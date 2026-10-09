import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ManualWidget } from '../../../shared/types/project';
import { makeDefaultWidget } from '../../widgets/defaults';
import ManualView from '../../widgets/Manual/ManualView';

// The manual, full screen, from the Manual button next to the widget search.
// Text size is one variable (A− / slider / A+), remembered per computer.

const KEY = 'lf.manualScale';
const MIN = 0.7, MAX = 2.5, STEP = 0.1;

function loadScale(): number {
  try { const v = Number(localStorage.getItem(KEY)); return v >= MIN && v <= MAX ? v : 1.2; } catch { return 1.2; }
}

export default function ManualPopup({ onClose }: { onClose: () => void }): React.JSX.Element {
  const [scale, setScale] = useState(loadScale);
  useEffect(() => { try { localStorage.setItem(KEY, String(scale)); } catch { /* not kept */ } }, [scale]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);

  const base = useMemo(() => makeDefaultWidget('manual-popup', 'manual', 0) as ManualWidget, []);
  const widget: ManualWidget = { ...base, fontScale: scale };
  const set = (v: number) => setScale(Math.round(Math.max(MIN, Math.min(MAX, v)) * 10) / 10);

  return createPortal(
    <div style={{ position: 'fixed', inset: 0, zIndex: 1001, background: '#0b0b0b', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', borderBottom: '1px solid var(--color-border)', flexShrink: 0, fontFamily: 'monospace' }}>
        <span style={{ fontWeight: 700, letterSpacing: 2, fontSize: 13, color: 'var(--color-text)' }}>MANUAL</span>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
          <button style={btn} onClick={() => set(scale - STEP)} title="Smaller text">A−</button>
          <input type="range" min={MIN} max={MAX} step={STEP} value={scale} onChange={(e) => set(Number(e.target.value))} style={{ width: 160 }} />
          <button style={btn} onClick={() => set(scale + STEP)} title="Bigger text">A+</button>
          <span style={{ width: 44, textAlign: 'right', fontSize: 12, color: 'var(--color-text-dim)', fontVariantNumeric: 'tabular-nums' }}>{Math.round(scale * 100)}%</span>
          <button style={{ ...btn, marginLeft: 10 }} onClick={onClose} title="Close (Esc)">✕ Close</button>
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <ManualView widget={widget} interactive />
      </div>
    </div>,
    document.body,
  );
}

const btn: React.CSSProperties = {
  height: 30, minWidth: 36, padding: '0 10px', background: 'var(--color-surface-2)', border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-sm)', color: 'var(--color-text)', fontFamily: 'inherit', fontSize: 13, cursor: 'pointer',
};
