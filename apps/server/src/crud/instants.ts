// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE ONE PLACE A SERVER-SIDE "NOW" IS SPELLED FOR A SOURCE COLUMN.
 *
 * `instantFor` moved here from `public-api/generate.ts`, which had it first
 * and still imports it: the public surface's `{"$generate":"now"}` and a
 * column rule's `now` fill are the same instant written the same way, and two
 * copies of this would drift the day one of them learned about `date`.
 *
 * ── WHY A STRING PER DIALECT, NOT A `Date` ─────────────────────────────────
 *
 * No single JavaScript value writes a timestamp on all three engines. `pg` and
 * `mysql2` serialize a `Date`; `better-sqlite3` refuses one outright ("can
 * only bind numbers, strings, bigints, buffers, and null"). And MySQL's
 * `datetime` rejects the `T` and the `Z` an ISO instant carries. So the value
 * is formatted here, per dialect, and the round trip is tested on all three.
 *
 * ── WHICH CLOCK, AND WHY IT IS NOT ALWAYS UTC ──────────────────────────────
 *
 * A `timestamptz` denotes an instant, so it is UTC — the same instant Postgres
 * and SQLite are holding, or the same row would mean two times.
 *
 * A naive `timestamp`, a `date` and a `time` carry NO zone, so "now" in one of
 * them can only mean the wall clock of whoever wrote it. That is the SERVER's
 * clock, which is already the zone `crud/write-values.ts` encodes a naive
 * timestamp into on every ordinary write — read → echo → write is the identity
 * there precisely because the zone that decoded the wire value is this same
 * process's. Filling one in UTC instead would put a row written at 22:00 in
 * UTC−5 on tomorrow's date, in a column whose whole point is the local day.
 */

import type { Dialect, LogicalType } from '@adminium/engine';

/**
 * The instant, in the form THIS dialect's `timestamptz` column accepts.
 *
 * Exported for the round-trip tests, which is the only way to prove the mysql
 * branch without a mysql server in the loop for every case.
 */
export function instantFor(dialect: Dialect, now: Date): string {
  const iso = now.toISOString();
  // `2026-09-06T12:34:56.789Z` → `2026-09-06 12:34:56.789`, still UTC.
  return dialect === 'mysql' ? iso.slice(0, 23).replace('T', ' ') : iso;
}

const pad = (n: number, width = 2): string => String(n).padStart(width, '0');

/** `YYYY-MM-DD` in the server's own zone. */
export function localDate(now: Date): string {
  return `${pad(now.getFullYear(), 4)}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** `HH:MM:SS` in the server's own zone. */
export function localTime(now: Date): string {
  return `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

/**
 * The server's wall clock, spelled the way `write-values.ts` spells a naive
 * timestamp on the ordinary write path — milliseconds only when there are
 * any, so a filled value and an echoed one are the same bytes.
 */
export function localTimestamp(now: Date): string {
  const ms = now.getMilliseconds();
  return `${localDate(now)} ${localTime(now)}${ms === 0 ? '' : `.${pad(ms, 3)}`}`;
}

/** The column types a `now` fill is legal on. */
export const NOW_TYPES: readonly LogicalType[] = ['date', 'time', 'timestamp', 'timestamptz'];

export function isNowType(logicalType: LogicalType): boolean {
  return NOW_TYPES.includes(logicalType);
}

/**
 * "Now" for one column, or `null` when the column cannot hold one.
 *
 * `null` is not an error path anybody should reach: a fill is only ever built
 * for a column whose type {@link isNowType} accepts. It is the answer that
 * writes nothing rather than the answer that writes an ISO string into a
 * `varchar` somebody happened to call `created`.
 */
export function renderNow(
  column: { readonly logicalType: LogicalType },
  dialect: Dialect,
  now: Date,
): string | null {
  switch (column.logicalType) {
    case 'timestamptz':
      return instantFor(dialect, now);
    case 'timestamp':
      return localTimestamp(now);
    case 'date':
      return localDate(now);
    case 'time':
      return localTime(now);
    default:
      return null;
  }
}
