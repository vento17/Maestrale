import { pal, palRgb } from '../../palette';
import { xyMapping } from '../../../shared/types/project';
import React, { useState, useRef, useEffect } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type {
  SubmastersWidget, Widget,
  SliderBankWidget, KnobBankWidget, ButtonGridWidget, XYPadWidget,
} from '../../../shared/types/project';
import { useStore, useWidgetRuntime } from '../../store';
import { dispatchValue, dispatchButton } from '../../ipc/dispatch';
import { cellCount, clamp } from '../utils';
import CellLinkMenu from '../base/CellLinkMenu';
import { submasterTargets } from '../base/links';
import { useSlavedCells, SLAVE_OUTLINE } from '../base/useSlavedCells';

// ─── Dispatch helper (same as CuesLive) ──────────────────────────────────────

function dispatchCellValue(widget: Widget, cellIndex: number, value: number): void {
  switch (widget.kind) {
    case 'sliderBank':
    case 'knobBank': {
      const w = widget as SliderBankWidget | KnobBankWidget;
      dispatchValue(w.cells[cellIndex]?.mapping ?? widget.mapping, value);
      break;
    }
    case 'buttonGrid': {
      const w = widget as ButtonGridWidget;
      const cell = w.cells[cellIndex];
      dispatchButton(cell?.mapping ?? widget.mapping, value >= 0.5, cell?.onValue ?? 127, cell?.offValue ?? 0);
      break;
    }
    case 'xyPad': {
      const w = widget as XYPadWidget;
      dispatchValue(xyMapping(w, cellIndex), value);
      break;
    }
    default:
      dispatchValue(widget.mapping, value);
  }
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function SubmastersLive({ widget }: { widget: SubmastersWidget }): React.JSX.Element {
  const { countX, spacingX, spacingY, style, scenes, mergeMode, linkedWidgetIds } = widget;

  const { updateWidget, setCellValue, setButtonActive } = useStore(useShallow((s) => ({
    updateWidget: s.updateWidget,
    setCellValue: s.setCellValue,
    setButtonActive: s.setButtonActive,
  })));
  const widgetRuntime = useWidgetRuntime(widget.id);

  const scenesRef = useRef(scenes);
  scenesRef.current = scenes;

  const slavedCells = useSlavedCells(widget.id);
  const [contextMenu, setContextMenu] = useState<{ cellIndex: number; x: number; y: number } | null>(null);
  useEffect(() => {
    if (!contextMenu) return;
    const handler = () => setContextMenu(null);
    document.addEventListener('pointerdown', handler);
    return () => document.removeEventListener('pointerdown', handler);
  }, [contextMenu]);

  const [recArmed, setRecArmed]               = useState(false);
  const [delArmed, setDelArmed]               = useState(false);
  const [lastTouchedScene, setLastTouchedScene] = useState(0);
  const [flashedScenes, setFlashedScenes]     = useState<Set<number>>(new Set());

  const preFlashRef = useRef<Record<number, number>>({});

  const faderValues = Array.from({ length: countX }, (_, i) => widgetRuntime?.cells[i]?.value ?? 0);
  const project = useStore((s) => s.project);
  // "All widgets · all pages" by default; narrowed in the settings.
  const linkedWidgets = submasterTargets(project, { id: widget.id, linkedWidgetIds, excludeWidgetIds: widget.excludeWidgetIds });

  const REC_COL_W = 48;
  const pad = Math.max(spacingX, spacingY);

  // ─── Merge + push ─────────────────────────────────────────────────────────

  function computeAndPush(faderVals: number[], ltsTouched: number) {
    if (linkedWidgets.length === 0) return;

    for (const w of linkedWidgets) {
      const count = cellCount(w);
      const vals = new Array<number>(count).fill(0);

      if (mergeMode === 'htp') {
        for (let si = 0; si < countX; si++) {
          const fv = faderVals[si] ?? 0;
          if (fv === 0) continue;
          const snap = scenes[si]?.snapshot[w.id];
          if (!snap) continue;
          for (let ci = 0; ci < count; ci++) {
            vals[ci] = Math.max(vals[ci], (snap[ci] ?? 0) * fv);
          }
        }
      } else {
        // LTP: only the last-touched scene contributes
        const fv = faderVals[ltsTouched] ?? 0;
        const snap = scenes[ltsTouched]?.snapshot[w.id];
        if (snap) {
          for (let ci = 0; ci < count; ci++) {
            vals[ci] = (snap[ci] ?? 0) * fv;
          }
        }
      }

      for (let ci = 0; ci < count; ci++) {
        setCellValue(w.id, ci, vals[ci]);
        dispatchCellValue(w, ci, vals[ci]);
        if (w.kind === 'buttonGrid') {
          setButtonActive(w.id, ci, vals[ci] >= 0.5);
        }
      }
    }
  }

  function handleFaderChange(sceneIdx: number, value: number) {
    setCellValue(widget.id, sceneIdx, value);
    setLastTouchedScene(sceneIdx);
    const newFaderValues = [...faderValues];
    newFaderValues[sceneIdx] = value;
    computeAndPush(newFaderValues, sceneIdx);
  }

  // ─── Scene record / delete ────────────────────────────────────────────────

  function handleTopButtonPress(sceneIdx: number) {
    if (!recArmed && !delArmed) return;

    if (recArmed) {
      const { runtime: rt, project } = useStore.getState();
      // The page this submaster lives on (it may control widgets elsewhere).
      const pid = project.pages.find((p) => p.widgets.some((w) => w.id === widget.id))?.id;
      if (!pid) return;
      const snapshot: Record<string, number[]> = {};
      for (const lw of submasterTargets(project, { id: widget.id, linkedWidgetIds, excludeWidgetIds: widget.excludeWidgetIds })) {
        const wid = lw.id;
        const wr = rt.widgets[wid];
        if (wr) snapshot[wid] = wr.cells.map((c) => c.value);
      }
      const newScenes = scenes.map((s, i) => i === sceneIdx ? { ...s, snapshot } : s);
      useStore.getState().captureHistory();
      updateWidget(pid, widget.id, { scenes: newScenes } as never);
      setRecArmed(false);
      // The scene now IS what is on stage, so its fader goes to full — the look
      // stays up through this submaster from here on. The linked widgets already
      // hold snapshot × 1, so nothing is pushed.
      setCellValue(widget.id, sceneIdx, 1);
      setLastTouchedScene(sceneIdx);
    } else {
      // del armed — clear snapshot
      const pid = useStore.getState().project.pages.find((p) => p.widgets.some((w) => w.id === widget.id))?.id;
      if (!pid) return;
      const newScenes = scenes.map((s, i) => i === sceneIdx ? { ...s, snapshot: {} } : s);
      useStore.getState().captureHistory();
      updateWidget(pid, widget.id, { scenes: newScenes } as never);
      setDelArmed(false);
    }
  }

  // ─── Flash (bottom buttons) ───────────────────────────────────────────────

  // The flash button is cell countX + sceneIdx: its own cell, so it can be
  // linked, learned and sent outward like any other button. The fader stays at
  // cell sceneIdx.
  const flashCell = (sceneIdx: number) => countX + sceneIdx;

  function handleFlashDown(sceneIdx: number) {
    if (preFlashRef.current[sceneIdx] !== undefined) return;   // already held
    preFlashRef.current[sceneIdx] = faderValues[sceneIdx];
    setFlashedScenes((prev) => new Set([...prev, sceneIdx]));
    const fc = flashCell(sceneIdx);
    setCellValue(widget.id, fc, 1);
    setButtonActive(widget.id, fc, true);
    const m = scenesRef.current[sceneIdx]?.flashMapping;
    if (m) dispatchButton(m, true, 127, 0);
    handleFaderChange(sceneIdx, 1.0);
  }

  function handleFlashUp(sceneIdx: number) {
    if (preFlashRef.current[sceneIdx] === undefined) return;    // not held
    const prev = preFlashRef.current[sceneIdx] ?? 0;
    delete preFlashRef.current[sceneIdx];
    setFlashedScenes((p) => { const next = new Set(p); next.delete(sceneIdx); return next; });
    const fc = flashCell(sceneIdx);
    setCellValue(widget.id, fc, 0);
    setButtonActive(widget.id, fc, false);
    const m = scenesRef.current[sceneIdx]?.flashMapping;
    if (m) dispatchButton(m, false, 127, 0);
    handleFaderChange(sceneIdx, prev);
  }

  // A router row pointed at a flash cell drives the flash, so a pad on a
  // controller behaves exactly like a finger on the button: held down while the
  // pad is held, released when it is let go.
  const flashDownRef = useRef(handleFlashDown);
  const flashUpRef   = useRef(handleFlashUp);
  flashDownRef.current = handleFlashDown;
  flashUpRef.current   = handleFlashUp;
  useEffect(() => {
    const prev: number[] = [];
    return useStore.subscribe((state) => {
      const wr = state.runtime.widgets[widget.id];
      if (!wr) return;
      const n = countXRef.current;
      for (let i = 0; i < n; i++) {
        const v = wr.cells[n + i]?.value ?? 0;
        const was = prev[i] ?? 0;
        prev[i] = v;
        if (was < 0.5 && v >= 0.5) flashDownRef.current(i);
        else if (was >= 0.5 && v < 0.5) flashUpRef.current(i);
      }
    });
  }, [widget.id]);

  // When this submaster's own fader cells change from OUTSIDE the local drag
  // handlers (e.g. a remote NetworkLive client, a router, or a cue), re-run the
  // merge so linked widgets follow. Fires only when our own runtime changed, so
  // pushing to linked widgets (which changes their runtime, not ours) can't loop.
  const computeAndPushRef = useRef(computeAndPush);
  computeAndPushRef.current = computeAndPush;
  const lastTouchedRef = useRef(lastTouchedScene);
  lastTouchedRef.current = lastTouchedScene;
  const countXRef = useRef(countX);
  countXRef.current = countX;
  useEffect(() => {
    return useStore.subscribe((state, prev) => {
      const wr = state.runtime.widgets[widget.id];
      if (!wr || wr === prev.runtime.widgets[widget.id]) return;
      const n = countXRef.current;
      const fv = Array.from({ length: n }, (_, i) => wr.cells[i]?.value ?? 0);
      computeAndPushRef.current(fv, lastTouchedRef.current);
    });
  }, [widget.id]);

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div style={{
      width: '100%', height: '100%',
      display: 'flex',
      gap: spacingX,
      padding: pad,
      boxSizing: 'border-box',
    }}>
      {/* Scene columns */}
      <div style={{ flex: 1, display: 'flex', gap: spacingX, minWidth: 0 }}>
        {Array.from({ length: countX }, (_, i) => {
          const scene = scenes[i];
          const hasData = scene && Object.keys(scene.snapshot).length > 0;
          const fv = faderValues[i];
          const btnColor = scene?.color ?? style.foregroundColor;
          const isFlashing = flashedScenes.has(i);

          let topBg: string;
          if (recArmed)      topBg = `rgba(${palRgb('#ff9232')},0.45)`;
          else if (delArmed) topBg = `rgba(${palRgb('#ff7700')},0.45)`;
          else if (hasData)  topBg = fv > 0.001 ? btnColor : `${btnColor}55`;
          else               topBg = 'rgba(255,255,255,0.07)';

          return (
            <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: spacingY, minWidth: 0 }}>
              {/* Top button — scene record / status */}
              <div
                onClick={() => handleTopButtonPress(i)}
                style={{
                  flexShrink: 0, height: 28,
                  background: topBg,
                  borderRadius: 3,
                  cursor: (recArmed || delArmed) ? 'pointer' : 'default',
                  border: (recArmed || delArmed) ? '1px dashed rgba(255,255,255,0.25)' : '1px solid transparent',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  userSelect: 'none',
                  transition: 'background 0.1s',
                }}
              >
                {style.showLabel && (
                  <span style={{
                    fontSize: Math.max(style.fontSize - 2, 8),
                    color: hasData ? (fv > 0.001 ? '#000' : style.labelColor) : style.labelColor,
                    pointerEvents: 'none',
                    opacity: hasData ? 1 : 0.5,
                  }}>
                    {scene?.label ?? `${i + 1}`}
                  </span>
                )}
              </div>

              {/* Fader */}
              <div
                style={{
                  flex: 1, position: 'relative',
                  background: 'rgba(0,0,0,0.35)',
                  borderRadius: 4, overflow: 'hidden',
                  touchAction: 'none',
                  cursor: 'pointer',
                  outline: slavedCells.has(i) ? SLAVE_OUTLINE : undefined,
                  outlineOffset: slavedCells.has(i) ? -1 : undefined,
                }}
                onPointerDown={(e) => {
                  // A router link is a second way in, not a lock.
                  e.currentTarget.setPointerCapture(e.pointerId);
                  const rect = e.currentTarget.getBoundingClientRect();
                  const v = clamp(1 - (e.clientY - rect.top) / rect.height, 0, 1);
                  handleFaderChange(i, v);
                }}
                onPointerMove={(e) => {
                  if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
                  const rect = e.currentTarget.getBoundingClientRect();
                  const v = clamp(1 - (e.clientY - rect.top) / rect.height, 0, 1);
                  handleFaderChange(i, v);
                }}
                data-lf-widget={widget.id} data-lf-cell={i}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setContextMenu({ cellIndex: i, x: e.clientX, y: e.clientY });
                }}
                onMouseMove={(e) => {
                  e.stopPropagation();
                  useStore.getState().setHoverInfo(widget.label + ' · ' + (scene?.label ?? String(i + 1)));
                }}
              >
                {/* Fill */}
                <div style={{
                  position: 'absolute', bottom: 0, left: 0, right: 0,
                  height: `${fv * 100}%`,
                  background: btnColor, opacity: 0.45,
                }} />
                {/* Thumb */}
                <div style={{
                  position: 'absolute',
                  bottom: `calc(${fv * 100}% - 8px)`,
                  left: '10%', right: '10%', height: 16,
                  background: btnColor, borderRadius: 4,
                  zIndex: 1, boxShadow: '0 0 6px rgba(0,0,0,0.5)',
                }} />
              </div>

              {/* Bottom button — flash. Cell countX + i, so it links and learns. */}
              <div
                data-lf-widget={widget.id} data-lf-cell={countX + i}
                onPointerDown={(e) => {
                  if (e.button !== 0) return;      // right-click → context menu
                  e.currentTarget.setPointerCapture(e.pointerId);
                  handleFlashDown(i);
                }}
                onPointerUp={() => handleFlashUp(i)}
                onPointerCancel={() => handleFlashUp(i)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setContextMenu({ cellIndex: countX + i, x: e.clientX, y: e.clientY });
                }}
                onMouseMove={(e) => {
                  e.stopPropagation();
                  useStore.getState().setHoverInfo(
                    widget.label + ' · ' + (scene?.label ?? String(i + 1)) + ' flash');
                }}
                style={{
                  flexShrink: 0, height: 28,
                  background: isFlashing ? btnColor : 'rgba(255,255,255,0.06)',
                  borderRadius: 3, cursor: 'pointer',
                  touchAction: 'none',
                  border: '1px solid transparent',
                  outline: slavedCells.has(countX + i) ? SLAVE_OUTLINE : undefined,
                  outlineOffset: slavedCells.has(countX + i) ? -1 : undefined,
                  transition: 'background 0.08s',
                }}
              />
            </div>
          );
        })}
      </div>

      {/* Right REC / DEL column */}
      <div style={{
        flexShrink: 0, width: REC_COL_W,
        display: 'flex', flexDirection: 'column', gap: spacingY,
      }}>
        {/* REC button */}
        <div
          onClick={() => { setRecArmed((v) => !v); setDelArmed(false); }}
          style={{
            flex: 1, borderRadius: 3,
            background: recArmed ? pal('#cc6811') : `rgba(${palRgb('#c86d1e')},0.15)`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', userSelect: 'none',
            border: `1px solid ${recArmed ? pal('#ff9b44') : pal('#402915')}`,
            transition: 'all 0.1s',
          }}
        >
          <span style={{
            fontSize: 10, fontWeight: 700, letterSpacing: 1,
            color: recArmed ? '#ffffff' : pal('#d97a26'),
          }}>REC</span>
        </div>

        {/* DEL button */}
        <div
          onClick={() => { setDelArmed((v) => !v); setRecArmed(false); }}
          style={{
            flex: 1, borderRadius: 3,
            background: delArmed ? `rgba(${palRgb('#ff7700')},0.35)` : 'rgba(255,255,255,0.05)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', userSelect: 'none',
            border: `1px solid ${delArmed ? `rgba(${palRgb('#ff7700')},0.5)` : '#252525'}`,
            transition: 'all 0.1s',
          }}
        >
          <span style={{
            fontSize: 10, fontWeight: 700, letterSpacing: 1,
            color: delArmed ? pal('#ff7700') : '#555',
          }}>DEL</span>
        </div>
      </div>

      {contextMenu && (
        <CellLinkMenu
          x={contextMenu.x}
          y={contextMenu.y}
          widgetId={widget.id}
          cellIndex={contextMenu.cellIndex}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}
