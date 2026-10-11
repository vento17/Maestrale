import React from 'react';
import type { EncoderWidget } from '../../../shared/types/project';
import EncoderLive from './EncoderLive';

// Design preview: the same face, not turnable.
export default function EncoderDesign({ widget }: { widget: EncoderWidget }): React.JSX.Element {
  return <div style={{ width: '100%', height: '100%', pointerEvents: 'none' }}><EncoderLive widget={widget} /></div>;
}
