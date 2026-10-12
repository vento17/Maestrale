// iCON iControls / iControls Pro in Mackie mode.
//
//   faders  1–8 + master : Pitch Bend, MIDI channel 1–9, 14-bit (0…16383)
//   touch   1–8 + master : Note 104–112 (0x68–0x70), velocity 127 = touched, 0 = released
//   knobs   1–8          : CC 16–23 (V-Pots), relative
//   knob    9            : CC 60 (jog), relative
//
// Relative knobs use the Mackie sign bit: 1…63 = clockwise by n,
// 65…127 = counter-clockwise by (n − 64).

export const FADER_COUNT = 9;          // 8 + master
export const KNOB_COUNT = 9;
export const CELL_COUNT = FADER_COUNT + KNOB_COUNT;

export const TOUCH_NOTE_BASE = 104;
export const DEFAULT_KNOB_CCS = [16, 17, 18, 19, 20, 21, 22, 23, 60];

// Cells 0–8 are the faders, 9–17 the knobs.
export const faderCell = (i: number): number => i;
export const knobCell = (i: number): number => FADER_COUNT + i;

export function iControlsCellLabel(cellIndex: number): string {
  if (cellIndex < FADER_COUNT) return cellIndex === FADER_COUNT - 1 ? 'Master' : `F${cellIndex + 1}`;
  return `K${cellIndex - FADER_COUNT + 1}`;
}

export function relativeTicks(value: number): number {
  if (value === 0 || value === 64) return 0;
  return value < 64 ? value : -(value - 64);
}

export function pitchBendValue(lsb: number, msb: number): number {
  return ((msb & 0x7f) << 7 | (lsb & 0x7f)) / 16383;
}
