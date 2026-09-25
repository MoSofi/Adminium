// SPDX-License-Identifier: AGPL-3.0-only
import type { Dialect } from '@adminium/engine';

import type { ResolvedColumn } from './identifiers.js';
import { instantFor } from './instants.js';

/**
 * Write-side value normalization for the JSON data routes (create / update /
 * bulk-update) — the inverse of the read side's driver behavior.
 *
 * Naive `timestamp` columns carry no zone, but the pg (and mysql) drivers
 * parse their wall clock at SERVER-LOCAL time on read, so the JSON wire
 * serializes them as UTC instants: `2026-05-28 22:00:00` on a UTC+2 host
 * reads as `'2026-05-28T20:00:00.000Z'`. Postgres drops the zone suffix when
 * casting a zoned literal into `timestamp`, so echoing the wire value back —
 * which the generated edit form does verbatim for untouched fields — stored
 * the UTC wall clock instead: a drift of exactly the server offset on every
 * save (live repro 2026-08-24: 22:00 → 20:00 → 18:00 on Europe/Berlin).
 *
 * Converting zoned input back to the server-local wall clock makes
 * read → echo → write the identity, because the zone that encoded the wire
 * value is this same process's. Naive literals pass through byte-identical
 * (microseconds included), so callers writing `2026-05-28 22:00:00` keep
 * exact-literal semantics. `timestamptz` is untouched — zoned instants are
 * already lossless there, and the guards between here and the statement read
 * them as instants — and `date` is normalized client-side (the form sends
 * plain `YYYY-MM-DD`; a raw API caller's zoned literal keeps the database's
 * own cast semantics). How MySQL takes an instant is {@link bindWriteValue}'s
 * business, at the moment it is bound.
 */

const ZONED_TIMESTAMP =
  /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/i;

const pad = (n: number, width = 2): string => String(n).padStart(width, '0');

/**
 * An instant as MySQL's `TIMESTAMP` takes one on a UTC session:
 * `2026-07-27 23:00:00.000`. The fraction is copied from the text rather than
 * the Date, so a microsecond a caller sent is not cut to milliseconds — a zone
 * offset is whole minutes and never moves it. Anything else passes through.
 */
function mysqlInstant(value: unknown): unknown {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? value : instantFor('mysql', value);
  if (typeof value !== 'string') return value;
  const zoned = ZONED_TIMESTAMP.exec(value);
  if (zoned === null) return value;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  const fraction = zoned[2] ?? '';
  return `${instantFor('mysql', parsed).slice(0, 19)}${fraction}`;
}

/**
 * A value as the statement binds it for this column: {@link normalizeWriteValue},
 * and on MySQL an instant for a `timestamptz` column (a `TIMESTAMP` there)
 * spelled as its UTC wall time.
 *
 * MySQL's `TIMESTAMP` refuses the `T` and the `Z` of an ISO instant outright
 * under strict mode — every API write of one failed — and reads any zone-less
 * spelling in the SESSION's zone. The adapter pins every data connection's
 * session to UTC, so the UTC wall time is the instant, whatever zone the
 * database server or this process runs in. A Date is spelled here too: the
 * driver would write it in this process's zone. Postgres and SQLite take the
 * zoned instant as it is.
 *
 * Only where a value meets the database: a guard on the way reads a
 * zone-less time as this server's wall clock, which a UTC one is not.
 */
export function bindWriteValue(column: ResolvedColumn, value: unknown, dialect: Dialect): unknown {
  if (column.logicalType === 'timestamptz') return dialect === 'mysql' ? mysqlInstant(value) : value;
  return normalizeWriteValue(column, value);
}

export function normalizeWriteValue(column: ResolvedColumn, value: unknown): unknown {
  if (column.logicalType !== 'timestamp') return value;
  if (typeof value !== 'string' || !ZONED_TIMESTAMP.test(value)) return value;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  const ms = parsed.getMilliseconds();
  return (
    `${pad(parsed.getFullYear(), 4)}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}` +
    ` ${pad(parsed.getHours())}:${pad(parsed.getMinutes())}:${pad(parsed.getSeconds())}` +
    (ms === 0 ? '' : `.${pad(ms, 3)}`)
  );
}

/** JSON with its keys sorted: one spelling for one value. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

/** A JSON value from what a driver or a writer hands over: parsed text (SQLite keeps JSON as text), or the value itself. */
function jsonOf(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/**
 * A Date and another spelling of the same day or moment: a `date` column
 * comes back from Postgres and MySQL as the server's local midnight, which a
 * form sends back as `YYYY-MM-DD` or as the instant's ISO text.
 */
function sameMoment(date: Date, other: unknown): boolean {
  if (other instanceof Date) return date.getTime() === other.getTime();
  const text = String(other).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return `${String(date.getFullYear())}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}` === text;
  const at = new Date(/^\d{4}-\d{2}-\d{2} \d/.test(text) ? text.replace(' ', 'T') : text).getTime();
  return !Number.isNaN(at) && at === date.getTime();
}

/**
 * Whether a value in a column and a value a rule names are the same answer.
 * A boolean comes back from MySQL and SQLite as 1 or 0, and a number from a
 * form as a string; a JSON value as an object, or as text on SQLite, compared
 * by what it holds; a date or a moment as a Date, compared as that day or
 * that instant.
 */
export function sameValue(a: unknown, b: unknown): boolean {
  if (a === null || a === undefined || b === null || b === undefined) return (a ?? null) === (b ?? null);
  if (a instanceof Date) return sameMoment(a, b);
  if (b instanceof Date) return sameMoment(b, a);
  if ((typeof a === 'object' && !(a instanceof Uint8Array)) || (typeof b === 'object' && !(b instanceof Uint8Array))) {
    return canonicalJson(jsonOf(a)) === canonicalJson(jsonOf(b));
  }
  if (typeof a === 'boolean' || typeof b === 'boolean') {
    const truth = (v: unknown) => (['true', 't', '1', 'yes'].includes(String(v).toLowerCase()) ? true : ['false', 'f', '0', 'no'].includes(String(v).toLowerCase()) ? false : null);
    return truth(a) !== null && truth(a) === truth(b);
  }
  if (typeof a === 'number' || typeof b === 'number' || typeof a === 'bigint' || typeof b === 'bigint') {
    const [x, y] = [Number(a), Number(b)];
    return Number.isFinite(x) && x === y;
  }
  return String(a) === String(b);
}
