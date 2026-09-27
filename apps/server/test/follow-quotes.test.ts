// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A quote of a change that other rows follow — a stay's guests, under its
 * breakfast — works the follow out as the save would, and holds nothing:
 *
 *  - its figures are the save's: the breakfast, the extras total, the tax,
 *    the total and the balance the change would leave;
 *  - it refuses what the save refuses: fewer guests on a paid stay would
 *    take its balance below zero, and both say so;
 *  - it never writes nor holds the rows that follow: it answers while
 *    another writer holds the breakfast (Postgres, MySQL);
 *  - a change whose follow settles a total the role may not write is
 *    refused by that column's name, before anything is written.
 */
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ForbiddenError } from '../src/errors.js';
import { createWriteService } from '../src/crud/write-service.js';
import { writeStores } from '../src/crud/write-stores.js';
import { installInvoicing, LEGS, writerFor, type InvoicingHarness } from './invoicing-install.helpers.js';
import { seedWren, wrenManifest } from './wren-house-fixture.js';

const money = (value: unknown) => (value === null || value === undefined ? null : Number(value).toFixed(2));
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe.each(LEGS)('a quote of a change that rows follow — %s', (dialect, available) => {
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

  /** A Garden stay Fri 31 July – Mon 3 August for two with breakfast; paid in full when asked. */
  const stayWithBreakfast = async (paid: boolean) => {
    const stay = await w.create('stays', { first_name: 'Mia', last_name: 'Okada', guests: 2, room_type_id: seed.garden['id'], arrive: '2026-07-31', depart: '2026-08-03' });
    const breakfast = await w.create('stay_extras', { stay_id: stay['id'], extra_id: seed.breakfast['id'] });
    if (paid) await w.create('payments', { stay_id: stay['id'], amount: '693.24' });
    return { stay, breakfast };
  };
  const stayRow = async (id: unknown) => (await h!.rows(`SELECT * FROM ${h!.real('stays')} WHERE id = ${String(id)}`))[0]!;
  const extraRow = async (id: unknown) => (await h!.rows(`SELECT * FROM ${h!.real('stay_extras')} WHERE id = ${String(id)}`))[0]!;
  const figures = (row: Record<string, unknown>) => ({
    extras: money(row['extras_total']),
    subtotal: money(row['subtotal']),
    tax: money(row['tax']),
    total: money(row['total']),
    balance: money(row['balance']),
  });
  const quote = (id: unknown, values: Record<string, unknown>) =>
    w.writes.update({ target: w.targetOf('stays'), pk: { id }, values, context: w.desk, mode: 'dry', announce: async () => {} });

  it.runIf(available)("answers the figures the save then writes, and keeps none of them", async () => {
    const { stay, breakfast } = await stayWithBreakfast(false);
    const quoted = await quote(stay['id'], { guests: 3 });
    // 16 × 3 × 3 breakfasts on 540 of room: 684, 61.56 tax.
    expect(figures(quoted.after!)).toEqual({ extras: '144.00', subtotal: '684.00', tax: '61.56', total: '745.56', balance: '745.56' });
    // Nothing kept: the stay and its breakfast as they were.
    expect(figures(await stayRow(stay['id']))).toMatchObject({ extras: '96.00', total: '693.24' });
    expect(Number((await extraRow(breakfast['id']))['guests'])).toBe(2);
    await w.update('stays', stay['id'], { guests: 3 });
    expect(figures(await stayRow(stay['id']))).toEqual(figures(quoted.after!));
    expect(money((await extraRow(breakfast['id']))['amount'])).toBe('144.00');
  });

  it.runIf(available)('refuses what the save refuses: fewer guests on a paid stay', async () => {
    const { stay, breakfast } = await stayWithBreakfast(true);
    const quoted = await quote(stay['id'], { guests: 1 }).catch((error: unknown) => error);
    const saved = await w.update('stays', stay['id'], { guests: 1 }).catch((error: unknown) => error);
    expect(quoted).toMatchObject({ statusCode: 409, code: 'BALANCE_EXCEEDED', details: { column: 'balance', balance: 0 } });
    expect(saved).toMatchObject({ statusCode: 409, code: 'BALANCE_EXCEEDED', details: { column: 'balance', balance: 0 } });
    expect(figures(await stayRow(stay['id']))).toMatchObject({ extras: '96.00', balance: '0.00' });
    expect(Number((await extraRow(breakfast['id']))['guests'])).toBe(2);
    // More guests is owed, not refused, by both.
    expect(figures((await quote(stay['id'], { guests: 3 })).after!)).toMatchObject({ extras: '144.00', balance: '52.32' });
  });

  it.runIf(available && dialect !== 'sqlite')('holds none of the rows that follow: it answers while another writer holds the breakfast', async () => {
    const { stay, breakfast } = await stayWithBreakfast(false);
    // The other writer comes through a pool of its own: a pool of one stays the quote's.
    const twin = await h!.twin();
    const { db } = await twin.manager.data(twin.connectionId);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let held!: () => void;
    const taken = new Promise<void>((resolve) => (held = resolve));
    const holder = db.transaction().execute(async (trx) => {
      await sql`SELECT id FROM ${sql.table(w.targetOf('stay_extras').table.id)} WHERE id = ${breakfast['id']} FOR UPDATE`.execute(trx);
      held();
      // A deadline: the gate opens after 20 s at the latest, whatever the test does.
      await Promise.race([gate, pause(20_000)]);
    });
    try {
      await taken;
      const answered = quote(stay['id'], { guests: 3 }).then((r) => r.after);
      const settled = await Promise.race([answered.then(() => true), pause(3_000).then(() => false)]);
      expect(settled).toBe(true);
      expect(figures((await answered)!)).toMatchObject({ extras: '144.00' });
    } finally {
      release();
      await holder;
      await twin.close();
    }
  });

  it.runIf(available)('refuses, by name, a change whose follow settles a total the role may not write — before anything is written', async () => {
    const { stay, breakfast } = await stayWithBreakfast(false);
    const stays = w.targetOf('stays').table.id;
    const writes = createWriteService({
      ...writeStores(h!.meta),
      rights: async (_connection, table) => (table === stays ? { insert: true, update: true, delete: true, columns: { extras_total: { insert: true, update: false } } } : null),
    });
    for (const mode of ['save', 'dry'] as const) {
      const refused = await writes
        .update({ target: w.targetOf('stays'), pk: { id: stay['id'] }, values: { guests: 3 }, context: w.desk, mode, announce: async () => {} })
        .catch((error: unknown) => error);
      expect(refused).toBeInstanceOf(ForbiddenError);
      expect(refused).toMatchObject({ code: 'READ_ONLY_MODE', details: { table: stays, columns: ['extras_total'], reason: 'privileges' } });
    }
    expect(Number((await stayRow(stay['id']))['guests'])).toBe(2);
    expect(Number((await extraRow(breakfast['id']))['guests'])).toBe(2);
  });
});
