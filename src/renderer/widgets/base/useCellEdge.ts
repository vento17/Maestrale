import { useEffect, useRef } from 'react';
import { useStore } from '../../store';

// Fire `onRise` when a cell's runtime value crosses 0.5 going up — how a
// trigger cell (REC, PLAY, STOP…) reacts to a Router link, a MIDI pad or an
// Art-Net channel. Holding the value high fires once.
export function useCellEdge(widgetId: string, cellIndex: number, onRise: () => void): void {
  const cb = useRef(onRise);
  cb.current = onRise;
  useEffect(() => {
    let prev = useStore.getState().runtime.widgets[widgetId]?.cells[cellIndex]?.value ?? 0;
    return useStore.subscribe((s) => {
      const v = s.runtime.widgets[widgetId]?.cells[cellIndex]?.value ?? 0;
      if (v === prev) return;
      const rose = prev < 0.5 && v >= 0.5;
      prev = v;
      if (rose) cb.current();
    });
  }, [widgetId, cellIndex]);
}
