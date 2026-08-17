// SPDX-License-Identifier: AGPL-3.0-only
/** Drizzle parser — golden model over the Northwind-ish fixture. */
import { describe, expect, it } from 'vitest';

import { parseSchemaFile } from '../src/index.js';
import { column, loadFixture, relationBetween, table } from './helpers.js';

describe('drizzle fixture', () => {
  const { model, format } = parseSchemaFile(loadFixture('northwind-drizzle.ts.txt'));

  it('detects drizzle; pgTable → postgres dialect', () => {
    expect(format).toBe('drizzle');
    expect(model.dialect).toBe('postgres');
  });

  it('parses all tables with db column names (not TS keys)', () => {
    expect(model.tables.map((t) => t.name).sort()).toEqual([
      'categories',
      'customers',
      'order_items',
      'orders',
      'products',
      'suppliers',
    ]);
    expect(column(model, 'products', 'unit_price')).toBeDefined();
    expect(column(model, 'products', 'is_active').logicalType).toBe('boolean');
  });

  it('maps builders (serial/varchar/numeric/timestamp withTimezone/uuid)', () => {
    expect(column(model, 'categories', 'id').default).toEqual({ kind: 'autoincrement' });
    const name = column(model, 'categories', 'name');
    expect(name.logicalType).toBe('varchar');
    expect(name.maxLength).toBe(60);
    const price = column(model, 'products', 'unit_price');
    expect(price.numericPrecision).toBe(10);
    expect(price.numericScale).toBe(2);
    expect(column(model, 'products', 'created_at').logicalType).toBe('timestamptz');
    expect(column(model, 'customers', 'id').logicalType).toBe('uuid');
    expect(column(model, 'customers', 'id').default).toEqual({ kind: 'uuid' });
  });

  it('applies .notNull()/.unique()/.primaryKey()/.default()', () => {
    expect(column(model, 'products', 'sku').nullable).toBe(false);
    expect(column(model, 'customers', 'email').isUnique).toBe(true);
    expect(table(model, 'categories').primaryKey).toEqual(['id']);
    expect(column(model, 'products', 'unit_price').default).toEqual({ kind: 'literal', text: '0' });
    expect(column(model, 'orders', 'ordered_at').default).toEqual({ kind: 'now' });
  });

  it('resolves pgEnum columns', () => {
    const def = model.enums.find((e) => e.id === 'order_status');
    expect(def?.values).toEqual(['pending', 'paid', 'shipped', 'delivered', 'cancelled']);
    expect(column(model, 'orders', 'status').enumRef).toBe('order_status');
  });

  it('resolves .references(() => other.col) incl. onDelete', () => {
    const rel = relationBetween(model, 'products', 'categories');
    expect(rel?.kind).toBe('declared-fk');
    expect(rel?.onDelete).toBe('set-null');
    expect(column(model, 'orders', 'customer_id').references).toEqual({
      tableId: 'public.customers',
      column: 'id',
    });
    expect(model.relations.length).toBe(5);
  });

  it('parses extras: composite primaryKey() and indexes', () => {
    expect(table(model, 'order_items').primaryKey).toEqual(['order_id', 'product_id']);
    const products = table(model, 'products');
    expect(products.indexes.some((ix) => ix.name === 'products_sku_idx' && ix.unique)).toBe(true);
    expect(products.indexes.some((ix) => ix.name === 'products_category_idx')).toBe(true);
  });

  it('warns on dynamic table names instead of throwing', () => {
    const src = `const t = pgTable(dynamicName, { id: serial('id') });\nconst ok = pgTable('ok', { id: serial('id').primaryKey() });`;
    const { model: m, warnings } = parseSchemaFile(src, { format: 'drizzle' });
    expect(m.tables.map((t) => t.name)).toEqual(['ok']);
    expect(warnings.some((w) => /non-literal name/.test(w))).toBe(true);
  });

  it('mysqlTable → mysql dialect', () => {
    const src = `const users = mysqlTable('users', { id: int('id').primaryKey() });`;
    const { model: m } = parseSchemaFile(src, { format: 'drizzle' });
    expect(m.dialect).toBe('mysql');
  });
});
