import React, { useEffect, useRef, useState } from 'react';
import type { EncoderWidget, EncoderDef } from '../../../shared/types/project';
import { sendEncoder } from './encoderOut';
import { useJog } from '../base/useJog';

// Endless encoders. Drag up/right (or the mouse wheel) to send +, down/left
// to send −. Nothing is absolute: the desk keeps the value, we send changes.
// One full turn of the ring = `ticksPerTurn` ticks = 240 px of drag.
// Ctrl while turning = fine (¼). Double-click a counter to zero it.

const PX_PER_TURN = 240;
const FLUSH_MS = 25;    // changes are summed and sent at most every 25 ms

export const FORMAT_BADGE: Record<EncoderWidget['format'], string> = {
  oscDelta: 'OSC ±', oscText: 'OSC text', oscIncDec: 'OSC +/−', midi: 'MIDI rel',
};

export default function EncoderLive({ widget }: { widget: EncoderWidget }): React.JSX.Element {
  const color = widget.style.foregroundColor;
  const fs = widget.style.fontSize || 14;
  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', fontFamily: 'monospace', boxSizing: 'border-box', padding: 6, gap: 4 }}>
      {widget.style.showLabel !== false && (
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexShrink: 0, fontSize: Math.max(9, fs - 4), color: '#777', letterSpacing: 1 }}>
          <span style={{ fontWeight: 700, color: widget.style.labelColor, textTransform: 'uppercase' }}>{widget.label}</span>
          <span style={{ color: '#555' }}>{FORMAT_BADGE[widget.format]}</span>
        </div>
      )}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', gap: 6 }}>
        {widget.encoders.map((e) => <Encoder key={e.id} w={widget} e={e} color={color} fs={fs} />)}
      </div>
    </div>
  );
}

function Encoder({ w, e, color, fs }: { w: EncoderWidget; e: EncoderDef; color: string; fs: number }): React.JSX.Element {
  const wRef = useRef(w); wRef.current = w;
  const eRef = useRef(e); eRef.current = e;
  const [pos, setPos] = useState(0);          // net ticks sent since the last zero
  const [flash, setFlash] = useState(0);      // last change, for the little readout
  const frac = useRef(0);                     // sub-tick remainder of the drag
  const pending = useRef(0);                  // whole ticks waiting for the next send
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const last = useRef<{ x: number; y: number; t: number } | null>(null);

  const flush = () => {
    timer.current = null;
    const t = pending.current;
    pending.current = 0;
    if (!t) return;
    sendEncoder(wRef.current, eRef.current, t);
    setPos((p) => p + t);
    setFlash(t);
  };
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const add = (ticks: number) => {
    frac.current += ticks;
    const whole = Math.trunc(frac.current);
    if (!whole) return;
    frac.current -= whole;
    pending.current += whole;
    if (!timer.current) timer.current = setTimeout(flush, FLUSH_MS);
  };

  // Drag (pointer locked for the mouse, so no screen edge), or hold = jog.
  const { handlers, jogging } = useJog((px, ev) => {
    // Acceleration: faster turning sends proportionally more, like desk wheels.
    const speed = Math.abs(px) / ev.dt;                    // px per ms
    const accel = 1 + (wRef.current.acceleration || 0) * Math.min(6, speed * 2);
    add((px / PX_PER_TURN) * (wRef.current.ticksPerTurn || 64) * accel * (ev.ctrlKey ? 0.25 : 1));
  }, (ticks) => add(ticks));
  void last;

  const turns = pos / (w.ticksPerTurn || 64);
  const angle = turns * 360;
  const mult = w.format === 'midi' || w.format === 'oscIncDec' ? 1 : (w.step || 1);
  const total = pos * mult;
  const nice = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(2));
  const ticksMarks = 24;

  return (
    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
      <div
        data-lf-widget={w.id}
        title="Drag up/right = +, down/left = − · hold still = keeps turning (upper half +, lower half −; slide to speed up) · wheel · Ctrl = fine"
        {...handlers}
        onWheel={(ev) => add((ev.deltaY < 0 ? 1 : -1) * (ev.ctrlKey ? 0.25 : 1))}
        style={{ flex: 1, minHeight: 0, width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'ns-resize', touchAction: 'none',
          filter: jogging ? `drop-shadow(0 0 8px ${color})` : undefined }}
      >
        <svg viewBox="0 0 60 60" style={{ height: '100%', maxWidth: '100%', aspectRatio: '1', display: 'block' }}>
          {/* endless ring: evenly spaced notches that rotate with the turn */}
          <g transform={`rotate(${angle} 30 30)`}>
            {Array.from({ length: ticksMarks }, (_, i) => {
              const a = (i / ticksMarks) * Math.PI * 2;
              return <line key={i} x1={30 + Math.sin(a) * 23} y1={30 - Math.cos(a) * 23} x2={30 + Math.sin(a) * 27} y2={30 - Math.cos(a) * 27}
                stroke={i === 0 ? color : '#3a3a3a'} strokeWidth={i === 0 ? 2.4 : 1.2} strokeLinecap="round" />;
            })}
          </g>
          <circle cx={30} cy={30} r={19} fill="#111" stroke="#2a2a2a" strokeWidth={1} />
          <g transform={`rotate(${angle} 30 30)`}>
            <line x1={30} y1={30} x2={30} y2={14} stroke={color} strokeWidth={2.4} strokeLinecap="round" />
          </g>
          <text x={30} y={33} textAnchor="middle" fontSize={7} fill="#999" fontFamily="monospace">
            {flash ? `${flash > 0 ? '+' : ''}${nice(flash * mult)}` : '·'}
          </text>
        </svg>
      </div>
      <div style={{ fontSize: Math.max(9, fs - 2), color: w.style.labelColor, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }}>{e.label}</div>
      <div title="Total sent since zero — double-click to zero" onDoubleClick={() => { setPos(0); setFlash(0); }}
        style={{ fontSize: Math.max(8, fs - 5), color: '#777', fontVariantNumeric: 'tabular-nums', cursor: 'pointer' }}>
        Σ {total > 0 ? '+' : ''}{nice(total)}
      </div>
    </div>
  );
}
