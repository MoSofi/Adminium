// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The scope document and its compiler.
 *
 * A scope is the whole of what a publishable key may reach. It is authored by
 * the OPERATOR — not by a manifest publisher — because it describes their
 * production database, and because the shipped customer pages are meant to be
 * replaceable by pages that need a column the publisher never listed.
 *
 * ── WHY THIS IS A COMPILER AND NOT A VALIDATOR ─────────────────────────────
 * Every refusal below is BOOT-FATAL and happens once, at write time and at
 * load time, never per request. A scope that compiles is one the request path
 * can trust without re-deriving anything, which is what keeps the hot path free
 * of authorization logic. A scope that does not compile takes the whole public
 * surface down loudly rather than serving a narrower version of itself quietly.
 *
 * ── THE ONE PROPERTY THIS FILE EXISTS TO HOLD ──────────────────────────────
 * A caller can ADD conditions and can never REMOVE one. `where` compiles to the
 * same `RecordFilter` grammar the dashboard uses and is ANDed first, server
 * side; `expose` is the complete column set, not a default. Everything else
 * here is in service of that sentence.
 */

import { z } from 'zod';

import { FILTER_OPS, type RecordFilter } from '../crud/filters.js';
import { PUBLIC_GENERATORS, readGenerator } from './generate.js';

/* --------------------------------------------------------------- vocabulary */

export const PUBLIC_SIDES = ['staff', 'customer'] as const;
export type PublicSide = (typeof PUBLIC_SIDES)[number];

/**
 * One action per public method: GET → `read` (a list AND one row by
 * key), POST → `create`, PATCH → `update`, PUT → `replace`, DELETE → `delete`,
 * BATCH → `batch`.
 *
 * v1 had no `delete`, and said the vocabulary was closed so that adding it
 * would be a spec change rather than a config change. Adding `delete`,
 * `replace` and `batch` was that spec change. The list is still closed: a verb
 * nobody wrote a route and a rule for does not arrive through a scope document.
 */
export const PUBLIC_ACTIONS = ['read', 'create', 'update', 'replace', 'delete', 'batch'] as const;
export type PublicAction = (typeof PUBLIC_ACTIONS)[number];

/** The actions that send column values, and so need something `writable`. */
const WRITING_ACTIONS: ReadonlySet<PublicAction> = new Set(['create', 'update', 'replace', 'batch']);

/**
 * How a list answers. `wrapped` is `{ data, page, cursor }`,
 * which is what every published client reads; `array` is the bare rows with
 * the cursor in a header; `single` is exactly one row. Only the LIST route
 * reads it — one row by key and every write always answer `{ data }`.
 */
export const PUBLIC_RESPONSE_SHAPES = ['wrapped', 'array', 'single'] as const;
export type PublicResponseShape = (typeof PUBLIC_RESPONSE_SHAPES)[number];

/**
 * Claim tiers. `lookup` is possession-of-a-reference and is permitted only on
 * tables the operator has NOT marked sensitive. `email-code` needs SMTP.
 * `external` is declared and unimplemented so the durable path is additive
 * rather than a rewrite.
 */
export const CLAIM_STRATEGIES = ['lookup', 'email-code', 'external'] as const;
export type ClaimStrategy = (typeof CLAIM_STRATEGIES)[number];

/**
 * `none` only, and `estimated` is gone too (sharpened 2026-08-20).
 *
 * `exact` was always banned — a full COUNT(*) is a free amplification
 * primitive. `estimated` looked like the safe middle and is not: `runList`
 * consults catalog statistics ONLY for an unfiltered list, because table-level
 * statistics cannot see a filter, and otherwise **falls through to the exact
 * COUNT(*)** (`crud/list.ts`). A mandatory predicate makes every public list
 * filtered by construction, so `estimated` would have reached the exact count
 * on every single public request.
 *
 * `runList` now also refuses the fall-through whenever a mandatory predicate is
 * present, so this vocabulary and that guard say the same thing in two places —
 * deliberately, because either one alone is a single point of failure for a
 * property that is measured in query cost against an anonymous caller.
 */
export const PUBLIC_COUNT_MODES = ['none'] as const;

const LIMIT_CEILING = 200;

/**
 * Logical ref: what the caller names. Never a physical table name.
 *
 * Widened to admit `_`, so a generated endpoint keeps a
 * snake_case table's own name (`order_details`). Every ref the old grammar
 * accepted still parses; the dot and the schema stay out.
 */
const refSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][A-Za-z0-9_]*$/, 'a ref starts with a lower-case letter and carries no schema or dots');

const columnSchema = z.string().min(1).max(128);

/**
 * A mandatory condition. Deliberately FLAT — no `and`/`or` nesting, even though
 * `RecordFilter` supports it. A scope predicate is an authorization boundary,
 * and a boundary a reader cannot evaluate by eye is one nobody audits. The
 * conditions are ANDed; that is the only combinator.
 */
const mandatoryConditionSchema = z.object({
  column: columnSchema,
  op: z.enum(FILTER_OPS),
  value: z.unknown().optional(),
});

/**
 * How a claimed session narrows this resource.
 *
 * `column` is matched against a value the CLAIM resolved (e.g. `patient_id`).
 * `via` is one hop and one hop only: `{ ref, localColumn, foreignColumn }`.
 * Two hops is a join planner with an authorization boundary inside it,
 * refuses it on purpose.
 */
const claimScopeSchema = z
  .object({
    column: columnSchema.optional(),
    via: z
      .object({ ref: refSchema, localColumn: columnSchema, foreignColumn: columnSchema })
      .strict()
      .optional(),
  })
  .strict();

const resourceSchema = z
  .object({
    ref: refSchema,
    /** Physical `schema.table`, resolved server-side. Never sent to the browser. */
    table: z.string().min(1).max(256),
    actions: z.array(z.enum(PUBLIC_ACTIONS)).min(1),
    /** The COMPLETE readable column set. Not a default — see the header. */
    expose: z.array(columnSchema).min(1),
    /** Columns `where=` may name. Defaults to EMPTY. */
    filterable: z.array(columnSchema).default([]),
    /** Columns `q=` may search. Absent ⇒ `q=` is refused. */
    searchable: z.array(columnSchema).default([]),
    orderable: z.array(columnSchema).default([]),
    /** ANDed server-side, always. */
    where: z.array(mandatoryConditionSchema).default([]),
    /** Writable columns for create/update. Empty ⇒ the action is declared but inert. */
    writable: z.array(columnSchema).default([]),
    /**
     * Server-injected on create; a caller may not supply these.
     *
     * A value is ordinarily a literal. Since it may instead be a SENTINEL — `{
     * "$generate": "uuid" }` or `{ "$generate": "now" }` — which the server
     * resolves per request, per dialect. That is what makes an anonymous
     * create possible without a writable primary key; see `generate.ts` for
     * the whole account, including the one thing it costs (a `json` column can
     * no longer default to an object with a `$generate` key).
     *
     * The shape is checked in `compileScope` rather than here, because zod
     * cannot see the resource's `writable` list from inside a record's value
     * schema and half of what makes a sentinel legal is what else the resource
     * says about the same column.
     */
    defaults: z.record(columnSchema, z.unknown()).default({}),
    claim: claimScopeSchema.optional(),
    /** Operator flag: this table carries data a `lookup` claim may not gate. */
    sensitive: z.boolean().default(false),
    limit: z.number().int().min(1).max(LIMIT_CEILING).default(50),
    /*
     * ── WHAT PLAN 54 ADDED, ALL OPTIONAL ──────────────────────────────────
     * A scope written before these existed parses unchanged and behaves as it
     * did: `limit` stays both the default page and the cap, the order is the
     * caller's or the database's, and a list is wrapped. `version` stays 1.
     */
    /** The page size when the caller names none. Absent ⇒ `limit`. */
    defaultLimit: z.number().int().min(1).max(LIMIT_CEILING).optional(),
    /** `column.asc` / `column.desc`, used when the caller names no order. */
    defaultOrder: z
      .string()
      .regex(/^[^.,\s]+\.(asc|desc)$/, 'an order is "column.asc" or "column.desc"')
      .max(160)
      .optional(),
    /** This resource's own ceiling, per the rules in `limiter.ts`. */
    rate: z
      .object({
        max: z.number().int().min(1),
        windowMs: z.union([z.literal(1_000), z.literal(60_000), z.literal(3_600_000)]),
      })
      .strict()
      .optional(),
    response: z.object({ shape: z.enum(PUBLIC_RESPONSE_SHAPES) }).strict().optional(),
    count: z.enum(PUBLIC_COUNT_MODES).default('none'),
    /** `availability`: free or full per slot, from the table's booking limit; never a row. */
    kind: z.enum(['records', 'availability']).optional(),
    /** The email sent when a guest creates a row (see the endpoint's `confirm`). */
    confirm: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const publicScopeDocumentSchema = z
  .object({
    version: z.literal(1),
    side: z.enum(PUBLIC_SIDES),
    /**
     * IANA zone. OPTIONAL since, and an OVERRIDE rather than the home: the
     * zone belongs to the connection, and a scope that omits it inherits from
     * there.
     *
     * Optional is not lax. `compileScope` still refuses when NEITHER source
     * yields a canonical zone, so this boot-fatal guarantee is unchanged — the
     * reason is in the pilot: a `timestamptz` rendered through the READER's
     * zone put a 15:00 booking at 16:00 with no error anywhere. There is no
     * defensible default; a wrong timezone is worse than a missing one because
     * it looks like data.
     *
     * It stays overridable because one connection can legitimately be read by
     * two scopes for businesses in different places — a franchise database, a
     * shared tenant — and that is the reason it is not made global.
     */
    timezone: z.string().min(1).max(64).optional(),
    /**
     * ISO-4217 currency, when this scope serves money.
     *
     * Same argument as `timezone`, and the audit measured the same absence: a
     * `money` column comes back as a bare decimal string — `"45.00"` — with
     * nothing saying whether that is pounds or dollars, so the page cannot
     * format it. Fifteen of fifteen apps hardcode a currency and one models it
     * per row; three of them already disagree with each other.
     *
     * OPTIONAL, unlike `timezone`: a scope that exposes no money needs none,
     * and requiring it would be ceremony. `timezone` is required because every
     * scope that returns a timestamp needs it and there is no safe default —
     * a wrong zone looks like data.
     *
     * The rest of what this document's closed key set listed did NOT need
     * building: `displayName` and the logo already have a home in
     * `adminium_settings` (`branding.appName`, `branding.logoFileId`) served
     * publicly at `/api/v1/branding`, and the address is app-owned —
     * Adminium serves only what it needs to serve correct data.
     */
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/, 'currency must be a three-letter ISO-4217 code, e.g. GBP')
      .optional(),
    claim: z
      .object({
        strategy: z.enum(CLAIM_STRATEGIES),
        /** The resource a claim is made against. */
        ref: refSchema,
        /** Columns the claimant must match, ALL of them, equality only. */
        match: z.array(columnSchema).min(1),
      })
      .strict()
      .optional(),
    /**
     * May this key ASK for a document to be drawn?
     *
     * Default off, and off is the only safe default: a publishable key ships in
     * the page bundle by design, so with this on, anybody holding it can put
     * text in front of the operator's letterhead. What keeps that from being an
     * email relay is that the drawn row's `delivery` starts `pending-review`
     * and a person settles it.
     */
    documents: z
      .object({ create: z.boolean().default(false) })
      .strict()
      .optional(),
    resources: z.array(resourceSchema).min(1),
  })
  .strict();

/**
 * A DERIVED document may hold no resources at all: every
 * endpoint its key was granted can be narrowed to nothing, and the key must
 * then answer the one 404 on every ref rather than make each endpoint save
 * refuse. A hand-written scope keeps `.min(1)`.
 */
const derivedScopeDocumentSchema = publicScopeDocumentSchema.extend({ resources: z.array(resourceSchema) });

export type PublicScopeDocument = z.infer<typeof publicScopeDocumentSchema>;
export type PublicScopeResource = z.infer<typeof resourceSchema>;

/* ---------------------------------------------------------------- compiling */

export interface ScopeIssue {
  code: string;
  message: string;
  ref?: string;
  column?: string;
}

export class ScopeCompileError extends Error {
  readonly issues: readonly ScopeIssue[];
  constructor(issues: readonly ScopeIssue[]) {
    super(`scope failed to compile: ${issues.map((i) => i.code).join(', ')}`);
    this.name = 'ScopeCompileError';
    this.issues = issues;
  }
}

/** What the request path is handed. Every field is already checked. */
export interface CompiledResource {
  ref: string;
  table: string;
  actions: ReadonlySet<PublicAction>;
  expose: readonly string[];
  filterable: ReadonlySet<string>;
  searchable: readonly string[];
  orderable: ReadonlySet<string>;
  writable: ReadonlySet<string>;
  defaults: Readonly<Record<string, unknown>>;
  /** Already in the dashboard's own grammar, ready to AND. */
  mandatory: RecordFilter | null;
  claim: z.infer<typeof claimScopeSchema> | null;
  sensitive: boolean;
  /** The cap. A caller may ask for fewer rows, never more. */
  limit: number;
  /** The page size when the caller names none; never above `limit`. */
  defaultLimit: number;
  /** `column.dir`, or null to leave the order to the caller and the database. */
  defaultOrder: string | null;
  rate: { max: number; windowMs: number } | null;
  response: { shape: PublicResponseShape };
  /** `none` is the whole vocabulary (see `PUBLIC_COUNT_MODES`). */
  count: 'none';
  /** `availability` answers free or full per slot and never a row. */
  kind: 'records' | 'availability';
  /** The confirmation a guest's create sends, or null. */
  confirm: Record<string, unknown> | null;
}

export interface CompiledScope {
  version: 1;
  side: PublicSide;
  timezone: string;
  /** ISO-4217, when the scope serves money. */
  currency: string | null;
  claim: PublicScopeDocument['claim'] | null;
  /** The door, already defaulted — the request path reads one boolean. */
  documents: { create: boolean };
  byRef: ReadonlyMap<string, CompiledResource>;
}

/** A column set a table is known to have, supplied by the caller from the snapshot. */
export type TableColumnLookup = (table: string) => ReadonlySet<string> | null;

/**
 * Canonical IANA zone check.
 *
 * ── WHY NOT `new Intl.DateTimeFormat({ timeZone })` AND CATCH ──────────────
 * Because it accepts legacy aliases and SILENTLY REMAPS THEM, which is the
 * exact failure mode this field exists to prevent. Measured on this runtime:
 *
 *     "BST"  → Asia/Dhaka        (an operator means British Summer Time; they
 *                                 get Bangladesh Standard Time — SIX hours)
 *     "EST"  → America/Panama     (a real zone that never observes DST, so the
 *                                 error appears only half the year)
 *     "Zulu" → UTC
 *     "GMT"  → UTC
 *
 * Every one of those constructs without throwing. A validator built on the
 * throw would have passed "BST" and shipped a six-hour offset that looks like
 * data — the same shape as the one-hour bug that made this field mandatory in
 * the first place, only larger and harder to spot.
 *
 * So membership in the canonical list is the test. `Intl.supportedValuesOf`
 * returns the 400-odd canonical zones and deliberately excludes the aliases;
 * `UTC` is added back because it is canonical in every other sense and is what
 * a UTC-native deployment will write.
 *
 * Matching is case-insensitive and returns the CANONICAL spelling, so
 * `europe/london` is accepted and stored as `Europe/London` — a spelling
 * difference is a typo worth fixing for the operator, whereas an alias is a
 * meaning difference that only they can resolve.
 */
let canonicalZones: Map<string, string> | null = null;

function zoneIndex(): Map<string, string> {
  if (canonicalZones) return canonicalZones;
  const index = new Map<string, string>();
  const supported =
    typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
  for (const z of supported) index.set(z.toLowerCase(), z);
  index.set('utc', 'UTC');
  canonicalZones = index;
  return index;
}

/** The canonical spelling of `tz`, or null when it is not a canonical IANA zone. */
export function canonicalTimeZone(tz: string): string | null {
  const index = zoneIndex();
  const hit = index.get(tz.toLowerCase());
  if (hit !== undefined) return hit;
  /*
   * Fallback for a runtime without `supportedValuesOf` (the index is then just
   * `UTC`). Require a `Region/City` shape and that Intl accepts it: that still
   * rejects every bare alias above, which is the property worth keeping.
   */
  if (index.size <= 1 && tz.includes('/')) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: tz });
      return tz;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Compile a scope document, or throw with every issue found — not just the
 * first. An operator fixing a scope in Studio should see the whole list.
 *
 * `columnsOf` is optional so a scope can be checked for internal consistency
 * before a connection is reachable (Studio authoring, unit tests). When it is
 * supplied, every named column is additionally checked to EXIST.
 */
/**
 * Tenant facts the CONNECTION carries, which a scope inherits when it does not
 * state its own. Absent in Studio authoring, where no connection has been
 * chosen yet — which is exactly why they are optional here.
 */
export interface InheritedTenantConfig {
  timezone?: string | null;
  currency?: string | null;
}

export interface CompileScopeOptions {
  /** The document was derived from a key's endpoint grants. */
  derived?: boolean;
}

export function compileScope(
  input: unknown,
  columnsOf?: TableColumnLookup,
  inherited?: InheritedTenantConfig,
  opts: CompileScopeOptions = {},
): CompiledScope {
  const parsed = (opts.derived === true ? derivedScopeDocumentSchema : publicScopeDocumentSchema).safeParse(input);
  if (!parsed.success) {
    throw new ScopeCompileError(
      parsed.error.issues.map((i) => {
        const path = i.path.join('.');
        // `exactOptionalPropertyTypes` is on: an optional property may be
        // ABSENT but may not be present-and-undefined. Spread it in or leave
        // it out; never write `column: undefined`.
        return path === ''
          ? { code: 'SCOPE_SHAPE_INVALID', message: i.message }
          : { code: 'SCOPE_SHAPE_INVALID', message: i.message, column: path };
      }),
    );
  }
  const doc = parsed.data;
  const issues: ScopeIssue[] = [];

  /*
   * Scope first, connection second. The scope is the narrower statement and the
   * operator wrote it more recently; inheritance is the default, not a
   * fallback that silently wins.
   */
  const declaredZone = doc.timezone ?? inherited?.timezone ?? null;
  const timezone = declaredZone === null ? null : canonicalTimeZone(declaredZone);
  if (timezone === null) {
    issues.push({
      code: 'SCOPE_TIMEZONE_INVALID',
      message:
        declaredZone === null
          ? // Naming both places matters: an operator told only "the scope has
            // no timezone" will add one to every scope instead of setting it
            // once on the connection, which is the whole point of the setting.
            'no time zone is configured. Set one on the connection, or state a ' +
            '`timezone` on this scope to override it.'
          : `"${declaredZone}" is not a canonical IANA time zone. Use a Region/City name such as ` +
            `"Europe/London". Abbreviations are refused because they are ambiguous: "BST" resolves ` +
            `to Asia/Dhaka, and "EST" to a zone that never observes daylight saving.`,
    });
  }

  const seen = new Set<string>();
  for (const r of doc.resources) {
    if (seen.has(r.ref)) {
      issues.push({ code: 'SCOPE_REF_DUPLICATE', message: `ref "${r.ref}" is declared twice`, ref: r.ref });
    }
    seen.add(r.ref);
  }

  for (const r of doc.resources) {
    /*
     * The meta namespace is not reachable through this door at any time. The
     * public surface addresses the DATA connection; a ref pointed at an
     * `adminium_` table would be asking the records API to serve the meta store
     * to the internet. Refused by name rather than by permission, because a
     * permission is something someone can grant. The table's own name is what
     * counts: every meta table starts with `adminium_`, while a MySQL database
     * named `adminium_shop` holds the operator's tables.
     */
    if (/(^|\.)adminium_[^.]*$/.test(r.table)) {
      issues.push({
        code: 'SCOPE_REF_META_NAMESPACE',
        message: `ref "${r.ref}" maps into the adminium_ namespace, which is never publishable`,
        ref: r.ref,
      });
    }

    /*
     * `columnsOf` returns null for a table the snapshot does not have.
     *
     * That USED to compile silently, and the failure surfaced at request time
     * as `PUBLIC_UPSTREAM_UNAVAILABLE` — a live probe hit it on a table created
     * after the last introspection. A scope naming a table that does not exist
     * is not a narrower scope; it is a broken one, and the operator authoring it
     * is the only person who can fix it. So it refuses here, where they can see
     * it, rather than at 3am to somebody anonymous.
     *
     * Only when a lookup was SUPPLIED: `compileScope` is also called without one
     * (Studio authoring before a connection is reachable, and unit tests), and
     * there "unknown" means "not checked" rather than "absent".
     */
    const known = columnsOf === undefined ? null : columnsOf(r.table);
    if (columnsOf !== undefined && known === null) {
      issues.push({
        code: 'SCOPE_TABLE_UNKNOWN',
        message: `${r.table} is not in this connection's schema snapshot — re-introspect, or correct the name`,
        ref: r.ref,
      });
    }
    const check = (col: string, code: string): void => {
      if (known && !known.has(col)) {
        issues.push({ code, message: `"${col}" is not a column of ${r.table}`, ref: r.ref, column: col });
      }
    };

    for (const c of r.expose) check(c, 'SCOPE_EXPOSE_UNKNOWN_COLUMN');
    for (const c of r.filterable) check(c, 'SCOPE_FILTERABLE_UNKNOWN_COLUMN');
    for (const c of r.searchable) check(c, 'SCOPE_SEARCHABLE_UNKNOWN_COLUMN');
    for (const c of r.orderable) check(c, 'SCOPE_ORDERABLE_UNKNOWN_COLUMN');
    for (const c of r.writable) check(c, 'SCOPE_WRITABLE_UNKNOWN_COLUMN');
    for (const c of r.where) check(c.column, 'SCOPE_WHERE_UNKNOWN_COLUMN');
    /*
     * Defaults were the one list not checked against the snapshot, and the
     * omission became load-bearing with `$generate`: a default on a mistyped
     * column used to fail at insert time as an unhelpful "that write was
     * refused", and a MINTED default on a mistyped column would fail the same
     * way while the row it was supposed to identify looked correctly declared.
     */
    for (const c of Object.keys(r.defaults)) check(c, 'SCOPE_DEFAULT_UNKNOWN_COLUMN');

    /*
     * A filterable/searchable/orderable column that is not exposed is a read
     * primitive for a column the caller cannot see — the exact shape of the
     * `q=` oracle the `searchable` rule below exists to close, arrived at from
     * a different direction.
     */
    const exposed = new Set(r.expose);
    for (const c of r.filterable) {
      if (!exposed.has(c)) {
        issues.push({
          code: 'SCOPE_FILTERABLE_NOT_EXPOSED',
          message: `"${c}" is filterable but not exposed — that is a read primitive for a hidden column`,
          ref: r.ref,
          column: c,
        });
      }
    }
    for (const c of r.searchable) {
      if (!exposed.has(c)) {
        issues.push({
          code: 'SCOPE_SEARCHABLE_NOT_EXPOSED',
          message: `"${c}" is searchable but not exposed — substring matching leaks it a character at a time`,
          ref: r.ref,
          column: c,
        });
      }
    }
    for (const c of r.orderable) {
      if (!exposed.has(c)) {
        issues.push({
          code: 'SCOPE_ORDERABLE_NOT_EXPOSED',
          message: `"${c}" is orderable but not exposed — ordering reveals it comparison by comparison`,
          ref: r.ref,
          column: c,
        });
      }
    }

    /* A caller must never be able to move a row out of its own scope. */
    const writable = new Set(r.writable);
    for (const c of r.where) {
      if (writable.has(c.column)) {
        issues.push({
          code: 'SCOPE_WHERE_COLUMN_WRITABLE',
          message: `"${c.column}" is constrained by the mandatory predicate and also writable — a caller could write itself out of scope`,
          ref: r.ref,
          column: c.column,
        });
      }
    }
    if (r.claim?.column !== undefined && writable.has(r.claim.column)) {
      issues.push({
        code: 'SCOPE_CLAIM_COLUMN_WRITABLE',
        message: `"${r.claim.column}" gates this resource for a claimed session and must not be writable`,
        ref: r.ref,
        column: r.claim.column,
      });
    }

    /*
     * `$generate` SENTINELS — the shape, and the one place they may not sit.
     *
     * A malformed sentinel is refused rather than treated as a literal, for the
     * reason `generate.ts` gives at length: an object with a `$generate` key is
     * always an instruction here, so a typo in it must fail where the operator
     * is looking rather than be serialized into their column at 3am.
     *
     * ── AND WHY WRITABLE IS REFUSED FOR A SENTINEL AND NOT FOR A LITERAL ────
     *
     * A literal default on a writable column is merely useless: the caller may
     * send the column, and `prepareValues` throws their value away. Odd, and
     * nothing worse, which is why it has always been allowed.
     *
     * A MINTED default on a writable column is a different claim. Every one of
     * them exists because the value must be the SERVER's — an id nobody can
     * guess, a timestamp nobody can backdate — and listing the column writable
     * is the scope saying, in the same document, that a caller may choose it.
     * Today the default wins and the write is safe; the refusal is for the day
     * somebody reorders those two lines in `prepareValues`, or reads the scope
     * and believes the half of it that is a lie. A contradiction a reader can
     * resolve two ways does not belong in a security document.
     */
    for (const [column, value] of Object.entries(r.defaults)) {
      const reading = readGenerator(value);
      if (reading === null) continue;
      if (reading.problem === 'extra-keys') {
        issues.push({
          code: 'SCOPE_DEFAULT_GENERATE_SHAPE',
          message: `default for "${column}" carries "$generate" alongside other keys — a sentinel is exactly { "$generate": … }`,
          ref: r.ref,
          column,
        });
        continue;
      }
      if (reading.problem === 'unknown-generator') {
        issues.push({
          code: 'SCOPE_DEFAULT_GENERATE_UNKNOWN',
          message: `default for "${column}" asks for "${String(reading.raw)}" — the generators are ${PUBLIC_GENERATORS.join(', ')}`,
          ref: r.ref,
          column,
        });
        continue;
      }
      if (writable.has(column)) {
        issues.push({
          code: 'SCOPE_DEFAULT_GENERATE_WRITABLE',
          message: `"${column}" is generated by the server and also writable — a generated value exists because the caller may not choose it`,
          ref: r.ref,
          column,
        });
      }
    }

    for (const c of r.where) {
      const needsValue = c.op !== 'is_null' && c.op !== 'not_null';
      if (needsValue && c.value === undefined) {
        issues.push({
          code: 'SCOPE_WHERE_VALUE_MISSING',
          message: `condition on "${c.column}" uses "${c.op}" and needs a value`,
          ref: r.ref,
          column: c.column,
        });
      }
    }

    /* Declaring a write action with nothing writable is almost always a mistake. */
    for (const a of r.actions) {
      if (WRITING_ACTIONS.has(a) && r.writable.length === 0) {
        issues.push({
          code: 'SCOPE_ACTION_WITHOUT_WRITABLE',
          message: `ref "${r.ref}" declares "${a}" but lists no writable columns`,
          ref: r.ref,
        });
      }
    }

    if (r.defaultLimit !== undefined && r.defaultLimit > r.limit) {
      issues.push({
        code: 'SCOPE_DEFAULT_LIMIT_ABOVE_LIMIT',
        message: `ref "${r.ref}" pages ${r.defaultLimit} rows by default but caps a page at ${r.limit}`,
        ref: r.ref,
      });
    }
    /*
     * The default order is the SERVER's choice, so it needs no `orderable`
     * entry — but it still sorts by a column, and a sort by a hidden column
     * reveals it comparison by comparison, exactly as `orderable` would.
     */
    if (r.defaultOrder !== undefined) {
      const column = r.defaultOrder.slice(0, r.defaultOrder.lastIndexOf('.'));
      check(column, 'SCOPE_DEFAULT_ORDER_UNKNOWN_COLUMN');
      if (!exposed.has(column)) {
        issues.push({
          code: 'SCOPE_DEFAULT_ORDER_NOT_EXPOSED',
          message: `ref "${r.ref}" orders by "${column}", which it does not expose`,
          ref: r.ref,
          column,
        });
      }
    }

    /* `via` is one hop, and the hop must land on a ref this scope declares. */
    if (r.claim?.via && !seen.has(r.claim.via.ref)) {
      issues.push({
        code: 'SCOPE_CLAIM_VIA_UNKNOWN_REF',
        message: `claim.via points at "${r.claim.via.ref}", which this scope does not declare`,
        ref: r.ref,
      });
    }
    if (r.claim?.via && r.claim.column !== undefined) {
      issues.push({
        code: 'SCOPE_CLAIM_AMBIGUOUS',
        message: `ref "${r.ref}" sets both claim.column and claim.via — pick one`,
        ref: r.ref,
      });
    }

    /*
     * A customer-side resource with no mandatory predicate AND no claim is the
     * whole table, published. Sometimes that is right — a menu, a course
     * catalogue — so this refuses only when the resource is also `sensitive`.
     */
    if (doc.side === 'customer' && r.sensitive && r.where.length === 0 && !r.claim) {
      issues.push({
        code: 'SCOPE_SENSITIVE_UNSCOPED',
        message: `ref "${r.ref}" is marked sensitive but has neither a mandatory predicate nor a claim`,
        ref: r.ref,
      });
    }
  }

  /*
   * The document door is a CUSTOMER-side affordance and nothing else.
   *
   * A staff-side key belongs to a person Adminium can authenticate, and the
   * staff surfaces already have `POST /api/v1/documents/render` behind a real
   * session and a real grant. Offering the same thing through a publishable key
   * would be a second, weaker door into the same pipeline — one whose whole
   * defence is that a human settles what comes out of it, which is
   * ceremony when the caller is already a known user.
   */
  if (doc.documents?.create === true && doc.side === 'staff') {
    issues.push({
      code: 'SCOPE_DOCUMENTS_STAFF_SIDE',
      message:
        'documents.create is a customer-side flag — a staff surface draws documents through the ' +
        'authenticated API',
    });
  }

  /*
   * The claim-tier rule, enforced here rather than documented. A `lookup`
   * claim is possession-of-a-reference; the pilot's own model app matched on a
   * mobile number and a date of birth, both low-entropy personal data, against
   * sequential references. That is acceptable for "track my order" and is not
   * acceptable for a medical record.
   */
  if (doc.claim) {
    const target = doc.resources.find((r) => r.ref === doc.claim?.ref);
    if (!target) {
      issues.push({
        code: 'SCOPE_CLAIM_UNKNOWN_REF',
        message: `claim targets ref "${doc.claim.ref}", which this scope does not declare`,
      });
    } else {
      if (doc.claim.strategy === 'lookup' && target.sensitive) {
        issues.push({
          code: 'SCOPE_CLAIM_TIER_TOO_WEAK',
          message: `ref "${target.ref}" is sensitive, so it cannot be claimed by reference lookup — use "email-code" or "external"`,
          ref: target.ref,
        });
      }
      const cols = columnsOf?.(target.table) ?? null;
      for (const c of doc.claim.match) {
        if (cols && !cols.has(c)) {
          issues.push({
            code: 'SCOPE_CLAIM_UNKNOWN_COLUMN',
            message: `claim matches on "${c}", which is not a column of ${target.table}`,
            column: c,
          });
        }
      }
    }
  }

  if (issues.length > 0) throw new ScopeCompileError(issues);

  /*
   * `timezone` is non-null here: a null pushed an issue above, and any issue
   * threw. Restated rather than asserted with `!` so the invariant survives a
   * future edit that adds an early return between the two — the compiler then
   * keeps checking it instead of trusting a bang that has stopped being true.
   */
  if (timezone === null) {
    throw new ScopeCompileError([
      { code: 'SCOPE_TIMEZONE_INVALID', message: 'time zone did not resolve' },
    ]);
  }

  const byRef = new Map<string, CompiledResource>();
  for (const r of doc.resources) {
    byRef.set(r.ref, {
      ref: r.ref,
      table: r.table,
      actions: new Set(r.actions),
      expose: [...r.expose],
      filterable: new Set(r.filterable),
      searchable: [...r.searchable],
      orderable: new Set(r.orderable),
      writable: new Set(r.writable),
      defaults: { ...r.defaults },
      mandatory: toRecordFilter(r.where),
      claim: r.claim ?? null,
      sensitive: r.sensitive,
      limit: r.limit,
      defaultLimit: r.defaultLimit ?? r.limit,
      defaultOrder: r.defaultOrder ?? null,
      rate: r.rate === undefined ? null : { max: r.rate.max, windowMs: r.rate.windowMs },
      response: { shape: r.response?.shape ?? 'wrapped' },
      count: r.count,
      kind: r.kind ?? 'records',
      confirm: r.confirm ?? null,
    });
  }

  return {
    version: 1,
    side: doc.side,
    // The CANONICAL spelling, not what was written — see `canonicalTimeZone`.
    timezone: timezone,
    // Same inheritance as the zone, same order: the scope overrides, the
    // connection supplies. Null only when neither has one, which is legitimate
    // — a scope exposing no money needs no currency.
    currency: doc.currency ?? inherited?.currency ?? null,
    claim: doc.claim ?? null,
    // Defaulted HERE so the request path reads one boolean rather than three
    // levels of optional, and so "absent" and "false" cannot mean two things.
    documents: { create: doc.documents?.create ?? false },
    byRef,
  };
}

/** Flat conditions → the dashboard's own filter grammar, ANDed. */
function toRecordFilter(where: readonly z.infer<typeof mandatoryConditionSchema>[]): RecordFilter | null {
  if (where.length === 0) return null;
  const conditions = where.map((c) =>
    c.value === undefined
      ? ({ column: c.column, op: c.op } as RecordFilter)
      : ({ column: c.column, op: c.op, value: c.value } as RecordFilter),
  );
  return conditions.length === 1 ? (conditions[0] as RecordFilter) : { and: conditions };
}

/**
 * The browser-facing projection of a scope — what `GET /public/config` returns.
 *
 * Physical table names, mandatory predicates, claim columns and `sensitive` are
 * all ABSENT: a client needs to know what it may ask for, never how the server
 * decides. The predicate in particular is an authorization rule, and publishing
 * it tells an attacker exactly which rows they are being kept away from.
 */
export function publicConfigOf(scope: CompiledScope): {
  version: 1;
  side: PublicSide;
  timezone: string;
  currency: string | null;
  claim: { strategy: ClaimStrategy; ref: string; match: string[] } | null;
  /**
   * A capability, not a rule about rows — the page needs to know whether it
   * may offer "email me a copy" at all, and hiding that would make it
   * discover the refusal by being refused.
   */
  documents: { create: boolean };
  refs: Record<string, ReturnType<typeof projectResource>>;
} {
  const refs: Record<string, ReturnType<typeof projectResource>> = {};
  for (const [ref, r] of scope.byRef) refs[ref] = projectResource(r);
  return {
    version: 1,
    side: scope.side,
    timezone: scope.timezone,
    currency: scope.currency,
    claim: scope.claim
      ? { strategy: scope.claim.strategy, ref: scope.claim.ref, match: [...scope.claim.match] }
      : null,
    documents: { create: scope.documents.create },
    refs,
  };
}

function projectResource(r: CompiledResource): {
  actions: PublicAction[];
  expose: string[];
  filterable: string[];
  searchable: string[];
  orderable: string[];
  writable: string[];
  limit: number;
  /**
   * How a list of this ref answers. A page detects it here rather than by
   * version: `version` is the constant 1.
   */
  response: { shape: PublicResponseShape };
  kind?: 'availability';
} {
  // Copied, not aliased: this object is serialized straight onto the wire, and
  // handing out the compiled scope's own arrays would let a serializer or a
  // future caller mutate an authorization document in place.
  return {
    actions: [...r.actions],
    expose: [...r.expose],
    filterable: [...r.filterable],
    searchable: [...r.searchable],
    orderable: [...r.orderable],
    writable: [...r.writable],
    limit: r.limit,
    response: { shape: r.response.shape },
    ...(r.kind === 'availability' ? { kind: 'availability' as const } : {}),
  };
}
