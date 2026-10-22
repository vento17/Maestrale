import { useEffect, useReducer } from 'react';
import type { StartupTrigger, StartupWidget } from '../../../shared/types/project';
import { useStore } from '../../store';
import { dispatchValue } from '../../ipc/dispatch';

// The Startup widget's brain. When Live opens, every trigger of every Startup
// widget (any page) is armed: `delay` seconds later its cell pulses 1 → 0
// (PULSE_MS apart) and its mapping, if any, goes out the same way. Once per
// app run unless the widget says "every Live"; a tap on a trigger fires it now.

const PULSE_MS = 150;

interface Armed { timer: ReturnType<typeof setTimeout>; at: number }
const armed = new Map<string, Armed>();          // "widgetId:triggerId" → pending
const fired = new Map<string, number>();         // "widgetId:triggerId" → when it last fired
const doneOnce = new Set<string>();              // widgets already run this app session
const listeners = new Set<() => void>();
const notify = (): void => listeners.forEach((f) => f());

export function armedAt(widgetId: string, triggerId: string): number | undefined { return armed.get(`${widgetId}:${triggerId}`)?.at; }
export function firedAt(widgetId: string, triggerId: string): number | undefined { return fired.get(`${widgetId}:${triggerId}`); }
export function useStartupState(): void {
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => { listeners.add(force); return () => { listeners.delete(force); }; }, []);
  useEffect(() => {
    if (armed.size === 0) return;
    const t = setInterval(force, 250);
    return () => clearInterval(t);
  });
}

export function fireStartupTrigger(w: StartupWidget, index: number): void {
  const t = w.triggers[index];
  if (!t) return;
  const key = `${w.id}:${t.id}`;
  const a = armed.get(key);
  if (a) { clearTimeout(a.timer); armed.delete(key); }
  const st = useStore.getState();
  st.setCellValue(w.id, index, 1);
  if (t.mapping) dispatchValue(t.mapping, 1);
  fired.set(key, Date.now());
  st.addLog('info', `Startup: ${t.label || `trigger ${index + 1}`}`);
  notify();
  setTimeout(() => {
    useStore.getState().setCellValue(w.id, index, 0);
    if (t.mapping) dispatchValue(t.mapping, 0);
  }, PULSE_MS);
}

function arm(w: StartupWidget, index: number, t: StartupTrigger): void {
  const key = `${w.id}:${t.id}`;
  const old = armed.get(key);
  if (old) clearTimeout(old.timer);
  const ms = Math.max(0, t.delay) * 1000;
  armed.set(key, {
    at: Date.now() + ms,
    timer: setTimeout(() => { armed.delete(key); fireStartupTrigger(findWidget(w.id) ?? w, index); notify(); }, ms),
  });
}

function findWidget(id: string): StartupWidget | undefined {
  for (const p of useStore.getState().project.pages) {
    const w = p.widgets.find((x) => x.id === id);
    if (w && w.kind === 'startup') return w;
  }
  return undefined;
}

/** Live just opened: arm every Startup widget that is due. */
export function runStartup(): void {
  for (const p of useStore.getState().project.pages) for (const w of p.widgets) {
    if (w.kind !== 'startup') continue;
    if (!w.everyLive && doneOnce.has(w.id)) continue;
    doneOnce.add(w.id);
    w.triggers.forEach((t, i) => arm(w, i, t));
  }
  notify();
}

/** Disarm what has not fired yet (leaving Live). */
export function cancelStartup(): void {
  armed.forEach((a) => clearTimeout(a.timer));
  armed.clear();
  notify();
}

/** Arm a whole widget again by hand (the ↺ button): all its triggers, from now. */
export function rearmStartup(w: StartupWidget): void {
  w.triggers.forEach((t, i) => arm(w, i, t));
  useStore.getState().addLog('info', `Startup: ${w.label} armed again`);
  notify();
}

