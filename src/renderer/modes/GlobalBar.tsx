import { pal, palRgb, onPalette } from '../palette';
import { LogBadge } from './LogConsole';
import React, { useState, useRef, useEffect } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStore, useMode, useIsLocked, useProject, useActivePageId } from '../store';
import { makeDefaultProject } from '../store/layoutSlice';
import { markSaved, isSaved, setDiscarding } from '../store/savedMark';
import type { Mapping, MidiMapping, OscMapping } from '../../shared/types/mapping';
import { bridge } from '../ipc/bridge';
import { onDmxInput, snapshotDmx, onDmxInputStatus } from '../ipc/dmxInput';
import { MAIN_ROUTER_ID } from '../widgets/base/routers';
import { AutoBpmService } from '../audio/AutoBpmService';
import type { AutoBpmConfig } from '../audio/AutoBpmService';

export const GLOBAL_BAR_HEIGHT = 100; // 50px main bar + 50px BPM strip (31px × zoom 1.6)
const MAX_PAGES = 12;

// Module-level singleton — persists for the lifetime of the app
let _autoBpmSvc: AutoBpmService | null = null;
function getAutoBpmSvc(): AutoBpmService {
  if (!_autoBpmSvc) {
    _autoBpmSvc = new AutoBpmService(
      (result) => {
        const store = useStore.getState();
        store.setAutoBpmStatus({
          locked:        result.locked,
          confidence:    result.confidence,
          rawBpm:        result.rawBpm,
          beatPhase:     result.beatPhase,
          onsetStrength: result.onsetStrength,
          dropArmed:     result.dropArmed,
        });
        if (result.locked && result.bpm > 0) {
          store.setMasterBpm(Math.round(result.bpm));
        }
      },
      (msg) => { useStore.getState().setAutoBpmError(msg); },
    );
  }
  return _autoBpmSvc;
}

// Returns '#000' or '#fff' depending on which contrasts better with a hex background
function contrastColor(hex: string): string {
  const h = hex.replace('#', '');
  if (h.length < 6) return '#fff';
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.55 ? '#000' : '#fff';
}

export default function GlobalBar(): React.JSX.Element {
  const mode         = useMode();
  const liveSidebarOpen = useStore((s) => s.liveSidebarOpen);
  const isLocked     = useIsLocked();
  const project      = useProject();
  const activePageId = useActivePageId();

  const {
    setMode, loadProject, toggleLock,
    openWidgetPicker, openSettings, closeSettings, isSettingsOpen,
    masterBpm, setMasterBpm,
    isGlobalPlaying, triggerGlobalPlay, triggerGlobalStop,
    addPage, removePage, reorderPages, setActivePageId,
    bpmMode, setBpmMode, autoBpmConfig, setAutoBpmConfig,
    autoBpmStatus, autoBpmAudioDeviceId, setAutoBpmAudioDeviceId, autoBpmError, setAutoBpmError,
    midiClockEnabled, midiLearnTarget,
    learnMode, setLearnMode, learnRouterId,
    connectedProtocols, networkEnabled,
  } = useStore(useShallow((s) => ({
    setMode:                 s.setMode,
    loadProject:             s.loadProject,
    toggleLock:              s.toggleLock,
    openWidgetPicker:        s.openWidgetPicker,
    openSettings:            s.openSettings,
    closeSettings:           s.closeSettings,
    isSettingsOpen:          s.isSettingsOpen,
    masterBpm:               s.masterBpm,
    setMasterBpm:            s.setMasterBpm,
    isGlobalPlaying:         s.isGlobalPlaying,
    triggerGlobalPlay:       s.triggerGlobalPlay,
    triggerGlobalStop:       s.triggerGlobalStop,
    addPage:                 s.addPage,
    removePage:              s.removePage,
    reorderPages:            s.reorderPages,
    setActivePageId:         s.setActivePageId,
    bpmMode:                 s.bpmMode,
    setBpmMode:              s.setBpmMode,
    autoBpmConfig:           s.autoBpmConfig,
    setAutoBpmConfig:        s.setAutoBpmConfig,
    autoBpmStatus:           s.autoBpmStatus,
    autoBpmAudioDeviceId:    s.autoBpmAudioDeviceId,
    setAutoBpmAudioDeviceId: s.setAutoBpmAudioDeviceId,
    autoBpmError:            s.autoBpmError,
    setAutoBpmError:         s.setAutoBpmError,
    midiClockEnabled:        s.midiClockEnabled,
    midiLearnTarget:         s.midiLearnTarget,
    learnMode:               s.learnMode,
    learnRouterId:           s.learnRouterId,
    setLearnMode:            s.setLearnMode,
    connectedProtocols:      s.connectedProtocols,
    networkEnabled:          s.networkEnabled,
  })));


  const routerPageOpen = useStore((s) => s.routerPageOpen);
  const learnRouterLabel = learnRouterId === MAIN_ROUTER_ID ? 'router'
    : project.pages.flatMap((p) => p.widgets).find((w) => w.id === learnRouterId)?.label ?? 'router';

  // Learned rows always go into the main router — no router to pick.
  function toggleLearn(protocol: 'midi' | 'osc') {
    if (learnMode === protocol) { setLearnMode(null); return; }
    setLearnMode(protocol, MAIN_ROUTER_ID);
  }



  const pages    = project.pages;
  const canAdd   = pages.length < MAX_PAGES;
  const canRemove = pages.length > 1;

  const [bpmInput, setBpmInput]   = useState(String(masterBpm));
  const [tapFlash, setTapFlash]   = useState(false);
  const [resetFlash, setResetFlash] = useState(false);

  const tapMappingRef      = useRef(project.tapTriggerMapping);
  const resetMappingRef    = useRef(project.resetTriggerMapping);
  const playMappingRef     = useRef(project.playTriggerMapping ?? null);
  const stopMappingRef     = useRef(project.stopTriggerMapping ?? null);
  const flashTimerRef      = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resetFlashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  tapMappingRef.current   = project.tapTriggerMapping;
  resetMappingRef.current = project.resetTriggerMapping;
  playMappingRef.current  = project.playTriggerMapping ?? null;
  stopMappingRef.current  = project.stopTriggerMapping ?? null;

  useEffect(() => { setBpmInput(String(masterBpm)); }, [masterBpm]);

  // Audio input devices
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  useEffect(() => {
    if (bpmMode !== 'auto') return;
    navigator.mediaDevices.enumerateDevices().then((all) => {
      setAudioDevices(all.filter((d) => d.kind === 'audioinput'));
    }).catch(() => {});
  }, [bpmMode]);

  // Auto BPM service lifecycle
  const autoBpmConfigRef = useRef(autoBpmConfig);
  autoBpmConfigRef.current = autoBpmConfig;

  useEffect(() => {
    const svc = getAutoBpmSvc();
    if (bpmMode === 'auto') {
      setAutoBpmError(null);
      svc.start(autoBpmAudioDeviceId, autoBpmConfigRef.current);
    } else {
      svc.stop();
    }
    return () => { /* keep running on unmount — singleton lives on */ };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bpmMode, autoBpmAudioDeviceId]);

  // Push config changes to running service
  useEffect(() => {
    if (bpmMode === 'auto') getAutoBpmSvc().updateConfig(autoBpmConfig);
  }, [autoBpmConfig, bpmMode]);

  function commitBpm(raw: string) {
    const v = parseInt(raw, 10);
    if (!isNaN(v) && v >= 20 && v <= 300) {
      setMasterBpm(v);
      setBpmInput(String(v));
    } else {
      setBpmInput(String(masterBpm));
    }
  }

  const flashRef = useRef<() => void>(null!);
  flashRef.current = () => {
    setTapFlash(true);
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    flashTimerRef.current = setTimeout(() => setTapFlash(false), 60);
  };

  const tapRef = useRef<() => void>(null!);
  tapRef.current = () => {
    flashRef.current();
    useStore.getState().triggerTap();
    setBpmInput(String(useStore.getState().masterBpm));
  };

  const resetRef = useRef<() => void>(null!);
  resetRef.current = () => {
    setResetFlash(true);
    if (resetFlashTimerRef.current) clearTimeout(resetFlashTimerRef.current);
    resetFlashTimerRef.current = setTimeout(() => setResetFlash(false), 120);
    useStore.getState().triggerGlobalReset();
  };

  // ─── MIDI Clock ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (midiClockEnabled) {
      bridge.send('tr:midi:clockStart', { bpm: masterBpm });
    } else {
      bridge.send('tr:midi:clockStop', undefined as never);
    }
  }, [midiClockEnabled, masterBpm]);

  // ─── Protocol Learn — capture next MIDI CC/note or OSC message ───────────
  // A learned controller becomes an ordinary Router row driving the cell. That
  // is the app's existing answer to "this input moves that cell", so learn gets
  // everything the Router already does for free: it shows up in the router, it
  // is visible and undoable through the right-click menu, Cues snapshot it, and
  // it drives ANY cell — the per-widget MIDI listeners only understood their own
  // message type, which is why learning a CC onto a button grid did nothing.
  //
  // Crucially it also leaves the cell's own mapping alone, so a fader can take
  // MIDI in and keep sending OSC out.
  useEffect(() => {
    if (!midiLearnTarget) return;
    const protocol = midiLearnTarget.protocol ?? 'midi';

    // The row needs a router to live in. Prefer one on the target's own page,
    // else any router in the project, else make one.
    // Fallback for a target armed without a router: the main router.
    function routerFor(): string {
      return MAIN_ROUTER_ID;
    }

    function bind(t: NonNullable<typeof midiLearnTarget>, input: {
      inputType: 'midiCC' | 'midiNote' | 'midiPB' | 'osc' | 'artnet' | 'sacn';
      midiChannel?: number; midiNumber?: number; oscAddress?: string;
      artnetUniverse?: number; artnetChannel?: number;
    }) {
      // The router was chosen up front (right-click Learn, or the header learn
      // buttons), so every row of one patching pass lands in the same place.
      // routerFor() is only the fallback for a target armed without a choice.
      const chosen = t.routerId
        && (t.routerId === MAIN_ROUTER_ID
          || useStore.getState().project.pages.some((p) => p.widgets.some((w) => w.id === t.routerId)))
        ? t.routerId : null;
      const routerId = chosen ?? routerFor();
      if (!routerId) return;
      useStore.getState().linkSlaveCell({
        slaveWidgetId: t.widgetId, slaveCellIndex: t.cellIndex,
        sourceWidgetId: '', sourceCellIndex: 0,
        routerId, input,
      });
      useStore.getState().setMidiLearnTarget(null);
    }

    // Art-Net: a console streams every channel all the time, so "the first
    // message" means nothing. Learn binds the first channel that MOVES by a
    // real amount (≥ 20 of 255) from where it was when learn was armed.
    if (protocol === 'artnet' || protocol === 'sacn') {
      const base = snapshotDmx();
      return onDmxInput((changes) => {
        const t = useStore.getState().midiLearnTarget;
        if (!t || t.protocol !== protocol || t.mappingKey) return;
        for (const c of changes) {
          if (c.protocol !== protocol || c.initial) continue;
          const was = base.get(`${protocol}:${c.universe}`)?.[c.channel] ?? 0;
          if (Math.abs(c.value - was) < 20) continue;
          bind(t, { inputType: protocol, artnetUniverse: c.universe, artnetChannel: c.channel });
          return;
        }
      });
    }

    if (protocol === 'osc') {
      return bridge.on('tr:osc:feedback', (msg) => {
        const t = useStore.getState().midiLearnTarget;
        if (!t || (t.protocol ?? 'midi') !== 'osc') return;
        const firstArg = msg.args[0];
        if (firstArg === 0 || firstArg === false) return; // ignore release events
        // A non-cell target (an LFO play trigger, say) still learns a mapping.
        if (t.mappingKey) {
          const mapping: OscMapping = { type: 'osc', address: msg.address, minValue: 0, maxValue: 1 };
          useStore.getState().updateCell(t.pageId, t.widgetId, t.cellIndex, { [t.mappingKey]: mapping });
          useStore.getState().setMidiLearnTarget(null);
          return;
        }
        bind(t, { inputType: 'osc', oscAddress: msg.address });
      });
    }

    // Motorised / touch-sensitive faders (iCON, X-Touch, any Mackie-mode surface)
    // send a touch NOTE the instant a finger lands, then the position as Pitch
    // Bend or CC. Binding the first message would learn the touch (0/1), so a
    // note is held back briefly: if a continuous message follows, that wins.
    const NOTE_GRACE_MS = 400;
    let pendingNote: ReturnType<typeof setTimeout> | null = null;
    const cancelPending = () => { if (pendingNote) { clearTimeout(pendingNote); pendingNote = null; } };

    const off = bridge.on('tr:midi:inputEvent', (evt) => {
      const t = useStore.getState().midiLearnTarget;
      if (!t) return;
      if (evt.messageType === 'pitchBend') {
        if (t.mappingKey) return;            // non-cell triggers only take CC/notes
        cancelPending();
        bind(t, { inputType: 'midiPB', midiChannel: evt.channel });
        return;
      }
      if (evt.messageType !== 'controlChange' && evt.messageType !== 'noteOn') return;
      if (evt.messageType === 'noteOn' && !t.mappingKey) {
        if (pendingNote) return;             // keep the first note, wait for movement
        pendingNote = setTimeout(() => {
          pendingNote = null;
          const cur = useStore.getState().midiLearnTarget;
          if (cur && cur === t) bind(cur, { inputType: 'midiNote', midiChannel: evt.channel, midiNumber: evt.number });
        }, NOTE_GRACE_MS);
        return;
      }
      cancelPending();
      if (t.mappingKey) {
        const mapping: MidiMapping = {
          type: 'midi',
          messageType: evt.messageType === 'controlChange' ? 'controlChange' : 'noteOn',
          channel: evt.channel, number: evt.number, minValue: 0, maxValue: 127,
        };
        useStore.getState().updateCell(t.pageId, t.widgetId, t.cellIndex, { [t.mappingKey]: mapping });
        useStore.getState().setMidiLearnTarget(null);
        return;
      }
      bind(t, {
        inputType: evt.messageType === 'controlChange' ? 'midiCC' : 'midiNote',
        midiChannel: evt.channel,
        midiNumber: evt.number,
      });
    });
    return () => { cancelPending(); off(); };
  }, [midiLearnTarget]);

  // ─── Keyboard shortcuts ───────────────────────────────────────────────────
  const modeRef       = useRef(mode);
  const activePgRef   = useRef(activePageId);
  const isLockedKbRef = useRef(isLocked);
  const saveRef = useRef<(as?: boolean) => Promise<boolean>>(async () => false);
  modeRef.current       = mode;
  activePgRef.current   = activePageId;
  isLockedKbRef.current = isLocked;

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      // Ctrl+S save, Ctrl+Shift+S save as — anywhere, even while typing.
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (!isLockedKbRef.current) void saveRef.current(e.shiftKey);
        return;
      }
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase() ?? '';
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      if (e.key === 'F1') {
        e.preventDefault();
        if (activePgRef.current) useStore.getState().setMode('live');
      } else if (e.key === 'Escape') {
        if (!isLockedKbRef.current) useStore.getState().setMode('design');
      } else if (e.key === 't' || e.key === 'T') {
        tapRef.current();
      } else if (e.key === 'r' || e.key === 'R') {
        resetRef.current();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  // OSC tap — ignore zero-value releases (TouchDesigner sends on+off pairs)
  useEffect(() => bridge.on('tr:osc:feedback', (msg) => {
    const m = tapMappingRef.current;
    if (!m || m.type !== 'osc') return;
    if (msg.address !== (m as OscMapping).address) return;
    if (msg.args.length > 0 && (msg.args[0] === 0 || msg.args[0] === false)) return;
    tapRef.current();
  }), []);

  // MIDI tap
  useEffect(() => bridge.on('tr:midi:inputEvent', (evt) => {
    const m = tapMappingRef.current;
    if (!m || m.type !== 'midi') return;
    const mm = m as MidiMapping;
    const isCC   = mm.messageType === 'controlChange' && evt.messageType === 'controlChange' && evt.channel === mm.channel && evt.number === mm.number;
    const isNote = mm.messageType === 'noteOn'        && evt.messageType === 'noteOn'        && evt.channel === mm.channel && evt.number === mm.number;
    if (isCC || isNote) tapRef.current();
  }), []);

  // ── Learn on the transport buttons ────────────────────────────────────────
  // Setting these from the Settings dropdowns means knowing the CC number by
  // heart. Right-clicking the button itself and pressing the pad is how every
  // other mapping in the app is made, so these work the same way.
  type TransportKey = 'reset' | 'play' | 'stop';
  const [tMenu, setTMenu] = useState<{ key: TransportKey; x: number; y: number } | null>(null);
  const [tLearn, setTLearn] = useState<{ key: TransportKey; protocol: 'midi' | 'osc' } | null>(null);

  const setTransportMapping = (key: TransportKey, m: Mapping | null) => {
    const st = useStore.getState();
    if (key === 'reset') st.setResetTriggerMapping(m);
    else if (key === 'play') st.setPlayTriggerMapping(m);
    else st.setStopTriggerMapping(m);
  };
  const transportMapping = (key: TransportKey): Mapping | null =>
    key === 'reset' ? project.resetTriggerMapping
    : key === 'play' ? (project.playTriggerMapping ?? null)
    : (project.stopTriggerMapping ?? null);

  useEffect(() => {
    if (!tMenu) return;
    const close = () => setTMenu(null);
    const t = setTimeout(() => document.addEventListener('pointerdown', close), 0);
    return () => { clearTimeout(t); document.removeEventListener('pointerdown', close); };
  }, [tMenu]);

  useEffect(() => {
    if (!tLearn) return;
    const { key, protocol } = tLearn;
    if (protocol === 'osc') {
      return bridge.on('tr:osc:feedback', (msg) => {
        const first = msg.args[0];
        if (first === 0 || first === false) return;   // ignore the release half
        setTransportMapping(key, { type: 'osc', address: msg.address });
        setTLearn(null);
      });
    }
    return bridge.on('tr:midi:inputEvent', (evt) => {
      if (evt.messageType !== 'controlChange' && evt.messageType !== 'noteOn') return;
      if (evt.messageType === 'noteOn' && evt.value === 0) return;
      setTransportMapping(key, {
        type: 'midi',
        messageType: evt.messageType === 'controlChange' ? 'controlChange' : 'noteOn',
        channel: evt.channel, number: evt.number, minValue: 0, maxValue: 127,
      });
      setTLearn(null);
    });
  }, [tLearn]);

  // Esc cancels an armed transport learn.
  useEffect(() => {
    if (!tLearn) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setTLearn(null); };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [tLearn]);

  function transportTitle(key: TransportKey, base: string): string {
    if (tLearn?.key === key) return `${base} — learning ${tLearn.protocol.toUpperCase()}, send it now (Esc cancels)`;
    const m = transportMapping(key);
    const desc = !m ? 'not mapped'
      : m.type === 'osc' ? `OSC ${(m as OscMapping).address}`
      : `MIDI ch${(m as MidiMapping).channel} ${(m as MidiMapping).messageType === 'noteOn' ? 'note' : 'cc'}${(m as MidiMapping).number}`;
    return `${base} — ${desc}. Right-click to learn.`;
  }

  const transportCtx = (key: TransportKey) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setTMenu({ key, x: e.clientX, y: e.clientY });
  };

  // ── Transport triggers: reset, play and stop ──────────────────────────────
  // All three top-bar buttons can be driven from a controller. The matching is
  // written once so play and stop cannot drift from the reset behaviour.
  const playRef = useRef<() => void>(null!);
  const stopRef = useRef<() => void>(null!);
  playRef.current = () => triggerGlobalPlay();
  stopRef.current = () => triggerGlobalStop();

  useEffect(() => {
    const targets: [React.MutableRefObject<Mapping | null>, React.MutableRefObject<() => void>][] = [
      [resetMappingRef, resetRef],
      [playMappingRef,  playRef],
      [stopMappingRef,  stopRef],
    ];

    const offOsc = bridge.on('tr:osc:feedback', (msg) => {
      for (const [mapRef, fire] of targets) {
        const m = mapRef.current;
        if (!m || m.type !== 'osc') continue;
        if (msg.address === (m as OscMapping).address) fire.current();
      }
    });

    const offMidi = bridge.on('tr:midi:inputEvent', (evt) => {
      for (const [mapRef, fire] of targets) {
        const m = mapRef.current;
        if (!m || m.type !== 'midi') continue;
        const mm = m as MidiMapping;
        const isCC   = mm.messageType === 'controlChange' && evt.messageType === 'controlChange' && evt.channel === mm.channel && evt.number === mm.number;
        // A note-off carries velocity 0; firing on it would double-trigger.
        const isNote = mm.messageType === 'noteOn'        && evt.messageType === 'noteOn'        && evt.channel === mm.channel && evt.number === mm.number && evt.value > 0;
        if (isCC || isNote) fire.current();
      }
    });

    return () => { offOsc(); offMidi(); };
  }, []);

  async function handleSave(as = false) {
    const st = useStore.getState();
    const proj = st.project;
    const res = await bridge.invoke(as ? 'tr:project:save' : 'tr:project:saveQuick', proj);
    if (res?.ok) { markSaved(proj); st.addLog('info', `Saved ${res.path}`); }
    return !!res?.ok;
  }

  // Window: full screen on/off and moving to another screen. The state comes
  // from the main process (F11 changes it too).
  const [winState, setWinState] = useState({ fullscreen: true, displays: 1 });
  useEffect(() => {
    bridge.invoke('tr:window:state', undefined as never).then((st) => { if (st) setWinState(st); }).catch(() => {});
    return bridge.on('tr:window:changed', (st) => setWinState(st));
  }, []);
  const winBtn: React.CSSProperties = {
    ...styles.lockBtn, width: 34, padding: 0, marginLeft: 4,
    background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', color: 'var(--color-text-dim)',
  };

  // Close: asks first, unless nothing changed since the last save.
  const [askClose, setAskClose] = useState(false);
  function handleClose() {
    if (isSaved(useStore.getState().project)) bridge.send('tr:window:close', undefined as never);
    else setAskClose(true);
  }
  saveRef.current = handleSave;


  // New: a blank project. Asks first — there is no undo for this.
  const [askNew, setAskNew] = useState(false);
  function handleNew() {
    void bridge.invoke('tr:project:forget', undefined as never);
    markSaved(null);
    loadProject(makeDefaultProject());
    useStore.getState().setMode('design');   // a blank project is for building
    setAskNew(false);
  }

  async function handleLoad() {
    const loaded = await bridge.invoke('tr:project:load', undefined as never);
    if (loaded) { loadProject(loaded); markSaved(useStore.getState().project); }
  }

  // Page tabs: drag to reorder, right-click to delete the one you point at —
  // the − button only ever removed the last page, which is rarely the one you
  // wanted gone.
  // The source index lives in a ref, not in state: dragstart and drop can land
  // in the same batch, and a state update that has not committed yet would make
  // the drop a no-op. The state copy exists only to grey out the dragged tab.
  const dragPageRef = useRef<number | null>(null);
  const [dragPageIdx, setDragPageIdx] = useState<number | null>(null);
  const [overPageIdx, setOverPageIdx] = useState<number | null>(null);
  const [pageMenu, setPageMenu] = useState<{ pageId: string; x: number; y: number } | null>(null);

  useEffect(() => {
    if (!pageMenu) return;
    const close = () => setPageMenu(null);
    const t = setTimeout(() => document.addEventListener('pointerdown', close), 0);
    return () => { clearTimeout(t); document.removeEventListener('pointerdown', close); };
  }, [pageMenu]);

  function handleDeleteLast() {
    if (!canRemove) return;
    removePage(pages[pages.length - 1].id);
  }

  return (
    <div style={styles.outerBar}>
      {/* ── Row 1: main bar ── */}
      <div style={styles.bar}>
        {/* Left */}
        <span style={styles.logo}>Maestrale</span>

        {mode === 'design' && (
          <>
            <div style={styles.sep} />
            <Btn onClick={openWidgetPicker}>+ Widget</Btn>
          </>
        )}

        <div style={styles.sep} />
        <Btn onClick={() => setAskNew(true)} disabled={isLocked}>New</Btn>
        <span title="Ctrl+S save · Ctrl+Shift+S save as (Shift+click)">
          <Btn onClick={(e?: React.MouseEvent) => void handleSave(!!e?.shiftKey)} disabled={isLocked}>Save</Btn>
        </span>
        <Btn onClick={handleLoad} disabled={isLocked}>Load</Btn>
        {askNew && (
          <div onPointerDown={() => setAskNew(false)}
            style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div onPointerDown={(e) => e.stopPropagation()}
              onKeyDown={(e) => { if (e.key === 'Escape') setAskNew(false); if (e.key === 'Enter') handleNew(); }}
              style={{ background: '#151515', border: '1px solid #333', borderRadius: 6, padding: '18px 20px', width: 380, fontFamily: 'inherit', color: '#ddd' }}>
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>Start a new project from scratch?</div>
              <div style={{ fontSize: 12, color: '#999', marginBottom: 16 }}>Unsaved changes to the current project will be lost.</div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <Btn onClick={() => setAskNew(false)}>Cancel</Btn>
                <button autoFocus onClick={handleNew}
                  style={{ padding: '5px 14px', borderRadius: 3, cursor: 'pointer', background: 'var(--lf-orange)', color: '#000', border: 'none', fontWeight: 700, fontFamily: 'inherit' }}>
                  New project
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Learn mode — two half-height buttons stacked into one Btn slot.
            Arms the whole surface so cells can be patched by tapping them
            instead of right-clicking each one. */}
        <div style={styles.sep} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, position: 'relative' }}>
          <LearnBtn
            label={learnMode === 'midi' ? `MIDI → ${learnRouterLabel}` : 'LEARN MIDI'}
            on={learnMode === 'midi'}
            title={learnMode === 'midi'
              ? `Learn mode ON — rows go into ${learnRouterLabel}. Tap a cell, move the control. Esc to exit.`
              : 'Learn mode (MIDI): tap a cell, move the physical control. Rows go into the main router.'}
            onClick={() => toggleLearn('midi')}
          />
          <LearnBtn
            label={learnMode === 'osc' ? `OSC → ${learnRouterLabel}` : 'LEARN OSC'}
            on={learnMode === 'osc'}
            title={learnMode === 'osc'
              ? `Learn mode ON — rows go into ${learnRouterLabel}. Tap a cell, send the message. Esc to exit.`
              : 'Learn mode (OSC): tap a cell, send the OSC message. Rows go into the main router.'}
            onClick={() => toggleLearn('osc')}
          />
        </div>


        {/* Center: pages (absolutely positioned within row 1) */}
        <div style={styles.pageCenter}>
          {mode === 'design' && (
            <>
              <PageBtn
                label="+"
                title={canAdd ? 'Add page' : `Max ${MAX_PAGES} pages`}
                active={false}
                dimmed={!canAdd}
                bg="var(--color-surface-2)"
                onClick={() => { if (canAdd) addPage(); }}
              />
              <PageBtn
                label="−"
                title={canRemove ? 'Delete last page' : 'Cannot delete last page'}
                active={false}
                dimmed={!canRemove}
                bg="var(--color-surface-2)"
                onClick={handleDeleteLast}
              />
            </>
          )}
          {pages.map((page, i) => {
            const isActive = page.id === activePageId;
            return (
              <PageBtn
                key={page.id}
                label={String(i + 1)}
                title={mode === 'design'
                  ? `${page.name} — drag to reorder, right-click to delete`
                  : page.name}
                active={isActive}
                dimmed={false}
                bg={isActive ? page.backgroundColor : 'var(--color-surface-2)'}
                wide={mode === 'live'}
                onClick={() => setActivePageId(page.id)}
                draggable={mode === 'design' && pages.length > 1}
                dragging={dragPageIdx === i}
                dropSide={overPageIdx === i && dragPageIdx !== null && dragPageIdx !== i
                  ? (dragPageIdx < i ? 'right' : 'left') : null}
                onDragStart={() => { dragPageRef.current = i; setDragPageIdx(i); }}
                onDragOver={() => setOverPageIdx(i)}
                onDrop={() => {
                  const from = dragPageRef.current;
                  if (from !== null) reorderPages(from, i);
                  dragPageRef.current = null;
                  setDragPageIdx(null); setOverPageIdx(null);
                }}
                onDragEnd={() => { dragPageRef.current = null; setDragPageIdx(null); setOverPageIdx(null); }}
                onContextMenu={mode === 'design'
                  ? (e) => { e.preventDefault(); setPageMenu({ pageId: page.id, x: e.clientX, y: e.clientY }); }
                  : undefined}
              />
            );
          })}
        </div>

        {/* Page context menu — delete the page you pointed at, not the last one */}
        {pageMenu && (() => {
          const pg = pages.find((p) => p.id === pageMenu.pageId);
          const idx = pages.findIndex((p) => p.id === pageMenu.pageId);
          const item: React.CSSProperties = {
            display: 'block', width: '100%', minHeight: 38, padding: '9px 16px',
            background: 'none', border: 'none', cursor: 'pointer',
            fontSize: 14, color: '#ccc', textAlign: 'left', fontFamily: 'monospace',
          };
          return (
            <div
              style={{
                position: 'fixed', left: Math.min(pageMenu.x, window.innerWidth - 250), top: pageMenu.y,
                zIndex: 9999, background: '#1a1a1a', border: '1px solid #3a3a3a',
                borderRadius: 6, padding: '6px 0', minWidth: 240,
                boxShadow: '0 6px 28px rgba(0,0,0,0.75)',
              }}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <div style={{ padding: '8px 16px', color: '#8a8a8a', fontSize: 12, textTransform: 'uppercase', letterSpacing: 1 }}>
                page {idx + 1} · {pg?.name ?? ''}
              </div>
              <div style={{ height: 1, background: '#3a3a3a', margin: '4px 0' }} />
              <button style={{ ...item, color: canRemove ? pal('#ffad66') : '#555' }}
                disabled={!canRemove}
                onClick={() => {
                  if (!canRemove) return;
                  removePage(pageMenu.pageId);
                  setPageMenu(null);
                }}>
                ✕ Delete page{pg?.widgets.length ? ` (${pg.widgets.length} widgets)` : ''}
              </button>
              {!canRemove && (
                <div style={{ padding: '2px 16px 8px', color: '#555', fontSize: 12, fontFamily: 'monospace' }}>
                  the last page cannot be deleted
                </div>
              )}
              <div style={{ height: 1, background: '#3a3a3a', margin: '4px 0' }} />
              <button style={item} onClick={() => setPageMenu(null)}>cancel</button>
            </div>
          );
        })()}

        {/* Transport learn menu */}
        {tMenu && (() => {
          const item: React.CSSProperties = {
            display: 'block', width: '100%', minHeight: 38, padding: '9px 16px',
            background: 'none', border: 'none', cursor: 'pointer',
            fontSize: 14, color: '#ccc', textAlign: 'left', fontFamily: 'monospace',
          };
          const cur = transportMapping(tMenu.key);
          return (
            <div
              style={{
                position: 'fixed', left: Math.min(tMenu.x, window.innerWidth - 260), top: tMenu.y,
                zIndex: 9999, background: '#1a1a1a', border: '1px solid #3a3a3a',
                borderRadius: 6, padding: '6px 0', minWidth: 250,
                boxShadow: '0 6px 28px rgba(0,0,0,0.75)',
              }}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <div style={{ padding: '8px 16px', color: '#8a8a8a', fontSize: 12, textTransform: 'uppercase', letterSpacing: 1 }}>
                {tMenu.key}
              </div>
              <div style={{ height: 1, background: '#3a3a3a', margin: '4px 0' }} />
              <button style={item} onClick={() => { setTLearn({ key: tMenu.key, protocol: 'midi' }); setTMenu(null); }}>
                ⬤ Learn MIDI
              </button>
              <button style={item} onClick={() => { setTLearn({ key: tMenu.key, protocol: 'osc' }); setTMenu(null); }}>
                ⬤ Learn OSC
              </button>
              {cur && (
                <>
                  <div style={{ height: 1, background: '#3a3a3a', margin: '4px 0' }} />
                  <button style={{ ...item, color: pal('#ffad66') }}
                    onClick={() => { setTransportMapping(tMenu.key, null); setTMenu(null); }}>
                    ✕ Clear mapping
                  </button>
                </>
              )}
            </div>
          );
        })()}

        {/* Right spacer */}
        <div style={{ flex: 1 }} />


        {/* Reset — a second instance of the BPM-row ↺, up here at play/stop size
            so it can be hit without looking down at the smaller strip. */}
        <button
          style={{ ...styles.tapBtn, minWidth: 30,
            ...(resetFlash ? styles.resetBtnFlash : {}),
            ...(tLearn?.key === 'reset' ? styles.learnArmed : {}) }}
          title={transportTitle('reset', 'Reset all widgets to their start point')}
          onContextMenu={transportCtx('reset')}
          onPointerDown={(e) => { if (e.button !== 0) return; e.preventDefault(); resetRef.current(); }}
        >↺</button>

        {/* Global play / stop */}
        <button
          style={{ ...styles.tapBtn, minWidth: 30,
            ...(!isGlobalPlaying ? { background: 'var(--color-accent)', border: '1px solid var(--color-accent)', color: '#000' } : {}),
            ...(tLearn?.key === 'play' ? styles.learnArmed : {}) }}
          title={transportTitle('play', 'Play all widgets from the top')}
          onContextMenu={transportCtx('play')}
          onPointerDown={(e) => { if (e.button !== 0) return; e.preventDefault(); triggerGlobalPlay(); }}
        >▶</button>
        <button
          style={{ ...styles.tapBtn, minWidth: 30,
            ...(isGlobalPlaying ? { background: `rgba(${palRgb('#ffa250')},0.18)`, border: `1px solid rgba(${palRgb('#ffa250')},0.5)`, color: `rgba(${palRgb('#ffbc82')},1)` } : { opacity: 0.45 }),
            ...(tLearn?.key === 'stop' ? styles.learnArmed : {}) }}
          title={transportTitle('stop', 'Stop all widgets')}
          onContextMenu={transportCtx('stop')}
          onPointerDown={(e) => { if (e.button !== 0) return; e.preventDefault(); triggerGlobalStop(); }}
        >■</button>

        <div style={styles.sep} />

        {mode === 'design' && (
          <>
            <Btn onClick={isSettingsOpen ? closeSettings : openSettings} active={isSettingsOpen}>⚙ Settings</Btn>
            <Btn
              onClick={() => { if (activePageId) setMode('live'); }}
              accent
              disabled={!activePageId}
            >▶ Live</Btn>
          </>
        )}

        {mode === 'live' && (
          <Btn onClick={() => setMode('design')} disabled={isLocked}>Edit</Btn>
        )}

        <button
          onClick={toggleLock}
          style={{
            ...styles.lockBtn,
            background: isLocked ? '#fff' : 'var(--color-surface-2)',
            border: isLocked ? '1px solid #ccc' : '1px solid var(--color-border)',
            color: isLocked ? '#000' : 'var(--color-text-dim)',
          }}
          title={isLocked ? 'Unlock controls' : 'Lock controls'}
        >
          <svg width="12" height="15" viewBox="0 0 12 15" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <rect x="1" y="7" width="10" height="7" rx="1.5" fill="currentColor" fillOpacity={0.15}/>
            {isLocked
              ? <path d="M3 7V5a3 3 0 016 0v2"/>
              : <>
                  <path d="M3 7V5a3 3 0 016 0"/>
                  <line x1="9" y1="5" x2="9" y2="0.5"/>
                </>
            }
            <circle cx="6" cy="10.5" r="1.2" fill="currentColor" stroke="none"/>
          </svg>
        </button>
        {winState.displays > 1 && (
          <button onClick={() => void bridge.invoke('tr:window:nextDisplay', undefined as never)} title="Move Maestrale to the next screen" style={winBtn}>
            <svg width="16" height="12" viewBox="0 0 16 12" fill="none" stroke="currentColor" strokeWidth="1.4"><rect x="0.7" y="0.7" width="7" height="6" rx="1" /><rect x="8.3" y="5.3" width="7" height="6" rx="1" /><path d="M5 9.5 L7 9.5 M11 2.5 L9 2.5" /></svg>
          </button>
        )}
        <button onClick={() => void bridge.invoke('tr:window:toggleFullscreen', undefined as never)} title={winState.fullscreen ? 'Leave full screen (F11) — then drag the window anywhere' : 'Full screen (F11)'} style={winBtn}>
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            {winState.fullscreen
              ? <path d="M5 1 V5 H1 M8 1 V5 H12 M5 12 V8 H1 M8 12 V8 H12" />
              : <path d="M1 5 V1 H5 M12 5 V1 H8 M1 8 V12 H5 M12 8 V12 H8" />}
          </svg>
        </button>
        <button onClick={() => bridge.send('tr:window:minimize', undefined as never)} title="Minimise Maestrale" style={{ ...winBtn, fontSize: 14 }}>▁</button>
        <button onClick={handleClose} title="Close Maestrale" style={{ ...winBtn, fontSize: 14 }}>✕</button>
        {askClose && (
          <div onPointerDown={() => setAskClose(false)}
            style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div onPointerDown={(e) => e.stopPropagation()}
              onKeyDown={(e) => { if (e.key === 'Escape') setAskClose(false); }}
              style={{ background: '#151515', border: '1px solid #333', borderRadius: 6, padding: '18px 20px', width: 480, color: '#ddd', fontFamily: 'inherit' }}>
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>Close Maestrale?</div>
              <div style={{ fontSize: 12, color: '#999', marginBottom: 16 }}>The project has changed since it was last saved.</div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <Btn onClick={() => setAskClose(false)}>Cancel</Btn>
                <Btn onClick={async () => { setDiscarding(true); await bridge.invoke('tr:project:recoverClear', undefined as never).catch(() => {}); bridge.send('tr:window:close', undefined as never); }}>Close without saving</Btn>
                <button autoFocus onClick={async () => { if (await handleSave()) bridge.send('tr:window:close', undefined as never); }}
                  style={{ padding: '5px 14px', borderRadius: 3, cursor: 'pointer', background: 'var(--lf-orange)', color: '#000', border: 'none', fontWeight: 700, fontFamily: 'inherit' }}>
                  Save and close
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Row 2: BPM strip ── */}
      <div style={styles.bpmRow}>
        {/* BPM cell first */}
        <input
          type="number"
          min={20} max={300}
          value={bpmInput}
          onChange={(e) => setBpmInput(e.target.value)}
          onBlur={(e) => commitBpm(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && commitBpm(bpmInput)}
          style={{ ...styles.bpmRowInput, ...(bpmMode === 'auto' && autoBpmStatus.locked ? { color: pal('#7ec5ca') } : {}) }}
          readOnly={bpmMode === 'auto' && autoBpmStatus.locked}
        />
        <span style={styles.bpmLabel}>BPM</span>

        <div style={styles.sep} />

        {/* Reset */}
        <button
          style={{ ...styles.bpmRowRestartBtn, ...(resetFlash ? styles.resetBtnFlash : {}) }}
          title="Reset tap averaging and all widgets"
          onPointerDown={(e) => { e.preventDefault(); resetRef.current(); }}
        >↺</button>

        {/* TAP / AUTO mode toggle */}
        <div style={styles.bpmRowModeToggle}>
          <button
            style={{ ...styles.bpmRowModeBtn, ...(bpmMode === 'tap' ? styles.modeBtnActive : {}) }}
            onPointerDown={(e) => { e.preventDefault(); setBpmMode('tap'); }}
          >TAP</button>
          <button
            style={{ ...styles.bpmRowModeBtn, ...(bpmMode === 'auto' ? styles.modeBtnActive : {}) }}
            onPointerDown={(e) => { e.preventDefault(); setBpmMode('auto'); }}
          >AUTO</button>
        </div>

        {bpmMode === 'tap' ? (
          <button
            style={{ ...styles.bpmRowTapBtn, ...(tapFlash ? styles.tapBtnFlash : {}) }}
            onPointerDown={(e) => { e.preventDefault(); tapRef.current(); }}
          >TAP</button>
        ) : (
          <AutoBpmControls
            status={autoBpmStatus}
            config={autoBpmConfig}
            devices={audioDevices}
            deviceId={autoBpmAudioDeviceId}
            error={autoBpmError}
            onDeviceChange={setAutoBpmAudioDeviceId}
            onConfigChange={setAutoBpmConfig}
            onResetHistory={() => getAutoBpmSvc().resetHistory()}
            onRestartBar={() => { getAutoBpmSvc().restartBar(); resetRef.current(); }}
          />
        )}

        <div style={{ flex: 1 }} />

        {/* Router page — every link in the project, as one table. Lives with the
            protocol badges: it is about where signals go. */}
        <button
          onClick={() => useStore.getState().setRouterPageOpen(!routerPageOpen)}
          title="Router — every link in one table (search, filter, edit)"
          style={{
            display: 'flex', alignItems: 'center', height: 20, padding: '0 8px', marginRight: 2,
            cursor: 'pointer', fontFamily: 'monospace', fontSize: 11, fontWeight: 700, letterSpacing: 1,
            background: 'none', border: 'none', color: pal('#ff8a1f'),
            textDecoration: routerPageOpen ? 'underline' : 'none', textUnderlineOffset: 4,
          }}
        >
          Router
        </button>
        <LogBadge />
        {/* space · grey rule · space, then the protocols that light up when on */}
        <span style={{ width: 1, height: 16, background: '#3a3a3a', margin: '0 10px' }} />

        {/* All protocols + network at a glance: white = connected, grey = not */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {PROTO_BADGES.map((b) => (
            <StatusBadge key={b.type} label={b.label} connected={!!connectedProtocols[b.key]} />
          ))}
          <ArtNetInBadge />
          <SacnInBadge />
          <StatusBadge label="NET" connected={networkEnabled} />
        </div>
        {mode === 'live' && (
          <>
            <span style={{ width: 1, height: 16, background: '#3a3a3a', margin: '0 10px' }} />
            {/* Live params panel on the right — the arrow lives up here, so the
                canvas has no corner taken by it. */}
            <button
              title={liveSidebarOpen ? 'Close live params' : 'Open live params'}
              onClick={() => useStore.getState().setLiveSidebarOpen(!liveSidebarOpen)}
              style={{
                width: 24, height: 20, padding: 0, borderRadius: 3, cursor: 'pointer', fontSize: 10, lineHeight: 1,
                background: liveSidebarOpen ? 'rgba(255,255,255,0.12)' : 'none', color: liveSidebarOpen ? '#fff' : '#888',
                border: '1px solid #3a3a3a',
              }}
            >{liveSidebarOpen ? '▶' : '◀'}</button>
          </>
        )}
      </div>
    </div>
  );
}

// Small status pill — lit when the protocol/network is live, dim when only configured.
const PROTO_BADGES: { type: string; label: string; key: string }[] = [
  { type: 'midi',      label: 'MIDI', key: 'midi' },
  { type: 'midiInput', label: 'M·IN', key: 'midiInput' },
  { type: 'osc',       label: 'OSC',  key: 'osc' },
  { type: 'artnet',    label: 'ART',  key: 'artnet' },
  { type: 'sacn',      label: 'sACN', key: 'sacn' },
  { type: 'enttecDmx', label: 'DMX',  key: 'enttec' },
];

// Art-Net input: lit while packets are arriving, so "is the console reaching
// me?" is answered from the top bar.
function ArtNetInBadge(): React.JSX.Element {
  const [pps, setPps] = useState<number | null>(null);
  useEffect(() => onDmxInputStatus((s) => { if (s.protocol === 'artnet') setPps(s.listening ? s.packetsPerSec : null); }), []);
  return <StatusBadge label={pps ? `A·IN ${pps}` : 'A·IN'} connected={!!pps} />;
}

function SacnInBadge(): React.JSX.Element | null {
  const [pps, setPps] = useState<number | null>(null);
  const on = useStore((s) => s.project.connections.some((c) => c.type === 'sacnInput' && c.enabled));
  useEffect(() => onDmxInputStatus((s) => { if (s.protocol === 'sacn') setPps(s.listening ? s.packetsPerSec : null); }), []);
  if (!on) return null;
  return <StatusBadge label={pps ? `S·IN ${pps}` : 'S·IN'} connected={!!pps} />;
}

function StatusBadge({ label, connected }: { label: string; connected: boolean }): React.JSX.Element {
  return (
    <span
      title={connected ? `${label} — connected` : `${label} — not connected`}
      style={{
        fontSize: 9, fontWeight: 700, letterSpacing: 0.5, fontFamily: 'monospace',
        padding: '2px 6px', borderRadius: 3, lineHeight: 1, whiteSpace: 'nowrap',
        color: connected ? '#ffffff' : '#3a3a3a',
        background: connected ? 'rgba(255,255,255,0.12)' : 'transparent',
        border: `1px solid ${connected ? 'rgba(255,255,255,0.55)' : 'var(--color-border)'}`,
      }}
    >
      {label}
    </span>
  );
}

// ─── Auto BPM controls ────────────────────────────────────────────────────────

function AutoBpmControls({ status, config, devices, deviceId, error, onDeviceChange, onConfigChange, onResetHistory, onRestartBar }: {
  status: { locked: boolean; confidence: number; rawBpm: number; onsetStrength: number; dropArmed: boolean };
  config: AutoBpmConfig;
  devices: MediaDeviceInfo[];
  deviceId: string | null;
  error: string | null;
  onDeviceChange: (id: string | null) => void;
  onConfigChange: (patch: Partial<AutoBpmConfig>) => void;
  onResetHistory: () => void;
  onRestartBar: () => void;
}) {
  const [showConfig, setShowConfig] = useState(false);
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showConfig) return;
    function handleClick(e: MouseEvent) {
      if (popRef.current && !popRef.current.contains(e.target as Node)) setShowConfig(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showConfig]);

  const dotColor = error ? pal('#ff9b44') : status.locked ? pal('#7ec5ca') : pal('#ff8922');
  const dotTitle = error ? `Error: ${error}` : status.locked ? `Locked · conf ${(status.confidence*100).toFixed(0)}%` : 'Acquiring…';
  const confPct = Math.round(status.confidence * 100);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, position: 'relative' }}>
      {/* Lock indicator + confidence */}
      <div title={dotTitle} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: dotColor, boxShadow: `0 0 4px ${dotColor}`, flexShrink: 0 }} />
        <div style={{ width: 36, height: 4, background: 'var(--color-border)', borderRadius: 2, overflow: 'hidden' }}>
          <div style={{ width: `${confPct}%`, height: '100%', background: dotColor, transition: 'width 0.3s' }} />
        </div>
      </div>

      {/* Audio device selector */}
      <select
        title="Audio input device"
        style={{ ...autoSelectStyle, maxWidth: 130 }}
        value={deviceId ?? ''}
        onChange={(e) => onDeviceChange(e.target.value || null)}
      >
        <option value="">Default input</option>
        {devices.map((d) => (
          <option key={d.deviceId} value={d.deviceId}>{d.label || `Input ${d.deviceId.slice(0,6)}`}</option>
        ))}
      </select>

      {/* Club mode quick toggle */}
      <button
        title="Club Mode: round BPM to nearest integer, bias toward 120–128"
        style={{ ...autoIconBtn, ...(config.clubMode ? { color: 'var(--color-accent)', border: '1px solid var(--color-accent)' } : {}) }}
        onPointerDown={(e) => { e.preventDefault(); onConfigChange({ clubMode: !config.clubMode }); }}
      >CLUB</button>

      {/* Drop armed indicator */}
      {status.dropArmed && (
        <span style={{ fontSize: 9, color: pal('#ff8922'), padding: '0 3px', fontWeight: 700, letterSpacing: '0.05em', animation: 'none' }}>
          DROP
        </span>
      )}

      {/* Reset history */}
      <button title="Reset BPM history" style={autoIconBtn} onPointerDown={(e) => { e.preventDefault(); onResetHistory(); }}>↺H</button>

      {/* Restart bar */}
      <button title="Restart bar (re-align beat)" style={autoIconBtn} onPointerDown={(e) => { e.preventDefault(); onRestartBar(); }}>⟳</button>

      {/* Config popover toggle */}
      <button title="Auto BPM settings" style={{ ...autoIconBtn, ...(showConfig ? { color: 'var(--color-accent)', border: '1px solid var(--color-accent)' } : {}) }}
        onPointerDown={(e) => { e.preventDefault(); setShowConfig((v) => !v); }}>⚙</button>

      {showConfig && (
        <div ref={popRef} style={{
          position: 'absolute', bottom: 'calc(100% + 4px)', right: 0,
          background: 'var(--color-surface)', border: '1px solid var(--color-border-bright)',
          borderRadius: 4, padding: '10px 12px', zIndex: 9999,
          display: 'flex', flexDirection: 'column', gap: 7, minWidth: 200,
          boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
        }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--color-accent)', marginBottom: 2 }}>AUTO BPM CONFIG</div>
          <CfgRow label="Min BPM">
            <NumCfg value={config.minBpm} onChange={(v) => onConfigChange({ minBpm: Math.max(30, Math.min(config.maxBpm - 1, v)) })} />
          </CfgRow>
          <CfgRow label="Max BPM">
            <NumCfg value={config.maxBpm} onChange={(v) => onConfigChange({ maxBpm: Math.max(config.minBpm + 1, Math.min(300, v)) })} />
          </CfgRow>
          <CfgRow label="Sensitivity">
            <NumCfg value={config.sensitivity} onChange={(v) => onConfigChange({ sensitivity: Math.max(0.2, Math.min(3, v)) })} step={0.1} />
          </CfgRow>
          <CfgRow label="Stability">
            <NumCfg value={config.stability} onChange={(v) => onConfigChange({ stability: Math.max(0, Math.min(0.995, v)) })} step={0.01} />
          </CfgRow>
          <CfgRow label="Window (s)">
            <NumCfg value={config.analysisWindowSec} onChange={(v) => onConfigChange({ analysisWindowSec: Math.max(2, Math.min(32, v)) })} />
          </CfgRow>
          <CfgRow label="Attack (ms)">
            <NumCfg value={config.attackMs} onChange={(v) => onConfigChange({ attackMs: Math.max(0.5, Math.min(50, v)) })} step={0.5} />
          </CfgRow>
          <CfgRow label="Release (ms)">
            <NumCfg value={config.releaseMs} onChange={(v) => onConfigChange({ releaseMs: Math.max(10, Math.min(500, v)) })} step={5} />
          </CfgRow>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <Toggle label="Club Mode" value={config.clubMode} onChange={(v) => onConfigChange({ clubMode: v })} />
            <Toggle label="Mic Mode"  value={config.micMode}  onChange={(v) => onConfigChange({ micMode: v })} />
            <Toggle label="Auto Drop Restart" value={config.autoDropRestart} onChange={(v) => onConfigChange({ autoDropRestart: v })} />
          </div>
          {status.rawBpm > 0 && (
            <div style={{ fontSize: 9, color: 'var(--color-text-dim)', marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>
              raw {status.rawBpm.toFixed(1)} · conf {confPct}% · onset {(status.onsetStrength * 100).toFixed(0)}%
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const autoSelectStyle: React.CSSProperties = {
  height: 20, fontSize: 9, padding: '0 3px',
  background: 'var(--color-surface-2)', border: '1px solid var(--color-border)',
  color: 'var(--color-text)', borderRadius: 'var(--radius-sm)', fontFamily: 'inherit',
};
const autoIconBtn: React.CSSProperties = {
  height: 20, padding: '0 5px', fontSize: 9, fontFamily: 'inherit', cursor: 'pointer',
  background: 'var(--color-surface-2)', border: '1px solid var(--color-border)',
  color: 'var(--color-text-dim)', borderRadius: 'var(--radius-sm)',
  display: 'flex', alignItems: 'center',
};

function CfgRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
      <span style={{ fontSize: 10, color: 'var(--color-text-dim)', flexShrink: 0 }}>{label}</span>
      {children}
    </div>
  );
}

function NumCfg({ value, onChange, step = 1 }: { value: number; onChange: (v: number) => void; step?: number }) {
  return (
    <input
      type="number"
      step={step}
      value={value}
      onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) onChange(v); }}
      style={{ width: 64, height: 24, textAlign: 'right', fontSize: 10, padding: '0 4px',
        background: '#000', border: '1px solid var(--color-border)', color: 'var(--color-accent)',
        borderRadius: 2, fontFamily: 'inherit', fontVariantNumeric: 'tabular-nums' }}
    />
  );
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
      <span style={{ fontSize: 10, color: 'var(--color-text-dim)' }}>{label}</span>
      <button
        onPointerDown={(e) => { e.preventDefault(); onChange(!value); }}
        style={{
          width: 36, height: 18, borderRadius: 9, border: 'none', cursor: 'pointer', position: 'relative',
          background: value ? 'var(--color-accent)' : 'var(--color-border)', transition: 'background 0.15s',
        }}
      >
        <div style={{
          position: 'absolute', top: 3, left: value ? 18 : 3,
          width: 12, height: 12, borderRadius: '50%', background: value ? '#000' : 'var(--color-text-dim)',
          transition: 'left 0.15s',
        }} />
      </button>
    </div>
  );
}

// ─── Page button ──────────────────────────────────────────────────────────────

function PageBtn({ label, title, active, dimmed, bg, wide, onClick,
  draggable, dragging, dropSide, onDragStart, onDragOver, onDrop, onDragEnd, onContextMenu }: {
  label: string;
  title: string;
  active: boolean;
  dimmed: boolean;
  bg: string;
  wide?: boolean;
  onClick: () => void;
  draggable?: boolean;
  dragging?: boolean;
  dropSide?: 'left' | 'right' | null;
  onDragStart?: () => void;
  onDragOver?: () => void;
  onDrop?: () => void;
  onDragEnd?: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
}) {
  const fgColor = active ? contrastColor(bg.startsWith('#') ? bg : '#111') : 'var(--color-text-dim)';
  return (
    <button
      title={title}
      onClick={onClick}
      draggable={draggable}
      onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; onDragStart?.(); }}
      onDragOver={(e) => { if (!onDragOver) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; onDragOver(); }}
      onDrop={(e) => { if (!onDrop) return; e.preventDefault(); onDrop(); }}
      onDragEnd={() => onDragEnd?.()}
      onContextMenu={onContextMenu}
      style={{
        // Which edge the dragged page would land on. Drawn as an inset shadow
        // rather than a border so the button does not change size mid-drag.
        boxShadow: dropSide === 'left'  ? 'inset 3px 0 0 0 var(--color-accent)'
                 : dropSide === 'right' ? 'inset -3px 0 0 0 var(--color-accent)'
                 : undefined,
        width: wide ? 72 : 42,
        height: 40,
        padding: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        fontSize: 11,
        fontWeight: 700,
        fontFamily: 'inherit',
        letterSpacing: '0.04em',
        borderRadius: 'var(--radius-sm)',
        background: active ? bg : 'var(--color-surface-2)',
        border: `1px solid ${active ? 'var(--color-accent)' : 'var(--color-border)'}`,
        color: fgColor,
        ...(dimmed ? { opacity: 0.3 } : dragging ? { opacity: 0.35 } : { opacity: 1 }),
        transition: 'background 0.08s, color 0.08s',
        pointerEvents: dimmed ? 'none' : undefined,
        cursor: dimmed ? 'default' : draggable ? 'grab' : 'pointer',
      }}
    >
      {label}
    </button>
  );
}

// ─── Generic bar button ───────────────────────────────────────────────────────

function Btn({
  children, onClick, disabled, active, accent,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  accent?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        ...styles.btn,
        ...(accent   ? styles.btnAccent   : {}),
        ...(active   ? styles.btnActive   : {}),
        ...(disabled ? styles.btnDisabled : {}),
      }}
    >
      {children}
    </button>
  );
}

// ─── Learn-mode router picker ─────────────────────────────────────────────────
// Drops under the two learn buttons. Same question the right-click Learn entry
// asks, so both routes into learn behave alike.


// ─── Learn-mode button ────────────────────────────────────────────────────────
// Half height, so two of them stack into the same footprint as one Save/Load.

function LearnBtn({ label, on, disabled, title, onClick }: {
  label: string; on: boolean; disabled?: boolean; title?: string; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        ...styles.btn,
        height: 20,
        padding: '0 10px',
        fontSize: 10,
        letterSpacing: '0.12em',
        fontWeight: 700,
        ...(on ? { background: pal('#ff7700'), border: `1px solid ${pal('#ff7700')}`, color: '#000' } : {}),
        ...(disabled ? styles.btnDisabled : {}),
      }}
    >
      {label}
    </button>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const make_styles = (): Record<string, React.CSSProperties> => ({
  outerBar: {
    display: 'flex',
    flexDirection: 'column',
    flexShrink: 0,
    background: 'var(--color-surface)',
    borderBottom: '1px solid var(--color-border-bright)',
    fontFamily: 'inherit',
  },
  bar: {
    height: 50,
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '0 12px',
    position: 'relative',
  },
  bpmRow: {
    // As tall as the row above, for touch: the whole strip is drawn 1.6× (zoom),
    // so every control in it grows with it.
    height: 31,
    zoom: 1.6,
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '0 12px',
    borderTop: '1px solid var(--color-border)',
  },
  pageCenter: {
    position: 'absolute',
    left: '50%',
    transform: 'translateX(-50%)',
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    pointerEvents: 'auto',
  },
  logo: {
    fontWeight: 700,
    fontSize: 13,
    marginRight: 4,
    color: 'var(--color-accent)',
    letterSpacing: '0.22em',
    textTransform: 'uppercase',
  },
  sep: {
    width: 1,
    height: 16,
    background: 'var(--color-border)',
    margin: '0 2px',
  },
  btn: {
    background: 'var(--color-surface-2)',
    border: '1px solid var(--color-border)',
    color: 'var(--color-text)',
    borderRadius: 'var(--radius-sm)',
    padding: '0 14px',
    height: 42,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 'var(--font-size-md)',
    cursor: 'pointer',
    fontFamily: 'inherit',
    letterSpacing: '0.05em',
    boxSizing: 'border-box',
  },
  btnAccent: {
    background: 'var(--color-accent)',
    border: '1px solid var(--color-accent)',
    color: '#000',
    fontWeight: 700,
  },
  btnActive: {
    background: 'var(--color-accent-dim)',
    border: '1px solid var(--color-accent)',
    color: 'var(--color-accent)',
  },
  learnArmed: {
    background: pal('#ff7700'),
    border: `1px solid ${pal('#ff7700')}`,
    color: '#000',
  },
  btnDisabled: {
    opacity: 0.3,
    cursor: 'default',
    pointerEvents: 'none',
  },
  bpmInput: {
    width: 70,
    height: 42,
    textAlign: 'center',
    borderRadius: 1,
    padding: '0 6px',
    background: '#000',
    border: '1px solid var(--color-border)',
    color: 'var(--color-accent)',
    fontSize: 16,
    fontFamily: 'inherit',
    fontWeight: 700,
    fontVariantNumeric: 'tabular-nums',
    letterSpacing: '0.05em',
    outline: 'none',
    boxSizing: 'border-box',
  },
  bpmRowInput: {
    width: 62,
    height: 20,
    textAlign: 'center',
    borderRadius: 1,
    padding: '0 4px',
    background: '#000',
    border: '1px solid var(--color-border)',
    color: 'var(--color-accent)',
    fontSize: 13,
    fontFamily: 'inherit',
    fontWeight: 700,
    fontVariantNumeric: 'tabular-nums',
    letterSpacing: '0.05em',
    outline: 'none',
    boxSizing: 'border-box',
  },
  bpmLabel: {
    fontSize: 9,
    color: 'var(--color-text-dim)',
    marginLeft: -3,
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
  },
  restartBtn: {
    background: 'none',
    border: 'none',
    color: 'var(--color-text-dim)',
    cursor: 'pointer',
    fontSize: 16,
    padding: '0 6px',
    height: 42,
    display: 'flex',
    alignItems: 'center',
    lineHeight: 1,
    fontFamily: 'inherit',
    boxSizing: 'border-box',
  },
  bpmRowRestartBtn: {
    background: 'none',
    border: 'none',
    color: 'var(--color-text-dim)',
    cursor: 'pointer',
    fontSize: 14,
    padding: '0 4px',
    height: 20,
    display: 'flex',
    alignItems: 'center',
    lineHeight: 1,
    fontFamily: 'inherit',
    boxSizing: 'border-box',
  },
  tapBtn: {
    background: 'var(--color-surface-2)',
    border: '1px solid var(--color-border)',
    color: 'var(--color-text-dim)',
    borderRadius: 'var(--radius-sm)',
    padding: '0 14px',
    height: 42,
    display: 'flex',
    alignItems: 'center',
    fontSize: 12,
    fontFamily: 'inherit',
    letterSpacing: '0.12em',
    cursor: 'pointer',
    fontWeight: 600,
    transition: 'background 0.05s, color 0.05s, border-color 0.05s',
    boxSizing: 'border-box',
  },
  bpmRowTapBtn: {
    background: 'var(--color-surface-2)',
    border: '1px solid var(--color-border)',
    color: 'var(--color-text-dim)',
    borderRadius: 'var(--radius-sm)',
    padding: '0 10px',
    height: 20,
    display: 'flex',
    alignItems: 'center',
    fontSize: 10,
    fontFamily: 'inherit',
    letterSpacing: '0.12em',
    cursor: 'pointer',
    fontWeight: 600,
    transition: 'background 0.05s, color 0.05s, border-color 0.05s',
    boxSizing: 'border-box',
  },
  tapBtnFlash: {
    background: 'var(--color-accent)',
    border: '1px solid var(--color-accent)',
    color: '#000',
  },
  resetBtnFlash: {
    color: '#000',
    background: 'var(--color-accent)',
    borderRadius: 'var(--radius-sm)',
  },
  lockBtn: {
    borderRadius: 'var(--radius-sm)',
    padding: '0 12px',
    height: 42,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: 'inherit',
    boxSizing: 'border-box',
  },
  modeToggle: {
    display: 'flex',
    height: 30,
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-sm)',
    overflow: 'hidden',
    flexShrink: 0,
  },
  bpmRowModeToggle: {
    display: 'flex',
    height: 20,
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-sm)',
    overflow: 'hidden',
    flexShrink: 0,
  },
  modeBtn: {
    padding: '0 9px',
    fontSize: 10,
    fontWeight: 600,
    fontFamily: 'inherit',
    letterSpacing: '0.08em',
    cursor: 'pointer',
    background: 'var(--color-surface-2)',
    border: 'none',
    color: 'var(--color-text-dim)',
    transition: 'background 0.08s, color 0.08s',
  },
  bpmRowModeBtn: {
    padding: '0 7px',
    fontSize: 9,
    fontWeight: 600,
    fontFamily: 'inherit',
    letterSpacing: '0.08em',
    cursor: 'pointer',
    background: 'var(--color-surface-2)',
    border: 'none',
    color: 'var(--color-text-dim)',
    transition: 'background 0.08s, color 0.08s',
  },
  modeBtnActive: {
    background: 'var(--color-accent)',
    color: '#000',
  },
});
let styles: Record<string, React.CSSProperties> = make_styles();
onPalette(() => { styles = make_styles(); });
