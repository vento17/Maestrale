import { markSaved, isSaved, isDiscarding } from '../store/savedMark';
import { pal } from '../palette';
import React, { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { bridge } from '../ipc/bridge';
import type { Project } from '../../shared/types/project';

// How long to wait after the last edit before writing. Long enough that dragging
// a widget does not write on every frame, short enough that almost nothing is
// lost when the app dies.
const QUIET_MS = 3000;
// And a ceiling, so a long unbroken stretch of edits still reaches disk.
const MAX_MS = 20000;

/**
 * Autosave and crash recovery.
 *
 * The app had a backup IPC channel wired end to end in main and declared in the
 * IPC types, and nothing in the renderer ever called it — so until you pressed
 * Save there was nothing on disk at all. A black screen, a crash or a force
 * quit took the whole session with it.
 *
 * The recovery copy is deliberately NOT cleared when the app exits: an exit is
 * exactly when we cannot tell a clean quit from a force close. It is cleared
 * when the work is provably safe — an explicit Save (done in main) or the user
 * dismissing the offer.
 */
export default function Recovery(): React.JSX.Element | null {
  const project = useStore((s) => s.project);
  const [offer, setOffer] = useState<{ project: Project; savedAt: string } | null>(null);

  // ── Offer to restore on startup ────────────────────────────────────────────
  // Read before the first autosave can overwrite it.
  const checked = useRef(false);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (checked.current) return;
    checked.current = true;
    // Start where we left off, without asking: the last saved / opened project
    // (or, if nothing was ever saved, the autosave). An installation PC with
    // Maestrale in its startup apps boots straight into its show.
    bridge.invoke('tr:project:openLast', undefined as never)
      .then((found) => {
        if (!found) return;
        const st = useStore.getState();
        st.loadProject(found.project);
        if (found.from === 'saved') markSaved(useStore.getState().project);
        if (found.project.startInLive !== false) st.setMode('live');
        st.addLog('info', found.from === 'saved' ? `Opened ${found.path}` : found.from === 'resumed' ? `Reopened ${found.path} as it was left (changes not saved yet)` : 'Opened the last autosave');
      })
      .catch(() => {})
      .finally(() => setReady(true));
    void setOffer;
  }, []);

  // ── Autosave ───────────────────────────────────────────────────────────────
  const quiet = useRef<number | null>(null);
  const ceiling = useRef<number | null>(null);
  const first = useRef(true);

  useEffect(() => {
    // Do not write until the recovery check has run, or the first render would
    // overwrite the very file we are about to offer.
    if (!ready) return;
    if (first.current) { first.current = false; return; }

    const write = () => {
      if (quiet.current)   { clearTimeout(quiet.current);   quiet.current = null; }
      if (ceiling.current) { clearTimeout(ceiling.current); ceiling.current = null; }
      bridge.invoke('tr:project:autosave', useStore.getState().project).catch(() => {});
    };

    if (quiet.current) clearTimeout(quiet.current);
    quiet.current = window.setTimeout(write, QUIET_MS);
    if (!ceiling.current) ceiling.current = window.setTimeout(write, MAX_MS);

    return () => { if (quiet.current) clearTimeout(quiet.current); };
  }, [project, ready]);

  // Connection settings and Connect / Disconnect are written into the project's
  // file at once (main patches just those fields), so ports, IPs and what was
  // connected survive even "Close without saving". If that was the only change,
  // the project still counts as saved.
  const prevProj = useRef<Project | null>(null);
  useEffect(() => {
    const prev = prevProj.current;
    prevProj.current = project;
    if (!ready || !prev || prev.id !== project.id) return;
    if (prev.connections === project.connections && prev.connected === project.connected) return;
    const onlyConn = (Object.keys({ ...prev, ...project }) as (keyof Project)[])
      .every((k) => k === 'connections' || k === 'connected' || k === 'updatedAt' || prev[k] === project[k]);
    if (onlyConn && isSaved(prev)) markSaved(project);
    bridge.invoke('tr:project:patchConnections', { connections: project.connections, connected: project.connected }).catch(() => {});
  }, [project, ready]);

  // A last write on the way out catches whatever the timers had not flushed.
  useEffect(() => {
    const flush = () => {
      const p = useStore.getState().project;
      if (isDiscarding() || isSaved(p)) return;
      bridge.send('tr:project:autosave', p);
    };
    window.addEventListener('beforeunload', flush);
    return () => window.removeEventListener('beforeunload', flush);
  }, []);

  if (!offer) return null;

  const when = new Date(offer.savedAt);
  const widgets = offer.project.pages?.reduce((n, p) => n + (p.widgets?.length ?? 0), 0) ?? 0;

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 10000,
      background: 'rgba(0,0,0,0.72)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        background: '#1a1a1a', border: '1px solid #3a3a3a', borderRadius: 8,
        padding: '22px 26px', minWidth: 420, maxWidth: 560,
        boxShadow: '0 10px 40px rgba(0,0,0,0.8)', fontFamily: 'inherit',
      }}>
        <div style={{ fontSize: 17, fontWeight: 700, color: '#eee', marginBottom: 10 }}>
          Unsaved work recovered
        </div>
        <div style={{ fontSize: 14, color: '#b0b0b0', lineHeight: 1.55, marginBottom: 18 }}>
          Maestrale closed with changes that were never saved to a file.
          <div style={{ marginTop: 10, fontFamily: 'monospace', fontSize: 13, color: '#ddd' }}>
            {offer.project.name || 'untitled'}
            <span style={{ color: '#777' }}>
              {' · '}{offer.project.pages?.length ?? 0} pages
              {' · '}{widgets} widgets
            </span>
            <div style={{ color: '#777', marginTop: 3 }}>
              {when.toLocaleString()}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button
            onClick={() => {
              // Only drop it once the user has said so — never on their behalf.
              bridge.invoke('tr:project:recoverClear', undefined as never).catch(() => {});
              setOffer(null);
            }}
            style={{
              background: 'none', border: '1px solid #3a3a3a', color: '#999',
              borderRadius: 5, padding: '10px 18px', fontSize: 14, cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            Discard
          </button>
          <button
            onClick={() => { useStore.getState().loadProject(offer.project); setOffer(null); }}
            style={{
              background: `var(--color-accent, ${pal('#91ced2')})`, border: `1px solid var(--color-accent, ${pal('#91ced2')})`,
              color: '#000', fontWeight: 700,
              borderRadius: 5, padding: '10px 18px', fontSize: 14, cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            Restore
          </button>
        </div>
      </div>
    </div>
  );
}
