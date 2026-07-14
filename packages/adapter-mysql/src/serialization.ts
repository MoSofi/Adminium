/**
 * Identifier quoting + per-LogicalType value serialization for the MySQL
 * data connection — 05-introspection-engine.md §3 (`QueryEngine`) and
 * 08-server-api.md §3.7. Pure module (no `mysql2`/`kysely` import) so the
 * policy is unit-testable offline. Mirrors the postgres reference adapter.
 *
 * Serialization policy (05 §3 `TypeSerializer` contract):
 * - `bigint` and `decimal` travel as STRINGS end to end — unsigned bigint
 *   exceeds Number.MAX_SAFE_INTEGER and JS numbers would silently lose
 *   precision (05 §4.2 flags this in QueryResult column meta).
 * - `timestamp` (datetime) and `timestamptz` (timestamp) serialize to
 *   ISO-8601 UTC; `date` keeps its SQL text form (`YYYY-MM-DD`).
 * - `boolean` maps tinyint(1)'s 0/1 wire form to real booleans.
 * - `json` values pass through as parsed objects (mysql2 parses the JSON
 *   type); `toDb` stringifies so a single parameter binds.
 * - BINARY POLICY: `binary` columns are EXCLUDED from CRUD v1 — no
 *   serializer is registered for `'binary'` (same as postgres bytea).
 */
import type { LogicalType, TypeSerializer } from '@adminium/engine/adapter';

/** MySQL truncates identifiers at 64 characters. */
export const MYSQL_MAX_IDENTIFIER_LENGTH = 64;

/**
 * Backtick-quote an identifier, escaping embedded backticks. Identifiers are
 * snapshot-validated before they ever reach this point (no raw SQL escape
 * hatch — 05 §3); quoting is defense in depth, not sanitization.
 */
export function quoteIdentifier(identifier: string): string {
  return `\`${identifier.replaceAll('`', '``')}\``;
}

function toIsoUtc(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  return value;
}

/** `YYYY-MM-DD` from a driver-parsed Date (local calendar date, not UTC). */
function toIsoDate(value: unknown): unknown {
  if (value instanceof Date) {
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${value.getFullYear()}-${month}-${day}`;
  }
  return value;
}

function numericToDb(value: unknown): unknown {
  if (typeof value === 'bigint' || typeof value === 'number') return value.toString();
  return value;
}

const lossless: TypeSerializer = {
  toDb: numericToDb,
  fromDb: (value) => {
    if (typeof value === 'number' || typeof value === 'bigint') return value.toString();
    return value;
  },
};

/** Per-LogicalType converters handed to the CRUD layer via `QueryEngine`. */
export const mysqlSerializers: Partial<Record<LogicalType, TypeSerializer>> = {
  bigint: lossless,
  decimal: lossless,
  boolean: {
    toDb: (value) => (typeof value === 'boolean' ? (value ? 1 : 0) : value),
    fromDb: (value) => {
      if (value === 1 || value === 0) return value === 1;
      return value;
    },
  },
  timestamp: { toDb: (value) => value, fromDb: toIsoUtc },
  timestamptz: { toDb: (value) => value, fromDb: toIsoUtc },
  date: { toDb: (value) => value, fromDb: toIsoDate },
  json: {
    toDb: (value) => (typeof value === 'string' ? value : JSON.stringify(value)),
    fromDb: (value) => value,
  },
  // NOTE: no 'binary' entry on purpose — blobs are excluded from CRUD v1.
};
