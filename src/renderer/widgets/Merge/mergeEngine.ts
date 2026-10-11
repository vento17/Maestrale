import type { MergeWidget, Project } from '../../../shared/types/project';
import { useStore } from '../../store';
import { eachRouter } from '../base/routers';
import { onTouch } from './touch';

// The Merge widget's brain, for every Merge in the project (any page).
// Inputs arrive from the Router on NEGATIVE cells: −1 = in 1, −2 = in 2…
// They are grouped `every` at a time (in 1-3 = group 1, in 4-6 = group 2 …)
// and slot s of the output is merged from slot s of every group:
//   HTP  highest   ·  LTP  the group moved / touched last
//   MIN  lowest    ·  AVG  average
// Outputs glide to their new value in `smooth` seconds (linear).

interface State {
  inputs: Map<number, number>;       // in k (1-based) → value
  latest: number;                    // LTP: group index
  out: number[];                     // what is out now
  ramps: ({ from: number; to: number; t0: number; dur: number } | null)[];
}
const states = new Map<string, State>();
const listeners = new Set<() => void>();
let raf = 0;
let startedAt = 0;

function stateOf(id: string): State {
  let s = states.get(id);
  if (!s) { s = { inputs: new Map(), latest: 0, out: [], ramps: [] }; states.set(id, s); }
  return s;
}
function findMerge(id: string): MergeWidget | undefined {
  for (const p of useStore.getState().project.pages) {
    const w = p.widgets.find((x) => x.id === id);
    if (w && w.kind === 'merge') return w as MergeWidget;
  }
  return undefined;
}
const everyOf = (w: MergeWidget): number => Math.max(1, Math.min(16, Math.round(w.every || 1)));

export function mergeInputs(id: string): Map<number, number> { return stateOf(id).inputs; }
export function mergeLatest(id: string): number { return stateOf(id).latest; }
export function onMerge(f: () => void): () => void { listeners.add(f); return () => { listeners.delete(f); }; }

/** From the Router: in `k` (1-based) of merge `id` is now `v`. */
export function setMergeInput(id: string, k: number, v: number): void {
  const w = findMerge(id);
  if (!w) return;
  const s = stateOf(id);
  const was = s.inputs.get(k);
  s.inputs.set(k, v);
  // The first burst when Live opens (every link sends its value once) is not a
  // "move": LTP keeps its choice until something really changes.
  if (was !== undefined && was !== v && performance.now() - startedAt > 600) s.latest = Math.floor((k - 1) / everyOf(w));
  recompute(w);
}

function target(w: MergeWidget, s: State, slot: number): number {
  const n = everyOf(w);
  const vals: number[] = [];
  let max = 0;
  s.inputs.forEach((_, k) => { if (k > max) max = k; });
  const groups = Math.ceil(max / n);
  if (w.mode === 'ltp') return s.inputs.get(s.latest * n + slot + 1) ?? 0;
  for (let g = 0; g < groups; g++) {
    const v = s.inputs.get(g * n + slot + 1);
    if (v !== undefined) vals.push(v);
  }
  if (!vals.length) return 0;
  if (w.mode === 'min') return Math.min(...vals);
  if (w.mode === 'avg') return vals.reduce((a, b) => a + b, 0) / vals.length;
  return Math.max(...vals);
}

function recompute(w: MergeWidget): void {
  const s = stateOf(w.id);
  const n = everyOf(w);
  const now = performance.now();
  const dur = Math.max(0, w.smooth || 0) * 1000;
  for (let slot = 0; slot < n; slot++) {
    const to = target(w, s, slot);
    const cur = s.out[slot] ?? useStore.getState().runtime.widgets[w.id]?.cells[slot]?.value ?? 0;
    const r = s.ramps[slot];
    if (r ? r.to === to : cur === to) continue;
    if (dur <= 0) { s.ramps[slot] = null; s.out[slot] = to; useStore.getState().setCellValue(w.id, slot, to); continue; }
    s.ramps[slot] = { from: cur, to, t0: now, dur };
  }
  listeners.forEach((f) => f());
  if (!raf) raf = requestAnimationFrame(step);
}

function step(): void {
  raf = 0;
  const now = performance.now();
  let busy = false;
  states.forEach((s, id) => {
    s.ramps.forEach((r, slot) => {
      if (!r) return;
      const t = Math.min(1, (now - r.t0) / r.dur);
      const v = r.from + (r.to - r.from) * t;
      s.out[slot] = v;
      useStore.getState().setCellValue(id, slot, v);
      if (t >= 1) s.ramps[slot] = null; else busy = true;
    });
  });
  if (busy) raf = requestAnimationFrame(step);
}

// Which merge inputs a source cell feeds (for touches).
function inputsFedBy(project: Project, srcWidget: string, srcCells: number[]): { mergeId: string; k: number }[] {
  const out: { mergeId: string; k: number }[] = [];
  for (const r of eachRouter(project)) for (const row of r.holder.rows) {
    if ((row.inputType ?? 'widget') !== 'widget' || row.widgetId !== srcWidget || row.allCells) continue;
    if (!srcCells.includes(row.cellIndex)) continue;
    for (const o of row.outputs) {
      const c = o.targetCellIndex ?? 0;
      if (o.targetWidgetId && !o.targetAllCells && c < 0) out.push({ mergeId: o.targetWidgetId, k: -c });
    }
  }
  return out;
}

let started = false;
export function startMergeEngine(): void {
  startedAt = performance.now();
  if (started) return;
  started = true;
  // A palette colour tapped again (values unchanged): its group becomes latest.
  onTouch((widgetId, cells) => {
    const fed = inputsFedBy(useStore.getState().project, widgetId, cells);
    const done = new Set<string>();
    for (const { mergeId, k } of fed) {
      const w = findMerge(mergeId);
      if (!w) continue;
      stateOf(mergeId).latest = Math.floor((k - 1) / everyOf(w));
      done.add(mergeId);
    }
    done.forEach((id) => { const w = findMerge(id); if (w) recompute(w); });
  });
  // Settings changed (mode, every, smooth): recompute.
  useStore.subscribe((st, prev) => {
    if (st.project === prev.project) return;
    for (const p of st.project.pages) for (const w of p.widgets) if (w.kind === 'merge' && states.has(w.id)) recompute(w as MergeWidget);
  });
}

// The inputs that have a cable (from any router), 1-based, sorted.
export function connectedInputs(project: Project, mergeId: string): number[] {
  const ks = new Set<number>();
  for (const r of eachRouter(project)) for (const row of r.holder.rows) for (const o of row.outputs) {
    if (o.targetWidgetId === mergeId && !o.targetAllCells && (o.targetCellIndex ?? 0) < 0) ks.add(-(o.targetCellIndex ?? 0));
  }
  return [...ks].sort((a, b) => a - b);
}
