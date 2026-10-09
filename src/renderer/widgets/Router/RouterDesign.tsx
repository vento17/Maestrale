import { pal } from '../../palette';
import { useShallow } from 'zustand/react/shallow';
import React from 'react';
import type { RouterWidget, RouterRow, Widget } from '../../../shared/types/project';
import type { Mapping, OscMapping, MidiMapping, ArtNetMapping, SacnMapping, EnttecDmxMapping } from '../../../shared/types/mapping';
import { useStore } from '../../store';
import { cellLabel, allCellsLabel } from '../base/links';
import { remapRange, isIdentityRange } from '../base/range';

function protocolDesc(mapping: Mapping): string {
  if (!mapping) return '';
  switch (mapping.type) {
    case 'midi': {
      const m = mapping as MidiMapping;
      return `MIDI ch${m.channel} cc${m.number}`;
    }
    case 'osc':   return `OSC  ${(mapping as OscMapping).address}`;
    case 'enttec': return `ENTTEC ch${(mapping as EnttecDmxMapping).channel}`;
    case 'artnet': {
      const m = mapping as ArtNetMapping;
      return `ART-NET u${m.universe} ch${m.channel}`;
    }
    case 'sacn': {
      const m = mapping as SacnMapping;
      return `sACN u${m.universe} ch${m.channel}`;
    }
  }
}

function scaledDisplay(v: number, mapping: Mapping): string {
  if (!mapping) return '';
  if (mapping.type === 'osc') {
    const m = mapping as OscMapping;
    if (m.minValue !== undefined && m.maxValue !== undefined) {
      return (v * (m.maxValue - m.minValue) + m.minValue).toFixed(2);
    }
    return v.toFixed(3);
  }
  if ('minValue' in mapping && 'maxValue' in mapping) {
    return String(Math.round(v * ((mapping as ArtNetMapping).maxValue - (mapping as ArtNetMapping).minValue) + (mapping as ArtNetMapping).minValue));
  }
  return v.toFixed(3);
}

function sourceLabel(row: RouterRow, src: Widget | undefined): { primary: string; secondary: string } {
  const t = row.inputType ?? 'widget';
  if (t === 'midiCC')   return { primary: 'MIDI CC',   secondary: `ch${row.midiChannel ?? 1} #${row.midiNumber ?? 0}` };
  if (t === 'midiNote') return { primary: 'MIDI Note', secondary: `ch${row.midiChannel ?? 1} #${row.midiNumber ?? 0}` };
  if (t === 'osc')      return { primary: 'OSC',       secondary: row.oscAddress ?? '—' };
  if (t === 'artnet')   return { primary: 'Art-Net',   secondary: `U${row.artnetUniverse ?? 0} ch${row.artnetChannel ?? 1}` };
  if (t === 'sacn')     return { primary: 'sACN',      secondary: `U${row.artnetUniverse ?? 1} ch${row.artnetChannel ?? 1}` };
  return {
    primary: src ? src.label : '—',
    secondary: row.allCells ? allCellsLabel(src) : cellLabel(src, row.cellIndex),
  };
}

export default function RouterDesign({ widget }: { widget: RouterWidget }): React.JSX.Element {
  const project = useStore((s) => s.project);
  const fs = widget.style.fontSize || 13;

  // Links may point at any page, and this router is often read while a different
  // page is on screen — so resolve names against the whole project, not just the
  // visible page, which is what used to render a bare "?".
  const widgetById = React.useMemo(() => {
    const m = new Map<string, Widget>();
    for (const p of project.pages) for (const w of p.widgets) m.set(w.id, w);
    return m;
  }, [project.pages]);

  // Custom equality prevents re-renders when widget-cell values haven't changed.
  const runtimeValues = useStore(useShallow(
    (state) => {
      const out: Record<string, number> = {};
      for (const row of widget.rows) {
        const t = row.inputType ?? 'widget';
        if (t !== 'widget') {
          // MIDI/OSC rows have no source cell — use what the engine last received.
          out[row.id] = state.runtime.routerInputs?.[row.id] ?? 0;
          continue;
        }
        if (!row.widgetId) continue;
        if (row.allCells) continue;   // no single value to track
        const cell = state.runtime.widgets[row.widgetId]?.cells[row.cellIndex];
        out[row.id] = cell ? (cell.value ?? (cell.active ? 1 : 0)) : 0;
      }
      return out;
    },
  ));

  return (
    <div style={{
      width: '100%', height: '100%',
      display: 'flex', flexDirection: 'column',
      padding: '6px 8px', boxSizing: 'border-box',
      fontFamily: 'monospace', overflow: 'hidden',
    }}>
      <div style={{
        fontSize: Math.max(9, fs - 3), fontWeight: 700, letterSpacing: 2,
        color: '#505050', marginBottom: 5, textTransform: 'uppercase',
      }}>
        ◈ router
      </div>

      <div className="lf-scroll" style={{
        flex: 1, minHeight: 0,
        overflowY: 'auto', overflowX: 'hidden',
        display: 'flex', flexDirection: 'column', gap: 6,
        paddingRight: 4,
      }}>
        {widget.rows.length === 0 ? (
          <div style={{ fontSize: fs, color: '#404040', fontStyle: 'italic' }}>
            no routes — configure in inspector
          </div>
        ) : widget.rows.map((row) => {
          const src = widgetById.get(row.widgetId);
          const lbl = sourceLabel(row, src);
          const v   = runtimeValues[row.id] ?? 0;
          // An ALL source is many signals at once, so there is no single number
          // to show — printing one would just be the first cell, misleadingly.
          const showValue = !row.allCells;

          return (
            <div key={row.id}>
              {/* Input line: source · detail (value) */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <span style={{ fontSize: fs, color: '#cccccc', fontWeight: 600 }}>
                  {lbl.primary}
                  <span style={{ fontSize: fs - 2, color: '#777', fontWeight: 400 }}> · {lbl.secondary}</span>
                </span>
                {showValue && (
                  <span style={{ fontSize: fs - 1, color: '#aaa', marginLeft: 8 }}>
                    {v.toFixed(3)}
                  </span>
                )}
              </div>

              {/* Output lines — each shows what IT sends, after its own range */}
              {row.outputs.map((out) => {
                const ov = isIdentityRange(out) ? v : remapRange(v, out);
                if (out.targetWidgetId) {
                  const tw = widgetById.get(out.targetWidgetId);
                  // A widget cell only ever holds 0–1, so show what it will land on.
                  const cellV = Math.max(0, Math.min(1, ov));
                  return (
                    <div key={out.id}
                      style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginLeft: 10 }}>
                      <span style={{ fontSize: fs - 2, color: '#606060' }}>
                        → {tw ? tw.label : '?'} · {out.targetAllCells ? allCellsLabel(tw) : cellLabel(tw, out.targetCellIndex ?? 0)}
                      </span>
                      {showValue && (
                        <span style={{ fontSize: fs - 2, color: cellV !== ov ? pal('#a75d1d') : '#555', marginLeft: 8 }}>
                          {cellV.toFixed(3)}
                        </span>
                      )}
                    </div>
                  );
                }
                if (!out.mapping) return null;
                // Negative and above-unity values are real on OSC; elsewhere the
                // protocol clamps them, so flag that in the colour.
                const clamped = out.mapping.type !== 'osc' && (ov < 0 || ov > 1);
                return (
                  <div key={out.id}
                    style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginLeft: 10 }}>
                    <span style={{ fontSize: fs - 2, color: '#606060' }}>
                      → {protocolDesc(out.mapping)}
                    </span>
                    {showValue && (
                      <span style={{ fontSize: fs - 2, color: clamped ? pal('#a75d1d') : '#555', marginLeft: 8 }}>
                        {scaledDisplay(out.mapping.type === 'osc' ? ov : Math.max(0, Math.min(1, ov)), out.mapping)}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
