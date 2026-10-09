import React, { useState, useEffect, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { StepSequencerWidget, SpeedMultiplier } from '../../../shared/types/project';
import type { Mapping } from '../../../shared/types/mapping';
import { useGlobalTransport } from '../base/useGlobalTransport';
import { getParamInput, onParamInputs, genSpeedFromInput } from '../base/paramInputs';
import { useStore } from '../../store';
import { dispatchValue } from '../../ipc/dispatch';

const SPEED_OPTIONS: { label: string; value: SpeedMultiplier }[] = [
  { label: '1/8', value: 0.125 },
  { label: '1/4', value: 0.25  },
  { label: '1/2', value: 0.5   },
  { label: '1x',  value: 1     },
  { label: '2x',  value: 2     },
  { label: '4x',  value: 4     },
  { label: '8x',  value: 8     },
];

function fmtValue(normalized: number, mapping: Mapping): string {
  if (!mapping || mapping.type === 'osc') return normalized.toFixed(2);
  const scaled = normalized * (mapping.maxValue - mapping.minValue) + mapping.minValue;
  return String(Math.round(scaled));
}

export default function StepSequencerLive({ widget }: { widget: StepSequencerWidget }): React.JSX.Element {
  const { activePageId, updateWidget, masterBpm } = useStore(useShallow((s) => ({
    activePageId:     s.activePageId,
    updateWidget:     s.updateWidget,
    masterBpm:        s.masterBpm,
  })));

  const color = widget.style.foregroundColor;
  const dim   = 'rgba(255,255,255,0.3)';

  const [isPlaying,   setIsPlaying]   = useState(false);
  const [isReverse,   setIsReverse]   = useState(false);
  const [currentStep, setCurrentStep] = useState(-1);
  const [localSpeed,  setLocalSpeed]  = useState<SpeedMultiplier>(widget.speedMultiplier);

  const isPlayingRef    = useRef(false);
  const isReverseRef    = useRef(false);
  const currentStepRef  = useRef(-1);
  const masterBpmRef    = useRef(masterBpm);
  const localSpeedRef   = useRef(localSpeed);

  // RAF-based beat accumulator (replaces setTimeout drift-correction)
  const rafRef       = useRef(0);
  const accBeatsRef  = useRef(0);
  const lastNowRef   = useRef(0);
  const outRef       = useRef(0);   // smoothed output value
  const lastSentRef  = useRef(-1);  // last value dispatched (to avoid spamming)

  const widgetRef         = useRef(widget);
  const activePageIdRef   = useRef(activePageId);
  const updateWidgetRef   = useRef(updateWidget);
  widgetRef.current       = widget;
  activePageIdRef.current = activePageId;
  updateWidgetRef.current = updateWidget;
  masterBpmRef.current    = masterBpm;
  localSpeedRef.current   = localSpeed;

  // RAF tick — created once, reads live values via refs
  useEffect(() => {
    function tick(now: number) {
      // Stop freezes TIME, not the parameters: the playhead stays on its step,
      // but editing that step (or RND/MAX/ZERO) still moves the output instead
      // of waiting for the next play.
      const running = isPlayingRef.current;
      const dt = now - lastNowRef.current;
      lastNowRef.current = now;

      if (running && dt > 0 && dt < 300) {
        accBeatsRef.current += dt * masterBpmRef.current / 60000 * localSpeedRef.current;
      }

      const w    = widgetRef.current;
      const n    = w.stepCount;
      const beatFloor = Math.floor(accBeatsRef.current);
      const step = isReverseRef.current
        ? (n - 1 - (beatFloor % n))
        : beatFloor % n;

      if (step !== currentStepRef.current) {
        currentStepRef.current = step;
        setCurrentStep(step);
      }

      // Target = the current step's value; slew the output toward it. With
      // smooth = 0 the output snaps (dispatched only on change); with smooth > 0
      // it ramps every frame (exponential slew, up to ~0.6 s time constant).
      const s = w.steps[step];
      const target = s?.active ? s.value : 0;
      const smooth = running ? (w.smooth ?? 0) : 0;
      if (smooth <= 0) {
        outRef.current = target;
      } else {
        const dtS = Math.min(dt, 100) / 1000;
        const k = 1 - Math.exp(-dtS / (smooth * 0.6));
        outRef.current += (target - outRef.current) * k;
      }

      const out = outRef.current;
      if (Math.abs(out - lastSentRef.current) > 0.0005) {
        lastSentRef.current = out;
        if (w.mapping) dispatchValue(w.mapping, out);
        useStore.getState().setCellValue(w.id, 0, out);   // so Router can use it as source
      }

      rafRef.current = requestAnimationFrame(tick);
    }

    lastNowRef.current = performance.now();
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  function startPlaying() {
    if (isPlayingRef.current) return;
    isPlayingRef.current = true;
    setIsPlaying(true);
    const w = widgetRef.current;
    currentStepRef.current = -1;
    // Start just before beat 0 so the first step fires on the next RAF tick
    accBeatsRef.current = isReverseRef.current ? w.stepCount - 0.001 : -0.001;
    lastNowRef.current = performance.now();
  }

  function stopPlaying() {
    isPlayingRef.current = false;
    setIsPlaying(false);
    setCurrentStep(-1);
    currentStepRef.current = -1;
    const m = widgetRef.current.mapping;
    if (m) dispatchValue(m, 0);
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

  function toggleReverse() {
    const next = !isReverseRef.current;
    isReverseRef.current = next;
    setIsReverse(next);
  }

  function handleSpeedChange(speed: SpeedMultiplier) {
    setLocalSpeed(speed);
    if (activePageIdRef.current)
      updateWidgetRef.current(activePageIdRef.current, widgetRef.current.id, { speedMultiplier: speed } as never);
  }

  function handleRandom() {
    if (!activePageIdRef.current) return;
    // Randomize values only — keep every step active so they all output their
    // value (no dark "rest" steps that would send 0).
    const newSteps = widgetRef.current.steps.map(() => ({
      active: true,
      value:  Math.random(),
    }));
    updateWidgetRef.current(activePageIdRef.current, widgetRef.current.id, { steps: newSteps } as never);
  }

  function handleMax() {
    if (!activePageIdRef.current) return;
    const newSteps = widgetRef.current.steps.map((s) => ({ ...s, active: true, value: 1 }));
    updateWidgetRef.current(activePageIdRef.current, widgetRef.current.id, { steps: newSteps } as never);
  }

  function handleZero() {
    if (!activePageIdRef.current) return;
    const newSteps = widgetRef.current.steps.map((s) => ({ ...s, active: false, value: 0 }));
    updateWidgetRef.current(activePageIdRef.current, widgetRef.current.id, { steps: newSteps } as never);
  }

  const dragRef = useRef<{ index: number; startY: number; moved: boolean; rect: DOMRect } | null>(null);

  function handleStepPointerDown(e: React.PointerEvent<HTMLDivElement>, i: number) {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { index: i, startY: e.clientY, moved: false, rect: e.currentTarget.getBoundingClientRect() };
    e.preventDefault();
  }

  function handleStepPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragRef.current || !activePageIdRef.current) return;
    const { index, startY, rect } = dragRef.current;
    if (Math.abs(e.clientY - startY) > 4) dragRef.current.moved = true;
    if (!dragRef.current.moved) return;
    const newValue = Math.max(0, Math.min(1, 1 - (e.clientY - rect.top) / rect.height));
    const newSteps = widgetRef.current.steps.map((s, idx) =>
      idx === index ? { ...s, value: newValue, active: true } : s
    );
    updateWidgetRef.current(activePageIdRef.current, widgetRef.current.id, { steps: newSteps } as never);
  }

  function handleStepPointerUp(i: number) {
    if (!dragRef.current) return;
    const { moved } = dragRef.current;
    dragRef.current = null;
    if (!moved && activePageIdRef.current) {
      const newSteps = widgetRef.current.steps.map((s, idx) =>
        idx === i ? { ...s, active: !s.active } : s
      );
      updateWidgetRef.current(activePageIdRef.current, widgetRef.current.id, { steps: newSteps } as never);
    }
  }

  useEffect(() => { setLocalSpeed(widget.speedMultiplier); }, [widget.speedMultiplier]);

  const startPlayingRef = useRef(startPlaying);
  const stopPlayingRef  = useRef(stopPlaying);
  startPlayingRef.current = startPlaying;
  stopPlayingRef.current  = stopPlaying;

  useGlobalTransport({
    start: () => startPlayingRef.current(),
    stop:  () => stopPlayingRef.current(),
    // Restarting IS the way back to step one for this widget.
    reset: () => {
      const wasPlaying = isPlayingRef.current;
      stopPlayingRef.current();
      if (wasPlaying) startPlayingRef.current();
    },
  });


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
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', boxSizing: 'border-box', padding: 8, gap: 6 }}>

      {/* ── Controls row ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>

        {/* Stop */}
        <button
          style={{ ...btn, minWidth: 26,
            color: isPlaying ? color : dim,
            background: 'rgba(0,0,0,0.4)',
            border: `1px solid ${isPlaying ? color + '55' : 'rgba(255,255,255,0.08)'}` }}
          onPointerDown={(e) => { e.preventDefault(); stopPlaying(); }}
        >■</button>

        {/* Play */}
        <button
          style={{ ...btn, minWidth: 26,
            color: !isPlaying ? color : dim,
            background: !isPlaying ? color + '22' : 'rgba(0,0,0,0.4)',
            border: `1px solid ${!isPlaying ? color + '55' : 'rgba(255,255,255,0.08)'}` }}
          onPointerDown={(e) => { e.preventDefault(); startPlaying(); }}
        >▶</button>

        {/* Reverse toggle */}
        <button
          style={{ ...btn, minWidth: 26,
            color: isReverse ? color : dim,
            background: isReverse ? color + '22' : 'rgba(0,0,0,0.4)',
            border: `1px solid ${isReverse ? color + '55' : 'rgba(255,255,255,0.08)'}` }}
          onPointerDown={(e) => { e.preventDefault(); toggleReverse(); }}
        >◀</button>

        <div style={{ width: 1, height: 16, background: 'rgba(255,255,255,0.12)', margin: '0 1px', flexShrink: 0 }} />

        {/* Utility buttons */}
        {([['RND', handleRandom], ['MAX', handleMax], ['ZERO', handleZero]] as [string, () => void][]).map(([label, action]) => (
          <button
            key={label}
            style={{ ...btn, fontSize: 11, padding: '5px 8px',
              color: dim, background: 'rgba(0,0,0,0.25)',
              border: '1px solid rgba(255,255,255,0.07)' }}
            onPointerDown={(e) => { e.preventDefault(); action(); }}
          >{label}</button>
        ))}

        {/* Smooth (slew) on the output — between ZERO and the speeds */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 6, flexShrink: 0 }}
          title="Output smoothing (slew)">
          <span style={{ fontSize: 8, letterSpacing: 1, color: dim }}>SMTH</span>
          <input
            type="range" min={0} max={1} step={0.01}
            value={widget.smooth ?? 0}
            onPointerDown={(e) => e.stopPropagation()}
            onChange={(e) => {
              if (activePageIdRef.current)
                updateWidgetRef.current(activePageIdRef.current, widgetRef.current.id, { smooth: parseFloat(e.target.value) } as never);
            }}
            style={{ width: 60, cursor: 'pointer', accentColor: color }}
          />
        </div>

        <div style={{ flex: 1 }} />

        {/* Speed */}
        {SPEED_OPTIONS.map(({ label, value }) => (
          <button
            key={value}
            style={{
              ...btn, fontSize: 11, minWidth: 30, padding: '5px 8px',
              background: localSpeed === value ? color + '33' : 'rgba(0,0,0,0.25)',
              color:      localSpeed === value ? color          : 'rgba(255,255,255,0.4)',
              border:     `1px solid ${localSpeed === value ? color + '66' : 'rgba(255,255,255,0.07)'}`,
            }}
            onPointerDown={(e) => { e.preventDefault(); handleSpeedChange(value); }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── Steps ── */}
      <div style={{ flex: 1, display: 'flex', gap: 3, alignItems: 'stretch', minHeight: 0 }}>
        {widget.steps.map((step, i) => {
          const isCurrent = i === currentStep;
          const fillPct   = Math.round(step.value * 100);
          const valLabel  = fmtValue(step.value, widget.mapping);

          const fillColor = isCurrent
            ? (step.active ? color + 'dd' : 'rgba(255,255,255,0.22)')
            : (step.active ? color + '55' : 'rgba(255,255,255,0.06)');

          return (
            <div
              key={i}
              style={{
                flex: 1, position: 'relative', borderRadius: 2, overflow: 'hidden',
                background: 'rgba(0,0,0,0.35)',
                border: `1px solid ${isCurrent ? color : (step.active ? color + '44' : 'rgba(255,255,255,0.07)')}`,
                cursor: 'ns-resize', touchAction: 'none', userSelect: 'none', boxSizing: 'border-box',
              }}
              onPointerDown={(e) => handleStepPointerDown(e, i)}
              onPointerMove={handleStepPointerMove}
              onPointerUp={() => handleStepPointerUp(i)}
            >
              {isCurrent && (
                <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: color, zIndex: 2 }} />
              )}

              <div style={{
                position: 'absolute', bottom: 0, left: 0, right: 0,
                height: `${fillPct}%`,
                background: fillColor,
              }} />

              <div style={{
                position: 'absolute', bottom: 2, width: '100%', textAlign: 'center',
                fontSize: 9, pointerEvents: 'none', fontVariantNumeric: 'tabular-nums',
                color: step.active ? (isCurrent ? '#fff' : color + 'cc') : 'rgba(255,255,255,0.18)',
              }}>
                {valLabel}
              </div>

              <div style={{
                position: 'absolute', top: 4, width: '100%', textAlign: 'center',
                fontSize: 8, pointerEvents: 'none',
                color: isCurrent ? '#fff' : 'rgba(255,255,255,0.18)',
              }}>
                {i + 1}
              </div>
            </div>
          );
        })}
      </div>

    </div>
  );
}

const btn: React.CSSProperties = {
  padding: '6px 11px', borderRadius: 3, fontSize: 13, fontWeight: 600,
  cursor: 'pointer', userSelect: 'none', touchAction: 'none', flexShrink: 0,
  fontFamily: 'inherit',
};
