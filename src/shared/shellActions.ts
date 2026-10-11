// The actions a Shell widget button can run, by name — the command behind each
// one lives in main (shellHandlers). `arg` = what the action needs (a path, a
// web address, a command line); `power` = it switches the PC off / restarts,
// so it waits `delay` seconds first (Cancel in the widget, or another press).

export interface ShellActionDef {
  id: string;
  name: string;
  group: string;
  arg?: string;        // label of the extra field, if the action needs one
  power?: boolean;
  hint: string;
}

export const SHELL_ACTIONS: ShellActionDef[] = [
  { id: 'shutdown', name: 'Turn off PC', group: 'Power', power: true, hint: 'Saves where Maestrale is, then switches the computer off.' },
  { id: 'restart', name: 'Restart PC', group: 'Power', power: true, hint: 'Saves where Maestrale is, then restarts the computer.' },
  { id: 'sleep', name: 'Sleep', group: 'Power', hint: 'Puts the computer to sleep.' },
  { id: 'hibernate', name: 'Hibernate', group: 'Power', hint: 'Hibernates the computer (if Windows allows it).' },
  { id: 'cancelShutdown', name: 'Cancel turn off / restart', group: 'Power', hint: 'Stops a turn off or restart that is counting down.' },
  { id: 'monitorsOff', name: 'Turn off screens', group: 'Screen', hint: 'Screens go dark; any mouse move or touch wakes them.' },
  { id: 'lock', name: 'Lock PC', group: 'Session', hint: 'Locks Windows (Maestrale keeps running).' },
  { id: 'signOut', name: 'Sign out of Windows', group: 'Session', power: true, hint: 'Closes the Windows session.' },
  { id: 'quitApp', name: 'Close Maestrale', group: 'Maestrale', hint: 'Saves where it is and closes.' },
  { id: 'restartApp', name: 'Restart Maestrale', group: 'Maestrale', hint: 'Closes and opens Maestrale again, same project.' },
  { id: 'openFile', name: 'Open file / program', group: 'Open', arg: 'Path', hint: 'Opens a file with its program, or starts a program (.exe, .bat…).' },
  { id: 'openFolder', name: 'Open folder', group: 'Open', arg: 'Folder', hint: 'Shows a folder in Explorer.' },
  { id: 'openUrl', name: 'Open web page', group: 'Open', arg: 'Address', hint: 'Opens a web address in the default browser.' },
  { id: 'killProcess', name: 'Close a program', group: 'Open', arg: 'Program (.exe name)', hint: 'Closes every window of a program, e.g. chrome.exe.' },
  { id: 'custom', name: 'Custom command', group: 'Advanced', arg: 'Command line', hint: 'Any Windows command line (cmd). Runs as you, hidden.' },
];

export function shellAction(id: string): ShellActionDef | undefined { return SHELL_ACTIONS.find((a) => a.id === id); }
