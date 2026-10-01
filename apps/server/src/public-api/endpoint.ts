// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The ENDPOINT definition: one route of the public API, shared by every key
 * that is granted it.
 *
 * ── WHAT IT IS FOR ─────────────────────────────────────────────────────────
 * A scope document (`scope.ts`) is one key's whole authorization, written by
 * hand. An endpoint is one table's route, written once and granted to many
 * keys, method by method. The request path never reads an endpoint: a key
 * made from endpoints gets a scope document DERIVED from them (`derive.ts`),
 * and that document is what the resolver compiles and serves. So this file
 * adds a second way to WRITE authorization, and no second way to enforce it.
 *
 * ── WHY THE KEYS ARE THE COMP'S, IN SNAKE CASE ─────────────────────────────
 * The builder prints this document beside its form, and the operator edits
 * either one. The keys are therefore the ones the design shows —
 * `path`, `source`, `methods`, `select`, `filters`, `pagination`, `auth`,
 * `rate_limit`, `response` — with the ADVANCED keys after them, which the form
 * does not draw and round-trips untouched. Each advanced key means what the
 * scope resource's field of the same name means, so nothing a hand-written
 * scope can say is lost. Unknown keys are refused by name.
 *
 * ── WHY THE STORED FORM IS PRINTED TEXT ────────────────────────────────────
 * `json` columns come back reordered on Postgres (`jsonb`) and MySQL, and the
 * pane compares text to decide whether it is "synced with form".
 * `printDefinition` is the one canonical spelling: the definition's own key
 * order, methods in GET POST PATCH PUT DELETE BATCH order, two-space indent.
 */

import { formulaColumns, linkedConditionSchema, stateConditionSchema } from '@adminium/manifest';
import { z } from 'zod';

import type { EffectiveColumn } from '../connections/effective-schema.js';
import { columnPolicyFor } from '../connections/effective-schema.js';
import { FILTER_OPS } from '../crud/filters.js';
import type { ResolvedTable, SnapshotView } from '../crud/identifiers.js';
import { ANONYMOUS_PER_IP_HOUR, copyPlainText, plainColumns, plainTextListSchema } from './anonymous-caps.js';
import { readGenerator } from './generate.js';
import { DAY_TYPES, isMomentWindow, isTimeWindow } from './relative-filters.js';
import {
  CLAIM_STRATEGIES,
  compileScope,
  type PublicAction,
  type PublicResponseShape,
  type PublicScopeDocument,
  type PublicScopeResource,
  ScopeCompileError,
  type ScopeChild,
  type ScopeIssue,
  scopeAgreeSchema,
  scopeAgreeTargetSchema,
  scopeCountsSchema,
  writableWhenSchema,
} from './scope.js';

/* --------------------------------------------------------------- vocabulary */

/** Canonical order, which is also the order the design lists them in. */
export const PUBLIC_METHODS = ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'BATCH'] as const;
export type PublicMethod = (typeof PUBLIC_METHODS)[number];

/** One method, one action. */
export const METHOD_ACTION: Readonly<Record<PublicMethod, PublicAction>> = {
  GET: 'read',
  POST: 'create',
  PATCH: 'update',
  PUT: 'replace',
  DELETE: 'delete',
  BATCH: 'batch',
};

/** The actions that send column values: the only ones `writable` means anything to. */
const SENDS_VALUES: ReadonlySet<PublicAction> = new Set(['create', 'update', 'replace', 'batch']);

/** The methods that address one row by its primary key. */
const KEYED_METHODS: ReadonlySet<PublicMethod> = new Set(['PATCH', 'PUT', 'DELETE']);
/** The methods that send column values. */
const WRITING_METHODS: ReadonlySet<PublicMethod> = new Set(['POST', 'PATCH', 'PUT', 'BATCH']);

export const PUBLIC_AUTH_ROLES = ['anon', 'authenticated', 'service_role'] as const;
export type PublicAuthRole = (typeof PUBLIC_AUTH_ROLES)[number];

export const RATE_WINDOWS = { '1s': 1_000, '1m': 60_000, '1h': 3_600_000 } as const;
export type RateWindow = keyof typeof RATE_WINDOWS;

/** The page cap the scope vocabulary allows (`scope.ts`). */
const MAX_LIMIT_CEILING = 200;
/** 1 to 10,000 requests a minute, whatever the window. */
const RATE_PER_MINUTE_CEILING = 10_000;

/**
 * A ref, widened from the scope grammar so a snake_case table keeps its name
 * (`order_details`, the design's `mrr_rollup`). Every ref a scope accepts
 * still parses.
 */
export const ENDPOINT_REF_PATTERN = /^[a-z][A-Za-z0-9_]*$/;
const REF_MAX = 64;
export const endpointRefSchema = z
  .string()
  .min(1)
  .max(REF_MAX)
  .regex(ENDPOINT_REF_PATTERN, 'a ref starts with a lower-case letter and holds only letters, digits and _');

const columnSchema = z.string().min(1).max(128);

const filterSchema = z.union([
  z.object({ column: columnSchema, op: z.enum(FILTER_OPS), value: z.unknown().optional() }).strict(),
  /*
   * The venue's calendar, worked out on every request in its zone: `today`
   * is today's date, `from-today` today on (`days` limits how far). A date
   * or a time column only.
   */
  z.object({ column: columnSchema, op: z.literal('today') }).strict(),
  z.object({ column: columnSchema, op: z.literal('from-today'), days: z.number().int().min(1).max(366).optional() }).strict(),
]);

const scalarSchema = z.union([z.string().max(256), z.number(), z.boolean()]);

/** One filter as the document spells it, whichever kind. */
function filterOf(f: z.infer<typeof filterSchema>): Record<string, unknown> {
  if (f.op === 'today') return { column: f.column, op: f.op };
  if (f.op === 'from-today') return f.days === undefined ? { column: f.column, op: f.op } : { column: f.column, op: f.op, days: f.days };
  return f.value === undefined ? { column: f.column, op: f.op } : { column: f.column, op: f.op, value: f.value };
}

/**
 * The design writes `{ shape: "object", envelope: "data" }` for a wrapped
 * list, and the pane shows what is stored, so that is the spelling.
 * It compiles to the one stored enum, `wrapped | array | single`.
 */
const responseSchema = z.union([
  z.object({ shape: z.literal('object'), envelope: z.literal('data') }).strict(),
  z.object({ shape: z.literal('array') }).strict(),
  z.object({ shape: z.literal('single') }).strict(),
]);

const claimSchema = z
  .object({
    column: columnSchema.optional(),
    via: z
      .object({ ref: endpointRefSchema, localColumn: columnSchema, foreignColumn: columnSchema })
      .strict()
      .optional(),
    /**
     * The identity endpoint the session must have been claimed through. Set,
     * a session claimed on any other identity reaches nothing here — two
     * identities never share a value by accident.
     */
    ref: endpointRefSchema.optional(),
    /**
     * A create that goes through without a session too (a first visit, by
     * someone not on file yet). With one, the claim column is filled from it.
     */
    optional: z.literal(true).optional(),
  })
  .strict();

/**
 * Rows readable only where another endpoint of the same key reads the row
 * they belong to: `localColumn` here equals `foreignColumn` there. Either
 * this table points at the parent, or the parent points here.
 */
const visibleWithSchema = z
  .object({ ref: endpointRefSchema, localColumn: columnSchema, foreignColumn: columnSchema })
  .strict();

/**
 * The claim a customer makes AGAINST this endpoint. An endpoint-only
 * key: it becomes the derived document's `claim { strategy, ref, match }`
 * plus this resource's own `claim.column`, which is the column whose value
 * the session then carries to every other `authenticated` endpoint.
 */
const identitySchema = z
  .object({
    strategy: z.enum(CLAIM_STRATEGIES),
    match: z.array(columnSchema).min(1),
    column: columnSchema,
    /**
     * `email-code`: a code emailed to the row's `email` column raises the
     * session to `verified`. `email-link` (strategy `email-link`): a link
     * emailed to that address is the only way in, and opens at `verified`.
     */
    verify: z.enum(['email-code', 'email-link']).optional(),
    email: columnSchema.optional(),
    /** `token`: the date or time after which the link opens nothing, and the yes/no that stops it. */
    expires: columnSchema.optional(),
    stopped: columnSchema.optional(),
    /** `token`: the owner's own link, which opens a verified session that may change its row. */
    own: z.literal(true).optional(),
    /** An own link: the text columns of its row whose addresses the link may be emailed to. */
    address: z.array(columnSchema).min(1).max(2).optional(),
  })
  .strict();

/*
 * ── A create with its child rows, and a person found by address ─────────
 * Snake case, as the rest of the document. A child's `source` is its real
 * table; the key it is listed under is the name the wire uses.
 */

/** The agreement and count shapes are the scope's own: the definition maps them across unchanged. */
type AgreeTarget = z.infer<typeof scopeAgreeTargetSchema>;
export const endpointAgreeSchema = scopeAgreeSchema;
export const endpointCountsSchema = scopeCountsSchema;

const childShape = {
  /** The child's real table. */
  source: z.string().min(1).max(256),
  via: columnSchema,
  writable: z.array(columnSchema),
  select: z.array(columnSchema).optional(),
  defaults: z.record(columnSchema, z.unknown()).optional(),
  writable_values: z.record(columnSchema, z.array(scalarSchema).min(1).max(32)).optional(),
  requires: z.array(columnSchema).min(1).max(8).optional(),
  position: columnSchema.optional(),
  min: z.number().int().min(0).optional(),
  max: z.number().int().min(1).max(200),
  agrees: z.array(endpointAgreeSchema).min(1).max(8).optional(),
  counts: z.array(endpointCountsSchema).min(1).max(2).optional(),
  plain_text: plainTextListSchema(columnSchema).optional(),
  /** The most `column` may add up to across one write: a number, or a column of a one-row table (its real id). */
  sum_max: z
    .object({ column: columnSchema, max: z.union([z.number().int().min(1), z.object({ table: z.string().min(1).max(256), column: columnSchema }).strict()]) })
    .strict()
    .optional(),
};
const childRefSchema = z.string().min(1).max(64).regex(/^[a-z][a-z0-9_]*$/, 'a child is named by the snake_case table name the wire uses');
const childMap = <T extends z.ZodTypeAny>(entry: T) =>
  z.record(childRefSchema, entry).refine((children) => Object.keys(children).length >= 1 && Object.keys(children).length <= 4, {
    message: 'one to four child tables at each level',
  });
const grandchildSchema = z.object(childShape).strict();
export const endpointChildSchema = z.object({ ...childShape, children: childMap(grandchildSchema).optional() }).strict();
export type EndpointChild = z.infer<typeof endpointChildSchema>;

/**
 * A person found by the address a guest types, or made: the identity
 * endpoint they sign in through (`identity_ref`), this table's column holding
 * the address and its link to the person, and the person's columns a new row
 * is filled with, from this table's.
 */
const findOrCreateSchema = z
  .object({
    identity_ref: endpointRefSchema,
    email: columnSchema,
    link: columnSchema,
    fill: z.record(columnSchema, columnSchema).optional(),
    /** On a change through the row's own link: only the save that moves `column` to `to` finds the person. */
    on: z.object({ column: columnSchema, to: z.string().min(1).max(64) }).strict().optional(),
  })
  .strict();

/** A confirmation emailed on a guest's create (`definition.confirm`). */
export const publicConfirmSchema = z
  .object({
    template: z.enum(['booking-confirmation']),
    /** The column holding the guest's email address. */
    to: columnSchema,
    code: columnSchema.optional(),
    when: columnSchema.optional(),
    party: columnSchema.optional(),
    name: columnSchema.optional(),
    /** The one-row table holding the venue's name, address and phone. */
    venue: z
      .object({ table: z.string().min(1).max(256), name: columnSchema.optional(), address: columnSchema.optional(), phone: columnSchema.optional() })
      .strict()
      .optional(),
    /** Where "Manage your booking" leads, under the app's guest side: `manage?code={code}`. */
    link: z.string().max(200).optional(),
  })
  .strict();

export type PublicConfirm = z.infer<typeof publicConfirmSchema>;

export const publicEndpointDefinitionSchema = z
  .object({
    path: z.string().min(2).max(REF_MAX + 1),
    source: z.string().min(1).max(256),
    methods: z.array(z.enum(PUBLIC_METHODS)),
    select: z.array(columnSchema),
    filters: z.array(filterSchema).default([]),
    pagination: z
      .object({
        default_limit: z.number().int().min(1),
        max_limit: z.number().int().min(1),
        order: z.string().regex(/^[^.,\s]+\.(asc|desc)$/, 'an order is "column.asc" or "column.desc"').max(160),
      })
      .strict(),
    auth: z.object({ role: z.enum(PUBLIC_AUTH_ROLES) }).strict(),
    rate_limit: z
      .object({
        requests: z.number().int().min(1),
        window: z.enum(Object.keys(RATE_WINDOWS) as [RateWindow, ...RateWindow[]]),
      })
      .strict(),
    response: responseSchema,
    /* ── advanced: not drawn by the form, round-tripped by it ────────────── */
    writable: z.array(columnSchema).optional(),
    defaults: z.record(columnSchema, z.unknown()).optional(),
    filterable: z.array(columnSchema).optional(),
    searchable: z.array(columnSchema).optional(),
    orderable: z.array(columnSchema).optional(),
    claim: claimSchema.optional(),
    /** Readable only with a parent endpoint's row (a draft's lines stay as hidden as the draft). */
    visible_with: visibleWithSchema.optional(),
    identity: identitySchema.optional(),
    sensitive: z.boolean().optional(),
    /**
     * Permit DELETE on a table another table references with ON DELETE
     * CASCADE / SET NULL / SET DEFAULT. Off, such a DELETE is
     * refused: it would change rows in tables this endpoint was never
     * granted, with no audit row, hook or event for them.
     */
    allow_cascade: z.boolean().optional(),
    /**
     * `availability`: the endpoint answers "free or full" for each time slot
     * of a day, from the table's booking limit — never a row. GET only.
     */
    kind: z.enum(['records', 'availability']).optional(),
    /**
     * A confirmation Adminium emails when a guest creates a row here — the
     * page is static and has no server to send one. Each field names the
     * column the email reads; `venue` names a one-row settings table.
     */
    confirm: publicConfirmSchema.optional(),
    /** The only values a caller may write into these columns (`status: [cancelled]`). */
    writable_values: z.record(columnSchema, z.array(scalarSchema).min(1).max(32)).optional(),
    /** Columns a write here must fill: accepting a proposal carries the typed name. */
    requires: z.array(columnSchema).min(1).max(8).optional(),
    /** File columns a signed-in person may download, through the row that names the file. */
    files: z.array(columnSchema).min(1).max(8).optional(),
    /**
     * The state a row must be in for an update to touch it — part of the
     * UPDATE, never of a read: a finished visit still lists, and cannot be
     * moved. `from-now` on a time: while it is still ahead. `{within: 60}` on
     * a time: no more than 60 minutes ahead — a change asked for earlier is
     * refused as too early, with that time.
     */
    writable_when: writableWhenSchema.optional(),
    /** The session this endpoint needs: `verified` once an emailed code is confirmed. */
    level: z.enum(['lookup', 'verified']).optional(),
    /**
     * A small proof of work before a create with no session — or, on an
     * identity endpoint, before every claim (`x-adminium-proof`).
     */
    human_check: z.literal(true).optional(),
    /** On an optional claim: the columns a signed-in create empties (a first visit's own details). */
    on_claim: z.object({ clear: z.array(columnSchema).min(1).max(12) }).strict().optional(),
    /** A signed-in person may hold at most `n` rows whose column is one of `values` (still ahead, with `upcoming`). */
    max_open: z
      .object({
        column: columnSchema,
        values: z.array(scalarSchema).min(1).max(32),
        n: z.number().int().min(1).max(50),
        upcoming: columnSchema.optional(),
      })
      .strict()
      .optional(),
    /** A create answers where the new row stands: the matching rows ordered at or before it. */
    rank: z
      .object({ order_by: columnSchema, where: z.object({ column: columnSchema, eq: scalarSchema }).strict().optional() })
      .strict()
      .optional(),
    /**
     * Writes refused while a bool in the settings row is false; `when:
     * anonymous` refuses only a create nobody signed in for.
     */
    require_setting: z
      .array(z.object({ table: z.string().min(1).max(200), column: columnSchema, when: z.literal('anonymous').optional() }).strict())
      .min(1)
      .max(4)
      .optional(),
    /** The limits on a change a guest makes: per value a day, plain-text columns. */
    limits: z
      .object({
        per_value: z.object({ columns: z.array(columnSchema).min(1).max(4), n: z.number().int().min(1).max(20) }).strict().optional(),
        plain_text: plainTextListSchema(columnSchema).optional(),
      })
      .strict()
      .optional(),
    /** The limits on a create nobody signed in for: per value a day, per key an hour, plain-text columns. */
    anonymous: z
      .object({
        per_value: z.object({ columns: z.array(columnSchema).min(1).max(4), n: z.number().int().min(1).max(20) }).strict().optional(),
        per_key_hour: z.number().int().min(1).max(1000).optional(),
        per_ip_hour: z.number().int().min(1).max(ANONYMOUS_PER_IP_HOUR).optional(),
        plain_text: plainTextListSchema(columnSchema).optional(),
      })
      .strict()
      .optional(),
    /** Availability: which of the source's limits it answers, by its place in the list (absent: the first). */
    capacity_rule: z.number().int().min(0).max(2).optional(),
    /** Availability: what is left is said only when little is — below a number, or a share of the pool. */
    show_left: z
      .union([
        z.object({ below: z.number().int().min(1) }).strict(),
        z.object({ below_share: z.number().int().min(1).max(100) }).strict(),
      ])
      .optional(),
    /** Availability of a parent limit: the column of the pools' rows a page asks by. */
    under: columnSchema.optional(),
    /**
     * Rows readable only with a code that unlocks them: a row of `table` whose
     * `column` holds the typed code and whose `link` points at the row. No
     * row answers without one.
     */
    unlock_by: z
      .object({
        table: z.string().min(1).max(256),
        column: columnSchema,
        link: columnSchema,
        where: z
          .array(
            z.union([
              z.object({ column: columnSchema, eq: scalarSchema }).strict(),
              z.object({ column: columnSchema, not_before: z.enum(['now', 'today']), or_empty: z.literal(true).optional() }).strict(),
              z.object({ column: columnSchema, not_after: z.enum(['now', 'today']), or_empty: z.literal(true).optional() }).strict(),
            ]),
          )
          .max(4)
          .optional(),
      })
      .strict()
      .optional(),
    /** Image columns any visitor may see, through the rows this endpoint reads. */
    pictures: z.array(columnSchema).min(1).max(4).optional(),
    /* ── a create with its child rows ─────────────────────────────────────── */
    /** The rows a create carries, by the name the wire uses (see `endpointChildSchema`). */
    children: childMap(endpointChildSchema).optional(),
    /** Checks the created row's own values pass (guests no more than a room sleeps). */
    agrees: z.array(endpointAgreeSchema).min(1).max(8).optional(),
    /** The same write may be tried without writing, to see every figure. */
    dry_run: z.literal(true).optional(),
    /** A money column a write may send its expected value for. */
    expect: columnSchema.optional(),
    /** A column holding a key the browser mints, so a retry lands on the same row. */
    client_key: columnSchema.optional(),
    /* ── a person found by address ────────────────────────────────────────── */
    find_or_create: findOrCreateSchema.optional(),
    /** A create answers, once, the new row's own link: this code column, opened through the key of this purpose. */
    share_link: z.object({ column: columnSchema, key: z.string().min(1).max(64) }).strict().optional(),
    /** Read only by the holder of a live session of the key (no claim of its own). */
    session_only: z.literal(true).optional(),
    /** On an identity endpoint: the columns "delete my details" empties, and the time it stamps. */
    forget: z
      .object({
        columns: z.array(columnSchema).min(1).max(16),
        stamp: columnSchema.optional(),
        /** Of `columns`, the yes/no ones the database keeps as a number (SQLite): emptied to no, as a boolean column is. */
        flags: z.array(columnSchema).min(1).max(16).optional(),
        /** Also stopped: the own links of the person's rows — each table, its code column, and the columns that point at the person. */
        links: z
          .array(z.object({ table: z.string().min(1).max(256), column: columnSchema, people: z.array(columnSchema).min(1).max(8) }).strict())
          .min(1)
          .max(8)
          .optional(),
      })
      .strict()
      .optional(),
    /** On a signed-in person's rows: "Make a new link" renews `column` and emails the new link as the outbox's `kind`. */
    new_link: z
      .object({ column: columnSchema, kind: z.string().min(1).max(40), when: z.object({ where: z.array(stateConditionSchema).min(1).max(8) }).strict().optional(), stopped: columnSchema.optional() })
      .strict()
      .optional(),
    /**
     * On rows reached through a parent: these columns are left out unless
     * `unless_holder` is empty or names the session's own person.
     */
    withhold: z
      .object({
        columns: z.array(columnSchema).min(1).max(8),
        unless_holder: columnSchema.optional(),
        /** Withheld from whoever reads while this holds of the row, or of a row it links to (every condition). */
        when: z
          .object({
            where: z.array(stateConditionSchema).min(1).max(8).optional(),
            linked: z.array(linkedConditionSchema).min(1).max(4).optional(),
          })
          .strict()
          .refine((w) => w.where !== undefined || w.linked !== undefined, { message: 'a when names where, linked, or both' })
          .optional(),
        /** The key (its purpose) the declaring entry is served through: its `when` is that key's readers' alone. */
        key: z.string().min(1).max(64).optional(),
        /** That key opens a row by its own link: its `when` is about whoever holds the link. */
        own_link: z.literal(true).optional(),
      })
      .strict()
      .refine((w) => w.unless_holder !== undefined || w.when !== undefined, { message: 'a withhold names its holder, a when, or both' })
      .optional(),
  })
  .strict();

export type PublicEndpointDefinition = z.infer<typeof publicEndpointDefinitionSchema>;

/* ------------------------------------------------------------------ printing */

/** Methods, de-duplicated, in canonical order. */
export function canonicalMethods(methods: readonly PublicMethod[]): PublicMethod[] {
  const set = new Set(methods);
  return PUBLIC_METHODS.filter((m) => set.has(m));
}

/**
 * The document in the definition's own key order. Built key by key rather than by sorting, so
 * the order is written down here and a new key cannot land in the middle of
 * the document by accident.
 */
function ordered(def: PublicEndpointDefinition): Record<string, unknown> {
  const out: Record<string, unknown> = {
    path: def.path,
    source: def.source,
    methods: canonicalMethods(def.methods),
    select: [...def.select],
    filters: def.filters.map(filterOf),
    pagination: {
      default_limit: def.pagination.default_limit,
      max_limit: def.pagination.max_limit,
      order: def.pagination.order,
    },
    auth: { role: def.auth.role },
    rate_limit: { requests: def.rate_limit.requests, window: def.rate_limit.window },
    response:
      def.response.shape === 'object'
        ? { shape: 'object', envelope: 'data' }
        : { shape: def.response.shape },
  };
  if (def.writable !== undefined) out['writable'] = [...def.writable];
  if (def.defaults !== undefined) out['defaults'] = { ...def.defaults };
  if (def.filterable !== undefined) out['filterable'] = [...def.filterable];
  if (def.searchable !== undefined) out['searchable'] = [...def.searchable];
  if (def.orderable !== undefined) out['orderable'] = [...def.orderable];
  if (def.claim !== undefined) {
    const claim: Record<string, unknown> = {};
    if (def.claim.column !== undefined) claim['column'] = def.claim.column;
    if (def.claim.via !== undefined) {
      claim['via'] = {
        ref: def.claim.via.ref,
        localColumn: def.claim.via.localColumn,
        foreignColumn: def.claim.via.foreignColumn,
      };
    }
    if (def.claim.ref !== undefined) claim['ref'] = def.claim.ref;
    if (def.claim.optional !== undefined) claim['optional'] = def.claim.optional;
    out['claim'] = claim;
  }
  if (def.visible_with !== undefined) {
    out['visible_with'] = {
      ref: def.visible_with.ref,
      localColumn: def.visible_with.localColumn,
      foreignColumn: def.visible_with.foreignColumn,
    };
  }
  if (def.identity !== undefined) {
    out['identity'] = {
      strategy: def.identity.strategy,
      match: [...def.identity.match],
      column: def.identity.column,
      ...(def.identity.verify === undefined ? {} : { verify: def.identity.verify }),
      ...(def.identity.email === undefined ? {} : { email: def.identity.email }),
      ...(def.identity.expires === undefined ? {} : { expires: def.identity.expires }),
      ...(def.identity.stopped === undefined ? {} : { stopped: def.identity.stopped }),
      ...(def.identity.own === undefined ? {} : { own: def.identity.own }),
      ...(def.identity.address === undefined ? {} : { address: [...def.identity.address] }),
    };
  }
  if (def.sensitive !== undefined) out['sensitive'] = def.sensitive;
  if (def.allow_cascade !== undefined) out['allow_cascade'] = def.allow_cascade;
  if (def.kind !== undefined) out['kind'] = def.kind;
  if (def.confirm !== undefined) out['confirm'] = { ...def.confirm };
  if (def.writable_values !== undefined) out['writable_values'] = { ...def.writable_values };
  if (def.requires !== undefined) out['requires'] = [...def.requires];
  if (def.files !== undefined) out['files'] = [...def.files];
  if (def.writable_when !== undefined) out['writable_when'] = { ...def.writable_when };
  if (def.level !== undefined) out['level'] = def.level;
  if (def.human_check !== undefined) out['human_check'] = def.human_check;
  if (def.on_claim !== undefined) out['on_claim'] = { clear: [...def.on_claim.clear] };
  if (def.max_open !== undefined) out['max_open'] = { ...def.max_open };
  if (def.rank !== undefined) out['rank'] = { ...def.rank };
  if (def.anonymous !== undefined) out['anonymous'] = { ...def.anonymous };
  if (def.limits !== undefined) {
    out['limits'] = {
      ...(def.limits.per_value === undefined ? {} : { per_value: { columns: [...def.limits.per_value.columns], n: def.limits.per_value.n } }),
      ...(def.limits.plain_text === undefined ? {} : { plain_text: copyPlainText(def.limits.plain_text) }),
    };
  }
  if (def.require_setting !== undefined) out['require_setting'] = def.require_setting.map((setting) => ({ ...setting }));
  if (def.capacity_rule !== undefined) out['capacity_rule'] = def.capacity_rule;
  if (def.show_left !== undefined) out['show_left'] = { ...def.show_left };
  if (def.under !== undefined) out['under'] = def.under;
  if (def.unlock_by !== undefined) {
    out['unlock_by'] = {
      table: def.unlock_by.table,
      column: def.unlock_by.column,
      link: def.unlock_by.link,
      ...(def.unlock_by.where === undefined ? {} : { where: def.unlock_by.where.map((condition) => ({ ...condition })) }),
    };
  }
  if (def.pictures !== undefined) out['pictures'] = [...def.pictures];
  if (def.children !== undefined) out['children'] = orderedChildren(def.children);
  if (def.agrees !== undefined) out['agrees'] = def.agrees.map(orderedAgree);
  if (def.dry_run !== undefined) out['dry_run'] = def.dry_run;
  if (def.expect !== undefined) out['expect'] = def.expect;
  if (def.client_key !== undefined) out['client_key'] = def.client_key;
  if (def.find_or_create !== undefined) {
    const f = def.find_or_create;
    out['find_or_create'] = {
      identity_ref: f.identity_ref,
      email: f.email,
      link: f.link,
      ...(f.fill === undefined ? {} : { fill: { ...f.fill } }),
      ...(f.on === undefined ? {} : { on: { column: f.on.column, to: f.on.to } }),
    };
  }
  if (def.share_link !== undefined) out['share_link'] = { column: def.share_link.column, key: def.share_link.key };
  if (def.session_only !== undefined) out['session_only'] = def.session_only;
  if (def.forget !== undefined) {
    out['forget'] = {
      columns: [...def.forget.columns],
      ...(def.forget.stamp === undefined ? {} : { stamp: def.forget.stamp }),
      ...(def.forget.flags === undefined ? {} : { flags: [...def.forget.flags] }),
      ...(def.forget.links === undefined ? {} : { links: def.forget.links.map((link) => ({ table: link.table, column: link.column, people: [...link.people] })) }),
    };
  }
  if (def.new_link !== undefined) out['new_link'] = { column: def.new_link.column, kind: def.new_link.kind, ...(def.new_link.when === undefined ? {} : { when: structuredClone(def.new_link.when) }), ...(def.new_link.stopped === undefined ? {} : { stopped: def.new_link.stopped }) };
  if (def.withhold !== undefined) {
    out['withhold'] = {
      columns: [...def.withhold.columns],
      ...(def.withhold.unless_holder === undefined ? {} : { unless_holder: def.withhold.unless_holder }),
      ...(def.withhold.when === undefined ? {} : { when: structuredClone(def.withhold.when) }),
      ...(def.withhold.key === undefined ? {} : { key: def.withhold.key }),
      ...(def.withhold.own_link === undefined ? {} : { own_link: true }),
    };
  }
  return out;
}

/** An agreement, key by key. */
function orderedAgree(agree: z.infer<typeof endpointAgreeSchema>): Record<string, unknown> {
  const target = (t: AgreeTarget) =>
    'parent' in t ? { parent: t.parent, ...(t.path === undefined ? {} : { path: [...t.path] }) } : 'via' in t ? { via: t.via, column: t.column } : { value: t.value };
  return {
    column: agree.column,
    ...(agree.path === undefined ? {} : { path: [...agree.path] }),
    ...(agree.when === undefined ? {} : { when: { ...(agree.when.path === undefined ? {} : { path: [...agree.when.path] }), in: [...agree.when.in] } }),
    ...(agree.eq === undefined ? {} : { eq: target(agree.eq) }),
    ...(agree.lte === undefined ? {} : { lte: target(agree.lte) }),
    ...(agree.gte === undefined ? {} : { gte: target(agree.gte) }),
  };
}

/** Child rows, key by key, each level in the order it was written. */
function orderedChildren(children: Readonly<Record<string, z.infer<typeof grandchildSchema> & { children?: Record<string, z.infer<typeof grandchildSchema>> | undefined }>>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, c] of Object.entries(children)) {
    out[name] = {
      source: c.source,
      via: c.via,
      writable: [...c.writable],
      ...(c.select === undefined ? {} : { select: [...c.select] }),
      ...(c.defaults === undefined ? {} : { defaults: { ...c.defaults } }),
      ...(c.writable_values === undefined ? {} : { writable_values: { ...c.writable_values } }),
      ...(c.requires === undefined ? {} : { requires: [...c.requires] }),
      ...(c.position === undefined ? {} : { position: c.position }),
      ...(c.min === undefined ? {} : { min: c.min }),
      max: c.max,
      ...(c.agrees === undefined ? {} : { agrees: c.agrees.map(orderedAgree) }),
      ...(c.counts === undefined
        ? {}
        : {
            counts: c.counts.map((k) => ({
              by: [...k.by],
              ...(k.every === undefined ? {} : { every: { column: k.every.column, eq: { parent: k.every.eq.parent } } }),
              min: k.min,
              max: k.max,
            })),
          }),
      ...(c.plain_text === undefined ? {} : { plain_text: copyPlainText(c.plain_text) }),
      ...(c.sum_max === undefined ? {} : { sum_max: { column: c.sum_max.column, max: typeof c.sum_max.max === 'number' ? c.sum_max.max : { ...c.sum_max.max } } }),
      ...(c.children === undefined ? {} : { children: orderedChildren(c.children) }),
    };
  }
  return out;
}

/** The canonical stored and displayed text of a definition. */
export function printDefinition(def: PublicEndpointDefinition): string {
  return JSON.stringify(ordered(def), null, 2);
}

/* ------------------------------------------------------------------ issues */

export class EndpointCompileError extends Error {
  readonly issues: readonly ScopeIssue[];
  constructor(issues: readonly ScopeIssue[]) {
    super(`endpoint failed to compile: ${issues.map((i) => i.code).join(', ')}`);
    this.name = 'EndpointCompileError';
    this.issues = issues;
  }
}

/**
 * Parse a definition from text or a value. Shape problems come back as
 * `ENDPOINT_SHAPE_INVALID` issues, one per problem, with the path in `column`
 * the way `compileScope` reports its own.
 */
export function parseDefinition(
  input: unknown,
): { ok: true; definition: PublicEndpointDefinition } | { ok: false; issues: ScopeIssue[] } {
  let value = input;
  if (typeof input === 'string') {
    try {
      value = JSON.parse(input);
    } catch (error) {
      return {
        ok: false,
        issues: [{ code: 'ENDPOINT_SHAPE_INVALID', message: `not valid JSON: ${(error as Error).message}` }],
      };
    }
  }
  const parsed = publicEndpointDefinitionSchema.safeParse(value);
  if (parsed.success) return { ok: true, definition: parsed.data };
  return {
    ok: false,
    issues: parsed.error.issues.map((i) => {
      const path = i.path.join('.');
      return path === ''
        ? { code: 'ENDPOINT_SHAPE_INVALID', message: i.message }
        : { code: 'ENDPOINT_SHAPE_INVALID', message: i.message, column: path };
    }),
  };
}

/* ------------------------------------------------------------- table facts */

/** Resolve an endpoint's source against the view, or null when it is not addressable. */
export function sourceTable(view: SnapshotView, source: string): ResolvedTable | null {
  try {
    return view.table(source);
  } catch {
    return null;
  }
}

/** A column the database fills itself and a caller must never set: generated or identity. */
function serverOwned(column: EffectiveColumn): boolean {
  return column.isGenerated || column.default?.kind === 'autoincrement';
}

/** A copied value, a running number, a code, a total or a stamp: the write path fills it, never a caller. */
function decidedByAdminium(column: EffectiveColumn): boolean {
  return (
    column.copy !== undefined ||
    column.sequence !== undefined ||
    column.code !== undefined ||
    column.rollup !== undefined ||
    column.stamp !== undefined ||
    column.lookup !== undefined ||
    column.perNight !== undefined
  );
}

/** The columns of a table Adminium decides: its columns' own rules, a balance, and a booking's late flag. */
function decidedColumnsOf(table: ResolvedTable): Set<string> {
  const out = new Set(table.table.columns.filter(decidedByAdminium).map((c) => c.name));
  for (const column of table.table.columns) if (column.rollup?.balance !== undefined) out.add(column.rollup.balance.column);
  const flag = table.table.booking?.cancel?.flag;
  if (flag !== undefined) out.add(flag);
  // A late move's flag is Adminium's to set, as a booking's is.
  for (const late of table.table.states?.late ?? []) if (late.flag !== undefined) out.add(late.flag);
  return out;
}

/**
 * Columns a PUBLIC caller may not even be offered: secret ones are invisible
 * everywhere (`SnapshotView.column`), so they are treated as absent. A code
 * Adminium makes is not a secret — staff see it — and is offered only where a
 * definition names it: the defaults below leave it out.
 */
function visibleColumns(table: ResolvedTable): Set<string> {
  const out = new Set<string>();
  for (const column of table.columns.values()) if (!column.secret) out.add(column.name);
  return out;
}

/**
 * Whether every session that may read this endpoint proved the mailbox of
 * the rows it reads — so a read unmasks personal data for each of them
 * (`readsOwnPii` in `routes/public/index.ts`): a person's own rows (a
 * claim, a parent, a row's own link) at the `verified` level, or the
 * identity itself when signing in there proves the mailbox — a sign-in link
 * always does; an emailed code does at the `verified` level, since a found
 * session reads it before the code otherwise.
 */
function everyReaderProvesMailbox(def: PublicEndpointDefinition): boolean {
  const verified = def.level === 'verified';
  if (def.identity !== undefined) return verified || def.identity.strategy === 'email-link';
  if (def.claim !== undefined) return verified && def.claim.optional !== true;
  return verified && def.visible_with !== undefined;
}

/** PII-masked columns, as the operator last decided (an override beats the classifier). */
function maskedColumns(table: ResolvedTable): ReadonlySet<string> {
  return columnPolicyFor(table.table).masked;
}

/**
 * Tables whose foreign keys point here with an action that changes THEIR rows
 * when one of these is deleted. Self-references count: the rows they change
 * are in this table, but outside whatever predicate the endpoint holds.
 */
function cascadingReferrers(view: SnapshotView, table: ResolvedTable): string[] {
  const out = new Set<string>();
  for (const relation of view.model.relations) {
    if (relation.through !== null || relation.to.tableId !== table.id) continue;
    if (relation.onDelete === 'cascade' || relation.onDelete === 'set-null' || relation.onDelete === 'set-default') {
      out.add(relation.from.tableId);
    }
  }
  return [...out].sort();
}

/* ------------------------------------------------------ definition → resource */

/**
 * The columns `writable` defaults to: what is selected, minus everything a
 * caller must not choose — the primary key, generated and identity columns,
 * every column the mandatory filters name, every claim column, and every
 * column the server mints. Each subtraction is the reason one of the
 * scope compiler's refusals can never fire on a default.
 */
function defaultWritable(def: PublicEndpointDefinition, table: ResolvedTable | null): string[] {
  const out = new Set(def.select);
  if (table !== null) {
    for (const pk of table.primaryKey) out.delete(pk);
    const decided = decidedColumnsOf(table);
    for (const column of table.table.columns) if (serverOwned(column) || decided.has(column.name)) out.delete(column.name);
  }
  for (const f of def.filters) out.delete(f.column);
  if (def.claim?.column !== undefined) out.delete(def.claim.column);
  if (def.claim?.via !== undefined) out.delete(def.claim.via.localColumn);
  if (def.identity !== undefined) out.delete(def.identity.column);
  for (const [column, value] of Object.entries(def.defaults ?? {})) {
    if (readGenerator(value) !== null) out.delete(column);
  }
  return def.select.filter((c) => out.has(c));
}

function responseShapeOf(def: PublicEndpointDefinition): PublicResponseShape {
  return def.response.shape === 'object' ? 'wrapped' : def.response.shape;
}

/**
 * THE mapping from an endpoint to a scope resource — the only
 * one, used by the derived documents and by this file's own compile.
 *
 * `granted` is the methods a key holds; the resource's actions are the ones
 * the endpoint ALSO offers. An empty intersection is returned as an empty
 * action list, and the deriver drops such a resource.
 *
 * `table` supplies the facts `writable`'s default subtracts. It may be null
 * for a source that has gone; the derived compile then refuses the resource
 * on its unknown table, which is the report the operator needs.
 */
export function definitionToResource(
  ref: string,
  def: PublicEndpointDefinition,
  granted: readonly PublicMethod[],
  table: ResolvedTable | null,
): PublicScopeResource {
  const offered = new Set(def.methods);
  const actions = canonicalMethods(granted.filter((m) => offered.has(m))).map((m) => METHOD_ACTION[m]);
  const orderColumn = def.pagination.order.slice(0, def.pagination.order.lastIndexOf('.'));
  const claim =
    def.identity !== undefined
      ? { column: def.identity.column }
      : def.claim === undefined
        ? undefined
        : {
            ...(def.claim.column === undefined ? {} : { column: def.claim.column }),
            ...(def.claim.via === undefined ? {} : { via: { ...def.claim.via } }),
            ...(def.claim.ref === undefined ? {} : { ref: def.claim.ref }),
            ...(def.claim.optional === undefined ? {} : { optional: def.claim.optional }),
          };
  const resource: PublicScopeResource = {
    ref,
    table: def.source,
    actions,
    expose: [...def.select],
    filterable: [...(def.filterable ?? [])],
    searchable: [...(def.searchable ?? [])],
    orderable: [...(def.orderable ?? [])],
    where: def.filters.map(filterOf) as PublicScopeResource['where'],
    /*
     * Nothing is writable through a door that takes no write. The default —
     * "what is selected, minus what a caller must not choose" — is for an
     * endpoint that writes and names no columns; given to a read-only one it
     * published a list of columns nobody could send. A page that finds its
     * door by what it may write (a client's "I've sent a payment") then chose
     * the read-only door of the same table, and every such write answered 404.
     */
    writable: def.writable !== undefined ? [...def.writable] : actions.some((action) => SENDS_VALUES.has(action)) ? defaultWritable(def, table) : [],
    defaults: { ...(def.defaults ?? {}) },
    sensitive: def.sensitive ?? false,
    limit: def.pagination.max_limit,
    defaultLimit: def.pagination.default_limit,
    ...(orderColumn.length > 0 ? { defaultOrder: def.pagination.order } : {}),
    rate: { max: def.rate_limit.requests, windowMs: RATE_WINDOWS[def.rate_limit.window] },
    response: { shape: responseShapeOf(def) },
    count: 'none',
  };
  if (claim !== undefined) resource.claim = claim;
  if (def.visible_with !== undefined) resource.visibleWith = { ...def.visible_with };
  if (def.kind === 'availability') {
    resource.kind = 'availability';
    const answered = table?.table.capacityRules?.[def.capacity_rule ?? 0]?.kind;
    if (answered !== undefined) resource.capacity = answered;
    if (def.capacity_rule !== undefined) resource.capacityRule = def.capacity_rule;
    if (def.show_left !== undefined) resource.showLeft = 'below' in def.show_left ? { below: def.show_left.below } : { belowShare: def.show_left.below_share };
    if (def.under !== undefined) resource.under = def.under;
  }
  if (def.confirm !== undefined) resource.confirm = { ...def.confirm };
  if (def.writable_values !== undefined) resource.writableValues = { ...def.writable_values };
  if (def.requires !== undefined) resource.requires = [...def.requires];
  if (def.files !== undefined) resource.files = [...def.files];
  if (def.writable_when !== undefined) resource.writableWhen = { ...def.writable_when };
  if (def.level !== undefined) resource.level = def.level;
  if (def.human_check !== undefined) resource.humanCheck = true;
  if (def.on_claim !== undefined) resource.onClaim = { clear: [...def.on_claim.clear] };
  if (def.max_open !== undefined) resource.maxOpen = { ...def.max_open };
  if (def.rank !== undefined) resource.rank = { orderBy: def.rank.order_by, ...(def.rank.where === undefined ? {} : { where: { ...def.rank.where } }) };
  if (def.require_setting !== undefined) resource.requireSetting = def.require_setting.map((setting) => ({ ...setting }));
  if (def.anonymous !== undefined) {
    const caps = def.anonymous;
    resource.anonymous = {
      ...(caps.per_value === undefined ? {} : { perValue: { columns: [...caps.per_value.columns], n: caps.per_value.n } }),
      ...(caps.per_key_hour === undefined ? {} : { perKeyHour: caps.per_key_hour }),
      ...(caps.per_ip_hour === undefined ? {} : { perIpHour: caps.per_ip_hour }),
      ...(caps.plain_text === undefined ? {} : { plainText: copyPlainText(caps.plain_text) }),
    };
  }
  if (def.limits !== undefined) {
    const limits = def.limits;
    resource.limits = {
      ...(limits.per_value === undefined ? {} : { perValue: { columns: [...limits.per_value.columns], n: limits.per_value.n } }),
      ...(limits.plain_text === undefined ? {} : { plainText: copyPlainText(limits.plain_text) }),
    };
  }
  if (def.children !== undefined) resource.children = childResources(def.children);
  if (def.agrees !== undefined) resource.agrees = def.agrees.map((agree) => structuredClone(agree));
  if (def.dry_run !== undefined) resource.dryRun = true;
  if (def.expect !== undefined) resource.expect = def.expect;
  if (def.client_key !== undefined) resource.clientKey = def.client_key;
  if (def.find_or_create !== undefined) {
    const f = def.find_or_create;
    resource.findOrCreate = { identityRef: f.identity_ref, email: f.email, link: f.link, ...(f.fill === undefined ? {} : { fill: { ...f.fill } }), ...(f.on === undefined ? {} : { on: { ...f.on } }) };
  }
  if (def.share_link !== undefined) resource.shareLink = { ...def.share_link };
  if (def.session_only !== undefined) resource.sessionOnly = true;
  if (def.forget !== undefined) {
    resource.forget = {
      columns: [...def.forget.columns],
      ...(def.forget.stamp === undefined ? {} : { stamp: def.forget.stamp }),
      ...(def.forget.flags === undefined ? {} : { flags: [...def.forget.flags] }),
      ...(def.forget.links === undefined ? {} : { links: def.forget.links.map((link) => ({ ...link, people: [...link.people] })) }),
    };
  }
  if (def.new_link !== undefined) resource.newLink = { column: def.new_link.column, kind: def.new_link.kind, ...(def.new_link.when === undefined ? {} : { when: structuredClone(def.new_link.when) }), ...(def.new_link.stopped === undefined ? {} : { stopped: def.new_link.stopped }) };
  if (def.withhold !== undefined) {
    resource.withhold = {
      columns: [...def.withhold.columns],
      ...(def.withhold.unless_holder === undefined ? {} : { unlessHolder: def.withhold.unless_holder }),
      ...(def.withhold.when === undefined ? {} : { when: structuredClone(def.withhold.when) }),
    };
  }
  if (def.unlock_by !== undefined) {
    const u = def.unlock_by;
    resource.unlockBy = {
      table: u.table,
      column: u.column,
      link: u.link,
      ...(u.where === undefined
        ? {}
        : {
            where: u.where.map((w) =>
              'eq' in w
                ? { column: w.column, eq: w.eq }
                : 'not_before' in w
                  ? { column: w.column, notBefore: w.not_before, ...(w.or_empty === undefined ? {} : { orEmpty: w.or_empty }) }
                  : { column: w.column, notAfter: w.not_after, ...(w.or_empty === undefined ? {} : { orEmpty: w.or_empty }) },
            ),
          }),
    };
  }
  if (def.pictures !== undefined) resource.pictures = [...def.pictures];
  return resource;
}

/** A definition's child rows as the scope keeps them: camel case, each level the same. */
function childResources(children: Readonly<Record<string, EndpointChild>>): Record<string, ScopeChild> {
  const out: Record<string, ScopeChild> = {};
  for (const [name, c] of Object.entries(children)) {
    out[name] = {
      table: c.source,
      via: c.via,
      writable: [...c.writable],
      ...(c.select === undefined ? {} : { select: [...c.select] }),
      ...(c.defaults === undefined ? {} : { defaults: { ...c.defaults } }),
      ...(c.writable_values === undefined ? {} : { writableValues: { ...c.writable_values } }),
      ...(c.requires === undefined ? {} : { requires: [...c.requires] }),
      ...(c.position === undefined ? {} : { position: c.position }),
      ...(c.min === undefined ? {} : { min: c.min }),
      max: c.max,
      ...(c.agrees === undefined ? {} : { agrees: c.agrees.map((agree) => structuredClone(agree)) }),
      ...(c.counts === undefined ? {} : { counts: c.counts.map((counts) => structuredClone(counts)) }),
      ...(c.plain_text === undefined ? {} : { plainText: copyPlainText(c.plain_text) }),
      ...(c.sum_max === undefined ? {} : { sumMax: structuredClone(c.sum_max) }),
      ...(c.children === undefined ? {} : { children: childResources(c.children) }),
    };
  }
  return out;
}

/* ---------------------------------------------------------------- compiling */

export interface EndpointCompileContext {
  /**
   * The ref the definition is being saved under (the builder's URL), which
   * `path` must spell. A rename is its own request.
   */
  ref: string;
  /** The connection's schema, or null when it has never been introspected. */
  view: SnapshotView | null;
  /**
   * True when a key bound to a hosted app is granted this endpoint. A hosted
   * app's pages read `{ data }`, so a bare or single list would render empty
   * with no error anywhere.
   */
  grantedToAppBoundKey?: boolean;
  /**
   * The codes shared links open rows with on this connection, by source
   * table: every other endpoint's `identity: { strategy: 'token' }` columns
   * (`shareCodesOf`). None of them may be shown, filtered, searched or
   * ordered by here — the code leaves only as its link.
   */
  shareCodes?: ReadonlyMap<string, ReadonlySet<string>>;
}

/** The codes shared links open rows with, by source table, across these definitions. */
export function shareCodesOf(definitions: Iterable<PublicEndpointDefinition>): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const def of definitions) {
    if (def.identity?.strategy !== 'token' || def.methods.length === 0) continue;
    const codes = out.get(def.source) ?? new Set<string>();
    for (const column of def.identity.match) codes.add(column);
    out.set(def.source, codes);
  }
  return out;
}

/** Every column a definition shows, filters, searches or orders by — where a share code may never be named. */
export function readsOf(def: PublicEndpointDefinition): { list: string; column: string }[] {
  const order = def.pagination.order.slice(0, def.pagination.order.lastIndexOf('.'));
  return [
    ...def.select.map((column) => ({ list: 'select', column })),
    ...def.filters.map((filter) => ({ list: 'filters', column: filter.column })),
    ...(def.filterable ?? []).map((column) => ({ list: 'filterable', column })),
    ...(def.searchable ?? []).map((column) => ({ list: 'searchable', column })),
    ...(def.orderable ?? []).map((column) => ({ list: 'orderable', column })),
    ...(order === '' ? [] : [{ list: 'order', column: order }]),
    ...(def.rank === undefined ? [] : [{ list: 'rank', column: def.rank.order_by }, ...(def.rank.where === undefined ? [] : [{ list: 'rank', column: def.rank.where.column }])]),
  ];
}

/** Which limit an availability endpoint answers, and how much of it a page may be told. */
function availabilityShapeIssues(def: PublicEndpointDefinition, table: ResolvedTable, view: SnapshotView): ScopeIssue[] {
  const out: ScopeIssue[] = [];
  const rules = table.table.capacityRules ?? [];
  const named = def.capacity_rule !== undefined || def.show_left !== undefined || def.under !== undefined;
  if (rules.length === 0) {
    if (named) out.push({ code: 'ENDPOINT_AVAILABILITY_NO_LIMIT', message: `${def.source} has no limit for capacity_rule, show_left or under to answer` });
    return out;
  }
  const index = def.capacity_rule ?? 0;
  const rule = rules[index];
  if (rule === undefined) {
    out.push({ code: 'ENDPOINT_AVAILABILITY_NO_LIMIT', message: `${def.source} has ${rules.length} limit${rules.length === 1 ? '' : 's'}, so capacity_rule is 0 to ${rules.length - 1}`, column: 'capacity_rule' });
    return out;
  }
  if (def.show_left !== undefined && rule.kind === 'slot') {
    out.push({ code: 'ENDPOINT_AVAILABILITY_SHAPE', message: 'what is left is shown of a pool: a parent or night limit', column: 'show_left' });
  }
  if (def.under !== undefined) {
    if (rule.kind !== 'parent') {
      out.push({ code: 'ENDPOINT_AVAILABILITY_SHAPE', message: 'under asks a parent limit by a column of its pools', column: 'under' });
    } else {
      const relation = view.model.relations.find(
        (r) => r.through === null && r.from.tableId === table.id && r.from.columns.length === 1 && r.from.columns[0] === rule.via,
      );
      const target = relation === undefined ? null : sourceTable(view, relation.to.tableId);
      if (target !== null && !target.columns.has(def.under)) {
        out.push({ code: 'ENDPOINT_AVAILABILITY_SHAPE', message: `"${def.under}" is not a column of ${target.id}`, column: 'under' });
      }
    }
  }
  if (rule.kind === 'night' && 'size' in rule.pool && rule.pool.size === 1) {
    out.push({ code: 'ENDPOINT_AVAILABILITY_ONE_ROW', message: 'availability answers a pool, not one row', column: 'capacity_rule' });
  }
  return out;
}

/**
 * An endpoint that shows rows only with the code that unlocks them: a read, of
 * its own, through a real link — and a column that is a code: one row per
 * code (unique, alone or with its scope, or a code Adminium makes), compared
 * as a code, and never a shared link's secret (which would make the GET a
 * way to test guesses at it).
 */
function unlockIssues(def: PublicEndpointDefinition, table: ResolvedTable, view: SnapshotView, shareCodes?: ReadonlyMap<string, ReadonlySet<string>>): ScopeIssue[] {
  const out: ScopeIssue[] = [];
  const unlock = def.unlock_by!;
  if (def.methods.some((m) => m !== 'GET')) out.push({ code: 'ENDPOINT_UNLOCK_READ_ONLY', message: 'an unlock only reads' });
  if (def.claim !== undefined || def.identity !== undefined || def.visible_with !== undefined || def.kind === 'availability') {
    out.push({ code: 'ENDPOINT_UNLOCK_ALONE', message: 'an unlock is its own endpoint: no claim, identity, parent or availability' });
  }
  const codes = sourceTable(view, unlock.table);
  if (codes === null) {
    out.push({ code: 'ENDPOINT_UNLOCK_UNKNOWN_COLUMN', message: `${unlock.table} is not a table of this connection`, column: 'unlock_by.table' });
    return out;
  }
  for (const [name, column] of [['column', unlock.column], ['link', unlock.link], ...(unlock.where ?? []).map((w) => ['where', w.column] as const)] as const) {
    if (!codes.columns.has(column)) out.push({ code: 'ENDPOINT_UNLOCK_UNKNOWN_COLUMN', message: `"${column}" is not a column of ${unlock.table}`, column: `unlock_by.${name}` });
  }
  const link = view.model.relations.find(
    (r) => r.through === null && r.from.tableId === codes.id && r.from.columns.length === 1 && r.from.columns[0] === unlock.link,
  );
  if (codes.columns.has(unlock.link) && link?.to.tableId !== table.id) {
    out.push({ code: 'ENDPOINT_UNLOCK_UNKNOWN_COLUMN', message: `${unlock.table}.${unlock.link} does not point at ${def.source}`, column: 'unlock_by.link' });
  }
  const code = codes.table.columns.find((column) => column.name === unlock.column);
  if (code !== undefined) {
    const made = code.code !== undefined;
    const unique =
      made ||
      (codes.table.primaryKey.length === 1 && codes.table.primaryKey[0] === unlock.column) ||
      (codes.table.uniques ?? []).some((u) => u.columns.includes(unlock.column)) ||
      (codes.table.indexes ?? []).some((index) => index.unique && index.columns.includes(unlock.column));
    if (!unique) out.push({ code: 'ENDPOINT_UNLOCK_NOT_A_CODE', message: `a code finds one row: make ${unlock.table}.${unlock.column} unique (or unique with its scope)`, column: 'unlock_by.column' });
    if (!made && code.normalize !== 'code') out.push({ code: 'ENDPOINT_UNLOCK_NOT_A_CODE', message: `${unlock.table}.${unlock.column} is compared as a code: store it as one (normalize "code")`, column: 'unlock_by.column' });
    const secret = codes.columns.get(unlock.column)?.secret === true;
    if (secret || shareCodes?.get(unlock.table)?.has(unlock.column) === true || shareCodes?.get(codes.id)?.has(unlock.column) === true) {
      out.push({ code: 'ENDPOINT_UNLOCK_SHARE_CODE', message: `${unlock.table}.${unlock.column} opens rows by a shared link, so it is never looked up`, column: 'unlock_by.column' });
    }
  }
  return out;
}

/** Pictures anyone may see: shown columns of an open read, which no caller writes. */
function pictureIssues(def: PublicEndpointDefinition, table: ResolvedTable): ScopeIssue[] {
  const out: ScopeIssue[] = [];
  if (def.methods.some((m) => m !== 'GET') || def.kind === 'availability') {
    out.push({ code: 'ENDPOINT_PICTURES_READ_ONLY', message: 'pictures are shown through an endpoint that only reads rows' });
  }
  if (def.auth.role !== 'anon' || def.claim !== undefined || def.identity !== undefined || def.visible_with !== undefined || def.session_only === true) {
    out.push({ code: 'ENDPOINT_PICTURES_CLAIMED', message: "pictures are for every visitor; a signed-in person's own files are `files`" });
  }
  // A picture is fetched by an <img>, which carries no session: rows only a code opens are no rows it can show.
  if (def.unlock_by !== undefined) {
    out.push({ code: 'ENDPOINT_PICTURES_CLAIMED', message: 'pictures are for every visitor; rows a code unlocks are read only by whoever gave the code' });
  }
  const visible = visibleColumns(table);
  const written = new Set([...(def.writable ?? []), ...Object.keys(def.defaults ?? {})]);
  for (const column of def.pictures ?? []) {
    if (!visible.has(column)) out.push({ code: 'ENDPOINT_PICTURES_UNKNOWN_COLUMN', message: `"${column}" is not a column of ${def.source}`, column });
    else if (!def.select.includes(column)) out.push({ code: 'ENDPOINT_PICTURES_NOT_SELECTED', message: `"${column}" is a picture, so it is one of the columns shown`, column });
    if (written.has(column) || (def.files ?? []).includes(column)) out.push({ code: 'ENDPOINT_PICTURES_WRITABLE', message: `"${column}" is a picture anyone sees, so no caller writes it`, column });
  }
  return out;
}

/**
 * Every issue with a definition, in one list — the scope compiler's
 * discipline, because an operator fixing a definition should see all of it.
 *
 * Two layers. The `ENDPOINT_*` checks below are the ones only an endpoint can
 * make (its source, its methods against what the source supports, its path).
 * Then the definition, mapped with every method it offers, goes through
 * `compileScope` as a one-resource document, so each `SCOPE_*` refusal a
 * derived scope would raise is reported HERE, before anything is stored.
 */
export function endpointIssues(input: unknown, ctx: EndpointCompileContext): ScopeIssue[] {
  const parsed = parseDefinition(input);
  if (!parsed.ok) return parsed.issues;
  const def = parsed.definition;
  const { ref, view } = ctx;
  const issues: ScopeIssue[] = [];
  const push = (code: string, message: string, column?: string): void => {
    issues.push(column === undefined ? { code, message, ref } : { code, message, ref, column });
  };

  if (!ENDPOINT_REF_PATTERN.test(ref) || ref.length > REF_MAX) {
    push('ENDPOINT_REF_INVALID', `"${ref}" is not a ref: start with a lower-case letter, then letters, digits and _`);
  }
  if (def.path !== `/${ref}`) {
    push('ENDPOINT_PATH_MISMATCH', `path is "${def.path}" but this endpoint is "/${ref}" — rename it instead`);
  }

  const methods = new Set(def.methods);
  if (methods.size !== def.methods.length) {
    push('ENDPOINT_SHAPE_INVALID', 'a method is listed twice', 'methods');
  }

  const { default_limit: defaultLimit, max_limit: maxLimit } = def.pagination;
  if (maxLimit > MAX_LIMIT_CEILING || defaultLimit > maxLimit) {
    push(
      'ENDPOINT_LIMIT_ORDER',
      `a page is 1 to ${MAX_LIMIT_CEILING} rows, and the default (${defaultLimit}) may not exceed the maximum (${maxLimit})`,
    );
  }

  const perMinute = (def.rate_limit.requests * 60_000) / RATE_WINDOWS[def.rate_limit.window];
  if (perMinute > RATE_PER_MINUTE_CEILING) {
    push(
      'ENDPOINT_RATE_RANGE',
      `${def.rate_limit.requests} per ${def.rate_limit.window} is ${Math.round(perMinute)} a minute; the most is ${RATE_PER_MINUTE_CEILING}`,
    );
  }

  if (def.select.length === 0) push('ENDPOINT_SELECT_EMPTY', 'select at least one column');

  if (def.auth.role === 'authenticated' && def.claim === undefined && def.identity === undefined && def.visible_with === undefined && def.session_only !== true) {
    push(
      'ENDPOINT_AUTHENTICATED_WITHOUT_CLAIM',
      'an authenticated endpoint needs a claim column, a claim via another endpoint, an identity, a parent it is visible with, or to be read by a session alone',
    );
  }
  // A child is a signed-in person's own rows, through its parent: never open to anyone.
  if (def.visible_with !== undefined && def.auth.role !== 'authenticated') {
    push('ENDPOINT_VISIBLE_WITH_ANON', 'an endpoint visible with a parent is a signed-in person’s rows, so it is authenticated');
  }
  if (def.visible_with !== undefined && def.identity !== undefined) {
    push('ENDPOINT_IDENTITY_WITH_CLAIM', 'an identity endpoint is opened by its own claim, not by a parent');
  }
  if (def.identity !== undefined && def.claim !== undefined) {
    push('ENDPOINT_IDENTITY_WITH_CLAIM', 'an identity endpoint carries its own claim column — remove `claim`');
  }
  if (def.identity !== undefined && !methods.has('GET')) {
    push('ENDPOINT_IDENTITY_NEEDS_GET', 'a claim is resolved by reading this endpoint, so it must offer GET');
  }

  if (ctx.grantedToAppBoundKey === true && def.response.shape !== 'object') {
    push(
      'ENDPOINT_SHAPE_APP_BOUND',
      "a hosted app's pages read { data }; keep this endpoint wrapped while an app's key is granted it",
    );
  }

  const orderColumn = def.pagination.order.slice(0, def.pagination.order.lastIndexOf('.'));
  if (!def.select.includes(orderColumn)) {
    push('ENDPOINT_ORDER_NOT_SELECTED', `the order column "${orderColumn}" is not selected`, orderColumn);
  }

  /* ── the source ──────────────────────────────────────────────────────── */
  if (/(^|\.)adminium_[^.]*$/.test(def.source)) {
    push('ENDPOINT_SOURCE_META_NAMESPACE', `${def.source} is in the adminium_ namespace, which is never publishable`);
    return issues;
  }
  const table = view === null ? null : sourceTable(view, def.source);
  if (table === null) {
    push(
      'ENDPOINT_SOURCE_UNKNOWN',
      view === null
        ? 'this connection has not been introspected yet'
        : `${def.source} is not a table or view of this connection — re-introspect, or pick another source`,
    );
    return issues;
  }

  /*
   * An EMPTY method list is a switched-off endpoint (a tombstone):
   * nothing about its columns can be reached, so nothing about them is
   * checked. That is what lets an operator switch off an endpoint whose table
   * has drifted, instead of being told to repair it first.
   */
  if (methods.size === 0) return issues;

  if (def.confirm !== undefined) {
    // Every column the confirmation reads is one of this table's, or of its venue's.
    const own = new Set(table.columns.keys());
    const { to, code, when, party, name } = def.confirm;
    for (const column of [to, code, when, party, name]) {
      if (column !== undefined && !own.has(column)) push('ENDPOINT_CONFIRM_UNKNOWN_COLUMN', `"${column}" is not a column of ${def.source}`, column);
    }
    if (!def.methods.includes('POST')) push('ENDPOINT_CONFIRM_NO_CREATE', 'a confirmation is sent when a row is created, and this endpoint creates none');
    const venue = def.confirm.venue;
    if (venue !== undefined) {
      const settings = view === null ? null : sourceTable(view as SnapshotView, venue.table);
      if (settings === null) {
        push('ENDPOINT_CONFIRM_UNKNOWN_COLUMN', `${venue.table} is not a table of this connection`);
      } else {
        for (const column of [venue.name, venue.address, venue.phone]) {
          if (column !== undefined && !settings.columns.has(column)) push('ENDPOINT_CONFIRM_UNKNOWN_COLUMN', `"${column}" is not a column of ${venue.table}`, column);
        }
      }
    }
  }

  /*
   * A child's batch runs inside a transaction the route opens, so its
   * references are checked where the write happens. A slot or a person's
   * time is held by a named lock that MySQL refuses to take inside an open
   * transaction, so a guarded table is not a child a batch creates.
   */
  // A single create of one is made as a create of one row, its limit's locks taken first (`routes/public`); a batch is not.
  if (
    def.visible_with !== undefined &&
    methods.has('BATCH') &&
    (table.table.capacity !== undefined || table.table.capacityRules !== undefined || table.table.booking !== undefined)
  ) {
    push('ENDPOINT_VISIBLE_WITH_GUARDED', `${def.source} holds a booking limit, so rows visible with a parent are created one at a time, never in a batch`);
  }

  if (def.kind === 'availability') {
    // Free or full, per slot, and nothing else: a read of the booking limit.
    const capacity = table.table.capacity;
    const rules = table.table.capacityRules ?? [];
    if ([...methods].some((m) => m !== 'GET')) push('ENDPOINT_AVAILABILITY_READ_ONLY', 'availability answers GET only');
    if (capacity === undefined && rules.length === 0 && table.table.booking === undefined) {
      push('ENDPOINT_AVAILABILITY_NO_LIMIT', `${def.source} has no booking limit to answer availability from`);
    } else if (capacity?.resource !== undefined || rules.some((rule) => rule.kind === 'slot' && rule.resource !== undefined)) {
      // A booking rule answers per person; a capacity limit per table or room does not yet.
      push('ENDPOINT_AVAILABILITY_PER_RESOURCE', 'availability for a limit per table or room is not offered yet');
    }
    issues.push(...availabilityShapeIssues(def, table, view as SnapshotView).map((issue) => ({ ...issue, ref })));
  } else {
    for (const [name, value] of [['capacity_rule', def.capacity_rule], ['show_left', def.show_left], ['under', def.under]] as const) {
      if (value !== undefined) push('ENDPOINT_AVAILABILITY_SHAPE', `${name} shapes an availability answer, and this endpoint reads rows`, name);
    }
  }
  if (def.unlock_by !== undefined) issues.push(...unlockIssues(def, table, view as SnapshotView, ctx.shareCodes).map((issue) => ({ ...issue, ref })));
  if (def.pictures !== undefined) issues.push(...pictureIssues(def, table).map((issue) => ({ ...issue, ref })));

  /*
   * A shared link's code — this endpoint's, or another's on the same table,
   * anonymous or not — is never shown, filtered, searched or ordered by: it
   * leaves only as the link itself (its own claim compares it, and nothing
   * else names it).
   */
  const codes = new Set(ctx.shareCodes?.get(def.source) ?? []);
  const own = def.identity?.strategy === 'token' ? def.identity.match : [];
  for (const column of own) codes.add(column);
  for (const { list, column } of readsOf(def)) {
    if (!codes.has(column) || (list === 'select' && own.includes(column))) continue;
    push('ENDPOINT_SHARE_CODE_READ', `"${column}" is the code a shared link opens its row with, so no endpoint shows, filters, searches or orders by it (${list})`, column);
  }

  const visible = visibleColumns(table);
  for (const column of def.select) {
    if (!visible.has(column)) {
      push('ENDPOINT_SELECT_UNKNOWN_COLUMN', `"${column}" is not a column of ${def.source}`, column);
    } else if (def.identity?.strategy === 'token' && def.identity.match.includes(column)) {
      // Staff may read a shared link's code; the page it opens never shows it.
      push('ENDPOINT_SELECT_TOKEN', `"${column}" is the code a shared link opens its row with, so it is never shown`, column);
    }
  }

  const readOnlyKind = table.table.kind !== 'table';
  const hasKey = table.primaryKey.length > 0;
  for (const method of canonicalMethods(def.methods)) {
    if (method === 'GET') continue;
    if (readOnlyKind || (KEYED_METHODS.has(method) && !hasKey)) {
      push(
        'ENDPOINT_SOURCE_READ_ONLY',
        readOnlyKind
          ? `${def.source} is a view, so it answers GET only`
          : `${def.source} has no primary key, so a row cannot be addressed for ${method}`,
      );
    }
  }

  /*
   * A caller who can write a key can re-key rows, and one who can write a
   * generated or identity column is contradicting the database. Refused on
   * the endpoint whatever its `writable` came from; a hand-written scope is
   * not newly refused (54 acceptance 9).
   */
  const writable =
    def.writable ?? definitionToResource(ref, def, def.methods, table).writable;
  const pk = new Set(table.primaryKey);
  const owned = new Set(table.table.columns.filter(serverOwned).map((c) => c.name));
  const decided = decidedColumnsOf(table);
  if (def.methods.some((m) => WRITING_METHODS.has(m))) {
    for (const column of writable) {
      if (pk.has(column) || owned.has(column)) {
        push(
          'ENDPOINT_WRITABLE_PRIMARY_KEY',
          `"${column}" is ${pk.has(column) ? 'the primary key' : 'filled by the database'} and cannot be writable`,
          column,
        );
      } else if (decided.has(column)) {
        // A guest never picks a price, a number or a code.
        push('ENDPOINT_WRITABLE_DECIDED', `"${column}" is decided by Adminium and cannot be writable`, column);
      }
    }
  }

  // What a signed-in create empties, counts and ranks by: columns of this table.
  const named = [
    ...(def.on_claim?.clear ?? []).map((column) => ['on_claim', column] as const),
    ...(def.max_open === undefined ? [] : [['max_open', def.max_open.column] as const, ...(def.max_open.upcoming === undefined ? [] : [['max_open', def.max_open.upcoming] as const])]),
    ...(def.rank === undefined ? [] : [['rank', def.rank.order_by] as const, ...(def.rank.where === undefined ? [] : [['rank', def.rank.where.column] as const])]),
    ...(def.identity?.email === undefined ? [] : [['identity', def.identity.email] as const]),
    ...[...(def.anonymous?.per_value?.columns ?? []), ...plainColumns(def.anonymous?.plain_text)].map((column) => ['anonymous', column] as const),
    ...[...(def.limits?.per_value?.columns ?? []), ...plainColumns(def.limits?.plain_text)].map((column) => ['limits', column] as const),
  ];
  for (const [key, column] of named) {
    if (!table.columns.has(column)) push('ENDPOINT_COLUMN_UNKNOWN', `"${column}" (${key}) is not a column of ${def.source}`, column);
  }
  // A switch is a yes/no column of a table this connection has.
  for (const setting of view === null ? [] : (def.require_setting ?? [])) {
    let type: string | undefined;
    try {
      type = view?.table(setting.table).columns.get(setting.column)?.logicalType;
    } catch {
      type = undefined;
    }
    // A yes/no: a boolean, or the 0/1 integer SQLite and MySQL keep one in.
    if (type !== 'boolean' && type !== 'integer') push('ENDPOINT_SETTING_NOT_A_SWITCH', `"${setting.table}.${setting.column}" is not a yes/no column of this database`, setting.column);
  }
  if (def.max_open?.upcoming !== undefined) {
    const type = table.columns.get(def.max_open.upcoming)?.logicalType;
    if (type !== undefined && type !== 'timestamp' && type !== 'timestamptz') {
      push('ENDPOINT_WRITABLE_WHEN_NOT_A_TIME', `"${def.max_open.upcoming}" is not a time, so "upcoming" cannot apply`, def.max_open.upcoming);
    }
  }

  // A calendar filter counts days on a date or a time; `from-now` and a window ask for a time.
  for (const f of def.filters) {
    if (f.op !== 'today' && f.op !== 'from-today') continue;
    const type = table.columns.get(f.column)?.logicalType;
    if (type !== undefined && !DAY_TYPES.has(type)) {
      push('ENDPOINT_FILTER_NOT_A_DAY', `"${f.column}" is not a date or a time, so "${f.op}" cannot apply`, f.column);
    }
  }
  // A create only (no change) is judged against its parent's window alone: a window keyed by anything but the link to it would be judged by nothing.
  const createOnly = def.methods.includes('POST') && !def.methods.includes('PATCH') && !def.methods.includes('PUT');
  for (const [column, when] of Object.entries(def.writable_when ?? {})) {
    if (createOnly && isMomentWindow(when) && def.visible_with?.localColumn !== column) {
      push('SCOPE_WRITABLE_WHEN_MOMENT_INVALID', `a create is judged against its parent's window, keyed by the link to it — "${column}" is not`, column);
    }
    const type = table.columns.get(column)?.logicalType;
    const timed = when === 'from-now' ? 'from-now' : isTimeWindow(when) ? 'within' : null;
    if (timed !== null && type !== undefined && type !== 'timestamp' && type !== 'timestamptz') {
      push('ENDPOINT_WRITABLE_WHEN_NOT_A_TIME', `"${column}" is not a time, so "${timed}" cannot apply`, column);
    }
    if (when === 'from-today' && type !== undefined && !DAY_TYPES.has(type)) {
      push('ENDPOINT_FILTER_NOT_A_DAY', `"${column}" is not a date or a time, so "from-today" cannot apply`, column);
    }
    // An upper bound on a day: only a date column compares safely on every engine (`beforeToday`).
    if (when === 'before-today' && type !== undefined && type !== 'date') {
      push('ENDPOINT_FILTER_NOT_A_DATE', `"${column}" is not a date, so "before-today" cannot apply`, column);
    }
    // A window read from this column's own moment needs a date or a time; one naming a linked column is read through the link.
    if (isMomentWindow(when) && type !== undefined && [when.after, when.before].every((end) => end === undefined || end.column === undefined) && when.where === undefined) {
      if (!DAY_TYPES.has(type)) push('SCOPE_WRITABLE_WHEN_MOMENT_INVALID', `"${column}" is not a date or a time, so no window is read from it`, column);
    }
  }

  if (methods.has('DELETE') && def.allow_cascade !== true) {
    const referrers = cascadingReferrers(view as SnapshotView, table);
    if (referrers.length > 0) {
      push(
        'ENDPOINT_DELETE_CASCADES',
        `deleting from ${def.source} also changes rows of ${referrers.join(', ')} through ON DELETE; ` +
          'set "allow_cascade": true to permit it',
      );
    }
  }

  if (def.auth.role === 'anon') {
    const masked = maskedColumns(table);
    for (const column of def.select) {
      if (masked.has(column)) {
        push(
          'ENDPOINT_PII_ON_ANON',
          `"${column}" is marked personal data; an endpoint anyone can call may not select it`,
          column,
        );
      }
    }
  } else if (def.auth.role === 'authenticated' && !everyReaderProvesMailbox(def)) {
    /*
     * A signed-in read shows personal data only to a person who proved the
     * mailbox the rows are theirs by. Anywhere else the column is masked on
     * every read — answered as a failure — so it is refused here, where the
     * endpoint is written, rather than found by the first guest.
     */
    const masked = maskedColumns(table);
    // What a person typed to be found (their own address, as they gave it) is theirs to read back.
    const typed = def.identity?.strategy === 'lookup' ? def.identity.match : [];
    for (const column of def.select) {
      if (masked.has(column) && !typed.includes(column)) {
        push(
          'ENDPOINT_PII_NOT_PROVED',
          `"${column}" is marked personal data; it is shown only to a person who proved their mailbox (a verified level, or a sign-in by an emailed link), which this endpoint does not ask`,
          column,
        );
      }
    }
  }

  treeAndPersonIssues(def, table, view as SnapshotView, ctx, push);
  ownAddressAndWithholdIssues(def, table, view as SnapshotView, push);

  /* ── what the derived scope would refuse, reported now ──────────────── */
  issues.push(...scopeIssuesOf(ref, def, table, visible));
  return issues;
}

/** The real table a single-column foreign key of `table` points at, or null. */
function pointsAt(view: SnapshotView, table: ResolvedTable, column: string): ResolvedTable | null {
  const relation = view.model.relations.find(
    (r) => r.through === null && r.from.tableId === table.id && r.from.columns.length === 1 && r.from.columns[0] === column,
  );
  return relation === undefined ? null : sourceTable(view, relation.to.tableId);
}

/** Every column Adminium decides on a table, the full set: its rules, formulas, numbers and nightly prices. */
function decidedOfChild(table: ResolvedTable): Set<string> {
  const out = decidedColumnsOf(table);
  for (const column of table.table.columns) if (column.formula !== undefined || column.format !== undefined) out.add(column.name);
  const state = table.table.states?.column;
  if (state !== undefined) out.add(state);
  return out;
}

/**
 * The columns of `table` whose value comes, directly or through a formula,
 * from the row `link` points at: a copy or a nightly price read through it, a
 * stamp copying one, a formula over one.
 */
function readThroughLink(table: ResolvedTable, link: string): Set<string> {
  const out = new Set<string>();
  for (const column of table.table.columns) {
    if (column.copy?.via === link || column.perNight?.rate.via === link) out.add(column.name);
  }
  for (let changed = true; changed; ) {
    changed = false;
    for (const column of table.table.columns) {
      if (out.has(column.name)) continue;
      const set = column.stamp?.set as { copy?: unknown } | string | undefined;
      const reads = [
        ...(column.formula === undefined ? [] : formulaColumns(column.formula)),
        ...(typeof set === 'object' && set !== null && typeof set.copy === 'string' ? [set.copy] : []),
      ];
      if (reads.some((name) => out.has(name))) {
        out.add(column.name);
        changed = true;
      }
    }
  }
  return out;
}

/**
 * The checks a create with its child rows, a found person, a row's own link,
 * a read for a session alone and "delete my details" need against the live
 * schema — reported with the rest, never thrown.
 */
function treeAndPersonIssues(
  def: PublicEndpointDefinition,
  table: ResolvedTable,
  view: SnapshotView,
  ctx: EndpointCompileContext,
  push: (code: string, message: string, column?: string) => void,
): void {
  const methods = new Set(def.methods);
  const creates = methods.has('POST');

  // Child rows, the dry run, the price check and the retry key belong to a single create (a dry run and a check to a change too).
  if (def.children !== undefined) {
    if (!creates) push('ENDPOINT_CHILDREN_NO_CREATE', 'child rows come with a create, and this endpoint creates nothing');
    if (methods.has('BATCH')) push('ENDPOINT_CHILDREN_NO_CREATE', 'a create with its child rows is one write: it is never batched');
    if (def.identity !== undefined || def.visible_with !== undefined) push('ENDPOINT_CHILDREN_NO_CREATE', 'an identity or a child endpoint makes no child rows of its own');
    const anonymous = def.auth.role === 'anon' || def.claim?.optional === true || def.find_or_create !== undefined;
    if (anonymous && def.human_check !== true) push('ENDPOINT_CHILDREN_NEED_PROOF', 'a create anyone may make with its child rows asks the human check, once for the whole write');
  }
  if (def.dry_run === true && !creates && !methods.has('PATCH')) push('ENDPOINT_CHILDREN_NO_CREATE', 'a dry run tries a create or a change, and this endpoint makes neither');
  if (def.client_key !== undefined && !creates) push('ENDPOINT_CHILDREN_NO_CREATE', 'a retry key belongs to a create');
  // A batch, and a row visible with a parent, are created one by one, alone: what belongs to a single create would never run there.
  const batches = methods.has('BATCH');
  const alone = def.visible_with !== undefined;
  const changes = methods.has('PATCH');
  if (def.client_key !== undefined && (batches || alone)) push('ENDPOINT_CHILDREN_NO_CREATE', 'a retry key belongs to a single create: a batch, or a row visible with a parent, never looks one up');
  if (def.expect !== undefined && (batches || (alone && !changes))) push('ENDPOINT_CHILDREN_NO_CREATE', 'a price check belongs to a single create or a change: a batch, or a row visible with a parent created alone, never checks one');
  if (def.dry_run === true && alone && !changes) push('ENDPOINT_CHILDREN_NO_CREATE', 'a row visible with a parent is created alone, and is never tried first: a dry run here belongs to a change');
  if (def.agrees !== undefined && batches) push('ENDPOINT_CHILDREN_NO_CREATE', 'a batch never judges an agreement: an endpoint that agrees takes its rows one write at a time');

  if (def.expect !== undefined) {
    const column = table.table.columns.find((c) => c.name === def.expect);
    const decided = decidedOfChild(table);
    if (column === undefined || !decided.has(column.name) || !['decimal', 'integer', 'bigint', 'float'].includes(column.logicalType) || !def.select.includes(column.name)) {
      push('ENDPOINT_EXPECT_COLUMN', `"${def.expect}" is checked against the figure Adminium works out: a number column it decides, which the endpoint selects`, def.expect);
    }
  }
  if (def.client_key !== undefined) {
    const key = def.client_key;
    const column = table.columns.get(key);
    const writable = def.writable ?? [];
    const read = readsOf(def).some((r) => r.column === key);
    if (column === undefined || !['text', 'varchar'].includes(column.logicalType) || !writable.includes(key) || read) {
      push('ENDPOINT_CLIENT_KEY', `"${key}" is a retry key: a text column the caller writes and nothing shows, filters or orders by`, key);
    }
  }

  // Each child: a table here, once in the tree, linked to its parent, writing only what a guest may.
  const seen = new Set<string>([table.id]);
  const walk = (children: Readonly<Record<string, EndpointChild>>, parent: ResolvedTable, level: number): void => {
    for (const [name, child] of Object.entries(children)) {
      const own = sourceTable(view, child.source);
      if (own === null) {
        push('ENDPOINT_CHILD_UNKNOWN', `${child.source} (${name}) is not a table of this connection`);
        continue;
      }
      if (seen.has(own.id)) push('ENDPOINT_CHILD_TWICE', `${child.source} (${name}) is in this write twice`);
      seen.add(own.id);
      if (pointsAt(view, own, child.via)?.id !== parent.id) push('ENDPOINT_CHILD_VIA_NOT_PARENT', `"${child.via}" of ${child.source} does not point at ${parent.table.name}`, child.via);
      if (child.min !== undefined && child.min > child.max) push('ENDPOINT_CHILD_ROWS', `${name} asks for no more rows than it allows`);
      if (level > 2) push('ENDPOINT_CHILD_DEPTH', 'child rows go two levels below the create at most');
      const named = [child.via, ...child.writable, ...(child.select ?? []), ...(child.requires ?? []), ...plainColumns(child.plain_text), ...Object.keys(child.writable_values ?? {}), ...(child.position === undefined ? [] : [child.position])];
      const visible = visibleColumns(own);
      for (const column of named) if (!visible.has(column)) push('ENDPOINT_CHILD_SELECT_UNKNOWN', `"${column}" is not a column of ${child.source} (${name})`, column);
      const codes = ctx.shareCodes?.get(child.source) ?? new Set<string>();
      for (const column of child.select ?? []) {
        if (codes.has(column)) push('ENDPOINT_SHARE_CODE_READ', `"${column}" is the code a shared link opens its row with, so no endpoint shows it (${name})`, column);
      }
      const decided = new Set([...decidedOfChild(own), child.via, ...(child.position === undefined ? [] : [child.position])]);
      for (const column of own.primaryKey) decided.add(column);
      for (const column of child.writable) {
        if (decided.has(column)) push('ENDPOINT_CHILD_WRITABLE_DECIDED', `"${column}" of ${child.source} is decided by Adminium and cannot be writable`, column);
      }
      for (const [a, agree] of (child.agrees ?? []).entries()) agreePathIssues(view, own, parent, agree, `${name}.agrees.${String(a)}`, push);
      for (const counts of child.counts ?? []) {
        let group: ResolvedTable | null = own;
        for (const step of counts.by) group = group === null ? null : pointsAt(view, group, step);
        const whole = (column: string) => ['integer', 'bigint'].includes(group?.columns.get(column)?.logicalType ?? '');
        if (group === null || !whole(counts.min) || !whole(counts.max) || (counts.every !== undefined && pointsAt(view, group, counts.every.column) === null)) {
          push('ENDPOINT_CHILD_COUNTS', `${name} counts its rows by foreign keys to a group with whole-number min and max columns`);
        }
      }
      if (child.children !== undefined) walk(child.children, own, level + 1);
    }
  };
  if (def.children !== undefined) walk(def.children, table, 1);
  for (const [a, agree] of (def.agrees ?? []).entries()) agreePathIssues(view, table, null, agree, `agrees.${String(a)}`, push);

  // A person found by address: on a single create, linked through a column no one reads or writes.
  if (def.find_or_create !== undefined) {
    const f = def.find_or_create;
    const onChange = def.identity?.own === true && methods.has('PATCH') && !creates;
    const onlyCreate = def.methods.length === 1 && creates;
    if (!onlyCreate && !onChange) push('ENDPOINT_FIND_OR_CREATE_SHAPE', 'a person is found by address on a create alone (or a change through the row\'s own link)');
    if (methods.has('BATCH')) push('ENDPOINT_FIND_OR_CREATE_SHAPE', 'a person found by address is never batched');
    if (f.on !== undefined && (!onChange || !table.columns.has(f.on.column) || !(def.writable ?? []).includes(f.on.column))) {
      push('ENDPOINT_FIND_OR_CREATE_SHAPE', `a person is found on a move to "${f.on.to}" only by a change through the row's own link that writes "${f.on.column}"`, f.on.column);
    }
    if (!onChange && (def.claim?.column !== f.link || def.claim.optional !== true)) {
      push('ENDPOINT_FIND_OR_CREATE_SHAPE', `a signed-in create links its person as before: claim { column: "${f.link}", optional: true }`, f.link);
    }
    if (def.select.includes(f.link) || (def.writable ?? []).includes(f.link)) {
      push('ENDPOINT_FIND_OR_CREATE_SHAPE', `"${f.link}" would tell whether the address was on file, so it is neither shown nor written`, f.link);
    }
    for (const column of [f.email, f.link]) {
      if (!table.columns.has(column)) push('ENDPOINT_COLUMN_UNKNOWN', `"${column}" (find_or_create) is not a column of ${def.source}`, column);
    }
    for (const column of readThroughLink(table, f.link)) {
      push('SCOPE_FIND_OR_CREATE_READS_PERSON', `"${column}" reads the person "${f.link}" points at, whom a stranger may have typed the address of`, column);
    }
  }
  if (def.share_link !== undefined) {
    const column = table.table.columns.find((c) => c.name === def.share_link!.column);
    if (!creates || methods.has('BATCH') || column?.code === undefined || column.code.length < 16 || def.select.includes(def.share_link.column)) {
      push('ENDPOINT_SHARE_LINK_NOT_A_CODE', `"${def.share_link.column}" is answered once as the row's own link: a 16-character code Adminium makes, never selected, on a single create`, def.share_link.column);
    }
  }
  // A change's limits count each change as it is made: a single change, never a batch of them, and never a create.
  if (def.limits !== undefined && (methods.has('BATCH') || !(methods.has('PATCH') || methods.has('PUT')))) {
    push('ENDPOINT_LIMITS_SHAPE', 'limits count the changes a guest makes one at a time: a PATCH, never a batch');
  }
  if (def.session_only === true) {
    if (def.methods.some((m) => m !== 'GET') || def.claim !== undefined || def.identity !== undefined || def.visible_with !== undefined || def.auth.role !== 'authenticated') {
      push('ENDPOINT_SESSION_ONLY_READS', 'a read for a session\'s holder alone is an authenticated GET with no claim of its own');
    }
  }
  if (def.forget !== undefined) {
    if (def.identity === undefined) push('SCOPE_FORGET_COLUMN', 'what a person forgets is declared on the identity they sign in with');
    for (const flag of def.forget.flags ?? []) {
      if (!def.forget.columns.includes(flag)) push('SCOPE_FORGET_COLUMN', `"${flag}" is not one of the columns forgotten`, flag);
    }
    for (const name of def.forget.columns) {
      const column = table.table.columns.find((c) => c.name === name);
      // A yes/no kept as a number (a bool on SQLite) is emptied to no, as a boolean is.
      const flag = def.forget.flags?.includes(name) === true && column !== undefined && ['boolean', 'integer', 'smallint', 'bigint'].includes(column.logicalType);
      const emptied = column !== undefined && (column.nullable || column.logicalType === 'boolean' || flag);
      if (!emptied || table.primaryKey.includes(name) || name === def.identity?.column) push('SCOPE_FORGET_COLUMN', `"${name}" cannot be emptied when a person is forgotten`, name);
    }
    const stamp = def.forget.stamp;
    if (stamp !== undefined && !['timestamp', 'timestamptz'].includes(table.columns.get(stamp)?.logicalType ?? '')) {
      push('SCOPE_FORGET_COLUMN', `"${stamp}" is not a time to stamp when a person is forgotten`, stamp);
    }
    for (const link of def.forget.links ?? []) {
      let other: ResolvedTable | null = null;
      try {
        other = view.table(link.table);
      } catch {
        other = null;
      }
      const code = other?.table.columns.find((c) => c.name === link.column)?.code;
      if (other === null || code === undefined || link.people.some((column) => !other!.columns.has(column))) {
        push('SCOPE_FORGET_COLUMN', `"${link.table}.${link.column}" is no own link of the person's rows to stop`, link.column);
      }
    }
  }
  if (def.new_link !== undefined) {
    const code = table.table.columns.find((c) => c.name === def.new_link!.column)?.code;
    // Through a row's own link: another link of the row, never the code the asking session opened it by, and only while `when` holds.
    // (That another key opens the row by it is the manifest's check: an install saves its endpoints one by one.)
    const ownLink = def.identity?.strategy === 'token' && def.identity.own === true;
    const asker = ownLink ? !def.identity!.match.includes(def.new_link.column) && def.new_link.when !== undefined : def.claim !== undefined && def.claim.optional !== true && def.new_link.stopped === undefined;
    if (code === undefined || code.length < 16 || def.select.includes(def.new_link.column) || !asker || !def.methods.includes('GET')) {
      push('ENDPOINT_NEW_LINK_SHAPE', `a new link renews a row's own link code (16 characters or more, never shown) on a signed-in person's rows, or, while its when holds, another row's own link through its own link`, def.new_link.column);
    }
    for (const condition of def.new_link.when?.where ?? []) {
      if (!table.columns.has(condition.column)) push('ENDPOINT_COLUMN_UNKNOWN', `"${condition.column}" (new_link.when) is not a column of ${def.source}`, condition.column);
      // Only a column the endpoint shows: a refusal tells nothing about one it does not.
      else if (!def.select.includes(condition.column)) push('ENDPOINT_NEW_LINK_SHAPE', `"${condition.column}" (new_link.when) is not a column this endpoint shows`, condition.column);
    }
    if (def.new_link.stopped !== undefined && !table.columns.has(def.new_link.stopped)) {
      push('ENDPOINT_COLUMN_UNKNOWN', `"${def.new_link.stopped}" (new_link.stopped) is not a column of ${def.source}`, def.new_link.stopped);
    }
  }
}

/**
 * Where a row's own link may be emailed, and the columns withheld from rows
 * read through a parent — against the live schema, reported with the rest.
 */
function ownAddressAndWithholdIssues(
  def: PublicEndpointDefinition,
  table: ResolvedTable,
  view: SnapshotView,
  push: (code: string, message: string, column?: string) => void,
): void {
  const address = def.identity?.address;
  if (address !== undefined) {
    if (def.identity?.strategy !== 'token' || def.identity.own !== true) {
      push('ENDPOINT_OWN_ADDRESS_SHAPE', "a link is emailed to its row's own address only when it is the row's own link");
    }
    if (new Set(address).size !== address.length) push('ENDPOINT_OWN_ADDRESS_SHAPE', 'an address column is named once');
    for (const name of address) {
      const type = table.columns.get(name)?.logicalType;
      if (type === undefined) push('ENDPOINT_COLUMN_UNKNOWN', `"${name}" (identity.address) is not a column of ${def.source}`, name);
      else if ((type !== 'text' && type !== 'varchar') || def.identity?.match.includes(name) === true) {
        push('ENDPOINT_OWN_ADDRESS_SHAPE', `"${name}" is not a text column holding an address`, name);
      }
    }
  }
  const withhold = def.withhold;
  if (withhold === undefined) return;
  // A row reached through a parent, or claimed through a column naming someone other than its holder.
  const throughParent = def.visible_with !== undefined || (def.claim?.column !== undefined && def.claim.column !== withhold.unless_holder);
  // A row's own link (a ticket sent to a friend) may hold back columns while a condition holds: it names nobody, so no holder.
  const ownLink = def.identity?.strategy === 'token' && withhold.when !== undefined && withhold.unless_holder === undefined;
  if (def.auth.role !== 'authenticated' || (def.identity !== undefined && !ownLink) || (!throughParent && !ownLink)) {
    push('ENDPOINT_WITHHOLD_SHAPE', 'columns are withheld from a signed-in person\'s rows read through a parent (or while a condition holds, on a row\'s own link), never on another identity or a staff endpoint');
  }
  const writable = def.methods.some((m) => WRITING_METHODS.has(m)) ? (def.writable ?? definitionToResource(def.path.slice(1), def, def.methods, table).writable) : [];
  for (const condition of withhold.when?.where ?? []) {
    if (!table.columns.has(condition.column)) push('ENDPOINT_COLUMN_UNKNOWN', `"${condition.column}" (withhold.when) is not a column of ${def.source}`, condition.column);
    else if (writable.includes(condition.column)) push('ENDPOINT_WITHHOLD_SHAPE', `"${condition.column}" decides who reads the withheld columns, so it is not writable`, condition.column);
  }
  for (const link of withhold.when?.linked ?? []) {
    if (!table.columns.has(link.via) || pointsAt(view, table, link.via) === null) push('ENDPOINT_WITHHOLD_SHAPE', `"${link.via}" (withhold.when.linked) is not a foreign key of ${def.source}`, link.via);
    else if (writable.includes(link.via)) push('ENDPOINT_WITHHOLD_SHAPE', `"${link.via}" decides who reads the withheld columns, so it is not writable`, link.via);
  }
  if (withhold.unless_holder === undefined) {
    if (new Set(withhold.columns).size !== withhold.columns.length) push('ENDPOINT_WITHHOLD_SHAPE', 'a column is withheld once');
    for (const name of withhold.columns) {
      if (!def.select.includes(name)) push('ENDPOINT_WITHHOLD_SHAPE', `"${name}" is withheld, so it is one of the columns selected`, name);
    }
    return;
  }
  if (new Set(withhold.columns).size !== withhold.columns.length) push('ENDPOINT_WITHHOLD_SHAPE', 'a column is withheld once');
  for (const name of withhold.columns) {
    if (!def.select.includes(name)) push('ENDPOINT_WITHHOLD_SHAPE', `"${name}" is withheld, so it is one of the columns selected`, name);
  }
  if (!table.columns.has(withhold.unless_holder)) {
    push('ENDPOINT_COLUMN_UNKNOWN', `"${withhold.unless_holder}" (withhold) is not a column of ${def.source}`, withhold.unless_holder);
  } else if (pointsAt(view, table, withhold.unless_holder) === null) {
    push('ENDPOINT_WITHHOLD_SHAPE', `"${withhold.unless_holder}" is not a foreign key to the holder`, withhold.unless_holder);
  } else if (def.methods.some((m) => WRITING_METHODS.has(m)) && (def.writable ?? definitionToResource(def.path.slice(1), def, def.methods, table).writable).includes(withhold.unless_holder)) {
    push('ENDPOINT_WITHHOLD_SHAPE', `"${withhold.unless_holder}" decides who reads the withheld columns, so it is not writable`, withhold.unless_holder);
  }
}

/** An agreement's path: foreign keys from `column` to the compared column; the parent's, or a linked row's, to compare with. */
function agreePathIssues(
  view: SnapshotView,
  table: ResolvedTable,
  parent: ResolvedTable | null,
  agree: z.infer<typeof endpointAgreeSchema>,
  at: string,
  push: (code: string, message: string, column?: string) => void,
): void {
  const follow = (from: ResolvedTable, column: string, path: readonly string[] | undefined): boolean => {
    if (!from.columns.has(column)) return false;
    let here: ResolvedTable | null = from;
    let current = column;
    for (const step of path ?? []) {
      here = here === null ? null : pointsAt(view, here, current);
      if (here === null || !here.columns.has(step)) return false;
      current = step;
    }
    return true;
  };
  const tests = [agree.eq, agree.lte, agree.gte].filter((t) => t !== undefined);
  let ok = follow(table, agree.column, agree.path) && tests.length === 1 && (agree.when === undefined || follow(table, agree.column, agree.when.path));
  const target = tests[0];
  if (target !== undefined && 'parent' in target) ok &&= parent !== null && follow(parent, target.parent, target.path);
  if (target !== undefined && 'via' in target) {
    const linked = pointsAt(view, table, target.via);
    ok &&= linked !== null && linked.columns.has(target.column);
  }
  if (!ok) push('ENDPOINT_CHILD_AGREES_PATH', `${at}: an agreement follows foreign keys to the column it compares, with one of eq, lte or gte`);
}

/**
 * The definition as a one-resource scope document, compiled. Claim wiring
 * that needs ANOTHER endpoint (`claim.via.ref`, a parent it is visible with,
 * a claim column with no identity endpoint in the same key) is a property of
 * a key, not of this endpoint, and is checked when a key's document is
 * derived.
 */
const KEY_LEVEL_CODES = new Set(['SCOPE_CLAIM_VIA_UNKNOWN_REF', 'SCOPE_VISIBLE_WITH_UNKNOWN_REF', 'SCOPE_TIMEZONE_INVALID']);

function scopeIssuesOf(
  ref: string,
  def: PublicEndpointDefinition,
  table: ResolvedTable,
  visible: ReadonlySet<string>,
): ScopeIssue[] {
  const resource = definitionToResource(ref, def, def.methods, table);
  /*
   * A page size out of range is `ENDPOINT_LIMIT_ORDER`, already reported. Left
   * as is, it would fail the document's SHAPE and hide every rule below it,
   * so the check document carries it clamped.
   */
  resource.limit = Math.min(resource.limit, MAX_LIMIT_CEILING);
  if (resource.defaultLimit !== undefined) resource.defaultLimit = Math.min(resource.defaultLimit, resource.limit);
  const document: PublicScopeDocument = {
    version: 1,
    side: def.auth.role === 'service_role' ? 'staff' : 'customer',
    timezone: 'UTC',
    resources: [resource],
  };
  if (def.identity !== undefined) {
    document.claim = {
      strategy: def.identity.strategy,
      ref,
      match: [...def.identity.match],
      ...(def.identity.verify === undefined ? {} : { verify: def.identity.verify }),
      ...(def.identity.email === undefined ? {} : { email: def.identity.email }),
      ...(def.identity.expires === undefined ? {} : { expires: def.identity.expires }),
      ...(def.identity.stopped === undefined ? {} : { stopped: def.identity.stopped }),
      ...(def.identity.own === undefined ? {} : { own: def.identity.own }),
      ...(def.identity.address === undefined ? {} : { address: [...def.identity.address] }),
      ...(def.human_check === undefined ? {} : { humanCheck: true as const }),
    };
  }
  /*
   * A shared link's code is a secret by nature — never shown, never listed —
   * and still the one column its claim compares: the claim alone may name it.
   */
  const claimable = new Set(visible);
  if (def.identity?.strategy === 'token') {
    for (const column of [...def.identity.match, def.identity.expires, def.identity.stopped]) {
      if (column !== undefined && table.columns.has(column)) claimable.add(column);
    }
  }
  const lookup = (t: string) => {
    if (t !== def.source) return null;
    return claimable;
  };
  try {
    // Secret columns are left out of the lookup, so naming one in any list
    // is refused as an unknown column — the same answer `/data` gives.
    compileScope(document, lookup);
    return [];
  } catch (error) {
    if (!(error instanceof ScopeCompileError)) throw error;
    return error.issues.filter((i) => !KEY_LEVEL_CODES.has(i.code));
  }
}

/** `endpointIssues`, thrown. Returns the parsed definition on success. */
export function compileEndpoint(input: unknown, ctx: EndpointCompileContext): PublicEndpointDefinition {
  const issues = endpointIssues(input, ctx);
  if (issues.length > 0) throw new EndpointCompileError(issues);
  const parsed = parseDefinition(input);
  if (!parsed.ok) throw new EndpointCompileError(parsed.issues);
  return parsed.definition;
}

/* ------------------------------------------------------ generated defaults */

/** The ref a table's generated endpoint takes, or null when it has none. */
export function slugFor(table: { schema: string; name: string }, defaultSchema: string): string | null {
  const slug = (s: string): string =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
  const name = slug(table.name);
  if (name.length === 0) return null;
  let ref = name;
  if (table.schema !== defaultSchema) {
    const schema = slug(table.schema);
    if (schema.length === 0) return null;
    ref = `${schema}_${name}`;
  }
  return ENDPOINT_REF_PATTERN.test(ref) && ref.length <= REF_MAX ? ref : null;
}

/** The generated default's ceiling, stated once. */
export const GENERATED_DEFAULTS = {
  defaultLimit: 20,
  maxLimit: 200,
  /** Today's `public-read` ceiling. */
  requestsPerMinute: 120,
} as const;

/**
 * The generated definition for one table — every included table gets full
 * CRUD by default, the owner's ruling.
 *
 * "Every method the source supports", read strictly:
 * - a view answers GET;
 * - a table with no primary key answers GET, POST and BATCH — nothing can
 *   address one of its rows;
 * - POST and BATCH need a primary key the CALLER does not choose: a
 *   database default, or a uuid the server mints. A natural key with neither
 *   (`customers.customer_id bpchar(5)`) could never be inserted, so those two
 *   are left off rather than offered and always refused;
 * - a write needs a writable column, so a table that is all key answers GET
 *   and DELETE;
 * - DELETE is left off a table another table references with a cascading
 *   ON DELETE, kept by the owner.
 *
 * `select` is every column that is neither secret nor masked as personal data,
 * nor a code Adminium makes (a shared link's, a booking reference): a code is
 * shown to the public only where the owner names it.
 * Returns null when nothing would be selectable.
 */
export function defaultDefinitionFor(
  view: SnapshotView,
  table: ResolvedTable,
  ref: string,
): PublicEndpointDefinition | null {
  const masked = maskedColumns(table);
  const coded = new Set(table.table.columns.filter((c) => c.code !== undefined).map((c) => c.name));
  const select = [...table.columns.values()]
    .filter((c) => !c.secret && !masked.has(c.name) && !coded.has(c.name))
    .map((c) => c.name);
  if (select.length === 0) return null;

  const firstKey = table.primaryKey.find((c) => select.includes(c));
  const order = `${firstKey ?? select[0]}.desc`;

  const defaults: Record<string, unknown> = {};
  let insertable = table.primaryKey.length === 0;
  if (table.primaryKey.length > 0) {
    insertable = table.primaryKey.every((name) => {
      const column = table.table.columns.find((c) => c.name === name);
      if (column === undefined) return false;
      if (column.default !== null || column.isGenerated) return true;
      if (column.logicalType === 'uuid' && table.primaryKey.length === 1) {
        defaults[name] = { $generate: 'uuid' };
        return true;
      }
      return false;
    });
  }

  const base: PublicEndpointDefinition = {
    path: `/${ref}`,
    source: table.id,
    methods: ['GET'],
    select,
    filters: [],
    pagination: {
      default_limit: GENERATED_DEFAULTS.defaultLimit,
      max_limit: GENERATED_DEFAULTS.maxLimit,
      order,
    },
    auth: { role: 'anon' },
    rate_limit: { requests: GENERATED_DEFAULTS.requestsPerMinute, window: '1m' },
    response: { shape: 'object', envelope: 'data' },
  };
  if (insertable && Object.keys(defaults).length > 0) base.defaults = defaults;
  if (table.table.kind !== 'table') return base;

  const writes = defaultWritable(base, table).length > 0;
  const hasKey = table.primaryKey.length > 0;
  const methods: PublicMethod[] = ['GET'];
  if (writes && insertable) methods.push('POST');
  if (writes && hasKey) methods.push('PATCH', 'PUT');
  if (hasKey && cascadingReferrers(view, table).length === 0) methods.push('DELETE');
  if (writes && insertable) methods.push('BATCH');
  return { ...base, methods: canonicalMethods(methods) };
}

/* ------------------------------------------------------ effective endpoints */

/** A stored endpoint row, as much of it as this file reads. */
export interface StoredEndpoint {
  id: string;
  ref: string;
  /** `generated` | `custom`. */
  origin: string;
  /** The stored text. */
  definition: string;
}

export interface EffectiveEndpoint {
  /** Null for a virtual default nobody has stored yet. */
  id: string | null;
  ref: string;
  origin: 'generated' | 'custom';
  stored: boolean;
  /** Null only for a stored row whose text no longer parses. */
  definition: PublicEndpointDefinition | null;
  /** The stored text, or the canonical print of a virtual default. */
  text: string;
  /** Every issue, compiled against the current schema. Empty for a virtual default. */
  issues: ScopeIssue[];
}

/** Why a table has no generated endpoint, so the builder can say so. */
export interface UnaddressableTable {
  tableId: string;
  reason: 'no-slug' | 'slug-collision' | 'ref-taken' | 'nothing-selectable';
  /** The ref it would have had, when it has one. */
  ref: string | null;
  /** The other tables sharing that slug. */
  collidesWith: string[];
}

/**
 * Stored rows ∪ one generated default for every addressable table that has
 * no stored row under its ref.
 *
 * A default exists only when its slug is unique in the connection, fits the
 * grammar and the length. Two tables with one slug get NO default
 * between them: an ordinal suffix would make which table owns a ref depend on
 * the order of introspection. A stored row — including a switched-off
 * tombstone — always owns its ref.
 *
 * Tables come from the `SnapshotView`, never the raw snapshot, which is what
 * keeps system (`adminium_*`, migration ledgers) and excluded tables out.
 */
export function effectiveEndpoints(
  view: SnapshotView | null,
  stored: readonly StoredEndpoint[],
): { endpoints: EffectiveEndpoint[]; unaddressable: UnaddressableTable[] } {
  const endpoints: EffectiveEndpoint[] = [];
  const taken = new Set<string>();
  for (const row of stored) {
    taken.add(row.ref);
    const parsed = parseDefinition(row.definition);
    endpoints.push({
      id: row.id,
      ref: row.ref,
      origin: row.origin === 'generated' ? 'generated' : 'custom',
      stored: true,
      definition: parsed.ok ? parsed.definition : null,
      text: row.definition,
      issues: parsed.ok ? endpointIssues(parsed.definition, { ref: row.ref, view }) : parsed.issues,
    });
  }

  const unaddressable: UnaddressableTable[] = [];
  if (view !== null) {
    const tables = addressableTables(view);
    const bySlug = new Map<string, ResolvedTable[]>();
    for (const table of tables) {
      const ref = slugFor(table, view.model.defaultSchema);
      if (ref === null) {
        unaddressable.push({ tableId: table.id, reason: 'no-slug', ref: null, collidesWith: [] });
        continue;
      }
      bySlug.set(ref, [...(bySlug.get(ref) ?? []), table]);
    }
    for (const [ref, group] of bySlug) {
      if (group.length > 1) {
        for (const table of group) {
          unaddressable.push({
            tableId: table.id,
            reason: 'slug-collision',
            ref,
            collidesWith: group.filter((t) => t !== table).map((t) => t.id),
          });
        }
        continue;
      }
      const table = group[0] as ResolvedTable;
      if (taken.has(ref)) {
        // The owner of a stored ref may be this very table (the default was
        // granted or edited, then stored) — that is not a table without an
        // endpoint, so only a FOREIGN owner is reported.
        const owner = stored.find((s) => s.ref === ref);
        const ownerSource = owner === undefined ? null : parseDefinition(owner.definition);
        if (!(ownerSource?.ok === true && sourceTable(view, ownerSource.definition.source)?.id === table.id)) {
          unaddressable.push({ tableId: table.id, reason: 'ref-taken', ref, collidesWith: [] });
        }
        continue;
      }
      const definition = defaultDefinitionFor(view, table, ref);
      if (definition === null) {
        unaddressable.push({ tableId: table.id, reason: 'nothing-selectable', ref, collidesWith: [] });
        continue;
      }
      endpoints.push({
        id: null,
        ref,
        origin: 'generated',
        stored: false,
        definition,
        text: printDefinition(definition),
        issues: [],
      });
    }
  }

  endpoints.sort((a, b) => (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0));
  unaddressable.sort((a, b) => (a.tableId < b.tableId ? -1 : a.tableId > b.tableId ? 1 : 0));
  return { endpoints, unaddressable };
}

/** Every table `/data` can address, once each (the view indexes some twice). */
function addressableTables(view: SnapshotView): ResolvedTable[] {
  const out: ResolvedTable[] = [];
  for (const table of view.model.tables) {
    if (table.system || table.excluded === true) continue;
    const resolved = sourceTable(view, table.id);
    if (resolved !== null) out.push(resolved);
  }
  return out;
}
