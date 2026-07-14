/** JSON IR parser — the public ingestion contract + pretty error mapping. */
import { describe, expect, it } from 'vitest';

import { parseSchemaFile, SchemaImportError } from '../src/index.js';
import { column, loadFixture } from './helpers.js';

describe('json ir fixture', () => {
  it('round-trips through parseDatabaseModel with defaults applied', () => {
    const { model, format, warnings } = parseSchemaFile(loadFixture('northwind-ir.json'));
    expect(format).toBe('json');
    expect(warnings).toEqual([]);
    expect(model.name).toBe('northwind');
    expect(model.dialect).toBe('postgres');
    // Table ids derived from schema+name; defaults filled in.
    expect(model.tables[0]?.id).toBe('public.categories');
    expect(column(model, 'products', 'status').enumRef).toBe('order_status');
    expect(model.relations[0]?.kind).toBe('declared-fk');
    // Defaults: capabilities all-false shape, stats defaulted.
    expect(model.capabilities.hasRLS).toBe(false);
  });

  it('accepts the minimal valid IR', () => {
    const minimal = JSON.stringify({
      irVersion: 1,
      dialect: 'generic',
      name: 'tiny',
      tables: [{ name: 't', columns: [{ name: 'id' }] }],
    });
    const { model } = parseSchemaFile(minimal);
    expect(model.tables[0]?.columns[0]?.logicalType).toBe('text');
  });

  it('maps schema violations to readable path: message lines', () => {
    const bad = JSON.stringify({
      irVersion: 1,
      dialect: 'postgres',
      name: 'x',
      tables: [{ name: 't', columns: [] }],
    });
    try {
      parseSchemaFile(bad);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(SchemaImportError);
      expect((error as SchemaImportError).message).toMatch(/tables\.0\.columns/);
      expect((error as SchemaImportError).details.length).toBeGreaterThan(0);
    }
  });

  it('rejects dangling references (referential integrity is part of the schema)', () => {
    const dangling = JSON.stringify({
      irVersion: 1,
      dialect: 'generic',
      name: 'x',
      tables: [
        {
          name: 't',
          columns: [{ name: 'id' }, { name: 'other_id', references: { tableId: 'public.missing', column: 'id' } }],
        },
      ],
    });
    expect(() => parseSchemaFile(dangling)).toThrowError(/unknown table/);
  });

  it('reports invalid JSON as a SchemaImportError', () => {
    expect(() => parseSchemaFile('{ "irVersion": 1, ', { format: 'json' })).toThrowError(
      /invalid JSON/,
    );
  });

  it('opts.name overrides the document name', () => {
    const { model } = parseSchemaFile(loadFixture('northwind-ir.json'), { name: 'renamed' });
    expect(model.name).toBe('renamed');
  });
});
