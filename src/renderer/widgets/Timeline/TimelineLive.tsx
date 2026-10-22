import { pal, palRgb, onPalette } from '../../palette';
import { masterOut } from '../../audio/audioMaster';
import React, { useState, useRef, useEffect } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { createPortal } from 'react-dom';
import { nanoid } from 'nanoid';
import type {
  TimelineWidget, TimelineTrack,
  ValueTrack, ColorTrack, ColorOscFormat, SoundTrack, TrigTrack, CueTrack, CueRegion, WaitTrack, WaitPoint,
  ValueKeyframe, ColorKeyframe, TrigMarker, TimelineMarker,
  TimelineEasing, LtcAudioConnection, SoundRegion, AudioOutputConnection,
} from '../../../shared/types/project';
import type { Mapping, OscMapping, MidiMapping, ArtNetMapping, SacnMapping } from '../../../shared/types/mapping';
import type { MtcFramePayload } from '../../../shared/types/ipc';
import { useStore } from '../../store';
import { dispatchValue } from '../../ipc/dispatch';
import { bridge } from '../../ipc/bridge';
import { timelineTrigCells, timelineCueCells } from '../utils';
import NumberInput from '../base/NumberInput';
import CellLinkMenu from '../base/CellLinkMenu';
import { onTimelineCommand, TIMELINE_TRANSPORT } from './transport';

// ─── Layout constants ─────────────────────────────────────────────────────────
const TRACK_H  = 56;
const RULER_H  = 32;   // room for a 9px tick plus a readable label under it
const MARKER_H = 15;   // marker lane, kept clear of the ruler numbers
const LEFT_W   = 128;
const RIGHT_W  = 176;
const HEAD_H   = 50;
const KF_D     = 10;

// ─── Pure helpers ─────────────────────────────────────────────────────────────

function fmt(sec: number): string {
  const m  = Math.floor(sec / 60);
  const s  = Math.floor(sec % 60);
  const ds = Math.floor((sec % 1) * 10);
  return `${m}:${String(s).padStart(2, '0')}.${ds}`;
}

// Ruler label. In frames it reads as timecode (m:ss:ff); in seconds the decimal
// only appears once the step is fine enough to need it.
function fmtRuler(sec: number, unit: 'sec' | 'frames', fps: number, step: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  if (unit === 'frames') {
    const f = Math.round((sec - Math.floor(sec)) * fps) % Math.round(fps);
    return `${m}:${String(s).padStart(2, '0')}:${String(f).padStart(2, '0')}`;
  }
  if (step >= 1) return `${m}:${String(s).padStart(2, '0')}`;
  const dec = step >= 0.1 ? 1 : 2;
  return `${m}:${String(s).padStart(2, '0')}.${String(Math.round((sec % 1) * 10 ** dec)).padStart(dec, '0')}`;
}

function fmtDur(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255];
}

function lerpHex(c1: string, c2: string, t: number): string {
  const [r1, g1, b1] = hexToRgb(c1);
  const [r2, g2, b2] = hexToRgb(c2);
  const hex2 = (v: number) => Math.round(v * 255).toString(16).padStart(2, '0');
  return `#${hex2(r1 + (r2 - r1) * t)}${hex2(g1 + (g2 - g1) * t)}${hex2(b1 + (b2 - b1) * t)}`;
}

// ─── Bezier helpers ─────────────────────────────────────────────���──────────────

function cubicBez(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const mt = 1 - t;
  return mt*mt*mt*p0 + 3*mt*mt*t*p1 + 3*mt*t*t*p2 + t*t*t*p3;
}

function cubicBezDeriv(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const mt = 1 - t;
  return 3*mt*mt*(p1-p0) + 6*mt*t*(p2-p1) + 3*t*t*(p3-p2);
}

function evalBezierAtX(k0: ValueKeyframe, k1: ValueKeyframe, targetX: number): number {
  const dt   = k1.time - k0.time;
  const cp1x = k0.time + (k0.cpOut?.[0] ?? dt / 3);
  const cp1y = k0.value + (k0.cpOut?.[1] ?? 0);
  const cp2x = k1.time + (k1.cpIn?.[0]  ?? -dt / 3);
  const cp2y = k1.value + (k1.cpIn?.[1]  ?? 0);
  // Newton-Raphson to find bezier parameter u where bezierX(u) == targetX
  let u = (targetX - k0.time) / dt;
  for (let i = 0; i < 8; i++) {
    const bx  = cubicBez(k0.time, cp1x, cp2x, k1.time, u);
    const dbx = cubicBezDeriv(k0.time, cp1x, cp2x, k1.time, u);
    if (Math.abs(dbx) < 1e-10) break;
    u = Math.max(0, Math.min(1, u - (bx - targetX) / dbx));
  }
  return cubicBez(k0.value, cp1y, cp2y, k1.value, u);
}

function getValueAt(tNorm: number, kfs: ValueKeyframe[]): number {
  if (!kfs.length) return 0;
  const s = [...kfs].sort((a, b) => a.time - b.time);
  if (tNorm <= s[0].time) return s[0].value;
  if (tNorm >= s[s.length - 1].time) return s[s.length - 1].value;
  for (let i = 0; i < s.length - 1; i++) {
    const k0 = s[i], k1 = s[i + 1];
    if (tNorm >= k0.time && tNorm <= k1.time) {
      if (k0.easing === 'step') return k0.value;
      if (k0.easing === 'bezier') return evalBezierAtX(k0, k1, tNorm);
      const lt = (tNorm - k0.time) / (k1.time - k0.time);
      return k0.value + lt * (k1.value - k0.value);
    }
  }
  return s[s.length - 1].value;
}

function buildValuePath(kfs: ValueKeyframe[]): string {
  if (kfs.length < 2) return '';
  const s = [...kfs].sort((a, b) => a.time - b.time);
  const toSvg = (x: number, y: number) => `${x * 100} ${(1 - y) * 100}`;
  let d = `M ${toSvg(s[0].time, s[0].value)}`;
  for (let i = 0; i < s.length - 1; i++) {
    const k0 = s[i], k1 = s[i + 1];
    const dt = k1.time - k0.time;
    if (k0.easing === 'step') {
      // Sharp step: horizontal then vertical
      d += ` H ${k1.time * 100} V ${(1 - k1.value) * 100}`;
    } else if (k0.easing === 'bezier') {
      const cp1x = k0.time + (k0.cpOut?.[0] ?? dt / 3);
      const cp1y = k0.value + (k0.cpOut?.[1] ?? 0);
      const cp2x = k1.time + (k1.cpIn?.[0]  ?? -dt / 3);
      const cp2y = k1.value + (k1.cpIn?.[1]  ?? 0);
      d += ` C ${toSvg(cp1x, cp1y)} ${toSvg(cp2x, cp2y)} ${toSvg(k1.time, k1.value)}`;
    } else {
      d += ` L ${toSvg(k1.time, k1.value)}`;
    }
  }
  return d;
}

function getColorAt(tNorm: number, kfs: ColorKeyframe[]): string {
  if (!kfs.length) return '#000000';
  const s = [...kfs].sort((a, b) => a.time - b.time);
  if (tNorm <= s[0].time) return s[0].color;
  if (tNorm >= s[s.length - 1].time) return s[s.length - 1].color;
  for (let i = 0; i < s.length - 1; i++) {
    const k0 = s[i], k1 = s[i + 1];
    if (tNorm >= k0.time && tNorm <= k1.time) {
      if ((k0.easing ?? 'linear') === 'step') return k0.color;
      const lt = (tNorm - k0.time) / (k1.time - k0.time);
      return lerpHex(k0.color, k1.color, lt);
    }
  }
  return s[s.length - 1].color;
}

function buildColorGradient(kfs: ColorKeyframe[]): string {
  if (!kfs.length) return 'linear-gradient(to right, #1a1a1a, #1a1a1a)';
  const s = [...kfs].sort((a, b) => a.time - b.time);
  const stops: string[] = [];
  if (s[0].time > 0) stops.push(`${s[0].color} 0%`);
  for (let i = 0; i < s.length; i++) {
    const k = s[i];
    const prevK = s[i - 1];
    // Hard stop: duplicate previous color up to this position for step easing
    if (prevK && (prevK.easing ?? 'linear') === 'step') {
      stops.push(`${prevK.color} ${(k.time * 100).toFixed(2)}%`);
    }
    stops.push(`${k.color} ${(k.time * 100).toFixed(2)}%`);
  }
  if (s[s.length - 1].time < 1) stops.push(`${s[s.length - 1].color} 100%`);
  return `linear-gradient(to right, ${stops.join(', ')})`;
}

const TRACK_ICON: Record<string, string> = {
  value: '◆', color: '●', trig: '▲', sound: '♪', cue: '▮', wait: '⏸',
};
const TRACK_KIND_LABEL: Record<string, string> = {
  value: 'Value track', color: 'Color track', trig: 'Trig track',
  cue: 'Cue track', wait: 'Wait track', sound: 'Sound track',
};
function trackColor(t: TimelineTrack): string {
  if (t.kind === 'value') return (t as ValueTrack).color;
  if (t.kind === 'color') return pal('#da7e2e');
  if (t.kind === 'trig')  return (t as TrigTrack).color;
  if (t.kind === 'wait')  return (t as WaitTrack).color;
  if (t.kind === 'cue')   return (t as CueTrack).cues[0]?.color ?? pal('#68bbc1');
  return pal('#4a999f');
}

// Cue blocks cycle through these so consecutive blocks never look alike.
const make_CUE_COLORS = () => ([pal('#68bbc1'), pal('#60b8be'), pal('#db8235'), pal('#de8b42'), pal('#e08b40'), pal('#48a9b0')]);
let CUE_COLORS = make_CUE_COLORS();
onPalette(() => { CUE_COLORS = make_CUE_COLORS(); });

// Which cue block contains tNorm: the last block that starts at or before it.
function activeCueIndex(cues: CueRegion[], tNorm: number): number {
  let idx = -1;
  for (let i = 0; i < cues.length; i++) {
    if (cues[i].time <= tNorm) idx = i; else break;
  }
  return idx;
}

function getSoundRegions(t: SoundTrack): SoundRegion[] {
  if (t.regions && t.regions.length > 0) return t.regions;
  return [{ id: t.id + '_r', offset: t.offset, trimStart: t.trimStart, trimEnd: t.trimEnd }];
}

async function computeWaveform(src: string): Promise<{ wf: Float32Array; audioDur: number } | null> {
  try {
    const ctx  = new OfflineAudioContext(1, 44100, 44100);
    const resp = await fetch(src);
    const ab   = await resp.arrayBuffer();
    const buf  = await ctx.decodeAudioData(ab);
    const audioDur = buf.duration;
    const samples  = Math.min(32000, Math.max(1200, Math.round(audioDur * 500)));
    const data = buf.getChannelData(0);
    const bs   = Math.floor(data.length / samples);
    const wf   = new Float32Array(samples);
    for (let i = 0; i < samples; i++) {
      let peak = 0;
      for (let j = 0; j < bs; j++) peak = Math.max(peak, Math.abs(data[i * bs + j] ?? 0));
      wf[i] = peak;
    }
    const maxPeak = Math.max(...wf, 0.001);
    for (let i = 0; i < samples; i++) wf[i] = (wf[i] / maxPeak) * 0.75;
    return { wf, audioDur };
  } catch { return null; }
}

// ─── Waveform canvas ──────────────────────────────────────────────────────────
// Renders at natural scale: canvas width = audioDur, positioned/clipped by CSS.
// The parent div must have position:relative and overflow:hidden.

function WaveformCanvas({ wf, color, audioDur, regDur, trimStart }: {
  wf: Float32Array | null;
  color: string;
  audioDur: number;
  regDur: number;
  trimStart: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c || !wf) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const { width: w, height: h } = c;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = color;
    const bw = w / wf.length;
    for (let i = 0; i < wf.length; i++) {
      const bh = Math.max(1, wf[i] * h);
      ctx.fillRect(i * bw, (h - bh) / 2, Math.max(0.5, bw - 0.5), bh);
    }
  }, [wf, color]);
  const cssWidth  = `${(audioDur / Math.max(regDur, 0.001)) * 100}%`;
  const cssLeft   = `-${(trimStart  / Math.max(regDur, 0.001)) * 100}%`;
  return (
    <canvas
      ref={ref}
      width={wf?.length ?? 600}
      height={TRACK_H}
      style={{ position: 'absolute', left: cssLeft, width: cssWidth, height: '100%', display: 'block' }}
    />
  );
}

// ─── Track row ────────────────────────────────────────────────────────────────

interface TrackRowProps {
  track: TimelineTrack;
  isSelected: boolean;
  selectedKfId: string | null;
  tNorm: number;
  wf?: Float32Array;
  wfLoading?: boolean;
  toolMode: 'pointer' | 'cut';
  duration: number;
  trackHeight: number;
  onSelect: () => void;
  onSelectKf: (id: string) => void;
  onAddKf: (time: number, value: number) => void;
  onMoveKf: (kfId: string, time: number, value: number) => void;
  onPatchKf: (kfId: string, patch: Partial<ValueKeyframe>) => void;
  onCutTrack: (time: number) => void;
  onUpdateTrack: (patch: Partial<TimelineTrack>) => void;
  onSplitCue: (time: number) => void;
  onAddWait: (time: number) => void;
}

function TrackRow({ track, isSelected, selectedKfId, tNorm, wf, wfLoading, toolMode, duration, trackHeight, onSelect, onSelectKf, onAddKf, onMoveKf, onPatchKf, onCutTrack, onUpdateTrack, onSplitCue, onAddWait }: TrackRowProps) {
  const rowRef     = useRef<HTMLDivElement>(null);
  const dragRef    = useRef<{ kfId: string; origTime: number; origValue: number; startX: number; startY: number } | null>(null);
  const sndDragRef = useRef<{ kind: 'move' | 'trimL' | 'trimR'; regionId: string; origOffset: number; origTrimStart: number; origTrimEnd: number; startX: number } | null>(null);
  const cpDragRef  = useRef<{ kfId: string; handle: 'cpOut' | 'cpIn'; startX: number; startY: number; origCp: [number,number] } | null>(null);

  function startRegionDrag(e: React.PointerEvent, kind: 'move' | 'trimL' | 'trimR', reg: SoundRegion) {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    sndDragRef.current = { kind, regionId: reg.id, origOffset: reg.offset, origTrimStart: reg.trimStart ?? 0, origTrimEnd: reg.trimEnd ?? 0, startX: e.clientX };
  }

  function handleRowDown(e: React.PointerEvent<HTMLDivElement>) {
    onSelect();
    if (track.kind === 'sound') {
      if (toolMode === 'cut') {
        const rect = e.currentTarget.getBoundingClientRect();
        const t = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        onCutTrack(t);
      }
      return;
    }
    if (track.kind === 'trig') {
      const rect = e.currentTarget.getBoundingClientRect();
      const t = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      onAddKf(t, 0);
      return;
    }
    if (track.kind === 'cue') {
      const rect = e.currentTarget.getBoundingClientRect();
      const t = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      // Ctrl-click cuts (double-click does too, below); a plain click selects
      // the block you clicked so you can rename or colour it.
      if (e.ctrlKey || e.metaKey) { onSplitCue(t); return; }
      const idx = activeCueIndex((track as CueTrack).cues, t);
      if (idx >= 0) onSelectKf((track as CueTrack).cues[idx].id);
      return;
    }
    if (track.kind === 'wait') {
      const rect = e.currentTarget.getBoundingClientRect();
      const t = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      onAddWait(t);
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const t = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const v = Math.max(0, Math.min(1, 1 - (e.clientY - rect.top) / rect.height));
    onAddKf(t, v);
  }

  function handleRowMove(e: React.PointerEvent<HTMLDivElement>) {
    const d = sndDragRef.current;
    if (!d || !rowRef.current) return;
    const rect = rowRef.current.getBoundingClientRect();
    const dxSec = ((e.clientX - d.startX) / rect.width) * duration;
    if (d.kind === 'move') {
      onUpdateTrack({ regionId: d.regionId, offset: d.origOffset + dxSec } as never);
    } else if (d.kind === 'trimL') {
      // Crop from left: both offset and trimStart move together → right edge stays fixed
      const newTrimStart = Math.max(0, d.origTrimStart + dxSec);
      const actualDx = newTrimStart - d.origTrimStart;
      onUpdateTrack({ regionId: d.regionId, offset: d.origOffset + actualDx, trimStart: newTrimStart } as never);
    } else {
      const newTrimEnd = Math.max(0, d.origTrimEnd - dxSec);
      onUpdateTrack({ regionId: d.regionId, trimEnd: newTrimEnd } as never);
    }
  }

  function handleRowUp() {
    sndDragRef.current = null;
  }

  function handleKfDown(e: React.PointerEvent<HTMLDivElement>, kf: ValueKeyframe | ColorKeyframe) {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    onSelectKf(kf.id);
    dragRef.current = {
      kfId: kf.id,
      origTime: kf.time,
      origValue: 'value' in kf ? kf.value : 0,
      startX: e.clientX,
      startY: e.clientY,
    };
  }

  function handleKfMove(e: React.PointerEvent<HTMLDivElement>, kf: ValueKeyframe | ColorKeyframe) {
    const d = dragRef.current;
    if (!d || d.kfId !== kf.id || !rowRef.current) return;
    const rect = rowRef.current.getBoundingClientRect();
    // rect.width == totalW so pixel delta / rect.width = correct time fraction change
    const newTime  = Math.max(0, Math.min(1, d.origTime  + (e.clientX - d.startX) / rect.width));
    const newValue = track.kind === 'value'
      ? Math.max(0, Math.min(1, d.origValue - (e.clientY - d.startY) / trackHeight))
      : d.origValue;
    onMoveKf(d.kfId, newTime, newValue);
  }

  const kfs: (ValueKeyframe | ColorKeyframe)[] = (track.kind === 'value' || track.kind === 'color')
    ? (track as ValueTrack | ColorTrack).keyframes
    : [];

  const trigMarkers: TrigMarker[] = track.kind === 'trig' ? (track as TrigTrack).keyframes : [];

  const trackAccent = track.kind === 'value' ? (track as ValueTrack).color
    : track.kind === 'color' ? pal('#da7e2e')
    : track.kind === 'trig'  ? (track as TrigTrack).color
    : pal('#4a999f');

  const sndTrack  = track.kind === 'sound' ? (track as SoundTrack) : null;
  const sndRegions = sndTrack ? getSoundRegions(sndTrack) : [];

  const rowCursor = track.kind === 'sound'
    ? (toolMode === 'cut' ? 'crosshair' : 'default')
    : 'crosshair';

  return (
    <div
      ref={rowRef}
      style={{
        height: trackHeight, position: 'relative', boxSizing: 'border-box',
        borderBottom: '1px solid #141414',
        background: isSelected ? pal('#101f20') : '#0a0a0a',
        cursor: rowCursor,
        userSelect: 'none',
      }}
      onPointerDown={handleRowDown}
      onPointerMove={handleRowMove}
      onPointerUp={handleRowUp}
      onPointerCancel={handleRowUp}
      onDoubleClick={(e) => {
        if (track.kind !== 'cue') return;
        const rect = e.currentTarget.getBoundingClientRect();
        onSplitCue(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)));
      }}
    >
      {/* Cue blocks — the whole timeline is always covered */}
      {track.kind === 'cue' && (track as CueTrack).cues.map((c, i, arr) => {
        const end = i + 1 < arr.length ? arr[i + 1].time : 1;
        const isLive = tNorm >= c.time && tNorm < end + (end === 1 ? 0.0001 : 0);
        const isSel  = selectedKfId === c.id;
        return (
          <div
            key={c.id}
            style={{
              position: 'absolute', top: 2, bottom: 2,
              left: `${c.time * 100}%`, width: `${(end - c.time) * 100}%`,
              background: isLive ? c.color : `${c.color}33`,
              borderLeft: i === 0 ? undefined : `2px solid ${c.color}`,
              boxShadow: isSel ? 'inset 0 0 0 2px #fff' : undefined,
              borderRadius: 2, overflow: 'hidden',
              display: 'flex', alignItems: 'center', pointerEvents: 'none',
            }}
          >
            <span style={{
              fontSize: 10, padding: '0 6px', whiteSpace: 'nowrap',
              color: isLive ? '#000' : '#bbb', fontWeight: isLive ? 700 : 400,
              overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
              {c.name}
            </span>
          </div>
        );
      })}

      {/* Wait points — playback parks here until you continue */}
      {track.kind === 'wait' && (track as WaitTrack).points.map((p) => {
        const isSel = selectedKfId === p.id;
        const tint  = p.bypass ? '#555555' : (track as WaitTrack).color;
        return (
          <div
            key={p.id}
            onPointerDown={(e) => { e.stopPropagation(); onSelectKf(p.id); }}
            style={{
              position: 'absolute', top: 0, bottom: 0, left: `${p.time * 100}%`,
              width: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <div style={{
              position: 'absolute', top: 2, bottom: 2, left: -1, width: 2,
              background: tint, opacity: p.bypass ? 0.4 : (isSel ? 1 : 0.7),
            }} />
            <div style={{
              position: 'absolute', top: 4,
              display: 'flex', gap: 2, padding: '2px 4px', borderRadius: 2,
              background: '#0d0d0d', border: `1px solid ${tint}`,
              boxShadow: isSel ? '0 0 0 2px #fff' : undefined, cursor: 'pointer',
              transform: 'translateX(-50%)', alignItems: 'center',
              opacity: p.bypass ? 0.55 : 1,
            }}>
              <span style={{ width: 2, height: 8, background: tint, display: 'block' }} />
              <span style={{ width: 2, height: 8, background: tint, display: 'block' }} />
              {p.name && <span style={{ fontSize: 9, color: p.bypass ? '#666' : '#999', marginLeft: 2, whiteSpace: 'nowrap' }}>{p.name}</span>}
            </div>
          </div>
        );
      })}
      {/* Color gradient — full opacity */}
      {track.kind === 'color' && (
        <div style={{ position: 'absolute', inset: 0, background: buildColorGradient((track as ColorTrack).keyframes), pointerEvents: 'none' }} />
      )}

      {/* Trig markers + name chips */}
      {track.kind === 'trig' && trigMarkers.map((m) => {
        const isSel = selectedKfId === m.id;
        const barTop = 4;
        const chipH = 14;
        const labelTop = barTop + (m.labelY ?? 0) * Math.max(0, trackHeight - barTop * 2 - chipH);
        const nameLabelDragRef = { startY: 0, origLY: 0 };
        return (
          <React.Fragment key={m.id}>
            {/* Vertical bar */}
            <div
              style={{
                position: 'absolute', top: barTop, bottom: barTop,
                left: `${m.time * 100}%`,
                width: 3, marginLeft: -1,
                background: trackAccent, borderRadius: 2, cursor: 'grab', zIndex: 2,
                boxShadow: isSel ? `0 0 0 1px #fff` : 'none',
                border: isSel ? '1px solid #fff' : '1px solid transparent',
              }}
              onPointerDown={(e) => {
                e.stopPropagation();
                e.currentTarget.setPointerCapture(e.pointerId);
                onSelectKf(m.id);
                dragRef.current = { kfId: m.id, origTime: m.time, origValue: 0, startX: e.clientX, startY: e.clientY };
              }}
              onPointerMove={(e) => {
                const d = dragRef.current;
                if (!d || d.kfId !== m.id || !rowRef.current) return;
                const rect = rowRef.current.getBoundingClientRect();
                const newTime = Math.max(0, Math.min(1, d.origTime + (e.clientX - d.startX) / rect.width));
                onMoveKf(d.kfId, newTime, 0);
              }}
              onPointerUp={() => { dragRef.current = null; }}
              onPointerCancel={() => { dragRef.current = null; }}
            />
            {/* Name chip — anchored at top of bar, draggable down */}
            {m.name && (
              <div
                style={{
                  position: 'absolute',
                  left: `${m.time * 100}%`,
                  top: labelTop,
                  transform: 'translateX(6px)',
                  background: '#0a0e14',
                  border: `1px solid ${trackAccent}`,
                  borderRadius: 2, padding: '1px 5px',
                  fontSize: 9, color: trackAccent,
                  cursor: 'ns-resize', zIndex: 5,
                  userSelect: 'none', whiteSpace: 'nowrap',
                  lineHeight: `${chipH}px`,
                  pointerEvents: 'all',
                }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  const el = e.currentTarget;
                  el.setPointerCapture(e.pointerId);
                  nameLabelDragRef.startY = e.clientY;
                  nameLabelDragRef.origLY = m.labelY ?? 0;
                  const range = Math.max(1, trackHeight - barTop * 2 - chipH);
                  const onMove = (me: PointerEvent) => {
                    const newLY = Math.max(0, Math.min(1, nameLabelDragRef.origLY + (me.clientY - nameLabelDragRef.startY) / range));
                    onPatchKf(m.id, { labelY: newLY } as never);
                  };
                  const onUp = () => { el.removeEventListener('pointermove', onMove as EventListener); };
                  el.addEventListener('pointermove', onMove as EventListener);
                  el.addEventListener('pointerup', onUp, { once: true });
                  el.addEventListener('pointercancel', onUp, { once: true });
                }}
              >
                {m.name}
              </div>
            )}
          </React.Fragment>
        );
      })}

      {/* Sound track: dark base + one box per region */}
      {track.kind === 'sound' && (
        <>
          <div style={{ position: 'absolute', inset: 0, background: '#050505', pointerEvents: 'none' }} />
          {sndRegions.map((reg) => {
            const st = sndTrack!;
            const audioDur = st.audioDuration ?? duration;
            const regDur   = audioDur - (reg.trimStart ?? 0) - (reg.trimEnd ?? 0);
            const leftPct  = (Math.max(0, reg.offset) / duration) * 100;
            const widthPct = Math.max(0.5, (regDur / duration) * 100);
            return (
              <React.Fragment key={reg.id}>
                {/* Audio region body — overflow:hidden clips the natural-scale waveform canvas */}
                <div
                  style={{ position: 'absolute', top: 0, bottom: 0, left: `${leftPct}%`, width: `${widthPct}%`, background: pal('#0b1617'), cursor: toolMode === 'cut' ? 'crosshair' : 'grab', zIndex: 1, overflow: 'hidden' }}
                  onPointerDown={(e) => { if (toolMode !== 'cut') startRegionDrag(e, 'move', reg); }}
                  onPointerMove={handleRowMove}
                  onPointerUp={handleRowUp}
                  onPointerCancel={handleRowUp}
                >
                  {wf ? (
                    <div style={{ position: 'absolute', inset: 0, opacity: 0.8 }}>
                      <WaveformCanvas
                        wf={wf} color={trackAccent}
                        audioDur={st.audioDuration ?? regDur}
                        regDur={regDur}
                        trimStart={reg.trimStart ?? 0}
                      />
                    </div>
                  ) : (
                    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3 }}>
                      {wfLoading
                        ? [0,1,2,3,4].map((i) => (
                            <div key={i} style={{ width: 2, background: trackAccent, borderRadius: 1, opacity: 0.5,
                              height: `${20 + Math.sin((Date.now() / 200) + i) * 15}%`,
                              animation: `tl-pulse 0.8s ease-in-out ${i * 0.12}s infinite alternate` }} />
                          ))
                        : <span style={{ fontSize: 9, color: '#333' }}>{st.src ? '…' : 'no audio'}</span>
                      }
                    </div>
                  )}
                </div>
                {/* Left trim handle */}
                <div
                  style={{ position: 'absolute', top: 0, bottom: 0, left: `${leftPct}%`, width: 6, background: trackAccent, opacity: 0.7, cursor: 'ew-resize', zIndex: 3 }}
                  onPointerDown={(e) => startRegionDrag(e, 'trimL', reg)}
                  onPointerMove={handleRowMove}
                  onPointerUp={handleRowUp}
                  onPointerCancel={handleRowUp}
                />
                {/* Right trim handle */}
                <div
                  style={{ position: 'absolute', top: 0, bottom: 0, left: `calc(${leftPct}% + ${widthPct}% - 6px)`, width: 6, background: trackAccent, opacity: 0.7, cursor: 'ew-resize', zIndex: 3 }}
                  onPointerDown={(e) => startRegionDrag(e, 'trimR', reg)}
                  onPointerMove={handleRowMove}
                  onPointerUp={handleRowUp}
                  onPointerCancel={handleRowUp}
                />
              </React.Fragment>
            );
          })}
        </>
      )}

      {/* Value track: gridlines + curve + labels */}
      {track.kind === 'value' && (
        <>
          <div style={{ position: 'absolute', left: 2, top: 1,    fontSize: 7, color: '#252525', lineHeight: 1, pointerEvents: 'none', zIndex: 1 }}>1.0</div>
          <div style={{ position: 'absolute', left: 2, top: '50%', fontSize: 7, color: '#252525', lineHeight: 1, transform: 'translateY(-50%)', pointerEvents: 'none', zIndex: 1 }}>0.5</div>
          <div style={{ position: 'absolute', left: 2, bottom: 1,  fontSize: 7, color: '#252525', lineHeight: 1, pointerEvents: 'none', zIndex: 1 }}>0.0</div>
          <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
            preserveAspectRatio="none" viewBox="0 0 100 100">
            {/* Grid lines */}
            <line x1="0" y1="1"  x2="100" y2="1"  stroke="#1c1c1c" strokeWidth={1} vectorEffect="non-scaling-stroke" />
            <line x1="0" y1="50" x2="100" y2="50" stroke="#181818" strokeWidth={1} vectorEffect="non-scaling-stroke" strokeDasharray="2 4" />
            <line x1="0" y1="99" x2="100" y2="99" stroke="#1c1c1c" strokeWidth={1} vectorEffect="non-scaling-stroke" />
            {/* Baseline */}
            <line x1="0" y1="99" x2="100" y2="99" stroke={trackAccent} strokeWidth={1} vectorEffect="non-scaling-stroke" strokeOpacity={0.2} />
            {/* Single-keyframe level indicator */}
            {kfs.length === 1 && (() => {
              const k = kfs[0] as ValueKeyframe;
              const y = (1 - k.value) * 100;
              return <line x1="0" y1={y} x2="100" y2={y} stroke={trackAccent} strokeWidth={1} vectorEffect="non-scaling-stroke" strokeOpacity={0.3} strokeDasharray="3 5" />;
            })()}
            {/* Curve — built as proper SVG path (H/V for step, C for bezier, L for linear) */}
            {kfs.length >= 2 && (
              <path
                d={buildValuePath(kfs as ValueKeyframe[])}
                fill="none" stroke={trackAccent} strokeWidth={2}
                vectorEffect="non-scaling-stroke" strokeOpacity={0.7} />
            )}
          </svg>
        </>
      )}

      {/* Keyframe dots */}
      {kfs.map((kf) => {
        const xPct = kf.time * 100;
        const yPct = track.kind === 'value' && 'value' in kf ? (1 - (kf as ValueKeyframe).value) * 100 : 50;
        const isSelKf = selectedKfId === kf.id;
        return (
          <div
            key={kf.id}
            style={{
              position: 'absolute',
              left: `${xPct}%`, top: `${yPct}%`,
              width: KF_D, height: KF_D,
              marginLeft: -KF_D / 2, marginTop: -KF_D / 2,
              borderRadius: track.kind === 'value' ? '50%' : 2,
              background: track.kind === 'color' ? '#000000' : trackAccent,
              border: `2px solid ${track.kind === 'color' ? '#ffffff' : isSelKf ? '#fff' : 'rgba(255,255,255,0.25)'}`,
              boxShadow: isSelKf ? '0 0 0 2px #fff' : track.kind === 'color' ? '0 0 0 1px rgba(255,255,255,0.15)' : 'none',
              cursor: 'grab', zIndex: 2,
            }}
            onPointerDown={(e) => handleKfDown(e, kf)}
            onPointerMove={(e) => handleKfMove(e, kf)}
            onPointerUp={() => { dragRef.current = null; }}
            onPointerCancel={() => { dragRef.current = null; }}
          />
        );
      })}

      {/* Bezier control handles for value track */}
      {track.kind === 'value' && (kfs as ValueKeyframe[]).filter((k) => k.easing === 'bezier').map((kf) => {
        const sorted = [...(kfs as ValueKeyframe[])].sort((a, b) => a.time - b.time);
        const idx = sorted.findIndex((k) => k.id === kf.id);
        const prev = sorted[idx - 1];
        const next = sorted[idx + 1];
        const handles: Array<{ cp: 'cpOut' | 'cpIn'; xPct: number; yPct: number; lineX: number; lineY: number }> = [];
        const dtN = next ? (next.time - kf.time) / 3 : 0.1;
        const dtP = prev ? (kf.time - prev.time) / 3 : 0.1;
        if (next) {
          const ox = kf.time + (kf.cpOut?.[0] ?? dtN);
          const oy = kf.value + (kf.cpOut?.[1] ?? 0);
          handles.push({ cp: 'cpOut', xPct: ox * 100, yPct: (1 - oy) * 100, lineX: kf.time * 100, lineY: (1 - kf.value) * 100 });
        }
        if (prev && prev.easing === 'bezier') {
          const ix = kf.time + (kf.cpIn?.[0] ?? -dtP);
          const iy = kf.value + (kf.cpIn?.[1] ?? 0);
          handles.push({ cp: 'cpIn', xPct: ix * 100, yPct: (1 - iy) * 100, lineX: kf.time * 100, lineY: (1 - kf.value) * 100 });
        }
        return handles.map((h) => (
          <React.Fragment key={`${kf.id}-${h.cp}`}>
            {/* Line from kf to handle */}
            <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 3 }}
              preserveAspectRatio="none" viewBox="0 0 100 100">
              <line x1={h.lineX} y1={h.lineY} x2={h.xPct} y2={h.yPct}
                stroke="rgba(255,255,255,0.25)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
            </svg>
            {/* Draggable handle dot */}
            <div
              style={{
                position: 'absolute',
                left: `${h.xPct}%`, top: `${h.yPct}%`,
                width: 7, height: 7,
                marginLeft: -3.5, marginTop: -3.5,
                borderRadius: 1,
                background: '#aaa',
                border: '1px solid #fff',
                cursor: 'move', zIndex: 4,
                transform: 'rotate(45deg)',
              }}
              onPointerDown={(e) => {
                e.stopPropagation();
                e.currentTarget.setPointerCapture(e.pointerId);
                cpDragRef.current = {
                  kfId: kf.id, handle: h.cp,
                  startX: e.clientX, startY: e.clientY,
                  origCp: h.cp === 'cpOut' ? (kf.cpOut ?? [dtN, 0]) : (kf.cpIn ?? [-dtP, 0]),
                };
              }}
              onPointerMove={(e) => {
                const d = cpDragRef.current;
                if (!d || d.kfId !== kf.id || d.handle !== h.cp || !rowRef.current) return;
                const rect = rowRef.current.getBoundingClientRect();
                const dxNorm = (e.clientX - d.startX) / rect.width;
                const dyNorm = -(e.clientY - d.startY) / trackHeight;
                const newCp: [number, number] = [d.origCp[0] + dxNorm, d.origCp[1] + dyNorm];
                onPatchKf(kf.id, { [h.cp]: newCp } as Partial<ValueKeyframe>);
              }}
              onPointerUp={() => { cpDragRef.current = null; }}
              onPointerCancel={() => { cpDragRef.current = null; }}
            />
          </React.Fragment>
        ));
      })}

      {/* Playhead highlight */}
      <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${tNorm * 100}%`, width: 1, background: `rgba(${palRgb('#ff8c28')},0.3)`, pointerEvents: 'none' }} />
    </div>
  );
}

// ─── Compact mapping editor (OSC / MIDI / off) ────────────────────────────────

// Colour track → OSC, in the format chosen in its settings. RGBW takes the
// white out of the three (w = min(r, g, b)), the usual way for RGBW fixtures.
function sendColorOsc(track: ColorTrack, rgb: [number, number, number] | number[]): void {
  const [r, g, b] = rgb as [number, number, number];
  const fmt = track.oscFormat ?? 'rgb';
  const withW = fmt === 'rgbw' || fmt === 'rgbw-split';
  const w = withW ? Math.min(r, g, b) : 0;
  const vals = withW ? [r - w, g - w, b - w, w] : [r, g, b];
  const addr = track.oscAddress.replace(/\/+$/, '');
  if (fmt === 'rgb-split' || fmt === 'rgbw-split') {
    const names = ['r', 'g', 'b', 'w'];
    vals.forEach((v, i) => bridge.send('tr:osc:send', { address: `${addr}/${names[i]}`, args: [{ type: 'f', value: v }] }));
  } else {
    bridge.send('tr:osc:send', { address: addr, args: vals.map((v) => ({ type: 'f' as const, value: v })) });
  }
}

const COLOR_FORMATS: { value: ColorOscFormat; label: string; hint: string }[] = [
  { value: 'rgb',        label: 'RGB',     hint: 'one message: /addr r g b' },
  { value: 'rgbw',       label: 'RGBW',    hint: 'one message: /addr r g b w (white taken out of the three)' },
  { value: 'rgb-split',  label: 'R·G·B',   hint: 'separate: /addr/r  /addr/g  /addr/b' },
  { value: 'rgbw-split', label: 'R·G·B·W', hint: 'separate: /addr/r  /addr/g  /addr/b  /addr/w' },
];

function ColorOscSettings({ track, onChange, sec, lbl, inp }: {
  track: ColorTrack; onChange: (p: Partial<ColorTrack>) => void;
  sec: React.CSSProperties; lbl: React.CSSProperties; inp: React.CSSProperties;
}) {
  const fmt = track.oscFormat ?? 'rgb';
  const cur = COLOR_FORMATS.find((f) => f.value === fmt)!;
  return (
    <div style={sec}>
      <div style={lbl}>OSC address</div>
      <input style={inp} value={track.oscAddress} onChange={(e) => onChange({ oscAddress: e.target.value })} placeholder="/color" />
      <div style={{ ...lbl, marginTop: 6 }}>Send as</div>
      <div style={{ display: 'flex', gap: 2 }}>
        {COLOR_FORMATS.map((f) => (
          <button key={f.value} title={f.hint} onClick={() => onChange({ oscFormat: f.value })}
            style={{
              flex: 1, padding: '3px 0', fontSize: 9, cursor: 'pointer', borderRadius: 2, fontFamily: 'inherit',
              background: fmt === f.value ? pal('#2b6569') : '#111', color: fmt === f.value ? '#fff' : '#777',
              border: `1px solid ${fmt === f.value ? pal('#4aa4aa') : '#1e1e1e'}`,
            }}>{f.label}</button>
        ))}
      </div>
      <div style={{ fontSize: 9, color: '#555', marginTop: 3 }}>{cur.hint.replace(/\/addr/g, (track.oscAddress || '/color').replace(/\/+$/, ''))}</div>
    </div>
  );
}

function MiniMap({ label, mapping, onChange }: { label: string; mapping: Mapping; onChange: (m: Mapping) => void }) {
  const inp: React.CSSProperties = { flex: 1, background: '#111', border: '1px solid #1e1e1e', color: '#aaa', borderRadius: 2, padding: '2px 4px', fontSize: 10, boxSizing: 'border-box', minWidth: 0 };
  const sel: React.CSSProperties = { width: '100%', background: '#111', border: '1px solid #1e1e1e', color: '#aaa', borderRadius: 2, padding: '2px 4px', fontSize: 10, boxSizing: 'border-box' };
  const hdr: React.CSSProperties = { fontSize: 9, color: '#444', marginBottom: 3 };
  const row: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 4, marginBottom: 3 };
  const cap: React.CSSProperties = { fontSize: 8, color: '#333', width: 26, flexShrink: 0, textAlign: 'right' };
  const type = mapping?.type ?? 'none';
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={hdr}>{label}</div>
      <select value={type} onChange={(e) => {
        const t = e.target.value;
        if      (t === 'none')   onChange(null);
        else if (t === 'midi')   onChange({ type: 'midi',   messageType: 'controlChange', channel: 1, number: 0, minValue: 0, maxValue: 127 });
        else if (t === 'osc')    onChange({ type: 'osc',    address: '/value' });
        else if (t === 'artnet') onChange({ type: 'artnet', universe: 0, channel: 1, minValue: 0, maxValue: 255 });
        else                     onChange({ type: 'sacn',   universe: 1, channel: 1, minValue: 0, maxValue: 255, priority: 100 });
      }} style={{ ...sel, marginBottom: mapping ? 4 : 0 }}>
        <option value="none">Off</option>
        <option value="midi">MIDI</option>
        <option value="osc">OSC</option>
        <option value="artnet">Art-Net</option>
        <option value="sacn">sACN</option>
      </select>
      {mapping?.type === 'midi' && (
        <>
          <div style={row}><span style={cap}>ch.</span>
            <input type="number" value={(mapping as MidiMapping).channel} min={1} max={16} style={inp}
              onChange={(e) => onChange({ ...mapping, channel: +e.target.value } as MidiMapping)} /></div>
          <div style={row}><span style={cap}>cc</span>
            <input type="number" value={(mapping as MidiMapping).number} min={0} max={127} style={inp}
              onChange={(e) => onChange({ ...mapping, number: +e.target.value } as MidiMapping)} /></div>
          <div style={row}><span style={cap}>min</span>
            <input type="number" value={(mapping as MidiMapping).minValue} min={0} max={127} style={inp}
              onChange={(e) => onChange({ ...mapping, minValue: +e.target.value } as MidiMapping)} /></div>
          <div style={row}><span style={cap}>max</span>
            <input type="number" value={(mapping as MidiMapping).maxValue} min={0} max={127} style={inp}
              onChange={(e) => onChange({ ...mapping, maxValue: +e.target.value } as MidiMapping)} /></div>
        </>
      )}
      {mapping?.type === 'osc' && (
        <div style={row}><span style={cap}>addr</span>
          <input value={(mapping as OscMapping).address} style={inp}
            onChange={(e) => onChange({ ...mapping, address: e.target.value } as OscMapping)} placeholder="/address" /></div>
      )}
      {(mapping?.type === 'artnet' || mapping?.type === 'sacn') && (
        <>
          <div style={row}><span style={cap}>univ.</span>
            <input type="number" value={(mapping as ArtNetMapping).universe} min={mapping.type === 'artnet' ? 0 : 1} style={inp}
              onChange={(e) => onChange({ ...mapping, universe: +e.target.value } as ArtNetMapping)} /></div>
          <div style={row}><span style={cap}>ch.</span>
            <input type="number" value={(mapping as ArtNetMapping).channel} min={1} max={512} style={inp}
              onChange={(e) => onChange({ ...mapping, channel: Math.max(1, Math.min(512, +e.target.value)) } as ArtNetMapping)} /></div>
          <div style={row}><span style={cap}>min</span>
            <input type="number" value={(mapping as ArtNetMapping).minValue} min={0} max={255} style={inp}
              onChange={(e) => onChange({ ...mapping, minValue: +e.target.value } as ArtNetMapping)} /></div>
          <div style={row}><span style={cap}>max</span>
            <input type="number" value={(mapping as ArtNetMapping).maxValue} min={0} max={255} style={inp}
              onChange={(e) => onChange({ ...mapping, maxValue: +e.target.value } as ArtNetMapping)} /></div>
          {mapping?.type === 'sacn' && (
            <div style={row}><span style={cap}>prio.</span>
              <input type="number" value={(mapping as SacnMapping).priority} min={1} max={200} style={inp}
                onChange={(e) => onChange({ ...mapping, priority: +e.target.value } as SacnMapping)} /></div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function TimelineLive({ widget }: { widget: TimelineWidget }): React.JSX.Element {
  const { updateWidget, activePageId, project } = useStore(useShallow((s) => ({ updateWidget: s.updateWidget, activePageId: s.activePageId, project: s.project })));

  const [isPlaying,   setIsPlaying]   = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [selTrkId,    setSelTrkId]    = useState<string | null>(null);
  const [selKfId,     setSelKfId]     = useState<string | null>(null);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [waveforms,   setWaveforms]   = useState<Map<string, Float32Array>>(new Map());
  const [wfLoading,   setWfLoading]   = useState<Set<string>>(new Set());
  const [scrubbingPH, setScrubbingPH] = useState(false);
  const [zoom,        setZoom]        = useState(15);
  const [scrollLeft,  setScrollLeft]  = useState(0);
  const [editingDur,  setEditingDur]  = useState(false);
  const [durInputStr, setDurInputStr] = useState('');
  const [toolMode,    setToolMode]    = useState<'pointer' | 'cut'>('pointer');
  const [tcActive,    setTcActive]    = useState(false);
  const [trackHeights, setTrackHeights] = useState<Map<string, number>>(new Map());
  const [clipboardKf, setClipboardKf] = useState<ValueKeyframe | ColorKeyframe | TrigMarker | null>(null);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [selMarkerId, setSelMarkerId] = useState<string | null>(null);
  // Set while playback is parked on a wait point. Space continues from here.
  const [waitingAt, setWaitingAt] = useState<{ trackId: string; pointId: string; time: number } | null>(null);
  const markerDragRef = useRef<{ id: string; startX: number; origTime: number } | null>(null);
  const [audioOutDevices, setAudioOutDevices] = useState<MediaDeviceInfo[]>([]);

  const widgetRef   = useRef(widget);
  widgetRef.current = widget;
  const undoStack   = useRef<TimelineTrack[][]>([]);

  const rafRef         = useRef<number | null>(null);
  const startTRef      = useRef(0);
  const startOffRef    = useRef(0);
  const prevTNormRef   = useRef(0);
  // Last cue block reported per cue-track id, so we only fire on a change.
  const lastCueRef     = useRef<Map<string, number>>(new Map());
  const waitingRef     = useRef<typeof waitingAt>(null);
  const audioCtxRef    = useRef<AudioContext | null>(null);
  const abCache        = useRef<Map<string, AudioBuffer>>(new Map());
  const aSources       = useRef<Map<string, AudioBufferSourceNode>>(new Map());
  const audioSessionRef = useRef(0);
  const rulerRef       = useRef<HTMLDivElement>(null);
  const hScrollRef     = useRef<HTMLDivElement>(null);
  const indicatorRef   = useRef<HTMLDivElement>(null);
  const indDragRef     = useRef<{ mode: 'left' | 'right' | 'center'; startX: number; startY: number; startZoom: number; startVisStart: number; startVisEnd: number } | null>(null);
  const pendingScrollRef = useRef<number | null>(null);
  // Timecode
  const ltcNodeRef     = useRef<ScriptProcessorNode | null>(null);
  const ltcStreamRef   = useRef<MediaStream | null>(null);
  const ltcAudioSrcRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const tcActiveRef    = useRef(false);
  tcActiveRef.current  = tcActive;

  // Total pixel width of the timeline content
  const totalW     = Math.max(widget.duration * zoom, 100);
  const containerW = hScrollRef.current?.clientWidth ?? 0;
  const visStart   = containerW > 0 && totalW > containerW ? scrollLeft / totalW : 0;
  const visEnd     = containerW > 0 && totalW > containerW ? Math.min(1, (scrollLeft + containerW) / totalW) : 1;

  // Cleanup
  useEffect(() => () => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    audioCtxRef.current?.close();
  }, []);

  // Decode waveforms whenever a sound track's src changes; also stores audioDuration
  useEffect(() => {
    for (const t of widget.tracks) {
      if (t.kind !== 'sound' || !t.src || waveforms.has(t.id) || wfLoading.has(t.id)) continue;
      setWfLoading((p) => new Set([...p, t.id]));
      computeWaveform(t.src).then((res) => {
        setWfLoading((p) => { const n = new Set(p); n.delete(t.id); return n; });
        if (!res) return;
        setWaveforms((p) => new Map([...p, [t.id, res.wf]]));
        if (!t.audioDuration) updateTrack(t.id, { audioDuration: res.audioDur });
      });
    }
  }, [widget.tracks]);

  // OSC / MIDI input for play+stop mappings
  useEffect(() => bridge.on('tr:osc:feedback', (msg) => {
    const w = widgetRef.current;
    if (w.playMapping?.type === 'osc' && msg.address === (w.playMapping as OscMapping).address) startPbRef.current();
    if (w.stopMapping?.type === 'osc' && msg.address === (w.stopMapping as OscMapping).address) stopPbRef.current();
  }), []);

  useEffect(() => bridge.on('tr:midi:inputEvent', (evt) => {
    const w = widgetRef.current;
    function hit(m: Mapping): boolean {
      if (!m || m.type !== 'midi') return false;
      const mm = m as MidiMapping;
      return (mm.messageType === 'controlChange' && evt.messageType === 'controlChange' && evt.channel === mm.channel && evt.number === mm.number)
          || (mm.messageType === 'noteOn' && evt.messageType === 'noteOn' && evt.channel === mm.channel && evt.number === mm.number);
    }
    if (hit(w.playMapping)) startPbRef.current();
    if (hit(w.stopMapping)) stopPbRef.current();
  }), []);

  // MTC timecode sync
  useEffect(() => bridge.on('tr:midi:mtcFrame', (frame: MtcFramePayload) => {
    if (!tcActiveRef.current) return;
    const w = widgetRef.current;
    if ((w.timecodeSource ?? 'off') !== 'mtc') return;
    const fps = w.timecodeFrameRate ?? frame.fps ?? 25;
    const t   = frame.h * 3600 + frame.m * 60 + frame.s + frame.f / fps;
    setCurrentTime(Math.min(t, w.duration));
  }), []);

  // ─── LTC decoder ───────────────────────────────────────────────────────────

  function stopLtc() {
    ltcNodeRef.current?.disconnect();
    ltcNodeRef.current = null;
    ltcAudioSrcRef.current?.disconnect();
    ltcAudioSrcRef.current = null;
    ltcStreamRef.current?.getTracks().forEach((t) => t.stop());
    ltcStreamRef.current = null;
  }

  async function startLtc(deviceId: string) {
    stopLtc();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: deviceId } } });
      ltcStreamRef.current = stream;
      const ctx  = new AudioContext();
      const src  = ctx.createMediaStreamSource(stream);
      // eslint-disable-next-line @typescript-eslint/no-deprecated
      const proc = ctx.createScriptProcessor(2048, 1, 1);
      ltcNodeRef.current    = proc;
      ltcAudioSrcRef.current = src;

      let lastSign  = 0;
      let lastCross = 0;
      let bitPeriod = ctx.sampleRate / (25 * 80);
      let bits: number[] = [];

      proc.onaudioprocess = (e) => {
        if (!tcActiveRef.current) return;
        const data   = e.inputBuffer.getChannelData(0);
        const sr     = ctx.sampleRate;
        const w      = widgetRef.current;
        const fps    = w.timecodeFrameRate ?? 25;
        bitPeriod    = sr / (fps * 80);
        const thresh = 0.75;

        for (let i = 0; i < data.length; i++) {
          const sign = data[i]! >= 0 ? 1 : -1;
          if (sign !== lastSign && lastSign !== 0) {
            const interval = i - lastCross;
            lastCross = i;
            if (interval < bitPeriod * thresh) {
              // Short: mid-bit transition (still within a "1" bit)
              // do nothing — next crossing will be the bit boundary
            } else {
              // Long: bit boundary → "0" bit
              bits.push(0);
              if (bits.length >= 80) bits = bits.slice(bits.length - 80);
              tryDecodeLtc(bits, fps);
            }
            // After a short interval, we know the next crossing is a bit boundary of "1"
            if (interval < bitPeriod * thresh) {
              bits.push(1);
              if (bits.length >= 80) bits = bits.slice(bits.length - 80);
              tryDecodeLtc(bits, fps);
            }
          }
          lastSign = sign;
        }
      };

      src.connect(proc);
      proc.connect(ctx.destination);
    } catch (err) { console.error('[LTC]', err); }
  }

  function tryDecodeLtc(bits: number[], fps: number) {
    if (bits.length < 80) return;
    const b = bits.slice(bits.length - 80);
    // Sync word check: bits 64–79 = 0011 1111 1111 1101
    const sync = [0,0,1,1, 1,1,1,1, 1,1,1,1, 1,1,0,1];
    for (let i = 0; i < 16; i++) { if (b[64 + i] !== sync[i]) return; }
    const fU  = (b[0]|0)  | ((b[1]|0) <<1) | ((b[2]|0) <<2) | ((b[3]|0) <<3);
    const fT  = (b[5]|0)  | ((b[6]|0) <<1);
    const sU  = (b[8]|0)  | ((b[9]|0) <<1) | ((b[10]|0)<<2) | ((b[11]|0)<<3);
    const sT  = (b[13]|0) | ((b[14]|0)<<1);
    const mU  = (b[16]|0) | ((b[17]|0)<<1) | ((b[18]|0)<<2) | ((b[19]|0)<<3);
    const mT  = (b[21]|0) | ((b[22]|0)<<1);
    const hU  = (b[24]|0) | ((b[25]|0)<<1) | ((b[26]|0)<<2) | ((b[27]|0)<<3);
    const hT  = (b[29]|0) | ((b[30]|0)<<1);
    const f   = fT * 10 + fU;
    const s   = sT * 10 + sU;
    const m   = mT * 10 + mU;
    const h   = hT * 10 + hU;
    const t   = h * 3600 + m * 60 + s + f / fps;
    const w   = widgetRef.current;
    setCurrentTime(Math.min(t, w.duration));
  }

  // Start/stop LTC based on tcActive + timecodeSource
  useEffect(() => {
    if (!tcActive) { stopLtc(); return; }
    const w = widgetRef.current;
    if ((w.timecodeSource ?? 'off') !== 'ltc') return;
    const ltcConn = project.connections.find((c) => c.type === 'ltcAudio') as LtcAudioConnection | undefined;
    if (ltcConn?.deviceId) void startLtc(ltcConn.deviceId);
    return stopLtc;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tcActive]);

  // ─── Keyboard shortcuts ────────────────────────────────────────────────────

  const clipboardKfRef = useRef(clipboardKf); clipboardKfRef.current = clipboardKf;
  const selTrkIdRef    = useRef(selTrkId);    selTrkIdRef.current    = selTrkId;
  const selKfIdRef     = useRef(selKfId);     selKfIdRef.current     = selKfId;
  const tNormRef       = useRef(0);

  // Every page stays mounted in Live mode, so every timeline in the project has
  // this window listener attached. Without this gate one press of SPACE would
  // start them all, and the arrows would scrub timelines you cannot even see.
  const isOnActivePageRef = useRef(false);
  isOnActivePageRef.current =
    project.pages.find((p) => p.id === activePageId)?.widgets.some((w) => w.id === widget.id) ?? false;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!isOnActivePageRef.current) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement) return;

      if (e.key === ' ') {
        // A Keyboard widget bound to Space claims the event first.
        if (e.defaultPrevented) return;
        e.preventDefault();
        if (isPlayingRef.current) { stopPbRef.current(); return; }
        startPbRef.current();   // also continues when parked on a wait point
        return;
      }

      // ── Playhead navigation ────────────────────────────────────────────
      // Bare arrows nudge; the modifiers jump between landmarks. Arrows are the
      // most frequent move, so they get the cheapest keys.
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        // A Keyboard widget bound to the arrows claims them first.
        if (e.defaultPrevented) return;
        e.preventDefault();
        const w = widgetRef.current;
        const dir = e.key === 'ArrowRight' ? 1 : -1;
        const cur = tNormRef.current;
        const eps = 1e-4;   // never land back on the landmark we already sit on

        let targetNorm: number | undefined;
        if (e.ctrlKey || e.metaKey) {
          // Markers.
          const times = (w.markers ?? []).map((m) => m.time).sort((a, b) => a - b);
          targetNorm = dir > 0
            ? times.find((t) => t > cur + eps)
            : [...times].reverse().find((t) => t < cur - eps);
        } else if (e.shiftKey) {
          // Wait points — bypassed ones included, they are still landmarks.
          const times = w.tracks
            .filter((t) => t.kind === 'wait')
            .flatMap((t) => (t as WaitTrack).points.map((p) => p.time))
            .sort((a, b) => a - b);
          targetNorm = dir > 0
            ? times.find((t) => t > cur + eps)
            : [...times].reverse().find((t) => t < cur - eps);
        } else {
          // One ruler subdivision, so the step follows the zoom.
          const nudge = gridRef.current().minor;
          targetNorm = Math.max(0, Math.min(1, cur + (dir * nudge) / Math.max(w.duration, 0.001)));
        }
        if (targetNorm === undefined) return;   // no landmark that way

        stopPbRef.current();
        if (waitingRef.current) { waitingRef.current = null; setWaitingAt(null); }
        // Advance the ref straight away: tNormRef otherwise only catches up on
        // the next render, so held or hammered arrows would all step from the
        // same stale position and collapse into one move.
        tNormRef.current = targetNorm;
        setCurrentTime(targetNorm * w.duration);
        return;
      }

      const ctrl = e.ctrlKey || e.metaKey;
      if (!ctrl) return;

      if (e.key === 'm' || e.key === 'M') {
        e.preventDefault();
        addMarkerRef.current(tNormRef.current);
        return;
      }

      if (e.key === 'z' || e.key === 'Z') {
        e.preventDefault();
        const prev = undoStack.current.pop();
        if (prev) saveTracks(prev, true);
        return;
      }

      if (e.key === 'c' || e.key === 'C') {
        const trkId = selTrkIdRef.current;
        const kfId  = selKfIdRef.current;
        if (!trkId || !kfId) return;
        const track = widgetRef.current.tracks.find((t) => t.id === trkId);
        if (!track) return;
        if (track.kind === 'value' || track.kind === 'color') {
          const kf = (track as ValueTrack | ColorTrack).keyframes.find((k) => k.id === kfId);
          if (kf) { setClipboardKf(kf); e.preventDefault(); }
        } else if (track.kind === 'trig') {
          const mk = (track as TrigTrack).keyframes.find((k) => k.id === kfId);
          if (mk) { setClipboardKf(mk); e.preventDefault(); }
        }
        return;
      }

      if (e.key === 'v' || e.key === 'V') {
        const cb = clipboardKfRef.current;
        if (!cb) return;
        const trkId = selTrkIdRef.current;
        if (!trkId) return;
        const track = widgetRef.current.tracks.find((t) => t.id === trkId);
        if (!track) return;
        if ((track.kind === 'value' || track.kind === 'color') && ('value' in cb || 'color' in cb)) {
          const newKf = { ...(cb as ValueKeyframe | ColorKeyframe), id: nanoid(), time: tNormRef.current };
          const kfs = (track as ValueTrack | ColorTrack).keyframes;
          updateTrack(trkId, { keyframes: [...kfs, newKf] } as never);
          setSelKfId(newKf.id);
          e.preventDefault();
        } else if (track.kind === 'trig') {
          const src = cb as TrigMarker;
          const newMk: TrigMarker = { id: nanoid(), time: tNormRef.current, name: src.name };
          const kfs = (track as TrigTrack).keyframes;
          updateTrack(trkId, { keyframes: [...kfs, newMk] } as never);
          setSelKfId(newMk.id);
          e.preventDefault();
        }
      }
    }
    // Live stays mounted behind Design: its shortcuts only count while Live shows.
    const onKeyLive = (e: KeyboardEvent): void => { if (useStore.getState().mode === 'live') onKey(e); };
    window.addEventListener('keydown', onKeyLive);
    return () => window.removeEventListener('keydown', onKeyLive);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Audio helpers ─────────────────────────────────────────────────────────

  function getAudioCtx(): AudioContext {
    if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') audioCtxRef.current = new AudioContext();
    if (audioCtxRef.current.state === 'suspended') void audioCtxRef.current.resume();
    return audioCtxRef.current;
  }

  async function loadAB(track: SoundTrack): Promise<AudioBuffer | null> {
    if (abCache.current.has(track.id)) return abCache.current.get(track.id)!;
    if (!track.src) return null;
    try {
      const ctx  = getAudioCtx();
      const resp = await fetch(track.src);
      const ab   = await resp.arrayBuffer();
      const buf  = await ctx.decodeAudioData(ab);
      abCache.current.set(track.id, buf);
      return buf;
    } catch { return null; }
  }

  function stopAllAudio() {
    for (const src of aSources.current.values()) { try { src.stop(); } catch { /* empty */ } }
    aSources.current.clear();
  }

  async function startAudio(timelineOffset: number, session: number) {
    const ctx = getAudioCtx();
    // Route to project audio output device if configured
    const audioOutConn = project.connections.find((c) => c.type === 'audioOutput') as AudioOutputConnection | undefined;
    if (audioOutConn?.deviceId && 'setSinkId' in ctx) {
      await (ctx as AudioContext & { setSinkId(id: string): Promise<void> }).setSinkId(audioOutConn.deviceId).catch(() => {});
    }
    for (const t of widgetRef.current.tracks) {
      if (audioSessionRef.current !== session) return; // stop was called while we were loading
      if (t.kind !== 'sound') continue;
      if (t.muted) continue;
      const buf = await loadAB(t);
      if (audioSessionRef.current !== session) return; // stop was called during decode
      if (!buf) continue;
      const regions = getSoundRegions(t);
      regions.forEach((reg, ri) => {
        const regDur   = buf.duration - (reg.trimStart ?? 0) - (reg.trimEnd ?? 0);
        const relStart = timelineOffset - reg.offset;
        if (relStart >= regDur || relStart < -regDur) return; // not in range
        const audioPos = Math.max(0, relStart + (reg.trimStart ?? 0));
        const src  = ctx.createBufferSource();
        const gain = ctx.createGain();
        src.buffer      = buf;
        gain.gain.value = t.volume;
        src.connect(gain).connect(masterOut(ctx));
        src.start(0, audioPos);
        aSources.current.set(`${t.id}_${ri}`, src);
      });
    }
  }

  // ─── Playback ──────────────────────────────────────────────────────────────

  function startPlayback() {
    if (isPlayingRef.current) return;
    const session = ++audioSessionRef.current;
    const off = currentTime;
    startOffRef.current  = off;
    startTRef.current    = performance.now();
    // prevTNorm lands exactly on the wait point we were parked on, so the
    // `prevTN < p.time` edge test cannot re-fire it and we simply carry on.
    prevTNormRef.current = off / Math.max(widgetRef.current.duration, 0.001);
    if (waitingRef.current) { waitingRef.current = null; setWaitingAt(null); }
    setIsPlaying(true);
    void startAudio(off, session);

    function tick() {
      const w = widgetRef.current;
      let t = startOffRef.current + (performance.now() - startTRef.current) / 1000;
      const prevTN = prevTNormRef.current;

      if (t >= w.duration) {
        if (w.loopMode === 'loop') {
          t %= w.duration;
          startOffRef.current  = 0;
          startTRef.current    = performance.now();
          prevTNormRef.current = 0;
          stopAllAudio();
          const loopSession = ++audioSessionRef.current;
          void startAudio(0, loopSession);
        } else {
          setCurrentTime(w.duration);
          setIsPlaying(false);
          return;
        }
      }

      const tNRaw = t / Math.max(w.duration, 0.001);

      // A wait point stops the transport dead on the point. Checked before the
      // outputs so we park exactly on it rather than a frame past.
      let hitWait: { trackId: string; pointId: string; time: number } | null = null;
      for (const track of w.tracks) {
        if (track.kind !== 'wait' || track.muted) continue;
        for (const p of (track as WaitTrack).points) {
          if (p.bypass) continue;   // still a jump target, just not a stop
          if (prevTN < p.time && tNRaw >= p.time) {
            if (!hitWait || p.time < hitWait.time) hitWait = { trackId: track.id, pointId: p.id, time: p.time };
          }
        }
      }
      if (hitWait) {
        const stopT = hitWait.time * w.duration;
        prevTNormRef.current = hitWait.time;
        setCurrentTime(stopT);
        syncCuesRef.current(hitWait.time);
        waitingRef.current = hitWait;
        setWaitingAt(hitWait);
        stopPbRef.current();
        return;
      }

      setCurrentTime(t);
      const tN = tNRaw;
      prevTNormRef.current = tN;

      for (let ti = 0; ti < w.tracks.length; ti++) {
        const track = w.tracks[ti];
        if (track.muted) continue;
        if (track.kind === 'value') {
          const val = getValueAt(tN, track.keyframes);
          if (track.mapping) dispatchValue(track.mapping, val);
          useStore.getState().setCellValue(w.id, ti, val);
        } else if (track.kind === 'color' && track.oscAddress) {
          sendColorOsc(track, hexToRgb(getColorAt(tN, track.keyframes)));
        } else if (track.kind === 'trig') {
          const trigCells = timelineTrigCells(w);
          track.keyframes.forEach((marker, mi) => {
            if (prevTN < marker.time && tN >= marker.time) {
              if (track.mapping) dispatchValue(track.mapping, 1);
              useStore.getState().setCellValue(w.id, ti, 1);
              // Also pulse this marker's OWN cell, so a link can target one
              // specific trigger inside the track (not just the whole row).
              const mkCellIdx = trigCells.findIndex((c) => c.trackIndex === ti && c.markerIndex === mi);
              const mkCell = mkCellIdx >= 0 ? w.tracks.length + mkCellIdx : -1;
              if (mkCell >= 0) useStore.getState().setCellValue(w.id, mkCell, 1);
              const capturedId = w.id;
              const capturedTi = ti;
              const capturedMapping = track.mapping;
              setTimeout(() => {
                useStore.getState().setCellValue(capturedId, capturedTi, 0);
                if (mkCell >= 0) useStore.getState().setCellValue(capturedId, mkCell, 0);
                if (capturedMapping) dispatchValue(capturedMapping, 0);
              }, 50);
            }
          });
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
  }

  // ─── Cue blocks ────────────────────────────────────────────────────────────
  // A cue is a STATE, not an edge: whichever block the playhead sits in is held
  // at 1. Driven off currentTime rather than from the playback loop, so dragging
  // the playhead into the middle of a block fires it exactly like playing does.

  function syncCues(tN: number): void {
    const w = widgetRef.current;
    const cueCells = timelineCueCells(w);
    const store = useStore.getState();

    w.tracks.forEach((track, ti) => {
      if (track.kind !== 'cue') return;
      const ct = track as CueTrack;
      if (ct.cues.length === 0) return;

      // Muting a cue track releases whatever it was holding.
      const idx = track.muted ? -1 : activeCueIndex(ct.cues, tN);
      if (lastCueRef.current.get(ct.id) === idx) return;
      const prev = lastCueRef.current.get(ct.id);
      lastCueRef.current.set(ct.id, idx);

      const cellOf = (ri: number): number => {
        const at = cueCells.findIndex((c) => c.trackIndex === ti && c.regionIndex === ri);
        return at >= 0 ? w.tracks.length + timelineTrigCells(w).length + at : -1;
      };

      if (prev !== undefined && prev >= 0) {
        const old = ct.cues[prev];
        const oldCell = cellOf(prev);
        if (oldCell >= 0) store.setCellValue(w.id, oldCell, 0);
        if (old?.mapping) dispatchValue(old.mapping, 0);
      }
      if (idx >= 0) {
        const cur = ct.cues[idx];
        const curCell = cellOf(idx);
        if (curCell >= 0) store.setCellValue(w.id, curCell, 1);
        if (cur?.mapping) dispatchValue(cur.mapping, 1);
        // The track's own cell carries which block we are in, 1-based and
        // normalised, so a Value Display or a link can read "cue 3".
        store.setCellValue(w.id, ti, ct.cues.length > 1 ? idx / (ct.cues.length - 1) : 1);
      } else {
        store.setCellValue(w.id, ti, 0);
      }
    });
  }

  const syncCuesRef = useRef(syncCues);
  syncCuesRef.current = syncCues;

  useEffect(() => {
    syncCuesRef.current(currentTime / Math.max(widget.duration, 0.001));
  }, [currentTime, widget.duration, widget.tracks]);

  function stopPlayback() {
    audioSessionRef.current++; // invalidate any in-flight startAudio calls
    if (rafRef.current !== null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    stopAllAudio();
    setIsPlaying(false);
  }

  const startPbRef  = useRef(startPlayback); startPbRef.current  = startPlayback;
  const stopPbRef   = useRef(stopPlayback);  stopPbRef.current   = stopPlayback;
  const isPlayingRef = useRef(isPlaying);    isPlayingRef.current = isPlaying;

  // The timeline stands apart from the top-bar transport: Play, Stop and Reset
  // up there do not touch it. A show runs from its own transport, so putting the
  // desk into play (or stopping it) cannot start, halt or rewind the show.

  function goToStart() { stopPlayback(); setCurrentTime(0); }
  function goToEnd()   { stopPlayback(); setCurrentTime(widget.duration); }

  // BACK: stop and park on the wait point before the one we are at (or before
  // the playhead), so the next GO replays that section. No earlier wait → top.
  // Bypassed points count, like Shift+Arrow: they are still landmarks.
  function backToPreviousWait() {
    const w = widgetRef.current;
    stopPbRef.current();
    const eps = 1e-4;
    const cur = waitingRef.current?.time ?? tNormRef.current;
    let best: { trackId: string; pointId: string; time: number } | null = null;
    for (const t of w.tracks) {
      if (t.kind !== 'wait') continue;
      for (const p of (t as WaitTrack).points) {
        if (p.time < cur - eps && (!best || p.time > best.time)) best = { trackId: t.id, pointId: p.id, time: p.time };
      }
    }
    const target = best?.time ?? 0;
    tNormRef.current = target;
    prevTNormRef.current = target;
    setCurrentTime(target * w.duration);
    syncCuesRef.current(target);
    waitingRef.current = best;
    setWaitingAt(best);
  }
  const backRef = useRef(backToPreviousWait); backRef.current = backToPreviousWait;

  // Remote transport (GO / STOP / BACK) arrives through the Router: any MIDI,
  // OSC, Art-Net or widget source patched onto this timeline's transport inputs.
  // GO while already playing is ignored on purpose — a double GO in a show must
  // never skip a cue.
  useEffect(() => onTimelineCommand(widget.id, (cmd) => {
    if (cmd === 'go')   { if (!isPlayingRef.current) startPbRef.current(); return; }
    if (cmd === 'stop') { stopPbRef.current(); return; }
    if (cmd === 'back') backRef.current();
  }), [widget.id]);

  // Right-click on ▶ → pick GO / STOP / BACK, then the usual link/learn menu.
  const [transportMenu, setTransportMenu] = useState<{ x: number; y: number; cell: number | null } | null>(null);
  useEffect(() => {
    if (!transportMenu) return;
    const close = () => setTransportMenu(null);
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [transportMenu]);

  // ─── Ruler scrub ───────────────────────────────────────────────────────────

  function scrubTo(clientX: number) {
    if (!rulerRef.current) return;
    const rect = rulerRef.current.getBoundingClientRect();
    // rect.width == totalW; rect.left accounts for scroll offset
    const t = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    if (isPlaying) stopPlayback();
    // Moving the playhead by hand abandons the wait we were parked on.
    if (waitingRef.current) { waitingRef.current = null; setWaitingAt(null); }
    setCurrentTime(t * widgetRef.current.duration);
  }

  // ─── Mutations ─────────────────────────────────────────────────────────────

  function saveTracks(tracks: TimelineTrack[], skipUndo = false) {
    if (!skipUndo) undoStack.current = [...undoStack.current.slice(-29), [...widgetRef.current.tracks]];
    if (!activePageId) return;
    updateWidget(activePageId, widget.id, { tracks } as never);
  }

  function patchWidget(partial: Partial<TimelineWidget>) {
    if (!activePageId) return;
    updateWidget(activePageId, widget.id, partial as never);
  }

  function addTrack(kind: 'value' | 'color' | 'sound' | 'trig' | 'cue' | 'wait') {
    setShowAddMenu(false);
    const n = widget.tracks.filter((t) => t.kind === kind).length + 1;
    let t: TimelineTrack;
    if (kind === 'value')       t = { id: nanoid(), kind: 'value', label: `Value ${n}`, color: pal('#68bbc1'), keyframes: [], mapping: null } satisfies ValueTrack;
    else if (kind === 'color')  t = { id: nanoid(), kind: 'color', label: `Color ${n}`, keyframes: [], oscAddress: '/color' } satisfies ColorTrack;
    else if (kind === 'trig')   t = { id: nanoid(), kind: 'trig',  label: `Trig ${n}`,  color: pal('#e08b40'), keyframes: [], mapping: null } satisfies TrigTrack;
    // A cue track is never empty: it always covers the whole timeline, starting
    // as one block that you then cut.
    else if (kind === 'cue')    t = { id: nanoid(), kind: 'cue', label: `Cues ${n}`,
                                      cues: [{ id: nanoid(), time: 0, name: 'Cue 1', color: CUE_COLORS[0], mapping: null }] } satisfies CueTrack;
    else if (kind === 'wait')   t = { id: nanoid(), kind: 'wait', label: `Wait ${n}`, color: pal('#db8235'), points: [] } satisfies WaitTrack;
    else                        t = { id: nanoid(), kind: 'sound', label: `Sound ${n}`, src: '', fileName: '', volume: 1, offset: 0 } satisfies SoundTrack;
    saveTracks([...widget.tracks, t]);
    setSelTrkId(t.id); setSelKfId(null);
  }

  function deleteTrack(id: string) {
    saveTracks(widget.tracks.filter((t) => t.id !== id));
    if (selTrkId === id) { setSelTrkId(null); setSelKfId(null); }
  }

  function updateTrack(id: string, patch: Partial<TimelineTrack> & { regionId?: string }) {
    saveTracks(widgetRef.current.tracks.map((t) => {
      if (t.id !== id) return t;
      if (patch.regionId && t.kind === 'sound') {
        const st = t as SoundTrack;
        const regions = getSoundRegions(st);
        const { regionId, ...regPatch } = patch;
        const newRegions = regions.map((r) => r.id === regionId ? { ...r, ...regPatch } as SoundRegion : r);
        return { ...st, regions: newRegions } as TimelineTrack;
      }
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { regionId: _rid, ...cleanPatch } = patch;
      return { ...t, ...cleanPatch } as TimelineTrack;
    }));
  }

  // Tracks/trig markers can be added or removed while live, and each trig marker
  // owns a source cell — keep the runtime cell count in sync (initRuntime merges
  // existing values, so this is non-destructive).
  const trigCellCount = timelineTrigCells(widget).length;
  const cueCellCount  = timelineCueCells(widget).length;
  useEffect(() => {
    const s = useStore.getState();
    const wr = s.runtime.widgets[widget.id];
    if (!wr || wr.cells.length === widget.tracks.length + trigCellCount + cueCellCount) return;
    s.initRuntime(s.project.pages.flatMap((p) => p.widgets));
  }, [trigCellCount, cueCellCount, widget.tracks.length, widget.id]);

  // ─── Cue / wait editing ────────────────────────────────────────────────────

  function splitCueAt(trackId: string, time: number) {
    const t = widgetRef.current.tracks.find((x) => x.id === trackId);
    if (!t || t.kind !== 'cue') return;
    const ct = t as CueTrack;
    const at = Math.max(0, Math.min(1, snapTime(time)));
    // Refuse a cut that lands on an existing boundary — it would make an empty
    // block that can never be reached.
    if (ct.cues.some((c) => Math.abs(c.time - at) < 0.001) || at <= 0.001) return;
    const region: CueRegion = {
      id: nanoid(), time: at,
      name: `Cue ${ct.cues.length + 1}`,
      color: CUE_COLORS[ct.cues.length % CUE_COLORS.length],
      mapping: null,
    };
    const cues = [...ct.cues, region].sort((a, b) => a.time - b.time);
    updateTrack(trackId, { cues } as never);
    setSelKfId(region.id);
  }

  function patchCue(trackId: string, regionId: string, patch: Partial<CueRegion>) {
    const t = widgetRef.current.tracks.find((x) => x.id === trackId);
    if (!t || t.kind !== 'cue') return;
    const cues = (t as CueTrack).cues
      .map((c) => (c.id === regionId ? { ...c, ...patch } : c))
      .sort((a, b) => a.time - b.time);
    updateTrack(trackId, { cues } as never);
  }

  function deleteCue(trackId: string, regionId: string) {
    const t = widgetRef.current.tracks.find((x) => x.id === trackId);
    if (!t || t.kind !== 'cue') return;
    const ct = t as CueTrack;
    // The opening block owns time 0 — removing it would leave a gap.
    if (ct.cues.length <= 1 || ct.cues[0].id === regionId) return;
    updateTrack(trackId, { cues: ct.cues.filter((c) => c.id !== regionId) } as never);
    if (selKfId === regionId) setSelKfId(null);
  }

  function addWaitAt(trackId: string, time: number) {
    const t = widgetRef.current.tracks.find((x) => x.id === trackId);
    if (!t || t.kind !== 'wait') return;
    const p: WaitPoint = { id: nanoid(), time: Math.max(0, Math.min(1, snapTime(time))) };
    const points = [...(t as WaitTrack).points, p].sort((a, b) => a.time - b.time);
    updateTrack(trackId, { points } as never);
    setSelKfId(p.id);
  }

  function patchWait(trackId: string, pointId: string, patch: Partial<WaitPoint>) {
    const t = widgetRef.current.tracks.find((x) => x.id === trackId);
    if (!t || t.kind !== 'wait') return;
    const points = (t as WaitTrack).points
      .map((p) => (p.id === pointId ? { ...p, ...patch } : p))
      .sort((a, b) => a.time - b.time);
    updateTrack(trackId, { points } as never);
  }

  function deleteWait(trackId: string, pointId: string) {
    const t = widgetRef.current.tracks.find((x) => x.id === trackId);
    if (!t || t.kind !== 'wait') return;
    updateTrack(trackId, { points: (t as WaitTrack).points.filter((p) => p.id !== pointId) } as never);
    if (selKfId === pointId) setSelKfId(null);
  }

  // ─── Ruler markers + snap ──────────────────────────────────────────────────

  const markers: TimelineMarker[] = widget.markers ?? [];

  function saveMarkers(next: TimelineMarker[]) {
    patchWidget({ markers: [...next].sort((a, b) => a.time - b.time) });
  }
  function addMarkerAt(time: number) {
    const m: TimelineMarker = { id: nanoid(), time: Math.max(0, Math.min(1, time)) };
    saveMarkers([...markers, m]);
    setSelMarkerId(m.id);
  }
  // The key handler is bound once, so it reaches the current closure via a ref.
  const addMarkerRef = useRef(addMarkerAt);
  addMarkerRef.current = addMarkerAt;
  function moveMarker(id: string, time: number) {
    saveMarkers(markers.map((m) => m.id === id ? { ...m, time: Math.max(0, Math.min(1, time)) } : m));
  }
  function patchMarker(id: string, patch: Partial<TimelineMarker>) {
    saveMarkers(markers.map((m) => m.id === id ? { ...m, ...patch } : m));
  }
  function deleteMarker(id: string) {
    saveMarkers(markers.filter((m) => m.id !== id));
    if (selMarkerId === id) setSelMarkerId(null);
  }
  // Snap a normalised time to the nearest marker (within ~8px) when snap is on.
  function snapTime(t: number): number {
    if (!snapEnabled || markers.length === 0) return t;
    const thresh = 8 / Math.max(1, totalW);
    let best = t, bestD = thresh;
    for (const m of markers) {
      const d = Math.abs(m.time - t);
      if (d < bestD) { bestD = d; best = m.time; }
    }
    return best;
  }

  function addKeyframe(trackId: string, timeRaw: number, value: number) {
    const track = widget.tracks.find((t) => t.id === trackId);
    if (!track || track.kind === 'sound') return;
    const time = snapTime(timeRaw);
    let kf: ValueKeyframe | ColorKeyframe | TrigMarker;
    if (track.kind === 'value')      kf = { id: nanoid(), time, value, easing: 'linear' } satisfies ValueKeyframe;
    else if (track.kind === 'color') kf = { id: nanoid(), time, color: pal('#ff9940') } satisfies ColorKeyframe;
    else {
      // Stable creation number, never reused, so the marker keeps its identity
      const nextNum = (track as TrigTrack).keyframes.reduce((m, k) => Math.max(m, k.num ?? 0), 0) + 1;
      kf = { id: nanoid(), time, num: nextNum } satisfies TrigMarker;
    }
    const kfs = (track as ValueTrack | ColorTrack | TrigTrack).keyframes;
    updateTrack(trackId, { keyframes: [...kfs, kf] } as never);
    setSelKfId(kf.id); setSelTrkId(trackId);
  }

  function cutTrack(trackId: string, tNorm: number) {
    const track = widget.tracks.find((t) => t.id === trackId) as SoundTrack | undefined;
    if (!track) return;
    const cutSec    = tNorm * widget.duration;
    const audioDur  = track.audioDuration ?? widget.duration;
    // Find the region that contains the cut point
    const regions   = getSoundRegions(track);
    const regionIdx = regions.findIndex((r) => {
      const rDur  = audioDur - (r.trimStart ?? 0) - (r.trimEnd ?? 0);
      return cutSec > r.offset && cutSec < r.offset + rDur;
    });
    if (regionIdx < 0) return;
    const reg    = regions[regionIdx];
    const relCut = cutSec - reg.offset; // seconds into this region's audio
    // Left region: keep same offset, add trimEnd to cut the tail
    const leftTrimEnd  = audioDur - (reg.trimStart ?? 0) - relCut;
    // Right region: starts at cutSec, skip ahead in the audio
    const rightTrimStart = (reg.trimStart ?? 0) + relCut;
    const leftReg:  SoundRegion = { ...reg, trimEnd: leftTrimEnd };
    const rightReg: SoundRegion = { id: nanoid(), offset: cutSec, trimStart: rightTrimStart, trimEnd: reg.trimEnd ?? 0 };
    const newRegions = [...regions];
    newRegions.splice(regionIdx, 1, leftReg, rightReg);
    updateTrack(trackId, { regions: newRegions });
  }

  function moveKeyframe(trackId: string, kfId: string, timeRaw: number, value: number) {
    const track = widget.tracks.find((t) => t.id === trackId);
    if (!track || track.kind === 'sound') return;
    const time = snapTime(timeRaw);   // triggers + value/graph points snap to markers
    if (track.kind === 'trig') {
      updateTrack(trackId, { keyframes: (track as TrigTrack).keyframes.map((k) => k.id !== kfId ? k : { ...k, time }) } as never);
    } else {
      const tr = track as ValueTrack | ColorTrack;
      updateTrack(trackId, {
        keyframes: tr.keyframes.map((k) => k.id !== kfId ? k : { ...k, time, ...('value' in k ? { value } : {}) }),
      } as never);
    }
  }

  // Patches any keyframe kind — value/color keyframes and trig markers (the name
  // chip's labelY drag comes through here too). Sound tracks have no keyframes.
  function patchKeyframe(trackId: string, kfId: string, patch: Record<string, unknown>) {
    const track = widget.tracks.find((t) => t.id === trackId);
    if (!track || track.kind === 'sound') return;
    const kfs = (track as ValueTrack | ColorTrack | TrigTrack).keyframes as { id: string }[];
    updateTrack(trackId, { keyframes: kfs.map((k) => k.id === kfId ? { ...k, ...patch } : k) } as never);
  }

  function deleteKeyframe(trackId: string, kfId: string) {
    const track = widget.tracks.find((t) => t.id === trackId);
    if (!track || track.kind === 'sound') return;
    if (track.kind === 'trig') {
      updateTrack(trackId, { keyframes: (track as TrigTrack).keyframes.filter((k) => k.id !== kfId) } as never);
    } else {
      const tr = track as ValueTrack | ColorTrack;
      updateTrack(trackId, { keyframes: tr.keyframes.filter((k) => k.id !== kfId) } as never);
    }
    if (selKfId === kfId) setSelKfId(null);
  }

  function patchTrigMarker(trackId: string, markerId: string, patch: Partial<TrigMarker>) {
    const track = widget.tracks.find((t) => t.id === trackId) as TrigTrack | undefined;
    if (!track || track.kind !== 'trig') return;
    updateTrack(trackId, { keyframes: track.keyframes.map((k) => k.id === markerId ? { ...k, ...patch } : k) } as never);
  }

  async function pickAudio(trackId: string) {
    try {
      const res = await bridge.invoke('tr:file:pickAudio', undefined as never);
      if (!res) return;
      // Reset waveform cache so the effect re-decodes
      setWaveforms((p) => { const n = new Map(p); n.delete(trackId); return n; });
      updateTrack(trackId, { src: res.dataUrl, fileName: res.fileName, audioDuration: undefined });
    } catch (err) { console.error('pickAudio', err); }
  }

  // Apply pending scroll position after a zoom-triggered re-render
  useEffect(() => {
    if (pendingScrollRef.current !== null && hScrollRef.current) {
      hScrollRef.current.scrollLeft = pendingScrollRef.current;
      pendingScrollRef.current = null;
    }
  }, [zoom]);

  // ─── Editable duration ─────────────────────────────────────────────────────

  function commitDur(str: string) {
    const parts = str.split(':').map(Number);
    let secs = 0;
    if (parts.length === 3) secs = (parts[0] ?? 0) * 3600 + (parts[1] ?? 0) * 60 + (parts[2] ?? 0);
    else if (parts.length === 2) secs = (parts[0] ?? 0) * 60 + (parts[1] ?? 0);
    else secs = Number(str);
    if (!isNaN(secs) && secs >= 1) patchWidget({ duration: Math.min(3600, Math.round(secs)) });
    setEditingDur(false);
  }

  // ─── Viewport indicator drag ───────────────────────────────────────────────

  function startIndDrag(e: React.PointerEvent<HTMLDivElement>, mode: 'left' | 'right' | 'center') {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    indDragRef.current = { mode, startX: e.clientX, startY: e.clientY, startZoom: zoom, startVisStart: visStart, startVisEnd: visEnd };
  }

  function handleIndicatorMove(e: React.PointerEvent<HTMLDivElement>) {
    const d = indDragRef.current;
    if (!d || !indicatorRef.current) return;
    const rect = indicatorRef.current.getBoundingClientRect();
    const dx   = (e.clientX - d.startX) / rect.width;
    const cW   = hScrollRef.current?.clientWidth ?? 600;
    const dur  = widgetRef.current.duration;

    if (d.mode === 'center') {
      const dy = e.clientY - d.startY;
      if (Math.abs(dy) > 4) {
        // vertical drag: zoom in (down) / zoom out (up)
        const factor = Math.pow(1.01, -dy);
        const newZoom = Math.max(2, Math.min(200, +(d.startZoom * factor).toFixed(2)));
        const midT = (d.startVisStart + d.startVisEnd) / 2;
        pendingScrollRef.current = Math.round((midT * dur * newZoom) - (cW / 2));
        setZoom(newZoom);
      } else {
        const rangeW   = d.startVisEnd - d.startVisStart;
        const newStart = Math.max(0, Math.min(1 - rangeW, d.startVisStart + dx));
        if (hScrollRef.current) hScrollRef.current.scrollLeft = Math.round(newStart * dur * zoom);
      }
    } else if (d.mode === 'left') {
      const newStart = Math.max(0, Math.min(d.startVisEnd - 0.02, d.startVisStart + dx));
      const newZoom  = Math.max(2, Math.min(200, cW / ((d.startVisEnd - newStart) * dur)));
      pendingScrollRef.current = Math.round(newStart * dur * newZoom);
      setZoom(newZoom);
    } else {
      const newEnd  = Math.min(1, Math.max(d.startVisStart + 0.02, d.startVisEnd + dx));
      const newZoom = Math.max(2, Math.min(200, cW / ((newEnd - d.startVisStart) * dur)));
      pendingScrollRef.current = Math.round(d.startVisStart * dur * newZoom);
      setZoom(newZoom);
    }
  }

  function handleIndicatorUp() { indDragRef.current = null; }

  function handleIndicatorDblClick() {
    const cW  = hScrollRef.current?.clientWidth ?? 600;
    const dur = widgetRef.current.duration;
    pendingScrollRef.current = 0;
    setZoom(Math.max(2, +(cW / Math.max(dur, 1)).toFixed(2)));
  }

  // ─── Ruler ticks ───────────────────────────────────────────────────────────

  // Ticks follow the ZOOM, not just the duration: the step is picked so labels
  // stay ~64px apart whatever the scale, and minor ticks appear between them as
  // soon as there is room. Zooming in therefore reveals detail instead of
  // stretching the same handful of marks.
  // The ruler grid for the current zoom: `step` is the labelled interval,
  // `minor` the finest tick drawn. Shift+arrows nudge the playhead by `minor`,
  // so a keyboard step always matches what you can see.
  function rulerGrid(): { step: number; minor: number } {
    const d   = Math.max(widget.duration, 0.001);
    const fps = widget.timecodeFrameRate ?? project.frameRate ?? 25;
    const unit = widget.rulerUnit ?? 'sec';
    const pxPerSec = totalW / d;

    const LADDER = unit === 'frames'
      ? [1 / fps, 2 / fps, 5 / fps, 10 / fps, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300]
      : [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
    const MIN_LABEL_PX = 64;
    let step = LADDER[LADDER.length - 1];
    for (const s of LADDER) { if (s * pxPerSec >= MIN_LABEL_PX) { step = s; break; } }

    // Subdivide only while the minor ticks stay readable.
    const subDiv = (step * pxPerSec) / 4 >= 7 ? 4 : (step * pxPerSec) / 2 >= 7 ? 2 : 1;
    return { step, minor: step / subDiv };
  }

  const gridRef = useRef(rulerGrid);
  gridRef.current = rulerGrid;

  function rulerTicks() {
    const d   = Math.max(widget.duration, 0.001);
    const fps = widget.timecodeFrameRate ?? project.frameRate ?? 25;
    const unit = widget.rulerUnit ?? 'sec';
    const { step, minor } = rulerGrid();

    const ticks: React.ReactNode[] = [];
    const count = Math.floor(d / minor);
    for (let i = 0; i <= count; i++) {
      const t = i * minor;
      const isMajor = Math.abs(t / step - Math.round(t / step)) < 1e-6;
      ticks.push(
        <div key={i} style={{
          position: 'absolute', left: `${(t / d) * 100}%`, top: 0,
          pointerEvents: 'none', transform: 'translateX(-50%)',
        }}>
          <div style={{
            width: 1, height: isMajor ? 9 : 4,
            background: isMajor ? '#6a6a6a' : '#3a3a3a', margin: '0 auto',
          }} />
          {isMajor && (
            <div style={{ fontSize: 10, color: '#a8a8a8', marginTop: 2, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
              {fmtRuler(t, unit, fps, step)}
            </div>
          )}
        </div>
      );
    }
    return ticks;
  }

  // ─── Right panel ───────────────────────────────────────────────────────────

  const selTrack  = widget.tracks.find((t) => t.id === selTrkId);
  const selKf     = selTrack && (selTrack.kind === 'value' || selTrack.kind === 'color')
    ? (selTrack as ValueTrack | ColorTrack).keyframes.find((k) => k.id === selKfId)
    : null;
  const selTrigMk = selTrack?.kind === 'trig'
    ? (selTrack as TrigTrack).keyframes.find((k) => k.id === selKfId)
    : null;

  const rInp: React.CSSProperties = { width: '100%', background: '#111', border: '1px solid #1e1e1e', color: '#bbb', borderRadius: 2, padding: '2px 5px', fontSize: 10, boxSizing: 'border-box' };
  const rLbl: React.CSSProperties = { fontSize: 9, color: '#444', marginBottom: 2 };
  const rSec: React.CSSProperties = { marginBottom: 8 };

  function renderRight() {
    const selMarker = markers.find((m) => m.id === selMarkerId);
    if (selMarker) {
      return (
        <>
          <div style={{ fontSize: 9, fontWeight: 600, color: '#555', marginBottom: 8, letterSpacing: '0.06em' }}>MARKER</div>
          <div style={rSec}>
            <div style={rLbl}>Name</div>
            <input style={rInp} value={selMarker.name ?? ''}
              onChange={(e) => patchMarker(selMarker.id, { name: e.target.value || undefined })}
              placeholder="Marker name…" />
          </div>
          <div style={rSec}>
            <div style={rLbl}>Time (s)</div>
            <NumberInput style={rInp} min={0} max={widget.duration} step={0.01}
              value={+(selMarker.time * widget.duration).toFixed(2)}
              onChange={(v) => moveMarker(selMarker.id, v / widget.duration)} />
          </div>
          <div style={{ fontSize: 9, color: '#444', marginBottom: 8, lineHeight: 1.4 }}>
            Draws a line across every track. Triggers and value points snap to it while SNAP is on.
          </div>
          <button onClick={() => deleteMarker(selMarker.id)}
            style={{ width: '100%', background: pal('#1a110a'), border: `1px solid ${pal('#3a291a')}`, color: pal('#db8235'), borderRadius: 2, padding: '4px', cursor: 'pointer', fontSize: 10 }}>
            Delete marker
          </button>
        </>
      );
    }
    if (selTrack?.kind === 'cue') {
      const region = (selTrack as CueTrack).cues.find((c) => c.id === selKfId);
      if (region) {
        const isFirst = (selTrack as CueTrack).cues[0].id === region.id;
        return (
          <>
            <div style={{ fontSize: 9, fontWeight: 600, color: '#555', marginBottom: 8, letterSpacing: '0.06em' }}>CUE BLOCK</div>
            <div style={rSec}>
              <div style={rLbl}>Name</div>
              <input style={rInp} value={region.name}
                onChange={(e) => patchCue(selTrack.id, region.id, { name: e.target.value })}
                placeholder="Cue name…" />
            </div>
            <div style={rSec}>
              <div style={rLbl}>Colour</div>
              <input type="color" value={region.color}
                onChange={(e) => patchCue(selTrack.id, region.id, { color: e.target.value })}
                style={{ width: '100%', height: 22, background: 'none', border: '1px solid #1e1e1e', borderRadius: 2, cursor: 'pointer', padding: 0 }} />
            </div>
            <div style={rSec}>
              <div style={rLbl}>Starts at (s)</div>
              <NumberInput style={rInp} min={0} max={widget.duration} step={0.01}                 disabled={isFirst}
              value={+(region.time * widget.duration).toFixed(2)}
              onChange={(v) => patchCue(selTrack.id, region.id, { time: Math.max(0, Math.min(1, v / widget.duration)) })} />
              {isFirst && <div style={{ fontSize: 9, color: '#444', marginTop: 2 }}>The opening block always starts at 0.</div>}
            </div>
            <MiniMap label="Output mapping" mapping={region.mapping}
              onChange={(m) => patchCue(selTrack.id, region.id, { mapping: m })} />
            <div style={{ fontSize: 9, color: '#444', marginBottom: 8, lineHeight: 1.4 }}>
              Held at 1 while the playhead is anywhere inside this block — including
              when you scrub into it. Double-click or Ctrl-click the row to cut a new block.
            </div>
            {!isFirst && (
              <button onClick={() => deleteCue(selTrack.id, region.id)}
                style={{ width: '100%', background: pal('#1a110a'), border: `1px solid ${pal('#3a291a')}`, color: pal('#db8235'), borderRadius: 2, padding: '4px', cursor: 'pointer', fontSize: 10 }}>
                Delete block
              </button>
            )}
          </>
        );
      }
    }
    if (selTrack?.kind === 'wait') {
      const point = (selTrack as WaitTrack).points.find((p) => p.id === selKfId);
      if (point) {
        return (
          <>
            <div style={{ fontSize: 9, fontWeight: 600, color: '#555', marginBottom: 8, letterSpacing: '0.06em' }}>WAIT POINT</div>
            <div style={rSec}>
              <div style={rLbl}>Name</div>
              <input style={rInp} value={point.name ?? ''}
                onChange={(e) => patchWait(selTrack.id, point.id, { name: e.target.value || undefined })}
                placeholder="e.g. wait for actor…" />
            </div>
            <div style={rSec}>
              <div style={rLbl}>Time (s)</div>
              <NumberInput style={rInp} min={0} max={widget.duration} step={0.01}
              value={+(point.time * widget.duration).toFixed(2)}
              onChange={(v) => patchWait(selTrack.id, point.id, { time: Math.max(0, Math.min(1, v / widget.duration)) })} />
            </div>
            <div style={rSec}>
              <div style={rLbl}>Bypass</div>
              <button
                onClick={() => patchWait(selTrack.id, point.id, { bypass: !point.bypass })}
                style={{
                  width: '100%', borderRadius: 2, padding: '4px', cursor: 'pointer', fontSize: 10,
                  background: point.bypass ? '#2a2a2a' : '#111',
                  border: `1px solid ${point.bypass ? '#666' : '#1e1e1e'}`,
                  color: point.bypass ? '#bbb' : '#666', fontFamily: 'inherit',
                }}>
                {point.bypass ? 'BYPASSED — does not stop' : 'Active — stops playback'}
              </button>
            </div>
            <div style={{ fontSize: 9, color: '#444', marginBottom: 8, lineHeight: 1.4 }}>
              Playback stops on this point. SPACE (or ▶) carries on from here.
              Click the row to add another point.
              Bypassed points go grey and let the transport run through, but
              Ctrl+←/→ still jumps to them.
            </div>
            <button onClick={() => deleteWait(selTrack.id, point.id)}
              style={{ width: '100%', background: pal('#1a110a'), border: `1px solid ${pal('#3a291a')}`, color: pal('#db8235'), borderRadius: 2, padding: '4px', cursor: 'pointer', fontSize: 10 }}>
              Delete wait point
            </button>
          </>
        );
      }
    }
    if (selTrigMk && selTrack?.kind === 'trig') {
      return (
        <>
          <div style={{ fontSize: 9, fontWeight: 600, color: '#555', marginBottom: 8, letterSpacing: '0.06em' }}>TRIG MARKER</div>
          <div style={rSec}>
            <div style={rLbl}>Name</div>
            <input style={rInp} value={selTrigMk.name ?? ''}
              onChange={(e) => patchTrigMarker(selTrkId!, selTrigMk.id, { name: e.target.value || undefined })}
              placeholder="Label…" />
          </div>
          <div style={rSec}>
            <div style={rLbl}>Time (s)</div>
            <NumberInput style={rInp} min={0} max={widget.duration} step={0.01}
              value={+(selTrigMk.time * widget.duration).toFixed(2)}
              onChange={(v) => moveKeyframe(selTrkId!, selTrigMk.id, Math.max(0, Math.min(1, v / widget.duration)), 0)} />
          </div>
          <MiniMap label="Output mapping" mapping={(selTrack as TrigTrack).mapping}
            onChange={(m) => updateTrack(selTrack.id, { mapping: m } as never)} />
          <button onClick={() => deleteKeyframe(selTrkId!, selTrigMk.id)}
            style={{ width: '100%', background: pal('#1a110a'), border: `1px solid ${pal('#3a291a')}`, color: pal('#db8235'), borderRadius: 2, padding: '4px', cursor: 'pointer', fontSize: 10 }}>
            Delete marker
          </button>
        </>
      );
    }

    if (selKf && selTrack) {
      return (
        <>
          <div style={{ fontSize: 9, fontWeight: 600, color: '#555', marginBottom: 8, letterSpacing: '0.06em' }}>KEYFRAME</div>
          <div style={rSec}>
            <div style={rLbl}>Time (s)</div>
            <NumberInput style={rInp} min={0} max={widget.duration} step={0.01}
              value={+(selKf.time * widget.duration).toFixed(2)}
              onChange={(v) => patchKeyframe(selTrkId!, selKf.id, { time: Math.max(0, Math.min(1, v / widget.duration)) })} />
          </div>
          {selTrack.kind === 'value' && 'value' in selKf && (
            <div style={rSec}>
              <div style={rLbl}>Value (0–1)</div>
              <NumberInput style={rInp} min={0} max={1} step={0.01}
              value={+(selKf as ValueKeyframe).value.toFixed(3)}
              onChange={(v) => patchKeyframe(selTrkId!, selKf.id, { value: Math.max(0, Math.min(1, v)) })} />
            </div>
          )}
          {selTrack.kind === 'color' && 'color' in selKf && (
            <div style={rSec}>
              <div style={rLbl}>Color</div>
              <input type="color" value={(selKf as ColorKeyframe).color}
                onChange={(e) => patchKeyframe(selTrkId!, selKf.id, { color: e.target.value })}
                style={{ width: '100%', height: 26, border: 'none', background: 'none', padding: 0, cursor: 'pointer' }} />
            </div>
          )}
          {selTrack.kind === 'value' && (
            <div style={rSec}>
              <div style={rLbl}>Easing</div>
              <select style={rInp} value={(selKf as ValueKeyframe).easing ?? 'linear'}
                onChange={(e) => patchKeyframe(selTrkId!, selKf.id, { easing: e.target.value as TimelineEasing })}>
                <option value="linear">Linear</option>
                <option value="step">Step (square)</option>
                <option value="bezier">Bezier</option>
              </select>
            </div>
          )}
          {selTrack.kind === 'color' && (
            <div style={rSec}>
              <div style={rLbl}>Easing</div>
              <select style={rInp} value={(selKf as ColorKeyframe).easing ?? 'linear'}
                onChange={(e) => patchKeyframe(selTrkId!, selKf.id, { easing: e.target.value as 'linear' | 'step' })}>
                <option value="linear">Linear</option>
                <option value="step">Step</option>
              </select>
            </div>
          )}
          <button onClick={() => deleteKeyframe(selTrkId!, selKf.id)}
            style={{ width: '100%', background: pal('#1a110a'), border: `1px solid ${pal('#3a291a')}`, color: pal('#db8235'), borderRadius: 2, padding: '4px', cursor: 'pointer', fontSize: 10, marginBottom: 10 }}>
            Delete keyframe
          </button>
          {selTrack.kind === 'value' && (
            <MiniMap label="Track output" mapping={(selTrack as ValueTrack).mapping}
              onChange={(m) => updateTrack(selTrack.id, { mapping: m } as never)} />
          )}
          {selTrack.kind === 'color' && (
            <ColorOscSettings track={selTrack as ColorTrack} onChange={(p) => updateTrack(selTrack.id, p)} sec={rSec} lbl={rLbl} inp={rInp} />
          )}
        </>
      );
    }

    if (selTrack) {
      return (
        <>
          <div style={{ fontSize: 9, fontWeight: 600, color: '#555', marginBottom: 8, letterSpacing: '0.06em' }}>{selTrack.kind.toUpperCase()} TRACK</div>
          <div style={rSec}>
            <div style={rLbl}>Label</div>
            <input style={rInp} value={selTrack.label} onChange={(e) => updateTrack(selTrack.id, { label: e.target.value })} />
          </div>

          {selTrack.kind === 'value' && (
            <>
              <div style={rSec}>
                <div style={rLbl}>Accent color</div>
                <input type="color" value={(selTrack as ValueTrack).color}
                  onChange={(e) => updateTrack(selTrack.id, { color: e.target.value })}
                  style={{ width: '100%', height: 24, border: 'none', background: 'none', padding: 0, cursor: 'pointer' }} />
              </div>
              <MiniMap label="Output mapping" mapping={(selTrack as ValueTrack).mapping}
                onChange={(m) => updateTrack(selTrack.id, { mapping: m } as never)} />
            </>
          )}

          {selTrack.kind === 'color' && (
            <ColorOscSettings track={selTrack as ColorTrack} onChange={(p) => updateTrack(selTrack.id, p)} sec={rSec} lbl={rLbl} inp={rInp} />
          )}

          {selTrack.kind === 'trig' && (
            <>
              <div style={rSec}>
                <div style={rLbl}>Accent color</div>
                <input type="color" value={(selTrack as TrigTrack).color}
                  onChange={(e) => updateTrack(selTrack.id, { color: e.target.value })}
                  style={{ width: '100%', height: 24, border: 'none', background: 'none', padding: 0, cursor: 'pointer' }} />
              </div>
              <MiniMap label="Output mapping" mapping={(selTrack as TrigTrack).mapping}
                onChange={(m) => updateTrack(selTrack.id, { mapping: m } as never)} />
              <div style={{ fontSize: 9, color: '#444', marginBottom: 4 }}>Click on track to add markers. Drag to reposition.</div>
            </>
          )}

          {selTrack.kind === 'sound' && (
            <>
              <div style={rSec}>
                <div style={rLbl}>File</div>
                <div style={{ fontSize: 9, color: '#555', marginBottom: 4, wordBreak: 'break-all' }}>
                  {(selTrack as SoundTrack).fileName || 'No file'}
                </div>
                <button onClick={() => void pickAudio(selTrack.id)}
                  style={{ ...rInp, cursor: 'pointer', textAlign: 'left', background: '#151515', marginBottom: 0 }}>
                  {(selTrack as SoundTrack).src ? 'Replace audio…' : 'Pick audio…'}
                </button>
              </div>
              <div style={rSec}>
                <div style={rLbl}>Volume ({Math.round((selTrack as SoundTrack).volume * 100)}%)</div>
                <input type="range" min={0} max={1} step={0.01} value={(selTrack as SoundTrack).volume}
                  onChange={(e) => updateTrack(selTrack.id, { volume: +e.target.value })}
                  style={{ width: '100%' }} />
              </div>
              <div style={rSec}>
                <div style={rLbl}>Start offset (s)</div>
                <input type="number" style={rInp} min={0} step={0.1} value={(selTrack as SoundTrack).offset}
                  onChange={(e) => updateTrack(selTrack.id, { offset: Math.max(0, +e.target.value || 0) })} />
              </div>
              <div style={rSec}>
                <div style={rLbl}>Audio output</div>
                {audioOutDevices.length === 0 ? (
                  <button onClick={() => {
                    navigator.mediaDevices.enumerateDevices().then((devs) => {
                      setAudioOutDevices(devs.filter((d) => d.kind === 'audiooutput'));
                    }).catch(() => {});
                  }} style={{ ...rInp, cursor: 'pointer', textAlign: 'left', background: '#151515' }}>
                    Scan outputs…
                  </button>
                ) : (
                  <select style={rInp} value={(selTrack as SoundTrack).audioOutputDeviceId ?? ''}
                    onChange={(e) => updateTrack(selTrack.id, { audioOutputDeviceId: e.target.value || undefined })}>
                    <option value="">Default</option>
                    {audioOutDevices.map((d) => (
                      <option key={d.deviceId} value={d.deviceId}>{d.label || d.deviceId}</option>
                    ))}
                  </select>
                )}
              </div>
            </>
          )}

          <button onClick={() => deleteTrack(selTrack.id)}
            style={{ width: '100%', background: pal('#1a110a'), border: `1px solid ${pal('#3a291a')}`, color: pal('#db8235'), borderRadius: 2, padding: '4px', cursor: 'pointer', fontSize: 10, marginTop: 4 }}>
            Delete track
          </button>
        </>
      );
    }

    return <div style={{ fontSize: 9, color: '#282828', textAlign: 'center', paddingTop: 12 }}>Click a track or keyframe</div>;
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  const tNorm  = currentTime / Math.max(widget.duration, 0.001);
  tNormRef.current = tNorm;
  const icoBtn: React.CSSProperties = { background: 'transparent', border: 'none', color: '#ffffff', cursor: 'pointer', fontSize: 22, padding: '0 6px', height: 42, display: 'flex', alignItems: 'center', lineHeight: 1, fontFamily: 'inherit', boxSizing: 'border-box', WebkitAppearance: 'none', outline: 'none' };
  const barBtn: React.CSSProperties = { background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', color: 'var(--color-text)', borderRadius: 'var(--radius-sm)', height: 42, padding: '0 14px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'inherit', fontSize: 'var(--font-size-md)', boxSizing: 'border-box', flexShrink: 0 };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#080808' }}>

      {/* ── Header (50px) ── */}
      <div style={{ flexShrink: 0, height: HEAD_H, display: 'flex', alignItems: 'center', gap: 6, padding: '0 8px', borderBottom: '1px solid #141414', background: '#0a0a0a' }}>
        <button onClick={goToStart} title="Go to start" style={icoBtn}>{'⏮︎'}</button>
        <button
          onClick={() => isPlaying ? stopPlayback() : startPlayback()}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setTransportMenu({ x: e.clientX, y: e.clientY, cell: null });
          }}
          title={isPlaying ? 'Stop · right-click: remote GO / STOP / BACK' : 'Play · right-click: remote GO / STOP / BACK'}
          style={{ ...icoBtn, fontSize: 22 }}
        >{isPlaying ? '■' : '▶'}</button>
        <button onClick={goToEnd} title="Go to end" style={icoBtn}>{'⏭︎'}</button>

        {/* Timecode toggle — left side, near transport */}
        <button
          onClick={() => setTcActive((v) => !v)}
          title={`Timecode sync (${widget.timecodeSource ?? 'off'})`}
          style={{ ...barBtn, height: 28, padding: '0 8px', fontSize: 10,
            background: tcActive ? '#ffffff' : 'transparent',
            borderColor: '#ffffff',
            color: tcActive ? '#000000' : '#ffffff',
            opacity: (widget.timecodeSource ?? 'off') === 'off' ? 0.25 : 1,
          }}>
          {(widget.timecodeSource ?? 'off') === 'ltc' ? 'LTC' : (widget.timecodeSource ?? 'off') === 'mtc' ? 'MTC' : 'TC'}
        </button>

        <span style={{ fontSize: 13, color: 'var(--color-text-dim)', minWidth: 52, fontVariantNumeric: 'tabular-nums', fontFamily: 'inherit' }}>{fmt(currentTime)}</span>

        <span style={{ flex: 1 }} />

        {/* Tool mode */}
        <button
          onClick={() => setToolMode('pointer')}
          title="Select / Move tool"
          style={{ ...icoBtn, color: toolMode === 'pointer' ? '#ffffff' : '#3a3a3a' }}>
          ↖
        </button>
        <button
          onClick={() => setToolMode('cut')}
          title="Cut / Crop tool"
          style={{ ...icoBtn, color: toolMode === 'cut' ? '#ffffff' : '#3a3a3a' }}>
          ✂
        </button>

        <div style={{ width: 1, height: 24, background: '#222', margin: '0 4px', flexShrink: 0 }} />

        {editingDur ? (
          <input
            autoFocus
            value={durInputStr}
            onChange={(e) => setDurInputStr(e.target.value)}
            onBlur={(e) => commitDur(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') commitDur(durInputStr); if (e.key === 'Escape') setEditingDur(false); }}
            style={{ width: 86, background: 'var(--color-surface-2)', border: '1px solid var(--color-accent)', color: 'var(--color-text)', fontSize: 12, textAlign: 'center', padding: '0 6px', height: 28, borderRadius: 'var(--radius-sm)', fontFamily: 'inherit', fontVariantNumeric: 'tabular-nums', outline: 'none', boxSizing: 'border-box' }}
          />
        ) : (
          <button
            onClick={() => { setDurInputStr(fmtDur(widget.duration)); setEditingDur(true); }}
            title="Click to edit duration (HH:MM:SS)"
            style={{ background: 'transparent', border: '1px solid #1e1e1e', color: 'var(--color-text-dim)', fontSize: 12, fontVariantNumeric: 'tabular-nums', cursor: 'text', padding: '0 6px', height: 28, display: 'flex', alignItems: 'center', boxSizing: 'border-box', fontFamily: 'inherit', borderRadius: 'var(--radius-sm)', WebkitAppearance: 'none', outline: 'none' }}
          >{fmtDur(widget.duration)}</button>
        )}

        <button
          onClick={() => patchWidget({ loopMode: widget.loopMode === 'loop' ? 'none' : 'loop' })}
          style={{ ...barBtn, height: 28, padding: '0 10px', fontSize: 11,
            background: widget.loopMode === 'loop' ? 'var(--color-accent-dim)' : 'transparent',
            borderColor: widget.loopMode === 'loop' ? 'var(--color-accent)' : '#1e1e1e',
            color: widget.loopMode === 'loop' ? 'var(--color-accent)' : '#3a3a3a',
          }}>↻</button>

        {/* Add a ruler marker at the playhead */}
        <button
          onClick={() => addMarkerAt(tNorm)}
          title="Add marker at playhead"
          style={{
            background: '#111', border: '1px solid #1e1e1e', borderRadius: 2,
            fontSize: 10, padding: '2px 7px', cursor: 'pointer', color: '#8a8a8a',
            fontFamily: 'inherit', lineHeight: 1.4, marginLeft: 4,
          }}>+M</button>

        {/* Snap keyframes/triggers to markers */}
        <button
          onClick={() => setSnapEnabled((v) => !v)}
          title={snapEnabled ? 'Snap to markers: ON — click to disable' : 'Snap to markers: OFF — click to enable'}
          style={{
            background: snapEnabled ? 'rgba(255,255,255,0.10)' : '#111',
            border: `1px solid ${snapEnabled ? 'rgba(255,255,255,0.5)' : '#1e1e1e'}`,
            borderRadius: 2, fontSize: 10, padding: '2px 7px', cursor: 'pointer',
            color: snapEnabled ? '#fff' : '#3a3a3a',
            fontFamily: 'inherit', lineHeight: 1.4,
          }}>SNAP</button>

        {/* Ruler readout: seconds or timecode frames */}
        <button
          onClick={() => patchWidget({ rulerUnit: (widget.rulerUnit ?? 'sec') === 'sec' ? 'frames' : 'sec' })}
          title={(widget.rulerUnit ?? 'sec') === 'sec'
            ? 'Ruler in seconds — click for frames'
            : `Ruler in frames @ ${widget.timecodeFrameRate ?? project.frameRate ?? 25}fps — click for seconds`}
          style={{
            background: '#111', border: '1px solid #1e1e1e',
            borderRadius: 2, fontSize: 10, padding: '2px 7px', cursor: 'pointer',
            color: '#9a9a9a', fontFamily: 'inherit', lineHeight: 1.4, marginLeft: 4,
          }}>
          {(widget.rulerUnit ?? 'sec') === 'sec' ? 'SEC' : 'FRM'}
        </button>
      </div>

      {/* ── Body ── */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>

        {/* Left panel: track list */}
        <div style={{ width: LEFT_W, flexShrink: 0, borderRight: '1px solid #141414', display: 'flex', flexDirection: 'column', background: '#090909' }}>
          {/* Header row aligns with viewport bar + ruler */}
          <div style={{ flexShrink: 0, height: 20 + RULER_H, display: 'flex', alignItems: 'center', padding: '0 8px', borderBottom: '1px solid #141414', position: 'relative' }}>
            <button onClick={() => setShowAddMenu((v) => !v)}
              style={{ background: '#111', border: '1px solid #1e1e1e', color: '#666', borderRadius: 2, fontSize: 11, padding: '1px 8px', cursor: 'pointer', width: '100%' }}>
              + Track
            </button>
            {showAddMenu && (
              <div style={{ position: 'absolute', top: '100%', left: 0, zIndex: 20, background: '#0f0f0f', border: '1px solid #1e1e1e', borderRadius: 3, width: LEFT_W - 4, overflow: 'hidden' }}>
                {(['value', 'color', 'trig', 'cue', 'wait', 'sound'] as const).map((kind) => (
                  <button key={kind} onClick={() => addTrack(kind)}
                    style={{ display: 'block', width: '100%', background: 'none', border: 'none', color: '#888', padding: '6px 10px', cursor: 'pointer', textAlign: 'left', fontSize: 11 }}>
                    {TRACK_ICON[kind]} {TRACK_KIND_LABEL[kind]}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Track labels */}
          <div className="tl-lbl" style={{ flex: 1, overflowY: 'auto', scrollbarWidth: 'none' } as React.CSSProperties}>
            {widget.tracks.map((t, ti) => {
              const tH = trackHeights.get(t.id) ?? TRACK_H;
              return (
                <div key={t.id}
                  style={{
                    height: tH, position: 'relative', display: 'flex', alignItems: 'center', padding: '0 8px', gap: 6,
                    borderBottom: '1px solid #101010', cursor: 'pointer', flexShrink: 0,
                    background: selTrkId === t.id ? pal('#101f20') : 'transparent',
                  }}
                  onClick={() => { setSelTrkId(t.id); setSelKfId(null); }}>
                  <span style={{ fontSize: 10, color: trackColor(t), flexShrink: 0, opacity: t.muted ? 0.35 : 1 }}>
                    {TRACK_ICON[t.kind] ?? '◆'}
                  </span>
                  <span style={{ fontSize: 10, color: '#666', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', flex: 1, opacity: t.muted ? 0.4 : 1 }}>{t.label}</span>
                  <button
                    onClick={(ev) => { ev.stopPropagation(); updateTrack(t.id, { muted: !t.muted }); }}
                    title={t.muted ? 'Unmute' : 'Mute'}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 1px', fontSize: 8, fontWeight: 700, color: t.muted ? pal('#e08b40') : '#282828', flexShrink: 0, lineHeight: 1, fontFamily: 'inherit' }}
                  >M</button>
                  {/* Output dot anchor: cell ti is this track's value, so Shift
                      patching puts its orange dot right here, on the row. */}
                  <span data-lf-widget={widget.id} data-lf-cell={ti}
                    style={{ width: 16, height: 16, flexShrink: 0, pointerEvents: 'none' }} />
                  {/* Vertical resize handle */}
                  <div
                    style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 5, cursor: 'ns-resize', zIndex: 5 }}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      const el = e.currentTarget; // capture before React nulls it
                      el.setPointerCapture(e.pointerId);
                      const startY = e.clientY;
                      const startH = tH;
                      const id = t.id;
                      const onMove = (me: PointerEvent) => {
                        const newH = Math.max(28, startH + (me.clientY - startY));
                        setTrackHeights((prev) => new Map([...prev, [id, newH]]));
                      };
                      const onUp = () => { el.removeEventListener('pointermove', onMove as EventListener); };
                      el.addEventListener('pointermove', onMove as EventListener);
                      el.addEventListener('pointerup', onUp, { once: true });
                      el.addEventListener('pointercancel', onUp, { once: true });
                    }}
                  />
                </div>
              );
            })}
            {widget.tracks.length === 0 && (
              <div style={{ padding: '10px 8px', fontSize: 9, color: '#282828' }}>No tracks. Press + to add one.</div>
            )}
          </div>
        </div>

        {/* Center column: viewport bar + scrollable ruler/tracks */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
          onClick={() => { if (showAddMenu) setShowAddMenu(false); }}>

          {/* Viewport indicator (20px) — drag handles to zoom, drag center to pan, dbl-click to fit */}
          <div
            ref={indicatorRef}
            style={{ flexShrink: 0, height: 20, background: '#070707', position: 'relative', borderBottom: '1px solid #141414', overflow: 'hidden', userSelect: 'none' }}
            onDoubleClick={handleIndicatorDblClick}
          >
            {/* Track background */}
            <div style={{ position: 'absolute', top: 6, bottom: 6, left: 0, right: 0, background: '#131313' }} />
            {/* Visible range bar */}
            <div style={{
              position: 'absolute', top: 3, bottom: 3,
              left: `${visStart * 100}%`,
              width: `${Math.max(0.01, visEnd - visStart) * 100}%`,
              background: pal('#204b4e'), borderRadius: 2,
              display: 'flex', overflow: 'hidden',
            }}>
              {/* Left resize handle — captures pointer so move/up stay on this element */}
              <div
                style={{ width: 6, height: '100%', cursor: 'ew-resize', background: pal('#3a7b80'), flexShrink: 0 }}
                onPointerDown={(e) => startIndDrag(e, 'left')}
                onPointerMove={handleIndicatorMove}
                onPointerUp={handleIndicatorUp}
                onPointerCancel={handleIndicatorUp}
              />
              {/* Pan area */}
              <div
                style={{ flex: 1, height: '100%', cursor: 'grab' }}
                onPointerDown={(e) => startIndDrag(e, 'center')}
                onPointerMove={handleIndicatorMove}
                onPointerUp={handleIndicatorUp}
                onPointerCancel={handleIndicatorUp}
              />
              {/* Right resize handle */}
              <div
                style={{ width: 6, height: '100%', cursor: 'ew-resize', background: pal('#3a7b80'), flexShrink: 0 }}
                onPointerDown={(e) => startIndDrag(e, 'right')}
                onPointerMove={handleIndicatorMove}
                onPointerUp={handleIndicatorUp}
                onPointerCancel={handleIndicatorUp}
              />
            </div>
            {/* Labels */}
            <div style={{ position: 'absolute', left: `${visStart * 100}%`, top: 4, fontSize: 7, color: pal('#4a868a'), transform: 'translateX(8px)', lineHeight: '12px', pointerEvents: 'none' }}>
              {Math.round(visStart * 100)}%
            </div>
            <div style={{ position: 'absolute', left: `${visEnd * 100}%`, top: 4, fontSize: 7, color: pal('#4a868a'), transform: 'translateX(calc(-100% - 8px))', lineHeight: '12px', pointerEvents: 'none' }}>
              {Math.round(visEnd * 100)}%
            </div>
          </div>

          {/* Horizontal scroll area — scrollbar hidden, navigate via viewport indicator */}
          <style>{`
            .tl-hs::-webkit-scrollbar{display:none}
            .tl-trk::-webkit-scrollbar{display:none}
            .tl-lbl::-webkit-scrollbar{display:none}
            @keyframes tl-pulse{from{opacity:0.2;transform:scaleY(0.4)}to{opacity:0.7;transform:scaleY(1)}}
          `}</style>
          <div
            ref={hScrollRef}
            className="tl-hs"
            style={{ flex: 1, overflowX: 'auto', overflowY: 'hidden', display: 'flex', flexDirection: 'column', scrollbarWidth: 'none' } as React.CSSProperties}
            onScroll={(e) => setScrollLeft(e.currentTarget.scrollLeft)}
          >
            {/* Content at totalW wide — ruler + tracks stacked */}
            <div style={{ width: totalW, display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, position: 'relative' }}>

              {/* Ruler */}
              <div ref={rulerRef}
                style={{ flexShrink: 0, height: RULER_H, position: 'relative', background: '#090909', borderBottom: '1px solid #141414', cursor: 'crosshair' }}
                onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); setScrubbingPH(true); scrubTo(e.clientX); }}
                onPointerMove={(e) => { if (scrubbingPH) scrubTo(e.clientX); }}
                onPointerUp={() => setScrubbingPH(false)}
                onPointerCancel={() => setScrubbingPH(false)}
              >
                {rulerTicks()}

                <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${tNorm * 100}%`, width: 1, background: pal('#e07a20'), pointerEvents: 'none' }} />
              </div>


              {/* Marker lane — its own thin strip, so marker names never sit on
                  top of the ruler numbers. */}
              <div style={{
                flexShrink: 0, height: MARKER_H, position: 'relative',
                background: '#0b0b0b', borderBottom: '1px solid #141414',
              }}>
                {markers.map((m) => {
                  const isSel = selMarkerId === m.id;
                  return (
                    <div
                      key={m.id}
                      title={m.name || 'marker'}
                      style={{
                        position: 'absolute', left: `${m.time * 100}%`, top: 0, bottom: 0,
                        display: 'flex', flexDirection: 'row', alignItems: 'center',
                        cursor: 'grab', zIndex: 6, userSelect: 'none',
                      }}
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        e.currentTarget.setPointerCapture(e.pointerId);
                        setSelMarkerId(m.id);
                        setSelKfId(null);
                        markerDragRef.current = { id: m.id, startX: e.clientX, origTime: m.time };
                      }}
                      onPointerMove={(e) => {
                        const d = markerDragRef.current;
                        if (!d || d.id !== m.id || !rulerRef.current) return;
                        const rect = rulerRef.current.getBoundingClientRect();
                        moveMarker(d.id, d.origTime + (e.clientX - d.startX) / rect.width);
                      }}
                      onPointerUp={() => { markerDragRef.current = null; }}
                      onPointerCancel={() => { markerDragRef.current = null; }}
                    >
                      {/* Droplet sits ON the time; the name runs to its right. */}
                      <span style={{
                        width: 9, height: 11, flexShrink: 0,
                        transform: 'translateX(-50%)',
                        background: isSel ? '#ffffff' : '#8a8a8a',
                        borderRadius: 3,
                        clipPath: 'polygon(0% 0%, 100% 0%, 100% 62%, 50% 100%, 0% 62%)',
                        pointerEvents: 'none',
                      }} />
                      {m.name && (
                        <span style={{
                          fontSize: 9, lineHeight: 1, color: isSel ? '#fff' : '#9a9a9a',
                          whiteSpace: 'nowrap', pointerEvents: 'none', marginLeft: 1,
                        }}>{m.name}</span>
                      )}
                    </div>
                  );
                })}
                <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${tNorm * 100}%`, width: 1, background: pal('#e07a20'), pointerEvents: 'none' }} />
              </div>

              {/* Track rows */}
              <div className="tl-trk" style={{ flex: 1, overflowY: 'auto', position: 'relative', scrollbarWidth: 'none' } as React.CSSProperties}>
                {widget.tracks.map((t) => (
                  <TrackRow key={t.id}
                    track={t}
                    isSelected={selTrkId === t.id}
                    selectedKfId={selKfId}
                    tNorm={tNorm}
                    wf={waveforms.get(t.id)}
                    wfLoading={wfLoading.has(t.id)}
                    toolMode={toolMode}
                    duration={widget.duration}
                    trackHeight={trackHeights.get(t.id) ?? TRACK_H}
                    onSelect={() => { setSelTrkId(t.id); setSelKfId(null); setSelMarkerId(null); }}
                    onSelectKf={(id) => { setSelKfId(id); setSelTrkId(t.id); setSelMarkerId(null); }}
                    onAddKf={(time, value) => addKeyframe(t.id, time, value)}
                    onMoveKf={(kfId, time, value) => moveKeyframe(t.id, kfId, time, value)}
                    onPatchKf={(kfId, patch) => patchKeyframe(t.id, kfId, patch)}
                    onCutTrack={(time) => cutTrack(t.id, time)}
                    onSplitCue={(time) => splitCueAt(t.id, time)}
                    onAddWait={(time) => addWaitAt(t.id, time)}
                    onUpdateTrack={(patch) => updateTrack(t.id, patch as Partial<TimelineTrack>)}
                  />
                ))}
                {/* Marker lines — always on, across every track (snap targets) */}
                {markers.map((m) => (
                  <div key={m.id} style={{
                    position: 'absolute', top: 0, bottom: 0, left: `${m.time * 100}%`,
                    width: 1, marginLeft: -0.5,
                    background: selMarkerId === m.id ? 'rgba(255,255,255,0.55)' : 'rgba(160,160,160,0.28)',
                    pointerEvents: 'none', zIndex: 9,
                  }} />
                ))}
                <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${tNorm * 100}%`, width: 1, background: pal('#e07a20'), pointerEvents: 'none', zIndex: 10 }} />
              </div>
            </div>
          </div>
        </div>

        {/* Right panel: properties */}
        <div style={{
          width: RIGHT_W, flexShrink: 0, borderLeft: '1px solid #141414',
          background: '#090909', overflowY: 'auto', padding: '10px 10px',
          display: 'flex', flexDirection: 'column',
        }}>
          {renderRight()}
        </div>
      </div>

      {/* Portal: a fixed menu inside the scaled Live canvas would be offset and clipped. */}
      {transportMenu && transportMenu.cell === null && createPortal(
        <div
          style={{
            position: 'fixed', left: transportMenu.x, top: transportMenu.y, zIndex: 9999,
            background: '#1a1a1a', border: '1px solid #3a3a3a', borderRadius: 6, padding: '6px 0',
            minWidth: 260, boxShadow: '0 6px 28px rgba(0,0,0,0.75)', fontFamily: 'monospace',
          }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <div style={{ padding: '8px 16px', color: '#8a8a8a', fontSize: 12, textTransform: 'uppercase', letterSpacing: 1 }}>
            remote transport
          </div>
          {TIMELINE_TRANSPORT.map((t) => (
            <button key={t.index}
              onClick={() => setTransportMenu({ ...transportMenu, cell: t.index })}
              style={{
                display: 'block', width: '100%', minHeight: 40, padding: '8px 16px', background: 'none',
                border: 'none', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit',
              }}>
              <span style={{ fontSize: 15, color: '#ccc' }}>{t.label} ▸</span>
              <div style={{ fontSize: 11, color: '#666', marginTop: 2 }}>{t.hint}</div>
            </button>
          ))}
        </div>,
        document.body,
      )}
      {transportMenu && transportMenu.cell !== null && (
        <CellLinkMenu
          x={transportMenu.x} y={transportMenu.y}
          widgetId={widget.id} cellIndex={transportMenu.cell}
          onClose={() => setTransportMenu(null)}
        />
      )}
    </div>
  );
}
