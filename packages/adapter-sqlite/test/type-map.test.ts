// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Offline unit tests — declared type → affinity → LogicalType mapping
 * (05 §2.2 SQLite column + §4.3 quirks), default classification, CHECK
 * scanning/enum synthesis, file-path normalization, identifier quoting, and
 * the type-serialization policy. No database, no drivers.
 */
import { describe, expect, it } from 'vitest';

import { normalizeSqliteFile } from '../src/file.js';
import { exactCountsSql, parseCheckEnum, scanCheckConstraints } from '../src/introspect.js';
import {
  SQLITE_MAX_IDENTIFIER_LENGTH,
  quoteIdentifier,
  sqliteSerializers,
} from '../src/serialization.js';
import { classifyDefault, mapSqliteType, sqliteAffinity } from '../src/type-map.js';

describe('sqliteAffinity — the five-rule algorithm', () => {
  it.each([
    ['INTEGER', 'INTEGER'],
    ['INT', 'INTEGER'],
    ['BIGINT', 'INTEGER'],
    ['UNSIGNED BIG INT', 'INTEGER'],
    ['TINYINT', 'INTEGER'],
    ['CHARACTER(20)', 'TEXT'],
    ['VARCHAR(255)', 'TEXT'],
    ['NVARCHAR(100)', 'TEXT'],
    ['TEXT', 'TEXT'],
    ['CLOB', 'TEXT'],
    ['BLOB', 'BLOB'],
    ['', 'BLOB'],
    ['REAL', 'REAL'],
    ['DOUBLE', 'REAL'],
    ['DOUBLE PRECISION', 'REAL'],
    ['FLOAT', 'REAL'],
    ['NUMERIC', 'NUMERIC'],
    ['DECIMAL(10,5)', 'NUMERIC'],
    ['BOOLEAN', 'NUMERIC'],
    ['DATE', 'NUMERIC'],
    ['DATETIME', 'NUMERIC'],
    ['STRING', 'NUMERIC'],
  ] as const)('%s → %s', (declared, affinity) => {
    expect(sqliteAffinity(declared)).toBe(affinity);
  });

  it('rule 1 wins over rule 4 (POINT contains INT)', () => {
    expect(sqliteAffinity('POINT')).toBe('INTEGER');
  });
});

describe('mapSqliteType — the §2.2 SQLite column (declared → affinity)', () => {
  it.each([
    ['TEXT', 'text'],
    ['CLOB', 'text'],
    ['varchar(30)', 'varchar'],
    ['CHARACTER(5)', 'varchar'],
    ['NVARCHAR(100)', 'varchar'],
    ['INTEGER', 'integer'],
    ['INT', 'integer'],
    ['SMALLINT', 'integer'],
    ['TINYINT', 'integer'],
    ['BIGINT', 'bigint'],
    ['NUMERIC', 'decimal'],
    ['DECIMAL(10,2)', 'decimal'],
    ['REAL', 'float'],
    ['DOUBLE', 'float'],
    ['FLOAT', 'float'],
    ['BLOB', 'binary'],
    // declared-name hints over NUMERIC/TEXT/INTEGER affinity — 05 §2.2
    ['BOOLEAN', 'boolean'],
    ['BOOL', 'boolean'],
    ['DATETIME', 'timestamp'],
    ['TIMESTAMP', 'timestamp'],
    ['DATE', 'date'],
    ['TIME', 'time'],
    ['UUID', 'uuid'],
    ['GUID', 'uuid'],
    ['JSON', 'json'],
    ['JSONB', 'json'],
    // unrecognized NUMERIC-affinity names and missing types → unknown
    ['STRING', 'unknown'],
    ['', 'unknown'],
    ['ANY', 'unknown'],
  ] as const)('%s → %s', (declared, logicalType) => {
    expect(mapSqliteType(declared).logicalType).toBe(logicalType);
  });

  it('keeps varchar lengths and decimal precision/scale', () => {
    expect(mapSqliteType('varchar(30)')).toMatchObject({ maxLength: 30 });
    expect(mapSqliteType('DECIMAL(10,2)')).toMatchObject({
      numericPrecision: 10,
      numericScale: 2,
    });
    expect(mapSqliteType('TEXT').maxLength).toBeNull();
  });

  it('STRICT tables skip the hint layer (closed type vocabulary)', () => {
    expect(mapSqliteType('BOOLEAN', { strict: true }).logicalType).toBe('unknown');
    expect(mapSqliteType('TEXT', { strict: true }).logicalType).toBe('text');
    expect(mapSqliteType('INTEGER', { strict: true }).logicalType).toBe('integer');
    expect(mapSqliteType('ANY', { strict: true }).logicalType).toBe('unknown');
  });

  it('reports the computed affinity alongside the logical type', () => {
    expect(mapSqliteType('DATETIME').affinity).toBe('NUMERIC');
    expect(mapSqliteType('varchar(10)').affinity).toBe('TEXT');
  });
});

describe('classifyDefault — pragma dflt_value text', () => {
  it('CURRENT_TIMESTAMP family is now', () => {
    expect(classifyDefault('CURRENT_TIMESTAMP')).toEqual({ kind: 'now' });
    expect(classifyDefault('CURRENT_DATE')).toEqual({ kind: 'now' });
    expect(classifyDefault("datetime('now')")).toEqual({ kind: 'now' });
    expect(classifyDefault("strftime('%s','now')")).toEqual({ kind: 'now' });
  });

  it('literals keep their verbatim text', () => {
    expect(classifyDefault("'active'")).toEqual({ kind: 'literal', text: "'active'" });
    expect(classifyDefault('0')).toEqual({ kind: 'literal', text: '0' });
    expect(classifyDefault('-3.5')).toEqual({ kind: 'literal', text: '-3.5' });
    expect(classifyDefault("x'00ff'")).toEqual({ kind: 'literal', text: "x'00ff'" });
  });

  it('anything else is an expression', () => {
    expect(classifyDefault("(hex(randomblob(16)))")).toEqual({
      kind: 'expression',
      text: '(hex(randomblob(16)))',
    });
  });

  it('no default / NULL → null', () => {
    expect(classifyDefault(null)).toBeNull();
    expect(classifyDefault('NULL')).toBeNull();
  });
});

describe('scanCheckConstraints + parseCheckEnum — DDL CHECK synthesis (05 §4.3)', () => {
  const DDL = `CREATE TABLE tickets (
    id INTEGER PRIMARY KEY,
    status TEXT NOT NULL DEFAULT 'open'
      CONSTRAINT tickets_status_check CHECK (status IN ('open', 'pending', 'closed')),
    note TEXT CHECK (length(note) > 2),
    tricky TEXT DEFAULT 'CHECK (decoy IN (''a''))',
    priority TEXT CHECK ("priority" IN ('low','high'))
  )`;

  it('finds every CHECK with balanced parens, skipping string literals', () => {
    const checks = scanCheckConstraints(DDL);
    expect(checks).toHaveLength(3);
    expect(checks[0]).toEqual({
      name: 'tickets_status_check',
      expression: "status IN ('open', 'pending', 'closed')",
    });
    expect(checks[1]).toEqual({ name: null, expression: 'length(note) > 2' });
    expect(checks[2]?.expression).toBe(`"priority" IN ('low','high')`);
  });

  it('synthesizes enums from IN lists (same approach as the pg adapter)', () => {
    expect(parseCheckEnum("status IN ('open', 'pending', 'closed')")).toEqual({
      column: 'status',
      values: ['open', 'pending', 'closed'],
    });
    expect(parseCheckEnum(`"priority" IN ('low','high')`)).toEqual({
      column: 'priority',
      values: ['low', 'high'],
    });
    expect(parseCheckEnum("mood IN ('it''s fine','meh')")).toEqual({
      column: 'mood',
      values: ["it's fine", 'meh'],
    });
    expect(parseCheckEnum('length(note) > 2')).toBeNull();
  });
});

describe('normalizeSqliteFile — the accepted DSN spellings (05 §4.3)', () => {
  it.each([
    [{ file: '/abs/path/app.db' }, '/abs/path/app.db'],
    [{ file: ':memory:' }, ':memory:'],
    [{ dsn: 'sqlite:///abs/path.db' }, '/abs/path.db'],
    [{ dsn: 'sqlite::memory:' }, ':memory:'],
    [{ dsn: 'file:abs/path.db' }, 'abs/path.db'],
    [{ dsn: 'file:///abs/path.db' }, '/abs/path.db'],
    [{ dsn: 'file:/abs/path.db?mode=ro' }, '/abs/path.db'],
    [{ dsn: '/plain/path.db' }, '/plain/path.db'],
    [{ file: '/wins.db', dsn: 'sqlite:///loses.db' }, '/wins.db'],
  ] as const)('%o → %s', (config, expected) => {
    expect(normalizeSqliteFile(config)).toBe(expected);
  });

  it('returns null when neither file nor dsn is present', () => {
    expect(normalizeSqliteFile({})).toBeNull();
  });
});

describe('exactCountsSql — the §4.3 small-file COUNT exception', () => {
  it('counts every table in one UNION ALL statement, quoted', () => {
    const sql = exactCountsSql(['orders', 'order details']);
    expect(sql).toContain('SELECT \'orders\' AS table_name, count(*) AS n FROM "orders"');
    expect(sql).toContain('FROM "order details"');
    expect(sql.split('UNION ALL')).toHaveLength(2);
  });
});

describe('identifier quoting + serialization policy', () => {
  it('double-quotes and escapes identifiers; max length is 128', () => {
    expect(quoteIdentifier('order_details')).toBe('"order_details"');
    expect(quoteIdentifier('weird"name')).toBe('"weird""name"');
    expect(SQLITE_MAX_IDENTIFIER_LENGTH).toBe(128);
  });

  it('bigint and decimal stay strings end to end (lossless policy)', () => {
    const bigint = sqliteSerializers.bigint;
    expect(bigint?.fromDb(9007199254740993n)).toBe('9007199254740993');
    expect(bigint?.toDb(42n)).toBe('42');
    expect(sqliteSerializers.decimal?.fromDb(19.99)).toBe('19.99');
  });

  it('0/1 storage becomes booleans', () => {
    const boolean = sqliteSerializers.boolean;
    expect(boolean?.fromDb(1)).toBe(true);
    expect(boolean?.fromDb(0)).toBe(false);
    expect(boolean?.toDb(true)).toBe(1);
  });

  it('json TEXT storage round-trips through parse/stringify', () => {
    const json = sqliteSerializers.json;
    expect(json?.toDb({ a: 1 })).toBe('{"a":1}');
    expect(json?.fromDb('{"a":1}')).toEqual({ a: 1 });
    expect(json?.fromDb('not json')).toBe('not json');
  });

  it('timestamps pass through (storage format is a runtime concern)', () => {
    expect(sqliteSerializers.timestamp).toBeUndefined();
  });

  it('blobs are excluded from CRUD v1 — no binary serializer', () => {
    expect(sqliteSerializers.binary).toBeUndefined();
  });
});

describe('ReDoS hardening — declared types and CHECK bodies parse linearly', () => {
  // CodeQL js/polynomial-redos. This adapter reads raw `sqlite_master.sql`
  // text, so a declared type and a CHECK body are whatever the application let
  // a user call things. Each input below is the pathological string CodeQL
  // named; the figures are what the previous regexes actually cost, measured.
  const BUDGET_MS = 1_000;

  const timed = <T>(run: () => T): { ms: number; value: T } => {
    const started = performance.now();
    const value = run();
    return { ms: performance.now() - started, value };
  };

  it('mapSqliteType: a declared type that opens parens and never closes one (~4.3s before)', () => {
    const hostile = `NUM${'('.repeat(50_000)}`;
    const { ms, value } = timed(() => mapSqliteType(hostile));
    expect(ms).toBeLessThan(BUDGET_MS);
    // Unclosed parens are not a modifier, so nothing is stripped: the base name
    // stays `NUM(…` — NUMERIC affinity with no usable hint — exactly as before.
    expect(value).toMatchObject({ affinity: 'NUMERIC', logicalType: 'unknown' });
  });

  it.each([
    ['one long identifier run (~4.2s)', '_'.repeat(50_000)],
    ['in( opened and never closed (~3.5s)', '_ in(' + '_ in(('.repeat(20_000)],
  ])('parseCheckEnum: %s', (_label, expression) => {
    const { ms, value } = timed(() => parseCheckEnum(expression));
    expect(ms).toBeLessThan(BUDGET_MS);
    expect(value).toBeNull();
  });

  it.each([
    ['VARCHAR(255)', { logicalType: 'varchar', maxLength: 255, affinity: 'TEXT' }],
    ['NATIVE CHARACTER(70)', { logicalType: 'varchar', maxLength: 70, affinity: 'TEXT' }],
    ['decimal(10,2)', { logicalType: 'decimal', numericPrecision: 10, numericScale: 2 }],
    ['  numeric ( 8 , 0 ) ', { logicalType: 'decimal', numericPrecision: 8, numericScale: 0 }],
    ['TEXT', { logicalType: 'text', maxLength: null, affinity: 'TEXT' }],
    ['BIGINT', { logicalType: 'bigint', affinity: 'INTEGER' }],
    ['varchar(', { logicalType: 'text', maxLength: null, affinity: 'TEXT' }],
    ['varchar)', { logicalType: 'text', maxLength: null, affinity: 'TEXT' }],
  ] as const)('mapSqliteType keeps its grammar: %s', (declaredType, expected) => {
    expect(mapSqliteType(declaredType)).toMatchObject(expected);
  });

  it.each([
    [
      "status IN ('open', 'pending', 'closed')",
      { column: 'status', values: ['open', 'pending', 'closed'] },
    ],
    [`"priority" IN ('low','high')`, { column: 'priority', values: ['low', 'high'] }],
    ["mood IN ('it''s fine','meh')", { column: 'mood', values: ["it's fine", 'meh'] }],
    ["[c] in('a')", { column: 'c', values: ['a'] }],
    ['`c` in (\'a\')', { column: 'c', values: ['a'] }],
    ["'c' in ('a')", { column: 'c', values: ['a'] }],
    ['length(note) > 2', null],
    ['kind in ()', null], // empty list — the `+` never matched empty
    ["kind in ('a'", null], // unclosed list
    // An empty list must not stop the search: the one-piece pattern retried at
    // the next offset and found the second clause, and so must the split one.
    ["a in () b in ('z')", { column: 'b', values: ['z'] }],
  ] as const)('parseCheckEnum keeps its grammar: %s', (expression, expected) => {
    expect(parseCheckEnum(expression)).toEqual(expected);
  });
});
