import { pal, palRgb } from '../../palette';
import React, { useEffect, useRef, useState } from 'react';
import type { AudioAnalyserWidget } from '../../../shared/types/project';
import { BEAT_DIVISORS } from '../../../shared/types/project';
import { useStore } from '../../store';
import { dispatchValue } from '../../ipc/dispatch';

// ─── Frequency helpers (log scale) ───────────────────────────────────────────

const FREQ_MIN = 20;
const FREQ_MAX = 20000;
const LOG_RATIO = Math.log(FREQ_MAX / FREQ_MIN);

function freqToX(f: number, w: number): number {
  return w * Math.log(Math.max(1, f) / FREQ_MIN) / LOG_RATIO;
}
function xToFreq(x: number, w: number): number {
  return Math.round(FREQ_MIN * Math.pow(FREQ_MAX / FREQ_MIN, x / w));
}

// ─── Band energy functions ────────────────────────────────────────────────────

function getBandEnergy(data: Uint8Array<ArrayBuffer>, sr: number, centerHz: number, bandHz: number): number {
  const binSize = (sr / 2) / data.length;
  const lo = Math.max(0, Math.floor((centerHz - bandHz / 2) / binSize));
  const hi = Math.min(data.length - 1, Math.ceil((centerHz + bandHz / 2) / binSize));
  if (lo > hi) return 0;
  let sum = 0;
  for (let i = lo; i <= hi; i++) sum += data[i];
  return sum / ((hi - lo + 1) * 255);
}

function getLowpassEnergy(data: Uint8Array<ArrayBuffer>, sr: number, cutoffHz: number): number {
  const binSize = (sr / 2) / data.length;
  const hi = Math.min(data.length - 1, Math.floor(cutoffHz / binSize));
  if (hi < 0) return 0;
  let sum = 0;
  for (let i = 0; i <= hi; i++) sum += data[i];
  return sum / ((hi + 1) * 255);
}

function getHighpassEnergy(data: Uint8Array<ArrayBuffer>, sr: number, cutoffHz: number): number {
  const binSize = (sr / 2) / data.length;
  const lo = Math.max(0, Math.ceil(cutoffHz / binSize));
  const count = data.length - lo;
  if (count <= 0) return 0;
  let sum = 0;
  for (let i = lo; i < data.length; i++) sum += data[i];
  return sum / (count * 255);
}

// ─── Filter shapes for canvas ─────────────────────────────────────────────────

function lowpassShape(f: number, cutoff: number, rolloff: number): number {
  if (f <= cutoff) return 1;
  const sigma = Math.max(1, rolloff / 4);
  return Math.exp(-0.5 * ((f - cutoff) / sigma) ** 2);
}
function bandpassShape(f: number, center: number, band: number): number {
  const sigma = Math.max(1, band / 4);
  return Math.exp(-0.5 * ((f - center) / sigma) ** 2);
}
function highpassShape(f: number, cutoff: number, rolloff: number): number {
  if (f >= cutoff) return 1;
  const sigma = Math.max(1, rolloff / 4);
  return Math.exp(-0.5 * ((f - cutoff) / sigma) ** 2);
}

// ─── Types ────────────────────────────────────────────────────────────────────

type DragBand = 'bass' | 'mid' | 'high';
interface DragState { band: DragBand; startX: number; startY: number; startFreq: number; startBand: number }
interface DisplayData {
  ramps: number[]; triggers: boolean[];
  kick: number; snare: number; bass: number; mid: number; high: number;
  kickFlash: boolean; snareFlash: boolean;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function AudioAnalyserLive({ widget }: { widget: AudioAnalyserWidget }): React.JSX.Element {
  const widgetRef = useRef(widget);
  widgetRef.current = widget;

  // Audio refs
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const audioCtxRef  = useRef<AudioContext | null>(null);
  const analyserRef  = useRef<AnalyserNode | null>(null);
  const streamRef    = useRef<MediaStream | null>(null);
  const rafRef       = useRef<number>(0);
  const dataRef      = useRef<Uint8Array<ArrayBuffer>>(new Uint8Array(0) as Uint8Array<ArrayBuffer>);
  const prevEnergyRef = useRef({ kick: 0, snare: 0 });
  const cooldownRef   = useRef({ kick: 0, snare: 0 });
  const kickFlashExpiry  = useRef(0);
  const snareFlashExpiry = useRef(0);

  // Clock refs
  const accBeatsRef    = useRef(0);
  const lastNowRef     = useRef(0);
  const prevFloorRef   = useRef<number[]>(BEAT_DIVISORS.map(() => -1));
  const trigFlashRef   = useRef<number[]>(BEAT_DIVISORS.map(() => 0));

  // Drag ref
  const dragRef = useRef<DragState | null>(null);

  // Display state (~30fps updates)
  const [display, setDisplay] = useState<DisplayData>({
    ramps: BEAT_DIVISORS.map(() => 0), triggers: BEAT_DIVISORS.map(() => false),
    kick: 0, snare: 0, bass: 0, mid: 0, high: 0, kickFlash: false, snareFlash: false,
  });
  const [audioError, setAudioError] = useState<string | null>(null);
  const frameCountRef = useRef(0);

  // Track masterBpm via subscription (avoids re-render per tick)
  const masterBpmRef = useRef(useStore.getState().masterBpm);
  useEffect(() => useStore.subscribe((s) => { masterBpmRef.current = s.masterBpm; }), []);

  // Re-align clock on global reset/play
  const globalResetTick = useStore((s) => s.globalResetTick);
  const globalPlayTick  = useStore((s) => s.globalPlayTick);
  useEffect(() => {
    accBeatsRef.current = 0;
    prevFloorRef.current = BEAT_DIVISORS.map(() => -1);
    lastNowRef.current = performance.now();
  }, [globalResetTick, globalPlayTick]);

  // Canvas resize observer
  useEffect(() => {
    const obs = new ResizeObserver((entries) => {
      for (const e of entries) {
        const { width, height } = e.contentRect;
        if (canvasRef.current) {
          canvasRef.current.width  = Math.max(1, Math.round(width));
          canvasRef.current.height = Math.max(1, Math.round(height));
        }
      }
    });
    if (containerRef.current) obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  // Audio init — re-runs when audioDeviceId changes
  useEffect(() => {
    let cancelled = false;
    async function init() {
      try {
        const constraints: MediaStreamConstraints = {
          audio: widgetRef.current.audioDeviceId
            ? { deviceId: { exact: widgetRef.current.audioDeviceId } } : true,
        };
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        const ctx = new AudioContext();
        audioCtxRef.current = ctx;
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 2048;
        analyser.smoothingTimeConstant = 0.5;
        analyserRef.current = analyser;
        ctx.createMediaStreamSource(stream).connect(analyser);
        dataRef.current = new Uint8Array(analyser.frequencyBinCount) as Uint8Array<ArrayBuffer>;
        setAudioError(null);
      } catch (e) {
        if (!cancelled) setAudioError(String(e));
      }
    }
    init();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      audioCtxRef.current?.close();
      audioCtxRef.current = null;
      analyserRef.current = null;
    };
  }, [widget.audioDeviceId]);

  // Main RAF loop — clock + audio + canvas
  useEffect(() => {
    lastNowRef.current = performance.now();

    function tick(now: number) {
      rafRef.current = requestAnimationFrame(tick);
      const w = widgetRef.current;

      // ── Clock ────────────────────────────────────────────────────────────
      const dt = now - lastNowRef.current;
      lastNowRef.current = now;
      if (dt > 0 && dt < 300) accBeatsRef.current += dt * masterBpmRef.current / 60000;
      const acc = accBeatsRef.current;
      const newRamps    = BEAT_DIVISORS.map((D) => (acc / D) % 1);
      const newTriggers = trigFlashRef.current.map((exp) => now < exp);

      for (let i = 0; i < BEAT_DIVISORS.length; i++) {
        const D = BEAT_DIVISORS[i];
        const floor = Math.floor(acc / D);
        if (floor !== prevFloorRef.current[i]) {
          prevFloorRef.current[i] = floor;
          trigFlashRef.current[i] = now + 120;
          newTriggers[i] = true;
          useStore.getState().setCellValue(w.id, 5 + i, 1);
          const idx = i;
          setTimeout(() => {
            useStore.getState().setCellValue(widgetRef.current.id, 5 + idx, 0);
            const wo = widgetRef.current.beatOutputs?.[idx];
            if (wo?.triggerMapping) dispatchValue(wo.triggerMapping, 0);
          }, 50);
          const out = w.beatOutputs?.[i];
          if (out?.triggerMapping) dispatchValue(out.triggerMapping, 1);
        }
        const out = w.beatOutputs?.[i];
        if (out?.rampMapping) dispatchValue(out.rampMapping, newRamps[i]);
      }
      useStore.getState().setRampCells(w.id, 13, newRamps);

      // ── Audio ────────────────────────────────────────────────────────────
      let kick = 0, snare = 0, bass = 0, mid = 0, high = 0;

      const analyser = analyserRef.current;
      if (analyser && dataRef.current.length > 0) {
        analyser.getByteFrequencyData(dataRef.current);
        const sr = analyser.context.sampleRate;
        const data = dataRef.current;

        kick  = getBandEnergy(data, sr, w.kickFreq,  w.kickBand);
        snare = getBandEnergy(data, sr, w.snareFreq, w.snareBand);
        bass  = getLowpassEnergy(data,  sr, w.bassFreq);
        mid   = getBandEnergy(data, sr, w.midFreq,  w.midBand);
        high  = getHighpassEnergy(data, sr, w.highFreq);

        const prevKick  = prevEnergyRef.current.kick;
        const prevSnare = prevEnergyRef.current.snare;
        prevEnergyRef.current.kick  = kick;
        prevEnergyRef.current.snare = snare;

        if (kick > w.kickThreshold && (kick - prevKick) > 0.005 && now > cooldownRef.current.kick) {
          cooldownRef.current.kick = now + 80;
          kickFlashExpiry.current  = now + 150;
          useStore.getState().setCellValue(w.id, 0, 1);
          if (w.kickMapping) dispatchValue(w.kickMapping, 1);
          setTimeout(() => {
            useStore.getState().setCellValue(widgetRef.current.id, 0, 0);
            if (widgetRef.current.kickMapping) dispatchValue(widgetRef.current.kickMapping, 0);
          }, 50);
        }
        if (snare > w.snareThreshold && (snare - prevSnare) > 0.003 && now > cooldownRef.current.snare) {
          cooldownRef.current.snare = now + 60;
          snareFlashExpiry.current  = now + 150;
          useStore.getState().setCellValue(w.id, 1, 1);
          if (w.snareMapping) dispatchValue(w.snareMapping, 1);
          setTimeout(() => {
            useStore.getState().setCellValue(widgetRef.current.id, 1, 0);
            if (widgetRef.current.snareMapping) dispatchValue(widgetRef.current.snareMapping, 0);
          }, 50);
        }

        useStore.getState().setRampCells(w.id, 2, [bass, mid, high]);
        if (w.bassMapping) dispatchValue(w.bassMapping, bass);
        if (w.midMapping)  dispatchValue(w.midMapping,  mid);
        if (w.highMapping) dispatchValue(w.highMapping, high);

        drawSpectrum(canvasRef.current, data, sr, w);
      }

      // State update at ~30fps
      frameCountRef.current++;
      if (frameCountRef.current % 2 === 0) {
        setDisplay({
          ramps: newRamps, triggers: newTriggers,
          kick, snare, bass, mid, high,
          kickFlash:  now < kickFlashExpiry.current,
          snareFlash: now < snareFlashExpiry.current,
        });
      }
    }

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  // ── Canvas draw ───────────────────────────────────────────────────────────

  function drawSpectrum(
    canvas: HTMLCanvasElement | null,
    data: Uint8Array<ArrayBuffer>,
    sr: number,
    w: AudioAnalyserWidget,
  ) {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const W = canvas.width;
    const H = canvas.height;
    if (W < 2 || H < 2) return;

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, W, H);

    // FFT bars
    const binSize = (sr / 2) / data.length;
    ctx.fillStyle = '#2a2a2a';
    for (let b = 0; b < data.length; b++) {
      const freq = b * binSize;
      if (freq < FREQ_MIN || freq > FREQ_MAX) continue;
      const x = freqToX(freq, W);
      const nx = freqToX((b + 1) * binSize, W);
      const bH = (data[b] / 255) * H;
      ctx.fillRect(x, H - bH, Math.max(1, nx - x), bH);
    }

    const STEP = 1.5;

    // Bass (lowpass, blue)
    ctx.beginPath(); ctx.moveTo(0, H);
    for (let px = 0; px <= W; px += STEP) {
      const amp = lowpassShape(xToFreq(px, W), w.bassFreq, w.bassBand);
      ctx.lineTo(px, H - amp * H * 0.85);
    }
    ctx.lineTo(W, H); ctx.closePath();
    ctx.fillStyle = `rgba(${palRgb('#7ac4c9')},0.22)`;
    ctx.fill();

    // Mid (bandpass, green)
    ctx.beginPath(); ctx.moveTo(0, H);
    for (let px = 0; px <= W; px += STEP) {
      const amp = bandpassShape(xToFreq(px, W), w.midFreq, w.midBand);
      ctx.lineTo(px, H - amp * H * 0.85);
    }
    ctx.lineTo(W, H); ctx.closePath();
    ctx.fillStyle = `rgba(${palRgb('#56b3ba')},0.22)`;
    ctx.fill();

    // High (highpass, cyan)
    ctx.beginPath(); ctx.moveTo(W, H);
    for (let px = W; px >= 0; px -= STEP) {
      const amp = highpassShape(xToFreq(px, W), w.highFreq, w.highBand);
      ctx.lineTo(px, H - amp * H * 0.85);
    }
    ctx.lineTo(0, H); ctx.closePath();
    ctx.fillStyle = `rgba(${palRgb('#abd9dc')},0.22)`;
    ctx.fill();

    // Cutoff/center lines and labels
    const bassX = freqToX(w.bassFreq, W);
    const midX  = freqToX(w.midFreq,  W);
    const highX = freqToX(w.highFreq,  W);

    ctx.lineWidth = 1; ctx.setLineDash([2, 3]);
    ctx.strokeStyle = pal('#7ac4c9'); ctx.beginPath(); ctx.moveTo(bassX, 0); ctx.lineTo(bassX, H); ctx.stroke();
    ctx.strokeStyle = pal('#56b3ba'); ctx.beginPath(); ctx.moveTo(midX,  0); ctx.lineTo(midX,  H); ctx.stroke();
    ctx.strokeStyle = pal('#abd9dc'); ctx.beginPath(); ctx.moveTo(highX, 0); ctx.lineTo(highX, H); ctx.stroke();
    ctx.setLineDash([]);

    // Drag handles (small triangles at top)
    function handle(x: number, color: string) {
      ctx!.fillStyle = color;
      ctx!.beginPath();
      ctx!.moveTo(x, 7); ctx!.lineTo(x - 5, 0); ctx!.lineTo(x + 5, 0);
      ctx!.fill();
    }
    handle(bassX, pal('#7ac4c9')); handle(midX, pal('#56b3ba')); handle(highX, pal('#abd9dc'));

    // Labels
    ctx.font = '9px monospace';
    ctx.fillStyle = pal('#7ac4c9');
    ctx.fillText(`B ${w.bassFreq >= 1000 ? (w.bassFreq/1000).toFixed(1)+'k' : w.bassFreq+''}Hz`, Math.min(bassX + 3, W - 58), 18);
    ctx.fillStyle = pal('#56b3ba');
    const midLabelX = Math.min(Math.max(midX - 20, 2), W - 60);
    ctx.fillText(`M ${w.midFreq >= 1000 ? (w.midFreq/1000).toFixed(1)+'k' : w.midFreq+''}Hz`, midLabelX, 30);
    ctx.fillStyle = pal('#abd9dc');
    ctx.fillText(`H ${w.highFreq >= 1000 ? (w.highFreq/1000).toFixed(1)+'k' : w.highFreq+''}Hz`, Math.max(highX - 58, 2), 18);

    // Freq axis
    ctx.fillStyle = '#2a2a2a';
    for (const af of [100, 500, 1000, 5000, 10000]) {
      const ax = freqToX(af, W);
      ctx.fillStyle = '#2e2e2e';
      ctx.fillRect(ax, 0, 1, H);
      ctx.fillStyle = '#333';
      ctx.fillText(af >= 1000 ? `${af/1000}k` : `${af}`, ax - 5, H - 2);
    }
  }

  // ── Drag handlers ─────────────────────────────────────────────────────────

  function pickBand(x: number, W: number): DragBand {
    const w = widgetRef.current;
    const bX = freqToX(w.bassFreq, W);
    const mX = freqToX(w.midFreq,  W);
    const hX = freqToX(w.highFreq, W);
    const dB = Math.abs(x - bX), dM = Math.abs(x - mX), dH = Math.abs(x - hX);
    if (dB <= dM && dB <= dH) return 'bass';
    if (dH <= dB && dH <= dM) return 'high';
    return 'mid';
  }

  function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect  = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (canvas.width / rect.width);
    const w = widgetRef.current;
    const band = pickBand(x, canvas.width);
    dragRef.current = {
      band, startX: e.clientX, startY: e.clientY,
      startFreq: band === 'bass' ? w.bassFreq : band === 'mid' ? w.midFreq : w.highFreq,
      startBand: band === 'bass' ? w.bassBand : band === 'mid' ? w.midBand : w.highBand,
    };
    canvas.setPointerCapture(e.pointerId);
    e.preventDefault();
  }

  function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    const startX = freqToX(drag.startFreq, canvas.width);
    const newFreq = Math.max(20, Math.min(20000, xToFreq(Math.max(0, Math.min(canvas.width, startX + dx)), canvas.width)));
    const newBand = Math.max(10, Math.round(drag.startBand - dy * 5));
    const { activePageId } = useStore.getState();
    if (!activePageId) return;
    const w = widgetRef.current;
    if (drag.band === 'bass')      useStore.getState().updateWidget(activePageId, w.id, { bassFreq: newFreq, bassBand: newBand } as never);
    else if (drag.band === 'mid')  useStore.getState().updateWidget(activePageId, w.id, { midFreq: newFreq, midBand: newBand } as never);
    else                           useStore.getState().updateWidget(activePageId, w.id, { highFreq: newFreq, highBand: newBand } as never);
  }

  function handlePointerUp() { dragRef.current = null; }

  function updateThreshold(key: 'kickThreshold' | 'snareThreshold', v: number) {
    const { activePageId } = useStore.getState();
    if (!activePageId) return;
    useStore.getState().updateWidget(activePageId, widgetRef.current.id, { [key]: v } as never);
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const bg = widget.style.backgroundColor || '#060608';
  const borderB: React.CSSProperties = { borderBottom: '1px solid #1a1a1a' };
  // Same base size the Router uses, with everything below derived from it. The
  // readouts used to be near-black on near-black at 8px: those numbers are the
  // point of the widget and could not be read from more than a foot away.
  const fs = widget.style.fontSize || 13;
  const hdr: React.CSSProperties = { fontSize: Math.max(9, fs - 4), color: '#5a5a5a',
    letterSpacing: 1, flexShrink: 0, marginBottom: 3 };
  const readout: React.CSSProperties = { fontSize: fs - 1, color: '#b0b0b0',
    width: fs * 2.8, textAlign: 'right', flexShrink: 0, fontVariantNumeric: 'tabular-nums' };

  return (
    <div className="lf-scroll" style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
      boxSizing: 'border-box', overflowY: 'auto', overflowX: 'hidden', background: bg, fontSize: fs, color: '#ccc' }}>

      {/* ── SECTION 1: RAMPS ─────────────────────────────── */}
      <div style={{ flexShrink: 0, ...borderB,
        padding: '4px 8px', display: 'flex', flexDirection: 'column' }}>
        <div style={hdr}>RAMPS</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {BEAT_DIVISORS.map((D, i) => (
            <div key={D} style={{ display: 'flex', alignItems: 'center', gap: 6, height: fs + 6 }}>
              <span style={{ width: 9, height: 9, borderRadius: '50%', flexShrink: 0,
                background: display.triggers[i] ? '#fff' : '#1a1a1a', transition: 'none' }} />
              <span style={{ fontSize: fs - 1, color: display.triggers[i] ? '#eee' : '#8a8a8a',
                width: fs * 3.6, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis',
                whiteSpace: 'nowrap', textAlign: 'right' }}>
                {widget.beatOutputs?.[i]?.name || `×${D}`}
              </span>
              <div style={{ flex: 1, height: 9, minHeight: 9, background: '#1a1a1a', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{ width: `${display.ramps[i] * 100}%`, height: '100%',
                  background: display.triggers[i] ? '#fff' : '#4c4c4c', borderRadius: 2, transition: 'none' }} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── SECTION 2: ONSET + LEVELS ────────────────────── */}
      <div style={{ flexShrink: 0, ...borderB,
        padding: '4px 8px', display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={hdr}>ONSET</div>

        {/* Kick row + threshold slider */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 12, height: 12, borderRadius: '50%', flexShrink: 0,
            background: display.kickFlash ? pal('#ff9b44') : '#1e1e1e', transition: 'none' }} />
          <span style={{ fontSize: fs, color: pal('#ff9b44'), width: fs, flexShrink: 0, fontWeight: 700 }}>K</span>
          <div style={{ flex: 1, height: 11, background: '#1a1a1a', borderRadius: 3, overflow: 'visible', position: 'relative' }}>
            <div style={{ width: `${Math.min(1, display.kick) * 100}%`, height: '100%',
              background: display.kick > widget.kickThreshold ? pal('#ff9b44') : '#333', borderRadius: 2, transition: 'none' }} />
            <div style={{ position: 'absolute', top: -2, left: `${widget.kickThreshold * 100}%`, width: 2, height: 15,
              background: pal('#ff9b44'), opacity: 0.85 }} />
          </div>
          <span style={readout}>{display.kick.toFixed(2)}</span>
        </div>
        <input className="lf-fat-range" type="range" min="0" max="1" step="0.001"
          title="K threshold"
          value={widget.kickThreshold}
          onChange={(e) => updateThreshold('kickThreshold', Number(e.target.value))}
          style={{ color: pal('#ff9b44'), flexShrink: 0 }} />

        {/* Snare row + threshold slider */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 12, height: 12, borderRadius: '50%', flexShrink: 0,
            background: display.snareFlash ? pal('#ff7700') : '#1e1e1e', transition: 'none' }} />
          <span style={{ fontSize: fs, color: pal('#ff7700'), width: fs, flexShrink: 0, fontWeight: 700 }}>S</span>
          <div style={{ flex: 1, height: 11, background: '#1a1a1a', borderRadius: 3, overflow: 'visible', position: 'relative' }}>
            <div style={{ width: `${Math.min(1, display.snare) * 100}%`, height: '100%',
              background: display.snare > widget.snareThreshold ? pal('#ff7700') : '#333', borderRadius: 2, transition: 'none' }} />
            <div style={{ position: 'absolute', top: -2, left: `${widget.snareThreshold * 100}%`, width: 2, height: 15,
              background: pal('#ff7700'), opacity: 0.85 }} />
          </div>
          <span style={readout}>{display.snare.toFixed(2)}</span>
        </div>
        <input className="lf-fat-range" type="range" min="0" max="1" step="0.001"
          title="S threshold"
          value={widget.snareThreshold}
          onChange={(e) => updateThreshold('snareThreshold', Number(e.target.value))}
          style={{ color: pal('#ff7700'), flexShrink: 0 }} />

        {/* Levels */}
        <div style={{ ...hdr, marginTop: 2 }}>LEVELS</div>
        {([
          { label: 'B', color: pal('#7ac4c9'), val: display.bass },
          { label: 'M', color: pal('#56b3ba'), val: display.mid  },
          { label: 'H', color: pal('#abd9dc'), val: display.high },
        ]).map(({ label, color, val }) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: fs, color, width: fs, flexShrink: 0, fontWeight: 700 }}>{label}</span>
            <div style={{ flex: 1, height: 11, background: '#1a1a1a', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ width: `${Math.min(1, val) * 100}%`, height: '100%', background: color, borderRadius: 2, transition: 'none' }} />
            </div>
            <span style={readout}>{val.toFixed(2)}</span>
          </div>
        ))}
      </div>

      {/* ── SECTION 3: SPECTRUM ──────────────────────────── */}
      <div ref={containerRef} style={{ flex: '1 0 90px', minHeight: 90, position: 'relative', overflow: 'hidden' }}>
        {audioError && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: fs - 1, color: '#888', padding: 8, textAlign: 'center', zIndex: 1 }}>
            {audioError}
          </div>
        )}
        <canvas
          ref={canvasRef}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', cursor: 'crosshair', touchAction: 'none' }}
          width={400} height={100}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        />
      </div>
    </div>
  );
}
