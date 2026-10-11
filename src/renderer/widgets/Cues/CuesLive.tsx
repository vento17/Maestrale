import { xyMapping } from '../../../shared/types/project';
import React, { useState, useRef, useEffect } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { nanoid } from 'nanoid';
import type { Widget, CuesWidget, CueData, SliderBankWidget, KnobBankWidget, ButtonGridWidget, XYPadWidget, RouterRow } from '../../../shared/types/project';
import type { OscMapping, MidiMapping } from '../../../shared/types/mapping';
import { useStore } from '../../store';
import { dispatchValue, dispatchButton } from '../../ipc/dispatch';
import { bridge } from '../../ipc/bridge';
import { cellCount } from '../utils';
import CellLinkMenu from '../base/CellLinkMenu';
import { eachRouter } from '../base/routers';
import { useSlavedCells, SLAVE_OUTLINE } from '../base/useSlavedCells';
import NumberInput from '../base/NumberInput';
import { widgetsInScope, cueContentOf } from './scope';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getContrastColor(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) > 0.45 ? '#000000' : '#ffffff';
}

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

export default function CuesLive({ widget }: { widget: CuesWidget }): React.JSX.Element {
  const { updateWidget } = useStore(useShallow((s) => ({ updateWidget: s.updateWidget })));
  const activePageId = useStore((s) => s.activePageId);

  const [editingId,   setEditingId]   = useState<string | null>(null);
  const [editName,    setEditName]    = useState('');
  const [dragSrcIdx,  setDragSrcIdx]  = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  const [activeCueId, setActiveCueId] = useState<string | null>(null);
  const slavedCells = useSlavedCells(widget.id);
  const [contextMenu, setContextMenu] = useState<{ cellIndex: number; x: number; y: number } | null>(null);
  useEffect(() => {
    if (!contextMenu) return;
    const handler = () => setContextMenu(null);
    document.addEventListener('pointerdown', handler);
    return () => document.removeEventListener('pointerdown', handler);
  }, [contextMenu]);

  const rafRef        = useRef<number | null>(null);
  const currentIdxRef = useRef(-1);
  const widgetRef     = useRef(widget);
  widgetRef.current   = widget;   // always current, no stale closure issues

  useEffect(() => () => { if (rafRef.current !== null) cancelAnimationFrame(rafRef.current); }, []);

  // ─── Helpers ──────────────────────────────────────────────────────────────

  function saveCues(cues: CueData[]) {
    if (!activePageId) return;
    useStore.getState().captureHistory();   // Ctrl+Z brings the cue back
    updateWidget(activePageId, widget.id, { cues } as never);
  }

  // ─── Add cue ──────────────────────────────────────────────────────────────

  function handleAddCue() {
    const { project, runtime } = useStore.getState();
    const snapshot: Record<string, number[]> = {};
    const play: Record<string, boolean> = {};
    const content: Record<string, Record<string, unknown>> = {};
    // Defaults to every widget on every page; the two scope dropdowns narrow it.
    for (const w of widgetsInScope(project, widget.scopePageId, widget.scopeWidgetId, widget.excludeIds)) {
      const wr = runtime.widgets[w.id];
      if (wr) snapshot[w.id] = wr.cells.map((c) => c.value);
      // Widgets with their own transport (LFO, Graph, Step Sequencer) store it
      // in the runtime; capture it so the cue restores what was running.
      if (wr?.playing !== undefined) play[w.id] = wr.playing;
      const c = cueContentOf(w);
      if (c) content[w.id] = c;
    }
    // Capture link/routing state — every router's rows across all pages, so
    // recalling this cue restores exactly which cells are slaved to what.
    const links: Record<string, RouterRow[]> = {};
    for (const r of eachRouter(project)) {
      links[r.id] = JSON.parse(JSON.stringify(r.holder.rows)) as RouterRow[];
    }
    const n = widget.cues.length + 1;
    saveCues([...widget.cues, { id: nanoid(), name: `Cue ${n}`, bgColor: '#1c2a1c', fadeTime: 0, snapshot, play, links, content }]);
  }

  // ─── Launch cue ───────────────────────────────────────────────────────────

  function launchCue(cue: CueData, idx: number) {
    const { project, activePageId: pid, runtime, setCellValue, setButtonActive } = useStore.getState();
    const page = project.pages.find((p) => p.id === pid);
    if (!page) return;

    currentIdxRef.current = idx;
    if (rafRef.current !== null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }

    // Restore link/routing state immediately (structural, not faded). Absent on
    // cues saved before this feature, in which case routing is left untouched.
    if (cue.links) {
      try { useStore.getState().applyLinksSnapshot(cue.links); }
      catch (err) { console.error('[cue] failed to restore links', err); }
    }

    // Generator content (a Sketch's drawing, an LFO's wave…) snaps too.
    if (cue.content) {
      for (const [wid, c] of Object.entries(cue.content)) {
        try {
          const pg = project.pages.find((p) => p.widgets.some((w) => w.id === wid));
          if (pg) useStore.getState().updateWidget(pg.id, wid, JSON.parse(JSON.stringify(c)) as never);
        } catch (err) { console.error('[cue] failed to restore content', wid, err); }
      }
    }

    // Transport is a boolean, so it snaps rather than fading with the values.
    // Absent on cues saved before this feature — those leave transports alone.
    if (cue.play) {
      for (const [wid, playing] of Object.entries(cue.play)) {
        try { useStore.getState().setWidgetPlaying(wid, playing); }
        catch (err) { console.error('[cue] failed to restore transport', wid, err); }
      }
    }

    const from: Record<string, number[]> = {};
    for (const widgetId of Object.keys(cue.snapshot)) {
      const wr = runtime.widgets[widgetId];
      from[widgetId] = wr ? wr.cells.map((c) => c.value) : [];
    }

    setActiveCueId(cue.id);

    function applyAt(t: number) {
      const { project: proj } = useStore.getState();
      // Look across every page: a cue can hold widgets that are not on the page
      // currently shown, and they still have to be recalled.
      const allWidgets = proj.pages.flatMap((p) => p.widgets);
      for (const [wid, targetVals] of Object.entries(cue.snapshot)) {
        // Defensive per-widget: a widget deleted since the cue was saved is
        // simply skipped; a widget added later isn't in the snapshot so it's
        // left alone. One bad widget never breaks the rest of the recall.
        try {
          const fromVals = from[wid] ?? [];
          const w = allWidgets.find((ww) => ww.id === wid);
          if (!w) continue;
          const cellN = cellCount(w);
          for (let i = 0; i < targetVals.length && i < cellN; i++) {
            const v = Math.max(0, Math.min(1, (fromVals[i] ?? 0) + (targetVals[i] - (fromVals[i] ?? 0)) * t));
            setCellValue(wid, i, v);
            if (w.kind === 'buttonGrid') setButtonActive(wid, i, v >= 0.5);
            dispatchCellValue(w, i, v);
          }
        } catch (err) {
          console.error('[cue] failed to apply widget', wid, err);
        }
      }
    }

    if (cue.fadeTime <= 0) { applyAt(1); return; }

    const duration = cue.fadeTime * 1000;
    const start = performance.now();
    function frame() {
      const elapsed = performance.now() - start;
      const t = Math.min(elapsed / duration, 1);
      applyAt(t);
      if (t < 1) { rafRef.current = requestAnimationFrame(frame); }
      else { rafRef.current = null; setActiveCueId(null); }
    }
    rafRef.current = requestAnimationFrame(frame);
  }

  // ─── Navigation ───────────────────────────────────────────────────────────

  function goTo(idx: number) {
    const cues = widgetRef.current.cues;
    if (!cues.length) return;
    const safeIdx = Math.max(0, Math.min(cues.length - 1, idx));
    launchCue(cues[safeIdx], safeIdx);
  }

  function goFirst()  { dispatchValue(widgetRef.current.navFirst, 1);  goTo(0); }
  function goPrev()   { dispatchValue(widgetRef.current.navPrev,  1);  goTo(Math.max(0, currentIdxRef.current - 1)); }
  function goNext()   { dispatchValue(widgetRef.current.navNext,  1);  goTo(currentIdxRef.current + 1); }
  function goLast()   { dispatchValue(widgetRef.current.navLast,  1);  goTo(widgetRef.current.cues.length - 1); }
  function goRandom() {
    dispatchValue(widgetRef.current.navRandom, 1);
    const cues = widgetRef.current.cues;
    if (!cues.length) return;
    if (cues.length === 1) { goTo(0); return; }
    let idx: number;
    do { idx = Math.floor(Math.random() * cues.length); } while (idx === currentIdxRef.current);
    goTo(idx);
  }

  // Stable refs for nav functions — updated each render so effects never go stale
  const goFirstRef  = useRef(goFirst);  goFirstRef.current  = goFirst;
  const goPrevRef   = useRef(goPrev);   goPrevRef.current   = goPrev;
  const goNextRef   = useRef(goNext);   goNextRef.current   = goNext;
  const goLastRef   = useRef(goLast);   goLastRef.current   = goLast;
  const goRandomRef = useRef(goRandom); goRandomRef.current = goRandom;
  const launchRef   = useRef(launchCue); launchRef.current  = launchCue;

  // ─── OSC: cue-by-name + nav button input ──────────────────────────────────

  useEffect(() => bridge.on('tr:osc:feedback', (msg) => {
    const w = widgetRef.current;
    // Trigger cue by name: OSC address = /cuename
    const idx = w.cues.findIndex((c) => `/${c.name}` === msg.address);
    if (idx >= 0) { launchRef.current(w.cues[idx], idx); return; }
    // Nav buttons via OSC mapping
    if (w.navFirst?.type  === 'osc' && msg.address === (w.navFirst  as OscMapping).address) { goFirstRef.current();  return; }
    if (w.navPrev?.type   === 'osc' && msg.address === (w.navPrev   as OscMapping).address) { goPrevRef.current();   return; }
    if (w.navNext?.type   === 'osc' && msg.address === (w.navNext   as OscMapping).address) { goNextRef.current();   return; }
    if (w.navRandom?.type === 'osc' && msg.address === (w.navRandom as OscMapping).address) { goRandomRef.current(); return; }
    if (w.navLast?.type   === 'osc' && msg.address === (w.navLast   as OscMapping).address) { goLastRef.current();   return; }
  }), []);

  // Cues can be added/removed while live, so keep the runtime cell count in sync
  // (initRuntime merges existing values, so this is non-destructive).
  const cuesLen = widget.cues.length;
  useEffect(() => {
    const s = useStore.getState();
    const wr = s.runtime.widgets[widget.id];
    if (!wr || wr.cells.length === cuesLen) return;
    s.initRuntime(s.project.pages.flatMap((p) => p.widgets));
  }, [cuesLen, widget.id]);

  // ─── Slave: a router link (e.g. a timeline trig track) launches a cue ──────
  // cells[i] = cue i. A rising edge (0 → 1) fires that cue, so linking "Trig 5"
  // (or a track you named 'cue5') to a cue row triggers it from the timeline.
  useEffect(() => {
    const prev: Record<number, number> = {};
    return useStore.subscribe((state, prevState) => {
      const wr = state.runtime.widgets[widget.id];
      // Only react when OUR own cells changed — launching writes other widgets'
      // cells, so this can't re-enter.
      if (!wr || wr === prevState.runtime.widgets[widget.id]) return;
      const cues = widgetRef.current.cues;
      for (let i = 0; i < cues.length; i++) {
        const v = wr.cells[i]?.value ?? 0;
        const p = prev[i] ?? 0;
        prev[i] = v;
        if (p < 0.5 && v >= 0.5) launchRef.current(cues[i], i);
      }
    });
  }, [widget.id]);

  // ─── MIDI: nav button input ────────────────────────────────────────────────

  useEffect(() => bridge.on('tr:midi:inputEvent', (evt) => {
    const w = widgetRef.current;
    function match(m: typeof w.navFirst): boolean {
      if (!m || m.type !== 'midi') return false;
      const mm = m as MidiMapping;
      const isCC   = mm.messageType === 'controlChange' && evt.messageType === 'controlChange' && evt.channel === mm.channel && evt.number === mm.number;
      const isNote = mm.messageType === 'noteOn'        && evt.messageType === 'noteOn'        && evt.channel === mm.channel && evt.number === mm.number;
      return isCC || isNote;
    }
    if (match(w.navFirst))  { goFirstRef.current();  return; }
    if (match(w.navPrev))   { goPrevRef.current();   return; }
    if (match(w.navNext))   { goNextRef.current();   return; }
    if (match(w.navRandom)) { goRandomRef.current(); return; }
    if (match(w.navLast))   { goLastRef.current();   return; }
  }), []);

  // ─── Cue mutations ────────────────────────────────────────────────────────

  function deleteCue(id: string) { saveCues(widget.cues.filter((c) => c.id !== id)); }
  function updateCue(id: string, patch: Partial<CueData>) {
    saveCues(widget.cues.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }
  function startRename(cue: CueData) { setEditingId(cue.id); setEditName(cue.name); }
  function commitRename() {
    if (editingId) updateCue(editingId, { name: editName.trim() || 'Cue' });
    setEditingId(null);
  }

  // ─── Drag reorder ─────────────────────────────────────────────────────────

  function handleDrop(targetIdx: number) {
    if (dragSrcIdx !== null && dragSrcIdx !== targetIdx) {
      const arr = [...widget.cues];
      const [item] = arr.splice(dragSrcIdx, 1);
      const ins = dragSrcIdx < targetIdx ? targetIdx - 1 : targetIdx;
      arr.splice(ins, 0, item);
      saveCues(arr);
    }
    setDragSrcIdx(null); setDragOverIdx(null);
  }

  // ─── Styles ───────────────────────────────────────────────────────────────

  const dropLine = { height: 2, background: '#fff', borderRadius: 1, margin: '1px 0', flexShrink: 0 } as const;
  const iconBtn  = { background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px', lineHeight: 1, fontSize: 11 } as const;
  const fadeStep = {
    background: '#141414', border: '1px solid #252525', color: '#999',
    borderRadius: 2, width: 20, height: 22, cursor: 'pointer',
    fontSize: 13, lineHeight: 1, padding: 0, flexShrink: 0, fontFamily: 'inherit',
  } as const;
  const navBtn: React.CSSProperties = {
    background: 'none',
    border: 'none',
    color: '#ffffff',
    cursor: 'pointer',
    fontSize: 22,
    padding: '0 7px',
    height: 42,
    display: 'flex',
    alignItems: 'center',
    lineHeight: 1,
    fontFamily: 'inherit',
    boxSizing: 'border-box',
    flexShrink: 0,
  };

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      {/* Header */}
      <div style={{ flexShrink: 0, height: 50, display: 'flex', alignItems: 'center', gap: 4, padding: '0 6px', borderBottom: '1px solid #252525' }}>
        {/* Navigation buttons */}
        <button onClick={goFirst}  title="First cue"   style={navBtn}>⏮</button>
        <button onClick={goPrev}   title="Previous cue" style={navBtn}>◀</button>
        <button onClick={goRandom} title="Random cue"  style={navBtn}>✦</button>
        <button onClick={goNext}   title="Next cue"    style={navBtn}>▶</button>
        <button onClick={goLast}   title="Last cue"    style={navBtn}>⏭</button>

        {/* Label centered */}
        <span style={{ flex: 1, textAlign: 'center', fontSize: 10, fontWeight: 600, color: '#666', letterSpacing: '0.08em', userSelect: 'none' }}>CUES</span>

        {/* Add cue */}
        <button
          onClick={handleAddCue}
          title="Save current state as new cue"
          style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', color: 'var(--color-text)', borderRadius: 'var(--radius-sm)', height: 42, padding: '0 14px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'inherit', fontSize: 'var(--font-size-md)', boxSizing: 'border-box', flexShrink: 0, lineHeight: 1 }}
        >+</button>
      </div>

      {/* Cue list */}
      <div
        style={{ flex: 1, overflowY: 'auto', padding: '4px 4px', display: 'flex', flexDirection: 'column' }}
        onDragOver={(e) => e.preventDefault()}
      >
        {widget.cues.map((cue, i) => {
          const isActive = activeCueId === cue.id;
          const contrast = getContrastColor(cue.bgColor);

          return (
            <React.Fragment key={cue.id}>
              {dragOverIdx === i && <div style={dropLine} />}
              <div
                draggable
                onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; setDragSrcIdx(i); }}
                onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDragOverIdx(i); }}
                onDrop={(e) => { e.preventDefault(); handleDrop(i); }}
                onDragEnd={() => { setDragSrcIdx(null); setDragOverIdx(null); }}
                data-lf-widget={widget.id} data-lf-cell={i}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setContextMenu({ cellIndex: i, x: e.clientX, y: e.clientY });
                }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 4, height: 38, flexShrink: 0,
                  opacity: dragSrcIdx === i ? 0.4 : 1,
                  outline: slavedCells.has(i) ? SLAVE_OUTLINE : isActive ? '1px solid #ffffff44' : 'none',
                  outlineOffset: slavedCells.has(i) ? -1 : undefined,
                  borderRadius: 3, marginBottom: 2,
                }}
              >
                {/* Drag handle */}
                <div style={{ width: 14, color: '#404040', fontSize: 10, cursor: 'grab', userSelect: 'none', textAlign: 'center', flexShrink: 0 }}>⠿</div>

                {/* Launch button */}
                <div
                  onClick={() => editingId !== cue.id && launchCue(cue, i)}
                  style={{ flex: 1, background: cue.bgColor, borderRadius: 2, paddingLeft: 8, paddingRight: 4, height: '100%', display: 'flex', alignItems: 'center', cursor: 'pointer', overflow: 'hidden', minWidth: 0 }}
                >
                  {editingId === cue.id ? (
                    <input
                      autoFocus
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onBlur={commitRename}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') commitRename(); }}
                      onClick={(e) => e.stopPropagation()}
                      style={{ background: 'transparent', border: 'none', outline: 'none', color: contrast, width: '100%', fontSize: 16, fontWeight: 600, fontFamily: 'inherit' }}
                    />
                  ) : (
                    <span style={{ fontSize: 16, fontWeight: 600, color: contrast, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', userSelect: 'none' }}>
                      {cue.name}
                    </span>
                  )}
                </div>

                {/* Right controls */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0 }}>

                  {/* Color swatch — native picker overlaid, positioned at swatch so picker opens nearby */}
                  <div style={{ position: 'relative', width: 14, height: 14, flexShrink: 0 }}>
                    <div style={{ width: 14, height: 14, background: cue.bgColor, border: '1px solid #555', borderRadius: 2, pointerEvents: 'none' }} />
                    <input
                      type="color"
                      value={cue.bgColor}
                      onChange={(e) => updateCue(cue.id, { bgColor: e.target.value })}
                      onClick={(e) => e.stopPropagation()}
                      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer', padding: 0, border: 'none' }}
                      tabIndex={-1}
                    />
                  </div>

                  {/* Fade time — the native spinner sat on top of the number in
                      a field this narrow, so the steppers live outside it. */}
                  <span style={{ fontSize: 10, color: '#555', userSelect: 'none' }}>fade</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); updateCue(cue.id, { fadeTime: Math.max(0, +(cue.fadeTime - 0.1).toFixed(2)) }); }}
                    title="Shorter fade"
                    style={fadeStep}
                  >−</button>
                  <NumberInput
                    min={0} max={60} step={0.1}
                    spinners={false}
                    value={cue.fadeTime}
                    onChange={(v) => updateCue(cue.id, { fadeTime: Math.max(0, v) })}
                    style={{ width: 56, background: '#111', border: '1px solid #252525', color: '#ccc', fontSize: 12, borderRadius: 2, padding: '3px 5px', textAlign: 'center' }}
                  />
                  <button
                    onClick={(e) => { e.stopPropagation(); updateCue(cue.id, { fadeTime: Math.min(60, +(cue.fadeTime + 0.1).toFixed(2)) }); }}
                    title="Longer fade"
                    style={fadeStep}
                  >+</button>
                  <span style={{ fontSize: 10, color: '#555', userSelect: 'none' }}>s</span>

                  {/* Rename */}
                  <button onClick={() => startRename(cue)} style={{ ...iconBtn, color: '#555' }} title="Rename">&#9999;</button>

                  {/* Delete */}
                  <button onClick={() => deleteCue(cue.id)} style={{ ...iconBtn, color: '#444' }} title="Delete">&#x2715;</button>
                </div>
              </div>
            </React.Fragment>
          );
        })}

        {/* End drop zone */}
        {dragOverIdx === widget.cues.length && <div style={dropLine} />}
        <div
          style={{ flex: 1, minHeight: 16 }}
          onDragOver={(e) => { e.preventDefault(); setDragOverIdx(widget.cues.length); }}
          onDrop={(e) => { e.preventDefault(); handleDrop(widget.cues.length); }}
        />

        {widget.cues.length === 0 && (
          <div style={{ fontSize: 10, color: '#303030', textAlign: 'center', paddingTop: 12, pointerEvents: 'none' }}>
            Press + to save current state
          </div>
        )}
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
