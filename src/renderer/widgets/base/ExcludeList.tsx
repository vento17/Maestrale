import React from 'react';

// "Everything except…": a short list of widgets to leave out, one per row,
// with ＋ to add another. Used by Cues and Submasters, in Design and in Live —
// so excluding two widgets never means picking all the others one by one.
export default function ExcludeList({ options, value, onChange, compact }: {
  options: { id: string; label: string }[];   // what could be excluded
  value: string[];
  onChange: (ids: string[]) => void;
  compact?: boolean;                           // the Live right bar
}): React.JSX.Element {
  const inp: React.CSSProperties = {
    flex: 1, minWidth: 0, background: compact ? '#1a1a1a' : 'var(--color-surface-2, #111)',
    border: '1px solid #2a2a2a', color: '#bbb', borderRadius: 3, padding: '3px 6px', fontSize: compact ? 11 : 12, fontFamily: 'inherit',
  };
  const free = options.filter((o) => !value.includes(o.id));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {value.map((id, i) => {
        const known = options.find((o) => o.id === id);
        return (
          <div key={i} style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: '#888', width: 14, textAlign: 'center' }}>−</span>
            <select style={inp} value={id} onChange={(e) => onChange(value.map((v, j) => (j === i ? e.target.value : v)))}>
              {!known && <option value={id}>[deleted]</option>}
              {known && <option value={id}>{known.label}</option>}
              {free.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
            <button title="Stop excluding it" onClick={() => onChange(value.filter((_, j) => j !== i))}
              style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', fontSize: 15, padding: '0 2px', lineHeight: 1 }}>×</button>
          </div>
        );
      })}
      <button disabled={!free.length} onClick={() => free[0] && onChange([...value, free[0].id])}
        style={{
          padding: '4px 0', fontSize: compact ? 11 : 12, borderRadius: 3, cursor: free.length ? 'pointer' : 'default', fontFamily: 'inherit',
          background: 'transparent', border: '1px dashed #333', color: free.length ? 'var(--lf-orange)' : '#444',
        }}>＋ Exclude {value.length ? 'another' : 'a widget'}</button>
    </div>
  );
}
