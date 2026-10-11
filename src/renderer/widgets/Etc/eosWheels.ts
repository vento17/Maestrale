import { bridge } from '../../ipc/bridge';

// What Eos says its encoders are. With OSC TX on, Eos sends one message per
// active wheel:  /eos/out/active/wheel/<index>  "Pan [ 12.5 ]"  <category>  <value>
// The index is what /eos/active/wheel/<index> moves. Categories (Eos): 0 none,
// 1 intensity, 2 focus, 3 color, 4 image, 5 form, 6 beam (shutter), 7 custom.
// Knowing them, the four encoders can page like the desk does: the category key
// picks the list, pressing it again shows the next four.

export interface EosWheel { index: number; label: string; category: number }

const wheels = new Map<number, EosWheel>();
const listeners = new Set<() => void>();
let lastAt = 0;

export const CATEGORY_OF_KEY: Record<string, number> = {
  encoder_category_intensity: 1,
  encoder_category_focus: 2,
  encoder_category_color: 3,
  encoder_category_image: 4,
  encoder_category_form: 5,
  encoder_category_shutter: 6,
};

let started = false;
export function startEosWheels(): void {
  if (started) return;
  started = true;
  bridge.on('tr:osc:feedback', (msg) => {
    const m = /^\/eos\/out\/active\/wheel\/(\d+)$/.exec(msg.address);
    if (!m) return;
    const index = Number(m[1]);
    const label = String(msg.args[0] ?? '').trim();
    const category = Number(msg.args[1] ?? 0);
    if (!label) wheels.delete(index); else wheels.set(index, { index, label, category });
    lastAt = Date.now();
    listeners.forEach((f) => f());
  });
}

export function onEosWheels(f: () => void): () => void { listeners.add(f); return () => { listeners.delete(f); }; }
export function eosWheelsKnown(): boolean { return wheels.size > 0 && Date.now() - lastAt < 10 * 60_000; }

// The wheels of one category, in Eos order (index).
export function wheelsOf(category: number): EosWheel[] {
  return [...wheels.values()].filter((w) => w.category === category).sort((a, b) => a.index - b.index);
}
export function allWheels(): EosWheel[] { return [...wheels.values()].sort((a, b) => a.index - b.index); }

// "Zoom [ 45 ]" → "Zoom": the parameter, without its value.
export function wheelName(label: string): string { return label.replace(/\s*\[.*$/, '').trim(); }

// How fast each parameter turns (ticks × gain). Some move very little per tick
// on Eos; these are the starting points, each can be changed in Settings.
// Measured on Eos with ticks per turn 100: colour feels right at ×1, pan /
// tilt need ×10, zoom ×100. Unknown names fall back on their category.
const DEFAULT_GAIN: Record<string, number> = {
  Intens: 0.1, Intensity: 0.1,
  Pan: 20, Tilt: 20, Zoom: 100, Edge: 30, Iris: 30, Frost: 30, Focus: 30,
  'X Focus': 10, 'Y Focus': 10, 'Z Focus': 10, 'Position MSpeed': 10,
};
const CATEGORY_GAIN: Record<number, number> = { 1: 0.1, 2: 20, 3: 1, 4: 3, 5: 30, 6: 10 };

// Your own defaults ("Save as default" in Settings): on this computer, for
// every ETC widget and every project, new ones included.
const USER_KEY = 'lf-etc-wheel-gains';
export function userGains(): Record<string, number> {
  try { return JSON.parse(localStorage.getItem(USER_KEY) ?? '{}') as Record<string, number>; } catch { return {}; }
}
export function saveUserGains(g: Record<string, number>): void {
  try { localStorage.setItem(USER_KEY, JSON.stringify(g)); } catch { /* not vital */ }
}
/** The default for a name: yours, else the built-in one, else by category. */
export function defaultGainOf(label: string, category?: number): number {
  const n = wheelName(label);
  const cat = category ?? [...wheels.values()].find((w) => wheelName(w.label) === n)?.category;
  return userGains()[n] ?? DEFAULT_GAIN[n] ?? (cat !== undefined ? CATEGORY_GAIN[cat] : undefined) ?? 1;
}
export function wheelGainOf(gains: Record<string, number> | undefined, label: string | undefined, category?: number): number {
  if (!label) return 1;
  return gains?.[wheelName(label)] ?? defaultGainOf(label, category);
}
