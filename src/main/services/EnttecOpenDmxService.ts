import koffi from 'koffi';
import { performance } from 'perf_hooks';
import fs from 'fs';
import path from 'path';

// A full DMX frame is 513 bytes at 250 kbaud, 8 data bits + 1 start + 2 stop =
// 11 bits a byte: 513 * 11 / 250000 = 22.6 ms ON THE WIRE, before the break and
// before any USB latency. The old 22 ms interval was therefore SHORTER than the
// frame it was sending, so every cycle asserted the break while the previous
// frame was still going out and the fixture got a truncated packet — which is
// what made a head flicker. 30 ms (~33 Hz) leaves ~7 ms of headroom for USB
// jitter and still refreshes far faster than any fixture needs.
const FLUSH_INTERVAL_MS = 30;  // ~33 Hz

// DMX512 asks for a break of at least 92 us and a mark-after-break of at least
// 12 us. FT_SetBreakOn/Off back to back leaves both at the mercy of however
// long the USB control transfer happens to take, so the break is held open for
// a measured stretch instead. At one frame per 30 ms this busy-waits for 0.5%
// of a core.
const BREAK_US = 120;
const MAB_US = 20;
const FT_OK = 0;
const FT_BITS_8 = 8;
const FT_STOP_BITS_2 = 2;
const FT_PARITY_NONE = 0;
const FT_FLOW_NONE = 0x0000;
const FT_PURGE_RX = 1;
const FT_PURGE_TX = 2;

const FT_STATUS_NAMES: Record<number, string> = {
  0: 'FT_OK', 1: 'FT_INVALID_HANDLE', 2: 'FT_DEVICE_NOT_FOUND', 3: 'FT_DEVICE_NOT_OPENED',
  4: 'FT_IO_ERROR', 5: 'FT_INSUFFICIENT_RESOURCES', 6: 'FT_INVALID_PARAMETER',
  7: 'FT_INVALID_BAUD_RATE', 18: 'FT_OTHER_ERROR',
};
const ftStatus = (st: number): string => `${FT_STATUS_NAMES[st] ?? 'FT_ERROR'} (${st})`;

// Sub-millisecond wait. setTimeout cannot do microseconds and the DMX break is
// measured in them, so this spins on the monotonic clock.
//
// It MUST be performance.now(), which returns a plain number.
// process.hrtime.bigint() allocates a BigInt on the heap on every single call,
// and a spin of this length calls it well over a thousand times — around sixty
// thousand BigInts a second at this frame rate, produced inside a loop that
// blocks the event loop and so starves the collector that would clean them up.
// That was enough to run the main process out of heap and take the window down
// with it, a few minutes after the Open DMX dongle was connected.
function spinMicros(us: number): void {
  const end = performance.now() + us / 1000;
  // A clock that never advances would hang the process, so the spin is bounded.
  let guard = 0;
  while (performance.now() < end && ++guard < 2_000_000) { /* ~100 us, twice a frame */ }
}

// FT_HANDLE is an opaque pointer. It MUST be a named opaque type: an out-param
// declared as koffi.pointer('void') makes koffi throw "Cannot pass ambiguous
// value to void *", which silently broke device listing and FT_Open.
const FT_HANDLE = koffi.pointer('FT_HANDLE', koffi.opaque());

// __stdcall only matters on 32-bit Windows; elsewhere use the default ABI.
const CC = process.platform === 'win32' ? '__stdcall' : '';

function candidatePaths(): string[] {
  const override = process.env.LIVEFORGE_FTD2XX_PATH;
  const list: string[] = override ? [override] : [];

  if (process.platform === 'win32') {
    list.push(
      'ftd2xx64.dll',
      'ftd2xx.dll',
      'C:\\Windows\\System32\\ftd2xx64.dll',
      'C:\\Windows\\System32\\ftd2xx.dll',
    );
  } else if (process.platform === 'darwin') {
    // FTDI's macOS package installs a versioned dylib (libftd2xx.1.4.x.dylib)
    // in /usr/local/lib; the plain name is only there if a symlink was made.
    const dirs = ['/usr/local/lib', '/opt/homebrew/lib', '/Library/Application Support/FTDI'];
    for (const d of dirs) {
      list.push(path.join(d, 'libftd2xx.dylib'));
      try {
        for (const f of fs.readdirSync(d)) {
          if (/^libftd2xx.*\.dylib$/.test(f)) list.push(path.join(d, f));
        }
      } catch { /* dir missing */ }
    }
    list.push('libftd2xx.dylib');
  } else {
    list.push('libftd2xx.so', '/usr/local/lib/libftd2xx.so', '/usr/lib/libftd2xx.so');
  }
  return list;
}

const DRIVER_HINT =
  process.platform === 'darwin'
    ? 'Install the FTDI D2XX driver for macOS (https://ftdichip.com/drivers/d2xx-drivers/) so that libftd2xx.dylib is in /usr/local/lib.'
    : 'Install the FTDI D2XX driver from https://ftdichip.com/drivers/d2xx-drivers/';

interface Ftd2xx {
  CreateDeviceInfoList: (count: number[]) => number;
  GetDeviceInfoDetail: (i: number, flags: number[], type: number[], id: number[], loc: number[],
                        serial: Buffer, desc: Buffer, handle: unknown[]) => number;
  Open: (index: number, handle: unknown[]) => number;
  SetBaudRate: (h: unknown, baud: number) => number;
  SetDataCharacteristics: (h: unknown, bits: number, stop: number, parity: number) => number;
  SetFlowControl: (h: unknown, flow: number, xon: number, xoff: number) => number;
  SetTimeouts: (h: unknown, rd: number, wr: number) => number;
  SetLatencyTimer: (h: unknown, ms: number) => number;
  Purge: (h: unknown, mask: number) => number;
  GetStatus: (h: unknown, rx: number[], tx: number[], ev: number[]) => number;
  SetBreakOn: (h: unknown) => number;
  SetBreakOff: (h: unknown) => number;
  Write: (h: unknown, data: Buffer, len: number, written: number[]) => number;
  Close: (h: unknown) => number;
}

let ftd: Ftd2xx | null = null;

function loadFtd2xx(): Ftd2xx {
  if (ftd) return ftd;
  let lib: ReturnType<typeof koffi.load> | null = null;
  const errors: string[] = [];
  for (const p of candidatePaths()) {
    try { lib = koffi.load(p); break; } catch (e) { errors.push(`${p}: ${(e as Error).message}`); }
  }
  if (!lib) {
    console.warn('[enttec] could not load D2XX:\n  ' + errors.join('\n  '));
    throw new Error(`FTDI D2XX library not found. ${DRIVER_HINT}`);
  }
  const L = lib;
  const fn = (name: string, ret: string, args: unknown[]) =>
    (CC ? L.func(CC, name, ret, args as never) : L.func(name, ret, args as never)) as never;
  const u32out = () => koffi.out(koffi.pointer('uint32'));

  ftd = {
    CreateDeviceInfoList: fn('FT_CreateDeviceInfoList', 'uint32', [u32out()]),
    GetDeviceInfoDetail: fn('FT_GetDeviceInfoDetail', 'uint32', [
      'uint32', u32out(), u32out(), u32out(), u32out(), 'void *', 'void *', koffi.out(koffi.pointer(FT_HANDLE)),
    ]),
    Open: fn('FT_Open', 'uint32', ['int', koffi.out(koffi.pointer(FT_HANDLE))]),
    SetBaudRate: fn('FT_SetBaudRate', 'uint32', [FT_HANDLE, 'uint32']),
    SetDataCharacteristics: fn('FT_SetDataCharacteristics', 'uint32', [FT_HANDLE, 'uint8', 'uint8', 'uint8']),
    SetFlowControl: fn('FT_SetFlowControl', 'uint32', [FT_HANDLE, 'uint16', 'uint8', 'uint8']),
    SetTimeouts: fn('FT_SetTimeouts', 'uint32', [FT_HANDLE, 'uint32', 'uint32']),
    SetLatencyTimer: fn('FT_SetLatencyTimer', 'uint32', [FT_HANDLE, 'uint8']),
    Purge: fn('FT_Purge', 'uint32', [FT_HANDLE, 'uint32']),
    GetStatus: fn('FT_GetStatus', 'uint32', [FT_HANDLE, u32out(), u32out(), u32out()]),
    SetBreakOn: fn('FT_SetBreakOn', 'uint32', [FT_HANDLE]),
    SetBreakOff: fn('FT_SetBreakOff', 'uint32', [FT_HANDLE]),
    Write: fn('FT_Write', 'uint32', [FT_HANDLE, 'void *', 'uint32', u32out()]),
    Close: fn('FT_Close', 'uint32', [FT_HANDLE]),
  };
  return ftd;
}

export interface EnttecDeviceInfo {
  index: number;
  description: string;
  serialNumber: string;
}

export class EnttecOpenDmxService {
  private handle: unknown = null;
  private channels = Buffer.alloc(512, 0); // index 0 = DMX ch 1, index 511 = DMX ch 512
  private frame = Buffer.alloc(513, 0);    // start code 0x00 + 512 channels
  private timer: NodeJS.Timeout | null = null;
  private nextFrameAt = 0;
  private connected = false;
  private writeErrorLogged = false;

  // Throws if the D2XX library can't be loaded or enumeration fails, so the
  // UI can show the real reason instead of "No FTDI devices found".
  listDevices(): EnttecDeviceInfo[] {
    const ft = loadFtd2xx();
    const countArr = [0];
    const st = ft.CreateDeviceInfoList(countArr);
    if (st !== FT_OK) throw new Error(`FT_CreateDeviceInfoList failed: ${ftStatus(st)}`);

    const results: EnttecDeviceInfo[] = [];
    for (let i = 0; i < countArr[0]; i++) {
      const serialBuf = Buffer.alloc(16, 0);
      const descBuf = Buffer.alloc(64, 0);
      const s = ft.GetDeviceInfoDetail(i, [0], [0], [0], [0], serialBuf, descBuf, [null]);
      results.push({
        index: i,
        description: s === FT_OK ? descBuf.toString('ascii').replace(/\0.*$/s, '').trim() : `Device ${i}`,
        serialNumber: s === FT_OK ? serialBuf.toString('ascii').replace(/\0.*$/s, '').trim() : '',
      });
    }
    return results;
  }

  open(deviceIndex: number): void {
    this.close();
    const ft = loadFtd2xx();

    const handleArr: unknown[] = [null];
    const st = ft.Open(deviceIndex, handleArr);
    if (st !== FT_OK || !handleArr[0]) {
      let hint = '';
      if (st === 2) hint = ' — no FTDI device at that index (is the dongle plugged in?)';
      else if (st === 3) {
        hint = process.platform === 'darwin'
          ? ' — the device is busy: another app has it open, or the macOS FTDI serial driver (AppleUSBFTDI / FTDI VCP) has claimed it. Unplug/replug, close other DMX apps; if it persists, unload the VCP driver.'
          : ' — the device is busy: close other DMX software (QLC+, Freestyler…) that may hold it.';
      }
      throw new Error(`FT_Open(${deviceIndex}) failed: ${ftStatus(st)}${hint}`);
    }
    const h = handleArr[0];

    const check = (name: string, s: number) => {
      if (s !== FT_OK) { ft.Close(h); throw new Error(`${name} failed: ${ftStatus(s)}`); }
    };
    check('FT_SetBaudRate', ft.SetBaudRate(h, 250000));
    check('FT_SetDataCharacteristics', ft.SetDataCharacteristics(h, FT_BITS_8, FT_STOP_BITS_2, FT_PARITY_NONE));
    check('FT_SetFlowControl', ft.SetFlowControl(h, FT_FLOW_NONE, 0, 0));
    ft.SetTimeouts(h, 500, 500);
    ft.SetLatencyTimer(h, 2);
    ft.Purge(h, FT_PURGE_RX | FT_PURGE_TX);

    this.handle = h;
    this.connected = true;
    this.nextFrameAt = Date.now();
    this.loop();
  }

  // The 512 channels as they are being sent (index 0 = ch 1) — for the recorder.
  snapshot(): Uint8Array { return new Uint8Array(this.channels); }

  setChannel(channel: number, value: number): void {
    if (channel < 1 || channel > 512) return;
    this.channels[channel - 1] = Math.max(0, Math.min(255, Math.round(value)));
  }

  setChannels(list: ReadonlyArray<{ channel: number; value: number }>): void {
    for (const c of list) this.setChannel(c.channel, c.value);
  }

  isConnected(): boolean {
    return this.connected;
  }

  close(): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (this.handle && ftd) {
      try { ftd.Close(this.handle); } catch { /* ignore */ }
    }
    this.handle = null;
    this.connected = false;
    this.channels.fill(0);
  }

  // Frames are kept on a fixed clock rather than a setInterval. When the main
  // process stalls — a big render, a burst of IPC — setInterval fires its missed
  // callbacks back to back, and those bunched frames land on top of each other
  // on the wire. Here a late frame just moves the grid forward instead.
  private loop(): void {
    this.sendFrame();
    if (!this.connected) return;
    const now = Date.now();
    this.nextFrameAt += FLUSH_INTERVAL_MS;
    if (this.nextFrameAt <= now) this.nextFrameAt = now + FLUSH_INTERVAL_MS;
    this.timer = setTimeout(() => this.loop(), this.nextFrameAt - now);
  }

  private sendFrame(): void {
    if (!this.handle || !ftd) return;
    try {
      // Never start a frame on top of one that is still leaving: the break
      // would cut it in half and the fixture would act on a corrupt packet.
      // FT_GetStatus reports what the driver has not handed to the chip yet.
      const rx = [0], tx = [0], ev = [0];
      if (ftd.GetStatus(this.handle, rx, tx, ev) === FT_OK && tx[0] > 0) return;

      ftd.SetBreakOn(this.handle);
      spinMicros(BREAK_US);
      ftd.SetBreakOff(this.handle);
      spinMicros(MAB_US);
      this.channels.copy(this.frame, 1);
      const written = [0];
      const st = ftd.Write(this.handle, this.frame, 513, written);
      if (st !== FT_OK && !this.writeErrorLogged) {
        console.warn(`[enttec] FT_Write failed: ${ftStatus(st)}`);
        this.writeErrorLogged = true;
      } else if (st === FT_OK) {
        this.writeErrorLogged = false;
      }
    } catch { /* device disconnected */ }
  }
}
