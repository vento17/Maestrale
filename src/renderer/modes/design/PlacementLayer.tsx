import { pal, palRgb } from '../../palette';
import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '../../store';
import { makeDefaultWidget } from '../../widgets/defaults';
import { GRID_SNAP_PX } from '../../../shared/constants';

/**
 * Placing a widget picked from the menu: a dashed outline of its real size
 * follows the mouse over the page; a click drops it there. Esc or right-click
 * cancels. Positions snap to the canvas grid like a drag does.
 */
export default function PlacementLayer({ pageRef, scale }: {
  pageRef: React.RefObject<HTMLDivElement>;
  scale: number;
}): React.JSX.Element | null {
  const kind = useStore((s) => s.placingKind);
  const page = useStore((s) => s.project.pages.find((p) => p.id === s.activePageId));
  const [pt, setPt] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!kind) { setPt(null); return; }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); useStore.getState().setPlacingKind(null); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [kind]);

  if (!kind || !page) return null;
  const size = makeDefaultWidget('placing', kind, 0).rect;

  // Page coordinates of the widget's top-left, centred on the cursor, snapped,
  // and kept inside the page.
  const toPage = (cx: number, cy: number) => {
    const r = pageRef.current?.getBoundingClientRect();
    if (!r) return null;
    const snap = (v: number) => Math.round(v / GRID_SNAP_PX) * GRID_SNAP_PX;
    const x = snap((cx - r.left) / scale - size.width / 2);
    const y = snap((cy - r.top) / scale - size.height / 2);
    return {
      x: Math.max(0, Math.min(page.width - size.width, x)),
      y: Math.max(0, Math.min(page.height - size.height, y)),
      left: r.left, top: r.top,
    };
  };

  const p = pt ? toPage(pt.x, pt.y) : null;

  const place = (e: React.PointerEvent) => {
    if (e.button === 2) { useStore.getState().setPlacingKind(null); return; }
    const at = toPage(e.clientX, e.clientY);
    if (!at) return;
    const st = useStore.getState();
    st.setPlacingKind(null);
    const id = st.addWidget(page.id, kind);
    useStore.getState().updateWidgetRect(page.id, id, { x: at.x, y: at.y });
  };

  return createPortal(
    <div
      onPointerMove={(e) => setPt({ x: e.clientX, y: e.clientY })}
      onPointerDown={place}
      onContextMenu={(e) => e.preventDefault()}
      style={{ position: 'fixed', inset: 0, zIndex: 900, cursor: 'copy' }}
    >
      {p && (
        <div style={{
          position: 'fixed',
          left: p.left + p.x * scale, top: p.top + p.y * scale,
          width: size.width * scale, height: size.height * scale,
          border: `2px dashed ${pal('#ff881f')}`, borderRadius: 4, background: `rgba(${palRgb('#ff881f')},0.06)`,
          pointerEvents: 'none', boxSizing: 'border-box',
        }} />
      )}
      <div style={{
        position: 'fixed', top: 90, left: '50%', transform: 'translateX(-50%)',
        background: 'rgba(0,0,0,0.82)', border: '1px solid #333', borderRadius: 12, padding: '4px 14px',
        fontFamily: 'monospace', fontSize: 12, color: '#ddd', pointerEvents: 'none',
      }}>
        click to place · Esc or right-click to cancel
      </div>
    </div>,
    document.body,
  );
}
