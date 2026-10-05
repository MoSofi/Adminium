// SPDX-License-Identifier: AGPL-3.0-only
/**
 * How a table is named inside another manifest's rows: by the manifest that
 * made it and that manifest's own short name, or by its id when nobody made
 * it. One resolver writes the form and reads it back.
 */
import type { AppTableRecord } from '@adminium/meta';
import { describe, expect, it } from 'vitest';

import { resolveTableRef, storedTableRef, type TableRefIndex } from '../src/apps/table-ref.js';

let n = 0;
const record = (over: Partial<AppTableRecord>): AppTableRecord => ({
  id: `apt_${String((n += 1)).padStart(3, '0')}`,
  appKey: 'shop',
  manifestId: 'mft_1',
  connectionId: 'conn_1',
  ref: 'orders',
  tableName: 'shop_orders',
  schemaName: null,
  owned: true,
  state: 'created',
  role: 'app',
  prefix: 'shop_',
  shape: null,
  rules: [],
  builtOn: null,
  shapeColumns: [],
  createdAt: n,
  updatedAt: n,
  releasedAt: null,
  ...over,
});
const TABLES = [
  { id: 'public.shop_orders', name: 'shop_orders' },
  { id: 'public.customers', name: 'customers' },
  { id: 'public.menu_items', name: 'menu_items' },
  { id: 'public.inventory_items', name: 'inventory_items' },
];
const index = (records: AppTableRecord[], tables = TABLES): TableRefIndex => ({ records, tables });

describe('the stored name of a table', () => {
  it('is its maker\'s key and short name when a manifest made it', () => {
    const made = index([record({})]);
    expect(storedTableRef(made, 'public.shop_orders')).toBe('shop:orders');
    expect(resolveTableRef(made, 'shop:orders')).toEqual({ tableId: 'public.shop_orders', maker: 'shop', ref: 'orders' });
  });

  it('is its id when nobody made it: a table only found and taken has no maker', () => {
    const adopted = index([record({ ref: 'customers', tableName: 'customers', owned: false, state: 'adopted', prefix: null })]);
    expect(storedTableRef(adopted, 'public.customers')).toBe('public.customers');
    expect(resolveTableRef(adopted, 'public.customers')).toEqual({ tableId: 'public.customers', maker: null, ref: null });
    // The adopter's key is not a name for it.
    expect(resolveTableRef(adopted, 'shop:customers')).toBeNull();
    expect(storedTableRef(index([]), 'public.customers')).toBe('public.customers');
  });

  it('is the EARLIEST owner\'s when two manifests record one table (a shared menu)', () => {
    const shared = index([
      record({ appKey: 'pos', ref: 'menu_items', tableName: 'menu_items', prefix: null }),
      record({ appKey: 'ordering', ref: 'menu_items', tableName: 'menu_items', owned: false, state: 'shared', prefix: null }),
    ]);
    expect(storedTableRef(shared, 'public.menu_items')).toBe('pos:menu_items');
    expect(resolveTableRef(shared, 'pos:menu_items')?.tableId).toBe('public.menu_items');
    expect(resolveTableRef(shared, 'ordering:menu_items')).toBeNull();
  });

  it('follows a rename: the name is the record\'s, and the record moved with the table', () => {
    const before = index([record({})]);
    const stored = storedTableRef(before, 'public.shop_orders');
    const after = index([record({ tableName: 'shop_sales' })], [{ id: 'public.shop_sales', name: 'shop_sales' }]);
    expect(resolveTableRef(after, stored)).toEqual({ tableId: 'public.shop_sales', maker: 'shop', ref: 'orders' });
    expect(storedTableRef(after, 'public.shop_sales')).toBe(stored);
  });

  it('survives a table released at uninstall and taken back at reinstall, and is nothing once the table is dropped', () => {
    const released = index([record({ state: 'released' })]);
    expect(storedTableRef(released, 'public.shop_orders')).toBe('shop:orders');
    expect(resolveTableRef(released, 'shop:orders')?.tableId).toBe('public.shop_orders');
    const dropped = index([record({ state: 'dropped' })], TABLES.filter((table) => table.name !== 'shop_orders'));
    expect(resolveTableRef(dropped, 'shop:orders')).toBeNull();
    // A table of that name made again by hand is nobody's.
    expect(storedTableRef(index([record({ state: 'dropped' })]), 'public.shop_orders')).toBe('public.shop_orders');
  });

  it('names nothing for a key with no record, a record whose table is gone, an id the database lacks, or text that is neither', () => {
    const made = index([record({})]);
    expect(resolveTableRef(made, 'clinic:orders')).toBeNull();
    expect(resolveTableRef(made, 'shop:invoices')).toBeNull();
    expect(resolveTableRef(index([record({})], []), 'shop:orders')).toBeNull();
    expect(resolveTableRef(made, 'public.ghosts')).toBeNull();
    expect(resolveTableRef(made, '')).toBeNull();
    expect(resolveTableRef(made, ':orders')).toBeNull();
    expect(resolveTableRef(made, 'orders')).toBeNull();
    // An id nothing has is kept as it is when written: the caller asked about a table that is not here.
    expect(storedTableRef(made, 'public.ghosts')).toBe('public.ghosts');
  });

  it('an add-on\'s own table is named the same way', () => {
    const kit = index([record({ appKey: 'inventory', ref: 'items', tableName: 'inventory_items', prefix: 'inventory_' })]);
    expect(storedTableRef(kit, 'public.inventory_items')).toBe('inventory:items');
    expect(resolveTableRef(kit, 'inventory:items')).toEqual({ tableId: 'public.inventory_items', maker: 'inventory', ref: 'items' });
  });

  it('what is written reads back as the same table, for every table of the database', () => {
    const all = index([
      record({}),
      record({ appKey: 'pos', ref: 'menu_items', tableName: 'menu_items', prefix: null }),
      record({ ref: 'customers', tableName: 'customers', owned: false, state: 'adopted', prefix: null }),
    ]);
    for (const table of TABLES) expect(resolveTableRef(all, storedTableRef(all, table.id))?.tableId, table.id).toBe(table.id);
  });
});
