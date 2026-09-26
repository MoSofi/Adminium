// SPDX-License-Identifier: AGPL-3.0-only
/**
 * How every Adminium connection to MySQL/MariaDB spells time: a session in UTC,
 * `TIMESTAMP` values read back as UTC, and a `DATE` as its `YYYY-MM-DD` text.
 *
 * A `TIMESTAMP` column holds an instant but speaks the SESSION's zone: every
 * value read comes back as wall time there, and every zone-less value written
 * or compared is taken as wall time there. With the server's default zone
 * left in place (often SYSTEM, the host's), an instant Adminium wrote was
 * stored hours early, a "still ahead" check answered against the wrong hour,
 * and a value read back was off by the server's offset less this process's.
 *
 * Pinned to UTC, a `TIMESTAMP` means the same instant whatever zone the
 * database host, the server default or this process runs in. The server binds
 * instants for those columns as UTC wall time (`bindWriteValue` in
 * `apps/server/src/crud/write-values.ts`), and they are read back here as UTC.
 *
 * `DATETIME` is left alone: it carries no zone, and Adminium keeps its own
 * convention there — the wall clock of the server process, which is how the
 * driver reads and writes one by default. Setting the driver's `timezone`
 * option would have moved `DATETIME` with it, which is why this is a
 * `typeCast` that looks only at `TIMESTAMP`.
 */

/** Run on every new connection, before it serves a query. Accepted by MySQL and MariaDB alike. */
export const UTC_SESSION_SQL = "SET time_zone = '+00:00'";

/** The part of mysql2's typeCast field this reads. */
export interface TypeCastField {
  readonly type: string;
  string(encoding?: string): string | null;
}

/**
 * mysql2 `typeCast`: a `TIMESTAMP` value as the instant it names on a UTC
 * session, and a `DATE` as the `YYYY-MM-DD` text MySQL sends; every other
 * type as the driver would have read it. A zero date
 * (`0000-00-00 00:00:00`) comes back as an invalid Date, as the driver's
 * own reading gives it.
 *
 * A `DATE` is a calendar day with no clock. The driver made it a Date at this
 * process's local midnight, so its ISO spelling named the day before on a
 * server east of UTC (`2026-08-14` read as `2026-08-13T22:00:00.000Z` in
 * Berlin). As text it reads the same on every server and every engine: SQLite
 * and Postgres hand a date back the same way. `DATETIME` and `TIMESTAMP` are
 * not dates and keep their readings.
 */
export function readTimestampsAsUtc(field: TypeCastField, next: () => unknown): unknown {
  if (field.type === 'DATE' || field.type === 'NEWDATE') return field.string();
  if (field.type !== 'TIMESTAMP' && field.type !== 'TIMESTAMP2') return next();
  const text = field.string();
  if (text === null) return null;
  return new Date(`${text.replace(' ', 'T')}Z`);
}
