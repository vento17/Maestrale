import { pal } from '../../palette';
import React from 'react';
import type { DmxRecorderWidget } from '../../../shared/types/project';

// Static design-mode preview.
export default function DmxRecorderDesign({ widget }: { widget: DmxRecorderWidget }): React.JSX.Element {
  const fs = widget.style.fontSize || 14;
  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', gap: 6, padding: 8, boxSizing: 'border-box', fontFamily: 'monospace' }}>
      <div style={{ fontSize: Math.max(9, fs - 4), color: '#8a8a8a', letterSpacing: 2, textTransform: 'uppercase' }}>{widget.label}</div>
      <div style={{
        flex: 1, borderRadius: 6, border: `1px solid ${pal('#3e2d1e')}`, background: 'rgba(0,0,0,0.45)', color: pal('#e07f2b'),
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, fontSize: fs + 4, fontWeight: 700, letterSpacing: 2,
      }}><span style={{ fontSize: fs + 8 }}>●</span>REC</div>
      <div style={{ fontSize: Math.max(9, fs - 4), color: '#666' }}>{widget.universes ? `universes ${widget.universes}` : 'all universes'}</div>
    </div>
  );
}
