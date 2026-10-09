import type { StateCreator } from 'zustand';
import type { StoreState } from './index';
import type { RuntimeState, WidgetRuntime, CellRuntime } from '../../shared/types/runtime';
import type { Widget } from '../../shared/types/project';
import { cellCount } from '../widgets/utils';

export interface RuntimeSlice {
  runtime: RuntimeState;

  // Called when entering Live mode to initialize all widgets
  initRuntime: (widgets: Widget[]) => void;
  resetRuntime: () => void;

  // Value updates from touch input
  setCellValue: (widgetId: string, cellIndex: number, value: number) => void;
  // Records what a router row received, for the router's own readout.
  setRouterInput: (rowId: string, value: number) => void;
  setButtonActive: (widgetId: string, cellIndex: number, active: boolean) => void;
  // Play/stop of a widget's own transport, so Cues can capture and restore it.
  setWidgetPlaying: (widgetId: string, playing: boolean) => void;
  // Batched write: sets values[i] into cells[startIndex + i] in one store update
  setRampCells: (widgetId: string, startIndex: number, values: number[]) => void;

  // Feedback from OSC
  applyFeedback: (widgetId: string, cellIndex: number, color: string | null, label: string | null) => void;
}

function makeCell(): CellRuntime {
  return { value: 0, active: false, feedbackColor: null, feedbackLabel: null };
}

function makeWidgetRuntime(widget: Widget): WidgetRuntime {
  const count = cellCount(widget);
  const cells = Array.from({ length: count }, makeCell);
  // A master starts at full (1) — 0 would mute everything on its protocol.
  if (widget.kind === 'masterLevel' && cells[0]) cells[0].value = 1;
  if (widget.kind === 'audioLevel' && widget.mode === 'out' && cells[0]) cells[0].value = 1;
  return { widgetId: widget.id, cells };
}

export const createRuntimeSlice: StateCreator<StoreState, [['zustand/immer', never]], [], RuntimeSlice> = (set) => ({
  runtime: { widgets: {}, routerInputs: {} },

  initRuntime: (widgets) => set((s) => {
    // Build the new map into a plain object first, copying existing cell VALUES
    // (not immer draft refs) before reassigning — otherwise reading `prev` after
    // `s.runtime.widgets = {}` returns stale/empty drafts and silently zeroes
    // every live value (breaks adding a cue/trigger mid-session).
    const prev = s.runtime.widgets;
    const next: Record<string, WidgetRuntime> = {};
    for (const widget of widgets) {
      const count = cellCount(widget);
      const existing = prev[widget.id];
      if (existing) {
        next[widget.id] = {
          widgetId: widget.id,
          playing: existing.playing,
          cells: Array.from({ length: count }, (_, i) => {
            const c = existing.cells[i];
            return c
              ? { value: c.value, active: c.active, feedbackColor: c.feedbackColor, feedbackLabel: c.feedbackLabel }
              : makeCell();
          }),
        };
      } else {
        next[widget.id] = makeWidgetRuntime(widget);
      }
    }
    s.runtime.widgets = next;
  }),

  resetRuntime: () => set((s) => {
    s.runtime = { widgets: {}, routerInputs: {} };
  }),

  setRouterInput: (rowId, value) => set((s) => {
    if (!s.runtime.routerInputs) s.runtime.routerInputs = {};
    // A controller re-sending the same value should not churn the store.
    if (s.runtime.routerInputs[rowId] === value) return;
    s.runtime.routerInputs[rowId] = value;
  }),

  setCellValue: (widgetId, cellIndex, value) => set((s) => {
    const wr = s.runtime.widgets[widgetId];
    if (!wr || !wr.cells[cellIndex]) return;
    wr.cells[cellIndex].value = Math.max(0, Math.min(1, value));
  }),

  setWidgetPlaying: (widgetId, playing) => set((s) => {
    const wr = s.runtime.widgets[widgetId];
    if (!wr || wr.playing === playing) return;
    wr.playing = playing;
  }),

  setButtonActive: (widgetId, cellIndex, active) => set((s) => {
    const wr = s.runtime.widgets[widgetId];
    if (!wr || !wr.cells[cellIndex]) return;
    wr.cells[cellIndex].active = active;
  }),

  setRampCells: (widgetId, startIndex, values) => set((s) => {
    const wr = s.runtime.widgets[widgetId];
    if (!wr) return;
    for (let i = 0; i < values.length; i++) {
      const cell = wr.cells[startIndex + i];
      if (cell) cell.value = Math.max(0, Math.min(1, values[i]));
    }
  }),

  applyFeedback: (widgetId, cellIndex, color, label) => set((s) => {
    const wr = s.runtime.widgets[widgetId];
    if (!wr || !wr.cells[cellIndex]) return;
    wr.cells[cellIndex].feedbackColor = color;
    wr.cells[cellIndex].feedbackLabel = label;
  }),
});
