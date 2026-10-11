import { ipcMain, app, dialog, shell, type BrowserWindow } from 'electron';
import path from 'path';
import fs from 'fs';
import { DmxTakeService } from '../services/DmxTakeService';
import { artnetIn, artnetOut } from './artnetHandlers';
import { sacnOut, sacnIn } from './sacnHandlers';
import { enttecOut } from './enttecHandlers';
import type { DmxRecSource } from '../../shared/types/ipc';

// What Maestrale itself sends, as frames: the recorder samples it at 44 Hz
// when its source is one of the outputs.
function outputFrames(source: DmxRecSource): Map<number, Uint8Array> {
  const m = new Map<number, Uint8Array>();
  if (source === 'out-artnet') for (const u of artnetOut.universesInUse()) m.set(u, artnetOut.snapshot(u));
  else if (source === 'out-sacn') for (const u of sacnOut.universesInUse()) m.set(u, sacnOut.snapshot(u));
  else if (source === 'out-enttec') m.set(0, enttecOut.snapshot());
  return m;
}

// Same folder convention as projects: next to the exe when packaged, the repo
// when running from source — so takes travel with the show folder.
const baseDir = app.isPackaged
  ? path.join(path.dirname(app.getPath('exe')), 'Save')
  : path.join(process.cwd(), 'Save');

export function registerDmxTakeHandlers(win: BrowserWindow): void {
  const send = (ch: string, p: unknown) => { if (!win.isDestroyed()) win.webContents.send(ch, p); };
  const svc = new DmxTakeService(
    baseDir,
    (source) => (source === 'sacn' ? sacnIn?.currentFrames() : source === 'artnet' ? artnetIn?.currentFrames() : outputFrames(source)) ?? new Map(),
    {
      send: (protocol, outputId, universe, channels) => {
        if (protocol === 'sacn') sacnOut.setChannels(outputId, universe, channels);
        else artnetOut.setChannels(outputId, universe, channels);
      },
    },
    (s) => send('tr:dmxRec:status', s),
    (s) => send('tr:dmxPlay:status', s),
  );
  // Folders: chosen in Settings, remembered on THIS computer (not in the
  // project — a path means nothing on another machine). Default: Documents/
  // Maestrale/Recordings. The old Save/Recordings is still read if it exists.
  const cfgFile = path.join(app.getPath('userData'), 'dmx-recordings.json');
  const defaultDir = path.join(app.getPath('documents'), 'Maestrale', 'Recordings');
  // Older folders are still played from: Save/Recordings, and Documents/
  // LiveForge/Recordings from before the app was renamed.
  const legacyDirs = [path.join(baseDir, 'Recordings'), path.join(app.getPath('documents'), 'LiveForge', 'Recordings')];
  const loadCfg = (): { record: string; play: string } => {
    try {
      const c = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
      if (c && typeof c.record === 'string' && typeof c.play === 'string') return c;
    } catch { /* first run */ }
    return { record: defaultDir, play: defaultDir };
  };
  const apply = (c: { record: string; play: string }) => svc.setFolders(c.record, c.play, legacyDirs.filter((d) => fs.existsSync(d)));
  apply(loadCfg());
  ipcMain.handle('tr:dmxRec:getFolders', () => svc.folders());
  ipcMain.handle('tr:dmxRec:setFolders', (_e, p) => {
    const cur = svc.folders();
    const next = { record: (p?.record ?? cur.record).trim() || defaultDir, play: (p?.play ?? cur.play).trim() || defaultDir };
    try { fs.mkdirSync(next.record, { recursive: true }); } catch (e) { return { ok: false, error: (e as Error).message, ...cur }; }
    apply(next);
    try { fs.mkdirSync(path.dirname(cfgFile), { recursive: true }); fs.writeFileSync(cfgFile, JSON.stringify(next, null, 2)); } catch { /* still applied */ }
    return { ok: true, ...next };
  });
  ipcMain.handle('tr:dmxRec:pickFolder', async (_e, p) => {
    const r = await dialog.showOpenDialog(win, { title: p?.title ?? 'Choose a folder', defaultPath: p?.current, properties: ['openDirectory', 'createDirectory'] });
    return r.canceled || !r.filePaths[0] ? null : r.filePaths[0];
  });
  ipcMain.handle('tr:dmxRec:openFolder', async (_e, p) => {
    const dir = p?.which === 'play' ? svc.folders().play : svc.folders().record;
    try { fs.mkdirSync(dir, { recursive: true }); } catch { /* */ }
    await shell.openPath(dir);
    return { ok: true };
  });

  // registerArtNetHandlers runs first, so the receiver exists by now.
  artnetIn?.tap((u, data) => svc.onFrame(u, data, 'artnet'));
  sacnIn?.tap((u, data) => svc.onFrame(u, data, 'sacn'));

  let sampler: NodeJS.Timeout | null = null;
  ipcMain.handle('tr:dmxRec:start', (_e, p) => {
    const source: DmxRecSource = p?.protocol ?? 'artnet';
    const r = svc.startRecording(p?.name, p?.universes, source);
    if (r.ok && source.startsWith('out-')) {
      if (sampler) clearInterval(sampler);
      sampler = setInterval(() => {
        if (!svc.isRecording()) { if (sampler) clearInterval(sampler); sampler = null; return; }
        for (const [u, f] of outputFrames(source)) svc.onFrame(u, f, source);
      }, 23);
    }
    return r;
  });
  ipcMain.handle('tr:dmxRec:stop', () => svc.stopRecording());
  ipcMain.handle('tr:dmxRec:list', () => svc.list());
  ipcMain.handle('tr:dmxRec:rename', (_e, p) => ({ ok: svc.rename(p.takeId, p.name) }));
  ipcMain.handle('tr:dmxRec:delete', (_e, p) => ({ ok: svc.delete(p.takeId) }));
  ipcMain.handle('tr:dmxPlay:play', (_e, p) => svc.play(p.playerId, p.config, p.fromMs));
  ipcMain.handle('tr:dmxPlay:pause', (_e, p) => { svc.pause(p.playerId); return { ok: true }; });
  ipcMain.handle('tr:dmxPlay:stop', (_e, p) => { svc.stop(p.playerId); return { ok: true }; });
  ipcMain.handle('tr:dmxPlay:seek', (_e, p) => { svc.seek(p.playerId, p.ms); return { ok: true }; });
  ipcMain.handle('tr:dmxPlay:configure', (_e, p) => { svc.configure(p.playerId, p.config); return { ok: true }; });
  // Never lose a take: closing the window mid-recording finalises the file.
  win.on('closed', () => svc.shutdown());
}
