import type { WidgetKind } from '../../shared/types/project';
import type { StateCreator } from 'zustand';
import type { StoreState } from './index';
import type { AutoBpmConfig } from '../audio/AutoBpmService';
import { DEFAULT_AUTO_BPM_CONFIG } from '../audio/BpmDetectorEngine';

export type AppMode = 'design' | 'live';
export type BpmMode = 'tap' | 'auto';

export interface AutoBpmStatus {
  locked: boolean;
  confidence: number;
  rawBpm: number;
  beatPhase: number;
  onsetStrength: number;
  dropArmed: boolean;
}

export interface MidiLearnTarget {
  pageId: string;
  widgetId: string;
  cellIndex: number;
  mappingKey?: string;  // 'mapping' | 'triggerMapping' | 'rampMapping' etc.
  protocol?: 'midi' | 'osc' | 'artnet' | 'sacn';  // defaults to 'midi' when absent
  routerId?: string;    // router the learned row goes into; picked before learning
}

// Learn mode: instead of right-clicking a single cell, arm the whole UI. Tap a
// cell to select it, move the physical control to bind it, repeat. Stays on
// until you switch it off, so a whole desk can be patched in one pass.
export type LearnMode = 'midi' | 'osc' | 'artnet' | null;

export type LogLevel = 'info' | 'warn' | 'error';
export interface LogEntry {
  id: string;
  level: LogLevel;
  message: string;
  time: number;   // Date.now()
}
const LOG_CAP = 500;

export interface AppSlice {
  mode: AppMode;
  activePageId: string | null;
  selectedWidgetId: string | null;
  selectedWidgetIds: string[];
  isWidgetPickerOpen: boolean;
  isSettingsOpen: boolean;
  isLocked: boolean;
  masterBpm: number;
  tapTimes: number[];
  isGlobalPlaying: boolean;
  globalResetTick: number;
  globalPlayTick: number;
  globalStopTick: number;
  connectedProtocols: Record<string, boolean>;

  // MIDI Clock
  midiClockEnabled: boolean;

  // MIDI Learn
  midiLearnTarget: MidiLearnTarget | null;
  learnMode: LearnMode;
  // Router chosen when learn mode was switched on: every cell patched in this
  // session lands in it, so a whole pass ends up in one readable router.
  learnRouterId: string | null;

  // Live sidebar
  liveSidebarOpen: boolean;
  routerPageOpen: boolean;
  // Widget picked in the menu, waiting for a click on the canvas to be placed.
  placingKind: WidgetKind | null;
  liveSelectedWidgetId: string | null;

  // Auto BPM
  bpmMode: BpmMode;
  autoBpmConfig: AutoBpmConfig;
  autoBpmStatus: AutoBpmStatus;
  autoBpmAudioDeviceId: string | null;
  autoBpmError: string | null;

  // Network Live
  networkEnabled: boolean;
  networkPort: number;
  networkLocalIP: string;

  // Log console
  logEntries: LogEntry[];
  logOpen: boolean;
  unseenErrors: number;
  addLog: (level: LogLevel, message: string) => void;
  clearLog: () => void;
  setLogOpen: (open: boolean) => void;

  // Hovered widget/cell description (shown in a bottom info bar)
  hoverInfo: string | null;
  setHoverInfo: (info: string | null) => void;

  setMode: (mode: AppMode) => void;
  setActivePageId: (id: string) => void;
  setSelectedWidgetId: (id: string | null) => void;
  toggleWidgetSelection: (id: string) => void;
  clearMultiSelection: () => void;
  openWidgetPicker: () => void;
  closeWidgetPicker: () => void;
  openSettings: () => void;
  closeSettings: () => void;
  toggleLock: () => void;
  setMasterBpm: (bpm: number) => void;
  triggerTap: () => void;
  setGlobalPlaying: (playing: boolean) => void;
  triggerGlobalReset: () => void;
  triggerGlobalPlay: () => void;
  triggerGlobalStop: () => void;
  setConnectedProtocol: (key: string, connected: boolean) => void;
  setMidiClockEnabled: (enabled: boolean) => void;
  setMidiLearnTarget: (target: MidiLearnTarget | null) => void;
  setLearnMode: (mode: LearnMode, routerId?: string | null) => void;
  setLiveSidebarOpen: (open: boolean) => void;
  setRouterPageOpen: (open: boolean) => void;
  setPlacingKind: (kind: WidgetKind | null) => void;
  setLiveSelectedWidgetId: (id: string | null) => void;

  setBpmMode: (mode: BpmMode) => void;
  setAutoBpmConfig: (patch: Partial<AutoBpmConfig>) => void;
  setAutoBpmStatus: (status: AutoBpmStatus) => void;
  setAutoBpmAudioDeviceId: (id: string | null) => void;
  setAutoBpmError: (err: string | null) => void;

  setNetworkEnabled: (enabled: boolean) => void;
  setNetworkPort: (port: number) => void;
  setNetworkLocalIP: (ip: string) => void;
}

export const createAppSlice: StateCreator<StoreState, [['zustand/immer', never]], [], AppSlice> = (set) => ({
  mode: 'design',
  activePageId: null,
  selectedWidgetId: null,
  selectedWidgetIds: [],
  isWidgetPickerOpen: false,
  isSettingsOpen: false,
  isLocked: false,
  masterBpm: 120,
  tapTimes: [],
  isGlobalPlaying: false,
  globalResetTick: 0,
  globalPlayTick: 0,
  globalStopTick: 0,
  connectedProtocols: {},
  midiClockEnabled: false,
  midiLearnTarget: null,
  learnMode: null,
  learnRouterId: null,
  liveSidebarOpen: false,
  routerPageOpen: false,
  placingKind: null,
  liveSelectedWidgetId: null,

  bpmMode: 'tap',
  autoBpmConfig: { ...DEFAULT_AUTO_BPM_CONFIG },
  autoBpmStatus: { locked: false, confidence: 0, rawBpm: 0, beatPhase: 0, onsetStrength: 0, dropArmed: false },
  autoBpmAudioDeviceId: null,
  autoBpmError: null,

  networkEnabled: false,
  networkPort: 3456,
  networkLocalIP: '',

  logEntries: [],
  logOpen: false,
  unseenErrors: 0,
  addLog: (level, message) => set((s) => {
    s.logEntries.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, level, message, time: Date.now() });
    if (s.logEntries.length > LOG_CAP) s.logEntries.splice(0, s.logEntries.length - LOG_CAP);
    if (level === 'error' && !s.logOpen) s.unseenErrors += 1;
  }),
  clearLog: () => set((s) => { s.logEntries = []; s.unseenErrors = 0; }),
  setLogOpen: (open) => set((s) => { s.logOpen = open; if (open) s.unseenErrors = 0; }),

  hoverInfo: null,
  setHoverInfo: (info) => set((s) => { if (s.hoverInfo !== info) s.hoverInfo = info; }),

  setMode: (mode) => set((s) => { s.mode = mode; }),
  setActivePageId: (id) => set((s) => { s.activePageId = id; s.selectedWidgetId = null; s.selectedWidgetIds = []; }),
  setSelectedWidgetId: (id) => set((s) => {
    s.selectedWidgetId = id;
    s.selectedWidgetIds = [];
    if (id) s.isSettingsOpen = false;
  }),
  toggleWidgetSelection: (id) => set((s) => {
    const idx = s.selectedWidgetIds.indexOf(id);
    if (idx >= 0) s.selectedWidgetIds.splice(idx, 1);
    else s.selectedWidgetIds.push(id);
    if (s.selectedWidgetIds.length > 0) s.selectedWidgetId = null;
  }),
  clearMultiSelection: () => set((s) => { s.selectedWidgetIds = []; }),
  openWidgetPicker: () => set((s) => { s.isWidgetPickerOpen = true; }),
  closeWidgetPicker: () => set((s) => { s.isWidgetPickerOpen = false; }),
  openSettings: () => set((s) => { s.isSettingsOpen = true; s.selectedWidgetId = null; }),
  closeSettings: () => set((s) => { s.isSettingsOpen = false; }),
  toggleLock: () => set((s) => { s.isLocked = !s.isLocked; }),
  setMasterBpm: (bpm) => set((s) => { s.masterBpm = Math.max(20, Math.min(300, bpm)); }),
  triggerTap: () => set((s) => {
    const now = performance.now();
    s.tapTimes.push(now);
    if (s.tapTimes.length > 4) s.tapTimes.shift();
    if (s.tapTimes.length >= 2) {
      let sum = 0;
      for (let i = 1; i < s.tapTimes.length; i++) sum += s.tapTimes[i] - s.tapTimes[i - 1];
      s.masterBpm = Math.min(300, Math.max(20, Math.round(60000 / (sum / (s.tapTimes.length - 1)))));
    }
  }),
  setGlobalPlaying: (playing) => set((s) => { s.isGlobalPlaying = playing; }),
  triggerGlobalReset: () => set((s) => { s.globalResetTick += 1; s.tapTimes = []; }),
  triggerGlobalPlay:  () => set((s) => { s.globalPlayTick  += 1; s.isGlobalPlaying = true; }),
  triggerGlobalStop:  () => set((s) => { s.globalStopTick  += 1; s.isGlobalPlaying = false; }),
  setConnectedProtocol: (key, connected) => set((s) => {
    if (connected) s.connectedProtocols[key] = true;
    else delete s.connectedProtocols[key];
  }),

  setBpmMode: (mode) => set((s) => { s.bpmMode = mode; }),
  setAutoBpmConfig: (patch) => set((s) => { Object.assign(s.autoBpmConfig, patch); }),
  setAutoBpmStatus: (status) => set((s) => { s.autoBpmStatus = status; }),
  setAutoBpmAudioDeviceId: (id) => set((s) => { s.autoBpmAudioDeviceId = id; }),
  setAutoBpmError: (err) => set((s) => { s.autoBpmError = err; }),

  setNetworkEnabled: (enabled) => set((s) => { s.networkEnabled = enabled; }),
  setNetworkPort: (port) => set((s) => { s.networkPort = port; }),
  setNetworkLocalIP: (ip) => set((s) => { s.networkLocalIP = ip; }),

  setMidiClockEnabled: (enabled) => set((s) => { s.midiClockEnabled = enabled; }),
  setMidiLearnTarget: (target) => set((s) => { s.midiLearnTarget = target; }),
  // Leaving learn mode also disarms whatever cell was waiting, so a stray CC
  // arriving afterwards cannot bind something you already stopped patching.
  setLearnMode: (mode, routerId) => set((s) => {
    s.learnMode = mode;
    if (mode === null) { s.midiLearnTarget = null; s.learnRouterId = null; return; }
    if (routerId !== undefined) s.learnRouterId = routerId;
    if (s.midiLearnTarget) s.midiLearnTarget = { ...s.midiLearnTarget, protocol: mode };
  }),
  setLiveSidebarOpen: (open) => set((s) => { s.liveSidebarOpen = open; }),
  setRouterPageOpen: (open) => set((s) => { s.routerPageOpen = open; }),
  setPlacingKind: (kind) => set((s) => { s.placingKind = kind; }),
  setLiveSelectedWidgetId: (id) => set((s) => { s.liveSelectedWidgetId = id; }),
});
