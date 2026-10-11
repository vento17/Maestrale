// The ETC widget: an Eos Gio @5 surface laid out like the real desk. Every key
// sends /eos/key/<name> (1.0 down, 0.0 up); names from the Eos "OSC /key Names"
// view. `guess: true` = not in that view, name taken from the Eos docs / forums
// or guessed — check it, it can be changed in the settings.

export interface EtcKey {
  id: string;           // default key name, also the override id
  label: string;
  x: number; y: number; w: number; h: number;
  guess?: boolean;
  small?: boolean;      // the little lit buttons (Release, Tab…)
  full?: string;        // a full OSC address instead of /eos/key/<id>
  cat?: boolean;        // an encoder-category key (accent outline, orange when on)
  mark?: boolean;       // always outlined orange (Live, Address / Patch)
}

export const ETC_W = 1330;
export const ETC_H = 660;

const K = 64, H = 50, G = 6;          // key size and gap
const GG = 18;                        // gap between key blocks
const X0 = 360;
const GX = [X0, X0 + 3 * K + 2 * G + GG];
GX.push(GX[1] + 3 * K + 2 * G + GG);           // block 3
GX.push(GX[2] + 3 * K + 2 * G + GG);           // single column
GX.push(GX[3] + K + GG);                        // right block

const keys: EtcKey[] = [];
const put = (id: string, label: string, block: number, col: number, y: number, extra: Partial<EtcKey> = {}) =>
  keys.push({ id, label, x: GX[block] + col * (K + G), y, w: K, h: H, ...extra });

// Row A: the encoder-category row.
const YA = 170;
put('displays', 'Displays', 0, 0, YA); put('address', 'Address Patch', 0, 1, YA, { mark: true }); put('gio_encoder_display', 'Encoder Display', 0, 2, YA, { guess: true });
put('encoder_category_intensity', 'Intensity', 1, 0, YA, { cat: true });
put('encoder_category_focus', 'Focus', 1, 1, YA, { cat: true });
put('encoder_category_color', 'Color', 1, 2, YA, { cat: true });
put('encoder_category_shutter', 'Shutter', 2, 0, YA, { cat: true });
put('encoder_category_image', 'Image', 2, 1, YA, { cat: true });
put('encoder_category_form', 'Form', 2, 2, YA, { cat: true });
put('more_softkeys', 'More SK', 3, 0, YA);
put('live', 'Live', 4, 0, YA, { mark: true }); put('blind', 'Blind', 4, 1, YA); put('page_mode', 'Scroll Lock', 4, 2, YA);

// Rows B.
const YB = 240, YB2 = YB + H + G;
put('macro', 'Macro', 0, 0, YB); put('help', 'Help', 0, 1, YB); put('learn', 'Learn', 0, 2, YB);
put('delete', 'Delete', 0, 0, YB2); put('color_path', 'Path', 0, 1, YB2); put('effect', 'Effect', 0, 2, YB2);
put('query', 'Query', 1, 0, YB); put('copy_to', 'Copy To', 1, 1, YB); put('recall_from', 'Recall From', 1, 2, YB);
put('go_to_cue', 'Go To Cue', 1, 0, YB2); put('block', 'Block', 1, 1, YB2); put('assert', 'Assert', 1, 2, YB2);
put('label', 'Label', 2, 0, YB); put('about', 'About', 2, 2, YB);
put('undo', 'Undo', 2, 0, YB2); put('highlight', 'High', 2, 1, YB2); put('fan', 'Fan', 2, 2, YB2);
put('park', 'Park', 3, 0, YB); put('capture', 'Capture', 3, 0, YB2);
put('escape', 'Escape', 4, 0, YB); put('page_up', 'Page ▲', 4, 1, YB); put('select', 'Select', 4, 2, YB);
put('page_left', '◀ Page', 4, 0, YB2); put('page_down', 'Page ▼', 4, 1, YB2); put('page_right', 'Page ▶', 4, 2, YB2);

// Main keypad, 5 rows.
const YM = 370;
const ym = (r: number) => YM + r * (H + G);
[
  ['part', 'Part', 'cue', 'Cue', 'record', 'Record'],
  ['intensity_palette', 'Int Palette', 'focus_palette', 'Focus Palette', 'record_only', 'Record Only'],
  ['color_palette', 'Color Palette', 'beam_palette', 'Beam Palette', 'update', 'Update'],
  ['preset', 'Preset', 'sub', 'Sub', 'group', 'Group'],
  ['shift', 'Shift', 'delay', 'Delay', 'time', 'Time'],
].forEach((r, i) => { put(r[0], r[1], 0, 0, ym(i)); put(r[2], r[3], 0, 1, ym(i)); put(r[4], r[5], 0, 2, ym(i)); });
[
  ['+', '+', 'thru', 'Thru', '-', '−'],
  ['7', '7', '8', '8', '9', '9'],
  ['4', '4', '5', '5', '6', '6'],
  ['1', '1', '2', '2', '3', '3'],
  ['clear_cmd', 'Clear', '0', '0', '.', '.'],
].forEach((r, i) => { put(r[0], r[1], 1, 0, ym(i)); put(r[2], r[3], 1, 1, ym(i)); put(r[4], r[5], 1, 2, ym(i)); });
[
  ['\\', '/', 'mark', 'Mark', 'sneak', 'Sneak'],
  ['rem_dim', 'Rem Dim', '+%', '+ %', 'home', 'Home'],
  ['out', 'Out', '-%', '− %', 'trace', 'Trace'],
  ['full', 'Full', 'level', 'Level', 'cueonlytrack', 'Q Only Track'],
].forEach((r, i) => { put(r[0], r[1], 2, 0, ym(i)); put(r[2], r[3], 2, 1, ym(i)); put(r[4], r[5], 2, 2, ym(i)); });
put('@', 'At', 2, 0, ym(4)); put('enter', 'Enter', 2, 1, ym(4), { w: 2 * K + G });
put('select_last', 'Select Last', 3, 0, ym(0)); put('select_manual', 'Select Manual', 3, 0, ym(1));
put('select_active', 'Select Active', 3, 0, ym(2)); put('last', 'Last', 3, 0, ym(3)); put('next', 'Next', 3, 0, ym(4));
// Display keys under the page block.
const SH = 32;
put('tab', 'Tab', 4, 0, ym(0), { h: SH, small: true }); put('flexichannel_mode', 'Flexi', 4, 1, ym(0), { h: SH, small: true }); put('display_timing', 'Time', 4, 2, ym(0), { h: SH, small: true });
put('format', 'Format', 4, 0, ym(0) + SH + 14, { h: SH, small: true }); put('expand', 'Expand', 4, 1, ym(0) + SH + 14, { h: SH, small: true }); put('data', 'Data', 4, 2, ym(0) + SH + 14, { h: SH, small: true });

// Fader buttons, two columns beside the masters.
const FX = 190, FW = 70, FH = 36;
[
  ['fader_release', 'Release', false, 'fader_spread', 'Spread', false],
  ['fader_off', 'Off', false, 'fader_assert', 'Assert', false],
  ['go_to_cue_0', 'Go To Cue 0', false, 'stop_effect', 'Stop Effect', false],
  ['fader_freeze', 'Freeze', false, 'filter_fader_button', 'Filter', false],
  ['manual_override', 'Manual Override', true, 'timing_disable', 'Timing Disable', false],
  ['rate', 'Rate', false, 'fader_pages', 'Fader Page', true],
].forEach((r, i) => {
  const y = 240 + i * (FH + 18);
  keys.push({ id: r[0] as string, label: r[1] as string, guess: r[2] as boolean, x: FX, y, w: FW, h: FH, small: true });
  keys.push({ id: r[3] as string, label: r[4] as string, guess: r[5] as boolean, x: FX + FW + 10, y, w: FW, h: FH, small: true });
});

// Masters block: Master key, Stop, Go. Faders are drawn separately.
keys.push({ id: 'master', label: 'Master', x: 58, y: 170, w: 106, h: 44, guess: true });
keys.push({ id: 'stop', label: '■', x: 20, y: ym(3), w: 130, h: H });
keys.push({ id: 'go_0', label: '▶', x: 20, y: ym(4), w: 130, h: H });

// From the Eos key list but not on the Gio @5 surface: a small row top-left.
[['load_modifier_button', 'Load'], ['snapshot', 'Snapshot'], ['fader', 'Fader'], ['staging_mode', 'Stage'], ['open_setup', 'System']]
  .forEach(([id, label], i) => keys.push({ id, label, x: 6 + i * 68, y: 6, w: 62, h: 30, small: true }));
// Softkeys: on the desk they live on the touchscreen; here a strip under them.
for (let i = 1; i <= 6; i++) keys.push({ id: `softkey_${i}`, label: `SK ${i}`, x: 6 + (i - 1) * 56, y: 50, w: 50, h: 30, small: true });

export const ETC_KEYS = keys;

// Master faders (Eos master = fader bank 0).
export const ETC_FADERS = [
  { id: 'm1', x: 64, y: 230 },
  { id: 'm2', x: 118, y: 230 },
];
export const ETC_FADER_H = ym(3) - 44 - 230;
// Grandmaster fader: far left, the same size as the masters.
export const ETC_GM = { x: 8, y: 230 };

// The four encoders over the keys.
export const ETC_ENCODERS = [0, 1, 2, 3].map((i) => ({ n: i + 1, cx: GX[1] + 40 + i * 205, cy: 74, r: 62 }));

// The vertical level wheel, in the empty corner bottom right.
export const ETC_LEVEL_WHEEL = { x: GX[4] + 70, y: ym(2) - 10, w: 84, h: 2 * (H + G) + H + 0 };
