import { pal } from '../../palette';
import React, { useState, useRef, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '../../store';
import {
  findSlaveLink, listLinkableSources, sourceCells, pageIdOfWidget,
} from './links';
import { MAIN_ROUTER_ID } from './routers';

interface Props {
  x: number;
  y: number;
  widgetId: string;      // the slave widget (the cell you right-clicked)
  cellIndex: number;     // the slave cell index
  onClose: () => void;
}

type View = 'root' | 'sources' | 'cells';



export default function CellLinkMenu({ x, y, widgetId, cellIndex, onClose }: Props): React.JSX.Element {
  const project = useStore((s) => s.project);
  const connectedProtocols = useStore((s) => s.connectedProtocols);
  const connections = project.connections;
  // Offer Learn when the protocol is either configured in Settings OR actually
  // connected. MIDI learn listens on the INPUT port, so accept either midi entry.
  const hasMidi = !!connectedProtocols['midiInput'] || !!connectedProtocols['midi'] ||
                  connections.some((c) => c.type === 'midiInput' || c.type === 'midi');
  const hasOsc  = !!connectedProtocols['osc'] || connections.some((c) => c.type === 'osc');
  const hasArtnetIn = connections.some((c) => c.type === 'artnetInput' && c.enabled);
  const hasSacnIn = connections.some((c) => c.type === 'sacnInput' && c.enabled);

  const learnTarget = useStore((s) => s.midiLearnTarget);
  const isLearning = learnTarget?.widgetId === widgetId && learnTarget?.cellIndex === cellIndex;

  const [view, setView] = useState<View>('root');
  const [srcWidgetId, setSrcWidgetId] = useState<string>('');

  const slaveLink = findSlaveLink(project, widgetId, cellIndex);
  const srcWidget = project.pages.flatMap((p) => p.widgets).find((w) => w.id === srcWidgetId);


  // Every link lives in the main router now: Learn arms straight away.
  const askLearnRouter = (protocol: 'midi' | 'osc' | 'artnet' | 'sacn'): void => {
    const pageId = pageIdOfWidget(useStore.getState().project, widgetId)
                ?? useStore.getState().activePageId;
    if (!pageId) { onClose(); return; }
    useStore.getState().setMidiLearnTarget({ pageId, widgetId, cellIndex, protocol, routerId: MAIN_ROUTER_ID });
    onClose();
  };

  const goPickCell = (wid: string): void => {
    setSrcWidgetId(wid);
    setView('cells');
  };

  const goPickRouter = (idx: number): void => {
    useStore.getState().linkSlaveCell({
      slaveWidgetId: widgetId, slaveCellIndex: cellIndex,
      sourceWidgetId: srcWidgetId, sourceCellIndex: idx,
      routerId: MAIN_ROUTER_ID,
    });
    onClose();
  };

  // The menu is big enough now that opening it near an edge would push it off
  // screen, so measure and pull it back in. Re-runs per view: each view is a
  // different height.
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const margin = 8;
    setPos({
      left: Math.max(margin, Math.min(x, window.innerWidth - width - margin)),
      top: Math.max(margin, Math.min(y, window.innerHeight - height - margin)),
    });
  }, [x, y, view]);

  // Portal to <body>: the menu is opened from inside a widget, and every Live
  // page sits in a transform: scale() box inside an overflow: hidden canvas. A
  // transformed ancestor turns position: fixed into position-relative-to-it, so
  // the menu landed offset by the canvas origin and was clipped at the canvas
  // edge — the tail of the source list (other pages' widgets) was unreachable.
  return createPortal(
    <div
      ref={menuRef}
      style={{
        position: 'fixed', left: pos.left, top: pos.top, zIndex: 9999,
        background: '#1a1a1a', border: '1px solid #3a3a3a',
        borderRadius: 6, padding: '6px 0', minWidth: 300, maxWidth: 420,
        maxHeight: '75vh', overflowY: 'auto',
        boxShadow: '0 6px 28px rgba(0,0,0,0.75)', fontFamily: 'monospace',
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {view === 'root' && (
        <>
          {slaveLink ? (
            <>
              <div style={headerStyle}>
                ▶ slaved to <span style={{ color: pal('#ffa455') }}>{slaveLink.source.primary}</span>
                <span style={{ color: '#777' }}> · {slaveLink.source.secondary}</span>
              </div>
              <div style={dividerStyle} />
              <button style={itemStyle(pal('#ffad66'))} onClick={() => { useStore.getState().unlinkSlaveCell(widgetId, cellIndex); onClose(); }}>
                ✕ Unlink
              </button>
              <button style={itemStyle()} onClick={() => setView('sources')}>
                ↻ Select new source ▸
              </button>
            </>
          ) : (
            <button style={itemStyle()} onClick={() => setView('sources')}>
              ⇢ Link to source ▸
            </button>
          )}

          {(hasMidi || hasOsc || hasArtnetIn || hasSacnIn) && <div style={dividerStyle} />}
          {isLearning ? (
            <button style={itemStyle(pal('#ff7700'))} onClick={() => { useStore.getState().setMidiLearnTarget(null); onClose(); }}>
              ⬤ Cancel Learn ({learnTarget?.protocol?.toUpperCase() ?? 'MIDI'})
            </button>
          ) : (
            <>
              {hasMidi && <button style={itemStyle()} onClick={() => askLearnRouter('midi')}>⬤ Learn MIDI CC ▸</button>}
              {hasOsc  && <button style={itemStyle()} onClick={() => askLearnRouter('osc')}>⬤ Learn OSC ▸</button>}
              {hasArtnetIn && <button style={itemStyle()} onClick={() => askLearnRouter('artnet')}>⬤ Learn Art-Net ▸</button>}
              {hasSacnIn && <button style={itemStyle()} onClick={() => askLearnRouter('sacn')}>⬤ Learn sACN ▸</button>}
              {!hasMidi && !hasOsc && !hasArtnetIn && !hasSacnIn && (
                <div style={emptyStyle}>
                  no MIDI/OSC/Art-Net input — add one in Settings
                </div>
              )}
            </>
          )}
        </>
      )}

      {view === 'sources' && (
        <>
          <button style={backStyle} onClick={() => setView('root')}>‹ back</button>
          <div style={dividerStyle} />
          {listLinkableSources(project).length === 0 && (
            <div style={emptyStyle}>no source widgets</div>
          )}
          {listLinkableSources(project).map((group, gi) => (
            <div key={group.pageId}>
              {/* Rule between pages so a long source list reads as groups. */}
              {gi > 0 && <div style={dividerStyle} />}
              {project.pages.length > 1 && <div style={headerStyle}>{group.pageName}</div>}
              {group.widgets.map((w) => (
                <button key={w.id} style={itemStyle()} onClick={() => goPickCell(w.id)}>
                  {w.label} <span style={{ color: '#666' }}>· {w.kind}</span>
                </button>
              ))}
            </div>
          ))}
        </>
      )}

      {view === 'cells' && srcWidget && (
        <>
          <button style={backStyle} onClick={() => setView('sources')}>‹ {srcWidget.label}</button>
          <div style={dividerStyle} />
          {sourceCells(srcWidget).map((c) => {
            const isSelf = srcWidget.id === widgetId && c.index === cellIndex;
            return (
              <button
                key={c.index}
                style={itemStyle(isSelf ? '#555' : undefined)}
                disabled={isSelf}
                onClick={() => { if (!isSelf) goPickRouter(c.index); }}
              >
                {c.label}{isSelf ? ' (this cell)' : ''}
              </button>
            );
          })}
        </>
      )}


    </div>,
    document.body,
  );
}

// Sized to stay readable standing over a monitor lying flat on a table.
const itemStyle = (color?: string): React.CSSProperties => ({
  display: 'block', width: '100%', minHeight: 40, padding: '10px 16px',
  background: 'none', border: 'none', cursor: 'pointer',
  fontSize: 15, color: color ?? '#ccc', textAlign: 'left', fontFamily: 'inherit',
});

const backStyle: React.CSSProperties = {
  ...itemStyle('#888'),
  fontSize: 13,
};

const headerStyle: React.CSSProperties = {
  padding: '8px 16px', color: '#8a8a8a', fontSize: 12,
  textTransform: 'uppercase', letterSpacing: 1,
};

const dividerStyle: React.CSSProperties = {
  height: 1, background: '#3a3a3a', margin: '6px 0',
};

const emptyStyle: React.CSSProperties = {
  padding: '10px 16px', color: '#555', fontSize: 14,
};
