// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Copies that follow their row, on a real database: a stay's departure moved
 * a night earlier re-prices the room, brings each extra's nights into step,
 * works their amounts out again and settles the stay's totals, tax and
 * balance — in one write, or not at all. Through every door that changes a
 * stay: a single change, bulk, an import's update and an undo; refused when
 * a paid stay would owe less than was paid, when too many rows follow, and
 * — by name, before anything is written — when the role may not write them.
 */
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ForbiddenError } from '../src/errors.js';
import { fetchByPk } from '../src/crud/records.js';
import { createWriteService, updateRows, type WriteContext } from '../src/crud/write-service.js';
import { writeStores } from '../src/crud/write-stores.js';
import { installInvoicing, LEGS, writerFor, type InvoicingHarness } from './invoicing-install.helpers.js';
import { seedWren, wrenManifest } from './wren-house-fixture.js';

const money = (value: unknown) => (value === null || value === undefined ? null : Number(value).toFixed(2));

describe.each(LEGS)('copies that follow their row — %s', (dialect, available) => {
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

  /** A Garden stay Fri 31 July – Mon 3 August for two, with breakfast (and parking when asked). */
  const breakfastStay = async (parking = false) => {
    const made = await w.create('stays', { first_name: 'Mia', last_name: 'Okada', guests: 2, room_type_id: seed.garden['id'], arrive: '2026-07-31', depart: '2026-08-03' });
    const breakfast = await w.create('stay_extras', { stay_id: made['id'], extra_id: seed.breakfast['id'] });
    const park = parking ? await w.create('stay_extras', { stay_id: made['id'], extra_id: seed.parking['id'] }) : null;
    return { stay: made, breakfast, park };
  };
  const stayRow = async (id: unknown) => (await h!.rows(`SELECT * FROM ${h!.real('stays')} WHERE id = ${String(id)}`))[0]!;
  const extraRow = async (id: unknown) => (await h!.rows(`SELECT * FROM ${h!.real('stay_extras')} WHERE id = ${String(id)}`))[0]!;
  const figures = async (id: unknown) => {
    const row = await stayRow(id);
    return {
      nights: Number(row['nights']),
      room: money(row['room_total']),
      extras: money(row['extras_total']),
      subtotal: money(row['subtotal']),
      tax: money(row['tax']),
      total: money(row['total']),
      paid: money(row['paid']),
      balance: money(row['balance']),
    };
  };

  it.runIf(available)('moves the room, the breakfast and the total with a departure a night earlier, in one write', async () => {
    const { stay, breakfast } = await breakfastStay();
    // 175 + 195 + 170 for the room; breakfast 16 × 2 × 3.
    expect(await figures(stay['id'])).toMatchObject({ nights: 3, room: '540.00', extras: '96.00', subtotal: '636.00', tax: '57.24', total: '693.24', balance: '693.24' });
    await w.update('stays', stay['id'], { depart: '2026-08-02' });
    expect(await figures(stay['id'])).toMatchObject({ nights: 2, room: '370.00', extras: '64.00', subtotal: '434.00', tax: '39.06', total: '473.06', balance: '473.06' });
    const extra = await extraRow(breakfast['id']);
    expect([Number(extra['nights']), Number(extra['guests']), money(extra['amount'])]).toEqual([2, 2, '64.00']);
  });

  it.runIf(available)('follows a change of guests', async () => {
    const { stay, breakfast, park } = await breakfastStay(true);
    await w.update('stays', stay['id'], { guests: 3 });
    expect(money((await extraRow(breakfast['id']))['amount'])).toBe('144.00');
    // Parking is by the night: the guests change nothing in its amount.
    expect(money((await extraRow(park!['id']))['amount'])).toBe('42.00');
    expect((await figures(stay['id'])).extras).toBe('186.00');
  });

  it.runIf(available)('keeps nothing when the write fails after the follow', async () => {
    const { stay, breakfast } = await breakfastStay();
    const failing = await w.writes
      .update({
        target: w.targetOf('stays'),
        pk: { id: stay['id'] },
        values: { depart: '2026-08-02' },
        context: w.desk,
        announce: async () => {},
        expect: async () => {
          throw new Error('The price check failed');
        },
      })
      .catch((error: unknown) => error);
    expect(String(failing)).toContain('The price check failed');
    expect(await figures(stay['id'])).toMatchObject({ nights: 3, room: '540.00', extras: '96.00', total: '693.24' });
    expect(Number((await extraRow(breakfast['id']))['nights'])).toBe(3);
  });

  it.runIf(available)('refuses to shorten a paid stay below what was paid, and changes nothing', async () => {
    const { stay, breakfast } = await breakfastStay();
    await w.create('payments', { stay_id: stay['id'], amount: '693.24' });
    expect((await figures(stay['id'])).balance).toBe('0.00');
    const refused = await w.update('stays', stay['id'], { depart: '2026-08-02' }).catch((error: unknown) => error);
    expect(refused).toMatchObject({ statusCode: 409, code: 'BALANCE_EXCEEDED', details: { column: 'balance' } });
    expect(await figures(stay['id'])).toMatchObject({ nights: 3, room: '540.00', extras: '96.00', total: '693.24', balance: '0.00' });
    expect(Number((await extraRow(breakfast['id']))['nights'])).toBe(3);
    // Lengthening it is owed, and goes through.
    await w.update('stays', stay['id'], { depart: '2026-08-04' });
    expect(await figures(stay['id'])).toMatchObject({ nights: 4, room: '710.00', extras: '128.00' });
  });

  /** A multi-row door's write of one stay: prepared, written, committed, then its totals and follows settled. */
  const bulkOf = (id: unknown) => async (values: Record<string, unknown>, context: WriteContext, options?: { capacity: 'unchecked' }) => {
    const target = w.targetOf('stays');
    const before = (await fetchByPk(target.db, target.table, { id }))!;
    const [prepared] = await w.writes.beforeEach('update', target, context, [{ match: { id }, values, record: before }], options);
    expect(prepared!.issues).toBeNull();
    await w.writes.transaction(target, [], (db) => updateRows(db, dialect, target.table, prepared!.values, { id }));
    const after = (await fetchByPk(target.db, target.table, { id }))!;
    await w.writes.afterEach('update', target, context, [{ record: after, before }]);
    return before;
  };

  it.runIf(available)('follows through an import update and an undo', async () => {
    const { stay, breakfast } = await breakfastStay();
    const target = w.targetOf('stays');
    const bulk = bulkOf(stay['id']);
    // An import brings in history: judged by no balance, its follows settled after its rows are written.
    await bulk({ depart: '2026-08-02' }, { ...w.desk, origin: 'import' }, { capacity: 'unchecked' });
    expect(Number((await extraRow(breakfast['id']))['nights'])).toBe(2);
    expect(await figures(stay['id'])).toMatchObject({ room: '370.00', extras: '64.00', total: '473.06' });
    await bulk({ guests: 1 }, { ...w.desk, origin: 'import' }, { capacity: 'unchecked' });
    expect(money((await extraRow(breakfast['id']))['amount'])).toBe('32.00');
    // An undo puts the row back as it was, and its extras follow it back.
    const restoring = (await fetchByPk(target.db, target.table, { id: stay['id'] }))!;
    await sql`UPDATE ${sql.table(target.table.id)} SET guests = 2, depart = ${'2026-08-03'}, nights = 3, room_total = 540 WHERE id = ${stay['id']}`.execute(target.db);
    const restored = (await fetchByPk(target.db, target.table, { id: stay['id'] }))!;
    await w.writes.afterEach('update', target, { ...w.desk, origin: 'undo' }, [{ record: restored, before: restoring }]);
    const extra = await extraRow(breakfast['id']);
    expect([Number(extra['nights']), Number(extra['guests']), money(extra['amount'])]).toEqual([3, 2, '96.00']);
    expect((await figures(stay['id'])).extras).toBe('96.00');
  });

  it.runIf(available)('refuses a bulk change of a stay whose balance is kept at zero or above — before anything is written', async () => {
    const { stay, breakfast } = await breakfastStay();
    await w.create('payments', { stay_id: stay['id'], amount: '693.24' });
    const target = w.targetOf('stays');
    const before = (await fetchByPk(target.db, target.table, { id: stay['id'] }))!;
    const prepare = (values: Record<string, unknown>) => w.writes.beforeEach('update', target, { ...w.desk, origin: 'bulk' }, [{ match: { id: stay['id'] }, values, record: before }]);
    // Fewer guests: the breakfast that follows them would take the paid stay below zero, after its rows were written.
    await expect(prepare({ guests: 1 })).rejects.toMatchObject({ statusCode: 409, details: { reason: 'BALANCE_ONE_AT_A_TIME' } });
    // A night fewer: the room priced again, and the total under the balance.
    await expect(prepare({ depart: '2026-08-02' })).rejects.toMatchObject({ statusCode: 409, details: { reason: 'BALANCE_ONE_AT_A_TIME' } });
    // Another room, or the same nights a day later: no night count moves, but the room is priced again, and the total with it.
    await expect(prepare({ room_type_id: seed.harbour['id'] })).rejects.toMatchObject({ statusCode: 409, details: { reason: 'BALANCE_ONE_AT_A_TIME' } });
    await expect(prepare({ arrive: '2026-08-01', depart: '2026-08-04' })).rejects.toMatchObject({ statusCode: 409, details: { reason: 'BALANCE_ONE_AT_A_TIME' } });
    // A whole-row edit that sends the dates and guests back as they are moves nothing, and goes through.
    await expect(prepare({ guests: 2, depart: '2026-08-03', note: 'Late check-in' })).resolves.toMatchObject([{ issues: null }]);
    // A change that moves neither: nothing follows, nothing is refused.
    await expect(prepare({ note: 'Late check-in' })).resolves.toMatchObject([{ issues: null }]);
    expect(await figures(stay['id'])).toMatchObject({ nights: 3, room: '540.00', extras: '96.00', total: '693.24', paid: '693.24', balance: '0.00' });
    const extra = await extraRow(breakfast['id']);
    expect([Number(extra['nights']), Number(extra['guests']), money(extra['amount'])]).toEqual([3, 2, '96.00']);
    // One at a time, the same change is judged in its own write: refused, and nothing is kept.
    await expect(w.update('stays', stay['id'], { guests: 1 })).rejects.toMatchObject({ code: 'BALANCE_EXCEEDED' });
    expect(Number((await extraRow(breakfast['id']))['guests'])).toBe(2);
  });

  it.runIf(available)('refuses a bulk change more than 500 rows follow before anything is written', async () => {
    const { stay } = await breakfastStay();
    const table = h!.real('stay_extras');
    const values = Array.from({ length: 500 }, () => `(${String(stay['id'])}, ${String(seed.late['id'])}, 3, 2, 35, 'stay', 'Late leaving', ${dialect === 'postgres' ? 'false' : '0'})`).join(', ');
    const q = (name: string) => (dialect === 'mysql' ? `\`${name}\`` : `"${name}"`);
    await h!.rows(`INSERT INTO ${table} (${['stay_id', 'extra_id', 'nights', 'guests', 'each', 'per', 'label', 'removed'].map(q).join(', ')}) VALUES ${values}`);
    const target = w.targetOf('stays');
    const before = (await fetchByPk(target.db, target.table, { id: stay['id'] }))!;
    // An import (history, judged by no balance) still moves at most 500 rows in one change.
    const refused = await w.writes
      .beforeEach('update', target, { ...w.desk, origin: 'import' }, [{ match: { id: stay['id'] }, values: { guests: 3 }, record: before }], { capacity: 'unchecked' })
      .catch((error: unknown) => error);
    expect(refused).toMatchObject({ statusCode: 409, code: 'FOLLOW_TOO_MANY', details: { table: w.targetOf('stay_extras').table.id, count: 501 } });
    expect(Number((await stayRow(stay['id']))['guests'])).toBe(2);
    await h!.rows(`DELETE FROM ${table} WHERE stay_id = ${String(stay['id'])}`);
  });

  it.runIf(available)("refuses a bulk change, by name, when the role may not write a follower's column or the total it adds into", async () => {
    const { stay } = await breakfastStay();
    const extras = w.targetOf('stay_extras').table.id;
    const stays = w.targetOf('stays').table.id;
    const writesWith = (rights: (table: string) => unknown) => createWriteService({ ...writeStores(h!.meta), rights: async (_connection, table) => rights(table) as never });
    const target = w.targetOf('stays');
    const before = (await fetchByPk(target.db, target.table, { id: stay['id'] }))!;
    const prepare = (writes: ReturnType<typeof createWriteService>) =>
      writes.beforeEach('update', target, { ...w.desk, origin: 'import' }, [{ match: { id: stay['id'] }, values: { guests: 3 }, record: before }], { capacity: 'unchecked' }).catch((error: unknown) => error);
    const guests = await prepare(writesWith((table) => (table === extras ? { insert: true, update: true, delete: true, columns: { guests: { insert: true, update: false } } } : null)));
    expect(guests).toMatchObject({ code: 'READ_ONLY_MODE', details: { table: extras, columns: ['guests'], reason: 'privileges' } });
    // The stay's extras total, which the follow settles, is the stay's own column: named too.
    const total = await prepare(writesWith((table) => (table === stays ? { insert: true, update: true, delete: true, columns: { extras_total: { insert: true, update: false } } } : null)));
    expect(total).toMatchObject({ code: 'READ_ONLY_MODE', details: { table: stays, columns: ['extras_total'], reason: 'privileges' } });
    expect(Number((await stayRow(stay['id']))['guests'])).toBe(2);
  });

  it.runIf(available)('refuses a change more than 500 rows follow, and writes none of them', async () => {
    const { stay } = await breakfastStay();
    const table = h!.real('stay_extras');
    const values = Array.from({ length: 500 }, () => `(${String(stay['id'])}, ${String(seed.late['id'])}, 3, 2, 35, 'stay', 'Late leaving', ${dialect === 'postgres' ? 'false' : '0'})`).join(', ');
    const q = (name: string) => (dialect === 'mysql' ? `\`${name}\`` : `"${name}"`);
    await h!.rows(`INSERT INTO ${table} (${['stay_id', 'extra_id', 'nights', 'guests', 'each', 'per', 'label', 'removed'].map(q).join(', ')}) VALUES ${values}`);
    const refused = await w.update('stays', stay['id'], { depart: '2026-08-02' }).catch((error: unknown) => error);
    expect(refused).toMatchObject({ statusCode: 409, code: 'FOLLOW_TOO_MANY', details: { table: w.targetOf('stay_extras').table.id, count: 501 } });
    expect(Number((await stayRow(stay['id']))['nights'])).toBe(3);
    await h!.rows(`DELETE FROM ${table} WHERE stay_id = ${String(stay['id'])}`);
  });

  it.runIf(available)("refuses, by name, a follower's column the role may not write — before anything is written", async () => {
    const { stay } = await breakfastStay();
    const extras = w.targetOf('stay_extras').table.id;
    const writes = createWriteService({
      ...writeStores(h!.meta),
      rights: async (_connection, table) => (table === extras ? { insert: true, update: true, delete: true, columns: { nights: { insert: true, update: false } } } : null),
    });
    const refused = await writes
      .update({ target: w.targetOf('stays'), pk: { id: stay['id'] }, values: { depart: '2026-08-02' }, context: w.desk, announce: async () => {} })
      .catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(ForbiddenError);
    expect(refused).toMatchObject({ code: 'READ_ONLY_MODE', details: { table: extras, columns: ['nights'], reason: 'privileges' } });
    expect(Number((await stayRow(stay['id']))['nights'])).toBe(3);
    // Through the caller's own refusal: a public change answers it as it answers any refused write.
    const mapped = await writes
      .update({
        target: w.targetOf('stays'),
        pk: { id: stay['id'] },
        values: { depart: '2026-08-02' },
        context: w.desk,
        announce: async () => {},
        mapError: (error) => {
          throw new Error(`mapped: ${(error as { code?: string }).code ?? ''}`);
        },
      })
      .catch((error: unknown) => error);
    expect(String(mapped)).toContain('mapped: READ_ONLY_MODE');
  });
});
