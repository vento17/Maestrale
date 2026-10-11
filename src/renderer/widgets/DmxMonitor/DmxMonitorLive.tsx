import { pal } from '../../palette';
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { DmxMonitorWidget, ArtNetConnection, SacnConnection } from '../../../shared/types/project';
import { PRIMARY_OUTPUT_ID } from '../../../shared/types/project';
import { useStore } from '../../store';
import { bridge } from '../../ipc/bridge';
import { onDmxInputStatus, getSeenSources } from '../../ipc/dmxInput';

// A universe as a grid of squares: channel number in each, black at 0, white
// at 255. IN shows what arrives (optionally from one sender), OUT what
// Maestrale sends (optionally to one destination). Drawn on a canvas so a
// 64 × 32 grid at 20 Hz costs nothing. When the grid holds fewer than 512
// channels a scrollbar on the right moves through the universe.

export interface IpOption { value: string; label: string }

// IN: every sender heard so far, plus localhost for apps on this PC.
export function inOptions(): IpOption[] {
  const ips = new Set(getSeenSources());
  ips.add('127.0.0.1');
  return [{ value: '', label: 'any sender' },
    ...[...ips].sort().map((ip) => ({ value: ip, label: ip === '127.0.0.1' ? '127.0.0.1 (localhost)' : ip }))];
}

// OUT: the destinations configured in Settings for that protocol.
export function outOptions(conns: ReturnType<typeof useStore.getState>['project']['connections'], protocol: 'artnet' | 'sacn'): IpOption[] {
  const all: IpOption[] = [{ value: '', label: 'all outputs' }];
  if (protocol === 'artnet') {
    const c = conns.find((x) => x.type === 'artnet') as ArtNetConnection | undefined;
    if (c) {
      all.push({ value: PRIMARY_OUTPUT_ID, label: `out 1 · ${c.targetHost || '255.255.255.255'}` });
      (c.extraOutputs ?? []).forEach((o, i) => all.push({ value: o.id, label: `${o.name || `out ${i + 2}`} · ${o.host || 'broadcast'}` }));
    }
  } else {
    const c = conns.find((x) => x.type === 'sacn') as SacnConnection | undefined;
    if (c) {
      all.push({ value: PRIMARY_OUTPUT_ID, label: `out 1 · ${c.mode === 'unicast' ? c.targetHost : 'multicast'}` });
      (c.extraOutputs ?? []).forEach((o, i) => all.push({ value: o.id, label: `${o.name || `out ${i + 2}`} · ${o.host || 'multicast'}` }));
    }
  }
  return all;
}

export default function DmxMonitorLive({ widget, preview = false }: { widget: DmxMonitorWidget; preview?: boolean }): React.JSX.Element {
  const conns = useStore((s) => s.project.connections);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const data = useRef(new Uint8Array(513));          // index = channel
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [, redraw] = useState(0);
  const [, bumpSources] = useState(0);
  const dirty = useRef(true);

  const cols = Math.max(1, Math.min(128, widget.cols || 16));
  const rows = Math.max(1, Math.min(128, widget.rows || 8));
  const dir = widget.source ?? 'in';
  const protocol = widget.protocol ?? 'artnet';
  const universe = widget.universe ?? 0;
  const ip = dir === 'in' ? (widget.sourceIp ?? '') : (widget.outputId ?? '');
  const totalRows = Math.ceil(512 / cols);
  const scrolls = rows < totalRows;
  const maxRow = Math.max(0, totalRows - rows);
  const rowOffset = scrolls ? Math.max(0, Math.min(maxRow, Math.floor(((widget.startChannel || 1) - 1) / cols))) : 0;
  const start = rowOffset * cols + 1;

  // New senders appear in the IN list as they are heard.
  useEffect(() => onDmxInputStatus(() => bumpSources((n) => n + 1)), []);

  // ── Feed: one watch in the main process, whichever direction ──
  useEffect(() => {
    data.current = new Uint8Array(513);
    dirty.current = true;
    if (preview) return;
    const watcherId = widget.id;
    void bridge.invoke('tr:dmxMon:watch', {
      watcherId, direction: dir, protocol, universe,
      sourceIp: dir === 'in' ? ip || undefined : undefined,
      outputId: dir === 'out' ? ip || undefined : undefined,
    }).catch(() => {});
    const off = bridge.on('tr:dmxMon:frame', (f) => {
      if (f.watcherId !== watcherId) return;
      for (let i = 0; i < 512; i++) data.current[i + 1] = f.data[i] ?? 0;
      dirty.current = true;
    });
    return () => { off(); void bridge.invoke('tr:dmxMon:watch', { watcherId, off: true }).catch(() => {}); };
  }, [dir, protocol, universe, ip, widget.id, preview]);

  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // ── Draw, only when something changed ──
  useEffect(() => {
    let raf = 0;
    const draw = () => {
      const cv = canvasRef.current;
      if (!cv || !size.w || !size.h) return;
      const dpr = window.devicePixelRatio || 1;
      cv.width = Math.round(size.w * dpr); cv.height = Math.round(size.h * dpr);
      const g = cv.getContext('2d');
      if (!g) return;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, size.w, size.h);
      const gap = cols > 40 || rows > 24 ? 1 : 2;
      const cw = (size.w - gap * (cols - 1)) / cols;
      const chh = (size.h - gap * (rows - 1)) / rows;
      const font = Math.max(6, Math.min(14, Math.min(cw * 0.32, chh * 0.5)));
      const showNum = cw >= 12 && chh >= 8;
      g.font = `${font}px monospace`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const ch = start + r * cols + c;
          const x = c * (cw + gap), y = r * (chh + gap);
          if (ch > 512) { g.fillStyle = '#080808'; g.fillRect(x, y, cw, chh); continue; }
          const v = data.current[ch];
          g.fillStyle = `rgb(${v},${v},${v})`;
          g.fillRect(x, y, cw, chh);
          if (cw > 6) { g.strokeStyle = '#141414'; g.lineWidth = 1; g.strokeRect(x + 0.5, y + 0.5, cw - 1, chh - 1); }
          if (showNum) { g.fillStyle = v > 110 ? '#000' : '#7a7a7a'; g.fillText(String(ch), x + cw / 2, y + chh / 2); }
        }
      }
    };
    const loop = () => {
      if (dirty.current) { dirty.current = false; draw(); redraw((n) => (n + 1) % 1e6); }
      raf = requestAnimationFrame(loop);
    };
    dirty.current = true;
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [size.w, size.h, cols, rows, start]);

  const update = (patch: Partial<DmxMonitorWidget>) => {
    const st = useStore.getState();
    const pageId = st.project.pages.find((p) => p.widgets.some((w) => w.id === widget.id))?.id;
    if (pageId) st.updateWidget(pageId, widget.id, patch as never);
  };
  const scrollTo = (row: number) => {
    const r = Math.max(0, Math.min(maxRow, Math.round(row)));
    if (r !== rowOffset) update({ startChannel: r * cols + 1 });
  };


  const fs = widget.style.fontSize || 14;
  const small = Math.max(9, fs - 4);
  const inp: React.CSSProperties = { height: 22, background: '#000', color: '#ddd', border: '1px solid #2a2a2a', fontFamily: 'inherit', fontSize: 11, padding: '0 4px' };
  const num = (label: string, value: number, min: number, max: number, set: (v: number) => void, w = 46) => (
    <label style={{ display: 'flex', alignItems: 'center', gap: 3, color: '#777' }}>
      {label}
      <input type="number" value={value} min={min} max={max}
        onChange={(e) => set(Math.max(min, Math.min(max, Number(e.target.value) || min)))}
        style={{ ...inp, width: w }} />
    </label>
  );
  const ipOpts = dir === 'in' ? inOptions() : outOptions(conns, protocol);
  const dirBtn = (d: 'in' | 'out') => (
    <button onClick={() => update({ source: d })}
      style={{ height: 22, padding: '0 8px', cursor: 'pointer', fontFamily: 'inherit', fontSize: 11, fontWeight: 700,
        background: dir === d ? (d === 'in' ? pal('#67bbc1') : pal('#ff881f')) : 'transparent',
        color: dir === d ? '#000' : '#777', border: `1px solid ${d === 'in' ? pal('#29c4ff55') : pal('#ff8a1f55')}` }}>{d.toUpperCase()}</button>
  );

  // Scrollbar thumb geometry.
  const thumbH = scrolls ? Math.max(18, (rows / totalRows) * size.h) : 0;
  const thumbY = scrolls && maxRow > 0 ? (rowOffset / maxRow) * (size.h - thumbH) : 0;
  const dragRef = useRef<{ y: number; row: number } | null>(null);

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', gap: 5, padding: 6, boxSizing: 'border-box', fontFamily: 'monospace' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: small, flexWrap: 'wrap', flexShrink: 0 }}>
        <div style={{ display: 'flex' }}>{dirBtn('in')}{dirBtn('out')}</div>
        <select value={protocol} onChange={(e) => update({ protocol: e.target.value as 'artnet' | 'sacn', outputId: '' })} style={inp}>
          <option value="artnet">Art-Net</option>
          <option value="sacn">sACN</option>
        </select>
        <select value={ip} title={dir === 'in' ? 'Show only what this sender puts out' : 'Show only what goes to this destination'}
          onChange={(e) => update(dir === 'in' ? { sourceIp: e.target.value } : { outputId: e.target.value })}
          style={{ ...inp, maxWidth: 190 }}>
          {ipOpts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          {ip && !ipOpts.some((o) => o.value === ip) && <option value={ip}>{ip}</option>}
        </select>
        {num('Universe', universe, 0, 32767, (v) => update({ universe: v }), 54)}
        <span style={{ marginLeft: 10, color: '#888' }}>Size</span>
        {num('', cols, 1, 128, (v) => update({ cols: v }), 40)}
        <span style={{ color: '#555' }}>×</span>
        {num('', rows, 1, 128, (v) => update({ rows: v }), 40)}
        {scrolls && (
          <span style={{ marginLeft: 'auto', color: '#aaa', flexShrink: 0, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
            {start}–{Math.min(512, start + cols * rows - 1)}
          </span>
        )}
      </div>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', gap: 4 }}>
        <div ref={boxRef} style={{ flex: 1, minWidth: 0, position: 'relative' }}
          onWheel={(e) => { if (scrolls) scrollTo(rowOffset + Math.sign(e.deltaY) * Math.max(1, Math.round(rows / 4))); }}>
          <canvas ref={canvasRef}
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
        </div>
        {scrolls && (
          <div
            title="Scroll through the universe"
            onPointerDown={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              const y = e.clientY - r.top;
              if (y < thumbY || y > thumbY + thumbH) scrollTo(((y - thumbH / 2) / Math.max(1, r.height - thumbH)) * maxRow);
              e.currentTarget.setPointerCapture(e.pointerId);
              dragRef.current = { y: e.clientY, row: y < thumbY || y > thumbY + thumbH ? ((y - thumbH / 2) / Math.max(1, r.height - thumbH)) * maxRow : rowOffset };
            }}
            onPointerMove={(e) => {
              const d = dragRef.current;
              if (!d) return;
              const r = e.currentTarget.getBoundingClientRect();
              scrollTo(d.row + ((e.clientY - d.y) / Math.max(1, r.height - thumbH)) * maxRow);
            }}
            onPointerUp={() => { dragRef.current = null; }}
            style={{ width: 14, flexShrink: 0, position: 'relative', background: 'rgba(255,255,255,0.04)', borderRadius: 3, cursor: 'pointer', touchAction: 'none' }}
          >
            <div style={{ position: 'absolute', left: 2, right: 2, top: thumbY, height: thumbH, background: dir === 'in' ? pal('#29c4ff88') : pal('#ff8a1f88'), borderRadius: 3 }} />
          </div>
        )}
      </div>
    </div>
  );
}
