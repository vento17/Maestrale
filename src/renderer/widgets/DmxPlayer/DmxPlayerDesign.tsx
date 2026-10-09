import React from 'react';
import type { DmxPlayerWidget } from '../../../shared/types/project';
import { useTakes, fmtTime } from '../../ipc/dmxTakes';
import { END_ICON, fmtFade } from '../base/playlist';

// Static design-mode preview: the playlist and how it will be sent.
export default function DmxPlayerDesign({ widget }: { widget: DmxPlayerWidget }): React.JSX.Element {
  const takes = useTakes();
  const fs = widget.style.fontSize || 13;
  const items = widget.items ?? [];
  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', boxSizing: 'border-box', fontFamily: 'monospace', overflow: 'hidden' }}>
      <div style={{ padding: '4px 8px', borderBottom: '1px solid #1e1e1e', fontSize: 9, fontWeight: 700, letterSpacing: 2, color: '#505050' }}>
        ◈ DMX PLAYER <span style={{ fontWeight: 400, letterSpacing: 0 }}>
          · {(widget.playProtocol ?? 'artnet') === 'sacn' ? 'sACN' : 'Art-Net'}{widget.universeOffset ? ` · U${widget.universeOffset > 0 ? '+' : ''}${widget.universeOffset}` : ''}
        </span>
      </div>
      <div style={{ flex: 1, padding: '4px 0', overflow: 'hidden' }}>
        {items.length === 0 && <div style={{ fontSize: 10, color: '#3a3a3a', fontStyle: 'italic', padding: '8px 10px' }}>no takes</div>}
        {items.map((it, k) => {
          const t = takes.find((x) => x.id === it.takeId);
          return (
            <div key={it.id} style={{ display: 'flex', gap: 6, padding: '3px 8px', fontSize: fs, color: '#777', whiteSpace: 'nowrap' }}>
              <span style={{ color: '#444', width: 14, textAlign: 'right' }}>{k + 1}</span>
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{t ? `${t.name} · ${fmtTime(t.durationMs)}` : '— no take —'}</span>
              <span style={{ color: '#666' }}>{END_ICON[it.end ?? 'stop']} ↗{fmtFade(it.fade ?? 0)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
