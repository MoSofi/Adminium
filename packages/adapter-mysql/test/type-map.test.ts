/**
 * Offline unit tests — COLUMN_TYPE → LogicalType mapping (05 §2.2 MySQL
 * column), enum(...)/set(...) parsing, default classification (05 §4.2),
 * CHECK-enum synthesis, server flavor/version gating, grants interpretation,
 * identifier quoting, and the type-serialization policy. No database, no
 * drivers.
 */
import { describe, expect, it } from 'vitest';

import {
  detectServerFlavor,
  interpretGrants,
  interpretProbe,
  parseCheckEnum,
} from '../src/introspect.js';
import {
  MYSQL_MAX_IDENTIFIER_LENGTH,
  mysqlSerializers,
  quoteIdentifier,
} from '../src/serialization.js';
import { classifyMysqlDefault, mapMysqlType, parseEnumValues } from '../src/type-map.js';

describe('mapMysqlType — the §2.2 MySQL/MariaDB column', () => {
  it.each([
    ['tinytext', 'text'],
    ['text', 'text'],
    ['mediumtext', 'text'],
    ['longtext', 'text'],
    ['varchar(120)', 'varchar'],
    ['char(5)', 'varchar'],
    ['tinyint(4)', 'integer'],
    ['tinyint unsigned', 'integer'],
    ['smallint(6)', 'integer'],
    ['mediumint(9)', 'integer'],
    ['int', 'integer'],
    ['int(11)', 'integer'],
    ['int unsigned', 'integer'],
    ['bigint(20)', 'bigint'],
    ['bigint unsigned', 'bigint'],
    ['decimal(10,2)', 'decimal'],
    ['numeric(8,0)', 'decimal'],
    ['float', 'float'],
    ['double', 'float'],
    ['double precision', 'float'],
    ['real', 'float'],
    ['tinyint(1)', 'boolean'],
    ['tinyint(1) unsigned', 'boolean'],
    ['bit(1)', 'boolean'],
    ['date', 'date'],
    ['time', 'time'],
    ['datetime', 'timestamp'],
    ['datetime(6)', 'timestamp'],
    ['timestamp', 'timestamptz'],
    ['timestamp(3)', 'timestamptz'],
    ['year', 'integer'],
    ['json', 'json'],
    ["enum('a','b')", 'enum'],
    ["set('a','b')", 'text'],
    ['blob', 'binary'],
    ['varbinary(255)', 'binary'],
    ['binary(16)', 'binary'],
    ['uuid', 'uuid'], // MariaDB ≥ 10.7 native type
    ['inet6', 'inet'],
    ['point', 'geometry'],
    ['geometry', 'geometry'],
    ['whatever(3)', 'unknown'],
  ] as const)('%s → %s', (columnType, logicalType) => {
    expect(mapMysqlType(columnType).logicalType).toBe(logicalType);
  });

  it('extracts varchar/char lengths from COLUMN_TYPE', () => {
    expect(mapMysqlType('varchar(120)').maxLength).toBe(120);
    expect(mapMysqlType('char(36)').maxLength).toBe(36);
    expect(mapMysqlType('text').maxLength).toBeNull();
  });

  it('extracts decimal precision and scale', () => {
    expect(mapMysqlType('decimal(10,2)')).toMatchObject({
      numericPrecision: 10,
      numericScale: 2,
    });
    expect(mapMysqlType('float').numericPrecision).toBe(24);
    expect(mapMysqlType('double').numericPrecision).toBe(53);
  });

  it('flags unsigned int/bigint overflow (05 §4.2)', () => {
    expect(mapMysqlType('int unsigned')).toMatchObject({
      unsigned: true,
      warning: 'unsigned-overflow',
    });
    expect(mapMysqlType('bigint unsigned').warning).toBe('unsigned-overflow');
    expect(mapMysqlType('smallint unsigned').warning).toBeNull();
    expect(mapMysqlType('int').warning).toBeNull();
  });

  it('flags year → integer and set(...) → text', () => {
    expect(mapMysqlType('year').warning).toBe('year-as-integer');
    expect(mapMysqlType("set('a','b')").warning).toBe('set-as-text');
  });

  it('tinyint(1) → boolean is the documented policy; other widths are integers', () => {
    expect(mapMysqlType('tinyint(1)').logicalType).toBe('boolean');
    expect(mapMysqlType('tinyint(2)').logicalType).toBe('integer');
    expect(mapMysqlType('tinyint').logicalType).toBe('integer');
  });
});

describe('parseEnumValues — COLUMN_TYPE enum(...)/set(...) parsing (05 §4.2)', () => {
  it('parses ordered enum values', () => {
    expect(parseEnumValues("enum('todo','doing','done')")).toEqual(['todo', 'doing', 'done']);
  });

  it('parses set values', () => {
    expect(parseEnumValues("set('red','green','blue')")).toEqual(['red', 'green', 'blue']);
  });

  it('unescapes doubled and backslash-escaped quotes', () => {
    expect(parseEnumValues("enum('it''s fine','meh')")).toEqual(["it's fine", 'meh']);
    expect(parseEnumValues("enum('it\\'s fine','meh')")).toEqual(["it's fine", 'meh']);
  });

  it('returns null for non-enum types', () => {
    expect(parseEnumValues('varchar(10)')).toBeNull();
    expect(parseEnumValues('int')).toBeNull();
  });
});

describe('classifyMysqlDefault — 05 §4.2', () => {
  it('EXTRA auto_increment wins regardless of default text', () => {
    expect(classifyMysqlDefault(null, 'auto_increment')).toEqual({ kind: 'autoincrement' });
    expect(classifyMysqlDefault('0', 'AUTO_INCREMENT')).toEqual({ kind: 'autoincrement' });
  });

  it('CURRENT_TIMESTAMP spellings are now (MySQL and MariaDB forms)', () => {
    expect(classifyMysqlDefault('CURRENT_TIMESTAMP', '')).toEqual({ kind: 'now' });
    expect(classifyMysqlDefault('current_timestamp()', '')).toEqual({ kind: 'now' });
    expect(classifyMysqlDefault('CURRENT_TIMESTAMP(6)', 'DEFAULT_GENERATED')).toEqual({
      kind: 'now',
    });
  });

  it('uuid() defaults are uuid', () => {
    expect(classifyMysqlDefault('uuid()', 'DEFAULT_GENERATED')).toEqual({ kind: 'uuid' });
  });

  it('literals keep their text (MySQL unquoted and MariaDB quoted forms)', () => {
    expect(classifyMysqlDefault('active', '')).toEqual({ kind: 'literal', text: 'active' });
    expect(classifyMysqlDefault("'active'", '')).toEqual({ kind: 'literal', text: "'active'" });
    expect(classifyMysqlDefault('0', '')).toEqual({ kind: 'literal', text: '0' });
    expect(classifyMysqlDefault('-3.5', '')).toEqual({ kind: 'literal', text: '-3.5' });
  });

  it('MySQL 8 DEFAULT_GENERATED expressions are expressions', () => {
    expect(classifyMysqlDefault("(concat('ORD-',_utf8mb4'x'))", 'DEFAULT_GENERATED')).toEqual({
      kind: 'expression',
      text: "(concat('ORD-',_utf8mb4'x'))",
    });
  });

  it('no default / NULL default → null', () => {
    expect(classifyMysqlDefault(null, '')).toBeNull();
    expect(classifyMysqlDefault('NULL', '')).toBeNull();
  });
});

describe('parseCheckEnum — CHECK (col IN (...)) synthesis (05 §4.2)', () => {
  it('parses the MySQL 8 CHECK_CLAUSE form (backticks + charset introducers)', () => {
    expect(
      parseCheckEnum("(`tier` in (_utf8mb4\\'free\\',_utf8mb4\\'pro\\',_utf8mb4\\'team\\'))"),
    ).toEqual({ column: 'tier', values: ['free', 'pro', 'team'] });
  });

  it('parses the MariaDB CHECK_CLAUSE form (plain quotes)', () => {
    expect(parseCheckEnum("`tier` in ('free','pro')")).toEqual({
      column: 'tier',
      values: ['free', 'pro'],
    });
  });

  it('returns null for non-enum checks', () => {
    expect(parseCheckEnum('(`price` > 0)')).toBeNull();
    expect(parseCheckEnum('(char_length(`name`) > 2)')).toBeNull();
  });
});

describe('detectServerFlavor — the §4.2 support gate', () => {
  it.each([
    ['8.0.36', 'mysql', true],
    ['8.4.3', 'mysql', true],
    ['9.1.0', 'mysql', true],
    ['5.7.44', 'mysql', false],
    ['10.5.23-MariaDB', 'mariadb', true],
    ['11.4.2-MariaDB-1:11.4.2+maria~ubu2404', 'mariadb', true],
    ['5.5.5-10.6.14-MariaDB', 'mariadb', true],
    ['10.4.33-MariaDB', 'mariadb', false],
  ] as const)('%s → %s supported=%s', (version, flavor, supported) => {
    expect(detectServerFlavor(version)).toMatchObject({ flavor, supported });
  });
});

describe('interpretProbe / interpretGrants — read-only detection (05 §4.2)', () => {
  it('reads @@read_only in its numeric and string forms', () => {
    const base = {
      server_version: '8.4.3',
      role_name: 'app@%',
      database_name: 'northwind',
    };
    expect(interpretProbe({ ...base, read_only: 0 }).readOnly).toBe(false);
    expect(interpretProbe({ ...base, read_only: 1 }).readOnly).toBe(true);
    expect(interpretProbe({ ...base, read_only: '1' }).readOnly).toBe(true);
  });

  it('ALL PRIVILEGES grants everything', () => {
    const rows = [{ g: 'GRANT ALL PRIVILEGES ON *.* TO `root`@`localhost` WITH GRANT OPTION' }];
    expect(interpretGrants(rows, 'northwind')).toEqual({
      canSelect: true,
      canWrite: true,
      canDDL: true,
    });
  });

  it('a SELECT-only grant on the database reads as read-only', () => {
    const rows = [
      { g: 'GRANT USAGE ON *.* TO `ro`@`%`' },
      { g: 'GRANT SELECT ON `northwind`.* TO `ro`@`%`' },
    ];
    expect(interpretGrants(rows, 'northwind')).toEqual({
      canSelect: true,
      canWrite: false,
      canDDL: false,
    });
  });

  it('grants scoped to a different database are ignored', () => {
    const rows = [{ g: 'GRANT ALL PRIVILEGES ON `other`.* TO `app`@`%`' }];
    expect(interpretGrants(rows, 'northwind')).toEqual({
      canSelect: false,
      canWrite: false,
      canDDL: false,
    });
  });

  it('write grants without DDL read as writable, not DDL-capable', () => {
    const rows = [{ g: 'GRANT SELECT, INSERT, UPDATE, DELETE ON `northwind`.* TO `app`@`%`' }];
    expect(interpretGrants(rows, 'northwind')).toEqual({
      canSelect: true,
      canWrite: true,
      canDDL: false,
    });
  });
});

describe('identifier quoting + serialization policy', () => {
  it('backtick-quotes and escapes identifiers; max length is 64', () => {
    expect(quoteIdentifier('order_details')).toBe('`order_details`');
    expect(quoteIdentifier('weird`name')).toBe('`weird``name`');
    expect(MYSQL_MAX_IDENTIFIER_LENGTH).toBe(64);
  });

  it('bigint and decimal stay strings end to end (lossless policy)', () => {
    const bigint = mysqlSerializers.bigint;
    const decimal = mysqlSerializers.decimal;
    expect(bigint?.fromDb('18446744073709551615')).toBe('18446744073709551615');
    expect(bigint?.toDb(42n)).toBe('42');
    expect(decimal?.fromDb('12345678901234567890.12')).toBe('12345678901234567890.12');
    expect(decimal?.toDb(19.99)).toBe('19.99');
  });

  it('tinyint(1) 0/1 wire values become booleans', () => {
    const boolean = mysqlSerializers.boolean;
    expect(boolean?.fromDb(1)).toBe(true);
    expect(boolean?.fromDb(0)).toBe(false);
    expect(boolean?.toDb(true)).toBe(1);
    expect(boolean?.toDb(false)).toBe(0);
  });

  it('timestamps serialize to ISO-8601 UTC; dates keep their SQL text form', () => {
    const when = new Date(Date.UTC(2026, 6, 1, 12, 30, 0));
    expect(mysqlSerializers.timestamptz?.fromDb(when)).toBe('2026-07-01T12:30:00.000Z');
    expect(mysqlSerializers.timestamp?.fromDb(when)).toBe('2026-07-01T12:30:00.000Z');
    expect(mysqlSerializers.date?.fromDb(new Date(2026, 6, 1))).toBe('2026-07-01');
    expect(mysqlSerializers.date?.fromDb('2026-07-01')).toBe('2026-07-01');
  });

  it('json binds as a single stringified parameter', () => {
    expect(mysqlSerializers.json?.toDb({ a: 1 })).toBe('{"a":1}');
  });

  it('blobs are excluded from CRUD v1 — no binary serializer', () => {
    expect(mysqlSerializers.binary).toBeUndefined();
  });
});
