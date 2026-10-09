import React, { useEffect, useRef, useState } from 'react';
import type { SoundPlayerWidget, SoundPlayerTrack } from '../../../shared/types/project';
import { useStore } from '../../store';
import CellLinkMenu from '../base/CellLinkMenu';
import { dispatchValue } from '../../ipc/dispatch';
import { useSlavedCells, SLAVE_OUTLINE } from '../base/useSlavedCells';
import { EndButton, FadeButton, TransportBar, usePlaylistInputs } from '../base/playlist';
import { getAudioMaster, onAudioMaster } from '../../audio/audioMaster';

interface TrackState {
  playing: boolean;
  paused: boolean;   // paused mid-track (resume from position)
  currentTime: number;
  duration: number;
}

function makeTrackState(): TrackState {
  return { playing: false, paused: false, currentTime: 0, duration: 0 };
}

function pageOf(widgetId: string): string | undefined {
  return useStore.getState().project.pages.find((p) => p.widgets.some((w) => w.id === widgetId))?.id;
}

// A playlist of audio files. Track k is cell k: a rising edge plays it (from a
// timeline, a clock time, a button, DMX, OSC…). STOP / NEXT / PREV / FIRST
// are inputs. Per track: at the end stop / loop / next, and a fade time that
// fades it in while the one that was playing fades out.
export default function SoundPlayerLive({ widget }: { widget: SoundPlayerWidget }): React.JSX.Element {
  const widgetRef = useRef(widget);
  widgetRef.current = widget;
  const slaved = useSlavedCells(widget.id);

  const audioRefs = useRef<Record<string, HTMLAudioElement>>({});
  const [states, setStates] = useState<TrackState[]>(() => widget.tracks.map(makeTrackState));
  const statesRef = useRef(states);
  statesRef.current = states;
  // The track on the play head — updated synchronously, so a trigger that
  // arrives in the same tick sees it.
  const currentRef = useRef(-1);
  const fades = useRef<Record<string, number>>({});    // track id → rAF id
  // Our own "playing" writes to the cells must not read as triggers.
  const selfWrite = useRef(false);
  const writeCell = (i: number, v: number) => {
    selfWrite.current = true;
    try { useStore.getState().setCellValue(widgetRef.current.id, i, v); } finally { selfWrite.current = false; }
  };
  const [contextMenu, setContextMenu] = useState<{ cellIndex: number; x: number; y: number } | null>(null);
  useEffect(() => {
    if (!contextMenu) return;
    const handler = () => setContextMenu(null);
    document.addEventListener('pointerdown', handler);
    return () => document.removeEventListener('pointerdown', handler);
  }, [contextMenu]);

  useEffect(() => {
    setStates((prev) => widget.tracks.map((_t, i) => prev[i] ?? makeTrackState()));
  }, [widget.tracks.length]);

  const targetVol = (t: SoundPlayerTrack) => Math.max(0, Math.min(1, t.volume * widgetRef.current.masterVolume * getAudioMaster()));
  const [audioMaster, setAudioMasterState] = useState(getAudioMaster());
  useEffect(() => onAudioMaster(setAudioMasterState), []);
  const setState = (i: number, p: Partial<TrackState>) =>
    setStates((prev) => { const next = [...prev]; next[i] = { ...(next[i] ?? makeTrackState()), ...p }; return next; });

  // Volume ramp; `then` runs at the end (pause a faded-out track).
  const ramp = (track: SoundPlayerTrack, audio: HTMLAudioElement, from: number, to: number, ms: number, then?: () => void) => {
    cancelAnimationFrame(fades.current[track.id] ?? 0);
    if (ms <= 0) { audio.volume = to; then?.(); return; }
    const t0 = performance.now();
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / ms);
      audio.volume = Math.max(0, Math.min(1, from + (to - from) * k));
      if (k < 1) fades.current[track.id] = requestAnimationFrame(step);
      else { delete fades.current[track.id]; then?.(); }
    };
    fades.current[track.id] = requestAnimationFrame(step);
  };

  const stopTrack = (i: number, fadeMs = 0) => {
    const track = widgetRef.current.tracks[i];
    if (!track) return;
    const audio = audioRefs.current[track.id];
    const done = () => { if (audio) { audio.pause(); audio.currentTime = 0; } };
    if (audio && fadeMs > 0 && !audio.paused) ramp(track, audio, audio.volume, 0, fadeMs, done);
    else { cancelAnimationFrame(fades.current[track.id] ?? 0); done(); }
    setState(i, { playing: false, paused: false, currentTime: 0 });
    writeCell(i, 0);
    if (track.playMapping) dispatchValue(track.playMapping, 0);
  };

  const playTrack = (i: number, resume = false) => {
    const w = widgetRef.current;
    const track = w.tracks[i];
    if (!track) return;
    const audio = audioRefs.current[track.id];
    if (!audio) return;
    const fadeMs = Math.round((track.fade ?? 0) * 1000);
    // Everything else fades out over this track's fade time (or stops now).
    w.tracks.forEach((_t, j) => { if (j !== i && (statesRef.current[j]?.playing || currentRef.current === j)) stopTrack(j, fadeMs); });
    currentRef.current = i;
    audio.loop = (track.end ?? 'stop') === 'loop';
    if (!resume) audio.currentTime = 0;
    audio.volume = fadeMs > 0 ? 0 : targetVol(track);
    audio.play().catch(() => {});
    if (fadeMs > 0) ramp(track, audio, 0, targetVol(track), fadeMs);
    setStates((prev) => prev.map((s, j) => (j === i ? { ...s, playing: true, paused: false } : { ...s, playing: false, paused: false })));
    writeCell(i, 1);
    if (track.playMapping) dispatchValue(track.playMapping, 1);
  };

  const pauseTrack = (i: number) => {
    const track = widgetRef.current.tracks[i];
    const audio = track && audioRefs.current[track.id];
    if (!audio) return;
    audio.pause();
    setState(i, { playing: false, paused: true });
  };

  const onEnded = (id: string) => {
    const w = widgetRef.current;
    const i = w.tracks.findIndex((t) => t.id === id);
    if (i < 0) return;
    const end = w.tracks[i].end ?? 'stop';
    if (end === 'next' && i + 1 < w.tracks.length) playTrack(i + 1);
    else stopTrack(i);
  };

  // Build / teardown Audio elements when tracks change.
  useEffect(() => {
    const current = audioRefs.current;
    const newMap: Record<string, HTMLAudioElement> = {};
    widget.tracks.forEach((track) => {
      if (current[track.id]) {
        newMap[track.id] = current[track.id];
      } else if (track.src) {
        const audio = new Audio(track.src);
        audio.volume = targetVol(track);
        audio.addEventListener('ended', () => onEnded(track.id));
        audio.addEventListener('timeupdate', () => {
          const i = widgetRef.current.tracks.findIndex((t) => t.id === track.id);
          if (i >= 0) setState(i, { currentTime: audio.currentTime, duration: audio.duration || 0 });
        });
        newMap[track.id] = audio;
      }
    });
    Object.keys(current).forEach((id) => { if (!newMap[id]) { current[id].pause(); current[id].src = ''; } });
    audioRefs.current = newMap;
  }, [widget.tracks]);  // eslint-disable-line react-hooks/exhaustive-deps

  // Volumes / loop follow the settings (not during a fade).
  useEffect(() => {
    widget.tracks.forEach((track) => {
      const audio = audioRefs.current[track.id];
      if (!audio) return;
      audio.loop = (track.end ?? 'stop') === 'loop';
      if (!fades.current[track.id]) audio.volume = targetVol(track);
    });
  }, [widget.tracks, widget.masterVolume, audioMaster]);  // eslint-disable-line react-hooks/exhaustive-deps

  // Track triggers: a rising edge on cell k plays track k. Falling edges do
  // nothing — a momentary button or a timeline pulse must not stop it.
  useEffect(() => {
    const read = () => useStore.getState().runtime.widgets[widgetRef.current.id]?.cells.map((c) => c.value ?? 0) ?? [];
    let prev = read();
    return useStore.subscribe(() => {
      const now = read();
      if (!selfWrite.current) now.forEach((v, k) => { if ((prev[k] ?? 0) < 0.5 && v >= 0.5) playTrack(k); });
      prev = now;
    });
  }, [widget.id]);  // eslint-disable-line react-hooks/exhaustive-deps

  const n = () => widgetRef.current.tracks.length;
  const fns = {
    stop: () => { const c = currentRef.current; if (c >= 0) stopTrack(c, 0); currentRef.current = -1; },
    next: () => { if (n()) playTrack(currentRef.current < 0 ? 0 : (currentRef.current + 1) % n()); },
    prev: () => { if (n()) playTrack(currentRef.current <= 0 ? n() - 1 : currentRef.current - 1); },
    first: () => { if (n()) playTrack(0); },
  };
  usePlaylistInputs(widget.id, fns);

  useEffect(() => () => {
    Object.values(fades.current).forEach((id) => cancelAnimationFrame(id));
    Object.values(audioRefs.current).forEach((a) => a.pause());
  }, []);

  const updateTrack = (i: number, p: Partial<SoundPlayerTrack>) => {
    const pageId = pageOf(widget.id);
    if (!pageId) return;
    const tracks = widgetRef.current.tracks.map((t, j) => (j === i ? { ...t, ...p } : t));
    useStore.getState().updateWidget(pageId, widget.id, { tracks } as never);
  };

  const color = widget.style.foregroundColor;
  const fs = widget.style.fontSize || 13;
  const link = (cell: number, e: React.MouseEvent) => setContextMenu({ cellIndex: cell, x: e.clientX, y: e.clientY });

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', boxSizing: 'border-box', fontFamily: 'monospace', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px', borderBottom: '1px solid #1e1e1e', flexShrink: 0 }}>
        <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: 2, color: '#505050', textTransform: 'uppercase' }}>◈ sound player</span>
        <span style={{ fontSize: 9, color: '#444', marginRight: 'auto' }}>vol {Math.round(widget.masterVolume * 100)}%</span>
        <TransportBar widgetId={widget.id} color={color} fs={Math.max(10, fs - 2)} fns={fns} onLink={link} />
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
        {widget.tracks.length === 0 ? (
          <div style={{ fontSize: 10, color: '#303030', fontStyle: 'italic', padding: '8px 10px' }}>no tracks — add in inspector</div>
        ) : widget.tracks.map((track, i) => {
          const st = states[i] ?? makeTrackState();
          const pct = st.duration > 0 ? st.currentTime / st.duration : 0;
          const btn = (active?: boolean): React.CSSProperties => ({
            background: 'none', border: 'none', cursor: 'pointer', padding: '2px 5px', fontSize: 11, color: active ? color : '#555', lineHeight: 1,
          });
          return (
            <div key={track.id}
              onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); link(i, e); }}
              style={{
                display: 'flex', alignItems: 'center', gap: 4, padding: '3px 8px',
                background: st.playing ? 'rgba(255,255,255,0.04)' : 'transparent',
                borderLeft: st.playing ? `2px solid ${color}` : '2px solid transparent',
              }}>
              <span style={{ fontSize: 9, color: '#444', width: 14, textAlign: 'right', flexShrink: 0 }}>{i + 1}</span>
              <button data-lf-widget={widget.id} data-lf-cell={i}
                title="Play / pause · right-click: link / learn (timeline, clock, button, DMX, OSC…)"
                style={{ ...btn(st.playing && !st.paused), outline: slaved.has(i) ? SLAVE_OUTLINE : undefined, outlineOffset: -1 }}
                onClick={() => (st.playing && !st.paused ? pauseTrack(i) : playTrack(i, st.paused))}>
                {st.playing && !st.paused ? '⏸' : '▶'}
              </button>
              <button style={btn()} onClick={() => stopTrack(i)}>■</button>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
                <span style={{ fontSize: fs, color: st.playing ? '#ddd' : '#666', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {track.label || track.fileName || `Track ${i + 1}`}
                </span>
                <div style={{ height: 2, background: 'rgba(255,255,255,0.06)', borderRadius: 1, overflow: 'hidden' }}>
                  <div style={{ width: `${pct * 100}%`, height: '100%', background: color + '80', transition: 'width 0.2s linear' }} />
                </div>
              </div>
              <input type="range" min={0} max={1} step={0.01} value={track.volume}
                onPointerDown={(e) => e.stopPropagation()}
                onChange={(e) => updateTrack(i, { volume: parseFloat(e.target.value) })}
                style={{ width: 48, accentColor: color, flexShrink: 0 }} />
              <EndButton value={track.end ?? 'stop'} onChange={(v) => updateTrack(i, { end: v })} color={color} fs={fs - 2} />
              <FadeButton value={track.fade ?? 0} onChange={(v) => updateTrack(i, { fade: v })} color={color} fs={fs - 2} />
            </div>
          );
        })}
      </div>
      {contextMenu && (
        <CellLinkMenu x={contextMenu.x} y={contextMenu.y} widgetId={widget.id} cellIndex={contextMenu.cellIndex} onClose={() => setContextMenu(null)} />
      )}
    </div>
  );
}
