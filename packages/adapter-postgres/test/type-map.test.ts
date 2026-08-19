// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Offline unit tests — dbType → LogicalType mapping table (05 §2.2), default
 * classification (05 §4.1), CHECK-enum synthesis, identifier quoting, and
 * the type-serialization policy. No database, no drivers.
 */
import { describe, expect, it } from 'vitest';

import { parseCheckEnum } from '../src/introspect.js';
import {
  PG_MAX_IDENTIFIER_LENGTH,
  postgresSerializers,
  quoteIdentifier,
} from '../src/serialization.js';
import { classifyDefault, mapPostgresType } from '../src/type-map.js';

describe('mapPostgresType — the §2.2 Postgres column', () => {
  it.each([
    ['text', 'text'],
    ['citext', 'text'],
    ['character varying(120)', 'varchar'],
    ['character(5)', 'varchar'],
    ['smallint', 'integer'],
    ['integer', 'integer'],
    ['bigint', 'bigint'],
    ['numeric(10,2)', 'decimal'],
    ['numeric', 'decimal'],
    ['money', 'decimal'],
    ['real', 'float'],
    ['double precision', 'float'],
    ['boolean', 'boolean'],
    ['date', 'date'],
    ['time without time zone', 'time'],
    ['time(3) with time zone', 'time'],
    ['timestamp without time zone', 'timestamp'],
    ['timestamp(6) without time zone', 'timestamp'],
    ['timestamp with time zone', 'timestamptz'],
    ['interval', 'interval'],
    ["interval day to second", 'interval'],
    ['uuid', 'uuid'],
    ['json', 'json'],
    ['jsonb', 'json'],
    ['bytea', 'binary'],
    ['inet', 'inet'],
    ['cidr', 'inet'],
    ['geometry', 'geometry'],
    ['geography', 'geometry'],
    ['tsvector', 'unknown'],
    ['int4range', 'unknown'],
  ] as const)('%s → %s', (dbType, logicalType) => {
    expect(mapPostgresType(dbType).logicalType).toBe(logicalType);
  });

  it('extracts varchar/char lengths', () => {
    expect(mapPostgresType('character varying(120)').maxLength).toBe(120);
    expect(mapPostgresType('character(5)').maxLength).toBe(5);
    expect(mapPostgresType('text').maxLength).toBeNull();
  });

  it('extracts numeric precision and scale', () => {
    expect(mapPostgresType('numeric(10,2)')).toMatchObject({
      numericPrecision: 10,
      numericScale: 2,
    });
    expect(mapPostgresType('numeric')).toMatchObject({
      numericPrecision: null,
      numericScale: null,
    });
  });

  it('reports binary float precision (real=24, double precision=53)', () => {
    expect(mapPostgresType('real').numericPrecision).toBe(24);
    expect(mapPostgresType('real').numericScale).toBeNull();
    expect(mapPostgresType('double precision').numericPrecision).toBe(53);
  });

  it('maps array element types (isArray handled by the assembler)', () => {
    expect(mapPostgresType('integer[]').logicalType).toBe('integer');
    expect(mapPostgresType('character varying(30)[]')).toMatchObject({
      logicalType: 'varchar',
      maxLength: 30,
    });
  });

  it('strips every dimension of a multi-dimensional array', () => {
    // `format_type` reports a 2-D column as `integer[][]`. Stripping only the
    // last `[]` would leave `integer[]`, which is not in the base-type map and
    // would render a perfectly ordinary int matrix as `unknown`.
    expect(mapPostgresType('integer[][]').logicalType).toBe('integer');
    expect(mapPostgresType('integer[][][]').logicalType).toBe('integer');
    expect(mapPostgresType('numeric(10,2)[][]')).toMatchObject({
      logicalType: 'decimal',
      numericPrecision: 10,
      numericScale: 2,
    });
  });

  it('tolerates whitespace inside the array suffix', () => {
    expect(mapPostgresType('integer[ ][ ]').logicalType).toBe('integer');
  });
});

describe('classifyDefault — 05 §4.1', () => {
  it('identity columns are autoincrement regardless of expression', () => {
    expect(classifyDefault(null, 'a')).toEqual({ kind: 'autoincrement' });
    expect(classifyDefault(null, 'd')).toEqual({ kind: 'autoincrement' });
  });

  it('nextval() defaults are autoincrement', () => {
    expect(classifyDefault("nextval('users_id_seq'::regclass)", '')).toEqual({
      kind: 'autoincrement',
    });
  });

  it('now()/CURRENT_TIMESTAMP defaults are now', () => {
    expect(classifyDefault('now()', '')).toEqual({ kind: 'now' });
    expect(classifyDefault('CURRENT_TIMESTAMP', '')).toEqual({ kind: 'now' });
  });

  it('uuid generator defaults are uuid', () => {
    expect(classifyDefault('gen_random_uuid()', '')).toEqual({ kind: 'uuid' });
    expect(classifyDefault('uuid_generate_v4()', '')).toEqual({ kind: 'uuid' });
  });

  it('literals keep their verbatim text', () => {
    expect(classifyDefault("'active'::text", '')).toEqual({
      kind: 'literal',
      text: "'active'::text",
    });
    expect(classifyDefault("'pend''ing'::character varying(20)", '')).toEqual({
      kind: 'literal',
      text: "'pend''ing'::character varying(20)",
    });
    expect(classifyDefault('0', '')).toEqual({ kind: 'literal', text: '0' });
    expect(classifyDefault('-3.5', '')).toEqual({ kind: 'literal', text: '-3.5' });
    expect(classifyDefault('false', '')).toEqual({ kind: 'literal', text: 'false' });
    expect(classifyDefault('NULL::text', '')).toEqual({ kind: 'literal', text: 'NULL::text' });
  });

  it('anything else is an expression', () => {
    expect(classifyDefault("lower((email)::text)", '')).toEqual({
      kind: 'expression',
      text: "lower((email)::text)",
    });
    expect(classifyDefault("('ORD-'::text || nextval2())", '')).toEqual({
      kind: 'expression',
      text: "('ORD-'::text || nextval2())",
    });
  });

  it('no default → null', () => {
    expect(classifyDefault(null, '')).toBeNull();
    expect(classifyDefault('', '')).toBeNull();
  });
});

describe('parseCheckEnum — CHECK (col IN (...)) synthesis (05 §4.1)', () => {
  it('parses the normalized = ANY(ARRAY[...]) text form', () => {
    expect(
      parseCheckEnum("CHECK ((status = ANY (ARRAY['todo'::text, 'doing'::text, 'done'::text])))"),
    ).toEqual({ column: 'status', values: ['todo', 'doing', 'done'] });
  });

  it('parses the varchar cast form', () => {
    expect(
      parseCheckEnum(
        "CHECK (((tier)::text = ANY ((ARRAY['free'::character varying, 'pro'::character varying])::text[])))",
      ),
    ).toEqual({ column: 'tier', values: ['free', 'pro'] });
  });

  it('parses a plain IN list', () => {
    expect(parseCheckEnum("CHECK (kind IN ('a', 'b'))")).toEqual({
      column: 'kind',
      values: ['a', 'b'],
    });
  });

  it('unescapes doubled quotes', () => {
    expect(
      parseCheckEnum("CHECK ((mood = ANY (ARRAY['it''s fine'::text, 'meh'::text])))"),
    ).toEqual({ column: 'mood', values: ["it's fine", 'meh'] });
  });

  it('returns null for non-enum checks', () => {
    expect(parseCheckEnum('CHECK ((price > (0)::numeric))')).toBeNull();
    expect(parseCheckEnum('CHECK ((char_length(name) > 2))')).toBeNull();
  });
});

describe('identifier quoting + serialization policy', () => {
  it('double-quotes and escapes identifiers; max length is 63', () => {
    expect(quoteIdentifier('order_details')).toBe('"order_details"');
    expect(quoteIdentifier('weird"name')).toBe('"weird""name"');
    expect(PG_MAX_IDENTIFIER_LENGTH).toBe(63);
  });

  it('bigint and decimal stay strings end to end (lossless policy)', () => {
    const bigint = postgresSerializers.bigint;
    const decimal = postgresSerializers.decimal;
    expect(bigint?.fromDb('9007199254740993')).toBe('9007199254740993');
    expect(bigint?.toDb(42n)).toBe('42');
    expect(decimal?.fromDb('12345678901234567890.12')).toBe('12345678901234567890.12');
    expect(decimal?.toDb(19.99)).toBe('19.99');
  });

  it('timestamps serialize to ISO-8601 UTC; dates keep their SQL text form', () => {
    const when = new Date(Date.UTC(2026, 6, 1, 12, 30, 0));
    expect(postgresSerializers.timestamptz?.fromDb(when)).toBe('2026-07-01T12:30:00.000Z');
    expect(postgresSerializers.timestamp?.fromDb(when)).toBe('2026-07-01T12:30:00.000Z');
    expect(postgresSerializers.date?.fromDb(new Date(2026, 6, 1))).toBe('2026-07-01');
    expect(postgresSerializers.date?.fromDb('2026-07-01')).toBe('2026-07-01');
  });

  it('json binds as a single stringified parameter', () => {
    expect(postgresSerializers.json?.toDb({ a: 1 })).toBe('{"a":1}');
  });

  it('bytea is excluded from CRUD v1 — no binary serializer', () => {
    expect(postgresSerializers.binary).toBeUndefined();
  });
});

describe('ReDoS hardening — CHECK bodies parse linearly (CodeQL js/polynomial-redos)', () => {
  // `pg_get_constraintdef` text is not fully trusted: a CHECK body carries
  // column names and enum labels, and an application that lets users name
  // things puts their text in both. Each input below is the pathological
  // string CodeQL named; the figures are what the previous one-piece patterns
  // actually cost, measured.
  // The gap this has to detect is enormous — every figure quoted below is in
  // SECONDS, while the warmed measurement is single-digit milliseconds — so the
  // budget only has to land somewhere in between. It sits far above the
  // measurement rather than just under the smallest regression (4.4 s), because
  // a budget set close to the observed value fails on runner contention instead
  // of on the defect, which is exactly what 1 s did.
  const BUDGET_MS = 2_000;

  /**
   * Warm up, then measure. The first call into one of these parsers pays for
   * regex compilation and JIT, and on a contended CI runner that dwarfed the
   * parse itself — this suite's first case measured 36 ms locally and 1,116 ms
   * in CI against a 1,000 ms budget, and went red on the difference. That was
   * warmup cost, not a regression.
   *
   * Warming with the SAME input is safe: these parsers are pure and memoize
   * nothing, so a quadratic implementation is slow on the second call too and
   * this cannot hide the blow-up the budget exists to catch. If one ever grows
   * a cache, warm it with a differently-shaped input instead.
   */
  const timed = <T>(run: () => T): { ms: number; value: T } => {
    run();
    const started = performance.now();
    const value = run();
    return { ms: performance.now() - started, value };
  };

  it.each([
    // [label, definition, old wall-clock]
    ['a bare word then a long run of double spaces (~12.2s)', 'A::' + '  '.repeat(40_000)],
    [
      'ARRAY[ opened and never closed (~8.6s)',
      'A=ANY(ARRAY[' + 'A=ANY(ARRAY[\\'.repeat(20_000),
    ],
    ['one long identifier run (~9.4s)', '_'.repeat(50_000)],
    ['IN ( opened and never closed (~4.4s)', '_ in (' + '_ in (('.repeat(20_000)],
  ])('parseCheckEnum: %s', (_label, definition) => {
    const { ms, value } = timed(() => parseCheckEnum(definition));
    expect(ms).toBeLessThan(BUDGET_MS);
    // None of these close a value list, so none is an enum — as before.
    expect(value).toBeNull();
  });

  it.each([
    [
      "CHECK ((status = ANY (ARRAY['todo'::text, 'doing'::text])))",
      { column: 'status', values: ['todo', 'doing'] },
    ],
    [
      "CHECK (((tier)::text = ANY ((ARRAY['free'::character varying])::text[])))",
      { column: 'tier', values: ['free'] },
    ],
    ["CHECK (kind IN ('a', 'b'))", { column: 'kind', values: ['a', 'b'] }],
    [
      "CHECK ((mood = ANY (ARRAY['it''s fine'::text])))",
      { column: 'mood', values: ["it's fine"] },
    ],
    ['CHECK ((price > (0)::numeric))', null],
    ['CHECK ((char_length(name) > 2))', null],
    ['CHECK (kind IN ())', null], // empty list — the `+` never matched empty
    ["CHECK (kind IN ('a'", null], // unclosed list
    ["CHECK ((s = ANY (ARRAY['a'::text)))", null], // unclosed ARRAY[
    ['CHECK ((s = ANY (ARRAY[])))', null],
    // An empty list must not stop the search: the one-piece pattern retried at
    // the next offset and found the second CHECK, and so must the split one.
    ["CHECK (a IN ()) CHECK (b IN ('z'))", { column: 'b', values: ['z'] }],
    // A NUMERIC value list parses as a delimited list but yields no string
    // literals. Synthesizing a zero-value enum here would produce a select
    // input with nothing in it, so it must stay null.
    ['CHECK ((level = ANY (ARRAY[1, 2, 3])))', null],
    ['CHECK (level IN (1, 2))', null],
  ] as const)('parseCheckEnum keeps its grammar: %s', (definition, expected) => {
    expect(parseCheckEnum(definition)).toEqual(expected);
  });
});
