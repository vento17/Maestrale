import { bridge } from './bridge';
import type { DmxInputPayload, DmxInputProtocol, DmxInputStatusPayload } from '../../shared/types/ipc';

// Renderer-side mirror of every DMX universe heard on the network (Art-Net now,
// sACN next). One IPC subscription for the whole app: the Router engine, Learn
// and — later — the stream recorder all read from here instead of each opening
// their own listener.

export interface DmxChange {
  protocol: DmxInputProtocol;
  universe: number;
  channel: number;     // 1–512
  value: number;       // 0–255
  initial: boolean;    // part of the first frame heard from this universe
}

const frames = new Map<string, Uint8Array>();   // `${protocol}:${universe}` → 513 bytes (index = channel)
const listeners = new Set<(changes: DmxChange[]) => void>();
const statusListeners = new Set<(s: DmxInputStatusPayload) => void>();
let lastStatus: DmxInputStatusPayload | null = null;
// Every sender heard since the app started — the DMX monitor offers them.
const seenSources = new Set<string>();
let wired = false;

function wire(): void {
  if (wired || typeof window === 'undefined' || !window.api) return;
  wired = true;
  bridge.on('tr:dmxIn:frame', (p: DmxInputPayload) => {
    const changes: DmxChange[] = [];
    for (const u of p.universes) {
      const key = `${p.protocol}:${u.universe}`;
      let f = frames.get(key);
      // A fresh first frame means the sender (re)appeared: start from zeros,
      // the batch carries every non-zero channel.
      if (!f || u.first) { f = new Uint8Array(513); frames.set(key, f); }
      for (let i = 0; i + 1 < u.pairs.length; i += 2) {
        const ch = u.pairs[i], v = u.pairs[i + 1];
        if (ch < 1 || ch > 512) continue;
        f[ch] = v;
        changes.push({ protocol: p.protocol, universe: u.universe, channel: ch, value: v, initial: u.first });
      }
    }
    if (changes.length) listeners.forEach((fn) => fn(changes));
  });
  bridge.on('tr:dmxIn:status', (s: DmxInputStatusPayload) => {
    lastStatus = s;
    s.sources.forEach((ip) => seenSources.add(ip));
    if (!s.listening) {
      for (const k of [...frames.keys()]) if (k.startsWith(`${s.protocol}:`)) frames.delete(k);
    }
    statusListeners.forEach((fn) => fn(s));
  });
}

export function onDmxInput(fn: (changes: DmxChange[]) => void): () => void {
  wire();
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function onDmxInputStatus(fn: (s: DmxInputStatusPayload) => void): () => void {
  wire();
  statusListeners.add(fn);
  if (lastStatus) fn(lastStatus);
  return () => { statusListeners.delete(fn); };
}

export function getSeenSources(): string[] {
  wire();
  return [...seenSources].sort();
}

export function getDmxValue(protocol: DmxInputProtocol, universe: number, channel: number): number {
  return frames.get(`${protocol}:${universe}`)?.[channel] ?? 0;
}

// Copy of everything heard so far — Learn compares against it to find the
// channel that actually moved.
export function snapshotDmx(): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>();
  for (const [k, f] of frames) out.set(k, f.slice());
  return out;
}
