import { pal, palRgb } from '../../palette';
import React from 'react';
import { useStore, useActivePage } from '../../store';
import type {
  Widget, LfoWidget, MathWidget, ValueDisplayWidget,
  StepSequencerWidget, GraphWidget, SoundPlayerWidget,
  SubmastersWidget, AudioAnalyserWidget, InstanceWidget, CuesWidget,
  SliderBankWidget, ButtonGridWidget, KnobBankWidget,
  LfoWaveform, LfoRateMode, MathOperation, ValueDisplayFormat,
  SpeedMultiplier, GraphPlayMode, SubmasterMergeMode,
} from '../../../shared/types/project';

import { cueScopePages, cueScopeWidgets, widgetsInScope, CUE_SCOPE_ALL } from '../../widgets/Cues/scope';
import CellEditModal from '../../widgets/base/CellEditModal';

type UpdateFn = (patch: Record<string, unknown>) => void;

// ─── Reusable control rows ────────────────────────────────────────────────────

function Row({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div style={{ padding: '7px 12px', borderBottom: '1px solid #111' }}>
      <div style={{ fontSize: 9, letterSpacing: 1.5, color: '#3a3a3a', textTransform: 'uppercase', marginBottom: 5 }}>
        {label}
      </div>
      {children}
    </div>
  );
}

function SliderRow({ label, value, min, max, step, fmt, onChange }: {
  label: string; value: number; min: number; max: number;
  step?: number; fmt?: (v: number) => string; onChange: (v: number) => void;
}): React.JSX.Element {
  return (
    <Row label={label}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <input
          type="range" min={min} max={max} step={step ?? 0.01} value={value}
          style={{ flex: 1, cursor: 'pointer', accentColor: `var(--color-accent, ${pal('#91ced2')})` }}
          onChange={(e) => onChange(parseFloat(e.target.value))}
        />
        <span style={{ fontSize: 10, color: '#666', fontVariantNumeric: 'tabular-nums', minWidth: 36, textAlign: 'right' }}>
          {fmt ? fmt(value) : value.toFixed(2)}
        </span>
      </div>
    </Row>
  );
}

function SelectRow({ label, value, options, onChange }: {
  label: string; value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}): React.JSX.Element {
  return (
    <Row label={label}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: '100%', background: '#1a1a1a', border: '1px solid #2a2a2a',
          color: '#bbb', borderRadius: 3, padding: '3px 6px', fontSize: 11,
        }}
      >
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </Row>
  );
}

function ButtonGroupRow({ label, options, value, onChange }: {
  label: string; options: string[]; value: string; onChange: (v: string) => void;
}): React.JSX.Element {
  return (
    <Row label={label}>
      <div style={{ display: 'flex', gap: 4 }}>
        {options.map((opt) => (
          <button
            key={opt}
            style={{
              flex: 1, padding: '4px 0', fontSize: 11, cursor: 'pointer',
              border: `1px solid ${value === opt ? `var(--color-accent, ${pal('#91ced2')})` : '#2a2a2a'}`,
              background: value === opt ? `rgba(${palRgb('#91ced2')},0.18)` : '#111',
              color: value === opt ? `var(--color-accent, ${pal('#91ced2')})` : '#555',
              borderRadius: 3,
            }}
            onClick={() => onChange(opt)}
          >
            {opt}
          </button>
        ))}
      </div>
    </Row>
  );
}

// ─── Per-widget param panels ──────────────────────────────────────────────────

function LfoParams({ w, update }: { w: LfoWidget; update: UpdateFn }): React.JSX.Element {
  const waveformLabels: Record<LfoWaveform, string> = {
    sine: 'SIN', square: 'SQR', saw: 'SAW', triangle: 'TRI', random: 'RND', noise: 'NOISE',
  };
  return (
    <>
      <ButtonGroupRow
        label="Waveform"
        options={(['sine', 'square', 'saw', 'triangle', 'random', 'noise'] as LfoWaveform[]).map((wf) => waveformLabels[wf])}
        value={waveformLabels[w.waveform]}
        onChange={(v) => {
          const wf = Object.entries(waveformLabels).find(([, label]) => label === v)?.[0] as LfoWaveform;
          if (wf) update({ waveform: wf });
        }}
      />
      <ButtonGroupRow
        label="Rate Mode"
        options={['bpm', 'hz']}
        value={w.rateMode}
        onChange={(v) => update({ rateMode: v as LfoRateMode })}
      />
      {w.rateMode === 'bpm' ? (
        <SliderRow
          label="BPM Multiplier"
          value={w.rateMultiplier} min={0.125} max={16} step={0.125}
          fmt={(v) => `×${v}`}
          onChange={(v) => update({ rateMultiplier: v })}
        />
      ) : (
        <SliderRow
          label="Rate (Hz)"
          value={w.rateHz} min={0.05} max={20} step={0.05}
          fmt={(v) => `${v.toFixed(2)} Hz`}
          onChange={(v) => update({ rateHz: v })}
        />
      )}
      <SliderRow
        label="Amplitude"
        value={w.amplitude} min={0} max={1}
        fmt={(v) => `${Math.round(v * 100)}%`}
        onChange={(v) => update({ amplitude: v })}
      />
      <SliderRow
        label="Offset"
        value={w.offset} min={0} max={1}
        fmt={(v) => `${Math.round(v * 100)}%`}
        onChange={(v) => update({ offset: v })}
      />
      <SliderRow
        label="Phase"
        value={w.phase} min={0} max={1}
        fmt={(v) => `${Math.round(v * 100)}%`}
        onChange={(v) => update({ phase: v })}
      />
    </>
  );
}

function MathParams({ w, update }: { w: MathWidget; update: UpdateFn }): React.JSX.Element {
  return (
    <>
      <SelectRow
        label="Operation"
        value={w.operation}
        options={[
          { value: 'add',      label: 'A + B  (Add)' },
          { value: 'subtract', label: 'A − B  (Subtract)' },
          { value: 'multiply', label: 'A × B  (Multiply)' },
          { value: 'min',      label: 'Min(A, B)' },
          { value: 'max',      label: 'Max(A, B)' },
          { value: 'avg',      label: 'Avg(A, B)' },
          { value: 'invert',   label: '1 − A  (Invert)' },
          { value: 'abs',      label: '|A|  (Abs)' },
        ]}
        onChange={(v) => update({ operation: v as MathOperation })}
      />
      <SliderRow
        label="In min"
        value={w.inMin ?? 0} min={-1} max={2} step={0.01}
        fmt={(v) => v.toFixed(2)}
        onChange={(v) => update({ inMin: v })}
      />
      <SliderRow
        label="In max"
        value={w.inMax ?? 1} min={-1} max={2} step={0.01}
        fmt={(v) => v.toFixed(2)}
        onChange={(v) => update({ inMax: v })}
      />
      <SliderRow
        label="Out min"
        value={w.outMin ?? 0} min={-1} max={2} step={0.01}
        fmt={(v) => v.toFixed(2)}
        onChange={(v) => update({ outMin: v })}
      />
      <SliderRow
        label="Out max"
        value={w.outMax ?? 1} min={-1} max={2} step={0.01}
        fmt={(v) => v.toFixed(2)}
        onChange={(v) => update({ outMax: v })}
      />
    </>
  );
}

function ValueDisplayParams({ w, update }: { w: ValueDisplayWidget; update: UpdateFn }): React.JSX.Element {
  return (
    <>
      <SelectRow
        label="Format"
        value={w.displayFormat}
        options={[
          { value: 'percent', label: 'Percent  0–100%' },
          { value: 'raw',     label: 'Raw  0.0–1.0' },
          { value: 'midi',    label: 'MIDI  0–127' },
        ]}
        onChange={(v) => update({ displayFormat: v as ValueDisplayFormat })}
      />
      <SliderRow
        label="Decimals"
        value={w.decimals} min={0} max={3} step={1}
        fmt={(v) => `${Math.round(v)} dp`}
        onChange={(v) => update({ decimals: Math.round(v) })}
      />
    </>
  );
}

function StepSeqParams({ w, update }: { w: StepSequencerWidget; update: UpdateFn }): React.JSX.Element {
  const speeds: SpeedMultiplier[] = [0.125, 0.25, 0.5, 1, 2, 4, 8];
  return (
    <>
      <SelectRow
        label="Speed"
        value={String(w.speedMultiplier)}
        options={speeds.map((s) => ({
          value: String(s),
          label: s < 1 ? `×${s}  (slower)` : s === 1 ? '×1  (normal)' : `×${s}  (faster)`,
        }))}
        onChange={(v) => update({ speedMultiplier: parseFloat(v) as SpeedMultiplier })}
      />
      <SliderRow
        label="Smooth"
        value={w.smooth ?? 0} min={0} max={1}
        fmt={(v) => v <= 0 ? 'off' : `${Math.round(v * 100)}%`}
        onChange={(v) => update({ smooth: v })}
      />
    </>
  );
}

function GraphParams({ w, update }: { w: GraphWidget; update: UpdateFn }): React.JSX.Element {
  const speeds: SpeedMultiplier[] = [0.125, 0.25, 0.5, 1, 2, 4, 8];
  return (
    <>
      <SelectRow
        label="Speed"
        value={String(w.speedMultiplier)}
        options={speeds.map((s) => ({
          value: String(s),
          label: s < 1 ? `×${s}` : s === 1 ? '×1  (normal)' : `×${s}`,
        }))}
        onChange={(v) => update({ speedMultiplier: parseFloat(v) as SpeedMultiplier })}
      />
      <ButtonGroupRow
        label="Play Mode"
        options={['loop', 'once']}
        value={w.playMode ?? 'loop'}
        onChange={(v) => update({ playMode: v as GraphPlayMode })}
      />
    </>
  );
}

function SoundPlayerParams({ w, update }: { w: SoundPlayerWidget; update: UpdateFn }): React.JSX.Element {
  return (
    <SliderRow
      label="Master Volume"
      value={w.masterVolume} min={0} max={1}
      fmt={(v) => `${Math.round(v * 100)}%`}
      onChange={(v) => update({ masterVolume: v })}
    />
  );
}


function CuesParams({ w, update }: { w: CuesWidget; update: UpdateFn }): React.JSX.Element {
  // Same helpers as the Inspector, so the two lists cannot drift apart.
  const project = useStore((st) => st.project);
  const count = widgetsInScope(project, w.scopePageId, w.scopeWidgetId).length;
  return (
    <>
      <SelectRow
        label="Pages"
        value={w.scopePageId ?? CUE_SCOPE_ALL}
        options={cueScopePages(project).map((o) => ({ value: o.id, label: o.label }))}
        // Changing the page invalidates a widget picked from another one.
        onChange={(v) => update({ scopePageId: v, scopeWidgetId: CUE_SCOPE_ALL })}
      />
      <SelectRow
        label="Widgets"
        value={w.scopeWidgetId ?? CUE_SCOPE_ALL}
        options={cueScopeWidgets(project, w.scopePageId).map((o) => ({ value: o.id, label: o.label }))}
        onChange={(v) => update({ scopeWidgetId: v })}
      />
      <div style={{ fontSize: 10, color: '#555', padding: '2px 10px 6px', lineHeight: 1.5 }}>
        Recording captures {count} widget{count !== 1 ? 's' : ''}.
      </div>
    </>
  );
}

function SubmastersParams({ w, update }: { w: SubmastersWidget; update: UpdateFn }): React.JSX.Element {
  return (
    <ButtonGroupRow
      label="Merge Mode"
      options={['htp', 'ltp']}
      value={w.mergeMode}
      onChange={(v) => update({ mergeMode: v as SubmasterMergeMode })}
    />
  );
}

function AudioParams({ w, update }: { w: AudioAnalyserWidget; update: UpdateFn }): React.JSX.Element {
  return (
    <>
      <SliderRow
        label="Kick Threshold"
        value={w.kickThreshold} min={0} max={1}
        fmt={(v) => `${Math.round(v * 100)}%`}
        onChange={(v) => update({ kickThreshold: v })}
      />
      <SliderRow
        label="Snare Threshold"
        value={w.snareThreshold} min={0} max={1}
        fmt={(v) => `${Math.round(v * 100)}%`}
        onChange={(v) => update({ snareThreshold: v })}
      />
    </>
  );
}

function InstanceParams({ w, update }: { w: InstanceWidget; update: UpdateFn }): React.JSX.Element {
  const project = useStore((s) => s.project);
  const sources = project.pages.flatMap((p) => p.widgets).filter((x) => x.id !== w.id && x.kind !== 'instance');
  return (
    <SelectRow
      label="Source widget"
      value={w.sourceWidgetId}
      options={[{ value: '', label: '— none —' }, ...sources.map((x) => ({ value: x.id, label: `${x.label} (${x.kind})` }))]}
      onChange={(v) => update({ sourceWidgetId: v })}
    />
  );
}


function CellBankParams({ w, onEditCells }: {
  w: SliderBankWidget | ButtonGridWidget | KnobBankWidget;
  onEditCells: () => void;
}): React.JSX.Element {
  const cells = (w as { cells?: unknown[] }).cells?.length ?? 0;
  return (
    <>
      <Row label="Cells">
        <button
          onClick={onEditCells}
          style={{
            width: '100%', minHeight: 32, cursor: 'pointer',
            background: '#1a1a1a', border: '1px solid #2a2a2a',
            color: '#bbb', borderRadius: 3, fontSize: 11, fontFamily: 'inherit',
          }}
        >
          ✏ Edit cells ({cells})
        </button>
      </Row>
      <div style={{ fontSize: 10, color: '#3a3a3a', padding: '2px 12px 8px', lineHeight: 1.5 }}>
        Names, colours, mappings — and behaviour on a button grid — one cell at a time.
      </div>
    </>
  );
}

function NoParams({ kind }: { kind: string }): React.JSX.Element {
  return (
    <div style={{ padding: '16px 12px', color: '#2a2a2a', fontSize: 11, fontFamily: 'monospace' }}>
      No live parameters for<br /><span style={{ color: '#444' }}>{kind}</span>
    </div>
  );
}

function ParamPanel({ widget, update, onEditCells }: {
  widget: Widget; update: UpdateFn; onEditCells: () => void;
}): React.JSX.Element {
  switch (widget.kind) {
    case 'sliderBank':
    case 'buttonGrid':
    case 'knobBank':
      return <CellBankParams w={widget as SliderBankWidget | ButtonGridWidget | KnobBankWidget} onEditCells={onEditCells} />;
    case 'noiseWidget':
    case 'lfoWidget':     return <LfoParams w={widget as LfoWidget} update={update} />;
    case 'mathWidget':    return <MathParams w={widget as MathWidget} update={update} />;
    case 'valueDisplay':  return <ValueDisplayParams w={widget as ValueDisplayWidget} update={update} />;
    case 'stepSequencer': return <StepSeqParams w={widget as StepSequencerWidget} update={update} />;
    case 'graphWidget':   return <GraphParams w={widget as GraphWidget} update={update} />;
    case 'soundPlayer':   return <SoundPlayerParams w={widget as SoundPlayerWidget} update={update} />;
    case 'submasters':    return <SubmastersParams w={widget as SubmastersWidget} update={update} />;
    case 'cues':          return <CuesParams w={widget as CuesWidget} update={update} />;
    case 'audioAnalyser': return <AudioParams w={widget as AudioAnalyserWidget} update={update} />;
    case 'instance':      return <InstanceParams w={widget as InstanceWidget} update={update} />;
    default:              return <NoParams kind={widget.kind} />;
  }
}

// ─── Main sidebar component ───────────────────────────────────────────────────

export default function LiveSidebar(): React.JSX.Element {
  const liveSelectedWidgetId = useStore((s) => s.liveSelectedWidgetId);
  const activePageId = useStore((s) => s.activePageId);
  const updateWidget = useStore((s) => s.updateWidget);
  const page = useActivePage();

  const widget = page?.widgets.find((w) => w.id === liveSelectedWidgetId) ?? null;
  const [editingCells, setEditingCells] = React.useState(false);
  // A widget deselected (or deleted) while the editor is open must not leave a
  // modal pointing at nothing.
  React.useEffect(() => { setEditingCells(false); }, [liveSelectedWidgetId]);

  const update: UpdateFn = (patch) => {
    if (activePageId && liveSelectedWidgetId) {
      updateWidget(activePageId, liveSelectedWidgetId, patch as Partial<Widget>);
    }
  };

  return (
    <div style={{
      width: 248,
      flexShrink: 0,
      background: '#090909',
      borderLeft: '1px solid #1a1a1a',
      display: 'flex',
      flexDirection: 'column',
      overflowY: 'auto',
      overflowX: 'hidden',
    }}>
      {/* Header — top padding leaves space for the toggle button */}
      <div style={{
        padding: '32px 12px 10px',
        borderBottom: '1px solid #181818',
        flexShrink: 0,
      }}>
        <div style={{ fontSize: 9, letterSpacing: 2, color: '#2e2e2e', textTransform: 'uppercase' }}>
          Live Params
        </div>
        {widget ? (
          <div style={{ fontSize: 12, color: '#666', marginTop: 4, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {widget.label}
          </div>
        ) : (
          <div style={{ fontSize: 11, color: '#1e1e1e', marginTop: 4 }}>
            — click a widget —
          </div>
        )}
      </div>

      {/* Param controls */}
      <div style={{ flex: 1 }}>
        {widget
          ? <ParamPanel widget={widget} update={update} onEditCells={() => setEditingCells(true)} />
          : null
        }
      </div>

      {editingCells && widget && activePageId && (
        <CellEditModal
          widgetId={widget.id}
          pageId={activePageId}
          onClose={() => setEditingCells(false)}
        />
      )}
    </div>
  );
}
