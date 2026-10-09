import { pal, palRgb } from '../../palette';
import React, { useRef, useEffect, useState } from 'react';
import type { KnobBankWidget } from '../../../shared/types/project';
import { useStore, useWidgetRuntime } from '../../store';
import { dispatchValue } from '../../ipc/dispatch';
import { bridge } from '../../ipc/bridge';
import { clamp, formatCellValue } from '../utils';
import type { MidiMapping } from '../../../shared/types/mapping';
import CellLinkMenu from '../base/CellLinkMenu';
import { useSlavedCells, SLAVE_OUTLINE } from '../base/useSlavedCells';

const DRAG_RANGE_PX = 200;
const DRAG_DATA_KEY = 'application/liveforge-bpm-output';

const VB = 60;
const CX = 30, CY = 30, R = 21, TRACK_R = 26, STROKE = 5.5, DOT_R = 3.8;

function describeArc(startDeg: number, endDeg: number): string {
  const toRad = (d: number) => (d - 90) * (Math.PI / 180);
  const x1 = CX + TRACK_R * Math.cos(toRad(startDeg));
  const y1 = CY + TRACK_R * Math.sin(toRad(startDeg));
  const x2 = CX + TRACK_R * Math.cos(toRad(endDeg));
  const y2 = CY + TRACK_R * Math.sin(toRad(endDeg));
  const large = Math.abs(endDeg - startDeg) > 180 ? 1 : 0;
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${TRACK_R} ${TRACK_R} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

export default function KnobBankLive({ widget }: { widget: KnobBankWidget }): React.JSX.Element {
  const { countX, countY, spacingX, spacingY, style, cells } = widget;
  const count = countX * countY;
  const size = widget.knobSize ?? 56;
  const runtime = useWidgetRuntime(widget.id);
  const setCellValue = useStore((s) => s.setCellValue);
  const drags = useRef<Map<number, { startX: number; startY: number; startValue: number }>>(new Map());
  const widgetRef = useRef(widget);
  widgetRef.current = widget;

  const [contextMenu, setContextMenu] = useState<{ cellIndex: number; x: number; y: number } | null>(null);
  const [dragOverCell, setDragOverCell] = useState<number | null>(null);
  const slavedCells = useSlavedCells(widget.id);

  // Bidirectional MIDI
  useEffect(() => {
    const off = bridge.on('tr:midi:inputEvent', (evt) => {
      if (evt.messageType !== 'controlChange') return;
      const w = widgetRef.current;
      w.cells.forEach((cell, i) => {
        // Listen on the input binding when there is one; otherwise the
        // output mapping doubles as the input, as a motorised fader wants.
        const m = cell?.mapping ?? w.mapping;
        if (!m || m.type !== 'midi') return;
        const mm = m as MidiMapping;
        if (mm.messageType !== 'controlChange') return;
        if (mm.channel !== evt.channel || mm.number !== evt.number) return;
        useStore.getState().setCellValue(w.id, i, evt.value / 127);
      });
    });
    return off;
  }, [widget.id]);

  useEffect(() => {
    if (!contextMenu) return;
    const handler = () => setContextMenu(null);
    document.addEventListener('pointerdown', handler);
    return () => document.removeEventListener('pointerdown', handler);
  }, [contextMenu]);

  return (
    <div
      style={{
        width: '100%', height: '100%',
        display: 'grid',
        gridTemplateColumns: `repeat(${countX}, 1fr)`,
        gridTemplateRows: `repeat(${countY}, 1fr)`,
        columnGap: spacingX, rowGap: spacingY,
        padding: Math.max(spacingX, spacingY), boxSizing: 'border-box',
        position: 'relative',
      }}
      onPointerDown={() => setContextMenu(null)}
    >
      {Array.from({ length: count }, (_, i) => {
        const cell = cells[i];
        const rt = runtime?.cells[i];
        const value = rt?.value ?? 0;
        const color = rt?.feedbackColor ?? cells[i]?.color ?? style.foregroundColor;
        const minAngle = cell?.minAngle ?? -135;
        const maxAngle = cell?.maxAngle ?? 135;
        const deg = minAngle + value * (maxAngle - minAngle);
        const isDragOver = dragOverCell === i;
        const mlt = useStore.getState().midiLearnTarget;
        const isLearnTarget = mlt?.widgetId === widget.id && mlt?.cellIndex === i;
        const isSlave = slavedCells.has(i);

        return (
          <div
            key={i}
            style={{
              display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center',
              gap: 4, cursor: 'ns-resize', touchAction: 'none',
              borderRadius: 4,
              outline: isLearnTarget ? `2px solid ${pal('#ff7700')}`
                : isDragOver ? `2px solid ${pal('#91ced2')}`
                : isSlave ? SLAVE_OUTLINE
                : undefined,
              background: isDragOver ? `rgba(${palRgb('#91ced2')},0.1)` : undefined,
            }}
            onPointerDown={(e) => {
              // A router link is a second way in, not a lock.
              e.currentTarget.setPointerCapture(e.pointerId);
              drags.current.set(e.pointerId, {
                startX: e.clientX,
                startY: e.clientY,
                startValue: runtime?.cells[i]?.value ?? 0,
              });
            }}
            onPointerMove={(e) => {
              const drag = drags.current.get(e.pointerId);
              if (!drag) return;
              // Up OR right raises the value; down OR left lowers it.
              const delta = (drag.startY - e.clientY) + (e.clientX - drag.startX);
              const v = clamp(drag.startValue + delta / DRAG_RANGE_PX, 0, 1);
              setCellValue(widget.id, i, v);
              dispatchValue(cells[i]?.mapping ?? widget.mapping, v);
            }}
            onPointerUp={(e) => { drags.current.delete(e.pointerId); }}
            onPointerCancel={(e) => { drags.current.delete(e.pointerId); }}
            data-lf-widget={widget.id} data-lf-cell={i}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setContextMenu({ cellIndex: i, x: e.clientX, y: e.clientY });
            }}
            onMouseMove={(e) => {
              e.stopPropagation();
              useStore.getState().setHoverInfo(widget.label + ' · ' + (cell?.label ?? ('K' + (i + 1))));
            }}
            onDragOver={(e) => {
              if (!e.dataTransfer.types.includes(DRAG_DATA_KEY)) return;
              e.preventDefault();
              setDragOverCell(i);
            }}
            onDragLeave={() => setDragOverCell(null)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOverCell(null);
              const json = e.dataTransfer.getData(DRAG_DATA_KEY);
              if (!json) return;
              try {
                const { mapping } = JSON.parse(json);
                const store = useStore.getState();
                if (store.activePageId) {
                  store.updateCell(store.activePageId, widgetRef.current.id, i, { mapping });
                }
              } catch { /* ignore */ }
            }}
          >
            <svg width={size} height={size} viewBox={`0 0 ${VB} ${VB}`}>
              <path d={describeArc(minAngle, maxAngle)}
                fill="none" stroke="rgba(0,0,0,0.4)" strokeWidth={STROKE} strokeLinecap="round" />
              <path d={describeArc(minAngle, deg)}
                fill="none" stroke={color} strokeWidth={STROKE} strokeLinecap="round" />
              <circle cx={CX} cy={CY} r={R} fill="rgba(0,0,0,0.6)" />
              <circle
                cx={CX + R * 0.6 * Math.cos((deg - 90) * Math.PI / 180)}
                cy={CY + R * 0.6 * Math.sin((deg - 90) * Math.PI / 180)}
                r={DOT_R} fill={color}
              />
            </svg>
            {style.showLabel && (
              <span style={{ fontSize: style.fontSize - 1, color: rt?.feedbackLabel ? color : style.labelColor, pointerEvents: 'none' }}>
                {rt?.feedbackLabel ?? cell?.label ?? `K${i + 1}`}
              </span>
            )}
            {style.showValue && (
              <span style={{ fontSize: Math.max(8, style.fontSize - 4), color: style.labelColor, opacity: 0.85, pointerEvents: 'none', fontVariantNumeric: 'tabular-nums' }}>
                {formatCellValue(value, cell?.mapping ?? widget.mapping, style.valueFormat ?? 'percent')}
              </span>
            )}
            {isLearnTarget && (
              <div style={{
                position: 'absolute', inset: 0, background: `rgba(${palRgb('#ff7700')},0.12)`,
                zIndex: 3, pointerEvents: 'none', borderRadius: 4,
              }} />
            )}
          </div>
        );
      })}

      {contextMenu && (
        <CellLinkMenu
          x={contextMenu.x}
          y={contextMenu.y}
          widgetId={widget.id}
          cellIndex={contextMenu.cellIndex}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}
