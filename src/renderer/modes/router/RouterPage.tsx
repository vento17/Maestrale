import { pal } from '../../palette';
import { AQUA, AQUA_BRIGHT, ORANGE, ORANGE_BRIGHT } from '../../theme';
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { subscribeTabNav, tabDir, setTabDir, pendingCell, openCell, cellKey, nextCell } from './tabNav';
import { createPortal } from 'react-dom';
import { useStore } from '../../store';
import type { Project, Widget, RouterRow, RouterOutput, RouterInputType } from '../../../shared/types/project';
import type { Mapping, MidiMapping } from '../../../shared/types/mapping';
import { eachRouter, MAIN_ROUTER_ID } from '../../widgets/base/routers';
import { cellLabel, sourceCells, targetCells, allCellsLabel } from '../../widgets/base/links';
import { GLOBAL_BAR_HEIGHT } from '../GlobalBar';
import { cellMapping, mappingScale } from '../../widgets/base/cellMapping';
import { ChaosIcon } from './ChaosIcon';

/**
 * Router page — every link in the project as one table.
 *
 * One line per link (a router output). Built to stay usable at a thousand
 * links: the list is virtualised, search matches page / widget / parameter /
 * protocol / address all at once, and every cell edits in place. Source and
 * destination open a navigator that starts AT the current parameter, so
 * re-pointing "LFO 1 → Sliders 1 · fader 1" to "Sliders 2 · fader 1" is: click
 * the destination, back, pick Sliders 2, pick the fader.
 *
 * Ranges are shown in each side's own units — 0–1 for widgets and OSC, 0–127
 * for MIDI, 0–255 for DMX — so OSC→MIDI reads 0 1 → 0 127 out of the box.
 */

// ─── Vocabulary ───────────────────────────────────────────────────────────────
// "Widget" is the whole object (Sliders 1), "parameter" one element of it
// (fader 3). Search understands both words.

const KIND_NAME: Partial<Record<Widget['kind'], string>> = {
  sliderBank: 'sliders', knobBank: 'knobs', buttonGrid: 'buttons', xyPad: 'xy pad',
  stepSequencer: 'step sequencer', graphWidget: 'graph', submasters: 'submasters',
  autoBpm: 'auto bpm', timeline: 'timeline', audioAnalyser: 'audio analyser',
  soundPlayer: 'sound player', cues: 'cues', lfoWidget: 'lfo', noiseWidget: 'noise', sketch: 'sketch', mathWidget: 'math',
  masterLevel: 'master', audioLevel: 'audio level', keyboard: 'keyboard', dmxRecorder: 'recorder', dmxPlayer: 'player', clock: 'clock', encoder: 'encoder', etc: 'etc', shell: 'shell', palette: 'palette', merge: 'merge',
};
const PARAM_NAME: Partial<Record<Widget['kind'], string>> = {
  sliderBank: 'fader', knobBank: 'knob', buttonGrid: 'button', xyPad: 'axis',
  submasters: 'submaster', keyboard: 'key', cues: 'cue', soundPlayer: 'track',
  timeline: 'track', clock: 'alarm',
};

type Proto = 'widget' | 'midi' | 'osc' | 'artnet' | 'sacn' | 'dmx' | 'none';
const PROTO_LABEL: Record<Proto, string> = {
  widget: 'Widget', midi: 'MIDI', osc: 'OSC', artnet: 'Art-Net', sacn: 'sACN', dmx: 'DMX', none: '—',
};
// Extra words search should accept for each protocol.
const PROTO_ALIAS: Record<Proto, string> = {
  widget: 'widget', midi: 'midi', osc: 'osc', artnet: 'artnet art net dmx', sacn: 'sacn e131 e1.31 dmx',
  dmx: 'dmx enttec', none: '',
};
const PROTO_COLOR: Record<Proto, string> = {
  widget: '#bbbbbb', midi: AQUA, osc: AQUA_BRIGHT, artnet: ORANGE, sacn: ORANGE_BRIGHT, dmx: '#e8e8e8', none: '#555',
};

function srcProto(row: RouterRow): Proto {
  const t = row.inputType ?? 'widget';
  if (t === 'midiCC' || t === 'midiNote') return 'midi';
  if (t === 'osc') return 'osc';
  if (t === 'artnet') return 'artnet';
  if (t === 'sacn') return 'sacn';
  return 'widget';
}
function dstProto(out: RouterOutput): Proto {
  if (out.targetWidgetId) return 'widget';
  const m = out.mapping;
  if (!m) return 'none';
  if (m.type === 'enttec') return 'dmx';
  return m.type;
}

// ─── Link model ───────────────────────────────────────────────────────────────

interface Link {
  key: string;
  routerId: string; routerLabel: string; isMain: boolean;
  row: RouterRow; out: RouterOutput;
  order: number; createdAt: number;
  src: Proto; dst: Proto;
  srcText: { main: string; sub: string; page: string };
  dstText: { main: string; sub: string; page: string };
  // What 0 and 1 mean on each side, in real units: a MIDI source is 0–127, a
  // fader whose own mapping sends DMX is 0–255, an OSC address 0–1…
  srcScale: Scale;
  dstScale: Scale;
  search: string;
}
type Scale = { lo: number; hi: number; int: boolean };

function protoScale(p: Proto, mapping?: Mapping): Scale {
  if (p === 'midi') return { lo: 0, hi: mapping?.type === 'midi' && mapping.messageType === 'pitchBend' ? 16383 : 127, int: true };
  if (p === 'artnet' || p === 'sacn' || p === 'dmx') return { lo: 0, hi: 255, int: true };
  return { lo: 0, hi: 1, int: false };
}

function widgetIndex(project: Project): Map<string, { w: Widget; page: string }> {
  const m = new Map<string, { w: Widget; page: string }>();
  for (const p of project.pages) for (const w of p.widgets) m.set(w.id, { w, page: p.name });
  return m;
}

function describeSource(row: RouterRow, idx: Map<string, { w: Widget; page: string }>): Link['srcText'] {
  const t: RouterInputType = row.inputType ?? 'widget';
  if (t === 'midiCC')   return { main: `CC ${row.midiNumber ?? 0}`, sub: `ch ${row.midiChannel || 'any'}`, page: '' };
  if (t === 'midiNote') return { main: `Note ${row.midiNumber ?? 0}`, sub: `ch ${row.midiChannel || 'any'}`, page: '' };
  if (t === 'osc')      return { main: row.oscAddress || '/…', sub: '', page: '' };
  if (t === 'artnet' || t === 'sacn') return { main: `U${row.artnetUniverse ?? (t === 'sacn' ? 1 : 0)} · ch ${row.artnetChannel ?? 1}`, sub: '', page: '' };
  const e = idx.get(row.widgetId);
  if (!e) return { main: '— pick a source —', sub: '', page: '' };
  return { main: e.w.label, sub: row.allCells ? allCellsLabel(e.w) : cellLabel(e.w, row.cellIndex), page: e.page };
}

function describeDest(out: RouterOutput, idx: Map<string, { w: Widget; page: string }>): Link['dstText'] {
  if (out.targetWidgetId) {
    const e = idx.get(out.targetWidgetId);
    if (!e) return { main: '— missing widget —', sub: '', page: '' };
    return { main: e.w.label, sub: out.targetAllCells ? allCellsLabel(e.w) : cellLabel(e.w, out.targetCellIndex ?? 0), page: e.page };
  }
  const m = out.mapping;
  if (!m) return { main: '— pick a destination —', sub: '', page: '' };
  if (m.type === 'midi') {
    const kind = m.messageType === 'controlChange' ? 'CC' : m.messageType === 'noteOn' ? 'Note' : m.messageType;
    return { main: `${kind} ${m.number}`, sub: `ch ${m.channel}`, page: '' };
  }
  if (m.type === 'osc') return { main: m.address, sub: '', page: '' };
  if (m.type === 'artnet') return { main: `U${m.universe} · ch ${m.channel}`, sub: '', page: '' };
  if (m.type === 'sacn') return { main: `U${m.universe} · ch ${m.channel}`, sub: '', page: '' };
  return { main: `ch ${m.channel}`, sub: 'Enttec', page: '' };
}

function buildLinks(project: Project): Link[] {
  const idx = widgetIndex(project);
  const links: Link[] = [];
  let order = 0;
  for (const r of eachRouter(project)) {
    for (const row of r.holder.rows) {
      for (const out of row.outputs) {
        const src = srcProto(row), dst = dstProto(out);
        const srcText = describeSource(row, idx), dstText = describeDest(out, idx);
        const sw = row.widgetId ? idx.get(row.widgetId)?.w : undefined;
        const tw = out.targetWidgetId ? idx.get(out.targetWidgetId)?.w : undefined;
        const search = [
          srcText.main, srcText.sub, srcText.page, dstText.main, dstText.sub, dstText.page,
          PROTO_LABEL[src], PROTO_LABEL[dst], src, dst, PROTO_ALIAS[src], PROTO_ALIAS[dst], r.label,
          sw && KIND_NAME[sw.kind], sw && PARAM_NAME[sw.kind],
          tw && KIND_NAME[tw.kind], tw && PARAM_NAME[tw.kind],
          src !== dst ? 'conversion' : '',
        ].filter(Boolean).join(' ').toLowerCase();
        const srcScale = src === 'widget' && row.widgetId
          ? mappingScale(cellMapping(project, row.widgetId, row.allCells ? 0 : row.cellIndex))
          : protoScale(src);
        const dstScale = dst === 'widget' && out.targetWidgetId
          ? mappingScale((out.targetCellIndex ?? 0) < 0 ? null : cellMapping(project, out.targetWidgetId, out.targetAllCells ? 0 : out.targetCellIndex ?? 0))
          : protoScale(dst, out.mapping);
        links.push({
          srcScale, dstScale,
          key: `${r.id}:${row.id}:${out.id}`,
          routerId: r.id, routerLabel: r.label, isMain: r.isMain,
          row, out, order: order++, createdAt: row.createdAt ?? 0,
          src, dst, srcText, dstText, search,
        });
      }
    }
  }
  return links;
}

// ─── Page ─────────────────────────────────────────────────────────────────────

type ProtoFilter = 'all' | Exclude<Proto, 'none'>;
type Units = 'native' | 'norm';
type SortKey = 'new' | 'old' | 'src' | 'dst';

const ROW_H = 36;
// The four numbers of a link, in the order Tab walks them across a row.
const NUM_COLS = 4;
const COLS: { key: string; label: string; w: number; sort?: SortKey; align?: 'right' | 'center' }[] = [
  { key: 'date',   label: 'Added',       w: 78,  sort: 'new' },
  { key: 'src',    label: 'Source',      w: 250, sort: 'src' },
  { key: 'sproto', label: 'In',          w: 70 },
  { key: 'inmin',  label: 'in min',      w: 62,  align: 'right' },
  { key: 'inmax',  label: 'in max',      w: 62,  align: 'right' },
  { key: 'arrow',  label: '',            w: 26,  align: 'center' },
  { key: 'dst',    label: 'Destination', w: 250, sort: 'dst' },
  { key: 'dproto', label: 'Out',         w: 70 },
  { key: 'outmin', label: 'out min',     w: 62,  align: 'right' },
  { key: 'outmax', label: 'out max',     w: 62,  align: 'right' },
  { key: 'live',   label: 'live',        w: 62,  align: 'right' },
  { key: 'smooth', label: 'smooth',      w: 144 },
  { key: 'spring', label: 'spring',      w: 120 },
  { key: 'router', label: 'Router',      w: 90 },
  { key: 'on',     label: 'on',          w: 40,  align: 'center' },
  { key: 'del',    label: '',            w: 36,  align: 'center' },
];
const TABLE_W = COLS.reduce((a, c) => a + c.w, 0);

type NavTarget = { link: Link; side: 'src' | 'dst'; x: number; y: number };

export default function RouterPage(): React.JSX.Element | null {
  const open = useStore((s) => s.routerPageOpen);
  const project = useStore((s) => s.project);
  const [query, setQuery] = useState('');
  const [proto, setProto] = useState<ProtoFilter>('all');
  const [conversions, setConversions] = useState(false);
  const [routerFilter, setRouterFilter] = useState<string>('all');
  const [sort, setSort] = useState<SortKey>('new');
  const [scrollTop, setScrollTop] = useState(0);
  const [viewH, setViewH] = useState(600);
  const [nav, setNav] = useState<NavTarget | null>(null);
  const [flashKey, setFlashKey] = useState<string | null>(null);
  // Real numbers (0–127, 0–255…) or everything 0–1. Remembered per machine.
  const [units, setUnitsState] = useState<Units>(() => {
    try { return localStorage.getItem('lf.router.units') === 'norm' ? 'norm' : 'native'; } catch { return 'native'; }
  });
  const setUnits = (u: Units) => { setUnitsState(u); try { localStorage.setItem('lf.router.units', u); } catch { /* private mode */ } };
  const scrollRef = useRef<HTMLDivElement>(null);
  const tDir = useSyncExternalStore(subscribeTabNav, tabDir);
  const searchRef = useRef<HTMLInputElement>(null);

  const links = useMemo(() => buildLinks(project), [project]);
  const routers = useMemo(() => eachRouter(project).map((r) => ({ id: r.id, label: r.isMain ? 'Main' : `${r.label} · ${r.pageName}` })), [project]);

  const shown = useMemo(() => {
    const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
    const list = links.filter((l) => {
      if (routerFilter !== 'all' && l.routerId !== routerFilter) return false;
      if (proto !== 'all' && l.src !== proto && l.dst !== proto) return false;
      if (conversions && (l.src === l.dst || l.dst === 'none')) return false;
      return tokens.every((t) => l.search.includes(t));
    });
    const by = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
    const time = (l: Link) => l.createdAt || l.order;   // pre-dating rows keep list order
    if (sort === 'new') list.sort((a, b) => time(b) - time(a) || b.order - a.order);
    if (sort === 'old') list.sort((a, b) => time(a) - time(b) || a.order - b.order);
    if (sort === 'src') list.sort((a, b) => by(`${a.srcText.main} ${a.srcText.sub}`, `${b.srcText.main} ${b.srcText.sub}`));
    if (sort === 'dst') list.sort((a, b) => by(`${a.dstText.main} ${a.dstText.sub}`, `${b.dstText.main} ${b.dstText.sub}`));
    return list;
  }, [links, query, proto, conversions, routerFilter, sort]);

  // Keep the viewport height current for virtualisation.
  useLayoutEffect(() => {
    if (!open) return;
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewH(el.clientHeight));
    ro.observe(el);
    setViewH(el.clientHeight);
    return () => ro.disconnect();
  }, [open]);

  useEffect(() => { if (open) setTimeout(() => searchRef.current?.focus(), 0); }, [open]);

  // Esc: close the navigator first, then the page. Ctrl+F jumps to search.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault(); e.stopPropagation();
        if (nav) setNav(null); else useStore.getState().setRouterPageOpen(false);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault(); searchRef.current?.focus(); searchRef.current?.select();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, nav]);

  if (!open) return null;

  const first = Math.max(0, Math.floor(scrollTop / ROW_H) - 8);
  const last = Math.min(shown.length, Math.ceil((scrollTop + viewH) / ROW_H) + 8);
  const visible = shown.slice(first, last);

  const addLink = () => {
    useStore.getState().captureHistory();
    const rowId = useStore.getState().addMainRouterLink();
    setQuery(''); setProto('all'); setConversions(false); setRouterFilter('all'); setSort('new');
    scrollRef.current?.scrollTo({ top: 0 });
    const out = useStore.getState().project.mainRouter?.rows.find((r) => r.id === rowId)?.outputs[0];
    if (out) setFlashKey(`${MAIN_ROUTER_ID}:${rowId}:${out.id}`);
  };

  const chips: ProtoFilter[] = ['all', 'widget', 'midi', 'osc', 'artnet', 'sacn', 'dmx'];

  return (
    <div style={{
      position: 'fixed', left: 0, right: 0, top: GLOBAL_BAR_HEIGHT, bottom: 0, zIndex: 500,
      background: '#0b0b0b', display: 'flex', flexDirection: 'column', fontFamily: 'monospace', color: '#ccc',
    }}>
      {/* ── Toolbar ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderBottom: '1px solid #1d1d1d', flexWrap: 'wrap' }}>
        <ChaosIcon size={20} color={pal('#ff881f')} />
        <span style={{ fontSize: 14, letterSpacing: 3, color: '#eee', marginRight: 6 }}>ROUTER</span>
        <input
          ref={searchRef}
          value={query}
          onChange={(e) => { setQuery(e.target.value); scrollRef.current?.scrollTo({ top: 0 }); }}
          placeholder="search: sliders, fader, lfo, page 2, cc 7, /osc…   (Ctrl+F)"
          style={{
            flex: '1 1 320px', minWidth: 220, height: 34, padding: '0 12px', background: '#141414',
            border: '1px solid #2a2a2a', borderRadius: 4, color: '#eee', fontFamily: 'inherit', fontSize: 14,
          }}
        />
        <div style={{ display: 'flex', gap: 4 }}>
          {chips.map((c) => (
            <Chip key={c} on={proto === c} color={c === 'all' ? '#ddd' : PROTO_COLOR[c]} onClick={() => setProto(c)}>
              {c === 'all' ? 'All' : PROTO_LABEL[c]}
            </Chip>
          ))}
        </div>
        <Chip on={conversions} color={pal('#ff9e4a')} onClick={() => setConversions(!conversions)}>⇄ Conversions</Chip>
        <select value={routerFilter} onChange={(e) => setRouterFilter(e.target.value)} style={selectStyle}>
          <option value="all">all routers</option>
          {routers.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} style={selectStyle}>
          <option value="new">newest first</option>
          <option value="old">oldest first</option>
          <option value="src">source A→Z</option>
          <option value="dst">destination A→Z</option>
        </select>
        <button onClick={() => setTabDir(tDir === 'down' ? 'across' : 'down')}
          title="Where Tab goes from a number: down the same column, link after link, or across the row"
          style={{ ...btnStyle, color: '#ddd' }}>
          {tDir === 'down' ? 'tab: ↓ column' : 'tab: → row'}
        </button>
        <button onClick={() => setUnits(units === 'native' ? 'norm' : 'native')}
          title="Show ranges in real units (MIDI 0–127, DMX 0–255…) or all normalised 0–1"
          style={{ ...btnStyle, color: '#ddd' }}>
          {units === 'native' ? 'units: real' : 'units: 0–1'}
        </button>
        <button onClick={addLink} style={{ ...btnStyle, color: pal('#6ebec4'), borderColor: pal('#2e575a') }}>＋ Link</button>
        <span style={{ fontSize: 12, color: '#777', minWidth: 90, textAlign: 'right' }}>
          {shown.length === links.length ? `${links.length} links` : `${shown.length} / ${links.length}`}
        </span>
        <button title="Close (Esc)" onClick={() => useStore.getState().setRouterPageOpen(false)} style={{ ...btnStyle, width: 34, padding: 0 }}>✕</button>
      </div>

      {/* ── Table ── */}
      <div ref={scrollRef} className="lf-scroll" onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
        style={{ flex: 1, overflow: 'auto', position: 'relative' }}>
        <div style={{ width: TABLE_W, minWidth: '100%' }}>
          {/* Header */}
          <div style={{ position: 'sticky', top: 0, zIndex: 2, display: 'flex', height: 30, background: '#111', borderBottom: '1px solid #222' }}>
            {COLS.map((c) => {
              const active = c.sort && (sort === c.sort || (c.key === 'date' && sort === 'old'));
              return (
                <div key={c.key}
                  onClick={() => {
                    if (!c.sort) return;
                    if (c.key === 'date') setSort(sort === 'new' ? 'old' : 'new');
                    else setSort(c.sort);
                  }}
                  style={{
                    width: c.w, flexShrink: 0, padding: '0 8px', display: 'flex', alignItems: 'center',
                    justifyContent: c.align === 'right' ? 'flex-end' : c.align === 'center' ? 'center' : 'flex-start',
                    fontSize: 11, letterSpacing: 0.5, textTransform: 'uppercase', whiteSpace: 'nowrap',
                    color: active ? pal('#ff881f') : '#777', cursor: c.sort ? 'pointer' : 'default', userSelect: 'none',
                  }}>
                  {c.label}{c.key === 'date' && active ? (sort === 'new' ? ' ↓' : ' ↑') : active ? ' ↓' : ''}
                </div>
              );
            })}
          </div>

          {shown.length === 0 ? (
            <div style={{ padding: 30, color: '#555', fontSize: 14 }}>
              {links.length === 0
                ? 'No links yet — hold Shift in Live and drag a cable, right-click a control → Link, or ＋ Link.'
                : 'Nothing matches.'}
            </div>
          ) : (
            <div style={{ height: shown.length * ROW_H, position: 'relative' }}>
              {visible.map((l, i) => (
                <LinkLine key={l.key} link={l} top={(first + i) * ROW_H} row={first + i}
                  flash={flashKey === l.key} units={units}
                  onTab={(col, back) => {
                    const n = nextCell(first + i, col, shown.length, NUM_COLS, back);
                    // Scroll the row into view so it is rendered, then open it.
                    const el = scrollRef.current;
                    if (el) {
                      const y = n.row * ROW_H;
                      if (y < el.scrollTop + ROW_H) el.scrollTo({ top: Math.max(0, y - ROW_H * 2) });
                      else if (y > el.scrollTop + el.clientHeight - 2 * ROW_H) el.scrollTo({ top: y - el.clientHeight + 3 * ROW_H });
                    }
                    openCell(cellKey(n.row, n.col));
                  }}
                  onNav={(side, x, y) => setNav({ link: l, side, x, y })} />
              ))}
            </div>
          )}
        </div>
      </div>

      {nav && (
        <Navigator target={nav} onClose={() => setNav(null)} />
      )}
    </div>
  );
}

// ─── One table line ───────────────────────────────────────────────────────────

function LinkLine({ link: l, top, row, flash, onNav, onTab, units }: {
  link: Link; top: number; row: number; flash: boolean; units: Units;
  onNav: (side: 'src' | 'dst', x: number, y: number) => void;
  onTab: (col: number, back: boolean) => void;
}): React.JSX.Element {
  const m = l.out.mapping as (Mapping & { minValue?: number; maxValue?: number }) | null;
  const protoOut = l.dst !== 'widget' && l.dst !== 'none';
  const muted = !!l.out.muted;
  const native = units === 'native';
  const S = l.srcScale, D = l.dstScale;
  const NORM: Scale = { lo: 0, hi: 1, int: false };

  // Normalised 0–1 values as stored (protocol outputs keep native numbers in
  // their mapping, so convert those back first).
  const inMinN = l.out.inMin ?? 0, inMaxN = l.out.inMax ?? 1;
  const toN = (v: number, sc: Scale) => (sc.hi === sc.lo ? 0 : (v - sc.lo) / (sc.hi - sc.lo));
  const outMinN = protoOut ? toN(m?.minValue ?? D.lo, D) : (l.out.outMin ?? 0);
  const outMaxN = protoOut ? toN(m?.maxValue ?? D.hi, D) : (l.out.outMax ?? 1);
  const show = (n: number, sc: Scale) => (native ? sc.lo + n * (sc.hi - sc.lo) : n);

  const setIn = (k: 'inMin' | 'inMax', shown: number) => {
    const n = native ? toN(shown, S) : shown;
    useStore.getState().captureHistory();
    useStore.getState().updateRouterOutput(l.routerId, l.row.id, l.out.id, { [k]: n });
  };
  const setOut = (k: 'min' | 'max', shown: number) => {
    const n = native ? toN(shown, D) : shown;
    useStore.getState().captureHistory();
    if (protoOut && m) {
      const v = D.lo + n * (D.hi - D.lo);
      useStore.getState().updateRouterOutput(l.routerId, l.row.id, l.out.id, {
        mapping: { ...m, [k === 'min' ? 'minValue' : 'maxValue']: D.int ? Math.round(v) : v } as Mapping,
      });
    } else {
      useStore.getState().updateRouterOutput(l.routerId, l.row.id, l.out.id, { [k === 'min' ? 'outMin' : 'outMax']: n });
    }
  };
  const sIn = native ? S : NORM, sOut = native ? D : NORM;

  const cell = (w: number, children: React.ReactNode, align?: 'right' | 'center', extra?: React.CSSProperties) => (
    <div style={{
      width: w, flexShrink: 0, padding: '0 8px', display: 'flex', alignItems: 'center', overflow: 'hidden',
      justifyContent: align === 'right' ? 'flex-end' : align === 'center' ? 'center' : 'flex-start', ...extra,
    }}>{children}</div>
  );
  const W = Object.fromEntries(COLS.map((c) => [c.key, c.w]));

  return (
    <div style={{
      position: 'absolute', top, left: 0, right: 0, height: ROW_H, display: 'flex',
      borderBottom: '1px solid #161616', fontSize: 13,
      background: flash ? '#1d2a22' : undefined, opacity: muted ? 0.45 : 1,
    }}
      onMouseEnter={(e) => { if (!flash) e.currentTarget.style.background = '#131313'; }}
      onMouseLeave={(e) => { if (!flash) e.currentTarget.style.background = ''; }}
    >
      {cell(W.date, <span style={{ color: '#666', fontSize: 11 }}>{fmtDate(l.createdAt)}</span>)}
      {cell(W.src, <Target text={l.srcText} onClick={(e) => onNav('src', e.clientX, e.clientY)} />)}
      {cell(W.sproto, <ProtoTag p={l.src} />)}
      {cell(W.inmin, <NumCell navKey={cellKey(row, 0)} onTab={(back) => onTab(0, back)} value={show(inMinN, S)} scale={sIn} onCommit={(v) => setIn('inMin', v)} />, 'right')}
      {cell(W.inmax, <NumCell navKey={cellKey(row, 1)} onTab={(back) => onTab(1, back)} value={show(inMaxN, S)} scale={sIn} onCommit={(v) => setIn('inMax', v)} />, 'right')}
      {cell(W.arrow, <span style={{ color: l.src !== l.dst && l.dst !== 'none' ? pal('#ff9e4a') : '#555' }}>{l.src !== l.dst && l.dst !== 'none' ? '⇄' : '→'}</span>, 'center')}
      {cell(W.dst, <Target text={l.dstText} onClick={(e) => onNav('dst', e.clientX, e.clientY)} />)}
      {cell(W.dproto, <ProtoTag p={l.dst} />)}
      {cell(W.outmin, <NumCell navKey={cellKey(row, 2)} onTab={(back) => onTab(2, back)} value={show(outMinN, D)} scale={sOut} onCommit={(v) => setOut('min', v)} />, 'right')}
      {cell(W.outmax, <NumCell navKey={cellKey(row, 3)} onTab={(back) => onTab(3, back)} value={show(outMaxN, D)} scale={sOut} onCommit={(v) => setOut('max', v)} />, 'right')}
      {cell(W.live, <LiveValue link={l} scale={sIn} />, 'right')}
      {cell(W.smooth, <FilterCell on={!!l.out.smoothOn} value={l.out.smooth ?? 0.3}
        dir={l.out.smoothDir ?? 'both'}
        onDir={(d) => { useStore.getState().captureHistory(); useStore.getState().updateRouterOutput(l.routerId, l.row.id, l.out.id, { smoothDir: d }); }}
        hint="Smooth: glides to each new value instead of jumping — the slider sets how slowly"
        onToggle={(on) => { useStore.getState().captureHistory(); useStore.getState().updateRouterOutput(l.routerId, l.row.id, l.out.id, { smoothOn: on }); }}
        onChange={(v) => useStore.getState().updateRouterOutput(l.routerId, l.row.id, l.out.id, { smooth: v })} />)}
      {cell(W.spring, <FilterCell on={!!l.out.springOn} value={l.out.spring ?? 0.5}
        hint="Spring: follows with a bounce — the slider sets how springy"
        onToggle={(on) => { useStore.getState().captureHistory(); useStore.getState().updateRouterOutput(l.routerId, l.row.id, l.out.id, { springOn: on }); }}
        onChange={(v) => useStore.getState().updateRouterOutput(l.routerId, l.row.id, l.out.id, { spring: v })} />)}
      {cell(W.router, <span style={{ color: l.isMain ? '#666' : '#9ab', fontSize: 11 }}>{l.routerLabel}</span>)}
      {cell(W.on, <input type="checkbox" checked={!muted} title={muted ? 'Off — click to enable' : 'On — click to switch off'}
        onChange={() => {
          useStore.getState().captureHistory();
          useStore.getState().updateRouterOutput(l.routerId, l.row.id, l.out.id, { muted: !muted });
        }} />, 'center')}
      {cell(W.del, <button title="Delete link" onClick={() => useStore.getState().removeRouterOutputs([{ routerId: l.routerId, rowId: l.row.id, outputId: l.out.id }])}
        style={{ background: 'none', border: 'none', color: '#664444', cursor: 'pointer', fontSize: 14 }}>✕</button>, 'center')}
    </div>
  );
}

// Toggle + slider for a motion filter on one link.
type SmoothDir = 'in' | 'both' | 'out';
const DIR_NEXT: Record<SmoothDir, SmoothDir> = { in: 'both', both: 'out', out: 'in' };
const DIR_HINT: Record<SmoothDir, string> = { in: 'only rising (attack)', both: 'rising and falling', out: 'only falling (release)' };
// Little curve: ramp up, S (ease in-out), ramp down.
function DirIcon({ d }: { d: SmoothDir }): React.JSX.Element {
  const path = d === 'in' ? 'M2 12 L12 2' : d === 'out' ? 'M2 2 L12 12' : 'M2 12 C8 12 6 2 12 2';
  return <svg width={14} height={14} viewBox="0 0 14 14"><path d={path} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" /></svg>;
}

function FilterCell({ on, value, hint, onToggle, onChange, dir, onDir }: {
  on: boolean; value: number; hint: string; onToggle: (on: boolean) => void; onChange: (v: number) => void;
  dir?: SmoothDir; onDir?: (d: SmoothDir) => void;
}): React.JSX.Element {
  return (
    <div title={hint} style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%' }}>
      <input type="checkbox" checked={on} onChange={(e) => onToggle(e.target.checked)} />
      {dir && onDir && (
        <button onClick={() => onDir(DIR_NEXT[dir])} title={`Smooth ${DIR_HINT[dir]} — click: in → both → out`}
          style={{ width: 20, height: 18, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            background: 'transparent', border: '1px solid #2a2a2a', borderRadius: 3, cursor: 'pointer', color: on ? 'var(--lf-aqua)' : '#555' }}>
          <DirIcon d={dir} />
        </button>
      )}
      <input type="range" min={0} max={1} step={0.01} value={value} disabled={!on}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ flex: 1, minWidth: 0, opacity: on ? 1 : 0.3, accentColor: 'var(--lf-aqua)' }} />
    </div>
  );
}

function fmtDate(t: number): string {
  if (!t) return '—';
  const d = new Date(t);
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return hm;
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} ${hm}`;
}

function Target({ text, onClick }: { text: Link['srcText']; onClick: (e: React.MouseEvent) => void }): React.JSX.Element {
  return (
    <button onClick={onClick} title="Click to change"
      style={{
        width: '100%', height: 28, display: 'flex', alignItems: 'baseline', gap: 6, padding: '0 6px',
        background: '#121212', border: '1px solid #222', borderRadius: 3, cursor: 'pointer',
        fontFamily: 'inherit', textAlign: 'left', overflow: 'hidden', whiteSpace: 'nowrap', color: '#ddd', fontSize: 13,
        lineHeight: '26px',
      }}>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{text.main}</span>
      {text.sub && <span style={{ color: pal('#ff881f'), flexShrink: 0 }}>{text.sub}</span>}
      {text.page && <span style={{ color: '#555', fontSize: 11, marginLeft: 'auto', flexShrink: 0 }}>{text.page}</span>}
    </button>
  );
}

function ProtoTag({ p }: { p: Proto }): React.JSX.Element {
  return <span style={{ fontSize: 11, color: PROTO_COLOR[p], border: `1px solid ${PROTO_COLOR[p]}44`, borderRadius: 3, padding: '1px 5px' }}>{PROTO_LABEL[p]}</span>;
}

// Number shown in the current units; click to type, Enter/blur commits.
function fmtScaled(v: number, sc: Scale): string {
  return sc.int ? String(Math.round(v)) : String(Math.round(v * 1000) / 1000);
}
function NumCell({ value, scale, onCommit, navKey, onTab }: {
  value: number; scale: Scale; onCommit: (v: number) => void; navKey?: string; onTab?: (back: boolean) => void;
}): React.JSX.Element {
  const [edit, setEdit] = useState<string | null>(null);
  const lo = Math.min(scale.lo, scale.hi), hi = Math.max(scale.lo, scale.hi);
  // Tab from the number before this one: open for typing straight away.
  const pend = useSyncExternalStore(subscribeTabNav, pendingCell);
  const shown = fmtScaled(value, scale);
  useEffect(() => {
    if (navKey && pend === navKey && edit === null) { openCell(null); setEdit(shown); }
  }, [pend, navKey, edit, shown]);
  if (edit !== null) {
    const commit = () => {
      const v = Number(edit.replace(',', '.'));
      setEdit(null);
      if (Number.isFinite(v)) onCommit(Math.max(lo, Math.min(hi, v)));
    };
    return (
      <input autoFocus onFocus={(e) => e.currentTarget.select()} value={edit} onChange={(e) => setEdit(e.target.value)} onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Tab' && onTab) { e.preventDefault(); e.stopPropagation(); commit(); onTab(e.shiftKey); }
          if (e.key === 'Escape') { e.stopPropagation(); setEdit(null); }
        }}
        style={{ width: '100%', height: 26, background: '#000', border: `1px solid ${pal('#ff881f')}`, color: '#fff', textAlign: 'right', fontFamily: 'inherit', fontSize: 13, padding: '0 4px' }} />
    );
  }
  return (
    <span onClick={() => setEdit(fmtScaled(value, scale))} title={`Click to edit (${fmtScaled(scale.lo, scale)}–${fmtScaled(scale.hi, scale)})`}
      style={{ cursor: 'text', color: '#bbb', padding: '2px 4px', borderRadius: 2, minWidth: 30, textAlign: 'right' }}>
      {fmtScaled(value, scale)}
    </span>
  );
}

// What the link is receiving right now, in source units. Polled at 10 Hz: only
// visible lines exist, so a thousand links cost nothing.
function LiveValue({ link, scale }: { link: Link; scale: Scale }): React.JSX.Element {
  const [v, setV] = useState(0);
  useEffect(() => {
    const read = () => {
      const st = useStore.getState();
      const row = link.row;
      let x = 0;
      if ((row.inputType ?? 'widget') === 'widget') {
        const c = st.runtime.widgets[row.widgetId]?.cells[row.allCells ? 0 : row.cellIndex];
        x = c ? (c.value ?? (c.active ? 1 : 0)) : 0;
      } else {
        x = st.runtime.routerInputs?.[row.id] ?? 0;
      }
      setV(x);
    };
    read();
    const t = setInterval(read, 100);
    return () => clearInterval(t);
  }, [link.row]);
  return <span style={{ color: v > 0 ? pal('#6ebec4') : '#444' }}>{fmtScaled(scale.lo + v * (scale.hi - scale.lo), scale)}</span>;
}

// ─── Navigator popup ──────────────────────────────────────────────────────────
// Starts where the link already points and lets you walk up (parameter →
// widget → page → type) and back down somewhere else.

type NavLevel =
  | { kind: 'type' }
  | { kind: 'pages' }
  | { kind: 'widgets'; pageId: string }
  | { kind: 'params'; widgetId: string }
  | { kind: 'form'; proto: Proto };

function Navigator({ target, onClose }: { target: NavTarget; onClose: () => void }): React.JSX.Element {
  const project = useStore((s) => s.project);
  const { link, side } = target;
  const isSrc = side === 'src';

  const initial = (): NavLevel => {
    if (isSrc) {
      if (link.src === 'widget') return link.row.widgetId ? { kind: 'params', widgetId: link.row.widgetId } : { kind: 'pages' };
      return { kind: 'form', proto: link.src };
    }
    if (link.dst === 'widget') return { kind: 'params', widgetId: link.out.targetWidgetId! };
    if (link.dst === 'none') return { kind: 'type' };
    return { kind: 'form', proto: link.dst };
  };
  const [level, setLevel] = useState<NavLevel>(initial);
  const [filter, setFilter] = useState('');
  useEffect(() => setFilter(''), [level]);

  const pageOf = (wid: string) => project.pages.find((p) => p.widgets.some((w) => w.id === wid));
  const widget = level.kind === 'params' ? project.pages.flatMap((p) => p.widgets).find((w) => w.id === level.widgetId) : undefined;

  const back = (): void => {
    if (level.kind === 'params') { const p = pageOf(level.widgetId); setLevel(p ? { kind: 'widgets', pageId: p.id } : { kind: 'pages' }); }
    else if (level.kind === 'widgets') setLevel({ kind: 'pages' });
    else if (level.kind === 'pages' || level.kind === 'form') setLevel({ kind: 'type' });
  };

  // Changing the source of one output of a shared row must not move the others.
  const ownRow = (): string => useStore.getState().splitRouterOutput(link.routerId, link.row.id, link.out.id);

  const applyWidget = (wid: string, cell: number | 'all'): void => {
    const st = useStore.getState();
    st.captureHistory();
    if (isSrc) {
      const rowId = ownRow();
      st.updateRouterRow(link.routerId, rowId, cell === 'all'
        ? { inputType: 'widget', widgetId: wid, cellIndex: 0, allCells: true }
        : { inputType: 'widget', widgetId: wid, cellIndex: cell, allCells: false });
    } else {
      st.updateRouterOutput(link.routerId, link.row.id, link.out.id, cell === 'all'
        ? { targetWidgetId: wid, targetCellIndex: 0, targetAllCells: true, mapping: null }
        : { targetWidgetId: wid, targetCellIndex: cell, targetAllCells: false, mapping: null });
    }
    onClose();
  };

  // Destination widgets: anything with cells to drive. Sources: anything with
  // cells to read.
  const cellsOf = (w: Widget) => (isSrc ? sourceCells(w) : targetCells(w));

  const title = isSrc ? 'source' : 'destination';
  const crumbs: string[] = [];
  if (level.kind === 'widgets') crumbs.push(project.pages.find((p) => p.id === level.pageId)?.name ?? '?');
  if (level.kind === 'params' && widget) crumbs.push(pageOf(widget.id)?.name ?? '?', widget.label);
  if (level.kind === 'form') crumbs.push(PROTO_LABEL[level.proto]);

  const f = filter.toLowerCase();
  const match = (s: string) => !f || s.toLowerCase().includes(f);

  return (
    <Popup x={target.x} y={target.y} onClose={onClose}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderBottom: '1px solid #262626' }}>
        {level.kind !== 'type' && (
          <button onClick={back} style={{ ...btnStyle, height: 30, padding: '0 10px' }}>‹ back</button>
        )}
        <span style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: 1 }}>{title}</span>
        <span style={{ fontSize: 12, color: '#ccc', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {crumbs.join(' › ')}
        </span>
      </div>
      {(level.kind === 'pages' || level.kind === 'widgets' || level.kind === 'params') && (
        <input autoFocus value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="filter…"
          style={{ margin: '8px 10px 4px', width: 'calc(100% - 20px)', height: 30, background: '#0d0d0d', border: '1px solid #2a2a2a', color: '#eee', padding: '0 8px', fontFamily: 'inherit', fontSize: 13 }} />
      )}

      <div className="lf-scroll" style={{ maxHeight: '55vh', overflowY: 'auto', padding: '4px 0' }}>
        {level.kind === 'type' && (
          <>
            <NavItem onClick={() => setLevel({ kind: 'pages' })} color={PROTO_COLOR.widget}>Widget ▸</NavItem>
            {(isSrc ? (['midi', 'osc', 'artnet', 'sacn'] as Proto[]) : (['midi', 'osc', 'artnet', 'sacn', 'dmx'] as Proto[])).map((p) => (
              <NavItem key={p} color={PROTO_COLOR[p]} onClick={() => setLevel({ kind: 'form', proto: p })}>{PROTO_LABEL[p]} ▸</NavItem>
            ))}
          </>
        )}

        {level.kind === 'pages' && project.pages.filter((p) => match(p.name)).map((p) => {
          const n = p.widgets.filter((w) => cellsOf(w).length > 0).length;
          return (
            <NavItem key={p.id} onClick={() => setLevel({ kind: 'widgets', pageId: p.id })}>
              {p.name} <span style={{ color: '#555' }}>· {n} widgets</span> ▸
            </NavItem>
          );
        })}

        {level.kind === 'widgets' && (project.pages.find((p) => p.id === level.pageId)?.widgets ?? [])
          .filter((w) => cellsOf(w).length > 0 && match(`${w.label} ${KIND_NAME[w.kind] ?? w.kind}`))
          .map((w) => (
            <NavItem key={w.id} onClick={() => setLevel({ kind: 'params', widgetId: w.id })}
              current={(isSrc ? link.row.widgetId : link.out.targetWidgetId) === w.id}>
              {w.label} <span style={{ color: '#555' }}>· {KIND_NAME[w.kind] ?? w.kind}</span> ▸
            </NavItem>
          ))}

        {level.kind === 'params' && widget && (
          <>
            {cellsOf(widget).filter((c) => c.index >= 0).length > 1 && match('all') && (
              <NavItem onClick={() => applyWidget(widget.id, 'all')}
                current={isSrc ? (link.row.widgetId === widget.id && !!link.row.allCells) : (link.out.targetWidgetId === widget.id && !!link.out.targetAllCells)}>
                ✳ {allCellsLabel(widget)} <span style={{ color: '#555' }}>· every {PARAM_NAME[widget.kind] ?? 'cell'}</span>
              </NavItem>
            )}
            {cellsOf(widget).filter((c) => match(`${c.label} ${PARAM_NAME[widget.kind] ?? ''} ${c.index + 1}`)).map((c) => {
              const cur = isSrc
                ? link.row.widgetId === widget.id && !link.row.allCells && link.row.cellIndex === c.index
                : link.out.targetWidgetId === widget.id && !link.out.targetAllCells && (link.out.targetCellIndex ?? 0) === c.index;
              return (
                <NavItem key={c.index} current={cur} onClick={() => applyWidget(widget.id, c.index)}>
                  {c.label}
                  {PARAM_NAME[widget.kind] && c.index >= 0 && <span style={{ color: '#555' }}> · {PARAM_NAME[widget.kind]} {c.index + 1}</span>}
                </NavItem>
              );
            })}
          </>
        )}

        {level.kind === 'form' && (
          <ProtoForm proto={level.proto} isSrc={isSrc} link={link} onDone={onClose} ownRow={ownRow} />
        )}
      </div>
    </Popup>
  );
}

function ProtoForm({ proto, isSrc, link, onDone, ownRow }: {
  proto: Proto; isSrc: boolean; link: Link; onDone: () => void; ownRow: () => string;
}): React.JSX.Element {
  const row = link.row;
  const m = link.out.mapping as (Mapping & Record<string, unknown>) | null;
  const same = isSrc ? link.src === proto : link.dst === proto;

  // Start from what the link has now when it is already this protocol.
  const [midiKind, setMidiKind] = useState<'cc' | 'note'>(
    isSrc ? (row.inputType === 'midiNote' ? 'note' : 'cc') : (m?.type === 'midi' && (m as MidiMapping).messageType === 'noteOn' ? 'note' : 'cc'));
  const [ch, setCh] = useState<number>(same
    ? (isSrc ? (proto === 'artnet' || proto === 'sacn' ? row.artnetChannel ?? 1 : row.midiChannel ?? 0) : Number(m?.channel ?? 1))
    : (proto === 'midi' ? (isSrc ? 0 : 1) : 1));
  const [num, setNum] = useState<number>(same ? (isSrc ? (proto === 'artnet' || proto === 'sacn' ? row.artnetUniverse ?? (proto === 'sacn' ? 1 : 0) : row.midiNumber ?? 0)
    : Number(proto === 'midi' ? m?.number ?? 0 : m?.universe ?? (proto === 'sacn' ? 1 : 0))) : (proto === 'sacn' ? 1 : 0));
  const [addr, setAddr] = useState<string>(same ? (isSrc ? row.oscAddress ?? '/' : String(m?.address ?? '/')) : '/');

  const apply = () => {
    const st = useStore.getState();
    st.captureHistory();
    if (isSrc) {
      const rowId = ownRow();
      if (proto === 'midi') st.updateRouterRow(link.routerId, rowId, { inputType: midiKind === 'cc' ? 'midiCC' : 'midiNote', midiChannel: ch, midiNumber: num, widgetId: '', allCells: false });
      if (proto === 'osc') st.updateRouterRow(link.routerId, rowId, { inputType: 'osc', oscAddress: addr, widgetId: '', allCells: false });
      if (proto === 'artnet') st.updateRouterRow(link.routerId, rowId, { inputType: 'artnet', artnetUniverse: num, artnetChannel: ch, widgetId: '', allCells: false });
      if (proto === 'sacn') st.updateRouterRow(link.routerId, rowId, { inputType: 'sacn', artnetUniverse: Math.max(1, num), artnetChannel: ch, widgetId: '', allCells: false });
    } else {
      // Native full range by default, so OSC→MIDI is 0–1 → 0–127 straight away.
      const keep = same && m ? { minValue: m.minValue, maxValue: m.maxValue } : null;
      let mapping: Mapping = null;
      if (proto === 'midi') mapping = { type: 'midi', messageType: midiKind === 'cc' ? 'controlChange' : 'noteOn', channel: Math.max(1, ch), number: num, minValue: 0, maxValue: 127, ...(keep as object) };
      if (proto === 'osc') mapping = { type: 'osc', address: addr, minValue: 0, maxValue: 1, ...(keep as object) };
      if (proto === 'artnet') mapping = { type: 'artnet', universe: num, channel: ch, minValue: 0, maxValue: 255, ...(keep as object) };
      if (proto === 'sacn') mapping = { type: 'sacn', universe: Math.max(1, num), channel: ch, minValue: 0, maxValue: 255, priority: 100, ...(keep as object) };
      if (proto === 'dmx') mapping = { type: 'enttec', channel: ch, minValue: 0, maxValue: 255, ...(keep as object) };
      st.updateRouterOutput(link.routerId, link.row.id, link.out.id, {
        mapping, targetWidgetId: undefined, targetCellIndex: undefined, targetAllCells: false, outMin: 0, outMax: 1,
      });
    }
    onDone();
  };

  const field = (label: string, value: number, set: (v: number) => void, min: number, max: number) => (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11, color: '#888', flex: 1 }}>
      {label}
      <input type="number" value={value} min={min} max={max}
        onChange={(e) => set(Math.max(min, Math.min(max, Number(e.target.value) || 0)))}
        onKeyDown={(e) => { if (e.key === 'Enter') apply(); }}
        style={formInput} />
    </label>
  );

  return (
    <div style={{ padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      {proto === 'midi' && (
        <>
          <div style={{ display: 'flex', gap: 4 }}>
            <Chip on={midiKind === 'cc'} color={PROTO_COLOR.midi} onClick={() => setMidiKind('cc')}>CC</Chip>
            <Chip on={midiKind === 'note'} color={PROTO_COLOR.midi} onClick={() => setMidiKind('note')}>Note</Chip>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {field(isSrc ? 'channel (0 = any)' : 'channel', ch, setCh, isSrc ? 0 : 1, 16)}
            {field(midiKind === 'cc' ? 'CC number' : 'note', num, setNum, 0, 127)}
          </div>
        </>
      )}
      {proto === 'osc' && (
        <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11, color: '#888' }}>
          address
          <input autoFocus value={addr} onChange={(e) => setAddr(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') apply(); }} style={formInput} />
        </label>
      )}
      {(proto === 'artnet' || proto === 'sacn') && (
        <div style={{ display: 'flex', gap: 8 }}>
          {field('universe', num, setNum, proto === 'sacn' ? 1 : 0, proto === 'sacn' ? 63999 : 32767)}
          {field('channel', ch, setCh, 1, 512)}
        </div>
      )}
      {proto === 'dmx' && field('channel (Enttec)', ch, setCh, 1, 512)}
      <button onClick={apply} style={{ ...btnStyle, height: 36, color: pal('#6ebec4'), borderColor: pal('#2e575a') }}>
        Set {isSrc ? 'source' : 'destination'}
      </button>
    </div>
  );
}

// ─── Small parts ──────────────────────────────────────────────────────────────

function Popup({ x, y, onClose, children }: { x: number; y: number; onClose: () => void; children: React.ReactNode }): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const left = Math.max(8, Math.min(x - 20, window.innerWidth - width - 8));
    const top = Math.max(8, Math.min(y + 14, window.innerHeight - height - 8));
    // Re-measured after every render (the content changes height as you
    // navigate) — only set when it actually moved, or it loops.
    setPos((p) => (p.left === left && p.top === top ? p : { left, top }));
  });
  useEffect(() => {
    const close = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    const t = setTimeout(() => document.addEventListener('pointerdown', close), 0);
    return () => { clearTimeout(t); document.removeEventListener('pointerdown', close); };
  }, [onClose]);
  return createPortal(
    <div ref={ref} style={{
      position: 'fixed', left: pos.left, top: pos.top, zIndex: 9999, width: 340,
      background: '#1a1a1a', border: '1px solid #3a3a3a', borderRadius: 6,
      boxShadow: '0 6px 28px rgba(0,0,0,0.75)', fontFamily: 'monospace', color: '#ccc',
    }}>{children}</div>,
    document.body,
  );
}

function NavItem({ children, onClick, current, color }: { children: React.ReactNode; onClick: () => void; current?: boolean; color?: string }): React.JSX.Element {
  return (
    <button onClick={onClick} style={{
      display: 'block', width: '100%', minHeight: 38, padding: '8px 14px', background: current ? pal('#2a1c10') : 'none',
      border: 'none', borderLeft: current ? `3px solid ${pal('#ff881f')}` : '3px solid transparent', cursor: 'pointer',
      textAlign: 'left', fontFamily: 'inherit', fontSize: 14, color: color ?? (current ? '#fff' : '#ccc'),
    }}
      onMouseEnter={(e) => { if (!current) e.currentTarget.style.background = '#222'; }}
      onMouseLeave={(e) => { if (!current) e.currentTarget.style.background = 'none'; }}
    >{children}</button>
  );
}

// '#ddd' + '22' would be '#ddd22' — not a colour at all, so the button kept the
// browser's own light background and the pale text vanished into it.
function hex6(c: string): string {
  const m = /^#([0-9a-f]{3})$/i.exec(c.trim());
  return m ? `#${m[1].split('').map((d) => d + d).join('')}` : c;
}
function Chip({ on, color, onClick, children }: { on: boolean; color: string; onClick: () => void; children: React.ReactNode }): React.JSX.Element {
  const c = hex6(color);
  return (
    <button onClick={onClick} style={{
      height: 30, padding: '0 10px', borderRadius: 15, cursor: 'pointer', fontFamily: 'monospace', fontSize: 12,
      background: on ? `${c}22` : 'transparent', color: on ? c : '#777',
      border: `1px solid ${on ? c : '#2a2a2a'}`,
    }}>{children}</button>
  );
}

const btnStyle: React.CSSProperties = {
  height: 34, padding: '0 12px', background: '#141414', border: '1px solid #2a2a2a', borderRadius: 4,
  color: '#ccc', cursor: 'pointer', fontFamily: 'monospace', fontSize: 13,
};
const selectStyle: React.CSSProperties = {
  height: 34, background: '#141414', border: '1px solid #2a2a2a', borderRadius: 4, color: '#ccc',
  fontFamily: 'monospace', fontSize: 12, padding: '0 6px',
};
const formInput: React.CSSProperties = {
  height: 32, background: '#0d0d0d', border: '1px solid #2a2a2a', color: '#eee', padding: '0 8px',
  fontFamily: 'monospace', fontSize: 14,
};
