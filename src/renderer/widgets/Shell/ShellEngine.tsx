import { useEffect } from 'react';
import type { ShellWidget } from '../../../shared/types/project';
import { useStore } from '../../store';
import { fireShellButton } from './shellRun';

// Fires Shell buttons from their input cells (a clock row, a cue, MIDI…) on a
// rising edge — on every page, not just the one on screen, so "turn off at
// 23:00" works whatever page is showing.
export default function ShellEngine(): null {
  useEffect(() => {
    const prev = new Map<string, number>();
    const scan = (first: boolean) => {
      const st = useStore.getState();
      for (const p of st.project.pages) for (const w of p.widgets) {
        if (w.kind !== 'shell') continue;
        const cells = st.runtime.widgets[w.id]?.cells ?? [];
        (w as ShellWidget).buttons.forEach((b, i) => {
          const k = `${w.id}:${b.id}`;
          const v = cells[i]?.value ?? 0;
          const was = prev.get(k);
          prev.set(k, v);
          if (!first && (was ?? 0) < 0.5 && v >= 0.5) fireShellButton(w as ShellWidget, i);
        });
      }
    };
    scan(true);
    return useStore.subscribe(() => scan(false));
  }, []);
  return null;
}
