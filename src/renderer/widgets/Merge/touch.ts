// "Touch": a widget says some of its cells were just chosen again even if their
// values did not change — tapping a palette colour that is already sent. An
// LTP Merge takes the touched group as the latest.

type TouchFn = (widgetId: string, cells: number[]) => void;
const listeners = new Set<TouchFn>();

export function touchCells(widgetId: string, cells: number[]): void {
  listeners.forEach((f) => f(widgetId, cells));
}
export function onTouch(f: TouchFn): () => void {
  listeners.add(f);
  return () => { listeners.delete(f); };
}
