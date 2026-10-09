import { ipcMain } from 'electron';
import { EnttecOpenDmxService } from '../services/EnttecOpenDmxService';

export const enttecOut = new EnttecOpenDmxService();
const svc = enttecOut;

export function registerEnttecHandlers(): void {
  ipcMain.handle('tr:enttec:listDevices', (_e) => {
    try {
      return { ok: true, devices: svc.listDevices() };
    } catch (e) {
      return { ok: false, devices: [], error: String(e) };
    }
  });

  ipcMain.handle('tr:enttec:connect', (_e, { deviceIndex }: { deviceIndex: number }) => {
    try {
      svc.open(deviceIndex);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  });

  ipcMain.handle('tr:enttec:disconnect', (_e) => {
    svc.close();
    return { ok: true };
  });

  ipcMain.on('tr:enttec:sendChannel', (_e, p: { channel: number; value: number }) => {
    svc.setChannel(p.channel, p.value);
  });
}
