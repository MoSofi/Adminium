// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Shared repo helpers: dialect-portable JSON/bool round-tripping
 * (repos serialize/parse JSON and coerce booleans).
 */

import type { MetaDb } from '../connect.js';

export class MetaValidationError extends Error {
  override name = 'MetaValidationError';
  constructor(message: string, readonly issues?: unknown) {
    super(message);
  }
}

export const HOUR_MS = 3_600_000;
export const DAY_MS = 86_400_000;

/** JSON writes are always serialized strings — portable across jsonb/json/text. */
export function packJson(value: unknown): string {
  return JSON.stringify(value);
}

/**
 * Reads may come back as serialized text (SQLite `text` columns) or already
 * decoded by the driver (`pg` parses `jsonb`, `mysql2` parses `json` unless
 * `jsonStrings: true`). The decoded shape includes bare scalars: a stored
 * `"violet"` arrives as the JS string `violet`, which is not parseable JSON —
 * so strings that fail to parse are the driver-decoded value and returned
 * as-is. (Residual ambiguity: a *stored JSON string* whose content is itself
 * valid JSON — e.g. the string `"123"` — is indistinguishable from serialized
 * text once decoded. Safe only for a column whose top-level value is never a
 * string; one that can hold a string reads with {@link readJsonFrom}.)
 */
export function readJson<T = unknown>(value: unknown): T {
  if (typeof value !== 'string') return value as T;
  try {
    return JSON.parse(value) as T;
  } catch {
    return value as T;
  }
}

export function readJsonOrNull<T = unknown>(value: unknown): T | null {
  if (value === null || value === undefined) return null;
  return readJson<T>(value);
}

/**
 * The exact read, for a json column whose top-level value may itself be a
 * string: `adminium_settings.value`, where `branding.appName` and
 * `assistant.name` are whatever somebody typed.
 *
 * {@link readJson} guesses from the value's shape, and a string is the one
 * shape it cannot place. Postgres and MySQL hand a stored `"2048"` back as the
 * JS string `2048`, which parses, so a workspace named 2048 read back as the
 * NUMBER 2048 and failed its own schema: `get` threw, `overrides()` dropped
 * the row, and `PUT /settings/branding` could not rename it back because it
 * reads the current name first. SQLite never showed it, because its column
 * keeps the serialized text. The dialect answers what the shape cannot: only
 * SQLite stores text, so only SQLite's value is parsed.
 */
export function readJsonFrom<T = unknown>(meta: MetaDb, value: unknown): T {
  return meta.dialect === 'sqlite' ? readJson<T>(value) : (value as T);
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((k) => [k, sortKeysDeep(record[k])]),
    );
  }
  return value;
}

/**
 * Dialect-stable structural equality for JSON payloads. Comparing serialized
 * strings is NOT portable: pg `jsonb` and mysql `json` normalize documents
 * (object key order is not preserved), so a round-tripped value rarely
 * re-serializes to the text that was written. Canonicalize (deep-sorted keys)
 * before comparing.
 */
export function jsonEquals(a: unknown, b: unknown): boolean {
  return JSON.stringify(sortKeysDeep(a)) === JSON.stringify(sortKeysDeep(b));
}

/** PG boolean / MySQL tinyint / SQLite integer → JS boolean. */
export function readBool(value: unknown): boolean {
  return value === true || value === 1;
}

/**
 * JS boolean → dialect-correct bind value. better-sqlite3 refuses to bind
 * booleans; PG refuses numbers for boolean columns; mysql2 accepts both.
 */
export function writeBool(meta: MetaDb, value: boolean): boolean | 0 | 1 {
  return meta.dialect === 'postgres' ? value : value ? 1 : 0;
}

/** Affected-row count from Kysely's bigint result. */
export function affected(count: bigint | undefined): number {
  return Number(count ?? 0n);
}

/**
 * Duplicate-key detection across the three v1 dialects: SQLite
 * (`SQLITE_CONSTRAINT_PRIMARYKEY` / "UNIQUE constraint failed"), Postgres
 * (SQLSTATE 23505), MySQL/MariaDB (errno 1062 / `ER_DUP_ENTRY`). Falls back to
 * a message probe so an unrecognized driver shape still reads as a duplicate
 * rather than a 500 on the security-critical path.
 *
 * Two callers rely on it and both treat a duplicate as an OUTCOME rather than
 * an error: bootstrap's "somebody else claimed the first user", and the
 * automation runner's "this occurrence has already fired", where the unique
 * index IS the exactly-once guarantee and a violation is the normal, expected
 * answer on every producer but the first.
 */
export function isDuplicateKeyError(error: unknown): boolean {
  if (error === null || typeof error !== 'object') return false;
  const e = error as { code?: unknown; errno?: unknown; message?: unknown };
  if (typeof e.code === 'string') {
    if (e.code === '23505') return true; // Postgres unique_violation
    if (e.code.startsWith('SQLITE_CONSTRAINT')) return true;
    if (e.code === 'ER_DUP_ENTRY') return true;
  }
  if (e.errno === 1062) return true; // MySQL/MariaDB
  return typeof e.message === 'string' && /duplicate|unique constraint/i.test(e.message);
}
