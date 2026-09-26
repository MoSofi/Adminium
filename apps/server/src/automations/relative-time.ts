// SPDX-License-Identifier: AGPL-3.0-only
/**
 * AUTOMATION CONDITIONS → THE LIST FILTER DSL (42-automations-and-workflow-
 * logs.md D5).
 *
 * A schedule scan asks the database a question — "which appointments start
 * within the next two hours and are still `scheduled`?" — so its conditions
 * have to become SQL. They go through `crud/filters.ts`, which resolves every
 * identifier against the snapshot and binds every value as a parameter, and
 * NOT through a hand-built `WHERE col > '2026-…'`. That is the whole point:
 * the one place this product has repeatedly got timestamps wrong is when a
 * value was formatted into SQL by hand for one dialect and shipped to three.
 *
 * ─── The bound value, per dialect and per column type ──────────────────────
 *
 * There is no single JS value that means "this instant" on Postgres, MySQL
 * and SQLite at once (the `$generate` lesson, learnt writing defaults). What
 * there IS, is a documented WIRE convention this product already follows on
 * the write side (`crud/write-values.ts`): a `timestamptz` carries a zoned
 * instant, a naive `timestamp` carries the SERVER-LOCAL wall clock, and a
 * `date` carries `YYYY-MM-DD`. A bound produced the same way compares against
 * the same column correctly, because it is spelled the way the column's own
 * values are spelled.
 *
 * SQLite is the exception and takes ISO-8601 UTC for a time: it has no date
 * type at all, its columns hold text, and ISO-8601 is the format whose
 * lexicographic order IS its chronological order — which is what a `BETWEEN`
 * on a text column actually compares.
 *
 * A `date` holds a calendar day, and every engine reads it back as its
 * `YYYY-MM-DD` text. It is bounded by the day it is on this server's clock,
 * on every engine alike — SQLite included, which used the UTC day and so
 * moved the edge by the server's offset. `conditions.ts` judges a date the
 * same way when a trigger's condition is evaluated in memory, so the event
 * path and this scan agree about the same row at the same moment.
 *
 * ─── Case ─────────────────────────────────────────────────────────────────
 *
 * D18 says a string comparison is case-insensitive for `is`, `is not` and
 * `contains`. In memory that is a `toLowerCase()`; in SQL it is `ILIKE`, and
 * `is` on a text column compiles to `ILIKE` with the LIKE metacharacters
 * escaped rather than to `=`, so a scan and an in-memory evaluation of the
 * same condition never disagree. Non-text columns keep `=`: `ILIKE` against
 * an integer is a type error on Postgres and nonsense everywhere else.
 */

import type { Dialect } from '@adminium/engine';
import type { AutomationCondition } from '@adminium/meta';
import { automationDurationMs, isRelativeAutomationOp } from '@adminium/meta';

import { ValidationFailedError } from '../errors.js';
import { escapeLike, type RecordFilter } from '../crud/filters.js';
import type { ResolvedColumn, ResolvedTable } from '../crud/identifiers.js';

const DATE_TYPES = new Set(['date', 'timestamp', 'timestamptz']);

const pad = (n: number, width = 2): string => String(n).padStart(width, '0');

/** The server-local wall clock, in the spelling `normalizeWriteValue` writes. */
function localStamp(at: Date, withTime: boolean): string {
  const date = `${pad(at.getFullYear(), 4)}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
  if (!withTime) return date;
  return `${date} ${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}`;
}

/** The day an instant falls on, on this server's clock: `YYYY-MM-DD`. */
export function serverDay(ms: number): string {
  return localStamp(new Date(ms), false);
}

/** One instant, spelled the way this column's own values are spelled. */
export function boundValue(column: Pick<ResolvedColumn, 'logicalType'>, ms: number, dialect: Dialect): string {
  const at = new Date(ms);
  // A day is the day on this server's clock, on every engine (see above).
  if (column.logicalType === 'date') return serverDay(ms);
  if (dialect === 'sqlite' || column.logicalType === 'timestamptz') return at.toISOString();
  return localStamp(at, true);
}

export interface CompileConditionContext {
  table: ResolvedTable;
  dialect: Dialect;
  now: number;
}

export function isDateColumn(column: ResolvedColumn): boolean {
  return DATE_TYPES.has(column.logicalType);
}

/**
 * Compile ONE condition to a filter node. Throws {@link ValidationFailedError}
 * for anything the save path should already have refused — an unknown column,
 * a relative operator on a column that is not a date — so a rule that somehow
 * reaches the scanner with a bad condition fails loudly rather than scanning
 * the whole table.
 */
export function toRecordFilter(
  condition: AutomationCondition,
  ctx: CompileConditionContext,
): RecordFilter {
  if ('count' in condition.left) {
    // A related-record count is a second query, not a WHERE clause. The
    // scanner evaluates those per row after the scan has narrowed the set.
    throw new ValidationFailedError('A related-records count cannot be scanned in SQL.', {});
  }
  const name = condition.left.field;
  const column = ctx.table.columns.get(name);
  if (column === undefined) {
    throw new ValidationFailedError(`Unknown column ${JSON.stringify(name)}.`, {
      table: ctx.table.id,
    });
  }

  if (condition.op === 'is_empty') return { column: name, op: 'is_null' };
  if (condition.op === 'not_empty') return { column: name, op: 'not_null' };

  if (isRelativeAutomationOp(condition.op)) {
    if (!isDateColumn(column)) {
      throw new ValidationFailedError(
        `${JSON.stringify(name)} is not a date column, so it has no relative time.`,
        { column: name },
      );
    }
    const operand = condition.right;
    if (typeof operand !== 'object' || operand === null || !('amount' in operand)) {
      throw new ValidationFailedError('A relative condition needs an amount and a unit.', {
        column: name,
      });
    }
    const span = automationDurationMs(operand.amount, operand.unit);
    const at = (ms: number): string => boundValue(column, ms, ctx.dialect);
    switch (condition.op) {
      case 'within_next':
        return { column: name, op: 'between', value: [at(ctx.now), at(ctx.now + span)] };
      case 'within_last':
        return { column: name, op: 'between', value: [at(ctx.now - span), at(ctx.now)] };
      case 'more_than_ago':
        return { column: name, op: 'lt', value: at(ctx.now - span) };
      default:
        return { column: name, op: 'gt', value: at(ctx.now + span) };
    }
  }

  const value = condition.right;
  if (value === undefined) {
    throw new ValidationFailedError('A condition needs a value.', { column: name });
  }
  switch (condition.op) {
    case 'gt':
      return { column: name, op: 'gt', value };
    case 'lt':
      return { column: name, op: 'lt', value };
    case 'contains':
      return { column: name, op: 'ilike', value: `%${escapeLike(String(value))}%` };
    case 'is':
      return column.textish
        ? { column: name, op: 'ilike', value: escapeLike(String(value)) }
        : { column: name, op: 'eq', value };
    default:
      /*
       * `is_not`. Two things are going on:
       *
       * The OR with `is_null` is not a nicety — a NULL is not equal to
       * anything in SQL, so `status <> 'cancelled'` silently drops every row
       * with no status, and a person who writes "status is not cancelled"
       * plainly means to keep them.
       *
       * And it compiles to `<>` even on a text column, where `is` compiles to
       * ILIKE. That asymmetry is deliberate and is the DSL's: there is no
       * `NOT ILIKE` in the grammar, and inventing one here to gain
       * case-insensitivity on the rarer operator is a worse trade than saying
       * plainly that `is not` compares exactly. The guide says so.
       */
      return {
        or: [
          { column: name, op: 'neq', value },
          { column: name, op: 'is_null' },
        ],
      };
  }
}

/** Every condition, ANDed — the shape a for-each scan and a watch filter want. */
export function toRecordFilterAll(
  conditions: readonly AutomationCondition[],
  ctx: CompileConditionContext,
): RecordFilter | null {
  const nodes = conditions.map((condition) => toRecordFilter(condition, ctx));
  if (nodes.length === 0) return null;
  return nodes.length === 1 ? (nodes[0] as RecordFilter) : { and: nodes };
}
