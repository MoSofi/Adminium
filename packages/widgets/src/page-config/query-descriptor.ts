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

export const bucketUnitSchema = z.enum(['hour', 'day', 'week', 'month', 'quarter', 'year']);

export const queryDescriptorSchema = z.object({
  kind: z.literal('table-query').default('table-query'),
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
    })
    .optional(),
  orderBy: z
    .array(z.object({ column: z.string(), dir: z.enum(['asc', 'desc']) }))
    .max(3)
    .optional(),
  limit: z.number().int().min(1).max(1000).optional(),
  cursor: z.string().optional(), // keyset pagination for record-list
});

export type QueryDescriptor = z.infer<typeof queryDescriptorSchema>;
export type Aggregation = z.infer<typeof aggregationSchema>;
export type QueryFilter = z.infer<typeof filterSchema>;
export type BucketUnit = z.infer<typeof bucketUnitSchema>;
