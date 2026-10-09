import { pal } from '../../palette';
import React, { useEffect, useRef, useState } from 'react';
import type { AudioLevelWidget, LtcAudioConnection } from '../../../shared/types/project';
import { useStore, useWidgetRuntime } from '../../store';
import { clamp } from '../utils';
import CellLinkMenu from '../base/CellLinkMenu';
import { useSlavedCells, SLAVE_OUTLINE } from '../base/useSlavedCells';

const DB_FLOOR = -60;
export const levelToDb = (v: number): number => (v <= 0 ? -Infinity : DB_FLOOR * (1 - v));
const fmtDb = (v: number): string => (v <= 0.001 ? '−∞ dB' : `${levelToDb(v).toFixed(1)} dB`);

// OUT: master fader for all audio LiveForge plays (Sound Player, timeline).
// IN:  meter of the audio input; its level (−60…0 dB as 0…1) is cell 0, a
//      source to link anywhere — a light that breathes with the room.
export default function AudioLevelLive({ widget }: { widget: AudioLevelWidget }): React.JSX.Element {
  return widget.mode === 'in' ? <InputMeter widget={widget} /> : <OutputFader widget={widget} />;
}

function useLinkMenu() {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [menu]);
  return [menu, setMenu] as const;
}

function Frame({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', padding: 8, boxSizing: 'border-box', gap: 6, fontFamily: 'monospace' }}>
      <div style={{ flexShrink: 0, textAlign: 'center', fontWeight: 700, letterSpacing: 2, fontSize: 10, color: '#8a8a8a', textTransform: 'uppercase' }}>{title}</div>
      {children}
    </div>
  );
}

function OutputFader({ widget }: { widget: AudioLevelWidget }): React.JSX.Element {
  const runtime = useWidgetRuntime(widget.id);
  const value = runtime?.cells[0]?.value ?? 1;
  const color = widget.style.foregroundColor;
  const vertical = (widget.orientation ?? 'vertical') === 'vertical';
  const isSlave = useSlavedCells(widget.id).has(0);
  const [menu, setMenu] = useLinkMenu();
  const setFrom = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const v = vertical ? clamp(1 - (e.clientY - r.top) / r.height, 0, 1) : clamp((e.clientX - r.left) / r.width, 0, 1);
    useStore.getState().setCellValue(widget.id, 0, v);
  };
  return (
    <Frame title="audio out">
      <div data-lf-widget={widget.id} data-lf-cell={0}
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); setFrom(e); }}
        onPointerMove={(e) => { if (e.currentTarget.hasPointerCapture(e.pointerId)) setFrom(e); }}
        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setMenu({ x: e.clientX, y: e.clientY }); }}
        style={{
          flex: 1, position: 'relative', minHeight: 0, background: 'rgba(0,0,0,0.4)', borderRadius: 4, overflow: 'hidden',
          touchAction: 'none', cursor: 'pointer', outline: isSlave ? SLAVE_OUTLINE : undefined, outlineOffset: -1,
        }}>
        <div style={{
          position: 'absolute', background: color, opacity: 0.55,
          ...(vertical ? { bottom: 0, left: 0, right: 0, height: `${value * 100}%` } : { left: 0, top: 0, bottom: 0, width: `${value * 100}%` }),
        }} />
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, fontWeight: 700, color: '#fff', fontVariantNumeric: 'tabular-nums', pointerEvents: 'none' }}>
          {Math.round(value * 100)}%
        </div>
      </div>
      {menu && <CellLinkMenu x={menu.x} y={menu.y} widgetId={widget.id} cellIndex={0} onClose={() => setMenu(null)} />}
    </Frame>
  );
}

function InputMeter({ widget }: { widget: AudioLevelWidget }): React.JSX.Element {
  const conns = useStore((s) => s.project.connections);
  const settingsDevice = (conns.find((c) => c.type === 'ltcAudio') as LtcAudioConnection | undefined)?.deviceId ?? '';
  const deviceId = widget.deviceId || settingsDevice;
  const [level, setLevel] = useState(0);
  const [peak, setPeak] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [menu, setMenu] = useLinkMenu();
  const vertical = (widget.orientation ?? 'vertical') === 'vertical';
  const color = widget.style.foregroundColor;
  const lastSent = useRef(-1);

  useEffect(() => {
    let stop = false;
    let raf = 0;
    let ctx: AudioContext | null = null;
    let stream: MediaStream | null = null;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { ...(deviceId ? { deviceId: { exact: deviceId } } : {}), echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        });
        if (stop) { stream.getTracks().forEach((t) => t.stop()); return; }
        ctx = new AudioContext();
        const an = ctx.createAnalyser();
        an.fftSize = 2048;
        ctx.createMediaStreamSource(stream).connect(an);
        const buf = new Float32Array(an.fftSize);
        let smooth = 0, pk = 0, pkAt = 0;
        const tick = () => {
          an.getFloatTimeDomainData(buf);
          let sum = 0;
          for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
          const rms = Math.sqrt(sum / buf.length);
          const db = rms > 0 ? 20 * Math.log10(rms) : -Infinity;
          const v = clamp((db - DB_FLOOR) / -DB_FLOOR, 0, 1);
          // Fast up, slower down — reads like a VU, drives lights without flicker.
          smooth = v > smooth ? v : smooth * 0.9 + v * 0.1;
          const now = performance.now();
          if (smooth >= pk || now - pkAt > 1500) { pk = smooth; pkAt = now; }
          setLevel(smooth); setPeak(pk);
          if (Math.abs(smooth - lastSent.current) > 0.004) {
            lastSent.current = smooth;
            useStore.getState().setCellValue(widget.id, 0, smooth);
          }
          raf = requestAnimationFrame(tick);
        };
        setError(null);
        tick();
      } catch (e) {
        setError((e as Error).message || 'no audio input');
      }
    })();
    return () => {
      stop = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
      void ctx?.close();
    };
  }, [deviceId, widget.id]);

  return (
    <Frame title="audio in">
      <div data-lf-widget={widget.id} data-lf-cell={0}
        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setMenu({ x: e.clientX, y: e.clientY }); }}
        title="Input level — right-click: link it anywhere"
        style={{ flex: 1, position: 'relative', minHeight: 0, background: 'rgba(0,0,0,0.4)', borderRadius: 4, overflow: 'hidden' }}>
        <div style={{
          position: 'absolute',
          background: `linear-gradient(${vertical ? 'to top' : 'to right'}, ${color} 0%, ${color} 70%, ${pal('#e08230')} 85%, ${pal('#e07f2b')} 100%)`,
          ...(vertical
            ? { bottom: 0, left: 0, right: 0, height: '100%', clipPath: `inset(${(1 - level) * 100}% 0 0 0)` }
            : { left: 0, top: 0, bottom: 0, width: '100%', clipPath: `inset(0 ${(1 - level) * 100}% 0 0)` }),
        }} />
        <div style={{
          position: 'absolute', background: '#fff',
          ...(vertical ? { left: 0, right: 0, height: 2, bottom: `calc(${peak * 100}% - 1px)` } : { top: 0, bottom: 0, width: 2, left: `calc(${peak * 100}% - 1px)` }),
        }} />
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: '#fff', fontVariantNumeric: 'tabular-nums', textShadow: '0 0 3px #000', pointerEvents: 'none', textAlign: 'center', padding: 4 }}>
          {error ? <span style={{ color: pal('#e39d60'), fontSize: 10 }}>{error}</span> : fmtDb(level)}
        </div>
      </div>
      {menu && <CellLinkMenu x={menu.x} y={menu.y} widgetId={widget.id} cellIndex={0} onClose={() => setMenu(null)} />}
    </Frame>
  );
}
