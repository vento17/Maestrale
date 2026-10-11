import { ipcMain, screen, app } from 'electron';
import type { BrowserWindow } from 'electron';
import { readFileSync, writeFileSync } from 'fs';
import path from 'path';

// Which display Maestrale lives on, remembered between launches.
const prefPath = (): string => path.join(app.getPath('userData'), 'window.json');
export function savedDisplayBounds(): Electron.Rectangle | null {
  try {
    const { displayId } = JSON.parse(readFileSync(prefPath(), 'utf8')) as { displayId?: number };
    const d = screen.getAllDisplays().find((x) => x.id === displayId);
    return d ? d.workArea : null;   // that screen may be unplugged: then the default one
  } catch { return null; }
}
function rememberDisplay(win: BrowserWindow): void {
  try { writeFileSync(prefPath(), JSON.stringify({ displayId: screen.getDisplayMatching(win.getBounds()).id })); } catch { /* not vital */ }
}

export function registerWindowHandlers(win: BrowserWindow): void {
  const state = () => ({ fullscreen: win.isFullScreen(), displays: screen.getAllDisplays().length });
  const notify = () => { if (!win.isDestroyed()) win.webContents.send('tr:window:changed', state()); };
  win.on('enter-full-screen', notify);
  win.on('leave-full-screen', notify);
  win.on('moved', () => rememberDisplay(win));
  screen.on('display-added', notify);
  screen.on('display-removed', notify);

  ipcMain.handle('tr:window:fullscreen', (_e, fullscreen: boolean) => {
    if (win.isDestroyed()) return;
    if (win.isFullScreen() === fullscreen) return;
    win.setFullScreen(fullscreen);
  });
  ipcMain.handle('tr:window:state', () => state());
  // Start Maestrale with Windows (installations). null = just ask.
  ipcMain.handle('tr:app:autostart', (_e, on: boolean | null) => {
    if (typeof on === 'boolean') app.setLoginItemSettings({ openAtLogin: on });
    return app.getLoginItemSettings().openAtLogin;
  });
  ipcMain.handle('tr:window:toggleFullscreen', () => {
    if (!win.isDestroyed()) win.setFullScreen(!win.isFullScreen());
  });
  // Jump to the next screen, keeping full screen if it was on.
  ipcMain.handle('tr:window:nextDisplay', () => {
    if (win.isDestroyed()) return;
    const all = screen.getAllDisplays();
    if (all.length < 2) return;
    const cur = screen.getDisplayMatching(win.getBounds());
    const next = all[(all.findIndex((d) => d.id === cur.id) + 1) % all.length];
    // Windows restores the old bounds a moment AFTER leaving full screen, which
    // undid the move (a flash, then back). So: leave, wait, un-maximise, move,
    // wait, and only then go full screen again — on the new screen.
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const wasFull = win.isFullScreen();
    void (async () => {
      if (wasFull) { win.setFullScreen(false); await wait(400); }
      if (win.isMaximized()) { win.unmaximize(); await wait(150); }
      const a = next.workArea;
      win.setBounds({ x: a.x + 40, y: a.y + 40, width: Math.min(1440, a.width - 80), height: Math.min(900, a.height - 80) });
      await wait(150);
      if (screen.getDisplayMatching(win.getBounds()).id !== next.id) {   // still not there: once more
        win.setPosition(a.x + 40, a.y + 40); await wait(150);
      }
      if (wasFull) win.setFullScreen(true);
      rememberDisplay(win);
    })();
  });
}
