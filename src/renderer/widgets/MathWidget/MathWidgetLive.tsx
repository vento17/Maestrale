import React, { useEffect, useRef, useState } from 'react';
import type { MathWidget } from '../../../shared/types/project';
import type { StoreState } from '../../store';
import { useStore } from '../../store';
import { dispatchValue } from '../../ipc/dispatch';
import { remapRange } from '../base/range';
import { getParamInput, onParamInputs } from '../base/paramInputs';
import { connectedInputs } from '../Merge/mergeEngine';
import { pal } from '../../palette';
import { applyOpN, opSymbol } from './mathOps';

// The Math: a box on the left takes any number of cables (Shift-drag onto it,
// like the Merge: each one becomes the next input), the result on the right.
// in 1 / in 2 fall back to the Source A / B pickers when nothing is cabled.

interface In { k: number; value: number }

function readInputs(w: MathWidget, state: StoreState): In[] {
  const out: In[] = [];
  const cabled = connectedInputs(state.project, w.id);
  for (const k of cabled) {
    const v = getParamInput(w.id, `in${k}`);
    out.push({ k, value: v ?? 0 });
  }
  const has = (k: number) => cabled.includes(k);
  if (!has(1) && w.sourceAWidgetId) out.push({ k: 1, value: state.runtime.widgets[w.sourceAWidgetId]?.cells[w.sourceACellIndex]?.value ?? 0 });
  if (!has(2) && w.sourceBWidgetId) out.push({ k: 2, value: state.runtime.widgets[w.sourceBWidgetId]?.cells[w.sourceBCellIndex]?.value ?? 0 });
  return out.sort((a, b) => a.k - b.k);
}

function compute(w: MathWidget, state: StoreState): number {
  const ins = readInputs(w, state).map((i) => i.value);
  let result = remapRange(applyOpN(ins, w.operation), w);
  if (w.clampOutput) result = Math.max(0, Math.min(1, result));
  return result * (w.gain ?? 1);
}

export default function MathWidgetLive({ widget, preview = false }: { widget: MathWidget; preview?: boolean }): React.JSX.Element {
  const widgetRef = useRef(widget);
  widgetRef.current = widget;

  useEffect(() => {
    if (preview) return;
    const tick = (): void => {
      const w = widgetRef.current;
      const state = useStore.getState();
      const result = compute(w, state);
      const current = state.runtime.widgets[w.id]?.cells[0]?.value;
      if (current === result) return;
      state.setCellValue(w.id, 0, result);
      if (w.mapping) dispatchValue(w.mapping, result);
    };
    const unsubStore = useStore.subscribe(tick);
    const unsubParams = onParamInputs(tick);
    tick();
    return () => { unsubStore(); unsubParams(); };
  }, [widget.id, preview]);

  // Re-render when a cable value changes (those live outside the store).
  const [, bump] = useState(0);
  useEffect(() => onParamInputs(() => bump((n) => n + 1)), []);

  const color  = widget.style.foregroundColor;
  const fs     = widget.style.fontSize || 12;
  const result = useStore((s) => s.runtime.widgets[widget.id]?.cells[0]?.value ?? 0);
  const inputs = useStore((s) => readInputs(widget, s), (a, b) => a.length === b.length && a.every((v, i) => v.k === b[i].k && v.value === b[i].value));
  const gain   = widget.gain ?? 1;

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', gap: 8, padding: 8, boxSizing: 'border-box', fontFamily: 'monospace', pointerEvents: preview ? 'none' : undefined }}>
      <div data-lf-merge-in={widget.id}
        title="Inputs — Shift-drag cables onto this box: each one becomes the next input"
        style={{ flex: 1, minWidth: 0, border: `2px dashed ${pal('#67bbc1')}88`, borderRadius: 6, padding: 6, display: 'flex', flexDirection: 'column', gap: 3, overflow: 'hidden', background: 'rgba(103,187,193,0.05)' }}>
        <div style={{ fontSize: Math.max(9, fs - 3), color: '#777', letterSpacing: 1 }}>IN · {inputs.length}</div>
        {inputs.length === 0 && <div style={{ fontSize: Math.max(9, fs - 3), color: '#555', lineHeight: 1.4 }}>Shift-drag cables here</div>}
        <div className="lf-scroll" style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
          {inputs.map((i) => (
            <div key={i.k} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '1px 3px' }}>
              <span style={{ width: 16, fontSize: 9, color: '#666' }}>{i.k}</span>
              <div style={{ flex: 1, height: 6, background: 'rgba(255,255,255,0.06)', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{ width: `${Math.max(0, Math.min(1, i.value)) * 100}%`, height: '100%', background: color, opacity: 0.7 }} />
              </div>
              <span style={{ fontSize: 9, color: '#555', fontVariantNumeric: 'tabular-nums', width: 30, textAlign: 'right' }}>{i.value.toFixed(2)}</span>
            </div>
          ))}
        </div>
      </div>
      <div style={{ width: 70, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ fontSize: Math.max(9, fs - 3), color, letterSpacing: 1, textAlign: 'center' }}>
          {opSymbol(widget.operation)}{gain !== 1 ? ` ×${gain}` : ''}
        </div>
        <div data-lf-widget={widget.id} data-lf-cell={0}
          style={{ flex: 1, position: 'relative', background: 'rgba(255,255,255,0.05)', borderRadius: 3, overflow: 'hidden', minWidth: 0 }}>
          <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: `${Math.max(0, Math.min(1, result / (gain || 1))) * 100}%`, background: color, opacity: 0.8 }} />
          <span style={{ position: 'absolute', top: 2, left: 0, right: 0, textAlign: 'center', fontSize: 9, color: '#bbb', fontVariantNumeric: 'tabular-nums' }}>
            {Math.abs(result) >= 10 ? result.toFixed(1) : result.toFixed(3)}
          </span>
        </div>
      </div>
    </div>
  );
}
