import { ipcMain, type BrowserWindow } from 'electron';
import { ArtNetService } from '../services/ArtNetService';
import { ArtNetInputService } from '../services/ArtNetInputService';

// Shared with the DMX player, which sends through the same sockets.
export const artnetOut = new ArtNetService();
const svc = artnetOut;
export let artnetIn: ArtNetInputService | null = null;

export function registerArtNetHandlers(win: BrowserWindow): void {
  ipcMain.handle('tr:artnet:configure', (_e, config) => {
    svc.configure(config.outputs ?? []);
    return { ok: true };
  });

  ipcMain.on('tr:artnet:sendChannel', (_e, p) =>
    svc.setChannel(p.outputId, p.universe, p.channel, p.value)
  );

  ipcMain.on('tr:artnet:sendUniverse', (_e, p) =>
    svc.setChannels(p.outputId, p.universe, p.channels)
  );

  // ── Input ──
  const input = artnetIn = new ArtNetInputService(
    (frame) => { if (!win.isDestroyed()) win.webContents.send('tr:dmxIn:frame', frame); },
    (status) => { if (!win.isDestroyed()) win.webContents.send('tr:dmxIn:status', status); },
    () => svc.localPort(),
  );

  ipcMain.handle('tr:artnet:listen', (_e, p) => input.listen(p?.bindHost, p?.universes));
  ipcMain.handle('tr:artnet:stopListen', () => { input.stop(); return { ok: true }; });
  win.on('closed', () => input.stop());
}
