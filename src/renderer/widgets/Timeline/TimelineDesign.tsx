import { pal } from '../../palette';
import React from 'react';
import type { TimelineWidget, ValueTrack, ColorTrack } from '../../../shared/types/project';

const TRACK_H = 22;

function trackColor(kind: string): string {
  if (kind === 'value') return pal('#367f84');
  if (kind === 'color') return pal('#6d3d13');
  return pal('#2a4d50');
}

function trackIcon(kind: string): string {
  if (kind === 'value') return '◆';
  if (kind === 'color') return '●';
  return '♪';
}

export default function TimelineDesign({ widget }: { widget: TimelineWidget }): React.JSX.Element {
  const hasTrack = widget.tracks.length > 0;

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#080808' }}>
      {/* Header bar */}
      <div style={{ flexShrink: 0, height: 22, display: 'flex', alignItems: 'center', gap: 6, padding: '0 8px', borderBottom: '1px solid #1a1a1a' }}>
        <span style={{ fontSize: 9, color: '#333' }}>▶</span>
        <span style={{ fontSize: 9, color: '#333' }}>■</span>
        <span style={{ fontSize: 9, color: '#444', flex: 1, textAlign: 'center', letterSpacing: '0.06em' }}>TIMELINE</span>
        <span style={{ fontSize: 9, color: '#2a2a2a' }}>{widget.duration}s</span>
      </div>

      {/* Body */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Left track labels */}
        <div style={{ width: 80, flexShrink: 0, borderRight: '1px solid #141414', overflowY: 'hidden' }}>
          {widget.tracks.slice(0, 6).map((t) => (
            <div key={t.id} style={{ height: TRACK_H, display: 'flex', alignItems: 'center', gap: 4, padding: '0 6px', borderBottom: '1px solid #101010' }}>
              <span style={{ fontSize: 8, color: trackColor(t.kind) }}>{trackIcon(t.kind)}</span>
              <span style={{ fontSize: 9, color: '#444', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{t.label}</span>
            </div>
          ))}
          {!hasTrack && (
            <div style={{ height: TRACK_H, display: 'flex', alignItems: 'center', padding: '0 6px' }}>
              <span style={{ fontSize: 9, color: '#222' }}>No tracks</span>
            </div>
          )}
        </div>

        {/* Timeline area */}
        <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
          {widget.tracks.slice(0, 6).map((t) => {
            const kfs = t.kind !== 'sound' ? (t as ValueTrack | ColorTrack).keyframes : [];
            const bg = t.kind === 'color'
              ? `linear-gradient(to right, ${(t as ColorTrack).keyframes.slice(0, 4).map((k) => `${k.color} ${(k.time * 100).toFixed(0)}%`).join(', ') || '#111'})`
              : 'transparent';
            return (
              <div key={t.id} style={{ height: TRACK_H, borderBottom: '1px solid #101010', position: 'relative', background: bg, overflow: 'hidden' }}>
                {t.kind === 'value' && kfs.length >= 2 && (
                  <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} preserveAspectRatio="none" viewBox="0 0 100 100">
                    <polyline
                      points={(kfs as ValueTrack['keyframes']).map((k) => `${k.time * 100},${(1 - k.value) * 100}`).join(' ')}
                      fill="none" stroke={(t as ValueTrack).color} strokeWidth={2} vectorEffect="non-scaling-stroke" />
                  </svg>
                )}
                {kfs.map((k) => (
                  <div key={k.id} style={{
                    position: 'absolute', top: '50%', transform: 'translateY(-50%)',
                    left: `${k.time * 100}%`,
                    width: 4, height: 4, borderRadius: '50%',
                    background: t.kind === 'value' ? (t as ValueTrack).color : 'white',
                    marginLeft: -2,
                  }} />
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
