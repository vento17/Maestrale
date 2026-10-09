import { pal, onPalette } from '../../palette';
import React, { useEffect, useRef, useState } from 'react';
import { nanoid } from 'nanoid';
import type { DmxPlayerWidget, DmxPlayerItem } from '../../../shared/types/project';
import type { DmxPlayConfig } from '../../../shared/types/ipc';
import { useStore } from '../../store';
import { bridge } from '../../ipc/bridge';
import { useTakes, usePlayStatus, fmtTime } from '../../ipc/dmxTakes';
import CellLinkMenu from '../base/CellLinkMenu';
import { useSlavedCells, SLAVE_OUTLINE } from '../base/useSlavedCells';
import { EndButton, FadeButton, TransportBar, usePlaylistInputs } from '../base/playlist';

const make_PLAY_GREEN = () => (pal('#4aadb4'));
let PLAY_GREEN = make_PLAY_GREEN();
onPalette(() => { PLAY_GREEN = make_PLAY_GREEN(); });

function configOf(w: DmxPlayerWidget, it: DmxPlayerItem, withFade: boolean): DmxPlayConfig {
  return {
    takeId: it.takeId, loop: it.end === 'loop', universeOffset: w.universeOffset || 0,
    protocol: w.playProtocol ?? 'artnet', fadeMs: withFade ? Math.round((it.fade || 0) * 1000) : 0,
  };
}

function pageOf(widgetId: string): string | undefined {
  return useStore.getState().project.pages.find((p) => p.widgets.some((w) => w.id === widgetId))?.id;
}

// A playlist of recorded takes, like the Sound Player. Each item is a trigger
// cell (Router, Shift, Learn — timeline, clock, button, DMX, OSC…); STOP, NEXT,
// PREV and FIRST are inputs too. Per item: what to do at the end (stop / loop /
// next) and a fade time that crossfades from what was on output.
export default function DmxPlayerLive({ widget }: { widget: DmxPlayerWidget }): React.JSX.Element {
  const takes = useTakes();
  const status = usePlayStatus(widget.id);
  const slaved = useSlavedCells(widget.id);
  const widgetRef = useRef(widget);
  widgetRef.current = widget;
  const [current, setCurrent] = useState<number>(-1);      // item on the play head
  const currentRef = useRef(-1);
  const [menu, setMenu] = useState<{ x: number; y: number; cell: number } | null>(null);
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [menu]);

  const items = widget.items ?? [];
  const cur = items[current];
  const playing = !!status?.playing && !!cur && status.takeId === cur.takeId;
  const take = cur ? takes.find((t) => t.id === cur.takeId) : undefined;
  const duration = take?.durationMs ?? status?.durationMs ?? 0;
  const position = cur && status?.takeId === cur.takeId ? status.positionMs : 0;

  const update = (patch: Partial<DmxPlayerWidget>) => {
    const pageId = pageOf(widget.id);
    if (pageId) useStore.getState().updateWidget(pageId, widget.id, patch as never);
  };
  const updateItem = (k: number, patch: Partial<DmxPlayerItem>) =>
    update({ items: (widgetRef.current.items ?? []).map((it, j) => (j === k ? { ...it, ...patch } : it)) });

  const playItem = (k: number) => {
    const w = widgetRef.current;
    const it = (w.items ?? [])[k];
    if (!it?.takeId) return;
    currentRef.current = k;
    setCurrent(k);
    void bridge.invoke('tr:dmxPlay:play', { playerId: w.id, config: configOf(w, it, true), fromMs: 0 });
  };
  const stop = () => { void bridge.invoke('tr:dmxPlay:stop', { playerId: widgetRef.current.id }); };
  const pause = () => { void bridge.invoke('tr:dmxPlay:pause', { playerId: widgetRef.current.id }); };
  const n = () => (widgetRef.current.items ?? []).length;
  const fns = {
    stop,
    next: () => { if (n()) playItem(currentRef.current < 0 ? 0 : (currentRef.current + 1) % n()); },
    prev: () => { if (n()) playItem(currentRef.current <= 0 ? n() - 1 : currentRef.current - 1); },
    first: () => { if (n()) playItem(0); },
  };
  usePlaylistInputs(widget.id, fns);

  // Item triggers: a rising edge on cell k plays item k. Holding high fires once.
  useEffect(() => {
    const read = () => useStore.getState().runtime.widgets[widgetRef.current.id]?.cells.map((c) => c.value ?? 0) ?? [];
    let prev = read();
    return useStore.subscribe(() => {
      const now = read();
      now.forEach((v, k) => { if ((prev[k] ?? 0) < 0.5 && v >= 0.5) playItem(k); });
      prev = now;
    });
  }, [widget.id]);  // eslint-disable-line react-hooks/exhaustive-deps

  // End of an item: "next" moves on (loop is handled by the player itself).
  const lastEnded = useRef(false);
  useEffect(() => {
    const ended = !!status?.ended;
    if (ended && !lastEnded.current) {
      const it = (widgetRef.current.items ?? [])[currentRef.current];
      if (it?.end === 'next' && currentRef.current + 1 < n()) playItem(currentRef.current + 1);
    }
    lastEnded.current = ended;
  }, [status]);  // eslint-disable-line react-hooks/exhaustive-deps

  // Offset / protocol / end-mode changes apply to the item already playing.
  const cfgKey = cur ? JSON.stringify(configOf(widget, cur, false)) : '';
  const firstCfg = useRef(true);
  useEffect(() => {
    if (firstCfg.current) { firstCfg.current = false; return; }
    if (cur) void bridge.invoke('tr:dmxPlay:configure', { playerId: widget.id, config: configOf(widget, cur, false) });
  }, [cfgKey]);  // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => { void bridge.invoke('tr:dmxPlay:stop', { playerId: widget.id }).catch(() => {}); }, [widget.id]);

  const fs = widget.style.fontSize || 13;
  const color = PLAY_GREEN;
  const pct = duration > 0 ? Math.min(1, position / duration) : 0;
  const link = (cell: number, e: React.MouseEvent) => setMenu({ x: e.clientX, y: e.clientY, cell });

  const seekFrom = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!duration || !cur) return;
    const r = e.currentTarget.getBoundingClientRect();
    const ms = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * duration;
    if (status?.takeId === cur.takeId) void bridge.invoke('tr:dmxPlay:seek', { playerId: widget.id, ms });
  };

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', boxSizing: 'border-box', fontFamily: 'monospace', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px', borderBottom: '1px solid #1e1e1e', flexShrink: 0 }}>
        <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: 2, color: '#505050', textTransform: 'uppercase' }}>◈ dmx player</span>
        {/* Output protocol: click to switch (applies to what is playing too). */}
        <span style={{ display: 'flex' }} onPointerDown={(e) => e.stopPropagation()}>
          {(['artnet', 'sacn'] as const).map((p) => {
            const on = (widget.playProtocol ?? 'artnet') === p;
            return (
              <button key={p} onClick={() => update({ playProtocol: p })} title={`Play out on ${p === 'sacn' ? 'sACN' : 'Art-Net'}`}
                style={{
                  padding: '1px 6px', fontSize: Math.max(9, fs - 4), fontFamily: 'inherit', cursor: 'pointer',
                  background: on ? color : 'transparent', color: on ? '#000' : '#777',
                  border: '1px solid #3a3a3a', borderRadius: p === 'artnet' ? '3px 0 0 3px' : '0 3px 3px 0',
                }}>{p === 'sacn' ? 'sACN' : 'ART'}</button>
            );
          })}
        </span>
        <span style={{ fontSize: 9, color: '#444', marginRight: 'auto' }}>
          {widget.universeOffset ? `U${widget.universeOffset > 0 ? '+' : ''}${widget.universeOffset}` : ''}
        </span>
        <TransportBar widgetId={widget.id} color={color} fs={Math.max(10, fs - 2)} fns={fns} onLink={link} />
        <button title="Pause" onClick={pause} onPointerDown={(e) => e.stopPropagation()}
          style={{ height: Math.max(20, (fs - 2) * 1.6), padding: '0 6px', borderRadius: 3, cursor: 'pointer', background: 'rgba(0,0,0,0.4)', color: '#bbb', border: '1px solid #2a2a2a', fontSize: fs - 2, fontFamily: 'inherit' }}>❚❚</button>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '4px 0' }}>
        {items.length === 0 && (
          <div style={{ fontSize: 10, color: '#3a3a3a', fontStyle: 'italic', padding: '8px 10px' }}>no takes — add one below or in the settings</div>
        )}
        {items.map((it, k) => {
          const t = takes.find((x) => x.id === it.takeId);
          const here = k === current;
          const on = here && playing;
          return (
            <div key={it.id}
              style={{
                display: 'flex', alignItems: 'center', gap: 4, padding: '3px 8px',
                background: on ? 'rgba(255,255,255,0.04)' : 'transparent',
                borderLeft: on ? `2px solid ${color}` : '2px solid transparent',
              }}>
              <span style={{ fontSize: 9, color: '#444', width: 14, textAlign: 'right', flexShrink: 0 }}>{k + 1}</span>
              <button data-lf-widget={widget.id} data-lf-cell={k}
                title="Play · right-click: link / learn (timeline, clock, button, DMX, OSC…)"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => (on ? stop() : playItem(k))}
                onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); link(k, e); }}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer', padding: '2px 5px', fontSize: fs - 2, lineHeight: 1,
                  color: on ? color : '#777',
                  outline: slaved.has(k) ? SLAVE_OUTLINE : undefined, outlineOffset: -1,
                }}>{on ? '■' : '▶'}</button>
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
                <span style={{ fontSize: fs, color: on ? '#ddd' : '#777', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {t ? t.name : it.takeId ? 'take missing' : '— no take —'}
                  <span style={{ color: '#444', fontSize: Math.max(9, fs - 3) }}>{t ? `  ${fmtTime(t.durationMs)}` : ''}</span>
                </span>
                <div onPointerDown={here ? seekFrom : undefined}
                  style={{ height: 3, background: 'rgba(255,255,255,0.06)', borderRadius: 1, overflow: 'hidden', cursor: here ? 'pointer' : 'default' }}>
                  <div style={{ width: `${(here ? pct : 0) * 100}%`, height: '100%', background: on ? color : '#555' }} />
                </div>
              </div>
              <EndButton value={it.end ?? 'stop'} onChange={(v) => updateItem(k, { end: v })} color={color} fs={fs - 2} />
              <FadeButton value={it.fade ?? 0} onChange={(v) => updateItem(k, { fade: v })} color={color} fs={fs - 2} />
            </div>
          );
        })}
      </div>

      <div style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '4px 8px', borderTop: '1px solid #1e1e1e', flexShrink: 0 }}>
        <select value="" onPointerDown={(e) => e.stopPropagation()}
          onChange={(e) => { if (e.target.value) update({ items: [...items, { id: nanoid(), takeId: e.target.value, end: 'stop', fade: 0 }] }); }}
          style={{ flex: 1, minWidth: 0, height: 22, background: '#111', color: '#888', border: '1px solid #2a2a2a', borderRadius: 3, fontFamily: 'inherit', fontSize: Math.max(10, fs - 3) }}>
          <option value="">＋ add take…</option>
          {takes.map((t) => <option key={t.id} value={t.id}>{t.name} · {fmtTime(t.durationMs)}</option>)}
        </select>
        <span style={{ fontSize: Math.max(9, fs - 4), color: '#666', whiteSpace: 'nowrap' }}>{fmtTime(position)} / {fmtTime(duration)}</span>
      </div>
      {menu && <CellLinkMenu x={menu.x} y={menu.y} widgetId={widget.id} cellIndex={menu.cell} onClose={() => setMenu(null)} />}
    </div>
  );
}
