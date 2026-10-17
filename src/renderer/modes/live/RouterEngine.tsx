import { useEffect, useRef } from 'react';
import type { RouterRow, RouterOutput, Widget } from '../../../shared/types/project';
import type { Mapping } from '../../../shared/types/mapping';
import { useStore } from '../../store';
import { cellCount } from '../../widgets/utils';
import { setMergeInput } from '../../widgets/Merge/mergeEngine';
import { remapRange, isIdentityRange } from '../../widgets/base/range';
import { dispatchValue } from '../../ipc/dispatch';
import { pressCell, releaseCell } from '../../widgets/ButtonGrid/behavior';
import { bridge } from '../../ipc/bridge';
import { transportCommandOf, sendTimelineCommand } from '../../widgets/Timeline/transport';
import { onDmxInput } from '../../ipc/dmxInput';
import { cellMapping } from '../../widgets/base/cellMapping';
import { paramInputOf, setParamInput } from '../../widgets/base/paramInputs';
import { allRouterRows as allProjectRouterRows } from '../../widgets/base/routers';

// Headless engine that runs ALL router rows across ALL pages, regardless of
// which page is currently shown. This is what makes cross-page links work:
// a router only routes while its own page is mounted otherwise, but here the
// engine is mounted once for the whole Live session.
//
// Note: generator sources (LFO, timeline, autoBpm, audioAnalyser, stepSequencer,
// graph) only tick while their page is active — their animation loops live in
// their Live components. When their page is not shown, their runtime value
// freezes at the last emitted value and the engine keeps forwarding that.

function getWidgetCellMapping(widgetId: string, cellIndex: number): Mapping {
  return cellMapping(useStore.getState().project, widgetId, cellIndex);
}

function isButtonTarget(widgetId: string): boolean {
  for (const page of useStore.getState().project.pages) {
    const w = page.widgets.find((x) => x.id === widgetId);
    if (w) return w.kind === 'buttonGrid';
  }
  return false;
}

function findWidget(widgetId: string): Widget | undefined {
  for (const page of useStore.getState().project.pages) {
    const w = page.widgets.find((x) => x.id === widgetId);
    if (w) return w;
  }
  return undefined;
}

// Last incoming value per driven button cell, so an edge can be told from a
// stream of the same value. Module-level: the engine is mounted once.
const lastButtonInput = new Map<string, number>();

// Timeline transport inputs fire on the rising edge only (≥ 0.5), so a pad's
// note-off, a fader resting at full or a DMX channel held open fire once.
const lastTransportInput = new Map<string, number>();

function driveTimelineTransport(widgetId: string, cellIdx: number, v: number, initial: boolean): void {
  const cmd = transportCommandOf(cellIdx);
  if (!cmd) return;
  const key = `${widgetId}:${cellIdx}`;
  const prev = lastTransportInput.get(key) ?? 0;
  lastTransportInput.set(key, v);
  // `initial`: the first value ever seen on a streamed input (Art-Net). A
  // console that is already sitting at full when Maestrale starts listening
  // must not fire GO by itself — only a real move does.
  if (initial) return;
  if (prev < 0.5 && v >= 0.5) sendTimelineCommand(widgetId, cmd);
}

// Widgets whose cells are triggers, not levels: they act on a rising edge, so
// the first value of a stream (a console already at full when we start
// listening) must not reach them — only a real move may fire.
const TRIGGER_KINDS = new Set<Widget['kind']>(['dmxRecorder', 'dmxPlayer', 'cues', 'soundPlayer', 'keyboard', 'shell']);
const lastTriggerInput = new Map<string, number>();

function driveCell(widgetId: string, cellIdx: number, v: number, isButton: boolean, initial = false): void {
  if (cellIdx < 0) {
    const tw = findWidget(widgetId);
    if (tw?.kind === 'merge') { setMergeInput(widgetId, -cellIdx, v); return; }
    // Math: in k (any number of them, like the Merge box) → a parameter input.
    if (tw?.kind === 'mathWidget') { setParamInput(widgetId, `in${-cellIdx}`, v); return; }
    if (tw?.kind === 'timeline') { driveTimelineTransport(widgetId, cellIdx, v, initial); return; }
    // Continuous parameter inputs (LFO SPEED / RATE / PHASE): just the value.
    const pi = tw ? paramInputOf(tw, cellIdx) : undefined;
    if (pi) setParamInput(widgetId, pi.key, v);
    return;
  }
  if (isButton) { driveButtonCell(widgetId, cellIdx, v, initial); return; }
  const w = findWidget(widgetId);
  if (w && TRIGGER_KINDS.has(w.kind)) {
    const key = `${widgetId}:${cellIdx}`;
    const prev = lastTriggerInput.get(key);
    lastTriggerInput.set(key, v);
    if (initial) return;
    // Still held high since that first frame, just wiggling: no edge yet.
    const cur = useStore.getState().runtime.widgets[widgetId]?.cells[cellIdx]?.value ?? 0;
    if (prev !== undefined && prev >= 0.5 && v >= 0.5 && cur < 0.5) return;
  }
  useStore.getState().setCellValue(widgetId, cellIdx, v);
  const cellMapping = getWidgetCellMapping(widgetId, cellIdx);
  if (cellMapping) dispatchValue(cellMapping, v);
}

// A physical pad sends note-on then note-off. Writing that straight into the
// cell made every linked button momentary regardless of how it was configured,
// so the incoming EDGE is treated as a press/release and the cell's own
// behaviour decides the state — a toggle stays lit after the pad is released.
// pressCell also sends the cell's mapping, so a controller patched to the MIDI
// output gets the resulting state back and lights its LED.
function driveButtonCell(widgetId: string, cellIdx: number, v: number, initial = false): void {
  const w = findWidget(widgetId);
  if (!w || w.kind !== 'buttonGrid') return;
  const key = `${widgetId}:${cellIdx}`;
  const prev = lastButtonInput.get(key) ?? 0;
  lastButtonInput.set(key, v);
  if (initial) return;   // see driveTimelineTransport
  if (prev < 0.5 && v >= 0.5) pressCell(w, cellIdx);
  else if (prev >= 0.5 && v < 0.5) releaseCell(w, cellIdx);
}

// ─── Smooth / spring ──────────────────────────────────────────────────────────
// An output with a motion filter does not jump: the engine keeps a target per
// output (and per source cell for ALL rows) and moves a follower towards it on
// every frame, sending what the follower reads. Idle followers cost nothing.
interface Follower { target: number; s: number; x: number; v: number; out: RouterOutput; srcIndex?: number }
const followers = new Map<string, Follower>();
let rafId = 0;
let lastT = 0;

function filtered(out: RouterOutput): boolean { return !!(out.smoothOn || out.springOn); }

function follow(key: string, out: RouterOutput, target: number, srcIndex: number | undefined, from: number): void {
  const f = followers.get(key);
  if (f) { f.target = target; f.out = out; }
  else followers.set(key, { target, s: from, x: from, v: 0, out, srcIndex });
  if (!rafId) { lastT = performance.now(); rafId = requestAnimationFrame(stepFollowers); }
}

function stepFollowers(now: number): void {
  const dt = Math.min(0.05, Math.max(0.001, (now - lastT) / 1000));
  lastT = now;
  for (const [key, f] of followers) {
    const o = f.out;
    const dir = o.smoothDir ?? 'both';
    const rising = f.target > f.s;
    if (o.smoothOn && (dir === 'both' || (dir === 'in') === rising)) {
      const tau = 0.02 + (o.smooth ?? 0.3) * 1.5;
      f.s += (f.target - f.s) * (1 - Math.exp(-dt / tau));
    } else f.s = f.target;
    if (o.springOn) {
      const zeta = 1 - 0.92 * (o.spring ?? 0.5);    // damping: 1 = no bounce
      const w = 2 * Math.PI * 2.2;                 // ~2 Hz
      const a = w * w * (f.s - f.x) - 2 * zeta * w * f.v;
      f.v += a * dt;
      f.x += f.v * dt;
    } else { f.x = f.s; f.v = 0; }
    const settled = Math.abs(f.target - f.s) < 1e-4 && Math.abs(f.s - f.x) < 1e-4 && Math.abs(f.v) < 1e-3;
    if (settled) { f.x = f.target; followers.delete(key); }
    sendOut(o, Math.max(0, Math.min(1, f.x)), f.srcIndex, false);
  }
  rafId = followers.size ? requestAnimationFrame(stepFollowers) : 0;
}

// Where a follower starts: what the output last sent, else the destination's
// current value, so switching smooth on never makes the target jump first.
const lastOut = new Map<string, number>();

// srcIndex is set when the row listens to a whole widget: the value then belongs
// to one specific source cell, and an ALL output mirrors it onto the SAME index
// (bank → bank, 1:1). Without it an ALL output fans one value out to every cell.
function routeValue(row: RouterRow, vIn: number, srcIndex?: number, initial = false): void {
  // Publish what the row received so the router widget can show it. Widget-input
  // rows read their source cell directly and do not need this; MIDI and OSC rows
  // have no cell to read, which is why they used to display a permanent 0.
  if ((row.inputType ?? 'widget') !== 'widget') {
    useStore.getState().setRouterInput(row.id, vIn);
  }
  for (const out of row.outputs) {
    if (out.muted) continue;   // switched off on the Router page
    // Each output gets its own travel through the source's range.
    const v = isIdentityRange(out) ? vIn : remapRange(vIn, out);
    const key = `${row.id}:${out.id}:${srcIndex ?? '-'}`;
    if (filtered(out) && !initial) {
      follow(key, out, v, srcIndex, lastOut.get(key) ?? v);
      lastOut.set(key, v);
      continue;
    }
    followers.delete(key);
    lastOut.set(key, v);
    sendOut(out, v, srcIndex, initial);
  }
}

function sendOut(out: RouterOutput, v: number, srcIndex: number | undefined, initial: boolean): void {
  {
    if (out.targetWidgetId) {
      const isButton = isButtonTarget(out.targetWidgetId);
      if (out.targetAllCells) {
        const w = findWidget(out.targetWidgetId);
        const n = w ? cellCount(w) : 0;
        if (srcIndex !== undefined) {
          if (srcIndex < n) driveCell(out.targetWidgetId, srcIndex, v, isButton, initial);
        } else {
          for (let i = 0; i < n; i++) driveCell(out.targetWidgetId, i, v, isButton, initial);
        }
      } else {
        // A single-cell output cannot follow an index, so it tracks the first
        // source cell only.
        if (srcIndex === undefined || srcIndex === 0) {
          driveCell(out.targetWidgetId, out.targetCellIndex ?? 0, v, isButton, initial);
        }
      }
    } else if (out.mapping) {
      if (srcIndex === undefined || srcIndex === 0) dispatchValue(out.mapping, v);
    }
  }
}

// All router rows in the project: the main router plus every Router widget.
function allRouterRows(): RouterRow[] {
  return allProjectRouterRows(useStore.getState().project);
}

export default function RouterEngine(): null {
  const prevValues = useRef<Record<string, number>>({});

  // Widget-cell sources — react to runtime store changes.
  useEffect(() => {
    const unsubscribe = useStore.subscribe((state, prevState) => {
      if (state.runtime.widgets === prevState.runtime.widgets) return;

      for (const row of allRouterRows()) {
        if (row.outputs.length === 0) continue;
        const inputType = row.inputType ?? 'widget';
        if (inputType !== 'widget' || !row.widgetId) continue;

        const wRuntime = state.runtime.widgets[row.widgetId];
        if (!wRuntime) continue;

        if (row.allCells) {
          // Every cell of the source is its own signal, tracked separately so a
          // bank mirrors onto another bank fader by fader.
          for (let i = 0; i < wRuntime.cells.length; i++) {
            const c = wRuntime.cells[i];
            if (!c) continue;
            const cv = c.value !== undefined ? c.value : (c.active ? 1 : 0);
            const key = `${row.id}:${i}`;
            if (prevValues.current[key] === cv) continue;
            prevValues.current[key] = cv;
            routeValue(row, cv, i);
          }
          continue;
        }

        const cell = wRuntime.cells[row.cellIndex];
        if (!cell) continue;

        const v = cell.value !== undefined ? cell.value : (cell.active ? 1 : 0);
        if (prevValues.current[row.id] === v) continue;
        prevValues.current[row.id] = v;
        routeValue(row, v);
      }
    });
    return unsubscribe;
  }, []);

  // MIDI input sources.
  useEffect(() => {
    const unsubscribe = bridge.on('tr:midi:inputEvent', (evt) => {
      for (const row of allRouterRows()) {
        if (row.outputs.length === 0) continue;
        const inputType = row.inputType ?? 'widget';
        if (inputType !== 'midiCC' && inputType !== 'midiNote' && inputType !== 'midiPB') continue;

        const ch = row.midiChannel ?? 0;
        if (ch !== 0 && ch !== evt.channel) continue;

        let v: number;
        if (inputType === 'midiCC') {
          if (evt.messageType !== 'controlChange') continue;
          if (row.midiNumber !== undefined && row.midiNumber !== evt.number) continue;
          v = evt.value / 127;
        } else if (inputType === 'midiPB') {
          // 14-bit: number = LSB, value = MSB → 0…16383.
          if (evt.messageType !== 'pitchBend') continue;
          v = ((evt.value << 7) | evt.number) / 16383;
        } else {
          if (evt.messageType !== 'noteOn' && evt.messageType !== 'noteOff') continue;
          if (row.midiNumber !== undefined && row.midiNumber !== evt.number) continue;
          v = evt.messageType === 'noteOn' ? evt.value / 127 : 0;
        }

        if (prevValues.current[row.id] === v) continue;
        prevValues.current[row.id] = v;
        routeValue(row, v);
      }
    });
    return unsubscribe;
  }, []);

  // OSC input sources.
  useEffect(() => {
    const unsubscribe = bridge.on('tr:osc:feedback', (msg) => {
      for (const row of allRouterRows()) {
        if (row.outputs.length === 0) continue;
        const inputType = row.inputType ?? 'widget';
        if (inputType !== 'osc') continue;
        if (!row.oscAddress || msg.address !== row.oscAddress) continue;

        const firstArg = msg.args[0];
        let v: number;
        if (typeof firstArg === 'number') {
          v = Math.max(0, Math.min(1, firstArg));
        } else if (typeof firstArg === 'boolean') {
          v = firstArg ? 1 : 0;
        } else {
          continue;
        }

        if (prevValues.current[row.id] === v) continue;
        prevValues.current[row.id] = v;
        routeValue(row, v);
      }
    });
    return unsubscribe;
  }, []);

  // Art-Net and sACN input sources (same row fields: universe + channel). One batch of changed channels at a time; a row
  // listening on a channel that did not change is not touched.
  useEffect(() => onDmxInput((changes) => {
    const rows = allRouterRows().filter((r) => (r.inputType === 'artnet' || r.inputType === 'sacn') && r.outputs.length > 0);
    if (rows.length === 0) return;
    for (const c of changes) {
      for (const row of rows) {
        if (row.inputType !== c.protocol) continue;
        if ((row.artnetUniverse ?? 0) !== c.universe || (row.artnetChannel ?? 1) !== c.channel) continue;
        const v = c.value / 255;
        if (prevValues.current[row.id] === v && !c.initial) continue;
        prevValues.current[row.id] = v;
        // `initial`: the console's state when we started listening. Faders take
        // it; triggers (GO, buttons) only record it, so nothing fires by itself.
        routeValue(row, v, undefined, c.initial);
      }
    }
  }), []);

  return null;
}
