// SPDX-License-Identifier: AGPL-3.0-only
/**
 * SQL DDL parser — pg_dump golden model (ALTER-declared PKs/FKs!), mysqldump
 * golden model, CHECK→enum synthesis in both spellings, skip warnings.
 */
import { describe, expect, it } from 'vitest';

import { parseSchemaFile } from '../src/index.js';
import { column, loadFixture, relationBetween, table } from './helpers.js';

describe('pg_dump fixture', () => {
  const { model, format, warnings } = parseSchemaFile(loadFixture('northwind-pg.sql'), {
    name: 'northwind',
  });

  it('is detected as sql with postgres dialect', () => {
    expect(format).toBe('sql');
    expect(model.dialect).toBe('postgres');
    expect(model.source).toEqual({ kind: 'import', format: 'sql-ddl' });
    expect(model.name).toBe('northwind');
  });

  it('parses all six tables', () => {
    expect(model.tables.map((t) => t.name).sort()).toEqual([
      'categories',
      'customers',
      'order_items',
      'orders',
      'products',
      'suppliers',
    ]);
    expect(model.stats.tableCount).toBe(6);
  });

  it('applies ALTER TABLE … ADD CONSTRAINT PRIMARY KEY (pg_dump declares PKs via ALTER)', () => {
    expect(table(model, 'categories').primaryKey).toEqual(['id']);
    expect(column(model, 'categories', 'id').isPrimaryKey).toBe(true);
    // composite PK
    expect(table(model, 'order_items').primaryKey).toEqual(['order_id', 'product_id']);
  });

  it('applies ALTER TABLE … ADD CONSTRAINT FOREIGN KEY with ON DELETE', () => {
    const rel = relationBetween(model, 'products', 'categories');
    expect(rel).toBeDefined();
    expect(rel?.kind).toBe('declared-fk');
    expect(rel?.onDelete).toBe('set-null');
    expect(column(model, 'products', 'category_id').references).toEqual({
      tableId: 'public.categories',
      column: 'id',
    });
    expect(relationBetween(model, 'orders', 'customers')?.onDelete).toBe('cascade');
    expect(model.relations).toHaveLength(5);
  });

  it('maps types, lengths and precision', () => {
    const price = column(model, 'products', 'unit_price');
    expect(price.logicalType).toBe('decimal');
    expect(price.numericPrecision).toBe(10);
    expect(price.numericScale).toBe(2);
    const name = column(model, 'products', 'name');
    expect(name.logicalType).toBe('varchar');
    expect(name.maxLength).toBe(160);
    expect(column(model, 'products', 'tags').isArray).toBe(true);
    expect(column(model, 'customers', 'id').logicalType).toBe('uuid');
    expect(column(model, 'orders', 'ordered_at').logicalType).toBe('timestamptz');
  });

  it('classifies defaults (nextval → autoincrement via ALTER COLUMN SET DEFAULT)', () => {
    expect(column(model, 'categories', 'id').default).toEqual({ kind: 'autoincrement' });
    expect(column(model, 'customers', 'id').default).toEqual({ kind: 'uuid' });
    expect(column(model, 'orders', 'ordered_at').default).toEqual({ kind: 'now' });
    expect(column(model, 'suppliers', 'country').default).toEqual({ kind: 'literal', text: 'USA' });
  });

  it('resolves CREATE TYPE … AS ENUM columns', () => {
    const status = column(model, 'orders', 'status');
    expect(status.logicalType).toBe('enum');
    expect(status.enumRef).toBe('public.order_status');
    const def = model.enums.find((e) => e.id === 'public.order_status');
    expect(def?.source).toBe('native');
    expect(def?.values).toEqual(['pending', 'paid', 'shipped', 'delivered', 'cancelled']);
  });

  it('synthesizes an enum from the pg_dump ANY(ARRAY[…]) CHECK spelling', () => {
    const tier = column(model, 'suppliers', 'tier');
    expect(tier.logicalType).toBe('enum');
    const def = model.enums.find((e) => e.id === tier.enumRef);
    expect(def?.source).toBe('check');
    expect(def?.values).toEqual(['standard', 'preferred', 'strategic']);
  });

  it('records unique constraints and indexes', () => {
    expect(column(model, 'products', 'sku').isUnique).toBe(true);
    expect(column(model, 'customers', 'email').isUnique).toBe(true);
    const products = table(model, 'products');
    expect(products.indexes.some((ix) => ix.name === 'idx_products_category')).toBe(true);
    const exprIdx = products.indexes.find((ix) => ix.name === 'idx_products_name_lower');
    expect(exprIdx?.expression).toBeTruthy();
    const uniqueIdx = table(model, 'orders').indexes.find(
      (ix) => ix.name === 'idx_orders_customer_ordered_at',
    );
    expect(uniqueIdx?.unique).toBe(true);
  });

  it('applies COMMENT ON', () => {
    expect(table(model, 'products').comment).toBe('Catalog products');
    expect(column(model, 'products', 'unit_price').comment).toBe('Price per unit in USD');
  });

  it('skips INSERT/COPY/SET/GRANT with aggregated warnings, never throws', () => {
    expect(warnings.some((w) => /skipped INSERT statement/.test(w))).toBe(true);
    expect(warnings.some((w) => /skipped SET statement/.test(w))).toBe(true);
    expect(model.warnings.length).toBeGreaterThan(0);
  });
});

describe('mysqldump fixture', () => {
  const { model, warnings } = parseSchemaFile(loadFixture('northwind-mysql.sql'));

  it('sniffs the mysql dialect from backticks/ENGINE=', () => {
    expect(model.dialect).toBe('mysql');
  });

  it('parses inline PKs, uniques and FKs', () => {
    expect(table(model, 'products').primaryKey).toEqual(['id']);
    expect(table(model, 'order_items').primaryKey).toEqual(['order_id', 'product_id']);
    expect(column(model, 'products', 'sku').isUnique).toBe(true);
    const rel = relationBetween(model, 'orders', 'customers');
    expect(rel?.onDelete).toBe('cascade');
  });

  it('maps enum(…) column types to EnumDefs (source column-type)', () => {
    const status = column(model, 'products', 'status');
    expect(status.logicalType).toBe('enum');
    const def = model.enums.find((e) => e.id === status.enumRef);
    expect(def?.source).toBe('column-type');
    expect(def?.values).toEqual(['active', 'backorder', 'discontinued']);
  });

  it('maps tinyint(1) to boolean and set(…) to text with a warning', () => {
    expect(column(model, 'products', 'is_active').logicalType).toBe('boolean');
    expect(column(model, 'products', 'badges').logicalType).toBe('text');
    expect(warnings.some((w) => /SET column/.test(w))).toBe(true);
  });

  it('parses AUTO_INCREMENT and CURRENT_TIMESTAMP defaults', () => {
    expect(column(model, 'products', 'id').default).toEqual({ kind: 'autoincrement' });
    expect(column(model, 'products', 'created_at').default).toEqual({ kind: 'now' });
  });

  it('reads table and column COMMENTs', () => {
    expect(table(model, 'categories').comment).toBe('Product categories');
    expect(column(model, 'products', 'sku').comment).toBe('Stock keeping unit');
  });
});

describe('sql adversarial cases', () => {
  it('sqlite AUTOINCREMENT sniffs sqlite dialect', () => {
    const { model } = parseSchemaFile(
      'CREATE TABLE notes (id INTEGER PRIMARY KEY AUTOINCREMENT, body TEXT NOT NULL);',
    );
    expect(model.dialect).toBe('sqlite');
    expect(column(model, 'notes', 'id').default).toEqual({ kind: 'autoincrement' });
  });

  it('IN (…) CHECK spelling synthesizes an enum', () => {
    const { model } = parseSchemaFile(
      `CREATE TABLE jobs (id int PRIMARY KEY, state text NOT NULL CHECK (state IN ('queued','running','done')));`,
    );
    const state = column(model, 'jobs', 'state');
    expect(state.logicalType).toBe('enum');
    expect(model.enums[0]?.values).toEqual(['queued', 'running', 'done']);
  });

  it('drops FKs to tables not in the file with a warning instead of throwing', () => {
    const { model, warnings } = parseSchemaFile(
      'CREATE TABLE a (id int PRIMARY KEY, b_id int REFERENCES b(id));',
    );
    expect(column(model, 'a', 'b_id').references).toBeNull();
    expect(model.relations).toHaveLength(0);
    expect(warnings.some((w) => /not part of the import/.test(w))).toBe(true);
  });

  it('keeps going past unparseable statements', () => {
    const { model, warnings } = parseSchemaFile(
      'CREATE TABLE ((((;\nCREATE TABLE ok (id int PRIMARY KEY);',
    );
    expect(model.tables.map((t) => t.name)).toEqual(['ok']);
    expect(warnings.some((w) => /could not parse/.test(w))).toBe(true);
  });

  it('ignores semicolons inside string literals and dollar quotes', () => {
    const { model } = parseSchemaFile(
      `CREATE FUNCTION f() RETURNS void AS $$ SELECT ';'; $$ LANGUAGE sql;\n` +
        `CREATE TABLE t (id int PRIMARY KEY, note text DEFAULT 'a;b');`,
    );
    expect(column(model, 't', 'note').default).toEqual({ kind: 'literal', text: 'a;b' });
  });
});
