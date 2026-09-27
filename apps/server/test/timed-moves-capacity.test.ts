// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Timed moves and the limits they free, on every engine, the clock fixed:
 * a held order stops counting at its `held_until` whether or not the minute
 * job has run, and the job then moves it to expired; a transfer released at
 * its deadline gives its tickets back to sale; a stay not arrived by the next
 * morning frees its nights.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { runTimedMoves } from '../src/states/timed-moves.js';
import { installInvoicing, LEGS, writerFor, type InvoicingHarness } from './invoicing-install.helpers.js';

type Doc = Record<string, unknown>;
const id = { ref: 'id', type: 'int', role: 'pk' };
const setting = (column: string) => ({ table: 'settings', column });

function capacityVenue(): Doc {
  const tables: Doc[] = [
    { ref: 'settings', columns: [id, { ref: 'hold_minutes', type: 'int', default: 10 }, { ref: 'no_show_at', type: 'text', maxLength: 5, default: '10:00' }] },
    { ref: 'events', columns: [id, { ref: 'name', type: 'text', maxLength: 80 }, { ref: 'starts_at', type: 'timestamptz' }] },
    { ref: 'ticket_types', columns: [id, { ref: 'event_id', type: 'fk', references: 'events' }, { ref: 'capacity', type: 'int', nullable: true }] },
    {
      ref: 'orders',
      columns: [
        id,
        { ref: 'event_id', type: 'fk', references: 'events' },
        { ref: 'status', type: 'enum', enum: ['held', 'awaiting_transfer', 'paid', 'expired', 'released'], default: 'held' },
        { ref: 'held_until', type: 'timestamptz', nullable: true, rules: { stamp: { set: { addMinutes: { minutes: setting('hold_minutes') } }, on: 'create' } } },
        { ref: 'pay_by', type: 'timestamptz', nullable: true },
      ],
      states: {
        column: 'status',
        initial: 'held',
        moves: { held: ['awaiting_transfer', 'paid', 'expired'], awaiting_transfer: ['paid', 'released'] },
        timed: [
          { from: 'held', to: 'expired', at: { column: 'held_until' } },
          { from: 'awaiting_transfer', to: 'released', at: { column: 'pay_by' } },
        ],
      },
    },
    {
      ref: 'tickets',
      columns: [id, { ref: 'order_id', type: 'fk', references: 'orders' }, { ref: 'ticket_type_id', type: 'fk', references: 'ticket_types' }],
      capacity: {
        kind: 'parent',
        via: 'ticket_type_id',
        size: { column: 'capacity' },
        countWhere: { column: 'status', values: ['held', 'awaiting_transfer', 'paid'], via: 'order_id' },
        hold: { column: 'held_until', states: ['held'], via: 'order_id' },
      },
    },
    { ref: 'room_types', columns: [id, { ref: 'name', type: 'text', maxLength: 40 }] },
    { ref: 'rooms', columns: [id, { ref: 'room_type_id', type: 'fk', references: 'room_types' }] },
    {
      ref: 'stays',
      columns: [
        id,
        { ref: 'room_type_id', type: 'fk', references: 'room_types' },
        { ref: 'arrive', type: 'date' },
        { ref: 'depart', type: 'date' },
        { ref: 'status', type: 'enum', enum: ['booked', 'in_house', 'no_show'], default: 'booked' },
      ],
      capacity: {
        kind: 'night',
        from: 'arrive',
        to: 'depart',
        countWhere: { column: 'status', values: ['booked', 'in_house'] },
        pool: { via: 'room_type_id', count: { table: 'rooms', column: 'room_type_id' } },
      },
      states: {
        column: 'status',
        initial: 'booked',
        moves: { booked: ['in_house', 'no_show'] },
        timed: [{ from: 'booked', to: 'no_show', at: { column: 'arrive', plus: { days: 1 }, time: setting('no_show_at') } }],
      },
    },
  ];
  return {
    kind: 'app',
    manifestVersion: 1,
    key: 'venue',
    name: 'Venue',
    version: '0.1.0',
    publisher: { id: 'adminium', name: 'Adminium' },
    license: 'MIT',
    description: { key: 'd', fallback: 'A venue' },
    categories: ['crm'],
    compatibility: { minAdminiumVersion: '0.3.1' },
    requiredSchema: { prefixed: true, tables },
    pages: [{ ref: 'overview', template: 'page-dashboard', title: { key: 't', fallback: 'Overview' }, nav: { group: 'venue', icon: 'home', order: 1 } }],
    frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html' }],
  };
}

describe.each(LEGS)('timed moves free what they held — %s', (dialect, available) => {
  let h: InvoicingHarness;
  let w: Awaited<ReturnType<typeof writerFor>>;
  beforeAll(async () => {
    if (!available) return;
    h = await installInvoicing(dialect, capacityVenue());
    await h.meta.db.updateTable('adminium_connections').set({ timezone: 'Europe/London' } as never).where('id', '=', h.connectionId).execute();
    w = await writerFor(h, 'Europe/London');
    await w.create('settings', {});
  }, 180_000);
  afterAll(async () => {
    if (available) await h.close();
  });
  afterEach(() => vi.useRealTimers());
  const clock = (when: string) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(when));
    return new Date(when);
  };
  const tick = (when: string) => runTimedMoves({ meta: h.meta, manager: h.manager }, h.connectionId, {}, clock(when));

  it.runIf(available)('stops counting a held order at 10:00 with no tick, and the tick then expires it', async () => {
    const show = await w.create('events', { name: 'Hold', starts_at: '2026-08-20T19:00:00Z' });
    const type = await w.create('ticket_types', { event_id: show['id'], capacity: 1 });
    clock('2026-07-28T08:50:00Z');
    const held = await w.create('orders', { event_id: show['id'] });
    await w.create('tickets', { order_id: held['id'], ticket_type_id: type['id'] });
    const other = await w.create('orders', { event_id: show['id'] });
    await expect(w.create('tickets', { order_id: other['id'], ticket_type_id: type['id'] })).rejects.toMatchObject({ code: 'CAPACITY_FULL' });
    // 10:00:00 London is 09:00:00Z: the hold has ended; the job has not run.
    clock('2026-07-28T09:00:00Z');
    await expect(w.create('tickets', { order_id: other['id'], ticket_type_id: type['id'] })).resolves.toBeDefined();
    await tick('2026-07-28T09:00:30Z');
    expect((await h.rows(`select status from ${h.real('orders')} where id = ${String(held['id'])}`))[0]!['status']).toBe('expired');
  });

  it.runIf(available)('gives the tickets of a transfer released at its deadline back to sale', async () => {
    const show = await w.create('events', { name: 'Transfer', starts_at: '2026-08-20T19:00:00Z' });
    const type = await w.create('ticket_types', { event_id: show['id'], capacity: 1 });
    clock('2026-07-28T08:00:00Z');
    const order = await w.create('orders', { event_id: show['id'] });
    await w.create('tickets', { order_id: order['id'], ticket_type_id: type['id'] });
    await w.update('orders', order['id'], { status: 'awaiting_transfer', pay_by: '2026-08-01T17:00:00Z' });
    // A buyer holding places now, while the transfer is still due.
    clock('2026-08-01T16:00:00Z');
    const next = await w.create('orders', { event_id: show['id'] });
    await expect(w.create('tickets', { order_id: next['id'], ticket_type_id: type['id'] })).rejects.toMatchObject({ code: 'CAPACITY_FULL' });
    await tick('2026-08-01T17:00:30Z');
    expect((await h.rows(`select status from ${h.real('orders')} where id = ${String(order['id'])}`))[0]!['status']).toBe('released');
    const later = await w.create('orders', { event_id: show['id'] });
    await expect(w.create('tickets', { order_id: later['id'], ticket_type_id: type['id'] })).resolves.toBeDefined();
  });

  it.runIf(available)('frees the nights of a stay not arrived by 10:00 the next day', async () => {
    const type = await w.create('room_types', { name: 'Double' });
    await w.create('rooms', { room_type_id: type['id'] });
    clock('2026-08-01T12:00:00Z');
    await w.create('stays', { room_type_id: type['id'], arrive: '2026-08-10', depart: '2026-08-12' });
    await expect(w.create('stays', { room_type_id: type['id'], arrive: '2026-08-11', depart: '2026-08-12' })).rejects.toMatchObject({ code: 'CAPACITY_FULL' });
    await tick('2026-08-11T09:00:30Z');
    await expect(w.create('stays', { room_type_id: type['id'], arrive: '2026-08-11', depart: '2026-08-12' })).resolves.toBeDefined();
  });
});
