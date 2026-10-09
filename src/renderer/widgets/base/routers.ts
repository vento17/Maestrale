import type { Project, RouterRow, RouterWidget } from '../../../shared/types/project';

// Every place that holds router rows: the project's main router first, then
// each Router widget. `holder.rows` is the live array (or immer draft), so
// callers inside a store `set` can reassign it.

export const MAIN_ROUTER_ID = 'main-router';
export const MAIN_ROUTER_LABEL = 'Main';

export interface RouterHolder {
  id: string;
  label: string;
  isMain: boolean;
  pageId: string | null;
  pageName: string | null;
  holder: { rows: RouterRow[] };
}

export function eachRouter(project: Project): RouterHolder[] {
  const out: RouterHolder[] = [{
    id: MAIN_ROUTER_ID, label: MAIN_ROUTER_LABEL, isMain: true, pageId: null, pageName: null,
    holder: project.mainRouter ?? { rows: [] },
  }];
  for (const page of project.pages) {
    for (const w of page.widgets) {
      if (w.kind !== 'router') continue;
      out.push({ id: w.id, label: w.label, isMain: false, pageId: page.id, pageName: page.name, holder: w as RouterWidget });
    }
  }
  return out;
}

export function allRouterRows(project: Project): RouterRow[] {
  return eachRouter(project).flatMap((r) => r.holder.rows);
}

// For use inside a store mutation: makes sure project.mainRouter exists.
export function mainRouterRows(project: Project): { rows: RouterRow[] } {
  if (!project.mainRouter) project.mainRouter = { rows: [] };
  return project.mainRouter;
}
