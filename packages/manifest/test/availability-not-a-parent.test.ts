// SPDX-License-Identifier: AGPL-3.0-only
/**
 * An availability entry answers free or full per slot and never a row, so it
 * is never the parent a child entry is read with: a key that asks both "is
 * 12:15 free?" and "my orders, their lines, each line's options" has one
 * reader of `orders` and one of `order_items`, wherever the availability
 * entries stand in the list.
 */
import { describe, expect, it } from 'vitest';

import { issuesText, kitchen, messages, tableOf, type Doc } from './orders-stays-fixture.js';

const SLOTS = {
  kind: 'slot',
  slot: 'pickup_at',
  amount: 1,
  perSlot: 6,
  countWhere: { column: 'status', values: ['placed', 'ready'] },
  slotMinutes: 15,
  windowDays: 1,
  opens: '11:00',
  closes: '21:00',
};
const STOCK = {
  kind: 'parent',
  via: 'menu_item_id',
  size: { column: 'stock' },
  amount: 'qty',
  countWhere: { column: 'status', values: ['placed', 'ready'], via: 'order_id' },
};

/** The kitchen with slot and stock limits, their availability, and a signed-in diner's lines and options. */
function signedInKitchen(availabilityFirst: boolean): Doc {
  const m = kitchen();
  tableOf(m, 'orders')['capacity'] = SLOTS;
  tableOf(m, 'order_items')['capacity'] = STOCK;
  (tableOf(m, 'menu_items')['columns'] as Doc[]).push({ ref: 'stock', type: 'int', default: 20 });
  const availability: Doc[] = [
    { table: 'orders', kind: 'availability', methods: ['GET'] },
    { table: 'order_items', kind: 'availability', methods: ['GET'] },
  ];
  const children: Doc[] = [
    { table: 'order_items', methods: ['GET'], level: 'verified', visibleWith: { table: 'orders', via: 'order_id' }, select: ['id', 'qty', 'line_total'] },
    { table: 'order_item_modifiers', methods: ['GET'], level: 'verified', visibleWith: { table: 'order_items', via: 'order_item_id' }, select: ['id', 'name', 'price'] },
  ];
  const entries = m['publicAccess'] as Doc[];
  m['publicAccess'] = availabilityFirst ? [...availability, ...entries, ...children] : [...entries, ...children, ...availability];
  return m;
}

describe('an availability entry is never a parent', () => {
  it('leaves the signed-in reads of orders, lines and options their one parent each', () => {
    expect(messages(signedInKitchen(false))).toEqual([]);
  });

  it('changes nothing when the availability entries come first', () => {
    expect(messages(signedInKitchen(true))).toEqual([]);
  });

  it('still refuses two entries that read rows of the parent', () => {
    const m = signedInKitchen(true);
    (m['publicAccess'] as Doc[]).push({ table: 'orders', methods: ['GET'], level: 'verified', claimedBy: { table: 'customers', column: 'customer_id' }, select: ['id'] });
    expect(issuesText(m)).toContain('more than one entry reads "orders" on the "customer" key, so the parent is not clear');
  });

  it('is no parent on its own either: a child with only availability above it reads no parent', () => {
    const m = kitchen();
    tableOf(m, 'orders')['capacity'] = SLOTS;
    const entries = (m['publicAccess'] as Doc[]).filter((e) => !(e['table'] === 'orders' && e['key'] === undefined && (e['methods'] as string[]).includes('GET')));
    entries.push({ table: 'orders', kind: 'availability', methods: ['GET'] });
    entries.push({ table: 'order_items', methods: ['GET'], level: 'verified', visibleWith: { table: 'orders', via: 'order_id' }, select: ['id'] });
    m['publicAccess'] = entries;
    expect(issuesText(m)).toContain('no entry reads "orders" on the "customer" key');
  });
});
