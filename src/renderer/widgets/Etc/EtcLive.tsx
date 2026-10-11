import React, { useEffect, useRef, useState } from 'react';
import type { EtcWidget } from '../../../shared/types/project';
import { useStore, useWidgetRuntime } from '../../store';
import { bridge } from '../../ipc/bridge';
import { pal, palRgb } from '../../palette';
import { ETC_KEYS, ETC_W, ETC_H, ETC_FADERS, ETC_FADER_H, ETC_GM, ETC_ENCODERS, ETC_LEVEL_WHEEL, type EtcKey } from './etcLayout';
import { useJog } from '../base/useJog';
import { useCellEdge } from '../base/useCellEdge';
import { eosAddress } from '../base/eosUser';
import { startEosWheels, onEosWheels, wheelsOf, allWheels, wheelGainOf, eosWheelsKnown, CATEGORY_OF_KEY, type EosWheel } from './eosWheels';

const CATEGORY_NAME: Record<number, string> = { 1: 'Intensity', 2: 'Focus', 3: 'Color', 4: 'Image', 5: 'Form', 6: 'Shutter' };

// An Eos Gio @5 surface. The layout is drawn at its own size (ETC_W × ETC_H)
// and scaled to fit the widget, so it keeps the desk's proportions.

export function keyAddress(w: EtcWidget, k: EtcKey): string {
  const name = w.keyOverrides?.[k.id] ?? k.id;
  return name.startsWith('/') ? name : `${w.keyPrefix.replace(/\/$/, '')}/${name}`;
}

function send(w: EtcWidget, address: string, value: number, int = false): void {
  if (!address) return;
  bridge.send('tr:osc:send', { address: eosAddress(address, w.user), args: [{ type: int ? 'i' : 'f', value }], outputId: w.outputId || undefined });
}

export default function EtcLive({ widget, preview }: { widget: EtcWidget; preview?: boolean }): React.JSX.Element {
  const boxRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: ETC_W, h: ETC_H });
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth || 1, h: el.clientHeight || 1 }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const scale = Math.min(size.w / ETC_W, size.h / ETC_H);
  // Encoder paging, like the desk: a category key shows its first four
  // wheels, pressed again the next four. Needs Eos OSC TX (wheel list).
  const [cat, setCat] = useState<{ category: number; page: number } | null>(null);
  const [, setTick] = useState(0);
  useEffect(() => { startEosWheels(); return onEosWheels(() => setTick((t) => t + 1)); }, []);
  const known = eosWheelsKnown();
  const list: EosWheel[] = cat ? wheelsOf(cat.category) : [];
  const pages = Math.max(1, Math.ceil(list.length / 4));
  const page = cat ? cat.page % pages : 0;
  // The pressed category key glows orange while you are on the encoders; any
  // other key, or Eos changing its wheel list (another channel selected, a page
  // change on the desk), puts it back to green. The encoders keep the category.
  const [lit, setLit] = useState(false);
  const onKey = (id: string) => {
    const c = CATEGORY_OF_KEY[id];
    if (c === undefined) { setLit(false); return; }
    setLit(true);
    setCat((prev) => (prev && prev.category === c ? { category: c, page: prev.page + 1 } : { category: c, page: 0 }));
  };
  // Names only ("Pan [ 12.5 ]" → "Pan"): turning an encoder changes the values,
  // not the list, and must not clear the highlight.
  const wheelSig = allWheels().map((w) => `${w.index}:${w.label.replace(/\s*\[.*$/, '')}`).join('|');
  const sigRef = useRef(wheelSig);
  useEffect(() => { if (sigRef.current !== wheelSig) { sigRef.current = wheelSig; setLit(false); } }, [wheelSig]);
  // Encoder k → the Eos wheel index it moves (null = nothing on this page).
  const target = (k: number): { index: number; label?: string } | null => {
    if (!known || !cat) return { index: k };            // no list from Eos: plain 1…4
    const wh = list[page * 4 + k - 1];
    return wh ? { index: wh.index, label: wh.label } : null;
  };
  // GO / STOP driven from outside: a rising edge presses the key (1 then 0),
  // exactly like a finger on it.
  const fireKey = (id: string) => {
    const k = ETC_KEYS.find((x) => x.id === id);
    if (!k) return;
    const addr = keyAddress(widget, k);
    send(widget, addr, 1);
    setTimeout(() => send(wRef.current, addr, 0), 120);
    setFired(id); setTimeout(() => setFired((f) => (f === id ? null : f)), 220);
  };
  const wRef = useRef(widget); wRef.current = widget;
  const [fired, setFired] = useState<string | null>(null);
  useCellEdge(widget.id, 3, () => fireKey('go_0'));
  useCellEdge(widget.id, 4, () => fireKey('stop'));

  const accent = pal('#4fb3b8');
  const orange = pal('#ff8a1f');

  return (
    <div ref={boxRef} style={{ width: '100%', height: '100%', overflow: 'hidden', position: 'relative', background: '#0b0b0b', pointerEvents: preview ? 'none' : undefined }}>
      <div style={{ position: 'absolute', left: (size.w - ETC_W * scale) / 2, top: (size.h - ETC_H * scale) / 2, width: ETC_W, height: ETC_H, transform: `scale(${scale})`, transformOrigin: '0 0', fontFamily: 'inherit' }}>
        {ETC_ENCODERS.map((e) => <EtcEncoder key={e.n} w={widget} target={target(e.n)} cx={e.cx} cy={e.cy} r={e.r} color={accent} />)}
        {cat && known && (
          <div style={{ position: 'absolute', left: ETC_ENCODERS[0].cx - 62 - 120, top: ETC_ENCODERS[0].cy - 24, width: 100, textAlign: 'right', fontSize: 14, color: '#999' }}>
            <div style={{ fontSize: 12, color: lit ? orange : '#7fd18f', marginBottom: 2 }}>{CATEGORY_NAME[cat.category] ?? ''}</div>
            page {page + 1} / {pages}
          </div>
        )}
        {!known && (
          <div style={{ position: 'absolute', left: ETC_ENCODERS[0].cx - 62 - 200, top: ETC_ENCODERS[0].cy - 20, width: 180, textAlign: 'right', fontSize: 10, color: '#666', lineHeight: 1.4 }}>
            no wheel list from Eos — turn on OSC TX to this PC for paging
          </div>
        )}
        <EtcLevelWheel w={widget} color={accent} />
        {ETC_FADERS.map((f, i) => <EtcFader key={f.id} w={widget} index={i} x={f.x} y={f.y} h={ETC_FADER_H} color={orange} />)}
        <EtcFader w={widget} index={2} x={ETC_GM.x} y={ETC_GM.y} h={ETC_FADER_H} color={orange} label="GM" />
        {ETC_KEYS.map((k) => <EtcButton key={k.id} w={widget} k={k} accent={accent} orange={orange} onPress={onKey}
          lit={(lit && !!cat && CATEGORY_OF_KEY[k.id] === cat.category) || fired === k.id} />)}
      </div>
    </div>
  );
}

// GO and STOP are inputs too (cells 3 and 4): a cue, a clock row or the Router
// can press them. The dot shows on the key itself.
export const ETC_CELL_OF_KEY: Record<string, number> = { go_0: 3, stop: 4 };

function EtcButton({ w, k, accent, orange, onPress, lit }: { w: EtcWidget; k: EtcKey; accent: string; orange: string; onPress: (id: string) => void; lit: boolean }): React.JSX.Element {
  const [down, setDown] = useState(false);
  const addr = keyAddress(w, k);
  const name = w.keyOverrides?.[k.id] ?? k.id;
  const unsure = k.guess && !(w.keyOverrides && k.id in w.keyOverrides);
  const press = (on: boolean) => { setDown(on); send(w, addr, on ? 1 : 0); if (on) onPress(k.id); };
  return (
    <button
      data-lf-widget={ETC_CELL_OF_KEY[k.id] !== undefined ? w.id : undefined}
      data-lf-cell={ETC_CELL_OF_KEY[k.id]}
      title={`${addr}${unsure ? '  — name not confirmed, check it in Settings' : ''}`}
      onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); press(true); }}
      onPointerUp={() => { if (down) press(false); }}
      onPointerCancel={() => { if (down) press(false); }}
      style={{
        position: 'absolute', left: k.x, top: k.y, width: k.w, height: k.h, padding: '2px 3px', boxSizing: 'border-box',
        borderRadius: k.small ? 3 : 5, cursor: 'pointer', fontFamily: 'inherit', lineHeight: 1.1,
        background: down ? accent : k.small ? '#1d1d1d' : '#141414',
        color: down ? '#000' : '#ddd',
        border: `1px ${unsure ? 'dashed' : 'solid'} ${down ? accent : k.cat ? (lit ? orange : accent) : k.mark ? orange : lit ? accent : unsure ? '#555' : '#2c2c2c'}`,
        boxShadow: down ? `0 0 10px ${accent}` : 'inset 0 -2px 0 rgba(0,0,0,0.6)',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', touchAction: 'none',
      }}>
      <span style={{ fontSize: k.small ? 10 : k.label.length > 9 ? 11 : 13, fontWeight: 600, textAlign: 'center' }}>{k.label}</span>
      {!k.small && !w.hideOsc && (
        <span style={{ position: 'absolute', right: 3, bottom: 1, fontSize: 7, color: down ? '#000' : orange, opacity: 0.75, maxWidth: '95%', overflow: 'hidden', whiteSpace: 'nowrap' }}>
          {name.startsWith('/') ? name : `/${name}`}
        </span>
      )}
    </button>
  );
}

// Master fader: a level, sent as it moves. Its value is cell `index`, so a
// MIDI fader, the Router or a cue can drive it too.
// Eos listens to an OSC fader bank only after it has been told which page and
// how many faders that bank shows — so the config goes out before the level,
// and again after a pause (an Eos restarted meanwhile picks it up).
const configured = new Map<string, number>();
// The Grandmaster is a normal Eos fader: /eos/fader/<page>/<fader>, written as
// the desk shows it (10/10). Eos wants the bank told which page it is and how
// many faders it holds before it listens, so that goes out first, by itself.
export const GM_DEFAULT = '/eos/fader/10/10';
export function gmAddresses(w: EtcWidget): { config: string; level: string } {
  const level = (w.gmAddress?.trim() || GM_DEFAULT);
  const m = /^\/eos\/fader\/([1-9]\d*)\/([1-9]\d*)$/.exec(level);
  return { config: m ? `/eos/fader/${m[1]}/config/${m[1]}/${m[2]}` : '', level };
}

/** Move the Grandmaster from outside (the Test buttons in Settings). */
export function sendGm(w: EtcWidget, value: number): void {
  send(w, gmAddresses(w).level, value);
}

function faderAddress(w: EtcWidget, index: number): string {
  if (index === 2) return gmAddresses(w).level;
  return w.faderAddresses?.[index] ?? '';
}

/** Send a bank's config at most once every few seconds. */
export function sendFaderConfig(w: EtcWidget, msg: string): void {
  if (!msg) return;
  const key = `${w.outputId ?? ''}|${msg}`;
  const now = Date.now();
  const last = configured.get(key) ?? 0;
  if (now - last < 3000) return;
  configured.set(key, now);
  bridge.send('tr:osc:send', { address: eosAddress(msg, w.user), args: [], outputId: w.outputId || undefined });
}

function configureFader(w: EtcWidget, address: string, index: number): void {
  if (index === 2) { sendFaderConfig(w, gmAddresses(w).config); return; }
  // Bank 0 is Eos's own master pair: it needs no config (and must not get one).
  const m = /^\/eos\/fader\/([1-9]\d*)\/(\d+)$/.exec(address);
  if (m) sendFaderConfig(w, `/eos/fader/${m[1]}/config/1/10`);
}

function EtcFader({ w, index, x, y, h, color, label }: { w: EtcWidget; index: number; x: number; y: number; h: number; color: string; label?: string }): React.JSX.Element {
  const rt = useWidgetRuntime(w.id);
  const value = rt?.cells[index]?.value ?? 1;
  // Starts at what is shown, so opening the project never pushes the desk's
  // masters: only a real move (here, or from a link) is sent.
  const lastSent = useRef<number | null>(value);
  useEffect(() => {
    if (lastSent.current === value) return;
    lastSent.current = value;
    const addr = faderAddress(w, index);
    configureFader(w, addr, index);
    send(w, addr, value);
  }, [value]);
  const setFrom = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    useStore.getState().setCellValue(w.id, index, Math.max(0, Math.min(1, 1 - (e.clientY - r.top) / r.height)));
  };
  return (
    <div style={{ position: 'absolute', left: x, top: y, width: 40, height: h + 26, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div style={{ fontSize: 12, color: '#ccc', height: 20, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{Math.round(value * 100)}%</div>
      <div data-lf-widget={w.id} data-lf-cell={index}
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); setFrom(e); }}
        onPointerMove={(e) => { if (e.currentTarget.hasPointerCapture(e.pointerId)) setFrom(e); }}
        style={{ position: 'relative', width: 40, height: h, cursor: 'ns-resize', touchAction: 'none' }}>
        <div style={{ position: 'absolute', left: 18, top: 0, bottom: 0, width: 4, background: '#2a2a2a', borderRadius: 2 }} />
        <div style={{ position: 'absolute', left: 18, bottom: 0, height: `${value * 100}%`, width: 4, background: color, borderRadius: 2 }} />
        <div style={{ position: 'absolute', left: 4, width: 32, height: 22, top: `calc(${(1 - value) * 100}% - 11px)`, background: '#2b2b2b', border: `1px solid ${color}`, borderRadius: 3 }} />
      </div>
      {label && <div style={{ fontSize: 12, fontWeight: 700, color, marginTop: 4 }}>{label}</div>}
    </div>
  );
}

// An arc of the knob: radius, from and to in degrees (−90 = top, 90 = bottom).
function ARC(R: number, d0: number, d1: number): string {
  const a0 = (d0 * Math.PI) / 180, a1 = (d1 * Math.PI) / 180;
  const large = Math.abs(d1 - d0) > 180 ? 1 : 0;
  return `M ${60 + R * Math.cos(a0)} ${60 + R * Math.sin(a0)} A ${R} ${R} 0 ${large} 1 ${60 + R * Math.cos(a1)} ${60 + R * Math.sin(a1)}`;
}

// Encoder: relative ticks on /eos/active/wheel/fine/<n> — what it moves depends
// on the category key pressed and is shown on the Eos screen, so no names here.
function EtcEncoder({ w, target, cx, cy, r, color }: { w: EtcWidget; target: { index: number; label?: string } | null; cx: number; cy: number; r: number; color: string }): React.JSX.Element {
  const wRef = useRef(w); wRef.current = w;
  const tRef = useRef(target); tRef.current = target;
  const [angle, setAngle] = useState(0);
  const frac = useRef(0), pending = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const last = useRef<{ x: number; y: number; t: number } | null>(null);
  const flush = () => {
    timer.current = null;
    const t = pending.current; pending.current = 0;
    if (!t) return;
    const ww = wRef.current;
    const tg = tRef.current;
    if (!tg) return;
    send(ww, (ww.encoderAddress || '/eos/active/wheel/fine/{n}').replace('{n}', String(tg.index)), t);
    setAngle((a) => a + (t / (ww.ticksPerTurn || 64)) * 360);
  };
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const add = (ticks: number) => {
    frac.current += ticks * wheelGainOf(wRef.current.wheelGain, tRef.current?.label);
    const whole = Math.trunc(frac.current);
    if (!whole) return;
    frac.current -= whole; pending.current += whole;
    if (!timer.current) timer.current = setTimeout(flush, 25);
  };
  const jog = useJog((px, ev) => {
    const accel = 1 + (wRef.current.acceleration || 0) * Math.min(6, (Math.abs(px) / ev.dt) * 2);
    add((px / 240) * (wRef.current.ticksPerTurn || 64) * accel * (ev.ctrlKey ? 0.25 : 1));
  }, (t) => add(t));
  void last;
  return (
    <div
      title="Drag up/right = +, down/left = − · hold still = keeps turning (upper/right half +, lower/left −; slide to speed up) · wheel · Ctrl = fine"
      {...jog.handlers}
      onWheel={(e) => add((e.deltaY < 0 ? 1 : -1) * (e.ctrlKey ? 0.25 : 1))}
      style={{ position: 'absolute', left: cx - r, top: cy - r, width: 2 * r, height: 2 * r, borderRadius: '50%', cursor: 'ns-resize', touchAction: 'none',
        filter: jog.jogging ? `drop-shadow(0 0 10px ${color})` : undefined }}>
      <svg viewBox="0 0 120 120" width={2 * r} height={2 * r}>
        <defs>
          {/* A black glass sphere lit from straight above: the body is almost
              black, and the shape is read from the light that runs along the
              top edge and bounces back along the bottom one. */}
          <radialGradient id="etcBall" cx="50%" cy="26%" r="78%">
            <stop offset="0" stopColor="#262626" /><stop offset="0.34" stopColor="#101010" />
            <stop offset="0.72" stopColor="#040404" /><stop offset="1" stopColor="#000000" />
          </radialGradient>
          <linearGradient id="etcShade" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#000000" stopOpacity="0" />
            <stop offset="0.62" stopColor="#000000" stopOpacity="0.35" />
            <stop offset="1" stopColor="#000000" stopOpacity="0.75" />
          </linearGradient>
          {/* Strongest in the middle, gone at the sides — a rim, not a blob. */}
          <linearGradient id="etcEdge" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#ffffff" stopOpacity="0" />
            <stop offset="0.28" stopColor="#ffffff" stopOpacity="0.7" />
            <stop offset="0.5" stopColor="#ffffff" stopOpacity="1" />
            <stop offset="0.72" stopColor="#ffffff" stopOpacity="0.7" />
            <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="etcWall" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#000000" /><stop offset="0.5" stopColor="#050505" /><stop offset="1" stopColor="#262626" />
          </linearGradient>
          <radialGradient id="etcDome" cx="50%" cy="24%" r="80%">
            <stop offset="0" stopColor="#4a4a4a" /><stop offset="0.45" stopColor="#0c0c0c" /><stop offset="1" stopColor="#000000" />
          </radialGradient>
          <filter id="etcSoft" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="2.2" />
          </filter>
          <filter id="etcSoft2" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="1.1" />
          </filter>
        </defs>

        {/* The ball */}
        <circle cx={60} cy={60} r={56} fill="url(#etcBall)" />
        <circle cx={60} cy={60} r={56} fill="url(#etcShade)" />

        {/* The three holes, carved in — they turn with the encoder. */}
        <g transform={`rotate(${angle} 60 60)`}>
          {[0, 1, 2].map((i) => {
            const a0 = (-90 - 37 + i * 120) * Math.PI / 180, a1 = (-90 + 37 + i * 120) * Math.PI / 180, R = 32;
            const arc = (dy: number) =>
              `M ${60 + R * Math.cos(a0)} ${60 + dy + R * Math.sin(a0)} A ${R} ${R} 0 0 1 ${60 + R * Math.cos(a1)} ${60 + dy + R * Math.sin(a1)}`;
            return (
              <g key={i}>
                {/* the surface bending down into the hole */}
                <path d={arc(-1)} fill="none" stroke="#ffffff" strokeOpacity={0.16} strokeWidth={23} strokeLinecap="round" />
                {/* the opening, then the lit far wall at its bottom */}
                <path d={arc(0)} fill="none" stroke="#000000" strokeWidth={22} strokeLinecap="round" />
                <path d={arc(0.9)} fill="none" stroke="url(#etcWall)" strokeWidth={18} strokeLinecap="round" />
                <path d={arc(2.4)} fill="none" stroke="#ffffff" strokeOpacity={0.3} strokeWidth={1} strokeLinecap="round" />
              </g>
            );
          })}
          <circle cx={60} cy={11} r={2} fill={color} />
        </g>

        {/* Glass over the holes: the light along the top edge, the bounce along
            the bottom one, and one soft band following the top curve. */}
        <g style={{ pointerEvents: 'none' }}>
          <path d={ARC(47, -168, -12)} fill="none" stroke="url(#etcEdge)" strokeOpacity={0.14} strokeWidth={8} strokeLinecap="round" filter="url(#etcSoft)" />
          <path d={ARC(54.6, -172, -8)} fill="none" stroke="url(#etcEdge)" strokeWidth={1.8} strokeLinecap="round" />
          <path d={ARC(54.2, -168, -12)} fill="none" stroke="url(#etcEdge)" strokeOpacity={0.3} strokeWidth={4} strokeLinecap="round" filter="url(#etcSoft2)" />
          <path d={ARC(53.6, 22, 158)} fill="none" stroke="url(#etcEdge)" strokeOpacity={0.7} strokeWidth={2.6} strokeLinecap="round" filter="url(#etcSoft2)" />
          <path d={ARC(50, 40, 140)} fill="none" stroke="url(#etcEdge)" strokeOpacity={0.22} strokeWidth={6} strokeLinecap="round" filter="url(#etcSoft)" />
        </g>

        {/* Centre dome, with the accent ring. */}
        <circle cx={60} cy={60} r={15.5} fill="#000" />
        <circle cx={60} cy={60} r={14} fill="url(#etcDome)" />
        <path d={ARC(13.6, -150, -30)} fill="none" stroke="url(#etcEdge)" strokeWidth={1.6} strokeLinecap="round" />
        <path d={ARC(13.2, 40, 140)} fill="none" stroke="url(#etcEdge)" strokeOpacity={0.5} strokeWidth={1.4} strokeLinecap="round" />
        <circle cx={60} cy={60} r={7.4} fill="none" stroke={color} strokeWidth={2.6} />
        <circle cx={60} cy={60} r={7.4} fill="none" stroke={color} strokeWidth={5} opacity={0.16} />
      </svg>
      {target?.label && (
        <div style={{ position: 'absolute', top: 2 * r + 2, left: -20, right: -20, textAlign: 'center', fontSize: 11, color: '#bbb', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{target.label} <span style={{ color: '#666' }}>×{wheelGainOf(w.wheelGain, target.label)}</span></div>
      )}
    </div>
  );
}

// The level wheel (the vertical one, bottom right): relative ticks, like the
// desk's — up = more. Address in Settings.
function EtcLevelWheel({ w, color }: { w: EtcWidget; color: string }): React.JSX.Element {
  const L = ETC_LEVEL_WHEEL;
  const orange = palRgb('#ff8a1f');
  const wRef = useRef(w); wRef.current = w;
  const [off, setOff] = useState(0);
  const frac = useRef(0), pending = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastY = useRef<number | null>(null);
  const flush = () => {
    timer.current = null;
    const t = pending.current; pending.current = 0;
    if (t) send(wRef.current, wRef.current.levelWheelAddress ?? '/eos/wheel/level', t);
  };
  const add = (ticks: number) => {
    frac.current += ticks;
    const whole = Math.trunc(frac.current);
    if (!whole) return;
    frac.current -= whole; pending.current += whole;
    if (!timer.current) timer.current = setTimeout(flush, 25);
  };
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const jog = useJog((px, ev) => { setOff((o) => o - px); add(px / 4 * (ev.ctrlKey ? 0.25 : 1)); }, (t) => { setOff((o) => o - t * 4); add(t); });
  void lastY;
  const lines = Array.from({ length: 14 }, (_, i) => ((i * 14 + off) % (14 * 14) + 14 * 14) % (14 * 14) / (14 * 14));
  return (
    <div title="Level wheel — drag up = more, down = less · hold still = keeps going (upper half up, lower half down) · Ctrl = fine"
      {...jog.handlers}
      onWheel={(e) => add(e.deltaY < 0 ? 1 : -1)}
      style={{ position: 'absolute', left: L.x, top: L.y, width: L.w, height: L.h, cursor: 'ns-resize', touchAction: 'none',
        background: '#050505', border: `1px solid rgba(${orange},0.35)`, borderRadius: 6, display: 'flex', justifyContent: 'center' }}>
      {/* The drum: black at the edges, the palette's orange lit along the middle. */}
      <div style={{ position: 'relative', width: L.w * 0.62, height: '100%', overflow: 'hidden', borderRadius: 4,
        background: `linear-gradient(90deg, #000, rgba(${orange},0.35) 22%, rgba(${orange},1) 50%, rgba(${orange},0.35) 78%, #000)` }}>
        {lines.map((p, i) => (
          <div key={i} style={{ position: 'absolute', left: 0, right: 0, top: `${p * 100}%`, height: 1, background: 'rgba(0,0,0,0.55)' }} />
        ))}
        <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: '32%', background: 'linear-gradient(#000, transparent)' }} />
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: '32%', background: 'linear-gradient(transparent, #000)' }} />
      </div>
      <div style={{ position: 'absolute', bottom: -16, fontSize: 10, color, letterSpacing: 1 }}>LEVEL</div>
    </div>
  );
}
