import React from 'react';
import type { MathWidget } from '../../../shared/types/project';
import { pal } from '../../palette';
import { opSymbol } from './mathOps';

export default function MathWidgetDesign({ widget }: { widget: MathWidget }): React.JSX.Element {
  const color = widget.style.foregroundColor;
  const fs = widget.style.fontSize || 12;
  const gain = widget.gain ?? 1;
  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', gap: 8, padding: 8, boxSizing: 'border-box', fontFamily: 'monospace' }}>
      <div style={{ flex: 1, minWidth: 0, border: `2px dashed ${pal('#67bbc1')}88`, borderRadius: 6, padding: 6, background: 'rgba(103,187,193,0.05)', display: 'flex', flexDirection: 'column', gap: 3, overflow: 'hidden' }}>
        <div style={{ fontSize: Math.max(9, fs - 3), color: '#777', letterSpacing: 1 }}>IN · any number</div>
        <div style={{ fontSize: Math.max(9, fs - 3), color: '#555', lineHeight: 1.4 }}>Shift-drag cables here in Live</div>
      </div>
      <div style={{ width: 70, display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ fontSize: 18, color, fontWeight: 700 }}>{opSymbol(widget.operation)}</span>
        {gain !== 1 && <span style={{ fontSize: 11, color: '#555' }}>× {gain}</span>}
        <span style={{ fontSize: 9, color: '#444', textAlign: 'center' }}>{widget.inMin ?? 0}–{widget.inMax ?? 1} → {widget.outMin ?? 0}–{widget.outMax ?? 1}</span>
      </div>
    </div>
  );
}
