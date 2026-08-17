// SPDX-License-Identifier: AGPL-3.0-only
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
 * produce today (04 §5.2); the rest reject with 422. SINGLE SOURCE OF TRUTH for
 * that boundary:
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
 *
 * Two of the eighteen are NOT compiler gaps and must never be listed here:
 * `static` is config-only with no server round trip (04 §3), and `form-state`
 * is fed by the CRUD form path, not by a query descriptor. Still outstanding:
 * `hierarchy/tree`, `geo-points`, `flows`, `boolean-map`, `ohlc`.
 */
export const COMPILABLE_DATA_SHAPES = [
  'single-metric',
  'metric+delta',
  'timeseries',
  'multi-timeseries',
  'categorical',
  'record-list',
  'record',
  'matrix',
  'calendar-events',
  'distribution',
  'stream',
] as const satisfies readonly DataShape[];

export type CompilableDataShape = (typeof COMPILABLE_DATA_SHAPES)[number];

export function isCompilableShape(shape: DataShape): shape is CompilableDataShape {
  return (COMPILABLE_DATA_SHAPES as readonly DataShape[]).includes(shape);
}
