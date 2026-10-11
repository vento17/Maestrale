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
  outputId?: string;
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
