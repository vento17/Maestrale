import { pal, onPalette } from '../palette';
import React, { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { bridge } from '../ipc/bridge';
import type { LogLevel } from '../store/appSlice';
import { GLOBAL_BAR_HEIGHT } from './GlobalBar';

// LOG in the top bar, last of the status badges: lit when all is well, red
// with the count when there are errors you have not seen. Click: log opens
// right under the bar.
export function LogBadge(): React.JSX.Element {
  const open = useStore((s) => s.logOpen);
  const unseen = useStore((s) => s.unseenErrors);
  const setLogOpen = useStore((s) => s.setLogOpen);
  const bad = unseen > 0;
  return (
    <button
      title={bad ? `${unseen} new error(s) — open the log` : 'Log — all fine'}
      onClick={() => setLogOpen(!open)}
      style={{
        fontSize: 11, fontWeight: 700, letterSpacing: 1, fontFamily: 'monospace', cursor: 'pointer',
        height: 20, padding: '0 8px', lineHeight: 1, whiteSpace: 'nowrap',
        background: 'none', border: 'none',
        color: bad ? '#ff4a42' : '#e8e8e8',
        textDecoration: open ? 'underline' : 'none', textUnderlineOffset: 4,
        textShadow: bad ? '0 0 8px rgba(255,60,50,0.7)' : 'none',
      }}
    >{bad ? `Log ${unseen}` : 'Log'}</button>
  );
}

// Install global error capture exactly once (survives component remounts).
let installed = false;
function installCapture(): void {
  if (installed) return;
  installed = true;
  const log = (level: LogLevel, msg: string) => {
    try { useStore.getState().addLog(level, msg); } catch { /* ignore */ }
  };

  window.addEventListener('error', (e) => log('error', e.message || String(e.error ?? 'error')));
  window.addEventListener('unhandledrejection', (e) => log('error', `Unhandled: ${String(e.reason)}`));

  const wrap = (level: LogLevel, orig: (...a: unknown[]) => void) => (...args: unknown[]) => {
    orig(...args);
    log(level, args.map((a) => (typeof a === 'string' ? a : safeStringify(a))).join(' '));
  };
  // eslint-disable-next-line no-console
  console.error = wrap('error', console.error.bind(console));
  // eslint-disable-next-line no-console
  console.warn  = wrap('warn',  console.warn.bind(console));
}

function safeStringify(v: unknown): string {
  if (v instanceof Error) return v.message;
  try { return JSON.stringify(v); } catch { return String(v); }
}

const make_LEVEL_COLOR = (): Record<LogLevel, string> => ({
  error: '#ff5c5c', warn: pal('#ff8a1f'), info: pal('#8fd3d6'),
});
let LEVEL_COLOR: Record<LogLevel, string> = make_LEVEL_COLOR();
onPalette(() => { LEVEL_COLOR = make_LEVEL_COLOR(); });

export default function LogConsole(): React.JSX.Element {
  useEffect(() => { installCapture(); }, []);

  // The Spout/NDI sidecar runs in the main process, where its output is
  // invisible in a packaged build. Surface it here so "stream unavailable"
  // comes with a reason — a missing NDI runtime, a numpy/Pillow mismatch.
  useEffect(() => bridge.on('tr:sidecar:log', ({ level, text }) => {
    useStore.getState().addLog(level === 'error' ? 'error' : 'info', `[sidecar] ${text}`);
  }), []);

  const entries      = useStore((s) => s.logEntries);
  const open         = useStore((s) => s.logOpen);
  const setLogOpen   = useStore((s) => s.setLogOpen);
  const clearLog     = useStore((s) => s.clearLog);

  const [errorsOnly, setErrorsOnly] = useState(false);
  const [copied, setCopied] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  const shown = errorsOnly ? entries.filter((e) => e.level === 'error') : entries;

  // Auto-scroll to newest when open.
  useEffect(() => {
    if (open && listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [open, entries.length]);

  const copyAll = () => {
    const text = shown.map((e) => `[${new Date(e.time).toLocaleTimeString()}] ${e.level.toUpperCase()}  ${e.message}`).join('\n');
    const done = () => { setCopied(true); setTimeout(() => setCopied(false), 1200); };
    // Fallback for Electron where navigator.clipboard can silently fail.
    const fallback = () => {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.top = '0';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        done();
      } catch { /* ignore */ }
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(fallback);
    } else {
      fallback();
    }
  };

  return (
    <>
      {open && (
        <div style={{
          // Always drops down under the top bar, from the LOG badge.
          position: 'fixed', right: 8, top: GLOBAL_BAR_HEIGHT + 4, zIndex: 1200,
          width: 'min(900px, calc(100vw - 16px))',
          height: 260, background: '#0d0d0d', border: '1px solid #2a2a2a',
          borderRadius: 6, boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          fontFamily: 'monospace',
        }}>
          {/* Toolbar */}
          <div style={{
            flexShrink: 0, height: 30, display: 'flex', alignItems: 'center', gap: 6,
            padding: '0 8px', borderBottom: '1px solid #222', fontSize: 11,
          }}>
            <span style={{ color: '#888', fontWeight: 700, letterSpacing: 1 }}>LOG</span>
            <span style={{ color: '#555' }}>{shown.length}</span>
            <div style={{ flex: 1 }} />
            <button style={logBtn(errorsOnly)} onClick={() => setErrorsOnly((v) => !v)}>errors only</button>
            <button style={logBtn(false)} onClick={copyAll}>{copied ? 'copied' : 'copy'}</button>
            <button style={logBtn(false)} onClick={clearLog}>clear</button>
            <button style={logBtn(false)} onClick={() => setLogOpen(false)}>✕</button>
          </div>

          {/* Entries */}
          <div ref={listRef} style={{ flex: 1, overflowY: 'auto', padding: '4px 8px', userSelect: 'text', WebkitUserSelect: 'text', cursor: 'text' }}>
            {shown.length === 0 ? (
              <div style={{ color: '#444', fontSize: 11, padding: 6 }}>no entries</div>
            ) : shown.map((e) => (
              <div key={e.id} style={{ display: 'flex', gap: 8, fontSize: 11, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                <span style={{ color: '#555', flexShrink: 0 }}>{new Date(e.time).toLocaleTimeString()}</span>
                <span style={{ color: LEVEL_COLOR[e.level], flexShrink: 0, width: 38 }}>{e.level}</span>
                <span style={{ color: '#ccc' }}>{e.message}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

function logBtn(active: boolean): React.CSSProperties {
  return {
    background: active ? '#333' : 'rgba(255,255,255,0.05)',
    border: '1px solid #333', color: active ? '#fff' : '#aaa',
    borderRadius: 3, padding: '3px 8px', cursor: 'pointer',
    fontSize: 10, fontFamily: 'inherit',
  };
}
