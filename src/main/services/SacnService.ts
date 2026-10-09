import dgram from 'dgram';
import { randomBytes } from 'crypto';

// Raw E1.31 (sACN) sender — bypasses the sacn npm library which always pads to 512 channels.
// Packet length = 126 + N where N = highest channel used (partial universe per spec §6.2.6).
//
// Supports multiple named outputs. An output with a host sends unicast to it; an output
// without a host sends multicast (group address computed from the universe). Each output
// keeps its own universe/channel state so values never leak between machines.

const SACN_PORT = 5568;
const FLUSH_INTERVAL_MS = 23; // ~44 Hz
const PRIMARY = 'primary';

// Multicast address for universe U: 239.255.hi.lo (E1.31 §9.3.1)
function universeToMulticast(u: number): string {
  return `239.255.${(u >> 8) & 0xff}.${u & 0xff}`;
}

// Fixed 12-byte ACN Packet Identifier
const ACN_ID = Buffer.from([0x41,0x53,0x43,0x2d,0x45,0x31,0x2e,0x31,0x37,0x00,0x00,0x00]);

interface Output {
  host?: string;   // unicast target; undefined = multicast
  universes: Map<number, Map<number, number>>;
  dirty: Set<number>;
}

export class SacnService {
  private socket: dgram.Socket | null = null;
  private defaultPriority = 100;
  private cid = randomBytes(16);
  private seq = 0;
  private outputs = new Map<string, Output>();
  private timer: NodeJS.Timeout | null = null;

  configure(priority: number, outputs: Array<{ id: string; host?: string }>): void {
    this.cleanup();
    this.defaultPriority = priority;
    this.outputs.clear();
    const list = outputs.length ? outputs : [{ id: PRIMARY, host: undefined }];
    for (const o of list) {
      const host = (o.host ?? '').trim() || undefined;
      this.outputs.set(o.id, { host, universes: new Map(), dirty: new Set() });
    }
    if (!this.outputs.has(PRIMARY)) {
      const first = this.outputs.values().next().value as Output | undefined;
      if (first) this.outputs.set(PRIMARY, first);
    }
    const sock = dgram.createSocket('udp4');
    sock.bind(0, () => {
      try { sock.setMulticastTTL(64); } catch { /* */ }
    });
    this.socket = sock;
    this.startFlushLoop();
  }

  // Local UDP port of the sender — the sACN receiver drops our own multicast
  // when it loops back.
  localPort(): number | null {
    try { return this.socket ? this.socket.address().port : null; } catch { return null; }
  }

  // Every universe any output has touched — the DMX recorder samples these
  // when it records LiveForge's own output.
  universesInUse(): number[] {
    const set = new Set<number>();
    for (const o of this.outputs.values()) for (const u of o.universes.keys()) set.add(u);
    return [...set].sort((a, b) => a - b);
  }

  // What this service is currently putting out on a universe, for the DMX
  // monitor: every output merged highest-takes-precedence (index 0 = ch 1).
  snapshot(universe: number, outputId?: string): Uint8Array {
    const out = new Uint8Array(512);
    const seen = new Set<Output>();
    const only = outputId ? this.outputs.get(outputId) : undefined;
    for (const o of (only ? [only] : this.outputs.values())) {
      if (seen.has(o)) continue;
      seen.add(o);
      const m = o.universes.get(universe);
      if (!m) continue;
      for (const [ch, v] of m) if (ch >= 1 && ch <= 512 && v > out[ch - 1]) out[ch - 1] = v;
    }
    return out;
  }

  private resolve(outputId: string | undefined): Output | undefined {
    return this.outputs.get(outputId ?? PRIMARY) ?? this.outputs.get(PRIMARY);
  }

  setChannel(outputId: string | undefined, universe: number, channel: number, value: number, _priority?: number): void {
    const out = this.resolve(outputId);
    if (!out) return;
    this.getOrCreate(out, universe).set(channel, value);
    out.dirty.add(universe);
  }

  setChannels(outputId: string | undefined, universe: number, channels: Record<number, number>, _priority?: number): void {
    const out = this.resolve(outputId);
    if (!out) return;
    const m = this.getOrCreate(out, universe);
    for (const [ch, val] of Object.entries(channels)) m.set(Number(ch), val);
    out.dirty.add(universe);
  }

  private getOrCreate(out: Output, universe: number): Map<number, number> {
    if (!out.universes.has(universe)) out.universes.set(universe, new Map());
    return out.universes.get(universe)!;
  }

  private startFlushLoop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => this.flush(), FLUSH_INTERVAL_MS);
  }

  private flush(): void {
    if (!this.socket) return;
    const seen = new Set<Output>();
    for (const out of this.outputs.values()) {
      if (seen.has(out) || out.dirty.size === 0) continue;
      seen.add(out);
      for (const universe of out.dirty) {
        const chMap = out.universes.get(universe);
        if (chMap && chMap.size > 0) this.sendPacket(out, universe, chMap);
      }
      out.dirty.clear();
    }
  }

  private sendPacket(out: Output, universe: number, chMap: Map<number, number>): void {
    if (!this.socket) return;

    const N = Math.max(...chMap.keys()); // highest 1-indexed channel used
    const totalLen = 126 + N;
    const buf = Buffer.alloc(totalLen, 0);

    // ── Preamble (bytes 0–15) ────────────────────────────────────────────────
    buf.writeUInt16BE(0x0010, 0);   // Preamble Size
    buf.writeUInt16BE(0x0000, 2);   // Post-amble Size
    ACN_ID.copy(buf, 4);            // ACN Packet Identifier

    // ── Root layer (bytes 16–37) ─────────────────────────────────────────────
    buf.writeUInt16BE(0x7000 | (110 + N), 16); // Flags+Length
    buf.writeUInt32BE(0x00000004, 18);          // Vector: VECTOR_ROOT_E131_DATA
    this.cid.copy(buf, 22);                     // CID (16 bytes)

    // ── Framing layer (bytes 38–114) ─────────────────────────────────────────
    buf.writeUInt16BE(0x7000 | (88 + N), 38);  // Flags+Length
    buf.writeUInt32BE(0x00000002, 40);          // Vector: VECTOR_E131_DATA_PACKET
    buf.write('LiveForge', 44, 'utf8');         // Source Name (64 bytes, rest = 0)
    buf[108] = this.defaultPriority;            // Priority
    // Synchronization Address [109–110]: 0 (no sync)
    buf[111] = this.seq = (this.seq + 1) & 0xff; // Sequence Number
    // Options [112]: 0
    buf.writeUInt16BE(universe, 113);           // Universe

    // ── DMP layer (bytes 115–125 + data) ─────────────────────────────────────
    buf.writeUInt16BE(0x7000 | (11 + N), 115); // Flags+Length
    buf[117] = 0x02;                            // Vector: VECTOR_DMP_SET_PROPERTY
    buf[118] = 0xa1;                            // Address Type and Data Type
    buf.writeUInt16BE(0x0000, 119);             // First Property Address
    buf.writeUInt16BE(0x0001, 121);             // Address Increment
    buf.writeUInt16BE(N + 1, 123);              // Property Count (start code + N)
    buf[125] = 0x00;                            // DMX512 Start Code

    // DMX data: channel ch (1-indexed) → buf[125 + ch]
    for (const [ch, val] of chMap) {
      if (ch >= 1 && ch <= N) buf[125 + ch] = val;
    }

    const host = out.host ?? universeToMulticast(universe);
    this.socket.send(buf, SACN_PORT, host);
  }

  private cleanup(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    if (this.socket) { try { this.socket.close(); } catch { /* */ } this.socket = null; }
  }
}
