// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Shared repo helpers: dialect-portable JSON/bool round-tripping
 * (07-meta-store.md §2.1 — repos serialize/parse JSON and coerce booleans).
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
 * text once decoded. No meta payload stores such values; SQLite is unaffected
 * because its text column always carries the serialized form.)
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
