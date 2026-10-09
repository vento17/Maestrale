import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import type { DmxTakeInfo, DmxRecStatus, DmxPlayStatus, DmxPlayConfig, DmxRecSource } from '../../shared/types/ipc';

// DMX stream recorder + player.
//
// Recording happens HERE, in the main process, straight off the Art-Net
// receiver: the timestamps are the packet arrival times, not whenever the
// renderer got round to it, and a busy UI cannot make a take stutter.
//
// File format (.lfdmx), little-endian:
//   0     8 bytes  magic "LFDMX1\0\0"
//   8     uint32   header JSON length
//   12    4084     header JSON, space-padded (rewritten in place on stop)
//   4096  records…
// record: uint8 type (1 = delta, 2 = keyframe) · uint32 t (ms from start) ·
//         uint16 universe · uint16 n · payload
//   delta    : n × (uint16 channel 1–512, uint8 value)
//   keyframe : n bytes, channels 1…n
// A keyframe of every universe is written at t=0 (the state when REC was hit)
// and every KEYFRAME_MS after, so seeking never has to replay from the top.

const MAGIC = Buffer.from('LFDMX1\0\0', 'binary');
const HEADER_SIZE = 4096;
const KEYFRAME_MS = 2000;
const FLUSH_MS = 250;
const PLAY_TICK_MS = 5;

interface Event { t: number; universe: number; key: boolean; ch: Uint16Array; val: Uint8Array }

export interface DmxSink {
  send(protocol: 'artnet' | 'sacn', outputId: string | undefined, universe: number, channels: Record<number, number>): void;
}

export class DmxTakeService {
  private dir: string;
  // ── recording ──
  private rec: {
    id: string; name: string; fd: number; start: number; universes: Set<number> | null;
    last: Map<number, Uint8Array>; lastKey: number; pending: Buffer[]; bytes: number; events: number;
    offset: number;   // where the next record goes — positioned writes never move the file pointer
    seen: Set<number>;
  } | null = null;
  private recFlush: NodeJS.Timeout | null = null;
  private recStatusTimer: NodeJS.Timeout | null = null;
  // ── playback ──
  private players = new Map<string, Player>();
  // What each player last put on output (output universe → 512 ch), so a new
  // item can crossfade from it.
  private sent = new Map<string, Map<number, Uint8Array>>();

  constructor(
    baseDir: string,
    private currentFrames: (source: DmxRecSource) => Map<number, Uint8Array>,
    private sink: DmxSink,
    private emitRec: (s: DmxRecStatus) => void,
    private emitPlay: (s: DmxPlayStatus) => void,
  ) {
    this.dir = path.join(baseDir, 'Recordings');
    this.playDir = this.dir;
  }

  // Where REC writes, and where the Player looks (Settings → DMX recordings).
  // The player also sees what was just recorded, so a take is playable at once
  // even when the two folders differ.
  private playDir: string;
  private extraDirs: string[] = [];
  private index = new Map<string, string>();      // take id → file

  folders(): { record: string; play: string } { return { record: this.dir, play: this.playDir }; }
  setFolders(record: string, play: string, extra: string[] = []): void {
    this.dir = record;
    this.playDir = play;
    this.extraDirs = extra;
  }

  // ─── Takes on disk ──────────────────────────────────────────────────────────

  list(): DmxTakeInfo[] {
    const out: DmxTakeInfo[] = [];
    this.index.clear();
    for (const dir of [...new Set([this.playDir, this.dir, ...this.extraDirs])]) {
      if (!fs.existsSync(dir)) continue;
      for (const f of fs.readdirSync(dir)) {
        if (!f.endsWith('.lfdmx')) continue;
        const file = path.join(dir, f);
        const info = readHeader(file);
        if (!info || this.index.has(info.id)) continue;
        this.index.set(info.id, file);
        out.push(info);
      }
    }
    return out.sort((a, b) => b.createdAt - a.createdAt);
  }

  rename(takeId: string, name: string): boolean {
    const file = this.fileOf(takeId);
    const info = readHeader(file);
    if (!info) return false;
    writeHeader(file, { ...info, name: name.trim() || info.name });
    return true;
  }

  delete(takeId: string): boolean {
    if (this.rec?.id === takeId) return false;
    for (const p of this.players.values()) if (p.takeId === takeId) p.stop();
    try { fs.unlinkSync(this.fileOf(takeId)); return true; } catch { return false; }
  }

  private fileOf(takeId: string): string {
    const known = this.index.get(takeId);
    if (known && fs.existsSync(known)) return known;
    const name = `${takeId.replace(/[^a-zA-Z0-9-]/g, '')}.lfdmx`;
    for (const dir of [this.dir, this.playDir, ...this.extraDirs]) {
      const f = path.join(dir, name);
      if (fs.existsSync(f)) { this.index.set(takeId, f); return f; }
    }
    return path.join(this.dir, name);
  }

  // ─── Recording ──────────────────────────────────────────────────────────────

  // Which input the take records (Art-Net or sACN — they number universes
  // differently, so one take holds one of them).
  // Inputs (artnet / sacn) or LiveForge's own outputs (out-…).
  private recProtocol: DmxRecSource = 'artnet';
  isRecording(): boolean { return this.rec !== null; }

  startRecording(name: string | undefined, universes: number[] | undefined, source: DmxRecSource = 'artnet'): { ok: boolean; takeId?: string; error?: string } {
    if (this.rec) return { ok: false, error: 'already recording' };
    this.recProtocol = source;
    // The take's protocol is how it numbers universes: sACN from 1, the rest from 0.
    const protocol: 'artnet' | 'sacn' = source === 'sacn' || source === 'out-sacn' ? 'sacn' : 'artnet';
    fs.mkdirSync(this.dir, { recursive: true });
    const id = randomUUID();
    const takeName = name?.trim() || `Take ${this.list().length + 1}`;
    const fd = fs.openSync(this.fileOf(id), 'w');
    const start = Date.now();
    this.rec = {
      id, name: takeName, fd, start, universes: universes && universes.length ? new Set(universes) : null,
      last: new Map(), lastKey: 0, pending: [], bytes: HEADER_SIZE, events: 0, seen: new Set(), offset: HEADER_SIZE,
    };
    const header: DmxTakeInfo = { id, name: takeName, createdAt: start, durationMs: 0, universes: [], bytes: 0, protocol };
    fs.writeSync(fd, headerBuffer(header), 0, HEADER_SIZE, 0);
    // The state at the moment REC was hit, so playback starts from the same look.
    this.writeKeyframes(0);
    this.recFlush = setInterval(() => this.flushRec(), FLUSH_MS);
    this.recStatusTimer = setInterval(() => this.reportRec(), 250);
    this.reportRec();
    return { ok: true, takeId: id };
  }

  stopRecording(): { ok: boolean; take?: DmxTakeInfo } {
    const r = this.rec;
    if (!r) return { ok: false };
    this.flushRec();
    const info: DmxTakeInfo = {
      id: r.id, name: r.name, createdAt: r.start, durationMs: Date.now() - r.start,
      universes: [...r.seen].sort((a, b) => a - b), bytes: r.bytes,
      protocol: this.recProtocol === 'sacn' || this.recProtocol === 'out-sacn' ? 'sacn' : 'artnet', source: this.recProtocol,
    };
    fs.writeSync(r.fd, headerBuffer(info), 0, HEADER_SIZE, 0);
    fs.closeSync(r.fd);
    this.rec = null;
    if (this.recFlush) { clearInterval(this.recFlush); this.recFlush = null; }
    if (this.recStatusTimer) { clearInterval(this.recStatusTimer); this.recStatusTimer = null; }
    this.reportRec(info);
    return { ok: true, take: info };
  }

  // Called by the Art-Net and sACN receivers for every accepted packet.
  onFrame(universe: number, data: Uint8Array, protocol: DmxRecSource = 'artnet'): void {
    const r = this.rec;
    if (!r || protocol !== this.recProtocol) return;
    if (r.universes && !r.universes.has(universe)) return;
    const t = Date.now() - r.start;
    if (t - r.lastKey >= KEYFRAME_MS) this.writeKeyframes(t);
    let prev = r.last.get(universe);
    if (!prev) {
      // First packet of a universe that was silent when REC was hit.
      r.last.set(universe, data.slice(0, 512));
      r.seen.add(universe);
      this.push(2, t, universe, null, data.slice(0, 512));
      return;
    }
    const chs: number[] = [];
    const n = Math.min(data.length, 512);
    for (let i = 0; i < n; i++) if (prev[i] !== data[i]) chs.push(i);
    if (chs.length === 0) return;
    if (prev.length < n) { const grown = new Uint8Array(512); grown.set(prev); prev = grown; r.last.set(universe, prev); }
    const ch = new Uint16Array(chs.length), val = new Uint8Array(chs.length);
    chs.forEach((c, k) => { ch[k] = c + 1; val[k] = data[c]; prev![c] = data[c]; });
    this.push(1, t, universe, ch, val);
  }

  private writeKeyframes(t: number): void {
    const r = this.rec!;
    r.lastKey = t;
    for (const [u, f] of this.currentFrames(this.recProtocol)) {
      if (r.universes && !r.universes.has(u)) continue;
      const copy = f.slice(0, 512);
      r.last.set(u, copy);
      r.seen.add(u);
      this.push(2, t, u, null, copy);
    }
  }

  private push(type: 1 | 2, t: number, universe: number, ch: Uint16Array | null, val: Uint8Array): void {
    const r = this.rec!;
    const n = val.length;
    const buf = Buffer.alloc(9 + (type === 1 ? n * 3 : n));
    buf.writeUInt8(type, 0);
    buf.writeUInt32LE(t, 1);
    buf.writeUInt16LE(universe, 5);
    buf.writeUInt16LE(n, 7);
    if (type === 1) for (let k = 0; k < n; k++) { buf.writeUInt16LE(ch![k], 9 + k * 3); buf.writeUInt8(val[k], 11 + k * 3); }
    else Buffer.from(val.buffer, val.byteOffset, n).copy(buf, 9);
    r.pending.push(buf);
    r.bytes += buf.length;
    r.events++;
  }

  private flushRec(): void {
    const r = this.rec;
    if (!r || r.pending.length === 0) return;
    const all = Buffer.concat(r.pending);
    r.pending = [];
    fs.writeSync(r.fd, all, 0, all.length, r.offset);
    r.offset += all.length;
  }

  private reportRec(done?: DmxTakeInfo): void {
    const r = this.rec;
    this.emitRec(r
      ? { recording: true, takeId: r.id, name: r.name, elapsedMs: Date.now() - r.start, bytes: r.bytes, universes: [...r.seen].sort((a, b) => a - b) }
      : { recording: false, takeId: done?.id ?? null, name: done?.name ?? '', elapsedMs: done?.durationMs ?? 0, bytes: done?.bytes ?? 0, universes: done?.universes ?? [] });
  }

  // ─── Playback ───────────────────────────────────────────────────────────────

  play(playerId: string, cfg: DmxPlayConfig, fromMs?: number): { ok: boolean; error?: string } {
    let p = this.players.get(playerId);
    if (!p || p.takeId !== cfg.takeId) {
      p?.stop();
      const events = readEvents(this.fileOf(cfg.takeId));
      if (!events) return { ok: false, error: 'take not found' };
      const info = readHeader(this.fileOf(cfg.takeId))!;
      // A take cut short by a crash has no duration in its header: use the
      // last event instead.
      const duration = Math.max(info.durationMs, events.length ? events[events.length - 1].t : 0);
      let sent = this.sent.get(playerId);
      if (!sent) { sent = new Map(); this.sent.set(playerId, sent); }
      p = new Player(playerId, cfg.takeId, events, duration, this.sink, this.emitPlay, sent);
      this.players.set(playerId, p);
    }
    p.configure(cfg);
    p.play(fromMs, cfg.fadeMs ?? 0);
    return { ok: true };
  }

  pause(playerId: string): void { this.players.get(playerId)?.pause(); }
  stop(playerId: string): void { this.players.get(playerId)?.stop(); }
  seek(playerId: string, ms: number): void { this.players.get(playerId)?.seek(ms); }
  configure(playerId: string, cfg: DmxPlayConfig): void { this.players.get(playerId)?.configure(cfg); }

  shutdown(): void {
    if (this.rec) this.stopRecording();
    for (const p of this.players.values()) p.stop();
  }
}

class Player {
  private playing = false;
  private startWall = 0;      // wall clock when position 0 would have been
  private pos = 0;            // ms, while paused
  private idx = 0;            // next event to send
  private timer: NodeJS.Timeout | null = null;
  private statusTimer: NodeJS.Timeout | null = null;
  private cfg: DmxPlayConfig = { takeId: '', loop: false, universeOffset: 0, protocol: 'artnet' };

  constructor(
    readonly id: string,
    readonly takeId: string,
    private events: Event[],
    private duration: number,
    private sink: DmxSink,
    private emit: (s: DmxPlayStatus) => void,
    private sent: Map<number, Uint8Array>,
  ) {}

  // Full state of the take at the play head (recorded universe → 512 ch).
  private cur = new Map<number, Uint8Array>();
  private fade: { from: Map<number, Uint8Array>; start: number; ms: number } | null = null;
  private ended = false;

  configure(cfg: DmxPlayConfig): void { this.cfg = { ...cfg }; }

  play(fromMs?: number, fadeMs = 0): void {
    if (fromMs !== undefined) this.pos = Math.max(0, Math.min(this.duration, fromMs));
    if (this.pos >= this.duration) this.pos = 0;
    this.ended = false;
    // Crossfade: start from a copy of what is on output now.
    this.fade = fadeMs > 0
      ? { from: new Map([...this.sent].map(([u, f]) => [u, f.slice()])), start: Date.now(), ms: fadeMs }
      : null;
    this.restoreAt(this.pos);
    this.startWall = Date.now() - this.pos;
    this.playing = true;
    if (!this.timer) this.timer = setInterval(() => this.tick(), PLAY_TICK_MS);
    if (!this.statusTimer) this.statusTimer = setInterval(() => this.report(), 100);
    this.report();
  }

  pause(): void {
    if (!this.playing) return;
    this.pos = Date.now() - this.startWall;
    this.playing = false;
    this.clearTimers();
    this.report();
  }

  stop(): void {
    this.playing = false;
    this.fade = null;
    this.ended = false;
    this.pos = 0;
    this.idx = 0;
    this.clearTimers();
    this.report();
  }

  seek(ms: number): void {
    this.pos = Math.max(0, Math.min(this.duration, ms));
    this.restoreAt(this.pos);
    if (this.playing) this.startWall = Date.now() - this.pos;
    this.report();
  }

  private clearTimers(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    if (this.statusTimer) { clearInterval(this.statusTimer); this.statusTimer = null; }
  }

  // Jump: send the full look at `ms` — every channel as it stood then — so a
  // scrub lands on the right state, not on whatever was last sent. Replaying
  // from the top is a few ms even for an hour-long take.
  private restoreAt(ms: number): void {
    const state = new Map<number, Record<number, number>>();
    let i = 0;
    for (; i < this.events.length && this.events[i].t <= ms; i++) apply(state, this.events[i]);
    this.idx = i;
    this.cur.clear();
    for (const [u, chans] of state) {
      const f = new Uint8Array(512);
      for (const k in chans) { const c = Number(k); if (c >= 1 && c <= 512) f[c - 1] = chans[c]; }
      this.cur.set(u, f);
    }
    if (this.fade) this.outFade();
    else for (const [u, chans] of state) this.out(u, chans);
  }

  // During a crossfade every channel of every universe involved is sent,
  // blended from what was on output to the take's state at the play head.
  private outFade(): void {
    const f = this.fade!;
    const k = Math.min(1, (Date.now() - f.start) / f.ms);
    const off = this.cfg.universeOffset || 0;
    const outs = new Set<number>([...f.from.keys(), ...[...this.cur.keys()].map((u) => u + off)]);
    for (const ou of outs) {
      if (ou < 0) continue;
      const a = f.from.get(ou), b = this.cur.get(ou - off);
      const chans: Record<number, number> = {};
      for (let i = 0; i < 512; i++) {
        const va = a ? a[i] : 0, vb = b ? b[i] : 0;
        if (!a && !b) continue;
        chans[i + 1] = Math.round(va + (vb - va) * k);
      }
      this.sendOut(ou, chans);
    }
    if (k >= 1) this.fade = null;
  }

  private tick(): void {
    if (!this.playing) return;
    let now = Date.now() - this.startWall;
    if (now >= this.duration) {
      // Flush what is left, then loop or park at the end.
      this.sendUntil(this.duration);
      if (this.cfg.loop && this.duration > 0) {
        this.pos = 0;
        this.restoreAt(0);
        this.startWall = Date.now();
        now = 0;
      } else {
        this.playing = false;
        this.pos = this.duration;
        this.ended = true;
        this.clearTimers();
        this.report();
        return;
      }
    }
    this.sendUntil(now);
  }

  private sendUntil(ms: number): void {
    const state = new Map<number, Record<number, number>>();
    while (this.idx < this.events.length && this.events[this.idx].t <= ms) {
      apply(state, this.events[this.idx]);
      this.idx++;
    }
    for (const [u, chans] of state) {
      let f = this.cur.get(u);
      if (!f) { f = new Uint8Array(512); this.cur.set(u, f); }
      for (const k in chans) { const c = Number(k); if (c >= 1 && c <= 512) f[c - 1] = chans[c]; }
    }
    if (this.fade) this.outFade();
    else for (const [u, chans] of state) this.out(u, chans);
  }

  private out(universe: number, chans: Record<number, number>): void {
    const u = universe + (this.cfg.universeOffset || 0);
    if (u < 0) return;
    this.sendOut(u, chans);
  }

  private sendOut(u: number, chans: Record<number, number>): void {
    let f = this.sent.get(u);
    if (!f) { f = new Uint8Array(512); this.sent.set(u, f); }
    for (const k in chans) { const c = Number(k); if (c >= 1 && c <= 512) f[c - 1] = chans[c]; }
    this.sink.send(this.cfg.protocol, this.cfg.outputId, u, chans);
  }

  private report(): void {
    this.emit({
      playerId: this.id, takeId: this.takeId, playing: this.playing,
      positionMs: this.playing ? Math.min(this.duration, Date.now() - this.startWall) : this.pos,
      durationMs: this.duration,
      ended: this.ended,
    });
  }
}

function apply(state: Map<number, Record<number, number>>, e: Event): void {
  let s = state.get(e.universe);
  if (!s) { s = {}; state.set(e.universe, s); }
  if (e.key) { for (let i = 0; i < e.val.length; i++) s[i + 1] = e.val[i]; }
  else { for (let k = 0; k < e.ch.length; k++) s[e.ch[k]] = e.val[k]; }
}

// ─── File helpers ─────────────────────────────────────────────────────────────

function headerBuffer(info: DmxTakeInfo): Buffer {
  const buf = Buffer.alloc(HEADER_SIZE, 0x20);
  MAGIC.copy(buf, 0);
  const json = Buffer.from(JSON.stringify(info), 'utf8').subarray(0, HEADER_SIZE - 12);
  buf.writeUInt32LE(json.length, 8);
  json.copy(buf, 12);
  return buf;
}

function readHeader(file: string): DmxTakeInfo | null {
  try {
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(HEADER_SIZE);
    fs.readSync(fd, buf, 0, HEADER_SIZE, 0);
    const size = fs.fstatSync(fd).size;
    fs.closeSync(fd);
    if (!buf.subarray(0, 8).equals(MAGIC)) return null;
    const len = buf.readUInt32LE(8);
    const info = JSON.parse(buf.toString('utf8', 12, 12 + len)) as DmxTakeInfo;
    return { ...info, bytes: size };
  } catch { return null; }
}

function writeHeader(file: string, info: DmxTakeInfo): void {
  const fd = fs.openSync(file, 'r+');
  fs.writeSync(fd, headerBuffer(info), 0, HEADER_SIZE, 0);
  fs.closeSync(fd);
}

export function readEvents(file: string): Event[] | null {
  let data: Buffer;
  try { data = fs.readFileSync(file); } catch { return null; }
  if (data.length < HEADER_SIZE || !data.subarray(0, 8).equals(MAGIC)) return null;
  const out: Event[] = [];
  let o = HEADER_SIZE;
  while (o + 9 <= data.length) {
    const type = data.readUInt8(o);
    const t = data.readUInt32LE(o + 1);
    const universe = data.readUInt16LE(o + 5);
    const n = data.readUInt16LE(o + 7);
    o += 9;
    if (type === 1) {
      if (o + n * 3 > data.length) break;   // truncated tail (crash mid-take)
      const ch = new Uint16Array(n), val = new Uint8Array(n);
      for (let k = 0; k < n; k++) { ch[k] = data.readUInt16LE(o + k * 3); val[k] = data.readUInt8(o + k * 3 + 2); }
      out.push({ t, universe, key: false, ch, val });
      o += n * 3;
    } else if (type === 2) {
      if (o + n > data.length) break;
      out.push({ t, universe, key: true, ch: new Uint16Array(0), val: new Uint8Array(data.subarray(o, o + n)) });
      o += n;
    } else break;
  }
  return out;
}
