// Shared helpers for the "slave link" feature — right-click a control cell to
// slave it to another widget cell (or MIDI/OSC) via a Router row.
//
// A link is materialised as a RouterRow whose output targets the slave cell.
// Model: one router row per slave cell (source + a single output → slave cell).
// This keeps unlink / re-source trivial and robust.

import type { Project, Widget, RouterRow, RouterInputType, TrigTrack, CueTrack } from '../../../shared/types/project';
import { cellCount, timelineTrigCells, timelineCueCells } from '../utils';
import { takeName as takeNameOf } from '../../ipc/dmxTakes';
import { paramInputsOf, paramInputOf } from './paramInputs';
import { eachRouter } from './routers';
import { iControlsCellLabel } from '../IControls/iControlsMidi';

const BEAT_DIVS = [1, 2, 3, 4, 8, 16, 32, 64] as const;

// ─── Cell labelling ────────────────────────────────────────────────────────────
// Human label for the i-th cell of a widget (shared by RouterDesign + link menu).

// Label for "every cell of this widget". Reuses the cell naming so it reads as
// one of the family: a bank whose cells are S1.1…S1.8 shows as S1.ALL.
export function allCellsLabel(w: Widget | undefined): string {
  if (!w) return 'ALL';
  const cells = (w as { cells?: { label?: string }[] }).cells;
  const first = Array.isArray(cells) ? cells[0]?.label : undefined;
  const stem = first?.match(/^(.*)\.\d+$/)?.[1];
  return stem ? `${stem}.ALL` : 'ALL';
}

export function cellLabel(w: Widget | undefined, cellIndex: number): string {
  if (!w) return `#${cellIndex + 1}`;
  // Negative cells are parameter inputs (timeline GO, LFO SPEED…).
  if (cellIndex < 0) return paramInputOf(w, cellIndex)?.label ?? `in ${-cellIndex}`;
  if (w.kind === 'xyPad') {
    if (w.zSlider && cellIndex === 2 * (1 + (w.points?.length ?? 0))) return 'Z';
    const dot = Math.floor(cellIndex / 2), axis = cellIndex % 2 === 0 ? 'X' : 'Y';
    if (!w.points?.length) return axis;
    const name = dot === 0 ? '1' : (w.points[dot - 1]?.label || String(dot + 1));
    return `${name} ${axis}`;
  }
  if (w.kind === 'stepSequencer') return 'value';
  if (w.kind === 'graphWidget') {
    if (cellIndex === 0) return 'value';
    const lane = w.lanes?.[cellIndex - 1];
    return lane ? `out ${cellIndex + 1} φ${Math.round(lane.phase * 100) / 100}` : `out ${cellIndex + 1}`;
  }
  if (w.kind === 'lfoWidget' || w.kind === 'noiseWidget') {
    if (cellIndex === 0) return 'output';
    const lane = w.lanes?.[cellIndex - 1];
    return lane ? `out ${cellIndex + 1} φ${(Math.round(lane.phase * 100) / 100).toString()}` : `out ${cellIndex + 1}`;
  }
  if (w.kind === 'mathWidget') return 'result';
  if (w.kind === 'etc') return ['Master 1', 'Master 2', 'Grandmaster', 'GO', 'STOP'][cellIndex] ?? `#${cellIndex + 1}`;
  if (w.kind === 'shell') return w.buttons[cellIndex]?.label || `#${cellIndex + 1}`;
  if (w.kind === 'palette') return `${Math.floor(cellIndex / 3) + 1} ${'RGB'[cellIndex % 3]}`;
  if (w.kind === 'merge') return String(cellIndex + 1);
  if (w.kind === 'masterLevel') return 'level';
  if (w.kind === 'iControls') return iControlsCellLabel(cellIndex);
  if (w.kind === 'sketch') {
    const axis = cellIndex % 2 === 0 ? 'X' : 'Y';
    return (w.dots || 1) > 1 ? `${Math.floor(cellIndex / 2) + 1} ${axis}` : axis;
  }
  if (w.kind === 'audioLevel') return w.mode === 'in' ? 'input level' : 'audio master';
  if (w.kind === 'dmxRecorder') return 'REC';
  if (w.kind === 'clock') {
    const a = w.alarms[cellIndex];
    return a ? (a.label ? `${a.time} ${a.label}` : a.time) : `#${cellIndex + 1}`;
  }
  if (w.kind === 'dmxPlayer') {
    const it = w.items[cellIndex];
    return it ? `▶ ${takeNameOf(it.takeId)}` : `#${cellIndex + 1}`;
  }
  if (w.kind === 'keyboard') {
    const k = w.keys[cellIndex];
    return k ? (k.label || k.code) : `#${cellIndex + 1}`;
  }
  if (w.kind === 'cues') {
    const cue = w.cues[cellIndex];
    return cue ? (cue.name || `cue ${cellIndex + 1}`) : `#${cellIndex + 1}`;
  }
  if (w.kind === 'autoBpm') {
    return cellIndex < 8
      ? `trig ×${BEAT_DIVS[cellIndex]}`
      : `ramp ×${BEAT_DIVS[cellIndex - 8]}`;
  }
  if (w.kind === 'timeline') {
    const track = w.tracks[cellIndex];
    if (track) return `${track.kind}: ${track.label}`;
    // Beyond the track cells: an individual trig marker, then a cue block.
    const trigs = timelineTrigCells(w);
    const cueEntry = timelineCueCells(w)[cellIndex - w.tracks.length - trigs.length];
    if (cueEntry) {
      const ct = w.tracks[cueEntry.trackIndex] as CueTrack;
      const region = ct.cues[cueEntry.regionIndex];
      return `cue: ${region?.name || `#${cueEntry.regionIndex + 1}`}`;
    }
    const entry = trigs[cellIndex - w.tracks.length];
    if (!entry) return `#${cellIndex + 1}`;
    const trk = w.tracks[entry.trackIndex] as TrigTrack;
    const mk  = trk.keyframes[entry.markerIndex];
    const name = mk?.name || `#${mk?.num ?? entry.markerIndex + 1}`;
    return `${trk.label} · ${name}`;
  }
  if (w.kind === 'audioAnalyser') {
    if (cellIndex < 5) return ['kick', 'snare', 'bass', 'mid', 'high'][cellIndex] ?? `#${cellIndex + 1}`;
    if (cellIndex < 13) return `trig ×${BEAT_DIVS[cellIndex - 5] ?? '?'}`;
    return `ramp ×${BEAT_DIVS[cellIndex - 13] ?? '?'}`;
  }
  if (w.kind === 'submasters') {
    const n = w.countX;
    const scene = w.scenes[cellIndex % n];
    const name = scene?.label || String((cellIndex % n) + 1);
    return cellIndex < n ? name : `${name} flash`;
  }
  if (w.kind === 'soundPlayer') {
    const track = w.tracks[cellIndex];
    return track ? (track.label || track.fileName || `track ${cellIndex + 1}`) : `#${cellIndex + 1}`;
  }
  if ('cells' in w && Array.isArray(w.cells)) {
    const c = (w.cells as { label?: string }[])[cellIndex];
    return c?.label || `#${cellIndex + 1}`;
  }
  return `#${cellIndex + 1}`;
}

// ─── Source enumeration (for the link menu) ─────────────────────────────────────

export interface SourceCell {
  index: number;
  label: string;
}

// Cells of a widget that can be used as a link source.
function allCells(widget: Widget): SourceCell[] {
  const n = cellCount(widget);
  return Array.from({ length: n }, (_, i) => ({ index: i, label: cellLabel(widget, i) }));
}

// ─── Who can be linked to what ──────────────────────────────────────────────────
// One place that decides which widgets make sense in each picker, so menus do
// not offer a DMX recorder as a value source or a monitor to a submaster.

// Widgets whose cells are triggers or mirrors, never values worth reading.
const NOT_A_SOURCE = new Set<Widget['kind']>(['shell', 'dmxPlayer', 'dmxRecorder', 'instance', 'manual', 'textWidget', 'imageWidget', 'dmxMonitor']);
export function isLinkSource(w: Widget): boolean {
  return !NOT_A_SOURCE.has(w.kind) && cellCount(w) > 0;
}

// What a submaster scene can hold: plain controls.
export const SUBMASTER_KINDS = new Set<Widget['kind']>(['sliderBank', 'knobBank', 'buttonGrid', 'xyPad']);
export const SUBMASTER_ALL = '*all*';
export function submasterTargets(project: Project, sub: { id: string; linkedWidgetIds: string[]; excludeWidgetIds?: string[] }): Widget[] {
  const ex = sub.excludeWidgetIds ?? [];
  const all = project.pages.flatMap((p) => p.widgets).filter((w) => w.id !== sub.id && SUBMASTER_KINDS.has(w.kind) && !ex.includes(w.id));
  if (sub.linkedWidgetIds.includes(SUBMASTER_ALL)) return all;
  return all.filter((w) => sub.linkedWidgetIds.includes(w.id));
}

// What an Instance can mirror: widgets you play by hand.
export const INSTANCE_KINDS = new Set<Widget['kind']>([
  'sliderBank', 'knobBank', 'buttonGrid', 'xyPad', 'masterLevel', 'audioLevel', 'submasters', 'keyboard', 'cues', 'valueDisplay',
]);

// Cells a widget can SEND into a link (sources): outputs and controls.
export function sourceCells(widget: Widget): SourceCell[] {
  return isLinkSource(widget) ? allCells(widget) : [];
}

// Widgets whose cells can be DRIVEN (they take a value in). Everything else is
// output-only — an LFO, a math result, an analyser band — and linking an
// output onto an output means nothing.
export const INPUT_KINDS = new Set<Widget['kind']>([
  'sliderBank', 'knobBank', 'buttonGrid', 'xyPad', 'masterLevel',
  'keyboard', 'soundPlayer', 'cues', 'submasters', 'dmxRecorder', 'dmxPlayer', 'etc', 'shell',
]);

// Cells a router output can DRIVE: the cells of input widgets, plus parameter
// inputs (a timeline's GO / STOP / BACK, an LFO's SPEED / RATE / PHASE) — never
// outputs like timeline tracks or an LFO's wave.
export function targetCells(widget: Widget): SourceCell[] {
  const params = paramInputsOf(widget).map((p) => ({ index: p.index, label: p.label }));
  // The audio master fader takes input; the input meter only measures.
  if (widget.kind === 'audioLevel') return widget.mode === 'out' ? [...params, ...allCells(widget)] : params;
  return INPUT_KINDS.has(widget.kind) ? [...params, ...allCells(widget)] : params;
}

export interface SourcePageGroup {
  pageId: string;
  pageName: string;
  widgets: Widget[];
}

// All widgets across all pages that expose at least one cell (grouped by page).
// A widget is excluded as source only when it has no cells (router, image, text…).
export function listLinkableSources(project: Project): SourcePageGroup[] {
  const groups: SourcePageGroup[] = [];
  for (const page of project.pages) {
    const widgets = page.widgets.filter(isLinkSource);
    if (widgets.length > 0) {
      groups.push({ pageId: page.id, pageName: page.name, widgets });
    }
  }
  return groups;
}

// ─── Router enumeration ─────────────────────────────────────────────────────────

export interface RouterRef {
  id: string;
  label: string;
  pageId: string;
  pageName: string;
}

export function listRouters(project: Project): RouterRef[] {
  return eachRouter(project).map((r) => ({
    id: r.id, label: r.label, pageId: r.pageId ?? '', pageName: r.pageName ?? 'project',
  }));
}

// Page id a widget lives on (used to place a freshly-created router).
export function pageIdOfWidget(project: Project, widgetId: string): string | null {
  for (const page of project.pages) {
    if (page.widgets.some((w) => w.id === widgetId)) return page.id;
  }
  return null;
}

// ─── Slave link lookup ──────────────────────────────────────────────────────────

export interface SlaveLink {
  routerId: string;
  routerLabel: string;
  row: RouterRow;
  outputId: string;
  source: { primary: string; secondary: string };
}

function findWidgetById(project: Project, widgetId: string): Widget | undefined {
  for (const page of project.pages) {
    const w = page.widgets.find((x) => x.id === widgetId);
    if (w) return w;
  }
  return undefined;
}

// Describe a router row's input source for display.
export function describeRowSource(project: Project, row: RouterRow): { primary: string; secondary: string } {
  const t: RouterInputType = row.inputType ?? 'widget';
  if (t === 'midiCC')   return { primary: 'MIDI CC',   secondary: `ch${row.midiChannel ?? 1} #${row.midiNumber ?? 0}` };
  if (t === 'midiNote') return { primary: 'MIDI Note', secondary: `ch${row.midiChannel ?? 1} #${row.midiNumber ?? 0}` };
  if (t === 'midiPB')   return { primary: 'MIDI Pitch Bend', secondary: `ch${row.midiChannel || 'any'}` };
  if (t === 'osc')      return { primary: 'OSC',       secondary: row.oscAddress ?? '—' };
  if (t === 'artnet')   return { primary: 'Art-Net',   secondary: `U${row.artnetUniverse ?? 0} ch${row.artnetChannel ?? 1}` };
  if (t === 'sacn')     return { primary: 'sACN',      secondary: `U${row.artnetUniverse ?? 1} ch${row.artnetChannel ?? 1}` };
  const src = findWidgetById(project, row.widgetId);
  return { primary: src ? src.label : '—', secondary: cellLabel(src, row.cellIndex) };
}

// Find the router row whose output targets the given slave cell (first match).
export function findSlaveLink(project: Project, slaveWidgetId: string, slaveCellIndex: number): SlaveLink | null {
  for (const r of eachRouter(project)) {
    for (const row of r.holder.rows) {
      for (const out of row.outputs) {
        if (out.targetWidgetId === slaveWidgetId && (out.targetCellIndex ?? 0) === slaveCellIndex) {
          return {
            routerId: r.id,
            routerLabel: r.label,
            row,
            outputId: out.id,
            source: describeRowSource(project, row),
          };
        }
      }
    }
  }
  return null;
}

// Set of cell indices of a widget that are currently slaved (targeted by a router).
export function computeSlavedCellSet(project: Project, slaveWidgetId: string): Set<number> {
  const set = new Set<number>();
  for (const r of eachRouter(project)) {
    for (const row of r.holder.rows) {
      for (const out of row.outputs) {
        if (out.targetWidgetId === slaveWidgetId) set.add(out.targetCellIndex ?? 0);
      }
    }
  }
  return set;
}
