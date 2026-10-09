import { pal } from '../../palette';
import React from 'react';
import type { GraphWidget, GraphPoint, SpeedMultiplier } from '../../../shared/types/project';

function speedLabel(m: SpeedMultiplier): string {
  if (m === 0.125) return '1/8';
  if (m === 0.25)  return '1/4';
  if (m === 0.5)   return '1/2';
  if (m === 1)     return '1x';
  if (m === 2)     return '2x';
  if (m === 4)     return '4x';
  return '8x';
}

function buildPath(points: GraphPoint[]): string {
  if (points.length < 2) return '';
  let d = `M ${points[0].x * 100} ${(1 - points[0].y) * 100}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i], p1 = points[i + 1];
    const x1 = p1.x * 100, y1 = (1 - p1.y) * 100;
    switch (p0.mode) {
      case 'linear': d += ` L ${x1} ${y1}`; break;
      case 'square': d += ` H ${x1} V ${y1}`; break;
      case 'bezier': {
        const cpr = p0.cpRight ?? [p0.x + (p1.x - p0.x) / 3, p0.y];
        const cpl = p1.cpLeft  ?? [p1.x - (p1.x - p0.x) / 3, p1.y];
        d += ` C ${cpr[0] * 100} ${(1 - cpr[1]) * 100} ${cpl[0] * 100} ${(1 - cpl[1]) * 100} ${x1} ${y1}`;
        break;
      }
    }
  }
  return d;
}

export default function GraphWidgetDesign({ widget }: { widget: GraphWidget }): React.JSX.Element {
  const { points, speedMultiplier, style } = widget;
  const color      = style.foregroundColor;
  const pathD      = buildPath(points);
  const firstPt    = points[0];
  const lastPt     = points[points.length - 1];
  const timingMode = widget.timingMode ?? 'bpm';
  const playMode   = widget.playMode   ?? 'loop';

  // Speed options for BPM mode
  const speedOpts = ([0.125, 0.25, 0.5, 1, 2, 4, 8] as const);

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', boxSizing: 'border-box', padding: 8, gap: 6 }}>

      {/* Controls row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
        <div style={{ ...pill, background: 'rgba(0,0,0,0.4)', color }}>▶</div>
        <div style={{ ...pill, background: 'rgba(0,0,0,0.25)', color: 'rgba(255,255,255,0.3)', fontSize: 9 }}>
          {playMode === 'loop' ? '↺' : '→|'}
        </div>
        <div style={{ ...pill, background: 'rgba(0,0,0,0.2)', color: 'rgba(255,255,255,0.2)', fontSize: 9, letterSpacing: '0.1em' }}>
          {timingMode === 'manual' ? `${widget.manualDuration ?? 4}s` : 'BPM'}
        </div>
        <div style={{ flex: 1 }} />
        {timingMode === 'bpm' && speedOpts.map((m) => (
          <div key={m} style={{
            ...pill, fontSize: 9,
            background: speedMultiplier === m ? color + '33' : 'rgba(0,0,0,0.25)',
            color:      speedMultiplier === m ? color          : 'rgba(255,255,255,0.3)',
          }}>
            {speedLabel(m)}
          </div>
        ))}
        {timingMode === 'manual' && (
          <div style={{ ...pill, fontSize: 9, background: 'rgba(0,0,0,0.25)', color: 'rgba(255,255,255,0.3)' }}>
            {widget.manualDuration ?? 4} sec
          </div>
        )}
      </div>

      {/* Curve area — relative container so HTML dot overlays work */}
      <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
        <svg
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block', pointerEvents: 'none' }}
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
        >
          {[25, 50, 75].map((v) => (
            <React.Fragment key={v}>
              <line x1={v} y1={0} x2={v} y2={100} stroke="rgba(255,255,255,0.06)" strokeWidth={0.5} vectorEffect="non-scaling-stroke" />
              <line x1={0} y1={v} x2={100} y2={v} stroke="rgba(255,255,255,0.06)" strokeWidth={0.5} vectorEffect="non-scaling-stroke" />
            </React.Fragment>
          ))}
          {pathD && (
            <path d={`${pathD} L ${lastPt.x * 100} 100 L ${firstPt.x * 100} 100 Z`} fill={color + '18'} />
          )}
          {pathD && (
            <path d={pathD} fill="none" stroke={color + 'cc'} strokeWidth={1.5}
              strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          )}
        </svg>

        {/* Dot overlays — fixed pixel size, same as live mode */}
        {points.map((p, i) => {
          const modeColor: Record<string, string> = { linear: color, bezier: pal('#abd9dc'), square: pal('#ff9b44') };
          const borderColor = modeColor[p.mode] ?? color;
          return (
            <div key={i} style={{
              position: 'absolute',
              left: `${p.x * 100}%`,
              top:  `${(1 - p.y) * 100}%`,
              width: 10, height: 10,
              transform: 'translate(-50%, -50%)',
              borderRadius: '50%',
              background: style.backgroundColor,
              border: `2px solid ${borderColor}`,
              pointerEvents: 'none',
              boxSizing: 'border-box',
            }} />
          );
        })}
      </div>

      {style.showLabel && (
        <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.2)', textAlign: 'center', flexShrink: 0, letterSpacing: '0.08em' }}>
          {points.length} pts · {timingMode === 'bpm' ? speedLabel(speedMultiplier) : `${widget.manualDuration ?? 4}s`} · {playMode}
        </div>
      )}
    </div>
  );
}

const pill: React.CSSProperties = {
  padding: '5px 9px', borderRadius: 3, fontSize: 12, fontWeight: 600,
  userSelect: 'none', whiteSpace: 'nowrap',
};
