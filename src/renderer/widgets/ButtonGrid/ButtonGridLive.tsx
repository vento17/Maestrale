import React, { useRef, useEffect, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { ButtonGridWidget } from '../../../shared/types/project';
import { useStore, useWidgetRuntime } from '../../store';
import { bridge } from '../../ipc/bridge';
import CellLinkMenu from '../base/CellLinkMenu';
import { useSlavedCells, SLAVE_OUTLINE } from '../base/useSlavedCells';
import { BEHAVIOR_BADGE, pressCell, releaseCell } from './behavior';

function apcVelocityToColor(v: number): string {
  if (v === 1) return '#006600';
  if (v === 2) return '#00cc00';
  if (v === 3) return '#660000';
  if (v === 4) return '#cc0000';
  if (v === 5) return '#666600';
  if (v === 6) return '#cccc00';
  const h = Math.round((v / 127) * 270);
  return `hsl(${h}, 100%, 45%)`;
}

const PAGE = 8;

function NavArrow({ onClick, disabled, children }: { onClick: () => void; disabled: boolean; children: string }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        width: 40, height: 34, fontSize: 16, padding: 0,
        background: 'transparent',
        border: `1px solid ${disabled ? 'var(--color-border)' : 'var(--color-border-bright)'}`,
        color: disabled ? 'var(--color-text-dim)' : 'var(--color-text)',
        borderRadius: 2,
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.3 : 1,
        flexShrink: 0,
      }}
    >
      {children}
    </button>
  );
}

export default function ButtonGridLive({ widget }: { widget: ButtonGridWidget }): React.JSX.Element {
  const { countX, countY, spacingX, spacingY, style, cells } = widget;
  const runtime = useWidgetRuntime(widget.id);
  const { setCellValue, setButtonActive, applyFeedback } = useStore(useShallow((s) => ({
    setCellValue: s.setCellValue,
    setButtonActive: s.setButtonActive,
    applyFeedback: s.applyFeedback,
  })));

  const widgetRef = useRef(widget);
  useEffect(() => { widgetRef.current = widget; });

  const slavedCells = useSlavedCells(widget.id);
  const [contextMenu, setContextMenu] = useState<{ cellIndex: number; x: number; y: number } | null>(null);

  useEffect(() => {
    if (!contextMenu) return;
    const handler = () => setContextMenu(null);
    document.addEventListener('pointerdown', handler);
    return () => document.removeEventListener('pointerdown', handler);
  }, [contextMenu]);

  // ─── MIDI feedback from MadMapper (LED colors) ─────────────────────────────
  useEffect(() => bridge.on('tr:midi:inputEvent', (evt) => {
    if (evt.messageType !== 'noteOn' && evt.messageType !== 'noteOff') return;
    const w = widgetRef.current;
    const note = evt.number;
    const ch = evt.channel;
    const vel = evt.value;
    w.cells.forEach((cell, i) => {
      const m = cell?.mapping ?? w.mapping;
      if (!m || m.type !== 'midi') return;
      if ((m.messageType !== 'noteOn' && m.messageType !== 'noteOff') || m.channel !== ch || m.number !== note) return;
      const on = vel > 0;
      applyFeedback(w.id, i, on ? apcVelocityToColor(vel) : null, null);
      // The LED colour is always worth taking. The STATE is not: for a toggle or
      // a radio cell this app owns the state, and echoing the controller's
      // note-on/note-off back into it would drag the cell into momentary
      // behaviour — which is exactly what a linked toggle must not do.
      if ((cell?.behavior ?? 'momentary') !== 'momentary') return;
      setButtonActive(w.id, i, on);
      setCellValue(w.id, i, on ? 1 : 0);
    });
  }), []);

  // ─── Page navigation ───────────────────────────────────────────────────────
  const [pageX, setPageX] = useState(0);
  const [pageY, setPageY] = useState(0);

  const showNav = countX > PAGE || countY > PAGE;
  const maxPageX = Math.max(0, Math.ceil(countX / PAGE) - 1);
  const maxPageY = Math.max(0, Math.ceil(countY / PAGE) - 1);

  useEffect(() => {
    if (pageX > maxPageX) setPageX(maxPageX);
    if (pageY > maxPageY) setPageY(maxPageY);
  }, [maxPageX, maxPageY]);

  const visCols = showNav ? PAGE : countX;
  const visRows = showNav ? PAGE : countY;

  function getActualIndex(visIdx: number): number {
    const r = Math.floor(visIdx / visCols);
    const c = visIdx % visCols;
    const ar = pageY * PAGE + r;
    const ac = pageX * PAGE + c;
    if (ar >= countY || ac >= countX) return -1;
    return ar * countX + ac;
  }

  // ─── Button logic ──────────────────────────────────────────────────────────
  // Shared with the Router so a press from the screen and a press from a MIDI
  // controller produce exactly the same state change.
  function activate(i: number)   { pressCell(widgetRef.current, i); }
  function deactivate(i: number) { releaseCell(widgetRef.current, i); }

  // ─── Render ────────────────────────────────────────────────────────────────
  const pad = Math.max(spacingX, spacingY);

  return (
    <div
      style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', boxSizing: 'border-box', position: 'relative' }}
      onPointerDown={() => setContextMenu(null)}
    >

      {showNav && (
        <div style={{
          height: 48, flexShrink: 0,
          display: 'flex', alignItems: 'center', gap: 6,
          padding: `0 ${pad}px`,
          borderBottom: '1px solid var(--color-border)',
        }}>
          <NavArrow onClick={() => setPageX(p => Math.max(0, p - 1))} disabled={pageX === 0}>←</NavArrow>
          <NavArrow onClick={() => setPageY(p => Math.max(0, p - 1))} disabled={pageY === 0}>↑</NavArrow>
          <NavArrow onClick={() => setPageY(p => Math.min(maxPageY, p + 1))} disabled={pageY === maxPageY}>↓</NavArrow>
          <NavArrow onClick={() => setPageX(p => Math.min(maxPageX, p + 1))} disabled={pageX === maxPageX}>→</NavArrow>
          <span style={{ fontSize: 11, color: 'var(--color-text-dim)', marginLeft: 4 }}>
            {pageX + 1}/{maxPageX + 1} · {pageY + 1}/{maxPageY + 1}
          </span>
        </div>
      )}

      <div style={{
        flex: 1, minHeight: 0,
        display: 'grid',
        gridTemplateColumns: `repeat(${visCols}, 1fr)`,
        gridTemplateRows: `repeat(${visRows}, 1fr)`,
        columnGap: spacingX,
        rowGap: spacingY,
        padding: pad,
        boxSizing: 'border-box',
      }}>
        {Array.from({ length: visCols * visRows }, (_, visIdx) => {
          const cellIdx = getActualIndex(visIdx);

          if (cellIdx === -1) {
            return (
              <div key={visIdx} style={{
                borderRadius: 4,
                border: '1px solid rgba(255,255,255,0.06)',
              }} />
            );
          }

          const cell = cells[cellIdx];
          const rt = runtime?.cells[cellIdx];
          const isActive = rt?.active ?? false;
          const color = rt?.feedbackColor ?? cell?.color ?? style.foregroundColor;
          const isSlave = slavedCells.has(cellIdx);

          return (
            <div
              key={visIdx}
              style={{
                background: isActive ? color : 'rgba(0,0,0,0.35)',
                borderRadius: 4,
                border: `2px solid ${color}`,
                outline: isSlave ? SLAVE_OUTLINE : undefined,
                outlineOffset: isSlave ? -1 : undefined,
                position: 'relative',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                touchAction: 'none',
                transition: 'background 0.06s',
                userSelect: 'none',
              }}
              onPointerDown={(e) => {
                e.preventDefault();
                if (e.button !== 0) return;   // right-click → context menu only
                // A slaved button is still playable by hand: the router link is
                // a second way in, not a lock. The blue outline says it is linked.
                activate(cellIdx);
              }}
              onPointerUp={() => deactivate(cellIdx)}
              onPointerLeave={() => deactivate(cellIdx)}
              onPointerCancel={() => deactivate(cellIdx)}
              data-lf-widget={widget.id} data-lf-cell={cellIdx}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setContextMenu({ cellIndex: cellIdx, x: e.clientX, y: e.clientY });
              }}
              onMouseMove={(e) => {
                e.stopPropagation();
                useStore.getState().setHoverInfo(widget.label + ' · ' + (cell?.label ?? ('B' + (cellIdx + 1))));
              }}
            >
              {style.showLabel && (
                <span style={{
                  fontSize: style.fontSize,
                  color: isActive ? style.backgroundColor : (rt?.feedbackLabel ? color : style.labelColor),
                  pointerEvents: 'none',
                }}>
                  {rt?.feedbackLabel ?? cell?.label ?? `B${cellIdx + 1}`}
                </span>
              )}
              {/* Behaviour at a glance — a grid can mix modes cell by cell. */}
              <span style={{
                position: 'absolute', left: 3, bottom: 1,
                fontSize: Math.max(8, Math.round((style.fontSize ?? 12) * 0.62)),
                lineHeight: 1, fontWeight: 700, fontFamily: 'monospace',
                color: isActive ? style.backgroundColor : color,
                opacity: 0.65, pointerEvents: 'none',
              }}>
                {BEHAVIOR_BADGE[cell?.behavior ?? 'momentary']}
              </span>
            </div>
          );
        })}
      </div>

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
