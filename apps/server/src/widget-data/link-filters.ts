// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A LINK THAT OPENS A LIST FILTERED — `/p/<page>?f.<column>=<op>:<value>`.
 *
 * A metric card says "Overdue: $3,120" and leads to the invoices page; the page
 * must open on the overdue invoices, not all of them, and SAY that it did. The
 * link carries the filter as text; this turns that text into a plain filter
 * tree of the list grammar (`crud/filters.ts`), worked out against the table
 * as it is now, on the venue's calendar, and hands back what it did with each
 * piece so the page can show a chip for every one:
 *
 *   eq:<v>  neq:<v>  in:<a,b>              the value, or one of the values
 *   gt: gte: lt: lte:<n | day | today>     a number, a day, or the venue's today
 *   before:today  after:today               a day or a time, before or after today
 *   month:this  month:last                  a day or a time in this or last month
 *   set  unset                              has a value, or has none
 *
 * A day on a TIME column is the whole day where the venue is: `after:today`
 * starts at tomorrow's midnight there, `lte:2026-09-25` ends at the next one.
 *
 * WHAT IT NEVER DOES. It never builds SQL: the result is conditions of the list
 * grammar, whose every value binds as a parameter. It never widens a list
 * quietly and never fails the page: a piece naming a column the table does not
 * have, a column this reader may not see, an operator the column cannot take
 * or a value it cannot hold is LEFT OUT and reported as left out — the page
 * says so on the chip. Every value is checked against the column's type here,
 * because an engine that is handed "abc" for a number fails the whole read.
 */
import type { Dialect } from '@adminium/engine';

import type { FilterCondition, RecordFilter } from '../crud/filters.js';
import type { ResolvedColumn, ResolvedTable } from '../crud/identifiers.js';
import { venueClock, wallTimeToInstant } from '../crud/venue-time.js';
import { calendarBoundValue } from './compiler.js';

/** How many pieces one link may carry; the rest are left out, and said to be. */
export const LINK_FILTERS_MAX = 8;
/** How many values one `in:` may list. */
export const LINK_IN_VALUES_MAX = 50;
/** The longest single value a piece may carry. */
const VALUE_MAX = 200;

export const LINK_OPS = ['eq', 'neq', 'in', 'gt', 'gte', 'lt', 'lte', 'before', 'after', 'month', 'set', 'unset'] as const;
export type LinkOp = (typeof LINK_OPS)[number];

/** Why a piece was left out. */
export type LinkIgnoredReason =
  /** The table has no such column (or it is a secret one, which reads as none). */
  | 'unknown-column'
  /** A column masked for this reader: filtering on it would reveal what it hides. */
  | 'masked-column'
  /** Not `<op>` or `<op>:<value>` of a known operator. */
  | 'unknown-operator'
  /** An operator this column's type cannot take (`gt` on a yes/no). */
  | 'wrong-operator'
  /** A value the column cannot hold (`gt:abc` on a number, `month:next`). */
  | 'bad-value'
  /** Past the first {@link LINK_FILTERS_MAX} pieces. */
  | 'too-many';

export interface LinkFilterPiece {
  column: string;
  /** What the link said, after `f.<column>=`. */
  raw: string;
}

export type LinkFilterOutcome =
  | { column: string; raw: string; status: 'applied'; op: LinkOp; value: string | null }
  | { column: string; raw: string; status: 'ignored'; reason: LinkIgnoredReason };

export interface LinkFilterResolution {
  /** The pieces that apply, as one filter tree; null when none does. */
  where: RecordFilter | null;
  /** One entry per piece, in the link's order. */
  filters: LinkFilterOutcome[];
}

export interface ResolveLinkFiltersOptions {
  pieces: readonly LinkFilterPiece[];
  table: ResolvedTable;
  canReadPii: boolean;
  dialect: Dialect;
  /** The venue's zone: where today starts. */
  timezone: string;
  now: Date;
}

const NUMBER_TYPES = new Set(['integer', 'bigint', 'decimal', 'float']);
const TEXT_TYPES = new Set(['text', 'varchar', 'enum', 'uuid', 'inet']);
const TIME_TYPES = new Set(['timestamp', 'timestamptz']);
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const NUMBER = /^-?\d{1,30}(\.\d{1,30})?$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The value side of a comparison: which column kinds may be ordered. */
type Kind = 'number' | 'text' | 'boolean' | 'date' | 'time' | 'other';

function kindOf(column: ResolvedColumn): Kind {
  if (NUMBER_TYPES.has(column.logicalType)) return 'number';
  if (TEXT_TYPES.has(column.logicalType)) return 'text';
  if (column.logicalType === 'boolean') return 'boolean';
  if (column.logicalType === 'date') return 'date';
  if (TIME_TYPES.has(column.logicalType)) return 'time';
  return 'other';
}

/** The day `n` days after a `YYYY-MM-DD`. */
function plusDays(day: string, n: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + n);
  return date.toISOString().slice(0, 10);
}

/** The first day of the month `n` months after the one `day` is in. */
function monthStart(day: string, n: number): string {
  const date = new Date(`${day.slice(0, 7)}-01T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + n);
  return date.toISOString().slice(0, 10);
}

/** A real calendar day (`2026-02-30` is not one). */
function isDay(text: string): boolean {
  const match = DAY.exec(text);
  if (match === null) return false;
  const date = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text;
}

class Refused extends Error {
  constructor(readonly reason: LinkIgnoredReason) {
    super(reason);
  }
}

/** Work out the pieces of one link against one table, as of `now` where the venue is. */
export function resolveLinkFilters(options: ResolveLinkFiltersOptions): LinkFilterResolution {
  const { pieces, table, canReadPii, dialect, timezone, now } = options;
  const today = venueClock(now, timezone).day;
  const conditions: FilterCondition[] = [];
  const filters: LinkFilterOutcome[] = [];

  pieces.forEach((piece, index) => {
    const ignore = (reason: LinkIgnoredReason) => filters.push({ column: piece.column, raw: piece.raw, status: 'ignored', reason });
    if (index >= LINK_FILTERS_MAX) return ignore('too-many');
    const column = table.columns.get(piece.column);
    if (column === undefined || column.secret) return ignore('unknown-column');
    if (column.masked && !canReadPii) return ignore('masked-column');
    try {
      const parsed = parsePiece(piece.raw);
      conditions.push(...conditionsFor(column, parsed.op, parsed.value, { today, dialect, timezone }));
      filters.push({ column: piece.column, raw: piece.raw, status: 'applied', op: parsed.op, value: parsed.value });
    } catch (error) {
      if (error instanceof Refused) return ignore(error.reason);
      throw error;
    }
    return undefined;
  });

  return {
    where: conditions.length === 0 ? null : conditions.length === 1 ? (conditions[0] as FilterCondition) : { and: conditions },
    filters,
  };
}

/** `<op>` or `<op>:<value>` — the value may itself hold colons (a time). */
function parsePiece(raw: string): { op: LinkOp; value: string | null } {
  const at = raw.indexOf(':');
  const op = (at === -1 ? raw : raw.slice(0, at)).trim().toLowerCase();
  const value = at === -1 ? null : raw.slice(at + 1).trim();
  if (!(LINK_OPS as readonly string[]).includes(op)) throw new Refused('unknown-operator');
  if (value !== null && value.length > VALUE_MAX) throw new Refused('bad-value');
  const needsNone = op === 'set' || op === 'unset';
  if (needsNone ? value !== null && value !== '' : value === null || value === '') throw new Refused('bad-value');
  return { op: op as LinkOp, value: needsNone ? null : value };
}

interface Clock {
  today: string;
  dialect: Dialect;
  timezone: string;
}

/** The list-grammar conditions one piece stands for, or a refusal. */
function conditionsFor(column: ResolvedColumn, op: LinkOp, value: string | null, clock: Clock): FilterCondition[] {
  const kind = kindOf(column);
  const name = column.name;
  if (op === 'set') return [{ column: name, op: 'not_null' }];
  if (op === 'unset') return [{ column: name, op: 'is_null' }];

  if (op === 'before' || op === 'after' || op === 'month') {
    if (kind !== 'date' && kind !== 'time') throw new Refused('wrong-operator');
    if (op === 'month') {
      const shift = value === 'this' ? 0 : value === 'last' ? -1 : null;
      if (shift === null) throw new Refused('bad-value');
      return dayRange(column, monthStart(clock.today, shift), monthStart(clock.today, shift + 1), clock);
    }
    if (value !== 'today') throw new Refused('bad-value');
    return op === 'before' ? dayCompare(column, 'lt', clock.today, clock) : dayCompare(column, 'gt', clock.today, clock);
  }

  if (kind === 'date' || kind === 'time') {
    if (op === 'in') {
      if (kind === 'time') throw new Refused('wrong-operator');
      return [{ column: name, op: 'in', value: listOf(value).map((item) => dayOf(item, clock)) }];
    }
    const day = dayOf(value as string, clock);
    if (op === 'eq') return dayRange(column, day, plusDays(day, 1), clock);
    if (op === 'neq') {
      // A day on a time column is a span, so "not that day" is either side of it.
      if (kind === 'date') return [{ column: name, op: 'neq', value: day }];
      throw new Refused('wrong-operator');
    }
    return dayCompare(column, op, day, clock);
  }

  if (kind === 'number') {
    if (op === 'in') return [{ column: name, op: 'in', value: listOf(value).map(numberOf) }];
    return [{ column: name, op, value: numberOf(value as string) }];
  }
  if (kind === 'boolean') {
    if (op !== 'eq' && op !== 'neq') throw new Refused('wrong-operator');
    return [{ column: name, op, value: booleanOf(value as string) }];
  }
  if (kind === 'text') {
    // Text has no order a person means by "more than", so only equality.
    if (op === 'in') return [{ column: name, op: 'in', value: listOf(value).map((item) => textOf(column, item)) }];
    if (op !== 'eq' && op !== 'neq') throw new Refused('wrong-operator');
    return [{ column: name, op, value: textOf(column, value as string) }];
  }
  throw new Refused('wrong-operator');
}

/** `a,b,c`, each trimmed, none empty, at most {@link LINK_IN_VALUES_MAX}. */
function listOf(value: string | null): string[] {
  const items = (value ?? '').split(',').map((item) => item.trim());
  if (items.length === 0 || items.length > LINK_IN_VALUES_MAX || items.some((item) => item === '')) throw new Refused('bad-value');
  return items;
}

function numberOf(text: string): number | string {
  if (!NUMBER.test(text)) throw new Refused('bad-value');
  const number = Number(text);
  // A whole number past what a double holds exactly keeps its digits as text.
  return Number.isSafeInteger(number) || !/^-?\d+$/.test(text) ? number : text;
}

function booleanOf(text: string): boolean {
  const lower = text.toLowerCase();
  if (lower === 'true' || lower === '1' || lower === 'yes') return true;
  if (lower === 'false' || lower === '0' || lower === 'no') return false;
  throw new Refused('bad-value');
}

function textOf(column: ResolvedColumn, text: string): string {
  // An engine with a real uuid type refuses anything else — for the whole read.
  if (column.logicalType === 'uuid' && !UUID.test(text)) throw new Refused('bad-value');
  return text;
}

/** A day the link names: `today` on the venue's calendar, or a real `YYYY-MM-DD`. */
function dayOf(text: string, clock: Clock): string {
  if (text === 'today') return clock.today;
  if (!isDay(text)) throw new Refused('bad-value');
  return text;
}

/** The instant a venue day starts, spelled as the column keeps a value. */
function dayStart(column: ResolvedColumn, day: string, clock: Clock): unknown {
  if (column.logicalType === 'date') return day;
  const instant = wallTimeToInstant(`${day} 00:00`, clock.timezone);
  if (instant === null) throw new Refused('bad-value');
  return calendarBoundValue(column, instant, clock.dialect, clock.timezone);
}

/** From the start of `from` up to (not including) the start of `until`. */
function dayRange(column: ResolvedColumn, from: string, until: string, clock: Clock): FilterCondition[] {
  return [
    { column: column.name, op: 'gte', value: dayStart(column, from, clock) },
    { column: column.name, op: 'lt', value: dayStart(column, until, clock) },
  ];
}

/**
 * A comparison with a whole day. On a date column it is the plain comparison;
 * on a time column the day is its span where the venue is, so "after the 25th"
 * starts at the 26th's midnight and "up to the 25th" ends there.
 */
function dayCompare(column: ResolvedColumn, op: 'gt' | 'gte' | 'lt' | 'lte', day: string, clock: Clock): FilterCondition[] {
  if (column.logicalType === 'date') return [{ column: column.name, op, value: day }];
  switch (op) {
    case 'gt':
      return [{ column: column.name, op: 'gte', value: dayStart(column, plusDays(day, 1), clock) }];
    case 'gte':
      return [{ column: column.name, op: 'gte', value: dayStart(column, day, clock) }];
    case 'lt':
      return [{ column: column.name, op: 'lt', value: dayStart(column, day, clock) }];
    case 'lte':
      return [{ column: column.name, op: 'lt', value: dayStart(column, plusDays(day, 1), clock) }];
  }
}
