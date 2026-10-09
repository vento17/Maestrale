import { pal } from '../../palette';
import React, { useState, useEffect } from 'react';
import type { MasterLevelWidget } from '../../../shared/types/project';
import { useStore, useWidgetRuntime } from '../../store';
import { clamp } from '../utils';
import CellLinkMenu from '../base/CellLinkMenu';
import { useSlavedCells, SLAVE_OUTLINE } from '../base/useSlavedCells';

export const PROTOCOL_LABEL: Record<string, string> = {
  midi: 'MIDI', osc: 'OSC', artnet: 'ART-NET', sacn: 'sACN', enttec: 'ENTTEC',
};

export default function MasterLevelLive({ widget }: { widget: MasterLevelWidget }): React.JSX.Element {
  const { style, protocol } = widget;
  const runtime = useWidgetRuntime(widget.id);
  const setCellValue = useStore((s) => s.setCellValue);
  const value = runtime?.cells[0]?.value ?? 1;
  const color = runtime?.cells[0]?.feedbackColor ?? style.foregroundColor;
  const isVertical = (widget.orientation ?? 'vertical') === 'vertical';

  // The gain is published globally by MasterEngine (cross-page); this component
  // just drives the runtime value.

  const isSlave = useSlavedCells(widget.id).has(0);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    if (!contextMenu) return;
    const handler = () => setContextMenu(null);
    document.addEventListener('pointerdown', handler);
    return () => document.removeEventListener('pointerdown', handler);
  }, [contextMenu]);

  function setFromPointer(e: React.PointerEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const v = isVertical
      ? clamp(1 - (e.clientY - rect.top) / rect.height, 0, 1)
      : clamp((e.clientX - rect.left) / rect.width, 0, 1);
    setCellValue(widget.id, 0, v);
  }

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', padding: 8, boxSizing: 'border-box', gap: 6 }}>
      <div style={{
        flexShrink: 0, textAlign: 'center', fontWeight: 700, letterSpacing: 2,
        fontSize: Math.max(9, (style.fontSize || 16) - 6), color: '#8a8a8a', textTransform: 'uppercase',
      }}>
        {PROTOCOL_LABEL[protocol] ?? protocol} master
      </div>

      <div
        style={{
          flex: 1, position: 'relative', minHeight: 0,
          background: 'rgba(0,0,0,0.4)', borderRadius: 4, overflow: 'hidden',
          touchAction: 'none',
          cursor: 'pointer',
          outline: isSlave ? SLAVE_OUTLINE : undefined,
          outlineOffset: isSlave ? -1 : undefined,
        }}
        onPointerDown={(e) => {
          // A router link is a second way in, not a lock.
          e.currentTarget.setPointerCapture(e.pointerId);
          setFromPointer(e);
        }}
        onPointerMove={(e) => { if (e.currentTarget.hasPointerCapture(e.pointerId)) setFromPointer(e); }}
        data-lf-widget={widget.id} data-lf-cell={0}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setContextMenu({ x: e.clientX, y: e.clientY });
        }}
      >
        <div style={{
          position: 'absolute',
          ...(isVertical
            ? { bottom: 0, left: 0, right: 0, height: `${value * 100}%` }
            : { left: 0, top: 0, bottom: 0, width: `${value * 100}%` }),
          background: color, opacity: 0.55,   // no transition — it would trail the drag
        }} />
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 16, fontWeight: 700, color: '#fff', fontVariantNumeric: 'tabular-nums',
          pointerEvents: 'none', textShadow: '0 1px 3px rgba(0,0,0,0.8)',
        }}>
          {Math.round(value * 100)}%
        </div>
      </div>

      <div style={{ flexShrink: 0, textAlign: 'center', fontSize: 9, color: value < 1 ? pal('#da7f30') : '#444' }}>
        {value < 1 ? `scaling ${PROTOCOL_LABEL[protocol] ?? protocol} output` : 'full'}
      </div>

      {contextMenu && (
        <CellLinkMenu
          x={contextMenu.x}
          y={contextMenu.y}
          widgetId={widget.id}
          cellIndex={0}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}
