import { useEffect, useRef, useState } from 'react';
import type React from 'react';

// Endless-encoder input that never runs out of room:
//  • drag: up / right = +, down / left = − (lift and drag again to keep going);
//  • mouse: the pointer is locked while you drag, so the screen edge never stops you;
//  • hold still for a moment = JOG: it keeps turning by itself — press in the
//    upper / right half for +, lower / left for −, and slide a little from where
//    you held to go faster (towards +) or turn back (towards −). Release stops.
// `onPixels` gets drag pixels (+ = up/right); `onTicks` gets jog ticks.

const HOLD_MS = 350;
const STILL_PX = 6;

export function useJog(onPixels: (px: number, e: { ctrlKey: boolean; dt: number }) => void, onTicks: (ticks: number) => void) {
  const pxRef = useRef(onPixels); pxRef.current = onPixels;
  const tkRef = useRef(onTicks); tkRef.current = onTicks;
  const st = useRef<{
    id: number; x: number; y: number; t: number; moved: number; side: number;
    hold: ReturnType<typeof setTimeout> | null; jog: { ox: number; oy: number; cx: number; cy: number; acc: number; last: number } | null;
    locked: boolean; ctrl: boolean;
  } | null>(null);
  const raf = useRef(0);
  const [jogging, setJogging] = useState(false);

  const stop = () => {
    const s = st.current;
    if (s?.hold) clearTimeout(s.hold);
    if (s?.locked && document.pointerLockElement) document.exitPointerLock();
    cancelAnimationFrame(raf.current);
    st.current = null;
    setJogging(false);
  };
  useEffect(() => () => stop(), []);

  const jogLoop = (now: number) => {
    const s = st.current;
    if (!s?.jog) return;
    const j = s.jog;
    const dt = Math.min(0.1, (now - j.last) / 1000);
    j.last = now;
    // Offset from where the jog began (+ = up/right), in px.
    const off = (j.cx - j.ox) - (j.cy - j.oy);
    // Base creep by the half you pressed, plus speed from the slide.
    let rate = s.side * 4 + off * 0.8;                      // ticks per second
    rate = Math.max(-80, Math.min(80, rate)) * (s.ctrl ? 0.25 : 1);
    j.acc += rate * dt;
    const whole = Math.trunc(j.acc);
    if (whole) { j.acc -= whole; tkRef.current(whole); }
    raf.current = requestAnimationFrame(jogLoop);
  };

  const handlers = {
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      const r = e.currentTarget.getBoundingClientRect();
      const side = (e.clientX - (r.left + r.width / 2)) - (e.clientY - (r.top + r.height / 2)) >= 0 ? 1 : -1;
      const s = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), moved: 0, side, hold: null as ReturnType<typeof setTimeout> | null, jog: null, locked: false, ctrl: e.ctrlKey };
      st.current = s;
      if (e.pointerType === 'mouse') {
        try { (e.currentTarget as HTMLElement).requestPointerLock?.(); s.locked = true; } catch { /* not allowed: plain drag */ }
      }
      s.hold = setTimeout(() => {
        const c = st.current;
        if (!c || c.moved > STILL_PX) return;
        c.jog = { ox: c.x, oy: c.y, cx: c.x, cy: c.y, acc: 0, last: performance.now() };
        setJogging(true);
        raf.current = requestAnimationFrame(jogLoop);
      }, HOLD_MS);
    },
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => {
      const s = st.current;
      if (!s || e.pointerId !== s.id) return;
      s.ctrl = e.ctrlKey;
      const locked = s.locked && document.pointerLockElement;
      const dx = locked ? e.movementX : e.clientX - s.x;
      const dy = locked ? e.movementY : e.clientY - s.y;
      if (!locked) { s.x = e.clientX; s.y = e.clientY; } else { s.x += dx; s.y += dy; }
      if (s.jog) { s.jog.cx += dx; s.jog.cy += dy; return; }
      s.moved += Math.abs(dx) + Math.abs(dy);
      const now = performance.now();
      const dt = Math.max(1, now - s.t);
      s.t = now;
      const px = dx - dy;
      if (px) pxRef.current(px, { ctrlKey: e.ctrlKey, dt });
    },
    onPointerUp: () => stop(),
    onPointerCancel: () => stop(),
    onLostPointerCapture: () => { if (!st.current?.locked) stop(); },
  };
  return { handlers, jogging };
}
