// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The `parseSchemaFile` entry point and the shared finalize pass in
 * ModelBuilder: what happens to references and constraints that do not
 * resolve. The contract is that an importable file NEVER fails because one
 * reference dangles — the reference is dropped and a warning names it.
 */
import { describe, expect, it } from 'vitest';

import { parseSchemaFile, SchemaImportError, type Format } from '../src/index.js';
import { column, relationBetween, table } from './helpers.js';

describe('parseSchemaFile options', () => {
  it('rejects a format name that is not one of FORMATS', () => {
    expect(() =>
      parseSchemaFile('CREATE TABLE t (id int);', { format: 'postgresql' as Format }),
    ).toThrow(/unknown format "postgresql"/);
  });

  it('rejects empty input before touching a parser', () => {
    expect(() => parseSchemaFile('   \n\t ')).toThrow(SchemaImportError);
  });

  it('records the original file name on model.source for provenance', () => {
    const { model } = parseSchemaFile('CREATE TABLE t (id integer PRIMARY KEY);', {
      fileName: 'dump-2024-06-01.sql',
    });
    expect(model.source).toEqual({
      kind: 'import',
      format: 'sql-ddl',
      fileName: 'dump-2024-06-01.sql',
    });
  });

  it('warns when the content matches more than one format and parses as the first', () => {
    // A drizzle file whose comment happens to contain CREATE TABLE.
    const src =
      "// CREATE TABLE users\nconst users = pgTable('users', { id: serial('id').primaryKey() });";
    const { format, warnings } = parseSchemaFile(src);
    expect(format).toBe('drizzle');
    expect(warnings.some((w) => /matches multiple formats \(drizzle, sql\)/.test(w))).toBe(true);
  });

  it('names the model after the format when no name is given', () => {
    const { model } = parseSchemaFile('CREATE TABLE t (id integer PRIMARY KEY);');
    expect(model.name).toBe('sql-import');
  });
});

describe('finalize — dangling references', () => {
  it('drops a single-column FK whose target column does not exist', () => {
    const { model, warnings } = parseSchemaFile(
      'CREATE TABLE customers (id integer PRIMARY KEY);\n' +
        'CREATE TABLE orders (id integer PRIMARY KEY, customer_id integer REFERENCES customers(nope));',
    );
    expect(column(model, 'orders', 'customer_id').references).toBeNull();
    expect(model.relations).toHaveLength(0);
    expect(warnings.some((w) => /column "nope" not found on "public.customers"/.test(w))).toBe(true);
  });

  it('drops a composite relation whose target table is not in the file', () => {
    const { model, warnings } = parseSchemaFile(
      'CREATE TABLE lines (a integer, b integer, FOREIGN KEY (a, b) REFERENCES ghost (x, y));',
    );
    expect(model.relations).toHaveLength(0);
    expect(warnings.some((w) => /table "public.ghost" is not part of the import/.test(w))).toBe(true);
  });

  it('drops a composite relation whose target columns do not exist', () => {
    const { model, warnings } = parseSchemaFile(
      'CREATE TABLE items (a integer, b integer);\n' +
        'CREATE TABLE lines (a integer, b integer, FOREIGN KEY (a, b) REFERENCES items (x, y));',
    );
    expect(model.relations).toHaveLength(0);
    expect(warnings.some((w) => /column "x" not found on "public.items"/.test(w))).toBe(true);
  });

  it('drops a primary key column that was never declared', () => {
    const { model, warnings } = parseSchemaFile(
      'CREATE TABLE t (id integer, PRIMARY KEY (id, missing));',
    );
    expect(table(model, 't').primaryKey).toEqual(['id']);
    expect(warnings.some((w) => /primary key column "missing" not found on "public.t"/.test(w))).toBe(
      true,
    );
  });

  it('keeps the first of two definitions of the same table', () => {
    const { model, warnings } = parseSchemaFile(
      'CREATE TABLE t (id integer PRIMARY KEY, first_only text);\n' +
        'CREATE TABLE t (id integer PRIMARY KEY, second_only text);',
    );
    expect(model.tables).toHaveLength(1);
    expect(table(model, 't').columns.map((c) => c.name)).toEqual(['id', 'first_only']);
    expect(warnings.some((w) => /duplicate definition of table "public.t" ignored/.test(w))).toBe(
      true,
    );
  });

  it('mirrors a relation onto its column regardless of declaration order', () => {
    // The relation field is declared BEFORE the scalar it points at, so the
    // column does not exist yet when the relation is read.
    const { model } = parseSchemaFile(
      `model Order {
  id         Int      @id
  customer   Customer @relation(fields: [customerId], references: [id])
  customerId Int
}

model Customer {
  id     Int     @id
  orders Order[]
}
`,
      { format: 'prisma' },
    );
    expect(column(model, 'Order', 'customerId').references).toEqual({
      tableId: 'public.Customer',
      column: 'id',
    });
    expect(relationBetween(model, 'Order', 'Customer')?.from.columns).toEqual(['customerId']);
  });
});

describe('json ir — $schema handling', () => {
  const base = {
    irVersion: 1,
    dialect: 'generic',
    name: 'tiny',
    tables: [{ name: 't', columns: [{ name: 'id' }] }],
  };

  it('strips a string $schema pointer so the documented editor workflow imports', () => {
    const { model } = parseSchemaFile(
      JSON.stringify({ $schema: 'https://adminium.dev/ir-v1.json', ...base }),
      { format: 'json' },
    );
    expect(model.name).toBe('tiny');
  });

  it('refuses to silently drop a $schema key that holds data', () => {
    expect(() =>
      parseSchemaFile(JSON.stringify({ $schema: { real: 'data' }, ...base }), { format: 'json' }),
    ).toThrow(SchemaImportError);
  });

  it('reports a JSON syntax error as a fatal import error', () => {
    expect(() => parseSchemaFile('{ "irVersion": 1, ', { format: 'json' })).toThrow(/invalid JSON/);
  });

  it('rejects a document that is not a JSON object', () => {
    expect(() => parseSchemaFile('[1, 2, 3]', { format: 'json' })).toThrow(SchemaImportError);
  });

  it('honours the name override for JSON IR imports', () => {
    const { model } = parseSchemaFile(JSON.stringify(base), { format: 'json', name: 'renamed' });
    expect(model.name).toBe('renamed');
  });
});
