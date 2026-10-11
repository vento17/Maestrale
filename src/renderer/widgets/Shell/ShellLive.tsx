import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { nanoid } from 'nanoid';
import type { ShellButton, ShellWidget } from '../../../shared/types/project';
import { SHELL_ACTIONS, shellAction } from '../../../shared/shellActions';
import { useStore } from '../../store';
import { pal } from '../../palette';
import { fireShellButton, useCountdown, cancelCountdown } from './shellRun';

// Buttons that act on the PC. Tap = run (power actions count down first; tap
// again to cancel). Hold or right-click = edit. ＋ adds a button. Each button
// is also an input: patch a clock row onto it to turn the PC off at 23:00.

const HOLD_MS = 550;

function pageOf(widgetId: string): string | undefined {
  return useStore.getState().project.pages.find((p) => p.widgets.some((w) => w.id === widgetId))?.id;
}
export function setShellButtons(w: ShellWidget, buttons: ShellButton[]): void {
  const pid = pageOf(w.id);
  if (pid) useStore.getState().updateWidget(pid, w.id, { buttons } as never);
}

export default function ShellLive({ widget, preview = false }: { widget: ShellWidget; preview?: boolean }): React.JSX.Element {
  const [editing, setEditing] = useState<number | null>(null);
  const cd = useCountdown();
  const fs = widget.style.fontSize || 14;
  const color = widget.style.foregroundColor || pal('#4fb8ab');
  const n = widget.buttons.length;
  const cols = Math.max(1, Math.min(n || 1, Math.ceil(Math.sqrt(n || 1) * 1.5)));

  const add = () => {
    useStore.getState().captureHistory();
    const b: ShellButton = { id: nanoid(), label: 'Turn off PC', action: 'shutdown', delay: 10 };
    setShellButtons(widget, [...widget.buttons, b]);
    setEditing(widget.buttons.length);
  };

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', gap: 6, padding: 6, boxSizing: 'border-box', fontFamily: 'inherit', pointerEvents: preview ? 'none' : undefined }}>
      {cd && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px', borderRadius: 4, background: 'rgba(255,90,60,0.15)', border: '1px solid #c54', color: '#f98', fontSize: Math.max(11, fs - 2) }}>
          <span style={{ flex: 1 }}>{cd.label} in {Math.max(0, Math.ceil((cd.until - Date.now()) / 1000))} s</span>
          <button onClick={cancelCountdown} style={{ background: '#c54', color: '#000', border: 'none', borderRadius: 3, padding: '4px 12px', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
        </div>
      )}
      <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 6 }}>
        {widget.buttons.map((b, i) => (
          <ShellBtn key={b.id} w={widget} b={b} index={i} color={color} fs={fs}
            onEdit={() => { useStore.getState().captureHistory(); setEditing(i); }} />
        ))}
      </div>
      <button onClick={add} title="Add a button"
        style={{ flexShrink: 0, height: 24, borderRadius: 4, border: '1px dashed #333', background: 'transparent', color: '#888', cursor: 'pointer', fontSize: 16, lineHeight: '20px' }}>＋</button>
      {editing !== null && widget.buttons[editing] && (
        <ShellButtonEditor button={widget.buttons[editing]}
          onChange={(nb) => setShellButtons(widget, widget.buttons.map((x, j) => (j === editing ? nb : x)))}
          onRemove={() => {
            useStore.getState().captureHistory();
            useStore.getState().dropCellAndShiftLinks(widget.id, editing);
            setShellButtons(widget, widget.buttons.filter((_, j) => j !== editing));
            setEditing(null);
          }}
          onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

function ShellBtn({ w, b, index, color, fs, onEdit }: { w: ShellWidget; b: ShellButton; index: number; color: string; fs: number; onEdit: () => void }): React.JSX.Element {
  const def = shellAction(b.action);
  const hold = useRef<ReturnType<typeof setTimeout> | null>(null);
  const held = useRef(false);
  const [down, setDown] = useState(false);
  const cd = useCountdown();
  const counting = !!cd && cd.label === (b.label || def?.name);
  const danger = !!def?.power;
  const c = danger ? '#e0603f' : color;
  useEffect(() => () => { if (hold.current) clearTimeout(hold.current); }, []);
  return (
    <button data-lf-widget={w.id} data-lf-cell={index}
      title={`${def?.name ?? b.action}${b.arg ? ` · ${b.arg}` : ''} — tap: run${danger ? ' (counts down, tap again to cancel)' : ''} · hold / right-click: edit`}
      onContextMenu={(e) => { e.preventDefault(); onEdit(); }}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        held.current = false; setDown(true);
        hold.current = setTimeout(() => { held.current = true; setDown(false); onEdit(); }, HOLD_MS);
      }}
      onPointerUp={() => {
        if (hold.current) { clearTimeout(hold.current); hold.current = null; }
        setDown(false);
        if (!held.current) fireShellButton(w, index);
      }}
      onPointerLeave={() => { if (hold.current) { clearTimeout(hold.current); hold.current = null; } setDown(false); }}
      style={{
        minHeight: 0, borderRadius: 5, cursor: 'pointer', fontFamily: 'inherit', touchAction: 'none',
        background: down || counting ? c : '#141414', color: down || counting ? '#000' : '#ddd',
        border: `1px solid ${c}`, boxShadow: counting ? `0 0 12px ${c}` : 'inset 0 -2px 0 rgba(0,0,0,0.6)',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2, padding: 4,
      }}>
      <span style={{ fontSize: fs, fontWeight: 700, textAlign: 'center', lineHeight: 1.1 }}>{b.label || def?.name || b.action}</span>
      {b.label && def && b.label !== def.name && <span style={{ fontSize: Math.max(9, fs - 5), opacity: 0.6 }}>{def.name}</span>}
    </button>
  );
}

const inp: React.CSSProperties = { width: '100%', boxSizing: 'border-box', background: '#0e0e0e', border: '1px solid #2a2a2a', color: '#ddd', borderRadius: 3, padding: '7px 9px', fontSize: 14, fontFamily: 'inherit' };

export function ShellButtonEditor({ button, onChange, onRemove, onClose }: {
  button: ShellButton; onChange: (b: ShellButton) => void; onRemove: () => void; onClose: () => void;
}): React.JSX.Element {
  const def = shellAction(button.action);
  const groups = [...new Set(SHELL_ACTIONS.map((a) => a.group))];
  // Typing the action: matches a name ("turn off" → Turn off PC).
  const [q, setQ] = useState('');
  const matches = q ? SHELL_ACTIONS.filter((a) => a.name.toLowerCase().includes(q.toLowerCase())) : [];
  const pick = (id: string) => {
    const d = shellAction(id);
    const wasDefaultLabel = !button.label || SHELL_ACTIONS.some((a) => a.name === button.label);
    onChange({ ...button, action: id, label: wasDefaultLabel ? d?.name ?? button.label : button.label, delay: d?.power ? (button.delay ?? 10) : button.delay });
    setQ('');
  };
  return createPortal(
    <div onPointerDown={onClose} style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div onPointerDown={(e) => e.stopPropagation()} onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
        style={{ background: '#141414', border: '1px solid #333', borderRadius: 6, padding: 18, width: 420, display: 'flex', flexDirection: 'column', gap: 10, color: '#ddd', fontFamily: 'inherit' }}>
        <div style={{ fontSize: 14, fontWeight: 700 }}>Shell button</div>
        <label style={{ fontSize: 11, color: '#888' }}>Action
          <input style={{ ...inp, marginTop: 4 }} value={q} placeholder="type: turn off, restart, open…" onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && matches[0]) pick(matches[0].id); }} />
        </label>
        {matches.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {matches.map((a) => <button key={a.id} onClick={() => pick(a.id)} style={{ ...inp, width: 'auto', cursor: 'pointer', padding: '4px 10px', fontSize: 12 }}>{a.name}</button>)}
          </div>
        )}
        <select style={inp} value={button.action} onChange={(e) => pick(e.target.value)}>
          {groups.map((g) => (
            <optgroup key={g} label={g}>
              {SHELL_ACTIONS.filter((a) => a.group === g).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </optgroup>
          ))}
        </select>
        {def && <div style={{ fontSize: 11, color: '#888', lineHeight: 1.4 }}>{def.hint}</div>}
        {def?.arg && (
          <label style={{ fontSize: 11, color: '#888' }}>{def.arg}
            <input style={{ ...inp, marginTop: 4 }} value={button.arg ?? ''} onChange={(e) => onChange({ ...button, arg: e.target.value })}
              placeholder={button.action === 'openUrl' ? 'https://…' : button.action === 'killProcess' ? 'chrome.exe' : button.action === 'custom' ? 'e.g. start "" "C:\\Shows\\intro.mp4"' : 'C:\\…'} />
          </label>
        )}
        {def?.power && (
          <label style={{ fontSize: 11, color: '#888' }}>Countdown before it happens (s) — 0 = at once
            <input className="lf-no-spin" type="number" min={0} max={600} style={{ ...inp, marginTop: 4, width: 120 }} value={button.delay ?? 10}
              onChange={(e) => onChange({ ...button, delay: Math.max(0, Math.min(600, Math.round(Number(e.target.value) || 0))) })} />
          </label>
        )}
        <label style={{ fontSize: 11, color: '#888' }}>Name on the button
          <input style={{ ...inp, marginTop: 4 }} value={button.label} onChange={(e) => onChange({ ...button, label: e.target.value })} />
        </label>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 4 }}>
          <button onClick={onRemove} style={{ ...inp, width: 'auto', cursor: 'pointer', color: '#c66' }}>Remove</button>
          <button onClick={onClose} style={{ ...inp, width: 'auto', cursor: 'pointer', background: 'var(--lf-aqua)', color: '#000', fontWeight: 700, border: 'none' }}>Done</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
