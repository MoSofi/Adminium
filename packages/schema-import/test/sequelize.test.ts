// SPDX-License-Identifier: AGPL-3.0-only
/** Sequelize parser — golden model over both define() and Model.init forms. */
import { describe, expect, it } from 'vitest';

import { parseSchemaFile } from '../src/index.js';
import { column, loadFixture, relationBetween, table } from './helpers.js';

describe('sequelize fixture', () => {
  const { model, format, warnings } = parseSchemaFile(loadFixture('northwind-sequelize.js.txt'));

  it('detects sequelize (generic dialect) and reads both forms', () => {
    expect(format).toBe('sequelize');
    expect(model.dialect).toBe('generic');
    expect(model.tables.map((t) => t.name).sort()).toEqual([
      'categories',
      'customers',
      'orders',
      'products',
      'suppliers',
    ]);
  });

  it('maps DataTypes incl. args', () => {
    const name = column(model, 'categories', 'name');
    expect(name.logicalType).toBe('varchar');
    expect(name.maxLength).toBe(60);
    expect(column(model, 'categories', 'description').logicalType).toBe('text');
    const price = column(model, 'products', 'unit_price');
    expect(price.logicalType).toBe('decimal');
    expect(price.numericPrecision).toBe(10);
    expect(price.numericScale).toBe(2);
    expect(column(model, 'customers', 'id').logicalType).toBe('uuid');
    expect(column(model, 'orders', 'ordered_at').logicalType).toBe('timestamptz');
  });

  it('handles allowNull/unique/primaryKey/autoIncrement/defaultValue', () => {
    expect(column(model, 'products', 'sku').nullable).toBe(false);
    expect(column(model, 'products', 'sku').isUnique).toBe(true);
    expect(table(model, 'orders').primaryKey).toEqual(['id']);
    expect(column(model, 'orders', 'id').default).toEqual({ kind: 'autoincrement' });
    expect(column(model, 'products', 'unit_price').default).toEqual({ kind: 'literal', text: '0' });
    expect(column(model, 'customers', 'id').default).toEqual({ kind: 'uuid' });
    expect(column(model, 'orders', 'ordered_at').default).toEqual({ kind: 'now' });
  });

  it('honors field: (column rename) and comment', () => {
    expect(column(model, 'suppliers', 'company_name')).toBeDefined();
    expect(column(model, 'products', 'unit_price').comment).toBe('Price per unit in USD');
  });

  it('creates FKs from references: {model, key} with onDelete', () => {
    const rel = relationBetween(model, 'products', 'categories');
    expect(rel?.kind).toBe('declared-fk');
    expect(rel?.onDelete).toBe('set-null');
    expect(column(model, 'orders', 'customer_id').references).toEqual({
      tableId: 'public.customers',
      column: 'id',
    });
    expect(model.relations.length).toBe(3);
  });

  it('turns DataTypes.ENUM into an EnumDef', () => {
    const status = column(model, 'products', 'status');
    expect(status.logicalType).toBe('enum');
    const def = model.enums.find((e) => e.id === status.enumRef);
    expect(def?.values).toEqual(['active', 'backorder', 'discontinued']);
    expect(status.default).toEqual({ kind: 'literal', text: 'active' });
  });

  it('synthesizes createdAt/updatedAt for timestamps: true (underscored)', () => {
    expect(column(model, 'products', 'created_at').logicalType).toBe('timestamptz');
    expect(column(model, 'products', 'updated_at').nullable).toBe(false);
    // categories opted out
    expect(table(model, 'categories').columns.map((c) => c.name)).toEqual([
      'id',
      'name',
      'description',
    ]);
  });

  it('warns about skipped association calls', () => {
    expect(warnings.some((w) => /association calls/.test(w))).toBe(true);
  });
});
