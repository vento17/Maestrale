import React, { useEffect, useState } from 'react';
import type { IControlsWidget } from '../../../shared/types/project';
import { useStore, useWidgetRuntime } from '../../store';
import { bridge } from '../../ipc/bridge';
import { clamp } from '../utils';
import CellLinkMenu from '../base/CellLinkMenu';
import { useSlavedCells, SLAVE_OUTLINE } from '../base/useSlavedCells';
import {
  FADER_COUNT, TOUCH_NOTE_BASE, BUTTON_SLOTS,
  faderCell, knobCell, buttonCell, iControlsCellLabel,
  widgetPages, pageAt, pageCount, buttonsOf,
} from './iControlsMidi';
import { useIControlsBank, setBank, stepBank } from './iControlsBank';

// A mirror of the iCON iControls (Pro). Each of the surface's four layers is a
// page here, and a page holds 9 faders, 9 knobs and 32 buttons — 50 cells, each
// one an output dot to patch anywhere. The Layer buttons on the desk change the
// page, and so do the two arrows in the corner.
//
// The MIDI itself is handled by IControlsEngine, which runs for every project
// page at once; this component only draws and takes the mouse.
export default function IControlsLive({ widget, preview = false }: { widget: IControlsWidget; preview?: boolean }): React.JSX.Element {
  const runtime = useWidgetRuntime(widget.id);
  const slaved = useSlavedCells(widget.id);
  const [touched, setTouched] = useState<boolean[]>(() => new Array(FADER_COUNT).fill(false));
  const [menu, setMenu] = useState<{ x: number; y: number; cell: number } | null>(null);
  const color = widget.style.foregroundColor;

  const pages = widgetPages(widget);
  const nPages = pageCount(widget);
  const { page } = useIControlsBank(widget.id);
  const live = Math.min(page, nPages - 1);
  const cfg = pageAt(widget, live);
  const buttons = buttonsOf(cfg);

  // Only the touch highlight is handled here: it is a light on a fader cap,
  // nothing to patch, and it means nothing while you are looking elsewhere.
  useEffect(() => {
    if (preview) return;
    return bridge.on('tr:midi:inputEvent', (evt) => {
      if (evt.messageType !== 'noteOn' && evt.messageType !== 'noteOff') return;
      const f = evt.number - TOUCH_NOTE_BASE;
      if (f < 0 || f >= FADER_COUNT) return;
      const on = evt.messageType === 'noteOn' && evt.value > 0;
      setTouched((t) => (t[f] === on ? t : t.map((x, i) => (i === f ? on : x))));
    });
  }, [preview]);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [menu]);

  const valueOf = (cell: number): number => runtime?.cells[cell]?.value ?? 0;
  const onContext = (cell: number) => (e: React.MouseEvent) => {
    if (preview) return;
    e.preventDefault(); e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, cell });
  };

  // On-screen control too, so the widget works (and can be tested) with the
  // surface unplugged.
  const dragFader = (cell: number) => (e: React.PointerEvent<HTMLDivElement>) => {
    if (preview) return;
    if (e.type === 'pointerdown') e.currentTarget.setPointerCapture(e.pointerId);
    else if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    const r = e.currentTarget.getBoundingClientRect();
    useStore.getState().setCellValue(widget.id, cell, clamp(1 - (e.clientY - r.top) / r.height, 0, 1));
  };
  const dragKnob = (cell: number) => {
    let lastY = 0;
    return {
      onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => {
        if (preview) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        lastY = e.clientY;
      },
      onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => {
        if (preview || !e.currentTarget.hasPointerCapture(e.pointerId)) return;
        const dy = lastY - e.clientY;
        lastY = e.clientY;
        const st = useStore.getState();
        const cur = st.runtime.widgets[widget.id]?.cells[cell]?.value ?? 0;
        st.setCellValue(widget.id, cell, clamp(cur + dy / 150, 0, 1));
      },
    };
  };

  const strip = (i: number): React.JSX.Element => {
    const fc = faderCell(i, live), kc = knobCell(i, live);
    const fv = valueOf(fc), kv = valueOf(kc);
    const isMaster = i === FADER_COUNT - 1;
    return (
      <div key={i} style={{
        flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 6,
        paddingLeft: isMaster ? 8 : 0, borderLeft: isMaster ? '1px solid #2a2a2a' : undefined,
      }}>
        <Knob
          value={kv} color={color} label={iControlsCellLabel(kc, pages)}
          cellProps={{ 'data-lf-widget': widget.id, 'data-lf-cell': kc }}
          outline={slaved.has(kc) ? SLAVE_OUTLINE : undefined}
          onContextMenu={onContext(kc)}
          {...dragKnob(kc)}
        />
        <div
          data-lf-widget={widget.id} data-lf-cell={fc}
          onPointerDown={dragFader(fc)} onPointerMove={dragFader(fc)}
          onContextMenu={onContext(fc)}
          style={{
            flex: 1, minHeight: 40, position: 'relative', borderRadius: 4, overflow: 'hidden',
            background: 'rgba(0,0,0,0.45)', touchAction: 'none', cursor: preview ? 'default' : 'ns-resize',
            outline: slaved.has(fc) ? SLAVE_OUTLINE : touched[i] ? `1px solid ${color}` : undefined, outlineOffset: -1,
            boxShadow: touched[i] ? `0 0 10px ${color}` : undefined,
          }}
        >
          <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: `${fv * 100}%`, background: color, opacity: touched[i] ? 0.8 : 0.5 }} />
          <div style={{ position: 'absolute', left: 0, right: 0, bottom: `calc(${fv * 100}% - 2px)`, height: 4, background: '#fff', opacity: 0.85 }} />
          <div style={{ position: 'absolute', top: 4, left: 0, right: 0, textAlign: 'center', fontSize: 11, fontWeight: 700, color: '#fff', fontVariantNumeric: 'tabular-nums', pointerEvents: 'none' }}>
            {Math.round(fv * 127)}
          </div>
        </div>
        <div style={{ textAlign: 'center', fontSize: 10, fontWeight: 700, letterSpacing: 1, color: touched[i] ? color : '#8a8a8a' }}>
          {i === FADER_COUNT - 1 ? 'MASTER' : `F${i + 1}`}
        </div>
      </div>
    );
  };

  const pressButton = (cell: number, on: boolean) => (e: React.PointerEvent) => {
    if (preview) return;
    e.stopPropagation();
    useStore.getState().setCellValue(widget.id, cell, on ? 1 : 0);
  };

  const btn = (i: number): React.JSX.Element | null => {
    const b = buttons[i];
    const cell = buttonCell(i, live);
    const on = valueOf(cell) >= 0.5;
    return (
      <div key={i}
        data-lf-widget={widget.id} data-lf-cell={cell}
        onPointerDown={pressButton(cell, true)}
        onPointerUp={pressButton(cell, false)}
        onPointerLeave={(e) => { if (on) pressButton(cell, false)(e); }}
        onContextMenu={onContext(cell)}
        title={b.note ? `${b.label || `B${i + 1}`} — note ${b.note}` : 'unused'}
        style={{
          minWidth: 0, height: 20, borderRadius: 3, display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 8, fontWeight: 700, letterSpacing: 0.3, whiteSpace: 'nowrap', overflow: 'hidden',
          background: on ? color : 'rgba(255,255,255,0.05)',
          color: on ? '#000' : b.note ? '#9a9a9a' : '#4a4a4a',
          outline: slaved.has(cell) ? SLAVE_OUTLINE : undefined, outlineOffset: -1,
          cursor: preview ? 'default' : 'pointer', userSelect: 'none', touchAction: 'none',
        }}>
        {b.label || `B${i + 1}`}
      </div>
    );
  };

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', padding: 8, boxSizing: 'border-box', gap: 6, fontFamily: 'monospace' }}>
      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
        {nPages > 1 && (
          <>
            <PageBtn label="◀" onClick={() => stepBank(widget.id, -1, nPages)} disabled={live === 0 || preview} />
            <div
              onPointerDown={(e) => { if (!preview) { e.stopPropagation(); setBank(widget.id, (live + 1) % nPages, nPages); } }}
              title="Click to step through the pages; the Layer buttons on the surface do the same"
              style={{ flex: 1, textAlign: 'center', fontSize: 10, fontWeight: 700, letterSpacing: 1, color, cursor: preview ? 'default' : 'pointer', textTransform: 'uppercase', overflow: 'hidden', whiteSpace: 'nowrap' }}>
              {cfg.name || `Page ${live + 1}`} · {live + 1}/{nPages}
            </div>
            <PageBtn label="▶" onClick={() => stepBank(widget.id, +1, nPages)} disabled={live === nPages - 1 || preview} />
          </>
        )}
        {nPages === 1 && widget.style.showLabel !== false && (
          <div style={{ flex: 1, textAlign: 'center', fontWeight: 700, letterSpacing: 2, fontSize: 10, color: '#8a8a8a', textTransform: 'uppercase' }}>
            {widget.label}
          </div>
        )}
      </div>

      <div style={{ flex: 1, minHeight: 0, display: 'flex', gap: 6 }}>
        {Array.from({ length: FADER_COUNT }, (_, i) => strip(i))}
      </div>

      <div style={{ flexShrink: 0, display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 3 }}>
        {Array.from({ length: BUTTON_SLOTS }, (_, i) => btn(i))}
      </div>

      {menu && <CellLinkMenu x={menu.x} y={menu.y} widgetId={widget.id} cellIndex={menu.cell} onClose={() => setMenu(null)} />}
    </div>
  );
}

function PageBtn({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }): React.JSX.Element {
  return (
    <div
      onPointerDown={(e) => { if (!disabled) { e.stopPropagation(); onClick(); } }}
      style={{
        width: 22, height: 18, flexShrink: 0, borderRadius: 3, display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(255,255,255,0.06)', color: disabled ? '#3a3a3a' : '#bbb', fontSize: 10,
        cursor: disabled ? 'default' : 'pointer', userSelect: 'none', touchAction: 'none',
      }}>
      {label}
    </div>
  );
}

function Knob({ value, color, label, cellProps, outline, onContextMenu, onPointerDown, onPointerMove }: {
  value: number; color: string; label: string;
  cellProps: Record<string, string | number>;
  outline?: string;
  onContextMenu: (e: React.MouseEvent) => void;
  onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
  onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => void;
}): React.JSX.Element {
  // 270° sweep from 7:30 to 4:30.
  const a0 = 135, sweep = 270;
  const arc = (from: number, to: number): string => {
    const p = (deg: number) => {
      const r = (deg * Math.PI) / 180;
      return `${20 + 15 * Math.cos(r)} ${20 + 15 * Math.sin(r)}`;
    };
    const large = to - from > 180 ? 1 : 0;
    return `M ${p(from)} A 15 15 0 ${large} 1 ${p(to)}`;
  };
  const end = a0 + sweep * value;
  return (
    <div {...cellProps}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onContextMenu={onContextMenu}
      style={{ position: 'relative', aspectRatio: '1', width: '100%', maxWidth: 64, alignSelf: 'center', touchAction: 'none', cursor: 'ns-resize', outline, outlineOffset: -1, borderRadius: '50%' }}
      title={`${label}: ${Math.round(value * 127)}`}
    >
      <svg viewBox="0 0 40 40" style={{ width: '100%', height: '100%', display: 'block' }}>
        <path d={arc(a0, a0 + sweep)} stroke="rgba(255,255,255,0.12)" strokeWidth={4} fill="none" strokeLinecap="round" />
        {value > 0.001 && <path d={arc(a0, end)} stroke={color} strokeWidth={4} fill="none" strokeLinecap="round" />}
        <text x={20} y={23} textAnchor="middle" fontSize={9} fontWeight={700} fill="#ddd" fontFamily="monospace">{Math.round(value * 127)}</text>
      </svg>
    </div>
  );
}
