import { pal } from '../../palette';
import React, { useEffect, useState } from 'react';
import type { DmxRecorderWidget } from '../../../shared/types/project';
import type { DmxInputStatusPayload } from '../../../shared/types/ipc';
import { useStore } from '../../store';
import { bridge } from '../../ipc/bridge';
import { onDmxInputStatus } from '../../ipc/dmxInput';
import { useRecStatus, parseUniverses, fmtTime, fmtBytes, refreshTakes } from '../../ipc/dmxTakes';
import CellLinkMenu from '../base/CellLinkMenu';
import { useSlavedCells, SLAVE_OUTLINE } from '../base/useSlavedCells';
import { useCellEdge } from '../base/useCellEdge';

const REC_RED = '#e0322b';

// One big REC. Recording runs in the main process off the Art-Net receiver, so
// this widget is only the remote control and the readout.
export function toggleRecording(widget: DmxRecorderWidget, recording: boolean): void {
  if (recording) {
    void bridge.invoke('tr:dmxRec:stop', undefined).then(() => refreshTakes());
    return;
  }
  const universes = parseUniverses(widget.universes ?? '');
  void bridge.invoke('tr:dmxRec:start', { universes: universes.length ? universes : undefined, protocol: widget.source ?? 'artnet' }).then((r) => {
    if (r && !r.ok) useStore.getState().addLog('error', `DMX recorder: ${r.error ?? 'cannot start'}`);
  });
}

type RecSource = NonNullable<DmxRecorderWidget['source']>;
export const REC_SOURCES: { value: RecSource; label: string; short: string }[] = [
  { value: 'artnet',     label: 'IN Art-Net',      short: 'Art-Net' },
  { value: 'sacn',       label: 'IN sACN',         short: 'sACN' },
  { value: 'out-artnet', label: 'OUT Art-Net',     short: 'Art-Net' },
  { value: 'out-sacn',   label: 'OUT sACN',        short: 'sACN' },
  { value: 'out-enttec', label: 'OUT Open DMX',    short: 'Open DMX' },
];

export default function DmxRecorderLive({ widget }: { widget: DmxRecorderWidget }): React.JSX.Element {
  const rec = useRecStatus();
  const src = widget.source ?? 'artnet';
  const isOut = src.startsWith('out-');
  const srcName = REC_SOURCES.find((x) => x.value === src)?.short ?? 'Art-Net';
  const inputOn = useStore((s) => isOut || s.project.connections.some((c) => c.type === (src === 'sacn' ? 'sacnInput' : 'artnetInput') && c.enabled));
  const [input, setInput] = useState<DmxInputStatusPayload | null>(null);
  useEffect(() => { setInput(null); if (isOut) return; return onDmxInputStatus((s) => { if (s.protocol === src) setInput(s); }); }, [src, isOut]);
  const setSource = (v: RecSource) => {
    const st = useStore.getState();
    const pageId = st.project.pages.find((p) => p.widgets.some((w) => w.id === widget.id))?.id;
    if (pageId && !rec.recording) st.updateWidget(pageId, widget.id, { source: v } as never);
  };
  const isSlave = useSlavedCells(widget.id).has(0);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [menu]);

  // REC from the Router / MIDI / Art-Net: each rising edge toggles.
  useCellEdge(widget.id, 0, () => toggleRecording(widget, rec.recording));

  const fs = widget.style.fontSize || 14;
  const filter = parseUniverses(widget.universes ?? '');
  const live = input?.listening && input.packetsPerSec > 0;

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', gap: 6, padding: 8, boxSizing: 'border-box', fontFamily: 'monospace' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: Math.max(9, fs - 4), color: '#8a8a8a', letterSpacing: 2, textTransform: 'uppercase' }}>
        <span>{widget.label}</span>
        <select value={src} disabled={rec.recording} onPointerDown={(e) => e.stopPropagation()}
          onChange={(e) => setSource(e.target.value as RecSource)}
          title={rec.recording ? 'Stop recording to change the source' : 'What to record'}
          style={{ background: '#111', color: '#ccc', border: '1px solid #333', borderRadius: 3, fontFamily: 'inherit', fontSize: Math.max(9, fs - 5), letterSpacing: 0, textTransform: 'none' }}>
          {REC_SOURCES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <span style={{ marginLeft: 'auto', color: !inputOn ? '#a55' : isOut || live ? `var(--lf-aqua, ${pal('#4fb8b0')})` : '#777', letterSpacing: 0, textTransform: 'none' }}>
          {isOut ? 'Maestrale out' : !inputOn ? `${srcName} in off` : live ? `${input!.packetsPerSec} pkt/s` : 'no signal'}
        </span>
      </div>

      <button
        data-lf-widget={widget.id} data-lf-cell={0}
        onClick={() => toggleRecording(widget, rec.recording)}
        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setMenu({ x: e.clientX, y: e.clientY }); }}
        title={rec.recording ? 'Stop recording' : `Record ${isOut ? `what Maestrale sends on ${srcName}` : `the incoming ${srcName}`} · right-click: link / learn`}
        style={{
          flex: 1, minHeight: 0, borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
          background: rec.recording ? REC_RED : 'rgba(0,0,0,0.45)',
          border: `1px solid ${rec.recording ? REC_RED : '#3a2222'}`,
          color: rec.recording ? '#fff' : REC_RED, fontSize: fs + 4, fontWeight: 700, letterSpacing: 2,
          outline: isSlave ? SLAVE_OUTLINE : undefined, outlineOffset: isSlave ? -1 : undefined,
          animation: rec.recording ? 'lf-rec-pulse 1.2s ease-in-out infinite' : undefined,
        }}
      >
        <span style={{ fontSize: fs + 8 }}>●</span>
        {rec.recording ? fmtTime(rec.elapsedMs) : 'REC'}
      </button>

      <div style={{ fontSize: Math.max(9, fs - 4), color: '#777', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {rec.recording
          ? `${rec.name} · ${fmtBytes(rec.bytes)} · U ${rec.universes.join(',') || '—'}`
          : rec.takeId
            ? `last: ${rec.name} · ${fmtTime(rec.elapsedMs)}`
            : filter.length ? `universes ${widget.universes}` : 'all universes'}
      </div>

      <style>{'@keyframes lf-rec-pulse { 0%,100% { opacity: 1 } 50% { opacity: 0.6 } }'}</style>
      {menu && <CellLinkMenu x={menu.x} y={menu.y} widgetId={widget.id} cellIndex={0} onClose={() => setMenu(null)} />}
    </div>
  );
}
