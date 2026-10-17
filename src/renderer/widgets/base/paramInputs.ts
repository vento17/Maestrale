import type { Widget } from '../../../shared/types/project';
import { TIMELINE_TRANSPORT } from '../Timeline/transport';

// Inputs that are not a widget's own cells: a timeline's GO / STOP / BACK, an
// LFO's SPEED / RATE / PHASE… They live at NEGATIVE cell indices, which no
// output ever uses, so the Router, Shift patching, Link and Learn all reach
// them without knowing anything special.

export interface ParamInput { index: number; key: string; label: string; hint: string }

// Same idea as TouchDesigner's LFO CHOP: every parameter of the oscillator can
// be driven from outside. Values arrive 0–1; FREQ is exponential.
export const LFO_INPUTS: ParamInput[] = [
  { index: -1, key: 'play',   label: 'PLAY',   hint: 'oscillates while ≥ 0.5, stops (holds) below — like play / pause' },
  { index: -2, key: 'freq',   label: 'FREQ',   hint: 'cycles per second, 0.01 … 20 Hz exponential (half ≈ 0.45 Hz)' },
  { index: -3, key: 'amp',    label: 'AMP',    hint: 'amplitude: how wide the wave swings, 0–1' },
  { index: -4, key: 'offset', label: 'OFFSET', hint: 'shifts every output forward together, 0–1 cycle (0.5 = sine starts at the top)' },
  { index: -5, key: 'bias',   label: 'BIAS',   hint: 'shape: moves the triangle peak, widens/narrows the square — half = none' },
  { index: -6, key: 'phase',  label: 'PHASE',  hint: 'spread across the outputs by index: 0 = all together, 0.5 = last output half a cycle after the first' },
  { index: -7, key: 'reset',  label: 'RESET',  hint: 'back to the start of the cycle on each press' },
  { index: -8, key: 'quant',  label: 'QUANT',  hint: 'quantize: 0 smooth, higher = fewer held steps per cycle, 1 = one new value per cycle' },
];

// Quantize 0…1 → steps per cycle: 0 = smooth (Infinity), up to 1 = one per cycle.
export function quantSteps(q: number): number {
  if (q <= 0.001) return Infinity;
  if (q >= 0.999) return 1;
  return Math.max(2, Math.round(2 + 62 * (1 - q) * (1 - q)));
}
export function quantLabel(q: number): string {
  const s = quantSteps(q);
  return s === Infinity ? 'smooth' : s === 1 ? '1 step / cycle' : `${s} steps`;
}

export const LFO_SPEEDS = [0.25, 0.5, 1, 2, 4];

// Step Sequencer and Graph: the same transport as the LFO, speed in steps.
export const GEN_INPUTS: ParamInput[] = [
  { index: -1, key: 'play',  label: 'PLAY',  hint: 'plays while ≥ 0.5, stops below' },
  { index: -2, key: 'speed', label: 'SPEED', hint: 'steps 1/8 · 1/4 · 1/2 · 1x · 2x · 4x · 8x across the fader' },
  { index: -3, key: 'reset', label: 'RESET', hint: 'back to the start on each press' },
];
export const GEN_SPEEDS = [0.125, 0.25, 0.5, 1, 2, 4, 8] as const;
export function genSpeedFromInput(v: number): (typeof GEN_SPEEDS)[number] {
  return GEN_SPEEDS[Math.max(0, Math.min(GEN_SPEEDS.length - 1, Math.floor(v * GEN_SPEEDS.length)))];
}

// Sound Player and DMX Player: playlist transport. Item k is cell k.
export const PLAYLIST_INPUTS: ParamInput[] = [
  { index: -1, key: 'stop',  label: 'STOP',  hint: 'stops what is playing' },
  { index: -2, key: 'next',  label: 'NEXT',  hint: 'plays the next item (the first when nothing plays)' },
  { index: -3, key: 'prev',  label: 'PREV',  hint: 'plays the previous item' },
  { index: -4, key: 'first', label: 'FIRST', hint: 'plays the first item' },
];

// A one-shot press on an input (the Reset buttons in the settings).
export function pulseParamInput(widgetId: string, key: string): void {
  setParamInput(widgetId, key, 1);
  setParamInput(widgetId, key, 0);
}

// Math inputs are not listed here: like the Merge, its box takes any number of
// cables (in 1, in 2 … at −1, −2 …), each landing on param input `in<k>`.

export function paramInputsOf(widget: Widget): ParamInput[] {
  if (widget.kind === 'timeline') return TIMELINE_TRANSPORT.map((t) => ({ index: t.index, key: t.cmd, label: t.label, hint: t.hint }));
  if (widget.kind === 'lfoWidget' || widget.kind === 'noiseWidget') return LFO_INPUTS;
  if (widget.kind === 'stepSequencer' || widget.kind === 'graphWidget' || widget.kind === 'sketch') return GEN_INPUTS;
  if (widget.kind === 'soundPlayer' || widget.kind === 'dmxPlayer') return PLAYLIST_INPUTS;
  return [];
}

export function paramInputOf(widget: Widget, index: number): ParamInput | undefined {
  return paramInputsOf(widget).find((p) => p.index === index);
}

// Live values arriving on those inputs (0–1). Not saved with the project: they
// are what the Router is sending right now; unset means "not driven".
const values = new Map<string, Record<string, number>>();
const listeners = new Set<() => void>();

export function setParamInput(widgetId: string, key: string, v: number): void {
  const cur = values.get(widgetId) ?? {};
  if (cur[key] === v) return;
  values.set(widgetId, { ...cur, [key]: v });
  listeners.forEach((f) => f());
}

export function getParamInput(widgetId: string, key: string): number | undefined {
  return values.get(widgetId)?.[key];
}

export function onParamInputs(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

// FREQ fader → 0.01 … 20 Hz, exponential.
export const FREQ_MIN = 0.01, FREQ_MAX = 20;
export function freqFromInput(v: number): number {
  return FREQ_MIN * Math.pow(FREQ_MAX / FREQ_MIN, Math.max(0, Math.min(1, v)));
}
