// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A stay priced by the night on a real database: the nights and the room
 * total at the released hotel's prices, re-priced by a change of its own
 * dates or room type and never by a rate edited later, an import's figure
 * kept, a guest's figure dropped, a stay too long refused, a rate rule that
 * cannot be read refused loudly, and the price worked out again from the row
 * as held when another writer moved the dates meanwhile.
 */
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { WriteContext } from '../src/crud/write-service.js';
import { installInvoicing, LEGS, writerFor, type InvoicingHarness } from './invoicing-install.helpers.js';
import { seedWren, wrenManifest } from './wren-house-fixture.js';

const money = (value: unknown) => (value === null || value === undefined ? null : Number(value).toFixed(2));

describe.each(LEGS)('prices by the night — %s', (dialect, available) => {
  let h: InvoicingHarness | undefined;
  let w: Awaited<ReturnType<typeof writerFor>>;
  let seed: Awaited<ReturnType<typeof seedWren>>;
  beforeAll(async () => {
    if (!available) return;
    h = await installInvoicing(dialect, wrenManifest());
    w = await writerFor(h, 'America/Los_Angeles');
    seed = await seedWren((ref, values) => w.create(ref, values));
  }, 180_000);
  afterAll(async () => h?.close());

  const stay = async (values: Record<string, unknown>, context?: WriteContext) =>
    w.create('stays', { first_name: 'Mia', last_name: 'Okada', guests: 2, room_type_id: seed.garden['id'], ...values }, context);
  const read = async (id: unknown) => (await h!.rows(`SELECT * FROM ${h!.real('stays')} WHERE id = ${String(id)}`))[0]!;

  it.runIf(available)('prices a Garden stay Mon 3 – Wed 5 August at 170 a night: 340', async () => {
    const made = await stay({ arrive: '2026-08-03', depart: '2026-08-05' });
    const row = await read(made['id']);
    expect(Number(row['nights'])).toBe(2);
    expect(money(row['room_total'])).toBe('340.00');
    expect(row['guest_name']).toBe('Mia Okada');
  });

  it.runIf(available)('prices Fri 31 July – Sun 2 August at 175 + 195: 370', async () => {
    const made = await stay({ arrive: '2026-07-31', depart: '2026-08-02' });
    expect(money((await read(made['id']))['room_total'])).toBe('370.00');
  });

  it.runIf(available)('prices again when the dates or the room type change, and not when a rate changes later', async () => {
    const made = await stay({ arrive: '2026-07-31', depart: '2026-08-02' });
    await w.update('stays', made['id'], { depart: '2026-08-01' });
    expect(money((await read(made['id']))['room_total'])).toBe('175.00');
    await w.update('stays', made['id'], { room_type_id: seed.loft['id'] });
    expect(money((await read(made['id']))['room_total'])).toBe('240.00');
    // The weekend goes up: a stored stay keeps the price it was charged, a change of its note leaves it alone.
    await w.update('rate_rules', seed.weekend['id'], { amount: '40.00' });
    await w.update('stays', made['id'], { note: 'Late arrival' });
    expect(money((await read(made['id']))['room_total'])).toBe('240.00');
    // A whole-row send that repeats the dates and the room type, a note changed: still the price it was charged.
    await w.update('stays', made['id'], { arrive: '2026-07-31', depart: '2026-08-01', room_type_id: seed.loft['id'], note: 'Very late arrival' });
    expect(money((await read(made['id']))['room_total'])).toBe('240.00');
    // Its dates changed again: priced at the rates as they are now.
    await w.update('stays', made['id'], { arrive: '2026-07-30' });
    await w.update('stays', made['id'], { arrive: '2026-07-31' });
    expect(money((await read(made['id']))['room_total'])).toBe('255.00');
    await w.update('rate_rules', seed.weekend['id'], { amount: '25.00' });
    // The rates fell back: a repeated send leaves the charged price, a paid stay is not refused for it.
    await w.create('payments', { stay_id: made['id'], amount: (await read(made['id']))['total'] as string });
    await w.update('stays', made['id'], { arrive: '2026-07-31', depart: '2026-08-01', note: 'Paid in full' });
    expect(money((await read(made['id']))['room_total'])).toBe('255.00');
    expect((await read(made['id']))['note']).toBe('Paid in full');
  });

  it.runIf(available)('keeps the figure an import brings, and prices one that brings none', async () => {
    const importing: WriteContext = { ...w.desk, origin: 'import' };
    const kept = await stay({ arrive: '2026-08-03', depart: '2026-08-05', room_total: '299.00' }, importing);
    expect(money((await read(kept['id']))['room_total'])).toBe('299.00');
    const priced = await stay({ arrive: '2026-08-03', depart: '2026-08-05' }, importing);
    expect(money((await read(priced['id']))['room_total'])).toBe('340.00');
  });

  it.runIf(available)('drops a figure anyone else sends, a guest included', async () => {
    const guest: WriteContext = { ...w.desk, origin: 'public', actor: null };
    const made = await stay({ arrive: '2026-08-03', depart: '2026-08-05', room_total: '1.00' }, guest);
    expect(money((await read(made['id']))['room_total'])).toBe('340.00');
    const desk = await stay({ arrive: '2026-08-03', depart: '2026-08-05', room_total: '1.00' });
    expect(money((await read(desk['id']))['room_total'])).toBe('340.00');
  });

  it.runIf(available)('refuses a stay longer than two years, naming its departure', async () => {
    const refused = await stay({ arrive: '2026-01-01', depart: '2028-03-11' }).catch((error: unknown) => error);
    expect(refused).toMatchObject({ statusCode: 422, code: 'VALIDATION_FAILED', details: { fields: { depart: { code: 'out-of-range' } } } });
  });

  it.runIf(available)('refuses weekdays it cannot read on a rate rule', async () => {
    const refused = await w.create('rate_rules', { name: 'Odd', weekdays: 'fri,sunday', amount: '5.00' }).catch((error: unknown) => error);
    expect(refused).toMatchObject({ statusCode: 422, details: { fields: { weekdays: { code: 'format' } } } });
    await expect(w.create('rate_rules', { name: 'Fine', weekdays: 'Mon Tue', amount: '0.00', active: false })).resolves.toBeTruthy();
  });

  it.runIf(available)('refuses to price with a stored rule it cannot read, and names the rule', async () => {
    const { db } = await h!.manager.data(h!.connectionId);
    const table = h!.real('rate_rules');
    const inserted = await sql<{ id: number }>`INSERT INTO ${sql.table(table)} (name, weekdays, amount, active) VALUES ('Broken', 'friday', 1, ${dialect === 'postgres' ? sql`true` : sql`1`})`.execute(db);
    const rows = await h!.rows(`SELECT id FROM ${table} WHERE name = 'Broken'`);
    const refused = await stay({ arrive: '2026-08-03', depart: '2026-08-05' }).catch((error: unknown) => error);
    expect(refused).toMatchObject({ statusCode: 409, code: 'NIGHTLY_RATE_UNREADABLE', details: { table: w.targetOf('rate_rules').table.id, column: 'weekdays' } });
    expect(String((refused as { details: { key: unknown } }).details.key)).toBe(String(rows[0]!['id']));
    void inserted;
    await sql`DELETE FROM ${sql.table(table)} WHERE name = 'Broken'`.execute(db);
  });

  it.runIf(available)('prices from the row as held when another writer moved the dates meanwhile', async () => {
    const made = await stay({ arrive: '2026-08-03', depart: '2026-08-05' });
    const stale = await read(made['id']);
    // Another writer moves the departure a night later...
    await w.update('stays', made['id'], { depart: '2026-08-06' });
    // ...while this one changes the room type, having read the row before that.
    await w.writes.update({ target: w.targetOf('stays'), pk: { id: made['id'] }, values: { room_type_id: seed.loft['id'] }, before: stale, context: w.desk, announce: async () => {} });
    const row = await read(made['id']);
    // Loft: Mon 3, Tue 4, Wed 5 August at 215 + 20.
    expect(money(row['room_total'])).toBe('705.00');
    expect(Number(row['nights'])).toBe(3);
  });

  it.runIf(available)('cuts a joined name to its column rather than refusing it', async () => {
    const made = await stay({ first_name: 'Maximiliana-Josefina', last_name: 'Okada-Rennerhausen', arrive: '2026-08-03', depart: '2026-08-04' });
    expect(String((await read(made['id']))['guest_name'])).toBe('Maximiliana-Josefina Oka');
  });
});
