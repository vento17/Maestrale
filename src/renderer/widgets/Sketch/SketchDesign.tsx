import React from 'react';
import type { SketchWidget } from '../../../shared/types/project';

// Design preview: the drawing, scaled to the widget.
export default function SketchDesign({ widget }: { widget: SketchWidget }): React.JSX.Element {
  const color = widget.style.foregroundColor;
  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', fontFamily: 'monospace' }}>
      <div style={{ padding: '4px 6px', fontSize: 9, fontWeight: 700, letterSpacing: 2, color: '#505050', borderBottom: '1px solid #1e1e1e' }}>
        ◈ SKETCH <span style={{ fontWeight: 400, letterSpacing: 0 }}>· {widget.dots || 1}● · {widget.duration}s{widget.loop ? ' ⟳' : ''}</span>
      </div>
      <div style={{ flex: 1, position: 'relative' }}>
        {widget.showGrid && (
          <div style={{ position: 'absolute', inset: 0, backgroundImage: `linear-gradient(${color}22 1px, transparent 1px), linear-gradient(90deg, ${color}22 1px, transparent 1px)`, backgroundSize: '25% 25%' }} />
        )}
        <svg viewBox="0 0 1 1" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
          {(widget.strokes ?? []).map((s) => (
            <polyline key={s.id} points={s.pts.reduce<string[]>((a, v, i) => (i % 2 ? (a[a.length - 1] += `,${v}`, a) : [...a, String(v)]), []).join(' ')}
              fill="none" stroke={color} strokeOpacity={0.6} strokeWidth={2} vectorEffect="non-scaling-stroke" />
          ))}
        </svg>
      </div>
    </div>
  );
}
