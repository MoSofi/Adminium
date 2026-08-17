// SPDX-License-Identifier: AGPL-3.0-only
/** TypeORM parser — golden model over the Northwind-ish entity file. */
import { describe, expect, it } from 'vitest';

import { parseSchemaFile } from '../src/index.js';
import { column, loadFixture, relationBetween, table } from './helpers.js';

describe('typeorm fixture', () => {
  const { model, format, warnings } = parseSchemaFile(loadFixture('northwind-typeorm.ts.txt'));

  it('detects typeorm (generic dialect)', () => {
    expect(format).toBe('typeorm');
    expect(model.dialect).toBe('generic');
  });

  it('uses @Entity names, snake_case fallback warns', () => {
    expect(model.tables.map((t) => t.name).sort()).toEqual([
      'categories',
      'customer',
      'orders',
      'products',
      'suppliers',
    ]);
    expect(warnings.some((w) => /assumed snake_case "customer"/.test(w))).toBe(true);
  });

  it('parses @PrimaryGeneratedColumn (increment and uuid)', () => {
    const id = column(model, 'categories', 'id');
    expect(id.isPrimaryKey).toBe(true);
    expect(id.default).toEqual({ kind: 'autoincrement' });
    const custId = column(model, 'customer', 'id');
    expect(custId.logicalType).toBe('uuid');
    expect(custId.default).toEqual({ kind: 'uuid' });
  });

  it('parses @Column options: type/length/nullable/unique/default/comment', () => {
    const name = column(model, 'categories', 'name');
    expect(name.logicalType).toBe('varchar');
    expect(name.maxLength).toBe(60);
    expect(name.isUnique).toBe(true);
    expect(name.nullable).toBe(false);
    expect(column(model, 'categories', 'description').nullable).toBe(true);
    const price = column(model, 'products', 'unitPrice');
    expect(price.logicalType).toBe('decimal');
    expect(price.numericPrecision).toBe(10);
    expect(price.default).toEqual({ kind: 'literal', text: '0' });
    expect(column(model, 'suppliers', 'companyName').comment).toBe('Legal company name');
  });

  it('infers the column type from the TS property type when @Column has no type', () => {
    expect(column(model, 'customer', 'email').logicalType).toBe('varchar');
    expect(column(model, 'products', 'active').logicalType).toBe('boolean');
  });

  it('resolves @Column enum via the TS enum declaration', () => {
    const status = column(model, 'products', 'status');
    expect(status.logicalType).toBe('enum');
    const def = model.enums.find((e) => e.id === status.enumRef);
    expect(def?.values).toEqual(['pending', 'paid', 'shipped', 'cancelled']);
  });

  it('builds FKs from @ManyToOne + @JoinColumn, typed from the target pk', () => {
    const categoryId = column(model, 'products', 'category_id');
    expect(categoryId.references).toMatchObject({ tableId: 'public.categories', column: 'id' });
    expect(categoryId.logicalType).toBe('integer');
    const rel = relationBetween(model, 'products', 'categories');
    expect(rel?.onDelete).toBe('set-null');
    const custRel = relationBetween(model, 'orders', 'customer');
    expect(custRel?.onDelete).toBe('cascade');
    expect(column(model, 'orders', 'customer_id').logicalType).toBe('uuid');
  });

  it('applies the <prop>_id convention with a warning when @JoinColumn is absent', () => {
    expect(column(model, 'products', 'supplier_id').references).toMatchObject({
      tableId: 'public.suppliers',
    });
    expect(warnings.some((w) => /assumed FK column "supplier_id"/.test(w))).toBe(true);
  });

  it('skips @OneToMany without inventing columns', () => {
    expect(table(model, 'categories').columns.map((c) => c.name)).toEqual([
      'id',
      'name',
      'description',
    ]);
  });

  it('handles @CreateDateColumn/@UpdateDateColumn and @Index/@Unique', () => {
    expect(column(model, 'products', 'created_at').default).toEqual({ kind: 'now' });
    expect(column(model, 'products', 'updated_at').logicalType).toBe('timestamp');
    expect(table(model, 'products').indexes.some((ix) => ix.name === 'idx_products_name')).toBe(true);
    expect(table(model, 'products').uniques.some((u) => u.columns.includes('sku'))).toBe(true);
  });
});
