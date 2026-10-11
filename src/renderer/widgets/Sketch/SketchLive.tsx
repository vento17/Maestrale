import { pal } from '../../palette';
import { MULTI } from '../../theme';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { nanoid } from 'nanoid';
import type { SketchWidget, SketchStroke } from '../../../shared/types/project';
import { useStore } from '../../store';
import CellLinkMenu from '../base/CellLinkMenu';
import { getParamInput, onParamInputs, genSpeedFromInput } from '../base/paramInputs';
import { useGlobalTransport } from '../base/useGlobalTransport';

// ─── Path geometry ────────────────────────────────────────────────────────────
// All strokes in order make one path; dots travel it by arc length. Jumps from
// the end of one stroke to the start of the next take no time.

interface Path { segs: { x0: number; y0: number; x1: number; y1: number; at: number; len: number }[]; total: number }

// Smooth: resample each line evenly, then average each point with its
// neighbours (a window that grows with `amount`). Ends stay where drawn.
export function smoothStrokes(strokes: SketchStroke[], amount: number, aspect: number): SketchStroke[] {
  if (amount <= 0) return strokes;
  const STEP = 0.004;
  return strokes.map((s) => {
    if (s.pts.length < 6) return s;
    const rs: number[] = [s.pts[0], s.pts[1]];
    let carry = 0;
    for (let i = 0; i + 3 < s.pts.length; i += 2) {
      const x0 = s.pts[i], y0 = s.pts[i + 1], x1 = s.pts[i + 2], y1 = s.pts[i + 3];
      const len = Math.hypot((x1 - x0) * aspect, y1 - y0);
      let d = STEP - carry;
      while (d <= len) { const k = d / len; rs.push(x0 + (x1 - x0) * k, y0 + (y1 - y0) * k); d += STEP; }
      carry = len - (d - STEP);
    }
    rs.push(s.pts[s.pts.length - 2], s.pts[s.pts.length - 1]);
    const n = rs.length / 2;
    const r = Math.max(1, Math.round(amount * amount * 60));
    const out: number[] = [];
    for (let i = 0; i < n; i++) {
      const w = Math.min(r, i, n - 1 - i);          // shrink the window at the ends
      let sx = 0, sy = 0;
      for (let j = i - w; j <= i + w; j++) { sx += rs[2 * j]; sy += rs[2 * j + 1]; }
      out.push(sx / (2 * w + 1), sy / (2 * w + 1));
    }
    return { id: s.id, pts: out };
  });
}

export function buildPath(strokes: SketchStroke[], aspect: number): Path {
  const segs: Path['segs'] = [];
  let at = 0;
  for (const s of strokes) {
    for (let i = 0; i + 3 < s.pts.length; i += 2) {
      const x0 = s.pts[i], y0 = s.pts[i + 1], x1 = s.pts[i + 2], y1 = s.pts[i + 3];
      // Length in screen proportions, so speed is even on a wide pad.
      const len = Math.hypot((x1 - x0) * aspect, y1 - y0);
      if (len <= 0) continue;
      segs.push({ x0, y0, x1, y1, at, len });
      at += len;
    }
    if (s.pts.length === 2) segs.push({ x0: s.pts[0], y0: s.pts[1], x1: s.pts[0], y1: s.pts[1], at, len: 0 });
  }
  return { segs, total: at };
}

export function pointAt(path: Path, u: number): [number, number] | null {
  if (!path.segs.length) return null;
  if (path.total <= 0) return [path.segs[0].x0, path.segs[0].y0];
  const d = Math.max(0, Math.min(1, u)) * path.total;
  let lo = 0, hi = path.segs.length - 1;
  while (lo < hi) {             // last segment starting at or before d
    const mid = (lo + hi + 1) >> 1;
    if (path.segs[mid].at <= d) lo = mid; else hi = mid - 1;
  }
  const s = path.segs[lo];
  const k = s.len > 0 ? Math.min(1, (d - s.at) / s.len) : 0;
  return [s.x0 + (s.x1 - s.x0) * k, s.y0 + (s.y1 - s.y0) * k];
}

const DOT_COLORS = MULTI;

function pageOf(widgetId: string): string | undefined {
  return useStore.getState().project.pages.find((p) => p.widgets.some((w) => w.id === widgetId))?.id;
}

// Draw on the pad (click and drag = a line, lines play one after the other),
// Alt+click on a line deletes it. ▶ runs `dots` dots along the drawing,
// `delay` apart, and puts out X / Y for each.
export default function SketchLive({ widget }: { widget: SketchWidget }): React.JSX.Element {
  const widgetRef = useRef(widget);
  widgetRef.current = widget;
  const boxRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 1, h: 1 });
  const [draft, setDraft] = useState<number[] | null>(null);
  const draftRef = useRef<number[] | null>(null);
  const [playing, setPlaying] = useState(false);
  const playingRef = useRef(false);
  const dirRef = useRef<1 | -1>(1);
  const [dir, setDir] = useState<1 | -1>(1);
  const posRef = useRef(0);                 // 0–1 along the drawing (dot 1)
  const [, setFrame] = useState(0);
  const [hoverStroke, setHoverStroke] = useState<string | null>(null);
  // Alt = delete (red), Shift = move, Ctrl = scale around its centre (orange).
  const [hoverMode, setHoverMode] = useState<'del' | 'edit'>('del');
  const editRef = useRef<{ id: string; mode: 'move' | 'scale'; start: [number, number]; orig: number[]; c: [number, number]; pts?: number[] } | null>(null);
  const [editPts, setEditPts] = useState<{ id: string; pts: number[] } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; cell: number } | null>(null);
  const liveSpeed = useRef<number | null>(null);
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [menu]);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth || 1, h: el.clientHeight || 1 }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const aspect = size.w / size.h;
  const smoothed = useMemo(() => smoothStrokes(widget.strokes ?? [], widget.smooth ?? 0, aspect), [widget.strokes, widget.smooth, aspect]);
  const path = useMemo(() => buildPath(smoothed, aspect), [smoothed, aspect]);
  const pathRef = useRef(path);
  pathRef.current = path;

  const n = Math.max(1, widget.dots || 1);
  const positions = (base: number): ([number, number] | null)[] => {
    const w = widgetRef.current;
    const out: ([number, number] | null)[] = [];
    for (let k = 0; k < Math.max(1, w.dots || 1); k++) {
      let u = base - k * (w.delay ?? 0);
      if (w.loop && w.pingPong) { u = ((u % 2) + 2) % 2; if (u > 1) u = 2 - u; }   // forward, then back
      else if (w.loop) u = ((u % 1) + 1) % 1;
      else u = Math.max(0, u);
      out.push(pointAt(pathRef.current, u));
    }
    return out;
  };

  const emit = () => {
    const w = widgetRef.current;
    const st = useStore.getState();
    positions(posRef.current).forEach((p, k) => {
      if (!p) return;
      st.setCellValue(w.id, 2 * k, p[0]);
      st.setCellValue(w.id, 2 * k + 1, 1 - p[1]);   // Y up, like the XY pad
    });
  };

  // Which way the dots run: 1 forward, −1 backwards (the ◀ button).
  const start = (d: 1 | -1 = 1) => { dirRef.current = d; setDir(d); playingRef.current = true; setPlaying(true); };
  const stop = () => { playingRef.current = false; setPlaying(false); };
  // Back to the start — or to the end, when it is running backwards.
  const reset = () => {
    const w = widgetRef.current;
    posRef.current = dirRef.current > 0 ? 0 : (w.loop ? (w.pingPong ? 2 : 1) : 1 + (Math.max(1, w.dots || 1) - 1) * (w.delay ?? 0));
    emit(); setFrame((f) => f + 1);
  };

  // Run loop.
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const w = widgetRef.current;
      if (playingRef.current && pathRef.current.total > 0) {
        const speed = liveSpeed.current ?? (w.speed ?? 1);
        posRef.current += (dt / Math.max(0.1, w.duration || 4)) * speed * dirRef.current;
        const end = 1 + (w.loop ? 0 : (Math.max(1, w.dots || 1) - 1) * (w.delay ?? 0));
        if (!w.loop) {
          if (posRef.current >= end) { posRef.current = end; stop(); }
          else if (posRef.current <= 0) { posRef.current = 0; stop(); }
        } else {
          const span = w.pingPong ? 2 : 1;
          posRef.current = ((posRef.current % span) + span) % span;   // wraps both ways
        }
        emit();
        setFrame((f) => (f + 1) % 1e6);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  // PLAY / SPEED / RESET inputs, and the top-bar transport.
  useEffect(() => {
    let lastPlay: boolean | undefined, lastReset = 0;
    return onParamInputs(() => {
      const id = widgetRef.current.id;
      const pv = getParamInput(id, 'play');
      if (pv !== undefined) { const on = pv >= 0.5; if (on !== lastPlay) { lastPlay = on; if (on) start(); else stop(); } }
      const sv = getParamInput(id, 'speed');
      if (sv !== undefined) liveSpeed.current = genSpeedFromInput(sv);
      const rv = getParamInput(id, 'reset') ?? 0;
      if (rv >= 0.5 && lastReset < 0.5) reset();
      lastReset = rv;
    });
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps
  useGlobalTransport({ start, stop, reset });
  useEffect(() => { useStore.getState().setWidgetPlaying(widget.id, playing); }, [playing, widget.id]);
  useEffect(() => useStore.subscribe((s) => {
    const want = s.runtime.widgets[widget.id]?.playing;
    if (want === undefined || want === playingRef.current) return;
    if (want) start(); else stop();
  }), [widget.id]);  // eslint-disable-line react-hooks/exhaustive-deps

  // ── Drawing ────────────────────────────────────────────────────────────────
  const norm = (e: React.PointerEvent): [number, number] => {
    const r = boxRef.current!.getBoundingClientRect();
    return [Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), Math.max(0, Math.min(1, (e.clientY - r.top) / r.height))];
  };
  const strokeAt = (x: number, y: number): string | null => {
    const tol = 8 / Math.min(size.w, size.h);
    let best: string | null = null, bd = tol;
    for (const s of widgetRef.current.strokes ?? []) {
      for (let i = 0; i + 1 < s.pts.length; i += 2) {
        const x0 = s.pts[i], y0 = s.pts[i + 1];
        const x1 = i + 3 < s.pts.length ? s.pts[i + 2] : x0, y1 = i + 3 < s.pts.length ? s.pts[i + 3] : y0;
        const dx = (x1 - x0) * size.w, dy = (y1 - y0) * size.h;
        const l2 = dx * dx + dy * dy;
        const t = l2 > 0 ? Math.max(0, Math.min(1, (((x - x0) * size.w) * dx + ((y - y0) * size.h) * dy) / l2)) : 0;
        const d = Math.hypot((x - x0) * size.w - t * dx, (y - y0) * size.h - t * dy) / Math.min(size.w, size.h);
        if (d < bd) { bd = d; best = s.id; }
      }
    }
    return best;
  };
  const save = (strokes: SketchStroke[]) => {
    const pageId = pageOf(widget.id);
    if (pageId) useStore.getState().updateWidget(pageId, widget.id, { strokes } as never);
  };

  const onDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const [x, y] = norm(e);
    if (e.altKey) {
      const id = strokeAt(x, y);
      if (id) {
        useStore.getState().captureHistory();
        save((widgetRef.current.strokes ?? []).filter((s) => s.id !== id));
      }
      return;
    }
    if (e.shiftKey || e.ctrlKey) {
      const id = strokeAt(x, y);
      const st = (widgetRef.current.strokes ?? []).find((s) => s.id === id);
      if (!st) return;
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      let x0 = 1, y0 = 1, x1 = 0, y1 = 0;
      for (let i = 0; i + 1 < st.pts.length; i += 2) { x0 = Math.min(x0, st.pts[i]); x1 = Math.max(x1, st.pts[i]); y0 = Math.min(y0, st.pts[i + 1]); y1 = Math.max(y1, st.pts[i + 1]); }
      editRef.current = { id: st.id, mode: e.shiftKey ? 'move' : 'scale', start: [x, y], orig: st.pts, c: [(x0 + x1) / 2, (y0 + y1) / 2] };
      setHoverStroke(st.id); setHoverMode('edit');
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    draftRef.current = [x, y];
    setDraft([x, y]);
  };
  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const [x, y] = norm(e);
    const ed = editRef.current;
    if (ed) {
      const c01 = (v: number) => Math.max(0, Math.min(1, v));
      let pts: number[];
      if (ed.mode === 'move') {
        const dx = x - ed.start[0], dy = y - ed.start[1];
        pts = ed.orig.map((v, i) => c01(v + (i % 2 ? dy : dx)));
      } else {
        // Scale by how far the pointer is from the centre now vs. at the start (in pixels).
        const dist = (px: number, py: number) => Math.hypot((px - ed.c[0]) * size.w, (py - ed.c[1]) * size.h);
        const k = Math.max(0.05, dist(x, y) / Math.max(4, dist(ed.start[0], ed.start[1])));
        pts = ed.orig.map((v, i) => c01(ed.c[i % 2] + (v - ed.c[i % 2]) * k));
      }
      ed.pts = pts;
      setEditPts({ id: ed.id, pts });
      return;
    }
    if (!draftRef.current) {
      const mod = e.altKey || e.shiftKey || e.ctrlKey;
      setHoverStroke(mod ? strokeAt(x, y) : null);
      setHoverMode(e.altKey ? 'del' : 'edit');
      return;
    }
    const d = draftRef.current;
    const lx = d[d.length - 2], ly = d[d.length - 1];
    if (Math.hypot((x - lx) * size.w, (y - ly) * size.h) < 3) return;   // a point every 3 px
    const next = [...d, x, y];
    draftRef.current = next;
    setDraft(next);
  };
  const onUp = () => {
    const ed = editRef.current;
    if (ed) {
      editRef.current = null;
      setEditPts(null);
      const pts = ed.pts;
      if (pts) {
        useStore.getState().captureHistory();
        save((widgetRef.current.strokes ?? []).map((s) => (s.id === ed.id ? { ...s, pts: pts.map((v) => Math.round(v * 10000) / 10000) } : s)));
      }
      return;
    }
    const d = draftRef.current;
    draftRef.current = null;
    setDraft(null);
    if (d && d.length >= 2) {
      useStore.getState().captureHistory();   // Ctrl+Z puts the line back
      save([...(widgetRef.current.strokes ?? []), { id: nanoid(), pts: d.map((v) => Math.round(v * 10000) / 10000) }]);
    }
  };

  const color = widget.style.foregroundColor;
  const fs = widget.style.fontSize || 12;
  const dotsPos = positions(posRef.current);
  const poly = (pts: number[]) => {
    const out: string[] = [];
    for (let i = 0; i + 1 < pts.length; i += 2) out.push(`${pts[i] * size.w},${pts[i + 1] * size.h}`);
    return out.join(' ');
  };
  const btn = (on: boolean): React.CSSProperties => ({
    height: Math.max(20, fs * 1.6), minWidth: Math.max(24, fs * 2), padding: '0 6px', borderRadius: 3, cursor: 'pointer', fontFamily: 'inherit',
    background: on ? color : 'rgba(0,0,0,0.45)', color: on ? '#000' : '#aaa', border: `1px solid ${on ? color : '#2a2a2a'}`, fontSize: fs, lineHeight: 1,
  });
  const update = (p: Partial<SketchWidget>) => { const pageId = pageOf(widget.id); if (pageId) useStore.getState().updateWidget(pageId, widget.id, p as never); };

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', fontFamily: 'monospace', boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', rowGap: 4, alignItems: 'center', gap: 4, padding: '4px 6px', flexShrink: 0, borderBottom: '1px solid #1e1e1e' }}
        onPointerDown={(e) => e.stopPropagation()}>
        <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: 2, color: '#505050' }}>◈ SKETCH</span>
        <button style={btn(playing && dir < 0)} onClick={() => start(-1)} title="Play backwards">◀</button>
        <button style={btn(playing && dir > 0)} onClick={() => start(1)} title="Play — the PLAY input does the same">▶</button>
        <button style={btn(!playing)} onClick={stop} title="Stop">■</button>
        <button style={btn(false)} onClick={reset} title="Back to the start (to the end, when it runs backwards)">⟲</button>
        <span style={{ display: 'flex' }}>
          {([['stop', '→|', 'Once: stops at the end', { loop: false, pingPong: false }],
             ['loop', '⟳', 'Loop: starts again from the beginning', { loop: true, pingPong: false }],
             ['ping', '⇄', 'Ping-pong: at the end runs back the other way', { loop: true, pingPong: true }]] as const).map(([k, label, title, patch], i) => {
            const mode = !widget.loop ? 'stop' : widget.pingPong ? 'ping' : 'loop';
            return (
              <button key={k} title={title} onClick={() => update(patch)}
                style={{ ...btn(mode === k), borderRadius: i === 0 ? '3px 0 0 3px' : i === 2 ? '0 3px 3px 0' : 0, marginLeft: i ? -1 : 0 }}>{label}</button>
            );
          })}
        </span>
        <span style={{ width: 6 }} />
        {/* Smooth — dots — delay: two equal sliders around the dot count. */}
        <span style={{ display: 'flex', alignItems: 'center', gap: 4, flex: '1 1 320px', minWidth: 300 }}>
        <span title="Smooth the drawing" style={{ fontSize: Math.max(10, fs - 1), color: '#888' }}>∿</span>
        <input type="range" min={0} max={1} step={0.01} value={widget.smooth ?? 0} title={`Smooth ${Math.round((widget.smooth ?? 0) * 100)}%`}
          onChange={(e) => update({ smooth: Number(e.target.value) })}
          style={{ flex: 1, minWidth: 80, accentColor: color, height: Math.max(18, fs * 1.4) }} />
        <button style={btn(false)} onClick={() => update({ dots: Math.max(1, n - 1) })} title="One dot less">−</button>
        <span style={{ fontSize: fs, color: '#aaa', minWidth: '3ch', textAlign: 'center' }} title="Dots">{n}●</span>
        <button style={btn(false)} onClick={() => update({ dots: Math.min(32, n + 1) })} title="One dot more">＋</button>
        <input type="range" min={0} max={0.5} step={0.005} value={widget.delay ?? 0} title={`Delay between dots: ${(widget.delay ?? 0).toFixed(3)} of the drawing`}
          onChange={(e) => update({ delay: Number(e.target.value) })}
          style={{ flex: 1, minWidth: 80, accentColor: color, height: Math.max(18, fs * 1.4) }} />
        <span title="Delay between dots" style={{ fontSize: Math.max(10, fs - 1), color: '#888' }}>⋯</span>
        </span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
        <button style={btn(widget.showGrid)} onClick={() => update({ showGrid: !widget.showGrid })} title="Background grid">▦</button>
        <button style={btn(false)} onClick={() => { const pageId = pageOf(widget.id); if (pageId) { useStore.getState().captureHistory(); save([]); } }} title="Clear the drawing">✕</button>
        </span>
      </div>
      <div ref={boxRef}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
        onPointerLeave={() => setHoverStroke(null)}
        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setMenu({ x: e.clientX, y: e.clientY, cell: -1 }); }}
        style={{ flex: 1, minHeight: 0, position: 'relative', overflow: 'hidden', touchAction: 'none', cursor: 'crosshair' }}>
        {widget.showGrid && (
          <div style={{
            position: 'absolute', inset: 0, pointerEvents: 'none',
            backgroundImage: `linear-gradient(${color}14 1px, transparent 1px), linear-gradient(90deg, ${color}14 1px, transparent 1px),
              linear-gradient(${color}26 1px, transparent 1px), linear-gradient(90deg, ${color}26 1px, transparent 1px)`,
            backgroundSize: '5% 5%, 5% 5%, 25% 25%, 25% 25%',
          }} />
        )}
        <svg width={size.w} height={size.h} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
          {(widget.strokes ?? []).map((s, i) => (
            <g key={s.id}>
              {(widget.smooth ?? 0) > 0 && (
                <polyline points={poly(s.pts)} fill="none" stroke={color} strokeOpacity={0.18} strokeWidth={1} strokeLinejoin="round" />
              )}
              <polyline points={poly(editPts?.id === s.id ? editPts.pts : (smoothed[i]?.pts ?? s.pts))} fill="none"
                stroke={hoverStroke === s.id ? (hoverMode === 'edit' ? pal('#e07f2b') : '#e0322b') : color} strokeOpacity={hoverStroke === s.id ? 1 : 0.6}
                strokeWidth={hoverStroke === s.id ? 3 : 2} strokeLinecap="round" strokeLinejoin="round" />
              {s.pts.length >= 2 && (
                <text x={s.pts[0] * size.w + 4} y={s.pts[1] * size.h - 4} fill="#777" fontSize={10} fontFamily="monospace">{i + 1}</text>
              )}
            </g>
          ))}
          {draft && <polyline points={poly(draft)} fill="none" stroke="#fff" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />}
          {dotsPos.map((p, k) => p && (
            <circle key={k} cx={p[0] * size.w} cy={p[1] * size.h} r={k === 0 ? 7 : 5}
              fill={DOT_COLORS[k % DOT_COLORS.length]} style={{ filter: `drop-shadow(0 0 6px ${DOT_COLORS[k % DOT_COLORS.length]})` }} />
          ))}
        </svg>
        {(widget.strokes ?? []).length === 0 && !draft && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#333', fontSize: 11, pointerEvents: 'none', textAlign: 'center', padding: 10 }}>
            draw here — lines play one after the other · Alt+click a line to delete it · right-click: link X / Y
          </div>
        )}
        {/* Cells for Shift patching / Learn: X and Y of each dot. */}
        {Array.from({ length: n }, (_, k) => (
          <React.Fragment key={k}>
            <div className="lf-learn-zone" data-lf-widget={widget.id} data-lf-cell={2 * k}
              style={{ position: 'absolute', left: `${(k / n) * 100}%`, width: `${100 / n}%`, bottom: 0, height: 26 }}>{n > 1 ? `${k + 1}X` : 'X'}</div>
            <div className="lf-learn-zone" data-lf-widget={widget.id} data-lf-cell={2 * k + 1}
              style={{ position: 'absolute', left: 0, top: `${(k / n) * 100}%`, height: `${100 / n}%`, width: 26 }}>{n > 1 ? `${k + 1}Y` : 'Y'}</div>
          </React.Fragment>
        ))}
      </div>
      {menu && menu.cell === -1 && (
        <div onPointerDown={(e) => e.stopPropagation()} style={{
          position: 'fixed', left: menu.x, top: menu.y, zIndex: 9999, background: '#1a1a1a', border: '1px solid #333', borderRadius: 4,
          padding: '4px 0', minWidth: 140, maxHeight: '60vh', overflowY: 'auto', boxShadow: '0 4px 16px rgba(0,0,0,0.6)', fontFamily: 'monospace',
        }}>
          <div style={{ padding: '4px 12px', color: '#777', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1 }}>link</div>
          {Array.from({ length: n }, (_, k) => [0, 1].map((a) => (
            <button key={`${k}${a}`} onClick={() => setMenu({ ...menu, cell: 2 * k + a })}
              style={{ display: 'block', width: '100%', padding: '5px 12px', background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: '#ccc', textAlign: 'left', fontFamily: 'inherit' }}>
              {n > 1 ? `dot ${k + 1} ` : ''}{a === 0 ? 'X' : 'Y'} ▸
            </button>
          )))}
          {(['PLAY', 'SPEED', 'RESET'] as const).map((l, i) => (
            <button key={l} onClick={() => setMenu({ ...menu, cell: -(i + 1) - 100 })}
              style={{ display: 'block', width: '100%', padding: '5px 12px', background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: pal('#88b8bb'), textAlign: 'left', fontFamily: 'inherit' }}>
              {l} input ▸
            </button>
          ))}
        </div>
      )}
      {menu && menu.cell !== -1 && (
        <CellLinkMenu x={menu.x} y={menu.y} widgetId={widget.id} cellIndex={menu.cell <= -100 ? menu.cell + 100 : menu.cell} onClose={() => setMenu(null)} />
      )}
    </div>
  );
}

