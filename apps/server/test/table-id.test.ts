// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The one reading of a real table string (`installs/table-id.ts`), and the
 * meta store's "who else uses this table?" that reads it the same way: a
 * qualified string is that schema's table exactly; a bare name is the
 * DEFAULT schema's, never a same-named table in another schema.
 */
import BetterSqlite3 from 'better-sqlite3';
import { appTablesRepo, createSqliteMetaDb, firstRun, realTableOf } from '@adminium/meta';
import { describe, expect, it } from 'vitest';

import { realOfTable, realOfTableId, recordIsTable, tableIdIn, tableIdModelOf, tableIdOrNull, tableOfReal } from '../src/installs/table-id.js';

/** Sorted by id, as a snapshot is: `analytics.orders` before `public.orders`. */
const MODEL = {
  defaultSchema: 'public',
  tables: [
    { id: 'analytics.orders', schema: 'analytics', name: 'orders' },
    { id: 'analytics.visits', schema: 'analytics', name: 'visits' },
    { id: 'public.orders', schema: 'public', name: 'orders' },
    { id: 'sales.orders', schema: 'sales', name: 'orders' },
  ],
};

describe('a real table string read against a model', () => {
  it('is the default schema\'s table when bare, and that schema\'s exactly when qualified', () => {
    expect(tableIdOrNull(MODEL, 'orders')).toBe('public.orders');
    expect(tableIdOrNull(MODEL, 'sales.orders')).toBe('sales.orders');
    expect(tableIdOrNull(MODEL, 'public.orders')).toBe('public.orders');
    expect(tableOfReal(MODEL, 'analytics.orders')?.schema).toBe('analytics');
  });

  it('never falls back to a table of that name in another schema', () => {
    // Only `analytics` has visits: a bare `visits` means the default schema's, which is not there.
    expect(tableIdOrNull(MODEL, 'visits')).toBeNull();
    expect(tableIdOrNull(MODEL, 'billing.orders')).toBeNull();
    // A table not made yet is named as the plan names it.
    expect(tableIdIn(MODEL, 'visits')).toBe('visits');
    expect(tableIdIn(MODEL, 'sales.orders')).toBe('sales.orders');
  });

  it('reads SQLite\'s `main` and a MySQL database as the default schema they are', () => {
    expect(tableIdOrNull({ defaultSchema: 'main', tables: [{ id: 'main.orders', schema: 'main', name: 'orders' }] }, 'orders')).toBe('main.orders');
    expect(tableIdOrNull({ defaultSchema: 'shop_db', tables: [{ id: 'shop_db.orders', schema: 'shop_db', name: 'orders' }] }, 'orders')).toBe('shop_db.orders');
  });

  it('goes back from a model table or id to the string a record names it by', () => {
    expect(realOfTable(MODEL, { schema: 'public', name: 'orders' })).toBe('orders');
    expect(realOfTable(MODEL, { schema: 'sales', name: 'orders' })).toBe('sales.orders');
    expect(realOfTableId(MODEL, 'public.orders')).toBe('orders');
    expect(realOfTableId(MODEL, 'sales.orders')).toBe('sales.orders');
    expect(realOfTableId({ defaultSchema: 'main' }, 'main.invoices')).toBe('invoices');
  });

  it('says whether a record is of a table, its schema read the same way', () => {
    const bare = { tableName: 'orders', schemaName: null };
    const sales = { tableName: 'orders', schemaName: 'sales' };
    expect(recordIsTable(bare, { schema: 'public', name: 'orders' }, 'public')).toBe(true);
    expect(recordIsTable(bare, { schema: 'sales', name: 'orders' }, 'public')).toBe(false);
    expect(recordIsTable(sales, { schema: 'sales', name: 'orders' }, 'public')).toBe(true);
    expect(recordIsTable(sales, { schema: 'public', name: 'orders' }, 'public')).toBe(false);
    // MySQL reads one database: whatever it is called, a record with no schema is of it.
    expect(recordIsTable(bare, { schema: 'shop_db', name: 'orders' }, null)).toBe(true);
  });

  it('reads a model built by hand, its schema taken from each id', () => {
    const loose = tableIdModelOf({ tables: [{ id: 'public.orders', name: 'orders' }, { id: 'sales.orders', name: 'orders' }] });
    expect(loose.defaultSchema).toBe('public');
    expect(tableIdOrNull(loose, 'orders')).toBe('public.orders');
    expect(tableIdOrNull(loose, 'sales.orders')).toBe('sales.orders');
  });
});

describe('the apps that record a table', () => {
  it('are found by the table\'s own schema: `sales.orders` and `orders` are two tables', async () => {
    const meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
    try {
      await firstRun(meta);
      await meta.db
        .insertInto('adminium_connections')
        .values({ id: 'conn_1', name: 'Shop', engine: 'postgres', sourceKind: 'dsn', introspectDsnEncrypted: 'sealed', settings: '{}', status: 'connected', disabledAt: null, createdAt: 1, updatedAt: 1 } as never)
        .execute();
      const records = appTablesRepo(meta);
      const base = { manifestId: null, connectionId: 'conn_1', owned: true, state: 'created' as const };
      await records.record({ ...base, appKey: 'till', ref: 'orders', tableName: 'orders' });
      await records.record({ ...base, appKey: 'shop', ref: 'orders', tableName: 'orders', schemaName: 'sales' });
      await records.record({ ...base, appKey: 'desk', ref: 'orders', tableName: 'orders', schemaName: 'sales' });
      const keys = async (real: string) => (await records.byTable('conn_1', real)).map((record) => record.appKey).sort();
      expect(await keys('orders')).toEqual(['till']);
      expect(await keys('sales.orders')).toEqual(['desk', 'shop']);
      expect(await keys('public.orders')).toEqual([]);

      // A later version that keeps the table in the default schema says so with `null`; leaving it out keeps the held schema.
      await records.record({ ...base, appKey: 'desk', ref: 'orders', tableName: 'orders' });
      expect(realTableOf((await records.find('conn_1', 'desk', 'orders'))!)).toBe('sales.orders');
      await records.record({ ...base, appKey: 'desk', ref: 'orders', tableName: 'orders', schemaName: null });
      expect(realTableOf((await records.find('conn_1', 'desk', 'orders'))!)).toBe('orders');
      expect(await keys('orders')).toEqual(['desk', 'till']);
    } finally {
      await meta.db.destroy();
    }
  });
});
