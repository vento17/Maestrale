import { pal, palRgb, onPalette } from '../../palette';
import React, { useRef, useState, useEffect, useCallback } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Rnd } from 'react-rnd';
import type { Widget } from '../../../shared/types/project';
import { useStore, useActivePage } from '../../store';
import { GRID_SNAP_PX } from '../../../shared/constants';
import WidgetPicker from './WidgetPicker';
import WidgetPreview from '../../widgets/base/WidgetPreview';
import CellEditModal from '../../widgets/base/CellEditModal';
import PlacementLayer from './PlacementLayer';

const snap = (v: number): number => Math.round(v / GRID_SNAP_PX) * GRID_SNAP_PX;
// Snapped, and kept on the page: rounding up must not push the far edge out.
function snapIn(v: number, size: number, page: number): number {
  let x = Math.max(0, snap(v));
  while (x > 0 && x + size > page) x -= GRID_SNAP_PX;
  return x;
}

export default function Canvas(): React.JSX.Element {
  const page = useActivePage();
  const {
    selectedWidgetId, setSelectedWidgetId,
    selectedWidgetIds, toggleWidgetSelection, clearMultiSelection,
    isWidgetPickerOpen,
    updateWidgetRect, bringWidgetToFront, removeWidget, activePageId,
    captureHistory, undo, copyWidgets, cutWidgets, pasteWidgets,
  } = useStore(useShallow((s) => ({
    selectedWidgetId:      s.selectedWidgetId,
    setSelectedWidgetId:   s.setSelectedWidgetId,
    selectedWidgetIds:     s.selectedWidgetIds,
    toggleWidgetSelection: s.toggleWidgetSelection,
    clearMultiSelection:   s.clearMultiSelection,
    isWidgetPickerOpen:    s.isWidgetPickerOpen,
    updateWidgetRect:      s.updateWidgetRect,
    bringWidgetToFront:    s.bringWidgetToFront,
    removeWidget:          s.removeWidget,
    activePageId:          s.activePageId,
    captureHistory:        s.captureHistory,
    undo:                  s.undo,
    copyWidgets:           s.copyWidgets,
    cutWidgets:            s.cutWidgets,
    pasteWidgets:          s.pasteWidgets,
  })));

  const outerRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [editingWidgetId, setEditingWidgetId] = useState<string | null>(null);
  // Touch long-press → delete popup, so a widget can be removed without a keyboard.
  const [deleteMenu, setDeleteMenu] = useState<{ ids: string[]; x: number; y: number } | null>(null);
  const longPress = useRef<{ x: number; y: number; timer: number } | null>(null);
  // Rubber-band (marquee) selection on empty canvas
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const marqueeRef = useRef<{ x0: number; y0: number; moved: boolean } | null>(null);
  const justMarqueed = useRef(false);
  // Track shift key as state so Rnd re-renders with disableDragging
  const [shiftHeld, setShiftHeld] = useState(false);

  // Tracks start positions of all multi-selected widgets at drag start
  const multiDragStartPositions = useRef<Record<string, { x: number; y: number }>>({});
  // Snapshot for group resize: origin + each selected widget's rect + dragged base size
  const multiResizeStart = useRef<{
    origin: { x: number; y: number };
    rects: Record<string, { x: number; y: number; width: number; height: number }>;
    base: { w: number; h: number };
  } | null>(null);

  useEffect(() => {
    const down = (e: KeyboardEvent) => { if (e.key === 'Shift') setShiftHeld(true); };
    const up   = (e: KeyboardEvent) => { if (e.key === 'Shift') setShiftHeld(false); };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  const computeScale = useCallback(() => {
    if (!outerRef.current || !page) return;
    const { width, height } = outerRef.current.getBoundingClientRect();
    const padding = 32;
    const sx = (width  - padding) / page.width;
    const sy = (height - padding) / page.height;
    setScale(Math.min(sx, sy, 1));
  }, [page?.width, page?.height]);

  useEffect(() => {
    computeScale();
    const ro = new ResizeObserver(computeScale);
    if (outerRef.current) ro.observe(outerRef.current);
    return () => ro.disconnect();
  }, [computeScale]);

  const pageWidth  = page?.width  ?? 1920;
  // Every position and size lands on the grid — absolute, not "in steps from
  // where it was" — so edges of different widgets line up. Something pushed
  // against the far edge of the page stays inside it.
  const pageHeight = page?.height ?? 1080;

  const allSelectedIds = selectedWidgetId
    ? [selectedWidgetId]
    : selectedWidgetIds;

  const cancelLongPress = useCallback(() => {
    if (longPress.current) {
      clearTimeout(longPress.current.timer);
      longPress.current = null;
    }
  }, []);

  useEffect(() => cancelLongPress, [cancelLongPress]);

  // Hold a widget for LONG_PRESS_MS without sliding → delete popup. Mouse is
  // excluded on purpose: pausing mid-drag while arranging a layout is normal with
  // a pointer, and those users already have the Delete key.
  const startLongPress = useCallback((e: React.PointerEvent, widgetId: string) => {
    if (e.pointerType === 'mouse') return;
    cancelLongPress();
    const x = e.clientX;
    const y = e.clientY;
    const timer = window.setTimeout(() => {
      longPress.current = null;
      const selected = useStore.getState().selectedWidgetIds;
      // Long-pressing one of several selected widgets acts on the whole group.
      const ids = selected.includes(widgetId) && selected.length > 1 ? selected : [widgetId];
      setDeleteMenu({ ids, x, y });
    }, LONG_PRESS_MS);
    longPress.current = { x, y, timer };
  }, [cancelLongPress]);

  const moveLongPress = useCallback((e: React.PointerEvent) => {
    const lp = longPress.current;
    if (!lp) return;
    if (Math.abs(e.clientX - lp.x) > LONG_PRESS_SLOP || Math.abs(e.clientY - lp.y) > LONG_PRESS_SLOP) {
      cancelLongPress();
    }
  }, [cancelLongPress]);

  function confirmDelete(): void {
    if (!deleteMenu || !activePageId) return;
    captureHistory();
    deleteMenu.ids.forEach((id) => removeWidget(activePageId, id));
    setSelectedWidgetId(null);
    clearMultiSelection();
    setDeleteMenu(null);
  }

  return (
    <div
      ref={outerRef}
      style={styles.outer}
      onClick={(e) => {
        if (e.shiftKey) return;
        setSelectedWidgetId(null);
        clearMultiSelection();
      }}
      onDoubleClick={() => useStore.getState().openWidgetPicker()}
      // Ctrl+C/X/V/Z and Delete are React handlers on this div, so they only
      // fire while it holds focus. react-rnd calls preventDefault on the drag
      // mousedown, which stops the browser from focusing us when a widget is
      // clicked — so claim focus ourselves on any press that is not in a field.
      onPointerDownCapture={(e) => {
        const tag = (e.target as HTMLElement)?.tagName?.toLowerCase() ?? '';
        if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
        if (document.activeElement !== outerRef.current) outerRef.current?.focus({ preventScroll: true });
      }}
      onKeyDown={(e) => {
        if (editingWidgetId) return;
        const tag = (e.target as HTMLElement)?.tagName?.toLowerCase() ?? '';
        if (tag === 'input' || tag === 'textarea') return;
        if ((e.key === 'Delete' || e.key === 'Backspace')) {
          if (allSelectedIds.length > 0 && activePageId) {
            captureHistory();
            allSelectedIds.forEach((id) => removeWidget(activePageId, id));
            setSelectedWidgetId(null);
            clearMultiSelection();
          }
          return;
        }
        if (e.ctrlKey || e.metaKey) {
          // Caps Lock (or Shift) turns 'c' into 'C': the shortcut must not care.
          const key = e.key.toLowerCase();
          if (key === 'z') {
            undo();
            e.preventDefault();
          } else if (key === 'c' && allSelectedIds.length > 0) {
            const ws = (page?.widgets ?? []).filter((w) => allSelectedIds.includes(w.id));
            if (ws.length > 0) copyWidgets(ws);
            e.preventDefault();
          } else if (key === 'x' && allSelectedIds.length > 0 && activePageId) {
            cutWidgets(activePageId, allSelectedIds);
            e.preventDefault();
          } else if (key === 'v' && activePageId) {
            pasteWidgets(activePageId);
            e.preventDefault();
          }
        }
      }}
      tabIndex={0}
    >
      <div style={{
        position: 'absolute',
        top: '50%', left: '50%',
        width: pageWidth * scale,
        height: pageHeight * scale,
        transform: 'translate(-50%, -50%)',
      }}>
        <div ref={pageRef} style={{
          width: pageWidth,
          height: pageHeight,
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
          position: 'relative',
          background: page?.backgroundColor ?? '#000000',
          boxShadow: '0 0 0 1px var(--color-border), 0 8px 40px rgba(0,0,0,0.6)',
        }}
          onPointerDown={(e) => {
            // Start a marquee only on empty canvas (target is this div itself)
            if (e.target !== e.currentTarget || e.button !== 0 || e.shiftKey) return;
            const rect = e.currentTarget.getBoundingClientRect();
            marqueeRef.current = { x0: (e.clientX - rect.left) / scale, y0: (e.clientY - rect.top) / scale, moved: false };
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            const m = marqueeRef.current;
            if (!m) return;
            const rect = e.currentTarget.getBoundingClientRect();
            const x1 = (e.clientX - rect.left) / scale, y1 = (e.clientY - rect.top) / scale;
            m.moved = true;
            setMarquee({ x: Math.min(m.x0, x1), y: Math.min(m.y0, y1), w: Math.abs(x1 - m.x0), h: Math.abs(y1 - m.y0) });
          }}
          onPointerUp={() => {
            const m = marqueeRef.current;
            const box = marquee;
            marqueeRef.current = null;
            setMarquee(null);
            if (!m || !m.moved || !box || !page) return;
            justMarqueed.current = true;   // suppress the click that would deselect
            const ids = page.widgets.filter((w) =>
              w.rect.x < box.x + box.w && w.rect.x + w.rect.width > box.x &&
              w.rect.y < box.y + box.h && w.rect.y + w.rect.height > box.y
            ).map((w) => w.id);
            if (ids.length === 1) { setSelectedWidgetId(ids[0]); clearMultiSelection(); }
            else if (ids.length > 1) { useStore.setState({ selectedWidgetIds: ids, selectedWidgetId: null }); }
            else { setSelectedWidgetId(null); clearMultiSelection(); }
          }}
          onClick={(e) => { if (justMarqueed.current) { e.stopPropagation(); justMarqueed.current = false; } }}
        >
          {/* Cross grid — a cross every 3 snap steps, centred exactly on the
              snap points (0, 24, 48 …) so a snapped edge sits on them. */}
          <div style={{
            position: 'absolute', inset: 0, pointerEvents: 'none',
            backgroundImage: `url("data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect x="11" y="8" width="2" height="8" fill="#262626"/><rect x="8" y="11" width="8" height="2" fill="#262626"/></svg>')}")`,
            backgroundSize: '24px 24px',
            backgroundPosition: '-12px -12px',
          }} />

          {page?.widgets
            .slice()
            .sort((a, b) => {
              const layerOrder = { under: 0, normal: 1, over: 2 } as Record<string, number>;
              const la = (a.kind === 'imageWidget' || a.kind === 'textWidget') ? layerOrder[a.layer] : 1;
              const lb = (b.kind === 'imageWidget' || b.kind === 'textWidget') ? layerOrder[b.layer] : 1;
              return la !== lb ? la - lb : a.zIndex - b.zIndex;
            })
            .map((widget) => {
              const isSingleSelected = widget.id === selectedWidgetId;
              const isMultiSelected  = selectedWidgetIds.includes(widget.id);

              return (
                <Rnd
                  key={widget.id}
                  position={{ x: widget.rect.x, y: widget.rect.y }}
                  size={{ width: widget.rect.width, height: widget.rect.height }}
                  scale={scale}
                  // With a multi-selection, the group box (below) owns resizing so
                  // everything scales as one body; individual handles are disabled.
                  enableResizing={!(isMultiSelected && selectedWidgetIds.length > 1)}
                  dragGrid={[GRID_SNAP_PX, GRID_SNAP_PX]}
                  resizeGrid={[GRID_SNAP_PX, GRID_SNAP_PX]}
                  minWidth={80}
                  minHeight={60}
                  bounds="parent"
                  disableDragging={shiftHeld}
                  onDragStart={() => {
                    captureHistory();
                    if (!isSingleSelected && !isMultiSelected) {
                      setSelectedWidgetId(widget.id);
                      clearMultiSelection();
                    }
                    if (activePageId) bringWidgetToFront(activePageId, widget.id);
                    // Snapshot all selected widget positions for group move
                    const currentIds = useStore.getState().selectedWidgetIds;
                    const ids = currentIds.includes(widget.id) ? currentIds : [widget.id];
                    const snap: Record<string, { x: number; y: number }> = {};
                    page?.widgets.forEach((w) => {
                      if (ids.includes(w.id)) snap[w.id] = { x: w.rect.x, y: w.rect.y };
                    });
                    multiDragStartPositions.current = snap;
                  }}
                  // Rnd only animates the widget you grabbed. Without this the
                  // rest of the selection sat still until the drop, so you were
                  // aiming a group move while seeing only one piece of it.
                  // The grabbed one is left to Rnd — writing its position here
                  // would fight the drag it is already running.
                  onDrag={(_e, d) => {
                    if (!activePageId) return;
                    const liveIds = useStore.getState().selectedWidgetIds;
                    if (liveIds.length <= 1 || !liveIds.includes(widget.id)) return;
                    const origPos = multiDragStartPositions.current[widget.id];
                    if (!origPos) return;
                    const dx = d.x - origPos.x;
                    const dy = d.y - origPos.y;
                    for (const id of liveIds) {
                      if (id === widget.id) continue;
                      const start = multiDragStartPositions.current[id];
                      if (start) {
                        updateWidgetRect(activePageId, id, {
                          x: Math.max(0, start.x + dx),
                          y: Math.max(0, start.y + dy),
                        });
                      }
                    }
                  }}
                  onResizeStart={() => {
                    captureHistory();
                    const liveIds = useStore.getState().selectedWidgetIds;
                    if (liveIds.includes(widget.id) && liveIds.length > 1) {
                      // Group resize — snapshot all selected rects + group origin
                      const rects: Record<string, { x: number; y: number; width: number; height: number }> = {};
                      let ox = Infinity, oy = Infinity;
                      page?.widgets.forEach((w) => {
                        if (liveIds.includes(w.id)) {
                          rects[w.id] = { ...w.rect };
                          ox = Math.min(ox, w.rect.x);
                          oy = Math.min(oy, w.rect.y);
                        }
                      });
                      multiResizeStart.current = { origin: { x: ox, y: oy }, rects, base: { w: widget.rect.width, h: widget.rect.height } };
                    } else {
                      multiResizeStart.current = null;
                      setSelectedWidgetId(widget.id);
                      clearMultiSelection();
                    }
                  }}
                  onDragStop={(_e, d) => {
                    if (!activePageId) return;
                    const liveIds = useStore.getState().selectedWidgetIds;
                    const isCurrentMulti = liveIds.includes(widget.id);
                    if (isCurrentMulti && liveIds.length > 1) {
                      const origPos = multiDragStartPositions.current[widget.id];
                      if (origPos) {
                        const dx = Math.round((d.x - origPos.x) / GRID_SNAP_PX) * GRID_SNAP_PX;
                        const dy = Math.round((d.y - origPos.y) / GRID_SNAP_PX) * GRID_SNAP_PX;
                        liveIds.forEach((id) => {
                          const startPos = multiDragStartPositions.current[id];
                          if (startPos) {
                            const r = page?.widgets.find((w) => w.id === id)?.rect;
                            updateWidgetRect(activePageId, id, {
                              x: snapIn(startPos.x + dx, r?.width ?? 0, pageWidth),
                              y: snapIn(startPos.y + dy, r?.height ?? 0, pageHeight),
                            });
                          }
                        });
                      }
                    } else {
                      updateWidgetRect(activePageId, widget.id, {
                        x: snapIn(d.x, widget.rect.width, pageWidth),
                        y: snapIn(d.y, widget.rect.height, pageHeight),
                      });
                    }
                  }}
                  onResizeStop={(_e, _dir, ref, _delta, pos) => {
                    if (!activePageId) return;
                    const grp = multiResizeStart.current;
                    if (grp) {
                      // Scale every selected widget by the dragged widget's ratio,
                      // keeping their relative layout around the group's top-left.
                      const rx = ref.offsetWidth  / grp.base.w;
                      const ry = ref.offsetHeight / grp.base.h;
                      for (const [id, r] of Object.entries(grp.rects)) {
                        const width  = Math.max(GRID_SNAP_PX * 5, snap(r.width  * rx));
                        const height = Math.max(GRID_SNAP_PX * 4, snap(r.height * ry));
                        updateWidgetRect(activePageId, id, {
                          x: snapIn(grp.origin.x + (r.x - grp.origin.x) * rx, width, pageWidth),
                          y: snapIn(grp.origin.y + (r.y - grp.origin.y) * ry, height, pageHeight),
                          width, height,
                        });
                      }
                      multiResizeStart.current = null;
                    } else {
                      // Snap both edges, so a widget resized from its left or top
                      // keeps its far edge where it was.
                      const x0 = snap(pos.x), y0 = snap(pos.y);
                      const x1 = snap(pos.x + ref.offsetWidth), y1 = snap(pos.y + ref.offsetHeight);
                      updateWidgetRect(activePageId, widget.id, {
                        x: x0, y: y0,
                        width:  Math.min(pageWidth - x0, Math.max(80, x1 - x0)),
                        height: Math.min(pageHeight - y0, Math.max(60, y1 - y0)),
                      });
                    }
                  }}
                  style={{
                    outline: isSingleSelected
                      ? '2px solid var(--color-accent)'
                      : isMultiSelected
                        ? `2px solid ${pal('#91ced2')}`
                        : '1px solid rgba(255,255,255,0.5)',
                    borderRadius: widget.style.borderRadius,
                  }}
                >
                  <div
                    style={{ width: '100%', height: '100%', position: 'relative' }}
                    onDoubleClick={(e) => e.stopPropagation()}
                    onPointerDown={(e) => startLongPress(e, widget.id)}
                    onPointerMove={moveLongPress}
                    onPointerUp={cancelLongPress}
                    onPointerCancel={cancelLongPress}
                    // Windows fires a native context menu on touch-hold; ours replaces it.
                    onContextMenu={(e) => e.preventDefault()}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (e.shiftKey) {
                        // Include previously single-selected widget in multi-select.
                        // NOTE: don't call setSelectedWidgetId(null) here — that action
                        // also clears selectedWidgetIds, wiping the multi-selection.
                        // toggleWidgetSelection already nulls the single selection.
                        const prevSingle = useStore.getState().selectedWidgetId;
                        if (prevSingle && prevSingle !== widget.id) {
                          toggleWidgetSelection(prevSingle);
                        }
                        toggleWidgetSelection(widget.id);
                      } else {
                        setSelectedWidgetId(widget.id);
                        clearMultiSelection();
                      }
                    }}
                  >
                    <WidgetPreview widget={widget} />
                    {isSingleSelected && (widget.kind === 'sliderBank' || widget.kind === 'buttonGrid' || widget.kind === 'knobBank') && (
                      <button
                        style={{
                          ...styles.editBtn,
                          // The canvas is scaled, so a fixed size shrinks with the
                          // zoom — at 49% a 44px target is 21px on screen. Undo the
                          // canvas scale so the button stays a real finger target
                          // whatever the zoom.
                          transform: `scale(${1 / Math.max(scale, 0.05)})`,
                          transformOrigin: 'top right',
                        }}
                        // On touch, react-rnd claims the press as the start of a
                        // drag and the click never lands. Keep the press to
                        // ourselves so the button actually fires.
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingWidgetId(widget.id);
                        }}
                      >
                        ✏ Edit
                      </button>
                    )}
                    {isMultiSelected && (
                      <div style={{
                        position: 'absolute', inset: 0,
                        background: `rgba(${palRgb('#91ced2')},0.05)`,
                        pointerEvents: 'none',
                      }} />
                    )}
                  </div>
                </Rnd>
              );
            })}

          {/* Group resize box — scales the whole multi-selection as one body */}
          {page && activePageId && selectedWidgetIds.length > 1 && (
            <GroupResizeBox
              widgets={page.widgets.filter((w) => selectedWidgetIds.includes(w.id))}
              scale={scale}
              activePageId={activePageId}
              pageW={pageWidth}
              pageH={pageHeight}
            />
          )}

          {/* Marquee selection rectangle */}
          {marquee && (
            <div style={{
              position: 'absolute', left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h,
              border: `${1 / scale}px solid ${pal('#91ced2')}`, background: `rgba(${palRgb('#91ced2')},0.12)`,
              pointerEvents: 'none', zIndex: 998,
            }} />
          )}
        </div>
      </div>

      <div style={styles.scaleHint}>
        {pageWidth}×{pageHeight} — {Math.round(scale * 100)}%
        {selectedWidgetIds.length > 1 && (
          <span style={{ marginLeft: 8, color: pal('#91ced2') }}>{selectedWidgetIds.length} selected</span>
        )}
      </div>

      {deleteMenu && (
        <>
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 2000 }}
            onPointerDown={() => setDeleteMenu(null)}
            onClick={(e) => e.stopPropagation()}
          />
          <div
            style={{
              position: 'fixed', zIndex: 2001,
              // Keep the popup on screen when the widget is near an edge.
              left: Math.min(deleteMenu.x, window.innerWidth - 200),
              top: Math.min(deleteMenu.y, window.innerHeight - 130),
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: 6, padding: 8, width: 180,
              boxShadow: '0 8px 30px rgba(0,0,0,0.7)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <button style={styles.menuDelete} onClick={confirmDelete}>
              🗑 Delete {deleteMenu.ids.length > 1 ? `${deleteMenu.ids.length} widgets` : 'widget'}
            </button>
            <button style={styles.menuCancel} onClick={() => setDeleteMenu(null)}>
              Cancel
            </button>
          </div>
        </>
      )}

      {isWidgetPickerOpen && <WidgetPicker />}
      <PlacementLayer pageRef={pageRef} scale={scale} />
      {editingWidgetId && activePageId && (
        <CellEditModal
          widgetId={editingWidgetId}
          pageId={activePageId}
          onClose={() => setEditingWidgetId(null)}
        />
      )}
    </div>
  );
}

const LONG_PRESS_MS = 2000;
// How far a finger may drift before the hold counts as a drag instead.
const LONG_PRESS_SLOP = 12;

const make_styles = (): Record<string, React.CSSProperties> => ({
  outer: {
    flex: 1, position: 'relative', overflow: 'hidden', outline: 'none',
    background: 'var(--color-bg)',
  },
  menuDelete: {
    width: '100%', minHeight: 44, marginBottom: 6,
    background: pal('#3a291a'), color: pal('#ffb06b'),
    border: `1px solid ${pal('#d97a26')}`, borderRadius: 4,
    fontSize: 14, fontWeight: 600, cursor: 'pointer',
  },
  menuCancel: {
    width: '100%', minHeight: 40,
    background: 'var(--color-surface-2)', color: 'var(--color-text-dim)',
    border: '1px solid var(--color-border)', borderRadius: 4,
    fontSize: 13, cursor: 'pointer',
  },
  editBtn: {
    position: 'absolute', top: 4, right: 4,
    background: 'rgba(0,0,0,0.85)',
    border: '1px solid var(--color-accent)',
    color: 'var(--color-accent)',
    borderRadius: 6, padding: '0 14px',
    minHeight: 44, minWidth: 96,
    fontSize: 15, fontWeight: 600, fontFamily: 'inherit',
    cursor: 'pointer', zIndex: 10,
    touchAction: 'manipulation',
  },
  scaleHint: {
    position: 'absolute', bottom: 8, right: 10,
    fontSize: 10, color: 'var(--color-text-dim)',
    pointerEvents: 'none',
  },
});
let styles: Record<string, React.CSSProperties> = make_styles();
onPalette(() => { styles = make_styles(); });

// ─── Group resize box ─────────────────────────────────────────────────────────
// A selection bounding box with corner handles. Dragging a handle scales EVERY
// selected widget as one rigid body around the opposite corner (the anchor), so
// the whole group grows/shrinks together and stays glued.
type Corner = 'nw' | 'ne' | 'sw' | 'se';

function GroupResizeBox({ widgets, scale, activePageId, pageW, pageH }: {
  widgets: Widget[];
  scale: number;
  activePageId: string;
  pageW: number;
  pageH: number;
}): React.JSX.Element | null {
  const updateWidgetRect = useStore((s) => s.updateWidgetRect);
  const captureHistory   = useStore((s) => s.captureHistory);
  const drag = useRef<{
    anchorX: number; anchorY: number; bw: number; bh: number; corner: Corner;
    startX: number; startY: number;
    rects: { id: string; x: number; y: number; width: number; height: number }[];
  } | null>(null);

  if (widgets.length < 2) return null;

  const minX = Math.min(...widgets.map((w) => w.rect.x));
  const minY = Math.min(...widgets.map((w) => w.rect.y));
  const maxX = Math.max(...widgets.map((w) => w.rect.x + w.rect.width));
  const maxY = Math.max(...widgets.map((w) => w.rect.y + w.rect.height));
  const bw = Math.max(1, maxX - minX);
  const bh = Math.max(1, maxY - minY);

  function start(e: React.PointerEvent, corner: Corner) {
    e.stopPropagation();
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    captureHistory();
    drag.current = {
      corner,
      anchorX: corner.includes('w') ? maxX : minX,   // opposite corner stays fixed
      anchorY: corner.includes('n') ? maxY : minY,
      bw, bh,
      startX: e.clientX, startY: e.clientY,
      rects: widgets.map((w) => ({ id: w.id, ...w.rect })),
    };
  }
  function move(e: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.startX) / scale;   // screen px → page px
    const dy = (e.clientY - d.startY) / scale;
    const rawW = d.corner.includes('e') ? d.bw + dx : d.bw - dx;
    const rawH = d.corner.includes('s') ? d.bh + dy : d.bh - dy;
    // Clamp the GROUP scale (not each widget) so the whole thing stays a rigid
    // body — proportional scaling can never make non-overlapping widgets overlap.
    // The floor keeps the smallest widget at/above the min size.
    const minW = Math.min(...d.rects.map((r) => r.width));
    const minH = Math.min(...d.rects.map((r) => r.height));
    // Max scale keeps the whole group inside the page: from the fixed anchor,
    // the group can only grow until its far edge reaches the page border.
    const maxSx = (d.corner.includes('e') ? (pageW - d.anchorX) : d.anchorX) / d.bw;
    const maxSy = (d.corner.includes('s') ? (pageH - d.anchorY) : d.anchorY) / d.bh;
    const sx = Math.min(maxSx, Math.max(40 / minW, rawW / d.bw));
    const sy = Math.min(maxSy, Math.max(30 / minH, rawH / d.bh));
    for (const r of d.rects) {
      updateWidgetRect(activePageId, r.id, {
        x: Math.round(d.anchorX + (r.x - d.anchorX) * sx),
        y: Math.round(d.anchorY + (r.y - d.anchorY) * sy),
        width:  Math.round(r.width  * sx),
        height: Math.round(r.height * sy),
      });
    }
  }
  function end() { drag.current = null; }

  const hs = Math.max(8, 12 / scale);   // keep handles grabbable at any zoom
  const bw2 = 2 / scale;
  const corners: { c: Corner; left: number; top: number; cursor: string }[] = [
    { c: 'nw', left: 0,  top: 0,  cursor: 'nwse-resize' },
    { c: 'ne', left: bw, top: 0,  cursor: 'nesw-resize' },
    { c: 'sw', left: 0,  top: bh, cursor: 'nesw-resize' },
    { c: 'se', left: bw, top: bh, cursor: 'nwse-resize' },
  ];

  return (
    <div style={{
      position: 'absolute', left: minX, top: minY, width: bw, height: bh,
      border: `${bw2}px dashed ${pal('#91ced2')}`, boxSizing: 'border-box',
      pointerEvents: 'none', zIndex: 999,
    }}>
      {corners.map((h) => (
        <div
          key={h.c}
          onPointerDown={(e) => start(e, h.c)}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
          onClick={(e) => e.stopPropagation()}   // keep the group selected after resizing
          style={{
            position: 'absolute', left: h.left, top: h.top,
            width: hs, height: hs, marginLeft: -hs / 2, marginTop: -hs / 2,
            background: pal('#91ced2'), border: `${bw2}px solid #fff`, borderRadius: 2,
            cursor: h.cursor, pointerEvents: 'auto', zIndex: 1000,
          }}
        />
      ))}
    </div>
  );
}
