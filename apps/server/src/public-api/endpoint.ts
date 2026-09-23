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

import { z } from 'zod';

import type { EffectiveColumn } from '../connections/effective-schema.js';
import { columnPolicyFor } from '../connections/effective-schema.js';
import { FILTER_OPS } from '../crud/filters.js';
import type { ResolvedTable, SnapshotView } from '../crud/identifiers.js';
import { readGenerator } from './generate.js';
import {
  CLAIM_STRATEGIES,
  compileScope,
  type PublicAction,
  type PublicResponseShape,
  type PublicScopeDocument,
  type PublicScopeResource,
  ScopeCompileError,
  type ScopeIssue,
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

const filterSchema = z
  .object({ column: columnSchema, op: z.enum(FILTER_OPS), value: z.unknown().optional() })
  .strict();

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
  })
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
    filters: def.filters.map((f) =>
      f.value === undefined ? { column: f.column, op: f.op } : { column: f.column, op: f.op, value: f.value },
    ),
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
    out['claim'] = claim;
  }
  if (def.identity !== undefined) {
    out['identity'] = {
      strategy: def.identity.strategy,
      match: [...def.identity.match],
      column: def.identity.column,
    };
  }
  if (def.sensitive !== undefined) out['sensitive'] = def.sensitive;
  if (def.allow_cascade !== undefined) out['allow_cascade'] = def.allow_cascade;
  if (def.kind !== undefined) out['kind'] = def.kind;
  if (def.confirm !== undefined) out['confirm'] = { ...def.confirm };
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

/** A copied value, a running number, a code or a total: the write path fills it, never a caller. */
function decidedByAdminium(column: EffectiveColumn): boolean {
  return column.copy !== undefined || column.sequence !== undefined || column.code !== undefined || column.rollup !== undefined;
}

/**
 * Columns a PUBLIC caller may not even be offered: secret ones are invisible
 * everywhere (`SnapshotView.column`), so they are treated as absent.
 */
function visibleColumns(table: ResolvedTable): Set<string> {
  const out = new Set<string>();
  for (const column of table.columns.values()) if (!column.secret) out.add(column.name);
  return out;
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
    for (const column of table.table.columns) if (serverOwned(column) || decidedByAdminium(column)) out.delete(column.name);
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
          };
  const resource: PublicScopeResource = {
    ref,
    table: def.source,
    actions,
    expose: [...def.select],
    filterable: [...(def.filterable ?? [])],
    searchable: [...(def.searchable ?? [])],
    orderable: [...(def.orderable ?? [])],
    where: def.filters.map((f) =>
      f.value === undefined ? { column: f.column, op: f.op } : { column: f.column, op: f.op, value: f.value },
    ),
    writable: def.writable === undefined ? defaultWritable(def, table) : [...def.writable],
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
  if (def.kind === 'availability') resource.kind = 'availability';
  if (def.confirm !== undefined) resource.confirm = { ...def.confirm };
  return resource;
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

  if (def.auth.role === 'authenticated' && def.claim === undefined && def.identity === undefined) {
    push(
      'ENDPOINT_AUTHENTICATED_WITHOUT_CLAIM',
      'an authenticated endpoint needs a claim column, a claim via another endpoint, or an identity',
    );
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

  if (def.kind === 'availability') {
    // Free or full, per slot, and nothing else: a read of the booking limit.
    const capacity = table.table.capacity;
    if ([...methods].some((m) => m !== 'GET')) push('ENDPOINT_AVAILABILITY_READ_ONLY', 'availability answers GET only');
    if (capacity === undefined) {
      push('ENDPOINT_AVAILABILITY_NO_LIMIT', `${def.source} has no booking limit to answer availability from`);
    } else if (capacity.resource !== undefined) {
      push('ENDPOINT_AVAILABILITY_PER_RESOURCE', 'availability for a limit per table or room is not offered yet');
    }
  }

  const visible = visibleColumns(table);
  for (const column of def.select) {
    if (!visible.has(column)) {
      push('ENDPOINT_SELECT_UNKNOWN_COLUMN', `"${column}" is not a column of ${def.source}`, column);
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
  const decided = new Set(table.table.columns.filter(decidedByAdminium).map((c) => c.name));
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
  }

  /* ── what the derived scope would refuse, reported now ──────────────── */
  issues.push(...scopeIssuesOf(ref, def, table, visible));
  return issues;
}

/**
 * The definition as a one-resource scope document, compiled. Claim wiring
 * that needs ANOTHER endpoint (`claim.via.ref`, a claim column with no
 * identity endpoint in the same key) is a property of a key, not of this
 * endpoint, and is checked when a key's document is derived.
 */
const KEY_LEVEL_CODES = new Set(['SCOPE_CLAIM_VIA_UNKNOWN_REF', 'SCOPE_TIMEZONE_INVALID']);

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
    document.claim = { strategy: def.identity.strategy, ref, match: [...def.identity.match] };
  }
  try {
    // Secret columns are left out of the lookup, so naming one in any list
    // is refused as an unknown column — the same answer `/data` gives.
    compileScope(document, (t) => (t === def.source ? visible : null));
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
 * `select` is every column that is neither secret nor masked as personal data.
 * Returns null when nothing would be selectable.
 */
export function defaultDefinitionFor(
  view: SnapshotView,
  table: ResolvedTable,
  ref: string,
): PublicEndpointDefinition | null {
  const masked = maskedColumns(table);
  const select = [...table.columns.values()]
    .filter((c) => !c.secret && !masked.has(c.name))
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
