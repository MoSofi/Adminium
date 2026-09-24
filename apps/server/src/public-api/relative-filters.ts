// SPDX-License-Identifier: AGPL-3.0-only
/**
 * FILTERS ON THE VENUE'S CALENDAR — `today` and `from-today` — worked out on
 * every request, never when the scope compiles.
 *
 * A compiled scope is cached for half a minute, so a date written into it at
 * compile time would still be yesterday's for up to thirty seconds after
 * midnight, and a condition with no value refuses to compile at all. So the
 * compiled resource keeps these conditions as they were written, and each
 * request turns them into plain bounds on the venue's own clock:
 *
 *  - `today`: from the start of today to the start of tomorrow;
 *  - `from-today`: from the start of today on — for `days` days when given.
 *
 * A bound is spelled the way the column keeps a value: a date as the day, a
 * time as the instant the day starts where the venue is (and, in a column
 * with no zone, as the server's wall clock, which is how such a column is
 * written). A column that is not a date or a time — the schema moved since the
 * endpoint was saved — matches nothing: a filter that cannot be worked out
 * never widens a read.
 */
import type { LogicalType } from '@adminium/engine';

import type { RecordFilter } from '../crud/filters.js';
import type { ResolvedTable } from '../crud/identifiers.js';
import { venueClock, wallTimeToInstant } from '../crud/venue-time.js';
import { normalizeWriteValue } from '../crud/write-values.js';

export const RELATIVE_FILTER_OPS = ['today', 'from-today'] as const;
export type RelativeOp = (typeof RELATIVE_FILTER_OPS)[number];

export interface RelativeCondition {
  column: string;
  op: RelativeOp;
  /** `from-today` only: how many days, today included. */
  days?: number;
}

/** A resource's mandatory filter as compiled: fixed conditions, and the ones the calendar decides. */
export interface ScopeWhere {
  fixed: RecordFilter | null;
  relative: readonly RelativeCondition[];
}

/** The column types a calendar filter applies to. */
export const DAY_TYPES: ReadonlySet<LogicalType> = new Set(['date', 'timestamp', 'timestamptz']);

export function isRelativeOp(op: string): op is RelativeOp {
  return (RELATIVE_FILTER_OPS as readonly string[]).includes(op);
}

/** The day `n` days after a `YYYY-MM-DD`. */
function plusDays(day: string, n: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + n);
  return date.toISOString().slice(0, 10);
}

/** A row the table cannot hold: its key is never empty. */
function nothing(table: ResolvedTable): RecordFilter {
  return { column: table.primaryKey[0] ?? '', op: 'is_null' };
}

/** The mandatory filter as of `now`, in the venue's zone; null when there is none. */
export function mandatoryAt(where: ScopeWhere, table: ResolvedTable, timezone: string, now: Date = new Date()): RecordFilter | null {
  if (where.relative.length === 0) return where.fixed;
  const today = venueClock(now, timezone).day;
  const conditions: RecordFilter[] = where.fixed === null ? [] : [where.fixed];
  for (const condition of where.relative) {
    const column = table.columns.get(condition.column);
    if (column === undefined || !DAY_TYPES.has(column.logicalType)) {
      conditions.push(nothing(table));
      continue;
    }
    const bound = (day: string): unknown => {
      if (column.logicalType === 'date') return day;
      const start = wallTimeToInstant(`${day} 00:00`, timezone);
      return start === null ? null : normalizeWriteValue(column, start.toISOString());
    };
    const end = condition.op === 'today' ? plusDays(today, 1) : condition.days === undefined ? null : plusDays(today, condition.days);
    const from = bound(today);
    const to = end === null ? undefined : bound(end);
    if (from === null || to === null) {
      conditions.push(nothing(table));
      continue;
    }
    conditions.push({ column: condition.column, op: 'gte', value: from });
    if (to !== undefined) conditions.push({ column: condition.column, op: 'lt', value: to });
  }
  return conditions.length === 1 ? (conditions[0] as RecordFilter) : { and: conditions };
}

/**
 * "Still ahead": a time after now, spelled as the column keeps one — the
 * state `writable_when: {column: 'from-now'}` asks a row to be in.
 */
export function afterNow(table: ResolvedTable, column: string, now: Date = new Date()): RecordFilter {
  const found = table.columns.get(column);
  if (found === undefined || (found.logicalType !== 'timestamp' && found.logicalType !== 'timestamptz')) return nothing(table);
  return { column, op: 'gt', value: normalizeWriteValue(found, now.toISOString()) };
}
