import type { Mapping, FeedbackRule } from './mapping';

// ─── Geometry ─────────────────────────────────────────────────────────────────

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

// ─── Widget Style ─────────────────────────────────────────────────────────────

export type ValueDisplayMode = 'percent' | 'raw' | 'protocol';

export interface WidgetStyle {
  backgroundColor: string;
  foregroundColor: string;  // default cell color (overridable per-cell)
  labelColor: string;
  borderRadius: number;
  fontSize: number;
  showLabel: boolean;
  showValue?: boolean;              // show live numeric value on each cell
  valueFormat?: ValueDisplayMode;   // percent (0-100%) | raw (0-1) | protocol (scaled per mapping)
  frame?: 'none' | 'outline' | 'underline';
  frameColor?: string;
  frameSize?: number;
}

// ─── Widget Types ─────────────────────────────────────────────────────────────

export type WidgetKind = 'sliderBank' | 'buttonGrid' | 'knobBank' | 'xyPad' | 'imageWidget' | 'textWidget' | 'stepSequencer' | 'graphWidget' | 'cues' | 'timeline' | 'spoutInput' | 'ndiInput' | 'submasters' | 'router' | 'autoBpm' | 'audioAnalyser' | 'soundPlayer' | 'lfoWidget' | 'mathWidget' | 'valueDisplay' | 'masterLevel' | 'instance' | 'keyboard' | 'manual' | 'dmxRecorder' | 'dmxPlayer' | 'audioLevel' | 'noiseWidget' | 'sketch' | 'clock' | 'dmxMonitor' | 'encoder' | 'etc' | 'shell' | 'palette' | 'merge';

// ─── Widget Base ──────────────────────────────────────────────────────────────

export type OutputProtocol = 'midi' | 'osc' | 'enttec' | 'artnet' | 'sacn';

export interface WidgetBase {
  id: string;
  kind: WidgetKind;
  label: string;
  rect: Rect;
  style: WidgetStyle;
  zIndex: number;
  outputProtocol: OutputProtocol;
  mapping: Mapping;
  feedbackRules: FeedbackRule[];
}

// ─── Slider Bank ──────────────────────────────────────────────────────────────

export interface SliderCellConfig {
  label: string;
  color?: string;       // overrides style.foregroundColor if set
  mapping: Mapping;
  feedbackRules: FeedbackRule[];
}

export interface SliderBankWidget extends WidgetBase {
  kind: 'sliderBank';
  countX: number;
  countY: number;
  orientation: 'vertical' | 'horizontal';
  spacingX: number;
  spacingY: number;
  cells: SliderCellConfig[];  // length = countX * countY
}

// ─── Button Grid ──────────────────────────────────────────────────────────────

export type ButtonBehavior = 'momentary' | 'toggle' | 'pulse' | 'radio';

export interface ButtonCellConfig {
  label: string;
  color?: string;
  behavior: ButtonBehavior;
  mapping: Mapping;
  feedbackRules: FeedbackRule[];
  onValue: number;
  offValue: number;
}

export interface ButtonGridWidget extends WidgetBase {
  kind: 'buttonGrid';
  countX: number;
  countY: number;
  spacingX: number;
  spacingY: number;
  cells: ButtonCellConfig[];
}

// ─── Knob Bank ────────────────────────────────────────────────────────────────

export interface KnobCellConfig {
  label: string;
  color?: string;
  mapping: Mapping;
  feedbackRules: FeedbackRule[];
  minAngle: number;
  maxAngle: number;
}

export interface KnobBankWidget extends WidgetBase {
  kind: 'knobBank';
  countX: number;
  countY: number;
  spacingX: number;
  spacingY: number;
  knobSize?: number;
  cells: KnobCellConfig[];
}

// ─── XY Pad ───────────────────────────────────────────────────────────────────

export interface XYPadWidget extends WidgetBase {
  kind: 'xyPad';
  mappingX: Mapping;
  mappingY: Mapping;
  feedbackRulesX: FeedbackRule[];
  feedbackRulesY: FeedbackRule[];
  showCrosshair: boolean;
  invertX: boolean;
  invertY: boolean;
  // More dots on the same pad (＋): dot k+2 is cells 2(k+1) (X) and 2(k+1)+1 (Y).
  // Dot 1 uses mappingX / mappingY above.
  points?: XYPoint[];
  // A vertical slider at the right edge (a camera's Z, a zoom…): one more cell,
  // the last one (after every dot's X / Y). Starts at the middle.
  zSlider?: boolean;
  mappingZ?: Mapping;
}

export interface XYPoint {
  id: string;
  label?: string;
  color?: string;
  mappingX: Mapping;
  mappingY: Mapping;
}

// Mapping of an XY pad cell: even = X, odd = Y of dot ⌊cell/2⌋.
export function xyMapping(w: XYPadWidget, cell: number): Mapping {
  if (w.zSlider && cell === 2 * (1 + (w.points?.length ?? 0))) return w.mappingZ ?? null;
  const dot = Math.floor(cell / 2);
  const p = dot === 0 ? { mappingX: w.mappingX, mappingY: w.mappingY } : w.points?.[dot - 1];
  if (!p) return null;
  return cell % 2 === 0 ? p.mappingX : p.mappingY;
}

// ─── Image Widget ─────────────────────────────────────────────────────────────

export type BlendMode =
  | 'normal' | 'screen' | 'multiply' | 'overlay' | 'difference'
  | 'exclusion' | 'hard-light' | 'soft-light' | 'color-dodge'
  | 'color-burn' | 'luminosity' | 'hue' | 'saturation' | 'color';

export interface ImageWidget extends WidgetBase {
  kind: 'imageWidget';
  src: string;
  layer: 'under' | 'over';
  blendMode: BlendMode;
  opacity: number;
}

// ─── Step Sequencer ───────────────────────────────────────────────────────────

export interface StepConfig {
  active: boolean;
  value: number; // normalized 0.0 – 1.0
}

export type SpeedMultiplier = 0.125 | 0.25 | 0.5 | 1 | 2 | 4 | 8;

export interface StepSequencerWidget extends WidgetBase {
  kind: 'stepSequencer';
  stepCount: number;          // 4 | 8 | 16 | 32
  speedMultiplier: SpeedMultiplier;
  steps: StepConfig[];        // length = stepCount
  smooth?: number;            // 0 = instant step jumps, 1 = max slew on the output
}

// ─── Graph Widget ─────────────────────────────────────────────────────────────

export type GraphPointMode = 'linear' | 'bezier' | 'square';

export interface GraphPoint {
  x: number;            // 0–1 horizontal position (time)
  y: number;            // 0–1 vertical value (1 = max)
  mode: GraphPointMode; // interpolation from this point to the next
  cpLeft?:  [number, number]; // bezier incoming handle [x, y] in 0–1 space
  cpRight?: [number, number]; // bezier outgoing handle [x, y] in 0–1 space
}

export type GraphTimingMode = 'bpm' | 'manual';
export type GraphPlayMode = 'loop' | 'once';

export interface GraphWidget extends WidgetBase {
  kind: 'graphWidget';
  points: GraphPoint[];
  speedMultiplier: SpeedMultiplier;
  timingMode?: GraphTimingMode;
  manualDuration?: number;        // seconds, used when timingMode='manual'
  playMode?: GraphPlayMode;
  playMapping?: Mapping | null;
  stopMapping?: Mapping | null;
  reverseMapping?: Mapping | null;
  // Extra outputs (＋): the same curve read further along by `phase` (0–1 of a
  // cycle). Cell 0 is the main output, lane k is cell k + 1.
  lanes?: { id: string; phase: number }[];
}

// ─── Timeline ─────────────────────────────────────────────────────────────────

export type TimelineEasing = 'linear' | 'step' | 'bezier';

export interface ValueKeyframe {
  id: string;
  time: number;           // 0–1 normalised position on the timeline
  value: number;          // 0–1 normalised output value
  easing: TimelineEasing;
  cpOut?: [number, number]; // bezier handle out: [dt, dv] relative to this keyframe (normalised)
  cpIn?:  [number, number]; // bezier handle in:  [dt, dv] relative to this keyframe (normalised)
}

export interface ColorKeyframe {
  id: string;
  time: number;    // 0–1
  color: string;   // '#rrggbb'
  easing?: 'linear' | 'step';
}

export interface ValueTrack {
  id: string;
  kind: 'value';
  label: string;
  color: string;
  keyframes: ValueKeyframe[];
  mapping: Mapping;
  muted?: boolean;
}

export interface ColorTrack {
  id: string;
  kind: 'color';
  label: string;
  keyframes: ColorKeyframe[];
  oscAddress: string;
  // How the colour goes out on OSC: one message "r g b" (default) or "r g b w",
  // or one message per channel on <address>/r, /g, /b (and /w).
  oscFormat?: ColorOscFormat;
  muted?: boolean;
}

export type ColorOscFormat = 'rgb' | 'rgbw' | 'rgb-split' | 'rgbw-split';

export interface SoundRegion {
  id: string;
  offset: number;       // timeline start position in seconds
  trimStart?: number;
  trimEnd?: number;
}

export interface SoundTrack {
  id: string;
  kind: 'sound';
  label: string;
  src: string;
  fileName: string;
  volume: number;           // 0–1
  offset: number;
  trimStart?: number;
  trimEnd?: number;
  regions?: SoundRegion[];
  audioDuration?: number;
  muted?: boolean;
  mapping?: Mapping;        // optional MIDI/OSC trigger on playback start
  audioOutputDeviceId?: string;
}

export interface TrigMarker {
  id: string;
  time: number;           // 0–1 normalised position
  name?: string;          // optional label shown on the track
  labelY?: number;        // vertical offset (0–1, 0=top) for the name chip
  num?: number;           // stable creation number within its track (1,2,3…) — shown when unnamed
}

export interface TrigTrack {
  id: string;
  kind: 'trig';
  label: string;
  color: string;
  keyframes: TrigMarker[];
  mapping: Mapping;
  muted?: boolean;
}

// ─── Cue track ────────────────────────────────────────────────────────────────
// A track cut into contiguous blocks. Unlike a trig, a cue is a STATE, not an
// edge: while the playhead sits anywhere inside block N, block N is held at 1 —
// so scrubbing into the middle of a block fires it just as playing into it does.
// No snapshot is stored; the block only says "we are in cue N".

export interface CueRegion {
  id: string;
  time: number;      // 0–1 start of the block; the first block is pinned at 0
  name: string;
  color: string;
  mapping: Mapping;  // held on while the playhead is inside this block
}

export interface CueTrack {
  id: string;
  kind: 'cue';
  label: string;
  cues: CueRegion[];   // sorted by time, always at least one, cues[0].time === 0
  muted?: boolean;
}

// ─── Wait track ───────────────────────────────────────────────────────────────
// Points that stop playback until you continue, so a timeline can be run as a
// series of steps — animate, hold for the cue, carry on.

export interface WaitPoint {
  id: string;
  time: number;    // 0–1
  name?: string;
  // Bypassed points let the transport run straight through, but stay on the
  // track (greyed) and remain targets for the Ctrl+←/→ jump.
  bypass?: boolean;
}

export interface WaitTrack {
  id: string;
  kind: 'wait';
  label: string;
  color: string;
  points: WaitPoint[];
  muted?: boolean;
}

export type TimelineTrack = ValueTrack | ColorTrack | SoundTrack | TrigTrack | CueTrack | WaitTrack;

// Ruler markers — grey droplets in the ruler strip. They draw a vertical line
// across every track and act as snap targets for keyframes/triggers.
export interface TimelineMarker {
  id: string;
  time: number;    // 0–1 normalised position
  name?: string;
}

export interface TimelineWidget extends WidgetBase {
  kind: 'timeline';
  duration: number;       // seconds
  loopMode: 'none' | 'loop';
  markers?: TimelineMarker[];
  tracks: TimelineTrack[];
  playMapping: Mapping | null;
  stopMapping: Mapping | null;
  timecodeSource?: 'off' | 'ltc' | 'mtc';
  timecodeFrameRate?: 24 | 25 | 29.97 | 30;
  rulerUnit?: 'sec' | 'frames';   // how the ruler reads out; frames use timecodeFrameRate
}

// ─── Cues ─────────────────────────────────────────────────────────────────────

export interface CueData {
  id: string;
  name: string;
  bgColor: string;      // launch button background color
  fadeTime: number;     // seconds, 0 = instant
  snapshot: Record<string, number[]>; // widgetId → array of cell values (0-1)
  // widgetId → transport state for widgets that own one (LFO, Graph, Step
  // Sequencer). Absent on cues saved before this existed, in which case their
  // transports are left alone.
  play?: Record<string, boolean>;
  links?: Record<string, RouterRow[]>; // routerWidgetId → its rows at save time (link/routing state); absent on pre-feature cues
  // widgetId → what a generator IS at save time: a Sketch's drawing and dots,
  // an LFO's shape and rate, a sequencer's steps, a graph's curve. Snaps on recall.
  content?: Record<string, Record<string, unknown>>;
}

export interface CuesWidget extends WidgetBase {
  kind: 'cues';
  cues: CueData[];
  // What a recorded cue covers. Both default to 'all', so a cue captures every
  // widget on every page unless you deliberately narrow it.
  scopePageId?: string;    // page id, or 'all'
  scopeWidgetId?: string;  // widget id, or 'all'
  excludeIds?: string[];   // left out of what the scope covers
  navFirst:  Mapping;
  navPrev:   Mapping;
  navNext:   Mapping;
  navRandom: Mapping;
  navLast:   Mapping;
}

// ─── Spout Input ──────────────────────────────────────────────────────────────

export interface SpoutInputWidget extends WidgetBase {
  kind: 'spoutInput';
  senderName: string;
  borderWidth?: number;   // px, 0 = no border
  borderColor?: string;   // CSS color
  targetFps?: number;     // 0 = no limit
}

// ─── Submasters ───────────────────────────────────────────────────────────────

export type SubmasterMergeMode = 'ltp' | 'htp';

export interface SubmasterScene {
  label: string;
  color?: string;      // top button color when scene has data
  snapshot: Record<string, number[]>; // widgetId → cell value array (0-1)
  // The flash button below the fader is a cell in its own right, so it can be
  // linked, learned and sent outward like any other button.
  flashMapping?: Mapping | null;
}

export interface SubmastersWidget extends WidgetBase {
  kind: 'submasters';
  countX: number;              // number of scene columns
  spacingX: number;
  spacingY: number;
  mergeMode: SubmasterMergeMode;
  linkedWidgetIds: string[];   // widgets this submaster controls
  excludeWidgetIds?: string[]; // left out, even when "all widgets" is linked
  scenes: SubmasterScene[];    // length = countX
}

// ─── NDI Input ────────────────────────────────────────────────────────────────

export interface NdiInputWidget extends WidgetBase {
  kind: 'ndiInput';
  sourceName: string;
  borderWidth?: number;
  borderColor?: string;
  targetFps?: number;
}

// ─── Text Widget ──────────────────────────────────────────────────────────────

export type TextFrame = 'none' | 'outline' | 'underline';
export type TextAlign = 'left' | 'center' | 'right';
export type FontWeight = 'normal' | 'bold';
export type FontStyle = 'normal' | 'italic';

export interface TextWidget extends WidgetBase {
  kind: 'textWidget';
  text: string;
  fontFamily: string;
  fontWeight: FontWeight;
  fontStyle: FontStyle;
  textColor: string;
  textAlign: TextAlign;
  layer: 'under' | 'over';
  frame: TextFrame;
  frameColor: string;
  frameSize: number;
}

// ─── Router ───────────────────────────────────────────────────────────────────
// Routes a signal (widget cell, MIDI input, or OSC input) to one or more outputs.

export type RouterInputType = 'widget' | 'midiCC' | 'midiNote' | 'osc' | 'artnet' | 'sacn';

export interface RouterOutput {
  id: string;
  mapping: Mapping;
  targetWidgetId?: string;   // if set, routes to a widget cell instead of a protocol
  targetCellIndex?: number;
  // "ALL": drive every cell of the target widget from this one output, instead
  // of adding one output per cell. targetCellIndex is ignored when set.
  targetAllCells?: boolean;
  // Switched off from the Router page: kept, but routes nothing.
  muted?: boolean;
  // Per-output range mapping: read the incoming value inside [inMin, inMax] and
  // send it as [outMin, outMax]. Lets one source drive several outputs over
  // different travels — or over opposite ones, by reversing the output pair.
  inMin?: number;
  inMax?: number;
  outMin?: number;
  outMax?: number;
  // Motion filters on the way out (Router page, right of the line):
  // SMOOTH glides to each new value (0–1 → ~0.02…1.5 s); SPRING follows with a
  // bounce (0 = no overshoot … 1 = very springy). Both on = smooth, then spring.
  smoothOn?: boolean;
  smooth?: number;
  // Which way the smoothing acts: 'in' = only rising (attack), 'out' = only
  // falling (release), 'both' (default).
  smoothDir?: 'in' | 'both' | 'out';
  springOn?: boolean;
  spring?: number;
}

export interface RouterRow {
  id: string;
  inputType?: RouterInputType;  // defaults to 'widget' when absent
  // widget source:
  widgetId: string;    // source widget id ('' = unassigned)
  cellIndex: number;   // 0-based cell index within the source widget
  // "ALL": listen to every cell of the source widget. Paired with an ALL output
  // this mirrors a whole bank onto another one, cell i → cell i.
  allCells?: boolean;
  // MIDI source (midiCC / midiNote):
  midiChannel?: number;   // 1-16; 0 = any channel
  midiNumber?: number;    // 0-127 (CC number or note number)
  // OSC source:
  oscAddress?: string;    // exact address to listen on, e.g. "/fader1"
  // Art-Net source: one DMX channel, 0–255 read as 0–1.
  artnetUniverse?: number;  // 15-bit port-address, as on the output side
  artnetChannel?: number;   // 1–512
  outputs: RouterOutput[];
  createdAt?: number;       // ms epoch — the Router page sorts by it
}

export interface RouterWidget extends WidgetBase {
  kind: 'router';
  rows: RouterRow[];
}

// ─── AutoBpm Widget ───────────────────────────────────────────────────────────
// Beat clock that emits triggers and ramps synced to masterBpm.
// cells[0..7]  = trigger pulses for each divisor (0→1→0 on boundary)
// cells[8..15] = ramp values 0→1 per N beats (read from runtime, written by live component)

export const BEAT_DIVISORS = [1, 2, 3, 4, 8, 16, 32, 64] as const;
export type BeatDivisor = typeof BEAT_DIVISORS[number];

export interface BeatOutput {
  divisor: BeatDivisor;
  name?: string;             // optional display label shown in live UI ramps
  triggerMapping: Mapping;   // brief 0→1→0 pulse at each N-beat boundary
  rampMapping: Mapping;      // continuous 0→1 sawtooth over N beats
}

export interface AutoBpmWidget extends WidgetBase {
  kind: 'autoBpm';
  beatOutputs: BeatOutput[];  // 8 entries, one per BEAT_DIVISORS entry
}

// ─── Audio Analyser ───────────────────────────────────────────────────────────
// cells[0]=kick, cells[1]=snare, cells[2]=bass, cells[3]=mid, cells[4]=high
// cells[5-12]=BPM trig ×{divisor}, cells[13-20]=BPM ramp ×{divisor}

export interface AudioAnalyserWidget extends WidgetBase {
  kind: 'audioAnalyser';
  audioDeviceId: string | null;   // null = default microphone
  beatOutputs: BeatOutput[];      // 8 entries (same divisors as AutoBpm)
  kickThreshold: number;          // 0-1
  kickFreq: number;               // center Hz
  kickBand: number;               // bandwidth Hz
  snareThreshold: number;         // 0-1
  snareFreq: number;              // center Hz
  snareBand: number;              // bandwidth Hz
  bassFreq: number;               // lowpass cutoff Hz
  bassBand: number;               // rolloff width Hz
  midFreq: number;                // bandpass center Hz
  midBand: number;                // bandpass bandwidth Hz
  highFreq: number;               // highpass cutoff Hz
  highBand: number;               // rolloff width Hz
  kickMapping: Mapping;
  snareMapping: Mapping;
  bassMapping: Mapping;
  midMapping: Mapping;
  highMapping: Mapping;
}

// ─── Sound Player ─────────────────────────────────────────────────────────────
// Vertical playlist with per-track play/pause/stop and volume.
// cells[i] = 1 while track i is playing, 0 otherwise.
// Router can set cells[i] = 1 to trigger play of track i.

export interface SoundPlayerTrack {
  id: string;
  label: string;
  src: string;         // base64 data URL
  fileName: string;    // display name
  volume: number;      // 0-1 per-track volume
  playMapping: Mapping;
  end?: PlayEnd;       // what happens when it finishes (default stop)
  fade?: number;       // seconds: fades in over the track that was playing
}

// Playlist players (Sound, DMX): what an item does when it reaches its end.
export type PlayEnd = 'stop' | 'loop' | 'next';

export interface SoundPlayerWidget extends WidgetBase {
  kind: 'soundPlayer';
  tracks: SoundPlayerTrack[];
  masterVolume: number;  // 0-1
}

// ─── LFO Widget ───────────────────────────────────────────────────────────────
// cells[0] = current LFO output value (0–1)

export type LfoWaveform = 'sine' | 'square' | 'saw' | 'triangle' | 'random' | 'noise';
export type LfoRateMode = 'bpm' | 'hz';

export interface LfoWidget extends WidgetBase {
  kind: 'lfoWidget' | 'noiseWidget';   // noiseWidget: the same widget playing smooth noise
  waveform: LfoWaveform;
  rateMode: LfoRateMode;
  rateMultiplier: number;  // when rateMode='bpm': beats per cycle (1=quarter, 2=half…)
  rateHz: number;          // when rateMode='hz'
  amplitude: number;       // 0–1 (output swing, centred on `center`)
  center?: number;         // 0–1 value the wave swings around (default 0.5)
  offset: number;          // 0–1 of a cycle: shifts EVERY output forward together
  phase: number;           // 0–1: spread across the outputs — output k of n is
                           // shifted by phase × k/(n−1); 0 = all together
  playMapping?: Mapping | null;  // MIDI/OSC trigger to start
  stopMapping?: Mapping | null;  // MIDI/OSC trigger to stop (freeze)
  // Extra outputs (＋): same waveform, rate, amplitude and offset, each shifted
  // by its own phase. Cell 0 is the main output, lane k is cell k + 1.
  lanes?: { id: string; phase: number }[];
  // Speed step (×0.25 … ×4) on top of the rate. The SPEED input overrides it live.
  speed?: number;
  // Shape for triangle (peak position) and square (width of the high part),
  // −1…1, 0 = none — like TouchDesigner's LFO bias.
  bias?: number;
  // Noise: which random pattern. Same seed = same curve, every time (1–9999).
  // 0 / missing = derived from the widget, so two noises never match.
  seed?: number;
  // 0 = smooth. Higher = the wave is sampled in fewer steps per cycle and held
  // still between them (64 steps … 2). 1 = one trigger per cycle.
  quantize?: number;
}

// ─── Math / Merge Widget ──────────────────────────────────────────────────────
// Combines up to two cell sources with a math operation.
// cells[0] = computed result

export type MathOperation = 'add' | 'subtract' | 'multiply' | 'min' | 'max' | 'avg' | 'invert' | 'abs';

export interface MathWidget extends WidgetBase {
  kind: 'mathWidget';
  sourceAWidgetId: string;
  sourceACellIndex: number;
  sourceBWidgetId: string;
  sourceBCellIndex: number;
  operation: MathOperation;
  // The operation result is read as a position inside [inMin, inMax], then
  // re-mapped onto [outMin, outMax]. Leaving both at 0–1 passes it straight
  // through. Reversing the output pair (outMin > outMax) inverts.
  inMin: number;
  inMax: number;
  outMin: number;
  outMax: number;
  clampOutput: boolean;  // clamp the final result to 0–1
}

// ─── Value Display Widget ─────────────────────────────────────────────────────
// Read-only display of a cell value from another widget. No runtime cells.

export type ValueDisplayFormat = 'percent' | 'raw' | 'midi';

export interface ValueDisplayWidget extends WidgetBase {
  kind: 'valueDisplay';
  sourceWidgetId: string;
  sourceCellIndex: number;
  displayFormat: ValueDisplayFormat;
  decimals: number;    // decimal places to show (0–3)
}

// ─── Master Level Widget ──────────────────────────────────────────────────────
// A fader that multiplies EVERYTHING going out on one protocol (its own value is
// the master gain, 0–1). cells[0] = master level (so it can itself be automated).

export interface MasterLevelWidget extends WidgetBase {
  kind: 'masterLevel';
  protocol: OutputProtocol;                    // which protocol this master scales
  orientation?: 'vertical' | 'horizontal';
}

// ─── Instance Widget ──────────────────────────────────────────────────────────
// A bound copy of another widget: renders the source widget's live UI wired to
// the SOURCE's runtime, so both share the exact same value. Put the source on
// one page and instances on others (e.g. a master + its instances).

export interface InstanceWidget extends WidgetBase {
  kind: 'instance';
  sourceWidgetId: string;   // widget being mirrored ('' = unassigned)
}

// ─── Keyboard Widget ──────────────────────────────────────────────────────────
// Physical computer-keyboard keys turned into buttons. Each bound key is one
// cell, so it can be mapped, linked and slaved exactly like a Button Grid cell.
// cells[i] = 1 while key i is down (behaviour permitting), 0 otherwise.

export interface KeyBinding {
  id: string;
  code: string;          // KeyboardEvent.code, e.g. 'KeyA', 'Space', 'F1'
  label: string;         // shown on the key cap; defaults to a readable code
  color?: string;        // overrides style.foregroundColor
  behavior: ButtonBehavior;
  onValue: number;
  offValue: number;
  mapping: Mapping;
  feedbackRules: FeedbackRule[];
}

export interface KeyboardWidget extends WidgetBase {
  kind: 'keyboard';
  keys: KeyBinding[];
  countX: number;        // keys per row in the on-screen layout
  spacingX: number;
  spacingY: number;
}

// ─── Manual Widget ────────────────────────────────────────────────────────────
// In-app documentation. Two rows of tabs: settings topics (+ shortcuts) on top,
// one tab per widget kind below. Read-only, no runtime cells, no output.

export interface ManualWidget extends WidgetBase {
  kind: 'manual';
  openTab?: string;    // id of the tab shown on load
  fontScale?: number;  // 0.6–2, multiplies the body text size
}

// ─── Union ────────────────────────────────────────────────────────────────────

export type Widget =
  | SliderBankWidget
  | ButtonGridWidget
  | KnobBankWidget
  | XYPadWidget
  | ImageWidget
  | TextWidget
  | StepSequencerWidget
  | GraphWidget
  | CuesWidget
  | TimelineWidget
  | SpoutInputWidget
  | NdiInputWidget
  | SubmastersWidget
  | RouterWidget
  | AutoBpmWidget
  | AudioAnalyserWidget
  | SoundPlayerWidget
  | LfoWidget
  | MathWidget
  | ValueDisplayWidget
  | MasterLevelWidget
  | InstanceWidget
  | KeyboardWidget
  | ManualWidget
  | DmxRecorderWidget
  | DmxPlayerWidget
  | ClockWidget
  | DmxMonitorWidget
  | AudioLevelWidget
  | EncoderWidget
  | EtcWidget
  | SketchWidget
  | ShellWidget
  | PaletteWidget
  | MergeWidget;

// ─── Shell ────────────────────────────────────────────────────────────────────
// Buttons that run an action on the PC (turn off, restart, open a file…). Each
// button is an input cell: a rising edge (a clock row, a cue, MIDI) fires it,
// like pressing it.
export interface ShellButton {
  id: string;
  label: string;
  action: string;      // SHELL_ACTIONS id
  arg?: string;        // path / address / command line
  delay?: number;      // power actions: seconds of countdown (default 10)
}
export interface ShellWidget extends WidgetBase {
  kind: 'shell';
  buttons: ShellButton[];
}

// ─── Palette ──────────────────────────────────────────────────────────────────
// Colour swatches. Every colour puts out three cells (R, G, B 0–1): colour k is
// cells 3k, 3k+1, 3k+2. Tapping a swatch selects it (and "touches" its cells,
// which an LTP Merge takes as the latest).
export interface PaletteWidget extends WidgetBase {
  kind: 'palette';
  colors: string[];    // '#rrggbb'
  cols: number;        // swatches per row
  model?: 'rgb' | 'cmy' | 'hsv';   // sliders in the colour editor
}

// ─── Merge ────────────────────────────────────────────────────────────────────
// Takes any number of inputs (drop cables on its box: in 1, in 2…) at NEGATIVE
// cell indices, groups them `every` at a time (3 = R G B of each colour) and
// merges the groups slot by slot: HTP (highest), LTP (latest group touched),
// lowest or average. Out k = cell k-1. `smooth` = seconds to glide to a new value.
export type MergeMode = 'htp' | 'ltp' | 'min' | 'avg';
export interface MergeWidget extends WidgetBase {
  kind: 'merge';
  mode: MergeMode;
  every: number;       // group size = number of outputs (1–16)
  smooth: number;      // seconds
}

// ─── Sketch ───────────────────────────────────────────────────────────────────
// Draw lines on the pad; on play, dots run along them one stroke after the
// other and put out their X / Y. Dot k is cells 2k (X) and 2k+1 (Y), 0–1 with
// Y up (same as the XY pad). Dots follow each other `delay` apart.
export interface SketchStroke {
  id: string;
  pts: number[];          // flat x, y pairs, 0–1, y from the top
}

export interface SketchWidget extends WidgetBase {
  kind: 'sketch';
  strokes: SketchStroke[];
  dots: number;           // how many dots run
  delay: number;          // distance between dots, as a fraction of the whole drawing
  duration: number;       // seconds for one run through the drawing at ×1
  speed?: number;         // ×0.125 … ×8, the SPEED input overrides it live
  loop: boolean;
  pingPong?: boolean;     // with loop: back to the start the other way, then forward again
  smooth?: number;        // 0–1: how much the drawing is smoothed before the dots run it
  showGrid: boolean;
}

// ─── Audio Level ──────────────────────────────────────────────────────────────
// OUT: a master fader for every sound Maestrale plays (Sound Player, timeline
// audio) — cells[0] is the gain, so it can be linked/automated.
// IN: a meter of the audio input — cells[0] is the level 0–1 (−60…0 dB), a
// source to link anywhere.
export interface AudioLevelWidget extends WidgetBase {
  kind: 'audioLevel';
  mode: 'in' | 'out';
  deviceId?: string;          // IN: '' = the Audio in device from Settings
  orientation?: 'vertical' | 'horizontal';
}

// ─── Encoder ──────────────────────────────────────────────────────────────────
// Endless encoders that send CHANGES (+3, −1…), never absolute values — like the
// wheels on a lighting desk. The desk keeps the real value, so there is nothing
// to jump from: turning here always continues from where the desk is.
export type EncoderFormat = 'oscDelta' | 'oscText' | 'oscIncDec' | 'midi';
export type EncoderMidiMode = 'offset64' | 'twos' | 'signBit';

export interface EncoderDef {
  id: string;
  label: string;
  address: string;      // oscDelta / oscText: where; oscIncDec: the "up" address
  addressDec?: string;  // oscIncDec: the "down" address
  text?: string;        // oscText: the string sent — {d} = +3 / -3, {abs} = 3, {dir} = + / -
  midiChannel?: number; // midi: 1–16
  midiCc?: number;      // midi: 0–127
}

export interface EncoderWidget extends WidgetBase {
  user?: number;             // Eos user (0 = the same as the console)
  kind: 'encoder';
  encoders: EncoderDef[];
  format: EncoderFormat;
  argType?: 'f' | 'i';       // oscDelta: float or integer argument
  step: number;              // amount sent per tick (oscDelta / oscText)
  ticksPerTurn: number;      // how many ticks one full turn of the knob gives
  acceleration: number;      // 0 = none … 1 = turning fast sends a lot more
  midiMode?: EncoderMidiMode;
  invert?: boolean;
  outputId?: string;         // OSC / MIDI output ('' / missing = the main one)
}

// ─── ETC (Eos Gio @5 surface) ─────────────────────────────────────────────────
// Every key of a Gio @5 laid out like the desk, sending Eos OSC: keys as
// <keyPrefix>/<name> (1 down, 0 up), the four encoders as relative ticks, the
// two masters as levels. Cells 0–1 are the master faders (linkable).
export interface EtcWidget extends WidgetBase {
  kind: 'etc';
  keyPrefix: string;                       // '/eos/key'
  keyOverrides?: Record<string, string>;   // key id → other name, or a full '/address'
  encoderAddress: string;                  // '/eos/active/wheel/fine/{n}'
  ticksPerTurn: number;
  acceleration: number;
  faderAddresses: [string, string];        // the two masters
  levelWheelAddress?: string;              // the vertical level wheel ('/eos/wheel/level')
  hideOsc?: boolean;                       // hide the small OSC names on the keys
  user?: number;                           // Eos user (0 = the same as the console)
  gmAddress?: string;                      // Grandmaster: the Eos fader it sits on, '/eos/fader/<page>/<fader>'
  wheelGain?: Record<string, number>;      // per parameter name ("Zoom"): ticks × this
  outputId?: string;
}

// ─── DMX Monitor ──────────────────────────────────────────────────────────────
// A grid of channels showing a universe: what arrives (Art-Net in) or what
// Maestrale sends (Art-Net / sACN out). Black = 0, white = 255. Read-only.

export interface DmxMonitorWidget extends WidgetBase {
  kind: 'dmxMonitor';
  source: 'in' | 'out';
  protocol: 'artnet' | 'sacn';
  universe: number;
  startChannel: number;   // first channel shown, 1–512 (the scroll position)
  cols: number;
  rows: number;
  sourceIp?: string;      // in: only this sender ('' = everyone)
  outputId?: string;      // out: only this destination ('' = all merged)
}

// ─── Clock ────────────────────────────────────────────────────────────────────
// The computer's time of day, and a list of times that fire a trigger when the
// clock reaches them — every day, for installations that run for days. Each
// alarm is one OUTPUT cell (a short 1 → 0 pulse), linkable like any other.

export interface ClockAlarm {
  id: string;
  time: string;        // "HH:MM:SS" (24 h)
  label?: string;
  enabled: boolean;
}

export interface ClockWidget extends WidgetBase {
  kind: 'clock';
  alarms: ClockAlarm[];
  showSeconds: boolean;
}

// ─── DMX Recorder / Player ────────────────────────────────────────────────────
// The recorder writes the incoming Art-Net stream to a take on disk
// (Save/Recordings); the player sends a take back out. Their cells are inputs:
// REC on the recorder, PLAY and STOP on the player — fire them from the Router.

export interface DmxRecorderWidget extends WidgetBase {
  kind: 'dmxRecorder';
  universes: string;        // "0, 1, 4-6" — empty records every universe heard
  // What it records: an input, or what Maestrale itself sends (default Art-Net in).
  source?: 'artnet' | 'sacn' | 'out-artnet' | 'out-sacn' | 'out-enttec';
}

// A playlist of recorded takes, like the Sound Player: item k is cell k (a
// rising edge plays it), and STOP / NEXT / PREV / FIRST are inputs.
export interface DmxPlayerItem {
  id: string;
  takeId: string;
  end: PlayEnd;      // at the end: stop, loop this item, or play the next
  fade: number;      // seconds: crossfade from what was on output
}

export interface DmxPlayerWidget extends WidgetBase {
  kind: 'dmxPlayer';
  items: DmxPlayerItem[];
  universeOffset: number;   // added to each recorded universe on the way out
  playProtocol: 'artnet' | 'sacn';
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export interface Page {
  id: string;
  name: string;
  widgets: Widget[];
  backgroundColor: string;
  width: number;
  height: number;
  liveOffsetX?: number;
  liveOffsetY?: number;
}

// ─── Connection ───────────────────────────────────────────────────────────────

// A named, individually-addressable extra output. The primary destination in each
// connection is implicitly output id 'primary' (shown as "out 1"); these are the
// additional ones a mapping can target by id.
export interface MidiOutput { id: string; name: string; portName: string; }
export interface HostOutput  { id: string; name: string; host: string; }              // Art-Net / sACN
export interface OscOutput   { id: string; name: string; host: string; port: number; }

export const PRIMARY_OUTPUT_ID = 'primary';

export interface MidiConnection {
  type: 'midi';
  portName: string;
  virtualPort: boolean;
  // Additional named MIDI output ports. Each mapping targets one output by id;
  // clock is mirrored to all. Virtual-port option applies only to the primary port.
  extraOutputs?: MidiOutput[];
}

export interface MidiInputConnection {
  type: 'midiInput';
  portName: string;
  // Additional MIDI input ports (by name). Channel messages from each are merged
  // into the same input stream; MTC/SysEx handling stays on the primary port.
  extraPorts?: string[];
}

export interface OscConnection {
  type: 'osc';
  targetHost: string;
  targetPort: number;
  listenPort: number;
  // Additional named output destinations (host:port). A mapping targets one by id.
  extraOutputs?: OscOutput[];
  // Additional local ports to listen on (input). Messages arriving on any of
  // these are merged into the same OSC feedback stream as listenPort.
  extraListenPorts?: number[];
}

export interface ArtNetConnection {
  type: 'artnet';
  targetHost: string;
  // Additional named output destinations (unicast/broadcast host). A mapping targets one by id.
  extraOutputs?: HostOutput[];
}

// Art-Net INPUT: receive DMX on UDP 6454 (any universe). Separate from the
// output connection so you can listen without sending, and the other way round.
export interface ArtNetInputConnection {
  type: 'artnetInput';
  enabled: boolean;
  bindHost?: string;   // local interface IP to listen on; '' / undefined = all
  // Universes announced to ArtPoll, so senders in unicast mode (MadMapper
  // "Use Unicast", consoles) find Maestrale in their node list. "0-3", "0, 5".
  universes?: string;
}

export interface SacnConnection {
  type: 'sacn';
  mode: 'multicast' | 'unicast';
  targetHost?: string;
  priority: number;
  // Additional named unicast output destinations. A mapping targets one by id.
  extraOutputs?: HostOutput[];
}

export interface LtcAudioConnection {
  type: 'ltcAudio';
  deviceId: string;     // Web Audio deviceId from enumerateDevices
  deviceLabel: string;
}

export interface AudioOutputConnection {
  type: 'audioOutput';
  deviceId: string;
  deviceLabel: string;
}

export interface EnttecDmxConnection {
  type: 'enttecDmx';
  deviceIndex: number;
  deviceDescription?: string;
}

export interface SacnInputConnection {
  type: 'sacnInput';
  enabled: boolean;
  bindHost?: string;   // card to join the multicast groups on; '' = every card (loopback included)
  universes?: string;  // universes to join (multicast is per universe): "1-4", "1, 7"
}

export type Connection = MidiConnection | MidiInputConnection | OscConnection | ArtNetConnection | ArtNetInputConnection | SacnInputConnection | SacnConnection | LtcAudioConnection | AudioOutputConnection | EnttecDmxConnection;

// ─── Project ──────────────────────────────────────────────────────────────────

export const SCHEMA_VERSION = 1;

export interface Project {
  schemaVersion: typeof SCHEMA_VERSION;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  connections: Connection[];
  pages: Page[];
  activePageId: string;
  tapTriggerMapping: Mapping | null;
  resetTriggerMapping: Mapping | null;
  // The other two transport buttons in the top bar. Optional so projects saved
  // before they existed still load.
  playTriggerMapping?: Mapping | null;
  // Installations: go straight to Live when Maestrale starts with this project.
  startInLive?: boolean;           // missing = on (installations boot into Live)
  // Which protocols were connected (Connect pressed) — reopened the same way.
  // Missing = an older project: everything configured connects.
  connected?: Record<string, boolean>;
  // Interface colours (Settings → Palette). Travel with the project, so it opens
  // the same on any PC. Missing = the default palette.
  palette?: { accent: string; highlight: string };
  stopTriggerMapping?: Mapping | null;
  // Project-wide frame rate. Timelines read their ruler in frames against this
  // unless they carry their own timecode rate.
  frameRate?: 24 | 25 | 29.97 | 30 | 50 | 60;
  // The project's main router: every link made by Shift-patching, right-click
  // Link or Learn lands here. Router widgets still route their own rows, but
  // the Router page is where links live and get edited.
  mainRouter?: { rows: RouterRow[] };
}
