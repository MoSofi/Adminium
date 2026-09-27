// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The row a move moves too (`states.effects`) is judged as the app's declared
 * move of that row — by its limits, the totals it climbs into and its own
 * states — on every engine, the clock fixed:
 *
 *  - an order's money taken at the door pays it: the order owns the tickets
 *    its state counts, and keeps a total; what the event has taken in (a
 *    total of its paid orders) climbs with it;
 *  - an order held past its end whose places went to another buyer is not
 *    paid by money taken: the order's tickets would count again in a pool
 *    with no room — refused as the order's own move would be, and a quote of
 *    the collection is refused alike;
 *  - a write that named no lock for the pools the effect's row counts in (a
 *    batch) cannot move it: refused as a batch of limited rows is;
 *  - a waitlist entry follows its offer: claimed when the order is paid,
 *    missed when it expires — the entry owns the orders held until its offer
 *    ends, and a change of its state moves no count; its list's count of
 *    claimed entries climbs with it, the list held before the entry as every
 *    writer holds a total's row before the rows below it.
 */
import { sql } from 'kysely';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { updateRows } from '../src/crud/write-service.js';
import { door, later, T0, waitlist } from './effects-fixture.js';
import { installInvoicing, LEGS, writerFor, type InvoicingHarness } from './invoicing-install.helpers.js';

describe.each(LEGS)("an effect's row is judged as its own move — %s", (dialect, available) => {
  let h: InvoicingHarness;
  let w: Awaited<ReturnType<typeof writerFor>>;
  let n = 0;
  beforeAll(async () => {
    if (!available) return;
    h = await installInvoicing(dialect, door());
    w = await writerFor(h, 'Europe/London');
    await w.create('settings', {});
  }, 180_000);
  afterAll(async () => {
    if (available) await h.close();
  });
  afterEach(() => vi.useRealTimers());
  const at = (minutes: number) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(later(minutes)));
  };
  const status = async (ref: string, key: unknown) => (await h.rows(`select status from ${h.real(ref)} where id = ${String(key)}`))[0]!['status'];
  const show = async (capacity: number) => {
    const event = await w.create('events', { name: `Show ${String((n += 1))}` });
    const type = await w.create('ticket_types', { event_id: event['id'], capacity });
    return { event, type };
  };

  it.runIf(available)("an order's money taken at the door pays it, and what the event took in climbs with it", async () => {
    at(0);
    const { event, type } = await show(4);
    const order = await w.create('orders', { event_id: event['id'] });
    await w.create('tickets', { order_id: order['id'], ticket_type_id: type['id'], price: 10 });
    await w.create('tickets', { order_id: order['id'], ticket_type_id: type['id'], price: 15 });
    await w.update('orders', order['id'], { status: 'door' });
    const money = await w.create('collections', { order_id: order['id'], amount: 25 });
    const collected = await w.update('collections', money['id'], { status: 'taken' });
    expect(collected.effects?.map((e) => e.after?.['status'])).toEqual(['paid']);
    expect(await status('orders', order['id'])).toBe('paid');
    const [row] = await h.rows(`select paid_total from ${h.real('events')} where id = ${String(event['id'])}`);
    expect(Number(row!['paid_total'])).toBe(25);
  });

  it.runIf(available)('an order whose hold ended and whose places were sold is not paid by money taken, nor by a quote of it', async () => {
    at(0);
    const { event, type } = await show(1);
    const lapsed = await w.create('orders', { event_id: event['id'] });
    await w.create('tickets', { order_id: lapsed['id'], ticket_type_id: type['id'], price: 10 });
    const money = await w.create('collections', { order_id: lapsed['id'], amount: 10 });
    // The hold ends; another buyer takes the one place.
    at(20);
    const other = await w.create('orders', { event_id: event['id'] });
    await w.create('tickets', { order_id: other['id'], ticket_type_id: type['id'], price: 10 });
    const quote = w.writes.update({ target: w.targetOf('collections'), pk: { id: money['id'] }, values: { status: 'taken' }, context: w.desk, mode: 'dry', announce: async () => {} });
    await expect(quote).rejects.toMatchObject({ code: 'CAPACITY_FULL' });
    await expect(w.update('collections', money['id'], { status: 'taken' })).rejects.toMatchObject({ code: 'CAPACITY_FULL' });
    expect([await status('collections', money['id']), await status('orders', lapsed['id'])]).toEqual(['due', 'held']);
  });

  it.runIf(available)('a write that named no lock for the pools cannot move the row: refused as a batch of limited rows is', async () => {
    at(0);
    const { event, type } = await show(4);
    const order = await w.create('orders', { event_id: event['id'] });
    await w.create('tickets', { order_id: order['id'], ticket_type_id: type['id'], price: 10 });
    await w.update('orders', order['id'], { status: 'door' });
    const money = await w.create('collections', { order_id: order['id'], amount: 10 });
    const target = w.targetOf('collections');
    const { rows } = await w.writes.check('update', target, w.desk, [{ status: 'taken' }], { capacity: 'unchecked' });
    const { db } = await h.manager.data(h.connectionId);
    const batch = db.transaction().execute((trx) => updateRows(trx as never, dialect, target.table, rows[0]!, { id: money['id'] }));
    await expect(batch).rejects.toMatchObject({ code: 'CONFLICT', details: { reason: 'CAPACITY_ONE_AT_A_TIME' } });
    expect([await status('collections', money['id']), await status('orders', order['id'])]).toEqual(['due', 'door']);
  });
});

describe.each(LEGS)('a waitlist entry follows its offer — %s', (dialect, available) => {
  let h: InvoicingHarness;
  let w: Awaited<ReturnType<typeof writerFor>>;
  beforeAll(async () => {
    if (!available) return;
    h = await installInvoicing(dialect, waitlist());
    w = await writerFor(h, 'Europe/London');
    await w.create('settings', {});
  }, 180_000);
  afterAll(async () => {
    if (available) await h.close();
  });
  afterEach(() => vi.useRealTimers());
  const status = async (ref: string, key: unknown) => (await h.rows(`select status from ${h.real(ref)} where id = ${String(key)}`))[0]!['status'];

  it.runIf(available)('is claimed when the order made for the offer is paid, and missed when it expires', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
    const type = await w.create('ticket_types', { capacity: 2 });
    const list = await w.create('lists', { name: 'Friday' });
    const offers = [];
    for (const email of ['a@example.com', 'b@example.com']) {
      const entry = await w.create('waitlist', { email, list_id: list['id'] });
      await w.update('waitlist', entry['id'], { status: 'offered' });
      const order = await w.create('orders', { waitlist_id: entry['id'] });
      await w.update('orders', order['id'], { status: 'offered' });
      await w.create('tickets', { order_id: order['id'], ticket_type_id: type['id'] });
      offers.push({ entry, order });
    }
    const [paid, lapsed] = offers as [(typeof offers)[number], (typeof offers)[number]];
    const moved = await w.update('orders', paid.order['id'], { status: 'paid' });
    expect(moved.effects?.map((e) => e.after?.['status'])).toEqual(['claimed']);
    await w.update('orders', lapsed.order['id'], { status: 'expired' });
    expect([await status('waitlist', paid.entry['id']), await status('waitlist', lapsed.entry['id'])]).toEqual(['claimed', 'missed']);
    // The list's count of claimed entries climbed with the entry's move.
    expect(Number((await h.rows(`select claimed from ${h.real('lists')} where id = ${String(list['id'])}`))[0]!['claimed'])).toBe(1);
    // What the two orders hold: the paid one's place, and none for the expired one.
    const [row] = await h.rows(`select count(*) as n from ${h.real('tickets')} t join ${h.real('orders')} o on o.id = t.order_id where o.status in ('held', 'offered', 'paid')`);
    expect(Number(row!['n'])).toBe(1);
  });

  it.runIf(available && dialect !== 'sqlite')("holds the entry's list before the entry, as a writer holding the list and then the entry does", async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
    const type = await w.create('ticket_types', { capacity: 2 });
    const list = await w.create('lists', { name: 'Saturday' });
    const entry = await w.create('waitlist', { email: 'c@example.com', list_id: list['id'] });
    await w.update('waitlist', entry['id'], { status: 'offered' });
    const order = await w.create('orders', { waitlist_id: entry['id'] });
    await w.update('orders', order['id'], { status: 'offered' });
    await w.create('tickets', { order_id: order['id'], ticket_type_id: type['id'] });
    vi.useRealTimers();
    const { db } = await h.manager.data(h.connectionId);
    let during: Promise<unknown> | undefined;
    await db.transaction().execute(async (trx) => {
      await sql`select id from ${sql.table(h.real('lists'))} where id = ${list['id']} for update`.execute(trx);
      during = w.update('orders', order['id'], { status: 'paid' }).catch((error: unknown) => error);
      await new Promise((resolve) => setTimeout(resolve, 500));
      await sql`select id from ${sql.table(h.real('waitlist'))} where id = ${entry['id']} for update`.execute(trx);
    });
    expect(await during).toMatchObject({ count: 1 });
    expect(await status('waitlist', entry['id'])).toBe('claimed');
  });
});
