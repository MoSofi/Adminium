// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A hold's end stamped so many hours from now, never later than a moment
 * (`addMinutes.notAfter`), on every engine, the clock fixed: a waitlist offer
 * made at 16:30 for a show whose doors open at 19:30 ends at the doors, not
 * at 04:30 the next morning; one made the day before ends twelve hours on; a
 * show with no doors time caps nothing; and a friend's ticket sent that
 * afternoon comes back at the doors at the latest. The same whichever zone the
 * server runs in (`TZ=America/Los_Angeles`).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { readInstant } from '../src/crud/moments.js';
import { installInvoicing, LEGS, writerFor, type InvoicingHarness } from './invoicing-install.helpers.js';

const id = { ref: 'id', type: 'int', role: 'pk' };
const offerHours = { table: 'settings', column: 'offer_hours' };

function boxOffice(): Record<string, unknown> {
  return {
    kind: 'app',
    manifestVersion: 1,
    key: 'offers',
    name: 'Offers',
    version: '0.1.0',
    publisher: { id: 'adminium', name: 'Adminium' },
    license: 'MIT',
    description: { key: 'd', fallback: 'A box office' },
    categories: ['crm'],
    compatibility: { minAdminiumVersion: '0.3.1' },
    requiredSchema: {
      prefixed: true,
      tables: [
        { ref: 'settings', columns: [id, { ref: 'offer_hours', type: 'int', default: 12 }] },
        { ref: 'events', columns: [id, { ref: 'name', type: 'text', maxLength: 40 }, { ref: 'doors_at', type: 'timestamptz', nullable: true }] },
        {
          ref: 'orders',
          columns: [
            id,
            { ref: 'event_id', type: 'fk', references: 'events' },
            { ref: 'status', type: 'enum', enum: ['held', 'offered', 'paid'], default: 'held' },
            {
              ref: 'offer_until',
              type: 'timestamptz',
              nullable: true,
              rules: { stamp: { set: { addMinutes: { hours: offerHours, notAfter: { via: 'event_id', column: 'doors_at' } } }, on: { column: 'status', values: ['offered'] } } },
            },
          ],
          states: { column: 'status', initial: 'held', moves: { held: ['offered', 'paid'], offered: ['paid'] } },
        },
      ],
    },
    pages: [{ ref: 'overview', template: 'page-dashboard', title: { key: 't', fallback: 'Overview' }, nav: { group: 'offers', icon: 'home', order: 1 } }],
    frontends: [{ side: 'staff', kind: 'spa' }],
  };
}

describe.each(LEGS)('an offer ends at the doors at the latest — %s', (dialect, available) => {
  let h: InvoicingHarness;
  let w: Awaited<ReturnType<typeof writerFor>>;
  beforeAll(async () => {
    if (!available) return;
    h = await installInvoicing(dialect, boxOffice());
    w = await writerFor(h, 'Europe/London');
    await w.create('settings', {});
  }, 180_000);
  afterAll(async () => {
    if (available) await h.close();
  });
  afterEach(() => vi.useRealTimers());
  const at = (when: string) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(when));
  };
  const offerUntil = async (key: unknown) => readInstant((await h.rows(`select offer_until from ${h.real('orders')} where id = ${String(key)}`))[0]!['offer_until'])?.toISOString() ?? null;
  const offer = async (doors: string | null, when: string) => {
    at('2026-07-01T09:00:00Z');
    const event = await w.create('events', { name: 'Velvet Hour', doors_at: doors });
    const order = await w.create('orders', { event_id: event['id'] });
    at(when);
    await w.update('orders', order['id'], { status: 'offered' });
    return offerUntil(order['id']);
  };

  it.runIf(available)('ends an offer made that afternoon at the doors, not twelve hours on', async () => {
    // 16:30 in London (summer time) is 15:30 UTC; the doors open at 19:30 London.
    expect(await offer('2026-07-28T18:30:00Z', '2026-07-28T15:30:00Z')).toBe('2026-07-28T18:30:00.000Z');
  });

  it.runIf(available)('ends an offer made the day before twelve hours on, before the doors', async () => {
    expect(await offer('2026-07-28T18:30:00Z', '2026-07-27T09:00:00Z')).toBe('2026-07-27T21:00:00.000Z');
  });

  it.runIf(available)('caps nothing when the show has no doors time', async () => {
    expect(await offer(null, '2026-07-28T15:30:00Z')).toBe('2026-07-29T03:30:00.000Z');
  });

  it.runIf(available)('caps a quote of the move the same way', async () => {
    at('2026-07-01T09:00:00Z');
    const event = await w.create('events', { name: 'Late show', doors_at: '2026-07-28T18:30:00Z' });
    const order = await w.create('orders', { event_id: event['id'] });
    at('2026-07-28T15:30:00Z');
    const quote = await w.writes.update({ target: w.targetOf('orders'), pk: { id: order['id'] }, values: { status: 'offered' }, context: w.desk, mode: 'dry', announce: async () => {} });
    expect(readInstant(quote.after?.['offer_until'])?.toISOString()).toBe('2026-07-28T18:30:00.000Z');
    expect(await offerUntil(order['id'])).toBeNull();
  });
});
