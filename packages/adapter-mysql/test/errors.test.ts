// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Offline unit tests — driver error → `AdapterError` mapping (05 §3).
 *
 * mysql2 rejects with an `Error` carrying a symbolic `code` (`ER_…`) plus
 * `errno`/`sqlState`; socket failures carry Node errnos. Those shapes are
 * constructed by hand here, so no MySQL server is involved — which matters
 * because this module is otherwise only executed by the env-gated live suite
 * and went completely unmeasured on any machine without `TEST_MYSQL_URL`.
 *
 * The `code` is the whole UX for failure states: the Studio wizard and the
 * `diagnostics-readout` widget map it to remediation copy.
 */
import { describe, expect, it } from 'vitest';

import { AdapterError } from '@adminium/engine/adapter';

import { toAdapterError } from '../src/errors.js';

/** The shape mysql2 rejects with for a server-side error packet. */
function mysqlError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

describe('toAdapterError — the §3 code table', () => {
  it.each([
    // Authentication and database selection — all "check your credentials".
    ['ER_ACCESS_DENIED_ERROR', "Access denied for user 'app'@'10.0.0.1'", 'AUTH'],
    ['ER_ACCESS_DENIED_NO_PASSWORD_ERROR', 'Access denied (no password)', 'AUTH'],
    ['ER_NOT_SUPPORTED_AUTH_MODE', 'Client does not support auth protocol', 'AUTH'],
    ['ER_BAD_DB_ERROR', "Unknown database 'nope'", 'AUTH'],
    ['ER_DBACCESS_DENIED_ERROR', "Access denied for user to database 'shop'", 'AUTH'],
    // Privilege failures on an otherwise good connection.
    ['ER_TABLEACCESS_DENIED_ERROR', "SELECT command denied to user", 'PERMISSION'],
    ['ER_COLUMNACCESS_DENIED_ERROR', 'SELECT command denied on column', 'PERMISSION'],
    ['ER_SPECIFIC_ACCESS_DENIED_ERROR', 'Access denied; you need SUPER', 'PERMISSION'],
    ['ER_PROCACCESS_DENIED_ERROR', 'EXECUTE command denied', 'PERMISSION'],
    ['ER_OPTION_PREVENTS_STATEMENT', 'The MySQL server is running with the --read-only option', 'PERMISSION'],
    // Time budget.
    ['ER_QUERY_TIMEOUT', 'Query execution was interrupted, max_execution_time exceeded', 'TIMEOUT'],
    ['ER_STATEMENT_TIMEOUT', 'Query exceeded max_statement_time', 'TIMEOUT'],
    ['ER_LOCK_WAIT_TIMEOUT', 'Lock wait timeout exceeded', 'TIMEOUT'],
    ['PROTOCOL_SEQUENCE_TIMEOUT', 'Timeout acquiring a connection', 'TIMEOUT'],
    // The snapshot no longer matches the server.
    ['ER_NO_SUCH_TABLE', "Table 'shop.gone' doesn't exist", 'SCHEMA_DRIFT'],
    ['ER_BAD_FIELD_ERROR', "Unknown column 'gone' in 'field list'", 'SCHEMA_DRIFT'],
    // Socket-level failures.
    ['ECONNREFUSED', 'connect ECONNREFUSED 10.0.0.1:3306', 'HOST_UNREACHABLE'],
    ['ECONNRESET', 'read ECONNRESET', 'HOST_UNREACHABLE'],
    ['ENOTFOUND', 'getaddrinfo ENOTFOUND db.example.com', 'HOST_UNREACHABLE'],
    ['EHOSTUNREACH', 'connect EHOSTUNREACH', 'HOST_UNREACHABLE'],
    ['ENETUNREACH', 'connect ENETUNREACH', 'HOST_UNREACHABLE'],
    ['EPIPE', 'write EPIPE', 'HOST_UNREACHABLE'],
    ['EAI_AGAIN', 'getaddrinfo EAI_AGAIN', 'HOST_UNREACHABLE'],
    // TLS.
    ['HANDSHAKE_SSL_ERROR', 'Error during SSL handshake', 'TLS'],
    ['HANDSHAKE_NO_SSL_SUPPORT', 'Server does not support secure connection', 'TLS'],
    ['SELF_SIGNED_CERT_IN_CHAIN', 'self signed certificate in chain', 'TLS'],
    ['UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'unable to verify the first certificate', 'TLS'],
    ['CERT_HAS_EXPIRED', 'certificate has expired', 'TLS'],
    ['DEPTH_ZERO_SELF_SIGNED_CERT', 'self signed certificate', 'TLS'],
    ['UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'unable to get local issuer certificate', 'TLS'],
    ['HOSTNAME_MISMATCH', 'Hostname/IP does not match certificate', 'TLS'],
  ] as const)('maps %s to %s', (code, message, expected) => {
    expect(toAdapterError(mysqlError(code, message), 'ctx').code).toBe(expected);
  });

  it('maps any ERR_TLS_* errno by prefix, not by an exhaustive list', () => {
    // Node adds these over time; the prefix rule is what keeps a new one from
    // silently degrading to UNKNOWN with no remediation copy.
    expect(toAdapterError(mysqlError('ERR_TLS_CERT_ALTNAME_INVALID', 'bad altname'), 'ctx').code).toBe(
      'TLS',
    );
    expect(toAdapterError(mysqlError('ERR_TLS_INVALID_PROTOCOL_VERSION', 'bad version'), 'ctx').code).toBe(
      'TLS',
    );
  });

  it.each([
    ['SSL connection error: unknown error number'],
    ['TLS handshake failed'],
    ['certificate verify failed'],
  ] as const)('falls back to the message for an uncoded TLS failure: %s', (message) => {
    // Some mysql2 TLS failures arrive with no `code` at all.
    expect(toAdapterError(new Error(message), 'ctx').code).toBe('TLS');
  });

  it('does not read "ssl" out of the middle of an unrelated word', () => {
    // The pattern is word-bounded; without that, a table called `sslogs` or a
    // message mentioning "grossly" would be reported as a certificate problem.
    expect(toAdapterError(new Error('table sslogs is missing'), 'ctx').code).toBe('UNKNOWN');
    expect(toAdapterError(new Error('value grossly exceeds the limit'), 'ctx').code).toBe('UNKNOWN');
  });
});

describe('toAdapterError — remediation hints', () => {
  it.each([
    ['ER_ACCESS_DENIED_ERROR', 'AUTH', /username, password, and database name/],
    ['ECONNREFUSED', 'HOST_UNREACHABLE', /firewall or IP allowlist/],
    ['HANDSHAKE_SSL_ERROR', 'TLS', /ssl options in the DSN/],
    ['ER_TABLEACCESS_DENIED_ERROR', 'PERMISSION', /lacks the required privilege/],
    ['ER_QUERY_TIMEOUT', 'TIMEOUT', /time budget/],
  ] as const)('%s carries the %s hint', (code, expectedCode, hint) => {
    const mapped = toAdapterError(mysqlError(code, 'boom'), 'ctx');
    expect(mapped.code).toBe(expectedCode);
    expect(mapped.hint).toMatch(hint);
  });

  it('leaves UNKNOWN without an invented hint', () => {
    const mapped = toAdapterError(mysqlError('ER_SOMETHING_NEW', 'boom'), 'ctx');
    expect(mapped.code).toBe('UNKNOWN');
    expect(mapped.hint).toBeNull();
  });
});

describe('toAdapterError — message and detail assembly', () => {
  it('prefixes the context and keeps the driver code in detail', () => {
    const mapped = toAdapterError(
      mysqlError('ER_NO_SUCH_TABLE', "Table 'shop.gone' doesn't exist"),
      'mysql query failed',
    );

    expect(mapped).toBeInstanceOf(AdapterError);
    expect(mapped.message).toBe(`mysql query failed: Table 'shop.gone' doesn't exist`);
    // detail carries the machine-readable code the UI keys remediation on.
    expect(mapped.detail).toBe(`ER_NO_SUCH_TABLE: Table 'shop.gone' doesn't exist`);
  });

  it('omits the code prefix from detail when there is no code', () => {
    const mapped = toAdapterError(new Error('something broke'), 'ctx');
    expect(mapped.detail).toBe('something broke');
  });

  it('preserves the original error as the cause', () => {
    const original = mysqlError('ER_NO_SUCH_TABLE', 'gone');
    expect(toAdapterError(original, 'ctx').cause).toBe(original);
  });

  it('passes an existing AdapterError through untouched', () => {
    // Errors raised by the adapter itself (role guards, version checks) must
    // not be re-wrapped into "mysql query failed: …".
    const original = new AdapterError('UNSUPPORTED', 'nope', { hint: 'upgrade' });
    expect(toAdapterError(original, 'ctx')).toBe(original);
  });

  it.each([
    ['a string', 'connection lost', 'connection lost'],
    ['a number', 42, '42'],
    ['null', null, 'null'],
    ['undefined', undefined, 'undefined'],
  ] as const)('stringifies %s rejection rather than crashing the mapper', (_l, thrown, text) => {
    const mapped = toAdapterError(thrown, 'ctx');
    expect(mapped.code).toBe('UNKNOWN');
    expect(mapped.message).toBe(`ctx: ${text}`);
    expect(mapped.detail).toBe(text);
  });

  it('still classifies a non-Error object that carries a code', () => {
    const mapped = toAdapterError({ code: 'ER_NO_SUCH_TABLE', toString: () => 'gone' }, 'ctx');
    expect(mapped.code).toBe('SCHEMA_DRIFT');
    expect(mapped.detail).toBe('ER_NO_SUCH_TABLE: gone');
  });

  it('reads a numeric code without throwing on String()', () => {
    // mysql2 sets `errno` numerically; a caller passing that shape must not
    // break the mapper even though the code will not match any set.
    const mapped = toAdapterError(Object.assign(new Error('boom'), { code: 1045 }), 'ctx');
    expect(mapped.code).toBe('UNKNOWN');
    expect(mapped.detail).toBe('1045: boom');
  });
});
