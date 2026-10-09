import { pal, palRgb } from '../../palette';
import React, { useEffect, useRef, useState } from 'react';
import type { SliderBankWidget } from '../../../shared/types/project';
import { useStore, useWidgetRuntime } from '../../store';
import { dispatchValue } from '../../ipc/dispatch';
import { bridge } from '../../ipc/bridge';
import { clamp, formatCellValue } from '../utils';
import type { MidiMapping } from '../../../shared/types/mapping';
import CellLinkMenu from '../base/CellLinkMenu';
import { useSlavedCells, SLAVE_OUTLINE } from '../base/useSlavedCells';

const DRAG_DATA_KEY = 'application/liveforge-bpm-output';

export default function SliderBankLive({ widget }: { widget: SliderBankWidget }): React.JSX.Element {
  const { countX, countY, spacingX, spacingY, orientation, style, cells } = widget;
  const count = countX * countY;
  const runtime = useWidgetRuntime(widget.id);
  const setCellValue = useStore((s) => s.setCellValue);
  const isVertical = (orientation ?? 'vertical') === 'vertical';

  const widgetRef = useRef(widget);
  widgetRef.current = widget;

  const [contextMenu, setContextMenu] = useState<{ cellIndex: number; x: number; y: number } | null>(null);
  const [dragOverCell, setDragOverCell] = useState<number | null>(null);

  // Which cells are slaved (driven by a router row) — shown with a thin blue outline
  // and locked against manual dragging.
  const slavedCells = useSlavedCells(widget.id);

  // Bidirectional MIDI — update cell value when incoming CC matches the cell mapping
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

  // Close context menu on outside click
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
        columnGap: spacingX,
        rowGap: spacingY,
        padding: Math.max(spacingX, spacingY),
        boxSizing: 'border-box',
        position: 'relative',
      }}
      onPointerDown={() => setContextMenu(null)}
    >
      {Array.from({ length: count }, (_, i) => {
        const cell = cells[i];
        const rt = runtime?.cells[i];
        const value = rt?.value ?? 0;
        const color = rt?.feedbackColor ?? cells[i]?.color ?? style.foregroundColor;
        const isLearnTarget = useStore.getState().midiLearnTarget?.cellIndex === i &&
                              useStore.getState().midiLearnTarget?.widgetId === widget.id;
        const isDragOver = dragOverCell === i;
        const isSlave = slavedCells.has(i);

        return (
          <div
            key={i}
            style={{
              position: 'relative',
              background: isDragOver ? `rgba(${palRgb('#91ced2')},0.15)` : 'rgba(0,0,0,0.35)',
              borderRadius: 4,
              overflow: 'hidden',
              touchAction: 'none',
              cursor: 'pointer',
              outline: isLearnTarget ? `2px solid ${pal('#ff7700')}`
                : isDragOver ? `2px solid ${pal('#91ced2')}`
                : isSlave ? SLAVE_OUTLINE
                : undefined,
            }}
            onPointerDown={(e) => {
              // Slaved cells are driven by the router — locked against manual drag.
              // Right-click → Unlink to free the fader.
              // A router link is a second way in, not a lock.
              e.currentTarget.setPointerCapture(e.pointerId);
              const rect = e.currentTarget.getBoundingClientRect();
              const v = isVertical
                ? clamp(1 - (e.clientY - rect.top) / rect.height, 0, 1)
                : clamp((e.clientX - rect.left) / rect.width, 0, 1);
              setCellValue(widget.id, i, v);
              dispatchValue(cell?.mapping ?? widget.mapping, v);
            }}
            onPointerMove={(e) => {
              if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
              const rect = e.currentTarget.getBoundingClientRect();
              const v = isVertical
                ? clamp(1 - (e.clientY - rect.top) / rect.height, 0, 1)
                : clamp((e.clientX - rect.left) / rect.width, 0, 1);
              setCellValue(widget.id, i, v);
              dispatchValue(cell?.mapping ?? widget.mapping, v);
            }}
            data-lf-widget={widget.id} data-lf-cell={i}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setContextMenu({ cellIndex: i, x: e.clientX, y: e.clientY });
            }}
            onMouseMove={(e) => {
              e.stopPropagation();
              useStore.getState().setHoverInfo(widget.label + ' · ' + (cell?.label ?? ('S' + (i + 1))));
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
            {/* Fill */}
            <div style={{
              position: 'absolute',
              ...(isVertical
                ? { bottom: 0, left: 0, right: 0, height: `${value * 100}%` }
                : { left: 0, top: 0, bottom: 0, width: `${value * 100}%` }),
              background: color,
              opacity: 0.5,
              // No CSS transition on the fill: the value already arrives every
              // frame from the pointer, the router or a cue fade, so a transition
              // only makes it chase a target two frames old. On a wide horizontal
              // bank that lag is a visible gap behind the thumb, which has none.
            }} />
            {/* Thumb */}
            <div style={{
              position: 'absolute',
              ...(isVertical
                ? { bottom: `calc(${value * 100}% - 8px)`, left: '10%', right: '10%', height: 16 }
                : { left: `calc(${value * 100}% - 8px)`, top: '10%', bottom: '10%', width: 16 }),
              background: color,
              borderRadius: 4,
              zIndex: 1,
              boxShadow: '0 0 6px rgba(0,0,0,0.5)',
            }} />
            {style.showLabel && (
              <div style={{
                position: 'absolute', bottom: 4, left: 0, right: 0,
                textAlign: 'center', fontSize: style.fontSize - 1,
                color: rt?.feedbackLabel ? color : style.labelColor,
                zIndex: 2, pointerEvents: 'none',
              }}>
                {rt?.feedbackLabel ?? cell?.label ?? `S${i + 1}`}
              </div>
            )}
            {style.showValue && (
              <div style={{
                position: 'absolute', top: 3, left: 0, right: 0,
                textAlign: 'center', fontSize: Math.max(9, style.fontSize - 4),
                color: style.labelColor, opacity: 0.85,
                zIndex: 2, pointerEvents: 'none', fontVariantNumeric: 'tabular-nums',
              }}>
                {formatCellValue(value, cell?.mapping ?? widget.mapping, style.valueFormat ?? 'percent')}
              </div>
            )}
            {isLearnTarget && (
              <div style={{
                position: 'absolute', inset: 0, background: `rgba(${palRgb('#ff7700')},0.12)`,
                zIndex: 3, pointerEvents: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <span style={{ fontSize: 9, color: pal('#ff7700'), fontFamily: 'monospace', letterSpacing: 1 }}>LEARN</span>
              </div>
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
