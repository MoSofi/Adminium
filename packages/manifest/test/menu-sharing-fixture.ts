// SPDX-License-Identifier: AGPL-3.0-only
/**
 * An online shop that shares its menu with a till: the released Point of Sale
 * 0.2.2 manifest, and a shop built beside it whose four menu tables are
 * Point of Sale's (the `menu@1` shape, column for column, labels and all)
 * plus two columns of its own — the portions left for the day and a tile
 * colour — with its orders and their lines pointing at the menu.
 *
 * Read by the planner's tests here and by the server's install tests.
 */
import { readFileSync } from 'node:fs';

export type Doc = Record<string, unknown>;

const RELEASED = new URL('./fixtures/released/', import.meta.url);

/** The released Point of Sale 0.2.2 manifest, as it shipped. */
export function pointOfSale(): Doc {
  return JSON.parse(readFileSync(new URL('point-of-sale-0.2.2.manifest.json', RELEASED), 'utf8')) as Doc;
}

/** The released Online Ordering 0.1.3 manifest, as it shipped: its own plain-named menu, no shape. */
export function onlineOrdering013(): Doc {
  return JSON.parse(readFileSync(new URL('online-ordering-0.1.3.manifest.json', RELEASED), 'utf8')) as Doc;
}

const MENU = ['menu_categories', 'menu_items', 'modifier_groups', 'modifiers'];

/** Point of Sale's four menu tables, as its release declares them. */
export function menuTables(): Doc[] {
  const tables = (pointOfSale()['requiredSchema'] as { tables: Doc[] }).tables;
  return MENU.map((ref) => structuredClone(tables.find((t) => t['ref'] === ref)!));
}

/**
 * The shop: `ordering`, prefixed, updating from 0.2.0, its menu shared under
 * `menu@1` with `stock_today` and `hue` added to the items. `over` replaces
 * top-level fields; `extra` adds more columns to the items.
 */
export function orderingSharingMenu(over: Doc = {}, extra: Doc[] = []): Doc {
  const base = onlineOrdering013();
  const tables = menuTables();
  const items = tables.find((t) => t['ref'] === 'menu_items')!;
  items['columns'] = [
    ...(items['columns'] as Doc[]),
    { ref: 'stock_today', type: 'int', nullable: true },
    { ref: 'hue', type: 'text', maxLength: 32, nullable: true },
    ...extra,
  ];
  return {
    ...base,
    version: '0.2.0',
    compatibility: { ...(base['compatibility'] as Doc), minAdminiumVersion: '0.3.2', updatesFrom: '>=0.2.0' },
    requiredSchema: {
      prefixed: true,
      tables: [
        ...tables,
        {
          ref: 'orders',
          columns: [
            { ref: 'id', type: 'int', role: 'pk' },
            { ref: 'customer_name', type: 'text', maxLength: 80 },
            { ref: 'status', type: 'enum', enum: ['placed', 'ready', 'picked_up', 'cancelled'], default: 'placed' },
            { ref: 'pickup_at', type: 'timestamptz', nullable: true },
          ],
        },
        {
          ref: 'order_items',
          columns: [
            { ref: 'id', type: 'int', role: 'pk' },
            { ref: 'order_id', type: 'fk', references: 'orders' },
            { ref: 'menu_item_id', type: 'fk', references: 'menu_items' },
            { ref: 'qty', type: 'int', default: 1 },
          ],
        },
      ],
    },
    // Its pages over the tables it keeps (the released one's opening-hours page has no table here).
    pages: (base['pages'] as Doc[]).filter((page) => (page['bindings'] as Doc | undefined)?.['rows'] !== 'hours'),
    // The kitchen reads the menu and works the orders.
    roles: [
      {
        key: 'kitchen',
        name: 'Ordering kitchen',
        permissions: ['table:@menu_items:read', 'table:@orders:read', 'table:@orders:update', 'table:@order_items:read'],
      },
    ],
    // The menu, readable by anyone through the shop's key.
    publicAccess: [{ table: 'menu_items', methods: ['GET'], select: ['id', 'name', 'price', 'available', 'stock_today'] }],
    ...over,
  };
}
