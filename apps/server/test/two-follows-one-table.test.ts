// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Two copies on one table following two parents, on every engine, the clock
 * fixed: a ticket keeps its order's status and its show's doors in step,
 * while it totals its price into its order. The show postponed moves every
 * ticket's doors and nothing of the order's total; the order paid moves every
 * ticket's copy of its status; and a timed move reading the ticket's own
 * copied doors (a place given back at the doors) fires at the doors as they
 * are now — not at the time they were.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { readInstant } from '../src/crud/moments.js';
import { runTimedMoves } from '../src/states/timed-moves.js';
import { installInvoicing, LEGS, writerFor, type InvoicingHarness } from './invoicing-install.helpers.js';

const id = { ref: 'id', type: 'int', role: 'pk' };

function boxOffice(): Record<string, unknown> {
  return {
    kind: 'app',
    manifestVersion: 1,
    key: 'shows',
    name: 'Shows',
    version: '0.1.0',
    publisher: { id: 'adminium', name: 'Adminium' },
    license: 'MIT',
    description: { key: 'd', fallback: 'A box office' },
    categories: ['crm'],
    compatibility: { minAdminiumVersion: '0.3.1' },
    requiredSchema: {
      prefixed: true,
      tables: [
        { ref: 'events', columns: [id, { ref: 'name', type: 'text', maxLength: 40 }, { ref: 'doors_at', type: 'timestamptz' }] },
        {
          ref: 'orders',
          columns: [
            id,
            { ref: 'event_id', type: 'fk', references: 'events' },
            { ref: 'status', type: 'enum', enum: ['held', 'paid', 'cancelled'], default: 'held' },
            { ref: 'total', type: 'decimal', scale: 2, nullable: true, rules: { rollup: { from: 'tickets', via: 'order_id', sum: 'price' } } },
          ],
          states: { column: 'status', initial: 'held', moves: { held: ['paid', 'cancelled'], paid: ['cancelled'] } },
        },
        {
          ref: 'tickets',
          columns: [
            id,
            { ref: 'order_id', type: 'fk', references: 'orders' },
            { ref: 'event_id', type: 'fk', references: 'events' },
            { ref: 'price', type: 'decimal', scale: 2, default: 0 },
            { ref: 'status', type: 'enum', enum: ['valid', 'returned', 'released'], default: 'valid' },
            { ref: 'order_status', type: 'enum', enum: ['held', 'paid', 'cancelled'], nullable: true, rules: { copy: { via: 'order_id', from: 'status', mode: 'always', follow: true } } },
            { ref: 'doors_at', type: 'timestamptz', nullable: true, rules: { copy: { via: 'event_id', from: 'doors_at', mode: 'always', follow: true } } },
          ],
          states: { column: 'status', initial: 'valid', moves: { valid: ['returned'], returned: ['released'] }, timed: [{ from: 'returned', to: 'released', at: { column: 'doors_at' } }] },
        },
      ],
    },
    pages: [{ ref: 'overview', template: 'page-dashboard', title: { key: 't', fallback: 'Overview' }, nav: { group: 'shows', icon: 'home', order: 1 } }],
    frontends: [{ side: 'staff', kind: 'spa' }],
  };
}

describe.each(LEGS)('a ticket follows its order and its show at once — %s', (dialect, available) => {
  let h: InvoicingHarness;
  let w: Awaited<ReturnType<typeof writerFor>>;
  beforeAll(async () => {
    if (!available) return;
    h = await installInvoicing(dialect, boxOffice());
    await h.meta.db.updateTable('adminium_connections').set({ timezone: 'Europe/London' } as never).where('id', '=', h.connectionId).execute();
    w = await writerFor(h, 'Europe/London');
  }, 180_000);
  afterAll(async () => {
    if (available) await h.close();
  });
  afterEach(() => vi.useRealTimers());
  const at = (when: string) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(when));
  };
  const tickets = async (order: unknown) => h.rows(`select * from ${h.real('tickets')} where order_id = ${String(order)} order by id`);

  it.runIf(available)("keeps both copies in step, the order's total as it was, and gives a place back at the doors as they are now", async () => {
    at('2026-07-01T09:00:00Z');
    const event = await w.create('events', { name: 'Velvet Hour', doors_at: '2026-07-28T18:30:00Z' });
    const order = await w.create('orders', { event_id: event['id'] });
    for (const price of ['20.00', '25.00']) await w.create('tickets', { order_id: order['id'], event_id: event['id'], price });
    expect((await tickets(order['id'])).map((t) => [t['order_status'], readInstant(t['doors_at'])?.toISOString()])).toEqual([
      ['held', '2026-07-28T18:30:00.000Z'],
      ['held', '2026-07-28T18:30:00.000Z'],
    ]);
    // The show moves a day later: every ticket's doors follow; the order's total is what its tickets cost.
    await w.update('events', event['id'], { doors_at: '2026-07-29T18:30:00Z' });
    await w.update('orders', order['id'], { status: 'paid' });
    const rows = await tickets(order['id']);
    expect(rows.map((t) => [t['order_status'], readInstant(t['doors_at'])?.toISOString()])).toEqual([
      ['paid', '2026-07-29T18:30:00.000Z'],
      ['paid', '2026-07-29T18:30:00.000Z'],
    ]);
    expect(Number((await h.rows(`select total from ${h.real('orders')} where id = ${String(order['id'])}`))[0]!['total'])).toBe(45);
    // A place given back is put on sale at the doors — the doors as they are now.
    await w.update('tickets', rows[0]!['id'], { status: 'returned' });
    const tick = (when: string) => {
      at(when);
      return runTimedMoves({ meta: h.meta, manager: h.manager }, h.connectionId, {}, new Date(when));
    };
    await tick('2026-07-28T18:31:00Z');
    expect((await tickets(order['id']))[0]!['status']).toBe('returned');
    await tick('2026-07-29T18:31:00Z');
    expect((await tickets(order['id']))[0]!['status']).toBe('released');
  });
});
