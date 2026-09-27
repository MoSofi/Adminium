// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The desk's "edit a stay" form: the stay's own change (its guests, its
 * dates) saved with its extras in one PATCH. The save is judged as a change
 * of the stay on its own followed by its extras' writes, in one transaction:
 *
 *  - a paid stay shortened by a night, with an extra added in the same save,
 *    is refused for its balance (409 `BALANCE_EXCEEDED`) and NOTHING of the
 *    save is kept — not the dates, not the extra, not a followed night;
 *  - an unpaid stay given a third guest, with parking added, is saved: the
 *    breakfast follows the guests, the parking copies the stay's nights and
 *    guests, and the totals and the balance are the hotel's own figures;
 *  - an undo of that save takes all of it back;
 *  - two desks saving two stays at once each go through, with no deadlock
 *    and no conflict (Postgres, MySQL);
 *  - a quote of the stay's change refuses what the save refuses;
 *  - a payment saved with the stay's change takes its receipt number
 *    without a gap, six forms at once, and a refused save takes none.
 *
 * A multi-row write (bulk) of the same change is still refused before it
 * writes anything: it cannot settle each stay inside its own statement.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { installInvoicing, LEGS, writerFor, type InvoicingHarness } from './invoicing-install.helpers.js';
import { dataRoutesOver, type DataRoutes } from './invoicing-routes.helpers.js';
import { seedWren, wrenManifest, wrenTables } from './wren-house-fixture.js';

const money = (value: unknown) => (value === null || value === undefined ? null : Number(value).toFixed(2));
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe.each(LEGS)("the desk's edit of a stay with its extras — %s", (dialect, available) => {
  let h: InvoicingHarness | undefined;
  let w: Awaited<ReturnType<typeof writerFor>>;
  let r: DataRoutes;
  let seed: Awaited<ReturnType<typeof seedWren>>;
  beforeAll(async () => {
    if (!available) return;
    h = await installInvoicing(dialect, wrenManifest());
    w = await writerFor(h, 'Europe/London');
    seed = await seedWren((ref, values) => w.create(ref, values));
    r = await dataRoutesOver(h, dialect);
  }, 180_000);
  afterAll(async () => {
    await r?.close();
    await h?.close();
  });

  const extras = () => r.relation('stay_extras', 'stays');
  /** A Garden stay Fri 31 July – Mon 3 August for two with breakfast: 540 of room, 96 of breakfast, 693.24 in all. */
  const stayWithBreakfast = async (paid: string | null) => {
    const stay = await w.create('stays', { first_name: 'Mia', last_name: 'Okada', guests: 2, room_type_id: seed.garden['id'], arrive: '2026-07-31', depart: '2026-08-03' });
    const breakfast = await w.create('stay_extras', { stay_id: stay['id'], extra_id: seed.breakfast['id'] });
    if (paid !== null) await w.create('payments', { stay_id: stay['id'], amount: paid });
    return { stay, breakfast };
  };
  const stayRow = async (id: unknown) => (await h!.rows(`SELECT * FROM ${h!.real('stays')} WHERE id = ${String(id)}`))[0]!;
  const extrasOf = async (id: unknown) => h!.rows(`SELECT * FROM ${h!.real('stay_extras')} WHERE stay_id = ${String(id)} ORDER BY id`);
  const figures = (row: Record<string, unknown>) => ({
    room: money(row['room_total']),
    extras: money(row['extras_total']),
    subtotal: money(row['subtotal']),
    tax: money(row['tax']),
    total: money(row['total']),
    paid: money(row['paid']),
    balance: money(row['balance']),
  });
  const day = (value: unknown) =>
    value instanceof Date ? `${String(value.getFullYear())}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}` : String(value).slice(0, 10);
  const extraLines = async (id: unknown) =>
    (await extrasOf(id)).map((row) => ({ extra: Number(row['extra_id']), nights: Number(row['nights']), guests: Number(row['guests']), amount: money(row['amount']) }));
  /** The form's save: the stay's changes, its extras as they are (by key), and the new ones. */
  const save = async (id: unknown, values: Record<string, unknown>, added: unknown[]) =>
    r.patch('stays', id, {
      values,
      children: { [extras()]: [...(await extrasOf(id)).map((row) => ({ key: { id: row['id'] }, values: {} })), ...added.map((extra) => ({ values: { extra_id: extra } }))] },
    });
  const errorOf = (reply: { json: <T>() => T }) => reply.json<{ error: { code: string; details?: Record<string, unknown> } }>().error;

  it.runIf(available)("refuses a paid stay's shorter dates and an added extra together, keeping nothing of the save", async () => {
    const { stay, breakfast } = await stayWithBreakfast('693.24');
    const was = await stayRow(stay['id']);
    expect(figures(was)).toEqual({ room: '540.00', extras: '96.00', subtotal: '636.00', tax: '57.24', total: '693.24', paid: '693.24', balance: '0.00' });
    // One night less (Sunday's 170, and two breakfasts) and a late leaving (35): 511.21 in all, under what was paid.
    const refused = await save(stay['id'], { depart: '2026-08-02' }, [seed.late['id']]);
    expect(refused.statusCode, refused.body).toBe(409);
    expect(errorOf(refused)).toMatchObject({ code: 'BALANCE_EXCEEDED', details: { column: 'balance', balance: 0 } });
    // Nothing kept: the dates, the breakfast's nights, no late leaving, the totals.
    const now = await stayRow(stay['id']);
    expect(day(now['depart'])).toBe('2026-08-03');
    expect(figures(now)).toEqual(figures(was));
    expect(await extraLines(stay['id'])).toEqual([{ extra: Number(seed.breakfast['id']), nights: 3, guests: 2, amount: '96.00' }]);
    expect(Number(breakfast['id'])).toBe(Number((await extrasOf(stay['id']))[0]!['id']));
    // A quote of the stay's change refuses it the same way, and keeps nothing either.
    const quoted = await w.writes
      .update({ target: w.targetOf('stays'), pk: { id: stay['id'] }, values: { depart: '2026-08-02' }, context: w.desk, mode: 'dry', announce: async () => {} })
      .catch((error: unknown) => error);
    expect(quoted).toMatchObject({ statusCode: 409, code: 'BALANCE_EXCEEDED', details: { column: 'balance', balance: 0 } });
    expect(figures(await stayRow(stay['id']))).toEqual(figures(was));
    // A longer stay with the late leaving is owed, not refused: an August Monday (170), eight breakfasts (128), 35.
    const longer = await save(stay['id'], { depart: '2026-08-04' }, [seed.late['id']]);
    expect(longer.statusCode, longer.body).toBe(200);
    expect(figures(await stayRow(stay['id']))).toEqual({ room: '710.00', extras: '163.00', subtotal: '873.00', tax: '78.57', total: '951.57', paid: '693.24', balance: '258.33' });
  });

  it.runIf(available)("saves an unpaid stay's third guest with parking added: the extras follow, the totals and balance add up — and an undo takes it all back", async () => {
    const { stay } = await stayWithBreakfast('200.00');
    const saved = await save(stay['id'], { guests: 3 }, [seed.parking['id']]);
    expect(saved.statusCode, saved.body).toBe(200);
    // Breakfast 16 × 3 × 3 = 144, parking 14 × 3 = 42: 540 + 186 = 726, 65.34 tax.
    expect(await extraLines(stay['id'])).toEqual([
      { extra: Number(seed.breakfast['id']), nights: 3, guests: 3, amount: '144.00' },
      { extra: Number(seed.parking['id']), nights: 3, guests: 3, amount: '42.00' },
    ]);
    const after = { room: '540.00', extras: '186.00', subtotal: '726.00', tax: '65.34', total: '791.34', paid: '200.00', balance: '591.34' };
    expect(figures(await stayRow(stay['id']))).toEqual(after);
    // The reply shows the stored figures.
    expect(figures(saved.json<{ data: Record<string, unknown> }>().data)).toEqual(after);

    const undone = await r.undo(saved.json<{ undoToken: string }>().undoToken);
    expect(undone.statusCode, undone.body).toBe(200);
    const back = await stayRow(stay['id']);
    expect(Number(back['guests'])).toBe(2);
    expect(await extraLines(stay['id'])).toEqual([{ extra: Number(seed.breakfast['id']), nights: 3, guests: 2, amount: '96.00' }]);
    expect(figures(back)).toEqual({ room: '540.00', extras: '96.00', subtotal: '636.00', tax: '57.24', total: '693.24', paid: '200.00', balance: '493.24' });
  });

  it.runIf(available)("saves an unpaid stay moved to another room type with an extra added: priced again for the new type's nights", async () => {
    const { stay } = await stayWithBreakfast('200.00');
    const saved = await save(stay['id'], { room_type_id: seed.harbour['id'] }, [seed.late['id']]);
    expect(saved.statusCode, saved.body).toBe(200);
    // Harbour 180: Fri 205 (weekend), Sat 225 (weekend, August), Sun 200 (August) = 630; 96 + 35 of extras; 68.49 tax.
    expect(figures(await stayRow(stay['id']))).toEqual({ room: '630.00', extras: '131.00', subtotal: '761.00', tax: '68.49', total: '829.49', paid: '200.00', balance: '629.49' });
  });

  it.runIf(available && dialect !== 'sqlite')('lets two desks save two stays at once: no deadlock, no conflict, each stay right', async () => {
    const one = await stayWithBreakfast(null);
    const two = await stayWithBreakfast(null);
    const three = await stayWithBreakfast(null);
    for (let round = 0; round < 3; round += 1) {
      const guests = 3 + (round % 2);
      const replies = await Promise.race([
        Promise.all([
          save(one.stay['id'], { guests }, [seed.parking['id']]),
          save(two.stay['id'], { guests, depart: round % 2 === 0 ? '2026-08-04' : '2026-08-03' }, [seed.late['id']]),
          // Writers of their own on a third stay: a single-row change of it, and an extra added to it, beside the two forms.
          w.update('stays', three.stay['id'], { guests }).then(() => ({ statusCode: 200, body: '' })),
          w.create('stay_extras', { stay_id: three.stay['id'], extra_id: seed.parking['id'] }).then(() => ({ statusCode: 200, body: '' })),
        ]),
        // A deadline: a deadlock that the database never breaks fails here rather than hanging the run.
        pause(30_000).then(() => null),
      ]);
      expect(replies, 'the saves never finished').not.toBeNull();
      for (const reply of replies!) expect(reply.statusCode, reply.body).toBe(200);
    }
    // Each stay as its own saves left it: every extra in step with its nights and guests, the totals adding up.
    for (const id of [one.stay['id'], two.stay['id'], three.stay['id']]) {
      const row = await stayRow(id);
      const lines = await extrasOf(id);
      let sum = 0;
      for (const line of lines) {
        expect([Number(line['nights']), Number(line['guests'])]).toEqual([Number(row['nights']), Number(row['guests'])]);
        sum += Number(line['amount']);
      }
      expect(money(row['extras_total'])).toBe(sum.toFixed(2));
      expect(money(row['subtotal'])).toBe((Number(row['room_total']) + sum).toFixed(2));
      expect(money(row['balance'])).toBe(money(row['total']));
    }
    expect((await extrasOf(one.stay['id'])).length).toBe(4);
    expect((await extrasOf(two.stay['id'])).length).toBe(4);
    expect((await extrasOf(three.stay['id'])).length).toBe(4);
  }, 120_000);

  it.runIf(available)('still refuses the same change as a multi-row write, before it writes anything', async () => {
    const { stay } = await stayWithBreakfast('693.24');
    const bulk = await r.t.app.inject({
      method: 'POST',
      url: `/api/v1/data/${r.connectionId}/${r.table('stays')}/bulk`,
      headers: (await import('./connections-helpers.js')).asUser(r.t.users.admin),
      payload: { action: 'update', ids: [String(stay['id'])], values: { depart: '2026-08-02' } },
    });
    expect(bulk.statusCode, bulk.body).toBe(409);
    expect(errorOf(bulk).details).toMatchObject({ reason: 'BALANCE_ONE_AT_A_TIME' });
    expect(day((await stayRow(stay['id']))['depart'])).toBe('2026-08-03');
  });
});

describe.each(LEGS)("the desk's edit of a stay with a numbered payment — %s", (dialect, available) => {
  let h: InvoicingHarness | undefined;
  let w: Awaited<ReturnType<typeof writerFor>>;
  let r: DataRoutes;
  let seed: Awaited<ReturnType<typeof seedWren>>;
  beforeAll(async () => {
    if (!available) return;
    // The released hotel's tables, its payments given a receipt number from a series without gaps.
    const tables = wrenTables().map((table) =>
      table['ref'] !== 'payments'
        ? table
        : {
            ...table,
            columns: [
              ...(table['columns'] as unknown[]),
              { ref: 'receipt_seq', type: 'int', nullable: true, rules: { sequence: { gapless: true } } },
              { ref: 'receipt', type: 'text', maxLength: 24, nullable: true, rules: { format: { from: 'receipt_seq', prefix: 'RCT-', pad: 4 } } },
            ],
          },
    );
    h = await installInvoicing(dialect, wrenManifest(tables));
    w = await writerFor(h, 'Europe/London');
    seed = await seedWren((ref, values) => w.create(ref, values));
    r = await dataRoutesOver(h, dialect);
  }, 180_000);
  afterAll(async () => {
    await r?.close();
    await h?.close();
  });

  const stay = () => w.create('stays', { first_name: 'Mia', guests: 2, room_type_id: seed.garden['id'], arrive: '2026-07-31', depart: '2026-08-03' });
  const receipts = async () => (await h!.rows(`SELECT receipt_seq AS n, receipt AS t FROM ${h!.real('payments')} ORDER BY receipt_seq`)).map((row) => [Number(row['n']), row['t']]);

  it.runIf(available)('numbers each payment without a gap, six forms at once, and a refused save takes no number', async () => {
    const payments = r.relation('payments', 'stays');
    const stays = [];
    for (let i = 0; i < 7; i += 1) stays.push(await stay());
    // Six desks at once, each a third guest and a payment on its own stay.
    const replies = await Promise.all(stays.slice(0, 6).map((one) => r.patch('stays', one['id'], { values: { guests: 3 }, children: { [payments]: [{ values: { amount: '10' } }] } })));
    for (const reply of replies) expect(reply.statusCode, reply.body).toBe(200);
    // Paid in full (588.60), then a night shorter with one more payment: refused whole, its number too.
    const paid = stays[6]!;
    await w.create('payments', { stay_id: paid['id'], amount: '588.60' });
    const listed = (await h!.rows(`SELECT id FROM ${h!.real('payments')} WHERE stay_id = ${String(paid['id'])}`)).map((row) => ({ key: { id: row['id'] }, values: {} }));
    const refused = await r.patch('stays', paid['id'], { values: { depart: '2026-08-02' }, children: { [payments]: [...listed, { values: { amount: '1' } }] } });
    expect(refused.statusCode, refused.body).toBe(409);
    expect(refused.json<{ error: { code: string } }>().error.code).toBe('BALANCE_EXCEEDED');
    await w.create('payments', { stay_id: stays[0]!['id'], amount: '1' });
    expect(await receipts()).toEqual([1, 2, 3, 4, 5, 6, 7, 8].map((n) => [n, `RCT-${String(n).padStart(4, '0')}`]));
  });
});
