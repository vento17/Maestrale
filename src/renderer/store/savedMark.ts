import type { Project } from '../../shared/types/project';

// Which project object is the one on disk. Every edit makes a new project object
// (immer), so "unchanged since the last save" is simply: same object.
let saved: Project | null = null;

export function markSaved(p: Project | null): void { saved = p; }
export function isSaved(p: Project): boolean { return p === saved; }

// "Close without saving": the last autosave on the way out is skipped, so the
// next start opens the saved file and not the changes you threw away.
let discarding = false;
export function setDiscarding(on: boolean): void { discarding = on; }
export function isDiscarding(): boolean { return discarding; }
