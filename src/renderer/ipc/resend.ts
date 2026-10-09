import { xyMapping } from '../../shared/types/project';
import type { Mapping } from '../../shared/types/mapping';
import { useStore } from '../store';
import { dispatchValue } from './dispatch';

// Re-send the current value of every parked control mapped to `protocol`, across
// all pages.
//
// A MasterLevel only multiplies values as they pass through dispatchValue, so on
// its own it cannot move anything that is sitting still: a slider left at full
// keeps the receiver at full until someone touches it again. Continuously
// running sources (LFO, sequencer, timeline, audio analyser) re-dispatch every
// frame and need nothing from us — this is only for the controls that hold a
// value and then go quiet.
//
// Buttons are re-sent on non-MIDI protocols only. There a button is already just
// a value (dispatchButton falls through to dispatchValue), so re-sending is
// idempotent; on MIDI it would re-fire note-on, which is not something a master
// fader should ever do.
export function resendProtocol(protocol: string): void {
  const { project, runtime } = useStore.getState();

  const send = (m: Mapping, v: number): void => {
    if (m && m.type === protocol) dispatchValue(m, v);
  };

  for (const page of project.pages) {
    for (const w of page.widgets) {
      const wr = runtime.widgets[w.id];
      // No runtime state = nothing has ever been sent for this widget. Falling
      // back to 0 here would turn a master move into a surprise blackout.
      if (!wr) continue;
      switch (w.kind) {
        case 'sliderBank':
        case 'knobBank':
          for (let i = 0; i < w.cells.length; i++) {
            const v = wr.cells[i]?.value;
            if (v !== undefined) send(w.cells[i]?.mapping ?? w.mapping, v);
          }
          break;
        case 'xyPad': {
          wr.cells.forEach((c, i) => { if (c?.value !== undefined) send(xyMapping(w, i), c.value); });
          break;
        }
        case 'buttonGrid':
          if (protocol === 'midi') break;
          for (let i = 0; i < w.cells.length; i++) {
            const cell = wr.cells[i];
            if (cell) send(w.cells[i]?.mapping ?? w.mapping, cell.active ? 1 : 0);
          }
          break;
        default:
          break;
      }
    }
  }
}
