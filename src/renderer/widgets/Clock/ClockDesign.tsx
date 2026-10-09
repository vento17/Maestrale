import React from 'react';
import type { ClockWidget } from '../../../shared/types/project';
import ClockLive from './ClockLive';

// Design mode shows the real clock, but inert (no triggers, no editing on the
// canvas — that would fight the drag). Edit the times in the settings panel.
export default function ClockDesign({ widget }: { widget: ClockWidget }): React.JSX.Element {
  return <div style={{ width: '100%', height: '100%', pointerEvents: 'none' }}><ClockLive widget={widget} preview /></div>;
}
