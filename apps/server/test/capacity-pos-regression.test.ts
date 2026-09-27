// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The released Point of Sale 0.2.2, installed from its byte-exact manifest,
 * keeps its booking limit answering as it did: the same grid, the same
 * refusals with no reason, a full slot told with its column and nothing more.
 * Two changes only, both loosenings: a status step on a slot already over its
 * limit (history, or a smaller limit) goes through, and so does a bulk cancel.
 */
import { readFileSync } from 'node:fs';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { installInvoicing, LEGS, writerFor, type InvoicingHarness } from './invoicing-install.helpers.js';

const ZONE = 'Europe/London';
const POS = JSON.parse(readFileSync(new URL('../../../packages/manifest/test/fixtures/released/point-of-sale-0.2.2.manifest.json', import.meta.url), 'utf8')) as Record<string, unknown>;
// Point of Sale's times are the venue's wall clock, as its screens send them.
const at = (wall: string) => wall;

const refusal = async (run: Promise<unknown>) => {
  try {
    await run;
    return 'ok';
  } catch (error) {
    const e = error as { code?: string; details?: unknown };
    if (e.code === undefined) throw error;
    return { code: e.code, details: e.details };
  }
};

describe.each(LEGS)('the released Point of Sale limit on %s', (dialect, available) => {
  let h: InvoicingHarness | undefined;
  beforeAll(async () => {
    if (available) h = await installInvoicing(dialect, POS);
  }, 180_000);
  afterAll(async () => h?.close());

  it.runIf(available)('answers and refuses as 0.3.4 did, but for the two loosenings', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-07-20T12:00:00.000Z'));
    try {
      const w = await writerFor(h!, ZONE);
      const table = w.targetOf('reservations').table.table;
      // The stored rule is the released one, read as it always was.
      expect(table.capacity).toBeDefined();
      expect(table.capacityRules).toHaveLength(1);
      await w.create('booking_rules', { covers_per_slot: 6 });
      const book = (wall: string, party: number) => refusal(w.create('reservations', { name: 'Guest', starts_at: at(wall), party_size: party, status: 'confirmed', channel: 'phone' }));

      // Off the grid, before the opening, past the close, in the past, beyond the window: bare refusals.
      for (const wall of ['2026-07-21 19:15', '2026-07-21 16:30', '2026-07-21 21:00', '2026-07-20 12:30', '2026-07-27 19:00']) {
        expect(await book(wall, 2), wall).toEqual({ code: 'VALIDATION_FAILED', details: { fields: { starts_at: { code: 'out-of-range' } } } });
      }
      expect(await book('2026-07-21 19:00', 4)).toBe('ok');
      expect(await book('2026-07-21 19:00', 2)).toBe('ok');
      expect(await book('2026-07-21 19:00', 1)).toEqual({ code: 'CAPACITY_FULL', details: { column: 'starts_at' } });

      // The limit lowered under a full slot: a guest seated there is still seated (it was refused before).
      await h!.rows(`update ${h!.real('booking_rules')} set covers_per_slot = 4`);
      const [first] = await h!.rows(`select id from ${h!.real('reservations')} order by id`);
      expect(await refusal(w.update('reservations', first!['id'], { status: 'seated' }))).toBe('ok');

      // A bulk cancel goes through; a bulk restore is still one at a time.
      const target = w.targetOf('reservations');
      const rows = (await h!.rows(`select id from ${h!.real('reservations')}`)).map((row) => ({ match: { id: row['id'] }, values: { status: 'cancelled' } }));
      await expect(w.writes.beforeEach('update', target, { ...w.desk, origin: 'bulk' }, rows)).resolves.toHaveLength(rows.length);
      await expect(
        w.writes.beforeEach('update', target, { ...w.desk, origin: 'bulk' }, rows.map((row) => ({ ...row, values: { status: 'confirmed' } }))),
      ).rejects.toMatchObject({ details: { reason: 'CAPACITY_ONE_AT_A_TIME' } });
    } finally {
      vi.useRealTimers();
    }
  });
});
