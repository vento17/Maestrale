import React, { useState } from 'react';
import type { EtcWidget } from '../../../shared/types/project';
import { PRIMARY_OUTPUT_ID } from '../../../shared/types/project';
import { useProject } from '../../store';
import { listOutputs } from '../../../shared/outputs';
import { ETC_KEYS } from './etcLayout';
import { startEosWheels, onEosWheels, allWheels, wheelName, wheelGainOf, userGains, saveUserGains } from './eosWheels';
import { gmAddresses, sendFaderConfig, sendGm } from './EtcLive';

// ETC widget settings — same panel in Design (Settings) and Live (right bar).

const lbl: React.CSSProperties = { fontSize: 10, letterSpacing: 1, color: '#777', textTransform: 'uppercase', margin: '10px 0 4px' };
const inp: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', background: '#111', border: '1px solid #2a2a2a', color: '#ccc',
  borderRadius: 3, padding: '4px 6px', fontSize: 12, fontFamily: 'inherit',
};

export default function EtcSettings({ w, update }: { w: EtcWidget; update: (p: Partial<EtcWidget>) => void }): React.JSX.Element {
  const project = useProject();
  const outs = listOutputs(project.connections, 'osc');
  const [q, setQ] = useState('');
  const [onlyGuess, setOnlyGuess] = useState(false);
  const [, setTick] = useState(0);
  React.useEffect(() => { startEosWheels(); return onEosWheels(() => setTick((t) => t + 1)); }, []);
  const wheels = allWheels();
  const ov = w.keyOverrides ?? {};
  const setKey = (id: string, v: string) => {
    const next = { ...ov };
    if (!v.trim() || v.trim() === id) delete next[id]; else next[id] = v.trim();
    update({ keyOverrides: next });
  };
  const num = (v: string, min: number, max: number, d: number) => {
    const n = Number(v.replace(',', '.'));
    return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : d;
  };
  const list = ETC_KEYS.filter((k) => (!onlyGuess || (k.guess && !(k.id in ov)))
    && (!q || k.label.toLowerCase().includes(q.toLowerCase()) || (ov[k.id] ?? k.id).toLowerCase().includes(q.toLowerCase())));

  return (
    <div>
      <div style={lbl}>Output</div>
      <select style={inp} value={w.outputId || PRIMARY_OUTPUT_ID} onChange={(e) => update({ outputId: e.target.value === PRIMARY_OUTPUT_ID ? '' : e.target.value })}>
        {outs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
      </select>

      <div style={lbl}>Eos user</div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <input key={`us${w.user}`} className="lf-no-spin" type="number" min={0} max={99} style={{ ...inp, width: 90 }} defaultValue={w.user ?? 0}
          onBlur={(e) => update({ user: Math.round(num(e.target.value, 0, 99, 0)) })} />
        <span style={{ fontSize: 11, color: '#777', lineHeight: 1.4 }}>
          {w.user ? `sends as user ${w.user} — /eos/user/${w.user}/…` : '0 = the same user as the console'}
        </span>
      </div>
      <div style={{ fontSize: 11, color: '#777', lineHeight: 1.5, marginTop: 4 }}>
        A user of its own gives this widget its own selection and command line on the desk, so you and whoever is at the
        console do not take each other's channels. Set the same number in Eos (Setup → User ID) if you want to see it there.
      </div>

      <button onClick={() => update({ hideOsc: !w.hideOsc })}
        style={{ ...inp, marginTop: 8, cursor: 'pointer', textAlign: 'left', color: w.hideOsc ? '#777' : 'var(--lf-aqua)', borderColor: w.hideOsc ? '#2a2a2a' : 'var(--lf-aqua)' }}>
        {w.hideOsc ? '○ OSC names on keys: hidden' : '● OSC names on keys: shown'}
      </button>

      <div style={lbl}>Key prefix</div>
      <input style={inp} defaultValue={w.keyPrefix} key={`kp${w.keyPrefix}`} onBlur={(e) => update({ keyPrefix: e.target.value.trim() || '/eos/key' })} />

      <div style={lbl}>Encoders ({'{n}'} = 1…4)</div>
      <input style={inp} defaultValue={w.encoderAddress} key={`ea${w.encoderAddress}`} onBlur={(e) => update({ encoderAddress: e.target.value.trim() || '/eos/active/wheel/fine/{n}' })} />
      <div style={{ display: 'flex', gap: 6 }}>
        <div style={{ flex: 1 }}>
          <div style={lbl}>Ticks per turn</div>
          <input style={inp} defaultValue={w.ticksPerTurn} key={`tp${w.ticksPerTurn}`} onBlur={(e) => update({ ticksPerTurn: Math.round(num(e.target.value, 1, 10000, 100)) })} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={lbl}>Acceleration · {Math.round((w.acceleration ?? 0) * 100)}%</div>
          <input type="range" min={0} max={1} step={0.05} value={w.acceleration ?? 0} style={{ width: '100%' }} onChange={(e) => update({ acceleration: Number(e.target.value) })} />
        </div>
      </div>

      <div style={lbl}>Level wheel</div>
      <input style={inp} defaultValue={w.levelWheelAddress ?? '/eos/wheel/level'} key={`lw${w.levelWheelAddress}`} onBlur={(e) => update({ levelWheelAddress: e.target.value.trim() || '/eos/wheel/level' })} />

      <div style={lbl}>Master faders</div>
      {[0, 1].map((i) => (
        <input key={`f${i}${w.faderAddresses?.[i]}`} style={{ ...inp, marginBottom: 4 }} defaultValue={w.faderAddresses?.[i] ?? ''}
          onBlur={(e) => { const f: [string, string] = [...(w.faderAddresses ?? ['', ''])] as [string, string]; f[i] = e.target.value.trim(); update({ faderAddresses: f }); }} />
      ))}

      <div style={lbl}>Grandmaster fader</div>
      <input key={`ga${w.gmAddress}`} style={inp} defaultValue={gmAddresses(w).level}
        onBlur={(e) => update({ gmAddress: e.target.value.trim() })} />
      <div style={{ fontSize: 11, color: '#777', lineHeight: 1.5, marginTop: 4 }}>
        Set the Grandmaster on a fader page in Eos: fader 10/10 is fader 100, so create fader 100, set it as the GM and go!
        {gmAddresses(w).config && <> Maestrale sends <span style={{ color: 'var(--lf-aqua)' }}>{gmAddresses(w).config}</span> first.</>}
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
        <button style={{ ...inp, width: 'auto', padding: '4px 10px', cursor: 'pointer', color: 'var(--lf-aqua)' }}
          title="Send it now — watch Eos Tab 99 (Diagnostics)"
          onClick={() => { sendFaderConfig(w, gmAddresses(w).config); setTimeout(() => sendGm(w, 1), 150); }}>Test: full</button>
        <button style={{ ...inp, width: 'auto', padding: '4px 10px', cursor: 'pointer' }}
          onClick={() => { sendFaderConfig(w, gmAddresses(w).config); setTimeout(() => sendGm(w, 0), 150); }}>Test: zero</button>
      </div>

      <div style={lbl}>Wheels Eos reports ({wheels.length})</div>
      {wheels.length === 0 ? null : (
        <div style={{ maxHeight: 220, overflowY: 'auto', fontSize: 11, color: '#aaa', fontFamily: 'monospace' }}>
          <div style={{ color: '#777', marginBottom: 4, fontFamily: 'inherit' }}>Speed × per parameter — the encoder sends its ticks times this (kept by name for every fixture). Green = changed here (Save as default keeps it for every project).
            <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
              <button title="These speeds become the default on this computer: every ETC widget, every project, new ones too"
                onClick={() => { saveUserGains({ ...userGains(), ...(w.wheelGain ?? {}) }); update({ wheelGain: {} }); }}
                style={{ ...inp, width: 'auto', padding: '3px 8px', cursor: 'pointer', fontSize: 11, color: 'var(--lf-aqua)' }}>Save as default</button>
              {w.wheelGain && Object.keys(w.wheelGain).length > 0 && (
                <button onClick={() => update({ wheelGain: {} })} style={{ ...inp, width: 'auto', padding: '3px 8px', cursor: 'pointer', fontSize: 11 }}>Back to defaults</button>
              )}
            </div></div>
          {wheels.map((x) => {
            const name = wheelName(x.label);
            const g = wheelGainOf(w.wheelGain, x.label, x.category);
            const setG = (v: number) => update({ wheelGain: { ...(w.wheelGain ?? {}), [name]: Math.max(0.01, Math.min(1000, Math.round(v * 100) / 100)) } });
            return (
              <div key={x.index} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 0' }}>
                <span style={{ width: 22, color: '#666' }}>{x.index}</span>
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{x.label} <span style={{ color: '#555' }}>cat {x.category}</span></span>
                <button tabIndex={-1} onClick={() => setG(g > 10 ? g - 10 : g > 1 ? g - 1 : g / 2)} style={{ ...inp, width: 24, padding: 0, cursor: 'pointer' }}>−</button>
                <input key={`${name}${g}`} defaultValue={g} onBlur={(e) => setG(num(e.target.value, 0.01, 1000, g))}
                  onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                  style={{ ...inp, width: 44, padding: '2px 4px', textAlign: 'center', color: w.wheelGain?.[name] !== undefined ? 'var(--lf-aqua)' : '#ccc' }} />
                <button tabIndex={-1} onClick={() => setG(g >= 10 ? g + 10 : g >= 1 ? g + 1 : g * 2)} style={{ ...inp, width: 24, padding: 0, cursor: 'pointer' }}>＋</button>
              </div>
            );
          })}
        </div>
      )}

      <div style={lbl}>Keys ({ETC_KEYS.length})</div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6 }}>
        <input style={{ ...inp, flex: 1 }} placeholder="filter…" value={q} onChange={(e) => setQ(e.target.value)} />
        <label style={{ fontSize: 11, color: '#999', display: 'flex', gap: 4, alignItems: 'center', whiteSpace: 'nowrap', cursor: 'pointer' }}>
          <input type="checkbox" checked={onlyGuess} onChange={(e) => setOnlyGuess(e.target.checked)} /> to check
        </label>
      </div>
      <div style={{ maxHeight: 320, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 3 }}>
        {list.map((k) => {
          const unsure = k.guess && !(k.id in ov);
          return (
            <div key={k.id} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <span style={{ width: 92, flexShrink: 0, fontSize: 11, color: unsure ? '#e39d60' : '#aaa', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={unsure ? 'Name not confirmed' : undefined}>
                {unsure ? '? ' : ''}{k.label}
              </span>
              <input style={{ ...inp, padding: '2px 5px', fontSize: 11 }} defaultValue={ov[k.id] ?? k.id} key={`${k.id}:${ov[k.id] ?? ''}`}
                onBlur={(e) => setKey(k.id, e.target.value)} />
            </div>
          );
        })}
      </div>
      <div style={{ fontSize: 11, color: '#666', lineHeight: 1.5, marginTop: 6 }}>
        A key sends {w.keyPrefix}/name (1 on press, 0 on release); a name starting with / is sent as a full address.
        Keys marked ? are not in the Eos key list — check them on the desk.
      </div>
    </div>
  );
}
