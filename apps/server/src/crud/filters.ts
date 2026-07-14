/**
 * The list-DSL filter grammar and its dynamic-Kysely compiler
 * (08-server-api.md §2.7.1). Identifiers are resolved against the snapshot
 * before they reach Kysely (`db.dynamic.ref` receives snapshot strings
 * only); every value binds as a parameter — §7 item 1 by construction.
 */

import type { DynamicModule, Expression, ExpressionBuilder, ReferenceExpression, SqlBool } from 'kysely';
import { z } from 'zod';

import type { Dialect } from '@adminium/engine';

import { ForbiddenError, ValidationFailedError } from '../errors.js';
import type { SourceDatabase } from '../connections/manager.js';
import type { ResolvedTable, SnapshotView } from './identifiers.js';

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

/** Structural limits (§2.7.1 refinement): depth ≤ 2 groups, ≤ 16 conditions. */
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

/** Parse the `where` query param (URL-encoded JSON) into a validated tree. */
export function parseWhereParam(raw: string): RecordFilter {
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

function compileCondition(eb: Eb, ctx: CompileFilterContext, condition: FilterCondition): Expression<SqlBool> {
  // Masked columns are rejected in `where` for non-PII readers (§5.3 rule 2).
  const column = ctx.view.readableColumn(ctx.table, condition.column, ctx.canReadPii);
  const ref = ctx.dynamic.ref(column.name);
  switch (condition.op) {
    case 'eq':
      return eb(ref, '=', requireValue(condition));
    case 'neq':
      return eb(ref, '!=', requireValue(condition));
    case 'gt':
      return eb(ref, '>', requireValue(condition));
    case 'gte':
      return eb(ref, '>=', requireValue(condition));
    case 'lt':
      return eb(ref, '<', requireValue(condition));
    case 'lte':
      return eb(ref, '<=', requireValue(condition));
    case 'in': {
      const value = requireValue(condition);
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
      const value = requireValue(condition);
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
 * `q=` quick search (§2.7.1): a case-insensitive `%q%` substring match OR-ed
 * across the table's text-ish columns from the snapshot, excluding masked ones
 * for non-PII readers. Compiled per dialect via {@link compileILike} — postgres
 * `ILIKE`, mysql/sqlite `LOWER(...) LIKE LOWER(...)`.
 */
export function compileQuickSearch(
  eb: Eb,
  ctx: CompileFilterContext,
  q: string,
): Expression<SqlBool> | null {
  const pattern = `%${escapeLike(q)}%`;
  const targets = [...ctx.table.columns.values()].filter(
    (column) => column.textish && !column.secret && (ctx.canReadPii || !column.masked),
  );
  if (targets.length === 0) return null;
  return eb.or(targets.map((column) => compileILike(eb, ctx.dialect, ctx.dynamic.ref(column.name), pattern)));
}

/** Re-exported for routes that need the masked-column rejection directly. */
export { ForbiddenError };
