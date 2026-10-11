import { eosAddress } from '../base/eosUser';
import { bridge } from '../../ipc/bridge';
import type { EncoderWidget, EncoderDef, EncoderMidiMode } from '../../../shared/types/project';

// What an encoder actually sends: a CHANGE, in whatever form the desk wants it.

// Fill an OSC text template: {d} = +3 / -3, {abs} = 3, {dir} = + / -.
export function fillText(tpl: string, d: number): string {
  const abs = Number(Math.abs(d).toFixed(4));
  const dir = d < 0 ? '-' : '+';
  return tpl.replace(/\{d\}/g, `${dir}${abs}`).replace(/\{abs\}/g, String(abs)).replace(/\{dir\}/g, dir);
}

// A relative MIDI value for `ticks` (−63…63) in the three usual encodings.
export function midiRelative(ticks: number, mode: EncoderMidiMode): number {
  const t = Math.max(-63, Math.min(63, Math.round(ticks)));
  if (mode === 'twos') return t >= 0 ? t : 128 + t;      // +1 = 1, −1 = 127
  if (mode === 'signBit') return t >= 0 ? t : 64 + -t;   // +1 = 1, −1 = 65
  return 64 + t;                                         // +1 = 65, −1 = 63
}

/** Send `ticks` (signed, may be fractional before rounding) for one encoder. */
export function sendEncoder(w: EncoderWidget, e: EncoderDef, ticks: number): void {
  if (!ticks) return;
  const t = w.invert ? -ticks : ticks;
  const outputId = w.outputId || undefined;
  switch (w.format) {
    case 'oscDelta': {
      const v = t * (w.step || 1);
      const int = (w.argType ?? 'f') === 'i';
      bridge.send('tr:osc:send', { address: eosAddress(e.address, w.user), args: [{ type: int ? 'i' : 'f', value: int ? Math.round(v) : v }], outputId });
      break;
    }
    case 'oscText':
      bridge.send('tr:osc:send', { address: eosAddress(e.address, w.user), args: [{ type: 's', value: fillText(e.text ?? '{d}', t * (w.step || 1)) }], outputId });
      break;
    case 'oscIncDec': {
      // One message per tick on the up or the down address.
      const addr = t > 0 ? e.address : (e.addressDec || e.address);
      const n = Math.min(64, Math.round(Math.abs(t)));
      for (let i = 0; i < n; i++) bridge.send('tr:osc:send', { address: eosAddress(addr, w.user), args: [{ type: 'i', value: 1 }], outputId });
      break;
    }
    case 'midi': {
      // Big moves are split: a relative CC carries at most ±63.
      let left = Math.round(t);
      while (left !== 0) {
        const part = Math.max(-63, Math.min(63, left));
        bridge.send('tr:midi:sendCC', { channel: e.midiChannel ?? 1, cc: e.midiCc ?? 0, value: midiRelative(part, w.midiMode ?? 'offset64'), outputId });
        left -= part;
      }
      break;
    }
  }
}

// Ready-made setups for common desks. To be checked against the desk's own
// manual — names of parameters and OSC prefixes change between versions.
export interface EncoderPreset {
  id: string; label: string; hint: string;
  apply: (w: EncoderWidget) => Partial<EncoderWidget>;
}

const PARAMS = ['Intensity', 'Pan', 'Tilt', 'Zoom', 'Focus', 'Iris', 'Gobo', 'Color'];

function relabel(w: EncoderWidget, f: (name: string, i: number, e: EncoderDef) => Partial<EncoderDef>): EncoderDef[] {
  return w.encoders.map((e, i) => {
    const name = PARAMS[i] ?? `Enc ${i + 1}`;
    return { ...e, label: name, ...f(name, i, e) };
  });
}

export const ENCODER_PRESETS: EncoderPreset[] = [
  {
    id: 'eos', label: 'ETC Eos', hint: 'OSC /eos/wheel/fine/<parameter> with the number of ticks — fine, because the coarse wheel runs away. Eos needs OSC RX on (Setup → System → Show Control → OSC).',
    apply: (w) => ({ format: 'oscDelta', argType: 'f', step: 1, encoders: relabel(w, (n) => ({ address: `/eos/wheel/fine/${n.toLowerCase()}` })) }),
  },
  {
    id: 'ma3', label: 'grandMA3', hint: 'OSC command line: the text is run as a command, e.g. Attribute "Dimmer" At + 5. Set the OSC prefix in the desk (In & Out → OSC).',
    apply: (w) => {
      const ma = ['Dimmer', 'Pan', 'Tilt', 'Zoom', 'Focus', 'Iris', 'Gobo1', 'ColorRGB_R'];
      return { format: 'oscText', step: 1, encoders: w.encoders.map((e, i) => ({ ...e, label: PARAMS[i] ?? `Enc ${i + 1}`, address: '/gma3/cmd', text: `Attribute "${ma[i] ?? 'Dimmer'}" At {dir} {abs}` })) };
    },
  },
  {
    id: 'midi', label: 'MIDI relative', hint: 'CC per encoder, 64 = still, 65 = +1, 63 = −1 (change the encoding if the desk wants another).',
    apply: (w) => ({ format: 'midi', midiMode: 'offset64', encoders: w.encoders.map((e, i) => ({ ...e, midiChannel: e.midiChannel ?? 1, midiCc: 20 + i })) }),
  },
];
