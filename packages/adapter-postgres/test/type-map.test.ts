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
