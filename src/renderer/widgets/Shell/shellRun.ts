import { useEffect, useReducer } from 'react';
import type { ShellButton, ShellWidget } from '../../../shared/types/project';
import { shellAction } from '../../../shared/shellActions';
import { bridge } from '../../ipc/bridge';
import { useStore } from '../../store';

// Running a Shell button. Power actions (turn off, restart, sign out) count
// down first — shown on every Shell widget with a Cancel — and save where
// Maestrale is, so it starts again exactly as it was.

interface Countdown { key: string; label: string; until: number; timer: ReturnType<typeof setTimeout> }
let countdown: Countdown | null = null;
const listeners = new Set<() => void>();
const notify = (): void => listeners.forEach((f) => f());

export function currentCountdown(): { label: string; until: number } | null {
  return countdown ? { label: countdown.label, until: countdown.until } : null;
}
export function useCountdown(): { label: string; until: number } | null {
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => { listeners.add(force); return () => { listeners.delete(force); }; }, []);
  useEffect(() => {
    if (!countdown) return;
    const t = setInterval(force, 250);
    return () => clearInterval(t);
  });
  return currentCountdown();
}

export function cancelCountdown(): void {
  if (!countdown) return;
  clearTimeout(countdown.timer);
  useStore.getState().addLog('info', `Shell: ${countdown.label} cancelled`);
  countdown = null;
  bridge.invoke('tr:shell:run', { action: 'cancelShutdown' }).catch(() => {});
  notify();
}

async function saveState(): Promise<void> {
  try { await bridge.invoke('tr:project:autosave', useStore.getState().project); } catch { /* best effort */ }
}

async function exec(b: ShellButton): Promise<void> {
  const def = shellAction(b.action);
  if (def?.power || b.action === 'quitApp' || b.action === 'restartApp') await saveState();
  const res = await bridge.invoke('tr:shell:run', { action: b.action, arg: b.arg, delay: 0 }).catch((e) => ({ ok: false, error: String(e) }));
  const st = useStore.getState();
  if (res?.ok) st.addLog('info', `Shell: ${b.label || def?.name || b.action}`);
  else st.addLog('error', `Shell: ${b.label || def?.name || b.action} — ${res?.error ?? 'failed'}`);
}

export function fireShellButton(w: ShellWidget, index: number): void {
  const b = w.buttons[index];
  if (!b) return;
  const def = shellAction(b.action);
  const key = `${w.id}:${b.id}`;
  if (def?.power) {
    // Pressed again while counting down: cancel.
    if (countdown?.key === key) { cancelCountdown(); return; }
    if (countdown) cancelCountdown();
    const secs = Math.max(0, Math.min(600, b.delay ?? 10));
    const label = b.label || def.name;
    if (secs === 0) { void exec(b); return; }
    countdown = { key, label, until: Date.now() + secs * 1000, timer: setTimeout(() => { countdown = null; notify(); void exec(b); }, secs * 1000) };
    useStore.getState().addLog('warn', `Shell: ${label} in ${secs} s — press again or Cancel to stop`);
    notify();
    return;
  }
  if (b.action === 'cancelShutdown') { cancelCountdown(); }
  void exec(b);
}
