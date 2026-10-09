import React, { useEffect, useSyncExternalStore } from 'react';
import { onPalette, paletteVersion } from '../palette';
import { useMode, useProject, useStore } from '../store';
import { bridge } from '../ipc/bridge';
import type { MidiConnection, MidiInputConnection, OscConnection, ArtNetConnection, ArtNetInputConnection, SacnInputConnection, SacnConnection } from '../../shared/types/project';
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
  // A palette change redraws the interface: everything below is re-mounted
  // (as switching mode already does) — except Recovery, which opens projects.
  const pv = useSyncExternalStore(onPalette, paletteVersion);

  // Auto-connect all configured services whenever the saved connections change.
  // This fires on first render (project load) and any time the user updates connections.
  useEffect(() => {
    const conns = project.connections;

    const midi = conns.find((c) => c.type === 'midi') as MidiConnection | undefined;
    if (midi?.portName)
      bridge.invoke('tr:midi:openPort', { portName: midi.portName, virtual: midi.virtualPort, extraOutputs: midiConfigOutputs(midi) }).catch(() => {});

    const midiIn = conns.find((c) => c.type === 'midiInput') as MidiInputConnection | undefined;
    if (midiIn?.portName)
      bridge.invoke('tr:midi:openInputPort', { portName: midiIn.portName, extraPorts: midiIn.extraPorts ?? [] }).catch(() => {});

    const osc = conns.find((c) => c.type === 'osc') as OscConnection | undefined;
    if (osc?.targetHost)
      bridge.invoke('tr:osc:configure', {
        targetHost: osc.targetHost,
        targetPort: osc.targetPort ?? 8000,
        listenPort: osc.listenPort ?? 9000,
        outputs: oscConfigOutputs(osc),
        extraListenPorts: osc.extraListenPorts ?? [],
      }).catch(() => {});

    const artnet = conns.find((c) => c.type === 'artnet') as ArtNetConnection | undefined;
    if (artnet?.targetHost)
      bridge.invoke('tr:artnet:configure', { outputs: artnetConfigOutputs(artnet) }).catch(() => {});

    const sacn = conns.find((c) => c.type === 'sacn') as SacnConnection | undefined;
    if (sacn)
      bridge.invoke('tr:sacn:configure', {
        priority: sacn.priority ?? 100,
        outputs:  sacnConfigOutputs(sacn),
      }).catch(() => {});
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
      <div style={{ flex: 1, overflow: 'hidden' }}>
        <CrashScreen key={`${mode}:${pv}`}>
          {mode === 'design' ? <DesignMode /> : <LiveMode />}
        </CrashScreen>
      </div>
      <RouterPage key={`rp${pv}`} />
      <Recovery />
      <LogConsole key={`lc${pv}`} />
    </div>
  );
}
