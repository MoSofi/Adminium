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
import { rowValues } from '../../security/nul-bytes.js';
import { boolFlag } from '../query-flag.js';

export const rowSchema = z.record(z.string(), z.unknown());

/**
 * A row's values written through the write service (a record's `values`, a
 * child row's): marked, so the request's own U+0000 check leaves them to the
 * write service's, which names the column (`security/nul-bytes.ts`).
 */
const rowValuesSchema = rowValues(z.record(z.string(), z.unknown()));

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
  label: z.string().optional(),
  column: z.string(),
  count: z.number(),
});

export const recordReply = z.object({
  data: rowSchema,
  inboundCounts: z.array(referenceCountSchema).optional(),
});

/** `GET …/:recordId/history`: the record's own changes, newest first, as the reader may read them. */
export const recordHistoryQuery = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: z.string().min(1).max(200).optional(),
  })
  .strict();

export const recordHistoryReply = z.object({
  entries: z.array(
    z.object({
      id: z.string(),
      createdAt: z.number(),
      actorKind: z.string(),
      actorLabel: z.string(),
      action: z.string(),
      changes: z.record(z.string(), z.unknown()).nullable(),
    }),
  ),
  nextCursor: z.string().nullable(),
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
  .record(
    z.string().min(1),
    z
      .array(
        z.object({
          key: rowSchema.optional(),
          values: rowValuesSchema,
          /** A new row's own new rows, one level further (an order line's options): on a create only. */
          children: z.record(z.string().min(1), z.array(z.object({ values: rowValuesSchema })).max(MAX_CHILD_ROWS)).optional(),
        }),
      )
      .max(MAX_CHILD_ROWS),
  )
  .optional();

/** A staff form's record with its rows tried and not kept: every figure the save would work out. */
/**
 * What each ledger a row hands something to said of it. In a save's reply:
 * `ok`, or `unavailable` for one let through while its add-on could not
 * answer. In a quote's: also `refused`, with the reason a save would be
 * given and the line it is about — a quote is answered, never failed, for a
 * ledger's "no".
 */
export const postingAnswerSchema = z.object({
  ledger: z.string(),
  state: z.enum(['ok', 'refused', 'unavailable']),
  reason: z.string().optional(),
  /** The line's place among the rows handed over, and its path in a create with child rows. */
  line: z.number().int().min(0).optional(),
  path: z.array(z.union([z.string(), z.number()])).optional(),
  notes: z.array(z.object({ line: z.number().int().min(0), note: z.string() })).optional(),
  /** On a refused quote, for a caller who may read the ledger's own rows: how much is left, and of what. */
  left: z.string().optional(),
  item: z.string().optional(),
});

export const recordDryRunReply = z.object({
  postings: z.array(postingAnswerSchema).optional(),
  data: rowSchema.nullable(),
  children: z.record(z.string(), z.array(z.object({ data: rowSchema, children: z.record(z.string(), z.array(z.object({ data: rowSchema }))).optional() }))),
  /** A row priced by the night (a stay): each night, its rate, the rate before what was added, and the names of what was added to it. */
  nights: z.array(z.object({ date: z.string(), rate: z.string(), base: z.string(), tags: z.array(z.string()) })).optional(),
});

/**
 * ONE ROW PER VALUE: the invitations field (comp 484–488).
 *
 * `values` carries what every row shares; `repeat.values` are the one thing
 * that differs, written into `repeat.column`. All of them in one transaction
 * under one undo token, because an invitation list half sent is worse than one
 * refused.
 */
export const recordRepeatBody = z
  .object({ column: z.string().min(1).max(120), values: rowValues(z.array(z.string().min(1)).min(1).max(100)) })
  .optional();

/**
 * When the thing the write records really happened, as a staff device says: a
 * door scan made offline and sent later. Up to six hours back, never ahead.
 */
const occurredAtBody = z.string().datetime({ offset: true }).optional();

/**
 * The price the desk showed (a stay's total): the save is refused with 409
 * `PRICE_CHANGED` when it comes to another figure. `column` names the money
 * column compared; absent, the one the app's own entries check.
 */
const recordExpectBody = z
  .object({ total: z.string().regex(/^-?\d{1,15}(?:\.\d{1,6})?$/), column: z.string().min(1).max(120).optional() })
  .strict()
  .optional();

/**
 * Plain columns as the writer saw them (two door phones ticking one party's
 * arrivals): the change is made only while each still holds that value, or
 * refused 409 `ROW_CHANGED`, naming the column. Up to 8.
 */
const recordSeenBody = z
  .record(z.string().min(1).max(120), z.union([z.string().max(10_000), z.number(), z.boolean(), z.null()]))
  .refine((seen) => Object.keys(seen).length >= 1 && Object.keys(seen).length <= 8, { message: '1 to 8 columns' })
  .optional();

export const recordCreateBody = z.object({
  values: rowValuesSchema,
  links: recordLinksBody,
  children: recordChildrenBody,
  repeat: recordRepeatBody,
  occurredAt: occurredAtBody,
  expect: recordExpectBody,
  /**
   * A key the form minted for this save: sent again after a reply that never
   * came, it answers the record the first save made (`replayed`) instead of
   * making a second. Kept as a keyed hash in the column the app's own entries
   * keep a guest's retry key in.
   */
  clientKey: z.string().min(1).max(200).optional(),
});
export const recordUpdateBody = z.object({
  values: rowValuesSchema,
  links: recordLinksBody,
  children: recordChildrenBody,
  occurredAt: occurredAtBody,
  /**
   * The state the writer saw the row in (a table that keeps states): the
   * change is refused if the row has moved on since. A move marked `undo`
   * is made only with it.
   */
  from: z.string().min(1).max(64).optional(),
  expect: recordExpectBody,
  seen: recordSeenBody,
});

/** A change tried and not kept (`POST …/:recordId/dry-run`): the record's values and its child rows, as a change sends them. */
export const recordChangeDryRunBody = z.object({
  values: rowValuesSchema,
  children: recordChildrenBody,
  from: z.string().min(1).max(64).optional(),
  /** Refused: a quote shows the figures, and a price check goes with the save (as a new record's quote). */
  expect: recordExpectBody,
});

/**
 * A change tried and not kept: the record as it would stand, its child rows
 * of each list the change sent as they would stand, and — for a row priced by
 * the night — the nights it would then be made of.
 */
export const recordChangeDryRunReply = z.object({
  postings: z.array(postingAnswerSchema).optional(),
  data: rowSchema,
  children: z.record(z.string(), z.array(z.object({ data: rowSchema }))),
  nights: z.array(z.object({ date: z.string(), rate: z.string(), base: z.string(), tags: z.array(z.string()) })).optional(),
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

/** `GET …/capacity-counts`: one of the table's limits, counted for a desk. */
export const capacityCountsQuery = z
  .object({
    rule: z.coerce.number().int().min(0).max(2).default(0),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    days: z.coerce.number().int().min(1).max(62).optional(),
    /** A parent limit: the pools' rows sharing `value` in this column, or these ids (comma-separated). */
    under: z.string().min(1).max(128).optional(),
    value: z.string().min(1).max(200).optional(),
    /** Several values under the same column at once, comma-separated (the shows of a page): each row says its own (`under`). */
    values: z.string().min(1).max(4000).optional(),
    ids: z.string().min(1).max(4000).optional(),
  })
  .strict();

export const capacityCountsReply = z.object({
  data: z.object({
    kind: z.enum(['slot', 'parent', 'night']),
    rows: z.array(z.record(z.string(), z.unknown())),
  }),
});

/** `GET …/:recordId/nightly`: the nights a row's price by the night is made of. */
export const nightlyQuery = z.object({ column: z.string().min(1).max(128).optional() }).strict();

export const nightlyReply = z.object({
  data: z.object({
    column: z.string(),
    /** One line per night, or — when the rates changed since the row was priced — one line for them all. */
    nights: z.array(
      z.object({
        date: z.string(),
        rate: z.string().nullable(),
        base: z.string().nullable(),
        tags: z.array(z.string()),
        qty: z.string(),
        amount: z.string().nullable(),
      }),
    ),
    total: z.string().nullable(),
    /** The nights priced now no longer add up to the stored figure: the rates changed after the row was priced. */
    stale: z.boolean(),
  }),
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
  /** A create sent again with the retry key of one already made: that record, made nothing new. */
  replayed: z.literal(true).optional(),
  /** What each ledger the row handed something to did. A save that posted answers no undo token: its way back is the rule's own. */
  postings: z.array(postingAnswerSchema).optional(),
});

export const recordCascadeReply = z.object({
  references: z.array(referenceCountSchema),
  requiresConfirm: z.boolean(),
});

export const recordDeleteReply = z.union([recordMutationReply, recordCascadeReply]);

export const recordBulkBody = z.object({
  action: z.enum(['update', 'delete']),
  ids: z.array(z.unknown()).min(1).max(1000),
  values: rowValuesSchema.optional(),
  /**
   * The state every row was seen in (a table that keeps states): a row moved
   * on since is refused, naming it, and nothing is written — a show's live
   * orders cancelled in a few writes, one per state they were seen in.
   */
  from: z.string().min(1).max(64).optional(),
});

/** The most rows one row-by-row call takes. */
export const ONE_BY_ONE_MAX = 500;

/**
 * Rows written ONE AT A TIME, each a save of its own: what a bulk change
 * becomes for a table whose rows hand something to an add-on (a bulk edit
 * cannot post). Either one change for each of `ids` — the same `values`,
 * `from` the state every row was seen in — or one new row for each entry of
 * `creates`. Never both.
 */
export const recordOneByOneBody = z
  .object({
    ids: z.array(z.unknown()).min(1).max(ONE_BY_ONE_MAX).optional(),
    values: rowValuesSchema.optional(),
    from: z.string().min(1).max(64).optional(),
    creates: z.array(rowValuesSchema).min(1).max(ONE_BY_ONE_MAX).optional(),
  })
  .refine((body) => (body.ids === undefined) !== (body.creates === undefined), { message: 'send `ids` with `values`, or `creates` — one of the two' })
  .refine((body) => body.creates === undefined || (body.values === undefined && body.from === undefined), { message: '`values` and `from` go with `ids`' })
  .refine((body) => body.ids === undefined || body.values !== undefined, { message: '`ids` come with the `values` to write' });

/**
 * One result a row, in the order sent. A row refused does not stop the next;
 * a row not reached within the call's time answers `NOT_RUN` and may be sent
 * again. Nothing here can be undone with a token.
 */
export const recordOneByOneReply = z.object({
  results: z.array(
    z.object({
      id: z.unknown().optional(),
      index: z.number().int().min(0).optional(),
      ok: z.boolean(),
      data: rowSchema.optional(),
      postings: z.array(postingAnswerSchema).optional(),
      error: z.object({ code: z.string(), message: z.string().optional(), reason: z.string().optional(), details: z.unknown().optional() }).optional(),
    }),
  ),
  done: z.number().int().min(0),
  notRun: z.number().int().min(0),
});

export const recordBulkReply = z.object({
  results: z.array(z.object({ id: z.unknown(), ok: z.boolean(), error: z.string().optional() })),
  undoToken: z.string().nullable(),
});

export const undoParams = z.object({ token: z.string().min(1) });
export const undoReply = z.object({ restoredIds: z.array(z.unknown()) });

/** `POST …/person`: the address the desk links a booking by, and what a new person is filled with. */
export const findPersonBody = z.object({ email: z.string().min(3).max(254), fill: z.record(z.string().min(1).max(128), z.string().max(500)).optional() }).strict();
/** The person's key, and whether they were already on file. */
export const findPersonReply = z.object({ data: z.object({ key: z.unknown(), found: z.boolean() }) });
