import dgram from 'dgram';
import os from 'os';
import type { DmxInputPayload, DmxInputStatusPayload } from '../../shared/types/ipc';

// Art-Net receiver — listens for ArtDmx (OpCode 0x5000) on UDP 6454.
//
// Keeps the last full frame of every universe it hears and forwards only what
// CHANGED to the renderer, batched at ~50 Hz: a console streams 44 frames a
// second per universe whether anything moves or not, and pushing all of that
// through IPC would be pure noise. The first frame of a universe is flagged
// `first`, so the renderer can tell "the console was already at full when we
// started listening" from "someone just pushed the fader" — triggers (GO,
// buttons) only fire on the latter.
//
// Merge: latest packet wins per universe. Two consoles on one universe will
// fight; HTP/LTP merge can come later with the recorder.
//
// The same shape (universe → 512 bytes, change batches) is what sACN input
// will plug into, and what the stream recorder/player widgets will read.

const ART_NET_PORT = 6454;
const OP_DMX = 0x5000;
const FLUSH_MS = 20;
const STATUS_MS = 1000;

export class ArtNetInputService {
  private socket: dgram.Socket | null = null;
  private frames = new Map<number, Uint8Array>();          // universe → 512 ch (index 0 = ch1)
  private changed = new Map<number, Map<number, number>>(); // universe → (ch → value) since last flush
  private firstSeen = new Set<number>();                     // universes whose first frame is pending
  private flushTimer: NodeJS.Timeout | null = null;
  private statusTimer: NodeJS.Timeout | null = null;
  private packets = 0;
  private other = 0;
  private own = 0;
  private polls = new Set<string>();
  private sources = new Set<string>();
  private localAddrs = new Set<string>();

  constructor(
    private emit: (p: DmxInputPayload) => void,
    private emitStatus: (s: DmxInputStatusPayload) => void,
    // Port our own Art-Net SENDER is bound to, so our broadcast output is not
    // read back as input (that would be a feedback loop on a shared universe).
    private ownSenderPort: () => number | null,
  ) {}

  // Universes announced in ArtPollReply, so a console or MadMapper in
  // unicast mode discovers Maestrale as a node and sends to it.
  private advertised: number[] = [0];
  private boundHost = '0.0.0.0';

  listen(bindHost = '0.0.0.0', universes?: number[]): Promise<{ ok: boolean; error?: string }> {
    this.stop();
    this.advertised = universes && universes.length ? universes.slice(0, 64) : [0];
    // The local card to bind. "localhost" is fine; anything that is not an IPv4
    // address is refused here rather than handed to the resolver.
    let host = (bindHost ?? '').trim();
    if (host === '' ) host = '0.0.0.0';
    if (host.toLowerCase() === 'localhost') host = '127.0.0.1';
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
      return Promise.resolve({ ok: false, error: `"${bindHost}" is not an IP address of this computer` });
    }
    this.localAddrs = new Set(
      Object.values(os.networkInterfaces()).flatMap((l) => (l ?? []).map((i) => i.address)),
    );
    return new Promise((resolve) => {
      // reuseAddr: another Art-Net tool on this machine (a visualiser, the
      // console's own software) may already hold 6454. Broadcast reaches both.
      const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      // listen() can be called twice in a row (React StrictMode runs effects
      // twice in dev): the earlier socket, still binding, must not survive and
      // keep 6454 busy in the background.
      this.pending = sock;
      let settled = false;
      sock.on('close', () => { if (!settled) { settled = true; resolve({ ok: false, error: 'superseded' }); } });
      sock.on('error', (err) => {
        if (!settled) { settled = true; resolve({ ok: false, error: err.message }); }
        if (sock !== this.socket && sock !== this.pending) { try { sock.close(); } catch { /* gone */ } return; }
        this.stop();
        this.emitStatus({ protocol: 'artnet', listening: false, packetsPerSec: 0, universes: [], sources: [],
          error: /EADDRINUSE/.test(err.message) ? `port 6454 on ${host} is taken by another program (${err.message})` : err.message });
      });
      sock.on('message', (msg, rinfo) => this.onMessage(msg, rinfo));
      sock.bind(ART_NET_PORT, host, () => {
        if (this.pending !== sock) { try { sock.close(); } catch { /* gone */ } return; }   // 'close' resolves
        this.pending = null;
        try { sock.setBroadcast(true); } catch { /* not needed to receive */ }
        this.socket = sock;
        this.boundHost = host;
        this.flushTimer = setInterval(() => this.flush(), FLUSH_MS);
        this.statusTimer = setInterval(() => this.reportStatus(), STATUS_MS);
        settled = true;
        resolve({ ok: true });
      });
    });
  }

  private pending: dgram.Socket | null = null;

  stop(): void {
    if (this.pending) { try { this.pending.close(); } catch { /* not bound yet */ } this.pending = null; }
    if (this.flushTimer) { clearInterval(this.flushTimer); this.flushTimer = null; }
    if (this.statusTimer) { clearInterval(this.statusTimer); this.statusTimer = null; }
    if (this.socket) { try { this.socket.close(); } catch { /* already closed */ } this.socket = null; }
    this.frames.clear();
    this.bySource.clear();
    this.changed.clear();
    this.firstSeen.clear();
    this.packets = 0;
    this.sources.clear();
    this.emitStatus({ protocol: 'artnet', listening: false, packetsPerSec: 0, universes: [], sources: [] });
  }

  isListening(): boolean { return this.socket !== null; }

  // Every accepted packet, raw — the DMX recorder taps in here so its
  // timestamps are packet arrival times.
  private taps = new Set<(universe: number, data: Uint8Array) => void>();
  tap(fn: (universe: number, data: Uint8Array) => void): () => void {
    this.taps.add(fn);
    return () => { this.taps.delete(fn); };
  }

  // Last full frame of every universe heard (index 0 = channel 1).
  currentFrames(): Map<number, Uint8Array> { return this.frames; }

  // The same, but only what one sender put on a universe — for a monitor set
  // to "from 127.0.0.1" while a console on the network also sends.
  private bySource = new Map<string, Map<number, Uint8Array>>();
  frameFrom(source: string, universe: number): Uint8Array | undefined {
    return this.bySource.get(source)?.get(universe);
  }

  private onMessage(msg: Buffer, rinfo: dgram.RemoteInfo): void {
    if (isArtPoll(msg)) { this.other++; this.polls.add(rinfo.address); this.replyToPoll(rinfo); return; }
    const parsed = parseArtDmx(msg);
    if (!parsed) { this.other++; return; }
    const own = this.ownSenderPort();
    if (own !== null && rinfo.port === own && this.localAddrs.has(rinfo.address)) { this.own++; return; }

    this.packets++;
    this.sources.add(rinfo.address);
    const { universe, data } = parsed;
    for (const fn of this.taps) fn(universe, data);
    let src = this.bySource.get(rinfo.address);
    if (!src) { src = new Map(); this.bySource.set(rinfo.address, src); }
    let sf = src.get(universe);
    if (!sf) { sf = new Uint8Array(512); src.set(universe, sf); }
    sf.set(data.subarray(0, Math.min(512, data.length)));

    let frame = this.frames.get(universe);
    if (!frame) {
      frame = new Uint8Array(512);
      this.frames.set(universe, frame);
      this.firstSeen.add(universe);
    }
    let ch = this.changed.get(universe);
    const first = this.firstSeen.has(universe);
    for (let i = 0; i < data.length && i < 512; i++) {
      const v = data[i];
      // On the first frame, report every non-zero channel: the renderer starts
      // from zeros too, so that brings it to the console's real state.
      if (frame[i] !== v || (first && v !== 0)) {
        // Same channel already changed in this batch: send the batch now, or a
        // one-frame bump (0 → 255 → 0 inside 20 ms) would collapse into
        // nothing and a GO on a flash button would be lost.
        if (ch?.has(i + 1)) { this.flush(); ch = undefined; }
        frame[i] = v;
        if (!ch) { ch = new Map(); this.changed.set(universe, ch); }
        ch.set(i + 1, v);
      }
    }
    // A short packet (fewer channels than before) leaves the tail as it was:
    // Art-Net senders may trim trailing channels, which does not mean zero.
    if (first && !ch) this.changed.set(universe, new Map());
  }

  // ArtPoll → ArtPollReply: "I am a node, these are my universes". Without it a
  // sender in unicast mode (MadMapper "Use Unicast", most consoles) has nobody
  // to send to. One reply per group of 4 universes sharing Net/Sub-Net.
  private replyToPoll(rinfo: dgram.RemoteInfo): void {
    const sock = this.socket;
    if (!sock) return;
    const ip = this.advertiseIp(rinfo.address);
    const groups = new Map<number, number[]>();   // (net<<4 | sub) → universes (low nibble)
    for (const u of this.advertised) {
      const key = (u >> 4) & 0x7ff;
      const g = groups.get(key) ?? [];
      if (!g.includes(u & 0x0f)) g.push(u & 0x0f);
      groups.set(key, g);
    }
    let bind = 1;
    for (const [key, all] of groups) for (let i = 0; i < all.length; i += 4) {
      const list = all.slice(i, i + 4);
      const reply = buildPollReply(ip, (key >> 4) & 0x7f, key & 0x0f, list, bind++);
      sock.send(reply, ART_NET_PORT, rinfo.address);
      // Spec says port 6454, but some pollers ask from another port (or share
      // 6454 with us on the same PC): answer there too.
      if (rinfo.port !== ART_NET_PORT) sock.send(reply, rinfo.port, rinfo.address);
    }
  }

  // Which of our addresses to announce: loopback to a poller on this PC, the
  // card we are bound to, or the card on the poller's subnet.
  private advertiseIp(sender: string): string {
    // Bound to a specific address (127.0.0.2 to share a PC with MadMapper…): that one.
    if (this.boundHost !== '0.0.0.0') return this.boundHost;
    if (sender.startsWith('127.')) return '127.0.0.1';
    const cards = Object.values(os.networkInterfaces()).flatMap((l) => l ?? []).filter((i) => i.family === 'IPv4' && !i.internal);
    const prefix = sender.split('.').slice(0, 3).join('.');
    return (cards.find((i) => i.address.startsWith(prefix + '.')) ?? cards[0])?.address ?? '127.0.0.1';
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
    this.emit({ protocol: 'artnet', universes });
  }

  private reportStatus(): void {
    this.emitStatus({
      protocol: 'artnet',
      listening: this.socket !== null,
      packetsPerSec: this.packets,
      universes: [...this.frames.keys()].sort((a, b) => a - b),
      sources: [...this.sources],
      bound: `${this.boundHost}:${ART_NET_PORT}`,
      otherPerSec: this.other,
      ownPerSec: this.own,
      polls: [...this.polls],
    });
    this.packets = 0; this.other = 0; this.own = 0;
    this.sources.clear(); this.polls.clear();
  }
}

function isArtPoll(msg: Buffer): boolean {
  return msg.length >= 12 && msg.toString('ascii', 0, 7) === 'Art-Net' && msg[7] === 0 && msg.readUInt16LE(8) === 0x2000;
}

// ArtPollReply (OpCode 0x2100, 239 bytes, Art-Net 4). Ports are OUTPUT ports
// in Art-Net terms — the node puts DMX from the network out — which is what a
// receiver is.
export function buildPollReply(ip: string, net: number, sub: number, universes: number[], bindIndex: number): Buffer {
  const b = Buffer.alloc(239, 0);
  b.write('Art-Net\0', 0, 'ascii');
  b.writeUInt16LE(0x2100, 8);
  ip.split('.').forEach((n, i) => { b[10 + i] = Number(n) & 0xff; });
  b.writeUInt16LE(ART_NET_PORT, 14);
  b[16] = 0; b[17] = 1;                       // firmware 0.1
  b[18] = net & 0x7f;                         // NetSwitch
  b[19] = sub & 0x0f;                         // SubSwitch
  b[23] = 0xd0;                               // Status1: indicators normal, port-address by network
  b.write('Maestrale', 26, 17, 'ascii');      // ShortName (18 incl. NUL)
  b.write('Maestrale show control — Art-Net in', 44, 63, 'utf8');
  b.write('#0001 [0000] Maestrale ready', 108, 63, 'ascii');
  b[173] = universes.length;                  // NumPortsLo
  universes.forEach((u, i) => {
    b[174 + i] = 0x80;                        // PortTypes: output (Art-Net → DMX), DMX512
    b[182 + i] = 0x80;                        // GoodOutputA: data being output
    b[190 + i] = u & 0x0f;                    // SwOut
  });
  b[200] = 0x00;                              // Style: StNode
  ip.split('.').forEach((n, i) => { b[207 + i] = Number(n) & 0xff; });   // BindIp
  b[211] = bindIndex & 0xff;
  b[212] = 0x08;                              // Status2: 15-bit Port-Address supported
  return b;
}

// ArtDmx layout: "Art-Net\0" (8) · OpCode LE (2) · ProtVer BE (2) · Sequence ·
// Physical · Port-Address LE (2: SubUni, Net) · Length BE (2) · data.
// The 15-bit Port-Address is used as the universe number, same as the sender.
export function parseArtDmx(msg: Buffer): { universe: number; data: Uint8Array } | null {
  if (msg.length < 18) return null;
  if (msg.toString('ascii', 0, 7) !== 'Art-Net' || msg[7] !== 0) return null;
  if (msg.readUInt16LE(8) !== OP_DMX) return null;
  const universe = msg.readUInt16LE(14) & 0x7fff;
  const len = Math.min(msg.readUInt16BE(16), msg.length - 18, 512);
  if (len <= 0) return null;
  return { universe, data: new Uint8Array(msg.buffer, msg.byteOffset + 18, len) };
}
