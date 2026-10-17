// ─── Output Targets ──────────────────────────────────────────────────────────

export type MidiMessageType =
  | 'noteOn'
  | 'noteOff'
  | 'controlChange'
  | 'pitchBend'
  | 'programChange'
  | 'aftertouch';

// outputId selects which named output of the protocol receives this mapping.
// undefined/'primary' → the primary destination ("out 1"). Never fans out to all.
export interface MidiMapping {
  type: 'midi';
  messageType: MidiMessageType;
  channel: number;   // 1–16
  number: number;    // note or CC number 0–127 (ignored for pitchBend)
  minValue: number;  // 0–127 (or 0–16383 for pitchBend)
  maxValue: number;
  outputId?: string;
}

export interface OscMapping {
  type: 'osc';
  address: string;       // e.g. "/touchrig/fader/1"
  // Eos user: 1… makes this message come from its own user on the desk, so it
  // does not fight the operator's selection ("/eos/..." → "/eos/user/<n>/...").
  // 0 / missing = the same user as the console.
  user?: number;
  args?: OscArgType[];   // fixed args prepended before value
  minValue?: number;     // if set, rescale value: out = v*(max-min)+min
  maxValue?: number;
  // The OSC type the value goes out as: 'f' float (default) or 'i' integer
  // (rounded). With minValue/maxValue 0–10 or 0–100 this gives whole steps.
  argType?: 'f' | 'i';
  // ETC Eos fader. Eos only listens to an OSC fader bank after being told which
  // page it shows and how many faders it holds, so a mapping that drives an Eos
  // fader carries the desk fader number (1 … 100) and the bank it goes through:
  // the address and the config message are derived from them, and the config
  // (eosConfig, editable) goes out before the level, throttled.
  eosFader?: number;     // desk fader number, 1 … 100 (fader 11 = page 2, position 1)
  eosBank?: number;      // OSC bank index, default 1
  eosConfig?: string;    // '/eos/fader/<bank>/config/<page>/10' unless overridden
  outputId?: string;
}

/** Eos: fader number → page (10 per page) and position in that page. */
export function eosFaderPagePos(fader: number): { page: number; pos: number } {
  const f = Math.max(1, Math.round(fader));
  return { page: Math.ceil(f / 10), pos: ((f - 1) % 10) + 1 };
}

/** The level address and the bank config message for an Eos fader. */
export function eosFaderAddresses(fader: number, bank = 1): { address: string; config: string } {
  const { page, pos } = eosFaderPagePos(fader);
  const b = Math.max(1, Math.round(bank || 1));
  return { address: `/eos/fader/${b}/${pos}`, config: `/eos/fader/${b}/config/${page}/10` };
}

/** The config message an OSC mapping needs before Eos listens to it, or ''. */
export function eosConfigOf(m: OscMapping): string {
  if (m.eosConfig?.trim()) return m.eosConfig.trim();
  if (m.eosFader) return eosFaderAddresses(m.eosFader, m.eosBank).config;
  return '';
}

/** Is this address itself an Eos bank config message? (sent bare, on press) */
export function isEosConfigAddress(address: string): boolean {
  return /^\/eos\/(user\/\d+\/)?fader\/\d+\/config\//.test(address);
}

/** The scaled number (and OSC type) an OSC mapping puts on the wire for v. */
export function oscOutValue(m: OscMapping, v: number): { type: 'f' | 'i'; value: number } {
  const scaled = (m.minValue !== undefined && m.maxValue !== undefined)
    ? v * (m.maxValue - m.minValue) + m.minValue
    : v;
  return m.argType === 'i'
    ? { type: 'i', value: Math.round(scaled) }
    : { type: 'f', value: scaled };
}

export type OscArgType = 'float' | 'int' | 'string';

// ─── Art-Net ──────────────────────────────────────────────────────────────────
// Maps a control value to a single DMX channel in an Art-Net universe.
// value (0.0–1.0) is scaled to minValue–maxValue (0–255).

export interface ArtNetMapping {
  type: 'artnet';
  universe: number;   // 0–32767
  channel: number;    // 1–512
  minValue: number;   // 0–255
  maxValue: number;   // 0–255
  outputId?: string;
}

// ─── sACN / E1.31 ─────────────────────────────────────────────────────────────
// Same channel/value model as Art-Net, different transport + universe range.

export interface SacnMapping {
  type: 'sacn';
  universe: number;   // 1–63999
  channel: number;    // 1–512
  minValue: number;   // 0–255
  maxValue: number;   // 0–255
  priority: number;   // 1–200, default 100
  outputId?: string;
}

// ─── Enttec Open DMX USB ──────────────────────────────────────────────────────
// Single-universe USB DMX output via FTDI D2XX driver (no Art-Net networking needed).

export interface EnttecDmxMapping {
  type: 'enttec';
  channel: number;    // 1–512
  minValue: number;   // 0–255
  maxValue: number;   // 0–255
}

// ─── Union ────────────────────────────────────────────────────────────────────

export type Mapping =
  | MidiMapping
  | OscMapping
  | ArtNetMapping
  | SacnMapping
  | EnttecDmxMapping
  | null;

// ─── Feedback Rules ───────────────────────────────────────────────────────────
// Feedback is always OSC-based (Art-Net/sACN are output-only protocols).

export type FeedbackComparator = 'eq' | 'gt' | 'lt' | 'gte' | 'lte' | 'range';

export interface FeedbackCondition {
  comparator: FeedbackComparator;
  value: number;
  valueMax?: number; // used only for 'range'
}

export interface FeedbackRule {
  id: string;
  oscAddress: string;       // OSC address to listen on
  condition: FeedbackCondition;
  targetColor: string;      // CSS color applied when condition matches
  targetLabel?: string;     // optional label override
}
