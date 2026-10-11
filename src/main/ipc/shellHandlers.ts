import { ipcMain, app, shell } from 'electron';
import type { BrowserWindow } from 'electron';
import { exec } from 'child_process';

// Shell widget: runs a named action. The renderer only ever sends an action id
// and its argument; the command lines live here.

function run(cmd: string): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    exec(cmd, { windowsHide: true }, (err) => resolve(err ? { ok: false, error: err.message } : { ok: true }));
  });
}

const win32 = process.platform === 'win32';
const q = (s: string): string => `"${s.replace(/"/g, '')}"`;

export function registerShellHandlers(win: BrowserWindow): void {
  ipcMain.handle('tr:shell:run', async (_e, { action, arg, delay }: { action: string; arg?: string; delay?: number }) => {
    const t = Math.max(0, Math.min(600, Math.round(delay ?? 0)));
    const a = (arg ?? '').trim();
    try {
      switch (action) {
        case 'shutdown':       return win32 ? run(`shutdown /s /t ${t}`) : run(`shutdown -h +${Math.ceil(t / 60)}`);
        case 'restart':        return win32 ? run(`shutdown /r /t ${t}`) : run(`shutdown -r +${Math.ceil(t / 60)}`);
        case 'signOut':        return win32 ? run('shutdown /l') : { ok: false, error: 'Windows only' };
        case 'cancelShutdown': return win32 ? run('shutdown /a') : run('shutdown -c');
        case 'sleep':          return win32 ? run('rundll32.exe powrprof.dll,SetSuspendState 0,1,0') : run('systemctl suspend');
        case 'hibernate':      return win32 ? run('shutdown /h') : run('systemctl hibernate');
        case 'lock':           return win32 ? run('rundll32.exe user32.dll,LockWorkStation') : { ok: false, error: 'Windows only' };
        case 'monitorsOff':
          return win32
            ? run(`powershell -NoProfile -WindowStyle Hidden -Command "(Add-Type '[DllImport(\\"user32.dll\\")]public static extern int PostMessage(int h,int m,int w,int l);' -Name a -Pas)::PostMessage(0xffff,0x0112,0xF170,2)"`)
            : { ok: false, error: 'Windows only' };
        case 'quitApp':        setTimeout(() => win.close(), 300); return { ok: true };
        case 'restartApp':     setTimeout(() => { app.relaunch(); app.exit(0); }, 300); return { ok: true };
        case 'openFile': {
          if (!a) return { ok: false, error: 'no path' };
          const err = await shell.openPath(a);
          return err ? { ok: false, error: err } : { ok: true };
        }
        case 'openFolder': {
          if (!a) return { ok: false, error: 'no folder' };
          const err = await shell.openPath(a);
          return err ? { ok: false, error: err } : { ok: true };
        }
        case 'openUrl': {
          if (!a) return { ok: false, error: 'no address' };
          await shell.openExternal(/^[a-z]+:\/\//i.test(a) ? a : `https://${a}`);
          return { ok: true };
        }
        case 'killProcess':    return a ? (win32 ? run(`taskkill /IM ${q(a)} /F`) : run(`pkill -f ${q(a)}`)) : { ok: false, error: 'no program' };
        case 'custom':         return a ? run(a) : { ok: false, error: 'no command' };
        default:               return { ok: false, error: `unknown action ${action}` };
      }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
}
