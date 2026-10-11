import React, { useState } from 'react';
import type { SketchWidget } from '../../../shared/types/project';
import { useStore } from '../../store';
import { builtinSketchPresets, makeBuiltin, userSketchPresets, saveUserSketchPresets } from './sketchPresets';

// Drawing presets: pick and Apply (replaces the drawing — Ctrl+Z brings it
// back), ＋ saves the current drawing as your own, 🗑 deletes one of yours.

const sel: React.CSSProperties = { flex: 1, minWidth: 0, background: '#111', border: '1px solid #2a2a2a', color: '#ccc', borderRadius: 3, padding: '4px 6px', fontSize: 12, fontFamily: 'inherit' };
const mini: React.CSSProperties = { height: 26, minWidth: 28, padding: '0 6px', flexShrink: 0, background: '#151515', border: '1px solid #2a2a2a', borderRadius: 3, color: '#bbb', cursor: 'pointer', fontSize: 13, fontFamily: 'inherit' };

export default function SketchPresetBar({ w, pageId }: { w: SketchWidget; pageId: string }): React.JSX.Element {
  const [id, setId] = useState('');
  const [, bump] = useState(0);
  const [naming, setNaming] = useState<string | null>(null);
  const mine = userSketchPresets();
  const isMine = id.startsWith('u:');
  const apply = () => {
    if (!id) return;
    const strokes = isMine ? JSON.parse(JSON.stringify(mine.find((p) => `u:${p.id}` === id)?.strokes ?? [])) : makeBuiltin(id.slice(2));
    const st = useStore.getState();
    st.captureHistory();
    st.updateWidget(pageId, w.id, { strokes } as never);
  };
  const saveAs = (name: string) => {
    const p = { id: Date.now().toString(36), name: name.trim() || `Drawing ${mine.length + 1}`, strokes: JSON.parse(JSON.stringify(w.strokes ?? [])) };
    saveUserSketchPresets([...mine, p]); setId(`u:${p.id}`); setNaming(null); bump((x) => x + 1);
  };
  if (naming !== null) {
    return (
      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
        <input autoFocus onFocus={(e) => e.currentTarget.select()} style={sel} value={naming} onChange={(e) => setNaming(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') saveAs(naming); if (e.key === 'Escape') setNaming(null); }} placeholder="Name of the drawing" />
        <button style={{ ...mini, color: 'var(--lf-aqua)' }} onClick={() => saveAs(naming)}>Save</button>
        <button style={mini} onClick={() => setNaming(null)}>✕</button>
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
      <select style={sel} value={id} onChange={(e) => setId(e.target.value)}>
        <option value="">— drawing —</option>
        <optgroup label="Built-in">
          {builtinSketchPresets().map((p) => <option key={p.id} value={`b:${p.id}`}>{p.name}</option>)}
        </optgroup>
        {mine.length > 0 && (
          <optgroup label="My drawings">
            {mine.map((p) => <option key={p.id} value={`u:${p.id}`}>{p.name}</option>)}
          </optgroup>
        )}
      </select>
      <button style={{ ...mini, color: id ? 'var(--lf-aqua)' : '#555' }} disabled={!id} onClick={apply} title="Replace the drawing with this one (Ctrl+Z to undo)">Apply</button>
      <button style={mini} title="Save the current drawing as a preset" disabled={!(w.strokes ?? []).length} onClick={() => setNaming(`Drawing ${mine.length + 1}`)}>＋</button>
      <button style={{ ...mini, color: isMine ? '#c66' : '#444' }} disabled={!isMine} title="Delete this saved drawing"
        onClick={() => { saveUserSketchPresets(mine.filter((p) => `u:${p.id}` !== id)); setId(''); bump((x) => x + 1); }}>🗑</button>
    </div>
  );
}
