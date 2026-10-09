import React from 'react';

// Router icon: eight short arrows radiating from a dot. The heads are small and
// sit well apart, so they never touch and close into a ring (that read as a
// ship's wheel).
export function ChaosIcon({ size = 18, color = 'currentColor' }: { size?: number; color?: string }): React.JSX.Element {
  return (
    <svg width={size} height={size} viewBox="-12.5 -12.5 25 25" style={{ display: 'block' }}>
      <circle r={1.8} fill={color} />
      {Array.from({ length: 8 }, (_, i) => (
        <g key={i} transform={`rotate(${i * 45})`}>
          <line x1={0} y1={-3.6} x2={0} y2={-10.3} stroke={color} strokeWidth={1.5} strokeLinecap="round" />
          <path d="M -1.7 -7.9 L 0 -10.5 L 1.7 -7.9" fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
        </g>
      ))}
    </svg>
  );
}
