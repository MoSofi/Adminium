// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Zod schemas for the generated CRUD API (`routes/data/`). Row payloads
 * are dynamic per-table shapes and pass through as open records —
 * identifier validation happens against the schema snapshot in the
 * handlers, never here.
 */

import { z } from 'zod';

import { MAX_COMPUTE_BYTES } from '../../crud/compute.js';
import { MAX_CHILD_ROWS } from '../../crud/child-rows.js';
import { MAX_WHERE_BYTES } from '../../crud/filters.js';
import { boolFlag } from '../query-flag.js';

export const rowSchema = z.record(z.string(), z.unknown());

export const dataTableParams = z.object({
  connectionId: z.string().min(1),
  /** URL-encoded qualified name, e.g. `public.customers`. */
  table: z.string().min(1),
});

export const dataRecordParams = dataTableParams.extend({
  /** Single PK value, or JSON tuple/object for composite PKs. */
  recordId: z.string().min(1),
});

/**
 * Repeatable cross-table lookup spec:
 * `alias:fkColumn[.fkColumn…].targetColumn` (crud/lookups.ts). Fastify hands
 * a repeated query key over as an array, a single one as a string.
 */
const lookupParam = z.union([z.string(), z.array(z.string())]).optional();

/**
 * Repeatable reverse-link aggregate spec:
 * `alias:table.fkColumn:count` (crud/aggregates.ts) — counts rows of a table
 * whose FK points at this one, aliased into each row.
 */
const aggParam = z.union([z.string(), z.array(z.string())]).optional();

/**
 * Derived columns: URL-encoded JSON mirroring the page's stored
 * `config.derived` block — `{"measures":[…],"fields":[…]}` (crud/compute.ts).
 *
 * The byte cap is roughly the largest `compute=` a default Node request line
 * can carry once URL-encoded; `parseComputeParam` re-checks it — and scans
 * nesting — before it parses, so the guard holds for every caller and not
 * only the ones routed through this schema. Typed as the union so a client
 * that repeats the key is refused by name rather than silently using one.
 */
const computeParam = z
  .union([z.string().max(MAX_COMPUTE_BYTES), z.array(z.string().max(MAX_COMPUTE_BYTES))])
  .optional();

export const recordListQuery = z.object({
  select: z.string().optional(),
  /**
   * URL-encoded JSON filter tree (grammar). The byte cap is the grammar's own
   * largest sendable filter (crud/filters.ts); `parseWhereParam` re-checks it —
   * and scans nesting — before it parses, so the guard holds for every caller,
   * not only the ones routed through this schema.
   */
  where: z.string().max(MAX_WHERE_BYTES).optional(),
  q: z.string().optional(),
  /** `col.desc,col2.asc` — ≤ 3 keys. */
  order: z.string().optional(),
  lookup: lookupParam,
  agg: aggParam,
  compute: computeParam,
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
  lookup: lookupParam,
  agg: aggParam,
  compute: computeParam,
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

/**
 * Whether a person may prove themselves by an emailed code today, as the
 * desk sees it: `locked` after too many wrong codes, with how many there
 * were. A row nobody finds themselves by is never locked.
 */
export const claimLockReply = z.object({
  locked: z.boolean(),
  failures: z.number().int(),
});

/** `POST /data/:connectionId/:table/:recordId/regenerate-code`: the code column to make again. */
export const regenerateCodeBody = z.object({ column: z.string().min(1).max(128) }).strict();

export const claimLockClearedReply = z.object({
  /** Wrong codes that stop counting now. */
  cleared: z.number().int(),
});

/**
 * The link sets a write replaces, keyed by relation id.
 *
 * A relation the body does not name is left ALONE — the same rule an absent
 * column follows. `{ "<relationId>": [] }` is how a set is emptied, and the
 * keys are target key values as they travel: strings, or numbers for an
 * integer key.
 *
 * The cap is per relation. A thousand links added in one request is not a form
 * filling itself in; it is an import, and an import has its own door.
 */
export const recordLinksBody = z
  .record(z.string().min(1).max(200), z.array(z.union([z.string(), z.number()])).max(500))
  .optional();

/**
 * Child rows written beside their parent: `{ <relationId>: [{ key?, values }] }`.
 *
 * A row with no `key` is being added; one with a key is being changed, and a
 * key the request leaves out is being removed. The cap is per relation, and it
 * is the leaf's — a dialog that can hold two hundred lines is already a page.
 */
export const recordChildrenBody = z
  .record(z.string().min(1), z.array(z.object({ key: rowSchema.optional(), values: rowSchema })).max(MAX_CHILD_ROWS))
  .optional();

/**
 * ONE ROW PER VALUE: the invitations field (comp 484–488).
 *
 * `values` carries what every row shares; `repeat.values` are the one thing
 * that differs, written into `repeat.column`. All of them in one transaction
 * under one undo token, because an invitation list half sent is worse than one
 * refused.
 */
export const recordRepeatBody = z
  .object({ column: z.string().min(1).max(120), values: z.array(z.string().min(1)).min(1).max(100) })
  .optional();

export const recordCreateBody = z.object({
  values: rowSchema,
  links: recordLinksBody,
  children: recordChildrenBody,
  repeat: recordRepeatBody,
});
export const recordUpdateBody = z.object({
  values: rowSchema,
  links: recordLinksBody,
  children: recordChildrenBody,
});

/** `GET …/:recordId/links/:relationId`. */
export const recordLinksParams = dataRecordParams.extend({
  /** The relation id, URI-encoded by the caller. */
  relationId: z.string().min(1).max(200),
});

export const recordLinksQuery = z.object({
  /** The target column the picker shows as the name. */
  name: z.string().min(1).max(120).optional(),
  /** Up to two detail columns, comma-separated, joined by " · " on the client. */
  detail: z.string().max(250).optional(),
});

export const recordLinksReply = z.object({
  data: z.array(
    z.object({
      key: z.union([z.string(), z.number()]),
      name: z.string(),
      detail: z.string().optional(),
    }),
  ),
  /** True when the record has more links than the cap returned. */
  hasMore: z.boolean(),
});

/**
 * The calendar's availability read. `from` / `to` are wire instants — the same
 * shape the date and datetime controls send — and `to` is EXCLUSIVE, so a
 * month is `[first, first-of-next)` with no last-millisecond arithmetic.
 */
export const availabilityQuery = z.object({
  column: z.string().min(1).max(120),
  from: z.string().min(4).max(40),
  to: z.string().min(4).max(40),
  /** A column whose value scopes the question — the room, the practitioner. */
  resource: z.string().min(1).max(120).optional(),
  resourceValue: z.string().max(200).optional(),
  /** The record this read is for; its own instant is not "taken". */
  exclude: z.string().min(1).max(400).optional(),
});

/**
 * The desk's booking read: a kind of visit, one person or anyone, and one
 * date or a strip of days — what the patients' side asks, answered for staff:
 * no notice limit, and with `resource=any` each free time names who would be
 * booked.
 */
export const bookingSlotsQuery = z
  .object({
    kind: z.string().min(1).max(200),
    resource: z.string().min(1).max(200).optional(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    days: z.coerce.number().int().min(1).max(31).optional(),
    /** The visit being moved; its own time is not counted against it. */
    exclude: z.string().min(1).max(400).optional(),
  })
  .strict();

export const bookingSlotsReply = z.object({
  data: z.union([
    z.array(
      z.object({ time: z.string(), state: z.enum(['free', 'full']), resource: z.union([z.string(), z.number()]).optional() }),
    ),
    z.array(z.object({ date: z.string(), open: z.number().int(), state: z.enum(['open', 'full', 'closed']) })),
  ]),
});

export const availabilityReply = z.object({
  taken: z.array(z.string()),
  /** The cap was reached, so nothing may be struck out from this reply. */
  capped: z.boolean(),
});

export const recordDeleteQuery = z.object({
  /** Referential consequences only — no write happens. */
  dryRun: boolFlag(),
  /** Required when inbound references exist (cascade modal confirm). */
  confirm: boolFlag(),
});

export const recordMutationReply = z.object({
  data: rowSchema.nullable(),
  /** Single-use undo token; null for non-undoable mutations. */
  undoToken: z.string().nullable(),
  /**
   * How many rows one create wrote. Present only for a `repeat` create — one
   * row per value — where `data` is the FIRST of them and a caller counting
   * replies would otherwise say "1 record added" about five.
   */
  created: z.number().int().min(1).optional(),
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
