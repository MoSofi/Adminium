// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Offline unit tests — driver error → `AdapterError` mapping (05 §3). The
 * driver error shapes are constructed by hand (a `pg.DatabaseError` is an
 * `Error` carrying the SQLSTATE on `.code`), so no database is involved.
 */
import { describe, expect, it } from 'vitest';

import { AdapterError } from '@adminium/engine/adapter';

import { toAdapterError } from '../src/errors.js';

/** The shape `pg` rejects with for a server-side ErrorResponse. */
function pgError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

/** Verbatim from a Neon `-pooler` endpoint. */
const NEON_POOLER_MESSAGE =
  'unsupported startup parameter in options: statement_timeout. Please use unpooled connection or remove this parameter from the startup package.';

describe('toAdapterError — pooled (PgBouncer) endpoints', () => {
  it('maps 08P01 + "unsupported startup parameter" to UNSUPPORTED with a pooler hint', () => {
    const mapped = toAdapterError(pgError('08P01', NEON_POOLER_MESSAGE), 'postgres query failed');

    expect(mapped).toBeInstanceOf(AdapterError);
    expect(mapped.code).toBe('UNSUPPORTED');
    expect(mapped.message).toBe(`postgres query failed: ${NEON_POOLER_MESSAGE}`);
    expect(mapped.detail).toBe(`08P01: ${NEON_POOLER_MESSAGE}`);
    // The hint is the whole point: it must name the fix for both providers
    // that hand out the pooled string by default.
    expect(mapped.hint).toContain('-pooler');
    expect(mapped.hint).toContain('6543');
    expect(mapped.hint).toMatch(/unpooled|direct/i);
  });

  it('matches the bare pgbouncer wording too (no "in options" clause)', () => {
    const mapped = toAdapterError(
      pgError('08P01', 'unsupported startup parameter: statement_timeout'),
      'postgres query failed',
    );

    expect(mapped.code).toBe('UNSUPPORTED');
    expect(mapped.hint).toContain('-pooler');
  });

  it('does not claim a pooler for other 08P01 protocol violations', () => {
    const mapped = toAdapterError(
      pgError('08P01', 'invalid message format'),
      'postgres query failed',
    );

    expect(mapped.code).toBe('UNKNOWN');
    expect(mapped.hint).toBeNull();
  });

  it('does not fire on the message alone under a different SQLSTATE', () => {
    const mapped = toAdapterError(
      pgError('42601', 'unsupported startup parameter: statement_timeout'),
      'postgres query failed',
    );

    expect(mapped.code).toBe('UNKNOWN');
    expect(mapped.hint).toBeNull();
  });
});

describe('toAdapterError — the rest of the §3 table', () => {
  it.each([
    ['28P01', 'password authentication failed for user "app"', 'AUTH'],
    ['28000', 'no pg_hba.conf entry for host', 'AUTH'],
    ['3D000', 'database "nope" does not exist', 'AUTH'],
    ['42501', 'permission denied for table users', 'PERMISSION'],
    ['57014', 'canceling statement due to statement timeout', 'TIMEOUT'],
    ['42P01', 'relation "users" does not exist', 'SCHEMA_DRIFT'],
    ['42703', 'column "gone" does not exist', 'SCHEMA_DRIFT'],
    ['ECONNREFUSED', 'connect ECONNREFUSED 10.0.0.1:5432', 'HOST_UNREACHABLE'],
    ['ENOTFOUND', 'getaddrinfo ENOTFOUND db.example.com', 'HOST_UNREACHABLE'],
    ['SELF_SIGNED_CERT_IN_CHAIN', 'self signed certificate in chain', 'TLS'],
  ] as const)('maps %s to %s', (code, message, expected) => {
    expect(toAdapterError(pgError(code, message), 'ctx').code).toBe(expected);
  });

  it('passes an existing AdapterError through untouched', () => {
    const original = new AdapterError('PERMISSION', 'nope', { hint: 'grant it' });

    expect(toAdapterError(original, 'ctx')).toBe(original);
  });

  it('falls back to UNKNOWN for a bare error with no code', () => {
    const mapped = toAdapterError(new Error('something broke'), 'ctx');

    expect(mapped.code).toBe('UNKNOWN');
    expect(mapped.detail).toBe('something broke');
    expect(mapped.hint).toBeNull();
  });
});
