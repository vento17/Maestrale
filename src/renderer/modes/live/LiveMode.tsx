import React, { useEffect, useState, useCallback } from 'react';
import { useStore, useActivePage, useProject } from '../../store';
import { GLOBAL_BAR_HEIGHT } from '../GlobalBar';
import LiveCanvas from './LiveCanvas';
import LiveSidebar from './LiveSidebar';
import RouterEngine from './RouterEngine';
import MasterEngine from './MasterEngine';
import PatchLayer from './PatchLayer';
import { bridge } from '../../ipc/bridge';
import { artnetConfigOutputs, sacnConfigOutputs, oscConfigOutputs, midiConfigOutputs } from '../../../shared/outputs';

const SIDEBAR_WIDTH = 248;

export default function LiveMode(): React.JSX.Element {
  const setMode              = useStore((s) => s.setMode);
  const initRuntime          = useStore((s) => s.initRuntime);
  const liveSidebarOpen      = useStore((s) => s.liveSidebarOpen);
  const setLiveSelectedWidgetId = useStore((s) => s.setLiveSelectedWidgetId);
  const hoverInfo            = useStore((s) => s.hoverInfo);
  const page                 = useActivePage();
  const project              = useProject();
  const [scale, setScale]    = useState(1);

  // Enter fullscreen on mount, exit on unmount
  useEffect(() => {
    bridge.invoke('tr:window:fullscreen', true).catch(() => {});
    // Leaving Live keeps full screen: LiveForge starts full screen and F11 is
    // the way out.
  }, []);

  // Runtime covers EVERY page's widgets (not just the active one) so cross-page
  // router links have their source/slave cells available regardless of which
  // page is shown. initRuntime merges existing values, so re-running is safe.
  useEffect(() => {
    initRuntime(project.pages.flatMap((p) => p.widgets));
  }, [project.pages, initRuntime]);

  // Connections are opened ONCE per Live session, not per page.
  //
  // This effect used to be keyed on the active page id. ArtNetService and
  // SacnService.configure() both start by closing the UDP socket and clearing
  // every held universe/channel — so each page change tore the DMX stream down
  // and threw away all current levels. OSC/MIDI got rebound the same way.
  useEffect(() => {
    const conns = project.connections;
    const midi   = conns.find((c) => c.type === 'midi');
    const osc    = conns.find((c) => c.type === 'osc');
    const artnet = conns.find((c) => c.type === 'artnet');
    const sacn   = conns.find((c) => c.type === 'sacn');

    if (midi && midi.type === 'midi' && midi.portName) {
      bridge.invoke('tr:midi:openPort', { portName: midi.portName, virtual: midi.virtualPort ?? false, extraOutputs: midiConfigOutputs(midi) }).catch(() => {});
    }

    if (osc && osc.type === 'osc' && osc.targetHost) {
      bridge.invoke('tr:osc:configure', {
        targetHost: osc.targetHost,
        targetPort: osc.targetPort ?? 8000,
        listenPort: osc.listenPort ?? 9000,
        outputs: oscConfigOutputs(osc),
        extraListenPorts: osc.extraListenPorts ?? [],
      }).catch(() => {});
    }
    if (artnet && artnet.type === 'artnet' && artnet.targetHost) {
      bridge.invoke('tr:artnet:configure', { outputs: artnetConfigOutputs(artnet) }).catch(() => {});
    }
    if (sacn && sacn.type === 'sacn') {
      bridge.invoke('tr:sacn:configure', {
        priority: sacn.priority ?? 100,
        outputs:  sacnConfigOutputs(sacn),
      }).catch(() => {});
    }
  }, [project.connections]);

  // Compute scale to fit design canvas into the available space
  const computeScale = useCallback(() => {
    if (!page) return;
    const availWidth = liveSidebarOpen
      ? window.innerWidth - SIDEBAR_WIDTH
      : window.innerWidth;
    const scaleX = availWidth / page.width;
    const scaleY = (window.innerHeight - GLOBAL_BAR_HEIGHT) / page.height;
    setScale(Math.min(scaleX, scaleY));
  }, [page, liveSidebarOpen]);

  useEffect(() => {
    computeScale();
    window.addEventListener('resize', computeScale);
    return () => window.removeEventListener('resize', computeScale);
  }, [computeScale]);

  // ESC exits Live mode
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMode('design');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setMode]);

  if (!page) {
    return (
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-dim)' }}>
        No page available
      </div>
    );
  }

  return (
    <div style={{
      width: '100%', height: '100%',
      display: 'flex',
      overflow: 'hidden',
      background: '#000',
      position: 'relative',
    }}>
      {/* Global engines — run across all pages (cross-page links & master gains) */}
      <RouterEngine />
      <MasterEngine />
      {/* Hold Shift: drag cables from outputs to controls to link them. */}
      <PatchLayer />

      {/* Canvas fills remaining space.
          EVERY page stays mounted, not just the visible one. A widget only
          streams while its component is alive, so unmounting hidden pages
          silently stopped their LFOs, sequencers, timelines and every router
          source living on them the moment you switched page. Inactive pages are
          taken out of flow and hidden, but still laid out — visibility:hidden
          (rather than display:none) keeps element measurements valid for
          widgets that size themselves off the DOM. */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', position: 'relative' }}>
        {project.pages.map((p) => {
          const isActive = p.id === page.id;
          // Every page renders through the SAME wrapper element, active or not —
          // only the style differs. Swapping between two different element
          // shapes made React tear the subtree down and rebuild it on every page
          // change, which stopped a running timeline and reset every LFO phase.
          return (
            <div
              key={p.id}
              aria-hidden={!isActive}
              style={isActive ? { flexShrink: 0 } : {
                position: 'absolute', top: 0, left: 0,
                visibility: 'hidden', pointerEvents: 'none', zIndex: -1,
              }}
            >
              <LiveCanvas
                page={p}
                scale={scale}
                active={isActive}
                onSelectWidget={isActive ? setLiveSelectedWidgetId : undefined}
              />
            </div>
          );
        })}
      </div>

      {/* Collapsible sidebar — after the canvas so it sits on the right edge,
          where a hand resting on the screen is less likely to cover the show. */}
      {liveSidebarOpen && <LiveSidebar />}

      {/* Hover info bar — shows the widget/cell under the cursor so per-cell
          labels can be turned off to keep widgets compact. */}
      {hoverInfo && (
        <div style={{
          position: 'fixed', bottom: 6, left: 8, right: 8, height: 22,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          pointerEvents: 'none', zIndex: 180,
        }}>
          <div style={{
            background: 'rgba(0,0,0,0.72)', border: '1px solid #2a2a2a', borderRadius: 11,
            padding: '2px 12px', fontSize: 11, color: '#cfcfcf', fontFamily: 'monospace',
            maxWidth: '80%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {hoverInfo}
          </div>
        </div>
      )}
    </div>
  );
}
