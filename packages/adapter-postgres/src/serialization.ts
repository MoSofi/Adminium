// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Identifier quoting + per-LogicalType value serialization for the Postgres
 * data connection — 05-introspection-engine.md §3 (`QueryEngine`) and
 * 08-server-api.md §3.7. Pure module (no `pg`/`kysely` import) so the policy
 * is unit-testable offline.
 *
 * Serialization policy (05 §3 `TypeSerializer` contract):
 * - `bigint` (int8) and `decimal` (numeric/money) travel as STRINGS end to
 *   end — the pg driver already returns them as strings and JS numbers would
 *   silently lose precision.
 * - timestamps serialize to ISO-8601 UTC; `date`/`time` keep their SQL text
 *   forms (`YYYY-MM-DD`, `HH:MM:SS`).
 * - `json` values pass through as parsed objects; `toDb` stringifies so
 *   Kysely binds a single jsonb parameter.
 * - BYTEA POLICY: `binary` columns are EXCLUDED from CRUD v1 — no serializer
 *   is registered for `'binary'`. Grids/forms never select bytea columns
 *   (they render as an attachment placeholder); file/blob transfer arrives
 *   with the dedicated attachment endpoints post-v1.
 */
import type { LogicalType, TypeSerializer } from '@adminium/engine/adapter';

/** Postgres truncates identifiers at 63 bytes (NAMEDATALEN - 1). */
export const PG_MAX_IDENTIFIER_LENGTH = 63;

/**
 * Double-quote an identifier, escaping embedded quotes. Identifiers are
 * snapshot-validated before they ever reach this point (no raw SQL escape
 * hatch — 05 §3); quoting is defense in depth, not sanitization.
 */
export function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
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
  fromDb: (value) => (typeof value === 'number' ? value.toString() : value),
};

/** Per-LogicalType converters handed to the CRUD layer via `QueryEngine`. */
export const postgresSerializers: Partial<Record<LogicalType, TypeSerializer>> = {
  bigint: lossless,
  decimal: lossless,
  timestamp: { toDb: (value) => value, fromDb: toIsoUtc },
  timestamptz: { toDb: (value) => value, fromDb: toIsoUtc },
  date: { toDb: (value) => value, fromDb: toIsoDate },
  json: {
    toDb: (value) => (typeof value === 'string' ? value : JSON.stringify(value)),
    fromDb: (value) => value,
  },
  // NOTE: no 'binary' entry on purpose — bytea is excluded from CRUD v1.
};
