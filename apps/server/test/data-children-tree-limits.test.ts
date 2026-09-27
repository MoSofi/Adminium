// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A desk's form with child rows that reach past the record: tickets that
 * climb into what each type has sold and take from its capacity. An undo of
 * the order gives back what the type sold (and is refused when a row changed
 * since); a change that adds tickets is one lock-first write, refused whole
 * when the type is full; a create carries two hundred rows below it at most.
 * On every engine.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { installInvoicing, LEGS, type InvoicingHarness } from './invoicing-install.helpers.js';
import { dataRoutesOver, type DataRoutes } from './invoicing-routes.helpers.js';
import { MENU, orderManifest } from './order-tree-fixture.js';
import { SEED, venue } from './venue-tree-fixture.js';

describe.each(LEGS)("a desk's order with tickets that take from a type — %s", (dialect, available) => {
  let h: InvoicingHarness | undefined;
  let r: DataRoutes;
  beforeAll(async () => {
    if (!available) return;
    h = await installInvoicing(dialect, venue({ limited: true }));
    for (const statement of SEED) await h.rows(statement);
    // Three places for the Standard type; the preview has none set (no limit).
    await h.rows(`update ${h.real('ticket_types')} set capacity = 3 where id = 1`);
    r = await dataRoutesOver(h, dialect);
  }, 180_000);
  afterAll(async () => {
    await r?.close();
    await h?.close();
  });

  const tickets = () => `fk:${r.table('tickets')}(order_id)->${r.table('orders')}(id)`;
  const sold = async () => Number((await h!.rows(`select coalesce(sold, 0) as n from ${h!.real('ticket_types')} where id = 1`))[0]!['n']);
  const count = async (ref: string) => Number((await h!.rows(`select count(*) as n from ${h!.real(ref)}`))[0]!['n']);
  const order = (types: number[]) => ({
    values: { event_id: 1, email: 'desk@example.com', name: 'Walk-in' },
    children: { [tickets()]: types.map((type) => ({ values: { ticket_type_id: type } })) },
  });

  it.runIf(available)('an undo of an order gives back what its tickets sold, and is refused once a ticket changed', async () => {
    const was = await sold();
    const made = await r.post('orders', order([1, 1]));
    expect(made.statusCode, made.body).toBe(201);
    expect(await sold()).toBe(was + 2);
    const undone = await r.undo(made.json<{ undoToken: string }>().undoToken);
    expect(undone.statusCode, undone.body).toBe(200);
    expect(await sold()).toBe(was);

    const again = await r.post('orders', order([1]));
    expect(again.statusCode, again.body).toBe(201);
    const orders = await count('orders');
    await h!.rows(`update ${h!.real('tickets')} set holder = 'Someone else' where order_id = ${String(again.json<{ data: { id: unknown } }>().data.id)}`);
    const refused = await r.undo(again.json<{ undoToken: string }>().undoToken);
    expect(refused.statusCode, refused.body).toBe(409);
    expect(refused.json<{ error: { details: { code: string } } }>().error.details.code).toBe('UNDO_CONFLICT');
    // Nothing went: the order, its ticket and what the type sold stand.
    expect([await count('orders'), await sold()]).toEqual([orders, was + 1]);
    await h!.rows(`delete from ${h!.real('tickets')} where order_id = ${String(again.json<{ data: { id: unknown } }>().data.id)}`);
    await h!.rows(`update ${h!.real('ticket_types')} set sold = 0 where id = 1`);
  });

  it.runIf(available)('a change that adds tickets is one write under the type\'s lock, refused whole when the type is full, and undone whole', async () => {
    const made = await r.post('orders', order([1]));
    expect(made.statusCode, made.body).toBe(201);
    const id = made.json<{ data: { id: unknown } }>().data.id;
    const ticketsOf = async () => h!.rows(`select id from ${h!.real('tickets')} where order_id = ${String(id)} order by id`);
    const first = (await ticketsOf())[0]!;
    // Two more: the type's three places, all taken, in one save with the order's own change.
    const added = await r.patch('orders', id, {
      values: { name: 'Walk-in party' },
      children: { [tickets()]: [{ key: { id: first['id'] }, values: {} }, { values: { ticket_type_id: 1 } }, { values: { ticket_type_id: 1 } }] },
    });
    expect(added.statusCode, added.body).toBe(200);
    expect([(await ticketsOf()).length, await sold()]).toEqual([3, 3]);
    // A fourth: the type is full, and nothing of the save is kept — not the name either.
    const kept = await ticketsOf();
    const full = await r.patch('orders', id, {
      values: { name: 'Too many' },
      children: { [tickets()]: [...kept.map((row) => ({ key: { id: row['id'] }, values: {} })), { values: { ticket_type_id: 1 } }] },
    });
    expect(full.statusCode, full.body).toBe(409);
    expect(full.json<{ error: { code: string } }>().error.code).toBe('CAPACITY_FULL');
    expect([(await ticketsOf()).length, await sold()]).toEqual([3, 3]);
    expect((await h!.rows(`select name from ${h!.real('orders')} where id = ${String(id)}`))[0]!['name']).toBe('Walk-in party');
    // The change undone: its two tickets go, and what they sold with them.
    const undone = await r.undo(added.json<{ undoToken: string }>().undoToken);
    expect(undone.statusCode, undone.body).toBe(200);
    expect([(await ticketsOf()).length, await sold()]).toEqual([1, 1]);
  });
});

describe.each(LEGS)("a desk's create with rows two levels down — %s", (dialect, available) => {
  let h: InvoicingHarness | undefined;
  let r: DataRoutes;
  beforeAll(async () => {
    if (!available) return;
    h = await installInvoicing(dialect, orderManifest(false));
    for (const statement of MENU) await h.rows(statement);
    r = await dataRoutesOver(h, dialect);
  }, 180_000);
  afterAll(async () => {
    await r?.close();
    await h?.close();
  });

  it.runIf(available)('carries two hundred rows below it at most, however they are spread', async () => {
    const lines = `fk:${r.table('order_items')}(order_id)->${r.table('orders')}(id)`;
    const options = `fk:${r.table('order_item_modifiers')}(order_item_id)->${r.table('order_items')}(id)`;
    const before = Number((await h!.rows(`select count(*) as n from ${h!.real('orders')}`))[0]!['n']);
    const res = await r.post('orders', {
      values: { email: 'desk@example.com', name: 'Big table' },
      children: { [lines]: [0, 1].map(() => ({ values: { menu_item_id: 1 }, children: { [options]: Array.from({ length: 100 }, () => ({ values: { modifier_id: 1 } })) } })) },
    });
    expect(res.statusCode, res.body).toBe(422);
    expect(res.json<{ error: { details: Record<string, unknown> } }>().error.details).toMatchObject({ reason: 'too-many' });
    expect(Number((await h!.rows(`select count(*) as n from ${h!.real('orders')}`))[0]!['n'])).toBe(before);
  });
});
