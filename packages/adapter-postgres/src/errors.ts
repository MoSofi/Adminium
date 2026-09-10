// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Driver error → typed `AdapterError` mapping — 05-introspection-engine.md §3.
 * The Studio wizard and the `diagnostics-readout` widget map `code` to
 * remediation copy, so the mapping here is the whole UX for failure states.
 */
import { AdapterError, type AdapterErrorCode } from '@adminium/engine/adapter';

const AUTH_SQLSTATES = new Set(['28P01', '28000']);
const NETWORK_ERRNOS = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ETIMEDOUT',
  'EPIPE',
  'EAI_AGAIN',
]);
const TLS_CODES = new Set([
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
  TLS: "check the sslmode in the DSN and the server's certificate chain",
  PERMISSION: 'the connected role lacks the required privilege — grant it or use a different role',
  TIMEOUT: 'the statement exceeded its time budget; retry or narrow the operation',
};

/**
 * A pooled endpoint refusing the startup packet a SECOND time.
 *
 * Reaching this hint used to be the ordinary case, and the copy said what it
 * said then: switch to the direct endpoint. It no longer is. `index.ts`
 * `#query()` handles the first refusal itself — it drops the startup `options`,
 * rebuilds the pool, and re-sends the same statement with a `SET LOCAL` prelude
 * — so a pooled connection string simply works and this hint is never built.
 *
 * The only way to arrive here is a refusal AFTER that downgrade, and the
 * downgraded pool no longer sends `options` of its own. Something else does:
 * almost always an `options=` parameter in the user's own DSN. So that is the
 * remediation this leads with; the direct endpoint is the fallback, not the fix.
 *
 * Both provider host rewrites stay, because they still resolve it and the two
 * providers are the ones handing out pooled strings by default.
 */
const POOLED_ENDPOINT_HINT =
  'Adminium already retried this without the session settings it sends at connect, and the endpoint refused the startup packet again — so the parameters are coming from the connection string itself: remove any `options=` from the DSN. Failing that, use the direct/unpooled endpoint rather than the transaction pooler — on Neon drop `-pooler` from the host (`ep-x-123456-pooler.us-east-1.aws.neon.tech` → `ep-x-123456.us-east-1.aws.neon.tech`), on Supabase use the direct host on port 5432 rather than the transaction pooler on port 6543';

function isPooledStartupRejection(code: string, message: string): boolean {
  return code === '08P01' && /unsupported startup parameter/i.test(message);
}

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
  /** Set only where the code alone is too coarse to remediate. */
  let specificHint: string | undefined;
  if (isPooledStartupRejection(code, message)) {
    mapped = 'UNSUPPORTED';
    specificHint = POOLED_ENDPOINT_HINT;
  } else if (AUTH_SQLSTATES.has(code) || code === '3D000') mapped = 'AUTH';
  else if (code === '42501') mapped = 'PERMISSION';
  else if (code === '57014') mapped = 'TIMEOUT';
  else if (code === '42P01' || code === '42703') mapped = 'SCHEMA_DRIFT';
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
  const hint = specificHint ?? HINTS[mapped];
  if (hint !== undefined) options.hint = hint;
  return new AdapterError(mapped, `${context}: ${message}`, options);
}
