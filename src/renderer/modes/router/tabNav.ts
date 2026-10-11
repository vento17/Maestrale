// Tab between the numbers on the Router page. Down the column by default (the
// same value on link after link), or across the row with the button in the
// toolbar. The cell that should open next is announced here; the NumCell with
// that key opens itself.

export type TabDir = 'down' | 'across';

const KEY = 'lf-router-tab-dir';
let dir: TabDir = (() => {
  try { return localStorage.getItem(KEY) === 'across' ? 'across' : 'down'; } catch { return 'down'; }
})();
let pending: string | null = null;
const subs = new Set<() => void>();
const notify = (): void => subs.forEach((f) => f());

export function subscribeTabNav(f: () => void): () => void { subs.add(f); return () => { subs.delete(f); }; }
export function tabDir(): TabDir { return dir; }
export function setTabDir(d: TabDir): void {
  dir = d;
  try { localStorage.setItem(KEY, d); } catch { /* not vital */ }
  notify();
}
export function pendingCell(): string | null { return pending; }
export function openCell(key: string | null): void { pending = key; notify(); }

export const cellKey = (row: number, col: number): string => `${row}:${col}`;

/** Where Tab goes from (row, col) — cols are the 4 numbers of a link. */
export function nextCell(row: number, col: number, rows: number, cols: number, back: boolean): { row: number; col: number } {
  const step = back ? -1 : 1;
  if (dir === 'down') {
    let r = row + step;
    let c = col;
    if (r < 0) { r = rows - 1; c = (col - 1 + cols) % cols; }
    else if (r >= rows) { r = 0; c = (col + 1) % cols; }
    return { row: r, col: c };
  }
  let c = col + step;
  let r = row;
  if (c < 0) { c = cols - 1; r = row - 1 < 0 ? rows - 1 : row - 1; }
  else if (c >= cols) { c = 0; r = row + 1 >= rows ? 0 : row + 1; }
  return { row: r, col: c };
}
