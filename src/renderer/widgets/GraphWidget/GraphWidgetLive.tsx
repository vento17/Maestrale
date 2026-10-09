import { pal, palRgb } from '../../palette';
import React, { useState, useRef, useEffect } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { GraphWidget, GraphPoint, SpeedMultiplier } from '../../../shared/types/project';
import type { MidiMapping, OscMapping } from '../../../shared/types/mapping';
import { useGlobalTransport } from '../base/useGlobalTransport';
import { getParamInput, onParamInputs, genSpeedFromInput } from '../base/paramInputs';
import { useStore } from '../../store';
import { dispatchValue } from '../../ipc/dispatch';
import { addLane, LaneBar } from '../base/phaseLanes';
import { bridge } from '../../ipc/bridge';

const SPEED_OPTIONS: { label: string; value: SpeedMultiplier }[] = [
  { label: '1/8', value: 0.125 }, { label: '1/4', value: 0.25 },
  { label: '1/2', value: 0.5   }, { label: '1x',  value: 1    },
  { label: '2x',  value: 2     }, { label: '4x',  value: 4    },
  { label: '8x',  value: 8     },
];

function defaultCpRight(p0: GraphPoint, p1: GraphPoint): [number, number] {
  return [p0.x + (p1.x - p0.x) / 3, p0.y];
}
function defaultCpLeft(p0: GraphPoint, p1: GraphPoint): [number, number] {
  return [p1.x - (p1.x - p0.x) / 3, p1.y];
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
        const cpr = p0.cpRight ?? defaultCpRight(p0, p1);
        const cpl = p1.cpLeft  ?? defaultCpLeft(p0, p1);
        d += ` C ${cpr[0]*100} ${(1-cpr[1])*100} ${cpl[0]*100} ${(1-cpl[1])*100} ${x1} ${y1}`;
        break;
      }
    }
  }
  return d;
}

function getValueAt(t: number, points: GraphPoint[]): number {
  if (points.length === 0) return 0;
  if (points.length === 1) return points[0].y;
  t = Math.max(0, Math.min(1, t));
  if (t <= points[0].x) return points[0].y;
  if (t >= points[points.length - 1].x) return points[points.length - 1].y;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i], p1 = points[i + 1];
    if (t >= p0.x && t <= p1.x) {
      const lt = (t - p0.x) / (p1.x - p0.x);
      switch (p0.mode) {
        case 'linear': return p0.y + lt * (p1.y - p0.y);
        case 'square': return p0.y;
        case 'bezier': {
          const st = lt * lt * (3 - 2 * lt);
          return p0.y + st * (p1.y - p0.y);
        }
      }
    }
  }
  return points[points.length - 1].y;
}

// ＋ lanes: the same curve, read `phase` of a cycle further along (wrapping).
function emitLanes(w: GraphWidget, t: number): void {
  (w.lanes ?? []).forEach((l, k) => {
    const lt = (((t + l.phase) % 1) + 1) % 1;
    useStore.getState().setCellValue(w.id, k + 1, getValueAt(lt, w.points));
  });
}

export default function GraphWidgetLive({ widget }: { widget: GraphWidget }): React.JSX.Element {
  const { activePageId, updateWidget, masterBpm } = useStore(useShallow((s) => ({
    activePageId:    s.activePageId,
    updateWidget:    s.updateWidget,
    masterBpm:       s.masterBpm,
  })));

  const color = widget.style.foregroundColor;
  const dim   = 'rgba(255,255,255,0.3)';

  const timingMode    = widget.timingMode    ?? 'bpm';
  const manualDuration = widget.manualDuration ?? 4;
  const playMode      = widget.playMode      ?? 'loop';

  const [isPlaying,     setIsPlaying]     = useState(false);
  const [playhead,      setPlayhead]      = useState(0);
  const [localSpeed,    setLocalSpeed]    = useState<SpeedMultiplier>(widget.speedMultiplier);
  const [selectedPoint, setSelectedPoint] = useState<number | null>(null);
  const [isReverse,     setIsReverse]     = useState(false);
  const [durationInput, setDurationInput] = useState(String(manualDuration));

  const isPlayingRef       = useRef(false);
  const isReverseRef       = useRef(false);
  const tRef               = useRef(0);
  const lastNowRef         = useRef(0);
  const rafRef             = useRef(0);
  const masterBpmRef       = useRef(masterBpm);
  const localSpeedRef      = useRef(localSpeed);
  const timingModeRef      = useRef(timingMode);
  const manualDurationRef  = useRef(manualDuration);
  const playModeRef        = useRef(playMode);
  const widgetRef          = useRef(widget);
  const activePageIdRef    = useRef(activePageId);
  const updateWidgetRef    = useRef(updateWidget);
  const selectedPointRef   = useRef<number | null>(null);
  const playMappingRef     = useRef(widget.playMapping    ?? null);
  const stopMappingRef     = useRef(widget.stopMapping    ?? null);
  const reverseMappingRef  = useRef(widget.reverseMapping ?? null);

  widgetRef.current         = widget;
  activePageIdRef.current   = activePageId;
  updateWidgetRef.current   = updateWidget;
  masterBpmRef.current      = masterBpm;
  localSpeedRef.current     = localSpeed;
  selectedPointRef.current  = selectedPoint;
  timingModeRef.current     = timingMode;
  manualDurationRef.current = manualDuration;
  playModeRef.current       = playMode;
  isReverseRef.current      = isReverse;
  playMappingRef.current    = widget.playMapping    ?? null;
  stopMappingRef.current    = widget.stopMapping    ?? null;
  reverseMappingRef.current = widget.reverseMapping ?? null;

  const containerRef  = useRef<HTMLDivElement>(null);
  const pointDragRef  = useRef<{ index: number } | null>(null);
  const pointMovedRef = useRef(false);
  const cpDragRef     = useRef<{ ptIdx: number; side: 'left' | 'right' } | null>(null);

  function getCycleDuration(): number {
    if (timingModeRef.current === 'manual') return manualDurationRef.current * 1000;
    return (60 / masterBpmRef.current) / localSpeedRef.current * 1000;
  }

  // ── Tick (RAF) ─────────────────────────────────────────────────────────────

  const tickRef = useRef<(now: number) => void>(null!);
  tickRef.current = function tick(now: number) {
    if (!isPlayingRef.current) return;
    const dt = now - lastNowRef.current;
    lastNowRef.current = now;

    const direction = isReverseRef.current ? -1 : 1;
    let next = tRef.current + direction * dt / getCycleDuration();
    let stopped = false;

    if (direction > 0 && next >= 1) {
      if (playModeRef.current === 'once') { next = 1; stopped = true; }
      else next = next % 1;
    } else if (direction < 0 && next <= 0) {
      if (playModeRef.current === 'once') { next = 0; stopped = true; }
      else next = 1 + next; // wrap backwards: -0.05 → 0.95
    }

    tRef.current = Math.max(0, Math.min(1, next));
    setPlayhead(tRef.current);
    const w = widgetRef.current;
    const graphVal = getValueAt(tRef.current, w.points);
    useStore.getState().setCellValue(w.id, 0, graphVal);
    if (w.mapping) dispatchValue(w.mapping, graphVal);
    emitLanes(w, tRef.current);

    if (stopped) {
      isPlayingRef.current = false;
      setIsPlaying(false);
      rafRef.current = 0;
      return;
    }
    rafRef.current = requestAnimationFrame((n) => tickRef.current(n));
  };

  // Stop freezes TIME, not the curve. The tick loop shuts down entirely when
  // stopped, so rather than idling a frame loop just to notice edits, recompute
  // at the frozen playhead whenever the points change.
  useEffect(() => {
    if (isPlayingRef.current) return;
    const w = widgetRef.current;
    const v = getValueAt(tRef.current, w.points);
    useStore.getState().setCellValue(w.id, 0, v);
    if (w.mapping) dispatchValue(w.mapping, v);
    emitLanes(w, tRef.current);
  }, [widget.points, widget.lanes]);

  // ── Transport ──────────────────────────────────────────────────────────────

  function startPlaying() {
    if (isPlayingRef.current) return;
    isPlayingRef.current = true;
    setIsPlaying(true);
    tRef.current = isReverseRef.current ? 1 : 0;
    lastNowRef.current = performance.now();
    rafRef.current = requestAnimationFrame((n) => tickRef.current(n));
  }

  function stopPlaying() {
    isPlayingRef.current = false;
    setIsPlaying(false);
    setPlayhead(0);
    tRef.current = 0;
    cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
    const w = widgetRef.current;
    if (w.mapping) dispatchValue(w.mapping, 0);
  }


  // PLAY (level: ≥ 0.5 plays), SPEED (steps across a fader, not saved) and
  // RESET (each press restarts) from the Router — see paramInputs GEN_INPUTS.
  const genFns = useRef({ start: startPlaying, stop: stopPlaying, speed: (s: SpeedMultiplier) => { setLocalSpeed(s); } });
  genFns.current = { start: startPlaying, stop: stopPlaying, speed: (s: SpeedMultiplier) => { setLocalSpeed(s); } };
  useEffect(() => {
    let lastPlay: boolean | undefined;
    let lastSpeed: number | undefined;
    let lastReset = 0;
    return onParamInputs(() => {
      const id = widgetRef.current.id;
      const pv = getParamInput(id, 'play');
      if (pv !== undefined) {
        const on = pv >= 0.5;
        if (on !== lastPlay) { lastPlay = on; if (on) genFns.current.start(); else genFns.current.stop(); }
      }
      const sv = getParamInput(id, 'speed');
      if (sv !== undefined) {
        const s = genSpeedFromInput(sv);
        if (s !== lastSpeed) { lastSpeed = s; genFns.current.speed(s); }
      }
      const rv = getParamInput(id, 'reset') ?? 0;
      if (rv >= 0.5 && lastReset < 0.5 && isPlayingRef.current) { genFns.current.stop(); genFns.current.start(); }
      lastReset = rv;
    });
  }, []);

  // ── Widget setting changes ─────────────────────────────────────────────────

  function handleSpeedChange(speed: SpeedMultiplier) {
    setLocalSpeed(speed);
    if (activePageIdRef.current)
      updateWidgetRef.current(activePageIdRef.current, widgetRef.current.id, { speedMultiplier: speed } as never);
  }

  function handleTimingModeChange(mode: 'bpm' | 'manual') {
    if (activePageIdRef.current)
      updateWidgetRef.current(activePageIdRef.current, widgetRef.current.id, { timingMode: mode } as never);
  }

  function commitDuration(raw: string) {
    const v = parseFloat(raw);
    if (!isNaN(v) && v >= 0.1) {
      const rounded = Math.round(v * 10) / 10;
      setDurationInput(String(rounded));
      if (activePageIdRef.current)
        updateWidgetRef.current(activePageIdRef.current, widgetRef.current.id, { manualDuration: rounded } as never);
    } else {
      setDurationInput(String(manualDurationRef.current));
    }
  }

  function handlePlayModeToggle() {
    const next = playModeRef.current === 'loop' ? 'once' : 'loop';
    if (activePageIdRef.current)
      updateWidgetRef.current(activePageIdRef.current, widgetRef.current.id, { playMode: next } as never);
  }

  // ── Curve editing ──────────────────────────────────────────────────────────

  function setPointMode(mode: GraphPoint['mode']) {
    const idx = selectedPointRef.current;
    if (idx === null || !activePageIdRef.current) return;
    const points = widgetRef.current.points.map((p, i) => i === idx ? { ...p, mode } : p);
    updateWidgetRef.current(activePageIdRef.current, widgetRef.current.id, { points } as never);
  }

  function deleteSelectedPoint() {
    const idx = selectedPointRef.current;
    if (idx === null || !activePageIdRef.current) return;
    const pts = widgetRef.current.points;
    if (pts.length <= 2) return;
    const newPoints = pts.filter((_, i) => i !== idx);
    updateWidgetRef.current(activePageIdRef.current, widgetRef.current.id, { points: newPoints } as never);
    setSelectedPoint(null);
    selectedPointRef.current = null;
  }

  function getContainerNorm(clientX: number, clientY: number): { x: number; y: number } | null {
    const el = containerRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, 1 - (clientY - rect.top) / rect.height)),
    };
  }

  function handlePointPointerDown(e: React.PointerEvent<HTMLDivElement>, i: number) {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    pointDragRef.current  = { index: i };
    pointMovedRef.current = false;
    e.preventDefault();
  }

  function handlePointPointerMove(e: React.PointerEvent<HTMLDivElement>, i: number) {
    if (!pointDragRef.current || pointDragRef.current.index !== i) return;
    const pos = getContainerNorm(e.clientX, e.clientY);
    if (!pos || !activePageIdRef.current) return;
    pointMovedRef.current = true;
    const points = [...widgetRef.current.points];
    const minX = i > 0 ? points[i - 1].x + 0.01 : 0;
    const maxX = i < points.length - 1 ? points[i + 1].x - 0.01 : 1;
    const newX = i === 0 ? 0 : i === points.length - 1 ? 1 : Math.max(minX, Math.min(maxX, pos.x));
    points[i] = { ...points[i], x: newX, y: pos.y };
    updateWidgetRef.current(activePageIdRef.current, widgetRef.current.id, { points } as never);
  }

  function handlePointPointerUp(i: number) {
    if (!pointMovedRef.current) {
      setSelectedPoint(i);
      selectedPointRef.current = i;
    }
    pointDragRef.current  = null;
    pointMovedRef.current = false;
  }

  function handleCpPointerDown(e: React.PointerEvent<HTMLDivElement>, ptIdx: number, side: 'left' | 'right') {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    cpDragRef.current = { ptIdx, side };
    e.preventDefault();
  }

  function handleCpPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!cpDragRef.current || !activePageIdRef.current) return;
    const { ptIdx, side } = cpDragRef.current;
    const pos = getContainerNorm(e.clientX, e.clientY);
    if (!pos) return;
    const pts = [...widgetRef.current.points];
    pts[ptIdx] = side === 'right'
      ? { ...pts[ptIdx], cpRight: [pos.x, pos.y] }
      : { ...pts[ptIdx], cpLeft:  [pos.x, pos.y] };
    updateWidgetRef.current(activePageIdRef.current, widgetRef.current.id, { points: pts } as never);
  }

  function handleCpPointerUp() { cpDragRef.current = null; }

  function handleBgPointerDown() {
    setSelectedPoint(null);
    selectedPointRef.current = null;
  }

  function handleBgDoubleClick(e: React.MouseEvent<HTMLDivElement>) {
    const pos = getContainerNorm(e.clientX, e.clientY);
    if (!pos || !activePageIdRef.current) return;
    const newPoint: GraphPoint = { x: pos.x, y: pos.y, mode: 'linear' };
    const points = [...widgetRef.current.points, newPoint].sort((a, b) => a.x - b.x);
    updateWidgetRef.current(activePageIdRef.current, widgetRef.current.id, { points } as never);
  }

  // ── Sync effects ───────────────────────────────────────────────────────────

  useEffect(() => { setLocalSpeed(widget.speedMultiplier); },             [widget.speedMultiplier]);
  useEffect(() => { setDurationInput(String(widget.manualDuration ?? 4)); }, [widget.manualDuration]);

  const startPlayingRef = useRef(startPlaying);
  const stopPlayingRef  = useRef(stopPlaying);
  startPlayingRef.current = startPlaying;
  stopPlayingRef.current  = stopPlaying;

  // ── Remote trigger refs ───────────────────────────────────────────────────

  const handlePlayRef = useRef<() => void>(null!);
  handlePlayRef.current = () => { startPlayingRef.current(); };

  const handleStopRef = useRef<() => void>(null!);
  handleStopRef.current = () => { stopPlayingRef.current(); };

  const handleReverseRef = useRef<() => void>(null!);
  handleReverseRef.current = () => {
    const next = !isReverseRef.current;
    isReverseRef.current = next;
    setIsReverse(next);
  };

  // Play trigger: OSC
  useEffect(() => bridge.on('tr:osc:feedback', (msg) => {
    const m = playMappingRef.current;
    if (!m || m.type !== 'osc') return;
    if (msg.address === (m as OscMapping).address) handlePlayRef.current();
  }), []);

  // Play trigger: MIDI
  useEffect(() => bridge.on('tr:midi:inputEvent', (evt) => {
    const m = playMappingRef.current;
    if (!m || m.type !== 'midi') return;
    const mm = m as MidiMapping;
    const isCC   = mm.messageType === 'controlChange' && evt.messageType === 'controlChange' && evt.channel === mm.channel && evt.number === mm.number;
    const isNote = mm.messageType === 'noteOn'        && evt.messageType === 'noteOn'        && evt.channel === mm.channel && evt.number === mm.number;
    if (isCC || isNote) handlePlayRef.current();
  }), []);

  // Stop trigger: OSC
  useEffect(() => bridge.on('tr:osc:feedback', (msg) => {
    const m = stopMappingRef.current;
    if (!m || m.type !== 'osc') return;
    if (msg.address === (m as OscMapping).address) handleStopRef.current();
  }), []);

  // Stop trigger: MIDI
  useEffect(() => bridge.on('tr:midi:inputEvent', (evt) => {
    const m = stopMappingRef.current;
    if (!m || m.type !== 'midi') return;
    const mm = m as MidiMapping;
    const isCC   = mm.messageType === 'controlChange' && evt.messageType === 'controlChange' && evt.channel === mm.channel && evt.number === mm.number;
    const isNote = mm.messageType === 'noteOn'        && evt.messageType === 'noteOn'        && evt.channel === mm.channel && evt.number === mm.number;
    if (isCC || isNote) handleStopRef.current();
  }), []);

  // Reverse trigger: OSC
  useEffect(() => bridge.on('tr:osc:feedback', (msg) => {
    const m = reverseMappingRef.current;
    if (!m || m.type !== 'osc') return;
    if (msg.address === (m as OscMapping).address) handleReverseRef.current();
  }), []);

  // Reverse trigger: MIDI
  useEffect(() => bridge.on('tr:midi:inputEvent', (evt) => {
    const m = reverseMappingRef.current;
    if (!m || m.type !== 'midi') return;
    const mm = m as MidiMapping;
    const isCC   = mm.messageType === 'controlChange' && evt.messageType === 'controlChange' && evt.channel === mm.channel && evt.number === mm.number;
    const isNote = mm.messageType === 'noteOn'        && evt.messageType === 'noteOn'        && evt.channel === mm.channel && evt.number === mm.number;
    if (isCC || isNote) handleReverseRef.current();
  }), []);

  useGlobalTransport({
    start: () => startPlayingRef.current(),
    stop:  () => stopPlayingRef.current(),
    // Restarting IS the way back to the top of the curve for this widget.
    reset: () => {
      const wasPlaying = isPlayingRef.current;
      stopPlayingRef.current();
      if (wasPlaying) startPlayingRef.current();
    },
  });

  useEffect(() => () => {
    isPlayingRef.current = false;
    cancelAnimationFrame(rafRef.current);
  }, []);

  // ── Derived display values ─────────────────────────────────────────────────

  const { points } = widget;
  const pathD   = buildPath(points);
  const firstPt = points[0];
  const lastPt  = points[points.length - 1];
  const selMode = selectedPoint !== null ? points[selectedPoint]?.mode ?? null : null;
  const canDel  = selectedPoint !== null && points.length > 2;

  const selPt   = selectedPoint !== null ? points[selectedPoint] : null;
  const hasBez  = selPt?.mode === 'bezier';
  const cpRData = (hasBez && selectedPoint! < points.length - 1)
    ? (selPt!.cpRight ?? defaultCpRight(selPt!, points[selectedPoint! + 1]))
    : null;
  const cpLData = (hasBez && selectedPoint! > 0)
    ? (selPt!.cpLeft ?? defaultCpLeft(points[selectedPoint! - 1], selPt!))
    : null;

  // Second markers for manual mode
  const secMarkers = timingMode === 'manual' && manualDuration > 1
    ? Array.from({ length: Math.floor(manualDuration) - 1 }, (_, i) => (i + 1) / manualDuration)
    : [];

  // ── Render ─────────────────────────────────────────────────────────────────


  // ─── Transport ↔ store ──────────────────────────────────────────────────────
  // Mirror play/stop into the runtime so a Cue can snapshot it, and follow the
  // store when a cue recall drives it back. The guard on isPlayingRef stops the
  // two halves from chasing each other.
  useEffect(() => {
    useStore.getState().setWidgetPlaying(widget.id, isPlaying);
  }, [isPlaying, widget.id]);

  useEffect(() => useStore.subscribe((s) => {
    const want = s.runtime.widgets[widget.id]?.playing;
    if (want === undefined || want === isPlayingRef.current) return;
    if (want) startPlayingRef.current(); else stopPlayingRef.current();
  }), [widget.id]);

  return (
    <div
      style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', boxSizing: 'border-box', padding: 8, gap: 5, outline: 'none' }}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelectedPoint(); }
      }}
    >

      {/* ── Row 1: Transport + Timing ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>

        {/* Play */}
        <button
          style={{ ...btn, minWidth: 28,
            color: isPlaying ? color : dim,
            background: isPlaying ? color + '33' : 'rgba(0,0,0,0.4)',
            border: `1px solid ${isPlaying ? color : color + '44'}` }}
          onPointerDown={(e) => { e.preventDefault(); startPlaying(); }}
          title="Play"
        >▶</button>

        {/* Stop */}
        <button
          style={{ ...btn, minWidth: 28,
            color: !isPlaying ? color : dim,
            background: 'rgba(0,0,0,0.4)',
            border: `1px solid ${!isPlaying ? color + '55' : 'rgba(255,255,255,0.08)'}` }}
          onPointerDown={(e) => { e.preventDefault(); stopPlaying(); }}
          title="Stop"
        >■</button>

        {/* Reverse */}
        <button
          style={{ ...btn, minWidth: 26,
            color: isReverse ? color : dim,
            background: isReverse ? color + '22' : 'rgba(0,0,0,0.4)',
            border: `1px solid ${isReverse ? color + '55' : 'rgba(255,255,255,0.08)'}` }}
          onPointerDown={(e) => { e.preventDefault(); handleReverseRef.current(); }}
          title="Toggle reverse direction"
        >◀</button>

        {/* Loop / Once */}
        <button
          style={{ ...btn, minWidth: 26, fontSize: 10,
            color: playMode === 'loop' ? color : 'rgba(255,255,255,0.55)',
            background: 'rgba(0,0,0,0.4)',
            border: '1px solid rgba(255,255,255,0.1)' }}
          onPointerDown={(e) => { e.preventDefault(); handlePlayModeToggle(); }}
          title={playMode === 'loop' ? 'Loop (click for once)' : 'Play once (click for loop)'}
        >{playMode === 'loop' ? '↺' : '→|'}</button>

        <div style={{ width: 1, height: 16, background: 'rgba(255,255,255,0.12)', margin: '0 1px', flexShrink: 0 }} />

        {/* Timing mode: BPM / SEC */}
        {(['bpm', 'manual'] as const).map((m) => (
          <button key={m}
            style={{ ...btn, fontSize: 11, padding: '5px 8px',
              color:      timingMode === m ? color        : 'rgba(255,255,255,0.35)',
              background: timingMode === m ? color + '22' : 'rgba(0,0,0,0.3)',
              border:     `1px solid ${timingMode === m ? color + '55' : 'rgba(255,255,255,0.08)'}` }}
            onPointerDown={(e) => { e.preventDefault(); handleTimingModeChange(m); }}
          >{m === 'bpm' ? 'BPM' : 'SEC'}</button>
        ))}

        <div style={{ flex: 1 }} />

        {/* BPM mode: speed buttons */}
        {timingMode === 'bpm' && SPEED_OPTIONS.map(({ label, value }) => (
          <button key={value}
            style={{ ...btn, fontSize: 11, minWidth: 30, padding: '5px 8px',
              background: localSpeed === value ? color + '33' : 'rgba(0,0,0,0.25)',
              color:      localSpeed === value ? color          : 'rgba(255,255,255,0.4)',
              border:     `1px solid ${localSpeed === value ? color + '66' : 'rgba(255,255,255,0.07)'}` }}
            onPointerDown={(e) => { e.preventDefault(); handleSpeedChange(value); }}
          >{label}</button>
        ))}

        {/* Manual mode: duration input */}
        {timingMode === 'manual' && (
          <>
            <input
              type="number" min={0.1} step={0.1}
              value={durationInput}
              onChange={(e) => setDurationInput(e.target.value)}
              onBlur={(e) => commitDuration(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && commitDuration(durationInput)}
              style={{
                width: 60, textAlign: 'center', borderRadius: 3, padding: '5px 6px',
                background: '#000', border: `1px solid ${color + '55'}`,
                color, fontSize: 14, fontFamily: 'inherit', fontWeight: 700,
                fontVariantNumeric: 'tabular-nums', outline: 'none',
              }}
            />
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginLeft: -1 }}>s</span>
          </>
        )}
      </div>

      {/* ── Row 2: Point mode buttons ── */}
      <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
        {(['linear', 'bezier', 'square'] as const).map((m) => (
          <button key={m}
            style={{ ...btn, flex: 1, fontSize: 11, padding: '5px 8px',
              color:      selMode === m ? color : selectedPoint !== null ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.2)',
              background: selMode === m ? color + '33' : 'rgba(0,0,0,0.25)',
              border:     `1px solid ${selMode === m ? color + '66' : 'rgba(255,255,255,0.07)'}`,
              opacity:    selectedPoint !== null ? 1 : 0.35 }}
            onPointerDown={(e) => { e.preventDefault(); setPointMode(m); }}
          >{m}</button>
        ))}
        <button
          style={{ ...btn, fontSize: 11, minWidth: 38, padding: '5px 8px',
            color:      canDel ? `rgba(${palRgb('#ffb26e')},0.85)` : `rgba(${palRgb('#ffb26e')},0.2)`,
            background: 'rgba(0,0,0,0.25)',
            border:     `1px solid ${canDel ? `rgba(${palRgb('#ffac64')},0.35)` : 'rgba(255,255,255,0.07)'}`,
            opacity:    canDel ? 1 : 0.35 }}
          onPointerDown={(e) => { e.preventDefault(); deleteSelectedPoint(); }}
        >del</button>

        {/* ＋ output with its own phase */}
        <button
          style={{ ...btn, minWidth: 24, color: '#aaa', background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.15)' }}
          onPointerDown={(e) => { e.preventDefault(); addLane(widget); }}
          title="Add an output reading the curve with its own phase"
        >＋</button>
      </div>

      {/* ── Curve area ── */}
      <div
        ref={containerRef}
        style={{ flex: 1, position: 'relative', minHeight: 0, cursor: 'crosshair', touchAction: 'none', userSelect: 'none' }}
        onPointerDown={handleBgPointerDown}
        onDoubleClick={handleBgDoubleClick}
      >
        {/* Second markers (manual mode only) */}
        {secMarkers.map((x, i) => (
          <div key={i} style={{
            position: 'absolute', left: `${x * 100}%`, top: 0, bottom: 0, width: 1,
            background: 'rgba(255,255,255,0.13)', pointerEvents: 'none',
          }}>
            <span style={{
              position: 'absolute', bottom: 2, left: 3,
              fontSize: 8, color: 'rgba(255,255,255,0.3)', whiteSpace: 'nowrap', pointerEvents: 'none',
            }}>{i + 1}s</span>
          </div>
        ))}

        {/* Main SVG */}
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
          {isPlaying && (
            <line x1={playhead * 100} y1={0} x2={playhead * 100} y2={100}
              stroke={color} strokeWidth={1} opacity={0.9} vectorEffect="non-scaling-stroke" />
          )}
          {selPt && cpRData && (
            <line
              x1={selPt.x * 100} y1={(1 - selPt.y) * 100}
              x2={cpRData[0] * 100} y2={(1 - cpRData[1]) * 100}
              stroke={color + '77'} strokeWidth={0.8} strokeDasharray="2,2" vectorEffect="non-scaling-stroke"
            />
          )}
          {selPt && cpLData && (
            <line
              x1={selPt.x * 100} y1={(1 - selPt.y) * 100}
              x2={cpLData[0] * 100} y2={(1 - cpLData[1]) * 100}
              stroke={color + '77'} strokeWidth={0.8} strokeDasharray="2,2" vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>

        {/* Point handles */}
        {points.map((p, i) => {
          const isSelected  = i === selectedPoint;
          const modeColor: Record<string, string> = { linear: color, bezier: pal('#abd9dc'), square: pal('#ff9b44') };
          const borderColor = modeColor[p.mode] ?? color;
          return (
            <div key={i} style={{
              position: 'absolute',
              left: `${p.x * 100}%`, top: `${(1 - p.y) * 100}%`,
              width:  isSelected ? 14 : 10,
              height: isSelected ? 14 : 10,
              transform: 'translate(-50%, -50%)',
              borderRadius: '50%',
              background: isSelected ? borderColor + '44' : widget.style.backgroundColor,
              border: `${isSelected ? 2.5 : 2}px solid ${borderColor}`,
              cursor: 'grab', boxSizing: 'border-box', touchAction: 'none', zIndex: isSelected ? 2 : 1,
            }}
              onPointerDown={(e) => handlePointPointerDown(e, i)}
              onPointerMove={(e) => handlePointPointerMove(e, i)}
              onPointerUp={() => handlePointPointerUp(i)}
            />
          );
        })}

        {/* Bezier right handle */}
        {cpRData && (
          <div style={{
            position: 'absolute',
            left: `${cpRData[0] * 100}%`, top: `${(1 - cpRData[1]) * 100}%`,
            width: 8, height: 8, transform: 'translate(-50%, -50%)', borderRadius: 2,
            background: '#88aaff55', border: `1.5px solid ${pal('#abd9dc')}`,
            cursor: 'move', touchAction: 'none', zIndex: 3, boxSizing: 'border-box',
          }}
            onPointerDown={(e) => handleCpPointerDown(e, selectedPoint!, 'right')}
            onPointerMove={handleCpPointerMove}
            onPointerUp={handleCpPointerUp}
          />
        )}

        {/* Bezier left handle */}
        {cpLData && (
          <div style={{
            position: 'absolute',
            left: `${cpLData[0] * 100}%`, top: `${(1 - cpLData[1]) * 100}%`,
            width: 8, height: 8, transform: 'translate(-50%, -50%)', borderRadius: 2,
            background: '#88aaff55', border: `1.5px solid ${pal('#abd9dc')}`,
            cursor: 'move', touchAction: 'none', zIndex: 3, boxSizing: 'border-box',
          }}
            onPointerDown={(e) => handleCpPointerDown(e, selectedPoint!, 'left')}
            onPointerMove={handleCpPointerMove}
            onPointerUp={handleCpPointerUp}
          />
        )}
      </div>

      {(widget.lanes?.length ?? 0) > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, flexShrink: 0, height: Math.min(4, widget.lanes!.length) * 18 }}>
          {widget.lanes!.map((l, k) => <LaneBar key={l.id} widget={widget} index={k + 1} color={color} />)}
        </div>
      )}

      {widget.style.showLabel && (
        <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.18)', textAlign: 'center', flexShrink: 0 }}>
          dbl-click to add · click point to select · del to remove
        </div>
      )}
    </div>
  );
}

const btn: React.CSSProperties = {
  padding: '6px 11px', borderRadius: 3, fontSize: 13, fontWeight: 600,
  cursor: 'pointer', userSelect: 'none', touchAction: 'none', flexShrink: 0,
  fontFamily: 'inherit',
};
