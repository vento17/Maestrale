import React from 'react';
import type { DmxMonitorWidget } from '../../../shared/types/project';
import DmxMonitorLive from './DmxMonitorLive';

// Design mode: the same grid, empty and inert.
export default function DmxMonitorDesign({ widget }: { widget: DmxMonitorWidget }): React.JSX.Element {
  return <div style={{ width: '100%', height: '100%', pointerEvents: 'none' }}><DmxMonitorLive widget={widget} preview /></div>;
}
