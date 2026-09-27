// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A boundary (a window's start or end, a venue day's midnight) spelled as a
 * column keeps a value, for every engine. Shared by the widget compiler and
 * the link filters, which both compare columns with instants and days.
 */
import type { Dialect } from '@adminium/engine';

import type { ResolvedColumn } from '../crud/identifiers.js';
import { venueClock } from '../crud/venue-time.js';
import { normalizeWriteValue } from '../crud/write-values.js';

/**
 * A window boundary as the source driver expects it for a column that keeps
 * an instant: Postgres binds the `Date` directly (timestamptz), but MySQL and
 * SQLite take a UTC `'YYYY-MM-DD HH:MM:SS'` string — a MySQL `TIMESTAMP` is
 * read on a UTC session, and better-sqlite3 refuses to bind a `Date` at all
 * (it accepts only numbers, strings, bigints, buffers and null).
 */
export function windowBoundValue(date: Date, dialect: Dialect): Date | string {
  if (dialect === 'mysql' || dialect === 'sqlite') {
    return date.toISOString().slice(0, 19).replace('T', ' ');
  }
  return date;
}

/**
 * A boundary instant spelled as the column keeps a time: a zone-less timestamp
 * takes this server's wall clock (what every write to it stores,
 * `crud/write-values.ts`), and a zoned one the instant. UTC's wall clock in a
 * zone-less column moved a rolling window by this server's offset on MySQL
 * and SQLite: "the last hour" at 23:00 UTC in Berlin counted 22:00–23:00 on
 * a clock that read 01:00.
 */
export function instantBoundValue(column: ResolvedColumn, instant: Date, dialect: Dialect): unknown {
  if (column.logicalType === 'timestamp') return normalizeWriteValue(column, instant.toISOString());
  return windowBoundValue(instant, dialect);
}

/**
 * A calendar boundary spelled as the column keeps a value: a date column takes
 * the venue's day, and a time column the instant as {@link instantBoundValue}
 * spells it.
 */
export function calendarBoundValue(column: ResolvedColumn, instant: Date, dialect: Dialect, timezone: string): unknown {
  if (column.logicalType === 'date') return venueClock(instant, timezone).day;
  return instantBoundValue(column, instant, dialect);
}
