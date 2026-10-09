import { pal, onPalette } from '../../palette';
import { useMemo } from 'react';
import { useStore } from '../../store';
import { computeSlavedCellSet } from './links';

// Outline drawn on a cell that is slaved (driven by a router link).
// Thin, dark, muted blue: present without shouting. Blue because a slaved cell
// is one whose INPUT is taken, and inputs are blue in Shift patching.
const make_SLAVE_OUTLINE = () => (`1px solid ${pal('#2a6468')}`);
export let SLAVE_OUTLINE = make_SLAVE_OUTLINE();
onPalette(() => { SLAVE_OUTLINE = make_SLAVE_OUTLINE(); });

// Set of cell indices of `widgetId` currently slaved by a router link. Recomputes
// only when the project changes (not on every runtime value update).
export function useSlavedCells(widgetId: string): Set<number> {
  const project = useStore((s) => s.project);
  return useMemo(() => computeSlavedCellSet(project, widgetId), [project, widgetId]);
}
