import { pal } from '../../palette';
import { MULTI } from '../../theme';
import React, { useRef, useCallback, useState, useEffect } from 'react';
import type { XYPadWidget } from '../../../shared/types/project';
import { xyMapping } from '../../../shared/types/project';
import { nanoid } from 'nanoid';

// Dots after the first get their own colour, so several pan/tilt pairs read apart.
export const XY_DOT_COLORS = MULTI.slice(1);

// ＋ on the pad: a new dot with the next free CC / channel pair after the last one.
export function addXYDot(widget: XYPadWidget): void {
  const st = useStore.getState();
  const pageId = st.project.pages.find((p) => p.widgets.some((w) => w.id === widget.id))?.id;
  if (!pageId) return;
  const pts = widget.points ?? [];
  const n = 1 + pts.length;
  const step = (m: XYPadWidget['mappingX'], by: number): XYPadWidget['mappingX'] => {
    if (!m) return m;
    if (m.type === 'midi') return { ...m, number: (m.number + by) % 128 };
    if (m.type === 'artnet' || m.type === 'sacn' || m.type === 'enttec') return { ...m, channel: ((m.channel - 1 + by) % 512) + 1 };
    if (m.type === 'osc') return { ...m, address: `${m.address.replace(/\/\d+$/, '')}/${n + 1}` };
    return m;
  };
  st.updateWidget(pageId, widget.id, { points: [...pts, {
    id: nanoid(), mappingX: step(widget.mappingX, 2 * n), mappingY: step(widget.mappingY, 2 * n),
  }] } as never);
  // Start it near the middle, a little apart from the others, so it shows.
  const off = ((n % 6) - 2.5) * 0.08;
  queueMicrotask(() => {
    useStore.getState().setCellValue(widget.id, 2 * n, Math.max(0, Math.min(1, 0.5 + off)));
    useStore.getState().setCellValue(widget.id, 2 * n + 1, 0.5);
  });
}
import { useStore, useWidgetRuntime } from '../../store';
import { dispatchValue } from '../../ipc/dispatch';
import { clamp } from '../utils';
import CellLinkMenu from '../base/CellLinkMenu';
import { useSlavedCells, SLAVE_OUTLINE } from '../base/useSlavedCells';

export default function XYPadLive({ widget }: { widget: XYPadWidget }): React.JSX.Element {
  const { style, showCrosshair, invertX, invertY } = widget;
  const runtime = useWidgetRuntime(widget.id);
  const setCellValue = useStore((s) => s.setCellValue);
  const padRef = useRef<HTMLDivElement>(null);
  // Each finger / the mouse drags the dot it grabbed (the nearest one).
  const grabbed = useRef(new Map<number, number>());   // pointerId → dot

  const slaved = useSlavedCells(widget.id);       // even = X, odd = Y of each dot
  const isSlaved = slaved.size > 0;
  const dots = 1 + (widget.points?.length ?? 0);
  const dotColor = (k: number): string => (k === 0 ? (runtime?.cells[0]?.feedbackColor ?? style.foregroundColor) : (widget.points?.[k - 1]?.color || XY_DOT_COLORS[(k - 1) % XY_DOT_COLORS.length]));

  // Right-click: pick which axis to link, then show the link menu for that cell.
  const [menu, setMenu] = useState<{ x: number; y: number; axis: number | null } | null>(null);
  useEffect(() => {
    if (!menu) return;
    const handler = () => setMenu(null);
    document.addEventListener('pointerdown', handler);
    return () => document.removeEventListener('pointerdown', handler);
  }, [menu]);


  const toValue = (clientX: number, clientY: number): [number, number] => {
    const rect = padRef.current!.getBoundingClientRect();
    let nx = clamp((clientX - rect.left) / rect.width, 0, 1);
    let ny = clamp((clientY - rect.top) / rect.height, 0, 1);
    if (invertX) nx = 1 - nx;
    if (!invertY) ny = 1 - ny;
    return [nx, ny];
  };
  // Screen position (0–1, top-left origin) of a dot's current value.
  const posOf = (k: number): [number, number] => {
    const x = runtime?.cells[2 * k]?.value ?? 0.5, y = runtime?.cells[2 * k + 1]?.value ?? 0.5;
    return [invertX ? 1 - x : x, invertY ? y : 1 - y];
  };
  const nearestDot = (clientX: number, clientY: number): number => {
    const rect = padRef.current!.getBoundingClientRect();
    const px = (clientX - rect.left) / rect.width, py = (clientY - rect.top) / rect.height;
    let best = 0, bd = Infinity;
    for (let k = 0; k < dots; k++) {
      const [x, y] = posOf(k);
      const d = ((x - px) * rect.width) ** 2 + ((y - py) * rect.height) ** 2;
      if (d < bd) { bd = d; best = k; }
    }
    return best;
  };

  const updateFromPoint = useCallback((dot: number, clientX: number, clientY: number) => {
    if (!padRef.current) return;
    const [nx, ny] = toValue(clientX, clientY);
    // A router link is a second way in, not a lock: both axes stay draggable.
    setCellValue(widget.id, 2 * dot, nx); dispatchValue(xyMapping(widget, 2 * dot), nx);
    setCellValue(widget.id, 2 * dot + 1, ny); dispatchValue(xyMapping(widget, 2 * dot + 1), ny);
  }, [widget, invertX, invertY, setCellValue]);  // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div
      ref={padRef}
      style={{
        width: '100%', height: '100%',
        position: 'relative',
        touchAction: 'none',
        cursor: 'crosshair',
        overflow: 'hidden',
        outline: isSlaved ? SLAVE_OUTLINE : undefined,
        outlineOffset: isSlaved ? -1 : undefined,
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setMenu({ x: e.clientX, y: e.clientY, axis: null });
      }}
      onPointerDown={(e) => {
        setMenu(null);
        if (e.button !== 0) return;   // right-click → context menu only
        const taken = new Set(grabbed.current.values());
        const dot = nearestDot(e.clientX, e.clientY);
        if (taken.has(dot)) return;   // another finger has it
        grabbed.current.set(e.pointerId, dot);
        e.currentTarget.setPointerCapture(e.pointerId);
        updateFromPoint(dot, e.clientX, e.clientY);
      }}
      onPointerMove={(e) => {
        const dot = grabbed.current.get(e.pointerId);
        if (dot === undefined) return;
        updateFromPoint(dot, e.clientX, e.clientY);
      }}
      onPointerUp={(e) => { grabbed.current.delete(e.pointerId); }}
      onPointerCancel={(e) => { grabbed.current.delete(e.pointerId); }}
    >
      {/* Grid */}
      <div style={{
        position: 'absolute', inset: 0,
        backgroundImage: `linear-gradient(${style.foregroundColor}18 1px, transparent 1px), linear-gradient(90deg, ${style.foregroundColor}18 1px, transparent 1px)`,
        backgroundSize: '20% 20%',
        pointerEvents: 'none',
      }} />

      {/* Crosshair lines (first dot only — with many they would just be noise) */}
      {showCrosshair && dots === 1 && (
        <>
          <div style={{ position: 'absolute', left: 0, right: 0, top: `${posOf(0)[1] * 100}%`, height: 1, background: `${dotColor(0)}44`, pointerEvents: 'none' }} />
          <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${posOf(0)[0] * 100}%`, width: 1, background: `${dotColor(0)}44`, pointerEvents: 'none' }} />
        </>
      )}

      {/* Dots */}
      {Array.from({ length: dots }, (_, k) => {
        const [x, y] = posOf(k);
        const c = dotColor(k);
        return (
          <div key={k} style={{
            position: 'absolute', left: `${x * 100}%`, top: `${y * 100}%`, transform: 'translate(-50%, -50%)',
            width: 20, height: 20, borderRadius: '50%', background: c, boxShadow: `0 0 12px ${c}`,
            pointerEvents: 'none', zIndex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 10, fontWeight: 700, color: '#000', fontFamily: 'monospace',
          }}>{dots > 1 ? (k === 0 ? '1' : (widget.points?.[k - 1]?.label || String(k + 1))).slice(0, 2) : ''}</div>
        );
      })}

      {/* ＋ adds a dot */}
      <button title="Add a dot (its own X / Y cells and outputs)"
        onPointerDown={(e) => { e.stopPropagation(); }}
        onClick={(e) => { e.stopPropagation(); addXYDot(widget); }}
        style={{
          position: 'absolute', top: 4, right: 4, zIndex: 2, width: 22, height: 22, padding: 0, borderRadius: 3,
          background: 'rgba(0,0,0,0.5)', color: '#aaa', border: '1px solid rgba(255,255,255,0.15)', cursor: 'pointer', fontSize: 13,
        }}>＋</button>

      {style.showLabel && (
        <div style={{
          position: 'absolute', bottom: 6, left: 0, right: 0,
          textAlign: 'center', fontSize: style.fontSize,
          color: style.labelColor, opacity: 0.6, pointerEvents: 'none',
        }}>
          {widget.label}
        </div>
      )}

      {/* Learn mode only (shown by CSS): the pad is one element but two cells,
          so a tap needs somewhere to say which axis it means. */}
      {Array.from({ length: dots }, (_, k) => (
        <React.Fragment key={k}>
          <div className="lf-learn-zone" data-lf-widget={widget.id} data-lf-cell={2 * k}
            style={{ position: 'absolute', left: `${(k / dots) * 100}%`, width: `${100 / dots}%`, bottom: 0, height: 34 }}>{dots > 1 ? `${k + 1}X` : 'X'}</div>
          <div className="lf-learn-zone" data-lf-widget={widget.id} data-lf-cell={2 * k + 1}
            style={{ position: 'absolute', left: 0, top: `${(k / dots) * 100}%`, height: `calc(${100 / dots}% - ${34 / dots}px)`, width: 34 }}>{dots > 1 ? `${k + 1}Y` : 'Y'}</div>
        </React.Fragment>
      ))}

      {/* Right-click: axis picker → link menu */}
      {menu && menu.axis === null && (
        <div
          style={{
            position: 'fixed', left: menu.x, top: menu.y, zIndex: 9999,
            background: '#1a1a1a', border: '1px solid #333', borderRadius: 4,
            padding: '4px 0', minWidth: 120, boxShadow: '0 4px 16px rgba(0,0,0,0.6)',
            fontFamily: 'monospace',
          }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <div style={{ padding: '4px 12px', color: '#777', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1 }}>
            link axis
          </div>
          {Array.from({ length: dots }, (_, k) => [[`${dots > 1 ? `dot ${k + 1} ` : ''}X axis`, 2 * k], [`${dots > 1 ? `dot ${k + 1} ` : ''}Y axis`, 2 * k + 1]] as [string, number][]).flat().map(([label, axis]) => (
            <button
              key={axis}
              style={{
                display: 'block', width: '100%', padding: '5px 12px', background: 'none',
                border: 'none', cursor: 'pointer', fontSize: 11,
                color: slaved.has(axis) ? pal('#ffad66') : '#ccc', textAlign: 'left', fontFamily: 'inherit',
              }}
              onClick={() => setMenu({ ...menu, axis })}
            >
              {label}{slaved.has(axis) ? ' · slaved' : ''}
            </button>
          ))}
        </div>
      )}
      {menu && menu.axis !== null && (
        <CellLinkMenu
          x={menu.x}
          y={menu.y}
          widgetId={widget.id}
          cellIndex={menu.axis}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}
