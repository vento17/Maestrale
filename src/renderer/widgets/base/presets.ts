import type { Widget, SliderBankWidget, KnobBankWidget, ButtonGridWidget } from '../../../shared/types/project';
import type { Mapping } from '../../../shared/types/mapping';
import { makeSliderCells, makeKnobCells, makeButtonCells } from '../defaults';

// Ready-made setups for the cell banks (sliders, knobs, buttons): a list of
// named cells with where each one sends. Built-in ones ship with Maestrale;
// your own are kept on this computer and work in every project.

export type PresetKind = 'sliderBank' | 'knobBank' | 'buttonGrid';
export type PresetProtocol = 'osc' | 'artnet' | 'sacn' | 'midi';

export interface CellPreset {
  id: string;
  name: string;
  group: string;                 // shown as a section of the dropdown
  kinds: PresetKind[];
  protocol: PresetProtocol;
  universe?: number;             // artnet / sacn
  midiChannel?: number;          // midi
  min?: number;                  // OSC range (default 0–1)
  max?: number;
  cells: { label: string; target: string }[];   // target: OSC address · DMX channel · CC number
  builtin?: boolean;
  note?: string;
}

const dmx = (id: string, name: string, labels: string[], note?: string): CellPreset => ({
  id, name, group: 'Lights (DMX)', kinds: ['sliderBank', 'knobBank'], protocol: 'artnet', universe: 0, builtin: true, note,
  cells: labels.map((label, i) => ({ label, target: String(i + 1) })),
});
const osc = (id: string, name: string, group: string, kinds: PresetKind[], cells: [string, string][], extra: Partial<CellPreset> = {}): CellPreset => ({
  id, name, group, kinds, protocol: 'osc', builtin: true, cells: cells.map(([label, target]) => ({ label, target })), ...extra,
});
const range = (n: number, f: (i: number) => [string, string]) => Array.from({ length: n }, (_, i) => f(i + 1));

const TD_FX = ['Level1', 'Edge', 'Sobel', 'Feedback', 'HSV', 'VHS', 'Glitch', 'Pixelate', 'Quantize', 'RuttEtra', 'LightRays', 'TimeSlice', 'Bloom', 'Bloom_GL', 'Ascii', 'Mirror', 'Rippler', 'Strobo', 'Level2'];

export const BUILTIN_PRESETS: CellPreset[] = [
  // Lights: one fixture, channels from 1 (change the universe / start in Edit).
  dmx('rgb', 'RGB', ['R', 'G', 'B']),
  dmx('rgbw', 'RGBW', ['R', 'G', 'B', 'W']),
  dmx('drgbw', 'DRGBW', ['Dimmer', 'R', 'G', 'B', 'W']),
  dmx('rgbwsd', 'RGBW + Strobe + Dimmer', ['R', 'G', 'B', 'W', 'Strobe', 'Dimmer']),
  dmx('rgbwau', 'RGBWA + UV', ['R', 'G', 'B', 'W', 'Amber', 'UV']),
  dmx('mh', 'Moving head (basic)', ['Pan', 'Pan fine', 'Tilt', 'Tilt fine', 'Dimmer', 'Shutter', 'Color', 'Gobo']),

  // ETC Eos over OSC.
  osc('eos-subs', 'Eos submasters 1–10', 'ETC Eos', ['sliderBank', 'knobBank'], range(10, (i) => [`Sub ${i}`, `/eos/sub/${i}`])),
  osc('eos-faders', 'Eos fader bank 1 (1–10)', 'ETC Eos', ['sliderBank', 'knobBank'], range(10, (i) => [`Fader ${i}`, `/eos/fader/1/${i}`]),
    { note: 'Eos needs the bank first: /eos/fader/1/config/10 (once, e.g. from a button).' }),
  osc('eos-chan', 'Eos channels 1–12 intensity', 'ETC Eos', ['sliderBank', 'knobBank'], range(12, (i) => [`Ch ${i}`, `/eos/chan/${i}`]), { min: 0, max: 100 }),
  osc('eos-pt', 'Eos pan / tilt (selected)', 'ETC Eos', ['sliderBank', 'knobBank'], [['Pan', '/eos/param/pan'], ['Tilt', '/eos/param/tilt']], { min: -270, max: 270, note: 'Range in degrees — set it to your fixtures.' }),
  osc('eos-macros', 'Eos macros 1–8', 'ETC Eos', ['buttonGrid'], range(8, (i) => [`Macro ${i}`, `/eos/macro/${i}/fire`])),
  osc('eos-cues', 'Eos cues 1–8 (list 1)', 'ETC Eos', ['buttonGrid'], range(8, (i) => [`Cue ${i}`, `/eos/cue/1/${i}/fire`])),
  osc('eos-chan-sel', 'Eos channels 1–16 (select)', 'ETC Eos', ['buttonGrid'], range(16, (i) => [`Ch ${i}`, `/eos/newcmd/Chan/${i}/Enter`]),
    { note: 'Each button types "Chan N Enter" on a fresh command line: the channel is selected.' }),
  osc('eos-group-sel', 'Eos groups 1–16 (select)', 'ETC Eos', ['buttonGrid'], range(16, (i) => [`Group ${i}`, `/eos/newcmd/Group/${i}/Enter`]),
    { note: 'Each button types "Group N Enter" on a fresh command line: the group is selected.' }),
  osc('eos-play','Eos GO / STOP-BACK', 'ETC Eos', ['buttonGrid'], [['GO', '/eos/key/go_0'], ['STOP', '/eos/key/stop']]),

  // TouchDesigner.
  osc('td-mixer', 'TD mixer opacity, 5 layers', 'TouchDesigner', ['sliderBank', 'knobBank'], range(5, (i) => [`Layer ${i}`, `/mixer/layer${i}/opacity`])),
  osc('td-fx', 'TD post FX dry / wet', 'TouchDesigner', ['sliderBank', 'knobBank'], TD_FX.map((n) => [n, `/${n}`])),
  osc('td-fx-on', 'TD post FX on / off', 'TouchDesigner', ['buttonGrid'], TD_FX.map((n) => [n, `/${n}/active`])),
  osc('td-cam', 'TD camera (tx, ty, tz, rx, ry, rz)', 'TouchDesigner', ['sliderBank', 'knobBank'], ['tx', 'ty', 'tz', 'rx', 'ry', 'rz'].map((p) => [p.toUpperCase(), `/cam/${p}`])),
];

// ── Your presets ──────────────────────────────────────────────────────────────
const KEY = 'lf-cell-presets';
export function userPresets(): CellPreset[] {
  try { return (JSON.parse(localStorage.getItem(KEY) ?? '[]') as CellPreset[]).filter((p) => p && Array.isArray(p.cells)); }
  catch { return []; }
}
export function saveUserPresets(list: CellPreset[]): void {
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* not vital */ }
}
export function presetsFor(kind: PresetKind): CellPreset[] {
  return [...BUILTIN_PRESETS, ...userPresets()].filter((p) => p.kinds.includes(kind));
}

// ── Apply / capture ───────────────────────────────────────────────────────────
function mappingOf(p: CellPreset, target: string): Mapping {
  const n = Math.round(Number(target) || 0);
  switch (p.protocol) {
    case 'artnet': return { type: 'artnet', universe: p.universe ?? 0, channel: Math.max(1, Math.min(512, n || 1)), minValue: 0, maxValue: 255 };
    case 'sacn': return { type: 'sacn', universe: p.universe ?? 1, channel: Math.max(1, Math.min(512, n || 1)), minValue: 0, maxValue: 255, priority: 100 };
    case 'midi': return { type: 'midi', messageType: 'controlChange', channel: p.midiChannel ?? 1, number: Math.max(0, Math.min(127, n)), minValue: 0, maxValue: 127 };
    default: return { type: 'osc', address: target.trim() || '/', ...(p.min !== undefined || p.max !== undefined ? { minValue: p.min ?? 0, maxValue: p.max ?? 1 } : {}) };
  }
}

/** The patch that turns a bank into the preset: count, protocol, names, addresses. */
export function applyPreset(w: SliderBankWidget | KnobBankWidget | ButtonGridWidget, p: CellPreset): Record<string, unknown> {
  const n = Math.max(1, p.cells.length);
  const countX = w.kind === 'buttonGrid' ? Math.min(n, 8) : n;
  const countY = Math.ceil(n / countX);
  const total = countX * countY;
  const base = w.kind === 'sliderBank' ? makeSliderCells(total, 0, 'S') : w.kind === 'knobBank' ? makeKnobCells(total, 0, 'K') : makeButtonCells(total, 0, 'B');
  const cells = base.map((c, i) => {
    const src = p.cells[i];
    if (!src) return { ...c, label: '' };
    return { ...c, label: src.label, mapping: mappingOf(p, src.target), ...(w.kind === 'buttonGrid' ? { behavior: 'momentary' } : {}) };
  });
  return { countX, countY, cells, outputProtocol: p.protocol, mapping: null };
}

/** A new preset from what the widget does now. */
export function presetFromWidget(w: Widget, name: string): CellPreset | null {
  if (w.kind !== 'sliderBank' && w.kind !== 'knobBank' && w.kind !== 'buttonGrid') return null;
  const cells = (w.cells as { label: string; mapping: Mapping | null }[]);
  const first = cells.find((c) => c.mapping)?.mapping;
  const protocol: PresetProtocol = first?.type === 'artnet' || first?.type === 'sacn' || first?.type === 'midi' ? first.type : 'osc';
  const target = (m: Mapping | null): string => {
    if (!m) return '';
    if (m.type === 'osc') return m.address;
    if (m.type === 'artnet' || m.type === 'sacn') return String(m.channel);
    if (m.type === 'midi') return String(m.number);
    return '';
  };
  const kinds: PresetKind[] = w.kind === 'buttonGrid' ? ['buttonGrid'] : ['sliderBank', 'knobBank'];
  return {
    id: `u-${Date.now().toString(36)}`, name, group: 'My presets', kinds, protocol,
    universe: first && (first.type === 'artnet' || first.type === 'sacn') ? first.universe : undefined,
    midiChannel: first?.type === 'midi' ? first.channel : undefined,
    min: first?.type === 'osc' ? first.minValue : undefined, max: first?.type === 'osc' ? first.maxValue : undefined,
    cells: cells.map((c) => ({ label: c.label, target: target(c.mapping) })),
  };
}
