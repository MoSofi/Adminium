// SPDX-License-Identifier: AGPL-3.0-only
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
 * already lossless there — and `date` is normalized client-side (the form
 * sends plain `YYYY-MM-DD`; a raw API caller's zoned literal keeps the
 * database's own cast semantics).
 */

const ZONED_TIMESTAMP =
  /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/i;

const pad = (n: number, width = 2): string => String(n).padStart(width, '0');

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
