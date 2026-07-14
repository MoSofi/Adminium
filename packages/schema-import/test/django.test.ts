/** Django models.py parser — golden model over the Northwind-ish fixture. */
import { describe, expect, it } from 'vitest';

import { parseSchemaFile } from '../src/index.js';
import { column, loadFixture, relationBetween, table } from './helpers.js';

describe('django fixture', () => {
  const { model, format, warnings } = parseSchemaFile(loadFixture('northwind-models.py'));

  it('detects django (generic dialect); db_table honored', () => {
    expect(format).toBe('django');
    expect(model.dialect).toBe('generic');
    expect(model.tables.map((t) => t.name).sort()).toEqual([
      'categories',
      'customers',
      'orders',
      'products',
      'products_tags', // synthesized M2M join table
      'suppliers',
      'tags',
    ]);
  });

  it('adds the implicit id pk unless primary_key=True is present', () => {
    const id = column(model, 'categories', 'id');
    expect(id.isPrimaryKey).toBe(true);
    expect(id.logicalType).toBe('bigint');
    const custId = column(model, 'customers', 'id');
    expect(custId.isPrimaryKey).toBe(true);
    expect(custId.logicalType).toBe('uuid');
    expect(custId.default).toEqual({ kind: 'uuid' });
  });

  it('maps field types incl. EmailField/JSONField/DecimalField', () => {
    const name = column(model, 'categories', 'name');
    expect(name.logicalType).toBe('varchar');
    expect(name.maxLength).toBe(60);
    expect(name.isUnique).toBe(true);
    const email = column(model, 'suppliers', 'contact_email');
    expect(email.maxLength).toBe(254);
    expect(email.nullable).toBe(true);
    expect(column(model, 'customers', 'profile').logicalType).toBe('json');
    const price = column(model, 'products', 'unit_price');
    expect(price.numericPrecision).toBe(10);
    expect(price.numericScale).toBe(2);
  });

  it('django columns are NOT NULL unless null=True', () => {
    expect(column(model, 'products', 'name').nullable).toBe(false);
    expect(column(model, 'categories', 'description').nullable).toBe(true);
  });

  it('turns choices= into an enum', () => {
    const status = column(model, 'products', 'status');
    expect(status.logicalType).toBe('enum');
    const def = model.enums.find((e) => e.id === status.enumRef);
    expect(def?.values).toEqual(['active', 'backorder', 'discontinued']);
    expect(status.default).toEqual({ kind: 'literal', text: 'active' });
  });

  it('creates <field>_id FK columns with on_delete mapping', () => {
    const categoryId = column(model, 'products', 'category_id');
    expect(categoryId.nullable).toBe(true);
    expect(categoryId.references).toEqual({ tableId: 'public.categories', column: 'id' });
    expect(relationBetween(model, 'products', 'categories')?.onDelete).toBe('set-null');
    expect(relationBetween(model, 'products', 'suppliers')?.onDelete).toBe('restrict');
    expect(relationBetween(model, 'orders', 'customers')?.onDelete).toBe('cascade');
  });

  it('auto_now/auto_now_add → now default; timezone.now default → now', () => {
    expect(column(model, 'products', 'created_at').default).toEqual({ kind: 'now' });
    expect(column(model, 'products', 'updated_at').default).toEqual({ kind: 'now' });
    expect(column(model, 'orders', 'ordered_at').default).toEqual({ kind: 'now' });
  });

  it('synthesizes a join table for ManyToManyField with a warning', () => {
    const join = table(model, 'products_tags');
    expect(join.columns.map((c) => c.name)).toEqual(['id', 'product_id', 'tag_id']);
    const m2m = model.relations.find((r) => r.kind === 'inferred-join-table');
    expect(m2m?.cardinality).toBe('many-to-many');
    expect(m2m?.through?.tableId).toBe('public.products_tags');
    expect(warnings.some((w) => /synthesized join table "products_tags"/.test(w))).toBe(true);
  });

  it('warns that table names assume a missing app label', () => {
    // categories/products/… use Meta.db_table, so no warning for those; but the
    // synthesized join table and any model without db_table would warn. Force one:
    const src = 'from django.db import models\n\nclass Invoice(models.Model):\n    number = models.CharField(max_length=10)\n';
    const { model: m, warnings: w } = parseSchemaFile(src, { format: 'django' });
    expect(m.tables[0]?.name).toBe('invoice');
    expect(w.some((msg) => /app label unknown/.test(msg))).toBe(true);
  });

  it('records unique_together as a composite unique with FK fields remapped to columns', () => {
    expect(
      table(model, 'products').uniques.some((u) => u.columns.join(',') === 'sku,supplier_id'),
    ).toBe(true);
  });

  it('skips unsupported field types with a warning', () => {
    const src =
      'from django.db import models\n\nclass Thing(models.Model):\n    point = models.PointField()\n    name = models.CharField(max_length=5)\n';
    const { model: m, warnings: w } = parseSchemaFile(src, { format: 'django' });
    expect(column(m, 'thing', 'name')).toBeDefined();
    expect(w.some((msg) => /PointField/.test(msg))).toBe(true);
  });
});
