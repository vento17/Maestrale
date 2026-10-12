import React, { useEffect, useState } from 'react';
import type { IControlsWidget } from '../../../shared/types/project';
import { useStore, useWidgetRuntime } from '../../store';
import { bridge } from '../../ipc/bridge';
import { clamp } from '../utils';
import CellLinkMenu from '../base/CellLinkMenu';
import { useSlavedCells, SLAVE_OUTLINE } from '../base/useSlavedCells';
import {
  FADER_COUNT, KNOB_COUNT, TOUCH_NOTE_BASE, DEFAULT_KNOB_CCS,
  faderCell, knobCell, iControlsCellLabel, relativeTicks, pitchBendValue,
} from './iControlsMidi';

// A mirror of the iCON iControls (Pro): its 9 faders and 9 knobs land on 18
// cells, each one an output dot to patch anywhere. The surface speaks Mackie
// Control: faders arrive as Pitch Bend (14-bit), knobs as relative CC, and the
// touch-sensitive caps as notes — those only light the fader up here, they are
// never a value.
export default function IControlsLive({ widget, preview = false }: { widget: IControlsWidget; preview?: boolean }): React.JSX.Element {
  const runtime = useWidgetRuntime(widget.id);
  const slaved = useSlavedCells(widget.id);
  const [touched, setTouched] = useState<boolean[]>(() => new Array(FADER_COUNT).fill(false));
  const [menu, setMenu] = useState<{ x: number; y: number; cell: number } | null>(null);
  const color = widget.style.foregroundColor;
  const knobCcs = widget.knobCcs?.length === KNOB_COUNT ? widget.knobCcs : DEFAULT_KNOB_CCS;
  const step = widget.knobStep > 0 ? widget.knobStep : 1 / 127;

  useEffect(() => {
    if (preview) return;
    return bridge.on('tr:midi:inputEvent', (evt) => {
      const st = useStore.getState();
      if (evt.messageType === 'pitchBend') {
        const f = evt.channel - 1;
        if (f < 0 || f >= FADER_COUNT) return;
        st.setCellValue(widget.id, faderCell(f), pitchBendValue(evt.number, evt.value));
        return;
      }
      if (evt.messageType === 'noteOn' || evt.messageType === 'noteOff') {
        const f = evt.number - TOUCH_NOTE_BASE;
        if (f < 0 || f >= FADER_COUNT) return;
        const on = evt.messageType === 'noteOn' && evt.value > 0;
        setTouched((t) => (t[f] === on ? t : t.map((x, i) => (i === f ? on : x))));
        return;
      }
      if (evt.messageType === 'controlChange') {
        const k = knobCcs.indexOf(evt.number);
        if (k < 0) return;
        const ticks = relativeTicks(evt.value);
        if (ticks === 0) return;
        const cell = knobCell(k);
        const cur = st.runtime.widgets[widget.id]?.cells[cell]?.value ?? 0;
        st.setCellValue(widget.id, cell, clamp(cur + ticks * step, 0, 1));
      }
    });
  }, [preview, widget.id, knobCcs.join(','), step]);

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
    const fc = faderCell(i), kc = knobCell(i);
    const fv = valueOf(fc), kv = valueOf(kc);
    const isMaster = i === FADER_COUNT - 1;
    return (
      <div key={i} style={{
        flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 6,
        paddingLeft: isMaster ? 8 : 0, borderLeft: isMaster ? '1px solid #2a2a2a' : undefined,
      }}>
        <Knob
          value={kv} color={color} label={iControlsCellLabel(kc)}
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
          {iControlsCellLabel(fc)}
        </div>
      </div>
    );
  };

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', padding: 8, boxSizing: 'border-box', gap: 6, fontFamily: 'monospace' }}>
      {widget.style.showLabel !== false && (
        <div style={{ flexShrink: 0, textAlign: 'center', fontWeight: 700, letterSpacing: 2, fontSize: 10, color: '#8a8a8a', textTransform: 'uppercase' }}>
          {widget.label}
        </div>
      )}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', gap: 6 }}>
        {Array.from({ length: FADER_COUNT }, (_, i) => strip(i))}
      </div>
      {menu && <CellLinkMenu x={menu.x} y={menu.y} widgetId={widget.id} cellIndex={menu.cell} onClose={() => setMenu(null)} />}
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
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: -2, textAlign: 'center', fontSize: 9, color: '#8a8a8a', pointerEvents: 'none' }}>{label}</div>
    </div>
  );
}
