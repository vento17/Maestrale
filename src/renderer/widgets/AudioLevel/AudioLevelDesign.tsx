import React from 'react';
import type { AudioLevelWidget } from '../../../shared/types/project';

// Design preview: which mode, and the bar.
export default function AudioLevelDesign({ widget }: { widget: AudioLevelWidget }): React.JSX.Element {
  const vertical = (widget.orientation ?? 'vertical') === 'vertical';
  const color = widget.style.foregroundColor;
  const isIn = widget.mode === 'in';
  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', padding: 8, boxSizing: 'border-box', gap: 6, fontFamily: 'monospace' }}>
      <div style={{ textAlign: 'center', fontWeight: 700, letterSpacing: 2, fontSize: 10, color: '#8a8a8a', textTransform: 'uppercase' }}>{isIn ? 'audio in' : 'audio out'}</div>
      <div style={{ flex: 1, position: 'relative', background: 'rgba(0,0,0,0.4)', borderRadius: 4, overflow: 'hidden' }}>
        <div style={{
          position: 'absolute', background: color, opacity: 0.45,
          ...(vertical ? { bottom: 0, left: 0, right: 0, height: isIn ? '45%' : '100%' } : { left: 0, top: 0, bottom: 0, width: isIn ? '45%' : '100%' }),
        }} />
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: '#ccc' }}>
          {isIn ? 'meter' : 'master'}
        </div>
      </div>
    </div>
  );
}
