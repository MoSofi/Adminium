// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A waitlist offer claimed on a show whose places given back are kept for the
 * waitlist (`reserved: returned`: counted against the public, not staff), on
 * every engine, the clock fixed. The Velvet Hour: 120 places, 118 sold, 2
 * given back (returned), and an offer of those 2 to the first on the list,
 * held until the offer ends. For the public that is 122 of 120 — the offer's
 * places counted twice, as the offer and as the places it was made of. The
 * guest's claim (offered → pay at the door) leaves the hold for a state that
 * counts with no end, and is judged under the pool's lock; the places kept
 * back are the very ones it takes, so they are no one else's to count against
 * it: the claim passes. A claim with no place behind it is refused — one
 * whose hold ended and whose places were sold meanwhile, or an offer of more
 * places than were given back — and so is a guest's new order.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { WriteContext } from '../src/crud/write-context.js';
import { installInvoicing, LEGS, writerFor, type InvoicingHarness } from './invoicing-install.helpers.js';

const id = { ref: 'id', type: 'int', role: 'pk' };
const offerUntil = (on: unknown) => ({ ref: 'offer_until', type: 'timestamptz', nullable: true, rules: { stamp: { set: { addMinutes: { hours: 12 } }, on } } });

function velvet(release = false): Record<string, unknown> {
  return {
    kind: 'app',
    manifestVersion: 1,
    key: 'velvet',
    name: 'Velvet',
    version: '0.1.0',
    publisher: { id: 'adminium', name: 'Adminium' },
    license: 'MIT',
    description: { key: 'd', fallback: 'A box office' },
    categories: ['crm'],
    compatibility: { minAdminiumVersion: '0.3.1' },
    requiredSchema: {
      prefixed: true,
      tables: [
        { ref: 'ticket_types', columns: [id, { ref: 'name', type: 'text', maxLength: 40 }, { ref: 'capacity', type: 'int', nullable: true }] },
        {
          ref: 'waitlist',
          columns: [id, { ref: 'email', type: 'text', maxLength: 80 }, { ref: 'status', type: 'enum', enum: ['waiting', 'offered', 'claimed'], default: 'waiting' }, offerUntil({ column: 'status', values: ['offered'] })],
          states: { column: 'status', initial: 'waiting', moves: { waiting: ['offered'], offered: ['claimed'] } },
        },
        {
          ref: 'orders',
          columns: [
            id,
            { ref: 'status', type: 'enum', enum: ['held', 'offered', 'door', 'paid', 'expired'], default: 'held' },
            { ref: 'held_until', type: 'timestamptz', nullable: true, rules: { stamp: { set: { addMinutes: { minutes: 10 } }, on: 'create' } } },
            { ref: 'waitlist_id', type: 'fk', references: 'waitlist', nullable: true },
          ],
          states: { column: 'status', initial: 'held', moves: { held: ['offered', 'door', 'paid', 'expired'], offered: ['door', 'expired'], door: ['paid'] } },
        },
        {
          ref: 'tickets',
          columns: [
            id,
            { ref: 'order_id', type: 'fk', references: 'orders' },
            { ref: 'ticket_type_id', type: 'fk', references: 'ticket_types' },
            { ref: 'status', type: 'enum', enum: ['valid', 'returned', 'released'], default: 'valid' },
          ],
          capacity: {
            kind: 'parent',
            via: 'ticket_type_id',
            size: { column: 'capacity' },
            countWhere: [
              { column: 'status', values: ['valid', 'returned'] },
              { via: 'order_id', column: 'status', values: ['held', 'offered', 'door', 'paid'] },
            ],
            hold: { via: 'order_id', states: ['held', 'offered'], column: { column: 'offer_until', via: 'waitlist_id', or: [{ column: 'held_until' }] } },
            reserved: { states: ['returned'], ...(release ? { releaseTo: 'released' } : {}) },
          },
          states: { column: 'status', initial: 'valid', moves: { valid: ['returned'], returned: ['released'] } },
        },
      ],
    },
    pages: [{ ref: 'overview', template: 'page-dashboard', title: { key: 't', fallback: 'Overview' }, nav: { group: 'velvet', icon: 'home', order: 1 } }],
    frontends: [{ side: 'staff', kind: 'spa' }],
  };
}

describe.each(LEGS)('a waitlist offer claimed over places kept for the waitlist — %s', (dialect, available) => {
  let h: InvoicingHarness;
  let w: Awaited<ReturnType<typeof writerFor>>;
  let guest: WriteContext;
  beforeAll(async () => {
    if (!available) return;
    h = await installInvoicing(dialect, velvet());
    w = await writerFor(h, 'Europe/London');
    guest = { ...w.desk, origin: 'public', actor: { kind: 'system', id: null, label: 'Guest' } };
  }, 180_000);
  afterAll(async () => {
    if (available) await h.close();
  });
  afterEach(() => vi.useRealTimers());
  const at = (when: string) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(when));
  };
  let n = 0;
  /** A paid order, as the database holds one. */
  const paidOrder = async (): Promise<unknown> => {
    await h.rows(`insert into ${h.real('orders')} (status) values ('paid')`);
    return (await h.rows(`select max(id) as id from ${h.real('orders')}`))[0]!['id'];
  };
  const status = async (ref: string, key: unknown) => (await h.rows(`select status from ${h.real(ref)} where id = ${String(key)}`))[0]!['status'];

  /**
   * A show of `capacity`: `sold` tickets on paid orders, `returned` of them given back, and an offer of `offered` places to
   * the first on the list, held until the offer ends (twelve hours from Tuesday 16:30).
   */
  async function show(capacity: number, sold: number, returned: number, offered: number) {
    at('2026-07-28T15:30:00Z');
    const type = await w.create('ticket_types', { name: 'Velvet Hour', capacity });
    // The show as it stands (written by the database: how it got there is not what is judged here).
    const paid = await paidOrder();
    const values = Array.from({ length: sold }, (_, i) => `(${String(paid)}, ${String(type['id'])}, '${i < returned ? 'returned' : 'valid'}')`).join(', ');
    await h.rows(`insert into ${h.real('tickets')} (order_id, ticket_type_id, status) values ${values}`);
    const entry = await w.create('waitlist', { email: `mia${String((n += 1))}@example.com` });
    await w.update('waitlist', entry['id'], { status: 'offered' });
    const offer = await w.create('orders', { waitlist_id: entry['id'] });
    await w.update('orders', offer['id'], { status: 'offered' });
    if (offered > 0) {
      await h.rows(`insert into ${h.real('tickets')} (order_id, ticket_type_id, status) values ${Array.from({ length: offered }, () => `(${String(offer['id'])}, ${String(type['id'])}, 'valid')`).join(', ')}`);
    }
    return { type, offer };
  }

  it.runIf(available)('lets the guest claim the offer of the places given back: 118 sold, 2 offered, 2 returned, of 120', async () => {
    const { offer } = await show(120, 120, 2, 2);
    at('2026-07-28T16:00:00Z');
    const claimed = await w.update('orders', offer['id'], { status: 'door' }, guest);
    expect(claimed.count).toBe(1);
    expect(await status('orders', offer['id'])).toBe('door');
  });

  it.runIf(available)('lets a quote of the claim through too', async () => {
    const { offer } = await show(120, 120, 2, 2);
    at('2026-07-28T16:00:00Z');
    const quote = await w.writes.update({ target: w.targetOf('orders'), pk: { id: offer['id'] }, values: { status: 'door' }, context: guest, mode: 'dry', announce: async () => {} });
    expect(quote.after?.['status']).toBe('door');
    expect(await status('orders', offer['id'])).toBe('offered');
  });

  it.runIf(available)('refuses a claim with no place given back behind it: an offer of more places than were returned', async () => {
    // 119 sold, one of them given back, and an offer of two: one place too many.
    const { offer } = await show(120, 120, 1, 2);
    at('2026-07-28T16:00:00Z');
    await expect(w.update('orders', offer['id'], { status: 'door' }, guest)).rejects.toMatchObject({ code: 'CAPACITY_FULL' });
    expect(await status('orders', offer['id'])).toBe('offered');
  });

  it.runIf(available)('refuses a claim whose offer ended and whose places were sold meanwhile', async () => {
    const { type, offer } = await show(120, 118, 0, 2);
    // The offer ends at 04:30; at 05:00 the box office sells the last two places.
    at('2026-07-29T05:00:00Z');
    const other = await paidOrder();
    await w.create('tickets', { order_id: other, ticket_type_id: type['id'] });
    await w.create('tickets', { order_id: other, ticket_type_id: type['id'] });
    await expect(w.update('orders', offer['id'], { status: 'door' }, guest)).rejects.toMatchObject({ code: 'CAPACITY_FULL' });
  });

  it.runIf(available && dialect !== 'sqlite')('gives the last places to exactly one of a late claim and a desk sale made at once', async () => {
    const { type, offer } = await show(120, 118, 0, 2);
    // The offer ended at 04:30: its places are free for whoever takes them first.
    at('2026-07-29T05:00:00Z');
    const other = await paidOrder();
    vi.useRealTimers();
    const [claim, sale] = await Promise.allSettled([
      w.update('orders', offer['id'], { status: 'door' }, guest),
      (async () => {
        await w.create('tickets', { order_id: other, ticket_type_id: type['id'] });
        await w.create('tickets', { order_id: other, ticket_type_id: type['id'] });
      })(),
    ]);
    const counted = Number((await h.rows(`select count(*) as n from ${h.real('tickets')} t join ${h.real('orders')} o on o.id = t.order_id where t.ticket_type_id = ${String(type['id'])} and o.status in ('door', 'paid')`))[0]!['n']);
    expect(counted).toBeLessThanOrEqual(120);
    expect([claim.status, sale.status].filter((s) => s === 'fulfilled').length).toBeGreaterThanOrEqual(1);
    if (claim.status === 'fulfilled') expect(sale.status).toBe('rejected');
  });

  it.runIf(available)("still keeps the places given back from a guest's new order", async () => {
    // 118 sold and 2 given back: a guest finds the show sold out, while the box office still has 2 to offer.
    const { type } = await show(120, 120, 2, 0);
    at('2026-07-28T16:00:00Z');
    const order = await w.create('orders', {}, guest);
    await expect(w.create('tickets', { order_id: order['id'], ticket_type_id: type['id'] }, guest)).rejects.toMatchObject({ code: 'CAPACITY_FULL' });
    const desk = await w.create('orders', {});
    expect(await w.create('tickets', { order_id: desk['id'], ticket_type_id: type['id'] })).toMatchObject({ order_id: desk['id'] });
  });
});

describe.each(LEGS)('a waitlist claim releases the places given back it took — %s', (dialect, available) => {
  let h: InvoicingHarness;
  let w: Awaited<ReturnType<typeof writerFor>>;
  let guest: WriteContext;
  beforeAll(async () => {
    if (!available) return;
    h = await installInvoicing(dialect, velvet(true));
    w = await writerFor(h, 'Europe/London');
    guest = { ...w.desk, origin: 'public', actor: { kind: 'system', id: null, label: 'Guest' } };
  }, 180_000);
  afterAll(async () => {
    if (available) await h.close();
  });
  afterEach(() => vi.useRealTimers());

  it.runIf(available)('moves two of three returned places to released when a claim of two passes, and the public counts one left', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-07-28T15:30:00Z'));
    const type = await w.create('ticket_types', { name: 'Velvet Hour', capacity: 120 });
    await h.rows(`insert into ${h.real('orders')} (status) values ('paid')`);
    const paid = (await h.rows(`select max(id) as id from ${h.real('orders')}`))[0]!['id'];
    // 120 sold, 3 given back; an offer of 2 to the first on the list.
    const sold = Array.from({ length: 120 }, (_, i) => `(${String(paid)}, ${String(type['id'])}, '${i < 3 ? 'returned' : 'valid'}')`).join(', ');
    await h.rows(`insert into ${h.real('tickets')} (order_id, ticket_type_id, status) values ${sold}`);
    const entry = await w.create('waitlist', { email: 'mia@example.com' });
    await w.update('waitlist', entry['id'], { status: 'offered' });
    const offer = await w.create('orders', { waitlist_id: entry['id'] });
    await w.update('orders', offer['id'], { status: 'offered' });
    await h.rows(`insert into ${h.real('tickets')} (order_id, ticket_type_id, status) values (${String(offer['id'])}, ${String(type['id'])}, 'valid'), (${String(offer['id'])}, ${String(type['id'])}, 'valid')`);
    vi.setSystemTime(new Date('2026-07-28T16:00:00Z'));
    expect((await w.update('orders', offer['id'], { status: 'door' }, guest)).count).toBe(1);
    const statuses = await h.rows(`select status, count(*) as n from ${h.real('tickets')} where ticket_type_id = ${String(type['id'])} group by status order by status`);
    expect(Object.fromEntries(statuses.map((row) => [row['status'], Number(row['n'])]))).toEqual({ released: 2, returned: 1, valid: 119 });
    // The one place still given back is the public's to be kept from: sold out for a guest, one for the box office.
    const order = await w.create('orders', {}, guest);
    await expect(w.create('tickets', { order_id: order['id'], ticket_type_id: type['id'] }, guest)).rejects.toMatchObject({ code: 'CAPACITY_FULL' });
  });
});
