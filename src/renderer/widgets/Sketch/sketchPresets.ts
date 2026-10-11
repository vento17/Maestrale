import type { SketchStroke } from '../../../shared/types/project';

// Drawings to start from. Coordinates 0–1 (x right, y down); each stroke is a
// list of x,y pairs. Built-in ones are generated; your own are kept on this
// computer (＋ saves the current drawing).

export interface SketchPreset { id: string; name: string; strokes: SketchStroke[]; builtin?: boolean }

let n = 0;
const sid = () => `p${Date.now().toString(36)}${n++}`;
const r4 = (v: number) => Math.round(v * 10000) / 10000;
const stroke = (pts: [number, number][]): SketchStroke => ({ id: sid(), pts: pts.flatMap(([x, y]) => [r4(x), r4(y)]) });
const curve = (steps: number, f: (t: number) => [number, number]) => stroke(Array.from({ length: steps + 1 }, (_, i) => f(i / steps)));
const TAU = Math.PI * 2;

function circle(cx = 0.5, cy = 0.5, r = 0.4, steps = 96): SketchStroke {
  return curve(steps, (t) => [cx + r * Math.cos(TAU * t), cy + r * Math.sin(TAU * t)]);
}

const MAKERS: { id: string; name: string; make: () => SketchStroke[] }[] = [
  { id: 'circle', name: 'Circle', make: () => [circle()] },
  { id: 'concentric', name: 'Concentric circles', make: () => [0.12, 0.22, 0.32, 0.42].map((r) => circle(0.5, 0.5, r)) },
  { id: 'spiral', name: 'Spiral', make: () => [curve(400, (t) => { const a = TAU * 5 * t, r = 0.02 + 0.43 * t; return [0.5 + r * Math.cos(a), 0.5 + r * Math.sin(a)]; })] },
  { id: 'eight', name: 'Figure eight', make: () => [curve(160, (t) => { const a = TAU * t; const d = 1 + Math.sin(a) ** 2; return [0.5 + 0.42 * Math.cos(a) / d, 0.5 + 0.42 * Math.sin(a) * Math.cos(a) / d * 1.6]; })] },
  { id: 'square', name: 'Square', make: () => [stroke([[0.1, 0.1], [0.9, 0.1], [0.9, 0.9], [0.1, 0.9], [0.1, 0.1]])] },
  { id: 'triangle', name: 'Triangle', make: () => [stroke([[0.5, 0.08], [0.92, 0.88], [0.08, 0.88], [0.5, 0.08]])] },
  { id: 'star', name: 'Star', make: () => [stroke(Array.from({ length: 11 }, (_, i) => { const a = -Math.PI / 2 + (i * Math.PI) / 5, r = i % 2 ? 0.17 : 0.42; return [0.5 + r * Math.cos(a), 0.5 + r * Math.sin(a)] as [number, number]; }))] },
  { id: 'sine', name: 'Sine wave', make: () => [curve(160, (t) => [0.05 + 0.9 * t, 0.5 - 0.35 * Math.sin(TAU * 2 * t)])] },
  { id: 'zigzag', name: 'Zigzag', make: () => [stroke(Array.from({ length: 9 }, (_, i) => [0.05 + i * 0.1125, i % 2 ? 0.15 : 0.85] as [number, number]))] },
  { id: 'flower', name: 'Flower (rose)', make: () => [curve(360, (t) => { const a = TAU * t, r = 0.42 * Math.cos(5 * a); return [0.5 + r * Math.cos(a), 0.5 + r * Math.sin(a)]; })] },
  { id: 'lissajous', name: 'Lissajous 3:2', make: () => [curve(300, (t) => [0.5 + 0.42 * Math.sin(TAU * 3 * t + Math.PI / 2), 0.5 + 0.42 * Math.sin(TAU * 2 * t)])] },
  { id: 'grid', name: 'Grid scan', make: () => [stroke(Array.from({ length: 6 }, (_, i) => { const y = 0.1 + i * 0.16; return i % 2 ? [[0.9, y], [0.1, y]] : [[0.1, y], [0.9, y]]; }).flat() as [number, number][])] },
  { id: 'random', name: 'Random dots', make: () => Array.from({ length: 12 }, () => { const x = 0.08 + Math.random() * 0.84, y = 0.08 + Math.random() * 0.84; return stroke([[x, y], [x + 0.004, y + 0.004]]); }) },
  { id: 'walk', name: 'Random walk', make: () => { let x = 0.5, y = 0.5; return [stroke(Array.from({ length: 60 }, () => { x = Math.max(0.05, Math.min(0.95, x + (Math.random() - 0.5) * 0.12)); y = Math.max(0.05, Math.min(0.95, y + (Math.random() - 0.5) * 0.12)); return [x, y] as [number, number]; }))]; } },
];

export function builtinSketchPresets(): { id: string; name: string }[] { return MAKERS.map(({ id, name }) => ({ id, name })); }
export function makeBuiltin(id: string): SketchStroke[] { return MAKERS.find((m) => m.id === id)?.make() ?? []; }

const KEY = 'lf-sketch-presets';
export function userSketchPresets(): SketchPreset[] {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '[]') as SketchPreset[]; } catch { return []; }
}
export function saveUserSketchPresets(list: SketchPreset[]): void {
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* not vital */ }
}
