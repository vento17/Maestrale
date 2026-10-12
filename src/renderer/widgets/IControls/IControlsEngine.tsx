import { useEffect } from 'react';
import type { IControlsWidget } from '../../../shared/types/project';
import { useStore } from '../../store';
import { bridge } from '../../ipc/bridge';
import { clamp } from '../utils';
import {
  FADER_COUNT, KNOB_COUNT, PAGE_NEXT_NOTE, PAGE_PREV_NOTE,
  faderCell, knobCell, buttonCell, relativeTicks, pitchBendValue,
  pageAt, pageCount, knobCcsOf, faderCcsOf, buttonsOf,
} from './iControlsMidi';
import { bankOf, stepBank, learnState, learnCc, learnNote } from './iControlsBank';

// The surface drives its widget wherever that widget lives. This listener used
// to sit inside IControlsLive, and React unmounts a widget as soon as another
// page is on screen — so an iControls built on page 1 went deaf the moment you
// looked at page 2, with no sign anything was wrong. Everything is handled here
// instead, across every page of the project at once.
//
// Only the widget page matching the layer the surface is on is read. Two layers
// are free to use the same CC for different things, which on a real unit they
// do, and that is exactly why the routing cannot be global.
export default function IControlsEngine(): null {
  useEffect(() => bridge.on('tr:midi:inputEvent', (evt) => {
    const st = useStore.getState();
    const widgets: { w: IControlsWidget; pageId: string }[] = [];
    for (const p of st.project.pages) {
      for (const w of p.widgets) if (w.kind === 'iControls') widgets.push({ w: w as IControlsWidget, pageId: p.id });
    }
    if (widgets.length === 0) return;

    // A Learn run swallows what it is given: while learning, the surface is
    // being described, not played.
    const ls = learnState();
    if (ls) {
      const row = evt.messageType === 'controlChange'
        ? learnCc(evt.number)
        : (evt.messageType === 'noteOn' && evt.value > 0 ? learnNote(evt.number) : null);
      if (row) {
        const hit = widgets.find((x) => x.w.id === ls.widgetId);
        if (hit) {
          const pages = (hit.w.pages ?? []).map((p, i) => {
            if (i !== ls.page) return p;
            if (ls.what === 'faders') return { ...p, faderMode: 'cc' as const, faderCcs: row };
            if (ls.what === 'knobs') return { ...p, knobCcs: row };
            const bs = buttonsOf(p).slice();
            row.forEach((n, j) => { if (ls.from + j < bs.length) bs[ls.from + j] = { ...bs[ls.from + j], note: n }; });
            return { ...p, buttons: bs };
          });
          st.updateWidget(hit.pageId, hit.w.id, { pages } as never);
        }
      }
      return;
    }

    for (const { w } of widgets) {
      const pageIndex = bankOf(w.id);
      const cfg = pageAt(w, pageIndex);

      // The Layer buttons are read whatever page is live, or a page whose
      // channel filter does not match would be a dead end.
      if (evt.messageType === 'noteOn' && evt.value > 0) {
        const noteCh = w.pageNoteChannel ?? 1;
        if (!noteCh || evt.channel === noteCh) {
          if (evt.number === (w.pageNextNote ?? PAGE_NEXT_NOTE)) { stepBank(w.id, +1, pageCount(w)); continue; }
          if (evt.number === (w.pagePrevNote ?? PAGE_PREV_NOTE)) { stepBank(w.id, -1, pageCount(w)); continue; }
        }
      }

      // Faders: Pitch Bend carries the strip in its channel, so the page's
      // channel filter cannot apply to it.
      if (evt.messageType === 'pitchBend') {
        if (cfg.faderMode !== 'pitchBend') continue;
        const f = evt.channel - 1;
        if (f < 0 || f >= FADER_COUNT) continue;
        st.setCellValue(w.id, faderCell(f, pageIndex), pitchBendValue(evt.number, evt.value));
        continue;
      }

      const wantCh = cfg.channel ?? 0;
      if (wantCh && evt.channel !== wantCh) continue;

      // Buttons, and the touch-sensitive fader caps (those are only a light).
      if (evt.messageType === 'noteOn' || evt.messageType === 'noteOff') {
        const on = evt.messageType === 'noteOn' && evt.value > 0;
        buttonsOf(cfg).forEach((b, i) => {
          if (!b.note || b.note !== evt.number) return;
          st.setCellValue(w.id, buttonCell(i, pageIndex), on ? 1 : 0);
        });
        continue;
      }

      if (evt.messageType !== 'controlChange') continue;

      // Faders on a CC layer: absolute, 0–127.
      if (cfg.faderMode === 'cc') {
        const f = faderCcsOf(cfg).indexOf(evt.number);
        if (f >= 0 && f < FADER_COUNT) { st.setCellValue(w.id, faderCell(f, pageIndex), evt.value / 127); continue; }
      }

      const k = knobCcsOf(cfg).indexOf(evt.number);
      if (k < 0 || k >= KNOB_COUNT) continue;
      const cell = knobCell(k, pageIndex);
      if (cfg.knobMode === 'absolute') {
        st.setCellValue(w.id, cell, evt.value / 127);
      } else {
        const ticks = relativeTicks(evt.value);
        if (ticks === 0) continue;
        const step = w.knobStep > 0 ? w.knobStep : 1 / 127;
        const cur = useStore.getState().runtime.widgets[w.id]?.cells[cell]?.value ?? 0;
        st.setCellValue(w.id, cell, clamp(cur + ticks * step, 0, 1));
      }
    }
  }), []);

  return null;
}
