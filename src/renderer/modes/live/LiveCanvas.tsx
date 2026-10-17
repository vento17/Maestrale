import React from 'react';
import type { Widget, Page } from '../../../shared/types/project';
import LiveWidgetInner from './LiveWidgetInner';
import WidgetChrome from '../../widgets/base/WidgetChrome';
import { useStore } from '../../store';

function LiveWidget({ widget, onSelect }: { widget: Widget; onSelect?: (id: string) => void }): React.JSX.Element {
  const isPassthrough = widget.kind === 'imageWidget' || widget.kind === 'textWidget';

  return (
    <WidgetChrome
      style={widget.style}
      label={widget.label}
      outerStyle={{
        position: 'absolute',
        left: widget.rect.x,
        top: widget.rect.y,
        width: widget.rect.width,
        height: widget.rect.height,
        pointerEvents: isPassthrough ? 'none' : undefined,
      }}
      data-lf-patch={widget.id}
      // In the capture phase: touching ANY part of the widget shows its
      // parameters on the right — its own toolbar, an empty corner, a control
      // that stops the event for itself (a sketch's bar, a cue list…).
      onPointerDownCapture={() => onSelect?.(widget.id)}
      onMouseMove={() => useStore.getState().setHoverInfo(`${widget.label} · ${widget.kind}`)}
      onMouseLeave={() => useStore.getState().setHoverInfo(null)}
    >
      <LiveWidgetInner widget={widget} />
    </WidgetChrome>
  );
}

function getLayer(w: Widget): 'under' | 'normal' | 'over' {
  if (w.kind === 'imageWidget' || w.kind === 'textWidget') return w.layer;
  return 'normal';
}

interface LiveCanvasProps {
  page: Page;
  scale: number;
  // Inactive pages stay mounted (so their widgets keep streaming) but hidden.
  // Only the visible one may carry the id NetworkLive measures.
  active?: boolean;
  onSelectWidget?: (id: string) => void;
}

export default function LiveCanvas({ page, scale, active = true, onSelectWidget }: LiveCanvasProps): React.JSX.Element {
  const offsetX = page.liveOffsetX ?? 0;
  const offsetY = page.liveOffsetY ?? 0;

  return (
    // Outer div sized to scaled dimensions — flex parent will center this.
    // id lets NetworkLive measure the exact on-screen page rect for click mapping.
    <div id={active ? 'lf-page-canvas' : undefined} style={{
      width: page.width * scale,
      height: page.height * scale,
      flexShrink: 0,
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* Inner div: actual page content at natural size, scaled from top-left */}
      <div style={{
        position: 'absolute',
        top: offsetY,
        left: offsetX,
        width: page.width,
        height: page.height,
        transform: `scale(${scale})`,
        transformOrigin: 'top left',
        background: page.backgroundColor,
      }}>
        {(['under', 'normal', 'over'] as const).flatMap((layer) =>
          page.widgets
            .filter((w) => getLayer(w) === layer)
            .sort((a, b) => a.zIndex - b.zIndex)
            .map((widget) => <LiveWidget key={widget.id} widget={widget} onSelect={onSelectWidget} />)
        )}
      </div>
    </div>
  );
}
