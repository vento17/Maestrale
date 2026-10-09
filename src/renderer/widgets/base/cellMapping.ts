import { xyMapping } from '../../../shared/types/project';
import type { Project } from '../../../shared/types/project';
import type { Mapping } from '../../../shared/types/mapping';

// The protocol mapping a widget cell sends on — what a value written into that
// cell ends up as on the wire. The router engine dispatches through it, and the
// Router page reads it to show ranges in real units (a fader on MIDI → 0–127).
export function cellMapping(project: Project, widgetId: string, cellIndex: number): Mapping {
  for (const page of project.pages) {
    const w = page.widgets.find((x) => x.id === widgetId);
    if (!w) continue;
    if (w.kind === 'xyPad') return xyMapping(w, cellIndex);
    if (w.kind === 'autoBpm') {
      return cellIndex < 8
        ? (w.beatOutputs[cellIndex]?.triggerMapping ?? null)
        : (w.beatOutputs[cellIndex - 8]?.rampMapping ?? null);
    }
    if (w.kind === 'timeline') {
      const track = w.tracks[cellIndex];
      if (!track) return null;
      if (track.kind === 'value' || track.kind === 'trig') return (track as { mapping: Mapping }).mapping;
      return null;
    }
    if (w.kind === 'audioAnalyser') {
      const audioKeys = ['kickMapping', 'snareMapping', 'bassMapping', 'midMapping', 'highMapping'] as const;
      if (cellIndex < 5) return (w[audioKeys[cellIndex]] ?? null) as Mapping;
      if (cellIndex < 13) return (w.beatOutputs?.[cellIndex - 5]?.triggerMapping ?? null);
      return (w.beatOutputs?.[cellIndex - 13]?.rampMapping ?? null);
    }
    if (w.kind === 'soundPlayer') {
      return (w.tracks[cellIndex]?.playMapping ?? null) as Mapping;
    }
    if ('cells' in w && Array.isArray(w.cells)) {
      return ((w.cells as { mapping?: Mapping }[])[cellIndex]?.mapping ?? null);
    }
    if ('mapping' in w) return (w as { mapping: Mapping }).mapping;
    return null;
  }
  return null;
}

// The numbers a mapping actually puts on the wire for 0 and 1.
export function mappingScale(m: Mapping): { lo: number; hi: number; int: boolean } {
  if (!m) return { lo: 0, hi: 1, int: false };
  if (m.type === 'osc') return { lo: m.minValue ?? 0, hi: m.maxValue ?? 1, int: false };
  return { lo: m.minValue, hi: m.maxValue, int: true };
}
