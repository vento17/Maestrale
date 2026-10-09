import { xyMapping } from '../../shared/types/project';
// Renderer-side network sync.
// When network Live mode is enabled:
//   - Sends one snapshot to main on start (so new browser clients get layout)
//   - Subscribes to runtime store: sends targeted runtimePatch for interactive widgets
//   - Listens for `tr:net:interact` from main → processes as widget interactions

import { bridge } from '../ipc/bridge';
import { useStore } from '../store';
import { dispatchValue } from '../ipc/dispatch';
import type { NetInteractPayload, NetPageRect } from '../../shared/types/ipc';

let unsubscribeInteract: (() => void) | null = null;
let unsubscribeSwitchPage: (() => void) | null = null;
let unsubscribeStore: (() => void) | null = null;
let unsubscribeLayout: (() => void) | null = null;
let onResize: (() => void) | null = null;

// Measure the exact on-screen page rect so the browser client can map clicks
// precisely (accounts for the live sidebar and page live-offset).
function measurePageRect(): NetPageRect | undefined {
  const el = document.getElementById('lf-page-canvas');
  if (!el) return undefined;
  const r = el.getBoundingClientRect();
  if (r.width < 1) return undefined;
  const s = useStore.getState();
  const page = s.project.pages.find((p) => p.id === s.activePageId);
  if (!page) return undefined;
  const scale = r.width / page.width;
  return { x: r.left + (page.liveOffsetX ?? 0), y: r.top + (page.liveOffsetY ?? 0), scale };
}

const INTERACTIVE_KINDS = new Set(['sliderBank', 'buttonGrid', 'knobBank', 'xyPad', 'masterLevel', 'submasters']);

function sendSnapshot() {
  const s = useStore.getState();
  const runtimeWidgets: Record<string, { cells: { value: number; active: boolean }[] }> = {};
  for (const [id, wr] of Object.entries(s.runtime.widgets)) {
    runtimeWidgets[id] = { cells: wr.cells.map((c) => ({ value: c.value ?? 0, active: c.active ?? false })) };
  }
  bridge.send('tr:net:stateChange', {
    pages: s.project.pages,
    activePageId: s.activePageId ?? '',
    runtimeWidgets,
    dpr: window.devicePixelRatio,
    pageRect: measurePageRect(),
  });
}

function handleInteract(payload: NetInteractPayload) {
  const { widgetId, cellIndex, value, active } = payload;
  const store = useStore.getState();

  // Update runtime cell
  store.setCellValue(widgetId, cellIndex, value);
  if (active !== undefined) store.setButtonActive(widgetId, cellIndex, active);

  // Find widget and dispatch to its protocol mapping
  for (const page of store.project.pages) {
    const widget = page.widgets.find((w) => w.id === widgetId);
    if (!widget) continue;

    if (widget.kind === 'xyPad') {
      const mapping = xyMapping(widget, cellIndex);
      if (mapping) dispatchValue(mapping, value);
    } else if ('cells' in widget && Array.isArray(widget.cells)) {
      const cell = (widget.cells as { mapping?: unknown }[])[cellIndex];
      if (cell?.mapping) dispatchValue(cell.mapping as never, value);
    } else if ('mapping' in widget && widget.mapping) {
      dispatchValue(widget.mapping as never, value);
    }
    break;
  }
}

export function startNetworkSync() {
  stopNetworkSync();

  const initialState = useStore.getState();

  // Pre-compute interactive widget IDs (sliders, buttons, knobs, XY) for efficient subscription
  const interactiveIds = new Set<string>();
  for (const page of initialState.project.pages) {
    for (const w of page.widgets) {
      if (INTERACTIVE_KINDS.has(w.kind)) interactiveIds.add(w.id);
    }
  }

  let prevRuntime = initialState.runtime.widgets;
  const lastPatchMs: Record<string, number> = {};

  // Watch for runtime changes and push targeted patches to browser clients (PC→web sync)
  unsubscribeStore = useStore.subscribe((state) => {
    const runtime = state.runtime.widgets;
    if (runtime === prevRuntime) return;

    for (const widgetId of interactiveIds) {
      const wr = runtime[widgetId];
      // Reference equality: Immer only creates a new object when cells actually changed
      if (!wr || wr === prevRuntime[widgetId]) continue;

      // Throttle to ~60fps per widget
      const now = Date.now();
      if (lastPatchMs[widgetId] && now - lastPatchMs[widgetId] < 16) continue;
      lastPatchMs[widgetId] = now;

      const cells = wr.cells.map((c) => ({ value: c.value ?? 0, active: c.active ?? false }));
      bridge.send('tr:net:runtimePatch', { widgetId, cells });
    }

    prevRuntime = runtime;
  });

  unsubscribeInteract = bridge.on('tr:net:interact', handleInteract);
  unsubscribeSwitchPage = bridge.on('tr:net:switchPage', (pageId: string) => {
    useStore.getState().setActivePageId(pageId);
    setTimeout(sendSnapshot, 60); // let the new page lay out, then push fresh pageRect
  });

  // Re-send the snapshot (with a fresh pageRect) whenever the page's on-screen
  // placement can change: window resize or live-sidebar toggle.
  onResize = () => sendSnapshot();
  window.addEventListener('resize', onResize);
  let prevSidebar = initialState.liveSidebarOpen;
  unsubscribeLayout = useStore.subscribe((state) => {
    if (state.liveSidebarOpen !== prevSidebar) {
      prevSidebar = state.liveSidebarOpen;
      setTimeout(sendSnapshot, 60);
    }
  });

  sendSnapshot();
}

export function stopNetworkSync() {
  unsubscribeInteract?.();
  unsubscribeInteract = null;
  unsubscribeSwitchPage?.();
  unsubscribeSwitchPage = null;
  unsubscribeStore?.();
  unsubscribeStore = null;
  unsubscribeLayout?.();
  unsubscribeLayout = null;
  if (onResize) { window.removeEventListener('resize', onResize); onResize = null; }
}
