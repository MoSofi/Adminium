// SPDX-License-Identifier: AGPL-3.0-only
/**
 * AN ORDER THAT IS ITS OWN LINE — a stay: one row, priced by the night, with
 * no table of lines under it. The price rule reads the row itself as the one
 * line (its amount the whole stay's room price, its quantity the nights), a
 * code typed on it takes its share off the room, and a voucher for one night
 * takes the dearest night. Through real saves, on every engine.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { priceWorld, type PriceWorld } from './adjust.helpers.js';
import { refused, saveWorld, type SaveWorld } from './adjust-save.helpers.js';
import { PRICE_KIT, marketManifest } from './fixtures/price-kit/index.js';
import { LEGS } from './invoicing-install.helpers.js';

type Doc = Record<string, unknown>;
const pk = { ref: 'id', type: 'int', role: 'pk' };
const money = (ref: string, extra: Doc = {}): Doc => ({ ref, type: 'money', scale: 2, ...extra });
const link = (table: string): Doc => ({ addOnLink: { addOn: PRICE_KIT, table } });
const fixed = (value: unknown): string => Number(value).toFixed(2);

/** The shop, with rooms let by the night beside it. */
function inn(): Doc {
  const base = marketManifest() as { requiredSchema: { prefixed: boolean; tables: Doc[] } };
  return {
    ...base,
    requiredSchema: {
      ...base.requiredSchema,
      tables: [
        ...base.requiredSchema.tables,
        { ref: 'room_types', columns: [pk, { ref: 'name', type: 'text', maxLength: 60 }, money('base_rate', { default: 0 })] },
        {
          ref: 'rate_rules',
          columns: [pk, { ref: 'room_type_id', type: 'fk', references: 'room_types', nullable: true }, { ref: 'name', type: 'text', maxLength: 40 }, { ref: 'from_date', type: 'date', nullable: true }, { ref: 'to_date', type: 'date', nullable: true }, money('amount', { default: 0 }), { ref: 'active', type: 'bool', default: true }],
        },
        {
          ref: 'stays',
          adjust: {
            by: { addOn: PRICE_KIT },
            lines: [{ self: true, price: 'room_total', discount: 'room_discount', nights: { from: 'arrive', to: 'depart', rate: 'room_total' }, what: [{ column: 'room_type_id', as: 'item' }] }],
            order: { discount: 'discount' },
            codes: { table: 'stay_codes', via: 'stay_id', typed: 'typed', code: 'code_id', voucher: 'voucher_id' },
            expect: 'total',
          },
          columns: [
            pk,
            { ref: 'guest', type: 'text', maxLength: 80, nullable: true },
            { ref: 'room_type_id', type: 'fk', references: 'room_types' },
            { ref: 'arrive', type: 'date' },
            { ref: 'depart', type: 'date' },
            money('room_total', { nullable: true, rules: { perNight: { from: 'arrive', to: 'depart', rate: { via: 'room_type_id', column: 'base_rate' }, adjust: { table: 'rate_rules', match: { via: 'room_type_id', from: 'from_date', to: 'to_date' }, add: 'amount', name: 'name', where: { column: 'active', eq: true } } } } }),
            money('room_discount', { default: 0 }),
            money('discount', { default: 0 }),
            money('room', { nullable: true, rules: { formula: { sub: ['room_total', 'discount'] } } }),
            // Read off the stay as its own line: nothing but that reduction reaches it.
            money('nights_net', { nullable: true, rules: { formula: { sub: ['room_total', 'room_discount'] } } }),
            { ref: 'tax_rate', type: 'decimal', scale: 2, default: 9 },
            money('tax', { nullable: true, rules: { formula: { round: [{ div: [{ mul: ['room', 'tax_rate'] }, 100] }, 2] } } }),
            money('total', { nullable: true, rules: { formula: { add: ['room', 'tax'] } } }),
          ],
        },
        {
          ref: 'stay_codes',
          columns: [pk, { ref: 'stay_id', type: 'fk', references: 'stays' }, { ref: 'typed', type: 'text', maxLength: 40, nullable: true }, { ref: 'code_id', type: 'int', nullable: true, rules: link('codes') }, { ref: 'voucher_id', type: 'int', nullable: true, rules: link('vouchers') }],
        },
      ],
    },
  };
}

describe.each(LEGS)('an order that is its own line, priced by the night — %s', (dialect, available) => {
  let w: PriceWorld;
  let s: SaveWorld;
  let double = 0;
  const figures = async (id: unknown) => {
    const [row] = await w.rows(`SELECT room_total, room_discount, discount, room, tax, total FROM market_stays WHERE id = ${String(id)}`);
    return Object.fromEntries(Object.entries(row!).map(([column, value]) => [column, fixed(value)]));
  };

  beforeAll(async () => {
    if (!available) return;
    w = await priceWorld(dialect, { market: inn() });
    s = saveWorld(w);
    double = await w.insert('market_room_types', { name: 'Double', base_rate: '185.00' });
    // One night in the stay below is dearer than the others.
    await w.insert('market_rate_rules', { room_type_id: double, name: 'Fair night', from_date: '2026-11-07', to_date: '2026-11-07', amount: '30.00' });
    const ten = await w.insert('price_kit_offers', { name: 'Stay ten', kind: 'percent', value: '10.00', trigger: 'code', scope: 'order' });
    await w.insert('price_kit_codes', { code: 'STAY10', offer_id: ten });
    await w.insert('price_kit_vouchers', { code: '9QXA41TR7K2M', worth: 'thing', what_table: w.refOf('market_room_types'), what_row: String(double), units: 1, public_name: 'One night' });
  }, 240_000);
  afterAll(async () => {
    if (available) await w.close();
  });

  it.skipIf(!available)('a 10 % code on a $370.00 two-night stay makes the room $333.00, tax $29.97, total $362.97', async () => {
    const stay = await s.create('market_stays', { guest: 'Ada', room_type_id: double, arrive: '2026-11-02', depart: '2026-11-04' });
    // Nothing reduces it yet: two nights at 185.00, nine percent on top.
    expect(await figures(stay['id'])).toEqual({ room_total: '370.00', room_discount: '0.00', discount: '0.00', room: '370.00', tax: '33.30', total: '403.30' });
    const net = async () => fixed((await w.rows(`SELECT nights_net FROM market_stays WHERE id = ${String(stay['id'])}`))[0]!['nights_net']);
    expect(await net()).toBe('370.00');
    await s.create('market_stay_codes', { stay_id: stay['id'], typed: 'stay10' });
    expect(await net()).toBe('333.00');
    expect(await figures(stay['id'])).toEqual({ room_total: '370.00', room_discount: '37.00', discount: '37.00', room: '333.00', tax: '29.97', total: '362.97' });
    // The reduction is the stay's own: one row of what was applied, on the stay as its own line.
    expect((await w.rows(`SELECT source_line, kind, amount FROM price_kit_applied WHERE source_table = 'market:stays' AND source_row = '${String(stay['id'])}'`)).map((row) => `${String(row['source_line'])} ${String(row['kind'])} ${fixed(row['amount'])}`)).toEqual([`p0:${String(stay['id'])} code 37.00`]);
    // A night more: the stay's price moves, and the ten percent with it.
    await s.update('market_stays', stay['id'], { depart: '2026-11-05' });
    expect(await figures(stay['id'])).toMatchObject({ room_total: '555.00', room_discount: '55.50', room: '499.50' });
  });

  it.skipIf(!available)('a voucher for one night takes the dearest night', async () => {
    // Friday at 185.00, the fair's night at 215.00.
    const stay = await s.create('market_stays', { guest: 'Ben', room_type_id: double, arrive: '2026-11-06', depart: '2026-11-08' });
    expect(await figures(stay['id'])).toMatchObject({ room_total: '400.00', room: '400.00' });
    await s.create('market_stay_codes', { stay_id: stay['id'], typed: 'VC-9QXA-41TR-7K2M' });
    expect(await figures(stay['id'])).toMatchObject({ room_total: '400.00', room_discount: '215.00', discount: '215.00', room: '185.00', tax: '16.65', total: '201.65' });
    expect((await w.rows(`SELECT voucher_id FROM market_stay_codes WHERE stay_id = ${String(stay['id'])}`))[0]!['voucher_id']).not.toBeNull();
  });

  it.skipIf(!available)('a stay made with its code in one write is priced as it is made, and a code that does not stand refuses the stay', async () => {
    const made = await s.tree({ table: 'market_stays', values: { guest: 'Cy', room_type_id: double, arrive: '2026-11-02', depart: '2026-11-04' }, lists: { codes: { table: 'market_stay_codes', via: 'stay_id', rows: [{ typed: 'STAY10' }] } } });
    expect(await figures(made.root['id'])).toMatchObject({ room_discount: '37.00', total: '362.97' });
    const before = Number((await w.rows('SELECT COUNT(*) AS n FROM market_stays'))[0]!['n']);
    const bad = await refused(s.tree({ table: 'market_stays', values: { guest: 'Di', room_type_id: double, arrive: '2026-11-02', depart: '2026-11-04' }, lists: { codes: { table: 'market_stay_codes', via: 'stay_id', rows: [{ typed: 'NOSUCHCODE' }] } } }));
    expect(bad).toMatchObject({ code: 'ADJUST_REFUSED', details: { reason: 'unknown', column: 'typed' } });
    expect(Number((await w.rows('SELECT COUNT(*) AS n FROM market_stays'))[0]!['n'])).toBe(before);
  });
});
