import dgram from 'dgram';
import os from 'os';
import type { DmxInputPayload, DmxInputStatusPayload } from '../../shared/types/ipc';

// sACN (E1.31) receiver — UDP 5568, multicast 239.255.hi.lo per universe plus
// unicast. Same output as the Art-Net receiver (change batches, first-frame
// flag, per-sender frames, taps), tagged protocol 'sacn'.
//
// Multicast is why sACN shares a computer well: every program that joined the
// group gets every packet, so MadMapper, TouchDesigner and Maestrale can all
// listen on the same PC at once — unlike Art-Net unicast to 127.0.0.1.
//
// Merge: highest priority wins (E1.31). Among senders at the same priority the
// latest packet wins. A sender silent for 2.5 s stops counting.

const SACN_PORT = 5568;
const FLUSH_MS = 20;
const STATUS_MS = 1000;
const SOURCE_TIMEOUT_MS = 2500;
const ACN_ID = Buffer.from([0x41, 0x53, 0x43, 0x2d, 0x45, 0x31, 0x2e, 0x31, 0x37, 0x00, 0x00, 0x00]);

export function multicastGroup(u: number): string {
  return `239.255.${(u >> 8) & 0xff}.${u & 0xff}`;
}

export interface SacnPacket {
  universe: number;
  priority: number;
  cid: string;
  sourceName: string;
  terminated: boolean;
  preview: boolean;
  startCode: number;
  data: Uint8Array;
}

// E1.31 data packet: root layer (vector 4) · framing layer (vector 2) · DMP.
export function parseSacn(msg: Buffer): SacnPacket | null {
  if (msg.length < 126) return null;
  if (msg.readUInt16BE(0) !== 0x0010 || !msg.subarray(4, 16).equals(ACN_ID)) return null;
  if (msg.readUInt32BE(18) !== 0x00000004) return null;     // VECTOR_ROOT_E131_DATA
  if (msg.readUInt32BE(40) !== 0x00000002) return null;     // VECTOR_E131_DATA_PACKET
  if (msg[117] !== 0x02) return null;                       // VECTOR_DMP_SET_PROPERTY
  const count = msg.readUInt16BE(123);                      // includes the start code
  const len = Math.max(0, Math.min(count - 1, msg.length - 126, 512));
  const options = msg[112];
  return {
    universe: msg.readUInt16BE(113),
    priority: msg[108],
    cid: msg.subarray(22, 38).toString('hex'),
    sourceName: msg.toString('utf8', 44, 108).replace(/\0[\s\S]*$/, ''),
    terminated: (options & 0x40) !== 0,
    preview: (options & 0x80) !== 0,
    startCode: msg[125],
    data: new Uint8Array(msg.buffer, msg.byteOffset + 126, len),
  };
}

export class SacnInputService {
  private socket: dgram.Socket | null = null;
  private pending: dgram.Socket | null = null;
  private frames = new Map<number, Uint8Array>();
  private changed = new Map<number, Map<number, number>>();
  private firstSeen = new Set<number>();
  private bySource = new Map<string, Map<number, Uint8Array>>();
  // universe → cid → { priority, seen }
  private senders = new Map<number, Map<string, { priority: number; seen: number }>>();
  private flushTimer: NodeJS.Timeout | null = null;
  private statusTimer: NodeJS.Timeout | null = null;
  private packets = 0;
  private other = 0;
  private own = 0;
  private sources = new Set<string>();
  private names = new Set<string>();
  private localAddrs = new Set<string>();
  private boundHost = '0.0.0.0';
  private joined: number[] = [];
  private joinErrors: string[] = [];
  private taps = new Set<(universe: number, data: Uint8Array) => void>();

  constructor(
    private emit: (p: DmxInputPayload) => void,
    private emitStatus: (s: DmxInputStatusPayload) => void,
    private ownSenderPort: () => number | null,
  ) {}

  listen(bindHost = '', universes: number[] = [1]): Promise<{ ok: boolean; error?: string }> {
    this.stop();
    let host = (bindHost ?? '').trim();
    if (host === '') host = '0.0.0.0';
    if (host.toLowerCase() === 'localhost') host = '127.0.0.1';
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
      return Promise.resolve({ ok: false, error: `"${bindHost}" is not an IP address of this computer` });
    }
    const list = [...new Set(universes.filter((u) => u >= 1 && u <= 63999))].slice(0, 64);
    this.joined = list.length ? list : [1];
    const ifaces = Object.values(os.networkInterfaces()).flatMap((l) => l ?? []).filter((i) => i.family === 'IPv4');
    this.localAddrs = new Set(ifaces.map((i) => i.address));

    return new Promise((resolve) => {
      // Multicast needs the socket on the wildcard address (or the group) to
      // receive group traffic; a specific card is honoured through the join.
      const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      this.pending = sock;
      let settled = false;
      sock.on('close', () => { if (!settled) { settled = true; resolve({ ok: false, error: 'superseded' }); } });
      sock.on('error', (err) => {
        if (!settled) { settled = true; resolve({ ok: false, error: err.message }); }
        if (sock !== this.socket && sock !== this.pending) { try { sock.close(); } catch { /* gone */ } return; }
        this.stop();
        this.emitStatus({ protocol: 'sacn', listening: false, packetsPerSec: 0, universes: [], sources: [], error: err.message });
      });
      sock.on('message', (msg, rinfo) => this.onMessage(msg, rinfo));
      sock.bind(SACN_PORT, '0.0.0.0', () => {
        if (this.pending !== sock) { try { sock.close(); } catch { /* gone */ } return; }
        this.pending = null;
        this.socket = sock;
        this.boundHost = host;
        try { sock.setMulticastLoopback(true); } catch { /* */ }
        // Join each universe on every card (loopback included, so a sender on
        // this PC is heard) — or only on the chosen one.
        const cards = host === '0.0.0.0' ? ifaces.map((i) => i.address) : [host];
        this.joinErrors = [];
        for (const u of this.joined) {
          for (const addr of cards) {
            try { sock.addMembership(multicastGroup(u), addr); }
            catch (e) { this.joinErrors.push(`${multicastGroup(u)} on ${addr}: ${(e as Error).message}`); }
          }
        }
        this.flushTimer = setInterval(() => this.flush(), FLUSH_MS);
        this.statusTimer = setInterval(() => this.reportStatus(), STATUS_MS);
        settled = true;
        resolve({ ok: true });
      });
    });
  }

  stop(): void {
    if (this.pending) { try { this.pending.close(); } catch { /* */ } this.pending = null; }
    if (this.flushTimer) { clearInterval(this.flushTimer); this.flushTimer = null; }
    if (this.statusTimer) { clearInterval(this.statusTimer); this.statusTimer = null; }
    if (this.socket) { try { this.socket.close(); } catch { /* */ } this.socket = null; }
    this.frames.clear(); this.bySource.clear(); this.changed.clear(); this.firstSeen.clear(); this.senders.clear();
    this.packets = 0; this.sources.clear(); this.names.clear();
    this.emitStatus({ protocol: 'sacn', listening: false, packetsPerSec: 0, universes: [], sources: [] });
  }

  isListening(): boolean { return this.socket !== null; }
  currentFrames(): Map<number, Uint8Array> { return this.frames; }
  frameFrom(source: string, universe: number): Uint8Array | undefined { return this.bySource.get(source)?.get(universe); }
  tap(fn: (universe: number, data: Uint8Array) => void): () => void {
    this.taps.add(fn);
    return () => { this.taps.delete(fn); };
  }

  private onMessage(msg: Buffer, rinfo: dgram.RemoteInfo): void {
    const p = parseSacn(msg);
    if (!p) { this.other++; return; }
    const own = this.ownSenderPort();
    if (own !== null && rinfo.port === own && this.localAddrs.has(rinfo.address)) { this.own++; return; }
    if (p.preview || p.startCode !== 0) { this.other++; return; }

    const now = Date.now();
    let s = this.senders.get(p.universe);
    if (!s) { s = new Map(); this.senders.set(p.universe, s); }
    if (p.terminated) { s.delete(p.cid); return; }
    s.set(p.cid, { priority: p.priority, seen: now });
    let top = 0;
    for (const [cid, v] of s) {
      if (now - v.seen > SOURCE_TIMEOUT_MS) { s.delete(cid); continue; }
      if (v.priority > top) top = v.priority;
    }
    this.packets++;
    this.sources.add(rinfo.address);
    if (p.sourceName) this.names.add(p.sourceName);

    let src = this.bySource.get(rinfo.address);
    if (!src) { src = new Map(); this.bySource.set(rinfo.address, src); }
    let sf = src.get(p.universe);
    if (!sf) { sf = new Uint8Array(512); src.set(p.universe, sf); }
    sf.set(p.data.subarray(0, 512));
    if (p.priority < top) return;            // a higher-priority sender owns this universe

    for (const fn of this.taps) fn(p.universe, p.data);
    let frame = this.frames.get(p.universe);
    if (!frame) { frame = new Uint8Array(512); this.frames.set(p.universe, frame); this.firstSeen.add(p.universe); }
    let ch = this.changed.get(p.universe);
    const first = this.firstSeen.has(p.universe);
    for (let i = 0; i < p.data.length && i < 512; i++) {
      const v = p.data[i];
      if (frame[i] !== v || (first && v !== 0)) {
        if (ch?.has(i + 1)) { this.flush(); ch = undefined; }
        frame[i] = v;
        if (!ch) { ch = new Map(); this.changed.set(p.universe, ch); }
        ch.set(i + 1, v);
      }
    }
    if (first && !ch) this.changed.set(p.universe, new Map());
  }

  private flush(): void {
    if (this.changed.size === 0) return;
    const universes: DmxInputPayload['universes'] = [];
    for (const [u, chMap] of this.changed) {
      const pairs: number[] = [];
      for (const [c, v] of chMap) pairs.push(c, v);
      universes.push({ universe: u, first: this.firstSeen.has(u), pairs });
      this.firstSeen.delete(u);
    }
    this.changed.clear();
    this.emit({ protocol: 'sacn', universes });
  }

  private reportStatus(): void {
    this.emitStatus({
      protocol: 'sacn',
      listening: this.socket !== null,
      packetsPerSec: this.packets,
      universes: [...this.frames.keys()].sort((a, b) => a - b),
      sources: [...this.sources],
      bound: `${this.boundHost}:${SACN_PORT} · joined ${this.joined.join(', ')}`,
      otherPerSec: this.other,
      ownPerSec: this.own,
      names: [...this.names],
      error: this.joinErrors.length ? `could not join ${this.joinErrors.length} group(s): ${this.joinErrors[0]}` : undefined,
    });
    this.packets = 0; this.other = 0; this.own = 0;
    this.sources.clear(); this.names.clear();
  }
}
