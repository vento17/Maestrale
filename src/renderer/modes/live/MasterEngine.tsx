import { useEffect } from 'react';
import type { MasterLevelWidget } from '../../../shared/types/project';
import { useStore } from '../../store';
import { setMasterGain, clearMasterGain, resetMasterGains } from '../../ipc/dispatch';
import { resendProtocol } from '../../ipc/resend';
import { setAudioMaster } from '../../audio/audioMaster';

const PROTOCOLS = ['midi', 'osc', 'artnet', 'sacn', 'enttec'] as const;
type Protocol = typeof PROTOCOLS[number];

// Headless engine: applies every MasterLevel's runtime value as a per-protocol
// output gain, across ALL pages. This is what makes a master cross-page — its
// gain is honored even while its own page isn't shown (drive it from an Instance
// on another page). Absent protocols are cleared so deleting a master restores
// full output.
//
// Changing a gain also re-sends the protocol's parked values (see resend.ts):
// the gain is a multiplier applied on send, so without this a master fader would
// leave anything that is not actively moving stuck at its last-sent level.
function applyGains(last: Partial<Record<Protocol, number>>, resend: (p: Protocol) => void): void {
  const state = useStore.getState();
  const desired: Partial<Record<Protocol, number>> = {};
  for (const page of state.project.pages) {
    for (const w of page.widgets) {
      if (w.kind !== 'masterLevel') continue;
      const m = w as MasterLevelWidget;
      const v = state.runtime.widgets[m.id]?.cells[0]?.value ?? 1;
      desired[m.protocol] = v;   // last master wins for a shared protocol
    }
  }
  // Audio master: the last Audio Level in OUT mode, unity when there is none.
  let audio = 1;
  for (const page of state.project.pages) for (const w of page.widgets) {
    if (w.kind === 'audioLevel' && w.mode === 'out') audio = state.runtime.widgets[w.id]?.cells[0]?.value ?? 1;
  }
  setAudioMaster(audio);
  for (const p of PROTOCOLS) {
    const gain = desired[p];
    if (gain !== undefined) setMasterGain(p, gain);
    else clearMasterGain(p);
    // A cleared protocol is back to unity — deleting a master has to restore
    // full output on whatever it was holding down.
    const effective = gain ?? 1;
    if (last[p] !== effective) {
      last[p] = effective;
      resend(p);
    }
  }
}

export default function MasterEngine(): null {
  useEffect(() => {
    const last: Partial<Record<Protocol, number>> = {};
    let frame = 0;
    let queued: Set<Protocol> | null = null;

    // Dragging a master fires a store update per pointer move; coalesce to one
    // re-send per frame so we don't flood the wire with duplicate values.
    function scheduleResend(p: Protocol): void {
      (queued ??= new Set<Protocol>()).add(p);
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const protocols = queued;
        queued = null;
        if (protocols) for (const q of protocols) resendProtocol(q);
      });
    }

    // Mount only seeds the baseline — entering Live mode must not blast every
    // current value onto the wire.
    applyGains(last, () => {});

    const unsubscribe = useStore.subscribe((state, prev) => {
      if (state.runtime.widgets !== prev.runtime.widgets || state.project !== prev.project) {
        applyGains(last, scheduleResend);
      }
    });

    return () => {
      unsubscribe();
      if (frame) cancelAnimationFrame(frame);
      resetMasterGains();
      setAudioMaster(1);
    };
  }, []);
  return null;
}
