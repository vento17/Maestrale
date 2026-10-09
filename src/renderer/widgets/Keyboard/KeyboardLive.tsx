import React, { useEffect, useRef, useState } from 'react';
import type { KeyboardWidget } from '../../../shared/types/project';
import { useStore, useWidgetRuntime } from '../../store';
import { dispatchButton } from '../../ipc/dispatch';
import CellLinkMenu from '../base/CellLinkMenu';
import { useSlavedCells, SLAVE_OUTLINE } from '../base/useSlavedCells';
import { BEHAVIOR_BADGE } from '../ButtonGrid/behavior';
import { keyCapLabel } from './keyNames';

export default function KeyboardLive({ widget }: { widget: KeyboardWidget }): React.JSX.Element {
  const { keys, countX, spacingX, spacingY, style } = widget;
  const runtime = useWidgetRuntime(widget.id);
  const setCellValue = useStore((s) => s.setCellValue);
  const setButtonActive = useStore((s) => s.setButtonActive);
  const slavedCells = useSlavedCells(widget.id);
  const [contextMenu, setContextMenu] = useState<{ cellIndex: number; x: number; y: number } | null>(null);

  // The physical-key listener is bound once and reads through refs, so holding a
  // key never re-registers it mid-press.
  const widgetRef = useRef(widget);
  widgetRef.current = widget;
  const slavedRef = useRef(slavedCells);
  slavedRef.current = slavedCells;

  function activate(i: number): void {
    const w = widgetRef.current;
    const k = w.keys[i];
    if (!k || slavedRef.current.has(i)) return;
    const rt = useStore.getState().runtime.widgets[w.id];
    const mapping = k.mapping ?? w.mapping;
    const on = k.onValue ?? 127;
    const off = k.offValue ?? 0;

    if (k.behavior === 'toggle') {
      const next = !(rt?.cells[i]?.active ?? false);
      setButtonActive(w.id, i, next);
      setCellValue(w.id, i, next ? 1 : 0);
      dispatchButton(mapping, next, on, off);
    } else if (k.behavior === 'pulse') {
      setButtonActive(w.id, i, true);
      setCellValue(w.id, i, 1);
      dispatchButton(mapping, true, on, off);
      setTimeout(() => {
        setButtonActive(w.id, i, false);
        setCellValue(w.id, i, 0);
        dispatchButton(mapping, false, on, off);
      }, 100);
    } else if (k.behavior === 'radio') {
      w.keys.forEach((other, idx) => {
        if (other.behavior === 'radio' && idx !== i) {
          setButtonActive(w.id, idx, false);
          setCellValue(w.id, idx, 0);
          dispatchButton(other.mapping ?? w.mapping, false, other.onValue ?? 127, other.offValue ?? 0);
        }
      });
      setButtonActive(w.id, i, true);
      setCellValue(w.id, i, 1);
      dispatchButton(mapping, true, on, off);
    } else {
      setButtonActive(w.id, i, true);
      setCellValue(w.id, i, 1);
      dispatchButton(mapping, true, on, off);
    }
  }

  function deactivate(i: number): void {
    const w = widgetRef.current;
    const k = w.keys[i];
    if (!k || slavedRef.current.has(i)) return;
    // Only momentary releases — the others own their own off edge.
    if ((k.behavior ?? 'momentary') !== 'momentary') return;
    setButtonActive(w.id, i, false);
    setCellValue(w.id, i, 0);
    dispatchButton(k.mapping ?? w.mapping, false, k.onValue ?? 127, k.offValue ?? 0);
  }

  useEffect(() => {
    function isTyping(t: EventTarget | null): boolean {
      const el = t as HTMLElement | null;
      const tag = el?.tagName?.toLowerCase();
      return tag === 'input' || tag === 'textarea' || tag === 'select' || !!el?.isContentEditable;
    }
    function indexOf(code: string): number {
      return widgetRef.current.keys.findIndex((k) => k.code === code);
    }
    function onDown(e: KeyboardEvent): void {
      if (isTyping(e.target)) return;
      // Auto-repeat must not re-fire a held key.
      if (e.repeat) return;
      const i = indexOf(e.code);
      if (i === -1) return;
      e.preventDefault();
      activate(i);
    }
    function onUp(e: KeyboardEvent): void {
      if (isTyping(e.target)) return;
      const i = indexOf(e.code);
      if (i === -1) return;
      e.preventDefault();
      deactivate(i);
    }
    // A held key whose window loses focus would never see its keyup.
    function onBlur(): void {
      widgetRef.current.keys.forEach((_, i) => deactivate(i));
    }
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  const pad = Math.max(spacingX, spacingY);
  const cols = Math.max(1, countX);

  if (keys.length === 0) {
    return (
      <div style={{
        width: '100%', height: '100%', display: 'flex', alignItems: 'center',
        justifyContent: 'center', padding: 12, boxSizing: 'border-box',
        color: '#666', fontFamily: 'monospace', fontSize: 12, textAlign: 'center',
      }}>
        no keys bound — add them in the Inspector
      </div>
    );
  }

  return (
    <div
      style={{ width: '100%', height: '100%', boxSizing: 'border-box', position: 'relative' }}
      onPointerDown={() => setContextMenu(null)}
    >
      <div style={{
        width: '100%', height: '100%',
        display: 'grid',
        gridTemplateColumns: `repeat(${cols}, 1fr)`,
        gridAutoRows: '1fr',
        columnGap: spacingX,
        rowGap: spacingY,
        padding: pad,
        boxSizing: 'border-box',
      }}>
        {keys.map((k, i) => {
          const rt = runtime?.cells[i];
          const isActive = rt?.active ?? false;
          const color = rt?.feedbackColor ?? k.color ?? style.foregroundColor;
          const isSlave = slavedCells.has(i);
          return (
            <div
              key={k.id}
              style={{
                background: isActive ? color : 'rgba(0,0,0,0.35)',
                borderRadius: 4,
                border: `2px solid ${color}`,
                outline: isSlave ? SLAVE_OUTLINE : undefined,
                outlineOffset: isSlave ? -1 : undefined,
                position: 'relative',
                display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer',
                touchAction: 'none', userSelect: 'none',
                transition: 'background 0.06s',
                minHeight: 0, overflow: 'hidden',
              }}
              onPointerDown={(e) => {
                e.preventDefault();
                if (e.button !== 0) return;
                activate(i);
              }}
              onPointerUp={() => deactivate(i)}
              onPointerLeave={() => deactivate(i)}
              onPointerCancel={() => deactivate(i)}
              data-lf-widget={widget.id} data-lf-cell={i}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setContextMenu({ cellIndex: i, x: e.clientX, y: e.clientY });
              }}
              onMouseMove={(e) => {
                e.stopPropagation();
                useStore.getState().setHoverInfo(`${widget.label} · ${k.label || keyCapLabel(k.code)}`);
              }}
            >
              <span style={{
                fontSize: style.fontSize, fontWeight: 700, fontFamily: 'monospace',
                color: isActive ? style.backgroundColor : color,
                pointerEvents: 'none', lineHeight: 1.1,
              }}>
                {keyCapLabel(k.code)}
              </span>
              {style.showLabel && k.label && k.label !== keyCapLabel(k.code) && (
                <span style={{
                  fontSize: Math.max(8, (style.fontSize ?? 12) * 0.72),
                  color: isActive ? style.backgroundColor : style.labelColor,
                  pointerEvents: 'none', marginTop: 2,
                  maxWidth: '92%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {k.label}
                </span>
              )}
              <span style={{
                position: 'absolute', left: 3, bottom: 1,
                fontSize: Math.max(8, Math.round((style.fontSize ?? 12) * 0.62)),
                lineHeight: 1, fontWeight: 700, fontFamily: 'monospace',
                color: isActive ? style.backgroundColor : color,
                opacity: 0.65, pointerEvents: 'none',
              }}>
                {BEHAVIOR_BADGE[k.behavior ?? 'momentary']}
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
