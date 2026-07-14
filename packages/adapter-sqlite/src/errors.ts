/**
 * Driver error → typed `AdapterError` mapping — 05-introspection-engine.md §3.
 * better-sqlite3 errors carry a `code` like `SQLITE_CANTOPEN`; filesystem
 * failures carry Node errnos (`ENOENT`, `EACCES`). The Studio wizard and the
 * `diagnostics-readout` widget map `code` to remediation copy, so the
 * mapping here is the whole UX for failure states. SQLite has no network,
 * credentials, or TLS — `HOST_UNREACHABLE` doubles as "file not found /
 * not openable" and `AUTH`/`TLS` never occur.
 */
import { AdapterError, type AdapterErrorCode } from '@adminium/engine/adapter';

const UNREACHABLE_CODES = new Set([
  'SQLITE_CANTOPEN',
  'SQLITE_CANTOPEN_ISDIR',
  'SQLITE_CANTOPEN_FULLPATH',
  'SQLITE_NOTADB',
  'ENOENT',
  'ENOTDIR',
]);
const PERMISSION_CODES = new Set([
  'SQLITE_READONLY',
  'SQLITE_READONLY_DBMOVED',
  'SQLITE_READONLY_CANTINIT',
  'SQLITE_READONLY_DIRECTORY',
  'SQLITE_AUTH',
  'SQLITE_PERM',
  'EACCES',
  'EPERM',
]);
const TIMEOUT_CODES = new Set(['SQLITE_BUSY', 'SQLITE_BUSY_SNAPSHOT', 'SQLITE_LOCKED', 'SQLITE_PROTOCOL']);

const HINTS: Partial<Record<AdapterErrorCode, string>> = {
  HOST_UNREACHABLE:
    'check the database file path — the file must exist and be a valid SQLite database',
  PERMISSION:
    'the process cannot write to the database file (or it was opened read-only) — check file permissions',
  TIMEOUT: 'the database file is locked by another process; retry once the writer finishes',
};

const DRIFT_MESSAGE = /no such (table|column)/i;

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Coerce any driver/filesystem failure into the one allowed error type. */
export function toAdapterError(error: unknown, context: string): AdapterError {
  if (error instanceof AdapterError) return error;

  const message = messageOf(error);
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code: unknown }).code)
      : '';

  let mapped: AdapterErrorCode = 'UNKNOWN';
  if (UNREACHABLE_CODES.has(code)) mapped = 'HOST_UNREACHABLE';
  else if (PERMISSION_CODES.has(code)) mapped = 'PERMISSION';
  else if (TIMEOUT_CODES.has(code)) mapped = 'TIMEOUT';
  else if (code === 'SQLITE_ERROR' && DRIFT_MESSAGE.test(message)) mapped = 'SCHEMA_DRIFT';
  else if (DRIFT_MESSAGE.test(message)) mapped = 'SCHEMA_DRIFT';
  // better-sqlite3 throws plain TypeErrors for unopenable paths pre-driver.
  else if (/(unable to open|not a database|does not exist)/i.test(message)) {
    mapped = 'HOST_UNREACHABLE';
  }

  const options: { detail: string; cause: unknown; hint?: string } = {
    detail: code.length > 0 ? `${code}: ${message}` : message,
    cause: error,
  };
  const hint = HINTS[mapped];
  if (hint !== undefined) options.hint = hint;
  return new AdapterError(mapped, `${context}: ${message}`, options);
}
