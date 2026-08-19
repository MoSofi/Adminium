// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Offline unit tests for the Postgres `QueryEngine` serialization policy
 * (05-introspection-engine.md §3 `TypeSerializer`, 08-server-api.md §3.7).
 *
 * Pure module — no `pg`, no `kysely`, no server. These converters are the only
 * thing standing between a numeric(38,0) primary key and a silently-rounded
 * JSON number, so the lossless rules are asserted as round-trips rather than as
 * "the function was called".
 */
import { describe, expect, it } from 'vitest';

import {
  PG_MAX_IDENTIFIER_LENGTH,
  postgresSerializers,
  quoteIdentifier,
} from '../src/serialization.js';

describe('quoteIdentifier', () => {
  it('double-quotes a plain identifier', () => {
    expect(quoteIdentifier('users')).toBe('"users"');
  });

  it('doubles embedded quotes so the quoting cannot be escaped out of', () => {
    expect(quoteIdentifier('we"ird')).toBe('"we""ird"');
    // The classic break-out attempt stays inert: every quote is doubled, so the
    // result is one identifier token and the injected text never becomes SQL.
    expect(quoteIdentifier('a" ; DROP TABLE t; --')).toBe('"a"" ; DROP TABLE t; --"');
  });

  it('preserves an empty identifier as an empty quoted token', () => {
    expect(quoteIdentifier('')).toBe('""');
  });

  it('pins NAMEDATALEN - 1 as the identifier budget', () => {
    expect(PG_MAX_IDENTIFIER_LENGTH).toBe(63);
  });
});

describe('bigint / decimal — lossless string transport', () => {
  const bigintSerializer = postgresSerializers.bigint;
  const decimalSerializer = postgresSerializers.decimal;

  it('registers the same lossless converter for both', () => {
    expect(bigintSerializer).toBeDefined();
    expect(decimalSerializer).toBe(bigintSerializer);
  });

  it('stringifies a JS bigint on the way to the database', () => {
    // 2^63 - 1: the value that motivates the whole policy.
    expect(bigintSerializer!.toDb(9223372036854775807n)).toBe('9223372036854775807');
  });

  it('stringifies a JS number on the way to the database', () => {
    expect(bigintSerializer!.toDb(42)).toBe('42');
  });

  it('passes a string through toDb untouched (the driver already returns text)', () => {
    expect(bigintSerializer!.toDb('9223372036854775807')).toBe('9223372036854775807');
  });

  it('leaves null/undefined alone rather than coercing them to "null"', () => {
    expect(bigintSerializer!.toDb(null)).toBeNull();
    expect(bigintSerializer!.toDb(undefined)).toBeUndefined();
    expect(bigintSerializer!.fromDb(null)).toBeNull();
  });

  it('stringifies a number coming back from the driver', () => {
    expect(bigintSerializer!.fromDb(42)).toBe('42');
  });

  it('keeps the driver string verbatim on the way back — no Number() round-trip', () => {
    // The precision proof: this value is not representable as a JS number, so
    // any parse-then-stringify would come back 9223372036854775808.
    const exact = '9223372036854775807';
    expect(bigintSerializer!.fromDb(exact)).toBe(exact);
    expect(String(Number(exact))).not.toBe(exact);
  });

  it('keeps numeric scale that a JS number would destroy', () => {
    expect(decimalSerializer!.fromDb('1.100')).toBe('1.100');
    expect(decimalSerializer!.fromDb('0.10000000000000000001')).toBe('0.10000000000000000001');
  });
});

describe('timestamp / timestamptz — ISO-8601 UTC', () => {
  it.each(['timestamp', 'timestamptz'] as const)('%s converts a Date to ISO UTC', (key) => {
    const serializer = postgresSerializers[key]!;
    const instant = new Date(Date.UTC(2024, 2, 5, 12, 34, 56, 789));
    expect(serializer.fromDb(instant)).toBe('2024-03-05T12:34:56.789Z');
  });

  it.each(['timestamp', 'timestamptz'] as const)('%s passes a non-Date through', (key) => {
    const serializer = postgresSerializers[key]!;
    // Some deployments run the driver with a text parser for timestamps; the
    // string is already the wire form and must not be mangled.
    expect(serializer.fromDb('2024-03-05 12:34:56+00')).toBe('2024-03-05 12:34:56+00');
    expect(serializer.fromDb(null)).toBeNull();
  });

  it.each(['timestamp', 'timestamptz'] as const)('%s does not rewrite on the way in', (key) => {
    const serializer = postgresSerializers[key]!;
    const instant = new Date(Date.UTC(2024, 2, 5));
    // toDb is identity: the driver binds Dates natively and a pre-formatted
    // string must reach the server unchanged.
    expect(serializer.toDb(instant)).toBe(instant);
    expect(serializer.toDb('2024-03-05')).toBe('2024-03-05');
  });
});

describe('date — calendar date, no timezone shift', () => {
  const serializer = postgresSerializers.date!;

  it('formats a driver-parsed Date as YYYY-MM-DD', () => {
    // Constructed from LOCAL components, which is exactly what pg's DATE (OID
    // 1082) parser produces — local midnight. Reading it back with the local
    // accessors is therefore timezone-independent and this assertion holds in
    // any TZ, which a Date.UTC(...) fixture would not.
    expect(serializer.fromDb(new Date(2024, 2, 5))).toBe('2024-03-05');
  });

  it('zero-pads single-digit months and days', () => {
    expect(serializer.fromDb(new Date(2024, 0, 9))).toBe('2024-01-09');
  });

  it('does not roll a local-midnight date back a day', () => {
    // The bug this guards: formatting via toISOString() would report 2023-12-31
    // for this value anywhere west of UTC.
    expect(serializer.fromDb(new Date(2024, 0, 1))).toBe('2024-01-01');
  });

  it('passes a non-Date through (dateStrings-style drivers)', () => {
    expect(serializer.fromDb('2024-03-05')).toBe('2024-03-05');
    expect(serializer.fromDb(null)).toBeNull();
  });

  it('does not rewrite on the way in', () => {
    expect(serializer.toDb('2024-03-05')).toBe('2024-03-05');
  });
});

describe('json — one bound parameter', () => {
  const serializer = postgresSerializers.json!;

  it('stringifies an object so Kysely binds a single jsonb parameter', () => {
    expect(serializer.toDb({ a: 1, b: [2, 3] })).toBe('{"a":1,"b":[2,3]}');
  });

  it('stringifies arrays and JSON null the same way', () => {
    expect(serializer.toDb([1, 2])).toBe('[1,2]');
    expect(serializer.toDb(null)).toBe('null');
  });

  it('leaves an already-serialized string alone rather than double-encoding it', () => {
    // Double-encoding is the failure mode: JSON.stringify('{"a":1}') would
    // store the literal text "{\"a\":1}" instead of an object.
    expect(serializer.toDb('{"a":1}')).toBe('{"a":1}');
  });

  it('passes parsed values back untouched (the driver already parsed them)', () => {
    const parsed = { a: 1 };
    expect(serializer.fromDb(parsed)).toBe(parsed);
  });
});

describe('binary is excluded from CRUD v1', () => {
  it('registers no serializer for bytea', () => {
    // Documented policy in 05 §3 — the absence is the contract, so it gets a
    // test rather than a comment alone.
    expect(postgresSerializers.binary).toBeUndefined();
  });

  it('registers converters only for the types the policy names', () => {
    expect(Object.keys(postgresSerializers).sort()).toEqual([
      'bigint',
      'date',
      'decimal',
      'json',
      'timestamp',
      'timestamptz',
    ]);
  });
});
