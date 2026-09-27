// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The row an effect moves was named, before the write's transaction, from a
 * look at it then; when it moved meanwhile its judge finds a lock the write
 * does not hold, and the write starts over — named again from a fresh look —
 * never handed to the door as a refusal. Here the first look names nothing
 * (as if the order's tickets had moved to other pools since), on every
 * engine.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { door } from './effects-fixture.js';
import { installInvoicing, LEGS, writerFor, type InvoicingHarness } from './invoicing-install.helpers.js';

const looks = vi.hoisted(() => ({ count: 0, blind: false }));

vi.mock('../src/crud/capacity/judge.js', async (original) => {
  const real = await original<typeof import('../src/crud/capacity/judge.js')>();
  return {
    ...real,
    capacityLockNames: async (...args: Parameters<typeof real.capacityLockNames>) => {
      looks.count += 1;
      if (looks.blind) {
        looks.blind = false;
        return [];
      }
      return real.capacityLockNames(...args);
    },
  };
});

describe.each(LEGS)("an effect's row that moved away from its lock — %s", (dialect, available) => {
  let h: InvoicingHarness;
  let w: Awaited<ReturnType<typeof writerFor>>;
  beforeAll(async () => {
    if (!available) return;
    h = await installInvoicing(dialect, door());
    w = await writerFor(h, 'Europe/London');
    await w.create('settings', {});
  }, 180_000);
  afterAll(async () => {
    if (available) await h.close();
  });

  it.runIf(available)('starts the write over instead of refusing it', async () => {
    const event = await w.create('events', { name: 'Show' });
    const type = await w.create('ticket_types', { event_id: event['id'], capacity: 4 });
    const order = await w.create('orders', { event_id: event['id'] });
    const ticket = await w.create('tickets', { order_id: order['id'], ticket_type_id: type['id'], price: 10 });
    await w.update('orders', order['id'], { status: 'door' });
    const mapped: string[] = [];
    looks.count = 0;
    looks.blind = true;
    const collected = await w.writes.update({
      target: w.targetOf('tickets'),
      pk: { id: ticket['id'] },
      values: { status: 'collected' },
      context: w.desk,
      // A door's own mapping: what it is handed becomes its refusal.
      mapError: (error) => {
        mapped.push((error as Error).name);
        throw new Error('refused');
      },
      announce: async () => {},
    });
    expect(mapped).toEqual([]);
    expect(looks.count).toBe(2);
    expect(collected.effects?.map((effect) => effect.after?.['status'])).toEqual(['paid']);
  });
});
