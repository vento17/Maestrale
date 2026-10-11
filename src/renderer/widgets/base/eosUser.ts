import type { Mapping } from '../../../shared/types/mapping';
import type { Widget } from '../../../shared/types/project';

// Eos "user". On an Eos desk every user has their own selection and command
// line, so Maestrale sending as user 3 can work while someone else works on the
// console without the two stealing each other's channels. Every Eos address
// takes the user right after /eos:  /eos/key/go_0 → /eos/user/3/key/go_0.
// 0 (or nothing) = the same user as the console, as before.

export function eosAddress(address: string, user?: number): string {
  const u = Math.round(user ?? 0);
  if (!u || u < 1) return address;
  if (!address.startsWith('/eos/')) return address;          // not an Eos message
  if (address.startsWith('/eos/user/')) return address;      // already carries one
  return `/eos/user/${u}${address.slice(4)}`;
}

/** The user set on a widget's outputs (the first one found). */
export function widgetEosUser(w: Widget): number {
  const ms = widgetMappings(w);
  for (const m of ms) if (m && m.type === 'osc' && m.user) return m.user;
  return 0;
}

function widgetMappings(w: Widget): (Mapping | null | undefined)[] {
  const any = w as unknown as {
    mapping?: Mapping | null;
    cells?: { mapping?: Mapping | null }[];
    keys?: { mapping?: Mapping | null }[];
    mappingX?: Mapping | null; mappingY?: Mapping | null; mappingZ?: Mapping | null;
    points?: { mappingX?: Mapping | null; mappingY?: Mapping | null }[];
  };
  return [
    any.mapping, any.mappingX, any.mappingY, any.mappingZ,
    ...(any.cells ?? []).map((c) => c?.mapping),
    ...(any.keys ?? []).map((k) => k?.mapping),
    ...(any.points ?? []).flatMap((p) => [p?.mappingX, p?.mappingY]),
  ];
}

const withUser = (m: Mapping | null | undefined, user: number): Mapping | null | undefined =>
  (m && m.type === 'osc' ? ({ ...m, user: user || undefined } as Mapping) : m);

/** The patch that puts one Eos user on every OSC output of a widget. */
export function setWidgetEosUserPatch(w: Widget, user: number): Record<string, unknown> {
  const any = w as unknown as {
    mapping?: Mapping | null;
    cells?: { mapping?: Mapping | null }[];
    keys?: { mapping?: Mapping | null }[];
    mappingX?: Mapping | null; mappingY?: Mapping | null; mappingZ?: Mapping | null;
    points?: { mappingX?: Mapping | null; mappingY?: Mapping | null }[];
  };
  const patch: Record<string, unknown> = {};
  if (any.mapping) patch.mapping = withUser(any.mapping, user);
  if (any.mappingX) patch.mappingX = withUser(any.mappingX, user);
  if (any.mappingY) patch.mappingY = withUser(any.mappingY, user);
  if (any.mappingZ) patch.mappingZ = withUser(any.mappingZ, user);
  if (any.cells) patch.cells = any.cells.map((c) => ({ ...c, mapping: withUser(c?.mapping, user) }));
  if (any.keys) patch.keys = any.keys.map((k) => ({ ...k, mapping: withUser(k?.mapping, user) }));
  if (any.points) patch.points = any.points.map((p) => ({ ...p, mappingX: withUser(p?.mappingX, user), mappingY: withUser(p?.mappingY, user) }));
  return patch;
}

/** Does this widget send anything to an Eos desk (an /eos/… address)? */
export function sendsToEos(w: Widget): boolean {
  if (w.kind === 'etc' || w.kind === 'encoder') return true;
  return widgetMappings(w).some((m) => m && m.type === 'osc' && m.address.startsWith('/eos/'));
}
