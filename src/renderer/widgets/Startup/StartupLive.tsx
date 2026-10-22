import React from 'react';
import type { StartupWidget } from '../../../shared/types/project';
import { useWidgetRuntime } from '../../store';
import { pal } from '../../palette';
import { armedAt, firedAt, fireStartupTrigger, rearmStartup, useStartupState } from './startupRun';

// Startup: one row per trigger — its name, its delay, and where it stands
// (waiting with a countdown, fired, or idle). Tap a row: fire it now. ↺ arms
// the whole widget again. Each row is an output cell (orange dot on the right).

export default function StartupLive({ widget, preview = false }: { widget: StartupWidget; preview?: boolean }): React.JSX.Element {
  useStartupState();
  const rt = useWidgetRuntime(widget.id);
  const fs = widget.style.fontSize || 14;
  const color = widget.style.foregroundColor || pal('#4fb8ab');
  const now = Date.now();
  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', gap: 4, padding: 6, boxSizing: 'border-box', fontFamily: 'inherit', pointerEvents: preview ? 'none' : undefined }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
        <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: 2, color: '#505050', textTransform: 'uppercase', flex: 1 }}>▶ startup{widget.everyLive ? ' · every live' : ''}</span>
        <button onClick={() => rearmStartup(widget)} title="Arm every trigger again, from now"
          style={{ height: 20, padding: '0 8px', borderRadius: 3, border: '1px solid #333', background: 'transparent', color: '#888', cursor: 'pointer', fontSize: 12, lineHeight: '18px' }}>↺</button>
      </div>
      <div className="lf-scroll" style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 3 }}>
        {widget.triggers.map((t, i) => {
          const at = armedAt(widget.id, t.id);
          const last = firedAt(widget.id, t.id);
          const on = (rt?.cells[i]?.value ?? 0) >= 0.5;
          const waiting = at !== undefined && at > now;
          const left = waiting ? Math.max(0, Math.ceil((at - now) / 1000)) : 0;
          const done = !waiting && last !== undefined;
          return (
            <div key={t.id} data-lf-widget={widget.id} data-lf-cell={i}
              onClick={() => fireStartupTrigger(widget, i)}
              title={`${t.label} · ${t.delay} s after start — tap: fire now`}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px', borderRadius: 4, cursor: 'pointer', flexShrink: 0,
                background: on ? color : waiting ? `rgba(255,170,60,0.12)` : '#141414',
                border: `1px solid ${on ? color : waiting ? pal('#ffaa3c') : done ? color : '#2a2a2a'}`,
                color: on ? '#000' : '#ddd', minHeight: Math.max(22, fs + 10),
              }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: on ? '#000' : waiting ? pal('#ffaa3c') : done ? color : '#333' }} />
              <span style={{ flex: 1, fontSize: fs, fontWeight: 700, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{t.label || `trigger ${i + 1}`}</span>
              <span style={{ fontSize: Math.max(9, fs - 4), opacity: 0.7, fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
                {waiting ? `in ${left} s` : done ? '✓' : `+${t.delay} s`}
              </span>
            </div>
          );
        })}
        {widget.triggers.length === 0 && <div style={{ fontSize: 10, color: '#444', padding: 6 }}>No triggers — add them in the settings.</div>}
      </div>
    </div>
  );
}
