import React, { useEffect, useRef, useState } from 'react';
import type { LfoWidget } from '../../../shared/types/project';
import type { MidiMapping, OscMapping } from '../../../shared/types/mapping';
import { useGlobalTransport } from '../base/useGlobalTransport';
import { useStore } from '../../store';
import { dispatchValue } from '../../ipc/dispatch';
import { bridge } from '../../ipc/bridge';
import { addLane, LaneBar } from '../base/phaseLanes';
import { getParamInput, freqFromInput, onParamInputs, LFO_SPEEDS, LFO_INPUTS } from '../base/paramInputs';
import CellLinkMenu from '../base/CellLinkMenu';
import { createPortal } from 'react-dom';
export { addLane, removeLane, setLanePhase } from '../base/phaseLanes';

// Smooth noise: a random value per whole cycle, eased into the next (value
// noise), plus finer octaves by roughness. Deterministic per widget (seed), so
// the same phase gives the same value — outputs spread by PHASE are delayed
// copies, like the LFO.
function hash01(i: number, seed: number): number {
  const x = Math.sin(i * 127.1 + seed * 311.7) * 43758.5453;
  return x - Math.floor(x);
}
function valueNoise(p: number, seed: number): number {
  const i = Math.floor(p), f = p - i;
  const u = f * f * (3 - 2 * f);
  return hash01(i, seed) * (1 - u) + hash01(i + 1, seed) * u;
}
export function smoothNoise(p: number, seed: number, rough: number): number {
  let sum = valueNoise(p, seed), norm = 1, amp = 1, freq = 1;
  for (let o = 1; o < 4; o++) {
    amp *= rough; freq *= 2;
    if (amp < 0.01) break;
    sum += amp * valueNoise(p * freq + o * 17.3, seed + o * 7.1);
    norm += amp;
  }
  // Sums of several values pull towards 0.5 — stretch back to use the range.
  return Math.max(0, Math.min(1, 0.5 + (sum / norm - 0.5) * (1 + 0.6 * (norm - 1))));
}
function seedOf(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 100003;
  return h / 100003 * 1000;
}

function computeLfoValue(waveform: string, phase: number, bias = 0, seed = 0): number {
  if (waveform === 'noise') return smoothNoise(phase, seed, (bias + 1) / 2);
  const p = ((phase % 1) + 1) % 1;
  // bias −1…1 → split point 0.01…0.99 (0 = middle)
  const k = Math.max(0.01, Math.min(0.99, 0.5 + bias * 0.5));
  switch (waveform) {
    case 'sine':     return (1 - Math.cos(2 * Math.PI * p)) / 2;   // starts at 0, top at half cycle
    case 'square':   return p < k ? 1 : 0;
    case 'saw':      return p;
    case 'triangle': return p < k ? p / k : (1 - p) / (1 - k);
    case 'random':   return 0; // handled via randomRef
    default:         return (Math.sin(2 * Math.PI * p) + 1) / 2;
  }
}

export default function LfoWidgetLive({ widget }: { widget: LfoWidget }): React.JSX.Element {
  const masterBpm      = useStore((s) => s.masterBpm);

  const masterBpmRef = useRef(masterBpm);
  masterBpmRef.current = masterBpm;
  const widgetRef = useRef(widget);
  widgetRef.current = widget;

  const accBeatsRef   = useRef(0);   // cycles elapsed (fractional), not beats
  const lastNowRef    = useRef(0);
  // Per output (main = 0, lanes 1…): random sample-and-hold and last value sent.
  const randomValRef  = useRef<number[]>([]);
  const lastRandomPhaseFloorRef = useRef<number[]>([]);
  const lastSentRef  = useRef<number[]>([]);

  // Play/stop — starts running (preserves prior free-run behavior); stop freezes.
  const [isPlaying, setIsPlaying] = useState(true);
  const isPlayingRef = useRef(true);
  const playMappingRef = useRef(widget.playMapping ?? null);
  const stopMappingRef = useRef(widget.stopMapping ?? null);
  playMappingRef.current = widget.playMapping ?? null;
  stopMappingRef.current = widget.stopMapping ?? null;

  function startPlaying() { isPlayingRef.current = true;  setIsPlaying(true);  lastNowRef.current = performance.now(); }
  function stopPlaying()  { isPlayingRef.current = false; setIsPlaying(false); }
  const startRef = useRef(startPlaying); startRef.current = startPlaying;
  const stopRef  = useRef(stopPlaying);  stopRef.current  = stopPlaying;

  useEffect(() => {
    let rafId: number;

    function tick(now: number) {
      const dt = now - lastNowRef.current;
      lastNowRef.current = now;
      // Stop freezes TIME, not the parameters. accBeats stays put so there is no
      // phase jump on resume, but the value is still recomputed every frame —
      // otherwise moving offset, phase, amplitude or waveform while stopped did
      // nothing until you pressed play.
      const running = isPlayingRef.current;
      const w = widgetRef.current;

      // Driven inputs (TouchDesigner-style) override the saved parameters.
      // Accumulating CYCLES means a frequency change bends the wave from
      // where it is instead of jumping to another point of it.
      const inp = (k: string) => getParamInput(w.id, k);
      const freqIn = inp('freq');
      if (running && dt > 0 && dt < 300) {
        const cyclesPerMs = freqIn !== undefined ? freqFromInput(freqIn) / 1000
          : (w.rateMode === 'bpm'
            ? (masterBpmRef.current / 60000) / Math.max(0.001, w.rateMultiplier)
            : w.rateHz / 1000) * (w.speed ?? 1);
        accBeatsRef.current += dt * cyclesPerMs;   // cycles
      }
      const amp = inp('amp') ?? w.amplitude;
      const center = w.center ?? 0.5;
      const biasIn = inp('bias');
      const bias = biasIn !== undefined ? biasIn * 2 - 1 : (w.bias ?? 0);
      // OFFSET shifts every output forward together. PHASE spreads them by
      // index: output k of n sits phase × k/(n−1) of a cycle after the first,
      // so 0 = all identical and 0.5 = the last one half a cycle behind.
      const base = accBeatsRef.current + (inp('offset') ?? w.offset);
      const spread = inp('phase') ?? w.phase;
      const n = 1 + (w.lanes?.length ?? 0);
      const phases = Array.from({ length: n }, (_, k) => (n > 1 ? spread * k / (n - 1) : 0));
      phases.forEach((ph, i) => {
        const phase = base + ph;
        let raw: number;
        if (w.waveform === 'random') {
          // sample-and-hold, per output
          const floor = Math.floor(phase);
          if (floor !== lastRandomPhaseFloorRef.current[i]) {
            lastRandomPhaseFloorRef.current[i] = floor;
            randomValRef.current[i] = Math.random();
          }
          raw = randomValRef.current[i] ?? 0.5;
        } else {
          raw = computeLfoValue(w.waveform, phase, bias, w.seed ? w.seed * 7.919 : seedOf(w.id));
        }

        // Apply amplitude and offset: centre at offset, swing ±amplitude/2
        const value = Math.max(0, Math.min(1, center + (raw - 0.5) * amp));

        // While stopped the value only moves when you move a control, so emit on
        // change instead of flooding the wire with an unchanging number.
        if (running || value !== lastSentRef.current[i]) {
          lastSentRef.current[i] = value;
          useStore.getState().setCellValue(w.id, i, value);
          if (i === 0 && w.mapping) dispatchValue(w.mapping, value);
        }
      });

      rafId = requestAnimationFrame(tick);
    }

    lastNowRef.current = performance.now();
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, []);

  function rewind() {
    accBeatsRef.current = 0;
    lastNowRef.current = performance.now();
    lastRandomPhaseFloorRef.current = [];
  }
  const rewindRef = useRef(rewind); rewindRef.current = rewind;
  const startRefG = useRef(startPlaying); startRefG.current = startPlaying;
  const stopRefG  = useRef(stopPlaying);  stopRefG.current  = stopPlaying;

  // PLAY (level: ≥ 0.5 plays) and RESET (each press) from the Router.
  useEffect(() => {
    let lastPlay: boolean | undefined;
    let lastReset = 0;
    return onParamInputs(() => {
      const id = widgetRef.current.id;
      const pv = getParamInput(id, 'play');
      if (pv !== undefined) {
        const on = pv >= 0.5;
        if (on !== lastPlay) { lastPlay = on; if (on) startRef.current(); else stopRef.current(); }
      }
      const rv = getParamInput(id, 'reset') ?? 0;
      if (rv >= 0.5 && lastReset < 0.5) rewindRef.current();
      lastReset = rv;
    });
  }, []);

  useGlobalTransport({
    start: () => startRefG.current(),
    stop:  () => stopRefG.current(),
    reset: () => rewindRef.current(),
  });

  // Play/stop triggers (OSC + MIDI)
  useEffect(() => bridge.on('tr:osc:feedback', (msg) => {
    const pm = playMappingRef.current, sm = stopMappingRef.current;
    if (pm?.type === 'osc' && msg.address === (pm as OscMapping).address) startRef.current();
    if (sm?.type === 'osc' && msg.address === (sm as OscMapping).address) stopRef.current();
  }), []);

  useEffect(() => bridge.on('tr:midi:inputEvent', (evt) => {
    const matches = (m: MidiMapping | null): boolean => {
      if (!m || m.type !== 'midi') return false;
      const isCC   = m.messageType === 'controlChange' && evt.messageType === 'controlChange' && evt.channel === m.channel && evt.number === m.number;
      const isNote = m.messageType === 'noteOn'        && evt.messageType === 'noteOn'        && evt.channel === m.channel && evt.number === m.number;
      return isCC || isNote;
    };
    if (matches(playMappingRef.current as MidiMapping | null)) startRef.current();
    if (matches(stopMappingRef.current as MidiMapping | null)) stopRef.current();
  }), []);

  const color = widget.style.foregroundColor;



  // ─── Transport ↔ store ──────────────────────────────────────────────────────
  // Mirror play/stop into the runtime so a Cue can snapshot it, and follow the
  // store when a cue recall drives it back. The guard on isPlayingRef stops the
  // two halves from chasing each other.
  useEffect(() => {
    useStore.getState().setWidgetPlaying(widget.id, isPlaying);
  }, [isPlaying, widget.id]);

  useEffect(() => useStore.subscribe((s) => {
    const want = s.runtime.widgets[widget.id]?.playing;
    if (want === undefined || want === isPlayingRef.current) return;
    if (want) startRef.current(); else stopRef.current();
  }), [widget.id]);

  return (
    <div style={{
      width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
      padding: '6px 8px', boxSizing: 'border-box', fontFamily: 'monospace', overflow: 'hidden',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, marginBottom: 4 }}>
        <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: 2, color: '#505050', textTransform: 'uppercase' }}>
          ◈ {widget.kind === 'noiseWidget' ? 'noise' : 'lfo'}
        </span>
        <button
          style={{ ...lfoBtn, color: isPlaying ? color : 'rgba(255,255,255,0.3)',
            borderColor: isPlaying ? color : 'rgba(255,255,255,0.12)' }}
          onPointerDown={(e) => { e.preventDefault(); startPlaying(); }}
          title="Play"
        >▶</button>
        <button
          style={{ ...lfoBtn, color: !isPlaying ? color : 'rgba(255,255,255,0.3)',
            borderColor: !isPlaying ? color + '99' : 'rgba(255,255,255,0.12)' }}
          onPointerDown={(e) => { e.preventDefault(); stopPlaying(); }}
          title="Stop"
        >■</button>
        <span style={{ fontSize: 10, color, marginLeft: 'auto', fontWeight: 600 }}>
          {waveformIcon(widget.waveform)} {widget.waveform}
        </span>
        <SpeedButton widget={widget} color={color} />
        <button
          style={{ ...lfoBtn, color: '#aaa', borderColor: 'rgba(255,255,255,0.15)' }}
          onPointerDown={(e) => { e.preventDefault(); addLane(widget); }}
          title="Add an output with its own phase"
        >＋</button>
      </div>

      {/* One bar per output — the main one first, then the ＋ lanes. Each is a
          cell element, so Shift patching puts an output dot on it. */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
        {[0, ...(widget.lanes ?? []).map((_, k) => k + 1)].map((i) => (
          <LaneBar key={i === 0 ? 'main' : widget.lanes![i - 1].id} widget={widget} index={i} color={color}
            autoPhase={(widget.lanes?.length ?? 0) > 0 ? widget.phase * i / (widget.lanes!.length) : undefined} />
        ))}
      </div>

      <div style={{ fontSize: 9, color: '#444', marginTop: 4, flexShrink: 0 }}>
        {widget.rateMode === 'bpm'
          ? `×${widget.rateMultiplier} beats`
          : `${widget.rateHz} Hz`
        } · amp {widget.amplitude.toFixed(2)} · off {widget.offset.toFixed(2)} · φ {widget.phase.toFixed(2)}
      </div>
    </div>
  );
}

// ×1 badge: click steps through ×0.25 … ×4 (saved), right-click links the
// SPEED / RATE / PHASE inputs. While an input is driving it, the badge shows
// the live value and lights up.
function SpeedButton({ widget, color }: { widget: LfoWidget; color: string }): React.JSX.Element {
  const [, bump] = useState(0);
  useEffect(() => onParamInputs(() => bump((n) => n + 1)), []);
  const [menu, setMenu] = useState<{ x: number; y: number; cell: number | null } | null>(null);
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [menu]);

  // While FREQ is driven the badge shows the live Hz instead of the step.
  const freqIn = getParamInput(widget.id, 'freq');
  const driven = freqIn !== undefined;
  const hz = driven ? freqFromInput(freqIn) : 0;
  const label = driven ? `${hz >= 10 ? hz.toFixed(1) : hz >= 1 ? hz.toFixed(2) : hz.toFixed(3)}Hz` : `×${widget.speed ?? 1}`;

  const step = () => {
    const cur = widget.speed ?? 1;
    const i = LFO_SPEEDS.indexOf(cur);
    const next = LFO_SPEEDS[(i < 0 ? 2 : i + 1) % LFO_SPEEDS.length];
    const pageId = useStore.getState().project.pages.find((p) => p.widgets.some((w) => w.id === widget.id))?.id;
    if (pageId) useStore.getState().updateWidget(pageId, widget.id, { speed: next } as never);
  };

  return (
    <>
      <button
        style={{ ...lfoBtn, width: 60, minWidth: 60, boxSizing: 'border-box', fontVariantNumeric: 'tabular-nums', textAlign: 'center', color: driven ? '#000' : color, background: driven ? color : 'rgba(0,0,0,0.4)', borderColor: color + '88' }}
        onPointerDown={(e) => { if (e.button !== 0) return; e.preventDefault(); step(); }}
        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setMenu({ x: e.clientX, y: e.clientY, cell: null }); }}
        title="Speed — click: ×0.25 · ×0.5 · ×1 · ×2 · ×4 · right-click: link the LFO inputs (PLAY, FREQ, AMP, OFFSET, BIAS, PHASE, RESET)"
      >{label}</button>
      {menu && menu.cell === null && createPortal(
        <div onPointerDown={(e) => e.stopPropagation()} style={{
          position: 'fixed', left: menu.x, top: menu.y, zIndex: 9999, background: '#1a1a1a', border: '1px solid #3a3a3a',
          borderRadius: 6, padding: '6px 0', minWidth: 260, boxShadow: '0 6px 28px rgba(0,0,0,0.75)', fontFamily: 'monospace',
        }}>
          <div style={{ padding: '8px 16px', color: '#8a8a8a', fontSize: 12, textTransform: 'uppercase', letterSpacing: 1 }}>lfo inputs</div>
          {LFO_INPUTS.map((t) => (
            <button key={t.index} onClick={() => setMenu({ ...menu, cell: t.index })}
              style={{ display: 'block', width: '100%', minHeight: 40, padding: '8px 16px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit' }}>
              <span style={{ fontSize: 15, color: '#ccc' }}>{t.label} ▸</span>
              <div style={{ fontSize: 11, color: '#666', marginTop: 2 }}>{t.hint}</div>
            </button>
          ))}
        </div>,
        document.body,
      )}
      {menu && menu.cell !== null && (
        <CellLinkMenu x={menu.x} y={menu.y} widgetId={widget.id} cellIndex={menu.cell} onClose={() => setMenu(null)} />
      )}
    </>
  );
}

const lfoBtn: React.CSSProperties = {
  minWidth: 22, padding: '2px 5px', borderRadius: 3, fontSize: 11, lineHeight: 1,
  background: 'rgba(0,0,0,0.4)', border: '1px solid', cursor: 'pointer',
  fontFamily: 'inherit', touchAction: 'none', flexShrink: 0,
};

function waveformIcon(wf: string): string {
  switch (wf) {
    case 'sine':     return '∿';
    case 'square':   return '⊓';
    case 'saw':      return '⊿';
    case 'triangle': return '△';
    case 'random':   return '⌇';
    case 'noise':    return '≈';
    default:         return '∿';
  }
}
