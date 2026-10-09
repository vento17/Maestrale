import { pal } from '../../palette';
import React, { useEffect, useRef, useState } from 'react';
import type { AutoBpmWidget, BeatOutput } from '../../../shared/types/project';
import { BEAT_DIVISORS } from '../../../shared/types/project';
import { useStore } from '../../store';
import { dispatchValue } from '../../ipc/dispatch';

const DRAG_DATA_KEY = 'application/liveforge-bpm-output';

function startBpmDrag(e: React.DragEvent, mapping: BeatOutput['triggerMapping'] | BeatOutput['rampMapping']) {
  if (!mapping) { e.preventDefault(); return; }
  e.dataTransfer.effectAllowed = 'link';
  e.dataTransfer.setData(DRAG_DATA_KEY, JSON.stringify({ mapping }));
}

export default function AutoBpmLive({ widget }: { widget: AutoBpmWidget }): React.JSX.Element {
  const masterBpm      = useStore((s) => s.masterBpm);
  const autoBpmStatus  = useStore((s) => s.autoBpmStatus);
  const globalResetTick = useStore((s) => s.globalResetTick);
  const globalPlayTick  = useStore((s) => s.globalPlayTick);

  const masterBpmRef = useRef(masterBpm);
  masterBpmRef.current = masterBpm;
  const widgetRef = useRef(widget);
  widgetRef.current = widget;

  const accBeatsRef   = useRef(0);
  const lastNowRef    = useRef(0);
  // prevFloorRef[i] = last Math.floor(accBeats / D) for divisor i
  const prevFloorRef  = useRef<number[]>(BEAT_DIVISORS.map(() => -1));
  // triggerFlashRef[i] = performance.now() expiry timestamp for trigger flash (0 = off)
  const triggerFlashRef = useRef<number[]>(BEAT_DIVISORS.map(() => 0));

  const [display, setDisplay] = useState<{ ramps: number[]; triggers: boolean[] }>({
    ramps: BEAT_DIVISORS.map(() => 0),
    triggers: BEAT_DIVISORS.map(() => false),
  });

  // Always-running RAF beat clock — created once, reads live values via refs
  useEffect(() => {
    let rafId: number;

    function tick(now: number) {
      const dt = now - lastNowRef.current;
      lastNowRef.current = now;

      // Guard against large dt from tab-hidden pauses
      if (dt > 0 && dt < 300) {
        accBeatsRef.current += dt * masterBpmRef.current / 60000;
      }

      const acc = accBeatsRef.current;
      const w = widgetRef.current;
      const newRamps    = BEAT_DIVISORS.map((D) => (acc / D) % 1);
      const newTriggers = triggerFlashRef.current.map((exp) => now < exp);

      for (let i = 0; i < BEAT_DIVISORS.length; i++) {
        const D     = BEAT_DIVISORS[i];
        const floor = Math.floor(acc / D);

        if (floor !== prevFloorRef.current[i]) {
          prevFloorRef.current[i]    = floor;
          triggerFlashRef.current[i] = now + 120;
          newTriggers[i] = true;

          const out = w.beatOutputs[i];
          if (out?.triggerMapping) dispatchValue(out.triggerMapping, 1);
          useStore.getState().setCellValue(w.id, i, 1);

          // Reset trigger after 50 ms
          const idx = i;
          setTimeout(() => {
            const wo = widgetRef.current.beatOutputs[idx];
            if (wo?.triggerMapping) dispatchValue(wo.triggerMapping, 0);
            useStore.getState().setCellValue(widgetRef.current.id, idx, 0);
          }, 50);
        }

        // Continuous ramp dispatch to protocol mapping
        const out = w.beatOutputs[i];
        if (out?.rampMapping) dispatchValue(out.rampMapping, newRamps[i]);
      }

      // Write all ramp values to runtime in one batched update so Router can read them
      useStore.getState().setRampCells(w.id, BEAT_DIVISORS.length, newRamps);

      setDisplay({ ramps: newRamps, triggers: newTriggers });
      rafId = requestAnimationFrame(tick);
    }

    lastNowRef.current = performance.now();
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, []);

  // Re-align beat phase on global reset or play
  useEffect(() => {
    accBeatsRef.current = 0;
    prevFloorRef.current = BEAT_DIVISORS.map(() => -1);
    lastNowRef.current = performance.now();
  }, [globalResetTick, globalPlayTick]);

  const color  = widget.style.foregroundColor || '#e0e0e0';
  const locked = autoBpmStatus.locked;

  return (
    <div style={{
      width: '100%', height: '100%', padding: '6px 8px',
      boxSizing: 'border-box', display: 'flex', flexDirection: 'column',
      gap: 3, fontFamily: 'monospace', overflow: 'hidden',
    }}>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, marginBottom: 2 }}>
        <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: 2, color: '#505050', textTransform: 'uppercase' }}>
          ◈ bpm clock
        </span>
        <span style={{ fontSize: 11, color: locked ? color : '#666', fontWeight: 600, marginLeft: 'auto' }}>
          {masterBpm} BPM
        </span>
        <span style={{
          width: 6, height: 6, borderRadius: '50%', flexShrink: 0, display: 'inline-block',
          background: locked ? pal('#3b8b91') : '#333',
        }} />
      </div>

      {/* Divisor rows */}
      {BEAT_DIVISORS.map((D, i) => {
        const isHot = display.triggers[i];
        const out = widget.beatOutputs[i];
        return (
          <div key={D} style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minHeight: 0 }}>
            {/* Divisor label */}
            <span style={{ fontSize: 9, color: isHot ? color : '#505050', width: 22, textAlign: 'right', flexShrink: 0, transition: 'color 0.06s' }}>
              x{D}
            </span>

            {/* Ramp progress bar — draggable to link to slider/knob */}
            <div
              draggable={!!out?.rampMapping}
              title={out?.rampMapping ? 'Drag to link ramp to a slider or knob cell' : undefined}
              onDragStart={(e) => startBpmDrag(e, out?.rampMapping ?? null)}
              style={{
                flex: 1, height: '50%', maxHeight: 10,
                background: 'rgba(255,255,255,0.05)',
                borderRadius: 2, overflow: 'hidden', position: 'relative',
                cursor: out?.rampMapping ? 'grab' : 'default',
              }}
            >
              <div style={{
                position: 'absolute', left: 0, top: 0, bottom: 0,
                width: `${display.ramps[i] * 100}%`,
                background: isHot ? color : color + '45',
                transition: display.ramps[i] < 0.02 ? 'none' : 'background 0.06s',
                borderRadius: 2,
                pointerEvents: 'none',
              }} />
            </div>

            {/* Trigger flash dot — draggable to link to button cells */}
            <div
              draggable={!!out?.triggerMapping}
              title={out?.triggerMapping ? 'Drag to link trigger to a button cell' : undefined}
              onDragStart={(e) => startBpmDrag(e, out?.triggerMapping ?? null)}
              style={{
                width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                background: isHot ? color : color + '18',
                boxShadow: isHot ? `0 0 6px ${color}` : 'none',
                transition: isHot ? 'none' : 'background 0.1s, box-shadow 0.1s',
                cursor: out?.triggerMapping ? 'grab' : 'default',
              }}
            />
          </div>
        );
      })}
    </div>
  );
}
