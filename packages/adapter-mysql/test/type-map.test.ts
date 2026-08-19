// SPDX-License-Identifier: AGPL-3.0-only
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

describe('ReDoS hardening — COLUMN_TYPE parsing is linear (CodeQL js/polynomial-redos)', () => {
  // COLUMN_TYPE is not fully trusted input: an application that lets users name
  // things puts their text into a column type and into enum labels, and this
  // module parses that text verbatim. Each string below is the pathological
  // input CodeQL named for one alert; the wall-clock figures in the comments
  // are what the previous unanchored regexes actually cost, measured.
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

  it('mapMysqlType: a type that opens parens and never closes one (~4.5s before)', () => {
    const hostile = `varchar${'('.repeat(50_000)}`;
    const { ms, value } = timed(() => mapMysqlType(hostile));
    expect(ms).toBeLessThan(BUDGET_MS);
    // Unclosed parens are not a modifier, so nothing is stripped and the base
    // name stays unmappable — exactly what /\([^)]*\)/ produced.
    expect(value.logicalType).toBe('unknown');
  });

  it("parseEnumValues: an unterminated label repeating \\'& (~11.3s before)", () => {
    const hostile = `enum('${"\\'&".repeat(50_000)})`;
    const { ms, value } = timed(() => parseEnumValues(hostile));
    expect(ms).toBeLessThan(BUDGET_MS);
    // No closing quote is reachable, so no literal is produced — as before.
    expect(value).toEqual([]);
  });

  it.each([
    // The whole modifier/attribute grammar the rewritten scan has to preserve.
    ['varchar(255)', { logicalType: 'varchar', maxLength: 255 }],
    ['char(36)', { logicalType: 'varchar', maxLength: 36 }],
    ['varbinary(255)', { logicalType: 'binary', maxLength: 255 }],
    ['decimal(10,2)', { logicalType: 'decimal', numericPrecision: 10, numericScale: 2 }],
    ['decimal(10, 2)', { logicalType: 'decimal', numericPrecision: 10, numericScale: 2 }],
    ['int(11) unsigned', { logicalType: 'integer', unsigned: true }],
    ['int unsigned zerofill', { logicalType: 'integer', unsigned: true }],
    ['tinyint(1)', { logicalType: 'boolean' }],
    ['double precision', { logicalType: 'float' }],
    ['timestamp(3)', { logicalType: 'timestamptz' }],
    ['  VARCHAR(64)  ', { logicalType: 'varchar', maxLength: 64 }],
    ['varchar', { logicalType: 'varchar', maxLength: null }],
    ['varchar(', { logicalType: 'unknown' }],
    ['varchar)', { logicalType: 'unknown' }],
  ] as const)('mapMysqlType keeps its grammar: %s', (columnType, expected) => {
    expect(mapMysqlType(columnType)).toMatchObject(expected);
  });

  it.each([
    ["enum('todo','doing','done')", ['todo', 'doing', 'done']],
    ["set('red','green')", ['red', 'green']],
    ["enum('it''s fine','meh')", ["it's fine", 'meh']],
    ["enum('it\\'s fine','meh')", ["it's fine", 'meh']],
    ["ENUM ( 'a' , 'b' )", ['a', 'b']],
    ["enum('')", ['']],
    ["enum('a,b','c')", ['a,b', 'c']],
    ["enum('back\\\\slash','x')", ['back\\\\slash', 'x']],
    ["enum('a')", ['a']],
    ["enum('a','b'", null], // no closing paren: not an enum at all
  ] as const)('parseEnumValues keeps its grammar: %s', (columnType, expected) => {
    expect(parseEnumValues(columnType)).toEqual(expected);
  });
});

describe('ReDoS hardening — CHECK (col IN (…)) parsing is linear', () => {
  // Not on CodeQL's list: the postgres and sqlite adapters carry the same
  // `CHECK_IN_PATTERN` and were flagged (js/polynomial-redos #7 and #9), while
  // this byte-identical copy was missed. CHECK_CLAUSE comes back from
  // information_schema as whatever text the application put in the DDL, so it
  // is the same untrusted surface. Figures below are measured on the previous
  // one-piece pattern.
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

  it('parseCheckEnum: one long word before a real clause (~6.5s before)', () => {
    // `[\w$]*` and the `\s+` after it retried every split of the word run at
    // every offset inside it: 8 KB 105 ms, 16 KB 407 ms, 32 KB 1.6 s — 4x per
    // doubling. The clause that follows must still be found.
    const hostile = `${'a'.repeat(64_000)} status in ('new','done')`;
    const { ms, value } = timed(() => parseCheckEnum(hostile));
    expect(ms).toBeLessThan(BUDGET_MS);
    expect(value).toEqual({ column: 'status', values: ['new', 'done'] });
  });

  it('parseCheckEnum: `col in (` opened 40k times and never closed (~37.6s before)', () => {
    // `([^)]+)\)` rescanned to end-of-string at every start offset: 8 KB 15 ms,
    // 16 KB 61 ms, 32 KB 245 ms — 4x per doubling.
    const hostile = '`x` in ('.repeat(40_000);
    const { ms, value } = timed(() => parseCheckEnum(hostile));
    expect(ms).toBeLessThan(BUDGET_MS);
    expect(value).toBeNull();
  });

  it.each([
    ["status in ('new','done')", { column: 'status', values: ['new', 'done'] }],
    ["`status` IN ('new')", { column: 'status', values: ['new'] }],
    [`"status" in ('new')`, { column: 'status', values: ['new'] }],
    ["_x9$ in ('a')", { column: '_x9$', values: ['a'] }],
    ["status  in \t ('a','b')", { column: 'status', values: ['a', 'b'] }],
    ["mood in ('it''s fine','meh')", { column: 'mood', values: ["it's fine", 'meh'] }],
    // MySQL 8 backslash escaping: normalizeCheckClause turns `\'` into a bare
    // `'`, which then reads as the end of the literal. Unchanged, quirk and all.
    ["mood in ('it\\'s fine')", { column: 'mood', values: ['it'] }],
    ["s in (_utf8mb4'a',_utf8mb4'b')", { column: 's', values: ['a', 'b'] }], // charset introducer
    ["s in ('a') and t in ('b')", { column: 's', values: ['a'] }], // leftmost wins
    ['length(note) > 2', null],
    ["s in('a')", null], // `\s+` before `(` is required, as it always was
    ['s in (1,2)', null], // no string literals: nothing to synthesize
    ["s in ('a'", null], // unclosed list
    ['s in ()', null], // empty list — the `+` never matched empty
    // An empty list must not stop the search: the one-piece pattern retried at
    // the next offset and found the second clause, and so must the split one.
    ["a in () b in ('z')", { column: 'b', values: ['z'] }],
  ] as const)('parseCheckEnum keeps its grammar: %s', (clause, expected) => {
    expect(parseCheckEnum(clause)).toEqual(expected);
  });

  it('bounding the identifier at MySQL\'s 64 only truncates impossible names', () => {
    const legal = 'a'.repeat(MYSQL_MAX_IDENTIFIER_LENGTH);
    expect(parseCheckEnum(`${legal} in ('x')`)).toEqual({ column: legal, values: ['x'] });
    // 65+ characters cannot name a MySQL column. The head now matches the last
    // 64 rather than the whole run — a deliberate, documented narrowing.
    const illegal = 'a'.repeat(MYSQL_MAX_IDENTIFIER_LENGTH + 16);
    expect(parseCheckEnum(`${illegal} in ('x')`)).toEqual({ column: legal, values: ['x'] });
  });
});

describe('mapMysqlType — modifier edge cases', () => {
  it('reads bit(1) as boolean and a bare bit as boolean too', () => {
    // `bit` with no modifier defaults to bit(1) in MySQL.
    expect(mapMysqlType('bit(1)').logicalType).toBe('boolean');
    expect(mapMysqlType('bit').logicalType).toBe('boolean');
  });

  it('does not read a wider bit as boolean', () => {
    expect(mapMysqlType('bit(8)').logicalType).not.toBe('boolean');
  });

  it('does not read a wider tinyint as boolean', () => {
    // tinyint(4) is an ordinary small integer; only the (1) display width is
    // the boolean convention.
    expect(mapMysqlType('tinyint(4)').logicalType).toBe('integer');
    expect(mapMysqlType('tinyint').logicalType).toBe('integer');
  });

  it('leaves decimal precision/scale null when the modifier is absent', () => {
    expect(mapMysqlType('decimal')).toMatchObject({
      logicalType: 'decimal',
      numericPrecision: null,
      numericScale: null,
    });
  });

  it('reads a decimal precision given without a scale', () => {
    expect(mapMysqlType('decimal(10)')).toMatchObject({
      logicalType: 'decimal',
      numericPrecision: 10,
      numericScale: null,
    });
  });

  it('leaves varchar maxLength null when the modifier is absent', () => {
    expect(mapMysqlType('varchar').maxLength).toBeNull();
    expect(mapMysqlType('text').maxLength).toBeNull();
  });
});

describe('parseEnumValues — escaping inside the value list', () => {
  it('reads a doubled quote as one literal quote', () => {
    expect(parseEnumValues("enum('it''s','fine')")).toEqual(["it's", 'fine']);
  });

  it('reads a backslash-escaped quote', () => {
    expect(parseEnumValues("enum('it\\'s','fine')")).toEqual(["it's", 'fine']);
  });

  it('does not run past a trailing backslash with nothing after it', () => {
    // A truncated/garbled COLUMN_TYPE must terminate the scan rather than
    // reading off the end of the string.
    expect(parseEnumValues("enum('a','b\\")).toBeNull();
  });

  it('stops at a newline inside an unterminated value', () => {
    expect(parseEnumValues("enum('a','b\\\n")).toBeNull();
  });

  it('returns null for a non-enum type', () => {
    expect(parseEnumValues('varchar(10)')).toBeNull();
  });
});

describe('classifyMysqlDefault — expression defaults', () => {
  it('classifies a parenthesised expression as an expression default', () => {
    expect(classifyMysqlDefault('(`a` + `b`)', '')).toEqual({
      kind: 'expression',
      text: '(`a` + `b`)',
    });
  });

  it('classifies a function call as an expression default', () => {
    expect(classifyMysqlDefault("(concat(_utf8mb4'a',_utf8mb4'b'))", '')).toMatchObject({
      kind: 'expression',
    });
  });

  it('classifies a bare word as a literal — MySQL 8 strips the quotes', () => {
    expect(classifyMysqlDefault('free', '')).toEqual({ kind: 'literal', text: 'free' });
  });

  it('treats an explicit NULL default as no default', () => {
    expect(classifyMysqlDefault('NULL', '')).toBeNull();
    expect(classifyMysqlDefault(null, '')).toBeNull();
  });

  it('lets auto_increment win over any default text', () => {
    expect(classifyMysqlDefault('5', 'auto_increment')).toEqual({ kind: 'autoincrement' });
  });
});
