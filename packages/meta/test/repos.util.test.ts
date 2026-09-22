// SPDX-License-Identifier: AGPL-3.0-only
/**
 * readJson must accept BOTH driver shapes (repos own JSON round-tripping):
 *  - serialized text — SQLite `text` columns always, or pg/mysql2 configured
 *    for JSON-as-string;
 *  - driver-decoded values — `pg` parses `jsonb` and `mysql2` parses `json`
 *    by default (what apps/server's connectMetaStore pools do), INCLUDING
 *    bare scalars: a stored `"violet"` arrives as the plain JS string
 *    `violet`. The old `typeof value === 'string' ? JSON.parse(value)` threw
 *    SyntaxError on every such scalar — the settings/prefs suites' failure
 *    mode on real Postgres and MySQL meta stores.
 */
import { describe, expect, it } from 'vitest';

import type { MetaDb } from '../src/connect.js';
import { packJson, readJson, readJsonFrom, readJsonOrNull } from '../src/repos/util.js';

describe('readJson driver-shape handling', () => {
  it('parses serialized text (SQLite text columns) for every JSON type', () => {
    expect(readJson(packJson({ a: 1 }))).toEqual({ a: 1 });
    expect(readJson(packJson([1, 'two']))).toEqual([1, 'two']);
    expect(readJson(packJson('violet'))).toBe('violet');
    expect(readJson(packJson(42))).toBe(42);
    expect(readJson(packJson(true))).toBe(true);
    expect(readJson(packJson(null))).toBeNull();
  });

  it('passes through driver-decoded objects, arrays, numbers, booleans', () => {
    expect(readJson({ a: 1 })).toEqual({ a: 1 });
    expect(readJson([1, 'two'])).toEqual([1, 'two']);
    expect(readJson(42)).toBe(42);
    expect(readJson(false)).toBe(false);
  });

  it('returns driver-decoded bare string scalars as-is instead of throwing', () => {
    // pg jsonb / mysql2 json hand a stored "violet" back as plain 'violet'.
    expect(readJson('violet')).toBe('violet');
    expect(readJson('dark')).toBe('dark');
    expect(readJson('not json at all')).toBe('not json at all');
  });

  it('readJsonOrNull keeps SQL NULL distinct from stored JSON null text', () => {
    expect(readJsonOrNull(null)).toBeNull();
    expect(readJsonOrNull(undefined)).toBeNull();
    expect(readJsonOrNull(packJson('violet'))).toBe('violet');
  });
});

describe('readJsonFrom reads by dialect, not by shape', () => {
  const on = (dialect: MetaDb['dialect']): MetaDb => ({ dialect }) as MetaDb;

  it('parses SQLite text, including a string whose content is itself JSON', () => {
    expect(readJsonFrom(on('sqlite'), packJson('2048'))).toBe('2048');
    expect(readJsonFrom(on('sqlite'), packJson({ a: 1 }))).toEqual({ a: 1 });
    expect(readJsonFrom(on('sqlite'), 'not json at all')).toBe('not json at all');
  });

  it('never re-parses a value postgres or mysql already decoded', () => {
    for (const dialect of ['postgres', 'mysql'] as const) {
      const read = readJsonFrom(on(dialect), '2048');
      expect(typeof read).toBe('string');
      expect(read).toBe('2048');
      expect(readJsonFrom(on(dialect), 'null')).toBe('null');
      expect(readJsonFrom(on(dialect), { a: 1 })).toEqual({ a: 1 });
    }
  });
});
