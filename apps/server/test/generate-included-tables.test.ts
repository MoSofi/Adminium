// SPDX-License-Identifier: AGPL-3.0-only
/**
 * M5-T02 — `settings.includedTables` consumption in the generation pipeline:
 * the model is restricted to the persisted selection before `generatePages`,
 * join/system tables stay in the relation graph, and dangling FK mirrors /
 * relations to excluded tables are dropped. Offline (pure function).
 */
import { describe, expect, it } from 'vitest';
import { parseDatabaseModel } from '@adminium/engine';

import { filterModelToIncludedTables } from '../src/generate/run.js';

const MODEL = parseDatabaseModel({
  dialect: 'postgres',
  name: 'shop',
  source: { kind: 'live', connectionId: 'conn_1' },
  tables: [
    {
      name: 'customers',
      columns: [{ name: 'id', logicalType: 'integer', isPrimaryKey: true, nullable: false }],
      primaryKey: ['id'],
    },
    {
      name: 'orders',
      columns: [
        { name: 'id', logicalType: 'integer', isPrimaryKey: true, nullable: false },
        {
          name: 'customer_id',
          logicalType: 'integer',
          references: { tableId: 'public.customers', column: 'id' },
        },
        {
          name: 'session_id',
          logicalType: 'integer',
          references: { tableId: 'public.sessions', column: 'id' },
        },
      ],
      primaryKey: ['id'],
    },
    {
      name: 'sessions',
      columns: [{ name: 'id', logicalType: 'integer', isPrimaryKey: true, nullable: false }],
      primaryKey: ['id'],
      rowCountEstimate: 500_000,
    },
    {
      name: 'orders_products',
      columns: [{ name: 'order_id', logicalType: 'integer', nullable: false }],
      semantics: { role: 'join-table', hierarchy: null, polymorphic: [] },
    },
  ],
  relations: [
    {
      id: 'rel_orders_customers',
      kind: 'declared-fk',
      cardinality: 'one-to-many',
      from: { tableId: 'public.orders', columns: ['customer_id'] },
      to: { tableId: 'public.customers', columns: ['id'] },
    },
    {
      id: 'rel_orders_sessions',
      kind: 'declared-fk',
      cardinality: 'one-to-many',
      from: { tableId: 'public.orders', columns: ['session_id'] },
      to: { tableId: 'public.sessions', columns: ['id'] },
    },
  ],
});

describe('filterModelToIncludedTables', () => {
  it('returns the model untouched when no selection is stored', () => {
    expect(filterModelToIncludedTables(MODEL, undefined)).toBe(MODEL);
    expect(filterModelToIncludedTables(MODEL, [])).toBe(MODEL);
  });

  it('drops excluded tables but keeps join tables in the graph', () => {
    const filtered = filterModelToIncludedTables(MODEL, ['public.customers', 'public.orders']);
    const ids = filtered.tables.map((table) => table.id).sort();
    expect(ids).toEqual(['public.customers', 'public.orders', 'public.orders_products']);
  });

  it('drops relations and FK mirrors that point at excluded tables', () => {
    const filtered = filterModelToIncludedTables(MODEL, ['public.customers', 'public.orders']);
    expect(filtered.relations.map((relation) => relation.id)).toEqual(['rel_orders_customers']);
    const orders = filtered.tables.find((table) => table.id === 'public.orders');
    expect(orders?.columns.find((column) => column.name === 'customer_id')?.references).toEqual({
      tableId: 'public.customers',
      column: 'id',
    });
    expect(orders?.columns.find((column) => column.name === 'session_id')?.references).toBeNull();
  });
});
