import type { Mapping, OscMapping } from '../../../shared/types/mapping';
import type { Widget } from '../../../shared/types/project';

// OSC output scale. A slider's value is 0–1 inside Maestrale; on OSC it can
// go out as 0–1, 0–10 or 0–100, as a float or as a whole number (TouchDesigner
// wants 0–1 floats, a lighting desk 0–100 ints, a Resolume layer 0–100…).
// It lives on each OscMapping (minValue / maxValue / argType) so dispatch,
// which only sees the mapping, needs nothing else; these helpers read and
// write it for a whole widget at once.

export type OscRange = 1 | 10 | 100;
export type OscArg = 'f' | 'i';

export const OSC_RANGES: OscRange[] = [1, 10, 100];

export interface OscScale { range: OscRange | 'custom'; min: number; max: number; argType: OscArg }

export function oscScaleOf(m: OscMapping | null | undefined): OscScale {
  const min = m?.minValue ?? 0;
  const max = m?.maxValue ?? 1;
  const range: OscRange | 'custom' =
    min === 0 && (OSC_RANGES as number[]).includes(max) ? (max as OscRange) : 'custom';
  return { range, min, max, argType: m?.argType === 'i' ? 'i' : 'f' };
}

/** Write a range (0–N) and/or type into one OSC mapping; other mappings pass through. */
export function withOscScale(m: Mapping | null | undefined, p: { range?: OscRange; argType?: OscArg }): Mapping | null | undefined {
  if (!m || m.type !== 'osc') return m;
  const out: OscMapping = { ...m };
  if (p.range !== undefined) { out.minValue = 0; out.maxValue = p.range; }
  if (p.argType !== undefined) {
    if (p.argType === 'i') out.argType = 'i'; else delete out.argType;
  }
  return out;
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

/** The scale of a widget's OSC outputs (the first one found). */
export function widgetOscScale(w: Widget): OscScale {
  for (const m of widgetMappings(w)) if (m && m.type === 'osc') return oscScaleOf(m);
  return oscScaleOf(null);
}

/** The patch that puts one range/type on every OSC output of a widget. */
export function setWidgetOscScalePatch(w: Widget, p: { range?: OscRange; argType?: OscArg }): Record<string, unknown> {
  const any = w as unknown as {
    mapping?: Mapping | null;
    cells?: { mapping?: Mapping | null }[];
    keys?: { mapping?: Mapping | null }[];
    mappingX?: Mapping | null; mappingY?: Mapping | null; mappingZ?: Mapping | null;
    points?: { mappingX?: Mapping | null; mappingY?: Mapping | null }[];
  };
  const f = (m: Mapping | null | undefined) => withOscScale(m, p);
  const patch: Record<string, unknown> = {};
  if (any.mapping) patch.mapping = f(any.mapping);
  if (any.mappingX) patch.mappingX = f(any.mappingX);
  if (any.mappingY) patch.mappingY = f(any.mappingY);
  if (any.mappingZ) patch.mappingZ = f(any.mappingZ);
  if (any.cells) patch.cells = any.cells.map((c) => ({ ...c, mapping: f(c?.mapping) }));
  if (any.keys) patch.keys = any.keys.map((k) => ({ ...k, mapping: f(k?.mapping) }));
  if (any.points) patch.points = any.points.map((p2) => ({ ...p2, mappingX: f(p2?.mappingX), mappingY: f(p2?.mappingY) }));
  return patch;
}
