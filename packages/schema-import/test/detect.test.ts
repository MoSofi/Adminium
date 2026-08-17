// SPDX-License-Identifier: AGPL-3.0-only
/** Format auto-detection matrix over the realistic fixtures + adversarial input. */
import { describe, expect, it } from 'vitest';

import { detectCandidates, detectFormat, parseSchemaFile, SchemaImportError } from '../src/index.js';
import { loadFixture } from './helpers.js';

describe('detectFormat', () => {
  it.each([
    ['northwind-pg.sql', 'sql'],
    ['northwind-mysql.sql', 'sql'],
    ['northwind.prisma', 'prisma'],
    ['northwind-drizzle.ts.txt', 'drizzle'],
    ['northwind-typeorm.ts.txt', 'typeorm'],
    ['northwind-sequelize.js.txt', 'sequelize'],
    ['northwind-schema.rb', 'rails'],
    ['northwind-models.py', 'django'],
    ['northwind-ir.json', 'json'],
  ] as const)('%s → %s', (fixture, expected) => {
    expect(detectFormat(loadFixture(fixture))).toBe(expected);
  });

  it('returns null for prose', () => {
    expect(detectFormat('Hello, this is not a schema at all.')).toBeNull();
  });

  it('returns null for arbitrary JSON without IR markers', () => {
    expect(detectFormat('{"foo": 1}')).toBeNull();
  });

  it('detects JSON IR by irVersion even without tables', () => {
    expect(detectFormat('{"irVersion": 1}')).toBe('json');
  });

  it('prefers the higher-priority format on mixed content and warns', () => {
    // Rails migration helper that also contains raw SQL.
    const mixed = `${loadFixture('northwind-schema.rb')}\n# CREATE TABLE legacy (id int);\n`;
    const candidates = detectCandidates(mixed);
    expect(candidates[0]).toBe('rails');
    expect(candidates).toContain('sql');
    const result = parseSchemaFile(mixed);
    expect(result.format).toBe('rails');
    expect(result.warnings.some((w) => w.includes('multiple formats'))).toBe(true);
  });

  it('opts.format overrides detection', () => {
    const sql = 'CREATE TABLE t (id integer PRIMARY KEY);';
    const result = parseSchemaFile(sql, { format: 'sql' });
    expect(result.format).toBe('sql');
  });

  it('throws SchemaImportError with guidance on undetectable input', () => {
    expect(() => parseSchemaFile('once upon a time')).toThrowError(SchemaImportError);
    expect(() => parseSchemaFile('once upon a time')).toThrowError(/supported formats/);
  });

  it('throws on empty input', () => {
    expect(() => parseSchemaFile('   ')).toThrowError(/empty/);
  });
});
