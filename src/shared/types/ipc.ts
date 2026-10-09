import type { Project } from './project';
import type { OscFeedbackMessage, MidiPortInfo } from './runtime';

// ─── IPC Channel Registry ─────────────────────────────────────────────────────
//
// Convention:
//   'tr:domain:action'  — renderer → main (invoke/send)
//   'tr:domain:event'   — main → renderer (on)
//
// Every channel has an explicit request and response type.
// "void" response means fire-and-forget (ipcRenderer.send, not invoke).

export interface IpcChannels {
  // Project
  'tr:project:save':          { req: Project;                    res: { ok: boolean; path: string } };
  'tr:project:saveQuick':     { req: Project;                    res: { ok: boolean; path: string } };
  'tr:project:forget':        { req: void;                       res: void };
  'tr:project:load':          { req: void;                       res: Project | null };
  'tr:project:export':        { req: Project;                    res: { ok: boolean; path: string } };
  'tr:project:backup':        { req: Project;                    res: { ok: boolean; path: string } };
  // Crash recovery. autosave overwrites one rolling file; recoverRead returns it
  // with the time it was written; recoverClear drops it once the work is safe.
  'tr:project:autosave':      { req: Project;                    res: { ok: boolean } };
  'tr:project:recoverRead':   { req: void;                       res: { project: Project; savedAt: string } | null };
  'tr:project:openLast':      { req: void;                       res: { project: Project; path: string; from: 'saved' | 'autosave' } | null };
  'tr:project:recoverClear':  { req: void;                       res: { ok: boolean } };

  // Window
  'tr:window:fullscreen':     { req: boolean;                    res: void };

  // Files
  'tr:file:pickImage':        { req: void;                       res: string | null };
  'tr:file:pickAudio':        { req: void;                       res: { dataUrl: string; fileName: string } | null };

  // MIDI output
  'tr:midi:listPorts':        { req: void;                       res: MidiPortInfo[] };
  'tr:midi:openPort':         { req: { portName: string; virtual: boolean; extraOutputs?: Array<{ id: string; portName: string }> }; res: { ok: boolean } };
  'tr:midi:closePort':        { req: void;                       res: void };
  'tr:midi:sendCC':           { req: MidiCCPayload;              res: void };
  'tr:midi:sendNote':         { req: MidiNotePayload;            res: void };
  'tr:midi:sendPB':           { req: MidiPBPayload;              res: void };
  'tr:midi:clockStart':       { req: { bpm: number };            res: void };
  'tr:midi:clockStop':        { req: void;                       res: void };

  // MIDI input
  'tr:midi:listInputPorts':   { req: void;                       res: MidiPortInfo[] };
  'tr:midi:openInputPort':    { req: { portName: string; extraPorts?: string[] };       res: { ok: boolean } };
  'tr:midi:inputEvent':       { req: never;                      res: MidiInputEventPayload };
  'tr:midi:mtcFrame':         { req: never;                      res: MtcFramePayload };

  // OSC output
  'tr:osc:configure':         { req: OscConfigPayload;           res: { ok: boolean } };
  'tr:osc:disconnect':        { req: void;                       res: { ok: boolean } };
  'tr:osc:send':              { req: OscSendPayload;             res: void };

  // OSC feedback (main → renderer, event)
  'tr:osc:feedback':          { req: never;                      res: OscFeedbackMessage };

  // Sidecar stdout/stderr (main → renderer, event). In a packaged build the
  // sidecar's own output goes nowhere, so a user hitting "stream unavailable"
  // has no way to see WHY. Forward it into the in-app log instead.
  'tr:sidecar:log':           { req: never;                      res: { level: 'info' | 'error'; text: string } };

  // Art-Net
  'tr:artnet:configure':      { req: ArtNetConfigPayload;        res: { ok: boolean } };
  'tr:artnet:sendChannel':    { req: ArtNetChannelPayload;       res: void };
  'tr:artnet:sendUniverse':   { req: ArtNetUniversePayload;      res: void };
  // Art-Net INPUT (receive on UDP 6454)
  'tr:artnet:listen':         { req: { bindHost?: string; universes?: number[] }; res: { ok: boolean; error?: string } };
  'tr:artnet:stopListen':     { req: void;                       res: { ok: boolean } };
  'tr:sacn:listen':           { req: { bindHost?: string; universes?: number[] }; res: { ok: boolean; error?: string } };
  'tr:sacn:stopListen':       { req: void;                       res: { ok: boolean } };

  // DMX stream input (main → renderer, event). Shared by every DMX-over-IP
  // input — Art-Net now, sACN next — so consumers don't care which it was.
  'tr:dmxIn:frame':           { req: never;                      res: DmxInputPayload };
  'tr:dmxIn:status':          { req: never;                      res: DmxInputStatusPayload };

  // DMX stream recorder / player (takes live in Save/Recordings)
  'tr:dmxRec:start':          { req: { name?: string; universes?: number[]; protocol?: DmxRecSource }; res: { ok: boolean; takeId?: string; error?: string } };
  'tr:dmxRec:stop':           { req: void;                       res: { ok: boolean; take?: DmxTakeInfo } };
  'tr:dmxRec:list':           { req: void;                       res: DmxTakeInfo[] };
  'tr:dmxRec:rename':         { req: { takeId: string; name: string }; res: { ok: boolean } };
  'tr:dmxRec:delete':         { req: { takeId: string };         res: { ok: boolean } };
  'tr:dmxRec:getFolders':     { req: void;                       res: { record: string; play: string } };
  'tr:dmxRec:setFolders':     { req: { record?: string; play?: string }; res: { ok: boolean; error?: string; record: string; play: string } };
  'tr:dmxRec:pickFolder':     { req: { title?: string; current?: string }; res: string | null };
  'tr:dmxRec:openFolder':     { req: { which: 'record' | 'play' }; res: { ok: boolean } };
  'tr:dmxRec:status':         { req: never;                      res: DmxRecStatus };
  'tr:dmxPlay:play':          { req: { playerId: string; config: DmxPlayConfig; fromMs?: number }; res: { ok: boolean; error?: string } };
  'tr:dmxPlay:pause':         { req: { playerId: string };       res: { ok: boolean } };
  'tr:dmxPlay:stop':          { req: { playerId: string };       res: { ok: boolean } };
  'tr:dmxPlay:seek':          { req: { playerId: string; ms: number }; res: { ok: boolean } };
  'tr:dmxPlay:configure':     { req: { playerId: string; config: DmxPlayConfig }; res: { ok: boolean } };
  'tr:dmxPlay:status':        { req: never;                      res: DmxPlayStatus };

  // DMX monitor: watch one universe IN (optionally one sender) or OUT
  // (optionally one destination); frames arrive at ~20 Hz, only when changed.
  'tr:dmxMon:watch':          { req: DmxMonitorWatch | { watcherId: string; off: true }; res: { ok: boolean } };
  'tr:dmxMon:frame':          { req: never;                      res: { watcherId: string; data: number[] } };

  // sACN / E1.31
  'tr:sacn:configure':        { req: SacnConfigPayload;          res: { ok: boolean } };
  'tr:sacn:sendChannel':      { req: SacnChannelPayload;         res: void };
  'tr:sacn:sendUniverse':     { req: SacnUniversePayload;        res: void };

  // Enttec Open DMX USB
  'tr:enttec:listDevices':    { req: void;                       res: EnttecListDevicesRes };
  'tr:enttec:connect':        { req: { deviceIndex: number };    res: { ok: boolean; error?: string } };
  'tr:enttec:disconnect':     { req: void;                       res: { ok: boolean } };
  'tr:enttec:sendChannel':    { req: EnttecChannelPayload;       res: void };

  // Network Live server
  'tr:net:start':             { req: { port: number };           res: { ok: boolean; ip: string; port: number; error?: string } };
  'tr:net:stop':              { req: void;                       res: { ok: boolean } };
  'tr:net:getLocalIP':        { req: void;                       res: string };
  'tr:net:stateChange':       { req: NetStatePayload;            res: void };
  'tr:net:runtimePatch':      { req: { widgetId: string; cells: NetRuntimeCell[] }; res: void };
  'tr:net:switchPage':        { req: never;                      res: string };
  'tr:net:interact':          { req: never;                      res: NetInteractPayload };
}

// Utility types to extract req/res per channel
export type IpcReq<K extends keyof IpcChannels> = IpcChannels[K]['req'];
export type IpcRes<K extends keyof IpcChannels> = IpcChannels[K]['res'];

// ─── MIDI Payloads ────────────────────────────────────────────────────────────

export interface MidiInputEventPayload {
  channel: number;
  messageType: 'noteOn' | 'noteOff' | 'controlChange' | 'pitchBend' | 'programChange' | 'aftertouch';
  number: number;    // note or CC number 0–127
  value: number;     // velocity or CC value 0–127
}

export interface MtcFramePayload {
  h: number;    // hours
  m: number;    // minutes
  s: number;    // seconds
  f: number;    // frames
  fps: number;  // frame rate (24 | 25 | 29.97 | 30)
}

export interface MidiCCPayload {
  channel: number;   // 1–16
  cc: number;        // 0–127
  value: number;     // 0–127
  outputId?: string;
}

export interface MidiNotePayload {
  channel: number;
  note: number;      // 0–127
  velocity: number;  // 0–127
  on: boolean;
  outputId?: string;
}

export interface MidiPBPayload {
  channel: number;
  value: number;     // 0–16383
  outputId?: string;
}

// ─── OSC Payloads ─────────────────────────────────────────────────────────────

export interface OscConfigPayload {
  targetHost: string;
  targetPort: number;
  listenPort: number;
  outputs?: Array<{ id: string; host: string; port: number }>;
  extraListenPorts?: number[];
}

export interface OscSendPayload {
  address: string;
  args: Array<{ type: 'f' | 'i' | 's'; value: number | string }>;
  outputId?: string;
}

// ─── Art-Net Payloads ─────────────────────────────────────────────────────────

export type DmxInputProtocol = 'artnet' | 'sacn';

export interface DmxTakeInfo {
  id: string;
  name: string;
  createdAt: number;     // ms epoch
  durationMs: number;
  universes: number[];
  bytes: number;
  protocol: DmxInputProtocol;
  source?: DmxRecSource;  // what it was recorded from
}

// What the DMX recorder records: an input, or what LiveForge itself sends.
export type DmxRecSource = 'artnet' | 'sacn' | 'out-artnet' | 'out-sacn' | 'out-enttec';

export interface DmxRecStatus {
  recording: boolean;
  takeId: string | null;  // the take being recorded, or the one just finished
  name: string;
  elapsedMs: number;
  bytes: number;
  universes: number[];
}

export interface DmxMonitorWatch {
  watcherId: string;
  direction: 'in' | 'out';
  protocol: 'artnet' | 'sacn';
  universe: number;
  sourceIp?: string;     // in: only this sender ('' / undefined = everyone)
  outputId?: string;     // out: only this destination (undefined = all merged)
}

export interface DmxPlayConfig {
  takeId: string;
  loop: boolean;
  universeOffset: number;          // added to every recorded universe on output
  protocol: 'artnet' | 'sacn';
  outputId?: string;
  fadeMs?: number;                 // crossfade from what this player had on output
}

export interface DmxPlayStatus {
  playerId: string;
  takeId: string;
  playing: boolean;
  positionMs: number;
  durationMs: number;
  ended?: boolean;                 // reached the end by itself (not stopped)
}

// Channels that changed since the last batch, per universe. `pairs` is flat:
// [ch, value, ch, value, …] with ch 1–512 and value 0–255. `first` marks the
// first batch heard from that universe since listening started.
export interface DmxInputPayload {
  protocol: DmxInputProtocol;
  universes: Array<{ universe: number; first: boolean; pairs: number[] }>;
}

export interface DmxInputStatusPayload {
  protocol: DmxInputProtocol;
  listening: boolean;
  packetsPerSec: number;
  universes: number[];
  sources: string[];   // sender IPs heard in the last second
  // Diagnostics, so "nothing arriving" can say WHERE it stops.
  error?: string;          // why listening failed (port taken…)
  bound?: string;          // address:port actually bound
  otherPerSec?: number;    // UDP on 6454 that was not ArtDmx (polls, replies, other opcodes)
  ownPerSec?: number;      // ArtDmx from our own output, ignored
  polls?: string[];        // who sent ArtPoll in the last second (we answered)
  names?: string[];        // sACN source names heard in the last second
}

export interface ArtNetConfigPayload {
  outputs: Array<{ id: string; host: string }>;
}

export interface ArtNetChannelPayload {
  universe: number;  // 0–32767
  channel: number;   // 1–512
  value: number;     // 0–255
  outputId?: string;
}

// Full universe update — more efficient than per-channel when many channels change at once
export interface ArtNetUniversePayload {
  universe: number;
  // Sparse map: channel (1-based) → value (0–255)
  // Channels not listed keep their last value
  channels: Record<number, number>;
  outputId?: string;
}

// ─── sACN Payloads ────────────────────────────────────────────────────────────

export interface SacnConfigPayload {
  priority: number;
  // Each output: host present = unicast to it, host absent = multicast (per universe).
  outputs: Array<{ id: string; host?: string }>;
}

export interface SacnChannelPayload {
  universe: number;  // 1–63999
  channel: number;   // 1–512
  value: number;     // 0–255
  priority?: number; // overrides connection default if set
  outputId?: string;
}

export interface SacnUniversePayload {
  universe: number;
  channels: Record<number, number>;
  priority?: number;
  outputId?: string;
}

// ─── Enttec Open DMX USB Payloads ─────────────────────────────────────────────

export interface EnttecDeviceInfoPayload {
  index: number;
  description: string;
  serialNumber: string;
}

export interface EnttecListDevicesRes {
  ok: boolean;
  devices: EnttecDeviceInfoPayload[];
  error?: string;
}

export interface EnttecChannelPayload {
  channel: number;  // 1–512
  value: number;    // 0–255
}

// ─── Network Live Payloads ────────────────────────────────────────────────────

export interface NetRuntimeCell {
  value: number;
  active: boolean;
}

// Exact on-screen placement of the page canvas, measured in the renderer (window
// CSS px). Lets the browser client map click coords precisely regardless of the
// live sidebar being open or a page live-offset — no guessing the transform.
export interface NetPageRect {
  x: number;      // window CSS px of page origin (0,0), incl. sidebar + liveOffset
  y: number;      // window CSS px of page origin, incl. global bar + liveOffset
  scale: number;  // page px → window CSS px
}

export interface NetStatePayload {
  pages: import('./project').Page[];
  activePageId: string;
  runtimeWidgets: Record<string, { cells: NetRuntimeCell[] }>;
  dpr?: number; // renderer window.devicePixelRatio — used by main for capturePage() crop
  pageRect?: NetPageRect;
}

export interface NetInteractPayload {
  widgetId: string;
  cellIndex: number;
  value: number;      // 0–1
  active?: boolean;   // for button widgets
}
