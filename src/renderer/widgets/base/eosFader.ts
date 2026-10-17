import type { Mapping, OscMapping } from '../../../shared/types/mapping';
import { eosFaderAddresses, eosConfigOf } from '../../../shared/types/mapping';
import type { Widget } from '../../../shared/types/project';
import { sendEosConfig } from '../../ipc/dispatch';

// Eos faders from ordinary sliders / knobs / buttons. A cell is put on a desk
// fader by number (1 … 100): the OSC address and the bank config message follow
// from it (fader 11 = page 2, position 1 → /eos/fader/<bank>/1 after
// /eos/fader/<bank>/config/2/10). One bank shows one page of ten, so a widget
// whose cells span two pages needs two banks.

/** Put one OSC mapping on an Eos fader (0 / undefined = take it off). */
export function withEosFader(m: Mapping | null | undefined, fader: number | undefined, bank?: number): Mapping | null | undefined {
  if (!m || m.type !== 'osc') return m;
  const out: OscMapping = { ...m };
  if (!fader || fader < 1) {
    delete out.eosFader; delete out.eosBank; delete out.eosConfig;
    return out;
  }
  const f = Math.max(1, Math.min(100, Math.round(fader)));
  const b = Math.max(1, Math.round(bank ?? m.eosBank ?? 1));
  const a = eosFaderAddresses(f, b);
  out.eosFader = f;
  out.eosBank = b;
  out.address = a.address;
  // A hand-edited config string is kept only while it still fits this fader.
  if (!out.eosConfig || out.eosConfig === eosFaderAddresses(m.eosFader ?? f, m.eosBank ?? b).config) out.eosConfig = a.config;
  return out;
}

/** Every OSC mapping of a widget, in cell order (for the widget-wide row). */
export function widgetOscMappings(w: Widget): OscMapping[] {
  const any = w as unknown as { mapping?: Mapping | null; cells?: { mapping?: Mapping | null }[] };
  const list = any.cells ? any.cells.map((c) => c?.mapping) : [any.mapping];
  return list.filter((m): m is OscMapping => !!m && m.type === 'osc');
}

/** Widget-wide: first fader number and bank (from the first cell on an Eos fader). */
export function widgetEosFader(w: Widget): { first: number; bank: number } | null {
  for (const m of widgetOscMappings(w)) if (m.eosFader) return { first: m.eosFader, bank: m.eosBank ?? 1 };
  return null;
}

/** The patch that puts a widget's cells on consecutive Eos faders from `first` (0 = off). */
export function setWidgetEosFaderPatch(w: Widget, first: number, bank: number): Record<string, unknown> {
  const any = w as unknown as { mapping?: Mapping | null; cells?: { mapping?: Mapping | null }[] };
  const patch: Record<string, unknown> = {};
  if (any.cells) patch.cells = any.cells.map((c, i) => ({ ...c, mapping: withEosFader(c?.mapping, first ? first + i : undefined, bank) }));
  else if (any.mapping) patch.mapping = withEosFader(any.mapping, first || undefined, bank);
  return patch;
}

/** Send the bank config of every Eos fader cell of a widget, now. */
export function sendWidgetEosConfigs(w: Widget): number {
  const sent = new Set<string>();
  for (const m of widgetOscMappings(w)) {
    const cfg = eosConfigOf(m);
    if (!cfg || sent.has(cfg)) continue;
    sent.add(cfg);
    sendEosConfig(cfg, m.user, m.outputId, true);
  }
  return sent.size;
}

/** Send one mapping's config, now. */
export function sendMappingEosConfig(m: OscMapping): void {
  const cfg = eosConfigOf(m);
  if (cfg) sendEosConfig(cfg, m.user, m.outputId, true);
}
