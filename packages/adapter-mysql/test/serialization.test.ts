// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Offline unit tests for the MySQL `QueryEngine` serialization policy
 * (05-introspection-engine.md §3 `TypeSerializer`, 08-server-api.md §3.7).
 *
 * Pure module — no `mysql2`, no `kysely`, no server. The lossless rules are
 * asserted as round-trips: an UNSIGNED BIGINT primary key exceeds
 * Number.MAX_SAFE_INTEGER, so any numeric round-trip silently corrupts it.
 */
import { describe, expect, it } from 'vitest';

import {
  MYSQL_MAX_IDENTIFIER_LENGTH,
  mysqlSerializers,
  quoteIdentifier,
} from '../src/serialization.js';

describe('quoteIdentifier', () => {
  it('backtick-quotes a plain identifier', () => {
    expect(quoteIdentifier('users')).toBe('`users`');
  });

  it('doubles embedded backticks so the quoting cannot be escaped out of', () => {
    expect(quoteIdentifier('we`ird')).toBe('`we``ird`');
    expect(quoteIdentifier('a` ; DROP TABLE t; -- ')).toBe('`a`` ; DROP TABLE t; -- `');
  });

  it('leaves a double quote alone — it is not a MySQL identifier delimiter', () => {
    // Under the default sql_mode, `"` is a string delimiter, so escaping it
    // here would corrupt a legal (if unusual) column name.
    expect(quoteIdentifier('we"ird')).toBe('`we"ird`');
  });

  it('preserves an empty identifier as an empty quoted token', () => {
    expect(quoteIdentifier('')).toBe('``');
  });

  it('pins the MySQL identifier budget at 64', () => {
    expect(MYSQL_MAX_IDENTIFIER_LENGTH).toBe(64);
  });
});

describe('bigint / decimal — lossless string transport', () => {
  const bigintSerializer = mysqlSerializers.bigint;
  const decimalSerializer = mysqlSerializers.decimal;

  it('registers the same lossless converter for both', () => {
    expect(bigintSerializer).toBeDefined();
    expect(decimalSerializer).toBe(bigintSerializer);
  });

  it('stringifies a JS bigint on the way to the database', () => {
    // 2^64 - 1: MySQL's UNSIGNED BIGINT maximum, the value that motivates the
    // whole policy and which no JS number can hold.
    expect(bigintSerializer!.toDb(18446744073709551615n)).toBe('18446744073709551615');
  });

  it('stringifies a JS number on the way to the database', () => {
    expect(bigintSerializer!.toDb(42)).toBe('42');
  });

  it('leaves strings, null and undefined alone', () => {
    expect(bigintSerializer!.toDb('18446744073709551615')).toBe('18446744073709551615');
    expect(bigintSerializer!.toDb(null)).toBeNull();
    expect(bigintSerializer!.toDb(undefined)).toBeUndefined();
    expect(bigintSerializer!.fromDb(null)).toBeNull();
  });

  it('stringifies BOTH number and bigint coming back from the driver', () => {
    // mysql2 returns BIGINT as a JS bigint when supportBigNumbers is on and as
    // a number otherwise; both must leave as strings.
    expect(bigintSerializer!.fromDb(42)).toBe('42');
    expect(bigintSerializer!.fromDb(18446744073709551615n)).toBe('18446744073709551615');
  });

  it('keeps the driver string verbatim — no Number() round-trip', () => {
    const exact = '18446744073709551615';
    expect(bigintSerializer!.fromDb(exact)).toBe(exact);
    expect(String(Number(exact))).not.toBe(exact);
  });

  it('keeps decimal scale that a JS number would destroy', () => {
    expect(decimalSerializer!.fromDb('1.100')).toBe('1.100');
    expect(decimalSerializer!.fromDb('0.10000000000000000001')).toBe('0.10000000000000000001');
  });
});

describe('boolean — tinyint(1) on the wire', () => {
  const serializer = mysqlSerializers.boolean!;

  it('sends booleans as 0/1', () => {
    // MySQL has no real boolean; tinyint(1) is the convention.
    expect(serializer.toDb(true)).toBe(1);
    expect(serializer.toDb(false)).toBe(0);
  });

  it('passes non-booleans through on the way in', () => {
    expect(serializer.toDb(null)).toBeNull();
    expect(serializer.toDb(1)).toBe(1);
  });

  it('reads 0/1 back as real booleans', () => {
    expect(serializer.fromDb(1)).toBe(true);
    expect(serializer.fromDb(0)).toBe(false);
  });

  it('does not coerce other tinyint values into booleans', () => {
    // tinyint(1) can legally hold 2..127; claiming `2` is `true` would be a
    // lossy read of a column that is not really a flag.
    expect(serializer.fromDb(2)).toBe(2);
    expect(serializer.fromDb(-1)).toBe(-1);
    expect(serializer.fromDb(null)).toBeNull();
    expect(serializer.fromDb('1')).toBe('1');
  });
});

describe('timestamp / timestamptz — ISO-8601 UTC', () => {
  it.each(['timestamp', 'timestamptz'] as const)('%s converts a Date to ISO UTC', (key) => {
    const serializer = mysqlSerializers[key]!;
    const instant = new Date(Date.UTC(2024, 2, 5, 12, 34, 56, 789));
    expect(serializer.fromDb(instant)).toBe('2024-03-05T12:34:56.789Z');
  });

  it.each(['timestamp', 'timestamptz'] as const)('%s passes a non-Date through', (key) => {
    const serializer = mysqlSerializers[key]!;
    // mysql2 with dateStrings: true returns the SQL text form already.
    expect(serializer.fromDb('2024-03-05 12:34:56')).toBe('2024-03-05 12:34:56');
    expect(serializer.fromDb(null)).toBeNull();
  });

  it.each(['timestamp', 'timestamptz'] as const)('%s does not rewrite on the way in', (key) => {
    const serializer = mysqlSerializers[key]!;
    const instant = new Date(Date.UTC(2024, 2, 5));
    expect(serializer.toDb(instant)).toBe(instant);
    expect(serializer.toDb('2024-03-05 00:00:00')).toBe('2024-03-05 00:00:00');
  });
});

describe('date — calendar date, no timezone shift', () => {
  const serializer = mysqlSerializers.date!;

  it('formats a driver-parsed Date as YYYY-MM-DD', () => {
    // Built from LOCAL components, which is what mysql2 produces for DATE
    // (local midnight), so this assertion is timezone-independent.
    expect(serializer.fromDb(new Date(2024, 2, 5))).toBe('2024-03-05');
  });

  it('zero-pads single-digit months and days', () => {
    expect(serializer.fromDb(new Date(2024, 0, 9))).toBe('2024-01-09');
  });

  it('does not roll a local-midnight date back a day', () => {
    // Formatting via toISOString() would report 2023-12-31 west of UTC.
    expect(serializer.fromDb(new Date(2024, 0, 1))).toBe('2024-01-01');
  });

  it('passes a non-Date through (dateStrings mode)', () => {
    expect(serializer.fromDb('2024-03-05')).toBe('2024-03-05');
    expect(serializer.fromDb(null)).toBeNull();
  });

  it('does not rewrite on the way in', () => {
    expect(serializer.toDb('2024-03-05')).toBe('2024-03-05');
  });
});

describe('json — one bound parameter', () => {
  const serializer = mysqlSerializers.json!;

  it('stringifies an object so a single parameter binds', () => {
    expect(serializer.toDb({ a: 1, b: [2, 3] })).toBe('{"a":1,"b":[2,3]}');
  });

  it('stringifies arrays and JSON null the same way', () => {
    expect(serializer.toDb([1, 2])).toBe('[1,2]');
    expect(serializer.toDb(null)).toBe('null');
  });

  it('leaves an already-serialized string alone rather than double-encoding it', () => {
    expect(serializer.toDb('{"a":1}')).toBe('{"a":1}');
  });

  it('passes parsed values back untouched (mysql2 parses the JSON type)', () => {
    const parsed = { a: 1 };
    expect(serializer.fromDb(parsed)).toBe(parsed);
  });
});

describe('binary is excluded from CRUD v1', () => {
  it('registers no serializer for blob columns', () => {
    expect(mysqlSerializers.binary).toBeUndefined();
  });

  it('registers converters only for the types the policy names', () => {
    expect(Object.keys(mysqlSerializers).sort()).toEqual([
      'bigint',
      'boolean',
      'date',
      'decimal',
      'json',
      'timestamp',
      'timestamptz',
    ]);
  });
});
