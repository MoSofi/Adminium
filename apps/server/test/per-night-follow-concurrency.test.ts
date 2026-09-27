// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A stay changed by many writers at once — its dates, its room type, its
 * guests — while extras are added to it: every write goes through or loses
 * a race (409 `WRITE_CONFLICT`, tried again), none deadlocks into a 500, and
 * the stay that remains is priced for the dates and type it holds, each
 * extra follows its nights and guests, and its totals add up. On Postgres
 * and MySQL, where writers truly run side by side.
 */
import { nightlyRates, rollupValue } from '@adminium/manifest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { WriteContext } from '../src/crud/write-service.js';
import { installInvoicing, LEGS, writerFor, type InvoicingHarness } from './invoicing-install.helpers.js';
import { seedWren, wrenManifest } from './wren-house-fixture.js';

const RACED = LEGS.filter(([dialect]) => dialect !== 'sqlite');

describe.each(RACED)('a stay many writers change at once — %s', (dialect, available) => {
  let h: InvoicingHarness | undefined;
  let w: Awaited<ReturnType<typeof writerFor>>;
  let seed: Awaited<ReturnType<typeof seedWren>>;
  beforeAll(async () => {
    if (!available) return;
    h = await installInvoicing(dialect, wrenManifest());
    w = await writerFor(h, 'Europe/London');
    seed = await seedWren((ref, values) => w.create(ref, values));
  }, 180_000);
  afterAll(async () => h?.close());

  /** A write, tried again while it loses a race; any other refusal is the test's failure. */
  const settled = async (run: () => Promise<unknown>): Promise<number> => {
    for (let attempt = 1; attempt <= 8; attempt += 1) {
      try {
        await run();
        return attempt;
      } catch (error) {
        const code = (error as { code?: string }).code;
        if (code !== 'WRITE_CONFLICT' && code !== 'CAPACITY_BUSY') throw error;
        await new Promise((resolve) => setTimeout(resolve, 5 * attempt));
      }
    }
    throw new Error('a write lost every race');
  };

  it.runIf(available)('ends priced for its own dates and type, every extra in step, every total adding up', async () => {
    const stay = await w.create('stays', { first_name: 'Mia', guests: 2, room_type_id: seed.garden['id'], arrive: '2026-07-31', depart: '2026-08-03' });
    await w.create('stay_extras', { stay_id: stay['id'], extra_id: seed.breakfast['id'] });
    const id = stay['id'];
    const types = [seed.garden['id'], seed.loft['id'], seed.harbour['id']];
    const departs = ['2026-08-02', '2026-08-04', '2026-08-05', '2026-08-03'];
    const desk: WriteContext = w.desk;
    const writes: (() => Promise<unknown>)[] = [];
    for (let i = 0; i < 12; i += 1) {
      if (i % 3 === 0) writes.push(() => w.update('stays', id, { depart: departs[i % departs.length] }, desk));
      else if (i % 3 === 1) writes.push(() => w.update('stays', id, { room_type_id: types[i % types.length] }, desk));
      else writes.push(() => w.update('stays', id, { guests: 1 + (i % 3) }, desk));
    }
    for (let i = 0; i < 4; i += 1) writes.push(() => w.create('stay_extras', { stay_id: id, extra_id: i % 2 === 0 ? seed.parking['id'] : seed.late['id'] }));
    const attempts = await Promise.all(writes.map((write) => settled(write)));
    expect(attempts.every((n) => n >= 1)).toBe(true);

    const [row] = await h!.rows(`SELECT * FROM ${h!.real('stays')} WHERE id = ${String(id)}`);
    const [type] = await h!.rows(`SELECT base_rate FROM ${h!.real('room_types')} WHERE id = ${String(row!['room_type_id'])}`);
    const rules = await h!.rows(`SELECT * FROM ${h!.real('rate_rules')} ORDER BY id`);
    const day = (value: unknown) => (value instanceof Date ? `${String(value.getFullYear())}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}` : String(value).slice(0, 10));
    const priced = nightlyRates({
      from: day(row!['arrive']),
      to: day(row!['depart']),
      base: type!['base_rate'],
      scale: 2,
      adjustments: rules.map((r) => ({ add: r['amount'], name: String(r['name']), typeMatch: r['room_type_id'] === null, weekdays: r['weekdays'], from: r['from_date'] === null ? null : day(r['from_date']), to: r['to_date'] === null ? null : day(r['to_date']) })),
    })!;
    expect(Number(row!['room_total']).toFixed(2)).toBe(priced.total);
    expect(Number(row!['nights'])).toBe(priced.nights.length);
    const extras = await h!.rows(`SELECT * FROM ${h!.real('stay_extras')} WHERE stay_id = ${String(id)}`);
    expect(extras).toHaveLength(5);
    for (const extra of extras) {
      const [nights, guests] = [Number(row!['nights']), Number(row!['guests'])];
      expect([Number(extra['nights']), Number(extra['guests'])]).toEqual([nights, guests]);
      const each = Number(extra['each']);
      const amount = extra['per'] === 'person-night' ? each * guests * nights : extra['per'] === 'night' ? each * nights : each;
      expect(Number(extra['amount']).toFixed(2)).toBe(amount.toFixed(2));
    }
    expect(Number(row!['extras_total']).toFixed(2)).toBe(rollupValue(extras, { sum: 'amount' }, 2));
    const subtotal = Number(row!['room_total']) + Number(row!['extras_total']);
    expect(Number(row!['subtotal']).toFixed(2)).toBe(subtotal.toFixed(2));
    expect(Number(row!['total'])).toBeCloseTo(Number(row!['subtotal']) + Number(row!['tax']), 2);
  }, 120_000);
});
