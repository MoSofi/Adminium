// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The list-DSL filter grammar and its dynamic-Kysely compiler. Identifiers
 * are resolved against the snapshot before they reach Kysely
 * (`db.dynamic.ref` receives snapshot strings only); every value binds as
 * a parameter — by construction.
 */

import type { DynamicModule, Expression, ExpressionBuilder, ReferenceExpression, SqlBool } from 'kysely';
import { z } from 'zod';

import type { Dialect } from '@adminium/engine';

import { ForbiddenError, ValidationFailedError } from '../errors.js';
import type { SourceDatabase } from '../connections/manager.js';
import type { ResolvedColumn, ResolvedTable, SnapshotView } from './identifiers.js';
import { bindWriteValue } from './write-values.js';

export const FILTER_OPS = [
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
] as const;
export type FilterOp = (typeof FILTER_OPS)[number];

export interface FilterCondition {
  column: string;
  op: FilterOp;
  /** Required except for is_null / not_null. */
  value?: unknown;
}

export type RecordFilter =
  | FilterCondition
  | { and: RecordFilter[] }
  | { or: RecordFilter[] };

const conditionSchema = z.object({
  column: z.string().min(1),
  op: z.enum(FILTER_OPS),
  value: z.unknown().optional(),
});

export const recordFilterSchema: z.ZodType<RecordFilter> = z.lazy(() =>
  z.union([
    conditionSchema,
    z.object({ and: z.array(recordFilterSchema).min(1).max(16) }),
    z.object({ or: z.array(recordFilterSchema).min(1).max(16) }),
  ]),
) as z.ZodType<RecordFilter>;

export const MAX_FILTER_CONDITIONS = 16;
export const MAX_FILTER_GROUP_DEPTH = 2;
export const MAX_IN_VALUES = 200;

/** Structural limits (refinement): depth ≤ 2 groups, ≤ 16 conditions. */
export function assertFilterLimits(filter: RecordFilter): void {
  let conditions = 0;
  const walk = (node: RecordFilter, groupDepth: number): void => {
    if ('and' in node || 'or' in node) {
      if (groupDepth >= MAX_FILTER_GROUP_DEPTH) {
        throw new ValidationFailedError('Filter groups may nest at most 2 levels deep.', {
          maxDepth: MAX_FILTER_GROUP_DEPTH,
        });
      }
      const children = 'and' in node ? node.and : node.or;
      for (const child of children) walk(child, groupDepth + 1);
      return;
    }
    conditions += 1;
    if (conditions > MAX_FILTER_CONDITIONS) {
      throw new ValidationFailedError('Filters are limited to 16 conditions.', {
        maxConditions: MAX_FILTER_CONDITIONS,
      });
    }
  };
  walk(filter, 0);
}

/*
 * ── THE ENVELOPE, AND WHY IT IS NOT A ROUND NUMBER ─────────────────────────
 *
 * `assertFilterLimits` runs on a parsed tree, so it cannot bound the cost of
 * producing that tree. `recordFilterSchema` is recursive, and its union
 * re-descends on failure, which makes a rejecting chain quadratic in depth:
 * measured on this schema, a 9,023-byte `where=` burns ~410 ms of event loop
 * before returning its 422, and past ~7 KB zod overflows the stack outright —
 * a RangeError, which is not an AppError, so the CRUD path answers 500. Both
 * fit inside Node's default 16,384-byte request line, so both are reachable.
 *
 * The two numbers below are read off the grammar, not picked round:
 *
 *   depth — a group is an object wrapping an array (`{"and":[…]}`), so each
 *     of the MAX_FILTER_GROUP_DEPTH levels costs two brackets; the leaf
 *     condition object costs one more, and `in`/`between` may carry a flat
 *     list, costing the last. Nothing the grammar accepts nests deeper, so
 *     the scan refuses only what `assertFilterLimits` would have refused.
 *
 *   bytes — MAX_FILTER_CONDITIONS conditions, each naming a column, an op and
 *     a value, inside at most one group envelope apiece. Sixteen full `in`
 *     lists would be ~125 KB, which no request line can carry, so the budget
 *     allows the structural maximum plus ONE full list: the largest filter
 *     that can actually be sent. Under both caps the worst rejecting shape
 *     measures ~2.4 ms, and a 200-UUID `in` list still parses.
 */

/** Longest column identifier any supported dialect allows (pg 63, mysql 64). */
const IDENTIFIER_BYTES = 64;
/** Longest op token — `not_null`. */
const OP_BYTES = 8;
/** `{"column":"","op":"","value":},` with the three variable parts removed. */
const CONDITION_ENVELOPE_BYTES = 31;
/** `{"and":[` + `]}` — one group's punctuation. */
const GROUP_ENVELOPE_BYTES = 10;
/** A quoted UUID plus its separator: the widest scalar a key filter carries. */
const VALUE_BYTES = 39;

/** Group object + group array, per level; then the condition; then its list. */
export const MAX_WHERE_DEPTH = MAX_FILTER_GROUP_DEPTH * 2 + 2;

export const MAX_WHERE_BYTES =
  (MAX_FILTER_CONDITIONS + 1) * GROUP_ENVELOPE_BYTES +
  MAX_FILTER_CONDITIONS * (CONDITION_ENVELOPE_BYTES + IDENTIFIER_BYTES + OP_BYTES + VALUE_BYTES) +
  (MAX_IN_VALUES - 1) * VALUE_BYTES +
  2;

/**
 * Size and nesting gate for the RAW `where=` string — the half of the limits
 * that has to run before {@link JSON.parse} and {@link recordFilterSchema} to
 * mean anything. A single left-to-right character scan, string-literal aware
 * so a value like `"[[[["` is text and not structure.
 *
 * Refuses as the same 422 the rest of the parser throws: every shape it turns
 * away is one `assertFilterLimits` would have turned away anyway, just for a
 * price the caller no longer gets to charge us.
 */
export function assertWhereEnvelope(raw: string): void {
  const bytes = Buffer.byteLength(raw, 'utf8');
  if (bytes > MAX_WHERE_BYTES) {
    throw new ValidationFailedError(`\`where\` is limited to ${String(MAX_WHERE_BYTES)} bytes.`, {
      maxBytes: MAX_WHERE_BYTES,
      bytes,
    });
  }
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw.charCodeAt(i);
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === 0x5c) escaped = true; // backslash
      else if (ch === 0x22) inString = false; // closing quote
      continue;
    }
    if (ch === 0x22) {
      inString = true;
    } else if (ch === 0x7b || ch === 0x5b) {
      // { or [
      depth += 1;
      if (depth > MAX_WHERE_DEPTH) {
        throw new ValidationFailedError(
          `\`where\` may nest at most ${String(MAX_WHERE_DEPTH)} levels deep.`,
          { maxDepth: MAX_WHERE_DEPTH },
        );
      }
    } else if (ch === 0x7d || ch === 0x5d) {
      // } or ]
      depth -= 1;
    }
  }
}

/** Parse the `where` query param (URL-encoded JSON) into a validated tree. */
export function parseWhereParam(raw: string): RecordFilter {
  assertWhereEnvelope(raw);
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new ValidationFailedError('`where` must be URL-encoded JSON.', {});
  }
  const parsed = recordFilterSchema.safeParse(json);
  if (!parsed.success) {
    throw new ValidationFailedError('`where` does not match the filter grammar.', {
      issues: parsed.error.issues,
    });
  }
  assertFilterLimits(parsed.data);
  return parsed.data;
}

export interface CompileFilterContext {
  view: SnapshotView;
  table: ResolvedTable;
  /** `table:<conn>:<table>:read_pii`-equivalent — masked columns usable when true. */
  canReadPii: boolean;
  dynamic: DynamicModule<SourceDatabase>;
  /** Source dialect — decides `ilike` (postgres) vs `LOWER(...) LIKE` (mysql/sqlite). */
  dialect: Dialect;
}

function requireValue(condition: FilterCondition): unknown {
  if (condition.value === undefined) {
    throw new ValidationFailedError(`Filter op "${condition.op}" requires a value.`, {
      column: condition.column,
      op: condition.op,
    });
  }
  return condition.value;
}

type Eb = ExpressionBuilder<Record<string, Record<string, unknown>>, string>;
type Ref = ReferenceExpression<Record<string, Record<string, unknown>>, string>;

/**
 * Case-insensitive substring match, compiled per dialect. Postgres has a
 * native `ILIKE`; MySQL and SQLite have neither (`ILIKE` is a syntax error on
 * both), so both operands are folded with `LOWER()`. Folding — rather than a
 * bare `LIKE` — keeps the match case-insensitive regardless of the column's
 * collation: SQLite's default `LIKE` only folds ASCII, and a `_bin`/`_cs`
 * MySQL column would otherwise compare case-sensitively. The value still binds
 * as a parameter; `LOWER()` wraps the placeholder, not an inlined literal.
 */
function compileILike(eb: Eb, dialect: Dialect, ref: Ref, pattern: string): Expression<SqlBool> {
  if (dialect === 'postgres') return eb(ref, 'ilike', pattern);
  return eb(eb.fn('lower', [ref]), 'like', eb.fn<string>('lower', [eb.val(pattern)]));
}

/**
 * A value as the engine binds it. A descriptor carries JSON, so a boolean
 * filter arrives as `true`/`false` — which better-sqlite3 refuses to bind at
 * all ("can only bind numbers, strings, …"); SQLite keeps booleans as 1 and
 * 0, as every write to it does (`bindValue` in the write service). An instant
 * compared with a MySQL `TIMESTAMP` is spelled the way one is written there:
 * an ISO one is refused inside an UPDATE, and read in the session's zone
 * anywhere else (`bindWriteValue`).
 */
function bindable(ctx: CompileFilterContext, column: ResolvedColumn, value: unknown): unknown {
  if (ctx.dialect === 'mysql' && column.logicalType === 'timestamptz') {
    return Array.isArray(value) ? value.map((item) => bindWriteValue(column, item, ctx.dialect)) : bindWriteValue(column, value, ctx.dialect);
  }
  if (ctx.dialect !== 'sqlite') return value;
  if (typeof value === 'boolean') return value ? 1 : 0;
  return Array.isArray(value) ? value.map((item) => (typeof item === 'boolean' ? (item ? 1 : 0) : item)) : value;
}

function compileCondition(eb: Eb, ctx: CompileFilterContext, condition: FilterCondition): Expression<SqlBool> {
  // Masked columns are rejected in `where` for non-PII readers.
  const column = ctx.view.readableColumn(ctx.table, condition.column, ctx.canReadPii);
  const ref = ctx.dynamic.ref(column.name);
  const value = () => bindable(ctx, column, requireValue(condition));
  switch (condition.op) {
    case 'eq':
      return eb(ref, '=', value());
    case 'neq':
      return eb(ref, '!=', value());
    case 'gt':
      return eb(ref, '>', value());
    case 'gte':
      return eb(ref, '>=', value());
    case 'lt':
      return eb(ref, '<', value());
    case 'lte':
      return eb(ref, '<=', value());
    case 'in': {
      const value = bindable(ctx, column, requireValue(condition));
      if (!Array.isArray(value) || value.length > MAX_IN_VALUES) {
        throw new ValidationFailedError('`in` takes an array of at most 200 values.', {
          column: condition.column,
        });
      }
      if (value.length === 0) return eb(eb.val(1), '=', 0); // empty set matches nothing
      return eb(ref, 'in', value);
    }
    case 'like':
      return eb(ref, 'like', String(requireValue(condition)));
    case 'ilike':
      return compileILike(eb, ctx.dialect, ref, String(requireValue(condition)));
    case 'is_null':
      return eb(ref, 'is', null);
    case 'not_null':
      return eb(ref, 'is not', null);
    case 'between': {
      const value = bindable(ctx, column, requireValue(condition));
      if (!Array.isArray(value) || value.length !== 2) {
        throw new ValidationFailedError('`between` takes a [low, high] pair.', {
          column: condition.column,
        });
      }
      return eb.and([eb(ref, '>=', value[0]), eb(ref, '<=', value[1])]);
    }
  }
}

/** Compile a validated filter tree inside a Kysely `where((eb) => …)` callback. */
export function compileFilter(eb: Eb, ctx: CompileFilterContext, filter: RecordFilter): Expression<SqlBool> {
  if ('and' in filter) {
    return eb.and(filter.and.map((child) => compileFilter(eb, ctx, child)));
  }
  if ('or' in filter) {
    return eb.or(filter.or.map((child) => compileFilter(eb, ctx, child)));
  }
  return compileCondition(eb, ctx, filter);
}

/** Escape LIKE wildcards in user text for the `q=` quick search. */
export function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/**
 * `q=` quick search: a case-insensitive `%q%` substring match OR-ed across the
 * table's text-ish columns from the snapshot, excluding masked ones for non-PII
 * readers. Compiled per dialect via {@link compileILike} — postgres `ILIKE`,
 * mysql/sqlite `LOWER(...) LIKE LOWER(...)`.
 */
export function compileQuickSearch(
  eb: Eb,
  ctx: CompileFilterContext,
  q: string,
  /**
   * Restrict the search to these columns (b).
   *
   * WITHOUT it this ORs `ILIKE '%q%'` across every text-ish column on the
   * table, INDEPENDENTLY of `select`. For an authenticated caller who was
   * granted table-read that is the intended convenience. For an anonymous one
   * it is a character-extraction oracle: row presence answers "does any hidden
   * column contain this substring?", one character at a time, for columns the
   * caller can never see. The public layer therefore passes an explicit
   * allow-list or refuses `q=` outright; the dashboard passes nothing and is
   * unchanged.
   */
  searchable?: readonly string[],
): Expression<SqlBool> | null {
  const pattern = `%${escapeLike(q)}%`;
  const allow = searchable === undefined ? null : new Set(searchable);
  const targets = [...ctx.table.columns.values()].filter(
    (column) =>
      column.textish &&
      !column.secret &&
      (ctx.canReadPii || !column.masked) &&
      (allow === null || allow.has(column.name)),
  );
  if (targets.length === 0) return null;
  return eb.or(targets.map((column) => compileILike(eb, ctx.dialect, ctx.dynamic.ref(column.name), pattern)));
}

/** Re-exported for routes that need the masked-column rejection directly. */
export { ForbiddenError };
