// SPDX-License-Identifier: AGPL-3.0-only
import type { Dialect } from '@adminium/engine';

import type { ResolvedColumn } from './identifiers.js';

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

/** A time with no zone: `2026-09-25 09:15`, `2026-09-25T09:15:00.123456`. */
const WALL_TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(\.\d+)?)?$/;

const pad = (n: number, width = 2): string => String(n).padStart(width, '0');

/** `2026-07-27T23:00:00.000Z` → `2026-07-27 23:00:00.000`: the UTC wall time. */
const utcWallTime = (at: Date): string => at.toISOString().slice(0, 23).replace('T', ' ');

/**
 * An instant as MySQL's `TIMESTAMP` takes one on a UTC session:
 * `2026-07-27 23:00:00.000`. The fraction is copied from the text rather than
 * the Date, so a microsecond a caller sent is not cut to milliseconds — a zone
 * offset is whole minutes and never moves it. Anything else passes through.
 */
function mysqlInstant(value: unknown): unknown {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? value : utcWallTime(value);
  if (typeof value !== 'string') return value;
  const zoned = ZONED_TIMESTAMP.exec(value);
  if (zoned === null) return value;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  const fraction = zoned[2] ?? '';
  return `${utcWallTime(parsed).slice(0, 19)}${fraction}`;
}

/**
 * A time written to a column that KEEPS A ZONE (a `timestamptz`: Postgres's
 * own, MySQL's `TIMESTAMP`), as the instant it names: a zone-less
 * `2026-09-25 11:45` is 11:45 on this server's clock — the clock Adminium
 * reads and writes every zone-less time on — spelled with its zone.
 *
 * Without this the DATABASE chose the zone, after every reader on the way had
 * chosen another: Postgres reads a zone-less literal in its session's zone
 * (which Adminium never sets), MySQL in UTC (which it does), and a formula
 * counting hours, a bound or a slot guard read it on this server's clock — so
 * the hours worked out were not the hours stored. The fraction is copied from
 * the text, so a microsecond is not cut to a millisecond. A time that is no
 * time (a 30 February) passes through, for the database to refuse; so does
 * anything else.
 */
export function zonedWriteValue(column: Pick<ResolvedColumn, 'logicalType'>, value: unknown): unknown {
  if (column.logicalType !== 'timestamptz' || typeof value !== 'string') return value;
  const wall = WALL_TIMESTAMP.exec(value.trim());
  if (wall === null) return value;
  const [, y, mo, d, h, mi, s = '0', fraction = ''] = wall as unknown as string[];
  const at = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
  // A day or an hour that does not exist rolls over in a Date: it is not this one.
  if (Number.isNaN(at.getTime()) || at.getDate() !== Number(d) || at.getMonth() !== Number(mo) - 1 || Number(mi) > 59 || Number(s) > 59) return value;
  return `${at.toISOString().slice(0, 19)}${fraction}Z`;
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

const TRUE_WORDS: ReadonlySet<string> = new Set(['true', 't', 'yes', 'y', 'on', '1']);
const FALSE_WORDS: ReadonlySet<string> = new Set(['false', 'f', 'no', 'n', 'off', '0']);

/**
 * A yes or a no, as a writer spells one: `true`, `on`, `y`, `1`, `' TRUE'` —
 * the words Postgres itself reads as a boolean, whatever the case and the
 * spaces around them — or `null` when the value is no boolean. The one reading
 * the write path has: a value is checked, compared with a rule's `true`, and
 * stored as the same answer on every engine.
 */
export function booleanOf(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (value === 1 || value === 0 || value === 1n || value === 0n) return Number(value) === 1;
  if (typeof value !== 'string') return null;
  const word = value.trim().toLowerCase();
  return TRUE_WORDS.has(word) ? true : FALSE_WORDS.has(word) ? false : null;
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
    return booleanOf(a) !== null && booleanOf(a) === booleanOf(b);
  }
  if (typeof a === 'number' || typeof b === 'number' || typeof a === 'bigint' || typeof b === 'bigint') {
    const [x, y] = [Number(a), Number(b)];
    return Number.isFinite(x) && x === y;
  }
  return String(a) === String(b);
}
