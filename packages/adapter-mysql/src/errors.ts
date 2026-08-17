// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Driver error → typed `AdapterError` mapping — 05-introspection-engine.md §3.
 * mysql2 errors carry a symbolic `code` (`ER_ACCESS_DENIED_ERROR`, …) plus
 * `errno`/`sqlState`; socket-level failures carry Node errnos. The Studio
 * wizard and the `diagnostics-readout` widget map `code` to remediation
 * copy, so the mapping here is the whole UX for failure states.
 */
import { AdapterError, type AdapterErrorCode } from '@adminium/engine/adapter';

const AUTH_CODES = new Set([
  'ER_ACCESS_DENIED_ERROR',
  'ER_ACCESS_DENIED_NO_PASSWORD_ERROR',
  'ER_NOT_SUPPORTED_AUTH_MODE',
  'ER_BAD_DB_ERROR', // unknown database — same treatment as pg 3D000
  'ER_DBACCESS_DENIED_ERROR',
]);
const PERMISSION_CODES = new Set([
  'ER_TABLEACCESS_DENIED_ERROR',
  'ER_COLUMNACCESS_DENIED_ERROR',
  'ER_SPECIFIC_ACCESS_DENIED_ERROR',
  'ER_PROCACCESS_DENIED_ERROR',
  'ER_OPTION_PREVENTS_STATEMENT', // --read-only server rejecting a write
]);
const TIMEOUT_CODES = new Set([
  'ER_QUERY_TIMEOUT', // MySQL max_execution_time (3024) / MariaDB (1969)
  'ER_STATEMENT_TIMEOUT',
  'ER_LOCK_WAIT_TIMEOUT',
  'PROTOCOL_SEQUENCE_TIMEOUT',
  'ETIMEDOUT',
]);
const DRIFT_CODES = new Set(['ER_NO_SUCH_TABLE', 'ER_BAD_FIELD_ERROR']);
const NETWORK_ERRNOS = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EPIPE',
  'EAI_AGAIN',
]);
const TLS_CODES = new Set([
  'HANDSHAKE_SSL_ERROR',
  'HANDSHAKE_NO_SSL_SUPPORT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'CERT_HAS_EXPIRED',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'HOSTNAME_MISMATCH',
]);

const HINTS: Partial<Record<AdapterErrorCode, string>> = {
  AUTH: 'check the username, password, and database name in the connection string',
  HOST_UNREACHABLE:
    'check the host/port and any firewall or IP allowlist — the database must accept connections from this server',
  TLS: "check the ssl options in the DSN and the server's certificate chain",
  PERMISSION: 'the connected user lacks the required privilege — grant it or use a different user',
  TIMEOUT: 'the statement exceeded its time budget; retry or narrow the operation',
  UNSUPPORTED: 'Adminium supports MySQL ≥ 8.0 and MariaDB ≥ 10.5 — upgrade the server to connect',
};

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Coerce any driver/socket failure into the one allowed error type. */
export function toAdapterError(error: unknown, context: string): AdapterError {
  if (error instanceof AdapterError) return error;

  const message = messageOf(error);
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code: unknown }).code)
      : '';

  let mapped: AdapterErrorCode = 'UNKNOWN';
  if (AUTH_CODES.has(code)) mapped = 'AUTH';
  else if (PERMISSION_CODES.has(code)) mapped = 'PERMISSION';
  else if (TIMEOUT_CODES.has(code)) mapped = 'TIMEOUT';
  else if (DRIFT_CODES.has(code)) mapped = 'SCHEMA_DRIFT';
  else if (NETWORK_ERRNOS.has(code)) mapped = 'HOST_UNREACHABLE';
  else if (
    TLS_CODES.has(code) ||
    code.startsWith('ERR_TLS') ||
    /\b(ssl|tls|certificate)\b/i.test(message)
  ) {
    mapped = 'TLS';
  }

  const options: { detail: string; cause: unknown; hint?: string } = {
    detail: code.length > 0 ? `${code}: ${message}` : message,
    cause: error,
  };
  const hint = HINTS[mapped];
  if (hint !== undefined) options.hint = hint;
  return new AdapterError(mapped, `${context}: ${message}`, options);
}
