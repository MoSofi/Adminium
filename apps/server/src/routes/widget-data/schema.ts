// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Zod schemas for the widget-data routes. The descriptor schema is the
 * shared pure-Zod leaf re-exported through `@adminium/engine/config` — one
 * validation authority for client bindings, stored page configs, and this
 * API surface.
 */

import { z } from 'zod';
import { queryDescriptorSchema } from '@adminium/engine/config';

/** Page-control params for late-bound `filters[].param` references. */
export const widgetParamsSchema = z.record(z.string(), z.unknown());

export const widgetQueryBody = z.object({
  descriptor: queryDescriptorSchema,
  params: widgetParamsSchema.optional(),
});

/** Shaped envelopes are dynamic per shape — validated by the shaper, not here. */
export const shapedPayloadSchema = z.unknown();

export const widgetQueryReply = z.object({
  result: shapedPayloadSchema,
  /** True when served from the in-memory TTL cache. */
  cached: z.boolean(),
});

export const BATCH_MAX_REQUESTS = 40;

export const widgetBatchBody = z.object({
  requests: z
    .array(
      z.object({
        instanceId: z.string().min(1).max(64),
        descriptor: queryDescriptorSchema,
      }),
    )
    .min(1)
    .max(BATCH_MAX_REQUESTS),
  params: widgetParamsSchema.optional(),
});

export const widgetBatchItemResult = z.union([
  z.object({ ok: z.literal(true), result: shapedPayloadSchema, cached: z.boolean() }),
  z.object({
    ok: z.literal(false),
    error: z.object({ code: z.string(), message: z.string(), statusCode: z.number() }),
  }),
]);

export const widgetBatchReply = z.object({
  /** Keyed by `instanceId`; failures are per-item, never all-or-nothing. */
  results: z.record(z.string(), widgetBatchItemResult),
});

/**
 * `POST /widget-data/link-filters` — the `f.<column>=<op>:<value>` pieces of a
 * link into a records page, worked out against that page's table on the
 * venue's calendar (`widget-data/link-filters.ts`). More pieces than a link
 * may use are accepted and reported as left out, never refused.
 */
export const linkFiltersBody = z.object({
  connectionId: z.string().min(1),
  /** The table as the data routes name it (`:table`). */
  table: z.string().min(1),
  filters: z.array(z.object({ column: z.string().min(1).max(128), raw: z.string().max(400) })).max(32),
});

export const linkFiltersReply = z.object({
  /** The list-grammar filter tree to AND into every read of the list; null when nothing applies. */
  where: z.unknown(),
  filters: z.array(
    z.union([
      z.object({
        column: z.string(),
        raw: z.string(),
        status: z.literal('applied'),
        op: z.string(),
        value: z.string().nullable(),
      }),
      z.object({ column: z.string(), raw: z.string(), status: z.literal('ignored'), reason: z.string() }),
    ]),
  ),
});
