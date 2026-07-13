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

/** Reads may come back parsed (PG jsonb) or as a string (SQLite text). */
export function readJson<T = unknown>(value: unknown): T {
  return (typeof value === 'string' ? JSON.parse(value) : value) as T;
}

export function readJsonOrNull<T = unknown>(value: unknown): T | null {
  if (value === null || value === undefined) return null;
  return readJson<T>(value);
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
