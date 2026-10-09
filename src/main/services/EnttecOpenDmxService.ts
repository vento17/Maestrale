import koffi from 'koffi';

const FLUSH_INTERVAL_MS = 22; // ~44 Hz
const FT_OK = 0;
const FT_BITS_8 = 8;
const FT_STOP_BITS_2 = 2;
const FT_PARITY_NONE = 0;
const FT_FLOW_NONE = 0x0000;
const FT_PURGE_RX = 1;
const FT_PURGE_TX = 2;

function loadFtd2xx() {
  const paths = [
    'ftd2xx64.dll',
    'ftd2xx.dll',
    'C:\\Windows\\System32\\ftd2xx64.dll',
    'C:\\Windows\\System32\\ftd2xx.dll',
    'C:\\Windows\\SysWOW64\\ftd2xx.dll',
  ];
  for (const p of paths) {
    try { return koffi.load(p); } catch { /* try next */ }
  }
  throw new Error('FTDI D2XX driver not found. Install the driver from https://ftdichip.com/drivers/d2xx-drivers/');
}

export interface EnttecDeviceInfo {
  index: number;
  description: string;
  serialNumber: string;
}

export class EnttecOpenDmxService {
  private handle: unknown = null;
  private channels = Buffer.alloc(512, 0); // index 0 = DMX ch 1, index 511 = DMX ch 512
  private timer: NodeJS.Timeout | null = null;
  private connected = false;

  private fnBreakOn:  ((h: unknown) => number) | null = null;
  private fnBreakOff: ((h: unknown) => number) | null = null;
  private fnWrite:    ((h: unknown, data: Buffer, len: number, written: number[]) => number) | null = null;
  private fnClose:    ((h: unknown) => number) | null = null;

  listDevices(): EnttecDeviceInfo[] {
    const lib = loadFtd2xx();
    const results: EnttecDeviceInfo[] = [];
    try {
      const FT_CreateDeviceInfoList = lib.func('__stdcall', 'FT_CreateDeviceInfoList', 'uint32', [koffi.out(koffi.pointer('uint32'))]);
      const FT_GetDeviceInfoDetail   = lib.func('__stdcall', 'FT_GetDeviceInfoDetail', 'uint32', [
        'uint32',
        koffi.out(koffi.pointer('uint32')),
        koffi.out(koffi.pointer('uint32')),
        koffi.out(koffi.pointer('uint32')),
        koffi.out(koffi.pointer('uint32')),
        'void *',
        'void *',
        koffi.out(koffi.pointer('void')),
      ]);

      const countArr = [0];
      if (FT_CreateDeviceInfoList(countArr) !== FT_OK) return results;
      const count = countArr[0] as number;

      for (let i = 0; i < count; i++) {
        const flagsArr = [0], typeArr = [0], idArr = [0], locIdArr = [0], handleArr = [null];
        const serialBuf = Buffer.alloc(16, 0);
        const descBuf   = Buffer.alloc(64, 0);
        const st = FT_GetDeviceInfoDetail(i, flagsArr, typeArr, idArr, locIdArr, serialBuf, descBuf, handleArr);
        results.push({
          index: i,
          description: st === FT_OK ? descBuf.toString('ascii').replace(/\0/g, '').trim() : `Device ${i}`,
          serialNumber: st === FT_OK ? serialBuf.toString('ascii').replace(/\0/g, '').trim() : '',
        });
      }
    } catch { /* old driver version — caller gets empty list */ }
    return results;
  }

  open(deviceIndex: number): void {
    this.close();
    const lib = loadFtd2xx();

    const FT_Open                    = lib.func('__stdcall', 'FT_Open',                    'uint32', ['int', koffi.out(koffi.pointer('void'))]);
    const FT_SetBaudRate             = lib.func('__stdcall', 'FT_SetBaudRate',             'uint32', ['void *', 'uint32']);
    const FT_SetDataCharacteristics  = lib.func('__stdcall', 'FT_SetDataCharacteristics',  'uint32', ['void *', 'uint8', 'uint8', 'uint8']);
    const FT_SetFlowControl          = lib.func('__stdcall', 'FT_SetFlowControl',          'uint32', ['void *', 'uint16', 'uint8', 'uint8']);
    const FT_SetTimeouts             = lib.func('__stdcall', 'FT_SetTimeouts',             'uint32', ['void *', 'uint32', 'uint32']);
    const FT_Purge                   = lib.func('__stdcall', 'FT_Purge',                   'uint32', ['void *', 'uint32']);
    this.fnBreakOn  = lib.func('__stdcall', 'FT_SetBreakOn',  'uint32', ['void *']) as (h: unknown) => number;
    this.fnBreakOff = lib.func('__stdcall', 'FT_SetBreakOff', 'uint32', ['void *']) as (h: unknown) => number;
    this.fnWrite    = lib.func('__stdcall', 'FT_Write', 'uint32', ['void *', 'void *', 'uint32', koffi.out(koffi.pointer('uint32'))]) as (h: unknown, d: Buffer, n: number, w: number[]) => number;
    this.fnClose    = lib.func('__stdcall', 'FT_Close', 'uint32', ['void *']) as (h: unknown) => number;

    const handleArr = [null];
    const st = FT_Open(deviceIndex, handleArr);
    if (st !== FT_OK) throw new Error(`FT_Open(${deviceIndex}) failed with status ${st}`);
    this.handle = handleArr[0];

    FT_SetBaudRate(this.handle, 250000);
    FT_SetDataCharacteristics(this.handle, FT_BITS_8, FT_STOP_BITS_2, FT_PARITY_NONE);
    FT_SetFlowControl(this.handle, FT_FLOW_NONE, 0, 0);
    FT_SetTimeouts(this.handle, 500, 500);
    FT_Purge(this.handle, FT_PURGE_RX | FT_PURGE_TX);

    this.connected = true;
    this.timer = setInterval(() => this.sendFrame(), FLUSH_INTERVAL_MS);
  }

  // The 512 channels as they are being sent (index 0 = ch 1) — for the recorder.
  snapshot(): Uint8Array { return new Uint8Array(this.channels); }

  setChannel(channel: number, value: number): void {
    if (channel < 1 || channel > 512) return;
    this.channels[channel - 1] = Math.max(0, Math.min(255, Math.round(value)));
  }

  isConnected(): boolean {
    return this.connected;
  }

  close(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    if (this.handle && this.fnClose) {
      try { this.fnClose(this.handle); } catch { /* ignore */ }
    }
    this.handle = null;
    this.fnBreakOn = null;
    this.fnBreakOff = null;
    this.fnWrite = null;
    this.fnClose = null;
    this.connected = false;
    this.channels.fill(0);
  }

  private sendFrame(): void {
    if (!this.handle || !this.fnBreakOn || !this.fnBreakOff || !this.fnWrite) return;
    try {
      this.fnBreakOn(this.handle);
      this.fnBreakOff(this.handle);
      // DMX frame: start code 0x00 + 512 channel bytes
      const frame = Buffer.alloc(513, 0);
      this.channels.copy(frame, 1);
      const written = [0];
      this.fnWrite(this.handle, frame, 513, written);
    } catch { /* device disconnected */ }
  }
}
