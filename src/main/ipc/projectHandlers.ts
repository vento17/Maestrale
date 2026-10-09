import { ipcMain, dialog, app } from 'electron';
import { mkdir, stat, readFile, writeFile } from 'fs/promises';
import path from 'path';
import { ProjectService } from '../services/ProjectService';

const svc = new ProjectService();

const saveDir = app.isPackaged
  ? path.join(path.dirname(app.getPath('exe')), 'Save')
  : path.join(process.cwd(), 'Save');

// One rolling file, not a timestamped pile: the point is "what was on screen
// when it died", and a folder of hundreds of snapshots is its own problem.
const recoveryPath = path.join(app.getPath('userData'), 'recovery.liveforge');

// The project last saved or opened, reopened at the next start without asking —
// an installation PC just boots into its show.
const sessionPath = path.join(app.getPath('userData'), 'session.json');
// The file the open project lives in — what Ctrl+S writes to. Empty for a
// project that was never saved (New, or one rebuilt from the autosave).
let currentPath = '';
async function rememberProject(file: string): Promise<void> {
  currentPath = file;
  try { await mkdir(path.dirname(sessionPath), { recursive: true }); await writeFile(sessionPath, JSON.stringify({ lastProject: file }, null, 2)); } catch { /* not vital */ }
}

export function registerProjectHandlers(): void {
  ipcMain.handle('tr:project:openLast', async () => {
    try {
      const { lastProject } = JSON.parse(await readFile(sessionPath, 'utf8')) as { lastProject?: string };
      if (lastProject) {
        const project = await svc.read(lastProject);
        if (project) { currentPath = lastProject; return { project, path: lastProject, from: 'saved' as const }; }
      }
    } catch { /* no session yet */ }
    // Nothing saved yet: whatever was on screen last time (the autosave).
    try {
      const project = await svc.read(recoveryPath);
      if (project) return { project, path: '', from: 'autosave' as const };
    } catch { /* first run */ }
    return null;
  });

  ipcMain.handle('tr:project:autosave', async (_e, project) => {
    try {
      await mkdir(path.dirname(recoveryPath), { recursive: true });
      await svc.writeAtomic(recoveryPath, project);
      return { ok: true };
    } catch {
      // Autosave must never break the show: a failed write is not worth an error
      // dialog mid-performance.
      return { ok: false };
    }
  });

  // The renderer flushes one last autosave on beforeunload with send(), not
  // invoke(): an async invoke during teardown has nowhere to deliver its reply.
  // A send() to a handle()-only channel is dropped without a word, so the same
  // work is registered both ways.
  ipcMain.on('tr:project:autosave', (_e, project) => {
    void (async () => {
      try {
        await mkdir(path.dirname(recoveryPath), { recursive: true });
        await svc.writeAtomic(recoveryPath, project);
      } catch { /* never break teardown over a backup */ }
    })();
  });

  ipcMain.handle('tr:project:recoverRead', async () => {
    try {
      const info = await stat(recoveryPath);
      const project = await svc.read(recoveryPath);
      if (!project) return null;
      return { project, savedAt: info.mtime.toISOString() };
    } catch {
      return null;   // nothing to recover
    }
  });

  ipcMain.handle('tr:project:recoverClear', async () => {
    await svc.remove(recoveryPath);
    return { ok: true };
  });

  // Ctrl+S / Save: straight into the project's file; asks for a name and a
  // place only the first time.
  ipcMain.handle('tr:project:saveQuick', async (_e, project) => {
    if (!currentPath) return saveAs(project);
    await svc.write(currentPath, project);
    await rememberProject(currentPath);
    await svc.remove(recoveryPath);
    return { ok: true, path: currentPath };
  });
  ipcMain.handle('tr:project:forget', async () => { currentPath = ''; });
  ipcMain.handle('tr:project:save', async (_e, project) => saveAs(project));
  async function saveAs(project: Parameters<typeof svc.write>[1]): Promise<{ ok: boolean; path: string }> {
    await mkdir(saveDir, { recursive: true });
    const safeName = (project.name || 'project').replace(/[^a-z0-9_\- ]/gi, '_');
    const { filePath, canceled } = await dialog.showSaveDialog({
      title: 'Save Project As',
      defaultPath: currentPath || path.join(saveDir, `${safeName}.liveforge`),
      filters: [{ name: 'LiveForge Project', extensions: ['liveforge', 'json'] }],
    });
    if (canceled || !filePath) return { ok: false, path: '' };
    await svc.write(filePath, project);
    await rememberProject(filePath);
    // The work is on disk where the user put it; the recovery copy has done its
    // job and would otherwise offer to restore on the next launch.
    await svc.remove(recoveryPath);
    return { ok: true, path: filePath };
  }

  ipcMain.handle('tr:project:load', async () => {
    const { filePaths, canceled } = await dialog.showOpenDialog({
      title: 'Open Project',
      filters: [{ name: 'LiveForge Project', extensions: ['liveforge', 'surfrig', 'json'] }],
      properties: ['openFile'],
    });
    if (canceled || !filePaths[0]) return null;
    const project = await svc.read(filePaths[0]);
    if (project) await rememberProject(filePaths[0]);
    return project;
  });

  ipcMain.handle('tr:project:backup', async (_e, project) => {
    const backupDir = path.join(app.getPath('userData'), 'backup');
    await mkdir(backupDir, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const safeName = (project.name || 'project').replace(/[^a-z0-9_-]/gi, '_');
    const filePath = path.join(backupDir, `${safeName}_${timestamp}.json`);
    await svc.write(filePath, project);
    return { ok: true, path: filePath };
  });
}
