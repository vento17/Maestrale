import React, { useState } from 'react';
import { nanoid } from 'nanoid';
import type { EncoderWidget, EncoderDef, EncoderFormat, EncoderMidiMode } from '../../../shared/types/project';
import { useProject } from '../../store';
import { listOutputs } from '../../../shared/outputs';
import { PRIMARY_OUTPUT_ID } from '../../../shared/types/project';
import { ENCODER_PRESETS } from './encoderOut';

// Encoder settings — the same panel in Design (Settings) and in Live (right bar).

const lbl: React.CSSProperties = { fontSize: 10, letterSpacing: 1, color: '#777', textTransform: 'uppercase', margin: '10px 0 4px' };
const inp: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', background: '#111', border: '1px solid #2a2a2a', color: '#ccc',
  borderRadius: 3, padding: '4px 6px', fontSize: 12, fontFamily: 'inherit',
};
const hint: React.CSSProperties = { fontSize: 11, color: '#666', lineHeight: 1.5, marginTop: 4 };
const MAX_ENCODERS = 16;

export default function EncoderSettings({ w, update }: { w: EncoderWidget; update: (p: Partial<EncoderWidget>) => void }): React.JSX.Element {
  const project = useProject();
  const [preset, setPreset] = useState('');
  const outs = listOutputs(project.connections, w.format === 'midi' ? 'midi' : 'osc');
  const setEnc = (id: string, p: Partial<EncoderDef>) => update({ encoders: w.encoders.map((e) => (e.id === id ? { ...e, ...p } : e)) });
  const num = (v: string, min: number, max: number, dflt: number) => {
    const n = Number(v.replace(',', '.'));
    return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : dflt;
  };
  const p = ENCODER_PRESETS.find((x) => x.id === preset);

  return (
    <div style={{ fontFamily: 'inherit' }}>
      <div style={lbl}>Eos user</div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <input key={`us${w.user}`} className="lf-no-spin" type="number" min={0} max={99} style={{ ...inp, width: 90 }} defaultValue={w.user ?? 0}
          onBlur={(e) => update({ user: Math.round(num(e.target.value, 0, 99, 0)) })} />
        <span style={{ fontSize: 11, color: '#777' }}>{w.user ? `/eos/user/${w.user}/…` : '0 = like the console'}</span>
      </div>
      <div style={hint}>Only for /eos/… addresses: a user of its own so this widget does not fight the operator's selection.</div>

      <div style={lbl}>Desk preset</div>
      <div style={{ display: 'flex', gap: 6 }}>
        <select style={inp} value={preset} onChange={(e) => setPreset(e.target.value)}>
          <option value="">— choose —</option>
          {ENCODER_PRESETS.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
        </select>
        <button disabled={!p} onClick={() => { if (p) update(p.apply(w)); }}
          style={{ ...inp, width: 'auto', cursor: p ? 'pointer' : 'default', color: p ? 'var(--lf-aqua)' : '#555', whiteSpace: 'nowrap' }}>Apply</button>
      </div>
      {p && <div style={hint}>{p.hint} Applying sets the format and the addresses of every encoder.</div>}

      <div style={lbl}>Sends</div>
      <select style={inp} value={w.format} onChange={(e) => update({ format: e.target.value as EncoderFormat })}>
        <option value="oscDelta">OSC number — the change, e.g. +3 / −1</option>
        <option value="oscText">OSC text — a command with the change in it</option>
        <option value="oscIncDec">OSC up / down — one message per tick</option>
        <option value="midi">MIDI CC relative</option>
      </select>

      {(w.format === 'oscDelta' || w.format === 'oscText') && (
        <div style={{ display: 'flex', gap: 6 }}>
          <div style={{ flex: 1 }}>
            <div style={lbl}>Amount per tick</div>
            <input style={inp} defaultValue={w.step} key={`st${w.step}`} onBlur={(e) => update({ step: num(e.target.value, 0.0001, 10000, 1) })} />
          </div>
          {w.format === 'oscDelta' && (
            <div style={{ flex: 1 }}>
              <div style={lbl}>Number type</div>
              <select style={inp} value={w.argType ?? 'f'} onChange={(e) => update({ argType: e.target.value as 'f' | 'i' })}>
                <option value="f">float</option>
                <option value="i">integer</option>
              </select>
            </div>
          )}
        </div>
      )}
      {w.format === 'midi' && (
        <>
          <div style={lbl}>Encoding</div>
          <select style={inp} value={w.midiMode ?? 'offset64'} onChange={(e) => update({ midiMode: e.target.value as EncoderMidiMode })}>
            <option value="offset64">64 centre — 65 = +1, 63 = −1</option>
            <option value="twos">Two's complement — 1 = +1, 127 = −1</option>
            <option value="signBit">Sign bit — 1 = +1, 65 = −1</option>
          </select>
        </>
      )}

      <div style={{ display: 'flex', gap: 6 }}>
        <div style={{ flex: 1 }}>
          <div style={lbl}>Ticks per turn</div>
          <input style={inp} defaultValue={w.ticksPerTurn} key={`tp${w.ticksPerTurn}`} onBlur={(e) => update({ ticksPerTurn: Math.round(num(e.target.value, 1, 1024, 64)) })} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={lbl}>Output</div>
          <select style={inp} value={w.outputId || PRIMARY_OUTPUT_ID} onChange={(e) => update({ outputId: e.target.value === PRIMARY_OUTPUT_ID ? '' : e.target.value })}>
            {outs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </div>
      </div>
      <div style={lbl}>Acceleration · {Math.round((w.acceleration ?? 0) * 100)}%</div>
      <input type="range" min={0} max={1} step={0.05} value={w.acceleration ?? 0} style={{ width: '100%' }}
        onChange={(e) => update({ acceleration: Number(e.target.value) })} />
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#aaa', marginTop: 6, cursor: 'pointer' }}>
        <input type="checkbox" checked={!!w.invert} onChange={(e) => update({ invert: e.target.checked })} /> Invert direction
      </label>

      <div style={lbl}>Encoders ({w.encoders.length})</div>
      {w.encoders.map((e, i) => (
        <div key={e.id} style={{ border: '1px solid #1e1e1e', borderRadius: 4, padding: 6, marginBottom: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ display: 'flex', gap: 4 }}>
            <input style={{ ...inp, flex: 1 }} value={e.label} placeholder={`Enc ${i + 1}`} onChange={(ev) => setEnc(e.id, { label: ev.target.value })} />
            <button title="Remove" disabled={w.encoders.length <= 1}
              onClick={() => update({ encoders: w.encoders.filter((x) => x.id !== e.id) })}
              style={{ ...inp, width: 26, padding: 0, cursor: w.encoders.length > 1 ? 'pointer' : 'default', color: '#888' }}>✕</button>
          </div>
          {w.format === 'midi' ? (
            <div style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: 11, color: '#777' }}>
              ch <input style={{ ...inp, width: 46 }} defaultValue={e.midiChannel ?? 1} key={`ch${e.midiChannel}`} onBlur={(ev) => setEnc(e.id, { midiChannel: Math.round(num(ev.target.value, 1, 16, 1)) })} />
              CC <input style={{ ...inp, width: 56 }} defaultValue={e.midiCc ?? 0} key={`cc${e.midiCc}`} onBlur={(ev) => setEnc(e.id, { midiCc: Math.round(num(ev.target.value, 0, 127, 0)) })} />
            </div>
          ) : (
            <>
              <input style={inp} value={e.address} placeholder={w.format === 'oscIncDec' ? 'address for +' : '/address'} onChange={(ev) => setEnc(e.id, { address: ev.target.value })} />
              {w.format === 'oscIncDec' && (
                <input style={inp} value={e.addressDec ?? ''} placeholder="address for −" onChange={(ev) => setEnc(e.id, { addressDec: ev.target.value })} />
              )}
              {w.format === 'oscText' && (
                <input style={inp} value={e.text ?? ''} placeholder='Attribute "Dimmer" At {dir} {abs}' onChange={(ev) => setEnc(e.id, { text: ev.target.value })} />
              )}
            </>
          )}
        </div>
      ))}
      <button disabled={w.encoders.length >= MAX_ENCODERS}
        onClick={() => update({ encoders: [...w.encoders, { id: nanoid(), label: `Enc ${w.encoders.length + 1}`, address: `/enc/${w.encoders.length + 1}`, midiChannel: 1, midiCc: 20 + w.encoders.length }] })}
        style={{ ...inp, cursor: 'pointer', color: 'var(--lf-aqua)' }}>＋ Add encoder</button>
      {w.format === 'oscText' && <div style={hint}>In the text, {'{d}'} becomes +3 / -3, {'{abs}'} becomes 3, {'{dir}'} becomes + or −.</div>}
      <div style={hint}>
        Sends only the change, never a value: the desk keeps its own, so nothing jumps. Drag up or right for +, down or left for −,
        or use the mouse wheel; Ctrl = fine. Presets are a starting point — check names and prefixes in the desk's manual.
      </div>
    </div>
  );
}
