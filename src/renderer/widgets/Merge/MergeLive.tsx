import React, { useEffect, useReducer } from 'react';
import type { MergeWidget } from '../../../shared/types/project';
import { useStore, useWidgetRuntime } from '../../store';
import { pal } from '../../palette';
import { connectedInputs, mergeInputs, mergeLatest, onMerge } from './mergeEngine';

// The Merge: a box on the left takes any number of cables (Shift-drag onto it:
// each one becomes the next input), the outputs 1…N on the right.

const MODE_NAME = { htp: 'HTP', ltp: 'LTP', min: 'LOW', avg: 'AVG' } as const;

export default function MergeLive({ widget, preview = false }: { widget: MergeWidget; preview?: boolean }): React.JSX.Element {
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => onMerge(force), []);
  const project = useStore((s) => s.project);
  const rt = useWidgetRuntime(widget.id);
  const n = Math.max(1, Math.min(16, Math.round(widget.every || 1)));
  const ins = connectedInputs(project, widget.id);
  const vals = mergeInputs(widget.id);
  const latest = mergeLatest(widget.id);
  const groups = Math.max(1, Math.ceil((ins[ins.length - 1] ?? 0) / n));
  const color = widget.style.foregroundColor || pal('#4fb8ab');
  const orange = pal('#ff8a1f');
  const fs = widget.style.fontSize || 12;
  // A group of 3 reads as a colour: show it as one.
  const swatch = (g: number): string | null => {
    if (n !== 3) return null;
    const c = [1, 2, 3].map((s) => vals.get(g * 3 + s));
    if (c.some((v) => v === undefined)) return null;
    return `rgb(${c.map((v) => Math.round((v as number) * 255)).join(',')})`;
  };

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', gap: 8, padding: 8, boxSizing: 'border-box', fontFamily: 'monospace', pointerEvents: preview ? 'none' : undefined }}>
      <div data-lf-merge-in={widget.id}
        title="Inputs — Shift-drag cables onto this box: each one becomes the next input"
        style={{ flex: 1, minWidth: 0, border: `2px dashed ${pal('#67bbc1')}88`, borderRadius: 6, padding: 6, display: 'flex', flexDirection: 'column', gap: 3, overflow: 'hidden', background: 'rgba(103,187,193,0.05)' }}>
        <div style={{ fontSize: Math.max(9, fs - 3), color: '#777', letterSpacing: 1 }}>IN · {ins.length} · by {n}</div>
        {ins.length === 0 && <div style={{ fontSize: Math.max(9, fs - 3), color: '#555', lineHeight: 1.4 }}>Shift-drag cables here</div>}
        <div className="lf-scroll" style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
          {Array.from({ length: ins.length ? groups : 0 }, (_, g) => {
            const sw = swatch(g);
            const on = widget.mode === 'ltp' && g === latest;
            return (
              <div key={g} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '1px 3px', borderRadius: 3, border: `1px solid ${on ? orange : 'transparent'}` }}>
                <span style={{ width: 16, fontSize: 9, color: on ? orange : '#666' }}>{g + 1}</span>
                {sw && <span style={{ width: 12, height: 12, borderRadius: 2, background: sw, flexShrink: 0 }} />}
                {Array.from({ length: n }, (_, s) => {
                  const v = vals.get(g * n + s + 1);
                  return (
                    <div key={s} style={{ flex: 1, height: 6, background: 'rgba(255,255,255,0.06)', borderRadius: 2, overflow: 'hidden' }}>
                      {v !== undefined && <div style={{ width: `${v * 100}%`, height: '100%', background: color, opacity: 0.7 }} />}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
      <div style={{ width: 70, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ fontSize: Math.max(9, fs - 3), color, letterSpacing: 1, textAlign: 'center' }}>{MODE_NAME[widget.mode] ?? 'HTP'}{widget.smooth > 0 ? ` ${widget.smooth}s` : ''}</div>
        {n === 3 && (
          <div style={{ height: 14, borderRadius: 3, border: '1px solid #333',
            background: `rgb(${[0, 1, 2].map((i) => Math.round((rt?.cells[i]?.value ?? 0) * 255)).join(',')})` }} />
        )}
        <div style={{ flex: 1, minHeight: 0, display: 'flex', gap: 3 }}>
          {Array.from({ length: n }, (_, i) => {
            const v = rt?.cells[i]?.value ?? 0;
            return (
              <div key={i} data-lf-widget={widget.id} data-lf-cell={i}
                style={{ flex: 1, position: 'relative', background: 'rgba(255,255,255,0.05)', borderRadius: 3, overflow: 'hidden', minWidth: 0 }}>
                <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: `${v * 100}%`, background: color, opacity: 0.8 }} />
                <span style={{ position: 'absolute', top: 2, left: 0, right: 0, textAlign: 'center', fontSize: 9, color: '#bbb' }}>{i + 1}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
