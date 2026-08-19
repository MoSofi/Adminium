// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The three modules every parser shares: the native-type map, the
 * CHECK-constraint reader and the string-scanning primitives. They are unit
 * tested directly because each is a contract several parsers depend on — a
 * regression here shows up as a subtly wrong column in seven formats at once.
 */
import { describe, expect, it } from 'vitest';

import { extractCheckEnum } from '../src/check-enum.js';
import {
  collectStrings,
  findBalanced,
  parseArgs,
  pluralize,
  scalarValue,
  singularize,
  splitTopLevel,
  stringLiteral,
  stripComments,
  unquoteIdent,
} from '../src/text.js';
import { classifySqlDefault, isSerialType, mapSqlType } from '../src/type-map.js';

describe('mapSqlType', () => {
  it('extracts length for string and binary types', () => {
    expect(mapSqlType('varchar(120)')).toMatchObject({ logicalType: 'varchar', maxLength: 120 });
    expect(mapSqlType('character varying')).toMatchObject({
      logicalType: 'varchar',
      maxLength: null,
    });
    expect(mapSqlType('varbinary(16)')).toMatchObject({ logicalType: 'binary', maxLength: 16 });
  });

  it('extracts precision and scale for numeric types', () => {
    expect(mapSqlType('numeric(10,2)')).toMatchObject({
      logicalType: 'decimal',
      numericPrecision: 10,
      numericScale: 2,
    });
    expect(mapSqlType('double precision')).toMatchObject({
      logicalType: 'float',
      numericPrecision: null,
    });
  });

  it('applies the mysql2 tinyint(1) = boolean convention only at width 1', () => {
    expect(mapSqlType('tinyint(1)').logicalType).toBe('boolean');
    expect(mapSqlType('tinyint(4)').logicalType).toBe('integer');
    expect(mapSqlType('tinyint').logicalType).toBe('integer');
  });

  it('ignores the mysql unsigned/zerofill noise words', () => {
    expect(mapSqlType('int(11) unsigned zerofill')).toMatchObject({ logicalType: 'integer' });
    expect(mapSqlType('bigint unsigned').logicalType).toBe('bigint');
  });

  it('keeps the tail of a parameterized multi-word type', () => {
    expect(mapSqlType('timestamp(6) with time zone').logicalType).toBe('timestamptz');
    expect(mapSqlType('time(3) without time zone').logicalType).toBe('time');
  });

  it('recognizes both array spellings', () => {
    expect(mapSqlType('text[]')).toMatchObject({ logicalType: 'text', isArray: true });
    expect(mapSqlType('text[][]')).toMatchObject({ logicalType: 'text', isArray: true });
    expect(mapSqlType('integer ARRAY')).toMatchObject({ logicalType: 'integer', isArray: true });
    expect(mapSqlType('varchar(20)[]')).toMatchObject({
      logicalType: 'varchar',
      maxLength: 20,
      isArray: true,
    });
  });

  it('returns unknown rather than guessing for an unmapped type', () => {
    expect(mapSqlType('tsrange').logicalType).toBe('unknown');
    expect(mapSqlType('ltree').logicalType).toBe('unknown');
  });
});

describe('isSerialType', () => {
  it('matches the three pg serial pseudo-types and nothing that merely starts with them', () => {
    expect(isSerialType('serial')).toBe(true);
    expect(isSerialType('BIGSERIAL')).toBe(true);
    expect(isSerialType(' smallserial ')).toBe(true);
    expect(isSerialType('serialized_state')).toBe(false);
    expect(isSerialType('text')).toBe(false);
  });
});

describe('classifySqlDefault', () => {
  it('treats an empty or all-cast expression as no default', () => {
    expect(classifySqlDefault('   ')).toBeNull();
    expect(classifySqlDefault('NULL')).toBeNull();
  });

  it('unwraps the parentheses mysql and pg_dump add', () => {
    expect(classifySqlDefault('((0))')).toEqual({ kind: 'literal', text: '0' });
    expect(classifySqlDefault("('draft')")).toEqual({ kind: 'literal', text: 'draft' });
    expect(classifySqlDefault('()')).toEqual({ kind: 'expression', text: '()' });
  });

  it('recognizes the timestamp and uuid generator spellings', () => {
    for (const expr of [
      'now()',
      'CURRENT_TIMESTAMP',
      'current_timestamp(3)',
      'CURRENT_DATE',
      'getdate()',
      'transaction_timestamp()',
      'statement_timestamp()',
    ]) {
      expect(classifySqlDefault(expr)).toEqual({ kind: 'now' });
    }
    for (const expr of ['gen_random_uuid()', 'uuid_generate_v4()', 'uuid_generate_v1()']) {
      expect(classifySqlDefault(expr)).toEqual({ kind: 'uuid' });
    }
    expect(classifySqlDefault("nextval('t_id_seq'::regclass)")).toEqual({ kind: 'autoincrement' });
  });

  it('classifies literals, keeping quotes off and doubled quotes collapsed', () => {
    expect(classifySqlDefault('TRUE')).toEqual({ kind: 'literal', text: 'true' });
    expect(classifySqlDefault('-1.5')).toEqual({ kind: 'literal', text: '-1.5' });
    expect(classifySqlDefault("'it''s'")).toEqual({ kind: 'literal', text: "it's" });
    expect(classifySqlDefault('"quoted"')).toEqual({ kind: 'literal', text: 'quoted' });
  });

  it('keeps anything else as an opaque expression', () => {
    expect(classifySqlDefault("(now() + '1 day'::interval)")).toMatchObject({ kind: 'expression' });
  });
});

describe('extractCheckEnum', () => {
  it('reads the IN (…) spelling with every identifier quoting style', () => {
    expect(extractCheckEnum("status IN ('a','b')")).toEqual({
      column: 'status',
      values: ['a', 'b'],
    });
    expect(extractCheckEnum(`"status" IN ('a')`)).toEqual({ column: 'status', values: ['a'] });
    expect(extractCheckEnum('`status` IN (\'a\')')).toEqual({ column: 'status', values: ['a'] });
    expect(extractCheckEnum("[status] IN ('a')")).toEqual({ column: 'status', values: ['a'] });
  });

  it('reads the pg_dump = ANY (ARRAY[…]) spelling through its casts and parens', () => {
    expect(
      extractCheckEnum(
        "((tier)::text = ANY ((ARRAY['standard'::character varying, 'preferred'::character varying])::text[]))",
      ),
    ).toEqual({ column: 'tier', values: ['standard', 'preferred'] });
  });

  it('returns null for a CHECK that is not an enumeration', () => {
    expect(extractCheckEnum('quantity > 0')).toBeNull();
    expect(extractCheckEnum("status IN (1, 2)")).toBeNull();
    expect(extractCheckEnum('(a + b) > 0')).toBeNull();
    expect(extractCheckEnum('status = ANY (other_column)')).toBeNull();
  });

  it('returns null rather than half an enum when the list never closes', () => {
    expect(extractCheckEnum("status IN ('a', 'b'")).toBeNull();
    expect(extractCheckEnum("status = ANY (ARRAY['a'")).toBeNull();
  });
});

describe('text scanning primitives', () => {
  it('unquotes every identifier style and leaves bare words alone', () => {
    expect(unquoteIdent('"a""b"')).toBe('a"b');
    expect(unquoteIdent('`x`')).toBe('x');
    expect(unquoteIdent('[bracketed]')).toBe('bracketed');
    expect(unquoteIdent('bare')).toBe('bare');
    expect(unquoteIdent('"unterminated')).toBe('"unterminated');
  });

  it('splits at depth 0 only, treating strings and comments as opaque', () => {
    expect(splitTopLevel("a, f(b, c), 'd,e'", ',', { lineComments: ['--'] })).toEqual([
      'a',
      'f(b, c)',
      "'d,e'",
    ]);
    expect(splitTopLevel('a, -- b, c\n d', ',', { lineComments: ['--'] })).toEqual([
      'a',
      '-- b, c\n d',
    ]);
  });

  it('findBalanced returns -1 unless it is pointed at an opening bracket', () => {
    expect(findBalanced('(a(b))', 0)).toBe(5);
    expect(findBalanced('(a(b))', 2)).toBe(4);
    expect(findBalanced('xy', 0)).toBe(-1);
    expect(findBalanced('(a', 0)).toBe(-1);
    expect(findBalanced('', 0)).toBe(-1);
  });

  it('collects complete top-level string literals and drops an unterminated one', () => {
    expect(collectStrings("'a', 'b''c', 42, 'd")).toEqual(['a', "b'c"]);
    expect(collectStrings('no strings here')).toEqual([]);
  });

  it('honours backslash escapes only when asked', () => {
    // JS: the escaped quote keeps the literal open.
    expect(collectStrings("'a\\'b'", { backslashEscapes: true })).toEqual(["a'b"]);
    // SQL: a backslash escapes nothing, so the literal ends at that quote and
    // the `b'` left over is an unterminated fragment that is dropped.
    expect(collectStrings("'a\\'b'")).toEqual(['a\\']);
  });

  it('stripComments keeps newlines so line numbers survive', () => {
    const stripped = stripComments('a -- gone\nb /* also\ngone */ c', {
      lineComments: ['--'],
      blockComments: true,
    });
    expect(stripped.split('\n')).toHaveLength(3);
    expect(stripped.replace(/\s+/g, ' ').trim()).toBe('a b c');
  });

  it('stripComments never touches a comment opener inside a string', () => {
    expect(stripComments("a '-- not a comment' b", { lineComments: ['--'] })).toBe(
      "a '-- not a comment' b",
    );
  });

  it('stringLiteral only accepts a fully quoted value', () => {
    expect(stringLiteral(" 'x' ")).toBe('x');
    expect(stringLiteral('"x"')).toBe('x');
    expect(stringLiteral('x')).toBeNull();
    expect(stringLiteral("'x")).toBeNull();
  });

  it('scalarValue reads the python and js spellings of the primitives', () => {
    expect(scalarValue("'x'")).toBe('x');
    expect(scalarValue('12')).toBe(12);
    expect(scalarValue('-1.5')).toBe(-1.5);
    expect(scalarValue('true')).toBe(true);
    expect(scalarValue('True')).toBe(true);
    expect(scalarValue('false')).toBe(false);
    expect(scalarValue('False')).toBe(false);
    expect(scalarValue('some_const')).toBeNull();
  });

  it('parseArgs separates positional from named in all three styles', () => {
    expect(parseArgs("'users', :string, null: false, limit: 60", 'ruby')).toEqual({
      positional: ["'users'", ':string'],
      named: { null: 'false', limit: '60' },
    });
    expect(parseArgs("'Category', on_delete=models.CASCADE, null=True", 'python')).toEqual({
      positional: ["'Category'"],
      named: { on_delete: 'models.CASCADE', null: 'True' },
    });
    expect(parseArgs("type: DataTypes.STRING(60), 'quoted-key': 1", 'js')).toEqual({
      positional: [],
      named: { type: 'DataTypes.STRING(60)', 'quoted-key': '1' },
    });
  });

  it('pluralize and singularize round-trip the shapes the FK conventions rely on', () => {
    expect(pluralize('order')).toBe('orders');
    expect(pluralize('category')).toBe('categories');
    expect(pluralize('box')).toBe('boxes');
    expect(pluralize('dish')).toBe('dishes');
    expect(pluralize('day')).toBe('days'); // vowel + y keeps the y

    expect(singularize('orders')).toBe('order');
    expect(singularize('categories')).toBe('category');
    expect(singularize('boxes')).toBe('box');
    expect(singularize('dishes')).toBe('dish');
    expect(singularize('address')).toBe('address'); // never strips a double s
  });
});
