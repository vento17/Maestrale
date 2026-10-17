import { eosAddress } from '../widgets/base/eosUser';
import { bridge } from './bridge';
import { oscOutValue, eosConfigOf, isEosConfigAddress } from '../../shared/types/mapping';
import type { Mapping } from '../../shared/types/mapping';

// ─── Eos fader bank config ─────────────────────────────────────────────────────
// Eos listens to an OSC fader bank only once told which page it shows and how
// many faders it holds. The config goes out before a level, and again after a
// pause (an Eos restarted meanwhile picks it up) — at most once every 3 s per
// message, unless forced (the "Send config" buttons).
const eosConfigured = new Map<string, number>();

export function sendEosConfig(msg: string, user?: number, outputId?: string, force = false): void {
  if (!msg) return;
  const key = `${outputId ?? ''}|${msg}`;
  const now = Date.now();
  if (!force && now - (eosConfigured.get(key) ?? 0) < 3000) return;
  eosConfigured.set(key, now);
  bridge.send('tr:osc:send', { address: eosAddress(msg, user), args: [], outputId });
}

// ─── Master gains ───────────────────────────────────────────────────────────────
// A MasterLevel widget scales EVERYTHING going out on one protocol by multiplying
// the normalized value before it is scaled to the protocol range. gain 1 = full.
const masterGains: Record<string, number> = {};

export function setMasterGain(protocol: string, gain: number): void {
  masterGains[protocol] = Math.max(0, Math.min(1, gain));
}
export function clearMasterGain(protocol: string): void {
  delete masterGains[protocol];
}
export function resetMasterGains(): void {
  for (const k of Object.keys(masterGains)) delete masterGains[k];
}

// All continuous values (sliders, knobs, XY) enter as normalized 0.0–1.0.
// Buttons use dispatchButton which applies onValue/offValue directly.

export function dispatchValue(mapping: Mapping, value: number): void {
  if (!mapping) return;
  const gain = masterGains[mapping.type] ?? 1;
  // MIDI and DMX are hard-bounded by their own protocols, so anything outside
  // 0–1 is meaningless there and gets clamped. OSC is just a float: a range
  // mapped to -1…1 (a bipolar joystick, a TouchDesigner offset) has to survive,
  // so it passes through unclamped.
  const v = (mapping.type === 'osc' ? value : Math.max(0, Math.min(1, value))) * gain;

  switch (mapping.type) {
    case 'midi': {
      const scaled = Math.round(v * (mapping.maxValue - mapping.minValue) + mapping.minValue);
      switch (mapping.messageType) {
        case 'controlChange':
          bridge.send('tr:midi:sendCC', { channel: mapping.channel, cc: mapping.number, value: scaled, outputId: mapping.outputId });
          break;
        case 'noteOn':
        case 'noteOff':
          bridge.send('tr:midi:sendNote', { channel: mapping.channel, note: mapping.number, velocity: scaled, on: mapping.messageType === 'noteOn', outputId: mapping.outputId });
          break;
        case 'pitchBend':
          bridge.send('tr:midi:sendPB', { channel: mapping.channel, value: Math.round(v * 16383), outputId: mapping.outputId });
          break;
        default:
          bridge.send('tr:midi:sendCC', { channel: mapping.channel, cc: mapping.number, value: scaled, outputId: mapping.outputId });
      }
      break;
    }
    case 'osc': {
      // A button whose address IS an Eos bank config: bare message, on press only.
      if (isEosConfigAddress(mapping.address)) {
        if (v >= 0.5) sendEosConfig(mapping.address, mapping.user, mapping.outputId, true);
        break;
      }
      // An Eos fader: the desk must know the bank before it listens to the level.
      const cfg = eosConfigOf(mapping);
      if (cfg) sendEosConfig(cfg, mapping.user, mapping.outputId);
      bridge.send('tr:osc:send', { address: eosAddress(mapping.address, mapping.user), args: [oscOutValue(mapping, v)], outputId: mapping.outputId });
      break;
    }
    case 'artnet': {
      const scaled = Math.round(v * (mapping.maxValue - mapping.minValue) + mapping.minValue);
      bridge.send('tr:artnet:sendChannel', { universe: mapping.universe, channel: mapping.channel, value: scaled, outputId: mapping.outputId });
      break;
    }
    case 'sacn': {
      const scaled = Math.round(v * (mapping.maxValue - mapping.minValue) + mapping.minValue);
      bridge.send('tr:sacn:sendChannel', { universe: mapping.universe, channel: mapping.channel, value: scaled, priority: mapping.priority, outputId: mapping.outputId });
      break;
    }
    case 'enttec': {
      const scaled = Math.round(v * (mapping.maxValue - mapping.minValue) + mapping.minValue);
      queueEnttec(mapping.channel, scaled);
      break;
    }
  }
}

// ─── Open DMX: fold a drag into one message ────────────────────────────────
// A fader drag fires one pointer event per mouse report — a 1000 Hz mouse gives
// a thousand a second — and sending an IPC message for each one swamped the main
// process, which is exactly where the DMX frame timer lives. Frames then went
// out late and uneven and fixtures flickered while, and only while, a fader
// moved. DMX only cares about the newest value of each channel, so a burst is
// folded by channel and sent at most every 15 ms — still twice the frame rate.
// The first change of a burst goes out at once, so a tap still feels instant.

const ENTTEC_COALESCE_MS = 15;
const pendingEnttec = new Map<number, number>();
let enttecTimer: ReturnType<typeof setTimeout> | null = null;

function flushEnttec(): void {
  if (pendingEnttec.size === 0) return;
  const channels = Array.from(pendingEnttec, ([channel, value]) => ({ channel, value }));
  pendingEnttec.clear();
  bridge.send('tr:enttec:sendChannels', { channels });
}

function queueEnttec(channel: number, value: number): void {
  pendingEnttec.set(channel, value);
  if (enttecTimer !== null) return;
  flushEnttec();
  enttecTimer = setTimeout(() => { enttecTimer = null; flushEnttec(); }, ENTTEC_COALESCE_MS);
}

// Buttons bypass normalization — onValue/offValue are already in protocol range.
export function dispatchButton(mapping: Mapping, on: boolean, onValue: number, offValue: number): void {
  if (!mapping) return;
  switch (mapping.type) {
    case 'midi': {
      const value = on ? onValue : offValue;
      if (mapping.messageType === 'noteOn' || mapping.messageType === 'noteOff') {
        bridge.send('tr:midi:sendNote', { channel: mapping.channel, note: mapping.number, velocity: on ? onValue : 0, on, outputId: mapping.outputId });
      } else {
        bridge.send('tr:midi:sendCC', { channel: mapping.channel, cc: mapping.number, value, outputId: mapping.outputId });
      }
      break;
    }
    default:
      dispatchValue(mapping, on ? 1.0 : 0.0);
  }
}
