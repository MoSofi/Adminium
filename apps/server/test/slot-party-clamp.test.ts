// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A guest asking a slot limit about a party (`?party=`) is answered for what
 * one row can take of it, on every engine, through the public route: a rule
 * whose rows each take a fixed amount (a pickup order is one of a slot's six,
 * however many it feeds) answers each slot's exact order count whatever party
 * is asked — never "full" for a party of six at a slot with room for one more
 * order; a party column is asked for no more than one row may hold (its
 * `validation.max`). A page cannot measure how full a slot is by asking for
 * ever larger parties, nor hide a free slot from a large family.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { installInvoicing, LEGS, writerFor, type InvoicingHarness } from './invoicing-install.helpers.js';
import { shopManifest } from './person-fixture.js';
import { servePublic, type Served } from './public-lane.helpers.js';

type Doc = Record<string, unknown>;
const t = (ref: string) => `shop_${ref}`;
const hours = { slotMinutes: 60, windowDays: 3, opens: '11:00', closes: '14:00' };

function kitchen(): Doc {
  const manifest = shopManifest({
    orders: { columns: [{ ref: 'pickup_at', type: 'timestamptz', nullable: true }] },
    entries: (entries) => [
      ...entries,
      { table: 'orders', kind: 'availability', methods: ['GET'] },
      { table: 'tables_booked', kind: 'availability', methods: ['GET'] },
    ],
  });
  const tables = (manifest['requiredSchema'] as { tables: Doc[] }).tables;
  tables.find((table) => table['ref'] === 'orders')!['capacity'] = { kind: 'slot', slot: 'pickup_at', amount: 1, perSlot: 6, countWhere: { column: 'status', values: ['placed', 'ready'] }, ...hours };
  tables.push({
    ref: 'tables_booked',
    columns: [
      { ref: 'id', type: 'int', role: 'pk' },
      { ref: 'starts_at', type: 'timestamptz' },
      { ref: 'covers', type: 'int', default: 2, rules: { validation: { min: 1, max: 4 } } },
    ],
    // A notice makes it a rule of today's kinds; a released app's rule (no notice, no kind) answers as it always did.
    capacity: { kind: 'slot', slot: 'starts_at', amount: 'covers', perSlot: 6, noticeMinutes: 0, ...hours },
  });
  return manifest;
}

describe.each(LEGS)('a slot asked about a party answers for what one row takes — %s', (dialect, available) => {
  let h: InvoicingHarness & { reply: Record<string, unknown> };
  let w: Awaited<ReturnType<typeof writerFor>>;
  let shop: Served;
  beforeAll(async () => {
    if (!available) return;
    h = await installInvoicing(dialect, kitchen());
    await h.meta.db.updateTable('adminium_connections').set({ timezone: 'UTC' } as never).where('id', '=', h.connectionId).execute();
    w = await writerFor(h, 'UTC');
    const keys = (h.reply['publicAccess'] as { keys: Record<string, string> }).keys;
    shop = await servePublic(h, keys['customer']!);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-02T09:00:00Z'));
    // Five pickups at noon, six at one: noon has room for one more order, one o'clock none.
    for (let i = 0; i < 11; i += 1) await w.create('orders', { email: `d${String(i)}@example.com`, name: `Diner ${String(i)}`, pickup_at: i < 5 ? '2026-11-03T12:00:00Z' : '2026-11-03T13:00:00Z' });
    // Two covers booked at noon, of six.
    await w.create('tables_booked', { starts_at: '2026-11-03T12:00:00Z', covers: 2 });
    vi.useRealTimers();
  }, 180_000);
  afterAll(async () => {
    if (!available) return;
    await shop.close();
    await h.close();
  });
  afterEach(() => vi.useRealTimers());

  const day = async (entry: string, party: number) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-02T09:00:00Z'));
    const res = await shop.get(`/availability/${t(entry)}_availability?date=2026-11-03&party=${String(party)}`);
    expect(res.statusCode, res.body).toBe(200);
    return Object.fromEntries((res.json() as { data: { time: string; state: string }[] }).data.map((slot) => [slot.time, slot.state]));
  };

  it.runIf(available)('answers the exact order count whatever party is asked, when each order takes one', async () => {
    for (const party of [1, 2, 6, 40]) {
      expect(await day('orders', party)).toEqual({ '11:00': 'free', '12:00': 'free', '13:00': 'full' });
    }
  });

  it.runIf(available)('counts the free times of a strip of days the same way', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-02T09:00:00Z'));
    for (const party of [1, 40]) {
      const res = await shop.get(`/availability/${t('orders')}_availability?from=2026-11-03&days=1&party=${String(party)}`);
      expect(res.statusCode, res.body).toBe(200);
      expect((res.json() as { data: unknown[] }).data).toEqual([{ date: '2026-11-03', open: 2, state: 'open' }]);
    }
  });

  it.runIf(available)('asks a party column for no more than one row may hold', async () => {
    // Two of six covers taken at noon: a party of four fits; a party of forty is asked as four.
    expect(await day('tables_booked', 4)).toEqual({ '11:00': 'free', '12:00': 'free', '13:00': 'free' });
    expect(await day('tables_booked', 40)).toEqual({ '11:00': 'free', '12:00': 'free', '13:00': 'free' });
    await h.rows(`update ${h.real('tables_booked')} set covers = 3`);
    expect(await day('tables_booked', 3)).toEqual({ '11:00': 'free', '12:00': 'free', '13:00': 'free' });
    expect(await day('tables_booked', 40)).toEqual({ '11:00': 'free', '12:00': 'full', '13:00': 'free' });
  });
});
