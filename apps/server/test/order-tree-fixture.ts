// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A kitchen's ordering app: an order, its lines, each line's options, and the
 * customer the order is for — totals over totals three rows high (an option's
 * price into its line, the line's amount into the order, the order's total
 * into the customer's lifetime), a count of lines, tax worked out once from
 * the subtotal. Installed through the real installer by the tests of a create
 * with its child rows and of totals that climb.
 */
import type { Row } from '../src/crud/mask.js';
import type { WriteContext } from '../src/crud/write-service.js';
import type { TreeNode, TreeOutcome } from '../src/crud/write-tree.js';
import { normalizeWriteValue } from '../src/crud/write-values.js';
import { invoicingManifest, type writerFor } from './invoicing-install.helpers.js';

const id = { ref: 'id', type: 'int', role: 'pk' };
const text = (ref: string, maxLength = 120, more: Record<string, unknown> = {}) => ({ ref, type: 'text', maxLength, ...more });
const money = (ref: string, rules?: Record<string, unknown>) => ({ ref, type: 'decimal', scale: 2, nullable: true, ...(rules === undefined ? {} : { rules }) });

export function orderTables(numbered = true): Record<string, unknown>[] {
  const tables: Record<string, unknown>[] = [
    { ref: 'settings', columns: [id, { ref: 'max_items', type: 'int', default: 12 }, { ref: 'tax_rate', type: 'decimal', scale: 3, default: 8.25 }] },
    { ref: 'customers', columns: [id, text('email', 254), money('lifetime', { rollup: { from: 'orders', via: 'customer_id', sum: 'total' } })] },
    { ref: 'menu_items', columns: [id, text('name'), { ref: 'price', type: 'decimal', scale: 2, default: 0 }, { ref: 'available', type: 'bool', default: true }] },
    { ref: 'modifier_groups', columns: [id, { ref: 'item_id', type: 'fk', references: 'menu_items' }, text('name', 60), { ref: 'min', type: 'int', default: 0 }, { ref: 'max', type: 'int', nullable: true }] },
    { ref: 'modifiers', columns: [id, { ref: 'group_id', type: 'fk', references: 'modifier_groups' }, text('name', 60), { ref: 'price', type: 'decimal', scale: 2, default: 0 }] },
    {
      ref: 'orders',
      columns: [
        id,
        { ref: 'customer_id', type: 'fk', references: 'customers', nullable: true },
        text('email', 254, { rules: { validation: { format: 'email' } } }),
        text('name', 80),
        ...(numbered ? [{ ref: 'number', type: 'int', nullable: true, rules: { sequence: { gapless: true } } }] : []),
        text('client_key', 64, { nullable: true, unique: true }),
        { ref: 'tax_rate', type: 'decimal', scale: 3, nullable: true, rules: { default: { from: { table: 'settings', column: 'tax_rate' } } } },
        money('subtotal', { rollup: { from: 'order_items', via: 'order_id', sum: 'line_total', where: { column: 'removed', eq: false } } }),
        { ref: 'item_count', type: 'int', nullable: true, rules: { rollup: { from: 'order_items', via: 'order_id', count: true, where: { column: 'removed', eq: false } } } },
        money('tax', { formula: { round: { div: [{ mul: [{ coalesce: ['subtotal', 0] }, { coalesce: ['tax_rate', 0] }] }, 100] } } }),
        money('total', { formula: { add: [{ coalesce: ['subtotal', 0] }, { coalesce: ['tax', 0] }] } }),
      ],
    },
    {
      ref: 'order_items',
      columns: [
        id,
        { ref: 'order_id', type: 'fk', references: 'orders' },
        { ref: 'menu_item_id', type: 'fk', references: 'menu_items' },
        { ref: 'qty', type: 'decimal', scale: 3, default: 1, rules: { validation: { min: 1, max: 20 } } },
        { ref: 'position', type: 'int', nullable: true },
        text('note', 200, { nullable: true }),
        money('unit_price', { copy: { via: 'menu_item_id', from: 'price' } }),
        money('options_total', { rollup: { from: 'order_item_modifiers', via: 'order_item_id', sum: 'price' } }),
        money('line_total', { formula: { round: { mul: ['qty', { add: [{ coalesce: ['unit_price', 0] }, { coalesce: ['options_total', 0] }] }] } } }),
        { ref: 'removed', type: 'bool', default: false },
      ],
    },
    {
      ref: 'order_item_modifiers',
      columns: [
        id,
        { ref: 'order_item_id', type: 'fk', references: 'order_items' },
        { ref: 'modifier_id', type: 'fk', references: 'modifiers' },
        money('price', { copy: { via: 'modifier_id', from: 'price' } }),
      ],
    },
    // Totals of a quantity times a rate: where SQLite's float sums once rounded 0.495 down.
    { ref: 'tallies', columns: [id, money('total', { rollup: { from: 'tally_lines', via: 'tally_id', sum: 'qty', times: 'rate' } })] },
    {
      ref: 'tally_lines',
      columns: [id, { ref: 'tally_id', type: 'fk', references: 'tallies' }, { ref: 'qty', type: 'decimal', scale: 3, default: 1 }, { ref: 'rate', type: 'decimal', scale: 4, default: 0 }],
    },
  ];
  return tables;
}

/** The kitchen app; `numbered: false` leaves orders without a running number (so a create can be undone). */
export function orderManifest(numbered = true): Record<string, unknown> {
  const manifest = invoicingManifest(orderTables(numbered));
  manifest['key'] = 'kitchen';
  (manifest['pages'] as { bindings: Record<string, string> }[])[0]!.bindings = { rows: 'orders' };
  return manifest;
}

/**
 * The menu every test orders from: a Margherita $12 (size: one of Small +$0 /
 * Large +$4), a Salad $9 (extras: at most two of Feta, Olives, Egg at $1.50),
 * a Soda $2, and a Tiramisu that is off today.
 */
export const MENU = [
  'INSERT INTO kitchen_settings (id, max_items, tax_rate) VALUES (1, 12, 8.25)',
  "INSERT INTO kitchen_customers (id, email) VALUES (1, 'ada@example.com')",
  "INSERT INTO kitchen_menu_items (id, name, price, available) VALUES (1, 'Margherita', 12, true), (2, 'Salad', 9, true), (3, 'Tiramisu', 7, false), (4, 'Soda', 2, true)",
  "INSERT INTO kitchen_modifier_groups (id, item_id, name, min, max) VALUES (1, 1, 'Size', 1, 1), (2, 2, 'Extras', 0, 2)",
  "INSERT INTO kitchen_modifiers (id, group_id, name, price) VALUES (1, 1, 'Small', 0), (2, 1, 'Large', 4), (3, 2, 'Feta', 1.5), (4, 2, 'Olives', 1.5), (5, 2, 'Egg', 1.5)",
];

export type Writer = Awaited<ReturnType<typeof writerFor>>;
export interface Line {
  item: number;
  qty?: number;
  mods?: number[];
  note?: string;
}

function valuesFor(w: Writer, ref: string, values: Row): Row {
  const table = w.targetOf(ref).table;
  return Object.fromEntries(Object.entries(values).map(([k, v]) => [k, normalizeWriteValue(table.columns.get(k)!, v)]));
}

/** An order as a door hands it over: its lines in request order, each with its options. */
export function orderTree(w: Writer, lines: readonly Line[], root: Row = { email: 'ada@example.com', name: 'Ada', customer_id: 1 }): TreeNode {
  return {
    name: 'orders',
    target: w.targetOf('orders'),
    values: valuesFor(w, 'orders', root),
    at: [],
    lists: ['order_items'],
    children: lines.map((line, i) => ({
      name: 'order_items',
      target: w.targetOf('order_items'),
      values: valuesFor(w, 'order_items', { menu_item_id: line.item, qty: line.qty ?? 1, ...(line.note === undefined ? {} : { note: line.note }) }),
      via: { column: 'order_id', parentKey: 'id' },
      position: 'position',
      at: ['order_items', i],
      lists: ['order_item_modifiers'],
      children: (line.mods ?? []).map((modifier, j) => ({
        name: 'order_item_modifiers',
        target: w.targetOf('order_item_modifiers'),
        values: valuesFor(w, 'order_item_modifiers', { modifier_id: modifier }),
        via: { column: 'order_item_id', parentKey: 'id' },
        at: ['order_items', i, 'order_item_modifiers', j],
        children: [],
      })),
    })),
  };
}

export async function writeTree(w: Writer, root: TreeNode, mode: 'save' | 'dry' = 'save', context: WriteContext = w.desk, more: Partial<Parameters<Writer['writes']['createTree']>[0]> = {}): Promise<TreeOutcome> {
  return w.writes.createTree({
    root,
    context,
    mode,
    announce: async () => {},
    mapError: (error) => {
      throw error;
    },
    ...more,
  });
}


/** A money value as the text a person reads: `12.50`. */
export const cents = (value: unknown): string | null => (value === null || value === undefined ? null : Number(value).toFixed(2));

/** The public side of the kitchen: the menu anyone may read, and a guest's order with its lines and options. */
export function orderPublicManifest(numbered = true): Record<string, unknown> {
  const manifest = orderManifest(numbered);
  manifest['frontends'] = [
    { side: 'staff', kind: 'spa', entry: 'index.html' },
    { side: 'customer', kind: 'spa', entry: 'index.html' },
  ];
  manifest['publicAccess'] = [
    { table: 'menu_items', methods: ['GET'], select: ['id', 'name', 'price'], filters: [{ column: 'available', op: 'eq', value: true }] },
    { table: 'modifier_groups', methods: ['GET'], select: ['id', 'item_id', 'name', 'min', 'max'] },
    { table: 'modifiers', methods: ['GET'], select: ['id', 'group_id', 'name', 'price'] },
    {
      table: 'orders',
      methods: ['POST'],
      humanCheck: true,
      writable: ['email', 'name', 'client_key'],
      requires: ['email', 'name'],
      select: ['id', ...(numbered ? ['number'] : []), 'subtotal', 'item_count', 'tax', 'total'],
      anonymous: { perValue: { columns: ['email'], n: 20 } },
      children: {
        order_items: {
          via: 'order_id',
          writable: ['menu_item_id', 'qty', 'note'],
          select: ['id', 'position', 'unit_price', 'options_total', 'line_total'],
          position: 'position',
          min: 1,
          max: 40,
          plainText: ['note'],
          sumMax: { column: 'qty', max: { table: 'settings', column: 'max_items' } },
          children: {
            order_item_modifiers: {
              via: 'order_item_id',
              writable: ['modifier_id'],
              select: ['id', 'price'],
              max: 20,
              agrees: [{ column: 'modifier_id', path: ['group_id', 'item_id'], eq: { parent: 'menu_item_id' } }],
              counts: [{ by: ['modifier_id', 'group_id'], every: { column: 'item_id', eq: { parent: 'menu_item_id' } }, min: 'min', max: 'max' }],
            },
          },
        },
      },
      dryRun: true,
      expect: 'total',
      clientKey: 'client_key',
    },
  ];
  return manifest;
}
