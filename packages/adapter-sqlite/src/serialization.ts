/**
 * Identifier quoting + per-LogicalType value serialization for the SQLite
 * data connection — 05-introspection-engine.md §3 (`QueryEngine`) and
 * 08-server-api.md §3.7. Pure module (no `better-sqlite3`/`kysely` import)
 * so the policy is unit-testable offline. Mirrors the postgres reference
 * adapter.
 *
 * Serialization policy (05 §3 `TypeSerializer` contract):
 * - `bigint` and `decimal` travel as STRINGS end to end — better-sqlite3
 *   returns JS numbers (or bigints in safe-integer mode) and JS numbers
 *   would silently lose precision past 2^53.
 * - `boolean` maps SQLite's 0/1 storage to real booleans.
 * - timestamps pass through untouched: SQLite stores them as TEXT or
 *   INTEGER epoch and the storage format is detected by the runtime data
 *   layer, not the adapter (05 §2.2).
 * - `json` is TEXT on disk: `toDb` stringifies, `fromDb` parses when the
 *   stored text is valid JSON (raw text passes through otherwise).
 * - BLOB POLICY: `binary` columns are EXCLUDED from CRUD v1 — no serializer
 *   is registered for `'binary'` (same as postgres bytea).
 */
import type { LogicalType, TypeSerializer } from '@adminium/engine/adapter';

/**
 * SQLite has no hard identifier limit — the engine convention is 128
 * (05 §2.1 "unlimited-ish sqlite (use 128)").
 */
export const SQLITE_MAX_IDENTIFIER_LENGTH = 128;

/**
 * Double-quote an identifier, escaping embedded quotes. Identifiers are
 * snapshot-validated before they ever reach this point (no raw SQL escape
 * hatch — 05 §3); quoting is defense in depth, not sanitization.
 */
export function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
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
export const sqliteSerializers: Partial<Record<LogicalType, TypeSerializer>> = {
  bigint: lossless,
  decimal: lossless,
  boolean: {
    toDb: (value) => (typeof value === 'boolean' ? (value ? 1 : 0) : value),
    fromDb: (value) => {
      if (value === 1 || value === 0) return value === 1;
      return value;
    },
  },
  json: {
    toDb: (value) => (typeof value === 'string' ? value : JSON.stringify(value)),
    fromDb: (value) => {
      if (typeof value !== 'string') return value;
      try {
        return JSON.parse(value) as unknown;
      } catch {
        return value;
      }
    },
  },
  // NOTE: timestamps intentionally absent — storage format (TEXT vs INTEGER
  // epoch) is a runtime-detected format hint, not an adapter policy.
  // NOTE: no 'binary' entry on purpose — blobs are excluded from CRUD v1.
};
