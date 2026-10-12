import { useEffect, useReducer } from 'react';

// Which page of an iControls widget is live, and the state of a Learn run.
//
// The live page lives here rather than in the project because it follows the
// Layer button on the desk, not the design: writing it into the project would
// mark the file dirty every time someone pressed Layer mid-show. It starts at
// page 1 each run, which is where the surface starts too.

const bank = new Map<string, number>();
const listeners = new Set<() => void>();
const notify = (): void => listeners.forEach((f) => f());

export function bankOf(widgetId: string): number { return bank.get(widgetId) ?? 0; }

export function setBank(widgetId: string, page: number, pageCount: number): void {
  const n = Math.max(0, Math.min(Math.max(1, pageCount) - 1, page));
  if (bank.get(widgetId) === n) return;
  bank.set(widgetId, n);
  notify();
}

export function stepBank(widgetId: string, delta: number, pageCount: number): void {
  setBank(widgetId, bankOf(widgetId) + delta, pageCount);
}

// ─── Learn ───────────────────────────────────────────────────────────────────
// Click Learn, then move the controls one at a time: each new CC (or note)
// fills the next slot. Four layers of CC numbers read out of iMap by hand is a
// long way to get something wrong, and this also copes with a layer whose
// numbers are not consecutive.

export type LearnWhat = 'faders' | 'knobs' | 'buttons';

export interface LearnState {
  widgetId: string;
  page: number;
  what: LearnWhat;
  from: number;      // first button slot, for 'buttons'
  need: number;
  got: number[];
}

let learn: LearnState | null = null;

export function learnState(): LearnState | null { return learn; }
export function stopLearn(): void { learn = null; notify(); }

export function startLearn(widgetId: string, page: number, what: LearnWhat, from = 0, need = 9): void {
  learn = { widgetId, page, what, from, need, got: [] };
  notify();
}

function take(n: number, want: LearnWhat[]): number[] | null {
  if (!learn || !want.includes(learn.what)) return null;
  if (learn.got.includes(n)) return null;
  learn.got.push(n);
  notify();
  if (learn.got.length < learn.need) return null;
  const row = learn.got.slice();
  learn = null;
  notify();
  return row;
}

// Returns the finished row once enough controls have been seen, so the caller
// can write it into the widget and close the run.
export function learnCc(cc: number): number[] | null { return take(cc, ['faders', 'knobs']); }
export function learnNote(note: number): number[] | null { return take(note, ['buttons']); }

export function useIControlsBank(widgetId?: string): { page: number; learn: LearnState | null } {
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => { listeners.add(force); return () => { listeners.delete(force); }; }, []);
  return { page: widgetId ? bankOf(widgetId) : 0, learn };
}
