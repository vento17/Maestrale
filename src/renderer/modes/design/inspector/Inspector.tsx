import { pal, palRgb, DEFAULT_PALETTE } from '../../../palette';
import type { Palette } from '../../../palette';
import EncoderSettings from '../../../widgets/Encoder/EncoderSettings';
import EtcSettings from '../../../widgets/Etc/EtcSettings';
import ExcludeList from '../../../widgets/base/ExcludeList';
import PresetBar from '../../../widgets/base/PresetBar';
import SketchPresetBar from '../../../widgets/Sketch/SketchPresetBar';
import { quantLabel } from '../../../widgets/base/paramInputs';
import { xyMapping } from '../../../../shared/types/project';
import React, { useState, useEffect } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStore, useActivePage, useProject } from '../../../store';
import type { StoreState } from '../../../store';
import type { MidiConnection, MidiInputConnection, OscConnection, ArtNetConnection, ArtNetInputConnection, SacnInputConnection, SacnConnection, LtcAudioConnection, AudioOutputConnection, EnttecDmxConnection, ImageWidget, TextWidget, BlendMode, TextFrame, TextAlign, FontWeight, FontStyle, StepSequencerWidget, GraphWidget, XYPadWidget, SliderBankWidget, SpeedMultiplier, WidgetStyle, ButtonGridWidget, ButtonBehavior, KnobBankWidget, CuesWidget, TimelineWidget, RouterWidget, RouterRow, RouterOutput, RouterInputType, AutoBpmWidget, BeatOutput, LfoWidget, MathWidget, MathOperation, LfoWaveform, ValueDisplayWidget, ValueDisplayFormat } from '../../../../shared/types/project';
import { BEAT_DIVISORS } from '../../../../shared/types/project';
import type { Mapping, MidiMapping, OscMapping, EnttecDmxMapping, ArtNetMapping, SacnMapping } from '../../../../shared/types/mapping';
import { bridge } from '../../../ipc/bridge';
import { onDmxInputStatus } from '../../../ipc/dmxInput';
import { useTakes, refreshTakes, fmtTime, fmtBytes, parseUniverses } from '../../../ipc/dmxTakes';
import { ClockAlarms } from '../../../widgets/Clock/ClockLive';
import { inOptions as monInOptions, outOptions as monOutOptions } from '../../../widgets/DmxMonitor/DmxMonitorLive';
import { addLane, removeLane } from '../../../widgets/LfoWidget/LfoWidgetLive';
import { addXYDot, XY_DOT_COLORS } from '../../../widgets/XYPad/XYPadLive';
import ResizableColumn from '../../ResizableColumn';
import { widgetEosUser, setWidgetEosUserPatch } from '../../../widgets/base/eosUser';
import { XY_PRESETS, applyXYPreset, defaultZ } from '../../../widgets/XYPad/xyPresets';
import { ShellButtonEditor } from '../../../widgets/Shell/ShellLive';
import { ColorEditor, setPaletteCount } from '../../../widgets/Palette/PaletteLive';
import { shellAction } from '../../../../shared/shellActions';
import type { DmxInputStatusPayload } from '../../../../shared/types/ipc';
import { dispatchValue, dispatchButton } from '../../../ipc/dispatch';
import {
  SETTINGS_ENTRIES as MANUAL_SETTINGS_ENTRIES,
  WIDGET_ENTRIES as MANUAL_WIDGET_ENTRIES,
} from '../../../widgets/Manual/manualContent';
import { keyCapLabel, RESERVED_CODES } from '../../../widgets/Keyboard/keyNames';
import { cellLabel, sourceCells, targetCells, listLinkableSources, computeSlavedCellSet, isLinkSource, SUBMASTER_KINDS, SUBMASTER_ALL, INSTANCE_KINDS } from '../../../widgets/base/links';
import { pulseParamInput, GEN_SPEEDS } from '../../../widgets/base/paramInputs';
import NumberInput from '../../../widgets/base/NumberInput';
import { cueScopePages, cueScopeWidgets, CUE_SCOPE_ALL } from '../../../widgets/Cues/scope';
import { nextFreeCc } from '../../../widgets/defaults';
import { artnetConfigOutputs, sacnConfigOutputs, oscConfigOutputs, midiConfigOutputs, listOutputs } from '../../../../shared/outputs';
import type { OutputProtocol } from '../../../../shared/outputs';
import logoUrl from '../../../assets/Logo.png';
import { GLOBAL_BAR_HEIGHT } from '../../GlobalBar';

export default function Inspector(): React.JSX.Element {
  const { selectedWidgetId, updateWidget, updateWidgetRect, activePageId, isSettingsOpen } = useStore(useShallow((s) => ({
    selectedWidgetId: s.selectedWidgetId,
    updateWidget: s.updateWidget,
    updateWidgetRect: s.updateWidgetRect,
    activePageId: s.activePageId,
    isSettingsOpen: s.isSettingsOpen,
  })));
  const page = useActivePage();
  const widget = page?.widgets.find((w) => w.id === selectedWidgetId);

  return (
    <ResizableColumn base={333}>
    <div style={{ ...styles.panel, width: '100%', height: '100%', boxSizing: 'border-box' }}>
      {isSettingsOpen
        ? <SettingsPanel />
        : widget && activePageId
          ? widget.kind === 'imageWidget'
            ? <ImagePanel widget={widget as ImageWidget} activePageId={activePageId} updateWidget={updateWidget} />
            : widget.kind === 'textWidget'
              ? <TextPanel widget={widget as TextWidget} activePageId={activePageId} updateWidget={updateWidget} updateWidgetRect={updateWidgetRect} />
              : widget.kind === 'stepSequencer'
                ? <StepSequencerPanel widget={widget as StepSequencerWidget} activePageId={activePageId} updateWidget={updateWidget} updateWidgetRect={updateWidgetRect} />
                : widget.kind === 'graphWidget'
                  ? <GraphPanel widget={widget as GraphWidget} activePageId={activePageId} updateWidget={updateWidget} updateWidgetRect={updateWidgetRect} />
                  : widget.kind === 'xyPad'
                    ? <XYPadPanel widget={widget as XYPadWidget} activePageId={activePageId} updateWidget={updateWidget} updateWidgetRect={updateWidgetRect} />
                    : widget.kind === 'cues'
                      ? <CuesInspectorPanel widget={widget as CuesWidget} activePageId={activePageId} updateWidget={updateWidget} />
                      : widget.kind === 'timeline'
                        ? <TimelineInspectorPanel widget={widget as TimelineWidget} activePageId={activePageId} updateWidget={updateWidget} updateWidgetRect={updateWidgetRect} />
                        : widget.kind === 'spoutInput'
                          ? <SpoutInputInspectorPanel widget={widget as import('../../../../shared/types/project').SpoutInputWidget} activePageId={activePageId} updateWidget={updateWidget} updateWidgetRect={updateWidgetRect} />
                          : widget.kind === 'ndiInput'
                            ? <NdiInputInspectorPanel widget={widget as import('../../../../shared/types/project').NdiInputWidget} activePageId={activePageId} updateWidget={updateWidget} updateWidgetRect={updateWidgetRect} />
                            : widget.kind === 'submasters'
                              ? <SubmastersInspectorPanel widget={widget as import('../../../../shared/types/project').SubmastersWidget} activePageId={activePageId} updateWidget={updateWidget} updateWidgetRect={updateWidgetRect} />
                              : widget.kind === 'autoBpm'
                                ? <AutoBpmInspectorPanel widget={widget as AutoBpmWidget} activePageId={activePageId} updateWidget={updateWidget} updateWidgetRect={updateWidgetRect} />
                                : widget.kind === 'audioAnalyser'
                                  ? <AudioAnalyserInspectorPanel widget={widget as import('../../../../shared/types/project').AudioAnalyserWidget} activePageId={activePageId} updateWidget={updateWidget} updateWidgetRect={updateWidgetRect} />
                                  : widget.kind === 'soundPlayer'
                                    ? <SoundPlayerInspectorPanel widget={widget as import('../../../../shared/types/project').SoundPlayerWidget} activePageId={activePageId} updateWidget={updateWidget} updateWidgetRect={updateWidgetRect} />
                                    : widget.kind === 'router'
                                      ? <RouterInspectorPanel widget={widget as import('../../../../shared/types/project').RouterWidget} activePageId={activePageId} updateWidget={updateWidget} updateWidgetRect={updateWidgetRect} />
                                      : widget.kind === 'lfoWidget' || widget.kind === 'noiseWidget'
                                        ? <LfoInspectorPanel widget={widget as LfoWidget} activePageId={activePageId} updateWidget={updateWidget} updateWidgetRect={updateWidgetRect} />
                                        : widget.kind === 'mathWidget'
                                          ? <MathInspectorPanel widget={widget as MathWidget} activePageId={activePageId} updateWidget={updateWidget} updateWidgetRect={updateWidgetRect} />
                                          : widget.kind === 'valueDisplay'
                                            ? <ValueDisplayInspectorPanel widget={widget as ValueDisplayWidget} activePageId={activePageId} updateWidget={updateWidget} updateWidgetRect={updateWidgetRect} />
                                            : widget.kind === 'masterLevel'
                                              ? <MasterLevelInspectorPanel widget={widget as import('../../../../shared/types/project').MasterLevelWidget} activePageId={activePageId} updateWidget={updateWidget} updateWidgetRect={updateWidgetRect} />
                                              : widget.kind === 'sketch'
                                              ? <SketchInspectorPanel widget={widget as import('../../../../shared/types/project').SketchWidget} activePageId={activePageId} updateWidget={updateWidget} updateWidgetRect={updateWidgetRect} />
                                              : widget.kind === 'etc'
                                              ? <EtcInspectorPanel widget={widget as import('../../../../shared/types/project').EtcWidget} activePageId={activePageId} updateWidget={updateWidget} updateWidgetRect={updateWidgetRect} />
                                              : widget.kind === 'encoder'
                                              ? <EncoderInspectorPanel widget={widget as import('../../../../shared/types/project').EncoderWidget} activePageId={activePageId} updateWidget={updateWidget} updateWidgetRect={updateWidgetRect} />
                                              : widget.kind === 'audioLevel'
                                              ? <AudioLevelInspectorPanel widget={widget as import('../../../../shared/types/project').AudioLevelWidget} activePageId={activePageId} updateWidget={updateWidget} updateWidgetRect={updateWidgetRect} />
                                              : widget.kind === 'instance'
                                                ? <InstanceInspectorPanel widget={widget as import('../../../../shared/types/project').InstanceWidget} activePageId={activePageId} updateWidget={updateWidget} updateWidgetRect={updateWidgetRect} />
                                                : widget.kind === 'keyboard'
                                                  ? <KeyboardInspectorPanel widget={widget as import('../../../../shared/types/project').KeyboardWidget} activePageId={activePageId} updateWidget={updateWidget} updateWidgetRect={updateWidgetRect} />
                                                : widget.kind === 'dmxRecorder'
                                                  ? <DmxRecorderInspectorPanel widget={widget as import('../../../../shared/types/project').DmxRecorderWidget} activePageId={activePageId} updateWidget={updateWidget} updateWidgetRect={updateWidgetRect} />
                                                : widget.kind === 'dmxPlayer'
                                                  ? <DmxPlayerInspectorPanel widget={widget as import('../../../../shared/types/project').DmxPlayerWidget} activePageId={activePageId} updateWidget={updateWidget} updateWidgetRect={updateWidgetRect} />
                                                : widget.kind === 'dmxMonitor'
                                                  ? <DmxMonitorInspectorPanel widget={widget as import('../../../../shared/types/project').DmxMonitorWidget} activePageId={activePageId} updateWidget={updateWidget} updateWidgetRect={updateWidgetRect} />
                                                : widget.kind === 'clock'
                                                  ? <ClockInspectorPanel widget={widget as import('../../../../shared/types/project').ClockWidget} activePageId={activePageId} updateWidget={updateWidget} updateWidgetRect={updateWidgetRect} />
                                                : widget.kind === 'shell'
                                                  ? <ShellInspectorPanel widget={widget} activePageId={activePageId} updateWidget={updateWidget} updateWidgetRect={updateWidgetRect} />
                                                : widget.kind === 'palette'
                                                  ? <PaletteInspectorPanel widget={widget} activePageId={activePageId} updateWidget={updateWidget} updateWidgetRect={updateWidgetRect} />
                                                : widget.kind === 'merge'
                                                  ? <MergeInspectorPanel widget={widget} activePageId={activePageId} updateWidget={updateWidget} updateWidgetRect={updateWidgetRect} />
                                                : widget.kind === 'manual'
                                                  ? <ManualInspectorPanel widget={widget as import('../../../../shared/types/project').ManualWidget} activePageId={activePageId} updateWidget={updateWidget} updateWidgetRect={updateWidgetRect} />
                                                  : <WidgetPanel widget={widget} activePageId={activePageId} updateWidget={updateWidget} updateWidgetRect={updateWidgetRect} />
          : <NoSelectionPanel />
      }
    </div>
    </ResizableColumn>
  );
}

// ─── Widget selected ──────────────────────────────────────────────────────────

function WidgetPanel({ widget, activePageId, updateWidget, updateWidgetRect }: {
  widget: NonNullable<ReturnType<typeof useActivePage> extends null ? never : ReturnType<typeof useActivePage>>['widgets'][number];
  activePageId: string;
  updateWidget: StoreState['updateWidget'];
  updateWidgetRect: StoreState['updateWidgetRect'];
}) {
  const { updateWidgetCounts, resetCellMappings, resetCellNames, resetCellColors, setOutputProtocol } = useStore(useShallow((s) => ({
    updateWidgetCounts: s.updateWidgetCounts,
    resetCellMappings: s.resetCellMappings,
    resetCellNames: s.resetCellNames,
    resetCellColors: s.resetCellColors,
    setOutputProtocol: s.setOutputProtocol,
  })));

  const project = useProject();
  const [apcConflicts, setApcConflicts] = useState<string[]>([]);

  const isBankWidget = widget.kind !== 'xyPad';
  const bankWidget = isBankWidget ? widget as { countX: number; countY: number; spacingX: number; spacingY: number } : null;

  function patch(partial: Record<string, unknown>) {
    updateWidget(activePageId, widget.id, partial as never);
  }

  function patchStyle(partial: Partial<typeof widget.style>) {
    patch({ style: { ...widget.style, ...partial } });
  }

  function applyApcMiniPreset() {
    const bw = widget as ButtonGridWidget;
    const newCells = Array.from({ length: 64 }, (_, i) => {
      const row = Math.floor(i / 8);
      const col = i % 8;
      const note = (7 - row) * 8 + col;
      const existing = bw.cells[i];
      return {
        label: existing?.label ?? String(note),
        color: existing?.color,
        behavior: (existing?.behavior ?? 'toggle') as ButtonBehavior,
        onValue: existing?.onValue ?? 127,
        offValue: existing?.offValue ?? 0,
        feedbackRules: existing?.feedbackRules ?? [],
        mapping: {
          type: 'midi' as const,
          messageType: 'noteOn' as const,
          channel: 1,
          number: note,
          minValue: 0,
          maxValue: 127,
        } as MidiMapping,
      };
    });
    const apcNoteSet = new Set(Array.from({ length: 64 }, (_, i) => i));
    const conflicts: string[] = [];
    for (const page of project.pages) {
      for (const w of page.widgets) {
        if (w.id === widget.id) continue;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const wCells: Array<{ mapping?: Mapping }> = (w as any).cells ?? [];
        const wMappings: Mapping[] = [w.mapping, ...wCells.map((c) => c?.mapping ?? null)];
        for (const m of wMappings) {
          if (!m || m.type !== 'midi') continue;
          if (m.messageType !== 'noteOn' && m.messageType !== 'noteOff') continue;
          if (m.channel !== 1) continue;
          if (apcNoteSet.has(m.number)) {
            conflicts.push(`${page.name} › ${w.label || w.kind} (note ${m.number})`);
            break;
          }
        }
      }
    }
    setApcConflicts(conflicts);
    updateWidget(activePageId, widget.id, { countX: 8, countY: 8, cells: newCells } as never);
  }

  return (
    <>
      <div style={styles.header}>{widget.kind}</div>

      <Section label="Label">
        <input style={styles.input} value={widget.label}
          onChange={(e) => patch({ label: e.target.value })} />
      </Section>

      <Section label="Position">
        <Row>
          <Field label="X">
            <NumInput value={widget.rect.x} onChange={(v) => updateWidgetRect(activePageId, widget.id, { x: v })} />
          </Field>
          <Field label="Y">
            <NumInput value={widget.rect.y} onChange={(v) => updateWidgetRect(activePageId, widget.id, { y: v })} />
          </Field>
        </Row>
        <Row>
          <Field label="W">
            <NumInput value={widget.rect.width} onChange={(v) => updateWidgetRect(activePageId, widget.id, { width: v })} />
          </Field>
          <Field label="H">
            <NumInput value={widget.rect.height} onChange={(v) => updateWidgetRect(activePageId, widget.id, { height: v })} />
          </Field>
        </Row>
      </Section>

      {isBankWidget && (
        <Section label="Preset">
          <PresetBar w={widget as import('../../../../shared/types/project').SliderBankWidget} pageId={activePageId} />
        </Section>
      )}

      {bankWidget && (
        <Section label="Grid">
          <Row>
            <Field label="Cols (X)">
              <NumInput value={bankWidget.countX} onChange={(v) => updateWidgetCounts(activePageId, widget.id, Math.max(1, v), bankWidget.countY)} />
            </Field>
            <Field label="Rows (Y)">
              <NumInput value={bankWidget.countY} onChange={(v) => updateWidgetCounts(activePageId, widget.id, bankWidget.countX, Math.max(1, v))} />
            </Field>
          </Row>
          <Row>
            <Field label="Gap X (px)">
              <NumInput value={bankWidget.spacingX} onChange={(v) => patch({ spacingX: Math.max(0, v) })} />
            </Field>
            <Field label="Gap Y (px)">
              <NumInput value={bankWidget.spacingY} onChange={(v) => patch({ spacingY: Math.max(0, v) })} />
            </Field>
          </Row>
          {widget.kind === 'sliderBank' && (() => {
            const horizontal = (widget as SliderBankWidget).orientation === 'horizontal';
            return (
              <label style={{
                display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
                minHeight: 40, fontSize: 13, color: 'var(--color-text)', userSelect: 'none',
              }}>
                <input
                  type="checkbox"
                  checked={horizontal}
                  onChange={(e) => patch({ orientation: e.target.checked ? 'horizontal' : 'vertical' })}
                  style={{ width: 18, height: 18, cursor: 'pointer', accentColor: 'var(--color-accent)' }}
                />
                Horizontal sliders
              </label>
            );
          })()}
        </Section>
      )}

      {widget.kind === 'knobBank' && (
        <Section label="Knob size">
          <NumInput
            value={(widget as KnobBankWidget).knobSize ?? 56}
            onChange={(v) => patch({ knobSize: Math.max(20, Math.min(200, v)) })}
          />
        </Section>
      )}

      <Section label="Style">
        <Row>
          <Field label="BG">
            <ColorInput value={widget.style.backgroundColor} onChange={(v) => patchStyle({ backgroundColor: v })} />
          </Field>
          <Field label="FG (default)">
            <ColorInput value={widget.style.foregroundColor} onChange={(v) => patchStyle({ foregroundColor: v })} />
          </Field>
        </Row>
        <Row>
          <Field label="Label col.">
            <ColorInput value={widget.style.labelColor} onChange={(v) => patchStyle({ labelColor: v })} />
          </Field>
          <Field label="Radius">
            <NumInput value={widget.style.borderRadius} onChange={(v) => patchStyle({ borderRadius: v })} />
          </Field>
        </Row>
        <Row>
          <Field label="Font size">
            <NumInput value={widget.style.fontSize} onChange={(v) => patchStyle({ fontSize: v })} />
          </Field>
          <Field label="Show labels">
            <input type="checkbox" checked={widget.style.showLabel}
              onChange={(e) => patchStyle({ showLabel: e.target.checked })}
              style={{ marginTop: 6 }} />
          </Field>
        </Row>
        <Row>
          <Field label="Show value">
            <input type="checkbox" checked={widget.style.showValue ?? false}
              onChange={(e) => patchStyle({ showValue: e.target.checked })}
              style={{ marginTop: 6 }} />
          </Field>
          <Field label="Value format">
            <select style={styles.input} value={widget.style.valueFormat ?? 'percent'}
              onChange={(e) => patchStyle({ valueFormat: e.target.value as 'percent' | 'raw' | 'protocol' })}>
              <option value="percent">Percent %</option>
              <option value="raw">Raw 0–1</option>
              <option value="protocol">Protocol</option>
            </select>
          </Field>
        </Row>
      </Section>

      {isBankWidget && (
        <Section label="Output protocol">
          <select
            style={styles.input}
            value={widget.outputProtocol}
            onChange={(e) => setOutputProtocol(activePageId, widget.id, e.target.value as import('../../../../shared/types/project').OutputProtocol)}
          >
            <option value="midi">MIDI</option>
            <option value="osc">OSC</option>
            <option value="enttec">Enttec Open DMX USB</option>
            <option value="artnet">Art-Net (DMX)</option>
            <option value="sacn">sACN / E1.31 (DMX)</option>
          </select>
          <div style={{ fontSize: 12, color: 'var(--color-text-dim)', marginTop: 5 }}>
            Changes protocol and resets cell mappings to defaults.
          </div>
          {widget.outputProtocol === 'osc' && <EosUserRow widget={widget} activePageId={activePageId} />}
          {(() => {
            const proto = widget.outputProtocol as string;
            if (!['midi', 'osc', 'artnet', 'sacn'].includes(proto)) return null;
            const outs = listOutputs(project.connections, proto as OutputProtocol);
            if (outs.length <= 1) return null;
            const bw = widget as { mapping?: Mapping; cells?: Array<{ mapping?: Mapping | null }> };
            const current = (bw.mapping as { outputId?: string } | undefined)?.outputId
              ?? (bw.cells?.[0]?.mapping as { outputId?: string } | null | undefined)?.outputId
              ?? 'primary';
            return (
              <div style={{ marginTop: 8 }}>
                <div style={{ fontSize: 12, color: 'var(--color-text-dim)', marginBottom: 3 }}>Output (all cells)</div>
                <select style={styles.input} value={current}
                  onChange={(e) => {
                    const outputId = e.target.value === 'primary' ? undefined : e.target.value;
                    const apply = (m: Mapping | null | undefined): Mapping | null | undefined =>
                      m ? ({ ...m, outputId } as Mapping) : m;
                    const partial: Record<string, unknown> = {};
                    if (bw.cells) partial.cells = bw.cells.map((c) => ({ ...c, mapping: apply(c.mapping) }));
                    if (bw.mapping) partial.mapping = apply(bw.mapping);
                    patch(partial);
                  }}>
                  {outs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
              </div>
            );
          })()}
        </Section>
      )}

      <FrameSection style={widget.style} patchStyle={patchStyle} />

      {widget.kind === 'buttonGrid' && (
        <>
          <Section label="Button behavior">
            <div style={{ fontSize: 12, color: 'var(--color-text-dim)', marginBottom: 6 }}>
              Set all cells to — override one at a time in ✏ Cells:
            </div>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {(() => {
                const bw = widget as ButtonGridWidget;
                // No normalising: momentary is a real behaviour, not an alias for
                // pulse. A mixed grid highlights nothing, which is correct.
                const normalized = bw.cells.map((c) => c.behavior ?? 'momentary');
                const activeBehavior = normalized.length > 0 && normalized.every((b) => b === normalized[0]) ? normalized[0] : null;
                return (['momentary', 'pulse', 'toggle', 'radio'] as ButtonBehavior[]).map((b) => {
                  const isActive = activeBehavior === b;
                  return (
                    <button key={b} onClick={() => {
                      const newCells = bw.cells.map((c) => ({ ...c, behavior: b }));
                      updateWidget(activePageId, widget.id, { cells: newCells } as never);
                    }} style={{
                      padding: '7px 10px', minHeight: 36, fontSize: 13, cursor: 'pointer', borderRadius: 3,
                      background: isActive ? '#ffffff' : 'var(--color-surface-2)',
                      border: `1px solid ${isActive ? '#ffffff' : 'var(--color-border)'}`,
                      color: isActive ? '#000000' : 'var(--color-text)',
                      textTransform: 'capitalize',
                    }}>{b}</button>
                  );
                });
              })()}
            </div>
            <div style={{ fontSize: 12, color: 'var(--color-text-dim)', marginTop: 8, lineHeight: 1.6 }}>
              <b>M</b> momentary — 1 while held, 0 on release<br />
              <b>P</b> pulse — a short 1 then back to 0<br />
              <b>T</b> toggle — each press flips the state<br />
              <b>R</b> radio — only one stays on
            </div>
          </Section>

          <Section label="APC Mini">
            <div style={{ fontSize: 12, color: 'var(--color-text-dim)', marginBottom: 6 }}>
              Sets an 8×8 grid, Note On ch 1, APC Mini layout.<br />
              Rename the loopMIDI port to <strong style={{ color: 'var(--color-text)' }}>"APC MINI"</strong>.
            </div>
            <ResetBtn onClick={applyApcMiniPreset}>
              ⬛ Apply APC Mini layout
            </ResetBtn>
            {apcConflicts.length > 0 && (
              <div style={{ marginTop: 8, fontSize: 12, color: pal('#e66b00'), lineHeight: 1.5 }}>
                ⚠ Other widgets use ch 1 notes 0–63:
                {apcConflicts.map((c, idx) => (
                  <div key={idx} style={{ paddingLeft: 8 }}>· {c}</div>
                ))}
                <div style={{ marginTop: 4, color: 'var(--color-text-dim)' }}>
                  The APC buttons take priority on the conflicting notes.
                </div>
              </div>
            )}
          </Section>
        </>
      )}

      {isBankWidget && (
        <Section label="Reset">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <ResetBtn onClick={() => resetCellMappings(activePageId, widget.id)}>
              ↺ Auto channel index
            </ResetBtn>
            <ResetBtn onClick={() => resetCellNames(activePageId, widget.id)}>
              ↺ Reset names
            </ResetBtn>
            <ResetBtn onClick={() => resetCellColors(activePageId, widget.id)}>
              ↺ Reset colors (use FG default)
            </ResetBtn>
          </div>
        </Section>
      )}

      {(widget.kind === 'sliderBank' || widget.kind === 'knobBank' || widget.kind === 'buttonGrid' || widget.kind === 'xyPad') && (
        <Section label="Trigger">
          <ResetBtn onClick={() => {
            const wr = useStore.getState().runtime.widgets[widget.id];
            if (widget.kind === 'sliderBank' || widget.kind === 'knobBank') {
              for (let i = 0; i < widget.cells.length; i++) {
                dispatchValue(widget.cells[i]?.mapping ?? widget.mapping, wr?.cells[i]?.value ?? 0);
              }
            } else if (widget.kind === 'buttonGrid') {
              for (let i = 0; i < widget.cells.length; i++) {
                const cell = widget.cells[i];
                dispatchButton(cell?.mapping ?? widget.mapping, wr?.cells[i]?.active ?? false, cell?.onValue ?? 127, cell?.offValue ?? 0);
              }
            } else if (widget.kind === 'xyPad') {
              (wr?.cells ?? []).forEach((c, i) => dispatchValue(xyMapping(widget, i), c.value ?? 0));
            }
          }}>
            ↦ Send all current values
          </ResetBtn>
        </Section>
      )}
    </>
  );
}

// Settings → Palette: the two interface colours, kept on this computer.
// The whole interface redraws in them; Reset brings back laguna + fire orange.
function PaletteSection(): React.JSX.Element {
  const saved = useStore((st) => st.project.palette) ?? DEFAULT_PALETTE;
  const [p, setP] = useState<Palette>(saved);
  useEffect(() => { setP(saved); }, [saved.accent, saved.highlight]);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  // Stored in the project; App applies it to the interface.
  const commit = (next: Palette | undefined) => useStore.setState((st) => ({ project: { ...st.project, palette: next } }));
  const change = (k: keyof Palette, v: string) => {
    const next = { ...p, [k]: v };
    setP(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => commit(next), 250);
  };
  const isDefault = p.accent === DEFAULT_PALETTE.accent && p.highlight === DEFAULT_PALETTE.highlight;
  const row = (k: keyof Palette, label: string, hint: string) => (
    <label title={hint} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, cursor: 'pointer', marginBottom: 6 }}>
      <input type="color" value={p[k]} onChange={(e) => change(k, e.target.value)}
        style={{ width: 34, height: 22, padding: 0, border: '1px solid var(--color-border)', background: 'transparent', cursor: 'pointer' }} />
      <span style={{ flex: 1 }}>{label}</span>
      <span style={{ fontFamily: 'monospace', color: 'var(--color-text-dim)' }}>{p[k]}</span>
    </label>
  );
  return (
    <Section label="Palette">
      {row('accent', 'Accent', 'Selections, active states, inputs, Live')}
      {row('highlight', 'Highlight', 'Warnings, outputs, Learn, the second colour')}
      <ResetBtn onClick={() => { if (timer.current) clearTimeout(timer.current); setP(DEFAULT_PALETTE); commit(undefined); }}>
        {isDefault ? 'Default palette' : '↺ Reset palette'}
      </ResetBtn>
    </Section>
  );
}

function ResetBtn({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{
      background: 'var(--color-surface-2)',
      border: '1px solid var(--color-border)',
      color: 'var(--color-text-dim)',
      borderRadius: 'var(--radius-sm)',
      padding: '4px 8px',
      fontSize: 12, cursor: 'pointer',
      textAlign: 'left',
    }}>
      {children}
    </button>
  );
}

// ─── Timeline inspector panel ────────────────────────────────────────────────

function TimelineInspectorPanel({ widget, activePageId, updateWidget, updateWidgetRect }: {
  widget: TimelineWidget;
  activePageId: string;
  updateWidget: StoreState['updateWidget'];
  updateWidgetRect: StoreState['updateWidgetRect'];
}) {
  function patch(partial: Partial<TimelineWidget>) {
    updateWidget(activePageId, widget.id, partial as never);
  }
  return (
    <>
      <div style={styles.header}>Timeline</div>
      <Section label="Label">
        <input style={styles.input} value={widget.label} onChange={(e) => patch({ label: e.target.value })} />
      </Section>
      <Section label="Position">
        <Row>
          <Field label="X"><NumInput value={widget.rect.x} onChange={(v) => updateWidgetRect(activePageId, widget.id, { x: v })} /></Field>
          <Field label="Y"><NumInput value={widget.rect.y} onChange={(v) => updateWidgetRect(activePageId, widget.id, { y: v })} /></Field>
        </Row>
        <Row>
          <Field label="W"><NumInput value={widget.rect.width} onChange={(v) => updateWidgetRect(activePageId, widget.id, { width: v })} /></Field>
          <Field label="H"><NumInput value={widget.rect.height} onChange={(v) => updateWidgetRect(activePageId, widget.id, { height: v })} /></Field>
        </Row>
      </Section>
      <Section label="Playback">
        <Row>
          <Field label="Duration (s)">
            <NumInput value={widget.duration} onChange={(v) => patch({ duration: Math.max(1, v) })} />
          </Field>
          <Field label="Loop">
            <input type="checkbox" checked={widget.loopMode === 'loop'}
              onChange={(e) => patch({ loopMode: e.target.checked ? 'loop' : 'none' })}
              style={{ marginTop: 6 }} />
          </Field>
        </Row>
      </Section>
      <Section label="Play trigger">
        <MappingEditor mapping={widget.playMapping} onChange={(m) => patch({ playMapping: m })} />
      </Section>
      <Section label="Stop trigger">
        <MappingEditor mapping={widget.stopMapping} onChange={(m) => patch({ stopMapping: m })} />
      </Section>
      <Section label="Timecode sync">
        <Row>
          <Field label="Source">
            <select style={styles.input} value={widget.timecodeSource ?? 'off'}
              onChange={(e) => patch({ timecodeSource: e.target.value as 'off' | 'ltc' | 'mtc' })}>
              <option value="off">Off</option>
              <option value="ltc">LTC (audio)</option>
              <option value="mtc">MTC (MIDI)</option>
            </select>
          </Field>
        </Row>
        {(widget.timecodeSource === 'ltc' || widget.timecodeSource === 'mtc') && (
          <Row>
            <Field label="Frame rate">
              <select style={styles.input} value={widget.timecodeFrameRate ?? 25}
                onChange={(e) => patch({ timecodeFrameRate: Number(e.target.value) as 24 | 25 | 29.97 | 30 })}>
                <option value={24}>24 fps</option>
                <option value={25}>25 fps</option>
                <option value={29.97}>29.97 fps</option>
                <option value={30}>30 fps</option>
              </select>
            </Field>
          </Row>
        )}
      </Section>
      <div style={{ fontSize: 12, color: 'var(--color-text-dim)', padding: '8px 12px', lineHeight: 1.5 }}>
        {widget.tracks.length} track{widget.tracks.length !== 1 ? 's' : ''}.
        <br />Manage tracks in Live mode.
      </div>
    </>
  );
}

// ─── Cues inspector panel ─────────────────────────────────────────────────────

type NavKey = 'navFirst' | 'navPrev' | 'navNext' | 'navRandom' | 'navLast';
const NAV_BUTTONS: { key: NavKey; label: string; defaultAddr: string }[] = [
  { key: 'navFirst',  label: '⏮ First',   defaultAddr: '/cue/first'  },
  { key: 'navPrev',   label: '◀ Prev',    defaultAddr: '/cue/prev'   },
  { key: 'navNext',   label: 'Next ▶',    defaultAddr: '/cue/next'   },
  { key: 'navRandom', label: '✦ Random',  defaultAddr: '/cue/random' },
  { key: 'navLast',   label: 'Last ⏭',   defaultAddr: '/cue/last'   },
];


// ─── Cue scope ────────────────────────────────────────────────────────────────
// What a recorded cue covers. Rendered here and, with the same helpers, in the
// Live sidebar — a cue's reach is something you retune during a show.

function CueScopeFields({ widget, patch }: {
  widget: CuesWidget;
  patch: (p: Record<string, unknown>) => void;
}) {
  const project = useProject();
  const pageOpts = cueScopePages(project);
  const widgetOpts = cueScopeWidgets(project, widget.scopePageId);

  return (
    <Section label="Cue scope">
      <Field label="Pages">
        <select style={styles.input} value={widget.scopePageId ?? CUE_SCOPE_ALL}
          // Changing the page invalidates a widget picked from another one.
          onChange={(e) => patch({ scopePageId: e.target.value, scopeWidgetId: CUE_SCOPE_ALL })}>
          {pageOpts.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
      </Field>
      <Field label="Widgets">
        <select style={styles.input} value={widget.scopeWidgetId ?? CUE_SCOPE_ALL}
          onChange={(e) => patch({ scopeWidgetId: e.target.value })}>
          {widgetOpts.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
      </Field>
      <Field label="Exclude">
        <ExcludeList options={widgetOpts.filter((o) => o.id !== CUE_SCOPE_ALL)} value={widget.excludeIds ?? []} onChange={(ids) => patch({ excludeIds: ids })} />
      </Field>
    </Section>
  );
}

function CuesInspectorPanel({ widget, activePageId, updateWidget }: {
  widget: CuesWidget;
  activePageId: string;
  updateWidget: StoreState['updateWidget'];
}) {
  function patch(partial: Record<string, unknown>) {
    updateWidget(activePageId, widget.id, partial as never);
  }
  return (
    <>
      <div style={styles.header}>cues</div>
      <Section label="Label">
        <input style={styles.input} value={widget.label} onChange={(e) => patch({ label: e.target.value })} />
      </Section>
      <div style={{ fontSize: 12, color: 'var(--color-text-dim)', padding: '8px 12px', lineHeight: 1.5 }}>
        OSC trigger: /<em>cuename</em>
      </div>
      <CueScopeFields widget={widget} patch={patch} />
      <Section label="Navigation mappings">
        {NAV_BUTTONS.map(({ key, label, defaultAddr }) => {
          const m = widget[key];
          return (
            <div key={key} style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 12, color: 'var(--color-text-dim)', marginBottom: 4, fontWeight: 500 }}>{label}</div>
              <select
                style={{ ...styles.input, marginBottom: 4 }}
                value={m?.type ?? 'none'}
                onChange={(e) => {
                  const t = e.target.value;
                  if (t === 'none') patch({ [key]: null });
                  else if (t === 'midi') patch({ [key]: { type: 'midi', messageType: 'controlChange', channel: 1, number: 0, minValue: 0, maxValue: 127 } });
                  else patch({ [key]: { type: 'osc', address: defaultAddr } });
                }}
              >
                <option value="none">Off</option>
                <option value="midi">MIDI</option>
                <option value="osc">OSC</option>
              </select>
              {m?.type === 'midi' && (
                <Row>
                  <Field label="Ch.">
                    <NumInput value={(m as MidiMapping).channel} onChange={(v) => patch({ [key]: { ...m, channel: Math.max(1, Math.min(16, v)) } })} />
                  </Field>
                  <Field label="CC / Note">
                    <NumInput value={(m as MidiMapping).number} onChange={(v) => patch({ [key]: { ...m, number: Math.max(0, Math.min(127, v)) } })} />
                  </Field>
                </Row>
              )}
              {m?.type === 'osc' && (
                <input
                  style={styles.input}
                  value={(m as OscMapping).address}
                  onChange={(e) => patch({ [key]: { ...m, address: e.target.value } })}
                  placeholder="/address"
                />
              )}
            </div>
          );
        })}
      </Section>
    </>
  );
}

// ─── Image widget panel ───────────────────────────────────────────────────────

const BLEND_MODES: BlendMode[] = [
  'normal','screen','multiply','overlay','difference',
  'exclusion','hard-light','soft-light','color-dodge','color-burn',
  'luminosity','hue','saturation','color',
];

function ImagePanel({ widget, activePageId, updateWidget }: {
  widget: ImageWidget;
  activePageId: string;
  updateWidget: StoreState['updateWidget'];
}) {
  function patch(partial: Partial<ImageWidget>) {
    updateWidget(activePageId, widget.id, partial as never);
  }

  async function pickImage() {
    try {
      const dataUrl = await bridge.invoke('tr:file:pickImage', undefined as never);
      if (dataUrl) patch({ src: dataUrl });
    } catch (err) {
      console.error('pickImage failed:', err);
    }
  }

  return (
    <>
      <div style={styles.header}>Image</div>

      <Section label="File">
        <div style={{
          fontSize: 12, color: 'var(--color-text-dim)',
          marginBottom: 6, wordBreak: 'break-all',
        }}>
          {widget.src ? 'Image loaded' : 'No image selected'}
        </div>
        <button onClick={pickImage} style={{ ...styles.input, cursor: 'pointer', textAlign: 'left', background: 'var(--color-surface-2)' }}>
          Pick image…
        </button>
        {widget.src && (
          <button onClick={() => patch({ src: '' })} style={{ ...styles.input, cursor: 'pointer', marginTop: 4, color: 'var(--color-accent)', background: 'var(--color-surface-2)' }}>
            Clear
          </button>
        )}
      </Section>

      <Section label="Layer">
        <div style={{ display: 'flex', gap: 6 }}>
          {(['under', 'over'] as const).map((l) => (
            <button key={l} onClick={() => patch({ layer: l })} style={{
              flex: 1, padding: '4px 0', fontSize: 12, cursor: 'pointer', borderRadius: 3,
              background: widget.layer === l ? 'var(--color-accent)' : 'var(--color-surface-2)',
              border: `1px solid ${widget.layer === l ? 'var(--color-accent)' : 'var(--color-border)'}`,
              color: widget.layer === l ? '#000' : 'var(--color-text)',
              textTransform: 'capitalize',
            }}>{l}</button>
          ))}
        </div>
      </Section>

      <Section label="Blend Mode">
        <select style={styles.input} value={widget.blendMode}
          onChange={(e) => patch({ blendMode: e.target.value as BlendMode })}>
          {BLEND_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      </Section>

      <Section label="Opacity">
        <Row>
          <Field label={`${Math.round(widget.opacity * 100)}%`}>
            <input type="range" min={0} max={1} step={0.01}
              value={widget.opacity}
              onChange={(e) => patch({ opacity: Number(e.target.value) })}
              style={{ width: '100%' }} />
          </Field>
        </Row>
      </Section>
    </>
  );
}

// ─── Text widget panel ────────────────────────────────────────────────────────

const FONT_FAMILIES = [
  { label: 'System sans-serif', value: 'sans-serif' },
  { label: 'System serif',      value: 'serif' },
  { label: 'Monospace',         value: 'monospace' },
  { label: 'Impact',            value: 'Impact, sans-serif' },
  { label: 'Arial',             value: 'Arial, sans-serif' },
  { label: 'Georgia',           value: 'Georgia, serif' },
  { label: 'Custom…',           value: '__custom__' },
];

function TextPanel({ widget, activePageId, updateWidget, updateWidgetRect }: {
  widget: TextWidget;
  activePageId: string;
  updateWidget: StoreState['updateWidget'];
  updateWidgetRect: StoreState['updateWidgetRect'];
}) {
  const [customFont, setCustomFont] = useState('');

  function patch(partial: Partial<TextWidget>) {
    updateWidget(activePageId, widget.id, partial as never);
  }

  const isCustomFont = !FONT_FAMILIES.some((f) => f.value === widget.fontFamily && f.value !== '__custom__');

  return (
    <>
      <div style={styles.header}>Text</div>

      <Section label="Content">
        <textarea
          style={{ ...styles.input, height: 72, resize: 'vertical', fontFamily: 'inherit' }}
          value={widget.text}
          onChange={(e) => patch({ text: e.target.value })}
        />
      </Section>

      <Section label="Position">
        <Row>
          <Field label="X">
            <NumInput value={widget.rect.x} onChange={(v) => updateWidgetRect(activePageId, widget.id, { x: v })} />
          </Field>
          <Field label="Y">
            <NumInput value={widget.rect.y} onChange={(v) => updateWidgetRect(activePageId, widget.id, { y: v })} />
          </Field>
        </Row>
        <Row>
          <Field label="W">
            <NumInput value={widget.rect.width} onChange={(v) => updateWidgetRect(activePageId, widget.id, { width: v })} />
          </Field>
          <Field label="H">
            <NumInput value={widget.rect.height} onChange={(v) => updateWidgetRect(activePageId, widget.id, { height: v })} />
          </Field>
        </Row>
      </Section>

      <Section label="Font">
        <Field label="Family">
          <select style={styles.input}
            value={isCustomFont ? '__custom__' : widget.fontFamily}
            onChange={(e) => {
              if (e.target.value === '__custom__') return;
              patch({ fontFamily: e.target.value });
            }}>
            {FONT_FAMILIES.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
        </Field>
        {isCustomFont && (
          <Field label="Custom font name">
            <input style={styles.input}
              value={customFont || widget.fontFamily}
              onChange={(e) => setCustomFont(e.target.value)}
              onBlur={() => { if (customFont) patch({ fontFamily: customFont }); }}
              placeholder="e.g. Roboto, Arial" />
          </Field>
        )}
        <Row>
          <Field label="Size (px)">
            <NumInput value={widget.style.fontSize}
              onChange={(v) => updateWidget(activePageId, widget.id, { style: { ...widget.style, fontSize: v } } as never)} />
          </Field>
          <Field label="Align">
            <select style={styles.input} value={widget.textAlign}
              onChange={(e) => patch({ textAlign: e.target.value as TextAlign })}>
              <option value="left">Left</option>
              <option value="center">Center</option>
              <option value="right">Right</option>
            </select>
          </Field>
        </Row>
        <Row>
          <Field label="Weight">
            <select style={styles.input} value={widget.fontWeight}
              onChange={(e) => patch({ fontWeight: e.target.value as FontWeight })}>
              <option value="normal">Normal</option>
              <option value="bold">Bold</option>
            </select>
          </Field>
          <Field label="Style">
            <select style={styles.input} value={widget.fontStyle}
              onChange={(e) => patch({ fontStyle: e.target.value as FontStyle })}>
              <option value="normal">Normal</option>
              <option value="italic">Italic</option>
            </select>
          </Field>
        </Row>
      </Section>

      <Section label="Color">
        <Field label="Text color">
          <ColorInput value={widget.textColor} onChange={(v) => patch({ textColor: v })} />
        </Field>
      </Section>

      <Section label="Frame">
        <Field label="Type">
          <select style={styles.input} value={widget.frame}
            onChange={(e) => patch({ frame: e.target.value as TextFrame })}>
            <option value="none">None</option>
            <option value="outline">Outline (border)</option>
            <option value="underline">Underline</option>
          </select>
        </Field>
        {widget.frame !== 'none' && (
          <Row>
            <Field label="Color">
              <ColorInput value={widget.frameColor} onChange={(v) => patch({ frameColor: v })} />
            </Field>
            <Field label="Size (px)">
              <NumInput value={widget.frameSize} onChange={(v) => patch({ frameSize: Math.max(1, v) })} />
            </Field>
          </Row>
        )}
      </Section>

      <Section label="Layer">
        <div style={{ display: 'flex', gap: 6 }}>
          {(['under', 'over'] as const).map((l) => (
            <button key={l} onClick={() => patch({ layer: l })} style={{
              flex: 1, padding: '4px 0', fontSize: 12, cursor: 'pointer', borderRadius: 3,
              background: widget.layer === l ? 'var(--color-accent)' : 'var(--color-surface-2)',
              border: `1px solid ${widget.layer === l ? 'var(--color-accent)' : 'var(--color-border)'}`,
              color: widget.layer === l ? '#000' : 'var(--color-text)',
              textTransform: 'capitalize',
            }}>{l}</button>
          ))}
        </div>
      </Section>
    </>
  );
}

// ─── Step Sequencer panel ─────────────────────────────────────────────────────

const SPEED_OPTIONS: { label: string; value: SpeedMultiplier }[] = [
  { label: '1/8', value: 0.125 },
  { label: '1/4', value: 0.25  },
  { label: '1/2', value: 0.5   },
  { label: '1x',  value: 1     },
  { label: '2x',  value: 2     },
  { label: '4x',  value: 4     },
  { label: '8x',  value: 8     },
];

const STEP_COUNT_OPTIONS = [4, 8, 16, 32];

function StepSequencerPanel({ widget, activePageId, updateWidget, updateWidgetRect }: {
  widget: StepSequencerWidget;
  activePageId: string;
  updateWidget: StoreState['updateWidget'];
  updateWidgetRect: StoreState['updateWidgetRect'];
}) {
  function patch(partial: Partial<StepSequencerWidget>) {
    updateWidget(activePageId, widget.id, partial as never);
  }

  function patchStyle(partial: Partial<typeof widget.style>) {
    patch({ style: { ...widget.style, ...partial } });
  }

  function handleStepCountChange(newCount: number) {
    const oldSteps = widget.steps;
    const newSteps = Array.from({ length: newCount }, (_, i) =>
      i < oldSteps.length ? oldSteps[i] : { active: false, value: 1 }
    );
    patch({ stepCount: newCount, steps: newSteps });
  }

  function handleAllOn() {
    patch({ steps: widget.steps.map((s) => ({ ...s, active: true })) });
  }

  function handleAllOff() {
    patch({ steps: widget.steps.map((s) => ({ ...s, active: false })) });
  }

  function handleAllValue(v: number) {
    patch({ steps: widget.steps.map((s) => ({ ...s, value: v })) });
  }

  return (
    <>
      <div style={styles.header}>Step Sequencer</div>
      <GenTransportSection widget={widget} speed={widget.speedMultiplier} onSpeed={(v) => patch({ speedMultiplier: v })} />

      <Section label="Label">
        <input style={styles.input} value={widget.label}
          onChange={(e) => patch({ label: e.target.value })} />
      </Section>

      <Section label="Position">
        <Row>
          <Field label="X">
            <NumInput value={widget.rect.x} onChange={(v) => updateWidgetRect(activePageId, widget.id, { x: v })} />
          </Field>
          <Field label="Y">
            <NumInput value={widget.rect.y} onChange={(v) => updateWidgetRect(activePageId, widget.id, { y: v })} />
          </Field>
        </Row>
        <Row>
          <Field label="W">
            <NumInput value={widget.rect.width} onChange={(v) => updateWidgetRect(activePageId, widget.id, { width: v })} />
          </Field>
          <Field label="H">
            <NumInput value={widget.rect.height} onChange={(v) => updateWidgetRect(activePageId, widget.id, { height: v })} />
          </Field>
        </Row>
      </Section>

      <Section label="Sequencer">
        <Field label="Steps">
          <div style={{ display: 'flex', gap: 4 }}>
            {STEP_COUNT_OPTIONS.map((n) => (
              <button key={n} onClick={() => handleStepCountChange(n)} style={{
                flex: 1, padding: '4px 0', fontSize: 12, cursor: 'pointer', borderRadius: 3,
                background: widget.stepCount === n ? 'var(--color-accent)' : 'var(--color-surface-2)',
                border: `1px solid ${widget.stepCount === n ? 'var(--color-accent)' : 'var(--color-border)'}`,
                color: widget.stepCount === n ? '#fff' : 'var(--color-text)',
              }}>{n}</button>
            ))}
          </div>
        </Field>
        <Field label="Default speed">
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {SPEED_OPTIONS.map(({ label, value }) => (
              <button key={value} onClick={() => patch({ speedMultiplier: value })} style={{
                padding: '3px 6px', fontSize: 12, cursor: 'pointer', borderRadius: 3,
                background: widget.speedMultiplier === value ? 'var(--color-accent)' : 'var(--color-surface-2)',
                border: `1px solid ${widget.speedMultiplier === value ? 'var(--color-accent)' : 'var(--color-border)'}`,
                color: widget.speedMultiplier === value ? '#fff' : 'var(--color-text)',
              }}>{label}</button>
            ))}
          </div>
        </Field>
      </Section>

      <Section label="Step pattern">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <Row>
            <ResetBtn onClick={handleAllOn}>All on</ResetBtn>
            <ResetBtn onClick={handleAllOff}>All off</ResetBtn>
          </Row>
          <Row>
            <ResetBtn onClick={() => handleAllValue(1)}>Values → full</ResetBtn>
            <ResetBtn onClick={() => handleAllValue(0.5)}>Values → half</ResetBtn>
          </Row>
        </div>
      </Section>

      <Section label="Style">
        <Row>
          <Field label="BG">
            <ColorInput value={widget.style.backgroundColor} onChange={(v) => patchStyle({ backgroundColor: v })} />
          </Field>
          <Field label="FG">
            <ColorInput value={widget.style.foregroundColor} onChange={(v) => patchStyle({ foregroundColor: v })} />
          </Field>
        </Row>
        <Row>
          <Field label="Font size">
            <NumInput value={widget.style.fontSize} onChange={(v) => patchStyle({ fontSize: v })} />
          </Field>
          <Field label="Show labels">
            <input type="checkbox" checked={widget.style.showLabel}
              onChange={(e) => patchStyle({ showLabel: e.target.checked })}
              style={{ marginTop: 6 }} />
          </Field>
        </Row>
        <Row>
          <Field label="Show value">
            <input type="checkbox" checked={widget.style.showValue ?? false}
              onChange={(e) => patchStyle({ showValue: e.target.checked })}
              style={{ marginTop: 6 }} />
          </Field>
          <Field label="Value format">
            <select style={styles.input} value={widget.style.valueFormat ?? 'percent'}
              onChange={(e) => patchStyle({ valueFormat: e.target.value as 'percent' | 'raw' | 'protocol' })}>
              <option value="percent">Percent %</option>
              <option value="raw">Raw 0–1</option>
              <option value="protocol">Protocol</option>
            </select>
          </Field>
        </Row>
      </Section>

      <Section label="Output protocol">
        <select
          style={styles.input}
          value={widget.outputProtocol}
          onChange={(e) => {
            const proto = e.target.value as import('../../../../shared/types/project').OutputProtocol;
            let mapping: import('../../../../shared/types/mapping').Mapping;
            if (proto === 'midi') {
              mapping = { type: 'midi', messageType: 'controlChange', channel: 1, number: 0, minValue: 0, maxValue: 127 };
            } else if (proto === 'osc') {
              mapping = { type: 'osc', address: '/seq/1' };
            } else if (proto === 'enttec') {
              mapping = { type: 'enttec', channel: 1, minValue: 0, maxValue: 255 };
            } else if (proto === 'artnet') {
              mapping = { type: 'artnet', universe: 0, channel: 1, minValue: 0, maxValue: 255 };
            } else {
              mapping = { type: 'sacn', universe: 1, channel: 1, minValue: 0, maxValue: 255, priority: 100 };
            }
            patch({ outputProtocol: proto, mapping } as never);
          }}
        >
          <option value="midi">MIDI</option>
          <option value="osc">OSC</option>
          <option value="enttec">Enttec Open DMX USB</option>
          <option value="artnet">Art-Net (DMX)</option>
          <option value="sacn">sACN / E1.31 (DMX)</option>
        </select>
      </Section>

      <Section label="Mapping">
        {widget.mapping?.type === 'midi' && (
          <>
            <Row>
              <Field label="Channel">
                <NumInput value={widget.mapping.channel} onChange={(v) => patch({ mapping: { ...widget.mapping!, channel: Math.max(1, Math.min(16, v)) } } as never)} />
              </Field>
              <Field label="CC / Note">
                <NumInput value={widget.mapping.number} onChange={(v) => patch({ mapping: { ...widget.mapping!, number: Math.max(0, Math.min(127, v)) } } as never)} />
              </Field>
            </Row>
            <Row>
              <Field label="Min">
                <NumInput value={widget.mapping.minValue} onChange={(v) => patch({ mapping: { ...widget.mapping!, minValue: v } } as never)} />
              </Field>
              <Field label="Max">
                <NumInput value={widget.mapping.maxValue} onChange={(v) => patch({ mapping: { ...widget.mapping!, maxValue: v } } as never)} />
              </Field>
            </Row>
          </>
        )}
        {widget.mapping?.type === 'osc' && (
          <Field label="Address">
            <input style={styles.input} value={(widget.mapping as import('../../../../shared/types/mapping').OscMapping).address}
              onChange={(e) => patch({ mapping: { ...widget.mapping!, address: e.target.value } } as never)} />
          </Field>
        )}
        {widget.mapping?.type === 'enttec' && (
          <Row>
            <Field label="Channel">
              <NumInput value={(widget.mapping as import('../../../../shared/types/mapping').EnttecDmxMapping).channel}
                onChange={(v) => patch({ mapping: { ...widget.mapping!, channel: Math.max(1, Math.min(512, v)) } } as never)} />
            </Field>
            <Field label="Min">
              <NumInput value={(widget.mapping as import('../../../../shared/types/mapping').EnttecDmxMapping).minValue}
                onChange={(v) => patch({ mapping: { ...widget.mapping!, minValue: v } } as never)} />
            </Field>
            <Field label="Max">
              <NumInput value={(widget.mapping as import('../../../../shared/types/mapping').EnttecDmxMapping).maxValue}
                onChange={(v) => patch({ mapping: { ...widget.mapping!, maxValue: v } } as never)} />
            </Field>
          </Row>
        )}
        {(widget.mapping?.type === 'artnet' || widget.mapping?.type === 'sacn') && (
          <>
            <Row>
              <Field label="Universe">
                <NumInput value={(widget.mapping as import('../../../../shared/types/mapping').ArtNetMapping).universe}
                  onChange={(v) => patch({ mapping: { ...widget.mapping!, universe: v } } as never)} />
              </Field>
              <Field label="Channel">
                <NumInput value={(widget.mapping as import('../../../../shared/types/mapping').ArtNetMapping).channel}
                  onChange={(v) => patch({ mapping: { ...widget.mapping!, channel: Math.max(1, Math.min(512, v)) } } as never)} />
              </Field>
            </Row>
            <Row>
              <Field label="Min">
                <NumInput value={(widget.mapping as import('../../../../shared/types/mapping').ArtNetMapping).minValue}
                  onChange={(v) => patch({ mapping: { ...widget.mapping!, minValue: v } } as never)} />
              </Field>
              <Field label="Max">
                <NumInput value={(widget.mapping as import('../../../../shared/types/mapping').ArtNetMapping).maxValue}
                  onChange={(v) => patch({ mapping: { ...widget.mapping!, maxValue: v } } as never)} />
              </Field>
            </Row>
          </>
        )}
        <OutputSelect mapping={widget.mapping ?? null} onChange={(m) => patch({ mapping: m } as never)} />
      </Section>

      <FrameSection style={widget.style} patchStyle={(p) => patch({ style: { ...widget.style, ...p } } as never)} />
    </>
  );
}

// ─── Graph widget panel ───────────────────────────────────────────────────────

function GraphPanel({ widget, activePageId, updateWidget, updateWidgetRect }: {
  widget: GraphWidget;
  activePageId: string;
  updateWidget: StoreState['updateWidget'];
  updateWidgetRect: StoreState['updateWidgetRect'];
}) {
  function patch(partial: Partial<GraphWidget>) {
    updateWidget(activePageId, widget.id, partial as never);
  }

  function patchStyle(partial: Partial<typeof widget.style>) {
    patch({ style: { ...widget.style, ...partial } });
  }

  return (
    <>
      <div style={styles.header}>Graph</div>
      <GenTransportSection widget={widget} speed={widget.speedMultiplier} onSpeed={(v) => patch({ speedMultiplier: v })} />

      <Section label="Label">
        <input style={styles.input} value={widget.label}
          onChange={(e) => patch({ label: e.target.value })} />
      </Section>

      <Section label="Position">
        <Row>
          <Field label="X">
            <NumInput value={widget.rect.x} onChange={(v) => updateWidgetRect(activePageId, widget.id, { x: v })} />
          </Field>
          <Field label="Y">
            <NumInput value={widget.rect.y} onChange={(v) => updateWidgetRect(activePageId, widget.id, { y: v })} />
          </Field>
        </Row>
        <Row>
          <Field label="W">
            <NumInput value={widget.rect.width} onChange={(v) => updateWidgetRect(activePageId, widget.id, { width: v })} />
          </Field>
          <Field label="H">
            <NumInput value={widget.rect.height} onChange={(v) => updateWidgetRect(activePageId, widget.id, { height: v })} />
          </Field>
        </Row>
      </Section>

      <Section label="Playback">
        <Field label="Timing">
          <div style={{ display: 'flex', gap: 4 }}>
            {(['bpm', 'manual'] as const).map((m) => (
              <button key={m} onClick={() => patch({ timingMode: m })} style={{
                flex: 1, padding: '4px 0', fontSize: 12, cursor: 'pointer', borderRadius: 3,
                background: (widget.timingMode ?? 'bpm') === m ? 'var(--color-accent)' : 'var(--color-surface-2)',
                border: `1px solid ${(widget.timingMode ?? 'bpm') === m ? 'var(--color-accent)' : 'var(--color-border)'}`,
                color: (widget.timingMode ?? 'bpm') === m ? '#fff' : 'var(--color-text)',
              }}>{m === 'bpm' ? 'BPM' : 'Manual (sec)'}</button>
            ))}
          </div>
        </Field>

        <Field label="Mode">
          <div style={{ display: 'flex', gap: 4 }}>
            {(['loop', 'once'] as const).map((m) => (
              <button key={m} onClick={() => patch({ playMode: m })} style={{
                flex: 1, padding: '4px 0', fontSize: 12, cursor: 'pointer', borderRadius: 3,
                background: (widget.playMode ?? 'loop') === m ? 'var(--color-accent)' : 'var(--color-surface-2)',
                border: `1px solid ${(widget.playMode ?? 'loop') === m ? 'var(--color-accent)' : 'var(--color-border)'}`,
                color: (widget.playMode ?? 'loop') === m ? '#fff' : 'var(--color-text)',
                textTransform: 'capitalize' as const,
              }}>{m}</button>
            ))}
          </div>
        </Field>

        {(widget.timingMode ?? 'bpm') === 'bpm' && (
          <Field label="Speed">
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {SPEED_OPTIONS.map(({ label, value }) => (
                <button key={value} onClick={() => patch({ speedMultiplier: value })} style={{
                  padding: '3px 6px', fontSize: 12, cursor: 'pointer', borderRadius: 3,
                  background: widget.speedMultiplier === value ? 'var(--color-accent)' : 'var(--color-surface-2)',
                  border: `1px solid ${widget.speedMultiplier === value ? 'var(--color-accent)' : 'var(--color-border)'}`,
                  color: widget.speedMultiplier === value ? '#fff' : 'var(--color-text)',
                }}>{label}</button>
              ))}
            </div>
          </Field>
        )}

        {(widget.timingMode ?? 'bpm') === 'manual' && (
          <Field label="Duration (seconds)">
            <NumInput
              value={widget.manualDuration ?? 4}
              onChange={(v) => patch({ manualDuration: Math.max(0.1, Math.round(v * 10) / 10) })}
            />
          </Field>
        )}
      </Section>

      <Section label="Play Trigger">
        <TriggerField
          mapping={widget.playMapping ?? null}
          defaultAddress="/graph/play"
          onChange={(m) => patch({ playMapping: m })}
        />
      </Section>

      <Section label="Stop Trigger">
        <TriggerField
          mapping={widget.stopMapping ?? null}
          defaultAddress="/graph/stop"
          onChange={(m) => patch({ stopMapping: m })}
        />
      </Section>

      <Section label="Reverse Trigger">
        <TriggerField
          mapping={widget.reverseMapping ?? null}
          defaultAddress="/graph/rev"
          onChange={(m) => patch({ reverseMapping: m })}
        />
      </Section>

      <Section label="Style">
        <Row>
          <Field label="BG">
            <ColorInput value={widget.style.backgroundColor} onChange={(v) => patchStyle({ backgroundColor: v })} />
          </Field>
          <Field label="FG">
            <ColorInput value={widget.style.foregroundColor} onChange={(v) => patchStyle({ foregroundColor: v })} />
          </Field>
        </Row>
        <Row>
          <Field label="Font size">
            <NumInput value={widget.style.fontSize} onChange={(v) => patchStyle({ fontSize: v })} />
          </Field>
          <Field label="Show hints">
            <input type="checkbox" checked={widget.style.showLabel}
              onChange={(e) => patchStyle({ showLabel: e.target.checked })}
              style={{ marginTop: 6 }} />
          </Field>
        </Row>
      </Section>

      <FrameSection style={widget.style} patchStyle={patchStyle} />

      <Section label="Output protocol">
        <select
          style={styles.input}
          value={widget.outputProtocol}
          onChange={(e) => {
            const proto = e.target.value as import('../../../../shared/types/project').OutputProtocol;
            let mapping: import('../../../../shared/types/mapping').Mapping;
            if (proto === 'midi') {
              mapping = { type: 'midi', messageType: 'controlChange', channel: 1, number: 0, minValue: 0, maxValue: 127 };
            } else if (proto === 'osc') {
              mapping = { type: 'osc', address: '/graph/1' };
            } else if (proto === 'enttec') {
              mapping = { type: 'enttec', channel: 1, minValue: 0, maxValue: 255 };
            } else if (proto === 'artnet') {
              mapping = { type: 'artnet', universe: 0, channel: 1, minValue: 0, maxValue: 255 };
            } else {
              mapping = { type: 'sacn', universe: 1, channel: 1, minValue: 0, maxValue: 255, priority: 100 };
            }
            patch({ outputProtocol: proto, mapping } as never);
          }}
        >
          <option value="midi">MIDI</option>
          <option value="osc">OSC</option>
          <option value="enttec">Enttec Open DMX USB</option>
          <option value="artnet">Art-Net (DMX)</option>
          <option value="sacn">sACN / E1.31 (DMX)</option>
        </select>
      </Section>

      <Section label="Mapping">
        {widget.mapping?.type === 'midi' && (
          <>
            <Row>
              <Field label="Channel">
                <NumInput value={widget.mapping.channel} onChange={(v) => patch({ mapping: { ...widget.mapping!, channel: Math.max(1, Math.min(16, v)) } } as never)} />
              </Field>
              <Field label="CC / Note">
                <NumInput value={widget.mapping.number} onChange={(v) => patch({ mapping: { ...widget.mapping!, number: Math.max(0, Math.min(127, v)) } } as never)} />
              </Field>
            </Row>
            <Row>
              <Field label="Min">
                <NumInput value={widget.mapping.minValue} onChange={(v) => patch({ mapping: { ...widget.mapping!, minValue: v } } as never)} />
              </Field>
              <Field label="Max">
                <NumInput value={widget.mapping.maxValue} onChange={(v) => patch({ mapping: { ...widget.mapping!, maxValue: v } } as never)} />
              </Field>
            </Row>
          </>
        )}
        {widget.mapping?.type === 'osc' && (
          <Field label="Address">
            <input style={styles.input} value={(widget.mapping as import('../../../../shared/types/mapping').OscMapping).address}
              onChange={(e) => patch({ mapping: { ...widget.mapping!, address: e.target.value } } as never)} />
          </Field>
        )}
        {widget.mapping?.type === 'enttec' && (
          <Row>
            <Field label="Channel">
              <NumInput value={(widget.mapping as import('../../../../shared/types/mapping').EnttecDmxMapping).channel}
                onChange={(v) => patch({ mapping: { ...widget.mapping!, channel: Math.max(1, Math.min(512, v)) } } as never)} />
            </Field>
            <Field label="Min">
              <NumInput value={(widget.mapping as import('../../../../shared/types/mapping').EnttecDmxMapping).minValue}
                onChange={(v) => patch({ mapping: { ...widget.mapping!, minValue: v } } as never)} />
            </Field>
            <Field label="Max">
              <NumInput value={(widget.mapping as import('../../../../shared/types/mapping').EnttecDmxMapping).maxValue}
                onChange={(v) => patch({ mapping: { ...widget.mapping!, maxValue: v } } as never)} />
            </Field>
          </Row>
        )}
        {(widget.mapping?.type === 'artnet' || widget.mapping?.type === 'sacn') && (
          <>
            <Row>
              <Field label="Universe">
                <NumInput value={(widget.mapping as import('../../../../shared/types/mapping').ArtNetMapping).universe}
                  onChange={(v) => patch({ mapping: { ...widget.mapping!, universe: v } } as never)} />
              </Field>
              <Field label="Channel">
                <NumInput value={(widget.mapping as import('../../../../shared/types/mapping').ArtNetMapping).channel}
                  onChange={(v) => patch({ mapping: { ...widget.mapping!, channel: Math.max(1, Math.min(512, v)) } } as never)} />
              </Field>
            </Row>
            <Row>
              <Field label="Min">
                <NumInput value={(widget.mapping as import('../../../../shared/types/mapping').ArtNetMapping).minValue}
                  onChange={(v) => patch({ mapping: { ...widget.mapping!, minValue: v } } as never)} />
              </Field>
              <Field label="Max">
                <NumInput value={(widget.mapping as import('../../../../shared/types/mapping').ArtNetMapping).maxValue}
                  onChange={(v) => patch({ mapping: { ...widget.mapping!, maxValue: v } } as never)} />
              </Field>
            </Row>
          </>
        )}
        <OutputSelect mapping={widget.mapping ?? null} onChange={(m) => patch({ mapping: m } as never)} />
      </Section>
    </>
  );
}

// ─── XY Pad panel ────────────────────────────────────────────────────────────

function makeDefaultMapping(proto: string, num: number): Mapping {
  if (proto === 'midi')   return { type: 'midi', messageType: 'controlChange', channel: 1, number: num, minValue: 0, maxValue: 127 };
  if (proto === 'osc')    return { type: 'osc', address: `/xy/${num === 0 ? 'x' : 'y'}` };
  if (proto === 'enttec') return { type: 'enttec', channel: num + 1, minValue: 0, maxValue: 255 };
  if (proto === 'artnet') return { type: 'artnet', universe: 0, channel: num + 1, minValue: 0, maxValue: 255 };
  return { type: 'sacn', universe: 1, channel: num + 1, minValue: 0, maxValue: 255, priority: 100 };
}

function MappingEditor({ mapping, onChange }: {
  mapping: Mapping;
  onChange: (m: Mapping) => void;
}) {
  const proto = mapping?.type ?? 'midi';
  return (
    <>
      <Field label="Protocol">
        <select style={styles.input} value={proto}
          onChange={(e) => onChange(makeDefaultMapping(e.target.value, mapping?.type === 'midi' ? (mapping as import('../../../../shared/types/mapping').MidiMapping).number : 0))}>
          <option value="midi">MIDI</option>
          <option value="osc">OSC</option>
          <option value="enttec">Enttec Open DMX USB</option>
          <option value="artnet">Art-Net (DMX)</option>
          <option value="sacn">sACN / E1.31 (DMX)</option>
        </select>
      </Field>
      {mapping?.type === 'midi' && (
        <>
          <Row>
            <Field label="Ch.">
              <NumInput value={mapping.channel} onChange={(v) => onChange({ ...mapping, channel: Math.max(1, Math.min(16, v)) })} />
            </Field>
            <Field label="CC / Note">
              <NumInput value={mapping.number} onChange={(v) => onChange({ ...mapping, number: Math.max(0, Math.min(127, v)) })} />
            </Field>
          </Row>
          <Row>
            <Field label="Min">
              <NumInput value={mapping.minValue} onChange={(v) => onChange({ ...mapping, minValue: v })} />
            </Field>
            <Field label="Max">
              <NumInput value={mapping.maxValue} onChange={(v) => onChange({ ...mapping, maxValue: v })} />
            </Field>
          </Row>
        </>
      )}
      {mapping?.type === 'osc' && (
        <Field label="Address">
          <input style={styles.input} value={(mapping as import('../../../../shared/types/mapping').OscMapping).address}
            onChange={(e) => onChange({ ...mapping, address: e.target.value })} />
        </Field>
      )}
      {mapping?.type === 'enttec' && (
        <Row>
          <Field label="Channel">
            <NumInput value={(mapping as import('../../../../shared/types/mapping').EnttecDmxMapping).channel}
              onChange={(v) => onChange({ ...mapping, channel: Math.max(1, Math.min(512, v)) } as never)} />
          </Field>
          <Field label="Min">
            <NumInput value={(mapping as import('../../../../shared/types/mapping').EnttecDmxMapping).minValue}
              onChange={(v) => onChange({ ...mapping, minValue: v } as never)} />
          </Field>
          <Field label="Max">
            <NumInput value={(mapping as import('../../../../shared/types/mapping').EnttecDmxMapping).maxValue}
              onChange={(v) => onChange({ ...mapping, maxValue: v } as never)} />
          </Field>
        </Row>
      )}
      {(mapping?.type === 'artnet' || mapping?.type === 'sacn') && (
        <>
          <Row>
            <Field label="Universe">
              <NumInput value={(mapping as import('../../../../shared/types/mapping').ArtNetMapping).universe}
                onChange={(v) => onChange({ ...mapping, universe: v } as never)} />
            </Field>
            <Field label="Channel">
              <NumInput value={(mapping as import('../../../../shared/types/mapping').ArtNetMapping).channel}
                onChange={(v) => onChange({ ...mapping, channel: Math.max(1, Math.min(512, v)) } as never)} />
            </Field>
          </Row>
          <Row>
            <Field label="Min">
              <NumInput value={(mapping as import('../../../../shared/types/mapping').ArtNetMapping).minValue}
                onChange={(v) => onChange({ ...mapping, minValue: v } as never)} />
            </Field>
            <Field label="Max">
              <NumInput value={(mapping as import('../../../../shared/types/mapping').ArtNetMapping).maxValue}
                onChange={(v) => onChange({ ...mapping, maxValue: v } as never)} />
            </Field>
          </Row>
        </>
      )}
      <OutputSelect mapping={mapping} onChange={onChange} />
    </>
  );
}

// Per-mapping destination picker. Shows only for output protocols that have more
// than one configured output (primary + named extras). Default = out 1.
function OutputSelect({ mapping, onChange }: { mapping: Mapping; onChange: (m: Mapping) => void }) {
  const conns = useProject().connections;
  if (!mapping || (mapping.type !== 'midi' && mapping.type !== 'osc' && mapping.type !== 'artnet' && mapping.type !== 'sacn')) return null;
  const outs = listOutputs(conns, mapping.type as OutputProtocol);
  if (outs.length <= 1) return null;
  const current = (mapping as { outputId?: string }).outputId ?? 'primary';
  return (
    <Field label="Output">
      <select style={styles.input} value={current}
        onChange={(e) => onChange({ ...mapping, outputId: e.target.value === 'primary' ? undefined : e.target.value } as Mapping)}>
        {outs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
      </select>
    </Field>
  );
}

function XYPadPanel({ widget, activePageId, updateWidget, updateWidgetRect }: {
  widget: XYPadWidget;
  activePageId: string;
  updateWidget: StoreState['updateWidget'];
  updateWidgetRect: StoreState['updateWidgetRect'];
}) {
  function patch(partial: Partial<XYPadWidget>) {
    updateWidget(activePageId, widget.id, partial as never);
  }
  function patchStyle(partial: Partial<typeof widget.style>) {
    patch({ style: { ...widget.style, ...partial } });
  }

  return (
    <>
      <div style={styles.header}>XY Pad</div>

      <Section label="Label">
        <input style={styles.input} value={widget.label} onChange={(e) => patch({ label: e.target.value })} />
      </Section>

      <Section label="Position">
        <Row>
          <Field label="X"><NumInput value={widget.rect.x} onChange={(v) => updateWidgetRect(activePageId, widget.id, { x: v })} /></Field>
          <Field label="Y"><NumInput value={widget.rect.y} onChange={(v) => updateWidgetRect(activePageId, widget.id, { y: v })} /></Field>
        </Row>
        <Row>
          <Field label="W"><NumInput value={widget.rect.width} onChange={(v) => updateWidgetRect(activePageId, widget.id, { width: v })} /></Field>
          <Field label="H"><NumInput value={widget.rect.height} onChange={(v) => updateWidgetRect(activePageId, widget.id, { height: v })} /></Field>
        </Row>
      </Section>

      <Section label="Options">
        <Row>
          <Field label="Crosshair">
            <input type="checkbox" checked={widget.showCrosshair}
              onChange={(e) => patch({ showCrosshair: e.target.checked })} style={{ marginTop: 6 }} />
          </Field>
          <Field label="Invert X">
            <input type="checkbox" checked={widget.invertX}
              onChange={(e) => patch({ invertX: e.target.checked })} style={{ marginTop: 6 }} />
          </Field>
          <Field label="Invert Y">
            <input type="checkbox" checked={widget.invertY}
              onChange={(e) => patch({ invertY: e.target.checked })} style={{ marginTop: 6 }} />
          </Field>
        </Row>
      </Section>

      <Section label="Preset">
        <XYPresetBar widget={widget} patch={patch} />
        <EosUserRow widget={widget} activePageId={activePageId} />
      </Section>

      <Section label="X Axis">
        <MappingEditor mapping={widget.mappingX} onChange={(m) => patch({ mappingX: m })} />
      </Section>

      <Section label="Y Axis">
        <MappingEditor mapping={widget.mappingY} onChange={(m) => patch({ mappingY: m })} />
      </Section>

      {(widget.points ?? []).map((pt, k) => {
        const setPt = (p: Partial<typeof pt>) => patch({ points: (widget.points ?? []).map((x, j) => (j === k ? { ...x, ...p } : x)) });
        return (
          <Section key={pt.id} label={`Dot ${k + 2}${pt.label ? ` · ${pt.label}` : ''}`}>
            <Row>
              <Field label="Name"><input style={styles.input} value={pt.label ?? ''} placeholder={String(k + 2)} onChange={(e) => setPt({ label: e.target.value })} /></Field>
              <Field label="Colour"><ColorInput value={pt.color || XY_DOT_COLORS[k % XY_DOT_COLORS.length]} onChange={(v) => setPt({ color: v })} /></Field>
              <button title="Remove this dot" onClick={() => {
                const st = useStore.getState();
                st.dropCellAndShiftLinks(widget.id, 2 * (k + 1) + 1);
                st.dropCellAndShiftLinks(widget.id, 2 * (k + 1));
                patch({ points: (widget.points ?? []).filter((_, j) => j !== k) });
              }} style={{ background: 'none', border: '1px solid #333', color: pal('#de8b43'), cursor: 'pointer', borderRadius: 2, alignSelf: 'flex-end', height: 28 }}>✕</button>
            </Row>
            <div style={{ fontSize: 11, color: '#666', margin: '6px 0 2px' }}>X</div>
            <MappingEditor mapping={pt.mappingX} onChange={(m) => setPt({ mappingX: m })} />
            <div style={{ fontSize: 11, color: '#666', margin: '6px 0 2px' }}>Y</div>
            <MappingEditor mapping={pt.mappingY} onChange={(m) => setPt({ mappingY: m })} />
          </Section>
        );
      })}
      <Section label="Z slider">
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer', marginBottom: 6 }}>
          <input type="checkbox" checked={!!widget.zSlider} onChange={(e) => {
            const on = e.target.checked;
            const zCell = 2 * (1 + (widget.points?.length ?? 0));
            if (!on) useStore.getState().dropCellAndShiftLinks(widget.id, zCell);
            patch({ zSlider: on, mappingZ: widget.mappingZ ?? defaultZ(widget.mappingX) });
            if (on) queueMicrotask(() => useStore.getState().setCellValue(widget.id, zCell, 0.5));
          }} />
          A slider on the right (camera Z, zoom…), starts in the middle
        </label>
        {widget.zSlider && <MappingEditor mapping={widget.mappingZ ?? null} onChange={(m) => patch({ mappingZ: m })} />}
      </Section>

      <Section label="Dots">
        <button onClick={() => addXYDot(widget)} style={{ ...styles.input, cursor: 'pointer' }}>＋ Dot</button>
        <div style={{ fontSize: 12, color: 'var(--color-text-dim)', marginTop: 6, lineHeight: 1.5 }}>
          Several dots on one pad — e.g. pan / tilt of several heads, each driven by an LFO, Noise or Path and all visible
          together. Each dot has its own X and Y cells and outputs; drag the nearest one, several at once with several fingers.
        </div>
      </Section>

      <Section label="Style">
        <Row>
          <Field label="BG"><ColorInput value={widget.style.backgroundColor} onChange={(v) => patchStyle({ backgroundColor: v })} /></Field>
          <Field label="FG"><ColorInput value={widget.style.foregroundColor} onChange={(v) => patchStyle({ foregroundColor: v })} /></Field>
        </Row>
        <Row>
          <Field label="Radius">
            <NumInput value={widget.style.borderRadius} onChange={(v) => patchStyle({ borderRadius: v })} />
          </Field>
          <Field label="Show label">
            <input type="checkbox" checked={widget.style.showLabel}
              onChange={(e) => patchStyle({ showLabel: e.target.checked })} style={{ marginTop: 6 }} />
          </Field>
        </Row>
      </Section>

      <FrameSection style={widget.style} patchStyle={patchStyle} />
    </>
  );
}

// ─── Settings panel (⚙ button) ───────────────────────────────────────────────

type ConnStatus = 'idle' | 'ok' | 'error' | 'disconnected';

function isValidBindHost(v: string): boolean {
  const t = v.trim();
  if (t === '' || t.toLowerCase() === 'localhost') return true;
  const m = t.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  return !!m && m.slice(1).every((n) => Number(n) <= 255);
}

// Art-Net INPUT: on/off, interface, and what is actually arriving — packets,
// universes and who is sending — so a dead network is obvious before the show.
function ArtNetInputSettings({ conn, onChange }: {
  conn: ArtNetInputConnection | undefined;
  onChange: (c: ArtNetInputConnection) => void;
}) {
  const enabled = conn?.enabled ?? false;
  const [status, setStatus] = useState<DmxInputStatusPayload | null>(null);
  useEffect(() => onDmxInputStatus((s) => { if (s.protocol === 'artnet') setStatus(s); }), []);
  const live = enabled && status?.listening;
  // Applied on Enter / leaving the field, never per keystroke: restarting the
  // receiver for "1", "12", "127"… is what produced the ENOTFOUND errors.
  const [ipDraft, setIpDraft] = useState(conn?.bindHost ?? '');
  useEffect(() => setIpDraft(conn?.bindHost ?? ''), [conn?.bindHost]);
  const ipOk = isValidBindHost(ipDraft);
  const [uniDraft, setUniDraft] = useState(conn?.universes ?? '');
  useEffect(() => setUniDraft(conn?.universes ?? ''), [conn?.universes]);
  const commitIp = () => {
    const v = ipDraft.trim();
    if (!isValidBindHost(v) || v === (conn?.bindHost ?? '')) return;
    onChange({ type: 'artnetInput', enabled, bindHost: v, universes: conn?.universes });
  };
  return (
    <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid #222' }}>
      <div style={{ fontSize: 12, color: '#8a8a8a', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
        Input
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#ccc', cursor: 'pointer' }}>
        <input type="checkbox" checked={enabled}
          onChange={(e) => onChange({ type: 'artnetInput', enabled: e.target.checked, bindHost: conn?.bindHost, universes: conn?.universes })} />
        Receive Art-Net (UDP 6454)
      </label>
      <Field label="This PC's network card (optional)">
        <input style={{ ...styles.input, borderColor: ipOk ? undefined : pal('#bc6921') }}
          placeholder="empty = every card, 127.0.0.1 included"
          value={ipDraft}
          onChange={(e) => setIpDraft(e.target.value)}
          onBlur={commitIp}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
      </Field>
      <Field label="Announce universes">
        <input style={styles.input} placeholder="0" value={uniDraft}
          onChange={(e) => setUniDraft(e.target.value)}
          onBlur={() => { if (uniDraft !== (conn?.universes ?? '')) onChange({ type: 'artnetInput', enabled, bindHost: conn?.bindHost, universes: uniDraft }); }}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
      </Field>
      <div style={{ fontSize: 11, color: 'var(--color-text-dim)', marginTop: 4, lineHeight: 1.5 }}>
        Maestrale answers ArtPoll as a node with these universes ("0-3", "0, 5"), so a sender in unicast mode —
        MadMapper with "Use Unicast", most consoles — finds it in its node list and sends to it.
      </div>
      <div style={{ fontSize: 11, color: 'var(--color-text-dim)', marginTop: 4, lineHeight: 1.5 }}>
        Not the sender's address: which card of THIS computer to listen on. Leave it empty to receive everything —
        a console on the network and an app on this same PC sending to 127.0.0.1 / localhost (MadMapper, Resolume…).
        If that app also uses port 6454 itself (MadMapper does), Windows hands it the packets meant for 127.0.0.1:
        put <b>127.0.0.2</b> here and send to 127.0.0.2 from the app — any 127.x.x.x is this same PC.
        {!ipOk && <span style={{ color: pal('#e39d60') }}> Not a valid IP — kept the previous one.</span>}
      </div>
      <div style={{ fontSize: 12, color: live && status!.packetsPerSec > 0 ? pal('#6ebec4') : 'var(--color-text-dim)', marginTop: 4, lineHeight: 1.6 }}>
        {!enabled ? 'off'
          : !status?.listening ? <span style={{ color: pal('#e39d60') }}>not listening{status?.error ? ` — ${status.error}` : ''}</span>
          : status.packetsPerSec === 0 ? <>listening on {status.bound ?? '6454'} · no DMX arriving</>
          : <>
              listening on {status.bound ?? '6454'} · {status.packetsPerSec} pkt/s<br />
              universes {status.universes.join(', ')}<br />
              from {status.sources.join(', ')}
            </>}
        {live && (status!.polls?.length ?? 0) > 0 && <><br />ArtPoll from {status!.polls!.join(', ')} — answered</>}
        {live && (status!.otherPerSec ?? 0) > 0 && <><br />{status!.otherPerSec} other Art-Net pkt/s (not DMX)</>}
        {live && (status!.ownPerSec ?? 0) > 0 && <><br />{status!.ownPerSec} pkt/s of our own output ignored</>}
      </div>
    </div>
  );
}

// sACN INPUT: multicast is per universe, so the universes to listen to are
// listed here (joined on every card, loopback included). Unicast to this PC on
// 5568 arrives too, whatever the list.
// Where the DMX Recorder writes and where the Player looks. Kept on this
// computer, not in the project: a project copied or cloned elsewhere just
// points at that machine's own folders.
function RecordingFolders() {
  const [f, setF] = useState<{ record: string; play: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { bridge.invoke('tr:dmxRec:getFolders', undefined).then((r) => r && setF(r)).catch(() => {}); }, []);
  const save = async (p: { record?: string; play?: string }) => {
    const r = await bridge.invoke('tr:dmxRec:setFolders', p);
    if (r) { setF({ record: r.record, play: r.play }); setErr(r.ok ? null : r.error ?? 'cannot use that folder'); }
    void refreshTakes();
  };
  const pick = async (which: 'record' | 'play') => {
    const dir = await bridge.invoke('tr:dmxRec:pickFolder', { title: which === 'record' ? 'Record takes into…' : 'Play takes from…', current: f?.[which] });
    if (dir) await save(which === 'record' ? { record: dir } : { play: dir });
  };
  const row = (which: 'record' | 'play', label: string) => (
    <Field label={label}>
      <div style={{ display: 'flex', gap: 4 }}>
        <input style={{ ...styles.input, flex: 1, minWidth: 0, fontSize: 11 }} value={f?.[which] ?? ''} readOnly title={f?.[which]} />
        <button style={{ ...styles.input, width: 'auto', cursor: 'pointer', padding: '0 8px' }} onClick={() => void pick(which)}>Choose…</button>
        <button style={{ ...styles.input, width: 'auto', cursor: 'pointer', padding: '0 8px' }} title="Open in the file manager"
          onClick={() => void bridge.invoke('tr:dmxRec:openFolder', { which })}>↗</button>
      </div>
    </Field>
  );
  return (
    <>
      {row('record', 'REC saves takes in')}
      {row('play', 'Player takes takes from')}
      {f && f.play !== f.record && (
        <button style={{ ...styles.input, cursor: 'pointer', marginTop: 4 }} onClick={() => void save({ play: f.record })}>Player: use the REC folder</button>
      )}
      {err && <div style={{ fontSize: 12, color: pal('#e39d60'), marginTop: 4 }}>{err}</div>}
      <div style={{ fontSize: 11, color: 'var(--color-text-dim)', marginTop: 6, lineHeight: 1.5 }}>
        Remembered on this computer, not in the project. Default: Documents/Maestrale/Recordings. The Player also lists
        the takes just recorded, so a new take plays at once even if the folders differ. Takes are .lfdmx files — copy them
        between computers like any file.
      </div>
    </>
  );
}

function SacnInputSettings({ conn, onChange }: {
  conn: SacnInputConnection | undefined;
  onChange: (c: SacnInputConnection) => void;
}) {
  const enabled = conn?.enabled ?? false;
  const [status, setStatus] = useState<DmxInputStatusPayload | null>(null);
  useEffect(() => onDmxInputStatus((s) => { if (s.protocol === 'sacn') setStatus(s); }), []);
  const live = enabled && status?.listening;
  const [ipDraft, setIpDraft] = useState(conn?.bindHost ?? '');
  useEffect(() => setIpDraft(conn?.bindHost ?? ''), [conn?.bindHost]);
  const ipOk = isValidBindHost(ipDraft);
  const [uniDraft, setUniDraft] = useState(conn?.universes ?? '');
  useEffect(() => setUniDraft(conn?.universes ?? ''), [conn?.universes]);
  const base = { type: 'sacnInput' as const, enabled, bindHost: conn?.bindHost, universes: conn?.universes };
  return (
    <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid #222' }}>
      <div style={{ fontSize: 12, color: '#8a8a8a', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>Input</div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#ccc', cursor: 'pointer' }}>
        <input type="checkbox" checked={enabled} onChange={(e) => onChange({ ...base, enabled: e.target.checked })} />
        Receive sACN (UDP 5568)
      </label>
      <Field label="Universes to listen to">
        <input style={styles.input} placeholder="1" value={uniDraft}
          onChange={(e) => setUniDraft(e.target.value)}
          onBlur={() => { if (uniDraft !== (conn?.universes ?? '')) onChange({ ...base, universes: uniDraft }); }}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
      </Field>
      <Field label="This PC's network card (optional)">
        <input style={{ ...styles.input, borderColor: ipOk ? undefined : pal('#bc6921') }}
          placeholder="empty = every card, 127.0.0.1 included"
          value={ipDraft}
          onChange={(e) => setIpDraft(e.target.value)}
          onBlur={() => { const v = ipDraft.trim(); if (isValidBindHost(v) && v !== (conn?.bindHost ?? '')) onChange({ ...base, bindHost: v }); }}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
      </Field>
      <div style={{ fontSize: 11, color: 'var(--color-text-dim)', marginTop: 4, lineHeight: 1.5 }}>
        sACN universes start at 1 ("1-4", "1, 7"). Multicast reaches every program that listens, so it works next to
        MadMapper, TouchDesigner or Resolume on the same PC with nothing to configure. Highest priority wins when two sources send the same universe.
      </div>
      <div style={{ fontSize: 12, color: live && status!.packetsPerSec > 0 ? pal('#6ebec4') : 'var(--color-text-dim)', marginTop: 4, lineHeight: 1.6 }}>
        {!enabled ? 'off'
          : !status?.listening ? <span style={{ color: pal('#e39d60') }}>not listening{status?.error ? ` — ${status.error}` : ''}</span>
          : status.packetsPerSec === 0 ? <>listening on {status.bound ?? '5568'} · no DMX arriving</>
          : <>
              listening on {status.bound ?? '5568'} · {status.packetsPerSec} pkt/s<br />
              universes {status.universes.join(', ')}<br />
              from {status.sources.join(', ')}{(status.names?.length ?? 0) > 0 ? ` (${status.names!.join(', ')})` : ''}
            </>}
        {live && status!.error && <><br /><span style={{ color: pal('#dd6700') }}>{status!.error}</span></>}
        {live && (status!.ownPerSec ?? 0) > 0 && <><br />{status!.ownPerSec} pkt/s of our own output ignored</>}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: ConnStatus }) {
  if (status === 'idle') return null;
  const color = status === 'ok' ? pal('#4ca8af') : pal('#f48f36');
  const label = status === 'ok' ? 'connected' : status === 'error' ? 'error' : 'disconnected';
  return (
    <span style={{ fontSize: 12, marginLeft: 8, color }}>● {label}</span>
  );
}

function ConnectBtn({ onClick, children, disconnect, disabled }: {
  onClick: () => void;
  children: React.ReactNode;
  disconnect?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      style={{
        marginTop: 8, width: '100%',
        background: disabled ? 'var(--color-surface-2)' : disconnect ? pal('#c87023') : 'var(--color-accent)',
        border: 'none',
        color: disabled ? 'var(--color-text-dim)' : disconnect ? '#fff' : '#000',
        borderRadius: 'var(--radius-sm)',
        padding: '4px 8px',
        fontSize: 12, cursor: disabled ? 'not-allowed' : 'pointer',
        fontWeight: 600,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {children}
    </button>
  );
}

const RESOLUTION_PRESETS = [
  { label: '1920×1080 (16:9)',        width: 1920, height: 1030 },
  { label: '1920×1200 (16:10)',       width: 1920, height: 1150 },
  { label: '2560×1440 (16:9)',        width: 2560, height: 1390 },
  { label: '1280×800 (16:10)',        width: 1280, height: 750  },
  { label: '1280×720 (16:9)',         width: 1280, height: 670  },
  { label: '1024×768 (4:3)',          width: 1024, height: 718  },
  { label: '1080×1920 (portrait)',    width: 1080, height: 1870 },
  { label: '390×844 (iPhone)',        width: 390,  height: 794  },
  { label: '412×915 (Android)',       width: 412,  height: 865  },
  { label: 'Custom',                  width: 0,    height: 0    },
] as const;

function SettingsPanel() {
  const project = useProject();
  const page = useActivePage();
  const { setProjectName, setProjectFrameRate, setConnection, setPageSize, setPageLiveOffset, setTapTriggerMapping, setResetTriggerMapping, setPlayTriggerMapping, setStopTriggerMapping, setConnectedProtocol, connectedProtocols } = useStore(useShallow((s) => ({
    setProjectName:          s.setProjectName,
    setProjectFrameRate:     s.setProjectFrameRate,
    setConnection:           s.setConnection,
    setPageSize:             s.setPageSize,
    setPageLiveOffset:       s.setPageLiveOffset,
    setTapTriggerMapping:    s.setTapTriggerMapping,
    setResetTriggerMapping:  s.setResetTriggerMapping,
    setPlayTriggerMapping:   s.setPlayTriggerMapping,
    setStopTriggerMapping:   s.setStopTriggerMapping,
    setConnectedProtocol:    s.setConnectedProtocol,
    connectedProtocols:      s.connectedProtocols,
  })));

  const [midiStatus,      setMidiStatus]      = useState<ConnStatus>(connectedProtocols['midi']      ? 'ok' : 'idle');
  const [midiInputStatus, setMidiInputStatus] = useState<ConnStatus>(connectedProtocols['midiInput'] ? 'ok' : 'idle');
  const [oscStatus,       setOscStatus]       = useState<ConnStatus>(connectedProtocols['osc']       ? 'ok' : 'idle');
  const [artnetStatus,    setArtnetStatus]    = useState<ConnStatus>(connectedProtocols['artnet']    ? 'ok' : 'idle');
  const [sacnStatus,      setSacnStatus]      = useState<ConnStatus>(connectedProtocols['sacn']      ? 'ok' : 'idle');
  const [enttecStatus,    setEnttecStatus]    = useState<ConnStatus>(connectedProtocols['enttec']    ? 'ok' : 'idle');
  // The project reconnects by itself on open and after an edit (App): show it.
  useEffect(() => {
    if (connectedProtocols['midi'])      setMidiStatus('ok');
    if (connectedProtocols['midiInput']) setMidiInputStatus('ok');
    if (connectedProtocols['osc'])       setOscStatus('ok');
    if (connectedProtocols['artnet'])    setArtnetStatus('ok');
    if (connectedProtocols['sacn'])      setSacnStatus('ok');
    if (connectedProtocols['enttec'])    setEnttecStatus('ok');
  }, [connectedProtocols, project.connections]);
  const [midiPorts,       setMidiPorts]       = useState<string[] | null>(null);
  const [midiInputPorts,  setMidiInputPorts]  = useState<string[] | null>(null);
  const [enttecDevices,   setEnttecDevices]   = useState<{ index: number; description: string; serialNumber: string }[] | null>(null);

  const conn = {
    midi:        project.connections.find((c) => c.type === 'midi')        as MidiConnection        | undefined,
    midiInput:   project.connections.find((c) => c.type === 'midiInput')   as MidiInputConnection   | undefined,
    osc:         project.connections.find((c) => c.type === 'osc')         as OscConnection         | undefined,
    artnet:      project.connections.find((c) => c.type === 'artnet')      as ArtNetConnection      | undefined,
    artnetInput: project.connections.find((c) => c.type === 'artnetInput') as ArtNetInputConnection | undefined,
    sacnInput: project.connections.find((c) => c.type === 'sacnInput') as SacnInputConnection | undefined,
    sacn:        project.connections.find((c) => c.type === 'sacn')        as SacnConnection        | undefined,
    enttecDmx:   project.connections.find((c) => c.type === 'enttecDmx')  as EnttecDmxConnection   | undefined,
    ltcAudio:    project.connections.find((c) => c.type === 'ltcAudio')    as LtcAudioConnection    | undefined,
    audioOutput: project.connections.find((c) => c.type === 'audioOutput') as AudioOutputConnection | undefined,
  };

  const [audioDevices,    setAudioDevices]    = React.useState<MediaDeviceInfo[]>([]);
  const [audioOutDevices, setAudioOutDevices] = React.useState<MediaDeviceInfo[]>([]);

  async function listAudioInputs() {
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
      const devices = await navigator.mediaDevices.enumerateDevices();
      setAudioDevices(devices.filter((d) => d.kind === 'audioinput'));
    } catch { /* permission denied */ }
  }

  async function listAudioOutputs() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      setAudioOutDevices(devices.filter((d) => d.kind === 'audiooutput'));
    } catch { /* permission denied */ }
  }

  const tapMapping    = project.tapTriggerMapping;
  const resetMapping  = project.resetTriggerMapping;
  const playMapping   = project.playTriggerMapping ?? null;
  const stopMapping   = project.stopTriggerMapping ?? null;

  // Same shape as tap/reset above, for the other two transport buttons.
  const mappingType = (m: Mapping | null): string =>
    !m                                                    ? 'none'
    : m.type === 'osc'                                    ? 'osc'
    : (m as MidiMapping).messageType === 'controlChange'  ? 'midi-cc'
    :                                                       'midi-note';

  function transportTypeChange(
    t: string,
    set: (m: Mapping | null) => void,
    address: string,
    note: number,
  ) {
    if (t === 'none')           set(null);
    else if (t === 'osc')       set({ type: 'osc', address });
    else if (t === 'midi-cc')   set({ type: 'midi', messageType: 'controlChange', channel: 1, number: note, minValue: 0, maxValue: 127 });
    else if (t === 'midi-note') set({ type: 'midi', messageType: 'noteOn',        channel: 1, number: note, minValue: 0, maxValue: 127 });
  }

  const tapType: string =
    !tapMapping                                                           ? 'none'
    : tapMapping.type === 'osc'                                           ? 'osc'
    : (tapMapping as MidiMapping).messageType === 'controlChange'         ? 'midi-cc'
    :                                                                       'midi-note';

  const resetType: string =
    !resetMapping                                                             ? 'none'
    : resetMapping.type === 'osc'                                             ? 'osc'
    : (resetMapping as MidiMapping).messageType === 'controlChange'           ? 'midi-cc'
    :                                                                           'midi-note';

  function handleTapTypeChange(t: string) {
    if (t === 'none')           setTapTriggerMapping(null);
    else if (t === 'osc')       setTapTriggerMapping({ type: 'osc', address: '/tap' });
    else if (t === 'midi-cc')   setTapTriggerMapping({ type: 'midi', messageType: 'controlChange', channel: 1, number: 36, minValue: 0, maxValue: 127 });
    else if (t === 'midi-note') setTapTriggerMapping({ type: 'midi', messageType: 'noteOn',        channel: 1, number: 36, minValue: 0, maxValue: 127 });
  }

  function handleResetTypeChange(t: string) {
    if (t === 'none')           setResetTriggerMapping(null);
    else if (t === 'osc')       setResetTriggerMapping({ type: 'osc', address: '/reset' });
    else if (t === 'midi-cc')   setResetTriggerMapping({ type: 'midi', messageType: 'controlChange', channel: 1, number: 37, minValue: 0, maxValue: 127 });
    else if (t === 'midi-note') setResetTriggerMapping({ type: 'midi', messageType: 'noteOn',        channel: 1, number: 37, minValue: 0, maxValue: 127 });
  }

  async function connectMidi() {
    const portName = conn.midi?.portName ?? '';
    const virtual  = conn.midi?.virtualPort ?? false;
    if (!portName) return;
    try {
      const res = await bridge.invoke('tr:midi:openPort', { portName, virtual, extraOutputs: conn.midi ? midiConfigOutputs(conn.midi) : [] });
      const status = res.ok ? 'ok' : 'error';
      setMidiStatus(status);
      if (status === 'ok') setConnectedProtocol('midi', true);
    } catch {
      setMidiStatus('error');
    }
  }

  async function connectMidiInput() {
    const portName = conn.midiInput?.portName ?? '';
    if (!portName) return;
    try {
      const res = await bridge.invoke('tr:midi:openInputPort', { portName, extraPorts: conn.midiInput?.extraPorts ?? [] });
      const status = res.ok ? 'ok' : 'error';
      setMidiInputStatus(status);
      if (status === 'ok') setConnectedProtocol('midiInput', true);
    } catch {
      setMidiInputStatus('error');
    }
  }

  async function connectOsc() {
    try {
      const res = await bridge.invoke('tr:osc:configure', {
        targetHost: conn.osc?.targetHost ?? '127.0.0.1',
        targetPort: conn.osc?.targetPort ?? 8000,
        listenPort: conn.osc?.listenPort ?? 9000,
        outputs: conn.osc ? oscConfigOutputs(conn.osc) : [],
        extraListenPorts: conn.osc?.extraListenPorts ?? [],
      });
      const status = res.ok ? 'ok' : 'error';
      setOscStatus(status);
      if (status === 'ok') setConnectedProtocol('osc', true);
    } catch {
      setOscStatus('error');
    }
  }

  async function connectArtnet() {
    const an = conn.artnet;
    if (!an?.targetHost) return;
    try {
      const res = await bridge.invoke('tr:artnet:configure', { outputs: artnetConfigOutputs(an) });
      const status = res.ok ? 'ok' : 'error';
      setArtnetStatus(status);
      if (status === 'ok') setConnectedProtocol('artnet', true);
    } catch {
      setArtnetStatus('error');
    }
  }

  async function connectSacn() {
    const sacn = conn.sacn;
    try {
      const res = await bridge.invoke('tr:sacn:configure', {
        priority: sacn?.priority ?? 100,
        outputs: sacn ? sacnConfigOutputs(sacn) : [{ id: 'primary', host: undefined }],
      });
      const status = res.ok ? 'ok' : 'error';
      setSacnStatus(status);
      if (status === 'ok') setConnectedProtocol('sacn', true);
    } catch {
      setSacnStatus('error');
    }
  }

  async function disconnectMidi() {
    try { await bridge.invoke('tr:midi:closePort', undefined as never); } catch { /* ignore */ }
    setMidiStatus('disconnected');
    setConnectedProtocol('midi', false);
  }

  function disconnectMidiInput() {
    setMidiInputStatus('disconnected');
    setConnectedProtocol('midiInput', false);
  }

  async function disconnectOsc() {
    try { await bridge.invoke('tr:osc:disconnect', undefined as never); } catch { /* ignore */ }
    setOscStatus('disconnected');
    setConnectedProtocol('osc', false);
  }

  function disconnectArtnet() {
    setArtnetStatus('disconnected');
    setConnectedProtocol('artnet', false);
  }

  function disconnectSacn() {
    setSacnStatus('disconnected');
    setConnectedProtocol('sacn', false);
  }

  async function connectEnttec() {
    const idx = conn.enttecDmx?.deviceIndex ?? 0;
    try {
      const res = await bridge.invoke('tr:enttec:connect', { deviceIndex: idx });
      const status = res.ok ? 'ok' : 'error';
      setEnttecStatus(status);
      if (status === 'ok') setConnectedProtocol('enttec', true);
    } catch {
      setEnttecStatus('error');
    }
  }

  async function disconnectEnttec() {
    try { await bridge.invoke('tr:enttec:disconnect', undefined as never); } catch { /* ignore */ }
    setEnttecStatus('disconnected');
    setConnectedProtocol('enttec', false);
  }

  return (
    <>
      <img src={logoUrl} alt="Maestrale" style={{ width: '100%', display: 'block', marginBottom: 6, objectFit: 'contain' }} />
      <div style={{ textAlign: 'center', fontSize: 11, color: 'var(--color-text-dim)', marginBottom: 16, letterSpacing: 0.5 }}>developed by VENTO in 2026</div>
      <div style={styles.header}>Settings</div>

      <Section label="Project">
        <Field label="Name">
          <input style={styles.input} value={project.name}
            onChange={(e) => setProjectName(e.target.value)} />
        </Field>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer', marginTop: 6 }}>
          <input type="checkbox" checked={project.startInLive !== false}
            onChange={(e) => useStore.getState().setStartInLive(e.target.checked)} />
          Open in Live mode at startup
        </label>
        <AutostartToggle />
      </Section>

      <Section label="Trigger">
        <ResetBtn onClick={() => {
          const { runtime } = useStore.getState();
          for (const pg of project.pages) {
            for (const w of pg.widgets) {
              const wr = runtime.widgets[w.id];
              if (w.kind === 'sliderBank' || w.kind === 'knobBank') {
                for (let i = 0; i < w.cells.length; i++) {
                  dispatchValue(w.cells[i]?.mapping ?? w.mapping, wr?.cells[i]?.value ?? 0);
                }
              } else if (w.kind === 'buttonGrid') {
                for (let i = 0; i < w.cells.length; i++) {
                  const cell = w.cells[i];
                  dispatchButton(cell?.mapping ?? w.mapping, wr?.cells[i]?.active ?? false, cell?.onValue ?? 127, cell?.offValue ?? 0);
                }
              } else if (w.kind === 'xyPad') {
                (wr?.cells ?? []).forEach((c, i) => dispatchValue(xyMapping(w, i), c.value ?? 0));
              }
            }
          }
        }}>
          ↦ Trigger all widgets (all pages)
        </ResetBtn>
      </Section>

      {page && (
        <CollapsibleSection label="Canvas Resolution">
          <Field label="Preset">
            <select
              style={styles.input}
              value={RESOLUTION_PRESETS.find((p) => p.width === page.width && p.height === page.height)?.label ?? 'Custom'}
              onChange={(e) => {
                const preset = RESOLUTION_PRESETS.find((p) => p.label === e.target.value);
                if (preset && preset.width > 0) setPageSize(page.id, preset.width, preset.height);
              }}
            >
              {RESOLUTION_PRESETS.map((p) => (
                <option key={p.label} value={p.label}>{p.label}</option>
              ))}
            </select>
          </Field>
          <Field label="Width">
            <NumInput value={page.width} onChange={(v) => setPageSize(page.id, Math.max(320, v), page.height)} />
          </Field>
          <Field label="Screen height">
            <NumInput value={page.height + GLOBAL_BAR_HEIGHT} onChange={(v) => setPageSize(page.id, page.width, Math.max(240, v - GLOBAL_BAR_HEIGHT))} />
          </Field>
          <div style={{ fontSize: 12, color: 'var(--color-text-dim)', marginTop: 2, marginBottom: 10 }}>
            Enter your screen height — {GLOBAL_BAR_HEIGHT}px reserved for the top bar.
          </div>
          <Field label="Live X">
            <NumInput value={page.liveOffsetX ?? 0} onChange={(v) => setPageLiveOffset(page.id, v, page.liveOffsetY ?? 0)} />
          </Field>
          <Field label="Live Y">
            <NumInput value={page.liveOffsetY ?? 0} onChange={(v) => setPageLiveOffset(page.id, page.liveOffsetX ?? 0, v)} />
          </Field>
        </CollapsibleSection>
      )}

      <CollapsibleSection label="Frame rate">
        <Field label="Frames per second">
          <select style={styles.input} value={String(project.frameRate ?? 25)}
            onChange={(e) => setProjectFrameRate(Number(e.target.value) as never)}>
            <option value="24">24 fps</option>
            <option value="25">25 fps</option>
            <option value="29.97">29.97 fps</option>
            <option value="30">30 fps</option>
            <option value="50">50 fps</option>
            <option value="60">60 fps</option>
          </select>
        </Field>
        <div style={{ fontSize: 12, color: 'var(--color-text-dim)', lineHeight: 1.5 }}>
          Used by a Timeline ruler switched to FRM, unless that timeline carries
          its own timecode frame rate.
        </div>
      </CollapsibleSection>

      <CollapsibleSection label="Tempo">
        <Field label="Tap source">
          <select style={styles.input} value={tapType} onChange={(e) => handleTapTypeChange(e.target.value)}>
            <option value="none">None (manual only)</option>
            <option value="osc">OSC message</option>
            <option value="midi-cc">MIDI CC</option>
            <option value="midi-note">MIDI Note</option>
          </select>
        </Field>
        {tapMapping?.type === 'osc' && (
          <Field label="OSC address">
            <input style={styles.input}
              value={(tapMapping as OscMapping).address}
              onChange={(e) => setTapTriggerMapping({ ...(tapMapping as OscMapping), address: e.target.value })} />
          </Field>
        )}
        {tapMapping?.type === 'midi' && (
          <>
            <Field label="Channel">
              <NumInput
                value={(tapMapping as MidiMapping).channel}
                onChange={(v) => setTapTriggerMapping({ ...(tapMapping as MidiMapping), channel: Math.max(1, Math.min(16, v)) })} />
            </Field>
            <Field label={(tapMapping as MidiMapping).messageType === 'noteOn' ? 'Note' : 'CC'}>
              <NumInput
                value={(tapMapping as MidiMapping).number}
                onChange={(v) => setTapTriggerMapping({ ...(tapMapping as MidiMapping), number: Math.max(0, Math.min(127, v)) })} />
            </Field>
          </>
        )}
        {tapMapping === null && (
          <div style={{ fontSize: 12, color: 'var(--color-text-dim)', marginTop: 4 }}>
            Use ↺ TAP in the top bar.
          </div>
        )}

        <Field label="Reset source">
          <select style={styles.input} value={resetType} onChange={(e) => handleResetTypeChange(e.target.value)}>
            <option value="none">None (↺ button only)</option>
            <option value="osc">OSC message</option>
            <option value="midi-cc">MIDI CC</option>
            <option value="midi-note">MIDI Note</option>
          </select>
        </Field>
        {resetMapping?.type === 'osc' && (
          <Field label="OSC address">
            <input style={styles.input}
              value={(resetMapping as OscMapping).address}
              onChange={(e) => setResetTriggerMapping({ ...(resetMapping as OscMapping), address: e.target.value })} />
          </Field>
        )}
        {resetMapping?.type === 'midi' && (
          <>
            <Field label="Channel">
              <NumInput
                value={(resetMapping as MidiMapping).channel}
                onChange={(v) => setResetTriggerMapping({ ...(resetMapping as MidiMapping), channel: Math.max(1, Math.min(16, v)) })} />
            </Field>
            <Field label={(resetMapping as MidiMapping).messageType === 'noteOn' ? 'Note' : 'CC'}>
              <NumInput
                value={(resetMapping as MidiMapping).number}
                onChange={(v) => setResetTriggerMapping({ ...(resetMapping as MidiMapping), number: Math.max(0, Math.min(127, v)) })} />
            </Field>
          </>
        )}

        <TransportTrigger
          label="Play source" hint="None (play button only)"
          mapping={playMapping} set={setPlayTriggerMapping}
          type={mappingType(playMapping)}
          onType={(t) => transportTypeChange(t, setPlayTriggerMapping, '/play', 38)} />

        <TransportTrigger
          label="Stop source" hint="None (stop button only)"
          mapping={stopMapping} set={setStopTriggerMapping}
          type={mappingType(stopMapping)}
          onType={(t) => transportTypeChange(t, setStopTriggerMapping, '/stop', 39)} />
      </CollapsibleSection>

      <div style={{ borderTop: '1px solid var(--color-border)', margin: '4px 0 16px' }} />

      <CollapsibleSection label="MIDI Output" proto>
        <Field label="Port name">
          <input style={styles.input}
            placeholder="e.g. loopMIDI port, hardware synth"
            value={conn.midi?.portName ?? ''}
            onChange={(e) => { setMidiStatus('idle'); setConnection({ type: 'midi', portName: e.target.value, virtualPort: conn.midi?.virtualPort ?? false, extraOutputs: conn.midi?.extraOutputs }); }} />
        </Field>
        <button
          onClick={async () => {
            const ports = await bridge.invoke('tr:midi:listPorts', undefined as never);
            setMidiPorts(ports.map((p) => p.name));
          }}
          style={{ ...styles.input, cursor: 'pointer', marginTop: 6, textAlign: 'left', background: 'var(--color-surface-2)' }}
        >
          List available ports
        </button>
        {midiPorts !== null && (
          <div style={{ marginTop: 4, fontSize: 12, color: 'var(--color-text-dim)' }}>
            {midiPorts.length === 0
              ? 'No MIDI output ports found'
              : midiPorts.map((name, i) => (
                  <div
                    key={i}
                    style={{ cursor: 'pointer', padding: '2px 4px', borderRadius: 3,
                      background: name === conn.midi?.portName ? 'var(--color-accent)' : 'transparent',
                      color: name === conn.midi?.portName ? '#fff' : 'inherit' }}
                    onClick={() => { setMidiStatus('idle'); setConnection({ type: 'midi', portName: name, virtualPort: conn.midi?.virtualPort ?? false, extraOutputs: conn.midi?.extraOutputs }); }}
                  >
                    {name}
                  </div>
                ))
            }
          </div>
        )}
        <NamedOutputsEditor field="portName" outputs={conn.midi?.extraOutputs ?? []}
          onChange={(rows) => { setMidiStatus('idle'); setConnection({ type: 'midi', portName: conn.midi?.portName ?? '', virtualPort: conn.midi?.virtualPort ?? false, extraOutputs: rows.map((r) => ({ id: r.id, name: r.name, portName: r.portName ?? '' })) }); }} />
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <ConnectBtn
            onClick={midiStatus === 'ok' ? disconnectMidi : connectMidi}
            disconnect={midiStatus === 'ok'}
            disabled={midiStatus !== 'ok' && !(conn.midi?.portName)}
          >
            {midiStatus === 'ok' ? 'Disconnect MIDI' : conn.midi?.portName ? 'Connect MIDI' : 'Enter port name to connect'}
          </ConnectBtn>
          <StatusBadge status={midiStatus} />
        </div>
      </CollapsibleSection>

      <MidiClockSection />

      <CollapsibleSection label="MIDI Input" proto>
        <Field label="Port name">
          <input style={styles.input}
            placeholder="e.g. Launchpad"
            value={conn.midiInput?.portName ?? ''}
            onChange={(e) => { setMidiInputStatus('idle'); setConnection({ type: 'midiInput', portName: e.target.value, extraPorts: conn.midiInput?.extraPorts }); }} />
        </Field>
        <button
          onClick={async () => {
            const ports = await bridge.invoke('tr:midi:listInputPorts', undefined as never);
            setMidiInputPorts(ports.map((p) => p.name));
          }}
          style={{ ...styles.input, cursor: 'pointer', marginTop: 6, textAlign: 'left', background: 'var(--color-surface-2)' }}
        >
          List available ports
        </button>
        {midiInputPorts !== null && (
          <div style={{ marginTop: 4, fontSize: 12, color: 'var(--color-text-dim)' }}>
            {midiInputPorts.length === 0
              ? 'No MIDI input ports found'
              : midiInputPorts.map((name, i) => (
                  <div key={i}
                    style={{ cursor: 'pointer', padding: '2px 4px', borderRadius: 1,
                      background: name === conn.midiInput?.portName ? 'var(--color-accent)' : 'transparent',
                      color: name === conn.midiInput?.portName ? '#000' : 'inherit' }}
                    onClick={() => { setMidiInputStatus('idle'); setConnection({ type: 'midiInput', portName: name, extraPorts: conn.midiInput?.extraPorts }); }}
                  >
                    {name}
                  </div>
                ))
            }
          </div>
        )}
        <ExtraHostsEditor label="Extra input ports" placeholder="exact MIDI port name"
          hosts={conn.midiInput?.extraPorts ?? []}
          onChange={(ports) => { setMidiInputStatus('idle'); setConnection({ type: 'midiInput', portName: conn.midiInput?.portName ?? '', extraPorts: ports }); }} />
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <ConnectBtn
            onClick={midiInputStatus === 'ok' ? disconnectMidiInput : connectMidiInput}
            disconnect={midiInputStatus === 'ok'}
            disabled={midiInputStatus !== 'ok' && !(conn.midiInput?.portName)}
          >
            {midiInputStatus === 'ok' ? 'Disconnect MIDI In' : conn.midiInput?.portName ? 'Connect MIDI In' : 'Enter port name to connect'}
          </ConnectBtn>
          <StatusBadge status={midiInputStatus} />
        </div>
      </CollapsibleSection>

      <CollapsibleSection label="OSC" proto>
        <Field label="Destination IP">
          <input style={styles.input}
            placeholder="e.g. 192.168.1.100"
            value={conn.osc?.targetHost ?? '127.0.0.1'}
            onChange={(e) => { setOscStatus('idle'); setConnection({ type: 'osc', targetHost: e.target.value, targetPort: conn.osc?.targetPort ?? 8000, listenPort: conn.osc?.listenPort ?? 9000, extraOutputs: conn.osc?.extraOutputs, extraListenPorts: conn.osc?.extraListenPorts }); }} />
        </Field>
        <Field label="Destination port">
          <input style={styles.input} type="number"
            value={conn.osc?.targetPort ?? 8000}
            onChange={(e) => { setOscStatus('idle'); setConnection({ type: 'osc', targetHost: conn.osc?.targetHost ?? '127.0.0.1', targetPort: Number(e.target.value), listenPort: conn.osc?.listenPort ?? 9000, extraOutputs: conn.osc?.extraOutputs, extraListenPorts: conn.osc?.extraListenPorts }); }} />
        </Field>
        <Field label="Listen port">
          <input style={styles.input} type="number"
            value={conn.osc?.listenPort ?? 9000}
            onChange={(e) => { setOscStatus('idle'); setConnection({ type: 'osc', targetHost: conn.osc?.targetHost ?? '127.0.0.1', targetPort: conn.osc?.targetPort ?? 8000, listenPort: Number(e.target.value), extraOutputs: conn.osc?.extraOutputs, extraListenPorts: conn.osc?.extraListenPorts }); }} />
        </Field>
        <NamedOutputsEditor field="hostPort" outputs={conn.osc?.extraOutputs ?? []}
          onChange={(rows) => { setOscStatus('idle'); setConnection({ type: 'osc', targetHost: conn.osc?.targetHost ?? '127.0.0.1', targetPort: conn.osc?.targetPort ?? 8000, listenPort: conn.osc?.listenPort ?? 9000, extraOutputs: rows.map((r) => ({ id: r.id, name: r.name, host: r.host ?? '', port: r.port ?? 8000 })), extraListenPorts: conn.osc?.extraListenPorts }); }} />
        <ExtraPortsEditor ports={conn.osc?.extraListenPorts ?? []}
          onChange={(lp) => { setOscStatus('idle'); setConnection({ type: 'osc', targetHost: conn.osc?.targetHost ?? '127.0.0.1', targetPort: conn.osc?.targetPort ?? 8000, listenPort: conn.osc?.listenPort ?? 9000, extraOutputs: conn.osc?.extraOutputs, extraListenPorts: lp }); }} />
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <ConnectBtn onClick={oscStatus === 'ok' ? disconnectOsc : connectOsc} disconnect={oscStatus === 'ok'}>
            {oscStatus === 'ok' ? 'Disconnect OSC' : 'Connect OSC'}
          </ConnectBtn>
          <StatusBadge status={oscStatus} />
        </div>
      </CollapsibleSection>

      <CollapsibleSection label="Art-Net" proto>
        <Field label="Destination IP">
          <input style={styles.input}
            placeholder="255.255.255.255 = broadcast"
            value={conn.artnet?.targetHost ?? ''}
            onChange={(e) => { setArtnetStatus('idle'); setConnection({ type: 'artnet', targetHost: e.target.value, extraOutputs: conn.artnet?.extraOutputs }); }} />
        </Field>
        <div style={{ fontSize: 12, color: 'var(--color-text-dim)', marginTop: 4 }}>
          Use 255.255.255.255 for LAN broadcast, or the receiver's IP for unicast.
        </div>
        <NamedOutputsEditor field="host" outputs={conn.artnet?.extraOutputs ?? []}
          onChange={(rows) => { setArtnetStatus('idle'); setConnection({ type: 'artnet', targetHost: conn.artnet?.targetHost ?? '', extraOutputs: rows.map((r) => ({ id: r.id, name: r.name, host: r.host ?? '' })) }); }} />
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <ConnectBtn onClick={artnetStatus === 'ok' ? disconnectArtnet : connectArtnet} disconnect={artnetStatus === 'ok'}>
            {artnetStatus === 'ok' ? 'Disconnect Art-Net' : 'Connect Art-Net'}
          </ConnectBtn>
          <StatusBadge status={artnetStatus} />
        </div>

        <ArtNetInputSettings
          conn={conn.artnetInput}
          onChange={(c) => setConnection(c)}
        />
      </CollapsibleSection>

      <CollapsibleSection label="sACN / E1.31" proto>
        <Field label="Mode">
          <select style={styles.input}
            value={conn.sacn?.mode ?? 'multicast'}
            onChange={(e) => { setSacnStatus('idle'); setConnection({ type: 'sacn', mode: e.target.value as 'multicast' | 'unicast', priority: conn.sacn?.priority ?? 100, targetHost: conn.sacn?.targetHost, extraOutputs: conn.sacn?.extraOutputs }); }}>
            <option value="multicast">Multicast (automatic)</option>
            <option value="unicast">Unicast (specific IP)</option>
          </select>
        </Field>
        {(conn.sacn?.mode ?? 'multicast') === 'unicast' && (
          <>
            <Field label="Destination IP">
              <input style={styles.input}
                placeholder="e.g. 192.168.1.50"
                value={conn.sacn?.targetHost ?? ''}
                onChange={(e) => { setSacnStatus('idle'); setConnection({ type: 'sacn', mode: 'unicast', priority: conn.sacn?.priority ?? 100, targetHost: e.target.value, extraOutputs: conn.sacn?.extraOutputs }); }} />
            </Field>
            <NamedOutputsEditor field="host" outputs={conn.sacn?.extraOutputs ?? []}
              onChange={(rows) => { setSacnStatus('idle'); setConnection({ type: 'sacn', mode: 'unicast', priority: conn.sacn?.priority ?? 100, targetHost: conn.sacn?.targetHost, extraOutputs: rows.map((r) => ({ id: r.id, name: r.name, host: r.host ?? '' })) }); }} />
          </>
        )}
        <Field label="Priority (1–200)">
          <input style={styles.input} type="number" min={1} max={200}
            value={conn.sacn?.priority ?? 100}
            onChange={(e) => { setSacnStatus('idle'); setConnection({ type: 'sacn', mode: conn.sacn?.mode ?? 'multicast', priority: Number(e.target.value), targetHost: conn.sacn?.targetHost, extraOutputs: conn.sacn?.extraOutputs }); }} />
        </Field>
        {(conn.sacn?.mode ?? 'multicast') === 'multicast' && (
          <div style={{ fontSize: 12, color: 'var(--color-text-dim)', marginTop: 4 }}>
            Multicast: destination is computed automatically from the universe number.
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <ConnectBtn onClick={sacnStatus === 'ok' ? disconnectSacn : connectSacn} disconnect={sacnStatus === 'ok'}>
            {sacnStatus === 'ok' ? 'Disconnect sACN' : 'Connect sACN'}
          </ConnectBtn>
          <StatusBadge status={sacnStatus} />
        </div>

        <SacnInputSettings
          conn={conn.sacnInput}
          onChange={(c) => setConnection(c)}
        />
      </CollapsibleSection>

      <CollapsibleSection label="DMX recordings" proto>
        <RecordingFolders />
      </CollapsibleSection>

      <CollapsibleSection label="Enttec Open DMX USB" proto>
        <div style={{ fontSize: 12, color: 'var(--color-text-dim)', marginBottom: 6, lineHeight: 1.5 }}>
          Requires the FTDI D2XX driver. Device index is 0 for the first dongle.
        </div>
        <button
          onClick={async () => {
            try {
              const res = await bridge.invoke('tr:enttec:listDevices', undefined as never);
              if (res.ok) setEnttecDevices(res.devices);
              else setEnttecDevices([]);
            } catch { setEnttecDevices([]); }
          }}
          style={{ ...styles.input, cursor: 'pointer', marginBottom: 6, textAlign: 'left', background: 'var(--color-surface-2)' }}
        >
          Scan USB devices…
        </button>
        {enttecDevices !== null && (
          enttecDevices.length === 0
            ? <div style={{ fontSize: 12, color: 'var(--color-text-dim)', marginBottom: 6 }}>No FTDI devices found</div>
            : <div style={{ marginBottom: 6 }}>
                {enttecDevices.map((d) => (
                  <div key={d.index}
                    style={{ cursor: 'pointer', padding: '2px 4px', borderRadius: 3, fontSize: 12,
                      background: d.index === (conn.enttecDmx?.deviceIndex ?? 0) ? 'var(--color-accent)' : 'transparent',
                      color: d.index === (conn.enttecDmx?.deviceIndex ?? 0) ? '#fff' : 'inherit' }}
                    onClick={() => { setEnttecStatus('idle'); setConnection({ type: 'enttecDmx', deviceIndex: d.index, deviceDescription: d.description }); }}
                  >
                    [{d.index}] {d.description}{d.serialNumber ? ` (${d.serialNumber})` : ''}
                  </div>
                ))}
              </div>
        )}
        <Field label="Device index">
          <NumInput
            value={conn.enttecDmx?.deviceIndex ?? 0}
            onChange={(v) => { setEnttecStatus('idle'); setConnection({ type: 'enttecDmx', deviceIndex: Math.max(0, v) }); }}
          />
        </Field>
        {conn.enttecDmx?.deviceDescription && (
          <div style={{ fontSize: 12, color: 'var(--color-text-dim)', marginTop: 2 }}>
            {conn.enttecDmx.deviceDescription}
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', marginTop: 6 }}>
          <ConnectBtn onClick={enttecStatus === 'ok' ? disconnectEnttec : connectEnttec} disconnect={enttecStatus === 'ok'}>
            {enttecStatus === 'ok' ? 'Disconnect Enttec' : 'Connect Enttec'}
          </ConnectBtn>
          <StatusBadge status={enttecStatus} />
        </div>
      </CollapsibleSection>

      <CollapsibleSection label="Audio Input" proto>
        <div style={{ fontSize: 12, color: 'var(--color-text-dim)', marginBottom: 6, lineHeight: 1.5 }}>
          Select the audio input device. Used by Timeline widgets for timecode sync and future audio analysis features.
        </div>
        <button
          onClick={listAudioInputs}
          style={{ ...styles.input, cursor: 'pointer', marginBottom: 6, textAlign: 'left', background: 'var(--color-surface-2)' }}
        >
          Scan audio inputs…
        </button>
        {audioDevices.length > 0 && (
          <Field label="Device">
            <select
              style={styles.input}
              value={conn.ltcAudio?.deviceId ?? ''}
              onChange={(e) => {
                const dev = audioDevices.find((d) => d.deviceId === e.target.value);
                if (dev) setConnection({ type: 'ltcAudio', deviceId: dev.deviceId, deviceLabel: dev.label });
                else setConnection({ type: 'ltcAudio', deviceId: '', deviceLabel: '' });
              }}
            >
              <option value="">— none —</option>
              {audioDevices.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || d.deviceId}
                </option>
              ))}
            </select>
          </Field>
        )}
        {conn.ltcAudio?.deviceLabel && (
          <div style={{ fontSize: 12, color: 'var(--color-accent)', marginTop: 4 }}>
            Selected: {conn.ltcAudio.deviceLabel}
          </div>
        )}
      </CollapsibleSection>

      <CollapsibleSection label="Audio Output" proto>
        <div style={{ fontSize: 12, color: 'var(--color-text-dim)', marginBottom: 6, lineHeight: 1.5 }}>
          Select the audio output device for sound track playback.
        </div>
        <button
          onClick={listAudioOutputs}
          style={{ ...styles.input, cursor: 'pointer', marginBottom: 6, textAlign: 'left', background: 'var(--color-surface-2)' }}
        >
          Scan audio outputs…
        </button>
        {audioOutDevices.length > 0 && (
          <Field label="Device">
            <select
              style={styles.input}
              value={conn.audioOutput?.deviceId ?? ''}
              onChange={(e) => {
                const dev = audioOutDevices.find((d) => d.deviceId === e.target.value);
                if (dev) setConnection({ type: 'audioOutput', deviceId: dev.deviceId, deviceLabel: dev.label });
                else setConnection({ type: 'audioOutput', deviceId: '', deviceLabel: '' });
              }}
            >
              <option value="">— default —</option>
              {audioOutDevices.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || d.deviceId}
                </option>
              ))}
            </select>
          </Field>
        )}
        {conn.audioOutput?.deviceLabel && (
          <div style={{ fontSize: 12, color: 'var(--color-accent)', marginTop: 4 }}>
            Selected: {conn.audioOutput.deviceLabel}
          </div>
        )}
      </CollapsibleSection>

      <NetworkLiveSection />

      <PaletteSection />
    </>
  );
}

// ─── MIDI Clock section ───────────────────────────────────────────────────────

function MidiClockSection() {
  const { midiClockEnabled, setMidiClockEnabled } = useStore(useShallow((s) => ({
    midiClockEnabled: s.midiClockEnabled,
    setMidiClockEnabled: s.setMidiClockEnabled,
  })));

  return (
    <CollapsibleSection label="MIDI Clock" proto>
      <div style={{ fontSize: 12, color: 'var(--color-text-dim)', marginBottom: 8, lineHeight: 1.5 }}>
        Send MIDI clock ticks (24 PPQN) via the MIDI output port, synced to the master BPM.
        Requires an active MIDI output connection.
      </div>
      <Field label="Send clock">
        <button
          onPointerDown={(e) => { e.preventDefault(); setMidiClockEnabled(!midiClockEnabled); }}
          style={{
            height: 24, padding: '0 10px', fontSize: 12, fontFamily: 'inherit', cursor: 'pointer',
            background: midiClockEnabled ? 'var(--color-accent)' : 'var(--color-surface-2)',
            border: `1px solid ${midiClockEnabled ? 'var(--color-accent)' : 'var(--color-border)'}`,
            color: midiClockEnabled ? '#000' : 'var(--color-text-dim)',
            borderRadius: 'var(--radius-sm)', fontWeight: midiClockEnabled ? 700 : undefined,
          }}
        >
          {midiClockEnabled ? '⬤ Running' : '◎ Off'}
        </button>
      </Field>
    </CollapsibleSection>
  );
}

// ─── Network Live section (rendered inside SettingsPanel) ─────────────────────

function NetworkLiveSection() {
  const { networkEnabled, networkPort, networkLocalIP, setNetworkEnabled, setNetworkPort, setNetworkLocalIP } =
    useStore(useShallow((s) => ({
      networkEnabled: s.networkEnabled,
      networkPort: s.networkPort,
      networkLocalIP: s.networkLocalIP,
      setNetworkEnabled: s.setNetworkEnabled,
      setNetworkPort: s.setNetworkPort,
      setNetworkLocalIP: s.setNetworkLocalIP,
    })));

  const startNetworkSync = React.useCallback(() => {
    import('../../../network/networkSync').then((m) => m.startNetworkSync());
  }, []);
  const stopNetworkSync = React.useCallback(() => {
    import('../../../network/networkSync').then((m) => m.stopNetworkSync());
  }, []);

  const [portInput, setPortInput] = React.useState(String(networkPort));
  const [status, setStatus] = React.useState<'idle' | 'starting' | 'error'>('idle');

  async function handleToggle() {
    try {
      if (networkEnabled) {
        await bridge.invoke('tr:net:stop', undefined as never);
        stopNetworkSync();
        setNetworkEnabled(false);
        setNetworkLocalIP('');
      } else {
        const port = parseInt(portInput, 10) || 3456;
        setStatus('starting');
        const result = await bridge.invoke('tr:net:start', { port });
        if (result.ok) {
          setNetworkPort(port);
          setNetworkLocalIP(result.ip);
          setNetworkEnabled(true);
          setStatus('idle');
          startNetworkSync();
        } else {
          setStatus('error');
        }
      }
    } catch (err) {
      console.error('[Network] handleToggle error:', err);
      setStatus('error');
    }
  }

  const url = networkEnabled && networkLocalIP
    ? `https://${networkLocalIP}:${networkPort}`
    : null;

  return (
    <CollapsibleSection label="Network Live" proto>
      <div style={{ fontSize: 12, color: 'var(--color-text-dim)', marginBottom: 8, lineHeight: 1.5 }}>
        Serve the live canvas over the local network. Connect from any phone or PC on the same WiFi.
      </div>

      <Field label="Port">
        <input
          style={styles.input}
          value={portInput}
          onChange={(e) => setPortInput(e.target.value)}
          disabled={networkEnabled}
        />
      </Field>
      <Field label="">
        <button
          onClick={handleToggle}
          style={{
            ...styles.input, cursor: 'pointer', fontWeight: 600, minHeight: 40,
            background: networkEnabled ? '#1a2a1a' : 'var(--color-surface-2)',
            color: networkEnabled ? pal('#3b8b91') : 'var(--color-text)',
            border: `1px solid ${networkEnabled ? pal('#3b8b91') : 'var(--color-border)'}`,
          }}
        >
          {status === 'starting' ? '…' : networkEnabled ? '● ON' : 'Start'}
        </button>
      </Field>

      {status === 'error' && (
        <div style={{ fontSize: 12, color: pal('#d97a26'), marginTop: 4 }}>
          Failed to start — port may be in use.
        </div>
      )}

      {url && (
        <div style={{ marginTop: 8, padding: '8px', background: 'var(--color-surface)', border: '1px solid #00cc6640', borderRadius: 3 }}>
          <div style={{ fontSize: 11, color: '#555', marginBottom: 4, letterSpacing: 1 }}>OPEN IN BROWSER</div>
          <div style={{ fontSize: 12, color: pal('#3b8b91'), fontFamily: 'monospace', letterSpacing: 0.5 }}>
            {url}
          </div>
          <div style={{ fontSize: 11, color: '#444', marginTop: 4 }}>
            If browser shows "not secure": tap Advanced → Proceed to continue (self-signed cert, one-time per device).
          </div>
        </div>
      )}
    </CollapsibleSection>
  );
}

// ─── Sidecar source picker ────────────────────────────────────────────────────

const SIDECAR = 'http://127.0.0.1:8765';

function useSidecarSources(endpoint: string) {
  const [sources, setSources] = React.useState<string[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${SIDECAR}${endpoint}`);
      const data = await res.json() as { sources: string[]; ok: boolean; error?: string };
      setSources(data.sources ?? []);
      if (!data.ok && data.error) setError(data.error);
    } catch {
      setError('Sidecar not running — launch Maestrale normally');
    }
    setLoading(false);
  }

  React.useEffect(() => { refresh(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return { sources, loading, error, refresh };
}

function SourceSelect({ value, onChange, endpoint }: {
  value: string;
  onChange: (name: string) => void;
  endpoint: string;
}) {
  const { sources, loading, error, refresh } = useSidecarSources(endpoint);

  return (
    <>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4 }}>
        <select
          style={{ ...styles.input, flex: 1 }}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">— no source —</option>
          {sources.map((s) => <option key={s} value={s}>{s}</option>)}
          {value && !sources.includes(value) && (
            <option value={value} style={{ color: pal('#e66b00') }}>{value} (offline)</option>
          )}
        </select>
        <button
          onClick={refresh}
          disabled={loading}
          title="Refresh source list"
          style={{
            flexShrink: 0, padding: '3px 8px', fontSize: 12, cursor: 'pointer',
            background: 'var(--color-surface-2)', border: '1px solid var(--color-border)',
            color: 'var(--color-text-dim)', borderRadius: 3,
          }}
        >
          {loading ? '…' : '↺'}
        </button>
      </div>
      {error && (
        <div style={{ fontSize: 12, color: pal('#e66b00'), lineHeight: 1.4 }}>{error}</div>
      )}
      {!error && sources.length === 0 && !loading && (
        <div style={{ fontSize: 12, color: 'var(--color-text-dim)' }}>
          No sources found — start a sender then click ↺
        </div>
      )}
    </>
  );
}

// ─── Spout Input inspector panel ─────────────────────────────────────────────

function SpoutInputInspectorPanel({ widget, activePageId, updateWidget, updateWidgetRect }: {
  widget: import('../../../../shared/types/project').SpoutInputWidget;
  activePageId: string;
  updateWidget: StoreState['updateWidget'];
  updateWidgetRect: StoreState['updateWidgetRect'];
}) {
  function patch(partial: Partial<import('../../../../shared/types/project').SpoutInputWidget>) {
    updateWidget(activePageId, widget.id, partial as never);
  }

  return (
    <>
      <div style={styles.header}>Spout Input</div>
      <Section label="Label">
        <input style={styles.input} value={widget.label} onChange={(e) => patch({ label: e.target.value })} />
      </Section>
      <Section label="Position">
        <Row>
          <Field label="X"><NumInput value={widget.rect.x} onChange={(v) => updateWidgetRect(activePageId, widget.id, { x: v })} /></Field>
          <Field label="Y"><NumInput value={widget.rect.y} onChange={(v) => updateWidgetRect(activePageId, widget.id, { y: v })} /></Field>
        </Row>
        <Row>
          <Field label="W"><NumInput value={widget.rect.width} onChange={(v) => updateWidgetRect(activePageId, widget.id, { width: v })} /></Field>
          <Field label="H"><NumInput value={widget.rect.height} onChange={(v) => updateWidgetRect(activePageId, widget.id, { height: v })} /></Field>
        </Row>
      </Section>
      <Section label="Spout sender">
        <SourceSelect value={widget.senderName} onChange={(n) => patch({ senderName: n })} endpoint="/spout/sources" />
      </Section>
      <Section label="Display">
        <Row>
          <Field label="Border px">
            <NumInput value={widget.borderWidth ?? 0} min={0} max={32} onChange={(v) => patch({ borderWidth: v })} />
          </Field>
          <Field label="Color">
            <input type="color" value={widget.borderColor ?? '#ffffff'}
              onChange={(e) => patch({ borderColor: e.target.value })}
              style={{ width: '100%', height: 28, padding: 0, border: 'none', background: 'none', cursor: 'pointer' }} />
          </Field>
        </Row>
        <Row>
          <Field label="Max FPS">
            <NumInput value={widget.targetFps ?? 0} min={0} max={120} onChange={(v) => patch({ targetFps: v })} />
          </Field>
          <Field label=""><span style={{ fontSize: 12, color: 'var(--color-text-dim)' }}>0 = no limit</span></Field>
        </Row>
      </Section>
    </>
  );
}

// ─── NDI Input inspector panel ────────────────────────────────────────────────

function NdiInputInspectorPanel({ widget, activePageId, updateWidget, updateWidgetRect }: {
  widget: import('../../../../shared/types/project').NdiInputWidget;
  activePageId: string;
  updateWidget: StoreState['updateWidget'];
  updateWidgetRect: StoreState['updateWidgetRect'];
}) {
  function patch(partial: Partial<import('../../../../shared/types/project').NdiInputWidget>) {
    updateWidget(activePageId, widget.id, partial as never);
  }

  return (
    <>
      <div style={styles.header}>NDI Input</div>
      <Section label="Label">
        <input style={styles.input} value={widget.label} onChange={(e) => patch({ label: e.target.value })} />
      </Section>
      <Section label="Position">
        <Row>
          <Field label="X"><NumInput value={widget.rect.x} onChange={(v) => updateWidgetRect(activePageId, widget.id, { x: v })} /></Field>
          <Field label="Y"><NumInput value={widget.rect.y} onChange={(v) => updateWidgetRect(activePageId, widget.id, { y: v })} /></Field>
        </Row>
        <Row>
          <Field label="W"><NumInput value={widget.rect.width} onChange={(v) => updateWidgetRect(activePageId, widget.id, { width: v })} /></Field>
          <Field label="H"><NumInput value={widget.rect.height} onChange={(v) => updateWidgetRect(activePageId, widget.id, { height: v })} /></Field>
        </Row>
      </Section>
      <Section label="NDI source">
        <div style={{ fontSize: 12, color: 'var(--color-text-dim)', marginBottom: 6, lineHeight: 1.4 }}>
          NDI sources on the LAN. Requires NDI Runtime installed.
        </div>
        <SourceSelect value={widget.sourceName} onChange={(n) => patch({ sourceName: n })} endpoint="/ndi/sources" />
      </Section>
      <Section label="Display">
        <Row>
          <Field label="Border px">
            <NumInput value={widget.borderWidth ?? 0} onChange={(v) => patch({ borderWidth: v })} />
          </Field>
          <Field label="Color">
            <input type="color" value={widget.borderColor ?? '#ffffff'}
              onChange={(e) => patch({ borderColor: e.target.value })}
              style={{ width: '100%', height: 28, padding: 0, border: 'none', background: 'none', cursor: 'pointer' }} />
          </Field>
        </Row>
        <Row>
          <Field label="Max FPS">
            <NumInput value={widget.targetFps ?? 0} onChange={(v) => patch({ targetFps: v })} />
          </Field>
          <Field label=""><span style={{ fontSize: 12, color: 'var(--color-text-dim)' }}>0 = no limit</span></Field>
        </Row>
      </Section>
    </>
  );
}

// ─── Submasters inspector panel ──────────────────────────────────────────────

function SubmastersInspectorPanel({ widget, activePageId, updateWidget, updateWidgetRect }: {
  widget: import('../../../../shared/types/project').SubmastersWidget;
  activePageId: string;
  updateWidget: StoreState['updateWidget'];
  updateWidgetRect: StoreState['updateWidgetRect'];
}) {

  function patch(partial: Partial<import('../../../../shared/types/project').SubmastersWidget>) {
    updateWidget(activePageId, widget.id, partial as never);
  }

  function patchStyle(partial: Partial<typeof widget.style>) {
    patch({ style: { ...widget.style, ...partial } });
  }

  function handleCountChange(newCount: number) {
    const safe = Math.max(1, Math.min(32, Math.round(newCount)));
    const newScenes = Array.from({ length: safe }, (_, i) =>
      widget.scenes[i] ?? { label: `${i + 1}`, snapshot: {} }
    );
    patch({ countX: safe, scenes: newScenes });
  }

  // Only plain controls make sense in a scene: sliders, knobs, buttons, XY.
  const project = useProject();
  const eligible = project.pages.map((p) => ({ page: p, widgets: p.widgets.filter((w) => w.id !== widget.id && SUBMASTER_KINDS.has(w.kind)) }))
    .filter((g) => g.widgets.length > 0);
  const eligibleIds = eligible.flatMap((g) => g.widgets.map((w) => w.id));
  function handleAddLinked() {
    const ids = widget.linkedWidgetIds;
    const next = !ids.includes(SUBMASTER_ALL) && ids.length === 0 ? SUBMASTER_ALL : eligibleIds.find((id) => !ids.includes(id));
    if (!next) return;
    patch({ linkedWidgetIds: [...ids, next] });
  }

  function handleRemoveLinked(idx: number) {
    patch({ linkedWidgetIds: widget.linkedWidgetIds.filter((_, i) => i !== idx) });
  }

  function handleChangeLinked(idx: number, newId: string) {
    const newIds = [...widget.linkedWidgetIds];
    newIds[idx] = newId;
    patch({ linkedWidgetIds: newIds });
  }

  function handleSceneColor(sceneIdx: number, color: string) {
    const newScenes = widget.scenes.map((s, i) => i === sceneIdx ? { ...s, color } : s);
    patch({ scenes: newScenes });
  }

  function handleSceneLabel(sceneIdx: number, label: string) {
    const newScenes = widget.scenes.map((s, i) => i === sceneIdx ? { ...s, label } : s);
    patch({ scenes: newScenes });
  }

  function handleFlashMapping(sceneIdx: number, mapping: import('../../../../shared/types/mapping').Mapping | null) {
    const newScenes = widget.scenes.map((s, i) => i === sceneIdx ? { ...s, flashMapping: mapping } : s);
    patch({ scenes: newScenes });
  }

  function handleClearScene(sceneIdx: number) {
    const newScenes = widget.scenes.map((s, i) => i === sceneIdx ? { ...s, snapshot: {} } : s);
    patch({ scenes: newScenes });
  }


  return (
    <>
      <div style={styles.header}>Submasters</div>

      <Section label="Label">
        <input style={styles.input} value={widget.label}
          onChange={(e) => patch({ label: e.target.value })} />
      </Section>

      <Section label="Position">
        <Row>
          <Field label="X"><NumInput value={widget.rect.x} onChange={(v) => updateWidgetRect(activePageId, widget.id, { x: v })} /></Field>
          <Field label="Y"><NumInput value={widget.rect.y} onChange={(v) => updateWidgetRect(activePageId, widget.id, { y: v })} /></Field>
        </Row>
        <Row>
          <Field label="W"><NumInput value={widget.rect.width} onChange={(v) => updateWidgetRect(activePageId, widget.id, { width: v })} /></Field>
          <Field label="H"><NumInput value={widget.rect.height} onChange={(v) => updateWidgetRect(activePageId, widget.id, { height: v })} /></Field>
        </Row>
      </Section>

      <Section label="Scenes">
        <Row>
          <Field label="Count">
            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              <button
                onClick={() => handleCountChange(widget.countX - 1)}
                style={{ width: 28, height: 28, background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', color: 'var(--color-text)', borderRadius: 3, cursor: 'pointer', fontSize: 16 }}
              >−</button>
              <span style={{ flex: 1, textAlign: 'center', fontSize: 13, color: 'var(--color-text)' }}>{widget.countX}</span>
              <button
                onClick={() => handleCountChange(widget.countX + 1)}
                style={{ width: 28, height: 28, background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', color: 'var(--color-text)', borderRadius: 3, cursor: 'pointer', fontSize: 16 }}
              >+</button>
            </div>
          </Field>
        </Row>
        <Row>
          <Field label="Gap X">
            <NumInput value={widget.spacingX} onChange={(v) => patch({ spacingX: Math.max(0, v) })} />
          </Field>
          <Field label="Gap Y">
            <NumInput value={widget.spacingY} onChange={(v) => patch({ spacingY: Math.max(0, v) })} />
          </Field>
        </Row>
      </Section>

      <Section label="Merge Mode">
        <select
          style={styles.input}
          value={widget.mergeMode}
          onChange={(e) => patch({ mergeMode: e.target.value as import('../../../../shared/types/project').SubmasterMergeMode })}
        >
          <option value="htp">HTP – Higher Takes Preference</option>
          <option value="ltp">LTP – Last Takes Preference</option>
        </select>
        <div style={{ fontSize: 12, color: 'var(--color-text-dim)', marginTop: 5, lineHeight: 1.4 }}>
          HTP: max of all active scenes. LTP: last moved fader wins.
        </div>
      </Section>

      <Section label="Linked Widgets">
        <div style={{ fontSize: 12, color: 'var(--color-text-dim)', marginBottom: 8, lineHeight: 1.5 }}>
          What the scenes record and play back: sliders, knobs, buttons and XY pads. "All widgets · all pages"
          takes every one of them; replace it with single widgets to narrow it down.
        </div>
        {widget.linkedWidgetIds.map((wid, i) => {
          const found = wid === SUBMASTER_ALL || eligibleIds.includes(wid);
          return (
            <div key={i} style={{ display: 'flex', gap: 4, marginBottom: 4, alignItems: 'center' }}>
              <select
                value={wid}
                onChange={(e) => handleChangeLinked(i, e.target.value)}
                style={{ ...styles.input, flex: 1 }}
              >
                {!found && <option value={wid}>[deleted]</option>}
                <option value={SUBMASTER_ALL}>All widgets · all pages</option>
                {eligible.map((g) => (
                  <optgroup key={g.page.id} label={g.page.name}>
                    {g.widgets.map((w) => <option key={w.id} value={w.id}>{w.label || w.kind}</option>)}
                  </optgroup>
                ))}
              </select>
              <button
                onClick={() => handleRemoveLinked(i)}
                style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: 16, padding: '0 2px', lineHeight: 1 }}
              >×</button>
            </div>
          );
        })}
        <button
          onClick={handleAddLinked}
          disabled={widget.linkedWidgetIds.length > 0 && eligibleIds.every((id) => widget.linkedWidgetIds.includes(id))}
          style={{
            width: '100%', marginTop: 4, padding: '4px 0', fontSize: 12,
            background: 'var(--color-surface-2)', border: '1px solid var(--color-border)',
            color: 'var(--color-text-dim)', borderRadius: 3, cursor: 'pointer',
          }}
        >+ Add Widget</button>
        <div style={{ fontSize: 12, color: 'var(--color-text-dim)', margin: '10px 0 6px' }}>Exclude — left out even with "All widgets"</div>
        <ExcludeList
          options={eligible.flatMap((g) => g.widgets.map((w) => ({ id: w.id, label: project.pages.length > 1 ? `${g.page.name} · ${w.label || w.kind}` : (w.label || w.kind) })))}
          value={widget.excludeWidgetIds ?? []} onChange={(ids) => patch({ excludeWidgetIds: ids })} />
      </Section>

      <Section label="Scene Config">
        <div style={{ fontSize: 12, color: 'var(--color-text-dim)', marginBottom: 8 }}>
          Label and color per scene button. ⚡ sets what the flash button below
          the fader sends; it is also a linkable cell, so it can be learned.
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {widget.scenes.map((scene, i) => {
            const hasData = Object.keys(scene.snapshot).length > 0;
            return (
              <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <span style={{ fontSize: 12, color: 'var(--color-text-dim)', width: 14, flexShrink: 0 }}>{i + 1}</span>
                <input
                  style={{ ...styles.input, flex: 1 }}
                  value={scene.label}
                  onChange={(e) => handleSceneLabel(i, e.target.value)}
                />
                <input
                  type="color"
                  value={scene.color ?? widget.style.foregroundColor}
                  onChange={(e) => handleSceneColor(i, e.target.value)}
                  style={{ width: 28, height: 28, border: 'none', background: 'none', cursor: 'pointer', padding: 0, flexShrink: 0 }}
                />
                {hasData && (
                  <button
                    onClick={() => handleClearScene(i)}
                    title="Clear snapshot"
                    style={{ background: 'none', border: 'none', color: '#444', cursor: 'pointer', fontSize: 12, padding: '0 2px', lineHeight: 1, flexShrink: 0 }}
                  >✕</button>
                )}
                {!hasData && (
                  <span style={{ fontSize: 12, color: '#333', width: 16, flexShrink: 0, textAlign: 'center' }}>—</span>
                )}
                <button
                  title={scene.flashMapping ? 'Flash output — click to remove' : 'Add flash button output'}
                  onClick={() => handleFlashMapping(i, scene.flashMapping
                    ? null
                    : { type: 'midi', messageType: 'noteOn', channel: 1, number: 36 + i, minValue: 0, maxValue: 127 })}
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer', fontSize: 13,
                    color: scene.flashMapping ? pal('#ff7700') : '#3a3a3a',
                    padding: '0 2px', lineHeight: 1, flexShrink: 0,
                  }}
                >⚡</button>
              </div>
              {scene.flashMapping && (
                <div style={{ paddingLeft: 18 }}>
                  <MappingEditor mapping={scene.flashMapping} onChange={(m) => handleFlashMapping(i, m)} />
                </div>
              )}
              </div>
            );
          })}
        </div>
      </Section>

      <Section label="Style">
        <Row>
          <Field label="BG">
            <ColorInput value={widget.style.backgroundColor} onChange={(v) => patchStyle({ backgroundColor: v })} />
          </Field>
          <Field label="FG (default)">
            <ColorInput value={widget.style.foregroundColor} onChange={(v) => patchStyle({ foregroundColor: v })} />
          </Field>
        </Row>
        <Row>
          <Field label="Label col.">
            <ColorInput value={widget.style.labelColor} onChange={(v) => patchStyle({ labelColor: v })} />
          </Field>
          <Field label="Radius">
            <NumInput value={widget.style.borderRadius} onChange={(v) => patchStyle({ borderRadius: v })} />
          </Field>
        </Row>
        <Row>
          <Field label="Font size">
            <NumInput value={widget.style.fontSize} onChange={(v) => patchStyle({ fontSize: v })} />
          </Field>
          <Field label="Show labels">
            <input type="checkbox" checked={widget.style.showLabel}
              onChange={(e) => patchStyle({ showLabel: e.target.checked })}
              style={{ marginTop: 6 }} />
          </Field>
        </Row>
      </Section>

      <FrameSection style={widget.style} patchStyle={patchStyle} />
    </>
  );
}

// ─── AutoBpm inspector panel ──────────────────────────────────────────────────

function BeatOutputMappingEditor({ label, mapping, onChange }: {
  label: string;
  mapping: Mapping;
  onChange: (m: Mapping) => void;
}) {
  const proto = mapping?.type ?? 'none';
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ fontSize: 11, color: '#555', marginBottom: 3 }}>{label}</div>
      <select
        style={{ ...styles.input, fontSize: 12, marginBottom: proto !== 'none' ? 4 : 0 }}
        value={proto}
        onChange={(e) => {
          const t = e.target.value;
          if (t === 'none') onChange(null);
          else if (t === 'midi') onChange({ type: 'midi', messageType: 'controlChange', channel: 1, number: 0, minValue: 0, maxValue: 127 });
          else if (t === 'osc')  onChange({ type: 'osc', address: '/bpm/out' });
          else if (t === 'artnet') onChange({ type: 'artnet', universe: 0, channel: 1, minValue: 0, maxValue: 255 });
          else if (t === 'sacn')   onChange({ type: 'sacn', universe: 1, channel: 1, minValue: 0, maxValue: 255, priority: 100 });
          else if (t === 'enttec') onChange({ type: 'enttec', channel: 1, minValue: 0, maxValue: 255 });
        }}
      >
        <option value="none">Off</option>
        <option value="midi">MIDI</option>
        <option value="osc">OSC</option>
        <option value="artnet">Art-Net</option>
        <option value="sacn">sACN</option>
        <option value="enttec">Enttec DMX</option>
      </select>
      {mapping?.type === 'midi' && (() => {
        const m = mapping as MidiMapping;
        return (
          <Row>
            <Field label="Ch"><NumInput value={m.channel} onChange={(v) => onChange({ ...m, channel: Math.max(1, Math.min(16, v)) })} /></Field>
            <Field label="CC"><NumInput value={m.number} onChange={(v) => onChange({ ...m, number: Math.max(0, Math.min(127, v)) })} /></Field>
          </Row>
        );
      })()}
      {mapping?.type === 'osc' && (
        <input style={{ ...styles.input, fontSize: 12 }} placeholder="/address"
          value={(mapping as OscMapping).address}
          onChange={(e) => onChange({ ...(mapping as OscMapping), address: e.target.value })} />
      )}
      {(mapping?.type === 'artnet' || mapping?.type === 'sacn') && (() => {
        const m = mapping as ArtNetMapping | SacnMapping;
        return (
          <Row>
            <Field label="Univ"><NumInput value={m.universe} onChange={(v) => onChange({ ...m, universe: v } as never)} /></Field>
            <Field label="Ch"><NumInput value={m.channel} onChange={(v) => onChange({ ...m, channel: Math.max(1, Math.min(512, v)) } as never)} /></Field>
          </Row>
        );
      })()}
      {mapping?.type === 'enttec' && (() => {
        const m = mapping as EnttecDmxMapping;
        return (
          <Field label="Ch"><NumInput value={m.channel} onChange={(v) => onChange({ ...m, channel: Math.max(1, Math.min(512, v)) })} /></Field>
        );
      })()}
      <OutputSelect mapping={mapping} onChange={onChange} />
    </div>
  );
}

function AutoBpmInspectorPanel({ widget, activePageId, updateWidget, updateWidgetRect }: {
  widget: AutoBpmWidget;
  activePageId: string;
  updateWidget: StoreState['updateWidget'];
  updateWidgetRect: StoreState['updateWidgetRect'];
}) {
  function patch(partial: Partial<AutoBpmWidget>) { updateWidget(activePageId, widget.id, partial as never); }
  function patchStyle(p: Partial<typeof widget.style>) { patch({ style: { ...widget.style, ...p } }); }

  function patchOutput(i: number, partial: Partial<BeatOutput>) {
    const beatOutputs = widget.beatOutputs.map((o, idx) => idx === i ? { ...o, ...partial } : o);
    patch({ beatOutputs });
  }

  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  return (
    <>
      <div style={styles.header}>BPM Clock</div>

      <Section label="Label">
        <input style={styles.input} value={widget.label} onChange={(e) => patch({ label: e.target.value })} />
      </Section>

      <Section label="Position">
        <Row>
          <Field label="X"><NumInput value={widget.rect.x} onChange={(v) => updateWidgetRect(activePageId, widget.id, { x: v })} /></Field>
          <Field label="Y"><NumInput value={widget.rect.y} onChange={(v) => updateWidgetRect(activePageId, widget.id, { y: v })} /></Field>
        </Row>
        <Row>
          <Field label="W"><NumInput value={widget.rect.width} onChange={(v) => updateWidgetRect(activePageId, widget.id, { width: v })} /></Field>
          <Field label="H"><NumInput value={widget.rect.height} onChange={(v) => updateWidgetRect(activePageId, widget.id, { height: v })} /></Field>
        </Row>
      </Section>

      <Section label="Beat Outputs">
        <div style={{ fontSize: 12, color: 'var(--color-text-dim)', marginBottom: 8, lineHeight: 1.5 }}>
          Each divisor has a trigger (0→1→0 pulse) and a ramp (0→1 sawtooth).
        </div>
        {BEAT_DIVISORS.map((D, i) => {
          const out = widget.beatOutputs[i];
          const isOpen = expandedIdx === i;
          const hasMapping = !!(out.triggerMapping || out.rampMapping);
          return (
            <div key={D} style={{ marginBottom: 4 }}>
              <button
                onClick={() => setExpandedIdx(isOpen ? null : i)}
                style={{
                  width: '100%', textAlign: 'left', background: isOpen ? 'var(--color-surface-2)' : 'none',
                  border: `1px solid ${isOpen ? 'var(--color-border)' : 'transparent'}`,
                  borderRadius: 3, padding: '4px 8px', cursor: 'pointer',
                  color: hasMapping ? 'var(--color-text)' : 'var(--color-text-dim)',
                  fontSize: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                }}
              >
                <span>x{D} {D === 1 ? '(every beat)' : D === 3 ? '(triplet bar)' : `(${D} beats)`}</span>
                <span style={{ fontSize: 11, color: hasMapping ? pal('#3b8b91') : '#333' }}>
                  {hasMapping ? '●' : '○'} {isOpen ? '▲' : '▼'}
                </span>
              </button>
              {isOpen && (
                <div style={{ padding: '8px 8px 4px', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderTop: 'none', borderRadius: '0 0 3px 3px' }}>
                  <BeatOutputMappingEditor
                    label="Trigger (pulse)"
                    mapping={out.triggerMapping}
                    onChange={(m) => patchOutput(i, { triggerMapping: m })}
                  />
                  <BeatOutputMappingEditor
                    label="Ramp (sawtooth)"
                    mapping={out.rampMapping}
                    onChange={(m) => patchOutput(i, { rampMapping: m })}
                  />
                </div>
              )}
            </div>
          );
        })}
      </Section>

      <FrameSection style={widget.style} patchStyle={patchStyle} />
    </>
  );
}

// ─── Router inspector panel ───────────────────────────────────────────────────

function RouterOutputEditor({ output, onChange, onRemove }: {
  output: RouterOutput;
  onChange: (updated: Partial<RouterOutput>) => void;
  onRemove: () => void;
}) {
  const project = useProject();
  const mode = output.targetWidgetId != null ? 'widget' : (output.mapping?.type ?? '');

  function handleModeChange(p: string) {
    if (p === 'widget') {
      onChange({ mapping: null, targetWidgetId: '', targetCellIndex: 0 });
    } else {
      onChange({ targetWidgetId: undefined, targetCellIndex: undefined });
      if (!p) { onChange({ mapping: null }); return; }
      if (p === 'midi')   onChange({ mapping: { type: 'midi', messageType: 'controlChange', channel: 1, number: 0, minValue: 0, maxValue: 127 } });
      else if (p === 'osc')    onChange({ mapping: { type: 'osc', address: '/out' } });
      else if (p === 'enttec') onChange({ mapping: { type: 'enttec', channel: 1, minValue: 0, maxValue: 255 } });
      else if (p === 'artnet') onChange({ mapping: { type: 'artnet', universe: 0, channel: 1, minValue: 0, maxValue: 255 } });
      else if (p === 'sacn')   onChange({ mapping: { type: 'sacn', universe: 1, channel: 1, minValue: 0, maxValue: 255, priority: 100 } });
    }
  }

  function pm(partial: Partial<Mapping & object>) { onChange({ mapping: { ...output.mapping!, ...partial } as Mapping }); }

  // Widget cell target: compute available target widgets and their cells
  // Only widgets that take a value in — an output cannot drive an output.
  const targetGroups = project.pages
    .map((pg) => ({ pageId: pg.id, pageName: pg.name, widgets: pg.widgets.filter((w) => targetCells(w).length > 0) }))
    .filter((g) => g.widgets.length > 0);
  const allWidgets = project.pages.flatMap((pg) => pg.widgets);
  const targetWidget = allWidgets.find((w) => w.id === output.targetWidgetId);
  function getTargetCells(widgetId: string): { index: number; label: string }[] {
    const w = allWidgets.find((x) => x.id === widgetId);
    return w ? targetCells(w) : [];
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
        <select style={{ ...styles.input, flex: 1, fontSize: 12 }} value={mode} onChange={(e) => handleModeChange(e.target.value)}>
          <option value="">— output type —</option>
          <option value="widget">Widget Cell</option>
          <option value="midi">MIDI</option>
          <option value="osc">OSC</option>
          <option value="enttec">Enttec DMX USB</option>
          <option value="artnet">Art-Net</option>
          <option value="sacn">sACN / E1.31</option>
        </select>
        <button onClick={onRemove} style={{ background: 'none', border: '1px solid #333', color: '#555', cursor: 'pointer', borderRadius: 2, padding: '2px 6px', fontSize: 12, flexShrink: 0 }}>✕</button>
      </div>
      {mode === 'widget' && (
        <div style={{ display: 'flex', gap: 4 }}>
          <select
            style={{ ...styles.input, flex: 2, fontSize: 12 }}
            value={output.targetWidgetId ?? ''}
            onChange={(e) => onChange({ targetWidgetId: e.target.value, targetCellIndex: 0 })}
          >
            <option value="">— widget —</option>
            {targetGroups.map((g) => (
              <optgroup key={g.pageId} label={g.pageName}>
                {g.widgets.map((w) => <option key={w.id} value={w.id}>{w.label}</option>)}
              </optgroup>
            ))}
          </select>
          <select
            style={{ ...styles.input, flex: 1, fontSize: 12 }}
            value={output.targetAllCells ? 'all' : String(output.targetCellIndex ?? 0)}
            disabled={!targetWidget}
            onChange={(e) => onChange(e.target.value === 'all'
              ? { targetAllCells: true }
              : { targetAllCells: false, targetCellIndex: Number(e.target.value) })}
          >
            {/* One output for the whole widget, instead of one per cell. */}
            <option value="all">✳ ALL cells</option>
            <option disabled>──────────</option>
            {getTargetCells(output.targetWidgetId ?? '').map((c) => (
              <option key={c.index} value={c.index}>{c.label}</option>
            ))}
            {!targetWidget && <option value={0}>—</option>}
          </select>
        </div>
      )}
      {mode === 'widget' && output.targetAllCells && targetWidget && (
        <div style={{ fontSize: 11, color: 'var(--color-text-dim)' }}>
          Drives all {getTargetCells(output.targetWidgetId ?? '').length} cells of {targetWidget.label} together.
        </div>
      )}
      {output.mapping?.type === 'midi' && (() => {
        const m = output.mapping as MidiMapping;
        return (
          <>
            <Row>
              <Field label="Ch"><NumInput value={m.channel} onChange={(v) => pm({ channel: Math.max(1, Math.min(16, v)) })} /></Field>
              <Field label="CC"><NumInput value={m.number} onChange={(v) => pm({ number: Math.max(0, Math.min(127, v)) })} /></Field>
            </Row>
            <Row>
              <Field label="Min"><NumInput value={m.minValue} onChange={(v) => pm({ minValue: v })} /></Field>
              <Field label="Max"><NumInput value={m.maxValue} onChange={(v) => pm({ maxValue: v })} /></Field>
            </Row>
          </>
        );
      })()}
      {output.mapping?.type === 'osc' && (() => {
        const m = output.mapping as OscMapping;
        return (
          <>
            <input style={{ ...styles.input, fontSize: 12 }} placeholder="/address"
              value={m.address}
              onChange={(e) => pm({ address: e.target.value })} />
            <Row>
              <Field label="Min"><NumInput value={m.minValue ?? 0} onChange={(v) => pm({ minValue: v })} /></Field>
              <Field label="Max"><NumInput value={m.maxValue ?? 1} onChange={(v) => pm({ maxValue: v })} /></Field>
            </Row>
          </>
        );
      })()}
      {output.mapping?.type === 'enttec' && (() => {
        const m = output.mapping as EnttecDmxMapping;
        return (
          <>
            <Field label="Channel">
              <NumInput value={m.channel} onChange={(v) => pm({ channel: Math.max(1, Math.min(512, v)) })} />
            </Field>
            <Row>
              <Field label="Min"><NumInput value={m.minValue} onChange={(v) => pm({ minValue: v })} /></Field>
              <Field label="Max"><NumInput value={m.maxValue} onChange={(v) => pm({ maxValue: v })} /></Field>
            </Row>
          </>
        );
      })()}
      {(output.mapping?.type === 'artnet' || output.mapping?.type === 'sacn') && (() => {
        const m = output.mapping as ArtNetMapping | SacnMapping;
        return (
          <>
            <Row>
              <Field label="Universe"><NumInput value={m.universe} onChange={(v) => pm({ universe: v })} /></Field>
              <Field label="Channel"><NumInput value={m.channel} onChange={(v) => pm({ channel: Math.max(1, Math.min(512, v)) })} /></Field>
            </Row>
            <Row>
              <Field label="Min"><NumInput value={m.minValue} onChange={(v) => pm({ minValue: v })} /></Field>
              <Field label="Max"><NumInput value={m.maxValue} onChange={(v) => pm({ maxValue: v })} /></Field>
            </Row>
          </>
        );
      })()}
      <OutputSelect mapping={output.mapping ?? null} onChange={(m) => pm({ outputId: (m as { outputId?: string }).outputId })} />

      {/* Per-output travel: the same source can drive each output over a
          different span, or over an inverted one. */}
      <div style={{ fontSize: 11, color: 'var(--color-text-dim)', marginTop: 4 }}>Range</div>
      <Row>
        <Field label="In min"><NumInput value={output.inMin ?? 0} step={0.01} onChange={(v) => onChange({ inMin: v })} /></Field>
        <Field label="In max"><NumInput value={output.inMax ?? 1} step={0.01} onChange={(v) => onChange({ inMax: v })} /></Field>
      </Row>
      <Row>
        <Field label="Out min"><NumInput value={output.outMin ?? 0} step={0.01} onChange={(v) => onChange({ outMin: v })} /></Field>
        <Field label="Out max"><NumInput value={output.outMax ?? 1} step={0.01} onChange={(v) => onChange({ outMax: v })} /></Field>
      </Row>
    </div>
  );
}

function RouterInspectorPanel({ widget, activePageId, updateWidget, updateWidgetRect }: {
  widget: RouterWidget;
  activePageId: string;
  updateWidget: StoreState['updateWidget'];
  updateWidgetRect: StoreState['updateWidgetRect'];
}) {
  const project = useProject();

  function patch(partial: Partial<RouterWidget>) { updateWidget(activePageId, widget.id, partial as never); }
  function patchStyle(p: Partial<typeof widget.style>) { patch({ style: { ...widget.style, ...p } }); }

  // Every widget that has cells, on every page — the same set the right-click
  // link menu offers, so the two cannot disagree about what can be routed.
  const inputGroups = listLinkableSources(project);
  const allWidgets = project.pages.flatMap((pg) => pg.widgets);

  function getCells(widgetId: string): { index: number; label: string }[] {
    const w = allWidgets.find((x) => x.id === widgetId);
    return w ? sourceCells(w) : [];
  }

  function addRow() {
    const newRow: RouterRow = { id: crypto.randomUUID(), inputType: 'widget', widgetId: '', cellIndex: 0, outputs: [] };
    patch({ rows: [...widget.rows, newRow] });
  }

  function removeRow(rowId: string) {
    patch({ rows: widget.rows.filter((r) => r.id !== rowId) });
  }

  function updateRow(rowId: string, partial: Partial<RouterRow>) {
    patch({ rows: widget.rows.map((r) => r.id === rowId ? { ...r, ...partial } : r) });
  }

  function addOutput(rowId: string) {
    const newOut: RouterOutput = { id: crypto.randomUUID(), mapping: null };
    patch({ rows: widget.rows.map((r) => r.id === rowId ? { ...r, outputs: [...r.outputs, newOut] } : r) });
  }

  function removeOutput(rowId: string, outId: string) {
    patch({ rows: widget.rows.map((r) => r.id === rowId ? { ...r, outputs: r.outputs.filter((o) => o.id !== outId) } : r) });
  }

  function updateOutput(rowId: string, outId: string, partial: Partial<RouterOutput>) {
    patch({ rows: widget.rows.map((r) => r.id === rowId
      ? { ...r, outputs: r.outputs.map((o) => o.id === outId ? { ...o, ...partial } : o) }
      : r
    )});
  }

  const rowBtnStyle: React.CSSProperties = {
    background: 'none', border: '1px dashed #333', color: '#555', cursor: 'pointer',
    fontSize: 12, borderRadius: 2, padding: '3px 8px',
  };

  return (
    <>
      <div style={styles.header}>Router</div>

      <Section label="Label">
        <input style={styles.input} value={widget.label} onChange={(e) => patch({ label: e.target.value })} />
      </Section>

      <Section label="Position">
        <Row>
          <Field label="X"><NumInput value={widget.rect.x} onChange={(v) => updateWidgetRect(activePageId, widget.id, { x: v })} /></Field>
          <Field label="Y"><NumInput value={widget.rect.y} onChange={(v) => updateWidgetRect(activePageId, widget.id, { y: v })} /></Field>
        </Row>
        <Row>
          <Field label="W"><NumInput value={widget.rect.width} onChange={(v) => updateWidgetRect(activePageId, widget.id, { width: v })} /></Field>
          <Field label="H"><NumInput value={widget.rect.height} onChange={(v) => updateWidgetRect(activePageId, widget.id, { height: v })} /></Field>
        </Row>
      </Section>

      <Section label="Style">
        <Row>
          <Field label="Font size">
            <NumInput value={widget.style.fontSize} onChange={(v) => patchStyle({ fontSize: Math.max(8, v) })} />
          </Field>
        </Row>
      </Section>

      <Section label="Routes">
        <div style={{ fontSize: 12, color: 'var(--color-text-dim)', marginBottom: 8, lineHeight: 1.5 }}>
          Each route reads one widget cell and forwards its value (0–1) to all listed outputs.
        </div>

        {widget.rows.map((row, rowIdx) => {
          const inputType: RouterInputType = row.inputType ?? 'widget';
          const cells = getCells(row.widgetId);
          return (
            <div key={row.id} style={{ marginBottom: 12 }}>
              {/* Source type selector */}
              <div style={{ display: 'flex', gap: 4, alignItems: 'center', marginBottom: 4 }}>
                <span style={{ fontSize: 12, color: '#505050', width: 18, flexShrink: 0, textAlign: 'right' }}>{rowIdx + 1}</span>
                <select
                  style={{ ...styles.input, flex: 1, fontSize: 12 }}
                  value={inputType}
                  onChange={(e) => updateRow(row.id, { inputType: e.target.value as RouterInputType, widgetId: '', cellIndex: 0 })}
                >
                  <option value="widget">Widget Cell</option>
                  <option value="midiCC">MIDI CC</option>
                  <option value="midiNote">MIDI Note</option>
                  <option value="osc">OSC</option>
                  <option value="artnet">Art-Net in</option>
                  <option value="sacn">sACN in</option>
                </select>
                <button
                  onClick={() => removeRow(row.id)}
                  style={{ background: 'none', border: 'none', color: '#444', cursor: 'pointer', fontSize: 14, padding: '0 2px', flexShrink: 0 }}
                >✕</button>
              </div>

              {/* Source-specific inputs */}
              {inputType === 'widget' && (
                <div style={{ display: 'flex', gap: 4, marginBottom: 4, marginLeft: 22 }}>
                  <select
                    style={{ ...styles.input, flex: 2, fontSize: 12 }}
                    value={row.widgetId}
                    onChange={(e) => updateRow(row.id, { widgetId: e.target.value, cellIndex: 0 })}
                  >
                    <option value="">— widget —</option>
                    {inputGroups.map((g) => (
                      <optgroup key={g.pageId} label={g.pageName}>
                        {g.widgets.map((w) => <option key={w.id} value={w.id}>{w.label}</option>)}
                      </optgroup>
                    ))}
                  </select>
                  <select
                    style={{ ...styles.input, flex: 1, fontSize: 12 }}
                    value={row.allCells ? 'all' : String(row.cellIndex)}
                    onChange={(e) => updateRow(row.id, e.target.value === 'all'
                      ? { allCells: true }
                      : { allCells: false, cellIndex: Number(e.target.value) })}
                    disabled={cells.length === 0}
                  >
                    <option value="all">✳ ALL cells</option>
                    <option disabled>──────────</option>
                    {cells.length === 0
                      ? <option value={0}>—</option>
                      : cells.map((c) => <option key={c.index} value={c.index}>{c.label}</option>)
                    }
                  </select>
                </div>
              )}
              {inputType === 'widget' && row.allCells && (
                <div style={{ fontSize: 11, color: 'var(--color-text-dim)', marginLeft: 22, marginBottom: 4 }}>
                  Every cell is its own signal. With an ALL output the banks mirror
                  one another cell by cell; other outputs follow the first cell only.
                </div>
              )}
              {(inputType === 'midiCC' || inputType === 'midiNote') && (
                <div style={{ display: 'flex', gap: 4, marginBottom: 4, marginLeft: 22 }}>
                  <Field label="Ch (0=any)">
                    <NumInput
                      value={row.midiChannel ?? 0}
                      min={0} max={16}
                      onChange={(v) => updateRow(row.id, { midiChannel: Math.max(0, Math.min(16, v)) })}
                    />
                  </Field>
                  <Field label={inputType === 'midiCC' ? 'CC' : 'Note'}>
                    <NumInput
                      value={row.midiNumber ?? 0}
                      min={0} max={127}
                      onChange={(v) => updateRow(row.id, { midiNumber: Math.max(0, Math.min(127, v)) })}
                    />
                  </Field>
                </div>
              )}
              {(inputType === 'artnet' || inputType === 'sacn') && (
                <div style={{ display: 'flex', gap: 4, marginBottom: 4, marginLeft: 22 }}>
                  <Field label="Universe">
                    <NumInput
                      value={row.artnetUniverse ?? (inputType === 'sacn' ? 1 : 0)}
                      min={inputType === 'sacn' ? 1 : 0} max={inputType === 'sacn' ? 63999 : 32767}
                      onChange={(v) => updateRow(row.id, { artnetUniverse: inputType === 'sacn' ? Math.max(1, Math.min(63999, v)) : Math.max(0, Math.min(32767, v)) })}
                    />
                  </Field>
                  <Field label="Channel">
                    <NumInput
                      value={row.artnetChannel ?? 1}
                      min={1} max={512}
                      onChange={(v) => updateRow(row.id, { artnetChannel: Math.max(1, Math.min(512, v)) })}
                    />
                  </Field>
                </div>
              )}
              {inputType === 'osc' && (
                <div style={{ marginBottom: 4, marginLeft: 22 }}>
                  <input
                    style={{ ...styles.input, fontSize: 12 }}
                    placeholder="/address"
                    value={row.oscAddress ?? ''}
                    onChange={(e) => updateRow(row.id, { oscAddress: e.target.value })}
                  />
                </div>
              )}

              {/* Outputs */}
              {row.outputs.map((out) => (
                <div key={out.id} style={{
                  marginLeft: 22, marginBottom: 4,
                  padding: '6px 8px',
                  background: 'var(--color-surface)',
                  border: '1px solid var(--color-border)',
                  borderLeft: '2px solid #2a2a2a',
                  borderRadius: '0 2px 2px 0',
                }}>
                  <RouterOutputEditor
                    output={out}
                    onChange={(partial) => updateOutput(row.id, out.id, partial)}
                    onRemove={() => removeOutput(row.id, out.id)}
                  />
                </div>
              ))}

              <button
                onClick={() => addOutput(row.id)}
                style={{ ...rowBtnStyle, marginLeft: 22, width: 'calc(100% - 22px)' }}
              >
                + output
              </button>
            </div>
          );
        })}

        <button onClick={addRow} style={{ ...rowBtnStyle, width: '100%', marginTop: 4 }}>
          + route
        </button>
      </Section>

      <FrameSection style={widget.style} patchStyle={patchStyle} />
    </>
  );
}

// ─── Audio Analyser inspector panel ──────────────────────────────────────────

function AudioAnalyserInspectorPanel({ widget, activePageId, updateWidget, updateWidgetRect }: {
  widget: import('../../../../shared/types/project').AudioAnalyserWidget;
  activePageId: string;
  updateWidget: StoreState['updateWidget'];
  updateWidgetRect: StoreState['updateWidgetRect'];
}) {
  function patch(p: object) { updateWidget(activePageId, widget.id, p as never); }
  function patchStyle(p: Partial<typeof widget.style>) { patch({ style: { ...widget.style, ...p } }); }
  function patchBeatOutput(i: number, partial: Partial<import('../../../../shared/types/project').BeatOutput>) {
    const beatOutputs = (widget.beatOutputs ?? []).map((o, idx) => idx === i ? { ...o, ...partial } : o);
    patch({ beatOutputs });
  }

  const [expandedBpmIdx, setExpandedBpmIdx] = useState<number | null>(null);

  const OUTPUTS: { key: 'kickMapping' | 'snareMapping' | 'bassMapping' | 'midMapping' | 'highMapping'; label: string }[] = [
    { key: 'kickMapping', label: 'Kick trigger' },
    { key: 'snareMapping', label: 'Snare trigger' },
    { key: 'bassMapping', label: 'Bass level' },
    { key: 'midMapping', label: 'Mid level' },
    { key: 'highMapping', label: 'High level' },
  ];

  return (
    <>
      <div style={styles.header}>Audio Analyser</div>

      <Section label="Label">
        <input style={styles.input} value={widget.label} onChange={(e) => patch({ label: e.target.value })} />
      </Section>

      <Section label="Position">
        <Row>
          <Field label="X"><NumInput value={widget.rect.x} onChange={(v) => updateWidgetRect(activePageId, widget.id, { x: v })} /></Field>
          <Field label="Y"><NumInput value={widget.rect.y} onChange={(v) => updateWidgetRect(activePageId, widget.id, { y: v })} /></Field>
        </Row>
        <Row>
          <Field label="W"><NumInput value={widget.rect.width} onChange={(v) => updateWidgetRect(activePageId, widget.id, { width: v })} /></Field>
          <Field label="H"><NumInput value={widget.rect.height} onChange={(v) => updateWidgetRect(activePageId, widget.id, { height: v })} /></Field>
        </Row>
      </Section>

      <Section label="BPM Outputs">
        <div style={{ fontSize: 12, color: 'var(--color-text-dim)', marginBottom: 8, lineHeight: 1.5 }}>
          Each divisor has a trigger (pulse) and a ramp (0→1 sawtooth).
        </div>
        {BEAT_DIVISORS.map((D, i) => {
          const out = widget.beatOutputs?.[i];
          const isOpen = expandedBpmIdx === i;
          const hasMapping = !!(out?.triggerMapping || out?.rampMapping);
          return (
            <div key={D} style={{ marginBottom: 4 }}>
              <button
                onClick={() => setExpandedBpmIdx(isOpen ? null : i)}
                style={{
                  width: '100%', textAlign: 'left', background: isOpen ? 'var(--color-surface-2)' : 'none',
                  border: `1px solid ${isOpen ? 'var(--color-border)' : 'transparent'}`,
                  borderRadius: 3, padding: '4px 8px', cursor: 'pointer',
                  color: hasMapping ? 'var(--color-text)' : 'var(--color-text-dim)',
                  fontSize: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                }}
              >
                <span>×{D} {D === 1 ? '(every beat)' : D === 3 ? '(triplet bar)' : `(${D} beats)`}</span>
                <span style={{ fontSize: 11, color: hasMapping ? pal('#3b8b91') : '#333' }}>
                  {hasMapping ? '●' : '○'} {isOpen ? '▲' : '▼'}
                </span>
              </button>
              {isOpen && (
                <div style={{ padding: '8px 8px 4px', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderTop: 'none', borderRadius: '0 0 3px 3px' }}>
                  <Field label="Label">
                    <input
                      style={styles.input}
                      placeholder={`×${D}`}
                      value={out?.name ?? ''}
                      onChange={(e) => patchBeatOutput(i, { name: e.target.value || undefined })}
                    />
                  </Field>
                  <BeatOutputMappingEditor
                    label="Trigger (pulse)"
                    mapping={out?.triggerMapping ?? null}
                    onChange={(m) => patchBeatOutput(i, { triggerMapping: m })}
                  />
                  <BeatOutputMappingEditor
                    label="Ramp (sawtooth)"
                    mapping={out?.rampMapping ?? null}
                    onChange={(m) => patchBeatOutput(i, { rampMapping: m })}
                  />
                </div>
              )}
            </div>
          );
        })}
      </Section>

      <Section label="Kick">
        <Row>
          <Field label="Freq (Hz)"><NumInput value={widget.kickFreq} onChange={(v) => patch({ kickFreq: Math.max(1, v) })} /></Field>
          <Field label="Band (Hz)"><NumInput value={widget.kickBand} onChange={(v) => patch({ kickBand: Math.max(1, v) })} /></Field>
        </Row>
      </Section>

      <Section label="Snare">
        <Row>
          <Field label="Freq (Hz)"><NumInput value={widget.snareFreq} onChange={(v) => patch({ snareFreq: Math.max(1, v) })} /></Field>
          <Field label="Band (Hz)"><NumInput value={widget.snareBand} onChange={(v) => patch({ snareBand: Math.max(1, v) })} /></Field>
        </Row>
      </Section>

      <Section label="Bass (Lowpass)">
        <Row>
          <Field label="Cutoff (Hz)"><NumInput value={widget.bassFreq} onChange={(v) => patch({ bassFreq: Math.max(1, v) })} /></Field>
          <Field label="Rolloff (Hz)"><NumInput value={widget.bassBand} onChange={(v) => patch({ bassBand: Math.max(1, v) })} /></Field>
        </Row>
      </Section>

      <Section label="Mid (Bandpass)">
        <Row>
          <Field label="Center (Hz)"><NumInput value={widget.midFreq} onChange={(v) => patch({ midFreq: Math.max(1, v) })} /></Field>
          <Field label="Width (Hz)"><NumInput value={widget.midBand} onChange={(v) => patch({ midBand: Math.max(1, v) })} /></Field>
        </Row>
      </Section>

      <Section label="High (Highpass)">
        <Row>
          <Field label="Cutoff (Hz)"><NumInput value={widget.highFreq} onChange={(v) => patch({ highFreq: Math.max(1, v) })} /></Field>
          <Field label="Rolloff (Hz)"><NumInput value={widget.highBand} onChange={(v) => patch({ highBand: Math.max(1, v) })} /></Field>
        </Row>
      </Section>

      <Section label="Audio Output Mappings">
        {OUTPUTS.map(({ key, label }) => (
          <BeatOutputMappingEditor
            key={key}
            label={label}
            mapping={(widget as never)[key] as Mapping}
            onChange={(m) => patch({ [key]: m })}
          />
        ))}
      </Section>

      <FrameSection style={widget.style} patchStyle={patchStyle} />
    </>
  );
}

// ─── Sound Player inspector panel ─────────────────────────────────────────────

function SoundPlayerInspectorPanel({ widget, activePageId, updateWidget, updateWidgetRect }: {
  widget: import('../../../../shared/types/project').SoundPlayerWidget;
  activePageId: string;
  updateWidget: StoreState['updateWidget'];
  updateWidgetRect: StoreState['updateWidgetRect'];
}) {
  function patch(p: object) { updateWidget(activePageId, widget.id, p as never); }
  function patchStyle(p: Partial<typeof widget.style>) { patch({ style: { ...widget.style, ...p } }); }
  function patchTracks(tracks: import('../../../../shared/types/project').SoundPlayerTrack[]) { patch({ tracks }); }

  function addTrack() {
    const newTrack: import('../../../../shared/types/project').SoundPlayerTrack = {
      id: crypto.randomUUID(),
      label: `Track ${widget.tracks.length + 1}`,
      src: '',
      fileName: '',
      volume: 0.8,
      playMapping: null,
    };
    patchTracks([...widget.tracks, newTrack]);
  }

  function removeTrack(id: string) {
    patchTracks(widget.tracks.filter((t) => t.id !== id));
  }

  function updateTrack(id: string, p: Partial<import('../../../../shared/types/project').SoundPlayerTrack>) {
    patchTracks(widget.tracks.map((t) => t.id === id ? { ...t, ...p } : t));
  }

  function moveTrack(from: number, to: number) {
    const arr = [...widget.tracks];
    const [item] = arr.splice(from, 1);
    arr.splice(to, 0, item);
    patchTracks(arr);
  }

  async function loadFile(id: string) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'audio/*';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        const src = ev.target?.result as string;
        updateTrack(id, { src, fileName: file.name, label: file.name.replace(/\.[^.]+$/, '') });
      };
      reader.readAsDataURL(file);
    };
    input.click();
  }

  return (
    <>
      <div style={styles.header}>Sound Player</div>

      <Section label="Label">
        <input style={styles.input} value={widget.label} onChange={(e) => patch({ label: e.target.value })} />
      </Section>

      <Section label="Position">
        <Row>
          <Field label="X"><NumInput value={widget.rect.x} onChange={(v) => updateWidgetRect(activePageId, widget.id, { x: v })} /></Field>
          <Field label="Y"><NumInput value={widget.rect.y} onChange={(v) => updateWidgetRect(activePageId, widget.id, { y: v })} /></Field>
        </Row>
        <Row>
          <Field label="W"><NumInput value={widget.rect.width} onChange={(v) => updateWidgetRect(activePageId, widget.id, { width: v })} /></Field>
          <Field label="H"><NumInput value={widget.rect.height} onChange={(v) => updateWidgetRect(activePageId, widget.id, { height: v })} /></Field>
        </Row>
      </Section>

      <Section label="Master Volume">
        <Row>
          <Field label="Vol %">
            <NumInput value={Math.round(widget.masterVolume * 100)}
              onChange={(v) => patch({ masterVolume: Math.max(0, Math.min(100, v)) / 100 })} />
          </Field>
        </Row>
      </Section>

      <Section label="Tracks">
        <div style={{ fontSize: 12, color: 'var(--color-text-dim)', marginBottom: 8 }}>
          Each track is a trigger: link it from a timeline, a clock time, a button, DMX, OSC… (right-click ▶ on the widget,
          Shift-patch, or the Router page). STOP / NEXT / PREV / FIRST are inputs too (the buttons in the widget header).
        </div>
        {widget.tracks.map((track, i) => (
          <div key={track.id} style={{
            marginBottom: 8, padding: '8px',
            background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 3,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <span style={{ fontSize: 12, color: '#666' }}>#{i + 1}</span>
              <div style={{ display: 'flex', gap: 4 }}>
                {i > 0 && (
                  <button onClick={() => moveTrack(i, i - 1)}
                    style={{ background: 'none', border: '1px solid #333', color: '#555', cursor: 'pointer', fontSize: 12, padding: '1px 5px', borderRadius: 2 }}>▲</button>
                )}
                {i < widget.tracks.length - 1 && (
                  <button onClick={() => moveTrack(i, i + 1)}
                    style={{ background: 'none', border: '1px solid #333', color: '#555', cursor: 'pointer', fontSize: 12, padding: '1px 5px', borderRadius: 2 }}>▼</button>
                )}
                <button onClick={() => removeTrack(track.id)}
                  style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: 14, padding: '0 2px' }}>✕</button>
              </div>
            </div>

            <div style={{ marginBottom: 4 }}>
              <div style={{ fontSize: 11, color: '#555', marginBottom: 2 }}>Label</div>
              <input style={styles.input} value={track.label}
                onChange={(e) => updateTrack(track.id, { label: e.target.value })} />
            </div>

            <div style={{ marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
              <button
                onClick={() => loadFile(track.id)}
                style={{ background: '#1a1a1a', border: '1px solid #333', color: '#aaa', cursor: 'pointer', fontSize: 12, padding: '3px 8px', borderRadius: 2 }}
              >
                {track.fileName ? '🔄 Change file' : '📂 Load file'}
              </button>
              {track.fileName && (
                <span style={{ fontSize: 11, color: '#555', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                  {track.fileName}
                </span>
              )}
            </div>

            <Row>
              <Field label="Volume %">
                <NumInput value={Math.round(track.volume * 100)}
                  onChange={(v) => updateTrack(track.id, { volume: Math.max(0, Math.min(100, v)) / 100 })} />
              </Field>
              <Field label="At the end">
                <select style={styles.input} value={track.end ?? 'stop'} onChange={(e) => updateTrack(track.id, { end: e.target.value as 'stop' | 'loop' | 'next' })}>
                  <option value="stop">■ stop</option><option value="loop">⟳ loop</option><option value="next">⇥ next</option>
                </select>
              </Field>
              <Field label="Fade s">
                <NumInput value={track.fade ?? 0} step={0.5} onChange={(v) => updateTrack(track.id, { fade: Math.max(0, v) })} />
              </Field>
            </Row>

            <div style={{ marginTop: 6 }}>
              <div style={{ fontSize: 11, color: '#555', marginBottom: 3 }}>Play trigger mapping</div>
              <BeatOutputMappingEditor
                label=""
                mapping={track.playMapping}
                onChange={(m) => updateTrack(track.id, { playMapping: m })}
              />
            </div>
          </div>
        ))}
        <button
          onClick={addTrack}
          style={{ width: '100%', background: 'none', border: '1px dashed #333', color: '#555', cursor: 'pointer', fontSize: 12, borderRadius: 2, padding: '5px' }}
        >
          + add track
        </button>
      </Section>

      <FrameSection style={widget.style} patchStyle={patchStyle} />
    </>
  );
}

// ─── Nothing selected ─────────────────────────────────────────────────────────

function NoSelectionPanel() {
  const project = useProject();
  const { setProjectName } = useStore(useShallow((s) => ({ setProjectName: s.setProjectName })));

  const conns = project.connections;
  const midiConn      = conns.find((c) => c.type === 'midi')        as MidiConnection        | undefined;
  const midiInConn    = conns.find((c) => c.type === 'midiInput')   as MidiInputConnection   | undefined;
  const oscConn       = conns.find((c) => c.type === 'osc')         as OscConnection         | undefined;
  const artnetConn    = conns.find((c) => c.type === 'artnet')      as ArtNetConnection      | undefined;
  const sacnConn      = conns.find((c) => c.type === 'sacn')        as SacnConnection        | undefined;
  const audioInConn   = conns.find((c) => c.type === 'ltcAudio')    as LtcAudioConnection    | undefined;
  const audioOutConn  = conns.find((c) => c.type === 'audioOutput') as AudioOutputConnection | undefined;

  return (
    <>
      <img src={logoUrl} alt="Maestrale" style={{ width: '100%', display: 'block', marginBottom: 6, objectFit: 'contain' }} />
      <div style={{ textAlign: 'center', fontSize: 11, color: 'var(--color-text-dim)', marginBottom: 16, letterSpacing: 0.5 }}>developed by VENTO in 2026</div>
      <div style={styles.header}>Project</div>

      <Section label="Name">
        <input
          style={styles.input}
          value={project.name}
          onChange={(e) => setProjectName(e.target.value)}
        />
      </Section>

      <Section label="Connections">
        <div style={{ fontSize: 12, color: 'var(--color-text-dim)', marginBottom: 6 }}>
          Open ⚙ to configure
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <ConnBadge label="MIDI out"   status={midiConn?.portName      ?? 'not configured'} />
          <ConnBadge label="MIDI in"    status={midiInConn?.portName    ?? 'not configured'} />
          <ConnBadge label="OSC"        status={oscConn?.targetHost     ? `${oscConn.targetHost}:${oscConn.targetPort ?? 8000}` : 'not configured'} />
          <ConnBadge label="Art-Net"    status={artnetConn?.targetHost  ?? 'not configured'} />
          <ConnBadge label="sACN"       status={sacnConn                ? (sacnConn.mode ?? 'multicast') : 'not configured'} />
          <ConnBadge label="Audio in"   status={audioInConn?.deviceLabel  ?? 'not configured'} />
          <ConnBadge label="Audio out"  status={audioOutConn?.deviceLabel ?? 'not configured'} />
        </div>
      </Section>

    </>
  );
}

function ConnBadge({ label, status }: { label: string; status: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <span style={{ fontSize: 12, color: 'var(--color-text)' }}>{label}</span>
      <span style={{ fontSize: 12, color: 'var(--color-text-dim)', fontStyle: 'italic' }}>{status}</span>
    </div>
  );
}

// ─── Shared primitives ────────────────────────────────────────────────────────

function TriggerField({ mapping, defaultAddress, onChange }: {
  mapping: Mapping | null | undefined;
  defaultAddress: string;
  onChange: (m: Mapping | null) => void;
}) {
  const type = !mapping ? 'none'
    : mapping.type === 'osc' ? 'osc'
    : (mapping as MidiMapping).messageType === 'controlChange' ? 'midi-cc'
    : 'midi-note';

  function handleTypeChange(t: string) {
    if (t === 'none')           onChange(null);
    else if (t === 'osc')       onChange({ type: 'osc', address: defaultAddress });
    else if (t === 'midi-cc')   onChange({ type: 'midi', messageType: 'controlChange', channel: 1, number: 36, minValue: 0, maxValue: 127 });
    else if (t === 'midi-note') onChange({ type: 'midi', messageType: 'noteOn',        channel: 1, number: 36, minValue: 0, maxValue: 127 });
  }

  return (
    <>
      <Field label="Source">
        <select style={styles.input} value={type} onChange={(e) => handleTypeChange(e.target.value)}>
          <option value="none">None</option>
          <option value="osc">OSC</option>
          <option value="midi-cc">MIDI CC</option>
          <option value="midi-note">MIDI Note</option>
        </select>
      </Field>
      {mapping?.type === 'osc' && (
        <Field label="Address">
          <input style={styles.input} value={(mapping as OscMapping).address}
            onChange={(e) => onChange({ ...(mapping as OscMapping), address: e.target.value })} />
        </Field>
      )}
      {mapping?.type === 'midi' && (
        <Row>
          <Field label="Channel">
            <NumInput value={(mapping as MidiMapping).channel}
              onChange={(v) => onChange({ ...(mapping as MidiMapping), channel: Math.max(1, Math.min(16, v)) })} />
          </Field>
          <Field label={(mapping as MidiMapping).messageType === 'noteOn' ? 'Note' : 'CC'}>
            <NumInput value={(mapping as MidiMapping).number}
              onChange={(v) => onChange({ ...(mapping as MidiMapping), number: Math.max(0, Math.min(127, v)) })} />
          </Field>
        </Row>
      )}
    </>
  );
}

function FrameSection({ style, patchStyle }: { style: WidgetStyle; patchStyle: (p: Partial<WidgetStyle>) => void }) {
  const frame      = style.frame      ?? 'none';
  const frameColor = style.frameColor ?? '#ffffff';
  const frameSize  = style.frameSize  ?? 1;
  return (
    <Section label="Frame">
      <Field label="Type">
        <select style={styles.input} value={frame}
          onChange={(e) => patchStyle({ frame: e.target.value as WidgetStyle['frame'] })}>
          <option value="none">None</option>
          <option value="outline">Outline (border)</option>
          <option value="underline">Underline</option>
        </select>
      </Field>
      {frame !== 'none' && (
        <Row>
          <Field label="Color">
            <ColorInput value={frameColor} onChange={(v) => patchStyle({ frameColor: v })} />
          </Field>
          <Field label="Size (px)">
            <NumInput value={frameSize} onChange={(v) => patchStyle({ frameSize: Math.max(1, v) })} />
          </Field>
        </Row>
      )}
    </Section>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text-dim)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
        {label}
      </div>
      {children}
    </div>
  );
}

function CollapsibleSection({ label, children, defaultOpen = false, proto = false }: {
  label: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  proto?: boolean;   // a connection (OSC, Art-Net…): outlined in the interface colour, to find it at a glance
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ marginBottom: open ? 14 : 4 }}>
      <div
        style={{
          fontSize: 12, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase',
          color: proto ? `var(--color-accent, ${pal('#4fb3b8')})` : 'var(--color-text-dim)', cursor: 'pointer', userSelect: 'none',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          // Slim but still a whole-width target, so it stays easy to hit.
          minHeight: 28, padding: '0 10px', boxSizing: 'border-box',
          background: proto ? `rgba(${palRgb('#4fb3b8')},0.07)` : 'var(--color-surface-2)',
          border: `1px solid ${proto ? `var(--color-accent, ${pal('#4fb3b8')})` : 'var(--color-border)'}`,
          borderRadius: 'var(--radius-sm)',
          touchAction: 'manipulation',
          marginBottom: open ? 10 : 0,
        }}
        onClick={() => setOpen((v) => !v)}
      >
        <span>{label}</span>
        <span style={{ fontSize: 10, opacity: 0.6 }}>{open ? '▲' : '▼'}</span>
      </div>
      {open && children}
    </div>
  );
}

// Side-by-side fields. Spacing lives on Field so that dropping the Row wrapper
// stacks the same fields one per line without losing it.
function Row({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'flex', gap: 8 }}>{children}</div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ flex: 1, marginBottom: 10 }}>
      <div style={{ fontSize: 12, color: 'var(--color-text-dim)', marginBottom: 5 }}>{label}</div>
      {children}
    </div>
  );
}

// Editor for additional target IPs on a protocol — the same signal is also sent
// to each of these machines. Empty rows are ignored when the connection is used.
function ExtraHostsEditor({ hosts, onChange, placeholder, label }: {
  hosts: string[];
  onChange: (hosts: string[]) => void;
  placeholder?: string;
  label?: string;
}) {
  return (
    <div style={{ marginTop: 6 }}>
      <div style={{ fontSize: 12, color: 'var(--color-text-dim)', marginBottom: 5 }}>{label ?? 'Extra target IPs'}</div>
      {hosts.map((h, i) => (
        <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
          <input style={{ ...styles.input, flex: 1 }}
            placeholder={placeholder ?? 'e.g. 192.168.1.101'}
            value={h}
            onChange={(e) => { const next = hosts.slice(); next[i] = e.target.value; onChange(next); }} />
          <button
            onClick={() => onChange(hosts.filter((_, j) => j !== i))}
            title="Remove this IP"
            style={{ width: 40, minHeight: 40, flexShrink: 0, fontSize: 16, background: 'var(--color-surface)',
                     color: 'var(--color-text-dim)', border: '1px solid var(--color-border)',
                     borderRadius: 'var(--radius-sm)', cursor: 'pointer' }}>−</button>
        </div>
      ))}
      <button
        onClick={() => onChange([...hosts, ''])}
        style={{ ...styles.input, minHeight: 40, cursor: 'pointer', background: 'var(--color-surface)',
                 color: 'var(--color-text)' }}>+ IP</button>
    </div>
  );
}

// Editor for additional NAMED, individually-addressable outputs. Each row has a
// name (used by the per-mapping Output selector) plus the destination field(s):
//  · 'host'     → Art-Net / sACN (IP only)
//  · 'hostPort' → OSC (IP + port)
//  · 'portName' → MIDI (port name)
type OutRow = { id: string; name: string; host?: string; port?: number; portName?: string };
function NamedOutputsEditor({ outputs, onChange, field }: {
  outputs: OutRow[];
  onChange: (outputs: OutRow[]) => void;
  field: 'host' | 'hostPort' | 'portName';
}) {
  const patch = (i: number, p: Partial<OutRow>) => { const next = outputs.slice(); next[i] = { ...next[i], ...p }; onChange(next); };
  const add = () => onChange([...outputs, {
    id: crypto.randomUUID(),
    name: `out ${outputs.length + 2}`,
    ...(field === 'portName' ? { portName: '' } : { host: '' }),
    ...(field === 'hostPort' ? { port: 8000 } : {}),
  }]);
  // One field per line: squeezing name + IP + port onto a single row left the IP
  // box too narrow to read an address back.
  return (
    <div style={{ marginTop: 6 }}>
      <div style={{ fontSize: 12, color: 'var(--color-text-dim)', marginBottom: 5 }}>Extra outputs (named)</div>
      {outputs.map((o, i) => (
        <div key={o.id} style={{
          border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)',
          padding: 10, marginBottom: 8,
        }}>
          <Field label="Name">
            <input style={styles.input} placeholder="name"
              value={o.name}
              onChange={(e) => patch(i, { name: e.target.value })} />
          </Field>
          {field === 'portName' ? (
            <Field label="MIDI port name">
              <input style={styles.input} placeholder="exact MIDI port name"
                value={o.portName ?? ''}
                onChange={(e) => patch(i, { portName: e.target.value })} />
            </Field>
          ) : (
            <Field label="Destination IP">
              <input style={styles.input} placeholder="e.g. 192.168.1.101"
                value={o.host ?? ''}
                onChange={(e) => patch(i, { host: e.target.value })} />
            </Field>
          )}
          {field === 'hostPort' && (
            <Field label="Port">
              <input style={styles.input} type="number" placeholder="port"
                value={o.port ?? 8000}
                onChange={(e) => patch(i, { port: Number(e.target.value) })} />
            </Field>
          )}
          <button
            onClick={() => onChange(outputs.filter((_, j) => j !== i))}
            style={{ ...styles.input, minHeight: 40, cursor: 'pointer', background: 'var(--color-surface)',
                     color: 'var(--color-text-dim)' }}>− Remove output</button>
        </div>
      ))}
      <button
        onClick={add}
        style={{ ...styles.input, minHeight: 40, cursor: 'pointer', background: 'var(--color-surface)',
                 color: 'var(--color-text)' }}>+ output</button>
    </div>
  );
}

// Numeric variant of ExtraHostsEditor — for additional local listen ports.
function ExtraPortsEditor({ ports, onChange, label }: {
  ports: number[];
  onChange: (ports: number[]) => void;
  label?: string;
}) {
  return (
    <div style={{ marginTop: 6 }}>
      <div style={{ fontSize: 12, color: 'var(--color-text-dim)', marginBottom: 5 }}>{label ?? 'Extra listen ports'}</div>
      {ports.map((p, i) => (
        <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
          <input style={{ ...styles.input, flex: 1 }} type="number" placeholder="e.g. 9001"
            value={p}
            onChange={(e) => { const next = ports.slice(); next[i] = Number(e.target.value); onChange(next); }} />
          <button
            onClick={() => onChange(ports.filter((_, j) => j !== i))}
            title="Remove this port"
            style={{ width: 40, minHeight: 40, flexShrink: 0, fontSize: 16, background: 'var(--color-surface)',
                     color: 'var(--color-text-dim)', border: '1px solid var(--color-border)',
                     borderRadius: 'var(--radius-sm)', cursor: 'pointer' }}>−</button>
        </div>
      ))}
      <button
        onClick={() => onChange([...ports, 0])}
        style={{ ...styles.input, minHeight: 40, cursor: 'pointer', background: 'var(--color-surface)',
                 color: 'var(--color-text)' }}>+ port</button>
    </div>
  );
}

function NumInput({ value, onChange, min, max, step }: { value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number }) {
  return <NumberInput value={value} onChange={onChange} min={min} max={max} step={step} style={styles.input} />;
}

function ColorInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div style={{ display: 'flex', gap: 4 }}>
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)}
        style={{ width: 28, height: 28, border: 'none', background: 'none', cursor: 'pointer', padding: 0 }} />
      <input style={{ ...styles.input, flex: 1 }} value={value}
        onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

// ─── Linked parameters ────────────────────────────────────────────────────────
// A parameter that has a remote input (Router, Shift, Learn) linked to it is
// shown greyed and not clickable: the link drives it.

function useLinkedInputs(widgetId: string): Set<number> {
  const project = useProject();
  return React.useMemo(() => computeSlavedCellSet(project, widgetId), [project, widgetId]);
}

function Gate({ linked, children }: { linked: boolean; children: React.ReactNode }) {
  if (!linked) return <>{children}</>;
  return (
    <div style={{ position: 'relative' }}>
      <div style={{ opacity: 0.35, pointerEvents: 'none', userSelect: 'none' }}>{children}</div>
      <div style={{ position: 'absolute', right: 0, top: 0, fontSize: 10, color: 'var(--color-accent)', letterSpacing: 1 }}>⇄ LINKED</div>
    </div>
  );
}

// Play / Stop / Reset act on the running widget (Live), like its own buttons.
function TransportButtons({ widgetId, playLinked, resetLinked }: { widgetId: string; playLinked: boolean; resetLinked: boolean }) {
  const playing = useStore((s) => s.runtime.widgets[widgetId]?.playing ?? false);
  const btn = (on: boolean, linked: boolean): React.CSSProperties => ({
    flex: 1, padding: '6px 0', fontSize: 12, borderRadius: 3, whiteSpace: 'nowrap',
    background: on ? 'var(--color-accent)' : 'var(--color-surface-2)',
    border: `1px solid ${on ? 'var(--color-accent)' : 'var(--color-border)'}`,
    color: on ? '#000' : 'var(--color-text)',
    opacity: linked ? 0.35 : 1, cursor: linked ? 'default' : 'pointer', pointerEvents: linked ? 'none' : 'auto',
  });
  return (
    <>
      <div style={{ display: 'flex', gap: 4 }}>
        <button style={btn(playing, playLinked)} onClick={() => useStore.getState().setWidgetPlaying(widgetId, true)}>▶ Play</button>
        <button style={btn(!playing, playLinked)} onClick={() => useStore.getState().setWidgetPlaying(widgetId, false)}>■ Stop</button>
        <button style={btn(false, resetLinked)} onClick={() => pulseParamInput(widgetId, 'reset')}>⟲ Reset</button>
      </div>
      {(playLinked || resetLinked) && (
        <div style={{ fontSize: 10, color: 'var(--color-accent)', letterSpacing: 1, marginTop: 4, textAlign: 'right' }}>
          ⇄ LINKED: {[playLinked && 'PLAY', resetLinked && 'RESET'].filter(Boolean).join(', ')}
        </div>
      )}
    </>
  );
}

// Step Sequencer and Graph: transport + speed, same inputs as the LFO.
function GenTransportSection({ widget, speed, onSpeed }: { widget: { id: string }; speed: SpeedMultiplier; onSpeed: (s: SpeedMultiplier) => void }) {
  const linked = useLinkedInputs(widget.id);
  return (
    <Section label="Transport">
      <TransportButtons widgetId={widget.id} playLinked={linked.has(-1)} resetLinked={linked.has(-3)} />
      <div style={{ height: 6 }} />
      <Gate linked={linked.has(-2)}>
        <Field label="Speed">
          <select style={styles.input} value={String(speed)} onChange={(e) => onSpeed(Number(e.target.value) as SpeedMultiplier)}>
            {GEN_SPEEDS.map((v) => <option key={v} value={v}>{v < 1 ? `1/${1 / v}` : `${v}x`}</option>)}
          </select>
        </Field>
      </Gate>
      <div style={{ fontSize: 12, color: 'var(--color-text-dim)', marginTop: 6, lineHeight: 1.5 }}>
        Remote inputs PLAY, SPEED, RESET: Shift-patch the dots on the top edge, or the Router page. A linked one is greyed here.
      </div>
    </Section>
  );
}

// ─── LFO Inspector Panel ──────────────────────────────────────────────────────

function LfoInspectorPanel({ widget, activePageId, updateWidget, updateWidgetRect }: {
  widget: LfoWidget;
  activePageId: string;
  updateWidget: StoreState['updateWidget'];
  updateWidgetRect: StoreState['updateWidgetRect'];
}) {
  function patch(partial: Partial<LfoWidget>) { updateWidget(activePageId, widget.id, partial as never); }
  const linked = useLinkedInputs(widget.id);

  return (
    <>
      <div style={styles.header}>{widget.kind === 'noiseWidget' ? 'Noise' : 'LFO'}</div>
      <Section label="Transport">
        <TransportButtons widgetId={widget.id} playLinked={linked.has(-1)} resetLinked={linked.has(-7)} />
      </Section>
      <Section label="Label">
        <input style={styles.input} value={widget.label} onChange={(e) => patch({ label: e.target.value })} />
      </Section>
      <Section label="Position">
        <Row>
          <Field label="X"><NumInput value={widget.rect.x} onChange={(v) => updateWidgetRect(activePageId, widget.id, { x: v })} /></Field>
          <Field label="Y"><NumInput value={widget.rect.y} onChange={(v) => updateWidgetRect(activePageId, widget.id, { y: v })} /></Field>
        </Row>
        <Row>
          <Field label="W"><NumInput value={widget.rect.width} onChange={(v) => updateWidgetRect(activePageId, widget.id, { width: v })} /></Field>
          <Field label="H"><NumInput value={widget.rect.height} onChange={(v) => updateWidgetRect(activePageId, widget.id, { height: v })} /></Field>
        </Row>
      </Section>
      <Section label="Waveform">
        <select style={styles.input} value={widget.waveform} onChange={(e) => patch({ waveform: e.target.value as LfoWaveform })}>
          <option value="sine">Sine</option>
          <option value="square">Square</option>
          <option value="saw">Sawtooth</option>
          <option value="triangle">Triangle</option>
          <option value="random">Random (S&H)</option>
          <option value="noise">Noise (smooth)</option>
        </select>
      </Section>
      <Section label="Frequency">
        <Gate linked={linked.has(-2)}>
          <Field label="Mode">
            <select style={styles.input} value={widget.rateMode} onChange={(e) => patch({ rateMode: e.target.value as 'bpm' | 'hz' })}>
              <option value="bpm">BPM-synced</option>
              <option value="hz">Hz</option>
            </select>
          </Field>
          {widget.rateMode === 'bpm' ? (
            <Field label="Beats/cycle">
              <NumInput value={widget.rateMultiplier} onChange={(v) => patch({ rateMultiplier: Math.max(0.0625, v) })} step={0.25} />
            </Field>
          ) : (
            <Field label="Hz">
              <NumInput value={widget.rateHz} onChange={(v) => patch({ rateHz: Math.max(0.01, v) })} step={0.1} />
            </Field>
          )}
          <Field label="Speed">
            <select style={styles.input} value={String(widget.speed ?? 1)} onChange={(e) => patch({ speed: Number(e.target.value) })}>
              {[0.25, 0.5, 1, 2, 4].map((v) => <option key={v} value={v}>×{v}</option>)}
            </select>
          </Field>
        </Gate>
      </Section>
      <Section label="Shape">
        <Gate linked={linked.has(-3)}>
          <Field label="Amplitude">
            <NumInput value={widget.amplitude} onChange={(v) => patch({ amplitude: Math.max(0, Math.min(2, v)) })} step={0.01} />
          </Field>
        </Gate>
        <Field label="Center">
          <NumInput value={widget.center ?? 0.5} onChange={(v) => patch({ center: Math.max(0, Math.min(1, v)) })} step={0.01} />
        </Field>
        <Gate linked={linked.has(-5)}>
          <Field label={widget.waveform === 'noise' ? 'Roughness (−1 smooth … 1 rough)' : 'Bias'}>
            <NumInput value={widget.bias ?? 0} onChange={(v) => patch({ bias: Math.max(-1, Math.min(1, v)) })} step={0.05} />
          </Field>
        </Gate>
        {widget.waveform === 'noise' && (
          <Field label="Seed (same seed = same curve)">
            <div style={{ display: 'flex', gap: 6 }}>
              <div style={{ flex: 1 }}>
                <NumInput value={widget.seed ?? 0} onChange={(v) => patch({ seed: Math.max(0, Math.min(9999, Math.round(v))) })} step={1} />
              </div>
              <button title="New random seed" onClick={() => patch({ seed: 1 + Math.floor(Math.random() * 9999) })}
                style={{ padding: '0 10px', cursor: 'pointer', background: 'var(--color-surface-2)', color: 'var(--color-text)', border: '1px solid var(--color-border)', borderRadius: 3, fontFamily: 'inherit' }}>🎲</button>
            </div>
          </Field>
        )}
      </Section>
      <Section label="Phase">
        <Gate linked={linked.has(-4)}>
          <Field label="Offset (all)">
            <NumInput value={widget.offset} onChange={(v) => patch({ offset: Math.max(0, Math.min(1, v)) })} step={0.01} />
          </Field>
        </Gate>
        <Gate linked={linked.has(-6)}>
          <Field label="Phase (spread)">
            <NumInput value={widget.phase} onChange={(v) => patch({ phase: Math.max(0, Math.min(1, v)) })} step={0.01} />
          </Field>
        </Gate>
        <Gate linked={linked.has(-8)}>
          <Field label={`Quantize · ${quantLabel(widget.quantize ?? 0)}`}>
            <input type="range" min={0} max={1} step={0.01} value={widget.quantize ?? 0} style={{ width: '100%' }}
              onChange={(e) => patch({ quantize: Number(e.target.value) })} />
          </Field>
        </Gate>
        <div style={{ fontSize: 12, color: 'var(--color-text-dim)', marginTop: 6, lineHeight: 1.5 }}>
          Offset moves every output forward together (0.5 = half a cycle: a sine starts at the top). Phase spreads the outputs
          by index: output k of n is phase × k/(n−1) after the first — 0 = all identical, 0.5 with 4 outputs = 0, ⅙, ⅓, ½ of a cycle.
          Quantize: 0 = smooth; higher = the wave moves in fewer steps per cycle and holds still between them; at the end, one new value per cycle. Remote inputs: PLAY, FREQ (0.01–20 Hz, replaces mode and speed), AMP, OFFSET, BIAS, PHASE, RESET, QUANT. Link them with Shift (dots on the top edge),
          the Router page, or right-click the speed badge. A linked one is greyed here.
        </div>
      </Section>
      <Section label="Output">
        <MappingEditor mapping={widget.mapping} onChange={(m) => patch({ mapping: m })} />
      </Section>
      <Section label="Play Trigger">
        <TriggerField
          mapping={widget.playMapping ?? null}
          defaultAddress="/lfo/play"
          onChange={(m) => patch({ playMapping: m })}
        />
      </Section>
      <Section label="Stop Trigger">
        <TriggerField
          mapping={widget.stopMapping ?? null}
          defaultAddress="/lfo/stop"
          onChange={(m) => patch({ stopMapping: m })}
        />
      </Section>
      <Section label={`Outputs (${1 + (widget.lanes?.length ?? 0)})`}>
        <div style={{ fontSize: 12, color: 'var(--color-text-dim)', marginBottom: 6, lineHeight: 1.5 }}>
          ＋ adds an output with the same wave. Their phases come from Phase (spread by index), shown as φ on the widget.
        </div>
        {(widget.lanes ?? []).map((l, k) => (
          <Row key={l.id}>
            <div style={{ flex: 1, fontSize: 12, color: 'var(--color-text-dim)', alignSelf: 'center' }}>
              out {k + 2} · φ {(widget.phase * (k + 1) / (widget.lanes!.length)).toFixed(3)}
            </div>
            <button onClick={() => removeLane(widget, k)} title="Remove"
              style={{ background: 'none', border: '1px solid #333', color: pal('#d97a26'), cursor: 'pointer', borderRadius: 2, height: 28 }}>✕</button>
          </Row>
        ))}
        <button onClick={() => addLane(widget)} style={{ ...styles.input, cursor: 'pointer', marginTop: 4 }}>＋ Output</button>
      </Section>
    </>
  );
}

// ─── Master Level Inspector Panel ─────────────────────────────────────────────

// ─── DMX Recorder / Player ────────────────────────────────────────────────────

function PositionSection({ widget, activePageId, updateWidgetRect }: {
  widget: import('../../../../shared/types/project').Widget; activePageId: string; updateWidgetRect: StoreState['updateWidgetRect'];
}) {
  return (
    <Section label="Position">
      <Row>
        <Field label="X"><NumInput value={widget.rect.x} onChange={(v) => updateWidgetRect(activePageId, widget.id, { x: v })} /></Field>
        <Field label="Y"><NumInput value={widget.rect.y} onChange={(v) => updateWidgetRect(activePageId, widget.id, { y: v })} /></Field>
      </Row>
      <Row>
        <Field label="W"><NumInput value={widget.rect.width} onChange={(v) => updateWidgetRect(activePageId, widget.id, { width: v })} /></Field>
        <Field label="H"><NumInput value={widget.rect.height} onChange={(v) => updateWidgetRect(activePageId, widget.id, { height: v })} /></Field>
      </Row>
    </Section>
  );
}

// Every take on disk: rename in place, delete, and where the files live.
function PlaylistTakeSelect({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const takes = useTakes();
  return (
    <select style={{ ...styles.input, flex: 1, minWidth: 0 }} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">— take —</option>
      {takes.map((t) => <option key={t.id} value={t.id}>{t.name} · {fmtTime(t.durationMs)}</option>)}
      {value && !takes.some((t) => t.id === value) && <option value={value}>missing take</option>}
    </select>
  );
}

function TakesSection({ selectedId, onSelect }: { selectedId?: string; onSelect?: (id: string) => void }) {
  const takes = useTakes();
  const [folder, setFolder] = useState('');
  useEffect(() => {
    void refreshTakes();
    bridge.invoke('tr:dmxRec:getFolders', undefined).then((f) => setFolder(f ? (f.record === f.play ? f.record : `REC → ${f.record}\nPlayer ← ${f.play}`) : '')).catch(() => {});
  }, []);
  return (
    <Section label={`Takes (${takes.length})`}>
      {takes.length === 0 && <div style={{ fontSize: 12, color: 'var(--color-text-dim)' }}>No takes yet — hit REC on a Recorder.</div>}
      {takes.map((t) => (
        <div key={t.id} style={{
          display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4, padding: '2px 4px', borderRadius: 3,
          background: t.id === selectedId ? `rgba(${palRgb('#ff881f')},0.12)` : undefined,
        }}>
          {onSelect && (
            <input type="radio" checked={t.id === selectedId} onChange={() => onSelect(t.id)} title="Play this take" />
          )}
          <input style={{ ...styles.input, flex: 1, fontSize: 12 }} defaultValue={t.name}
            onBlur={(e) => { if (e.target.value !== t.name) void bridge.invoke('tr:dmxRec:rename', { takeId: t.id, name: e.target.value }).then(() => refreshTakes()); }}
            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
          <span style={{ fontSize: 11, color: '#888', whiteSpace: 'nowrap' }}>{fmtTime(t.durationMs)} · {fmtBytes(t.bytes)}</span>
          <button title="Delete take" onClick={() => { void bridge.invoke('tr:dmxRec:delete', { takeId: t.id }).then(() => refreshTakes()); }}
            style={{ background: 'none', border: 'none', color: pal('#d97a26'), cursor: 'pointer', fontSize: 13 }}>✕</button>
        </div>
      ))}
      {folder && <div style={{ fontSize: 11, color: 'var(--color-text-dim)', marginTop: 6, wordBreak: 'break-all', whiteSpace: 'pre-line' }}>{folder} · change in Settings → DMX recordings</div>}
    </Section>
  );
}

function DmxMonitorInspectorPanel({ widget, activePageId, updateWidget, updateWidgetRect }: {
  widget: import('../../../../shared/types/project').DmxMonitorWidget;
  activePageId: string;
  updateWidget: StoreState['updateWidget'];
  updateWidgetRect: StoreState['updateWidgetRect'];
}) {
  function patch(partial: Partial<import('../../../../shared/types/project').DmxMonitorWidget>) { updateWidget(activePageId, widget.id, partial as never); }
  const project = useProject();
  return (
    <>
      <div style={styles.header}>DMX Monitor</div>
      <Section label="Label">
        <input style={styles.input} value={widget.label} onChange={(e) => patch({ label: e.target.value })} />
      </Section>
      <PositionSection widget={widget} activePageId={activePageId} updateWidgetRect={updateWidgetRect} />
      <Section label="Source">
        <Row>
          <Field label="Direction">
            <select style={styles.input} value={widget.source} onChange={(e) => patch({ source: e.target.value as 'in' | 'out' })}>
              <option value="in">IN — what arrives</option>
              <option value="out">OUT — what Maestrale sends</option>
            </select>
          </Field>
          {(
            <Field label="Protocol">
              <select style={styles.input} value={widget.protocol} onChange={(e) => patch({ protocol: e.target.value as 'artnet' | 'sacn', outputId: '' })}>
                <option value="artnet">Art-Net</option>
                <option value="sacn">sACN / E1.31</option>
              </select>
            </Field>
          )}
        </Row>
        <Row>
          <Field label={widget.source === 'in' ? 'From (sender IP)' : 'To (destination)'}>
            <select style={styles.input}
              value={widget.source === 'in' ? (widget.sourceIp ?? '') : (widget.outputId ?? '')}
              onChange={(e) => patch(widget.source === 'in' ? { sourceIp: e.target.value } : { outputId: e.target.value })}>
              {(widget.source === 'in' ? monInOptions() : monOutOptions(project.connections, widget.protocol)).map((o) =>
                <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Field>
          <Field label="Universe"><NumInput value={widget.universe} min={0} max={32767} onChange={(v) => patch({ universe: Math.max(0, Math.min(32767, v)) })} /></Field>
        </Row>
        <div style={{ fontSize: 12, color: 'var(--color-text-dim)', marginTop: 6, lineHeight: 1.5 }}>
          IN lists every sender heard so far, plus localhost for apps on this PC (needs Settings → Art-Net / sACN → Input on;
          sACN listens to the universes listed there). OUT lists the Art-Net / sACN destinations set in Settings; "all outputs" merges them highest-wins.
        </div>
      </Section>
      <Section label="Grid">
        <Row>
          <Field label="Columns"><NumInput value={widget.cols} min={1} max={128} onChange={(v) => patch({ cols: Math.max(1, Math.min(128, v)) })} /></Field>
          <Field label="Rows"><NumInput value={widget.rows} min={1} max={128} onChange={(v) => patch({ rows: Math.max(1, Math.min(128, v)) })} /></Field>
        </Row>
        <div style={{ fontSize: 12, color: 'var(--color-text-dim)', marginTop: 6 }}>
          {widget.cols * widget.rows >= 512
            ? 'The whole universe fits.'
            : `${widget.cols * widget.rows} channels at a time — scroll with the bar on the right or the mouse wheel.`}
        </div>
      </Section>
    </>
  );
}

function ClockInspectorPanel({ widget, activePageId, updateWidget, updateWidgetRect }: {
  widget: import('../../../../shared/types/project').ClockWidget;
  activePageId: string;
  updateWidget: StoreState['updateWidget'];
  updateWidgetRect: StoreState['updateWidgetRect'];
}) {
  function patch(partial: Partial<import('../../../../shared/types/project').ClockWidget>) { updateWidget(activePageId, widget.id, partial as never); }
  return (
    <>
      <div style={styles.header}>Clock</div>
      <Section label="Label">
        <input style={styles.input} value={widget.label} onChange={(e) => patch({ label: e.target.value })} />
      </Section>
      <PositionSection widget={widget} activePageId={activePageId} updateWidgetRect={updateWidgetRect} />
      <Section label="Display">
        <Row>
          <Field label="Colour">
            <input type="color" value={widget.style.foregroundColor || pal('#ff902f')}
              onChange={(e) => patch({ style: { ...widget.style, foregroundColor: e.target.value } })} />
          </Field>
          <Field label="Seconds">
            <input type="checkbox" checked={widget.showSeconds} onChange={(e) => patch({ showSeconds: e.target.checked })} />
          </Field>
        </Row>
      </Section>
      <Section label="Triggers">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minHeight: 40 }}>
          <ClockAlarms widget={widget} />
        </div>
        <div style={{ fontSize: 12, color: 'var(--color-text-dim)', marginTop: 6, lineHeight: 1.5 }}>
          Each time fires every day when the computer's clock reaches it — a short pulse on that row's output.
          Link it from the Router page or with Shift (orange dot on the row).
        </div>
      </Section>
    </>
  );
}

function DmxRecorderInspectorPanel({ widget, activePageId, updateWidget, updateWidgetRect }: {
  widget: import('../../../../shared/types/project').DmxRecorderWidget;
  activePageId: string;
  updateWidget: StoreState['updateWidget'];
  updateWidgetRect: StoreState['updateWidgetRect'];
}) {
  function patch(partial: Partial<import('../../../../shared/types/project').DmxRecorderWidget>) { updateWidget(activePageId, widget.id, partial as never); }
  const parsed = parseUniverses(widget.universes ?? '');
  return (
    <>
      <div style={styles.header}>DMX Recorder</div>
      <Section label="Label">
        <input style={styles.input} value={widget.label} onChange={(e) => patch({ label: e.target.value })} />
      </Section>
      <PositionSection widget={widget} activePageId={activePageId} updateWidgetRect={updateWidgetRect} />
      <Section label="Source">
        <select style={styles.input} value={widget.source ?? 'artnet'} onChange={(e) => patch({ source: e.target.value as NonNullable<typeof widget.source> })}>
          <option value="artnet">IN — Art-Net input</option>
          <option value="sacn">IN — sACN input</option>
          <option value="out-artnet">OUT — what Maestrale sends on Art-Net</option>
          <option value="out-sacn">OUT — what Maestrale sends on sACN</option>
          <option value="out-enttec">OUT — what Maestrale sends on Open DMX (Enttec)</option>
        </select>
        <div style={{ fontSize: 12, color: 'var(--color-text-dim)', marginTop: 6, lineHeight: 1.5 }}>
          IN needs that input on in Settings (for sACN, the universes it listens to). OUT records Maestrale's own output —
          every widget, link, LFO and player merged — sampled 44 times a second, every universe in use (Open DMX = universe 0).
          A take holds one source.
        </div>
      </Section>
      <Section label="Universes">
        <input style={styles.input} placeholder="empty = every universe heard" value={widget.universes ?? ''}
          onChange={(e) => patch({ universes: e.target.value })} />
        <div style={{ fontSize: 12, color: 'var(--color-text-dim)', marginTop: 6, lineHeight: 1.5 }}>
          {parsed.length ? `Records ${parsed.join(', ')}.` : 'Records every Art-Net universe arriving.'} Comma list or ranges: 0, 1, 4-6.
          Needs Settings → Art-Net → Input on. REC is a cell: link it from the Router.
        </div>
      </Section>
      <TakesSection />
    </>
  );
}

function DmxPlayerInspectorPanel({ widget, activePageId, updateWidget, updateWidgetRect }: {
  widget: import('../../../../shared/types/project').DmxPlayerWidget;
  activePageId: string;
  updateWidget: StoreState['updateWidget'];
  updateWidgetRect: StoreState['updateWidgetRect'];
}) {
  function patch(partial: Partial<import('../../../../shared/types/project').DmxPlayerWidget>) { updateWidget(activePageId, widget.id, partial as never); }
  return (
    <>
      <div style={styles.header}>DMX Player</div>
      <Section label="Label">
        <input style={styles.input} value={widget.label} onChange={(e) => patch({ label: e.target.value })} />
      </Section>
      <PositionSection widget={widget} activePageId={activePageId} updateWidgetRect={updateWidgetRect} />
      <Section label="Output">
        <Row>
          <Field label="Protocol">
            <select style={styles.input} value={widget.playProtocol ?? 'artnet'} onChange={(e) => patch({ playProtocol: e.target.value as 'artnet' | 'sacn' })}>
              <option value="artnet">Art-Net</option>
              <option value="sacn">sACN / E1.31</option>
            </select>
          </Field>
          <Field label="Universe offset">
            <NumInput value={widget.universeOffset ?? 0} onChange={(v) => patch({ universeOffset: Math.max(-32767, Math.min(32767, v)) })} />
          </Field>
        </Row>
        <div style={{ fontSize: 12, color: 'var(--color-text-dim)', marginTop: 6, lineHeight: 1.5 }}>
          Goes out through the Art-Net / sACN connection in Settings — connect it there. Offset moves every
          recorded universe (recorded 0 with offset 4 plays on 4).
        </div>
      </Section>
      <Section label={`Playlist (${(widget.items ?? []).length})`}>
        <div style={{ fontSize: 12, color: 'var(--color-text-dim)', marginBottom: 6, lineHeight: 1.5 }}>
          Each item is a trigger: link it from a timeline, a clock time, a button, DMX, OSC… (right-click ▶ on the widget,
          Shift-patch, or the Router page). STOP / NEXT / PREV / FIRST are inputs too. ■ ⟳ ⇥ = at the end stop, loop, or play the next; fade in seconds.
        </div>
        {(widget.items ?? []).map((it, k) => (
          <Row key={it.id}>
            <span style={{ fontSize: 12, color: '#666', alignSelf: 'center', width: 18 }}>{k + 1}</span>
            <PlaylistTakeSelect value={it.takeId} onChange={(id) => patch({ items: widget.items.map((x, j) => (j === k ? { ...x, takeId: id } : x)) })} />
            <select style={{ ...styles.input, width: 78 }} value={it.end} onChange={(e) => patch({ items: widget.items.map((x, j) => (j === k ? { ...x, end: e.target.value as 'stop' | 'loop' | 'next' } : x)) })}>
              <option value="stop">■ stop</option><option value="loop">⟳ loop</option><option value="next">⇥ next</option>
            </select>
            <div style={{ width: 64 }}><NumInput value={it.fade ?? 0} step={0.5} onChange={(v) => patch({ items: widget.items.map((x, j) => (j === k ? { ...x, fade: Math.max(0, v) } : x)) })} /></div>
            <button onClick={() => { useStore.getState().dropCellAndShiftLinks(widget.id, k); patch({ items: widget.items.filter((_, j) => j !== k) }); }}
              style={{ background: 'none', border: '1px solid #333', color: pal('#de8b43'), cursor: 'pointer', borderRadius: 2, height: 28 }}>✕</button>
          </Row>
        ))}
        <button onClick={() => patch({ items: [...(widget.items ?? []), { id: crypto.randomUUID(), takeId: '', end: 'stop', fade: 0 }] })}
          style={{ ...styles.input, cursor: 'pointer', marginTop: 4 }}>＋ Item</button>
      </Section>
      <TakesSection />
    </>
  );
}

function SketchInspectorPanel({ widget, activePageId, updateWidget, updateWidgetRect }: {
  widget: import('../../../../shared/types/project').SketchWidget;
  activePageId: string;
  updateWidget: StoreState['updateWidget'];
  updateWidgetRect: StoreState['updateWidgetRect'];
}) {
  function patch(p: Partial<import('../../../../shared/types/project').SketchWidget>) { updateWidget(activePageId, widget.id, p as never); }
  const linked = useLinkedInputs(widget.id);
  return (
    <>
      <div style={styles.header}>Sketch</div>
      <Section label="Label">
        <input style={styles.input} value={widget.label} onChange={(e) => patch({ label: e.target.value })} />
      </Section>
      <PositionSection widget={widget} activePageId={activePageId} updateWidgetRect={updateWidgetRect} />
      <Section label="Drawing preset">
        <SketchPresetBar w={widget} pageId={activePageId} />
      </Section>
      <Section label="Transport">
        <TransportButtons widgetId={widget.id} playLinked={linked.has(-1)} resetLinked={linked.has(-3)} />
        <div style={{ height: 6 }} />
        <Row>
          <Field label="Seconds per run"><NumInput value={widget.duration} step={0.5} onChange={(v) => patch({ duration: Math.max(0.1, v) })} /></Field>
          <Gate linked={linked.has(-2)}>
            <Field label="Speed">
              <select style={styles.input} value={String(widget.speed ?? 1)} onChange={(e) => patch({ speed: Number(e.target.value) })}>
                {GEN_SPEEDS.map((v) => <option key={v} value={v}>{v < 1 ? `1/${1 / v}` : `${v}x`}</option>)}
              </select>
            </Field>
          </Gate>
        </Row>
        <div style={{ display: 'flex', gap: 12, marginTop: 6 }}>
          {([['stop', 'Stop at the end', { loop: false, pingPong: false }], ['loop', 'Loop', { loop: true, pingPong: false }], ['ping', 'Ping-pong', { loop: true, pingPong: true }]] as const).map(([k, label, p]) => (
            <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 13, color: '#ccc', cursor: 'pointer' }}>
              <input type="radio" name={`sketch-mode-${widget.id}`} checked={(!widget.loop ? 'stop' : widget.pingPong ? 'ping' : 'loop') === k} onChange={() => patch(p)} /> {label}
            </label>
          ))}
        </div>
      </Section>
      <Section label="Dots">
        <Row>
          <Field label="How many"><NumInput value={widget.dots} min={1} max={32} onChange={(v) => patch({ dots: Math.max(1, Math.min(32, Math.round(v))) })} /></Field>
          <Field label="Delay"><NumInput value={widget.delay} step={0.01} onChange={(v) => patch({ delay: Math.max(0, Math.min(1, v)) })} /></Field>
        </Row>
        <div style={{ fontSize: 12, color: 'var(--color-text-dim)', marginTop: 6, lineHeight: 1.5 }}>
          Delay = distance between one dot and the next, as a part of the whole drawing (0.1 = a tenth behind).
          Dot k puts out X and Y on its own two cells (Y up, like the XY pad): link them to pan / tilt, or to an XY pad's dots to see them.
        </div>
      </Section>
      <Section label="Drawing">
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#ccc', cursor: 'pointer' }}>
          <input type="checkbox" checked={widget.showGrid} onChange={(e) => patch({ showGrid: e.target.checked })} /> Background grid
        </label>
        <Field label={`Smooth ${Math.round((widget.smooth ?? 0) * 100)}%`}>
          <input type="range" min={0} max={1} step={0.01} value={widget.smooth ?? 0} onChange={(e) => patch({ smooth: Number(e.target.value) })} style={{ width: '100%' }} />
        </Field>
        <div style={{ fontSize: 12, color: 'var(--color-text-dim)', marginTop: 6, lineHeight: 1.5 }}>
          {(widget.strokes ?? []).length} line(s). Draw in Live; lines play one after the other in the order drawn. Alt+click a line to delete it.
        </div>
        <button onClick={() => patch({ strokes: [] })} style={{ ...styles.input, cursor: 'pointer', marginTop: 6, color: pal('#e39d60') }}>Clear drawing</button>
      </Section>
    </>
  );
}

function EtcInspectorPanel({ widget, activePageId, updateWidget, updateWidgetRect }: {
  widget: import('../../../../shared/types/project').EtcWidget;
  activePageId: string;
  updateWidget: StoreState['updateWidget'];
  updateWidgetRect: StoreState['updateWidgetRect'];
}) {
  function patch(p: Partial<import('../../../../shared/types/project').EtcWidget>) { updateWidget(activePageId, widget.id, p as never); }
  return (
    <>
      <div style={styles.header}>ETC</div>
      <Section label="Label">
        <input style={styles.input} value={widget.label} onChange={(e) => patch({ label: e.target.value })} />
      </Section>
      <PositionSection widget={widget} activePageId={activePageId} updateWidgetRect={updateWidgetRect} />
      <Section label="Eos OSC">
        <EtcSettings w={widget} update={patch} />
      </Section>
    </>
  );
}

function EncoderInspectorPanel({ widget, activePageId, updateWidget, updateWidgetRect }: {
  widget: import('../../../../shared/types/project').EncoderWidget;
  activePageId: string;
  updateWidget: StoreState['updateWidget'];
  updateWidgetRect: StoreState['updateWidgetRect'];
}) {
  function patch(p: Partial<import('../../../../shared/types/project').EncoderWidget>) { updateWidget(activePageId, widget.id, p as never); }
  return (
    <>
      <div style={styles.header}>Encoder</div>
      <Section label="Label">
        <input style={styles.input} value={widget.label} onChange={(e) => patch({ label: e.target.value })} />
      </Section>
      <PositionSection widget={widget} activePageId={activePageId} updateWidgetRect={updateWidgetRect} />
      <Section label="Encoders">
        <EncoderSettings w={widget} update={patch} />
      </Section>
    </>
  );
}

function AudioLevelInspectorPanel({ widget, activePageId, updateWidget, updateWidgetRect }: {
  widget: import('../../../../shared/types/project').AudioLevelWidget;
  activePageId: string;
  updateWidget: StoreState['updateWidget'];
  updateWidgetRect: StoreState['updateWidgetRect'];
}) {
  function patch(p: Partial<import('../../../../shared/types/project').AudioLevelWidget>) { updateWidget(activePageId, widget.id, p as never); }
  const [inputs, setInputs] = useState<MediaDeviceInfo[]>([]);
  useEffect(() => {
    navigator.mediaDevices?.enumerateDevices().then((d) => setInputs(d.filter((x) => x.kind === 'audioinput'))).catch(() => {});
  }, []);
  return (
    <>
      <div style={styles.header}>Audio Level</div>
      <Section label="Label">
        <input style={styles.input} value={widget.label} onChange={(e) => patch({ label: e.target.value })} />
      </Section>
      <PositionSection widget={widget} activePageId={activePageId} updateWidgetRect={updateWidgetRect} />
      <Section label="Mode">
        <select style={styles.input} value={widget.mode} onChange={(e) => patch({ mode: e.target.value as 'in' | 'out' })}>
          <option value="out">OUT — master volume of all audio played</option>
          <option value="in">IN — level meter of an audio input</option>
        </select>
        {widget.mode === 'in' && (
          <Field label="Input device">
            <select style={styles.input} value={widget.deviceId ?? ''} onChange={(e) => patch({ deviceId: e.target.value })}>
              <option value="">Settings → Audio in (or the default)</option>
              {inputs.map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || d.deviceId}</option>)}
            </select>
          </Field>
        )}
        <Field label="Orientation">
          <select style={styles.input} value={widget.orientation ?? 'vertical'} onChange={(e) => patch({ orientation: e.target.value as 'vertical' | 'horizontal' })}>
            <option value="vertical">Vertical</option>
            <option value="horizontal">Horizontal</option>
          </select>
        </Field>
        <div style={{ fontSize: 12, color: 'var(--color-text-dim)', marginTop: 6, lineHeight: 1.5 }}>
          OUT scales every Sound Player track and every timeline audio track, from any page; its fader is a cell, so a
          MIDI fader, OSC or the Router can drive it. IN measures the input (−60…0 dB as 0…1) and outputs it as a cell:
          link it to a dimmer, an LFO's AMP, a button… It runs in Live.
        </div>
      </Section>
    </>
  );
}

function MasterLevelInspectorPanel({ widget, activePageId, updateWidget, updateWidgetRect }: {
  widget: import('../../../../shared/types/project').MasterLevelWidget;
  activePageId: string;
  updateWidget: StoreState['updateWidget'];
  updateWidgetRect: StoreState['updateWidgetRect'];
}) {
  function patch(partial: Partial<import('../../../../shared/types/project').MasterLevelWidget>) { updateWidget(activePageId, widget.id, partial as never); }

  return (
    <>
      <div style={styles.header}>Master Level</div>
      <Section label="Label">
        <input style={styles.input} value={widget.label} onChange={(e) => patch({ label: e.target.value })} />
      </Section>
      <Section label="Position">
        <Row>
          <Field label="X"><NumInput value={widget.rect.x} onChange={(v) => updateWidgetRect(activePageId, widget.id, { x: v })} /></Field>
          <Field label="Y"><NumInput value={widget.rect.y} onChange={(v) => updateWidgetRect(activePageId, widget.id, { y: v })} /></Field>
        </Row>
        <Row>
          <Field label="W"><NumInput value={widget.rect.width} onChange={(v) => updateWidgetRect(activePageId, widget.id, { width: v })} /></Field>
          <Field label="H"><NumInput value={widget.rect.height} onChange={(v) => updateWidgetRect(activePageId, widget.id, { height: v })} /></Field>
        </Row>
      </Section>
      <Section label="Scales protocol">
        <select
          style={styles.input}
          value={widget.protocol}
          onChange={(e) => patch({ protocol: e.target.value as import('../../../../shared/types/project').OutputProtocol })}
        >
          <option value="midi">MIDI</option>
          <option value="osc">OSC</option>
          <option value="enttec">Enttec Open DMX USB</option>
          <option value="artnet">Art-Net (DMX)</option>
          <option value="sacn">sACN / E1.31 (DMX)</option>
        </select>
        <div style={{ fontSize: 12, color: 'var(--color-text-dim)', marginTop: 6 }}>
          Multiplies every value sent on this protocol (0 = silence, 100% = full).
        </div>
      </Section>
      <Section label="Orientation">
        <select
          style={styles.input}
          value={widget.orientation ?? 'vertical'}
          onChange={(e) => patch({ orientation: e.target.value as 'vertical' | 'horizontal' })}
        >
          <option value="vertical">Vertical</option>
          <option value="horizontal">Horizontal</option>
        </select>
      </Section>
    </>
  );
}

// ─── Keyboard Inspector Panel ─────────────────────────────────────────────────

function KeyboardInspectorPanel({ widget, activePageId, updateWidget, updateWidgetRect }: {
  widget: import('../../../../shared/types/project').KeyboardWidget;
  activePageId: string;
  updateWidget: StoreState['updateWidget'];
  updateWidgetRect: StoreState['updateWidgetRect'];
}) {
  type KeyBinding = import('../../../../shared/types/project').KeyBinding;
  const [capturing, setCapturing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function patch(partial: Partial<import('../../../../shared/types/project').KeyboardWidget>) {
    updateWidget(activePageId, widget.id, partial as never);
  }
  function patchKey(i: number, p: Partial<KeyBinding>) {
    patch({ keys: widget.keys.map((k, j) => (j === i ? { ...k, ...p } : k)) });
  }

  // Capture the next physical key. Listening on the window (capture phase) is
  // what lets us grab keys the focused control would otherwise swallow.
  useEffect(() => {
    if (!capturing) return;
    function onKey(e: KeyboardEvent) {
      e.preventDefault();
      e.stopPropagation();
      if (e.code === 'Escape') { setCapturing(false); return; }
      if (RESERVED_CODES.has(e.code)) {
        setError(`${e.code} is used by the app — pick another key`);
        setCapturing(false);
        return;
      }
      if (widget.keys.some((k) => k.code === e.code)) {
        setError(`${keyCapLabel(e.code)} is already bound`);
        setCapturing(false);
        return;
      }
      const base = nextFreeCc(useStore.getState().project.pages.flatMap((p) => p.widgets));
      const nk: KeyBinding = {
        id: crypto.randomUUID(),
        code: e.code,
        label: keyCapLabel(e.code),
        behavior: 'momentary',
        onValue: 127,
        offValue: 0,
        mapping: { type: 'midi', messageType: 'controlChange', channel: 1, number: base % 128, minValue: 0, maxValue: 127 },
        feedbackRules: [],
      };
      setError(null);
      setCapturing(false);
      patch({ keys: [...widget.keys, nk] });
    }
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [capturing, widget.keys]);

  return (
    <>
      <div style={styles.header}>Keyboard</div>
      <Section label="Label">
        <input style={styles.input} value={widget.label} onChange={(e) => patch({ label: e.target.value })} />
      </Section>
      <Section label="Position">
        <Row>
          <Field label="X"><NumInput value={widget.rect.x} onChange={(v) => updateWidgetRect(activePageId, widget.id, { x: v })} /></Field>
          <Field label="Y"><NumInput value={widget.rect.y} onChange={(v) => updateWidgetRect(activePageId, widget.id, { y: v })} /></Field>
        </Row>
        <Row>
          <Field label="W"><NumInput value={widget.rect.width} onChange={(v) => updateWidgetRect(activePageId, widget.id, { width: v })} /></Field>
          <Field label="H"><NumInput value={widget.rect.height} onChange={(v) => updateWidgetRect(activePageId, widget.id, { height: v })} /></Field>
        </Row>
      </Section>

      <Section label="Layout">
        <Field label="Keys per row"><NumInput value={widget.countX} min={1} max={16}
          onChange={(v) => patch({ countX: Math.max(1, Math.min(16, v)) })} /></Field>
        <Row>
          <Field label="Gap X"><NumInput value={widget.spacingX} onChange={(v) => patch({ spacingX: Math.max(0, v) })} /></Field>
          <Field label="Gap Y"><NumInput value={widget.spacingY} onChange={(v) => patch({ spacingY: Math.max(0, v) })} /></Field>
        </Row>
      </Section>

      <Section label={`Keys (${widget.keys.length})`}>
        <button
          onClick={() => { setError(null); setCapturing((v) => !v); }}
          style={{
            ...styles.input, minHeight: 44, cursor: 'pointer', fontWeight: 700,
            background: capturing ? pal('#3a291a') : 'var(--color-surface-2)',
            color: capturing ? pal('#ff963a') : 'var(--color-text)',
            border: `1px solid ${capturing ? pal('#ff963a') : 'var(--color-border)'}`,
          }}
        >
          {capturing ? '⬤ press a key…  (Esc cancels)' : '＋ Add key'}
        </button>
        {error && <div style={{ fontSize: 12, color: pal('#de8b43'), marginTop: 6 }}>{error}</div>}

        <div style={{ marginTop: 10 }}>
          {widget.keys.length === 0 && (
            <div style={{ fontSize: 12, color: 'var(--color-text-dim)' }}>
              No keys yet. Add one, then right-click it in Live mode to link it.
            </div>
          )}
          {widget.keys.map((k, i) => (
            <div key={k.id} style={{
              border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)',
              padding: 10, marginBottom: 8,
            }}>
              <div style={{
                fontSize: 15, fontWeight: 700, fontFamily: 'monospace',
                color: 'var(--color-accent)', marginBottom: 8,
              }}>
                ⌨ {keyCapLabel(k.code)}
                <span style={{ fontSize: 12, color: 'var(--color-text-dim)', fontWeight: 400 }}>  · {k.code}</span>
              </div>
              <Field label="Name">
                <input style={styles.input} value={k.label}
                  onChange={(e) => patchKey(i, { label: e.target.value })} />
              </Field>
              <Field label="Behavior">
                <select style={styles.input} value={k.behavior ?? 'momentary'}
                  onChange={(e) => patchKey(i, { behavior: e.target.value as import('../../../../shared/types/project').ButtonBehavior })}>
                  <option value="momentary">Momentary — 1 while held</option>
                  <option value="pulse">Pulse — short trig</option>
                  <option value="toggle">Toggle — press flips</option>
                  <option value="radio">Radio — one at a time</option>
                </select>
              </Field>
              <Row>
                <Field label="On value"><NumInput value={k.onValue ?? 127} min={0} max={127}
                  onChange={(v) => patchKey(i, { onValue: v })} /></Field>
                <Field label="Off value"><NumInput value={k.offValue ?? 0} min={0} max={127}
                  onChange={(v) => patchKey(i, { offValue: v })} /></Field>
              </Row>
              <Field label="Colour">
                <ColorInput value={k.color ?? widget.style.foregroundColor}
                  onChange={(v) => patchKey(i, { color: v })} />
              </Field>
              <MappingEditor
                mapping={k.mapping}
                onChange={(m) => patchKey(i, { mapping: m })}
              />
              <button
                onClick={() => patch({ keys: widget.keys.filter((_, j) => j !== i) })}
                style={{ ...styles.input, minHeight: 40, cursor: 'pointer', marginTop: 8,
                         background: 'var(--color-surface)', color: 'var(--color-text-dim)' }}>
                − Remove key
              </button>
            </div>
          ))}
        </div>
        <div style={{ fontSize: 12, color: 'var(--color-text-dim)', marginTop: 6, lineHeight: 1.6 }}>
          Keys work in Live mode, and only when you are not typing in a field.
          Each key is also a cell: right-click it in Live to link or Learn.
        </div>
      </Section>
    </>
  );
}

// ─── Manual Inspector Panel ───────────────────────────────────────────────────

function ManualInspectorPanel({ widget, activePageId, updateWidget, updateWidgetRect }: {
  widget: import('../../../../shared/types/project').ManualWidget;
  activePageId: string;
  updateWidget: StoreState['updateWidget'];
  updateWidgetRect: StoreState['updateWidgetRect'];
}) {
  function patch(partial: Partial<import('../../../../shared/types/project').ManualWidget>) { updateWidget(activePageId, widget.id, partial as never); }

  return (
    <>
      <div style={styles.header}>Manual</div>
      <Section label="Label">
        <input style={styles.input} value={widget.label} onChange={(e) => patch({ label: e.target.value })} />
      </Section>
      <Section label="Position">
        <Row>
          <Field label="X"><NumInput value={widget.rect.x} onChange={(v) => updateWidgetRect(activePageId, widget.id, { x: v })} /></Field>
          <Field label="Y"><NumInput value={widget.rect.y} onChange={(v) => updateWidgetRect(activePageId, widget.id, { y: v })} /></Field>
        </Row>
        <Row>
          <Field label="W"><NumInput value={widget.rect.width} onChange={(v) => updateWidgetRect(activePageId, widget.id, { width: v })} /></Field>
          <Field label="H"><NumInput value={widget.rect.height} onChange={(v) => updateWidgetRect(activePageId, widget.id, { height: v })} /></Field>
        </Row>
      </Section>
      <Section label="Text size">
        <NumInput value={widget.fontScale ?? 1} min={0.6} max={2} step={0.1}
          onChange={(v) => patch({ fontScale: Math.max(0.6, Math.min(2, v)) })} />
        <div style={{ fontSize: 12, color: 'var(--color-text-dim)', marginTop: 6 }}>
          Multiplies the body text. Everything else scales with it.
        </div>
      </Section>
      <Section label="Open tab">
        <select style={styles.input} value={widget.openTab ?? 'project'}
          onChange={(e) => patch({ openTab: e.target.value })}>
          <optgroup label="Settings">
            {MANUAL_SETTINGS_ENTRIES.map((e) => <option key={e.id} value={e.id}>{e.tab}</option>)}
          </optgroup>
          <optgroup label="Widgets">
            {MANUAL_WIDGET_ENTRIES.map((e) => <option key={e.id} value={e.id}>{e.tab}</option>)}
          </optgroup>
        </select>
        <div style={{ fontSize: 12, color: 'var(--color-text-dim)', marginTop: 6 }}>
          Which tab it shows when the project loads. Tabs are clickable in Live mode.
        </div>
      </Section>
    </>
  );
}

// ─── Instance Inspector Panel ─────────────────────────────────────────────────

function InstanceInspectorPanel({ widget, activePageId, updateWidget, updateWidgetRect }: {
  widget: import('../../../../shared/types/project').InstanceWidget;
  activePageId: string;
  updateWidget: StoreState['updateWidget'];
  updateWidgetRect: StoreState['updateWidgetRect'];
}) {
  const project = useStore((s) => s.project);
  // Widgets you play by hand — mirroring a generator or a player would run it twice.
  const sources = project.pages.flatMap((p) => p.widgets).filter((w) => w.id !== widget.id && INSTANCE_KINDS.has(w.kind));
  function patch(partial: Partial<import('../../../../shared/types/project').InstanceWidget>) { updateWidget(activePageId, widget.id, partial as never); }

  return (
    <>
      <div style={styles.header}>Instance</div>
      <Section label="Label">
        <input style={styles.input} value={widget.label} onChange={(e) => patch({ label: e.target.value })} />
      </Section>
      <Section label="Position">
        <Row>
          <Field label="X"><NumInput value={widget.rect.x} onChange={(v) => updateWidgetRect(activePageId, widget.id, { x: v })} /></Field>
          <Field label="Y"><NumInput value={widget.rect.y} onChange={(v) => updateWidgetRect(activePageId, widget.id, { y: v })} /></Field>
        </Row>
        <Row>
          <Field label="W"><NumInput value={widget.rect.width} onChange={(v) => updateWidgetRect(activePageId, widget.id, { width: v })} /></Field>
          <Field label="H"><NumInput value={widget.rect.height} onChange={(v) => updateWidgetRect(activePageId, widget.id, { height: v })} /></Field>
        </Row>
      </Section>
      <Section label="Source widget">
        <select
          style={styles.input}
          value={widget.sourceWidgetId}
          onChange={(e) => patch({ sourceWidgetId: e.target.value })}
        >
          <option value="">— none —</option>
          {sources.map((w) => <option key={w.id} value={w.id}>{w.label} ({w.kind})</option>)}
        </select>
        <div style={{ fontSize: 12, color: 'var(--color-text-dim)', marginTop: 6 }}>
          Mirrors this widget's value — control it from the source or any instance.
        </div>
      </Section>
    </>
  );
}

// ─── Math Inspector Panel ─────────────────────────────────────────────────────

function MathInspectorPanel({ widget, activePageId, updateWidget, updateWidgetRect }: {
  widget: MathWidget;
  activePageId: string;
  updateWidget: StoreState['updateWidget'];
  updateWidgetRect: StoreState['updateWidgetRect'];
}) {
  const page = useActivePage();
  const widgetOptions = page?.widgets.filter((w) => w.id !== widget.id && isLinkSource(w)) ?? [];
  function patch(partial: Partial<MathWidget>) { updateWidget(activePageId, widget.id, partial as never); }

  const usesB = ['add', 'subtract', 'multiply', 'min', 'max', 'avg'].includes(widget.operation);

  // Cells are listed by their real name (S1.1, cue names, track names…) — "Cell 0"
  // told you nothing about what you were picking.
  function cellOptions(widgetId: string): { index: number; label: string }[] {
    const w = page?.widgets.find((x) => x.id === widgetId);
    if (!w) return [];
    return Array.from({ length: getCellCount(w) }, (_, i) => ({ index: i, label: cellLabel(w, i) }));
  }

  return (
    <>
      <div style={styles.header}>Math / Merge</div>
      <Section label="Position">
        <Row>
          <Field label="X"><NumInput value={widget.rect.x} onChange={(v) => updateWidgetRect(activePageId, widget.id, { x: v })} /></Field>
          <Field label="Y"><NumInput value={widget.rect.y} onChange={(v) => updateWidgetRect(activePageId, widget.id, { y: v })} /></Field>
        </Row>
        <Row>
          <Field label="W"><NumInput value={widget.rect.width} onChange={(v) => updateWidgetRect(activePageId, widget.id, { width: v })} /></Field>
          <Field label="H"><NumInput value={widget.rect.height} onChange={(v) => updateWidgetRect(activePageId, widget.id, { height: v })} /></Field>
        </Row>
      </Section>
      <Section label="Source A">
        <Field label="Widget">
          <select style={styles.input} value={widget.sourceAWidgetId}
            onChange={(e) => patch({ sourceAWidgetId: e.target.value, sourceACellIndex: 0 })}>
            <option value="">— none —</option>
            {widgetOptions.map((w) => <option key={w.id} value={w.id}>{w.label} ({w.kind})</option>)}
          </select>
        </Field>
        <Field label="Cell">
          <select style={styles.input} value={widget.sourceACellIndex}
            onChange={(e) => patch({ sourceACellIndex: Number(e.target.value) })}>
            {cellOptions(widget.sourceAWidgetId).map((c) => <option key={c.index} value={c.index}>{c.label}</option>)}
          </select>
        </Field>
      </Section>
      <Section label="Operation">
        <select style={styles.input} value={widget.operation}
          onChange={(e) => patch({ operation: e.target.value as MathOperation })}>
          <option value="add">A + B</option>
          <option value="subtract">A − B</option>
          <option value="multiply">A × B</option>
          <option value="min">min(A, B)</option>
          <option value="max">max(A, B)</option>
          <option value="avg">avg(A, B)</option>
          <option value="invert">1 − A</option>
          <option value="abs">abs(A)</option>
        </select>
      </Section>
      {usesB && (
        <Section label="Source B">
          <Field label="Widget">
            <select style={styles.input} value={widget.sourceBWidgetId}
              onChange={(e) => patch({ sourceBWidgetId: e.target.value, sourceBCellIndex: 0 })}>
              <option value="">— none —</option>
              {widgetOptions.map((w) => <option key={w.id} value={w.id}>{w.label} ({w.kind})</option>)}
            </select>
          </Field>
          <Field label="Cell">
            <select style={styles.input} value={widget.sourceBCellIndex}
              onChange={(e) => patch({ sourceBCellIndex: Number(e.target.value) })}>
              {cellOptions(widget.sourceBWidgetId).map((c) => <option key={c.index} value={c.index}>{c.label}</option>)}
            </select>
          </Field>
        </Section>
      )}
      <Section label="Input range">
        <div style={{ fontSize: 12, color: 'var(--color-text-dim)', marginBottom: 6 }}>
          The span the operation result is read against.
        </div>
        <Row>
          <Field label="Min"><NumInput value={widget.inMin ?? 0} onChange={(v) => patch({ inMin: v })} step={0.01} /></Field>
          <Field label="Max"><NumInput value={widget.inMax ?? 1} onChange={(v) => patch({ inMax: v })} step={0.01} /></Field>
        </Row>
      </Section>
      <Section label="Output range">
        <div style={{ fontSize: 12, color: 'var(--color-text-dim)', marginBottom: 6 }}>
          Where it lands. Put Max below Min to invert.
        </div>
        <Row>
          <Field label="Min"><NumInput value={widget.outMin ?? 0} onChange={(v) => patch({ outMin: v })} step={0.01} /></Field>
          <Field label="Max"><NumInput value={widget.outMax ?? 1} onChange={(v) => patch({ outMax: v })} step={0.01} /></Field>
        </Row>
      </Section>
      <Section label="Clamp">
        <Field label="Clamp 0–1">
          <button
            style={styles.input}
            onPointerDown={(e) => { e.preventDefault(); patch({ clampOutput: !widget.clampOutput }); }}
          >
            {widget.clampOutput ? '⬤ On' : '◎ Off'}
          </button>
        </Field>
      </Section>
      <Section label="Output">
        <MappingEditor mapping={widget.mapping} onChange={(m) => patch({ mapping: m })} />
      </Section>
    </>
  );
}

function getCellCount(w: import('../../../../shared/types/project').Widget): number {
  if ('cells' in w && Array.isArray(w.cells)) return w.cells.length;
  if (w.kind === 'xyPad') return 2;
  if (w.kind === 'autoBpm') return 16;
  if (w.kind === 'lfoWidget' || w.kind === 'noiseWidget' || w.kind === 'mathWidget') return 1;
  if (w.kind === 'graphWidget' || w.kind === 'stepSequencer') return 1;
  return 0;
}

// ─── Value Display Inspector Panel ────────────────────────────────────────────

function ValueDisplayInspectorPanel({ widget, activePageId, updateWidget, updateWidgetRect }: {
  widget: ValueDisplayWidget;
  activePageId: string;
  updateWidget: StoreState['updateWidget'];
  updateWidgetRect: StoreState['updateWidgetRect'];
}) {
  // Sources span every page — the runtime is global, so a cross-page readout works.
  const project = useStore((s) => s.project);
  const allWidgets = project.pages.flatMap((p) => p.widgets);
  const widgetOptions = allWidgets.filter((w) => w.id !== widget.id && isLinkSource(w));
  function patch(partial: Partial<ValueDisplayWidget>) { updateWidget(activePageId, widget.id, partial as never); }

  function cellOptions(widgetId: string): { index: number; label: string }[] {
    const w = allWidgets.find((x) => x.id === widgetId);
    if (!w) return [];
    return Array.from({ length: getCellCount(w) }, (_, i) => ({ index: i, label: cellLabel(w, i) }));
  }

  return (
    <>
      <div style={styles.header}>Value Display</div>
      <Section label="Label">
        <input style={styles.input} value={widget.label} onChange={(e) => patch({ label: e.target.value })} />
      </Section>
      <Section label="Position">
        <Row>
          <Field label="X"><NumInput value={widget.rect.x} onChange={(v) => updateWidgetRect(activePageId, widget.id, { x: v })} /></Field>
          <Field label="Y"><NumInput value={widget.rect.y} onChange={(v) => updateWidgetRect(activePageId, widget.id, { y: v })} /></Field>
        </Row>
        <Row>
          <Field label="W"><NumInput value={widget.rect.width} onChange={(v) => updateWidgetRect(activePageId, widget.id, { width: v })} /></Field>
          <Field label="H"><NumInput value={widget.rect.height} onChange={(v) => updateWidgetRect(activePageId, widget.id, { height: v })} /></Field>
        </Row>
      </Section>
      <Section label="Source">
        <Field label="Widget">
          <select style={styles.input} value={widget.sourceWidgetId}
            onChange={(e) => patch({ sourceWidgetId: e.target.value, sourceCellIndex: 0 })}>
            <option value="">— none —</option>
            {widgetOptions.map((w) => <option key={w.id} value={w.id}>{w.label} ({w.kind})</option>)}
          </select>
        </Field>
        <Field label="Cell">
          <select style={styles.input} value={widget.sourceCellIndex}
            onChange={(e) => patch({ sourceCellIndex: Number(e.target.value) })}>
            {cellOptions(widget.sourceWidgetId).map((c) => <option key={c.index} value={c.index}>{c.label}</option>)}
          </select>
        </Field>
      </Section>
      <Section label="Display">
        <Field label="Format">
          <select style={styles.input} value={widget.displayFormat}
            onChange={(e) => patch({ displayFormat: e.target.value as ValueDisplayFormat })}>
            <option value="percent">Percent (0–100%)</option>
            <option value="raw">Raw (0.000–1.000)</option>
            <option value="midi">MIDI (0–127)</option>
          </select>
        </Field>
        <Field label="Decimals">
          <NumInput value={widget.decimals} onChange={(v) => patch({ decimals: Math.max(0, Math.min(3, Math.round(v))) })} />
        </Field>
      </Section>
      <Section label="Style">
        <Field label="Font size">
          <NumInput value={widget.style.fontSize} onChange={(v) => patch({ style: { ...widget.style, fontSize: Math.max(8, v) } })} />
        </Field>
        <Field label="Color">
          <ColorInput value={widget.style.foregroundColor} onChange={(c) => patch({ style: { ...widget.style, foregroundColor: c } })} />
        </Field>
        <Field label="BG color">
          <ColorInput value={widget.style.backgroundColor} onChange={(c) => patch({ style: { ...widget.style, backgroundColor: c } })} />
        </Field>
        <Field label="Show label">
          <button style={styles.input} onPointerDown={(e) => { e.preventDefault(); patch({ style: { ...widget.style, showLabel: !widget.style.showLabel } }); }}>
            {widget.style.showLabel ? '⬤ On' : '◎ Off'}
          </button>
        </Field>
      </Section>
    </>
  );
}

const styles: Record<string, React.CSSProperties> = {
  panel: {
    // Wide enough that a full IPv4 address is readable in one field.
    width: 300,
    flexShrink: 0,
    background: 'var(--color-surface)',
    borderLeft: '1px solid var(--color-border)',
    padding: 16,
    overflowY: 'auto',
  },
  header: {
    fontSize: 15, fontWeight: 600,
    marginBottom: 16,
    color: 'var(--color-accent)',
    textTransform: 'capitalize',
  },
  input: {
    width: '100%',
    background: 'var(--color-surface-2)',
    border: '1px solid var(--color-border)',
    color: 'var(--color-text)',
    borderRadius: 'var(--radius-sm)',
    // Tall enough to be a comfortable touch target, not just a mouse one.
    padding: '7px 9px',
    fontSize: 14,
    boxSizing: 'border-box',
  },
  note: {
    fontSize: 12,
    color: 'var(--color-text-dim)',
    fontStyle: 'italic',
    marginBottom: 6,
  },
  pill: {
    display: 'inline-block',
    fontSize: 12,
    padding: '2px 8px',
    borderRadius: 10,
    background: 'var(--color-surface-2)',
    border: '1px solid var(--color-border)',
    color: 'var(--color-text-dim)',
    marginRight: 4,
    marginBottom: 4,
  },
};


// ─── Transport trigger row ────────────────────────────────────────────────────
// Play and Stop, sharing one block. Tap and Reset predate it and are still
// written out longhand above.

function TransportTrigger({ label, hint, mapping, set, type, onType }: {
  label: string;
  hint: string;
  mapping: Mapping | null;
  set: (m: Mapping | null) => void;
  type: string;
  onType: (t: string) => void;
}) {
  return (
    <>
      <Field label={label}>
        <select style={styles.input} value={type} onChange={(e) => onType(e.target.value)}>
          <option value="none">{hint}</option>
          <option value="osc">OSC message</option>
          <option value="midi-cc">MIDI CC</option>
          <option value="midi-note">MIDI Note</option>
        </select>
      </Field>
      {mapping?.type === 'osc' && (
        <Field label="OSC address">
          <input style={styles.input}
            value={(mapping as OscMapping).address}
            onChange={(e) => set({ ...(mapping as OscMapping), address: e.target.value })} />
        </Field>
      )}
      {mapping?.type === 'midi' && (
        <>
          <Field label="Channel">
            <NumInput
              value={(mapping as MidiMapping).channel}
              onChange={(v) => set({ ...(mapping as MidiMapping), channel: Math.max(1, Math.min(16, v)) })} />
          </Field>
          <Field label={(mapping as MidiMapping).messageType === 'noteOn' ? 'Note' : 'CC'}>
            <NumInput
              value={(mapping as MidiMapping).number}
              onChange={(v) => set({ ...(mapping as MidiMapping), number: Math.max(0, Math.min(127, v)) })} />
          </Field>
        </>
      )}
    </>
  );
}

// Start with Windows: Maestrale opens by itself when the PC starts, with the
// last project exactly as it was left (installations).
function AutostartToggle(): React.JSX.Element {
  const [on, setOn] = useState(false);
  useEffect(() => { bridge.invoke('tr:app:autostart', null).then((v) => setOn(!!v)).catch(() => {}); }, []);
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer', marginTop: 6 }}>
      <input type="checkbox" checked={on}
        onChange={(e) => { const v = e.target.checked; setOn(v); bridge.invoke('tr:app:autostart', v).then((r) => setOn(!!r)).catch(() => {}); }} />
      Start Maestrale with Windows
    </label>
  );
}

// XY pad presets: Eos channel / group pan-tilt, plain OSC, cameras, DMX, MIDI.
function XYPresetBar({ widget, patch }: { widget: XYPadWidget; patch: (p: Partial<XYPadWidget>) => void }): React.JSX.Element {
  const [id, setId] = useState('');
  const [n, setN] = useState(1);
  const p = XY_PRESETS.find((x) => x.id === id);
  const groups = [...new Set(XY_PRESETS.map((x) => x.group))];
  return (
    <div>
      <div style={{ display: 'flex', gap: 4 }}>
        <select style={{ ...styles.input, flex: 1, minWidth: 0 }} value={id} onChange={(e) => setId(e.target.value)}>
          <option value="">— preset —</option>
          {groups.map((g) => (
            <optgroup key={g} label={g}>
              {XY_PRESETS.filter((x) => x.group === g).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </optgroup>
          ))}
        </select>
        <button disabled={!p} onClick={() => {
          if (!p) return;
          useStore.getState().captureHistory();
          patch(applyXYPreset(widget, p, n));
        }} style={{ ...styles.input, width: 'auto', cursor: p ? 'pointer' : 'default', color: p ? 'var(--lf-aqua)' : '#555' }}>Apply</button>
      </div>
      {p?.usesN && (
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, marginTop: 6, color: 'var(--color-text-dim)' }}>
          {p.usesN}
          <input className="lf-no-spin" type="number" min={1} value={n} onChange={(e) => setN(Math.max(1, Math.round(Number(e.target.value) || 1)))}
            style={{ ...styles.input, width: 80 }} />
        </label>
      )}
      {p?.note && <div style={{ fontSize: 11, color: '#888', marginTop: 4, lineHeight: 1.4 }}>{p.note}</div>}
      {p && <div style={{ fontSize: 11, color: '#666', marginTop: 4, lineHeight: 1.4 }}>Sets dot 1 (and Z); ＋ Dot continues with the next {p.usesN?.toLowerCase() ?? 'address'}.</div>}
    </div>
  );
}

type ShellW = import('../../../../shared/types/project').ShellWidget;
type PaletteW = import('../../../../shared/types/project').PaletteWidget;
type MergeW = import('../../../../shared/types/project').MergeWidget;

function ShellInspectorPanel({ widget, activePageId, updateWidget, updateWidgetRect }: {
  widget: ShellW; activePageId: string; updateWidget: StoreState['updateWidget']; updateWidgetRect: StoreState['updateWidgetRect'];
}) {
  const patch = (p: Partial<ShellW>) => updateWidget(activePageId, widget.id, p as never);
  const [editing, setEditing] = useState<number | null>(null);
  return (
    <>
      <div style={styles.header}>Shell</div>
      <Section label="Label">
        <input style={styles.input} value={widget.label} onChange={(e) => patch({ label: e.target.value })} />
      </Section>
      <PositionSection widget={widget} activePageId={activePageId} updateWidgetRect={updateWidgetRect} />
      <Section label="Buttons">
        {widget.buttons.map((b, i) => (
          <div key={b.id} style={{ display: 'flex', gap: 4, marginBottom: 4, alignItems: 'center' }}>
            <span style={{ width: 18, fontSize: 11, color: '#666' }}>{i + 1}</span>
            <button onClick={() => setEditing(i)} style={{ ...styles.input, flex: 1, textAlign: 'left', cursor: 'pointer' }}>
              {b.label || shellAction(b.action)?.name}
              <span style={{ color: '#666', fontSize: 11 }}>{b.label !== shellAction(b.action)?.name ? ` · ${shellAction(b.action)?.name ?? b.action}` : ''}</span>
            </button>
          </div>
        ))}
        <button onClick={() => { patch({ buttons: [...widget.buttons, { id: Math.random().toString(36).slice(2), label: 'Turn off PC', action: 'shutdown', delay: 10 }] }); setEditing(widget.buttons.length); }}
          style={{ ...styles.input, cursor: 'pointer' }}>＋ Button</button>
        <div style={{ fontSize: 12, color: 'var(--color-text-dim)', marginTop: 6, lineHeight: 1.5 }}>
          Each button is also an input: Shift-drag a Clock row onto it to turn the PC off at a time. Turn off / restart count down first
          (Cancel on the widget) and save where Maestrale is, so with "Start Maestrale with Windows" it comes back exactly as it was.
        </div>
      </Section>
      {editing !== null && widget.buttons[editing] && (
        <ShellButtonEditor button={widget.buttons[editing]}
          onChange={(nb) => patch({ buttons: widget.buttons.map((x, j) => (j === editing ? nb : x)) })}
          onRemove={() => { useStore.getState().dropCellAndShiftLinks(widget.id, editing); patch({ buttons: widget.buttons.filter((_, j) => j !== editing) }); setEditing(null); }}
          onClose={() => setEditing(null)} />
      )}
      <FrameSection style={widget.style} patchStyle={(p) => patch({ style: { ...widget.style, ...p } })} />
    </>
  );
}

function PaletteInspectorPanel({ widget, activePageId, updateWidget, updateWidgetRect }: {
  widget: PaletteW; activePageId: string; updateWidget: StoreState['updateWidget']; updateWidgetRect: StoreState['updateWidgetRect'];
}) {
  const patch = (p: Partial<PaletteW>) => updateWidget(activePageId, widget.id, p as never);
  const [editing, setEditing] = useState<number | null>(null);
  return (
    <>
      <div style={styles.header}>Palette</div>
      <Section label="Label">
        <input style={styles.input} value={widget.label} onChange={(e) => patch({ label: e.target.value })} />
      </Section>
      <PositionSection widget={widget} activePageId={activePageId} updateWidgetRect={updateWidgetRect} />
      <Section label="Colours">
        <Row>
          <Field label="How many"><NumInput value={widget.colors.length} min={1} max={64} onChange={(v) => setPaletteCount(widget, v)} /></Field>
          <Field label="Per row"><NumInput value={widget.cols} min={1} max={16} onChange={(v) => patch({ cols: Math.max(1, Math.min(16, Math.round(v))) })} /></Field>
        </Row>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 4, marginTop: 6 }}>
          {widget.colors.map((c, k) => (
            <button key={k} onClick={() => setEditing(k)} title={`${k + 1} · ${c}`}
              style={{ height: 30, borderRadius: 3, background: c, border: '1px solid #333', cursor: 'pointer' }} />
          ))}
          <button onClick={() => { setPaletteCount(widget, widget.colors.length + 1); setEditing(widget.colors.length); }}
            title="One more colour"
            style={{ height: 30, borderRadius: 3, background: 'transparent', border: '1px dashed #444', color: '#888', cursor: 'pointer' }}>＋</button>
        </div>
        <div style={{ fontSize: 12, color: 'var(--color-text-dim)', marginTop: 6, lineHeight: 1.5 }}>
          Each colour puts out three cells, R G B (0–1). For colour presets: Shift-drag all of them onto a Merge set to LTP, by 3,
          and its outputs 1 2 3 onto the R G B faders. In Live: tap a colour to pick it, hold or right-click to edit it.
        </div>
      </Section>
      {editing !== null && widget.colors[editing] !== undefined && (
        <ColorEditor color={widget.colors[editing]} model={widget.model ?? 'rgb'} onModel={(model) => patch({ model })}
          onChange={(hex) => patch({ colors: widget.colors.map((x, j) => (j === editing ? hex : x)) })}
          onRemove={widget.colors.length > 1 ? () => {
            for (let j = 2; j >= 0; j--) useStore.getState().dropCellAndShiftLinks(widget.id, 3 * editing + j);
            patch({ colors: widget.colors.filter((_, j) => j !== editing) }); setEditing(null);
          } : undefined}
          onClose={() => setEditing(null)} />
      )}
      <FrameSection style={widget.style} patchStyle={(p) => patch({ style: { ...widget.style, ...p } })} />
    </>
  );
}

function MergeInspectorPanel({ widget, activePageId, updateWidget, updateWidgetRect }: {
  widget: MergeW; activePageId: string; updateWidget: StoreState['updateWidget']; updateWidgetRect: StoreState['updateWidgetRect'];
}) {
  const patch = (p: Partial<MergeW>) => updateWidget(activePageId, widget.id, p as never);
  const modes: [MergeW['mode'], string, string][] = [
    ['ltp', 'LTP', 'the group moved or touched last wins (colour presets)'],
    ['htp', 'HTP', 'highest of each slot wins'],
    ['min', 'LOW', 'lowest of each slot'],
    ['avg', 'AVG', 'average of each slot'],
  ];
  return (
    <>
      <div style={styles.header}>Merge</div>
      <Section label="Label">
        <input style={styles.input} value={widget.label} onChange={(e) => patch({ label: e.target.value })} />
      </Section>
      <PositionSection widget={widget} activePageId={activePageId} updateWidgetRect={updateWidgetRect} />
      <Section label="Mode">
        <div style={{ display: 'flex', gap: 4 }}>
          {modes.map(([m, name]) => (
            <button key={m} onClick={() => patch({ mode: m })}
              style={{ ...styles.input, cursor: 'pointer', textAlign: 'center', background: widget.mode === m ? 'var(--lf-aqua)' : undefined, color: widget.mode === m ? '#000' : undefined, fontWeight: widget.mode === m ? 700 : 400 }}>{name}</button>
          ))}
        </div>
        <div style={{ fontSize: 12, color: 'var(--color-text-dim)', marginTop: 6 }}>{modes.find((x) => x[0] === widget.mode)?.[2]}</div>
      </Section>
      <Section label="Merge every">
        <Row>
          <Field label="Inputs per group = outputs"><NumInput value={widget.every} min={1} max={16} onChange={(v) => {
            const n = Math.max(1, Math.min(16, Math.round(v)));
            for (let i = widget.every - 1; i >= n; i--) useStore.getState().dropCellAndShiftLinks(widget.id, i);
            patch({ every: n });
          }} /></Field>
          <Field label="Smooth (s)"><NumInput value={widget.smooth} min={0} max={60} step={0.1} onChange={(v) => patch({ smooth: Math.max(0, Math.min(60, Math.round(v * 100) / 100)) })} /></Field>
        </Row>
        <div style={{ fontSize: 12, color: 'var(--color-text-dim)', marginTop: 6, lineHeight: 1.5 }}>
          In Live, hold Shift and drop as many cables as you like on the dashed box: each becomes the next input (in 1, in 2…).
          With 3: in 1-3 are group 1, in 4-6 group 2… and outputs 1 2 3 carry the merged R G B. Smooth = seconds to glide to a new value.
        </div>
      </Section>
      <FrameSection style={widget.style} patchStyle={(p) => patch({ style: { ...widget.style, ...p } })} />
    </>
  );
}

// Eos user for one widget: writes it into every OSC output it has, so this
// widget talks to the desk as its own user and does not fight the operator.
function EosUserRow({ widget, activePageId }: { widget: import('../../../../shared/types/project').Widget; activePageId: string }): React.JSX.Element | null {
  const user = widgetEosUser(widget);
  const [open, setOpen] = useState(user > 0);
  if (!open) {
    return (
      <button onClick={() => setOpen(true)} style={{ ...styles.input, cursor: 'pointer', color: 'var(--color-text-dim)', marginTop: 6 }}>
        + Eos user
      </button>
    );
  }
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ fontSize: 12, color: 'var(--color-text-dim)', marginBottom: 3 }}>Eos user (all outputs)</div>
      <input className="lf-no-spin" type="number" min={0} max={99} style={{ ...styles.input, width: 90 }} value={user}
        onChange={(e) => {
          const n = Math.max(0, Math.min(99, Math.round(Number(e.target.value) || 0)));
          useStore.getState().updateWidget(activePageId, widget.id, setWidgetEosUserPatch(widget, n) as never);
        }} />
      <div style={{ fontSize: 12, color: 'var(--color-text-dim)', marginTop: 5, lineHeight: 1.5 }}>
        {user > 0
          ? `Every /eos/… address of this widget goes out as /eos/user/${user}/… — its own selection and command line on the desk.`
          : '0 = the same user as the console. Put a number in to work alongside whoever is at the desk.'}
      </div>
    </div>
  );
}
