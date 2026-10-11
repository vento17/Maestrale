// The interface palette: two colours the user can change in Settings →
// Palette. Saved in the project (project.palette) and applied whenever a
// project is loaded; New project brings back the default. Every coloured value in the interface is a
// shade of one of two reference colours — laguna and fire orange. pal() maps a
// shade of the reference onto the same shade of the chosen colour, so one pick
// recolours the whole interface: bright, dim and tinted variants included.
//
// Greys, white, black and the REC / clock red are not palette colours and pass
// through untouched, as do colours a user picked for a single widget.

export interface Palette { accent: string; highlight: string }

// What the code was written in. Do not change: pal() measures every literal
// against these.
const REF_ACCENT = '#4fb3b8';
const REF_HIGHLIGHT = '#ff8a1f';

export const DEFAULT_PALETTE: Palette = { accent: '#4fb8ab', highlight: '#ff8a1f' };

const KEY = 'lf-palette';
const HEX6 = /^#[0-9a-f]{6}$/i;

function load(): Palette {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Palette> | null;
    if (p && HEX6.test(p.accent ?? '') && HEX6.test(p.highlight ?? '')) return { accent: p.accent!, highlight: p.highlight! };
  } catch { /* storage unavailable */ }
  return { ...DEFAULT_PALETTE };
}

let current: Palette = { ...DEFAULT_PALETTE };
void load;
let version = 0;
const cache = new Map<string, string>();
const listeners = new Set<() => void>();

type HLS = [number, number, number];
function toHls(hex: string): HLS {
  const r = parseInt(hex.slice(1, 3), 16) / 255, g = parseInt(hex.slice(3, 5), 16) / 255, b = parseInt(hex.slice(5, 7), 16) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  if (mx === mn) return [0, l, 0];
  const d = mx - mn;
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  const h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, l, s];
}
function toHex([h, l, s]: HLS): string {
  const f = (n: number) => {
    const k = (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return '#' + [f(0), f(8), f(4)].map((v) => v.toString(16).padStart(2, '0')).join('');
}
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

// Move a shade of `ref` onto the matching shade of `to`.
function shift(c: HLS, ref: HLS, to: HLS): string {
  const h = (c[0] + (to[0] - ref[0]) + 360) % 360;
  const s = clamp01(ref[2] > 0 ? c[2] * (to[2] / ref[2]) : to[2]);
  const l = to[1] >= ref[1] ? c[1] + (1 - c[1]) * (to[1] - ref[1]) / (1 - ref[1]) : c[1] * (to[1] / ref[1]);
  return toHex([h, clamp01(l), s]);
}

function familyOf(c: HLS): 'a' | 'h' | null {
  const [h, l, s] = c;
  if (s < 0.25 || l < 0.06 || l > 0.94) return null;
  if (h > 150 && h < 215) return 'a';
  if (h > 15 && h < 45) return 'h';
  return null;
}

/** A palette colour, in the current palette. Accepts #rrggbb or #rrggbbaa. */
export function pal(hex: string): string {
  if (typeof hex !== 'string' || hex[0] !== '#' || (hex.length !== 7 && hex.length !== 9)) return hex;
  const hit = cache.get(hex);
  if (hit) return hit;
  const base = hex.slice(0, 7), alpha = hex.slice(7);
  let out = hex;
  if (HEX6.test(base)) {
    const c = toHls(base), fam = familyOf(c);
    if (fam === 'a') out = shift(c, toHls(REF_ACCENT), toHls(current.accent)) + alpha;
    else if (fam === 'h') out = shift(c, toHls(REF_HIGHLIGHT), toHls(current.highlight)) + alpha;
  }
  cache.set(hex, out);
  return out;
}

/** "r, g, b" of a palette colour — for rgba(…) strings. */
export function palRgb(hex: string): string {
  const h = pal(hex);
  return `${parseInt(h.slice(1, 3), 16)}, ${parseInt(h.slice(3, 5), 16)}, ${parseInt(h.slice(5, 7), 16)}`;
}

export function getPalette(): Palette { return { ...current }; }
export function paletteVersion(): number { return version; }

// CSS variables (globals.css) written in the reference colours.
const CSS_VARS: Record<string, string> = {
  '--color-accent': '#4fb3b8',
  '--color-accent-dim': '#12292b',
  '--lf-aqua': '#4fb3b8',
  '--lf-aqua-bright': '#8fd3d6',
  '--lf-orange': '#ff8a1f',
  '--lf-orange-hot': '#ff7700',
};
function applyCss(): void {
  try {
    const root = document.documentElement.style;
    for (const [k, v] of Object.entries(CSS_VARS)) root.setProperty(k, pal(v));
  } catch { /* no DOM (tests) */ }
}

export function setPalette(p: Palette, persist = false): void {
  const next = { accent: p.accent.toLowerCase(), highlight: p.highlight.toLowerCase() };
  // Loading a project with the same colours must not redraw the interface.
  if (next.accent === current.accent && next.highlight === current.highlight) return;
  current = next;
  cache.clear();
  version++;
  if (persist) {
    try { localStorage.setItem(KEY, JSON.stringify(current)); } catch { /* not vital */ }
  }
  applyCss();
  listeners.forEach((f) => f());
}

export function resetPalette(): void { setPalette({ ...DEFAULT_PALETTE }); }

export function onPalette(f: () => void): () => void {
  listeners.add(f);
  return () => { listeners.delete(f); };
}

applyCss();
