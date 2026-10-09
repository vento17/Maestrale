import { ipcMain, type BrowserWindow } from 'electron';
import { SacnService } from '../services/SacnService';
import { SacnInputService } from '../services/SacnInputService';

// Shared with the DMX player.
export const sacnOut = new SacnService();
const svc = sacnOut;
export let sacnIn: SacnInputService | null = null;

export function registerSacnHandlers(win: BrowserWindow): void {
  const input = sacnIn = new SacnInputService(
    (frame) => { if (!win.isDestroyed()) win.webContents.send('tr:dmxIn:frame', frame); },
    (status) => { if (!win.isDestroyed()) win.webContents.send('tr:dmxIn:status', status); },
    () => svc.localPort(),
  );
  ipcMain.handle('tr:sacn:listen', (_e, p) => input.listen(p?.bindHost, p?.universes));
  ipcMain.handle('tr:sacn:stopListen', () => { input.stop(); return { ok: true }; });
  win.on('closed', () => input.stop());

  ipcMain.handle('tr:sacn:configure', (_e, config) => {
    svc.configure(config.priority, config.outputs ?? []);
    return { ok: true };
  });

  ipcMain.on('tr:sacn:sendChannel', (_e, p) =>
    svc.setChannel(p.outputId, p.universe, p.channel, p.value, p.priority)
  );

  ipcMain.on('tr:sacn:sendUniverse', (_e, p) =>
    svc.setChannels(p.outputId, p.universe, p.channels, p.priority)
  );
}
