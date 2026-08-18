// SPDX-License-Identifier: AGPL-3.0-only
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

  it('accepts the `$schema` pointer the docs tell you to write', () => {
    // THE BUG THIS PINS. The JSON IR guide told readers to add
    // `"$schema": ".../ir-v1.json"` so their editor validates while they type.
    // Every IR object is a Zod strictObject, so that key made the document
    // unimportable: the page's own recommended workflow produced a file
    // Adminium rejected at `<root>: Unrecognized key: "$schema"`.
    const withPointer = JSON.stringify({
      $schema: 'https://docs.adminium.dev/schemas/ir-v1.json',
      irVersion: 1,
      dialect: 'generic',
      name: 'tiny',
      tables: [{ name: 't', columns: [{ name: 'id' }] }],
    });
    const { model } = parseSchemaFile(withPointer);
    expect(model.name).toBe('tiny');
    expect(model.tables).toHaveLength(1);
  });

  it('still rejects a non-string `$schema` — that is data, not editor metadata', () => {
    const shady = JSON.stringify({
      $schema: { tables: 'not a pointer' },
      irVersion: 1,
      dialect: 'generic',
      name: 'tiny',
      tables: [{ name: 't', columns: [{ name: 'id' }] }],
    });
    expect(() => parseSchemaFile(shady, { format: 'json' })).toThrowError(/\$schema/);
  });

  it('leaves every other unknown key failing loudly', () => {
    const typo = JSON.stringify({
      irVersion: 1,
      dialect: 'generic',
      name: 'tiny',
      tabels: [],
      tables: [{ name: 't', columns: [{ name: 'id' }] }],
    });
    expect(() => parseSchemaFile(typo, { format: 'json' })).toThrowError(/tabels/);
  });

  it('opts.name overrides the document name', () => {
    const { model } = parseSchemaFile(loadFixture('northwind-ir.json'), { name: 'renamed' });
    expect(model.name).toBe('renamed');
  });
});
