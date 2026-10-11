import type { Mapping } from '../../../shared/types/mapping';
import type { XYPadWidget } from '../../../shared/types/project';

// Ready-made setups for the XY pad: what X, Y (and the optional Z slider) send.
// Applying one sets dot 1; ＋ Dot then continues from it (next channel / CC /
// address number). `n` = the channel / number typed next to the menu.

export interface XYPreset {
  id: string;
  name: string;
  group: string;
  usesN?: string;                 // label of the number field ("Channel", "Camera"…)
  make: (n: number) => { x: Mapping; y: Mapping; z?: Mapping };
  note?: string;
}

const osc = (address: string, minValue?: number, maxValue?: number): Mapping =>
  ({ type: 'osc', address, ...(minValue !== undefined ? { minValue, maxValue } : {}) });
const cc = (number: number): Mapping => ({ type: 'midi', messageType: 'controlChange', channel: 1, number: number % 128, minValue: 0, maxValue: 127 });
const dmx = (channel: number): Mapping => ({ type: 'artnet', universe: 0, channel: Math.max(1, Math.min(512, channel)), minValue: 0, maxValue: 255 });

export const XY_PRESETS: XYPreset[] = [
  // ETC Eos
  { id: 'eos-chan-pt', name: 'Eos channel pan / tilt', group: 'ETC Eos', usesN: 'Channel',
    make: (n) => ({ x: osc(`/eos/chan/${n}/param/pan`, -270, 270), y: osc(`/eos/chan/${n}/param/tilt`, -135, 135), z: osc(`/eos/chan/${n}/param/zoom`, 0, 100) }),
    note: 'Pan ±270°, tilt ±135° — set the range to your fixture. Z = zoom.' },
  { id: 'eos-sel-pt', name: 'Eos selected channels pan / tilt', group: 'ETC Eos',
    make: () => ({ x: osc('/eos/param/pan', -270, 270), y: osc('/eos/param/tilt', -135, 135), z: osc('/eos/param/zoom', 0, 100) }),
    note: 'Moves whatever is selected on the desk.' },
  { id: 'eos-group-pt', name: 'Eos group pan / tilt', group: 'ETC Eos', usesN: 'Group',
    make: (n) => ({ x: osc(`/eos/group/${n}/param/pan`, -270, 270), y: osc(`/eos/group/${n}/param/tilt`, -135, 135), z: osc(`/eos/group/${n}/param/zoom`, 0, 100) }) },
  { id: 'eos-chan-xy', name: 'Eos channel XY (focus position)', group: 'ETC Eos', usesN: 'Channel',
    make: (n) => ({ x: osc(`/eos/chan/${n}/param/x_focus`, -10, 10), y: osc(`/eos/chan/${n}/param/y_focus`, -10, 10), z: osc(`/eos/chan/${n}/param/z_focus`, 0, 10) }),
    note: 'Augment3d / XYZ focus, metres — needs the fixtures placed in Eos.' },

  // Plain OSC
  { id: 'osc-xy', name: 'OSC /xyN/x · y (0–1)', group: 'OSC', usesN: 'Pad',
    make: (n) => ({ x: osc(`/xy${n}/x`), y: osc(`/xy${n}/y`), z: osc(`/xy${n}/z`) }) },
  { id: 'osc-pt', name: 'OSC /xyN/pan · tilt (0–1)', group: 'OSC', usesN: 'Pad',
    make: (n) => ({ x: osc(`/xy${n}/pan`), y: osc(`/xy${n}/tilt`), z: osc(`/xy${n}/zoom`) }) },
  { id: 'osc-cam', name: 'Camera pan / tilt + Z', group: 'OSC', usesN: 'Camera',
    make: (n) => ({ x: osc(`/cam${n}/pan`, -1, 1), y: osc(`/cam${n}/tilt`, -1, 1), z: osc(`/cam${n}/z`, -1, 1) }) },
  { id: 'td-cam-t', name: 'TouchDesigner camera tx / ty + tz', group: 'TouchDesigner', usesN: 'Camera',
    make: (n) => ({ x: osc(`/cam${n}/tx`, -5, 5), y: osc(`/cam${n}/ty`, -5, 5), z: osc(`/cam${n}/tz`, -10, 10) }) },
  { id: 'td-cam-r', name: 'TouchDesigner camera ry / rx (orbit)', group: 'TouchDesigner', usesN: 'Camera',
    make: (n) => ({ x: osc(`/cam${n}/ry`, -180, 180), y: osc(`/cam${n}/rx`, -90, 90), z: osc(`/cam${n}/tz`, -10, 10) }) },
  { id: 'td-light', name: 'TouchDesigner light tx / ty + tz', group: 'TouchDesigner', usesN: 'Light',
    make: (n) => ({ x: osc(`/light${n}/tx`, -5, 5), y: osc(`/light${n}/ty`, -5, 5), z: osc(`/light${n}/tz`, -5, 5) }) },
  { id: 'td-pos', name: 'TouchDesigner object position (0–1)', group: 'TouchDesigner', usesN: 'Object',
    make: (n) => ({ x: osc(`/obj${n}/x`), y: osc(`/obj${n}/y`), z: osc(`/obj${n}/scale`) }) },

  // DMX / MIDI
  { id: 'dmx-mh', name: 'Moving head: pan ch N, tilt ch N+2', group: 'DMX (Art-Net)', usesN: 'Start channel',
    make: (n) => ({ x: dmx(n), y: dmx(n + 2), z: dmx(n + 4) }),
    note: 'Pan, pan fine, tilt, tilt fine… — Z on the 5th channel (often speed or zoom).' },
  { id: 'dmx-pt', name: 'Pan ch N, tilt ch N+1 (no fine)', group: 'DMX (Art-Net)', usesN: 'Start channel',
    make: (n) => ({ x: dmx(n), y: dmx(n + 1), z: dmx(n + 2) }) },
  { id: 'midi-cc', name: 'MIDI CC N, N+1 (+ N+2)', group: 'MIDI', usesN: 'First CC',
    make: (n) => ({ x: cc(n), y: cc(n + 1), z: cc(n + 2) }) },
];

/** The patch a preset makes on the pad (dot 1 and Z). */
export function applyXYPreset(w: XYPadWidget, p: XYPreset, n: number): Partial<XYPadWidget> {
  const m = p.make(n);
  return { mappingX: m.x, mappingY: m.y, mappingZ: m.z ?? w.mappingZ, outputProtocol: m.x?.type === 'midi' ? 'midi' : w.outputProtocol };
}

/** A sensible Z output next to X when the slider is first switched on. */
export function defaultZ(x: Mapping): Mapping {
  if (!x) return { type: 'osc', address: '/z' };
  if (x.type === 'osc') return { ...x, address: x.address.replace(/\/[^/]*$/, '') + '/z' };
  if (x.type === 'midi') return { ...x, number: (x.number + 2) % 128 };
  if (x.type === 'artnet' || x.type === 'sacn' || x.type === 'enttec') return { ...x, channel: Math.min(512, x.channel + 2) };
  return x;
}

/** The next dot's address / channel: Eos channel or group number, a trailing
 *  number, /xyN or /camN go up by `by`; DMX channels and CCs by `step`. */
export function stepMapping(m: Mapping, by: number, step: number): Mapping {
  if (!m) return m;
  if (m.type === 'midi') return { ...m, number: (m.number + step) % 128 };
  if (m.type === 'artnet' || m.type === 'sacn' || m.type === 'enttec') return { ...m, channel: ((m.channel - 1 + step) % 512) + 1 };
  if (m.type === 'osc') {
    const a = m.address;
    const eos = /^(\/eos\/(?:chan|group)\/)(\d+)(\/.*)$/.exec(a);
    if (eos) return { ...m, address: `${eos[1]}${Number(eos[2]) + by}${eos[3]}` };
    const named = /^(\/[a-z]+)(\d+)(\/.*)$/i.exec(a);
    if (named && named[1] !== '/xy') return { ...m, address: `${named[1]}${Number(named[2]) + by}${named[3]}` };
    return { ...m, address: `${a.replace(/\/\d+$/, '')}/${by + 1}` };
  }
  return m;
}
