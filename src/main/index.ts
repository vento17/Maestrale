import { app, BrowserWindow, shell, session } from 'electron';
import { join } from 'path';
import { spawn, ChildProcess } from 'child_process';
import { is } from '@electron-toolkit/utils';
import { registerAllHandlers } from './ipc/router';

let mainWindow: BrowserWindow | null = null;
let sidecar: ChildProcess | null = null;

// The sidecar's own stdout is invisible in a packaged build, so its startup
// lines — "Spout: OK", "NDI unavailable: …", "numpy/Pillow missing" — never
// reached anyone hitting a blank video widget. Push them into the in-app log.
// The sidecar starts before the window exists and long before React subscribes,
// and its FIRST lines are the diagnostic ones. Hold them until someone can hear.
const sidecarBacklog: { level: 'info' | 'error'; text: string }[] = [];
let sidecarLogReady = false;

function relaySidecar(level: 'info' | 'error', data: Buffer | string): void {
  const text = String(data).trimEnd();
  if (!text) return;
  process.stdout.write(`[sidecar] ${text}
`);
  if (sidecarLogReady && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('tr:sidecar:log', { level, text });
  } else {
    if (sidecarBacklog.length < 200) sidecarBacklog.push({ level, text });
  }
}

function flushSidecarLog(): void {
  sidecarLogReady = true;
  if (!mainWindow || mainWindow.isDestroyed()) return;
  for (const entry of sidecarBacklog) mainWindow.webContents.send('tr:sidecar:log', entry);
  sidecarBacklog.length = 0;
}

function startSidecar(): void {
  // The Spout/NDI video sidecar is Windows-only (Spout needs SpoutLibrary.dll).
  // Skip it elsewhere so the app runs on macOS/Linux without those widgets —
  // Windows behaviour is unchanged.
  if (process.platform !== 'win32') {
    console.log('[sidecar] skipped — Windows only');
    return;
  }
  let cmd: string;
  let args: string[];
  if (is.dev) {
    cmd = 'python';
    args = [join(app.getAppPath(), 'src/main/sidecar/server.py')];
  } else {
    cmd = join(process.resourcesPath, 'sidecar', 'sidecar.exe');
    args = [];
  }
  try {
    sidecar = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    // Never let a missing/failed sidecar crash the app (unhandled 'error' event).
    sidecar.on('error', (err) => { relaySidecar('error', `failed to start: ${err.message}`); sidecar = null; });
    sidecar.stdout?.on('data', (d: Buffer) => relaySidecar('info', d));
    sidecar.stderr?.on('data', (d: Buffer) => relaySidecar('error', d));
    sidecar.on('exit', (code) => { relaySidecar(code ? 'error' : 'info', `exited ${code}`); sidecar = null; });
  } catch (err) {
    console.error('[sidecar] spawn error:', err);
    sidecar = null;
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    title: 'LiveForge',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      backgroundThrottling: false,
    },
  });

  // Opens full screen (a show tool lives on the whole display). F11 toggles.
  mainWindow.on('ready-to-show', () => {
    mainWindow!.show();
    mainWindow!.setFullScreen(true);
  });
  mainWindow.webContents.on('before-input-event', (_e, input) => {
    if (input.type === 'keyDown' && input.key === 'F11' && mainWindow) mainWindow.setFullScreen(!mainWindow.isFullScreen());
  });

  // Renderer is up: hand it whatever the sidecar said while it was booting.
  mainWindow.webContents.on('did-finish-load', flushSidecarLog);

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: 'deny' };
  });

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }

  registerAllHandlers(mainWindow);
}

app.whenReady().then(() => {
  // Electron exposes camera + microphone access under the single 'media'
  // permission — there is no separate 'camera' value.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'media');
  });
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => {
    return permission === 'media';
  });
  startSidecar();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => {
  sidecar?.kill();
});

app.on('window-all-closed', () => {
  sidecar?.kill();
  if (process.platform !== 'darwin') app.quit();
});
