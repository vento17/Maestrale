import { pal } from '../../palette';
import React, { useState, useCallback, useRef } from 'react';
import type { NdiInputWidget } from '../../../shared/types/project';

const SIDECAR = 'http://127.0.0.1:8765';

export default function NdiInputLive({ widget }: { widget: NdiInputWidget }): React.JSX.Element {
  const [broken, setBroken] = useState(false);
  const [fps, setFps] = useState(0);
  const fpsRef = useRef({ count: 0, last: 0 });

  const fpsParam = (widget.targetFps ?? 0) > 0 ? `?fps=${widget.targetFps}` : '';
  const src = widget.sourceName
    ? `${SIDECAR}/ndi/mjpeg/${encodeURIComponent(widget.sourceName)}${fpsParam}`
    : '';

  const handleError = useCallback(() => setBroken(true), []);

  const handleLoad = useCallback(() => {
    const now = performance.now();
    if (fpsRef.current.last === 0) fpsRef.current.last = now;
    fpsRef.current.count++;
    if (now - fpsRef.current.last >= 1000) {
      setFps(fpsRef.current.count);
      fpsRef.current.count = 0;
      fpsRef.current.last = now;
    }
  }, []);

  React.useEffect(() => {
    setBroken(false);
    setFps(0);
    fpsRef.current = { count: 0, last: 0 };
  }, [widget.sourceName]);

  const border = (widget.borderWidth ?? 0) > 0;

  if (!widget.sourceName) {
    return (
      <div style={overlay}>
        <NdiIcon />
        <span>No source selected</span>
      </div>
    );
  }

  if (broken) {
    return (
      <div style={overlay}>
        <NdiIcon />
        <span style={{ color: pal('#db8235') }}>Stream unavailable</span>
        <span style={{ fontSize: 10, color: 'var(--color-text-dim)' }}>{widget.sourceName}</span>
        <span style={{ fontSize: 9, color: 'var(--color-text-dim)' }}>Is NDI Runtime installed?</span>
      </div>
    );
  }

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', background: '#000', overflow: 'hidden' }}>
      <img
        src={src}
        onError={handleError}
        onLoad={handleLoad}
        style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
      />
      {fps > 0 && (
        <div style={fpsBadge}>{fps} fps</div>
      )}
      {border && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 2, pointerEvents: 'none', boxSizing: 'border-box',
          border: `${widget.borderWidth}px solid ${widget.borderColor ?? '#ffffff'}`,
        }} />
      )}
    </div>
  );
}

const overlay: React.CSSProperties = {
  width: '100%', height: '100%',
  display: 'flex', flexDirection: 'column',
  alignItems: 'center', justifyContent: 'center', gap: 8,
  background: '#000', color: 'var(--color-text-dim)', fontSize: 12,
};

const fpsBadge: React.CSSProperties = {
  position: 'absolute', top: 6, left: 6,
  background: 'rgba(0,0,0,0.55)',
  color: '#fff',
  fontSize: 10,
  fontFamily: 'monospace',
  padding: '2px 5px',
  borderRadius: 2,
  pointerEvents: 'none',
  userSelect: 'none',
};

function NdiIcon() {
  return (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <path d="M8 21h8M12 17v4M2 8h4M18 8h4" />
    </svg>
  );
}
