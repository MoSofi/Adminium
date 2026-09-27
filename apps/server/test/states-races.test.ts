// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Moves that wait for another row, under writers at once, on Postgres and
 * MySQL (SQLite writes one transaction at a time): a ticket whose order link
 * is changed while its scan waits is refused to be made again, never judged
 * on the order it no longer belongs to; an order paid while its ticket is
 * scanned never deadlocks with it, and the ticket is let in only for a paid
 * order; two guests checked in to one room at once — only one gets it, and
 * the room is occupied once.
 */
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { installInvoicing, LEGS, writerFor, type InvoicingHarness } from './invoicing-install.helpers.js';
import { venueManifest } from './venue-moves.fixture.js';

type Writer = Awaited<ReturnType<typeof writerFor>>;
const SERVERS = LEGS.filter(([dialect]) => dialect !== 'sqlite');
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe.each(SERVERS)('moves that wait for another row, at once — %s', (dialect, available) => {
  let h: InvoicingHarness;
  let w: Writer;
  /** The other writer of a race, through a pool of its own: a pool of one stays `w`'s. */
  let other: Writer;
  let n = 0;
  beforeAll(async () => {
    if (!available) return;
    h = await installInvoicing(dialect, venueManifest({ timed: false }));
    w = await writerFor(h, 'Europe/London');
    other = await writerFor(await h.twin(), 'Europe/London');
    await w.create('settings', {});
  }, 180_000);
  afterAll(async () => {
    if (available) await h.close();
  });

  /** A show whose doors opened an hour ago, so only the links decide. */
  async function ticketFor(pay: string) {
    n += 1;
    const now = Date.now();
    const event = await w.create('events', { name: `Race ${String(n)}`, starts_at: new Date(now + 3_600_000).toISOString(), doors_at: new Date(now - 3_600_000).toISOString() });
    const order = await w.create('orders', { event_id: event['id'], email: `race${String(n)}@example.com`, pay });
    const ticket = await w.create('tickets', {
      order_id: order['id'],
      event_id: event['id'],
      valid_from: new Date(now - 7_200_000).toISOString(),
      valid_to: new Date(now + 7_200_000).toISOString(),
    });
    return { event, order, ticket };
  }

  it.runIf(available)('refuses a scan whose order link moved while it waited, to be made again', async () => {
    const paid = await ticketFor('paid');
    const unpaid = await w.create('orders', { event_id: paid.event['id'], email: `moved${String(n)}@example.com`, pay: 'transfer' });
    const { db } = other.targetOf('tickets');
    let scan: Promise<unknown> | undefined;
    await db.transaction().execute(async (trx) => {
      // Another writer moves the ticket to an unpaid order and holds it...
      await sql`update ${sql.table(h.real('tickets'))} set order_id = ${unpaid['id']} where id = ${paid.ticket['id']}`.execute(trx);
      // ...while the scan reads the paid order as the link, then waits for the ticket.
      scan = w.update('tickets', paid.ticket['id'], { status: 'checked_in' }).catch((error: unknown) => error);
      await sleep(400);
    });
    const outcome = await scan;
    expect(outcome).toMatchObject({ code: 'WRITE_CONFLICT', details: { retry: true, column: 'order_id' } });
    const [row] = await h.rows(`select status from ${h.real('tickets')} where id = ${String(paid.ticket['id'])}`);
    expect(row!['status']).toBe('valid');
    // Made again, it is judged on the order it belongs to now.
    await expect(w.update('tickets', paid.ticket['id'], { status: 'checked_in' })).rejects.toMatchObject({ code: 'STATE_MOVE_REFUSED', details: { requires: 'linked', via: 'order_id' } });
  });

  it.runIf(available)('pays an order while its ticket is scanned, never deadlocking, and lets the ticket in only once paid', async () => {
    for (let round = 0; round < 8; round += 1) {
      const { order, ticket } = await ticketFor('transfer');
      const [pay, scan] = await Promise.allSettled([other.update('orders', order['id'], { pay: 'paid' }), w.update('tickets', ticket['id'], { status: 'checked_in' })]);
      expect(pay.status).toBe('fulfilled');
      if (scan.status === 'rejected') expect(scan.reason).toMatchObject({ code: 'STATE_MOVE_REFUSED', details: { requires: 'linked' } });
      const [row] = await h.rows(`select status from ${h.real('tickets')} where id = ${String(ticket['id'])}`);
      expect(row!['status']).toBe(scan.status === 'fulfilled' ? 'checked_in' : 'valid');
    }
  });

  it.runIf(available)('gives one room to one of two guests checked in at once', async () => {
    for (let round = 0; round < 5; round += 1) {
      const room = await w.create('rooms', { number: `Q${String((n += 1))}` });
      const a = await w.create('stays', { arrive: '2026-08-10' });
      const b = await w.create('stays', { arrive: '2026-08-10' });
      const results = await Promise.allSettled([
        w.update('stays', a['id'], { status: 'in_house', room_id: room['id'] }),
        other.update('stays', b['id'], { status: 'in_house', room_id: room['id'] }),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const refused = results.find((r): r is PromiseRejectedResult => r.status === 'rejected')!;
      expect(refused.reason).toMatchObject({ code: expect.stringMatching(/^(STATE_MOVE_REFUSED|WRITE_CONFLICT)$/) });
      const [row] = await h.rows(`select status from ${h.real('rooms')} where id = ${String(room['id'])}`);
      expect(row!['status']).toBe('occupied');
    }
  });
});
