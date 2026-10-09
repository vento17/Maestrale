import { pal } from '../../palette';
import React from 'react';
import { useStore } from '../../store';

interface Props {
  x: number;
  y: number;
  widgetId: string;
  cellIndex: number;
  onClose: () => void;
}

export default function ProtocolLearnMenu({ x, y, widgetId, cellIndex, onClose }: Props): React.JSX.Element {
  const store = useStore.getState();
  const target = store.midiLearnTarget;
  const isLearning = target?.widgetId === widgetId && target?.cellIndex === cellIndex;
  const connections = store.project.connections;
  const hasMidi = connections.some((c) => c.type === 'midi');
  const hasOsc  = connections.some((c) => c.type === 'osc');

  const startLearn = (protocol: 'midi' | 'osc') => {
    const activePageId = useStore.getState().activePageId;
    if (!activePageId) { onClose(); return; }
    useStore.getState().setMidiLearnTarget({ pageId: activePageId, widgetId, cellIndex, protocol });
    onClose();
  };

  const cancel = () => {
    useStore.getState().setMidiLearnTarget(null);
    onClose();
  };

  return (
    <div
      style={{
        position: 'fixed', left: x, top: y, zIndex: 9999,
        background: '#1a1a1a', border: '1px solid #333',
        borderRadius: 4, padding: '4px 0', minWidth: 160,
        boxShadow: '0 4px 16px rgba(0,0,0,0.6)', fontFamily: 'monospace',
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {isLearning ? (
        <button style={itemStyle(pal('#ff7700'))} onClick={cancel}>
          ⬤ Cancel Learn ({target?.protocol?.toUpperCase() ?? 'MIDI'})
        </button>
      ) : (
        <>
          {hasMidi && (
            <button style={itemStyle()} onClick={() => startLearn('midi')}>
              ⬤ Learn MIDI CC
            </button>
          )}
          {hasOsc && (
            <button style={itemStyle()} onClick={() => startLearn('osc')}>
              ⬤ Learn OSC
            </button>
          )}
          {!hasMidi && !hasOsc && (
            <div style={{ padding: '5px 12px', color: '#555', fontSize: 11 }}>
              No protocols configured
            </div>
          )}
        </>
      )}
    </div>
  );
}

const itemStyle = (color?: string): React.CSSProperties => ({
  display: 'block', width: '100%', padding: '5px 12px',
  background: 'none', border: 'none', cursor: 'pointer',
  fontSize: 11, color: color ?? '#ccc', textAlign: 'left', fontFamily: 'inherit',
});
