import { pal, palRgb, onPalette } from '../../palette';
import React, { useEffect, useReducer, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '../../store';
import { cellCount } from '../../widgets/utils';
import { cellLabel, describeRowSource, allCellsLabel, INPUT_KINDS , isLinkSource } from '../../widgets/base/links';
import { eachRouter, MAIN_ROUTER_ID } from '../../widgets/base/routers';
import { paramInputsOf } from '../../widgets/base/paramInputs';
import { connectedInputs } from '../../widgets/Merge/mergeEngine';

// Drop target "the Merge box" (resolved to its next free input on drop).
const MERGE_NEXT = -999999;
function nextMergeInput(used: number[]): number {
  const u = new Set(used);
  let k = 1;
  while (u.has(k)) k++;
  return k;
}
import { GLOBAL_BAR_HEIGHT } from '../GlobalBar';
import type { Widget } from '../../../shared/types/project';

/**
 * Shift patching — link widgets by dragging cables, like a node editor.
 *
 * Hold Shift in Live and every cell grows two dots: the orange one at the
 * bottom is its OUTPUT (what it sends), the blue one at the top its INPUT (what
 * can drive it). Drag from an output and drop on any control to queue a link.
 * While Shift stays down the cable stays attached to the output, so one LFO can
 * be dropped on fader after fader without going back to the dot. Nothing is
 * written until the end: letting go of Shift (or finishing the last drag
 * without it) puts every queued link into the main router as one undo step.
 *
 * Shift also shows the links that already exist, as solid cables (a stub with
 * the source's name when the other end lives on another page or is MIDI/OSC).
 * Double-click a cable — or the blue dot of a linked control — to cut it.
 *
 * Like LearnModeLayer, this listens on document in the capture phase and only
 * swallows the pointer events it actually uses, so a Shift+click that is not
 * on a dot (the timeline uses those) still reaches the widget.
 */

const make_IN_COLOR = () => (pal('#67bbc1'));
let IN_COLOR = make_IN_COLOR();
onPalette(() => { IN_COLOR = make_IN_COLOR(); });
const make_OUT_COLOR = () => (pal('#ff881f'));
let OUT_COLOR = make_OUT_COLOR();
onPalette(() => { OUT_COLOR = make_OUT_COLOR(); });
const make_CUT_COLOR = () => (pal('#ffa04d'));
let CUT_COLOR = make_CUT_COLOR();
onPalette(() => { CUT_COLOR = make_CUT_COLOR(); });
const CABLE_HIT = 7;     // grab distance from a cable, px
const DOUBLE_MS = 400;   // double-tap window
const DOT = 12;          // dot diameter
const HIT = 16;          // grab radius around a dot
const SPACING = 18;      // dot pitch for widgets without per-cell elements


interface CellRef { widgetId: string; cellIndex: number }
interface Port extends CellRef { x: number; y: number; label: string }
interface Geometry {
  outs: Port[];
  ins: Port[];
  inRects: { ref: CellRef; rect: DOMRect }[];
  outByKey: Map<string, Port>;
  inByKey: Map<string, Port>;
}
interface PendingLink { source: CellRef; target: CellRef }

const keyOf = (c: CellRef): string => `${c.widgetId}:${c.cellIndex}`;
const EMPTY: Geometry = { outs: [], ins: [], inRects: [], outByKey: new Map(), inByKey: new Map() };

function findWidget(widgetId: string): Widget | undefined {
  for (const p of useStore.getState().project.pages) {
    const w = p.widgets.find((x) => x.id === widgetId);
    if (w) return w;
  }
  return undefined;
}

function describe(c: CellRef): string {
  const w = findWidget(c.widgetId);
  return w ? `${w.label} · ${cellLabel(w, c.cellIndex)}` : '—';
}

function isTyping(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

// Read every port off the DOM of the visible page. Cells that render their own
// element (data-lf-cell) get dots on that element; widgets whose outputs have
// no element of their own (LFO, math, timeline, analyser, XY axes…) get a row
// of dots along their edges, one per cell.
function measure(pending: PendingLink[] = []): Geometry {
  const root = document.getElementById('lf-page-canvas');
  const { project, activePageId } = useStore.getState();
  const page = project.pages.find((p) => p.id === activePageId);
  if (!root || !page) return EMPTY;

  const found = new Map<string, Map<number, DOMRect>>();
  root.querySelectorAll<HTMLElement>('[data-lf-widget][data-lf-cell]').forEach((el) => {
    const wid = el.getAttribute('data-lf-widget');
    const ci = Number(el.getAttribute('data-lf-cell'));
    if (!wid || !Number.isFinite(ci)) return;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return;
    let m = found.get(wid);
    if (!m) { m = new Map(); found.set(wid, m); }
    m.set(ci, r);
  });

  const g: Geometry = { outs: [], ins: [], inRects: [], outByKey: new Map(), inByKey: new Map() };
  const push = (list: Port[], map: Map<string, Port>, p: Port): void => { list.push(p); map.set(keyOf(p), p); };

  for (const w of page.widgets) {
    const n = cellCount(w);
    const params = paramInputsOf(w);
    if (n === 0 && params.length === 0) continue;
    const box = root.querySelector<HTMLElement>(`[data-lf-patch="${CSS.escape(w.id)}"]`)?.getBoundingClientRect();
    if (!box) continue;

    // Parameter inputs (timeline GO / STOP / BACK, LFO SPEED / RATE / PHASE)
    // sit as blue dots along the top edge, right of centre so they clear the
    // widget's own buttons.
    params.forEach((t, k) => {
      push(g.ins, g.inByKey, {
        widgetId: w.id, cellIndex: t.index, label: `${w.label} · ${t.label}`,
        x: box.left + Math.min(box.width - 20 - (params.length - 1) * 26, Math.max(20, box.width * 0.45)) + k * 26,
        y: box.top + 9,
      });
    });

    // Merge and Math: one box takes any number of cables. Each connected input gets a
    // port along the box's left edge; the box itself is the drop target for
    // the next one (MERGE_NEXT, resolved to the first free input on drop).
    if (w.kind === 'merge' || w.kind === 'mathWidget') {
      const box2 = root.querySelector<HTMLElement>(`[data-lf-merge-in="${CSS.escape(w.id)}"]`)?.getBoundingClientRect();
      if (box2 && box2.width > 0) {
        const ks = new Set(connectedInputs(project, w.id));
        pending.forEach((p) => { if (p.target.widgetId === w.id && p.target.cellIndex < 0 && p.target.cellIndex !== MERGE_NEXT) ks.add(-p.target.cellIndex); });
        const list = [...ks].sort((a, b) => a - b);
        const top = box2.top + 18, span = Math.max(1, box2.height - 26);
        list.forEach((k, j) => {
          push(g.ins, g.inByKey, { widgetId: w.id, cellIndex: -k, label: `${w.label} · in ${k}`,
            x: box2.left + 7, y: top + (list.length === 1 ? span / 2 : (j / (list.length - 1)) * span) });
        });
        push(g.ins, g.inByKey, { widgetId: w.id, cellIndex: MERGE_NEXT, label: `${w.label} · + new input (in ${nextMergeInput(list)})`,
          x: box2.left + box2.width / 2, y: box2.top + box2.height / 2 });
        g.inRects.push({ ref: { widgetId: w.id, cellIndex: MERGE_NEXT }, rect: box2 });
      }
    }

    const isIn = INPUT_KINDS.has(w.kind) || (w.kind === 'audioLevel' && w.mode === 'out');
    const isOut = isLinkSource(w);   // triggers-only widgets (players, recorder) get no output dot
    const cells = found.get(w.id);
    const missing: number[] = [];

    for (let i = 0; i < n; i++) {
      const r = cells?.get(i);
      if (!r) { missing.push(i); continue; }
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      // Scrolled out of its widget (a long cue list): no dot.
      if (cx < box.left || cx > box.right || cy < box.top || cy > box.bottom) continue;
      const label = `${w.label} · ${cellLabel(w, i)}`;
      // A fader or a button (tall, or about square) → input on top, output at
      // the bottom. A ROW (a cue, a sound track, a timeline track, a key: much
      // wider than tall) → input at its left, output at its right, always,
      // however tall the row is.
      const tall = r.height >= 30 && r.width <= r.height * 2;
      if (isOut) push(g.outs, g.outByKey, { widgetId: w.id, cellIndex: i, label,
        x: tall ? cx : r.right - 8, y: tall ? r.bottom - 8 : cy });
      if (isIn) {
        push(g.ins, g.inByKey, { widgetId: w.id, cellIndex: i, label,
          x: tall ? cx : r.left + 8, y: tall ? r.top + 8 : cy });
        g.inRects.push({ ref: { widgetId: w.id, cellIndex: i }, rect: r });
      }
    }

    if (missing.length > 0) {
      // X / Y pairs (XY pad dots, Sketch dots) are drawn in pairs with a gap
      // between pairs, so "2 X · 2 Y" reads as one dot's outputs.
      const group = w.kind === 'xyPad' || w.kind === 'sketch' ? 2 : 1;
      const GAP = group > 1 ? 12 : 0;
      const pitch = (c: number): number => c * SPACING + Math.floor(c / group) * GAP;
      let perRow = Math.max(1, Math.floor((box.width - 12) / SPACING));
      if (group > 1) { perRow = Math.max(group, perRow - (perRow % group)); while (perRow > group && pitch(perRow - 1) > box.width - 24) perRow -= group; }
      missing.forEach((i, k) => {
        const row = Math.floor(k / perRow);
        const col = k % perRow;
        const inRow = Math.min(perRow, missing.length - row * perRow);
        const x = box.left + box.width / 2 + pitch(col) - pitch(inRow - 1) / 2;
        const label = `${w.label} · ${cellLabel(w, i)}`;
        if (isOut) push(g.outs, g.outByKey, { widgetId: w.id, cellIndex: i, label, x, y: box.bottom - 9 - row * SPACING });
        if (isIn) push(g.ins, g.inByKey, { widgetId: w.id, cellIndex: i, label, x, y: box.top + 9 + row * SPACING });
      });
    }
  }
  return g;
}

function nearest(ports: Port[], x: number, y: number, max: number): Port | null {
  let best: Port | null = null;
  let bestD = max * max;
  for (const p of ports) {
    const d = (p.x - x) ** 2 + (p.y - y) ** 2;
    if (d <= bestD) { best = p; bestD = d; }
  }
  return best;
}

// Drop target under a point: a blue dot first, otherwise the control itself —
// dropping anywhere on a fader is easier than hitting its dot.
function hitInput(g: Geometry, x: number, y: number, exclude: CellRef | null): CellRef | null {
  const ex = exclude ? keyOf(exclude) : '';
  const dot = nearest(g.ins.filter((p) => keyOf(p) !== ex), x, y, HIT);
  if (dot) return { widgetId: dot.widgetId, cellIndex: dot.cellIndex };
  let best: { ref: CellRef; area: number } | null = null;
  for (const { ref, rect } of g.inRects) {
    if (keyOf(ref) === ex) continue;
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) continue;
    const area = rect.width * rect.height;
    if (!best || area < best.area) best = { ref, area };
  }
  return best?.ref ?? null;
}

function cablePath(sx: number, sy: number, tx: number, ty: number): string {
  const dy = Math.max(40, Math.abs(ty - sy) / 2);
  return `M ${sx} ${sy} C ${sx} ${sy + dy}, ${tx} ${ty - dy}, ${tx} ${ty}`;
}

function bezierPoints(sx: number, sy: number, tx: number, ty: number, n = 24): { x: number; y: number }[] {
  const dy = Math.max(40, Math.abs(ty - sy) / 2);
  const [x0, y0, x1, y1, x2, y2, x3, y3] = [sx, sy, sx, sy + dy, tx, ty - dy, tx, ty];
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    pts.push({
      x: u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3,
      y: u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3,
    });
  }
  return pts;
}

function distToPolyline(pts: { x: number; y: number }[], x: number, y: number): number {
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / len2));
    best = Math.min(best, Math.hypot(a.x + t * dx - x, a.y + t * dy - y));
  }
  return best;
}

// A link that already exists in some router: one router output → one cell.
// ALL rows/outputs are expanded cell by cell so each fader shows its cable.
interface LiveLink {
  routerId: string; rowId: string; outputId: string;
  source: CellRef | null;        // null = MIDI / OSC
  sourceLabel: string;
  target: CellRef;
}

function existingLinks(): LiveLink[] {
  const { project } = useStore.getState();
  const out: LiveLink[] = [];
  for (const r of eachRouter(project)) {
    {
      for (const row of r.holder.rows) {
        const isWidget = (row.inputType ?? 'widget') === 'widget';
        const src = isWidget && row.widgetId ? findWidget(row.widgetId) : undefined;
        if (isWidget && !src) continue;
        const desc = describeRowSource(project, row);
        for (const o of row.outputs) {
          if (!o.targetWidgetId) continue;            // protocol output, not a cable
          const tgt = findWidget(o.targetWidgetId);
          if (!tgt) continue;
          const base = { routerId: r.id, rowId: row.id, outputId: o.id };
          const cells = o.targetAllCells
            ? Array.from({ length: cellCount(tgt) }, (_, i) => i)
            : [o.targetCellIndex ?? 0];
          for (const ti of cells) {
            // ALL → ALL mirrors cell i onto cell i.
            const si = row.allCells && o.targetAllCells ? ti : row.cellIndex;
            if (src && row.allCells && o.targetAllCells && si >= cellCount(src)) continue;
            out.push({
              ...base,
              source: src ? { widgetId: src.id, cellIndex: si } : null,
              sourceLabel: src
                ? `${src.label} · ${row.allCells && !o.targetAllCells ? allCellsLabel(src) : cellLabel(src, si)}`
                : `${desc.primary} ${desc.secondary}`,
              target: { widgetId: tgt.id, cellIndex: ti },
            });
          }
        }
      }
    }
  }
  return out;
}

// Everything drawn as a cable this frame, existing and queued, with the points
// used to hit-test it.
interface DrawnCable {
  id: string;
  kind: 'existing' | 'pending';
  link?: LiveLink;
  pendingTarget?: CellRef;
  d: string;
  pts: { x: number; y: number }[];
  chip?: { x: number; y: number; text: string };
  label: string;
}

function buildCables(g: Geometry, pending: PendingLink[]): DrawnCable[] {
  const cables: DrawnCable[] = [];
  const queued = new Set(pending.map((p) => keyOf(p.target)));
  const STUB = 30;
  for (const l of existingLinks()) {
    if (queued.has(keyOf(l.target))) continue;   // about to be re-sourced
    const a = l.source ? g.outByKey.get(keyOf(l.source)) : undefined;
    const b = g.inByKey.get(keyOf(l.target));
    const id = `${l.outputId}:${keyOf(l.target)}`;
    const label = `${l.sourceLabel} → ${describe(l.target)}`;
    if (a && b) {
      cables.push({ id, kind: 'existing', link: l, label,
        d: cablePath(a.x, a.y, b.x, b.y), pts: bezierPoints(a.x, a.y, b.x, b.y) });
    } else if (b) {
      // Source on another page, or MIDI/OSC: a stub above the input, named.
      cables.push({ id, kind: 'existing', link: l, label,
        d: `M ${b.x} ${b.y} L ${b.x} ${b.y - STUB}`,
        pts: [{ x: b.x, y: b.y }, { x: b.x, y: b.y - STUB }],
        chip: { x: b.x, y: b.y - STUB, text: `◂ ${l.sourceLabel}` } });
    } else if (a) {
      cables.push({ id, kind: 'existing', link: l, label,
        d: `M ${a.x} ${a.y} L ${a.x} ${a.y + STUB}`,
        pts: [{ x: a.x, y: a.y }, { x: a.x, y: a.y + STUB }],
        chip: { x: a.x, y: a.y + STUB, text: `▸ ${describe(l.target)}` } });
    }
  }
  for (const p of pending) {
    const a = g.outByKey.get(keyOf(p.source));
    const b = g.inByKey.get(keyOf(p.target));
    if (!a || !b) continue;
    cables.push({ id: `p:${keyOf(p.target)}`, kind: 'pending', pendingTarget: p.target,
      label: `${describe(p.source)} → ${describe(p.target)}`,
      d: cablePath(a.x, a.y, b.x, b.y), pts: bezierPoints(a.x, a.y, b.x, b.y) });
  }
  return cables;
}

// What a double-click would cut: a linked blue dot first, then a cable.
type CutTarget = { kind: 'input'; ref: CellRef } | { kind: 'cable'; cable: DrawnCable };

function hitCut(g: Geometry, cables: DrawnCable[], x: number, y: number): CutTarget | null {
  const linked = new Set<string>();
  for (const c of cables) {
    const t = c.link?.target ?? c.pendingTarget;
    if (t) linked.add(keyOf(t));
  }
  const dot = nearest(g.ins.filter((p) => linked.has(keyOf(p))), x, y, HIT);
  if (dot) return { kind: 'input', ref: { widgetId: dot.widgetId, cellIndex: dot.cellIndex } };
  let best: DrawnCable | null = null;
  let bestD = CABLE_HIT;
  for (const c of cables) {
    const d = distToPolyline(c.pts, x, y);
    if (d <= bestD) { best = c; bestD = d; }
  }
  return best ? { kind: 'cable', cable: best } : null;
}

const cutId = (t: CutTarget): string => (t.kind === 'input' ? `in:${keyOf(t.ref)}` : `cable:${t.cable.id}`);

interface PatchState {
  shift: boolean;          // patching is on: latched OR Shift held
  latched: boolean;        // a tap on Shift switched it on (another tap: off)
  held: boolean;           // Shift is down right now
  latchedAtPress: boolean; // was it latched when this press began
  used: boolean;           // something was done while Shift was down (not a tap)
  cable: { source: CellRef; pressed: boolean; linkedOnDown: string | null } | null;
  pending: PendingLink[];
  pointer: { x: number; y: number };
  geo: Geometry;
  swallowing: boolean;   // inside a gesture we own: eat the widget's mouse/click events
  lastTap: { id: string; t: number } | null;   // for double-click to cut
}

export default function PatchLayer(): React.JSX.Element | null {
  const st = useRef<PatchState>({
    shift: false, latched: false, held: false, latchedAtPress: false, used: false, cable: null, pending: [],
    pointer: { x: 0, y: 0 }, geo: EMPTY, swallowing: false, lastTap: null,
  });
  const [, force] = useReducer((n: number) => n + 1, 0);

  const showing = st.current.shift || !!st.current.cable;

  // While patching the body carries .lf-patching; the widgets keep their look
  // (the dots and cables are drawn over them).
  useEffect(() => {
    document.body.classList.toggle('lf-patching', showing);
    return () => document.body.classList.remove('lf-patching');
  }, [showing]);

  // Re-measure every frame while visible: widgets move, lists scroll, pages
  // change under the dots.
  useEffect(() => {
    if (!showing) return;
    let raf = 0;
    const loop = (): void => {
      st.current.geo = measure(st.current.pending);
      force();
      raf = requestAnimationFrame(loop);
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, [showing]);

  useEffect(() => {
    const s = st.current;

    const reset = (): void => {
      s.shift = false; s.latched = false; s.held = false; s.cable = null; s.pending = []; s.swallowing = false;
      force();
    };

    // Cables are written as they are dropped (see addLink), so there is nothing
    // left to commit here — ending a session just drops the cable in hand.
    const finish = (): void => {
      s.cable = null;
      s.pending = [];
      force();
    };

    const addLink = (source: CellRef, target0: CellRef): void => {
      let target = target0;
      if (target.cellIndex === MERGE_NEXT) {
        // The Merge box: this cable becomes its next free input. Every earlier
        // cable is already in the project, so the store alone knows which
        // inputs are taken.
        const used = new Set(connectedInputs(useStore.getState().project, target.widgetId));
        target = { widgetId: target.widgetId, cellIndex: -nextMergeInput([...used]) };
      }
      if (keyOf(source) === keyOf(target)) return;
      // Each cable is written the moment it is dropped — one link, one undo
      // step, one save. They used to be queued and committed together when
      // Shift was tapped again, which meant a patch made and never confirmed
      // was quietly lost. linkSlaveCells already re-sources a slave cell that
      // had a source, so dropping on a patched input still replaces it.
      useStore.getState().linkSlaveCells(MAIN_ROUTER_ID, [{
        slaveWidgetId: target.widgetId, slaveCellIndex: target.cellIndex,
        sourceWidgetId: source.widgetId, sourceCellIndex: source.cellIndex,
      }]);
    };

    const eat = (e: Event): void => { e.preventDefault(); e.stopPropagation(); };

    const cut = (t: CutTarget): void => {
      if (t.kind === 'cable' && t.cable.kind === 'pending') {
        const k = keyOf(t.cable.pendingTarget!);
        s.pending = s.pending.filter((p) => keyOf(p.target) !== k);
      } else if (t.kind === 'cable' && t.cable.link) {
        const l = t.cable.link;
        useStore.getState().removeRouterOutputs([{ routerId: l.routerId, rowId: l.rowId, outputId: l.outputId }]);
      } else if (t.kind === 'input') {
        const k = keyOf(t.ref);
        s.pending = s.pending.filter((p) => keyOf(p.target) !== k);
        const seen = new Set<string>();
        const refs = existingLinks()
          .filter((l) => keyOf(l.target) === k)
          .filter((l) => (seen.has(l.outputId) ? false : (seen.add(l.outputId), true)))
          .map((l) => ({ routerId: l.routerId, rowId: l.rowId, outputId: l.outputId }));
        useStore.getState().removeRouterOutputs(refs);
      }
      force();
    };

    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && (s.shift || s.cable || s.pending.length)) {
        eat(e); reset(); return;
      }
      if (e.key === 'Shift') {
        // Live stays mounted behind Design: Shift there is the canvas's, not ours.
        if (e.repeat || isTyping(e.target) || useStore.getState().mode !== 'live') return;
        s.held = true; s.used = false; s.latchedAtPress = s.latched;
        s.shift = true;
        force();
        return;
      }
      // Shift used as a modifier (Shift+Arrow in the timeline…): not patching.
      if (s.held) {
        s.used = true;
        if (!s.latched && !s.cable && s.pending.length === 0) { s.shift = false; force(); }
      }
    };

    // Shift: a TAP switches patching on (cables stay shown, one drag = one
    // cable) and another tap switches it off. HOLDING it keeps the cable on the
    // pointer: many drops from the same output. Each drop is saved on its own,
    // so nothing depends on how the session ends.
    const releaseShift = (): void => {
      if (!s.held) return;
      s.held = false;
      if (!s.used) {
        // A tap: toggle.
        if (s.latchedAtPress) { s.latched = false; s.shift = false; s.cable = null; finish(); return; }
        s.latched = true; s.shift = true; force(); return;
      }
      if (s.latched) {
        // Held inside latched mode: drop the cable in hand, stay on.
        if (!s.cable?.pressed) s.cable = null;
        force();
        return;
      }
      s.shift = false;
      // Mid-drag: the drop that follows is the last one.
      if (s.cable?.pressed) { force(); return; }
      finish();
    };
    const onKeyUp = (e: KeyboardEvent): void => { if (e.key === 'Shift') releaseShift(); };

    const onPointerDown = (e: PointerEvent): void => {
      if (e.button !== 0) return;
      if (!s.shift && !s.cable) return;
      const x = e.clientX, y = e.clientY;
      s.pointer = { x, y };
      s.geo = measure(s.pending);

      if (s.held) s.used = true;
      const out = nearest(s.geo.outs, x, y, HIT);
      if (out) {
        eat(e);
        s.swallowing = true;
        s.cable = { source: { widgetId: out.widgetId, cellIndex: out.cellIndex }, pressed: true, linkedOnDown: null };
        force();
        return;
      }
      // No cable in hand: a double-click on a cable or a linked blue dot cuts it.
      if (!s.cable) {
        const t = hitCut(s.geo, buildCables(s.geo, s.pending), x, y);
        if (!t) { s.lastTap = null; return; }
        eat(e);
        s.swallowing = true;
        const id = cutId(t);
        const now = performance.now();
        if (s.lastTap && s.lastTap.id === id && now - s.lastTap.t < DOUBLE_MS) {
          s.lastTap = null;
          cut(t);
        } else {
          s.lastTap = { id, t: now };
        }
        return;
      }
      // Cable still attached (Shift held): a tap on a control links it too.
      if (s.cable) {
        const tgt = hitInput(s.geo, x, y, s.cable.source);
        if (tgt) {
          eat(e);
          s.swallowing = true;
          addLink(s.cable.source, tgt);
          s.cable.pressed = true;
          s.cable.linkedOnDown = keyOf(tgt);
          force();
        }
      }
    };

    const onPointerMove = (e: PointerEvent): void => {
      s.pointer = { x: e.clientX, y: e.clientY };
      if (s.swallowing) eat(e);
    };

    const onPointerUp = (e: PointerEvent): void => {
      if (!s.swallowing) return;
      eat(e);
      // Keep eating until the click that follows this pointerup has gone by.
      setTimeout(() => { s.swallowing = false; }, 0);
      const c = s.cable;
      if (!c?.pressed) return;
      const x = e.clientX, y = e.clientY;
      s.pointer = { x, y };
      s.geo = measure(s.pending);
      const tgt = hitInput(s.geo, x, y, c.source);
      if (tgt && keyOf(tgt) !== c.linkedOnDown) addLink(c.source, tgt);
      if (s.held) {
        c.pressed = false;           // Shift held: cable stays on the mouse for the next drop
        c.linkedOnDown = null;
        force();
      } else if (s.latched) {
        s.cable = null;              // latched: one drag, one cable — patching stays on
        force();
      } else {
        finish();
      }
    };

    const swallow = (e: Event): void => { if (s.swallowing) eat(e); };
    const onBlur = (): void => { if (s.held) { s.used = true; releaseShift(); } };

    const SWALLOWED = ['mousedown', 'mouseup', 'click', 'dblclick', 'dragstart', 'contextmenu'] as const;
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    window.addEventListener('blur', onBlur);
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('pointermove', onPointerMove, true);
    document.addEventListener('pointerup', onPointerUp, true);
    SWALLOWED.forEach((t) => document.addEventListener(t, swallow, true));
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('pointermove', onPointerMove, true);
      document.removeEventListener('pointerup', onPointerUp, true);
      SWALLOWED.forEach((t) => document.removeEventListener(t, swallow, true));
    };
  }, []);

  const s = st.current;
  if (!showing) return null;

  const g = s.geo;
  const linkedTargets = new Set(s.pending.map((p) => keyOf(p.target)));
  const cables = buildCables(g, s.pending);
  const existingTargets = new Set(cables.filter((c) => c.link).map((c) => keyOf(c.link!.target)));
  // Linked from somewhere not on screen (another page, MIDI, OSC): the stub
  // cables that start at an input.
  const remoteTargets = new Set(cables
    .filter((c) => c.link && c.chip && c.chip.text.startsWith('◂'))
    .map((c) => keyOf(c.link!.target)));
  const sourceKey = s.cable ? keyOf(s.cable.source) : null;
  const hover = s.cable ? hitInput(g, s.pointer.x, s.pointer.y, s.cable.source) : null;
  const hoverPort = hover ? g.inByKey.get(keyOf(hover)) : null;
  const srcPort = s.cable ? g.outByKey.get(keyOf(s.cable.source)) : null;
  const hoverOut = !s.cable ? nearest(g.outs, s.pointer.x, s.pointer.y, HIT) : null;
  const hoverCut = !s.cable && !hoverOut ? hitCut(g, cables, s.pointer.x, s.pointer.y) : null;
  const cutCable = hoverCut?.kind === 'cable' ? hoverCut.cable.id : null;
  const cutInput = hoverCut?.kind === 'input' ? keyOf(hoverCut.ref) : null;
  // A free blue dot under the mouse (no cable in hand, nothing to cut): still
  // say what it is, so every dot tells its name on hover.
  const hoverIn = !s.cable && !hoverOut && !hoverCut ? nearest(g.ins, s.pointer.x, s.pointer.y, HIT) : null;
  const tip = (hoverPort ? `▸ IN  ${hoverPort.label}` : null)
    ?? (hoverOut ? `◂ OUT  ${hoverOut.label}   ·   drag to patch` : null)
    ?? (hoverCut?.kind === 'cable' ? `${hoverCut.cable.label}   ·   double-click: unlink` : null)
    ?? (hoverCut?.kind === 'input' ? `▸ IN  ${describe(hoverCut.ref)}   ·   double-click: unlink` : null)
    ?? (hoverIn ? `▸ IN  ${hoverIn.label}` : null);


  return createPortal(
    <>
      <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 9000 }}>
        <svg width="100%" height="100%" style={{ position: 'absolute', inset: 0, overflow: 'visible' }}>
          {cables.map((c) => {
            const hot = c.id === cutCable || (c.link && cutInput === keyOf(c.link.target))
              || (c.pendingTarget && cutInput === keyOf(c.pendingTarget));
            return (
              <path key={c.id} d={c.d} fill="none"
                stroke={hot ? CUT_COLOR : OUT_COLOR}
                strokeOpacity={hot ? 1 : c.kind === 'pending' ? 0.75 : 0.45}
                strokeWidth={hot ? 4 : 2}
                strokeDasharray={c.kind === 'pending' ? '6 5' : undefined} />
            );
          })}
          {srcPort && (
            <path
              d={cablePath(srcPort.x, srcPort.y, hoverPort?.x ?? s.pointer.x, hoverPort?.y ?? s.pointer.y)}
              fill="none" stroke={OUT_COLOR} strokeWidth={3}
            />
          )}
        </svg>

        {cables.filter((c) => c.chip && (c.id === cutCable
          || (c.link && cutInput === keyOf(c.link.target)))).map((c) => (
          <div key={`c${c.id}`} style={{
            position: 'absolute', left: c.chip!.x, top: c.chip!.y,
            transform: 'translate(-50%, -50%)', ...chip, fontSize: 11,
            color: c.id === cutCable ? CUT_COLOR : '#ccc',
          }}>{c.chip!.text}</div>
        ))}

        {g.ins.map((p) => {
          const k = keyOf(p);
          const hot = (hoverPort && keyOf(hoverPort) === k) || (hoverIn && keyOf(hoverIn) === k);
          const done = linkedTargets.has(k) || existingTargets.has(k);
          const remote = remoteTargets.has(k);
          const cutting = cutInput === k;
          const color = cutting ? CUT_COLOR : IN_COLOR;
          const d = hot || cutting ? DOT + 6 : DOT;
          return (
            <div key={`i${k}`} style={{
              position: 'absolute', left: p.x - d / 2, top: p.y - d / 2, width: d, height: d,
              borderRadius: '50%', boxSizing: 'border-box',
              border: `2px solid ${color}`,
              background: done || hot || cutting ? color : 'rgba(0,0,0,0.75)',
              // Fed from another page / MIDI / OSC: full AND glowing, so a
              // control with no visible cable still reads as taken.
              boxShadow: hot || cutting ? `0 0 10px ${color}`
                : remote ? `0 0 0 3px rgba(${palRgb('#67bbc1')},0.3), 0 0 10px ${IN_COLOR}` : undefined,
            }} />
          );
        })}
        {g.outs.map((p) => {
          const k = keyOf(p);
          const hot = k === sourceKey || (hoverOut && keyOf(hoverOut) === k);
          const d = hot ? DOT + 6 : DOT;
          return (
            <div key={`o${k}`} style={{
              position: 'absolute', left: p.x - d / 2, top: p.y - d / 2, width: d, height: d,
              borderRadius: '50%', boxSizing: 'border-box',
              border: `2px solid ${OUT_COLOR}`,
              background: hot ? OUT_COLOR : 'rgba(0,0,0,0.75)',
              boxShadow: hot ? `0 0 10px ${OUT_COLOR}` : undefined,
            }} />
          );
        })}

        {tip && (
          <div style={{
            position: 'absolute', left: s.pointer.x + 14, top: s.pointer.y + 14,
            ...chip,
          }}>{tip}</div>
        )}

        {(
          <div style={{ position: 'absolute', top: GLOBAL_BAR_HEIGHT + 10, left: '50%', transform: 'translateX(-50%)', ...chip, fontSize: 13 }}>
            <span style={{ color: OUT_COLOR }}>● output</span>
            {'  →  '}
            <span style={{ color: IN_COLOR }}>● input</span>
            {s.pending.length > 0 && <span style={{ color: '#ddd' }}>{`   ·   ${s.pending.length} pending`}</span>}
            <span style={{ color: '#777' }}>{s.latched
              ? '   ·   drag = one cable · hold Shift = many from one output · double-click a cable: unlink · tap Shift: save and close · Esc cancels'
              : '   ·   double-click a cable: unlink   ·   release Shift: save · tap Shift: stay in patching · Esc cancels'}</span>
          </div>
        )}
      </div>

    </>,
    document.body,
  );
}

const chip: React.CSSProperties = {
  background: 'rgba(0,0,0,0.82)', border: '1px solid #333', borderRadius: 11,
  padding: '3px 12px', fontSize: 12, color: '#ddd', fontFamily: 'monospace',
  whiteSpace: 'pre', pointerEvents: 'none',
};



