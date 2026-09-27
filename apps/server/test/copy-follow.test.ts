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

  it.runIf(available)('follows through bulk, an import update and an undo', async () => {
    const { stay, breakfast } = await breakfastStay();
    const target = w.targetOf('stays');
    const bulk = async (values: Record<string, unknown>, context: WriteContext) => {
      const before = (await fetchByPk(target.db, target.table, { id: stay['id'] }))!;
      const [prepared] = await w.writes.beforeEach('update', target, context, [{ match: { id: stay['id'] }, values, record: before }]);
      expect(prepared!.issues).toBeNull();
      await w.writes.transaction(target, [], (db) => updateRows(db, dialect, target.table, prepared!.values, { id: stay['id'] }));
      const after = (await fetchByPk(target.db, target.table, { id: stay['id'] }))!;
      await w.writes.afterEach('update', target, context, [{ record: after, before }]);
      return before;
    };
    await bulk({ depart: '2026-08-02' }, { ...w.desk, origin: 'bulk' });
    expect(Number((await extraRow(breakfast['id']))['nights'])).toBe(2);
    expect(await figures(stay['id'])).toMatchObject({ room: '370.00', extras: '64.00', total: '473.06' });
    await bulk({ guests: 1 }, { ...w.desk, origin: 'import' });
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
  });
});
