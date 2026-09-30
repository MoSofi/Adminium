// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A credit priced as its stay was charged (`perNight.of`), on every engine: a
 * stay priced at 100 a night, then the room's rate raised to 150. A credit for
 * one night not used comes to what that night cost the guest — 100 — not
 * today's 150; while the rate is unchanged it is today's price, exactly.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { installInvoicing, LEGS, writerFor, type InvoicingHarness } from './invoicing-install.helpers.js';

const id = { ref: 'id', type: 'int', role: 'pk' };

const nights = (via: string, of?: Record<string, unknown>) => ({ perNight: { from: 'from_date', to: 'to_date', rate: { via, column: 'base_rate' }, ...(of === undefined ? {} : { of }) } });

function house(): Record<string, unknown> {
  return {
    kind: 'app',
    manifestVersion: 1,
    key: 'house',
    name: 'House',
    version: '0.1.0',
    publisher: { id: 'adminium', name: 'Adminium' },
    license: 'MIT',
    description: { key: 'd', fallback: 'A small hotel' },
    categories: ['crm'],
    compatibility: { minAdminiumVersion: '0.3.1' },
    requiredSchema: {
      prefixed: true,
      tables: [
        { ref: 'room_types', columns: [id, { ref: 'name', type: 'text', maxLength: 40 }, { ref: 'base_rate', type: 'decimal', scale: 2 }] },
        {
          ref: 'stays',
          columns: [
            id,
            { ref: 'room_type_id', type: 'fk', references: 'room_types' },
            { ref: 'from_date', type: 'date' },
            { ref: 'to_date', type: 'date' },
            { ref: 'room_total', type: 'decimal', scale: 2, nullable: true, rules: nights('room_type_id') },
          ],
        },
        {
          ref: 'stay_credits',
          columns: [
            id,
            { ref: 'stay_id', type: 'fk', references: 'stays' },
            { ref: 'room_type_id', type: 'fk', references: 'room_types', nullable: true, rules: { copy: { via: 'stay_id', from: 'room_type_id', mode: 'always' } } },
            { ref: 'from_date', type: 'date' },
            { ref: 'to_date', type: 'date' },
            { ref: 'amount', type: 'decimal', scale: 2, nullable: true, rules: nights('room_type_id', { via: 'stay_id', column: 'room_total' }) },
          ],
        },
      ],
    },
    pages: [{ ref: 'overview', template: 'page-dashboard', title: { key: 't', fallback: 'Overview' }, nav: { group: 'house', icon: 'home', order: 1 } }],
    frontends: [{ side: 'staff', kind: 'spa' }],
  };
}

describe.each(LEGS)('a credit priced as its stay was charged — %s', (dialect, available) => {
  let h: InvoicingHarness;
  let w: Awaited<ReturnType<typeof writerFor>>;
  beforeAll(async () => {
    if (!available) return;
    h = await installInvoicing(dialect, house());
    w = await writerFor(h, 'UTC');
  }, 180_000);
  afterAll(async () => {
    if (available) await h.close();
  });
  const amount = async (credit: Record<string, unknown>) => Number((await h.rows(`select amount from ${h.real('stay_credits')} where id = ${String(credit['id'])}`))[0]!['amount']);

  it.runIf(available)("credits a night at today's price while the rate is the one the stay was priced at", async () => {
    const garden = await w.create('room_types', { name: 'Garden', base_rate: '100.00' });
    const stay = await w.create('stays', { room_type_id: garden['id'], from_date: '2026-10-05', to_date: '2026-10-08' });
    expect(Number((await h.rows(`select room_total from ${h.real('stays')} where id = ${String(stay['id'])}`))[0]!['room_total'])).toBe(300);
    expect(await amount(await w.create('stay_credits', { stay_id: stay['id'], from_date: '2026-10-07', to_date: '2026-10-08' }))).toBe(100);
  });

  it.runIf(available)('credits a night at what the stay was charged after the rate went up', async () => {
    const sea = await w.create('room_types', { name: 'Sea', base_rate: '100.00' });
    const stay = await w.create('stays', { room_type_id: sea['id'], from_date: '2026-10-05', to_date: '2026-10-08' });
    await w.update('room_types', sea['id'], { base_rate: '150.00' });
    expect(await amount(await w.create('stay_credits', { stay_id: stay['id'], from_date: '2026-10-07', to_date: '2026-10-08' }))).toBe(100);
    // Never more than the stay was charged, however the nights asked run over it.
    expect(await amount(await w.create('stay_credits', { stay_id: stay['id'], from_date: '2026-10-05', to_date: '2026-10-10' }))).toBe(300);
  });
});
