import { pal, onPalette } from '../../palette';
import React, { useRef, useState } from 'react';
import { nanoid } from 'nanoid';
import { useStore } from '../../store';

// Extra outputs shifted in phase — the ＋ on LFO and Graph. A lane repeats the
// widget's own signal with its own phase offset; lane k is cell k + 1 (cell 0
// is the widget's main output).

type LaneWidget = { id: string; lanes?: { id: string; phase: number }[] };

function pageOf(widgetId: string): string | undefined {
  return useStore.getState().project.pages.find((p) => p.widgets.some((w) => w.id === widgetId))?.id;
}

// New lane: a quarter turn after the last one, so ＋＋＋ spreads them evenly-ish.
export function addLane(widget: LaneWidget): void {
  const lanes = widget.lanes ?? [];
  const last = lanes.length ? lanes[lanes.length - 1].phase : 0;
  const pageId = pageOf(widget.id);
  if (!pageId) return;
  useStore.getState().updateWidget(pageId, widget.id, { lanes: [...lanes, { id: nanoid(), phase: Math.round(((last + 0.25) % 1) * 100) / 100 }] } as never);
}

export function removeLane(widget: LaneWidget, laneIndex: number): void {
  const pageId = pageOf(widget.id);
  if (!pageId) return;
  const st = useStore.getState();
  st.captureHistory();
  st.dropCellAndShiftLinks(widget.id, laneIndex + 1);   // links on later lanes keep their lane
  st.updateWidget(pageId, widget.id, { lanes: (widget.lanes ?? []).filter((_, k) => k !== laneIndex) } as never);
}

// LFO: every row is the same wave, phase set by its index — so any row can be
// removed, the first one included. Links on later rows move up one.
export function removeRow(widget: LaneWidget, index: number): void {
  const pageId = pageOf(widget.id);
  const lanes = widget.lanes ?? [];
  if (!pageId || lanes.length === 0) return;
  const st = useStore.getState();
  st.captureHistory();
  st.dropCellAndShiftLinks(widget.id, index);
  const drop = Math.max(0, index - 1);
  st.updateWidget(pageId, widget.id, { lanes: lanes.filter((_, k) => k !== drop) } as never);
}

export function setLanePhase(widget: LaneWidget, laneIndex: number, phase: number): void {
  const pageId = pageOf(widget.id);
  if (!pageId) return;
  const p = Math.round((((phase % 1) + 1) % 1) * 1000) / 1000;
  useStore.getState().updateWidget(pageId, widget.id, {
    lanes: (widget.lanes ?? []).map((l, k) => (k === laneIndex ? { ...l, phase: p } : l)),
  } as never);
}

// autoPhase: the widget computes each output's phase itself (LFO: PHASE spread
// by index) — the φ box just shows it and is not draggable.
export function LaneBar({ widget, index, color, autoPhase }: { widget: LaneWidget; index: number; color: string; autoPhase?: number }): React.JSX.Element {
  const v = useStore((s) => s.runtime.widgets[widget.id]?.cells[index]?.value ?? 0);
  const lane = index > 0 ? widget.lanes?.[index - 1] : undefined;
  const drag = useRef<{ x: number; phase: number } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  return (
    <div style={{ flex: 1, minHeight: 12, display: 'flex', gap: 4, alignItems: 'stretch' }}>
      <div data-lf-widget={widget.id} data-lf-cell={index}
        style={{ flex: 1, background: 'rgba(255,255,255,0.05)', borderRadius: 3, overflow: 'hidden', position: 'relative' }}>
        <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${v * 100}%`, background: color, opacity: index === 0 ? 0.7 : 0.45 }} />
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: '#999', fontVariantNumeric: 'tabular-nums' }}>
          {v.toFixed(3)}
        </div>
      </div>
      {autoPhase !== undefined && (
        <>
          <div title="Phase of this output — set by the LFO's PHASE (spread by index)"
            style={{ width: 44, fontSize: 10, color: '#777', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.35)', borderRadius: 3, fontVariantNumeric: 'tabular-nums' }}
          >φ{(autoPhase % 1 === 0 && autoPhase > 0 ? 1 : autoPhase % 1).toFixed(2)}</div>
          <button onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); removeRow(widget, index); }} title="Remove this output"
            style={laneBtn}>✕</button>
        </>
      )}
      {lane && autoPhase === undefined && (
        <>
          {/* Drag sideways to shift the phase; double-click to type it. */}
          {editing !== null ? (
            <input autoFocus onFocus={(e) => e.currentTarget.select()} value={editing} onChange={(e) => setEditing(e.target.value)}
              onBlur={() => { const n = Number(editing.replace(',', '.')); if (Number.isFinite(n)) setLanePhase(widget, index - 1, n); setEditing(null); }}
              onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setEditing(null); }}
              style={{ width: 44, fontSize: 10, background: '#000', color: '#fff', border: `1px solid ${color}`, textAlign: 'center', fontFamily: 'inherit' }} />
          ) : (
            <div
              title="Phase — drag left/right, double-click to type"
              onPointerDown={(e) => { e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId); drag.current = { x: e.clientX, phase: lane.phase }; }}
              onPointerMove={(e) => { const d = drag.current; if (d) setLanePhase(widget, index - 1, d.phase + (e.clientX - d.x) / 200); }}
              onPointerUp={() => { drag.current = null; }}
              onDoubleClick={() => setEditing(String(lane.phase))}
              style={{ width: 44, fontSize: 10, color: '#aaa', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'ew-resize', background: 'rgba(0,0,0,0.35)', borderRadius: 3, touchAction: 'none', userSelect: 'none' }}
            >φ{lane.phase.toFixed(2)}</div>
          )}
          <button onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); removeLane(widget, index - 1); }} title="Remove this output"
            style={laneBtn}>✕</button>
        </>
      )}
    </div>
  );
}


const make_laneBtn = (): React.CSSProperties => ({
  minWidth: 22, padding: '2px 5px', borderRadius: 3, fontSize: 11, lineHeight: 1,
  background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.08)', cursor: 'pointer',
  fontFamily: 'inherit', touchAction: 'none', flexShrink: 0, color: pal('#de8b43'),
});
let laneBtn: React.CSSProperties = make_laneBtn();
onPalette(() => { laneBtn = make_laneBtn(); });
