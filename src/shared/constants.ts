import type { WidgetStyle } from './types/project';

export const SCHEMA_VERSION = 1;

export const CANVAS_DEFAULT_WIDTH  = 1920;
export const CANVAS_DEFAULT_HEIGHT = 1030;

export const GRID_SNAP_PX = 8;

export const DEFAULT_WIDGET_STYLE: WidgetStyle = {
  backgroundColor: '#080808',
  foregroundColor: '#e0e0e0',
  labelColor:      '#ffffff',
  borderRadius:    2,
  fontSize:        23,
  showLabel:       true,
};

export const DEFAULT_SLIDER_RECT     = { x: 0, y: 0, width: 640, height: 200 };
export const DEFAULT_BUTTON_RECT     = { x: 0, y: 0, width: 300, height: 200 };
export const DEFAULT_KNOB_RECT       = { x: 0, y: 0, width: 280, height: 160 };
export const DEFAULT_XYPAD_RECT      = { x: 0, y: 0, width: 300, height: 300 };
export const DEFAULT_IMAGE_RECT      = { x: 0, y: 0, width: 400, height: 300 };
export const DEFAULT_TEXT_RECT       = { x: 0, y: 0, width: 300, height: 80  };
export const DEFAULT_SEQUENCER_RECT  = { x: 0, y: 0, width: 640, height: 180 };
export const DEFAULT_GRAPH_RECT      = { x: 0, y: 0, width: 480, height: 240 };
export const DEFAULT_CUES_RECT       = { x: 0, y: 0, width: 320, height: 300 };
export const DEFAULT_TIMELINE_RECT   = { x: 0, y: 0, width: 900, height: 400 };
export const DEFAULT_SPOUT_RECT      = { x: 0, y: 0, width: 480, height: 270 };
export const DEFAULT_NDI_RECT        = { x: 0, y: 0, width: 480, height: 270 };
export const DEFAULT_SUBMASTERS_RECT = { x: 0, y: 0, width: 640, height: 280 };
export const DEFAULT_ROUTER_RECT     = { x: 0, y: 0, width: 380, height: 220 };
export const DEFAULT_AUTO_BPM_RECT        = { x: 0, y: 0, width: 280, height: 300 };
export const DEFAULT_AUDIO_ANALYSER_RECT  = { x: 0, y: 0, width: 300, height: 320 };
export const DEFAULT_SOUND_PLAYER_RECT    = { x: 0, y: 0, width: 340, height: 360 };
export const DEFAULT_LFO_RECT            = { x: 0, y: 0, width: 240, height: 180 };
export const DEFAULT_MATH_RECT           = { x: 0, y: 0, width: 260, height: 200 };
export const DEFAULT_VALUE_DISPLAY_RECT  = { x: 0, y: 0, width: 200, height: 120 };
export const DEFAULT_MASTER_LEVEL_RECT   = { x: 0, y: 0, width: 130, height: 340 };
export const DEFAULT_SKETCH_RECT         = { x: 0, y: 0, width: 420, height: 320 };
export const DEFAULT_AUDIO_LEVEL_RECT    = { x: 0, y: 0, width: 130, height: 340 };
export const DEFAULT_INSTANCE_RECT       = { x: 0, y: 0, width: 200, height: 200 };
export const DEFAULT_KEYBOARD_RECT       = { x: 0, y: 0, width: 420, height: 180 };
export const DEFAULT_DMX_RECORDER_RECT   = { x: 0, y: 0, width: 260, height: 170 };
export const DEFAULT_DMX_PLAYER_RECT     = { x: 0, y: 0, width: 360, height: 170 };
export const DEFAULT_CLOCK_RECT          = { x: 0, y: 0, width: 420, height: 260 };
export const DEFAULT_DMX_MONITOR_RECT    = { x: 0, y: 0, width: 480, height: 980 };
// Big by default — it carries two rows of tabs and a body of text.
export const DEFAULT_MANUAL_RECT         = { x: 0, y: 0, width: 900, height: 560 };

export const MIDI_VALUE_MIN  = 0;
export const MIDI_VALUE_MAX  = 127;
export const MIDI_PB_MAX     = 16383;
export const MIDI_CHANNEL_MIN = 1;
export const MIDI_CHANNEL_MAX = 16;
