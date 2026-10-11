import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import type { SliderBankWidget, KnobBankWidget, ButtonGridWidget } from '../../../shared/types/project';
import { useStore } from '../../store';
import { presetsFor, userPresets, saveUserPresets, applyPreset, presetFromWidget, type CellPreset, type PresetProtocol } from './presets';

// Preset row for sliders / knobs / buttons: pick one and Apply, or ＋ (new from
// this widget), ✎ (edit — a built-in one is edited as a copy), 🗑 (delete yours).

type Bank = SliderBankWidget | KnobBankWidget | ButtonGridWidget;

const sel: React.CSSProperties = {
  flex: 1, minWidth: 0, background: '#111', border: '1px solid #2a2a2a', color: '#ccc', borderRadius: 3,
  padding: '4px 6px', fontSize: 12, fontFamily: 'inherit',
};
const mini: React.CSSProperties = {
  width: 28, height: 26, padding: 0, flexShrink: 0, background: '#151515', border: '1px solid #2a2a2a', borderRadius: 3,
  color: '#bbb', cursor: 'pointer', fontSize: 13, fontFamily: 'inherit',
};

export default function PresetBar({ w, pageId }: { w: Bank; pageId: string }): React.JSX.Element {
  const [, bump] = useState(0);
  const list = presetsFor(w.kind);
  const [selId, setSelId] = useState<string>('');
  const [editing, setEditing] = useState<CellPreset | null>(null);
  const cur = list.find((p) => p.id === selId) ?? null;
  const groups = [...new Set(list.map((p) => p.group))];

  const apply = (p: CellPreset) => {
    const st = useStore.getState();
    st.captureHistory();
    st.updateWidget(pageId, w.id, applyPreset(w, p) as never);
  };
  const saveUser = (p: CellPreset) => {
    const mine = userPresets().filter((x) => x.id !== p.id);
    saveUserPresets([...mine, { ...p, builtin: false, group: 'My presets' }]);
    setSelId(p.id); bump((n) => n + 1);
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
        <select style={sel} value={selId} onChange={(e) => setSelId(e.target.value)}>
          <option value="">— preset —</option>
          {groups.map((g) => (
            <optgroup key={g} label={g}>
              {list.filter((p) => p.group === g).map((p) => <option key={p.id} value={p.id}>{p.name} ({p.cells.length})</option>)}
            </optgroup>
          ))}
        </select>
        <button style={{ ...mini, width: 'auto', padding: '0 8px', color: cur ? 'var(--lf-aqua)' : '#555' }} disabled={!cur}
          title="Apply: sets the number of cells, names and where each one sends" onClick={() => cur && apply(cur)}>Apply</button>
        <button style={mini} title="New preset from this widget" onClick={() => {
          const p = presetFromWidget(w, w.label || 'My preset');
          if (p) setEditing(p);
        }}>＋</button>
        <button style={{ ...mini, color: cur ? '#bbb' : '#444' }} disabled={!cur}
          title={cur?.builtin ? 'Edit a copy of this built-in preset' : 'Edit preset'}
          onClick={() => cur && setEditing(cur.builtin ? { ...JSON.parse(JSON.stringify(cur)), id: `u-${Date.now().toString(36)}`, name: `${cur.name} (copy)`, builtin: false } : JSON.parse(JSON.stringify(cur)))}>✎</button>
        <button style={{ ...mini, color: cur && !cur.builtin ? '#c66' : '#444' }} disabled={!cur || cur.builtin}
          title={cur?.builtin ? 'Built-in presets cannot be deleted' : 'Delete preset'}
          onClick={() => { if (!cur || cur.builtin) return; saveUserPresets(userPresets().filter((x) => x.id !== cur.id)); setSelId(''); bump((n) => n + 1); }}>🗑</button>
      </div>
      {cur?.note && <div style={{ fontSize: 11, color: '#888', marginTop: 4, lineHeight: 1.4 }}>{cur.note}</div>}
      {editing && <PresetEditor preset={editing} onCancel={() => setEditing(null)}
        onSave={(p, andApply) => { saveUser(p); setEditing(null); if (andApply) apply(p); }} />}
    </div>
  );
}

function PresetEditor({ preset, onCancel, onSave }: { preset: CellPreset; onCancel: () => void; onSave: (p: CellPreset, apply: boolean) => void }): React.JSX.Element {
  const [p, setP] = useState<CellPreset>(preset);
  const [pattern, setPattern] = useState('/{name}');
  const set = (patch: Partial<CellPreset>) => setP((x) => ({ ...x, ...patch }));
  const setCell = (i: number, patch: Partial<{ label: string; target: string }>) => set({ cells: p.cells.map((c, j) => (j === i ? { ...c, ...patch } : c)) });
  const targetHint = p.protocol === 'osc' ? 'OSC address' : p.protocol === 'midi' ? 'CC number' : 'DMX channel';
  const inp: React.CSSProperties = { ...sel, flex: undefined, width: '100%', boxSizing: 'border-box' };

  return createPortal(
    <div onPointerDown={onCancel} style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div onPointerDown={(e) => e.stopPropagation()} onKeyDown={(e) => { if (e.key === 'Escape') onCancel(); }}
        style={{ background: '#141414', border: '1px solid #333', borderRadius: 6, padding: 18, width: 560, maxHeight: '86vh', display: 'flex', flexDirection: 'column', gap: 10, color: '#ddd', fontFamily: 'inherit' }}>
        <div style={{ fontSize: 14, fontWeight: 700 }}>Preset</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input style={{ ...inp, flex: 2 }} value={p.name} onChange={(e) => set({ name: e.target.value })} placeholder="Name" />
          <select style={{ ...inp, flex: 1 }} value={p.protocol} onChange={(e) => set({ protocol: e.target.value as PresetProtocol })}>
            <option value="osc">OSC</option><option value="artnet">Art-Net</option><option value="sacn">sACN</option><option value="midi">MIDI CC</option>
          </select>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, color: '#999' }}>
          {(p.protocol === 'artnet' || p.protocol === 'sacn') && <>Universe <input style={{ ...inp, width: 70 }} value={p.universe ?? (p.protocol === 'sacn' ? 1 : 0)} onChange={(e) => set({ universe: Number(e.target.value) || 0 })} /></>}
          {p.protocol === 'midi' && <>Channel <input style={{ ...inp, width: 60 }} value={p.midiChannel ?? 1} onChange={(e) => set({ midiChannel: Math.max(1, Math.min(16, Number(e.target.value) || 1)) })} /></>}
          {p.protocol === 'osc' && <>Range <input style={{ ...inp, width: 64 }} value={p.min ?? 0} onChange={(e) => set({ min: Number(e.target.value) || 0 })} /> – <input style={{ ...inp, width: 64 }} value={p.max ?? 1} onChange={(e) => set({ max: Number(e.target.value) || 0 })} /></>}
        </div>
        {p.protocol === 'osc' && (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, color: '#999' }}>
            All addresses from the names:
            <input style={{ ...inp, flex: 1, width: undefined }} value={pattern} onChange={(e) => setPattern(e.target.value)} title="{name} = the cell name, {n} = its number" />
            <button style={{ ...mini, width: 'auto', padding: '0 8px' }} onClick={() => set({ cells: p.cells.map((c, i) => ({ ...c, target: pattern.replace(/\{name\}/g, c.label).replace(/\{n\}/g, String(i + 1)) })) })}>Fill</button>
          </div>
        )}
        <div style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4, minHeight: 80 }}>
          {p.cells.map((c, i) => (
            <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <span style={{ width: 22, fontSize: 11, color: '#666', textAlign: 'right' }}>{i + 1}</span>
              <input style={{ ...inp, flex: 1 }} value={c.label} placeholder="Name" onChange={(e) => setCell(i, { label: e.target.value })} />
              <input style={{ ...inp, flex: 2 }} value={c.target} placeholder={targetHint} onChange={(e) => setCell(i, { target: e.target.value })} />
              <button style={mini} title="Remove" onClick={() => set({ cells: p.cells.filter((_, j) => j !== i) })}>✕</button>
            </div>
          ))}
        </div>
        <button style={{ ...mini, width: '100%', color: 'var(--lf-aqua)' }} onClick={() => {
          const last = p.cells[p.cells.length - 1];
          const next = p.protocol === 'osc' ? '' : String((Number(last?.target) || 0) + 1);
          set({ cells: [...p.cells, { label: `${p.cells.length + 1}`, target: next }] });
        }}>＋ Add cell</button>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button style={{ ...mini, width: 'auto', padding: '0 14px' }} onClick={onCancel}>Cancel</button>
          <button style={{ ...mini, width: 'auto', padding: '0 14px' }} onClick={() => onSave(p, false)}>Save</button>
          <button style={{ ...mini, width: 'auto', padding: '0 14px', background: 'var(--lf-orange)', color: '#000', border: 'none', fontWeight: 700 }} onClick={() => onSave(p, true)}>Save and apply</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
