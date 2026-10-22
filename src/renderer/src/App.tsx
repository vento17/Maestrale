import React, { useEffect, useSyncExternalStore } from 'react';
import { onPalette, paletteVersion, setPalette, DEFAULT_PALETTE } from '../palette';
import { useMode, useProject, useStore } from '../store';
import { bridge } from '../ipc/bridge';
import type { MidiConnection, MidiInputConnection, OscConnection, ArtNetConnection, ArtNetInputConnection, SacnInputConnection, SacnConnection, EnttecDmxConnection } from '../../shared/types/project';
import { artnetConfigOutputs, sacnConfigOutputs, oscConfigOutputs, midiConfigOutputs } from '../../shared/outputs';
import DesignMode from '../modes/design/DesignMode';
import LiveMode from '../modes/live/LiveMode';
import GlobalBar from '../modes/GlobalBar';
import LogConsole from '../modes/LogConsole';
import LearnModeLayer from '../modes/LearnModeLayer';
import RouterPage from '../modes/router/RouterPage';
import { parseUniverses } from '../ipc/dmxTakes';
import Recovery from '../modes/Recovery';
import CrashScreen from '../modes/CrashScreen';

export default function App(): React.JSX.Element {
  const mode    = useMode();
  const project = useProject();
  // Has Live been opened in this run? From then on it stays mounted (hidden
  // behind Design), so nothing in it resets when you go to Edit and back.
  const [liveEver, setLiveEver] = React.useState(mode === 'live');
  useEffect(() => { if (mode === 'live') setLiveEver(true); }, [mode]);
  // A palette change redraws the interface: everything below is re-mounted
  // (as switching mode already does) — except Recovery, which opens projects.
  const pv = useSyncExternalStore(onPalette, paletteVersion);
  // The project carries its palette: opening it anywhere shows its colours.
  const pal = project.palette;
  useEffect(() => { setPalette(pal ?? DEFAULT_PALETTE); }, [pal?.accent, pal?.highlight]);

  // Enter in a field = done. Most fields take the value when they lose focus,
  // which meant reaching for the mouse after typing a number; now Enter leaves
  // the field (and so commits it) wherever the field has not already handled
  // the key itself.
  useEffect(() => {
    const onEnter = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || e.defaultPrevented || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (!t || t.tagName !== 'INPUT') return;                     // textareas keep their newlines
      const type = (t as HTMLInputElement).type;
      if (type === 'checkbox' || type === 'radio' || type === 'button') return;
      t.blur();
    };
    window.addEventListener('keydown', onEnter);
    return () => window.removeEventListener('keydown', onEnter);
  }, []);

  // Ctrl+Z anywhere: undoes the last change to the project — a line drawn or
  // cleared on a Sketch, a cue recorded, a colour edited, a widget moved…
  // Design mode's canvas has its own (it also handles copy / paste), so this
  // one steps aside when that has already taken the key.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'z') return;
      if (e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName?.toLowerCase() ?? '';
      if (tag === 'input' || tag === 'textarea' || t?.isContentEditable) return;
      e.preventDefault();
      useStore.getState().undo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Connect what the project says was connected when it was saved / closed
  // (Connect pressed). Re-runs when a connection is edited. A protocol you
  // disconnected stays off; an older project without that record connects
  // everything that is configured, as before.
  useEffect(() => {
    const conns = project.connections;
    const st = useStore.getState();
    const was = st.project.connected;
    const want = (k: string) => was?.[k] !== false;
    const mark = (k: string) => (res: { ok?: boolean } | undefined) => { if (res?.ok) useStore.getState().setConnectedProtocol(k, true); };
    // A different project: forget the old one's lights.
    for (const k of Object.keys(st.connectedProtocols)) if (was?.[k] === false) st.setConnectedProtocol(k, false);

    const midi = conns.find((c) => c.type === 'midi') as MidiConnection | undefined;
    if (midi?.portName && want('midi'))
      bridge.invoke('tr:midi:openPort', { portName: midi.portName, virtual: midi.virtualPort, extraOutputs: midiConfigOutputs(midi) }).then(mark('midi')).catch(() => {});

    const midiIn = conns.find((c) => c.type === 'midiInput') as MidiInputConnection | undefined;
    if (midiIn?.portName && want('midiInput'))
      bridge.invoke('tr:midi:openInputPort', { portName: midiIn.portName, extraPorts: midiIn.extraPorts ?? [] }).then(mark('midiInput')).catch(() => {});

    const osc = conns.find((c) => c.type === 'osc') as OscConnection | undefined;
    if (osc?.targetHost && want('osc'))
      bridge.invoke('tr:osc:configure', {
        targetHost: osc.targetHost,
        targetPort: osc.targetPort ?? 8000,
        listenPort: osc.listenPort ?? 9000,
        outputs: oscConfigOutputs(osc),
        extraListenPorts: osc.extraListenPorts ?? [],
      }).then(mark('osc')).catch(() => {});

    const artnet = conns.find((c) => c.type === 'artnet') as ArtNetConnection | undefined;
    if (artnet?.targetHost && want('artnet'))
      bridge.invoke('tr:artnet:configure', { outputs: artnetConfigOutputs(artnet) }).then(mark('artnet')).catch(() => {});

    const sacn = conns.find((c) => c.type === 'sacn') as SacnConnection | undefined;
    if (sacn && want('sacn'))
      bridge.invoke('tr:sacn:configure', {
        priority: sacn.priority ?? 100,
        outputs:  sacnConfigOutputs(sacn),
      }).then(mark('sacn')).catch(() => {});

    const enttec = conns.find((c) => c.type === 'enttecDmx') as EnttecDmxConnection | undefined;
    if (enttec && was?.enttec === true)
      bridge.invoke('tr:enttec:connect', { deviceIndex: enttec.deviceIndex ?? 0 }).then(mark('enttec')).catch(() => {});
  }, [project.connections]);

  // Art-Net input has its own effect: restarting the listener drops every
  // universe it knew, so it must not restart when an unrelated connection
  // (an OSC port, say) is edited.
  const artnetIn = project.connections.find((c) => c.type === 'artnetInput') as ArtNetInputConnection | undefined;
  const artnetInKey = artnetIn?.enabled ? `on:${artnetIn.bindHost ?? ''}|${artnetIn.universes ?? '0'}` : 'off';
  useEffect(() => {
    if (artnetInKey === 'off') {
      bridge.invoke('tr:artnet:stopListen', undefined).catch(() => {});
      return;
    }
    const [bindHost, uni] = artnetInKey.slice(3).split('|');
    const universes = parseUniverses(uni);
    bridge.invoke('tr:artnet:listen', { bindHost, universes: universes.length ? universes : [0] }).then((res) => {
      if (res && !res.ok && res.error !== 'superseded') useStore.getState().addLog('error', `Art-Net input: ${res.error ?? 'cannot listen on 6454'}`);
    }).catch(() => {});
  }, [artnetInKey]);

  // sACN input, same pattern: restarts only when its own settings change.
  const sacnIn = project.connections.find((c) => c.type === 'sacnInput') as SacnInputConnection | undefined;
  const sacnInKey = sacnIn?.enabled ? `on:${sacnIn.bindHost ?? ''}|${sacnIn.universes ?? '1'}` : 'off';
  useEffect(() => {
    if (sacnInKey === 'off') {
      bridge.invoke('tr:sacn:stopListen', undefined).catch(() => {});
      return;
    }
    const [bindHost, uni] = sacnInKey.slice(3).split('|');
    const universes = parseUniverses(uni).filter((u) => u >= 1);
    bridge.invoke('tr:sacn:listen', { bindHost, universes: universes.length ? universes : [1] }).then((res) => {
      if (res && !res.ok && res.error !== 'superseded') useStore.getState().addLog('error', `sACN input: ${res.error ?? 'cannot listen on 5568'}`);
    }).catch(() => {});
  }, [sacnInKey]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <GlobalBar key={`gb${pv}`} />
      <LearnModeLayer key={`lm${pv}`} />
      {/* Only the mode content is wrapped: a crash in a widget must not take the
          top bar with it, or there is no way to save what survived. */}
      <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
        {/* Live stays mounted once it has been opened: going to Edit hides it
            instead of tearing it down, so every fader, LFO phase, timeline
            position and running sound is exactly where you left it when you
            come back — the show keeps running behind the editor. Design is
            mounted only while editing. */}
        {mode === 'design' && (
          <CrashScreen key={`design:${pv}`}>
            <DesignMode />
          </CrashScreen>
        )}
        {liveEver && (
          <div aria-hidden={mode !== 'live'} style={mode === 'live'
            ? { position: 'absolute', inset: 0 }
            : { position: 'absolute', inset: 0, visibility: 'hidden', pointerEvents: 'none', zIndex: -1 }}>
            <CrashScreen key={`live:${pv}`}>
              <LiveMode />
            </CrashScreen>
          </div>
        )}
      </div>
      <RouterPage key={`rp${pv}`} />
      <Recovery />
      <LogConsole key={`lc${pv}`} />
    </div>
  );
}
