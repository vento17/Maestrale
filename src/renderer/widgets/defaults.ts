import { pal } from '../palette';
import type {
  Widget, WidgetKind,
  SliderBankWidget, ButtonGridWidget, KnobBankWidget, XYPadWidget,
  ImageWidget, TextWidget, StepSequencerWidget, StepConfig,
  SliderCellConfig, ButtonCellConfig, KnobCellConfig,
  GraphWidget, GraphPoint,
  CuesWidget, CueData,
  TimelineWidget,
  SpoutInputWidget, NdiInputWidget,
  SubmastersWidget, RouterWidget,
  AutoBpmWidget,
  AudioAnalyserWidget, SoundPlayerWidget,
  LfoWidget, MathWidget, ValueDisplayWidget,
  MasterLevelWidget, AudioLevelWidget, SketchWidget, InstanceWidget, ManualWidget, KeyboardWidget, DmxRecorderWidget, DmxPlayerWidget, ClockWidget, DmxMonitorWidget, EncoderWidget, EtcWidget,
  ShellWidget, PaletteWidget, MergeWidget,
} from '../../shared/types/project';
import { BEAT_DIVISORS } from '../../shared/types/project';
import type { MidiMapping, OscMapping } from '../../shared/types/mapping';
import {
  DEFAULT_WIDGET_STYLE,
  DEFAULT_SLIDER_RECT, DEFAULT_BUTTON_RECT,
  DEFAULT_KNOB_RECT, DEFAULT_XYPAD_RECT,
  DEFAULT_IMAGE_RECT, DEFAULT_TEXT_RECT, DEFAULT_SEQUENCER_RECT,
  DEFAULT_GRAPH_RECT, DEFAULT_CUES_RECT, DEFAULT_TIMELINE_RECT,
  DEFAULT_SPOUT_RECT, DEFAULT_NDI_RECT, DEFAULT_SUBMASTERS_RECT, DEFAULT_ROUTER_RECT,
  DEFAULT_AUTO_BPM_RECT, DEFAULT_AUDIO_ANALYSER_RECT, DEFAULT_SOUND_PLAYER_RECT,
  DEFAULT_LFO_RECT, DEFAULT_MATH_RECT, DEFAULT_VALUE_DISPLAY_RECT,
  DEFAULT_MASTER_LEVEL_RECT, DEFAULT_AUDIO_LEVEL_RECT, DEFAULT_ENCODER_RECT, DEFAULT_SHELL_RECT, DEFAULT_PALETTE_RECT, DEFAULT_MERGE_RECT, DEFAULT_ETC_RECT, DEFAULT_SKETCH_RECT, DEFAULT_INSTANCE_RECT, DEFAULT_MANUAL_RECT,
  DEFAULT_KEYBOARD_RECT, DEFAULT_DMX_RECORDER_RECT, DEFAULT_DMX_PLAYER_RECT, DEFAULT_CLOCK_RECT, DEFAULT_DMX_MONITOR_RECT,
} from '../../shared/constants';

// ─── Mapping auto-increment helpers ──────────────────────────────────────────
// baseIndex = starting offset so widgets don't collide (caller passes next free index)

export function defaultMidiMapping(cellIndex: number, baseIndex: number): MidiMapping {
  return {
    type: 'midi',
    messageType: 'controlChange',
    channel: 1,
    number: ((baseIndex + cellIndex) % 128),
    minValue: 0,
    maxValue: 127,
  };
}

// OSC addresses get typed by hand into the receiving software, so keep them
// short: widget letter + widget number / cell number. /s1/1 = slider bank 1,
// first fader. The widget letter already says what kind of control it is.
const OSC_WIDGET_LETTER: Record<string, string> = {
  sliderBank: 's', buttonGrid: 'b', knobBank: 'k', xyPad: 'xy',
};

// The number comes from the widget's own unique label (slider3 → 3), not from a
// positional rank: that keeps the address lined up with the cell names
// (S3.1 ↔ /s3/1) and makes it follow a copy instead of staying on the original.
export function widgetLabelNum(label: string): number {
  return Number(label.match(/(\d+)$/)?.[1] ?? 1);
}

export function defaultOscMapping(kind: string, widgetNum: number, cellIndex: number): OscMapping {
  const w = OSC_WIDGET_LETTER[kind] ?? kind;
  return {
    type: 'osc',
    address: `/${w}${widgetNum}/${cellIndex + 1}`,
  };
}

// ─── Cell factories ───────────────────────────────────────────────────────────

export function makeSliderCells(count: number, baseIndex: number, label: string): SliderCellConfig[] {
  return Array.from({ length: count }, (_, i) => ({
    label: `${label}${i + 1}`,
    mapping: defaultMidiMapping(i, baseIndex),
    feedbackRules: [],
  }));
}

export function makeButtonCells(count: number, baseIndex: number, label: string): ButtonCellConfig[] {
  return Array.from({ length: count }, (_, i) => ({
    label: `${label}${i + 1}`,
    // Momentary is what a button is expected to do: 1 while held, 0 on release.
    // Pulse (a short trig) is a deliberate choice, not the default.
    behavior: 'momentary' as const,
    mapping: defaultMidiMapping(i, baseIndex),
    feedbackRules: [],
    onValue: 127,
    offValue: 0,
  }));
}

export function makeKnobCells(count: number, baseIndex: number, label: string): KnobCellConfig[] {
  return Array.from({ length: count }, (_, i) => ({
    label: `${label}${i + 1}`,
    mapping: defaultMidiMapping(i, baseIndex),
    feedbackRules: [],
    minAngle: -135,
    maxAngle: 135,
  }));
}

// ─── Widget factories ─────────────────────────────────────────────────────────
// baseCC = next free MIDI CC to avoid collisions with existing widgets

export function makeDefaultWidget(id: string, kind: WidgetKind, zIndex: number, baseCC = 0): Widget {
  switch (kind) {
    case 'sliderBank': {
      const countX = 8, countY = 1;
      return {
        id, zIndex, kind: 'sliderBank',
        label: 'Sliders',
        rect: { ...DEFAULT_SLIDER_RECT },
        style: { ...DEFAULT_WIDGET_STYLE },
        outputProtocol: 'midi',
        mapping: null,
        feedbackRules: [],
        countX, countY,
        orientation: 'vertical',
        spacingX: 8, spacingY: 8,
        cells: makeSliderCells(countX * countY, baseCC, 'S'),
      } satisfies SliderBankWidget;
    }
    case 'buttonGrid': {
      const countX = 4, countY = 4;
      return {
        id, zIndex, kind: 'buttonGrid',
        label: 'Buttons',
        rect: { ...DEFAULT_BUTTON_RECT },
        style: { ...DEFAULT_WIDGET_STYLE },
        outputProtocol: 'midi',
        mapping: null,
        feedbackRules: [],
        countX, countY,
        spacingX: 8, spacingY: 8,
        cells: makeButtonCells(countX * countY, baseCC, 'B'),
      } satisfies ButtonGridWidget;
    }
    case 'knobBank': {
      const countX = 4, countY = 2;
      return {
        id, zIndex, kind: 'knobBank',
        label: 'Knobs',
        rect: { ...DEFAULT_KNOB_RECT },
        style: { ...DEFAULT_WIDGET_STYLE },
        outputProtocol: 'midi',
        mapping: null,
        feedbackRules: [],
        countX, countY,
        spacingX: 8, spacingY: 8,
        knobSize: 56,
        cells: makeKnobCells(countX * countY, baseCC, 'K'),
      } satisfies KnobBankWidget;
    }
    case 'xyPad': {
      return {
        id, zIndex, kind: 'xyPad',
        label: 'XY Pad',
        rect: { ...DEFAULT_XYPAD_RECT },
        style: { ...DEFAULT_WIDGET_STYLE },
        outputProtocol: 'midi',
        mapping: null,
        feedbackRules: [],
        mappingX: { type: 'midi', messageType: 'controlChange', channel: 1, number: baseCC % 128, minValue: 0, maxValue: 127 },
        mappingY: { type: 'midi', messageType: 'controlChange', channel: 1, number: (baseCC + 1) % 128, minValue: 0, maxValue: 127 },
        feedbackRulesX: [],
        feedbackRulesY: [],
        showCrosshair: true,
        invertX: false,
        invertY: false,
      } satisfies XYPadWidget;
    }
    case 'imageWidget': {
      return {
        id, zIndex, kind: 'imageWidget',
        label: 'Image',
        rect: { ...DEFAULT_IMAGE_RECT },
        style: { ...DEFAULT_WIDGET_STYLE, backgroundColor: 'transparent' },
        outputProtocol: 'midi',
        mapping: null,
        feedbackRules: [],
        src: '',
        layer: 'under',
        blendMode: 'normal',
        opacity: 1,
      } satisfies ImageWidget;
    }
    case 'textWidget': {
      return {
        id, zIndex, kind: 'textWidget',
        label: 'Text',
        rect: { ...DEFAULT_TEXT_RECT },
        style: { ...DEFAULT_WIDGET_STYLE, backgroundColor: 'transparent' },
        outputProtocol: 'midi',
        mapping: null,
        feedbackRules: [],
        text: 'Text',
        fontFamily: 'sans-serif',
        fontWeight: 'normal',
        fontStyle: 'normal',
        textColor: '#ffffff',
        textAlign: 'center',
        layer: 'under',
        frame: 'none',
        frameColor: '#ffffff',
        frameSize: 1,
      } satisfies TextWidget;
    }
    case 'stepSequencer': {
      const stepCount = 16;
      const steps: StepConfig[] = Array.from({ length: stepCount }, () => ({ active: false, value: 1 }));
      return {
        id, zIndex, kind: 'stepSequencer',
        label: 'Step Sequencer',
        rect: { ...DEFAULT_SEQUENCER_RECT },
        style: { ...DEFAULT_WIDGET_STYLE },
        outputProtocol: 'midi',
        mapping: defaultMidiMapping(0, baseCC),
        feedbackRules: [],
        stepCount,
        speedMultiplier: 1,
        steps,
        smooth: 0,
      } satisfies StepSequencerWidget;
    }
    case 'graphWidget': {
      const points: GraphPoint[] = [
        { x: 0,   y: 0, mode: 'linear' },
        { x: 0.5, y: 1, mode: 'linear' },
        { x: 1,   y: 0, mode: 'linear' },
      ];
      return {
        id, zIndex, kind: 'graphWidget',
        label: 'Graph',
        rect: { ...DEFAULT_GRAPH_RECT },
        style: { ...DEFAULT_WIDGET_STYLE },
        outputProtocol: 'midi',
        mapping: defaultMidiMapping(0, baseCC),
        feedbackRules: [],
        points,
        speedMultiplier: 1,
        timingMode: 'bpm',
        manualDuration: 4,
        playMode: 'loop',
        playMapping: null,
        stopMapping: null,
        reverseMapping: null,
      } satisfies GraphWidget;
    }
    case 'timeline': {
      return {
        id, zIndex, kind: 'timeline',
        label: 'Timeline',
        rect: { ...DEFAULT_TIMELINE_RECT },
        style: { ...DEFAULT_WIDGET_STYLE },
        outputProtocol: 'midi',
        mapping: null,
        feedbackRules: [],
        duration: 30,
        loopMode: 'none',
        markers: [],
        tracks: [],
        playMapping: null,
        stopMapping: null,
      } satisfies TimelineWidget;
    }
    case 'cues': {
      return {
        id, zIndex, kind: 'cues',
        label: 'Cues',
        rect: { ...DEFAULT_CUES_RECT },
        style: { ...DEFAULT_WIDGET_STYLE },
        outputProtocol: 'midi',
        mapping: null,
        feedbackRules: [],
        cues: [] as CueData[],
        navFirst:  null,
        navPrev:   null,
        navNext:   null,
        navRandom: null,
        navLast:   null,
      } satisfies CuesWidget;
    }
    case 'spoutInput': {
      return {
        id, zIndex, kind: 'spoutInput',
        label: 'Spout Input',
        rect: { ...DEFAULT_SPOUT_RECT },
        style: { ...DEFAULT_WIDGET_STYLE, backgroundColor: '#000000' },
        outputProtocol: 'midi',
        mapping: null,
        feedbackRules: [],
        senderName: '',
        borderWidth: 0,
        borderColor: '#ffffff',
        targetFps: 0,
      } satisfies SpoutInputWidget;
    }
    case 'ndiInput': {
      return {
        id, zIndex, kind: 'ndiInput',
        label: 'NDI Input',
        rect: { ...DEFAULT_NDI_RECT },
        style: { ...DEFAULT_WIDGET_STYLE, backgroundColor: '#000000' },
        outputProtocol: 'midi',
        mapping: null,
        feedbackRules: [],
        sourceName: '',
        borderWidth: 0,
        borderColor: '#ffffff',
        targetFps: 0,
      } satisfies NdiInputWidget;
    }
    case 'submasters': {
      const countX = 8;
      return {
        id, zIndex, kind: 'submasters',
        label: 'Submasters',
        rect: { ...DEFAULT_SUBMASTERS_RECT },
        style: { ...DEFAULT_WIDGET_STYLE },
        outputProtocol: 'midi',
        mapping: null,
        feedbackRules: [],
        countX,
        spacingX: 6,
        spacingY: 6,
        mergeMode: 'htp',
        linkedWidgetIds: ['*all*'],   // every slider, knob, button and XY pad, on every page
        scenes: Array.from({ length: countX }, (_, i) => ({
          label: `${i + 1}`,
          snapshot: {},
        })),
      } satisfies SubmastersWidget;
    }
    case 'router': {
      return {
        id, zIndex, kind: 'router',
        label: 'Router',
        rect: { ...DEFAULT_ROUTER_RECT },
        style: { ...DEFAULT_WIDGET_STYLE, backgroundColor: 'transparent' },
        outputProtocol: 'midi',
        mapping: null,
        feedbackRules: [],
        rows: [],
      } satisfies RouterWidget;
    }
    case 'autoBpm': {
      return {
        id, zIndex, kind: 'autoBpm',
        label: 'BPM Clock',
        rect: { ...DEFAULT_AUTO_BPM_RECT },
        style: { ...DEFAULT_WIDGET_STYLE, backgroundColor: '#060608' },
        outputProtocol: 'midi',
        mapping: null,
        feedbackRules: [],
        beatOutputs: BEAT_DIVISORS.map((divisor) => ({
          divisor,
          triggerMapping: null,
          rampMapping: null,
        })),
      } satisfies AutoBpmWidget;
    }
    case 'audioAnalyser': {
      return {
        id, zIndex, kind: 'audioAnalyser',
        label: 'Audio Analyser',
        rect: { ...DEFAULT_AUDIO_ANALYSER_RECT },
        style: { ...DEFAULT_WIDGET_STYLE, backgroundColor: '#060608' },
        outputProtocol: 'midi',
        mapping: null,
        feedbackRules: [],
        audioDeviceId: null,
        beatOutputs: BEAT_DIVISORS.map((divisor) => ({
          divisor,
          triggerMapping: null,
          rampMapping: null,
        })),
        kickThreshold: 0.10,
        kickFreq: 80,
        kickBand: 120,
        snareThreshold: 0.08,
        snareFreq: 250,
        snareBand: 500,
        bassFreq: 250,
        bassBand: 100,
        midFreq: 1500,
        midBand: 3000,
        highFreq: 4000,
        highBand: 500,
        kickMapping: null,
        snareMapping: null,
        bassMapping: null,
        midMapping: null,
        highMapping: null,
      } satisfies AudioAnalyserWidget;
    }
    case 'soundPlayer': {
      return {
        id, zIndex, kind: 'soundPlayer',
        label: 'Sound Player',
        rect: { ...DEFAULT_SOUND_PLAYER_RECT },
        style: { ...DEFAULT_WIDGET_STYLE, backgroundColor: '#060608' },
        outputProtocol: 'midi',
        mapping: null,
        feedbackRules: [],
        tracks: [],
        masterVolume: 0.8,
      } satisfies SoundPlayerWidget;
    }
    case 'noiseWidget':
    case 'lfoWidget': {
      const noise = kind === 'noiseWidget';
      return {
        id, zIndex, kind: noise ? 'noiseWidget' : 'lfoWidget',
        label: noise ? 'Noise' : 'LFO',
        rect: { ...DEFAULT_LFO_RECT },
        style: { ...DEFAULT_WIDGET_STYLE, backgroundColor: '#060608' },
        outputProtocol: 'midi',
        mapping: defaultMidiMapping(0, baseCC),
        feedbackRules: [],
        waveform: noise ? 'noise' : 'sine',
        ...(noise ? { seed: 1 + Math.floor(Math.random() * 9999) } : {}),
        rateMode: noise ? 'hz' : 'bpm',
        rateMultiplier: 1,
        rateHz: noise ? 0.5 : 1,
        amplitude: 1,
        center: 0.5,
        offset: 0,
        phase: 0.5,
        playMapping: null,
        stopMapping: null,
      } satisfies LfoWidget;
    }
    case 'mathWidget': {
      return {
        id, zIndex, kind: 'mathWidget',
        label: 'Math',
        rect: { ...DEFAULT_MATH_RECT },
        style: { ...DEFAULT_WIDGET_STYLE, backgroundColor: '#060608' },
        outputProtocol: 'midi',
        mapping: defaultMidiMapping(0, baseCC),
        feedbackRules: [],
        sourceAWidgetId: '',
        sourceACellIndex: 0,
        sourceBWidgetId: '',
        sourceBCellIndex: 0,
        operation: 'add',
        inMin: 0,
        inMax: 1,
        outMin: 0,
        outMax: 1,
        clampOutput: true,
      } satisfies MathWidget;
    }
    case 'valueDisplay': {
      return {
        id, zIndex, kind: 'valueDisplay',
        label: 'Value',
        rect: { ...DEFAULT_VALUE_DISPLAY_RECT },
        style: { ...DEFAULT_WIDGET_STYLE, backgroundColor: '#060608' },
        outputProtocol: 'midi',
        mapping: null,
        feedbackRules: [],
        sourceWidgetId: '',
        sourceCellIndex: 0,
        displayFormat: 'percent',
        decimals: 1,
      } satisfies ValueDisplayWidget;
    }
    case 'masterLevel': {
      return {
        id, zIndex, kind: 'masterLevel',
        label: 'Master',
        rect: { ...DEFAULT_MASTER_LEVEL_RECT },
        style: { ...DEFAULT_WIDGET_STYLE, showValue: true, valueFormat: 'percent' },
        outputProtocol: 'midi',
        mapping: null,
        feedbackRules: [],
        protocol: 'artnet',
        orientation: 'vertical',
      } satisfies MasterLevelWidget;
    }
    case 'sketch': {
      return {
        id, zIndex, kind: 'sketch',
        label: 'Sketch',
        rect: { ...DEFAULT_SKETCH_RECT },
        style: { ...DEFAULT_WIDGET_STYLE, foregroundColor: pal('#82c7cc') },
        outputProtocol: 'midi',
        mapping: null,
        feedbackRules: [],
        strokes: [],
        dots: 1,
        delay: 0.05,
        duration: 4,
        speed: 1,
        loop: true,
        showGrid: true,
      } satisfies SketchWidget;
    }
    case 'audioLevel': {
      return {
        id, zIndex, kind: 'audioLevel',
        label: 'Audio',
        rect: { ...DEFAULT_AUDIO_LEVEL_RECT },
        style: { ...DEFAULT_WIDGET_STYLE },
        outputProtocol: 'midi',
        mapping: null,
        feedbackRules: [],
        mode: 'out',
        deviceId: '',
        orientation: 'vertical',
      } satisfies AudioLevelWidget;
    }
    case 'etc': {
      return {
        id, zIndex, kind: 'etc',
        label: 'ETC',
        rect: { ...DEFAULT_ETC_RECT },
        style: { ...DEFAULT_WIDGET_STYLE, showLabel: false },
        outputProtocol: 'osc',
        mapping: null,
        feedbackRules: [],
        keyPrefix: '/eos/key',
        encoderAddress: '/eos/active/wheel/fine/{n}',
        ticksPerTurn: 100,
        acceleration: 0.4,
        faderAddresses: ['/eos/fader/0/1', '/eos/fader/0/2'],
        hideOsc: true,
        gmAddress: '/eos/fader/10/10',
      } satisfies EtcWidget;
    }
    case 'encoder': {
      return {
        id, zIndex, kind: 'encoder',
        label: 'Encoder',
        rect: { ...DEFAULT_ENCODER_RECT },
        style: { ...DEFAULT_WIDGET_STYLE, fontSize: 18 },
        outputProtocol: 'osc',
        mapping: null,
        feedbackRules: [],
        format: 'oscDelta',
        argType: 'f',
        step: 1,
        ticksPerTurn: 64,
        acceleration: 0.4,
        midiMode: 'offset64',
        encoders: ['Intensity', 'Pan', 'Tilt', 'Zoom'].map((label, i) => ({
          id: `${id}-e${i}`, label, address: `/eos/wheel/fine/${label.toLowerCase()}`, midiChannel: 1, midiCc: 20 + i,
        })),
      } satisfies EncoderWidget;
    }
    case 'shell': {
      return {
        id, zIndex, kind: 'shell',
        label: 'Shell',
        rect: { ...DEFAULT_SHELL_RECT },
        style: { ...DEFAULT_WIDGET_STYLE },
        outputProtocol: 'osc',
        mapping: null,
        feedbackRules: [],
        buttons: [{ id: `${id}-b0`, label: 'Turn off PC', action: 'shutdown', delay: 10 }],
      } satisfies ShellWidget;
    }
    case 'palette': {
      return {
        id, zIndex, kind: 'palette',
        label: 'Palette',
        rect: { ...DEFAULT_PALETTE_RECT },
        style: { ...DEFAULT_WIDGET_STYLE },
        outputProtocol: 'osc',
        mapping: null,
        feedbackRules: [],
        colors: ['#ff0000', '#ff8000', '#ffff00', '#00ff00', '#00ffff', '#0000ff', '#ff00ff', '#ffffff'],
        cols: 4,
        model: 'rgb',
      } satisfies PaletteWidget;
    }
    case 'merge': {
      return {
        id, zIndex, kind: 'merge',
        label: 'Merge',
        rect: { ...DEFAULT_MERGE_RECT },
        style: { ...DEFAULT_WIDGET_STYLE },
        outputProtocol: 'osc',
        mapping: null,
        feedbackRules: [],
        mode: 'ltp',
        every: 3,
        smooth: 0.5,
      } satisfies MergeWidget;
    }
    case 'keyboard': {
      return {
        id, zIndex, kind: 'keyboard',
        label: 'Keyboard',
        rect: { ...DEFAULT_KEYBOARD_RECT },
        style: { ...DEFAULT_WIDGET_STYLE, showValue: false },
        outputProtocol: 'midi',
        mapping: null,
        feedbackRules: [],
        // Starts empty: which keys you want is the whole point, so there is no
        // sensible default set to guess at.
        keys: [],
        countX: 4,
        spacingX: 6,
        spacingY: 6,
      } satisfies KeyboardWidget;
    }
    case 'dmxRecorder': {
      return {
        id, zIndex, kind: 'dmxRecorder',
        label: 'Recorder',
        rect: { ...DEFAULT_DMX_RECORDER_RECT },
        style: { ...DEFAULT_WIDGET_STYLE },
        outputProtocol: 'artnet',
        mapping: null,
        feedbackRules: [],
        universes: '',
      } satisfies DmxRecorderWidget;
    }
    case 'dmxPlayer': {
      return {
        id, zIndex, kind: 'dmxPlayer',
        label: 'Player',
        rect: { ...DEFAULT_DMX_PLAYER_RECT },
        style: { ...DEFAULT_WIDGET_STYLE },
        outputProtocol: 'artnet',
        mapping: null,
        feedbackRules: [],
        items: [],
        universeOffset: 0,
        playProtocol: 'artnet',
      } satisfies DmxPlayerWidget;
    }
    case 'dmxMonitor': {
      return {
        id, zIndex, kind: 'dmxMonitor',
        label: 'DMX Monitor',
        rect: { ...DEFAULT_DMX_MONITOR_RECT },
        style: { ...DEFAULT_WIDGET_STYLE },
        outputProtocol: 'artnet',
        mapping: null,
        feedbackRules: [],
        source: 'in',
        protocol: 'artnet',
        universe: 0,
        startChannel: 1,
        cols: 16,
        rows: 32,
      } satisfies DmxMonitorWidget;
    }
    case 'clock': {
      return {
        id, zIndex, kind: 'clock',
        label: 'Clock',
        rect: { ...DEFAULT_CLOCK_RECT },
        style: { ...DEFAULT_WIDGET_STYLE, foregroundColor: pal('#ff902f') },
        outputProtocol: 'midi',
        mapping: null,
        feedbackRules: [],
        alarms: [],
        showSeconds: true,
      } satisfies ClockWidget;
    }
    case 'manual': {
      return {
        id, zIndex, kind: 'manual',
        label: 'Manual',
        rect: { ...DEFAULT_MANUAL_RECT },
        style: { ...DEFAULT_WIDGET_STYLE },
        outputProtocol: 'midi',
        mapping: null,
        feedbackRules: [],
        openTab: 'project',
        fontScale: 1,
      } satisfies ManualWidget;
    }
    case 'instance': {
      return {
        id, zIndex, kind: 'instance',
        label: 'Instance',
        rect: { ...DEFAULT_INSTANCE_RECT },
        style: { ...DEFAULT_WIDGET_STYLE, backgroundColor: 'transparent' },
        outputProtocol: 'midi',
        mapping: null,
        feedbackRules: [],
        sourceWidgetId: '',
      } satisfies InstanceWidget;
    }
  }
}

// Count total cells used across all widgets to compute next free CC
export function nextFreeCc(widgets: Widget[]): number {
  return widgets.reduce((acc, w) => {
    if (w.kind === 'xyPad') return acc + 2 * (1 + (w.points?.length ?? 0)) + (w.zSlider ? 1 : 0);
    if (w.kind === 'imageWidget' || w.kind === 'textWidget') return acc;
    if (w.kind === 'stepSequencer' || w.kind === 'graphWidget') return acc + 1;
    if (w.kind === 'cues' || w.kind === 'timeline') return acc;
    if (w.kind === 'spoutInput' || w.kind === 'ndiInput') return acc;
    if (w.kind === 'submasters') return acc;
    if (w.kind === 'router') return acc;
    if (w.kind === 'autoBpm') return acc;
    if (w.kind === 'audioAnalyser') return acc;
    if (w.kind === 'soundPlayer') return acc;
    if (w.kind === 'valueDisplay') return acc;
    if (w.kind === 'masterLevel' || w.kind === 'audioLevel') return acc;
    if (w.kind === 'instance') return acc;
    if (w.kind === 'manual') return acc;
    if (w.kind === 'dmxRecorder' || w.kind === 'dmxPlayer' || w.kind === 'clock' || w.kind === 'dmxMonitor') return acc;
    if (w.kind === 'keyboard') return acc + w.keys.length;
    if (w.kind === 'lfoWidget' || w.kind === 'noiseWidget' || w.kind === 'mathWidget') return acc + 1;
    return 'countX' in w ? acc + w.countX * w.countY : acc;
  }, 0);
}
