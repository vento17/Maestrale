import type { StateCreator } from 'zustand';
import { nanoid } from 'nanoid';
import { eachRouter, mainRouterRows } from '../widgets/base/routers';
import type { StoreState } from './index';
import type { Project, Page, Widget, Rect, WidgetKind, Connection, OutputProtocol, RouterRow, RouterOutput, RouterInputType } from '../../shared/types/project';
import type { Mapping } from '../../shared/types/mapping';
import { makeDefaultWidget, nextFreeCc, makeSliderCells, makeButtonCells, makeKnobCells, defaultMidiMapping, defaultOscMapping, widgetLabelNum } from '../widgets/defaults';

const KIND_LABEL_PREFIX: Partial<Record<WidgetKind, string>> = {
  sliderBank: 'slider', buttonGrid: 'button', knobBank: 'knob', xyPad: 'xy',
  stepSequencer: 'seq', graphWidget: 'graph', cues: 'cues', timeline: 'timeline',
  spoutInput: 'spout', ndiInput: 'ndi', submasters: 'sub', router: 'router',
  imageWidget: 'image', textWidget: 'text', masterLevel: 'master', audioLevel: 'audio', noiseWidget: 'noise', sketch: 'sketch', instance: 'instance',
  lfoWidget: 'lfo', mathWidget: 'math',
  manual: 'manual', keyboard: 'keys', dmxRecorder: 'recorder', dmxPlayer: 'player', clock: 'clock', dmxMonitor: 'monitor',
};

// New widgets speak OSC: every control gets an address named after its label
// (/s1/1 … for a bank, /xy1/x · /xy1/y, /lfo1 …). DMX widgets keep their DMX.
function defaultToOsc(w: Widget): void {
  if (w.outputProtocol !== 'midi') return;
  w.outputProtocol = 'osc';
  const num = widgetLabelNum(w.label);
  if ('cells' in w && (w.kind === 'sliderBank' || w.kind === 'buttonGrid' || w.kind === 'knobBank')) {
    (w.cells as { mapping: unknown }[]).forEach((c, i) => { c.mapping = defaultOscMapping(w.kind, num, i); });
  }
  if (w.kind === 'xyPad') {
    w.mappingX = { type: 'osc', address: `/xy${num}/x` };
    w.mappingY = { type: 'osc', address: `/xy${num}/y` };
  }
  if (w.mapping && w.mapping.type === 'midi') w.mapping = { type: 'osc', address: `/${w.label}` };
}

function nextUniqueLabel(project: Project, kind: WidgetKind): string {
  const prefix = KIND_LABEL_PREFIX[kind] ?? kind;
  const used = new Set<number>();
  for (const page of project.pages) {
    for (const w of page.widgets) {
      const m = w.label.match(new RegExp(`^${prefix}(\\d+)$`));
      if (m) used.add(Number(m[1]));
    }
  }
  let n = 1;
  while (used.has(n)) n++;
  return `${prefix}${n}`;
}
import { SCHEMA_VERSION, CANVAS_DEFAULT_WIDTH, CANVAS_DEFAULT_HEIGHT } from '../../shared/constants';

export interface LayoutSlice {
  project: Project;
  projectHistory: Project[];
  clipboard: Widget[];
  clipboardMode: 'copy' | 'cut';  // cut → paste keeps original ids (a move); copy → new ids

  loadProject: (project: Project) => void;
  setProjectName: (name: string) => void;
  setStartInLive: (on: boolean) => void;
  setProjectFrameRate: (fps: NonNullable<Project['frameRate']>) => void;
  setPageSize: (pageId: string, width: number, height: number) => void;
  setPageLiveOffset: (pageId: string, x: number, y: number) => void;

  addPage: () => void;
  removePage: (pageId: string) => void;
  reorderPages: (fromIndex: number, toIndex: number) => void;
  renamePage: (pageId: string, name: string) => void;

  setConnection: (conn: Connection) => void;
  setTapTriggerMapping: (mapping: Mapping | null) => void;
  setResetTriggerMapping: (mapping: Mapping | null) => void;
  setPlayTriggerMapping: (mapping: Mapping | null) => void;
  setStopTriggerMapping: (mapping: Mapping | null) => void;

  addWidget: (pageId: string, kind: WidgetKind) => string;
  removeWidget: (pageId: string, widgetId: string) => void;
  updateWidgetRect: (pageId: string, widgetId: string, rect: Partial<Rect>) => void;
  updateWidget: (pageId: string, widgetId: string, patch: Partial<Widget>) => void;
  bringWidgetToFront: (pageId: string, widgetId: string) => void;

  // Per-cell
  setOutputProtocol: (pageId: string, widgetId: string, protocol: OutputProtocol) => void;
  updateCell: (pageId: string, widgetId: string, cellIndex: number, patch: Record<string, unknown>) => void;
  updateWidgetCounts: (pageId: string, widgetId: string, countX: number, countY: number) => void;
  resetCellMappings: (pageId: string, widgetId: string) => void;
  resetCellNames: (pageId: string, widgetId: string) => void;
  resetCellColors: (pageId: string, widgetId: string) => void;

  // Slave links (right-click "link to source") — materialised as router rows.
  linkSlaveCell: (params: {
    slaveWidgetId: string; slaveCellIndex: number;
    sourceWidgetId: string; sourceCellIndex: number;
    routerId: string;
    // A protocol source instead of a widget cell — this is how MIDI/OSC learn
    // binds, so a learned controller is an ordinary router row like any other.
    input?: { inputType: RouterInputType; midiChannel?: number; midiNumber?: number; oscAddress?: string; artnetUniverse?: number; artnetChannel?: number };
  }) => void;
  // Several widget→cell links into one router as ONE undo step — what a Shift
  // patching session commits when you let go.
  linkSlaveCells: (routerId: string, links: {
    slaveWidgetId: string; slaveCellIndex: number;
    sourceWidgetId: string; sourceCellIndex: number;
  }[]) => void;
  unlinkSlaveCell: (slaveWidgetId: string, slaveCellIndex: number) => void;
  // Remove specific router outputs (one undo step). A row left with no outputs
  // goes too. Used by Shift patching to cut a single cable, ALL links included.
  removeRouterOutputs: (refs: { routerId: string; rowId: string; outputId: string }[]) => void;
  updateRouterRow: (routerId: string, rowId: string, patch: Partial<RouterRow>) => void;
  updateRouterOutput: (routerId: string, rowId: string, outputId: string, patch: Partial<RouterOutput>) => void;
  splitRouterOutput: (routerId: string, rowId: string, outputId: string) => string;
  addMainRouterLink: () => string;
  // A widget lost cell `index` (an alarm deleted, a row removed): links on that
  // cell go, links on later cells move down one so they keep their target.
  dropCellAndShiftLinks: (widgetId: string, index: number) => void;
  applyLinksSnapshot: (links: Record<string, RouterRow[]>) => void;

  // History & clipboard
  captureHistory: () => void;
  undo: () => void;
  copyWidgets: (widgets: Widget[]) => void;
  cutWidgets: (pageId: string, widgetIds: string[]) => void;
  pasteWidgets: (pageId: string) => void;
}

export function makeDefaultProject(): Project {
  const pageId = nanoid();
  return {
    schemaVersion: SCHEMA_VERSION,
    id: nanoid(),
    name: 'Untitled Project',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    connections: [],
    tapTriggerMapping: null,
    resetTriggerMapping: null,
    activePageId: pageId,
    mainRouter: { rows: [] },
    pages: [{
      id: pageId, name: 'Page 1', widgets: [],
      backgroundColor: '#000000',
      width: CANVAS_DEFAULT_WIDTH, height: CANVAS_DEFAULT_HEIGHT,
    }],
  };
}

function applySlaveLink(project: Project, { slaveWidgetId, slaveCellIndex, sourceWidgetId, sourceCellIndex, routerId, input }: {
  slaveWidgetId: string; slaveCellIndex: number;
  sourceWidgetId: string; sourceCellIndex: number;
  routerId: string;
  input?: { inputType: RouterInputType; midiChannel?: number; midiNumber?: number; oscAddress?: string; artnetUniverse?: number; artnetChannel?: number };
}): void {
  mainRouterRows(project);
  // Drop any existing link targeting this slave cell (in every router, the
  // main one included), then remove rows left with no outputs — one source
  // per slave cell.
  let target: { rows: RouterRow[] } | undefined;
  for (const r of eachRouter(project)) {
    for (const row of r.holder.rows) {
      row.outputs = row.outputs.filter(
        (o) => !(o.targetWidgetId === slaveWidgetId && (o.targetCellIndex ?? 0) === slaveCellIndex)
      );
    }
    r.holder.rows = r.holder.rows.filter((row) => row.outputs.length > 0);
    if (r.id === routerId) target = r.holder;
  }
  // Unknown router id (deleted widget, stale choice) → the main router.
  if (!target) target = mainRouterRows(project);

  target.rows.push({
    id: nanoid(),
    createdAt: Date.now(),
    inputType: input?.inputType ?? 'widget',
    widgetId: input ? '' : sourceWidgetId,
    cellIndex: input ? 0 : sourceCellIndex,
    midiChannel: input?.midiChannel,
    midiNumber: input?.midiNumber,
    oscAddress: input?.oscAddress,
    artnetUniverse: input?.artnetUniverse,
    artnetChannel: input?.artnetChannel,
    outputs: [{
      id: nanoid(),
      mapping: null,
      targetWidgetId: slaveWidgetId,
      targetCellIndex: slaveCellIndex,
    }],
  });
}

function touchUpdatedAt(project: Project) {
  project.updatedAt = new Date().toISOString();
}

function getPage(project: Project, pageId: string): Page | undefined {
  return project.pages.find((p) => p.id === pageId);
}

function getWidget(page: Page, widgetId: string): Widget | undefined {
  return page.widgets.find((w) => w.id === widgetId);
}

function maxZIndex(page: Page): number {
  return page.widgets.reduce((max, w) => Math.max(max, w.zIndex), 0);
}

// Cell names carry the widget's own number, so two banks of the same kind are
// told apart at a glance: slider1 gets S1.1…S1.8 and slider2 gets S2.1…S2.8.
// Without it every bank numbered its cells from 1 and looked identical on the
// canvas, while the link menu listed them as separate widgets.
function defaultCellLabel(kind: string, index: number, widgetLabel?: string): string {
  const prefix: Record<string, string> = { sliderBank: 'S', buttonGrid: 'B', knobBank: 'K' };
  const num = widgetLabel?.match(/(\d+)$/)?.[1];
  return `${prefix[kind] ?? ''}${num ? `${num}.` : ''}${index + 1}`;
}

// Rewrites the default cell names of a cell bank to match its current label.
// Only touches slider/button/knob banks — the other kinds have no cell labels.
function applyDefaultCellLabels(widget: Widget): void {
  if (!('cells' in widget)) return;
  (widget.cells as { label: string }[]).forEach((c, i) => {
    c.label = defaultCellLabel(widget.kind, i, widget.label);
  });
}

// Reassign a copied widget's output "message values" to a free block so a copy
// doesn't collide with the original: MIDI CC/note numbers and DMX channels are
// bumped; OSC addresses are left as-is. Mutates the (already-cloned) widget.
function reassignOutputs(widget: Widget, base: number): void {
  let i = 0;
  const bump = (m: Mapping): Mapping => {
    const slot = base + i; i++;
    if (!m) return m;
    if (m.type === 'midi')   return { ...m, number: slot % 128 };
    if (m.type === 'artnet' || m.type === 'sacn' || m.type === 'enttec') return { ...m, channel: (slot % 512) + 1 };
    return m; // osc unchanged
  };
  const w = widget as { kind: string; cells?: { mapping: Mapping }[]; mapping?: Mapping; mappingX?: Mapping; mappingY?: Mapping };
  if (w.kind === 'xyPad') {
    w.mappingX = bump(w.mappingX ?? null); w.mappingY = bump(w.mappingY ?? null);
    const xy = widget as { points?: { mappingX: Mapping; mappingY: Mapping }[] };
    if (xy.points) xy.points = xy.points.map((p) => ({ ...p, mappingX: bump(p.mappingX), mappingY: bump(p.mappingY) }));
    return;
  }
  if (Array.isArray(w.cells)) { w.cells = w.cells.map((c) => ({ ...c, mapping: bump(c.mapping) })); return; }
  // Keyboard keys are cells too, they just live under a different name.
  const kb = widget as { kind: string; keys?: { mapping: Mapping }[] };
  if (kb.kind === 'keyboard' && Array.isArray(kb.keys)) {
    kb.keys = kb.keys.map((k) => ({ ...k, mapping: bump(k.mapping) }));
    return;
  }
  if ('mapping' in w && w.mapping !== undefined) { w.mapping = bump(w.mapping); }
}

// Remap a copied widget's internal references to other widgets so links follow
// a copy: if a referenced id is part of the copied set (in idMap) it's rewritten
// to the new id; references to widgets outside the copy are left unchanged.
function remapWidgetRefs(widget: Widget, idMap: Record<string, string>): void {
  const map = (id: string | undefined): string => (id && idMap[id]) ? idMap[id] : (id ?? '');
  const w = widget as {
    kind: string;
    rows?: { widgetId?: string; outputs?: { targetWidgetId?: string }[] }[];
    sourceAWidgetId?: string; sourceBWidgetId?: string; sourceWidgetId?: string;
    linkedWidgetIds?: string[];
  };
  if (w.kind === 'router' && Array.isArray(w.rows)) {
    for (const row of w.rows) {
      if (row.widgetId) row.widgetId = map(row.widgetId);
      if (Array.isArray(row.outputs)) for (const out of row.outputs) {
        if (out.targetWidgetId) out.targetWidgetId = map(out.targetWidgetId);
      }
    }
  } else if (w.kind === 'mathWidget') {
    w.sourceAWidgetId = map(w.sourceAWidgetId);
    w.sourceBWidgetId = map(w.sourceBWidgetId);
  } else if (w.kind === 'valueDisplay' || w.kind === 'instance') {
    w.sourceWidgetId = map(w.sourceWidgetId);
  } else if (w.kind === 'submasters' && Array.isArray(w.linkedWidgetIds)) {
    w.linkedWidgetIds = w.linkedWidgetIds.map((id) => map(id));
  }
}

export const createLayoutSlice: StateCreator<StoreState, [['zustand/immer', never]], [], LayoutSlice> = (set) => ({
  project: makeDefaultProject(),
  projectHistory: [],
  clipboard: [],
  clipboardMode: 'copy',

  loadProject: (project) => set((s) => {
    s.project = project;
    s.activePageId = project.activePageId;
    s.selectedWidgetId = null;
  }),

  setStartInLive: (on) => set((s) => { s.project.startInLive = on; }),
  setProjectName: (name) => set((s) => {
    s.project.name = name;
    touchUpdatedAt(s.project);
  }),

  setProjectFrameRate: (fps) => set((s) => {
    s.project.frameRate = fps;
    touchUpdatedAt(s.project);
  }),

  setPageSize: (pageId, width, height) => set((s) => {
    const page = getPage(s.project, pageId);
    if (page) { page.width = width; page.height = height; }
    touchUpdatedAt(s.project);
  }),

  setPageLiveOffset: (pageId, x, y) => set((s) => {
    const page = getPage(s.project, pageId);
    if (page) { page.liveOffsetX = x; page.liveOffsetY = y; }
    touchUpdatedAt(s.project);
  }),

  setConnection: (conn) => set((s) => {
    const idx = s.project.connections.findIndex((c) => c.type === conn.type);
    if (idx === -1) s.project.connections.push(conn);
    else s.project.connections[idx] = conn;
    touchUpdatedAt(s.project);
  }),

  setTapTriggerMapping: (mapping) => set((s) => {
    s.project.tapTriggerMapping = mapping;
    touchUpdatedAt(s.project);
  }),

  setResetTriggerMapping: (mapping) => set((s) => {
    s.project.resetTriggerMapping = mapping;
    touchUpdatedAt(s.project);
  }),


  setPlayTriggerMapping: (mapping) => set((s) => {
    s.project.playTriggerMapping = mapping;
    touchUpdatedAt(s.project);
  }),


  setStopTriggerMapping: (mapping) => set((s) => {
    s.project.stopTriggerMapping = mapping;
    touchUpdatedAt(s.project);
  }),

  addPage: () => set((s) => {
    const id = nanoid();
    const src = s.project.pages.find((p) => p.id === s.activePageId);
    const width  = src?.width  ?? CANVAS_DEFAULT_WIDTH;
    const height = src?.height ?? CANVAS_DEFAULT_HEIGHT;
    const bgColor = src?.backgroundColor ?? '#000000';
    s.project.pages.push({ id, name: `Page ${s.project.pages.length + 1}`, widgets: [], backgroundColor: bgColor, width, height });
    s.activePageId = id;
    touchUpdatedAt(s.project);
  }),

  removePage: (pageId) => set((s) => {
    if (s.project.pages.length === 1) return;
    // Any page can be deleted now, not just the last one, so this throws away
    // real work — make it undoable like the other destructive edits.
    const snapshot = JSON.parse(JSON.stringify(s.project)) as Project;
    s.projectHistory.push(snapshot);
    if (s.projectHistory.length > 50) s.projectHistory.shift();
    s.project.pages = s.project.pages.filter((p) => p.id !== pageId);
    if (s.activePageId === pageId) s.activePageId = s.project.pages[0].id;
    touchUpdatedAt(s.project);
  }),

  // Pages are identified by id everywhere (links, cue scopes, router rows), so
  // moving one in the array only changes the order of the tabs — nothing that
  // points at a page needs rewriting.
  reorderPages: (fromIndex, toIndex) => set((s) => {
    const n = s.project.pages.length;
    if (fromIndex === toIndex) return;
    if (fromIndex < 0 || fromIndex >= n || toIndex < 0 || toIndex >= n) return;
    const [moved] = s.project.pages.splice(fromIndex, 1);
    s.project.pages.splice(toIndex, 0, moved);
    touchUpdatedAt(s.project);
  }),

  renamePage: (pageId, name) => set((s) => {
    const page = getPage(s.project, pageId);
    if (page) page.name = name;
    touchUpdatedAt(s.project);
  }),

  addWidget: (pageId, kind) => {
    const id = nanoid();
    set((s) => {
      const snapshot = JSON.parse(JSON.stringify(s.project)) as Project;
      s.projectHistory.push(snapshot);
      if (s.projectHistory.length > 50) s.projectHistory.shift();
      const page = getPage(s.project, pageId);
      if (!page) return;
      const baseCC = nextFreeCc(page.widgets);
      const widget = makeDefaultWidget(id, kind, maxZIndex(page) + 1, baseCC);
      widget.label = nextUniqueLabel(s.project, kind);
      applyDefaultCellLabels(widget as Widget);
      defaultToOsc(widget as Widget);
      page.widgets.push(widget as Widget);
      s.selectedWidgetId = id;
      touchUpdatedAt(s.project);
    });
    return id;
  },

  removeWidget: (pageId, widgetId) => set((s) => {
    const snapshot = JSON.parse(JSON.stringify(s.project)) as Project;
    s.projectHistory.push(snapshot);
    if (s.projectHistory.length > 50) s.projectHistory.shift();
    const page = getPage(s.project, pageId);
    if (!page) return;
    page.widgets = page.widgets.filter((w) => w.id !== widgetId);
    if (s.selectedWidgetId === widgetId) s.selectedWidgetId = null;
    touchUpdatedAt(s.project);
  }),

  updateWidgetRect: (pageId, widgetId, rect) => set((s) => {
    const page = getPage(s.project, pageId);
    if (!page) return;
    const widget = page.widgets.find((w) => w.id === widgetId);
    if (!widget) return;
    Object.assign(widget.rect, rect);
    touchUpdatedAt(s.project);
  }),

  updateWidget: (pageId, widgetId, patch) => set((s) => {
    const page = getPage(s.project, pageId);
    if (!page) return;
    const idx = page.widgets.findIndex((w) => w.id === widgetId);
    if (idx === -1) return;
    page.widgets[idx] = { ...page.widgets[idx], ...patch } as Widget;
    touchUpdatedAt(s.project);
  }),

  bringWidgetToFront: (pageId, widgetId) => set((s) => {
    const page = getPage(s.project, pageId);
    if (!page) return;
    const widget = page.widgets.find((w) => w.id === widgetId);
    if (!widget) return;
    widget.zIndex = maxZIndex(page) + 1;
  }),

  setOutputProtocol: (pageId, widgetId, protocol) => set((s) => {
    const page = getPage(s.project, pageId);
    if (!page) return;
    const widget = getWidget(page, widgetId);
    if (!widget || !('cells' in widget)) return;   // narrows to the cell banks (slider/button/knob)
    widget.outputProtocol = protocol;
    const baseCC = nextFreeCc(page.widgets.filter((w) => w.id !== widgetId));
    const num = widgetLabelNum(widget.label);
    (widget.cells as { mapping: unknown }[]).forEach((cell, i) => {
      if (protocol === 'midi') {
        cell.mapping = defaultMidiMapping(i, baseCC);
      } else if (protocol === 'osc') {
        cell.mapping = defaultOscMapping(widget.kind, num, i);
      } else if (protocol === 'enttec') {
        cell.mapping = { type: 'enttec', channel: (baseCC + i) % 512 + 1, minValue: 0, maxValue: 255 };
      } else if (protocol === 'artnet') {
        cell.mapping = { type: 'artnet', universe: 0, channel: (baseCC + i) % 512 + 1, minValue: 0, maxValue: 255 };
      } else if (protocol === 'sacn') {
        cell.mapping = { type: 'sacn', universe: 1, channel: (baseCC + i) % 512 + 1, minValue: 0, maxValue: 255, priority: 100 };
      }
    });
    touchUpdatedAt(s.project);
  }),

  updateCell: (pageId, widgetId, cellIndex, patch) => set((s) => {
    const page = getPage(s.project, pageId);
    if (!page) return;
    const widget = page.widgets.find((w) => w.id === widgetId);
    if (!widget || !('cells' in widget)) return;   // narrows to the cell banks (slider/button/knob)
    const cell = (widget.cells as unknown as Record<string, unknown>[])[cellIndex];
    if (!cell) return;
    Object.assign(cell, patch);
    touchUpdatedAt(s.project);
  }),

  updateWidgetCounts: (pageId, widgetId, countX, countY) => set((s) => {
    const page = getPage(s.project, pageId);
    if (!page) return;
    const widget = getWidget(page, widgetId);
    if (!widget || !('cells' in widget)) return;   // narrows to the cell banks (slider/button/knob)

    const newCount = countX * countY;
    const oldCells = (widget as { cells: unknown[] }).cells;
    const baseCC = nextFreeCc(page.widgets.filter((w) => w.id !== widgetId));

    let newCells: unknown[];
    if (widget.kind === 'sliderBank') {
      newCells = makeSliderCells(newCount, baseCC, 'S').map((def, i) =>
        i < oldCells.length ? oldCells[i] : def
      );
    } else if (widget.kind === 'buttonGrid') {
      newCells = makeButtonCells(newCount, baseCC, 'B').map((def, i) =>
        i < oldCells.length ? oldCells[i] : def
      );
    } else {
      newCells = makeKnobCells(newCount, baseCC, 'K').map((def, i) =>
        i < oldCells.length ? oldCells[i] : def
      );
    }

    // Cells added to an OSC bank get OSC addresses, not the MIDI defaults.
    if (widget.outputProtocol === 'osc') {
      const num = widgetLabelNum(widget.label);
      (newCells as { mapping: unknown }[]).forEach((c, i) => { if (i >= oldCells.length) c.mapping = defaultOscMapping(widget.kind, num, i); });
    }
    Object.assign(widget, { countX, countY, cells: newCells });
    touchUpdatedAt(s.project);
  }),

  resetCellMappings: (pageId, widgetId) => set((s) => {
    const page = getPage(s.project, pageId);
    if (!page) return;
    const widget = getWidget(page, widgetId);
    if (!widget || !('cells' in widget)) return;   // narrows to the cell banks (slider/button/knob)
    const proto = widget.outputProtocol;
    const baseCC = nextFreeCc(page.widgets.filter((w) => w.id !== widgetId));
    const num = widgetLabelNum(widget.label);
    (widget.cells as { mapping: unknown }[]).forEach((cell, i) => {
      if (proto === 'midi') {
        cell.mapping = defaultMidiMapping(i, baseCC);
      } else if (proto === 'osc') {
        cell.mapping = defaultOscMapping(widget.kind, num, i);
      } else if (proto === 'enttec') {
        cell.mapping = { type: 'enttec', channel: (baseCC + i) % 512 + 1, minValue: 0, maxValue: 255 };
      } else if (proto === 'artnet') {
        cell.mapping = { type: 'artnet', universe: 0, channel: (baseCC + i) % 512 + 1, minValue: 0, maxValue: 255 };
      } else {
        cell.mapping = { type: 'sacn', universe: 1, channel: (baseCC + i) % 512 + 1, minValue: 0, maxValue: 255, priority: 100 };
      }
    });
    touchUpdatedAt(s.project);
  }),

  resetCellNames: (pageId, widgetId) => set((s) => {
    const page = getPage(s.project, pageId);
    if (!page) return;
    const widget = getWidget(page, widgetId);
    if (!widget || !('cells' in widget)) return;   // narrows to the cell banks (slider/button/knob)
    applyDefaultCellLabels(widget);
    touchUpdatedAt(s.project);
  }),

  resetCellColors: (pageId, widgetId) => set((s) => {
    const page = getPage(s.project, pageId);
    if (!page) return;
    const widget = getWidget(page, widgetId);
    if (!widget || !('cells' in widget)) return;   // narrows to the cell banks (slider/button/knob)
    (widget.cells as { color?: string }[]).forEach((c) => { delete c.color; });
    touchUpdatedAt(s.project);
  }),

  linkSlaveCell: (params) => set((s) => {
    const snapshot = JSON.parse(JSON.stringify(s.project)) as Project;
    s.projectHistory.push(snapshot);
    if (s.projectHistory.length > 50) s.projectHistory.shift();
    applySlaveLink(s.project, params);
    touchUpdatedAt(s.project);
  }),

  linkSlaveCells: (routerId, links) => set((s) => {
    if (links.length === 0) return;
    const snapshot = JSON.parse(JSON.stringify(s.project)) as Project;
    s.projectHistory.push(snapshot);
    if (s.projectHistory.length > 50) s.projectHistory.shift();
    for (const l of links) applySlaveLink(s.project, { ...l, routerId });
    touchUpdatedAt(s.project);
  }),

  // Restore a saved link/routing state (used by Cues). EVERY router is set to the
  // cue's saved rows, or emptied if it wasn't in the snapshot — so returning to an
  // older cue removes links (and their routers' rows) created after it. Full scene
  // recall. Not history-tracked (live recall).
  applyLinksSnapshot: (links) => set((s) => {
    mainRouterRows(s.project);
    for (const r of eachRouter(s.project)) {
      const saved = links[r.id];
      r.holder.rows = saved ? (JSON.parse(JSON.stringify(saved)) as RouterRow[]) : [];
    }
    touchUpdatedAt(s.project);
  }),

  unlinkSlaveCell: (slaveWidgetId, slaveCellIndex) => set((s) => {
    const snapshot = JSON.parse(JSON.stringify(s.project)) as Project;
    s.projectHistory.push(snapshot);
    if (s.projectHistory.length > 50) s.projectHistory.shift();

    mainRouterRows(s.project);
    for (const r of eachRouter(s.project)) {
      for (const row of r.holder.rows) {
        row.outputs = row.outputs.filter(
          (o) => !(o.targetWidgetId === slaveWidgetId && (o.targetCellIndex ?? 0) === slaveCellIndex)
        );
      }
      r.holder.rows = r.holder.rows.filter((row) => row.outputs.length > 0);
    }
    touchUpdatedAt(s.project);
  }),

  removeRouterOutputs: (refs) => set((s) => {
    if (refs.length === 0) return;
    const snapshot = JSON.parse(JSON.stringify(s.project)) as Project;
    s.projectHistory.push(snapshot);
    if (s.projectHistory.length > 50) s.projectHistory.shift();

    mainRouterRows(s.project);
    for (const r of eachRouter(s.project)) {
      const mine = refs.filter((x) => x.routerId === r.id);
      if (mine.length === 0) continue;
      r.holder.rows = r.holder.rows.filter((row) => {
        const cut = mine.filter((x) => x.rowId === row.id).map((x) => x.outputId);
        if (cut.length === 0) return true;
        row.outputs = row.outputs.filter((o) => !cut.includes(o.id));
        return row.outputs.length > 0;
      });
    }
    touchUpdatedAt(s.project);
  }),

  // ── Router page edits — main router or any router widget, by id ──────────
  updateRouterRow: (routerId, rowId, patch) => set((s) => {
    const r = eachRouter(s.project).find((x) => x.id === routerId);
    const row = r?.holder.rows.find((x) => x.id === rowId);
    if (!row) return;
    Object.assign(row, patch);
    touchUpdatedAt(s.project);
  }),

  updateRouterOutput: (routerId, rowId, outputId, patch) => set((s) => {
    const r = eachRouter(s.project).find((x) => x.id === routerId);
    const out = r?.holder.rows.find((x) => x.id === rowId)?.outputs.find((o) => o.id === outputId);
    if (!out) return;
    Object.assign(out, patch);
    // Pointing at a widget cell: that cell drops any other source (one source
    // per slave cell, same rule as every other way of linking).
    if (patch.targetWidgetId) {
      const tw = out.targetWidgetId, tc = out.targetCellIndex ?? 0;
      for (const rr of eachRouter(s.project)) {
        for (const row of rr.holder.rows) {
          row.outputs = row.outputs.filter((o) => o.id === outputId
            || !(o.targetWidgetId === tw && (o.targetCellIndex ?? 0) === tc));
        }
        rr.holder.rows = rr.holder.rows.filter((row) => row.outputs.length > 0);
      }
    }
    touchUpdatedAt(s.project);
  }),

  // A row with several outputs shares ONE source. Changing the source of one
  // link must not drag its siblings along, so that output moves to a row of
  // its own first. Returns the row id the output now lives in.
  splitRouterOutput: (routerId, rowId, outputId) => {
    let newRowId = rowId;
    set((s) => {
      const r = eachRouter(s.project).find((x) => x.id === routerId);
      const row = r?.holder.rows.find((x) => x.id === rowId);
      if (!r || !row || row.outputs.length < 2) return;
      const out = row.outputs.find((o) => o.id === outputId);
      if (!out) return;
      row.outputs = row.outputs.filter((o) => o.id !== outputId);
      newRowId = nanoid();
      const copy = JSON.parse(JSON.stringify({ ...row, outputs: [] })) as RouterRow;
      r.holder.rows.push({ ...copy, id: newRowId, createdAt: row.createdAt, outputs: [out] });
    });
    return newRowId;
  },

  dropCellAndShiftLinks: (widgetId, index) => set((s) => {
    for (const r of eachRouter(s.project)) {
      r.holder.rows = r.holder.rows.filter((row) => {
        if (row.widgetId === widgetId && (row.inputType ?? 'widget') === 'widget' && !row.allCells) {
          if (row.cellIndex === index) return false;
          if (row.cellIndex > index) row.cellIndex -= 1;
        }
        row.outputs = row.outputs.filter((o) => {
          if (o.targetWidgetId !== widgetId || o.targetAllCells) return true;
          const c = o.targetCellIndex ?? 0;
          if (c === index) return false;
          if (c > index) o.targetCellIndex = c - 1;
          return true;
        });
        return row.outputs.length > 0;
      });
    }
    touchUpdatedAt(s.project);
  }),

  addMainRouterLink: () => {
    const rowId = nanoid();
    set((s) => {
      mainRouterRows(s.project).rows.push({
        id: rowId, createdAt: Date.now(), inputType: 'widget', widgetId: '', cellIndex: 0,
        outputs: [{ id: nanoid(), mapping: null }],
      });
      touchUpdatedAt(s.project);
    });
    return rowId;
  },

  captureHistory: () => set((s) => {
    const snapshot = JSON.parse(JSON.stringify(s.project)) as Project;
    s.projectHistory.push(snapshot);
    if (s.projectHistory.length > 50) s.projectHistory.shift();
  }),

  undo: () => set((s) => {
    const prev = s.projectHistory.pop();
    if (!prev) return;
    s.project = prev;
    s.activePageId = prev.activePageId;
    s.selectedWidgetId = null;
  }),

  copyWidgets: (widgets) => set((s) => {
    s.clipboard = JSON.parse(JSON.stringify(widgets)) as Widget[];
    s.clipboardMode = 'copy';
  }),

  cutWidgets: (pageId, widgetIds) => set((s) => {
    const page = getPage(s.project, pageId);
    if (!page || widgetIds.length === 0) return;
    const snapshot = JSON.parse(JSON.stringify(s.project)) as Project;
    s.projectHistory.push(snapshot);
    if (s.projectHistory.length > 50) s.projectHistory.shift();
    // Clone the cut widgets (preserving page order + their ORIGINAL ids) onto the
    // clipboard, then remove them. On paste the same ids are restored, so it's a
    // true move — router links referencing these widgets by id stay intact,
    // even when pasted on a different page.
    const cut = page.widgets.filter((w) => widgetIds.includes(w.id));
    if (cut.length === 0) return;
    s.clipboard = JSON.parse(JSON.stringify(cut)) as Widget[];
    s.clipboardMode = 'cut';
    page.widgets = page.widgets.filter((w) => !widgetIds.includes(w.id));
    s.selectedWidgetId = null;
    s.selectedWidgetIds = [];
    touchUpdatedAt(s.project);
  }),

  pasteWidgets: (pageId) => set((s) => {
    if (s.clipboard.length === 0) return;
    const page = getPage(s.project, pageId);
    if (!page) return;
    const snapshot = JSON.parse(JSON.stringify(s.project)) as Project;
    s.projectHistory.push(snapshot);
    if (s.projectHistory.length > 50) s.projectHistory.shift();

    const isCut = s.clipboardMode === 'cut';
    let z = maxZIndex(page);
    const newIds: string[] = [];

    if (isCut) {
      // Move: keep the original id, label, mappings and position (links follow).
      for (const src of s.clipboard) {
        const w = JSON.parse(JSON.stringify(src)) as Widget;
        w.zIndex = ++z;
        page.widgets.push(w);
        newIds.push(w.id);
      }
      // A cut can be pasted (moved) once; downgrade so a second paste duplicates.
      s.clipboardMode = 'copy';
    } else {
      // Duplicate: fresh ids, unique labels, free CC/DMX blocks. Internal links
      // (references between copied widgets) are remapped so they follow the copy.
      const clones = s.clipboard.map((src) => JSON.parse(JSON.stringify(src)) as Widget);
      const idMap: Record<string, string> = {};
      for (const c of clones) { const nid = nanoid(); idMap[c.id] = nid; c.id = nid; }
      for (const c of clones) {
        c.rect = { ...c.rect, x: c.rect.x + 24, y: c.rect.y + 24 };
        c.zIndex = ++z;
        const oldLabel = c.label;
        c.label = nextUniqueLabel(s.project, c.kind);
        // Renumber only the cells still carrying their default name or default
        // OSC address — anything you typed yourself survives the copy.
        if ('cells' in c) {
          const oldNum = widgetLabelNum(oldLabel);
          const newNum = widgetLabelNum(c.label);
          (c.cells as { label: string; mapping: Mapping }[]).forEach((cell, i) => {
            if (cell.label === defaultCellLabel(c.kind, i, oldLabel)) {
              cell.label = defaultCellLabel(c.kind, i, c.label);
            }
            // reassignOutputs bumps MIDI/DMX numbers but leaves OSC alone, so
            // without this a copy kept pointing at the original's addresses.
            if (cell.mapping?.type === 'osc'
                && cell.mapping.address === defaultOscMapping(c.kind, oldNum, i).address) {
              cell.mapping = { ...cell.mapping, address: defaultOscMapping(c.kind, newNum, i).address };
            }
          });
        }
        reassignOutputs(c, nextFreeCc(page.widgets));
        remapWidgetRefs(c, idMap);
        page.widgets.push(c);
        newIds.push(c.id);
      }
    }

    if (newIds.length === 1) {
      s.selectedWidgetId = newIds[0];
      s.selectedWidgetIds = [];
    } else {
      s.selectedWidgetId = null;
      s.selectedWidgetIds = newIds;
    }
    touchUpdatedAt(s.project);
  }),
});
