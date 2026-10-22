import React, { createContext, useContext, useEffect, useLayoutEffect, useState } from 'react';

// Parameter tabs, shared by the Design inspector and the Live sidebar.
//
// A widget's parameters are long: position, label, colours, frame, its own
// settings, its outputs… scrolling through them all to reach one is slow. So
// every section sorts itself into one of three tabs, the same on every widget:
//   WIDGET  what this kind of widget does (waveform, tracks, cells…)
//   LOOK    label, position, colours, frame, title & edge, fonts
//   OUTPUT  protocol, mappings, triggers, axes
// A section picks its tab from its own heading (tabOfLabel), so the panels
// did not have to be rewritten; a tab with nothing in it is not shown, and
// with a single tab there is no bar at all. The chosen tab is kept while you
// click from widget to widget.

export type ParamTab = 'Widget' | 'Look' | 'Output';
export const PARAM_TABS: ParamTab[] = ['Widget', 'Look', 'Output'];

const LOOK = new Set([
  'label', 'name', 'position', 'style', 'frame', 'title & edge', 'display', 'layer', 'font', 'text size',
  'opacity', 'colour', 'colours', 'color', 'colors', 'orientation', 'knob size', 'grid', 'blend mode', 'layout',
  'shape', 'size', 'look',
]);
const OUTPUT_WORDS = ['output', 'mapping', 'trigger', 'protocol', 'axis', 'z slider', 'eos osc', 'scales protocol'];

export function tabOfLabel(label: string): ParamTab {
  const l = label.trim().toLowerCase();
  if (LOOK.has(l)) return 'Look';
  if (OUTPUT_WORDS.some((w) => l.includes(w))) return 'Output';
  return 'Widget';
}

interface Ctx {
  active: ParamTab;
  register: (tab: ParamTab) => () => void;
}
const TabCtx = createContext<Ctx | null>(null);

// Remembered across widgets and across Design / Live.
let remembered: ParamTab = 'Widget';

/** Whether a section with this heading (or explicit tab) is hidden right now. */
export function useParamTab(label: string, tab?: ParamTab): boolean {
  const ctx = useContext(TabCtx);
  const mine = tab ?? tabOfLabel(label);
  useLayoutEffect(() => (ctx ? ctx.register(mine) : undefined), [ctx, mine]);
  return !!ctx && ctx.active !== mine;
}

export function ParamTabs({ children, style, dark = false }: {
  children: React.ReactNode;
  style?: React.CSSProperties;
  dark?: boolean;    // the Live sidebar's darker palette
}): React.JSX.Element {
  const [counts, setCounts] = useState<Record<ParamTab, number>>({ Widget: 0, Look: 0, Output: 0 });
  const [active, setActiveState] = useState<ParamTab>(remembered);
  const setActive = (t: ParamTab): void => { remembered = t; setActiveState(t); };

  const register = React.useCallback((tab: ParamTab) => {
    setCounts((c) => ({ ...c, [tab]: c[tab] + 1 }));
    return () => setCounts((c) => ({ ...c, [tab]: Math.max(0, c[tab] - 1) }));
  }, []);

  const present = PARAM_TABS.filter((t) => counts[t] > 0);
  // The remembered tab is empty on this widget: fall to the first one that has
  // something, without forgetting the choice for the next widget.
  const shown: ParamTab = present.includes(active) ? active : (present[0] ?? active);
  useEffect(() => { if (present.length && !present.includes(active)) setActiveState(shown); }, [present.join(), active, shown]);

  const ctx = React.useMemo<Ctx>(() => ({ active: shown, register }), [shown, register]);

  return (
    <TabCtx.Provider value={ctx}>
      {present.length > 1 && (
        <div style={{
          display: 'flex', gap: 2, marginBottom: 12, position: 'sticky', top: 0, zIndex: 2,
          background: dark ? '#090909' : 'var(--color-surface)', padding: dark ? '0 12px 6px' : '0 0 6px',
          ...style,
        }}>
          {present.map((t) => {
            const on = t === shown;
            return (
              <button key={t} onClick={() => setActive(t)}
                style={{
                  flex: 1, minHeight: 28, cursor: 'pointer', fontFamily: 'inherit',
                  fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase',
                  color: on ? (dark ? '#ddd' : 'var(--color-text)') : (dark ? '#555' : 'var(--color-text-dim)'),
                  background: on ? (dark ? '#1a1a1a' : 'var(--color-surface-2)') : 'transparent',
                  border: `1px solid ${on ? (dark ? '#2a2a2a' : 'var(--color-border)') : 'transparent'}`,
                  borderBottom: on ? '2px solid var(--color-accent)' : '2px solid transparent',
                  borderRadius: 'var(--radius-sm, 3px)', touchAction: 'manipulation',
                }}>
                {t}
              </button>
            );
          })}
        </div>
      )}
      {children}
    </TabCtx.Provider>
  );
}
