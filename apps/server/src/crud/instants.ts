// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE ONE PLACE A SERVER-SIDE "NOW" IS SPELLED FOR A SOURCE COLUMN.
 *
 * `instantFor` moved here from `public-api/generate.ts`, which had it first
 * and still imports it: the public surface's `{"$generate":"now"}` and a
 * column rule's `now` fill are the same instant written the same way, and two
 * copies of this would drift the day one of them learned about `date`.
 *
 * ── WHY A STRING, NOT A `Date`, AND THE SAME ONE ON EVERY ENGINE ──────────
 *
 * No single JavaScript value writes a timestamp on all three engines. `pg` and
 * `mysql2` serialize a `Date`; `better-sqlite3` refuses one outright ("can
 * only bind numbers, strings, bigints, buffers, and null"). So the value is
 * text, and the round trip is tested on all three.
 *
 * A `timestamptz` is given the ISO instant, zone and all, on every engine, and
 * keeps it for as long as the write is in progress: a stamp, a formula
 * counting hours, a bound and a slot guard all read the moment the text
 * names. MySQL's `TIMESTAMP` refuses the `T` and the `Z`, so its UTC wall time
 * is spelled only where the value meets the statement (`bindWriteValue` in
 * `write-values.ts`). It used to be spelled here, without a zone, and every
 * reader on the way took UTC's wall clock for this server's: a shift stopped
 * by a stamp an hour after it started counted 0.00 hours in London.
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
 * The instant a `timestamptz` column is written with while the write is in
 * progress: the ISO text, with its zone, on every engine (see the header).
 */
export function instantFor(now: Date): string {
  return now.toISOString();
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
export function renderNow(column: { readonly logicalType: LogicalType }, now: Date): string | null {
  switch (column.logicalType) {
    case 'timestamptz':
      return instantFor(now);
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

/** A wall time as SQLite hands one back: `2026-09-24 19:00:00`, maybe with milliseconds. */
const WALL = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3})\d*)?)?$/;

/**
 * A row read from a SQLite source for somebody who is not this server — the
 * public API's caller, a browser anywhere — with each naive timestamp spelled
 * as the instant it denotes.
 *
 * SQLite has no zone, and what Adminium keeps in its timestamp columns is the
 * SERVER's wall clock (the header). A caller in another zone reading
 * `2026-09-25 01:00:00` has no way to know which instant that is, and reads it
 * as their own: a 7 PM booking in New York, served from Berlin, came back to a
 * guest as noon. Postgres and MySQL already answer with instants.
 */
export function wallTimesAsInstants<T extends Record<string, unknown>>(
  row: T,
  columns: ReadonlyMap<string, { readonly logicalType: LogicalType }>,
  dialect: Dialect,
): T {
  if (dialect !== 'sqlite') return row;
  let out: Record<string, unknown> | null = null;
  for (const [name, value] of Object.entries(row)) {
    if (typeof value !== 'string' || columns.get(name)?.logicalType !== 'timestamp') continue;
    const m = WALL.exec(value);
    if (m === null) continue;
    const at = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6] ?? 0), Number((m[7] ?? '0').padEnd(3, '0')));
    if (Number.isNaN(at.getTime())) continue;
    out ??= { ...row };
    out[name] = at.toISOString();
  }
  return (out ?? row) as T;
}
