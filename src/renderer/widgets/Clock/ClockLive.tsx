import React, { useEffect, useRef, useState } from 'react';
import { nanoid } from 'nanoid';
import type { ClockWidget, ClockAlarm } from '../../../shared/types/project';
import { useStore } from '../../store';
import SevenSeg from './SevenSeg';

const PULSE_MS = 150;

// "9:5" → "09:05:00"; anything unreadable → null.
export function normTime(text: string): string | null {
  const m = text.trim().match(/^(\d{1,2})(?::(\d{1,2}))?(?::(\d{1,2}))?$/);
  if (!m) return null;
  const h = Number(m[1]), mi = Number(m[2] ?? 0), se = Number(m[3] ?? 0);
  if (h > 23 || mi > 59 || se > 59) return null;
  return [h, mi, se].map((n) => String(n).padStart(2, '0')).join(':');
}
function secOfDay(t: string): number {
  const [h, m, s] = t.split(':').map(Number);
  return h * 3600 + m * 60 + s;
}
function nowSec(d = new Date()): number {
  return d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds() + d.getMilliseconds() / 1000;
}

// The computer's clock, big, and a list of daily alarms. Each alarm is an
// output cell that pulses 1 → 0 when the clock passes its time — patch it to a
// cue, a timeline GO, a DMX player… Checked on every tick against the previous
// tick, so a busy moment never skips one, and midnight wraps correctly.
export default function ClockLive({ widget, preview = false }: { widget: ClockWidget; preview?: boolean }): React.JSX.Element {
  const [now, setNow] = useState(() => new Date());
  const [flash, setFlash] = useState<Record<string, number>>({});
  const wRef = useRef(widget);
  wRef.current = widget;

  useEffect(() => {
    // The triggers themselves fire from ClockEngine (every page, any page on
    // screen); here only the display and the flash of a row that fired.
    const t = setInterval(() => setNow(new Date()), 200);
    let prevVals: number[] = [];
    const unsub = preview ? () => {} : useStore.subscribe((s) => {
      const cells = s.runtime.widgets[widget.id]?.cells ?? [];
      cells.forEach((c, i) => {
        if ((prevVals[i] ?? 0) < 0.5 && c.value >= 0.5) {
          const a = wRef.current.alarms[i];
          if (a) setFlash((f) => ({ ...f, [a.id]: Date.now() }));
        }
      });
      prevVals = cells.map((c) => c.value);
    });
    return () => { clearInterval(t); unsub(); };
  }, [widget.id, preview]);

  const pad = (n: number) => String(n).padStart(2, '0');
  const text = widget.showSeconds
    ? `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
    : `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const color = widget.style.foregroundColor || '#ff3b2f';
  const nextIdx = nextAlarmIndex(widget.alarms, nowSec(now));

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', gap: 6, padding: 8, boxSizing: 'border-box', fontFamily: 'monospace' }}>
      <div style={{ flex: widget.alarms.length ? '0 0 auto' : 1, height: widget.alarms.length ? '45%' : undefined, minHeight: 40 }}>
        <SevenSeg text={text} color={color} />
      </div>

      <ClockAlarms widget={widget} flash={flash} nextIdx={nextIdx} />
    </div>
  );
}

// The alarm list with its ＋ — shared by the widget and its settings panel.
export function ClockAlarms({ widget, flash = {}, nextIdx = -1 }: {
  widget: ClockWidget; flash?: Record<string, number>; nextIdx?: number;
}): React.JSX.Element {
  const pageId = () => useStore.getState().project.pages.find((p) => p.widgets.some((w) => w.id === widget.id))?.id;
  const setAlarms = (alarms: ClockAlarm[]) => {
    const id = pageId();
    if (id) useStore.getState().updateWidget(id, widget.id, { alarms } as never);
  };
  const addAlarm = () => {
    useStore.getState().captureHistory();
    const d = new Date(Date.now() + 60_000);
    const time = [d.getHours(), d.getMinutes(), 0].map((n) => String(n).padStart(2, '0')).join(':');
    setAlarms([...widget.alarms, { id: nanoid(), time, enabled: true }]);
  };
  const removeAlarm = (i: number) => {
    useStore.getState().captureHistory();
    // Links on later alarms move down with them.
    useStore.getState().dropCellAndShiftLinks(widget.id, i);
    setAlarms(widget.alarms.filter((_, k) => k !== i));
  };
  const patchAlarm = (i: number, p: Partial<ClockAlarm>) =>
    setAlarms(widget.alarms.map((a, k) => (k === i ? { ...a, ...p } : a)));

  const color = widget.style.foregroundColor || '#ff3b2f';
  const fs = widget.style.fontSize || 14;
  return (
    <>
      <div className="lf-scroll" style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 3 }}>
        {widget.alarms.map((a, i) => (
          <AlarmRow key={a.id} alarm={a} index={i} widgetId={widget.id} fs={fs} color={color}
            next={i === nextIdx} flashing={!!flash[a.id] && Date.now() - flash[a.id] < 600}
            onPatch={(p) => patchAlarm(i, p)} onRemove={() => removeAlarm(i)} />
        ))}
      </div>

      <button onClick={addAlarm} title="Add a time that fires a trigger"
        style={{ flexShrink: 0, height: 28, borderRadius: 4, border: '1px dashed #333', background: 'transparent', color: '#888', cursor: 'pointer', fontSize: 18, lineHeight: '24px' }}>＋</button>
    </>
  );
}

function nextAlarmIndex(alarms: ClockAlarm[], cur: number): number {
  let best = -1, bestD = Infinity;
  alarms.forEach((a, i) => {
    if (!a.enabled) return;
    const d = (secOfDay(a.time) - cur + 86400) % 86400;
    if (d < bestD) { bestD = d; best = i; }
  });
  return best;
}

function AlarmRow({ alarm, index, widgetId, fs, color, next, flashing, onPatch, onRemove }: {
  alarm: ClockAlarm; index: number; widgetId: string; fs: number; color: string; next: boolean; flashing: boolean;
  onPatch: (p: Partial<ClockAlarm>) => void; onRemove: () => void;
}): React.JSX.Element {
  const [draft, setDraft] = useState(alarm.time);
  const [fired, setFired] = useState(false);
  useEffect(() => setDraft(alarm.time), [alarm.time]);
  // ▶ fires this row now (same pulse as when the clock gets there), to test
  // what it is patched to without changing the time.
  const fireNow = () => {
    useStore.getState().setCellValue(widgetId, index, 1);
    setTimeout(() => useStore.getState().setCellValue(widgetId, index, 0), PULSE_MS);
    setFired(true); setTimeout(() => setFired(false), 400);
  };
  const bad = normTime(draft) === null;
  const commit = () => {
    const t = normTime(draft);
    if (t) onPatch({ time: t }); else setDraft(alarm.time);
  };
  return (
    <div
      data-lf-widget={widgetId} data-lf-cell={index}
      style={{
        display: 'flex', alignItems: 'center', gap: 6, padding: '3px 6px', borderRadius: 4, minHeight: 30,
        background: flashing || fired ? `${color}55` : next ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.35)',
        borderLeft: `3px solid ${alarm.enabled ? color : '#333'}`, transition: 'background 0.3s',
        opacity: alarm.enabled ? 1 : 0.5,
      }}
    >
      <input value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        title="HH:MM:SS — fires every day"
        style={{ width: '10ch', boxSizing: 'content-box', height: 24, background: '#000', border: `1px solid ${bad ? '#a33' : '#2a2a2a'}`, color: '#eee', fontFamily: 'inherit', fontSize: Math.max(11, fs - 1), padding: '0 6px' }} />
      <input value={alarm.label ?? ''} placeholder="label" onChange={(e) => onPatch({ label: e.target.value })}
        style={{ flex: 1, minWidth: 0, height: 24, background: 'transparent', border: '1px solid #1f1f1f', color: '#bbb', fontFamily: 'inherit', fontSize: Math.max(10, fs - 3), padding: '0 6px' }} />
      {next && <span style={{ fontSize: 10, color: '#888' }}>next</span>}
      <button onClick={fireNow} title="Fire now (test) — sends the trigger without waiting for the time"
        style={{ height: 24, minWidth: 28, background: '#151515', border: `1px solid ${color}88`, borderRadius: 3, color, cursor: 'pointer', fontSize: 11, padding: '0 6px' }}>▶</button>
      <input type="checkbox" checked={alarm.enabled} onChange={(e) => onPatch({ enabled: e.target.checked })} title="Armed" />
      <button onClick={onRemove} title="Remove"
        style={{ background: 'none', border: 'none', color: '#744', cursor: 'pointer', fontSize: 13, padding: '0 2px' }}>✕</button>
    </div>
  );
}

// Fires every Clock's rows when the computer's clock passes them — for all
// clocks in the project, whatever page is on screen (mounted in Live).
export function ClockEngine(): null {
  useEffect(() => {
    let last = nowSec();
    const t = setInterval(() => {
      const cur = nowSec();
      const prev = last;
      last = cur;
      const wrapped = cur < prev;   // passed midnight
      for (const p of useStore.getState().project.pages) for (const w of p.widgets) {
        if (w.kind !== 'clock') continue;
        (w as ClockWidget).alarms.forEach((a, i) => {
          if (!a.enabled) return;
          const at = secOfDay(a.time);
          const hit = wrapped ? (at > prev || at <= cur) : (at > prev && at <= cur);
          if (!hit) return;
          useStore.getState().setCellValue(w.id, i, 1);
          setTimeout(() => useStore.getState().setCellValue(w.id, i, 0), PULSE_MS);
        });
      }
    }, 200);
    return () => clearInterval(t);
  }, []);
  return null;
}
