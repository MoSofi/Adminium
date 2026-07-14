/** Prisma parser — golden model over the Northwind-ish fixture. */
import { describe, expect, it } from 'vitest';

import { parseSchemaFile, SchemaImportError } from '../src/index.js';
import { column, loadFixture, relationBetween, table } from './helpers.js';

describe('prisma fixture', () => {
  const { model, format } = parseSchemaFile(loadFixture('northwind.prisma'), { name: 'northwind' });

  it('detects prisma and maps the datasource provider to the dialect', () => {
    expect(format).toBe('prisma');
    expect(model.dialect).toBe('postgres');
    expect(model.source).toEqual({ kind: 'import', format: 'prisma' });
  });

  it('honors @@map for table names and @map for columns', () => {
    expect(model.tables.map((t) => t.name).sort()).toEqual([
      'categories',
      'customers',
      'order_items',
      'orders',
      'products',
      'suppliers',
    ]);
    expect(column(model, 'products', 'category_id')).toBeDefined();
  });

  it('maps scalar types (incl. @db.* refinements)', () => {
    const name = column(model, 'categories', 'name');
    expect(name.logicalType).toBe('varchar');
    expect(name.maxLength).toBe(60);
    expect(name.isUnique).toBe(true);
    expect(column(model, 'products', 'price').logicalType).toBe('decimal');
    expect(column(model, 'orders', 'id').logicalType).toBe('bigint');
    expect(column(model, 'products', 'active').logicalType).toBe('boolean');
  });

  it('handles ?→nullable and @id/@@id', () => {
    expect(column(model, 'categories', 'description').nullable).toBe(true);
    expect(column(model, 'categories', 'name').nullable).toBe(false);
    expect(table(model, 'categories').primaryKey).toEqual(['id']);
    expect(table(model, 'order_items').primaryKey).toEqual(['order_id', 'product_id']);
  });

  it('classifies @default(autoincrement/now/uuid/literal)', () => {
    expect(column(model, 'categories', 'id').default).toEqual({ kind: 'autoincrement' });
    expect(column(model, 'customers', 'id').default).toEqual({ kind: 'uuid' });
    expect(column(model, 'products', 'created_at').default).toEqual({ kind: 'now' });
    expect(column(model, 'orders', 'status').default).toEqual({ kind: 'literal', text: 'PENDING' });
  });

  it('turns enum blocks into EnumDefs and enum-typed columns', () => {
    const def = model.enums.find((e) => e.id === 'OrderStatus');
    expect(def?.values).toEqual(['PENDING', 'PAID', 'SHIPPED', 'DELIVERED', 'cancelled']);
    expect(column(model, 'orders', 'status').enumRef).toBe('OrderStatus');
    expect(column(model, 'orders', 'status').logicalType).toBe('enum');
  });

  it('creates declared FKs from @relation(fields/references) and skips back-relations', () => {
    const rel = relationBetween(model, 'products', 'categories');
    expect(rel?.kind).toBe('declared-fk');
    expect(rel?.onDelete).toBe('set-null');
    expect(column(model, 'orders', 'customer_id').references).toEqual({
      tableId: 'public.customers',
      column: 'id',
    });
    // Back-relation fields (products, orders, items) never became columns.
    expect(table(model, 'categories').columns.map((c) => c.name)).toEqual([
      'id',
      'name',
      'description',
    ]);
    expect(model.relations.length).toBe(5);
  });

  it('keeps /// doc comments', () => {
    expect(table(model, 'categories').comment).toContain('storefront nav');
    expect(column(model, 'products', 'price').comment).toBe('Price per unit in USD');
  });

  it('records @@index', () => {
    expect(table(model, 'products').indexes.some((ix) => ix.columns.includes('category_id'))).toBe(
      true,
    );
  });

  it('throws when no model blocks exist', () => {
    expect(() => parseSchemaFile('datasource db { provider = "postgresql" }', { format: 'prisma' }))
      .toThrowError(SchemaImportError);
  });
});
