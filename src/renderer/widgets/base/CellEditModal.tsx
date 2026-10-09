import { pal } from '../../palette';
import React from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { OutputProtocol } from '../../../shared/types/project';
import { useStore, useActivePage } from '../../store';
import NumberInput from './NumberInput';

interface Props {
  widgetId: string;
  pageId: string;
  onClose: () => void;
}

class CellEditErrorBoundary extends React.Component<{ onClose: () => void; children: React.ReactNode }, { error: string | null }> {
  state = { error: null };
  static getDerivedStateFromError(e: Error) { return { error: e.message }; }
  render() {
    if (this.state.error) {
      return (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000 }}>
          <div style={{ background: 'var(--color-surface)', border: `1px solid ${pal('#db8235')}`, borderRadius: 8, padding: 24, maxWidth: 400, color: 'var(--color-text)' }}>
            <div style={{ color: pal('#db8235'), fontWeight: 600, marginBottom: 8 }}>Could not open cell editor</div>
            <div style={{ fontSize: 12, color: 'var(--color-text-dim)', marginBottom: 16 }}>{this.state.error}</div>
            <button onClick={this.props.onClose} style={{ padding: '4px 16px', cursor: 'pointer', background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', color: 'var(--color-text)', borderRadius: 4 }}>Close</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function CellEditModalInner({ widgetId, pageId, onClose }: Props): React.JSX.Element | null {
  // Read widget LIVE from store — no stale snapshot, color updates reflect immediately
  const page = useActivePage();
  const { updateCell } = useStore(useShallow((s) => ({ updateCell: s.updateCell })));

  const widget = page?.widgets.find((w) => w.id === widgetId);
  // `'cells' in widget` already narrows to the cell-bank widgets (slider/button/knob)
  if (!widget || !('cells' in widget)) return null;

  const cells = widget.cells as Array<{
    label: string;
    color?: string;
    behavior?: import('../../../shared/types/project').ButtonBehavior;
    mapping: import('../../../shared/types/mapping').Mapping;
    onValue?: number;
    offValue?: number;
  }>;

  const proto = widget.outputProtocol;

  // Tab walks DOWN a column instead of across a row. You fill in every name,
  // then every address — the browser default (row by row) forces you to skip
  // past colour and mapping fields between each name.
  function handleTab(e: React.KeyboardEvent<HTMLDivElement>): void {
    if (e.key !== 'Tab') return;
    const rows = Array.from(e.currentTarget.querySelectorAll('tbody tr'));
    if (rows.length === 0) return;
    const fieldsOf = (tr: Element): HTMLElement[] =>
      Array.from(tr.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select'))
        .filter((el) => !el.disabled);

    const active = document.activeElement as HTMLElement | null;
    let row = -1, col = -1;
    rows.forEach((tr, ri) => {
      const at = fieldsOf(tr).indexOf(active as HTMLElement);
      if (at >= 0) { row = ri; col = at; }
    });
    if (row === -1) return;   // focus is outside the table — leave Tab alone

    e.preventDefault();
    const colCount = fieldsOf(rows[0]).length;
    let nRow = row + (e.shiftKey ? -1 : 1);
    let nCol = col;
    // Past the last row, carry on at the top of the next column.
    if (nRow >= rows.length) { nRow = 0; nCol = (col + 1) % colCount; }
    if (nRow < 0) { nRow = rows.length - 1; nCol = (col - 1 + colCount) % colCount; }

    const target = fieldsOf(rows[nRow])[nCol];
    if (!target) return;
    target.focus();
    // Pre-select text so the next keystroke overwrites — colour pickers cannot
    // be selected and throw if asked.
    const asInput = target as HTMLInputElement;
    if (asInput.select && (asInput.type === 'text' || asInput.type === 'number')) asInput.select();
  }

  return (
    <div
      style={styles.overlay}
      onClick={onClose}
      // Stop ALL keyboard events from reaching the canvas (fixes backspace-deletes-widget)
      onKeyDown={(e) => e.stopPropagation()}
    >
      <div style={styles.panel} onClick={(e) => e.stopPropagation()} onKeyDown={handleTab}>
        <div style={styles.header}>
          <span style={{ fontWeight: 600, color: 'var(--color-accent)' }}>
            {widget.label} — Edit cells
            <span style={{ fontWeight: 400, color: 'var(--color-text-dim)', marginLeft: 8, fontSize: 11 }}>
              [{proto.toUpperCase()}]
            </span>
          </span>
          <button style={styles.closeBtn} onClick={onClose}>✕</button>
        </div>

        <div style={styles.tableWrap}>
          <table style={styles.table}>
            <thead>
              <tr>
                <Th>#</Th>
                <Th>Name</Th>
                <Th>Color</Th>
                {proto === 'midi'   && <><Th>Ch</Th><Th>Msg</Th><Th>CC / Note</Th></>}
                {proto === 'osc'    && <Th style={{ minWidth: 200 }}>OSC Address</Th>}
                {proto === 'artnet' && <><Th>Universe</Th><Th>Channel</Th></>}
                {proto === 'sacn'   && <><Th>Universe</Th><Th>Channel</Th><Th>Priority</Th></>}
                {widget.kind === 'buttonGrid' && <><Th>Behavior</Th><Th>On</Th><Th>Off</Th></>}
              </tr>
            </thead>
            <tbody>
              {cells.map((cell, i) => (
                <CellRow
                  key={i}
                  index={i}
                  cell={cell}
                  proto={proto}
                  isButton={widget.kind === 'buttonGrid'}
                  onChange={(patch) => updateCell(pageId, widgetId, i, patch)}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default function CellEditModal(props: Props): React.JSX.Element {
  return (
    <CellEditErrorBoundary onClose={props.onClose}>
      <CellEditModalInner {...props} />
    </CellEditErrorBoundary>
  );
}

function CellRow({ index, cell, proto, isButton, onChange }: {
  index: number;
  cell: {
    label: string; color?: string;
    behavior?: import('../../../shared/types/project').ButtonBehavior;
    mapping: import('../../../shared/types/mapping').Mapping;
    onValue?: number; offValue?: number;
  };
  proto: OutputProtocol;
  isButton: boolean;
  onChange: (p: Record<string, unknown>) => void;
}) {
  const m = cell.mapping;
  const midi = m?.type === 'midi' ? m : null;
  const osc  = m?.type === 'osc'  ? m : null;
  const an   = m?.type === 'artnet' ? m : null;
  const sacn = m?.type === 'sacn'   ? m : null;

  return (
    <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
      <Td><span style={{ color: 'var(--color-text-dim)', fontSize: 11 }}>{index + 1}</span></Td>

      <Td>
        <input style={inp} value={cell.label}
          onChange={(e) => onChange({ label: e.target.value })} />
      </Td>

      <Td>
        <input type="color"
          value={cell.color ?? '#e0e0e0'}
          onChange={(e) => onChange({ color: e.target.value })}
          style={{ width: 32, height: 24, border: 'none', background: 'none', cursor: 'pointer', padding: 0 }} />
      </Td>

      {proto === 'midi' && (
        <>
          <Td>
            <NumberInput style={{ ...inp, width: 36 }} min={1} max={16}
              value={midi?.channel ?? 1}
              onChange={(v) => onChange({ mapping: { ...midi, type: 'midi', channel: v } })} />
          </Td>
          <Td>
            <select style={{ ...inp, width: 84 }}
              value={midi?.messageType ?? 'controlChange'}
              onChange={(e) => onChange({ mapping: { ...midi, type: 'midi', messageType: e.target.value } })}>
              <option value="controlChange">CC</option>
              <option value="noteOn">Note On</option>
              <option value="noteOff">Note Off</option>
              <option value="pitchBend">Pitch Bend</option>
              <option value="aftertouch">Aftertouch</option>
            </select>
          </Td>
          <Td>
            <NumberInput style={{ ...inp, width: 44 }} min={0} max={127}
              value={midi?.number ?? index}
              onChange={(v) => onChange({ mapping: { ...midi, type: 'midi', number: v } })} />
          </Td>
        </>
      )}

      {proto === 'osc' && (
        <Td>
          <input style={{ ...inp, width: '100%', minWidth: 180 }}
            value={osc?.address ?? `/ch/${index + 1}`}
            onChange={(e) => onChange({ mapping: { type: 'osc', address: e.target.value } })} />
        </Td>
      )}

      {proto === 'artnet' && (
        <>
          <Td>
            <NumberInput style={{ ...inp, width: 56 }} min={0} max={32767}
              value={an?.universe ?? 0}
              onChange={(v) => onChange({ mapping: { ...an, type: 'artnet', universe: v } })} />
          </Td>
          <Td>
            <NumberInput style={{ ...inp, width: 48 }} min={1} max={512}
              value={an?.channel ?? index + 1}
              onChange={(v) => onChange({ mapping: { ...an, type: 'artnet', channel: v } })} />
          </Td>
        </>
      )}

      {proto === 'sacn' && (
        <>
          <Td>
            <NumberInput style={{ ...inp, width: 60 }} min={1} max={63999}
              value={sacn?.universe ?? 1}
              onChange={(v) => onChange({ mapping: { ...sacn, type: 'sacn', channel: sacn?.channel ?? index + 1, minValue: 0, maxValue: 255, priority: sacn?.priority ?? 100, universe: v } })} />
          </Td>
          <Td>
            <NumberInput style={{ ...inp, width: 48 }} min={1} max={512}
              value={sacn?.channel ?? index + 1}
              onChange={(v) => onChange({ mapping: { ...sacn, type: 'sacn', universe: sacn?.universe ?? 1, minValue: 0, maxValue: 255, priority: sacn?.priority ?? 100, channel: v } })} />
          </Td>
          <Td>
            <NumberInput style={{ ...inp, width: 44 }} min={1} max={200}
              value={sacn?.priority ?? 100}
              onChange={(v) => onChange({ mapping: { ...sacn, type: 'sacn', universe: sacn?.universe ?? 1, channel: sacn?.channel ?? index + 1, minValue: 0, maxValue: 255, priority: v } })} />
          </Td>
        </>
      )}

      {isButton && (
        <>
          <Td>
            <select style={{ ...inp, width: 84 }}
              value={cell.behavior ?? 'momentary'}
              onChange={(e) => onChange({ behavior: e.target.value })}>
              <option value="momentary">Momentary</option>
              <option value="pulse">Pulse</option>
              <option value="toggle">Toggle</option>
              <option value="radio">Radio</option>
            </select>
          </Td>
          <Td>
            <NumberInput style={{ ...inp, width: 40 }} min={0} max={127}
              value={cell.onValue ?? 127}
              onChange={(v) => onChange({ onValue: v })} />
          </Td>
          <Td>
            <NumberInput style={{ ...inp, width: 40 }} min={0} max={127}
              value={cell.offValue ?? 0}
              onChange={(v) => onChange({ offValue: v })} />
          </Td>
        </>
      )}
    </tr>
  );
}

function Th({ children, style }: { children?: React.ReactNode; style?: React.CSSProperties }) {
  return <th style={{ ...styles.th, ...style }}>{children}</th>;
}
function Td({ children }: { children?: React.ReactNode }) {
  return <td style={styles.td}>{children}</td>;
}

const inp: React.CSSProperties = {
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  color: 'var(--color-text)',
  borderRadius: 3, padding: '2px 5px',
  fontSize: 11, width: '100%', boxSizing: 'border-box',
};

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed', inset: 0,
    background: 'rgba(0,0,0,0.7)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 2000,
  },
  panel: {
    background: 'var(--color-surface)',
    border: '1px solid var(--color-border)',
    borderRadius: 8,
    width: 'min(92vw, 760px)',
    maxHeight: '80vh',
    display: 'flex', flexDirection: 'column',
    overflow: 'hidden',
  },
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '12px 16px',
    borderBottom: '1px solid var(--color-border)',
    flexShrink: 0,
  },
  closeBtn: { background: 'none', border: 'none', color: 'var(--color-text-dim)', cursor: 'pointer', fontSize: 16 },
  tableWrap: { overflowY: 'auto', flex: 1 },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 12 },
  th: {
    textAlign: 'left', padding: '6px 10px',
    background: 'var(--color-surface-2)',
    color: 'var(--color-text-dim)',
    fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.8,
    borderBottom: '1px solid var(--color-border)',
    position: 'sticky', top: 0, zIndex: 1,
  },
  td: { padding: '5px 8px', verticalAlign: 'middle' },
};
