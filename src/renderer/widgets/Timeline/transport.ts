// Remote transport for a Timeline — GO / STOP / BACK as router-drivable inputs.
//
// The timeline's own cells (0…n) are its OUTPUTS: tracks, trig markers, cue
// blocks. Their count changes as you edit, so inputs cannot be appended after
// them without shifting every index. Transport inputs therefore live at
// NEGATIVE cell indices, which no output will ever use: a router output with
// targetCellIndex -1 is "GO on this timeline". Everything that already speaks
// cells — the Router, Shift patching, right-click Link and Learn, Cues
// snapshots — gets remote transport for free.

export type TimelineCommand = 'go' | 'stop' | 'back';

export const TIMELINE_TRANSPORT: { index: number; cmd: TimelineCommand; label: string; hint: string }[] = [
  { index: -1, cmd: 'go',   label: 'GO',   hint: 'continue from a wait, or play — ignored while playing' },
  { index: -2, cmd: 'stop', label: 'STOP', hint: 'stop where it is' },
  { index: -3, cmd: 'back', label: 'BACK', hint: 'jump back to the previous wait point' },
];

export function transportCommandOf(cellIndex: number): TimelineCommand | null {
  return TIMELINE_TRANSPORT.find((t) => t.index === cellIndex)?.cmd ?? null;
}

export function transportLabelOf(cellIndex: number): string | null {
  return TIMELINE_TRANSPORT.find((t) => t.index === cellIndex)?.label ?? null;
}

// Tiny per-widget bus: the router engine fires, the mounted Timeline listens.
// Every page stays mounted in Live, so a timeline on another page still hears it.
const listeners = new Map<string, Set<(cmd: TimelineCommand) => void>>();

export function onTimelineCommand(widgetId: string, fn: (cmd: TimelineCommand) => void): () => void {
  let set = listeners.get(widgetId);
  if (!set) { set = new Set(); listeners.set(widgetId, set); }
  set.add(fn);
  return () => { set!.delete(fn); };
}

export function sendTimelineCommand(widgetId: string, cmd: TimelineCommand): void {
  listeners.get(widgetId)?.forEach((fn) => fn(cmd));
}
