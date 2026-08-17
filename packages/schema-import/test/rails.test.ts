// SPDX-License-Identifier: AGPL-3.0-only
/** Rails schema.rb parser — golden model over the Northwind-ish fixture. */
import { describe, expect, it } from 'vitest';

import { parseSchemaFile } from '../src/index.js';
import { column, loadFixture, relationBetween, table } from './helpers.js';

describe('rails fixture', () => {
  const { model, format, warnings } = parseSchemaFile(loadFixture('northwind-schema.rb'));

  it('detects rails (generic dialect)', () => {
    expect(format).toBe('rails');
    expect(model.dialect).toBe('generic');
    expect(model.tables.map((t) => t.name).sort()).toEqual([
      'categories',
      'customers',
      'order_items',
      'orders',
      'products',
      'suppliers',
    ]);
  });

  it('adds the implicit bigint id pk (and uuid when id: :uuid)', () => {
    const id = column(model, 'categories', 'id');
    expect(id.isPrimaryKey).toBe(true);
    expect(id.logicalType).toBe('bigint');
    expect(id.default).toEqual({ kind: 'autoincrement' });
    const custId = column(model, 'customers', 'id');
    expect(custId.logicalType).toBe('uuid');
    expect(custId.default).toEqual({ kind: 'uuid' });
    // id: false → no pk
    expect(table(model, 'order_items').primaryKey).toEqual([]);
  });

  it('maps t.<type> with limit/precision/scale/null/default/comment', () => {
    const name = column(model, 'categories', 'name');
    expect(name.logicalType).toBe('varchar');
    expect(name.maxLength).toBe(60);
    expect(name.nullable).toBe(false);
    const price = column(model, 'products', 'unit_price');
    expect(price.numericPrecision).toBe(10);
    expect(price.numericScale).toBe(2);
    expect(price.default).toEqual({ kind: 'literal', text: '0.0' });
    expect(column(model, 'products', 'active').default).toEqual({ kind: 'literal', text: 'true' });
    expect(column(model, 'suppliers', 'company_name').comment).toBe('Legal company name');
    expect(column(model, 'orders', 'ordered_at').default).toEqual({ kind: 'now' });
  });

  it('expands t.references into <name>_id with convention FK + warning', () => {
    expect(column(model, 'products', 'category_id').references).toEqual({
      tableId: 'public.categories',
      column: 'id',
    });
    expect(warnings.some((w) => /pluralization convention/.test(w))).toBe(true);
    // Explicit foreign_key: { to_table:, on_delete: } form.
    const rel = relationBetween(model, 'products', 'suppliers');
    expect(rel?.onDelete).toBe('restrict');
  });

  it('expands t.timestamps', () => {
    expect(column(model, 'suppliers', 'created_at').nullable).toBe(false);
    expect(column(model, 'suppliers', 'updated_at').logicalType).toBe('timestamp');
  });

  it('applies add_foreign_key lines (column derived by singularization)', () => {
    expect(relationBetween(model, 'orders', 'customers')?.onDelete).toBe('cascade');
    expect(relationBetween(model, 'order_items', 'orders')?.onDelete).toBe('cascade');
    expect(relationBetween(model, 'order_items', 'products')).toBeDefined();
    expect(model.relations.length).toBe(5);
  });

  it('records t.index / add_index incl. unique', () => {
    expect(
      table(model, 'products').indexes.some((ix) => ix.name === 'index_products_on_sku' && ix.unique),
    ).toBe(true);
    expect(column(model, 'customers', 'email').isUnique).toBe(true);
    expect(
      table(model, 'orders').indexes.some((ix) => ix.name === 'index_orders_on_customer_id'),
    ).toBe(true);
  });

  it('synthesizes an enum from t.check_constraint "status IN (…)"', () => {
    const status = column(model, 'orders', 'status');
    expect(status.logicalType).toBe('enum');
    const def = model.enums.find((e) => e.id === status.enumRef);
    expect(def?.source).toBe('check');
    expect(def?.values).toEqual(['pending', 'paid', 'shipped', 'cancelled']);
  });

  it('skips execute blocks with a warning', () => {
    const src = `create_table "a" do |t|\n  t.string "x"\nend\nexecute <<-SQL\n  CREATE VIEW v AS SELECT 1;\nSQL\n`;
    const { warnings: w } = parseSchemaFile(src, { format: 'rails' });
    expect(w.some((msg) => /execute block/.test(msg))).toBe(true);
  });

  it('warns on unknown t. methods without failing', () => {
    const src = `create_table "a" do |t|\n  t.hstore "meta"\n  t.string "x"\nend\n`;
    const { model: m, warnings: w } = parseSchemaFile(src, { format: 'rails' });
    expect(column(m, 'a', 'x')).toBeDefined();
    expect(w.some((msg) => /t\.hstore/.test(msg))).toBe(true);
  });
});
