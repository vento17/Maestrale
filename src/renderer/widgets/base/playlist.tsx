import { pal } from '../../palette';
import React, { useEffect, useRef, useState } from 'react';
import type { PlayEnd } from '../../../shared/types/project';
import { getParamInput, onParamInputs } from './paramInputs';

// Shared bits of the playlist players (Sound Player, DMX Player): the two
// buttons at the right of every item, the transport inputs, and next/prev.

export const END_CYCLE: PlayEnd[] = ['stop', 'loop', 'next'];
export const END_ICON: Record<PlayEnd, string> = { stop: '■', loop: '⟳', next: '⇥' };
export const END_HINT: Record<PlayEnd, string> = {
  stop: 'at the end: stop', loop: 'at the end: loop this one', next: 'at the end: play the next one',
};
export const FADE_STEPS = [0, 0.5, 1, 2, 3, 5, 10];

export function fmtFade(s: number): string {
  return s === 0 ? '0s' : s < 1 ? `${s}s` : `${Number(s.toFixed(1))}s`;
}

// Stop / loop / next — click cycles.
export function EndButton({ value, onChange, color, fs }: { value: PlayEnd; onChange: (v: PlayEnd) => void; color: string; fs: number }): React.JSX.Element {
  return (
    <button
      title={`${END_HINT[value]} — click to change`}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => { e.stopPropagation(); onChange(END_CYCLE[(END_CYCLE.indexOf(value) + 1) % END_CYCLE.length]); }}
      style={{
        width: Math.max(24, fs * 2), height: Math.max(20, fs * 1.6), flexShrink: 0, borderRadius: 3, cursor: 'pointer',
        background: value === 'stop' ? 'rgba(0,0,0,0.35)' : color + '33', color: value === 'stop' ? '#888' : color,
        border: `1px solid ${value === 'stop' ? '#2a2a2a' : color + '88'}`, fontSize: fs, fontFamily: 'inherit', padding: 0,
      }}
    >{END_ICON[value]}</button>
  );
}

// Fade time — click steps 0 · 0.5 · 1 · 2 · 3 · 5 · 10 s, double-click to type.
export function FadeButton({ value, onChange, color, fs }: { value: number; onChange: (v: number) => void; color: string; fs: number }): React.JSX.Element {
  const [edit, setEdit] = useState<string | null>(null);
  const w = Math.max(38, fs * 3.2), h = Math.max(20, fs * 1.6);
  if (edit !== null) {
    return (
      <input autoFocus onFocus={(e) => e.currentTarget.select()} value={edit} onChange={(e) => setEdit(e.target.value)}
        onPointerDown={(e) => e.stopPropagation()}
        onBlur={() => { const n = Number(edit.replace(',', '.').replace(/s$/, '')); if (Number.isFinite(n)) onChange(Math.max(0, Math.min(600, n))); setEdit(null); }}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setEdit(null); }}
        style={{ width: w, height: h, flexShrink: 0, boxSizing: 'border-box', fontSize: fs - 1, background: '#000', color: '#fff', border: `1px solid ${color}`, textAlign: 'center', fontFamily: 'inherit' }} />
    );
  }
  const i = FADE_STEPS.indexOf(value);
  return (
    <button
      title="Fade time: crossfades in over what was playing — click to step, double-click to type"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => { e.stopPropagation(); onChange(FADE_STEPS[i < 0 ? 0 : (i + 1) % FADE_STEPS.length]); }}
      onDoubleClick={(e) => { e.stopPropagation(); setEdit(String(value)); }}
      style={{
        width: w, height: h, flexShrink: 0, borderRadius: 3, cursor: 'pointer', padding: 0,
        background: value > 0 ? color + '22' : 'rgba(0,0,0,0.35)', color: value > 0 ? color : '#666',
        border: `1px solid ${value > 0 ? color + '66' : '#2a2a2a'}`, fontSize: Math.max(9, fs - 2), fontFamily: 'inherit',
        fontVariantNumeric: 'tabular-nums',
      }}
    >↗{fmtFade(value)}</button>
  );
}

// STOP / NEXT / PREV / FIRST arriving on the player's inputs (Router, Shift,
// Learn — from a timeline, a button, DMX, OSC…): each fires on a rising edge.
export function usePlaylistInputs(widgetId: string, fns: { stop: () => void; next: () => void; prev: () => void; first: () => void }): void {
  const ref = useRef(fns);
  ref.current = fns;
  useEffect(() => {
    const last: Record<string, number> = {};
    return onParamInputs(() => {
      for (const k of ['stop', 'next', 'prev', 'first'] as const) {
        const v = getParamInput(widgetId, k) ?? 0;
        if (v >= 0.5 && (last[k] ?? 0) < 0.5) ref.current[k]();
        last[k] = v;
      }
    });
  }, [widgetId]);
}

// Header transport buttons: ⏮ first · ◀ prev · ■ stop · ▶ next. Each is also
// an input (negative cell) — right-click links / learns it.
export function TransportBar({ widgetId, color, fs, fns, onLink }: {
  widgetId: string; color: string; fs: number;
  fns: { stop: () => void; next: () => void; prev: () => void; first: () => void };
  onLink: (cell: number, e: React.MouseEvent) => void;
}): React.JSX.Element {
  const b = (cell: number, label: string, fn: () => void, title: string, c = '#bbb') => (
    <button key={cell} data-lf-widget={widgetId} data-lf-cell={cell}
      title={`${title} · right-click: link / learn`}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={fn}
      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onLink(cell, e); }}
      style={{
        height: Math.max(20, fs * 1.6), minWidth: Math.max(26, fs * 2.2), padding: '0 6px', borderRadius: 3, cursor: 'pointer',
        background: 'rgba(0,0,0,0.4)', color: c, border: '1px solid #2a2a2a', fontSize: fs, fontFamily: 'inherit', lineHeight: 1,
      }}>{label}</button>
  );
  return (
    <div style={{ display: 'flex', gap: 3 }}>
      {b(-4, '⏮', fns.first, 'First')}
      {b(-3, '◀', fns.prev, 'Previous')}
      {b(-1, '■', fns.stop, 'Stop', pal('#e07f2b'))}
      {b(-2, '▶▶', fns.next, 'Next', color)}
    </div>
  );
}
