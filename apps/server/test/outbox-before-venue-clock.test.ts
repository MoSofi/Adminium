// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A reminder before a moment, on the venue's clock, whatever zone the server
 * runs in: to the hour (three hours before a show), and "the day before at
 * 09:00" — at 09:00 where the venue is, across the night the clocks go back.
 * Run in a server zone far from the venue's too (`TZ=America/Los_Angeles`).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createOutboxProducers } from '../src/outbox/producers.js';
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
  beforeAll(async () => {
    if (!available) return;
    h = await installInvoicing(dialect, venueManifest({ outbox: true, timed: false }));
    await h.meta.db.updateTable('adminium_connections').set({ timezone: 'Europe/London' } as never).where('id', '=', h.connectionId).execute();
    w = await writerFor(h, 'Europe/London');
    await w.create('settings', {});
    producers = createOutboxProducers({ meta: h.meta, manager: h.manager, viewFor: createPublicViews(h.meta).viewFor, writes: createWriteService(writeStores(h.meta)) });
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
});
