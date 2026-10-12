import type { IControlsButton, IControlsPage, IControlsWidget } from '../../../shared/types/project';

// iCON iControls / iControls Pro.
//
// The surface has four LAYERS, switched by the < and > buttons under "Layer",
// and each one sends something completely different. Layer 1 is normally left
// in Mackie Control mode:
//
//   faders  1–8 + master : Pitch Bend, MIDI channel 1–9, 14-bit (0…16383)
//   touch   1–8 + master : Note 104–112 (0x68–0x70), velocity 127 = touched
//   knobs   1–8          : CC 16–23 (V-Pots), relative; knob 9 = CC 60 (jog)
//   Sel 1–8              : Note 24–31      Mute 1–8 : Note 16–23
//   Solo 1–8             : Note 8–15       Rec 1–8  : Note 0–7
//   transport            : Rewind 91, Fast Fwd 92, Stop 93, Play 94, Rec 95
//
// The other layers are plain CC, and WHICH CC is whatever the iMap file on the
// device says. Those numbers are not predictable and not even consistent from
// one layer to the next — one unit here has layer 2 faders on CC 0 with knobs
// on CC 16, layer 3 faders on CC 33 with knobs on CC 29, and layer 4 faders on
// CC 34 with knobs on CC 45. So every page carries its own map and "Learn"
// fills it from the surface instead of from a guess.
//
// iMap writes notes as octave(name) with C3 = 48: "6(A#) PLAY" is 94, and the
// Layer buttons on this unit are "3(C)" = 48 and "3(C#)" = 49.

export const FADER_COUNT = 9;          // 8 + master
export const KNOB_COUNT = 9;
export const BUTTON_SLOTS = 32;        // fixed, so cell indices never move

// Cells of one page: 0–8 faders, 9–17 knobs, 18–49 buttons.
export const CELLS_PER_PAGE = FADER_COUNT + KNOB_COUNT + BUTTON_SLOTS;  // 50
export const CELL_COUNT = CELLS_PER_PAGE;

export const TOUCH_NOTE_BASE = 104;
export const DEFAULT_KNOB_CCS = [16, 17, 18, 19, 20, 21, 22, 23, 60];

export const PAGE_PREV_NOTE = 48;      // Layer <   (also Mackie Channel Left)
export const PAGE_NEXT_NOTE = 49;      // Layer >   (also Mackie Channel Right)

const run = (from: number, n = 9): number[] => Array.from({ length: n }, (_, i) => Math.min(127, from + i));

// The Mackie button map, laid into the 32 slots. Slot order is fixed; a slot
// with note 0 is simply unused and its cell stays at rest.
export function defaultButtons(): IControlsButton[] {
  const b: IControlsButton[] = [];
  for (let i = 0; i < 8; i++) b.push({ label: `Sel ${i + 1}`,  note: 24 + i });
  for (let i = 0; i < 8; i++) b.push({ label: `Mute ${i + 1}`, note: 16 + i });
  for (let i = 0; i < 8; i++) b.push({ label: `Solo ${i + 1}`, note: 8 + i });
  b.push({ label: 'Rewind', note: 91 });
  b.push({ label: 'Fast Fwd', note: 92 });
  b.push({ label: 'Stop', note: 93 });
  b.push({ label: 'Play', note: 94 });
  b.push({ label: 'Rec', note: 95 });
  b.push({ label: 'Loop', note: 86 });
  b.push({ label: 'Zoom', note: 100 });
  b.push({ label: '', note: 0 });
  return b;
}

// Page 1 is the Mackie layer. Pages 2–4 start from what this unit's layers
// actually send; anything that does not match is a starting point to re-Learn.
export function defaultPages(): IControlsPage[] {
  return [
    { name: 'Layer 1 · Mackie', channel: 0, faderMode: 'pitchBend', knobMode: 'relative', knobCcs: [...DEFAULT_KNOB_CCS], buttons: defaultButtons() },
    { name: 'Layer 2', channel: 1, faderMode: 'cc', faderCcs: run(0),  knobMode: 'absolute', knobCcs: run(16), buttons: defaultButtons() },
    { name: 'Layer 3', channel: 1, faderMode: 'cc', faderCcs: run(33), knobMode: 'absolute', knobCcs: run(29), buttons: defaultButtons() },
    { name: 'Layer 4', channel: 1, faderMode: 'cc', faderCcs: run(34), knobMode: 'absolute', knobCcs: run(45), buttons: defaultButtons() },
  ];
}

// cellCount() calls this, and cellCount is read on every animation frame while
// patching — so the fallback for a widget saved before pages existed is built
// once per widget and kept, rather than allocating a page and 32 buttons each
// time anyone asks how many cells the widget has.
const legacyPages = new WeakMap<IControlsWidget, IControlsPage[]>();

export function widgetPages(w: IControlsWidget): IControlsPage[] {
  if (w.pages?.length) return w.pages;
  let p = legacyPages.get(w);
  if (!p) {
    p = [{
      name: 'Layer 1 · Mackie', channel: 0, faderMode: 'pitchBend', knobMode: 'relative',
      knobCcs: w.knobCcs?.length === KNOB_COUNT ? w.knobCcs : [...DEFAULT_KNOB_CCS],
      buttons: defaultButtons(),
    }];
    legacyPages.set(w, p);
  }
  return p;
}

export function pageCount(w: IControlsWidget): number { return widgetPages(w).length; }

export function pageAt(w: IControlsWidget, index: number): IControlsPage {
  const ps = widgetPages(w);
  return ps[Math.max(0, Math.min(ps.length - 1, index))];
}

export function knobCcsOf(p: IControlsPage): number[] {
  return p.knobCcs?.length === KNOB_COUNT ? p.knobCcs : DEFAULT_KNOB_CCS;
}
export function faderCcsOf(p: IControlsPage): number[] {
  return p.faderCcs?.length === FADER_COUNT ? p.faderCcs : run(0);
}
export function buttonsOf(p: IControlsPage): IControlsButton[] {
  const b = p.buttons ?? [];
  if (b.length === BUTTON_SLOTS) return b;
  const out = defaultButtons();
  b.forEach((x, i) => { if (i < BUTTON_SLOTS) out[i] = x; });
  return out;
}

// Page 1 keeps the fader and knob indices it always had, so links made before
// pages existed still point at the same control.
export const faderCell  = (i: number, page = 0): number => page * CELLS_PER_PAGE + i;
export const knobCell   = (i: number, page = 0): number => page * CELLS_PER_PAGE + FADER_COUNT + i;
export const buttonCell = (i: number, page = 0): number => page * CELLS_PER_PAGE + FADER_COUNT + KNOB_COUNT + i;

export function iControlsCellLabel(cellIndex: number, pages?: IControlsPage[]): string {
  const page = Math.floor(cellIndex / CELLS_PER_PAGE);
  const i = cellIndex % CELLS_PER_PAGE;
  const prefix = pages && pages.length > 1 ? `P${page + 1} ` : '';
  if (i < FADER_COUNT) return prefix + (i === FADER_COUNT - 1 ? 'Master' : `F${i + 1}`);
  if (i < FADER_COUNT + KNOB_COUNT) return `${prefix}K${i - FADER_COUNT + 1}`;
  const b = pages?.[page] ? buttonsOf(pages[page])[i - FADER_COUNT - KNOB_COUNT] : undefined;
  return prefix + (b?.label || `B${i - FADER_COUNT - KNOB_COUNT + 1}`);
}

export function relativeTicks(value: number): number {
  if (value === 0 || value === 64) return 0;
  return value < 64 ? value : -(value - 64);
}

export function pitchBendValue(lsb: number, msb: number): number {
  return ((msb & 0x7f) << 7 | (lsb & 0x7f)) / 16383;
}
