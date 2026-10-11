import React, { useRef, useState } from 'react';

// A right-hand column you can widen by dragging its left edge. It never gets
// narrower than its normal width, and opens at that width every time (the
// width is not remembered: close it and it comes back normal).
export default function ResizableColumn({ base, children }: { base: number; children: React.ReactNode }): React.JSX.Element {
  const [w, setW] = useState(base);
  const drag = useRef<{ x: number; w: number } | null>(null);
  return (
    <div style={{ position: 'relative', width: w, flexShrink: 0, height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div title="Drag to widen · double-click: back to normal"
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); drag.current = { x: e.clientX, w }; }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          const max = Math.max(base, window.innerWidth * 0.75);
          setW(Math.max(base, Math.min(max, drag.current.w + (drag.current.x - e.clientX))));
        }}
        onPointerUp={() => { drag.current = null; }}
        onPointerCancel={() => { drag.current = null; }}
        onDoubleClick={() => setW(base)}
        style={{ position: 'absolute', left: -4, top: 0, bottom: 0, width: 10, cursor: 'ew-resize', zIndex: 20, touchAction: 'none' }} />
      {children}
    </div>
  );
}
