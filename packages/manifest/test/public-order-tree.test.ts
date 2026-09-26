// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A create with its child rows in one write, the checks its rows must pass,
 * the dry run, the price check and the retry key — each rule broken once on
 * a manifest that otherwise validates, and read back as the sentence it gives.
 */
import { describe, expect, it } from 'vitest';

import { validateManifest } from '../src/index.js';
import { boxOffice, columnOf, entryOf, guestHouse, issuesText, kitchen, messages, type Doc } from './orders-stays-fixture.js';

const create = (m: Doc) => entryOf(m, m['key'] === 'guesthouse' ? 'stays' : 'orders', 'POST');
const lines = (m: Doc) => (create(m)['children'] as Record<string, Doc>)['order_items']!;
const options = (m: Doc) => (lines(m)['children'] as Record<string, Doc>)['order_item_modifiers']!;

function broken(make: () => Doc, change: (m: Doc) => void): string {
  const m = make();
  change(m);
  return issuesText(m);
}

describe('the three app shapes', () => {
  it('validate with every new field', () => {
    for (const m of [kitchen(), boxOffice(), guestHouse()]) expect(messages(m)).toEqual([]);
  });

  it('keep every new key through the schema', () => {
    const result = validateManifest(kitchen());
    expect(result.ok).toBe(true);
    if (!result.ok || result.manifest.kind !== 'app') return;
    const entry = result.manifest.publicAccess!.find((e) => e.methods.includes('POST') && e.table === 'orders')!;
    expect(entry.children?.['order_items']?.children?.['order_item_modifiers']?.counts?.[0]?.every).toEqual({ column: 'item_id', eq: { parent: 'menu_item_id' } });
    expect(entry.children?.['order_items']?.sumMax).toEqual({ column: 'qty', max: { table: 'settings', column: 'max_items' } });
    expect([entry.dryRun, entry.expect, entry.clientKey, entry.shareLink]).toEqual([true, 'total', 'client_key', 'link_token']);
  });
});

describe('child rows', () => {
  it('come with a create, never on an identity or a child entry', () => {
    expect(broken(kitchen, (m) => (create(m)['methods'] = ['PATCH']))).toContain('child rows come with a create, and this entry creates nothing');
  });

  it('are proved once for the whole write when anyone may create', () => {
    expect(broken(kitchen, (m) => delete create(m)['humanCheck'])).toContain('asks the human check, once for the whole write');
  });

  it('name tables of the app, each once, never the people who sign in', () => {
    expect(broken(kitchen, (m) => ((create(m)['children'] as Doc)['nope'] = { via: 'x', writable: [], max: 1 }))).toContain('"nope" is not a table of this app');
    expect(broken(kitchen, (m) => ((create(m)['children'] as Doc)['orders'] = { via: 'id', writable: [], max: 1 }))).toContain('"orders" is in this write twice');
    expect(broken(kitchen, (m) => ((create(m)['children'] as Doc)['customers'] = { via: 'id', writable: [], max: 1 }))).toContain(
      '"customers" holds the people who sign in, and a create never makes one as a child row',
    );
  });

  it('link to their parent through a foreign key to it', () => {
    expect(broken(kitchen, (m) => (lines(m)['via'] = 'menu_item_id'))).toContain('"order_items.menu_item_id" does not point at "orders"');
    expect(broken(kitchen, (m) => (options(m)['via'] = 'modifier_id'))).toContain('"order_item_modifiers.modifier_id" does not point at "order_items"');
  });

  it('go two levels deep at most', () => {
    const m = kitchen();
    options(m)['children'] = { modifiers: { via: 'group_id', writable: [], max: 1 } };
    expect(issuesText(m)).toContain('children');
  });

  it('never write what Adminium decides: its figures, the link, the position', () => {
    expect(broken(kitchen, (m) => (lines(m)['writable'] as string[]).push('unit_price'))).toContain('"unit_price" is decided by Adminium and cannot be written publicly');
    expect(broken(kitchen, (m) => (lines(m)['writable'] as string[]).push('order_id'))).toContain('"order_id" is decided by Adminium');
    expect(broken(kitchen, (m) => (lines(m)['writable'] as string[]).push('position'))).toContain('"position" is decided by Adminium');
  });

  it('name columns the child has, and never show a shared link\'s code', () => {
    expect(broken(kitchen, (m) => (lines(m)['select'] = ['id', 'nope']))).toContain('"order_items" has no column "nope"');
    expect(broken(boxOffice, (m) => ((create(m)['children'] as Record<string, Doc>)['tickets']!['select'] = ['id', 'link_token']))).toContain(
      '"tickets.link_token" is the code a shared link opens its row with',
    );
  });

  it('bound their rows, their position and what they add up to', () => {
    expect(broken(kitchen, (m) => (lines(m)['min'] = 50))).toContain('a child table asks for no more rows than it allows');
    expect(broken(kitchen, (m) => (lines(m)['max'] = 201))).toContain('max');
    expect(broken(kitchen, (m) => (lines(m)['position'] = 'note'))).toContain('"order_items.note" is not a whole number');
    expect(broken(kitchen, (m) => (lines(m)['sumMax'] = { column: 'note', max: 12 }))).toContain('"order_items.note" is not a number to add up');
    expect(broken(kitchen, (m) => (lines(m)['sumMax'] = { column: 'qty', max: { table: 'settings', column: 'bank_name' } }))).toContain('"settings.bank_name" is not a whole number');
  });

  it('hold plain text only in text columns a guest types', () => {
    expect(broken(kitchen, (m) => (lines(m)['plainText'] = ['qty']))).toContain('"order_items.qty" is not a text column');
  });
});

describe('agreements and counts', () => {
  it('follow foreign keys to the column compared, against the parent row', () => {
    expect(broken(kitchen, (m) => ((options(m)['agrees'] as Doc[])[0]!['path'] = ['name', 'item_id']))).toContain('"modifiers.name" is not a foreign key, so the path cannot go on to "item_id"');
    expect(broken(kitchen, (m) => (((options(m)['agrees'] as Doc[])[0]!['eq'] as Doc)['parent'] = 'nope'))).toContain('"order_items" has no column "nope"');
    expect(broken(kitchen, (m) => (((options(m)['agrees'] as Doc[])[0]!['eq'] as Doc)['parent'] = 'qty'))).toContain('cannot be compared with "qty"');
  });

  it('say one test, on numbers for at most and at least', () => {
    expect(broken(guestHouse, (m) => ((create(m)['agrees'] as Doc[])[0]!['eq'] = { value: 2 }))).toContain('an agreement says one of eq, lte or gte');
    expect(broken(guestHouse, (m) => ((create(m)['agrees'] as Doc[])[0] = { column: 'email', lte: { value: 'x' } }))).toContain('"stays.email" is not a number');
  });

  it('have no parent row on the create itself', () => {
    expect(broken(guestHouse, (m) => ((create(m)['agrees'] as Doc[])[0] = { column: 'room_type_id', eq: { parent: 'id' } }))).toContain('has no parent row to agree with');
  });

  it('tie a ticket to the order\'s show', () => {
    const m = boxOffice();
    ((create(m)['children'] as Record<string, Doc>)['tickets']!['agrees'] as Doc[])[0]!['eq'] = { parent: 'customer_id' };
    expect(issuesText(m)).toContain('cannot be compared with "customer_id"');
  });

  it('count siblings per group with whole-number bounds', () => {
    expect(broken(kitchen, (m) => ((options(m)['counts'] as Doc[])[0]!['by'] = ['name']))).toContain('"order_item_modifiers.name" is not a foreign key, so it leads to no group');
    expect(broken(kitchen, (m) => ((options(m)['counts'] as Doc[])[0]!['min'] = 'name'))).toContain('"modifier_groups.name" is not a whole number');
    expect(broken(kitchen, (m) => ((options(m)['counts'] as Doc[])[0]!['every'] = { column: 'name', eq: { parent: 'menu_item_id' } }))).toContain(
      '"modifier_groups.name" is not a foreign key of the group',
    );
  });
});

describe('a dry run, a price check, a retry key', () => {
  it('belong to a create (a dry run and a price check to a change too)', () => {
    const m = guestHouse();
    const change = entryOf(m, 'stays', 'PATCH', 'link');
    expect([change['dryRun'], change['expect']]).toEqual([true, 'total']);
    expect(messages(m)).toEqual([]);
    expect(broken(kitchen, (m2) => Object.assign(entryOf(m2, 'menu_items', 'GET'), { dryRun: true }))).toContain('a dry run tries a create or a change');
    expect(broken(kitchen, (m2) => Object.assign(entryOf(m2, 'menu_items', 'GET'), { clientKey: 'name' }))).toContain('a retry key belongs to a create');
  });

  it('check a money figure Adminium works out, which the create shows', () => {
    expect(broken(kitchen, (m) => (create(m)['expect'] = 'note'))).toContain('"orders.note" is not a money column');
    expect(broken(kitchen, (m) => (create(m)['select'] = ['id']))).toContain('"total" is checked, so the entry shows it (select)');
    const m = kitchen();
    const total = columnOf(m, 'orders', 'total');
    delete total['rules'];
    total['nullable'] = true;
    expect(issuesText(m)).toContain('"orders.total" is not a figure Adminium works out');
  });

  it('keep the retry key unique, typed by the browser, and never shown', () => {
    expect(broken(kitchen, (m) => delete columnOf(m, 'orders', 'client_key')['unique'])).toContain('"orders.client_key" finds one row by its key, so it is unique');
    expect(broken(kitchen, (m) => (create(m)['writable'] = ['email', 'name', 'phone', 'pickup_at', 'note']))).toContain('"client_key" is sent by the browser, so it is writable');
    expect(broken(kitchen, (m) => (entryOf(m, 'orders', 'GET')['select'] as string[]).push('client_key'))).toContain('"orders.client_key" is a retry key');
  });
});

describe('a number a guest types that a price reads', () => {
  it('declares its bounds', () => {
    expect(broken(kitchen, (m) => delete (columnOf(m, 'order_items', 'qty')['rules'] as Doc)['validation'])).toContain(
      '"order_items.qty" is written by a guest and feeds a price Adminium works out, so it declares validation.min (at least 0) and validation.max',
    );
    // A stay's guests feed each extra's price through a copy that follows it.
    expect(broken(guestHouse, (m) => ((columnOf(m, 'stays', 'guests')['rules'] as Doc)['validation'] = { min: -1, max: 6 }))).toContain('"stays.guests" is written by a guest');
  });
});
