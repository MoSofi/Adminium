// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A column's database default, as the write path reads it: the value it
 * stores. A text default is its text, whatever it looks like; a number, a
 * boolean or a typed NULL is read as one; a quoted spelling (MariaDB's, or
 * one kept from before) is read without its quotes.
 */
import { describe, expect, it } from 'vitest';

import { literalDefault } from '../src/crud/column-rules.js';

const literal = (text: string) => ({ kind: 'literal' as const, text });

describe('literalDefault', () => {
  it('reads a text default as its text, even one that looks like something else', () => {
    expect(literalDefault(literal('true'), 'varchar')).toBe('true');
    expect(literalDefault(literal('null'), 'text')).toBe('null');
    expect(literalDefault(literal('a::b'), 'varchar')).toBe('a::b');
    expect(literalDefault(literal('queued'), 'varchar')).toBe('queued');
  });

  it('reads a quoted spelling without its quotes or cast', () => {
    expect(literalDefault(literal("'it''s'"), 'varchar')).toBe("it's");
    expect(literalDefault(literal("'away'::character varying"))).toBe('away');
  });

  it('reads a boolean, a number and a typed NULL as themselves', () => {
    expect(literalDefault(literal('true'), 'boolean')).toBe(true);
    expect(literalDefault(literal('1'), 'integer')).toBe('1');
    expect(literalDefault(literal('NULL::integer'), 'integer')).toBeNull();
    expect(literalDefault({ kind: 'now' })).toBeUndefined();
    expect(literalDefault(null)).toBeUndefined();
  });
});
