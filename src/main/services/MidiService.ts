import midi from '@julusian/midi';
import type { MidiPortInfo } from '../../shared/types/runtime';
import type { MidiInputEventPayload, MtcFramePayload } from '../../shared/types/ipc';

// RtMidi puts the port's INDEX on the end of its name: "iCON iControls 1",
// "MIDIIN2 (iCON iControls) 2". So the name a project saves is not a stable
// identifier — plug or unplug any other MIDI device and the ports renumber,
// and the saved string now names a different physical port. A device that
// offers two ports (one that carries the surface, one that does not) would
// silently come back on the wrong one. Matching ignores that trailing number,
// which is the only part that moves; the rest of the name is what identifies
// the port.
function portBaseName(name: string): string {
  return name.replace(/\s+\d+$/, '').trim();
}

function findPort<T extends { name: string }>(ports: T[], wanted: string): T | undefined {
  const exact = ports.find((p) => p.name === wanted);
  if (exact) return exact;
  const base = portBaseName(wanted);
  if (!base) return undefined;
  return ports.find((p) => portBaseName(p.name) === base);
}

export class MidiService {
  private output = new midi.Output();          // primary output ('primary')
  private input  = new midi.Input();
  private extraOutputs = new Map<string, midi.Output>();  // id → additional named output port
  private extraInputs:  midi.Input[]  = [];   // additional MIDI input ports
  private inputCallback: ((evt: MidiInputEventPayload) => void) | null = null;
  private mtcCallback:   ((frame: MtcFramePayload) => void) | null = null;
  private clockTimer: NodeJS.Timeout | null = null;

  // MTC quarter-frame assembly state
  private mtcPieces: number[] = new Array(8).fill(0);
  private mtcCount = 0;

  constructor() {
    this.input.ignoreTypes(false, true, true); // receive SysEx, skip timing/activeSensing

    this.input.on('message', (_delta, msg) => {
      const status = msg[0];

      // Universal Device Identity Request → reply as APC Mini
      // F0 7E <any> 06 01 F7
      if (status === 0xf0 && msg.length === 6 && msg[1] === 0x7e && msg[3] === 0x06 && msg[4] === 0x01 && msg[5] === 0xf7) {
        this.replyApcMiniIdentity();
        return;
      }

      // MTC Quarter Frame (0xF1)
      if (status === 0xf1 && msg[1] !== undefined) {
        this.parseMtcQF(msg[1]);
        return;
      }

      this.routeInput(msg);
    });
  }

  // Parse a channel-voice message and forward it to the input callback. Shared by
  // the primary input and every extra input port so they merge into one stream.
  private routeInput(msg: number[]): void {
    if (!this.inputCallback) return;
    const status  = msg[0];
    const data1   = msg[1] ?? 0;
    const data2   = msg[2] ?? 0;
    const ch      = (status & 0x0f) + 1;
    const nibble  = status & 0xf0;

    let messageType: MidiInputEventPayload['messageType'];
    if      (nibble === 0x90) messageType = data2 > 0 ? 'noteOn' : 'noteOff';
    else if (nibble === 0x80) messageType = 'noteOff';
    else if (nibble === 0xb0) messageType = 'controlChange';
    else if (nibble === 0xe0) messageType = 'pitchBend';
    else if (nibble === 0xc0) messageType = 'programChange';
    else if (nibble === 0xa0) messageType = 'aftertouch';
    else return;

    this.inputCallback({ channel: ch, messageType, number: data1, value: data2 });
  }

  private parseMtcQF(data: number): void {
    const msgNum = (data >> 4) & 0x07;
    const nibble = data & 0x0f;

    this.mtcPieces[msgNum] = nibble;
    this.mtcCount++;

    // Emit a frame after every 8 quarter-frames (msgs 0–7 received)
    if (this.mtcCount >= 8 && msgNum === 7) {
      const f = (this.mtcPieces[0] | (this.mtcPieces[1] << 4)) & 0x1f;
      const s = (this.mtcPieces[2] | (this.mtcPieces[3] << 4)) & 0x3f;
      const m = (this.mtcPieces[4] | (this.mtcPieces[5] << 4)) & 0x3f;
      const hRate = (this.mtcPieces[6] | (this.mtcPieces[7] << 4));
      const h   = hRate & 0x1f;
      const rateCode = (hRate >> 5) & 0x03;
      const fps = rateCode === 0 ? 24 : rateCode === 1 ? 25 : rateCode === 2 ? 29.97 : 30;
      if (this.mtcCallback) this.mtcCallback({ h, m, s, f, fps });
      this.mtcCount = 0;
    }
  }

  onMtcFrame(cb: (frame: MtcFramePayload) => void): void {
    this.mtcCallback = cb;
  }

  private replyApcMiniIdentity(): void {
    try {
      // Universal Identity Reply — Akai APC Mini mk1
      // F0 7E 00 06 02  <mfr:47>  <family:28 00>  <member:19 00>  <ver:00 00 00 00>  F7
      this.output.sendMessage([
        0xf0, 0x7e, 0x00, 0x06, 0x02,
        0x47,             // Akai Professional
        0x28, 0x00,       // APC Mini family
        0x19, 0x00,       // device member
        0x00, 0x00, 0x00, 0x00, // firmware version
        0xf7,
      ]);
    } catch (err) {
      console.error('[MidiService] SysEx identity reply failed:', err);
    }
  }

  // ─── Output ──────────────────────────────────────────────────────────────────

  listPorts(): MidiPortInfo[] {
    const count = this.output.getPortCount();
    return Array.from({ length: count }, (_, i) => ({
      index: i,
      name: this.output.getPortName(i),
    }));
  }

  openPort(portName: string, virtual: boolean, extraOutputs: Array<{ id: string; portName: string }> = []): { ok: boolean } {
    try {
      this.closeExtraOutputs();
      this.output.closePort();
      if (virtual) {
        this.output.openVirtualPort(portName);
      } else {
        const match = findPort(this.listPorts(), portName);
        if (!match) return { ok: false };
        this.output.openPort(match.index);
      }
      // Additional named output ports (by name).
      const ports = this.listPorts();
      for (const o of extraOutputs) {
        const trimmed = (o.portName ?? '').trim();
        if (!trimmed) continue;
        const m = findPort(ports, trimmed);
        if (!m) continue;
        const out = new midi.Output();
        try { out.openPort(m.index); this.extraOutputs.set(o.id, out); }
        catch { try { out.closePort(); } catch { /* */ } }
      }
      return { ok: true };
    } catch {
      return { ok: false };
    }
  }

  private closeExtraOutputs(): void {
    for (const out of this.extraOutputs.values()) { try { out.closePort(); } catch { /* */ } }
    this.extraOutputs.clear();
  }

  // Resolve an outputId to a specific output port (primary when unset/unknown).
  private resolveOut(outputId: string | undefined): midi.Output {
    if (outputId && outputId !== 'primary') {
      const out = this.extraOutputs.get(outputId);
      if (out) return out;
    }
    return this.output;
  }

  private sendTo(outputId: string | undefined, bytes: number[]): void {
    try { this.resolveOut(outputId).sendMessage(bytes); }
    catch (err) { console.error('[MidiService] send failed:', err); }
  }

  // Send a raw MIDI message to the primary output and every extra output (for clock sync).
  private sendAll(bytes: number[]): void {
    try { this.output.sendMessage(bytes); } catch { /* port closed */ }
    for (const out of this.extraOutputs.values()) { try { out.sendMessage(bytes); } catch { /* port closed */ } }
  }

  closePort(): void {
    this.output.closePort();
    this.closeExtraOutputs();
  }

  sendCC(channel: number, cc: number, value: number, outputId?: string): void {
    this.sendTo(outputId, [0xb0 | (channel - 1), cc, value]);
  }

  sendNote(channel: number, note: number, velocity: number, on: boolean, outputId?: string): void {
    this.sendTo(outputId, [(on ? 0x90 : 0x80) | (channel - 1), note, velocity]);
  }

  sendPitchBend(channel: number, value: number, outputId?: string): void {
    this.sendTo(outputId, [0xe0 | (channel - 1), value & 0x7f, (value >> 7) & 0x7f]);
  }

  startClock(bpm: number): void {
    this.stopClock();
    const intervalMs = 60000 / (bpm * 24);
    this.clockTimer = setInterval(() => {
      this.sendAll([0xf8]);
    }, intervalMs);
  }

  stopClock(): void {
    if (this.clockTimer !== null) {
      clearInterval(this.clockTimer);
      this.clockTimer = null;
    }
  }

  // ─── Input ───────────────────────────────────────────────────────────────────

  listInputPorts(): MidiPortInfo[] {
    const count = this.input.getPortCount();
    return Array.from({ length: count }, (_, i) => ({
      index: i,
      name: this.input.getPortName(i),
    }));
  }

  openInputPort(portName: string, extraPorts: string[] = []): { ok: boolean } {
    try {
      this.closeExtraInputs();
      this.input.closePort();
      const match = findPort(this.listInputPorts(), portName);
      if (!match) return { ok: false };
      this.input.openPort(match.index);
      // Additional input ports: forward only channel-voice messages (MTC/SysEx
      // stay on the primary port to avoid double-parsing from multiple sources).
      const ports = this.listInputPorts();
      for (const name of extraPorts) {
        const trimmed = (name ?? '').trim();
        if (!trimmed || trimmed === portName) continue;
        const m = findPort(ports, trimmed);
        if (!m) continue;
        const inp = new midi.Input();
        try {
          inp.on('message', (_d, msg) => this.routeInput(msg));
          inp.openPort(m.index);
          this.extraInputs.push(inp);
        } catch { try { inp.closePort(); } catch { /* */ } }
      }
      return { ok: true };
    } catch {
      return { ok: false };
    }
  }

  private closeExtraInputs(): void {
    for (const inp of this.extraInputs) { try { inp.closePort(); } catch { /* */ } }
    this.extraInputs = [];
  }

  onInputMessage(cb: (evt: MidiInputEventPayload) => void): void {
    this.inputCallback = cb;
  }
}
