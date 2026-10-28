// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A reminder before a moment, on the venue's clock, whatever zone the server
 * runs in: to the hour (three hours before a show), and "the day before at
 * 09:00" — at 09:00 where the venue is, across the night the clocks go back.
 * Run in a server zone far from the venue's too (`TZ=America/Los_Angeles`).
 *
 * And it GOES then: the sender takes it as soon as the scan queues it, at its
 * lead, not once the moment itself has passed (its due column keeps the
 * moment, to the second, on both sides of the clock change); a reminder
 * queued by hand ("Send now", due at the moment) goes at once, and the scan's
 * own one does not follow.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createOutboxProducers } from '../src/outbox/producers.js';
import { createOutboxSender } from '../src/outbox/sender.js';
import { createPublicViews } from '../src/public-api/runtime.js';
import { createWriteService } from '../src/crud/write-service.js';
import { writeStores } from '../src/crud/write-stores.js';
import { installInvoicing, LEGS, writerFor, type InvoicingHarness } from './invoicing-install.helpers.js';
import { venueManifest } from './venue-moves.fixture.js';

type Writer = Awaited<ReturnType<typeof writerFor>>;

describe.each(LEGS)('reminders on the venue clock — %s', (dialect, available) => {
  let h: InvoicingHarness;
  let w: Writer;
  let producers: ReturnType<typeof createOutboxProducers>;
  let sender: ReturnType<typeof createOutboxSender>;
  beforeAll(async () => {
    if (!available) return;
    h = await installInvoicing(dialect, venueManifest({ outbox: true, timed: false }));
    await h.meta.db.updateTable('adminium_connections').set({ timezone: 'Europe/London' } as never).where('id', '=', h.connectionId).execute();
    w = await writerFor(h, 'Europe/London');
    await w.create('settings', {});
    const viewFor = createPublicViews(h.meta).viewFor;
    const writes = createWriteService(writeStores(h.meta));
    producers = createOutboxProducers({ meta: h.meta, manager: h.manager, viewFor, writes });
    sender = createOutboxSender({ meta: h.meta, manager: h.manager, viewFor, writes, live: () => producers.live() });
  }, 180_000);
  afterAll(async () => {
    if (available) await h.close();
  });

  const queued = async (order: unknown, kind: string) =>
    (await h.rows(`select due_at from ${h.real('messages')} where order_id = ${String(order)} and kind = '${kind}'`)).map((r) => new Date(r['due_at'] as string).toISOString());

  it.runIf(available)('sends three hours before, to the hour, and the day before at 09:00 on the venue clock', async () => {
    // Sun 25 Oct 2026, 20:00 GMT (the clocks went back that night).
    const show = await w.create('events', { name: 'Autumn', starts_at: '2026-10-25T20:00:00Z', doors_at: '2026-10-25T19:30:00Z' });
    const order = await w.create('orders', { event_id: show['id'], email: 'autumn@example.com', show_at: '2026-10-25T20:00:00Z' });
    // 24 hours before is Sat 24 Oct 20:00 GMT = 21:00 BST: the day before, at 09:00 BST, is 08:00Z.
    expect(await producers.scan(Date.parse('2026-10-24T07:59:00Z'))).toBe(0);
    await producers.scan(Date.parse('2026-10-24T08:00:30Z'));
    expect(await queued(order['id'], 'reminder')).toHaveLength(1);
    expect(await queued(order['id'], 'soon')).toHaveLength(0);
    await producers.scan(Date.parse('2026-10-25T16:59:00Z'));
    expect(await queued(order['id'], 'soon')).toHaveLength(0);
    await producers.scan(Date.parse('2026-10-25T17:00:30Z'));
    expect(await queued(order['id'], 'soon')).toHaveLength(1);
    // Never twice.
    await producers.scan(Date.parse('2026-10-25T17:10:00Z'));
    expect(await queued(order['id'], 'reminder')).toHaveLength(1);
    expect(await queued(order['id'], 'soon')).toHaveLength(1);
  });

  const log = async (order: unknown) =>
    (await h.rows(`select kind, status, due_at from ${h.real('messages')} where order_id = ${String(order)} order by id`)).map((r) => ({ kind: r['kind'], waiting: r['status'] === 'queued', due: new Date(r['due_at'] as string).toISOString() }));

  it.runIf(available)('goes at its lead, not once the moment has passed, on both sides of the clock change', async () => {
    // Fri 23 Oct 2026, 10:15 BST (09:15Z), and Fri 30 Oct, 10:15 GMT (10:15Z): three hours before each.
    for (const [show, lead] of [
      ['2026-10-23T09:15:00Z', '2026-10-23T06:15:00Z'],
      ['2026-10-30T10:15:00Z', '2026-10-30T07:15:00Z'],
    ] as const) {
      const event = await w.create('events', { name: `Morning ${show}`, starts_at: show, doors_at: show });
      const order = await w.create('orders', { event_id: event['id'], email: 'morning@venue.dev', show_at: show });
      const ms = Date.parse(lead);
      await producers.scan(ms - 60_000);
      expect((await log(order['id'])).filter((m) => m.kind === 'soon')).toEqual([]);
      await producers.scan(ms + 30_000);
      // Its due column keeps the moment itself, to the second.
      expect((await log(order['id'])).filter((m) => m.kind === 'soon')).toEqual([{ kind: 'soon', waiting: true, due: new Date(show).toISOString() }]);
      // The sender takes it now, three hours ahead: it does not wait for the show.
      await sender.sendApp('venue', ms + 60_000);
      expect((await log(order['id'])).filter((m) => m.kind === 'soon').map((m) => m.waiting)).toEqual([false]);
    }
  });

  it.runIf(available)('sends a reminder queued by hand at once, and the scan adds none of its own', async () => {
    const show = '2026-11-20T19:30:00Z';
    const event = await w.create('events', { name: 'Winter', starts_at: show, doors_at: show });
    const order = await w.create('orders', { event_id: event['id'], email: 'winter@venue.dev', show_at: show });
    // "Send now", two days ahead: due at the moment, as a desk queues it.
    const now = Date.parse('2026-11-18T12:00:00Z');
    await w.create('messages', { kind: 'soon', status: 'queued', order_id: order['id'], to_address: 'winter@venue.dev', due_at: show });
    await sender.sendApp('venue', now);
    expect((await log(order['id'])).map((m) => m.waiting)).toEqual([false]);
    // At its own lead the scan finds it already there.
    await producers.scan(Date.parse('2026-11-20T16:30:30Z'));
    expect((await log(order['id'])).filter((m) => m.kind === 'soon')).toHaveLength(1);
  });
});
