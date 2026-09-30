// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Moves that wait for things, on a venue app installed for real on every
 * engine, on a fixed clock: a ticket let in once (the second scan is told
 * when and at which door), only for a paid order, only from half an hour
 * before the doors and before its day ends, only while door scanning is on;
 * a check-in recorded only for a valid ticket on its day; a stay checked in
 * only to a ready room, turning it occupied, and out to cleaning; a late
 * cancellation flagged or refused; stamps worked out from moments.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { WriteContext } from '../src/crud/write-service.js';
import { installInvoicing, LEGS, writerFor, type InvoicingHarness } from './invoicing-install.helpers.js';
import { venueManifest } from './venue-moves.fixture.js';

type Writer = Awaited<ReturnType<typeof writerFor>>;

const at = (iso: string) => vi.setSystemTime(new Date(iso));
const iso = (value: unknown) => (value instanceof Date ? value.toISOString() : new Date(String(value).includes('T') || String(value).endsWith('Z') ? String(value) : `${String(value).replace(' ', 'T')}`).toISOString());

describe.each(LEGS)('moves that wait for things — %s', (dialect, available) => {
  let h: InvoicingHarness;
  let w: Writer;
  let n = 0;
  beforeAll(async () => {
    if (!available) return;
    h = await installInvoicing(dialect, venueManifest({ timed: false }));
    w = await writerFor(h, 'Europe/London');
    await w.create('settings', {});
  }, 180_000);
  afterAll(async () => {
    if (available) await h.close();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const clock = (when: string) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    at(when);
  };
  const guest: () => WriteContext = () => ({ origin: 'public', hops: 0, actor: { kind: 'public', id: null, label: 'Public' }, request: null });

  /** An event on Fri 31 Jul 2026, doors 20:00 London (19:00Z), a paid order and a ticket valid that night. */
  async function ticketFor(opts: { pay?: string } = {}) {
    n += 1;
    const event = await w.create('events', { name: `Night ${String(n)}`, starts_at: '2026-07-31T19:30:00Z', doors_at: '2026-07-31T19:00:00Z' });
    const order = await w.create('orders', { event_id: event['id'], email: `buyer${String(n)}@example.com`, pay: opts.pay ?? 'paid' });
    const ticket = await w.create('tickets', {
      order_id: order['id'],
      event_id: event['id'],
      valid_from: '2026-07-31T17:00:00Z',
      valid_to: '2026-08-01T03:00:00Z',
    });
    return { event, order, ticket };
  }

  it.runIf(available)('once means once: a second scan is refused with when, by whom and at which door', async () => {
    const { ticket } = await ticketFor();
    clock('2026-07-31T18:45:00Z');
    await w.update('tickets', ticket['id'], { status: 'checked_in', door: 'Door 1' });
    clock('2026-07-31T18:50:00Z');
    const again = await w.update('tickets', ticket['id'], { status: 'checked_in', door: 'Door 2' }).catch((e: unknown) => e);
    expect(again).toMatchObject({ statusCode: 409, code: 'STATE_UNCHANGED', details: { column: 'status', state: 'checked_in', by: 'Ivy Ferreira', door: 'Door 1' } });
    expect(iso((again as { details: { at: unknown } }).details.at)).toBe('2026-07-31T18:45:00.000Z');
    const [row] = await h.rows(`select door from ${h.real('tickets')} where id = ${String(ticket['id'])}`);
    expect(row!['door']).toBe('Door 1');
    // A save that does not name the state still passes.
    await expect(w.update('tickets', ticket['id'], { door: 'Door 3' })).resolves.toMatchObject({ count: 1 });
    // History brings rows in as they were: an import re-sending the state is not refused.
    const importing: WriteContext = { ...w.desk, origin: 'import' };
    await expect(w.update('tickets', ticket['id'], { status: 'checked_in' }, importing)).resolves.toMatchObject({ count: 1 });
  });

  it.runIf(available)('a table without strict still takes the same state twice', async () => {
    const room = await w.create('rooms', { number: `R${String((n += 1))}` });
    await expect(w.update('rooms', room['id'], { status: 'ready' })).resolves.toMatchObject({ count: 1 });
    await expect(w.update('rooms', room['id'], { status: 'ready' })).resolves.toMatchObject({ count: 1 });
  });

  it.runIf(available)('a ticket of an unpaid transfer is not let in; a paid one is', async () => {
    const unpaid = await ticketFor({ pay: 'transfer' });
    clock('2026-07-31T18:45:00Z');
    await expect(w.update('tickets', unpaid.ticket['id'], { status: 'checked_in' })).rejects.toMatchObject({
      code: 'STATE_MOVE_REFUSED',
      details: { requires: 'linked', via: 'order_id', column: 'pay' },
    });
    await w.update('orders', unpaid.order['id'], { pay: 'paid' });
    await expect(w.update('tickets', unpaid.ticket['id'], { status: 'checked_in' })).resolves.toMatchObject({ count: 1 });
  });

  it.runIf(available)('lets a ticket in from half an hour before the doors, and not after its day', async () => {
    const early = await ticketFor();
    clock('2026-07-31T18:29:00Z');
    await expect(w.update('tickets', early.ticket['id'], { status: 'checked_in' })).rejects.toMatchObject({
      code: 'STATE_MOVE_REFUSED',
      details: { requires: 'time', bound: 'after', at: '2026-07-31T18:30:00.000Z' },
    });
    clock('2026-07-31T18:30:00Z');
    await expect(w.update('tickets', early.ticket['id'], { status: 'checked_in' })).resolves.toMatchObject({ count: 1 });
    const late = await ticketFor();
    clock('2026-08-01T11:00:00Z');
    await expect(w.update('tickets', late.ticket['id'], { status: 'checked_in' })).rejects.toMatchObject({
      code: 'STATE_MOVE_REFUSED',
      details: { requires: 'time', bound: 'before', at: '2026-08-01T03:00:00.000Z' },
    });
  });

  it.runIf(available)('lets nobody in while door scanning is switched off', async () => {
    const { ticket } = await ticketFor();
    const [settings] = await h.rows(`select id from ${h.real('settings')}`);
    await w.update('settings', settings!['id'], { door_on: false });
    try {
      clock('2026-07-31T18:45:00Z');
      await expect(w.update('tickets', ticket['id'], { status: 'checked_in' })).rejects.toMatchObject({
        code: 'STATE_MOVE_REFUSED',
        details: { requires: 'setting', column: 'door_on' },
      });
    } finally {
      await w.update('settings', settings!['id'], { door_on: true });
    }
  });

  it.runIf(available)('records a check-in only for a valid ticket, on its day', async () => {
    const { ticket } = await ticketFor();
    clock('2026-07-31T16:59:00Z');
    await expect(w.create('check_ins', { ticket_id: ticket['id'], day: '2026-07-31' })).rejects.toMatchObject({
      code: 'STATE_MOVE_REFUSED',
      details: { create: true, requires: 'time', bound: 'after', at: '2026-07-31T17:00:00.000Z' },
    });
    clock('2026-07-31T18:00:00Z');
    await expect(w.create('check_ins', { ticket_id: ticket['id'], day: '2026-07-31' })).resolves.toMatchObject({ status: 'in' });
    await w.update('tickets', ticket['id'], { status: 'refund_asked' });
    await expect(w.create('check_ins', { ticket_id: ticket['id'], day: '2026-07-31' })).rejects.toMatchObject({
      code: 'STATE_MOVE_REFUSED',
      details: { create: true, requires: 'linked', via: 'ticket_id', column: 'status' },
    });
    // An import brings in what happened, whatever the ticket is now.
    await expect(w.create('check_ins', { ticket_id: ticket['id'], day: '2026-07-30' }, { ...w.desk, origin: 'import' })).resolves.toMatchObject({ status: 'in' });
  });

  it.runIf(available)('checks a stay in only to a ready room, turning it occupied, and out to cleaning', async () => {
    const room = await w.create('rooms', { number: `R${String((n += 1))}` });
    const stay = await w.create('stays', { room_id: room['id'], arrive: '2026-08-10' });
    const inHouse = await w.update('stays', stay['id'], { status: 'in_house' });
    expect(inHouse.effects?.map((e) => e.after?.['status'])).toEqual(['occupied']);
    const [occupied] = await h.rows(`select status from ${h.real('rooms')} where id = ${String(room['id'])}`);
    expect(occupied!['status']).toBe('occupied');
    await w.update('stays', stay['id'], { status: 'departed' });
    const [cleaning] = await h.rows(`select status from ${h.real('rooms')} where id = ${String(room['id'])}`);
    expect(cleaning!['status']).toBe('cleaning');
    // The next guest cannot be checked in to a room being cleaned; the room set in the same write is the one judged.
    const next = await w.create('stays', { arrive: '2026-08-10' });
    await expect(w.update('stays', next['id'], { status: 'in_house', room_id: room['id'] })).rejects.toMatchObject({
      code: 'STATE_MOVE_REFUSED',
      details: { requires: 'linked', via: 'room_id', column: 'status' },
    });
    const ready = await w.create('rooms', { number: `R${String((n += 1))}` });
    await expect(w.update('stays', next['id'], { status: 'in_house', room_id: ready['id'] })).resolves.toMatchObject({ count: 1 });
  });

  it.runIf(available)('flags a cancellation inside 48 hours of the 15:00 arrival, whoever makes it', async () => {
    const inside = await w.create('stays', { arrive: '2026-08-10' });
    const outside = await w.create('stays', { arrive: '2026-08-10' });
    // 15:00 London on 10 Aug is 14:00Z: 29 hours before, and 50.
    clock('2026-08-09T09:00:00Z');
    await w.update('stays', inside['id'], { status: 'cancelled', arrival_time: '22:00' }, guest());
    clock('2026-08-08T12:00:00Z');
    await w.update('stays', outside['id'], { status: 'cancelled', late_cancel: true });
    const rows = await h.rows(`select id, late_cancel from ${h.real('stays')} where id in (${String(inside['id'])}, ${String(outside['id'])}) order by id`);
    expect(rows.map((r) => Boolean(Number(r['late_cancel'])))).toEqual([true, false]);
  });

  it.runIf(available)('never flags a cancellation by the house, inside the window or not', async () => {
    const house = await w.create('stays', { arrive: '2026-08-10' });
    const guestCancel = await w.create('stays', { arrive: '2026-08-10' });
    clock('2026-08-09T09:00:00Z');
    // A flag sent for a move the rule's where leaves out is Adminium's to drop.
    await w.update('stays', house['id'], { status: 'cancelled', cancel_code: 'house', late_cancel: true });
    await w.update('stays', guestCancel['id'], { status: 'cancelled', cancel_code: 'no_card' });
    const rows = await h.rows(`select id, late_cancel from ${h.real('stays')} where id in (${String(house['id'])}, ${String(guestCancel['id'])}) order by id`);
    expect(rows.map((r) => Boolean(Number(r['late_cancel'])))).toEqual([false, true]);
  });

  it.runIf(available)('lets a booked stay leave earlier, and refuses it once the stay is in the house', async () => {
    const room = await w.create('rooms', { number: `R${String((n += 1))}` });
    const stay = await w.create('stays', { arrive: '2026-08-10', depart: '2026-08-14', room_id: room['id'] });
    await expect(w.update('stays', stay['id'], { depart: '2026-08-13' })).resolves.toMatchObject({ count: 1 });
    await w.update('stays', stay['id'], { status: 'in_house' });
    await expect(w.update('stays', stay['id'], { depart: '2026-08-12' })).rejects.toMatchObject({ details: { reason: 'ONLY_LATER' } });
    await expect(w.update('stays', stay['id'], { depart: '2026-08-15' })).resolves.toMatchObject({ count: 1 });
  });

  it.runIf(available)('turns a guest away inside the window in refuse mode, and lets staff through', async () => {
    const a = await w.create('bookings', { arrive: '2026-08-10', email: 'a@example.com' });
    const b = await w.create('bookings', { arrive: '2026-08-10', email: 'b@example.com' });
    clock('2026-08-09T09:00:00Z');
    await expect(w.update('bookings', a['id'], { status: 'cancelled' }, guest())).rejects.toMatchObject({
      code: 'STATE_TOO_LATE',
      details: { column: 'status', at: '2026-08-10T14:00:00.000Z' },
    });
    await expect(w.update('bookings', b['id'], { status: 'cancelled' })).resolves.toMatchObject({ count: 1 });
  });

  it.runIf(available)('stamps a hold, a transfer deadline, an offer and a cancel-by worked out from moments', async () => {
    clock('2026-07-27T10:00:00Z');
    const event = await w.create('events', { name: 'Stamps', starts_at: '2026-08-10T19:00:00Z', doors_at: '2026-08-10T18:30:00Z' });
    const order = await w.create('orders', { event_id: event['id'], email: 's@example.com' });
    expect(iso(order['held_until'])).toBe('2026-07-27T10:10:00.000Z');
    // Five days on at 18:00 London (Sat 1 Aug 17:00Z), before three days before the show (7 Aug 19:00Z).
    await w.update('orders', order['id'], { status: 'awaiting_transfer' });
    const [due] = await h.rows(`select pay_by from ${h.real('orders')} where id = ${String(order['id'])}`);
    expect(iso(due!['pay_by'])).toBe('2026-08-01T17:00:00.000Z');
    // A show in two days: the cap wins.
    const soon = await w.create('events', { name: 'Soon', starts_at: '2026-07-29T19:00:00Z', doors_at: '2026-07-29T18:30:00Z' });
    const rushed = await w.create('orders', { event_id: soon['id'], email: 't@example.com' });
    await w.update('orders', rushed['id'], { status: 'awaiting_transfer' });
    const [capped] = await h.rows(`select pay_by from ${h.real('orders')} where id = ${String(rushed['id'])}`);
    expect(iso(capped!['pay_by'])).toBe('2026-07-26T19:00:00.000Z');
    const entry = await w.create('waitlist', { event_id: event['id'], email: 'w@example.com' });
    await w.update('waitlist', entry['id'], { status: 'offered' });
    const [offered] = await h.rows(`select offered_until from ${h.real('waitlist')} where id = ${String(entry['id'])}`);
    expect(iso(offered!['offered_until'])).toBe('2026-07-27T22:00:00.000Z');
    // Arrive 15:00 London less 48 hours; moved when the arrival moves.
    const stay = await w.create('stays', { arrive: '2026-08-10' });
    expect(iso(stay['cancel_by'])).toBe('2026-08-08T14:00:00.000Z');
    await w.update('stays', stay['id'], { arrive: '2026-08-12' });
    const [moved] = await h.rows(`select cancel_by from ${h.real('stays')} where id = ${String(stay['id'])}`);
    expect(iso(moved!['cancel_by'])).toBe('2026-08-10T14:00:00.000Z');
  });
});
