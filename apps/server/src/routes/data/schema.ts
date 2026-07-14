/**
 * Zod schemas for the generated CRUD API (`routes/data/`,
 * 08-server-api.md §2.7). Row payloads are dynamic per-table shapes and
 * pass through as open records — identifier validation happens against the
 * schema snapshot in the handlers, never here.
 */

import { z } from 'zod';

export const rowSchema = z.record(z.string(), z.unknown());

export const dataTableParams = z.object({
  connectionId: z.string().min(1),
  /** URL-encoded qualified name, e.g. `public.customers` (§2.7). */
  table: z.string().min(1),
});

export const dataRecordParams = dataTableParams.extend({
  /** Single PK value, or JSON tuple/object for composite PKs (§2.7.2). */
  recordId: z.string().min(1),
});

export const recordListQuery = z.object({
  select: z.string().optional(),
  /** URL-encoded JSON filter tree (§2.7.1 grammar). */
  where: z.string().optional(),
  q: z.string().optional(),
  /** `col.desc,col2.asc` — ≤ 3 keys. */
  order: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  /** Keyset cursor; empty string = first keyset page. */
  cursor: z.string().optional(),
  count: z.enum(['exact', 'estimated', 'none']).optional(),
});

export const recordListReply = z.object({
  data: z.array(rowSchema),
  page: z
    .object({ limit: z.number(), offset: z.number(), total: z.number().nullable() })
    .optional(),
  cursor: z.object({ next: z.string().nullable() }).optional(),
});

export const recordGetQuery = z.object({
  include: z.enum(['inboundCounts']).optional(),
});

export const referenceCountSchema = z.object({
  relationId: z.string(),
  table: z.string(),
  column: z.string(),
  count: z.number(),
});

export const recordReply = z.object({
  data: rowSchema,
  inboundCounts: z.array(referenceCountSchema).optional(),
});

export const referencesReply = z.object({
  references: z.array(referenceCountSchema),
});

export const recordCreateBody = z.object({ values: rowSchema });
export const recordUpdateBody = z.object({ values: rowSchema });

export const recordDeleteQuery = z.object({
  /** Referential consequences only — no write happens (§2.7.2). */
  dryRun: z.coerce.boolean().optional(),
  /** Required when inbound references exist (cascade modal confirm). */
  confirm: z.coerce.boolean().optional(),
});

export const recordMutationReply = z.object({
  data: rowSchema.nullable(),
  /** Single-use undo token (§2.7.3); null for non-undoable mutations. */
  undoToken: z.string().nullable(),
});

export const recordCascadeReply = z.object({
  references: z.array(referenceCountSchema),
  requiresConfirm: z.boolean(),
});

export const recordDeleteReply = z.union([recordMutationReply, recordCascadeReply]);

export const recordBulkBody = z.object({
  action: z.enum(['update', 'delete']),
  ids: z.array(z.unknown()).min(1).max(1000),
  values: rowSchema.optional(),
});

export const recordBulkReply = z.object({
  results: z.array(z.object({ id: z.unknown(), ok: z.boolean(), error: z.string().optional() })),
  undoToken: z.string().nullable(),
});

export const undoParams = z.object({ token: z.string().min(1) });
export const undoReply = z.object({ restoredIds: z.array(z.unknown()) });
