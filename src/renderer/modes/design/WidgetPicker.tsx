import { pal, palRgb, onPalette } from '../../palette';
import React, { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStore, useActivePageId } from '../../store';
import type { WidgetKind } from '../../../shared/types/project';
import ManualPopup from './ManualPopup';

interface WidgetOption {
  kind: WidgetKind;
  label: string;
  description: string;
  full?: boolean;      // spans both columns (stands alone)
  winOnly?: boolean;   // disabled on non-Windows (Spout is Windows-only)
}

// Spout uses a Windows-only native library; disable those widgets off Windows.
const IS_WINDOWS = /Win/i.test(navigator.userAgent) || /Win/i.test(navigator.platform);

// One column per group: controls · show · generators · routing · and a last
// column holding sound + texture (text, image, video in). Groups with the same
// `col` stack. The Manual is not here: it has its own button next to search.
// Value Display is hidden for now.
const WIDGET_GROUPS: { title: string; col?: number; items: WidgetOption[] }[] = [
  { title: 'Controls', col: 0, items: [
    { kind: 'sliderBank',    label: 'Slider Bank',    description: 'Bank of vertical or horizontal faders. Each fader maps to its own MIDI/OSC/DMX output.' },
    { kind: 'knobBank',      label: 'Knob Bank',      description: 'Bank of rotary knobs — drag up/right to raise, down/left to lower.' },
    { kind: 'buttonGrid',    label: 'Button Grid',    description: 'Grid of momentary, toggle, pulse or radio buttons with per-cell colours.' },
    { kind: 'xyPad',         label: 'XY Pad',         description: 'Two-axis touch surface — X and Y each drive their own output.' },
    { kind: 'keyboard',      label: 'Keyboard',       description: 'Bind computer keys as buttons — press the key or tap it on screen. Each key is linkable.' },
  ] },
  { title: 'Show', col: 1, items: [
    { kind: 'cues',          label: 'Cues',           description: 'Snapshot and recall the whole state — values and links — with fade times.' },
    { kind: 'timeline',      label: 'Timeline',       description: 'Multi-track sequencer: value, colour and audio tracks with keyframes, cues and wait points.' },
    { kind: 'submasters',    label: 'Submasters',     description: 'Multi-scene submaster bank with HTP/LTP merge, record and flash buttons.' },
    { kind: 'masterLevel',   label: 'Master Level',   description: 'Master fader that scales EVERYTHING going out on one protocol (DMX/OSC/MIDI).' },
    { kind: 'dmxRecorder',   label: 'DMX Recorder',   description: 'Records the incoming Art-Net stream to a take on disk — REC from here or from the Router.' },
    { kind: 'dmxPlayer',     label: 'DMX Player',     description: 'Plays a recorded take back out on Art-Net or sACN, with loop, scrub and universe offset.' },
    { kind: 'dmxMonitor',    label: 'DMX Monitor',    description: 'Grid of DMX channels — what arrives (Art-Net in) or what LiveForge sends (Art-Net / sACN out). Black 0, white 255.' },
  ] },
  { title: 'Generators', col: 2, items: [
    { kind: 'lfoWidget',     label: 'LFO',            description: 'BPM-synced or Hz oscillator (sine/square/saw/triangle/random) with play/stop. ＋ adds outputs with their own phase.' },
    { kind: 'noiseWidget',   label: 'Noise',          description: 'Smooth random movement, like an LFO that never repeats: same inputs (PLAY, FREQ, AMP…), ＋ outputs, roughness.' },
    { kind: 'sketch',        label: 'Sketch',         description: 'Draw lines, press play: dots run along your drawing and put out X / Y — several dots chase each other.' },
    { kind: 'stepSequencer', label: 'Step Sequencer', description: 'Programmable step sequencer synced to the master BPM, with RND/MAX/ZERO.' },
    { kind: 'graphWidget',   label: 'Graph',          description: 'Draw your own envelope curve — linear/bezier/square points, looped or one-shot.' },
    { kind: 'clock',         label: 'Clock',          description: 'The computer\'s time, big. ＋ adds a time of day that fires a trigger — for installations running for days.' },
  ] },
  { title: 'Routing', col: 3, items: [
    { kind: 'router',        label: 'Router',         description: 'Its own routing rows (one input to many outputs), edited in its settings. Links made by Shift, right-click and Learn live in the Router page.' },
    { kind: 'mathWidget',    label: 'Math / Merge',   description: 'Combine two cell sources with add, subtract, multiply, min, max, avg, invert.' },
    { kind: 'instance',      label: 'Instance',       description: 'Bound copy of another widget — shares the exact same value across pages.' },
  ] },
  { title: 'Sound', col: 4, items: [
    { kind: 'audioAnalyser', label: 'Audio Analyser', description: 'Kick/snare detection, BPM ramps and bass/mid/high band levels from an audio input.' },
    { kind: 'audioLevel',    label: 'Audio Level',    description: 'OUT: master volume of every sound LiveForge plays. IN: level meter of an audio input, linkable as a source.' },
    { kind: 'soundPlayer',   label: 'Sound Player',   description: 'Playlist with per-track play/pause/stop and volume — triggerable from the Router.' },
  ] },
  { title: 'Texture', col: 4, items: [
    { kind: 'textWidget',    label: 'Text',           description: 'Static label with custom font, colour, alignment and frame.' },
    { kind: 'imageWidget',   label: 'Image',          description: 'PNG/JPG overlay, click-through — sits under or over the widgets.' },
    { kind: 'spoutInput',    label: 'Spout / Syphon', description: 'Live video from a Spout sender.', winOnly: true },
    { kind: 'ndiInput',      label: 'NDI Input',      description: 'Live video from an NDI source on the network.', winOnly: true },
  ] },
];

const COLUMNS = [0, 1, 2, 3, 4].map((c) => WIDGET_GROUPS.filter((g) => g.col === c));

// Search: a widget matches when any word of its name starts with what you
// typed — "c" lights Cues and Clock, "rec" lights DMX Recorder. Everything else
// dims but stays clickable.
function matches(o: WidgetOption, q: string): boolean {
  if (!q) return true;
  const words = o.label.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const query = q.toLowerCase().trim();
  return o.label.toLowerCase().startsWith(query) || words.some((w) => w.startsWith(query));
}

export default function WidgetPicker(): React.JSX.Element {
  const { closeWidgetPicker } = useStore(useShallow((s) => ({
    closeWidgetPicker: s.closeWidgetPicker,
  })));
  const activePageId = useActivePageId();
  const [hovered, setHovered] = useState<WidgetOption | null>(null);
  const [query, setQuery] = useState('');
  const [manualOpen, setManualOpen] = useState(false);

  // Picking does not drop the widget at the top-left any more: the canvas shows
  // a dashed outline of its size under the mouse, and a click places it.
  function handlePick(kind: WidgetKind) {
    if (!activePageId) return;
    closeWidgetPicker();
    useStore.getState().setPlacingKind(kind);
  }

  const firstMatch = query
    ? WIDGET_GROUPS.flatMap((g) => g.items).find((o) => matches(o, query) && !(o.winOnly && !IS_WINDOWS))
    : undefined;

  if (manualOpen) return <ManualPopup onClose={() => setManualOpen(false)} />;

  return (
    <div style={styles.overlay} onClick={closeWidgetPicker}>
      <div style={styles.panel} onClick={(e) => e.stopPropagation()}>
        <div style={styles.header}>
          <span style={{ fontWeight: 600 }}>Add Widget</span>
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && firstMatch) handlePick(firstMatch.kind);
              if (e.key === 'Escape') closeWidgetPicker();
            }}
            placeholder="search…  (Enter adds the first match)"
            style={styles.search}
          />
          <button style={styles.manualBtn} onClick={() => setManualOpen(true)} title="Open the manual">Manual</button>
          <button style={styles.close} onClick={closeWidgetPicker}>✕</button>
        </div>

        {/* Compact title-only cells, in groups — descriptions live in the strip below */}
        <div style={styles.list} onMouseLeave={() => setHovered(null)}>
          {COLUMNS.map((col, ci) => (
            <div key={ci} style={styles.column}>
            {col.map((g) => (
            <div key={g.title} style={styles.group}>
              <div style={styles.groupTitle}>{g.title}</div>
              <div style={styles.grid}>
                {g.items.map((o) => {
                  const isHovered = hovered?.kind === o.kind;
                  const disabled = !!o.winOnly && !IS_WINDOWS;
                  const dim = !matches(o, query);
                  const first = firstMatch?.kind === o.kind;
                  return (
                    <button
                      key={o.kind}
                      disabled={disabled}
                      style={{
                        ...styles.card,
                        ...(isHovered || first ? styles.cardHover : {}),
                        ...(disabled ? styles.cardDisabled : {}),
                        ...(dim && !disabled ? styles.cardDim : {}),
                      }}
                      onClick={() => { if (!disabled) handlePick(o.kind); }}
                      onMouseEnter={() => setHovered(o)}
                    >
                      {o.label}{disabled ? '  ·  Windows only' : ''}
                    </button>
                  );
                })}
              </div>
            </div>
            ))}
            </div>
          ))}
        </div>

        {/* Description of the widget under the cursor */}
        <div style={styles.desc}>
          {(hovered ?? firstMatch) ? (
            <>
              <div style={styles.descLabel}>{(hovered ?? firstMatch)!.label}</div>
              <div style={styles.descText}>
                {(hovered ?? firstMatch)!.description}
                {(hovered ?? firstMatch)!.winOnly && !IS_WINDOWS && (
                  <span style={{ color: pal('#da7f30') }}>  —  Windows only (Spout not available on this OS).</span>
                )}
              </div>
            </>
          ) : (
            <div style={styles.descHint}>hover a widget to see what it does</div>
          )}
        </div>
      </div>
    </div>
  );
}

const make_styles = (): Record<string, React.CSSProperties> => ({
  overlay: {
    position: 'fixed', inset: 0,
    background: 'rgba(0,0,0,0.6)',
    // Anchored to the top, not centred: hovering never moves the panel.
    display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: '6vh',
    zIndex: 1000,
  },
  panel: {
    background: 'var(--color-surface)',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-md)',
    width: 1180,
    maxWidth: '96vw',

    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    maxHeight: '92vh',
  },
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '12px 16px',
    borderBottom: '1px solid var(--color-border)',
    flexShrink: 0,
  },
  close: {
    background: 'none', border: 'none',
    color: 'var(--color-text-dim)', cursor: 'pointer', fontSize: 16,
  },
  list: {
    flex: 1, minHeight: 0, overflowY: 'auto', padding: '4px 12px 12px',
    display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', columnGap: 14, alignItems: 'start',
  },
  column: {
    display: 'flex', flexDirection: 'column', minWidth: 0,
  },
  manualBtn: {
    marginRight: 10, height: 28, padding: '0 14px',
    background: 'var(--color-surface-2)', border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-sm)', color: 'var(--color-text)', fontFamily: 'inherit', fontSize: 12, cursor: 'pointer',
  },
  group: {
    breakInside: 'avoid', marginBottom: 10,
    borderTop: '1px solid var(--color-border)', paddingTop: 4,
  },
  grid: {
    display: 'grid', gridTemplateColumns: '1fr',
    gap: 5,
  },
  rule: {
    height: 1, background: 'var(--color-border)', margin: '10px 0 2px',
  },
  groupTitle: {
    fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase',
    color: 'var(--color-text-dim)', padding: '6px 2px 5px',
  },
  search: {
    flex: 1, margin: '0 12px', height: 28, padding: '0 10px',
    background: 'var(--color-surface-2)', border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-sm)', color: 'var(--color-text)', fontFamily: 'inherit', fontSize: 12,
  },
  cardDim: {
    opacity: 0.28,
  },
  card: {
    background: 'var(--color-surface-2)',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-sm)',
    padding: '7px 10px',
    cursor: 'pointer',
    textAlign: 'left',
    color: 'var(--color-text)',
    fontSize: 12,
    fontFamily: 'inherit',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    transition: 'border-color 0.12s, background 0.12s',
  },
  cardHover: {
    background: `var(--color-accent-dim, rgba(${palRgb('#91ced2')},0.15))`,
    border: '1px solid var(--color-accent)',
    color: 'var(--color-accent)',
  },
  cardDisabled: {
    opacity: 0.4,
    cursor: 'not-allowed',
    color: 'var(--color-text-dim)',
  },
  desc: {
    flexShrink: 0,
    borderTop: '1px solid var(--color-border)',
    padding: '10px 16px',
    height: 76, boxSizing: 'border-box', overflow: 'hidden',
    background: 'var(--color-surface-2)',
    display: 'flex', flexDirection: 'column', gap: 3,
    justifyContent: 'flex-start',
  },
  descLabel: {
    fontSize: 11, fontWeight: 700, color: 'var(--color-accent)',
    letterSpacing: '0.04em',
  },
  descText: {
    fontSize: 11, color: 'var(--color-text-dim)', lineHeight: 1.45,
  },
  descHint: {
    fontSize: 11, color: 'var(--color-text-dim)', opacity: 0.5, fontStyle: 'italic',
  },
});
let styles: Record<string, React.CSSProperties> = make_styles();
onPalette(() => { styles = make_styles(); });
