import React, { useEffect, useReducer, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { PaletteWidget } from '../../../shared/types/project';
import { useStore } from '../../store';
import { touchCells } from '../Merge/touch';
import { hexToRgb, rgbToHex, rgbToHsv, hsvToRgb, rgbToCmy, cmyToRgb, type RGB } from './color';

// Colour swatches. Tap = pick (it lights, and its R G B cells are "touched" so
// an LTP Merge switches to it). Hold or right-click = edit the colour. ＋ adds
// one. Colour k puts out cells 3k (R), 3k+1 (G), 3k+2 (B).

const HOLD_MS = 550;

// Which swatch is picked, per widget (kept while switching pages).
const picked = new Map<string, number>();
const pickListeners = new Set<() => void>();
function usePicked(id: string): number {
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => { pickListeners.add(force); return () => { pickListeners.delete(force); }; }, []);
  return picked.get(id) ?? -1;
}

function pageOf(widgetId: string): string | undefined {
  return useStore.getState().project.pages.find((p) => p.widgets.some((w) => w.id === widgetId))?.id;
}
export function setPaletteColors(w: PaletteWidget, colors: string[]): void {
  const pid = pageOf(w.id);
  if (pid) useStore.getState().updateWidget(pid, w.id, { colors } as never);
  // Cells follow at once (Live rebuilds them from the colours too).
  colors.forEach((c, k) => hexToRgb(c).forEach((v, j) => useStore.getState().setCellValue(w.id, 3 * k + j, v)));
}

export default function PaletteLive({ widget, preview = false }: { widget: PaletteWidget; preview?: boolean }): React.JSX.Element {
  const sel = usePicked(widget.id);
  const [editing, setEditing] = useState<number | null>(null);
  const cols = Math.max(1, widget.cols || 4);
  const n = widget.colors.length;

  const pick = (k: number) => {
    picked.set(widget.id, k);
    pickListeners.forEach((f) => f());
    touchCells(widget.id, [3 * k, 3 * k + 1, 3 * k + 2]);
  };

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', gap: 6, padding: 6, boxSizing: 'border-box', pointerEvents: preview ? 'none' : undefined }}>
      <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gridAutoRows: '1fr', gap: 6 }}>
        {widget.colors.map((c, k) => (
          <Swatch key={k} w={widget} k={k} color={c} selected={sel === k} onPick={() => pick(k)}
            onEdit={() => { useStore.getState().captureHistory(); setEditing(k); }} />
        ))}
        {void n}
      </div>
      {editing !== null && widget.colors[editing] !== undefined && (
        <ColorEditor color={widget.colors[editing]} model={widget.model ?? 'rgb'}
          onModel={(model) => { const pid = pageOf(widget.id); if (pid) useStore.getState().updateWidget(pid, widget.id, { model } as never); }}
          onChange={(hex) => setPaletteColors(widget, widget.colors.map((x, j) => (j === editing ? hex : x)))}
          onRemove={widget.colors.length > 1 ? () => {
            useStore.getState().captureHistory();
            // Its three cells go, and links on later colours move down.
            for (let j = 2; j >= 0; j--) useStore.getState().dropCellAndShiftLinks(widget.id, 3 * editing + j);
            setPaletteColors(widget, widget.colors.filter((_, j) => j !== editing));
            setEditing(null);
          } : undefined}
          onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

function Swatch({ w, k, color, selected, onPick, onEdit }: { w: PaletteWidget; k: number; color: string; selected: boolean; onPick: () => void; onEdit: () => void }): React.JSX.Element {
  const hold = useRef<ReturnType<typeof setTimeout> | null>(null);
  const held = useRef(false);
  useEffect(() => () => { if (hold.current) clearTimeout(hold.current); }, []);
  const [r, g, b] = hexToRgb(color);
  const light = 0.3 * r + 0.59 * g + 0.11 * b > 0.6;
  return (
    <div
      title="Tap: pick · hold or right-click: edit the colour"
      onContextMenu={(e) => { e.preventDefault(); onEdit(); }}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        held.current = false;
        hold.current = setTimeout(() => { held.current = true; onEdit(); }, HOLD_MS);
      }}
      onPointerUp={() => { if (hold.current) { clearTimeout(hold.current); hold.current = null; } if (!held.current) onPick(); }}
      onPointerLeave={() => { if (hold.current) { clearTimeout(hold.current); hold.current = null; } }}
      style={{
        position: 'relative', borderRadius: 5, background: color, cursor: 'pointer', touchAction: 'none', minHeight: 0,
        border: selected ? `3px solid ${light ? '#000' : '#fff'}` : '1px solid rgba(255,255,255,0.15)',
        boxShadow: selected ? `0 0 14px ${color}` : 'none', boxSizing: 'border-box',
      }}>
      <span style={{ position: 'absolute', left: 5, top: 3, fontSize: 10, fontWeight: 700, color: light ? '#000' : '#fff', opacity: 0.6 }}>{k + 1}</span>
      {/* Where Shift-patching puts this colour's three outputs: R G B side by side. */}
      {[0, 1, 2].map((j) => (
        <span key={j} data-lf-widget={w.id} data-lf-cell={3 * k + j}
          style={{ position: 'absolute', bottom: 0, height: 30, left: `${j * 33.3}%`, width: '33.3%', pointerEvents: 'none' }} />
      ))}
    </div>
  );
}

// ── Colour editor: hue / saturation wheel, brightness, and three sliders ──────
const SL: Record<'rgb' | 'cmy' | 'hsv', { names: string[]; to: (c: RGB) => RGB; from: (v: RGB) => RGB; tracks: (c: RGB) => string[] }> = {
  rgb: { names: ['R', 'G', 'B'], to: (c) => c, from: (v) => v,
    tracks: ([r, g, b]) => [`linear-gradient(90deg, ${rgbToHex([0, g, b])}, ${rgbToHex([1, g, b])})`, `linear-gradient(90deg, ${rgbToHex([r, 0, b])}, ${rgbToHex([r, 1, b])})`, `linear-gradient(90deg, ${rgbToHex([r, g, 0])}, ${rgbToHex([r, g, 1])})`] },
  cmy: { names: ['C', 'M', 'Y'], to: rgbToCmy, from: cmyToRgb,
    tracks: ([r, g, b]) => [`linear-gradient(90deg, ${rgbToHex([1, g, b])}, ${rgbToHex([0, g, b])})`, `linear-gradient(90deg, ${rgbToHex([r, 1, b])}, ${rgbToHex([r, 0, b])})`, `linear-gradient(90deg, ${rgbToHex([r, g, 1])}, ${rgbToHex([r, g, 0])})`] },
  hsv: { names: ['H', 'S', 'V'], to: rgbToHsv, from: hsvToRgb,
    tracks: (c) => { const [h, s, v] = rgbToHsv(c); return [
      'linear-gradient(90deg, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)',
      `linear-gradient(90deg, ${rgbToHex(hsvToRgb([h, 0, v]))}, ${rgbToHex(hsvToRgb([h, 1, v]))})`,
      `linear-gradient(90deg, #000, ${rgbToHex(hsvToRgb([h, s, 1]))})`]; } },
};

export function ColorEditor({ color, model, onModel, onChange, onRemove, onClose }: {
  color: string; model: 'rgb' | 'cmy' | 'hsv'; onModel: (m: 'rgb' | 'cmy' | 'hsv') => void;
  onChange: (hex: string) => void; onRemove?: () => void; onClose: () => void;
}): React.JSX.Element {
  // Kept in HSV so hue survives going through black / grey.
  const [hsv, setHsv] = useState<RGB>(() => rgbToHsv(hexToRgb(color)));
  const [hexText, setHexText] = useState(color);
  const rgb = hsvToRgb(hsv);
  const set = (next: RGB) => { setHsv(next); const hex = rgbToHex(hsvToRgb(next)); setHexText(hex); onChange(hex); };
  const setRgb = (c: RGB) => { const h = rgbToHsv(c); if (h[1] === 0 || h[2] === 0) h[0] = hsv[0]; set(h); };
  const S = 220, R = S / 2;
  const wheel = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = wheel.current; if (!cv) return;
    const ctx = cv.getContext('2d'); if (!ctx) return;
    const img = ctx.createImageData(S, S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const dx = x - R, dy = y - R, d = Math.hypot(dx, dy);
      const i = (y * S + x) * 4;
      if (d > R) { img.data[i + 3] = 0; continue; }
      const h = (Math.atan2(dy, dx) / (2 * Math.PI) + 1) % 1;
      const [r, g, b] = hsvToRgb([h, d / R, hsv[2]]);
      img.data[i] = r * 255; img.data[i + 1] = g * 255; img.data[i + 2] = b * 255; img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }, [hsv[2]]);
  const fromWheel = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const dx = e.clientX - r.left - R, dy = e.clientY - r.top - R;
    set([(Math.atan2(dy, dx) / (2 * Math.PI) + 1) % 1, Math.min(1, Math.hypot(dx, dy) / R), hsv[2] || 1]);
  };
  const sl = SL[model];
  const vals = model === 'hsv' ? hsv : sl.to(rgb);
  const tracks = sl.tracks(rgb);
  const setSlider = (i: number, v: number) => {
    if (model === 'hsv') { const n = [...hsv] as RGB; n[i] = v; set(n); return; }
    const n = [...vals] as RGB; n[i] = v; setRgb(sl.from(n));
  };
  const mx = R + Math.cos(hsv[0] * 2 * Math.PI) * hsv[1] * R, my = R + Math.sin(hsv[0] * 2 * Math.PI) * hsv[1] * R;
  const btn: React.CSSProperties = { background: '#1a1a1a', border: '1px solid #333', color: '#ccc', borderRadius: 3, padding: '6px 12px', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13 };

  return createPortal(
    <div onPointerDown={onClose} style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div onPointerDown={(e) => e.stopPropagation()} onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
        style={{ background: '#141414', border: '1px solid #333', borderRadius: 8, padding: 18, width: 300, display: 'flex', flexDirection: 'column', gap: 12, color: '#ddd', fontFamily: 'inherit' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 36, height: 36, borderRadius: 5, background: rgbToHex(rgb), border: '1px solid #444' }} />
          <input value={hexText} onChange={(e) => { setHexText(e.target.value); if (/^#[0-9a-f]{6}$/i.test(e.target.value.trim())) setRgb(hexToRgb(e.target.value.trim())); }}
            style={{ flex: 1, background: '#0e0e0e', border: '1px solid #2a2a2a', color: '#ddd', borderRadius: 3, padding: '7px 9px', fontSize: 14, fontFamily: 'inherit' }} />
        </div>
        <div style={{ position: 'relative', width: S, height: S, alignSelf: 'center' }}>
          <canvas ref={wheel} width={S} height={S} style={{ borderRadius: '50%', touchAction: 'none', cursor: 'crosshair', display: 'block' }}
            onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); fromWheel(e); }}
            onPointerMove={(e) => { if (e.currentTarget.hasPointerCapture(e.pointerId)) fromWheel(e); }} />
          <div style={{ position: 'absolute', left: mx - 8, top: my - 8, width: 16, height: 16, borderRadius: '50%', border: '2px solid #fff', boxShadow: '0 0 0 1px #000', pointerEvents: 'none' }} />
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {(['rgb', 'cmy', 'hsv'] as const).map((m) => (
            <button key={m} onClick={() => onModel(m)} style={{ ...btn, flex: 1, padding: '4px 0', background: model === m ? 'var(--lf-aqua)' : '#1a1a1a', color: model === m ? '#000' : '#aaa', fontWeight: model === m ? 700 : 400 }}>{m.toUpperCase()}</button>
          ))}
        </div>
        {sl.names.map((name, i) => (
          <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 14, fontSize: 12, color: '#999' }}>{name}</span>
            <Fat value={vals[i]} track={tracks[i]} onChange={(v) => setSlider(i, v)} />
            <span style={{ width: 36, textAlign: 'right', fontSize: 12, color: '#bbb', fontVariantNumeric: 'tabular-nums' }}>
              {model === 'hsv' && i === 0 ? `${Math.round(vals[i] * 360)}°` : Math.round(vals[i] * 255)}
            </span>
          </div>
        ))}
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          {onRemove ? <button onClick={onRemove} style={{ ...btn, color: '#c66' }}>Remove</button> : <span />}
          <button onClick={onClose} style={{ ...btn, background: 'var(--lf-aqua)', color: '#000', fontWeight: 700, border: 'none' }}>Done</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// A thick slider with a gradient track (finger-sized).
function Fat({ value, track, onChange }: { value: number; track: string; onChange: (v: number) => void }): React.JSX.Element {
  const set = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    onChange(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)));
  };
  return (
    <div onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); set(e); }}
      onPointerMove={(e) => { if (e.currentTarget.hasPointerCapture(e.pointerId)) set(e); }}
      style={{ position: 'relative', flex: 1, height: 22, borderRadius: 4, background: track, cursor: 'pointer', touchAction: 'none', border: '1px solid #333' }}>
      <div style={{ position: 'absolute', top: -3, bottom: -3, width: 8, marginLeft: -4, left: `${value * 100}%`, background: '#fff', borderRadius: 3, boxShadow: '0 0 0 1px #000', pointerEvents: 'none' }} />
    </div>
  );
}

/** Set how many colours a palette has: new ones white, extra ones dropped
 *  (with their R G B cells and any links on them). */
export function setPaletteCount(w: PaletteWidget, count: number): void {
  const n = Math.max(1, Math.min(64, Math.round(count)));
  const cur = w.colors.length;
  if (n === cur) return;
  const st = useStore.getState();
  st.captureHistory();
  if (n < cur) for (let k = cur - 1; k >= n; k--) for (let j = 2; j >= 0; j--) st.dropCellAndShiftLinks(w.id, 3 * k + j);
  const colors = n > cur
    ? [...w.colors, ...Array.from({ length: n - cur }, () => '#ffffff')]
    : w.colors.slice(0, n);
  setPaletteColors(w, colors);
}
