import { ipcMain, type BrowserWindow } from 'electron';
import type { DmxMonitorWatch } from '../../shared/types/ipc';
import { artnetIn, artnetOut } from './artnetHandlers';
import { sacnOut, sacnIn } from './sacnHandlers';

// DMX monitor widgets. Each one watches a single universe, in or out, possibly
// narrowed to one sender / one destination. Only watched universes are read,
// and a frame is sent only when it changed — nothing runs when no one looks.
const FRAME_MS = 50;

export function registerDmxMonitorHandlers(win: BrowserWindow): void {
  const watchers = new Map<string, DmxMonitorWatch>();
  const last = new Map<string, string>();
  let timer: NodeJS.Timeout | null = null;

  const read = (w: DmxMonitorWatch): Uint8Array => {
    if (w.direction === 'in') {
      const src = w.protocol === 'sacn' ? sacnIn : artnetIn;
      if (!src) return new Uint8Array(512);
      const f = w.sourceIp ? src.frameFrom(w.sourceIp, w.universe) : src.currentFrames().get(w.universe);
      return f ?? new Uint8Array(512);
    }
    return (w.protocol === 'sacn' ? sacnOut : artnetOut).snapshot(w.universe, w.outputId || undefined);
  };

  const tick = () => {
    for (const [id, w] of watchers) {
      const data = read(w);
      const sig = Buffer.from(data.buffer, data.byteOffset, Math.min(512, data.length)).toString('base64');
      if (last.get(id) === sig) continue;
      last.set(id, sig);
      if (!win.isDestroyed()) win.webContents.send('tr:dmxMon:frame', { watcherId: id, data: Array.from(data.subarray(0, 512)) });
    }
  };

  ipcMain.handle('tr:dmxMon:watch', (_e, p) => {
    if ('off' in p) { watchers.delete(p.watcherId); last.delete(p.watcherId); }
    else { watchers.set(p.watcherId, p); last.delete(p.watcherId); }
    if (watchers.size && !timer) timer = setInterval(tick, FRAME_MS);
    if (!watchers.size && timer) { clearInterval(timer); timer = null; }
    return { ok: true };
  });
  win.on('closed', () => { if (timer) clearInterval(timer); });
}
