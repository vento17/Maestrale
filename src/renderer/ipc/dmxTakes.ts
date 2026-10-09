import { useEffect, useState } from 'react';
import { bridge } from './bridge';
import type { DmxTakeInfo, DmxRecStatus, DmxPlayStatus } from '../../shared/types/ipc';

// Renderer side of the DMX recorder/player: the list of takes on disk, the
// recorder's state and each player's position — one IPC subscription each,
// shared by every widget.

let takes: DmxTakeInfo[] = [];
let recStatus: DmxRecStatus = { recording: false, takeId: null, name: '', elapsedMs: 0, bytes: 0, universes: [] };
const playStatus = new Map<string, DmxPlayStatus>();
const takeListeners = new Set<() => void>();
const recListeners = new Set<() => void>();
const playListeners = new Set<() => void>();
let wired = false;

function wire(): void {
  if (wired || typeof window === 'undefined' || !window.api) return;
  wired = true;
  bridge.on('tr:dmxRec:status', (s: DmxRecStatus) => {
    const finished = recStatus.recording && !s.recording;
    recStatus = s;
    recListeners.forEach((f) => f());
    if (finished) void refreshTakes();
  });
  bridge.on('tr:dmxPlay:status', (s: DmxPlayStatus) => {
    playStatus.set(s.playerId, s);
    playListeners.forEach((f) => f());
  });
  void refreshTakes();
}

export async function refreshTakes(): Promise<void> {
  try {
    const list = await bridge.invoke('tr:dmxRec:list', undefined);
    takes = Array.isArray(list) ? list : [];
  } catch { takes = []; }
  takeListeners.forEach((f) => f());
}

function useSubscribed<T>(set: Set<() => void>, read: () => T): T {
  wire();
  const [v, setV] = useState<T>(read);
  useEffect(() => {
    const f = () => setV(read());
    set.add(f);
    f();
    return () => { set.delete(f); };
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps
  return v;
}

// Name of a take for labels (Router, links) — '' while the list loads.
export function takeName(id: string): string {
  wire();
  return takes.find((t) => t.id === id)?.name ?? (id ? 'take' : '— no take —');
}

export function useTakes(): DmxTakeInfo[] { return useSubscribed(takeListeners, () => takes); }
export function useRecStatus(): DmxRecStatus { return useSubscribed(recListeners, () => recStatus); }
export function usePlayStatus(playerId: string): DmxPlayStatus | undefined {
  return useSubscribed(playListeners, () => playStatus.get(playerId));
}

// "0, 1, 4-6" → [0, 1, 4, 5, 6]; empty → every universe.
export function parseUniverses(text: string): number[] {
  const out = new Set<number>();
  for (const part of text.split(/[,\s]+/).filter(Boolean)) {
    const m = part.match(/^(\d+)(?:-(\d+))?$/);
    if (!m) continue;
    const a = Number(m[1]), b = m[2] !== undefined ? Number(m[2]) : a;
    for (let u = Math.min(a, b); u <= Math.max(a, b) && u <= 32767; u++) out.add(u);
  }
  return [...out].sort((x, y) => x - y);
}

export function fmtTime(ms: number): string {
  const s = Math.max(0, ms) / 1000;
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(1).padStart(4, '0')}`;
}

export function fmtBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}
