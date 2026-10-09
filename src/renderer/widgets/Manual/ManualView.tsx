import { pal } from '../../palette';
import React, { useState } from 'react';
import type { ManualWidget } from '../../../shared/types/project';
import { SETTINGS_ENTRIES, WIDGET_ENTRIES, type ManualEntry } from './manualContent';

const ALL_ENTRIES = [...SETTINGS_ENTRIES, ...WIDGET_ENTRIES];

// Everything is sized off `em` against a single root font-size, so the whole
// manual scales with the widget rect (and with the Text size parameter) instead
// of needing a separate layout per size.
export default function ManualView({ widget, interactive }: {
  widget: ManualWidget;
  interactive: boolean;
}): React.JSX.Element {
  const [tabId, setTabId] = useState<string>(widget.openTab ?? SETTINGS_ENTRIES[0].id);
  const entry: ManualEntry =
    ALL_ENTRIES.find((e) => e.id === tabId) ?? SETTINGS_ENTRIES[0];

  const scale = widget.fontScale ?? 1;
  const fg = widget.style.foregroundColor;

  function TabRow({ entries, accent }: { entries: ManualEntry[]; accent: string }) {
    return (
      <div style={{
        display: 'flex', flexWrap: 'wrap', gap: '0.25em',
        padding: '0.3em 0.4em',
        flexShrink: 0,
      }}>
        {entries.map((e) => {
          const on = e.id === entry.id;
          return (
            <button
              key={e.id}
              onClick={() => { if (interactive) setTabId(e.id); }}
              style={{
                fontFamily: 'inherit', fontSize: '0.85em',
                padding: '0.35em 0.7em', borderRadius: '0.3em',
                cursor: interactive ? 'pointer' : 'default',
                whiteSpace: 'nowrap',
                background: on ? accent : 'rgba(255,255,255,0.04)',
                color: on ? '#000' : '#9a9a9a',
                border: `1px solid ${on ? accent : 'rgba(255,255,255,0.10)'}`,
                fontWeight: on ? 700 : 400,
                touchAction: 'manipulation',
              }}
            >
              {e.tab}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div style={{
      width: '100%', height: '100%',
      display: 'flex', flexDirection: 'column',
      boxSizing: 'border-box', overflow: 'hidden',
      fontFamily: 'monospace',
      fontSize: `${14 * scale}px`,
      color: '#c8c8c8',
    }}>
      <TabRow entries={SETTINGS_ENTRIES} accent={fg} />
      <div style={{ height: 1, background: 'rgba(255,255,255,0.10)', flexShrink: 0 }} />
      <TabRow entries={WIDGET_ENTRIES} accent={pal('#91ced2')} />
      <div style={{ height: 1, background: 'rgba(255,255,255,0.16)', flexShrink: 0 }} />

      <div style={{
        flex: 1, minHeight: 0, overflowY: 'auto',
        padding: '0.9em 1.1em',
      }}>
        <div style={{
          fontSize: '1.25em', fontWeight: 700, color: fg,
          letterSpacing: '0.04em', marginBottom: '0.35em',
        }}>
          {entry.title}
        </div>
        <div style={{ color: '#8f8f8f', lineHeight: 1.5, marginBottom: '0.9em' }}>
          {entry.intro}
        </div>

        {entry.items.map(([name, text], i) => (
          <div
            key={i}
            style={{
              display: 'flex', gap: '0.9em',
              padding: '0.45em 0',
              borderTop: i === 0 ? undefined : '1px solid rgba(255,255,255,0.06)',
            }}
          >
            <div style={{
              flex: '0 0 34%', minWidth: 0,
              color: '#e0e0e0', fontWeight: 700, wordBreak: 'break-word',
            }}>
              {name}
            </div>
            <div style={{ flex: 1, minWidth: 0, color: '#9a9a9a', lineHeight: 1.5 }}>
              {text}
            </div>
          </div>
        ))}

        {entry.note && (
          <div style={{
            marginTop: '1em', padding: '0.6em 0.8em',
            borderLeft: `0.2em solid ${fg}`,
            background: 'rgba(255,255,255,0.03)',
            color: '#a8a8a8', lineHeight: 1.5, fontSize: '0.95em',
          }}>
            {entry.note}
          </div>
        )}
      </div>
    </div>
  );
}
