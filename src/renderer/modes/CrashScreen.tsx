import { pal } from '../palette';
import React from 'react';
import { useStore } from '../store';
import { bridge } from '../ipc/bridge';

interface State { error: Error | null }

/**
 * Catches a render error in the mode content.
 *
 * Without a boundary React 18 unmounts the entire tree on a throw, leaving a
 * blank window with no way back and no way to rescue what was on screen. The
 * work itself is still in the store, so the first thing this offers is Save.
 *
 * It wraps only the mode content, not the whole app: the top bar stays alive,
 * so Save, page switching and Settings still work while the boundary is up.
 */
export default class CrashScreen extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    // Into the in-app log, so it is readable without opening devtools.
    useStore.getState().addLog('error', `crash: ${error.message}`);
    if (info.componentStack) {
      useStore.getState().addLog('error', info.componentStack.split('\n').slice(0, 4).join(' ').trim());
    }
  }

  render(): React.ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    const btn: React.CSSProperties = {
      borderRadius: 5, padding: '10px 18px', fontSize: 14,
      cursor: 'pointer', fontFamily: 'inherit',
    };

    return (
      <div style={{
        width: '100%', height: '100%',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'var(--color-bg, #0d0d0d)', padding: 24, boxSizing: 'border-box',
      }}>
        <div style={{ maxWidth: 640 }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: pal('#ffad66'), marginBottom: 10 }}>
            Something broke on this screen
          </div>
          <div style={{ fontSize: 14, color: '#b0b0b0', lineHeight: 1.55, marginBottom: 14 }}>
            Your project is still in memory and is being auto-saved. Save it to a
            file now, then go back to Config.
          </div>
          <pre style={{
            background: '#141414', border: '1px solid #2a2a2a', borderRadius: 5,
            padding: '10px 12px', fontSize: 12, color: pal('#e6a66f'),
            whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: '0 0 18px',
          }}>{error.message}</pre>
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              style={{ ...btn, background: `var(--color-accent, ${pal('#91ced2')})`, border: `1px solid var(--color-accent, ${pal('#91ced2')})`, color: '#000', fontWeight: 700 }}
              onClick={() => { bridge.invoke('tr:project:save', useStore.getState().project).catch(() => {}); }}
            >
              Save project
            </button>
            <button
              style={{ ...btn, background: 'none', border: '1px solid #3a3a3a', color: '#ccc' }}
              onClick={() => { useStore.getState().setMode('design'); this.setState({ error: null }); }}
            >
              Back to Config
            </button>
          </div>
        </div>
      </div>
    );
  }
}
