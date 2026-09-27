// SPDX-License-Identifier: AGPL-3.0-only
import { z } from 'zod';

import { dataShapeSchema } from './data-shapes.js';

/**
 * Declarative query descriptor.
 *
 * Bindings are descriptors, never SQL strings: the client cannot express
 * arbitrary SQL; the server compiles descriptors against the active schema
 * snapshot with dynamic Kysely, binding every value as a parameter.
 */
export const aggregationSchema = z.object({
  fn: z.enum(['count', 'sum', 'avg', 'min', 'max', 'count_distinct', 'percentile']),
  column: z.string().optional(), // absent ⇔ count(*)
  p: z.number().min(0).max(1).optional(), // percentile only
  alias: z.string(),
});

export const filterSchema = z.object({
  /**
   * A column of the source, or one of the row a foreign key points at,
   * `fkColumn.column` (`order_id.status`): one link, read-checked as a lookup
   * is — the reader must be able to read that table, and a masked column
   * only with personal data. A row whose key is empty matches no such filter.
   * `window.column` takes the same.
   */
  column: z.string(),
  op: z.enum([
    'eq',
    'neq',
    'gt',
    'gte',
    'lt',
    'lte',
    'in',
    'like',
    'ilike',
    'is_null',
    'not_null',
    'between',
  ]),
  value: z.unknown().optional(),
  param: z.string().optional(), // late-bound from page controls, e.g. 'dateRange.start'
});

/**
 * `hour-of-day` folds every day into its hours on the venue's clock: a week of
 * pickups between 11:00 and 20:00 is ten bars, one per hour, not seventy. A
 * `window` still picks the days folded; an hour with no rows has no bar, as
 * with every bucket (nothing is filled with zeros). Each point's `t` is that
 * hour on 1970-01-01 in UTC fields — a wall hour, not an instant. It is a
 * bucket only: a window counts whole periods, and is refused this one.
 */
export const bucketUnitSchema = z.enum(['hour', 'day', 'week', 'month', 'quarter', 'year', 'hour-of-day']);

/**
 * A page param's name, as the day control publishes one (`day`).
 */
const paramNameSchema = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_.]{0,63}$/);

/**
 * `kind: 'capacity-counts'` — what a table's limit has taken, the desk's
 * counts (`GET /data/:conn/:table/capacity-counts`) as a widget reads them,
 * under exactly that route's read rules. `source` is the limited table.
 *
 * - A slot limit counts one day, slot by slot: the day the page's day control
 *   names (`param`, `day` unless said otherwise), else `date`, else today on
 *   the venue's clock. The control's `week` is the week from Monday, day by day.
 * - A parent limit counts the pools' rows by `ids`, or those sharing `value`
 *   in their column `under`, and a day where the limit counts by day.
 *
 * Answered as `categorical` (one item per slot, day or pool, valued by what is
 * taken) or `record-list` (one row per slot, day or pool, as the route
 * answers it, a pool's row with its `label`).
 */
export const capacityCountsSchema = z.object({
  /** Which of the table's limits: its index in the table's rules. */
  rule: z.number().int().min(0).max(2).default(0),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  param: paramNameSchema.default('day'),
  under: z.string().min(1).max(128).optional(),
  value: z.string().min(1).max(200).optional(),
  ids: z.array(z.string().min(1).max(200)).min(1).max(200).optional(),
  /** A column of the pools' rows a pool is called by; its display column otherwise. */
  label: z.string().min(1).max(128).optional(),
});

export const queryDescriptorSchema = z.object({
  kind: z.enum(['table-query', 'capacity-counts']).default('table-query'),
  connectionId: z.string(), // adminium_connections.id
  source: z.object({
    schema: z.string().optional(), // pg schema; omitted for MySQL/SQLite
    name: z.string(),
    type: z.enum(['table', 'view']).default('table'),
  }),
  shape: dataShapeSchema, // requested output shape
  select: z.array(z.string()).optional(), // column names; record-list/record only
  /**
   * `alias:fkColumn[.fkColumn…].targetColumn` — one column of a table reached
   * through foreign keys, projected onto each row under `alias`. `record-list`
   * only. The same grammar, resolver, per-table read check and masking as the
   * CRUD read's `lookup=` param: a calendar can title an appointment with the
   * patient's name without the page authoring a join.
   */
  lookups: z.array(z.string()).max(4).optional(),
  aggregations: z.array(aggregationSchema).max(8).optional(),
  groupBy: z.array(z.string()).max(2).optional(),
  /**
   * `fkColumn.labelColumn` — what a group keyed by a foreign key is called:
   * a column of the row it points at (`clinician_id.short_name`), read with
   * the same per-table read check and masking as `lookups`. A group keyed by
   * a choice column is called by its labels without asking.
   */
  groupLabel: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*$/).optional(),
  bucket: z
    .object({
      // time bucketing (mutually additive with groupBy)
      column: z.string(),
      unit: bucketUnitSchema,
    })
    .optional(),
  filters: z.array(filterSchema).max(16).optional(),
  window: z
    .object({
      // rolling window + prior-period comparison
      column: z.string(),
      last: z.number().int().min(1),
      unit: bucketUnitSchema,
      compareToPrior: z.boolean().default(false), // fills MetricDelta.prior / Timeseries.compare
      /**
       * Whole periods on the venue's clock instead of a span ending now:
       * `{ last: 1, unit: 'day', calendar: true }` is today from the venue's
       * midnight, and `offset: 1` moves it back one period — yesterday.
       */
      calendar: z.boolean().optional(),
      offset: z.number().int().min(0).max(400).optional(),
      /**
       * Follow the page's day control: a param holding `today`, `yesterday`,
       * `week` or a `YYYY-MM-DD` day replaces `last`/`unit`/`offset` with that
       * calendar window, and a `week` turns hour buckets into days.
       */
      param: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_.]{0,63}$/).optional(),
      /**
       * Reach forward instead of back: from the start of the current period on
       * the venue's clock, with NO end — `{ ahead: true, last: 1, unit: 'day' }`
       * is every row dated today or later (invoices not yet due, proposals
       * still in date). Always a calendar window. It has no end on purpose: a
       * bounded "next n periods" would silently drop a row dated past it, so
       * `last` must stay 1 and `offset`, `compareToPrior` and `param` are
       * refused rather than read one of two ways.
       */
      ahead: z.boolean().optional(),
    })
    .optional(),
  orderBy: z
    .array(z.object({ column: z.string(), dir: z.enum(['asc', 'desc']) }))
    .max(3)
    .optional(),
  limit: z.number().int().min(1).max(1000).optional(),
  cursor: z.string().optional(), // keyset pagination for record-list
  /** `kind: 'capacity-counts'` only (and required there): which limit, which pools. */
  capacity: capacityCountsSchema.optional(),
});

export type QueryDescriptor = z.infer<typeof queryDescriptorSchema>;
export type Aggregation = z.infer<typeof aggregationSchema>;
export type QueryFilter = z.infer<typeof filterSchema>;
export type BucketUnit = z.infer<typeof bucketUnitSchema>;
export type CapacityCountsAsk = z.infer<typeof capacityCountsSchema>;
