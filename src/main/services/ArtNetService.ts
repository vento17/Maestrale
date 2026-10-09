import dgram from 'dgram';

// Raw Art-Net sender — bypasses the artnet npm library which always pads to 512 channels.
// Builds ArtDmx (OpCode 0x5000) packets with data length = highest channel used.
//
// Supports multiple named outputs (different target machines). Each output keeps its
// OWN universe/channel state so a value addressed to one machine never leaks to another.

const ART_NET_PORT = 6454;
const FLUSH_INTERVAL_MS = 23; // ~44 Hz
const PRIMARY = 'primary';

interface Output {
  host: string;
  universes: Map<number, Map<number, number>>; // universe → (1-indexed ch → value)
  dirty: Set<number>;
}

export class ArtNetService {
  private socket: dgram.Socket | null = null;
  private outputs = new Map<string, Output>();
  private timer: NodeJS.Timeout | null = null;
  private seq = 0;

  configure(outputs: Array<{ id: string; host: string }>): void {
    this.cleanup();
    this.outputs.clear();
    const list = outputs.length ? outputs : [{ id: PRIMARY, host: '255.255.255.255' }];
    for (const o of list) {
      const host = (o.host ?? '').trim() || '255.255.255.255';
      this.outputs.set(o.id, { host, universes: new Map(), dirty: new Set() });
    }
    if (!this.outputs.has(PRIMARY)) {
      // Guarantee a fallback so mappings without a valid outputId still send.
      const first = this.outputs.values().next().value as Output | undefined;
      if (first) this.outputs.set(PRIMARY, first);
    }
    const sock = dgram.createSocket('udp4');
    sock.bind(0, () => {
      try { sock.setBroadcast(true); } catch { /* unicast target, no broadcast needed */ }
    });
    this.socket = sock;
    this.startFlushLoop();
  }

  // Local UDP port the sender is bound to (null until configured). The Art-Net
  // receiver uses it to drop our own broadcast when it loops back.
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

  setChannel(outputId: string | undefined, universe: number, channel: number, value: number): void {
    const out = this.resolve(outputId);
    if (!out) return;
    this.getOrCreate(out, universe).set(channel, value);
    out.dirty.add(universe);
  }

  setChannels(outputId: string | undefined, universe: number, channels: Record<number, number>): void {
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
    // Iterate distinct Output objects (PRIMARY may alias another entry).
    const seen = new Set<Output>();
    for (const out of this.outputs.values()) {
      if (seen.has(out) || out.dirty.size === 0) continue;
      seen.add(out);
      for (const universe of out.dirty) {
        const chMap = out.universes.get(universe);
        if (chMap && chMap.size > 0) this.sendPacket(out.host, universe, chMap);
      }
      out.dirty.clear();
    }
  }

  private sendPacket(host: string, universe: number, chMap: Map<number, number>): void {
    if (!this.socket) return;

    const maxCh = Math.max(...chMap.keys());
    // Art-Net spec: data length must be even and at least 2
    const dataLen = Math.max(2, maxCh % 2 === 0 ? maxCh : maxCh + 1);
    const buf = Buffer.alloc(18 + dataLen, 0);

    buf.write('Art-Net\0', 0, 'ascii');           // ID (8 bytes, includes null)
    buf.writeUInt16LE(0x5000, 8);                 // OpCode ArtDmx (lo-hi per Art-Net spec)
    buf.writeUInt16BE(14, 10);                    // Protocol version 14
    buf[12] = this.seq = (this.seq + 1) & 0xff;  // Sequence (1–255, 0 = disable)
    buf[13] = 0;                                   // Physical
    buf.writeUInt16LE(universe, 14);              // Universe (lo-hi)
    buf.writeUInt16BE(dataLen, 16);               // Length (hi-lo)
    // DMX data starts at byte 18; channel N (1-indexed) → buf[18 + N - 1] = buf[17 + N]
    for (const [ch, val] of chMap) {
      if (ch >= 1 && ch <= dataLen) buf[17 + ch] = val;
    }

    this.socket.send(buf, ART_NET_PORT, host);
  }

  private cleanup(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    if (this.socket) { try { this.socket.close(); } catch { /* */ } this.socket = null; }
  }
}
