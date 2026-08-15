import { z } from 'zod';

/**
 * The eighteen canonical data-contract shapes (04-widget-registry.md §3).
 * Server payloads and widget data contracts discriminate on these keys.
 */
export const DATA_SHAPES = [
  'single-metric',
  'metric+delta',
  'timeseries',
  'multi-timeseries',
  'categorical',
  'record-list',
  'record',
  'matrix',
  'hierarchy/tree',
  'calendar-events',
  'geo-points',
  'flows',
  'ohlc',
  'distribution',
  'boolean-map',
  'stream',
  'form-state',
  'static',
] as const;

export const dataShapeSchema = z.enum(DATA_SHAPES);

export type DataShape = z.infer<typeof dataShapeSchema>;

/**
 * The subset of {@link DATA_SHAPES} the widget-data query compiler can actually
 * produce today (04 §5.2 "M4 scope notes"; the rest reject with 422 until
 * 04-T09/T10 land). SINGLE SOURCE OF TRUTH for that boundary:
 *
 *  - `apps/server/src/widget-data/compiler.ts` validates requested shapes
 *    against it, and
 *  - `registry/llm-allowlist.ts` refuses to offer the enrichment prompt a
 *    widget whose data contract lies outside it.
 *
 * Those two had drifted apart, which is how the LLM came to be offered 17
 * widgets (chart-sankey, chart-multiline, the matrix family…) that no binding
 * could ever satisfy. Extending the compiler therefore widens the prompt
 * vocabulary automatically — add the shape here in the same change.
 */
export const COMPILABLE_DATA_SHAPES = [
  'single-metric',
  'metric+delta',
  'timeseries',
  'categorical',
  'record-list',
  'stream',
] as const satisfies readonly DataShape[];

export type CompilableDataShape = (typeof COMPILABLE_DATA_SHAPES)[number];

export function isCompilableShape(shape: DataShape): shape is CompilableDataShape {
  return (COMPILABLE_DATA_SHAPES as readonly DataShape[]).includes(shape);
}
