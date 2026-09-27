// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A small hotel's app with the released hotel's own prices: room types
 * priced by the night (a weekend and August on top), extras that follow
 * their stay's nights and guests, charges, payments capped at the balance,
 * and a folio document over a stay. The figures the tests pin come from it.
 */
import { invoicingManifest } from './invoicing-install.helpers.js';

const id = { ref: 'id', type: 'int', role: 'pk' };
const text = (ref: string, maxLength = 120, more: Record<string, unknown> = {}) => ({ ref, type: 'text', maxLength, ...more });
const money = (ref: string, rules?: Record<string, unknown>, more: Record<string, unknown> = {}) => ({
  ref,
  type: 'decimal',
  scale: 2,
  nullable: true,
  ...more,
  ...(rules === undefined ? {} : { rules }),
});

export const ROOM_TOTAL = {
  from: 'arrive',
  to: 'depart',
  rate: { via: 'room_type_id', column: 'base_rate' },
  adjust: {
    table: 'rate_rules',
    match: { via: 'room_type_id', weekdays: 'weekdays', from: 'from_date', to: 'to_date' },
    add: 'amount',
    name: 'name',
    where: { column: 'active', eq: true },
  },
};

export function wrenTables(): Record<string, unknown>[] {
  return [
    { ref: 'settings', columns: [id, { ref: 'tax_rate', type: 'decimal', scale: 3, default: 9 }] },
    { ref: 'room_types', columns: [id, text('code', 16), text('name'), { ref: 'base_rate', type: 'decimal', scale: 2, default: 0 }, { ref: 'sleeps', type: 'int', default: 2 }] },
    {
      ref: 'rate_rules',
      columns: [
        id,
        { ref: 'room_type_id', type: 'fk', references: 'room_types', nullable: true },
        text('name', 40),
        text('weekdays', 32, { nullable: true }),
        { ref: 'from_date', type: 'date', nullable: true },
        { ref: 'to_date', type: 'date', nullable: true },
        { ref: 'amount', type: 'decimal', scale: 2, default: 0 },
        { ref: 'active', type: 'bool', default: true },
      ],
    },
    { ref: 'extras', columns: [id, text('label', 60), { ref: 'each', type: 'decimal', scale: 2, default: 0 }, text('per', 16, { default: 'stay' })] },
    {
      ref: 'stays',
      columns: [
        id,
        text('first_name', 60),
        text('last_name', 60, { nullable: true }),
        text('guest_name', 24, { nullable: true, rules: { formula: { join: ['first_name', ' ', 'last_name'] } } }),
        text('note', 200, { nullable: true }),
        { ref: 'room_type_id', type: 'fk', references: 'room_types' },
        { ref: 'arrive', type: 'date' },
        { ref: 'depart', type: 'date' },
        { ref: 'guests', type: 'int', default: 1, rules: { validation: { min: 1, max: 6 } } },
        { ref: 'nights', type: 'int', nullable: true, rules: { formula: { daysBetween: ['arrive', 'depart'] } } },
        money('room_total', { perNight: ROOM_TOTAL }),
        money('extras_total', { rollup: { from: 'stay_extras', via: 'stay_id', sum: 'amount', where: { column: 'removed', eq: false } } }),
        money('charges_total', { rollup: { from: 'charges', via: 'stay_id', sum: 'amount', where: { column: 'voided', eq: false } } }),
        money('subtotal', { formula: { add: [{ coalesce: ['room_total', 0] }, { coalesce: ['extras_total', 0] }, { coalesce: ['charges_total', 0] }] } }),
        { ref: 'tax_rate', type: 'decimal', scale: 3, nullable: true, rules: { default: { from: { table: 'settings', column: 'tax_rate' } } } },
        money('tax', { formula: { round: { div: [{ mul: ['subtotal', { coalesce: ['tax_rate', 0] }] }, 100] } } }),
        money('total', { formula: { add: ['subtotal', { coalesce: ['tax', 0] }] } }),
        money('paid', { rollup: { from: 'payments', via: 'stay_id', sum: 'amount', where: { column: 'voided', eq: false }, balance: { column: 'balance', of: 'total' }, cap: true } }),
        money('balance'),
      ],
    },
    {
      ref: 'stay_extras',
      columns: [
        id,
        { ref: 'stay_id', type: 'fk', references: 'stays' },
        { ref: 'extra_id', type: 'fk', references: 'extras' },
        text('label', 60, { nullable: true, rules: { copy: { via: 'extra_id', from: 'label' } } }),
        money('each', { copy: { via: 'extra_id', from: 'each' } }),
        text('per', 16, { nullable: true, rules: { copy: { via: 'extra_id', from: 'per' } } }),
        { ref: 'nights', type: 'int', nullable: true, rules: { copy: { via: 'stay_id', from: 'nights', mode: 'always', follow: true } } },
        { ref: 'guests', type: 'int', nullable: true, rules: { copy: { via: 'stay_id', from: 'guests', mode: 'always', follow: true } } },
        money('amount', {
          formula: {
            if: [{ eq: ['per', 'person-night'] }, { mul: ['each', 'guests', 'nights'] }, { if: [{ eq: ['per', 'night'] }, { mul: ['each', 'nights'] }, 'each'] }],
          },
        }),
        { ref: 'removed', type: 'bool', default: false },
      ],
    },
    {
      ref: 'charges',
      columns: [id, { ref: 'stay_id', type: 'fk', references: 'stays' }, text('label', 60), money('amount'), { ref: 'charged_on', type: 'date', nullable: true }, { ref: 'voided', type: 'bool', default: false }],
    },
    { ref: 'payments', columns: [id, { ref: 'stay_id', type: 'fk', references: 'stays' }, { ref: 'amount', type: 'decimal', scale: 2 }, { ref: 'voided', type: 'bool', default: false }] },
  ];
}

export function wrenManifest(tables: Record<string, unknown>[] = wrenTables()): Record<string, unknown> {
  const manifest = invoicingManifest(tables);
  manifest['key'] = 'wren';
  (manifest['pages'] as { bindings: Record<string, string> }[])[0]!.bindings = { rows: 'stays' };
  return manifest;
}

/** The released hotel's seed: room types, the weekend and August, and three extras (at the prices the hotel app ships with). */
export async function seedWren(create: (ref: string, values: Record<string, unknown>) => Promise<Record<string, unknown>>) {
  await create('settings', { tax_rate: '9.000' });
  const garden = await create('room_types', { code: 'garden', name: 'Garden', base_rate: '150.00', sleeps: 2 });
  const harbour = await create('room_types', { code: 'harbour', name: 'Harbour', base_rate: '180.00', sleeps: 2 });
  const loft = await create('room_types', { code: 'loft', name: 'Loft', base_rate: '215.00', sleeps: 4 });
  const weekend = await create('rate_rules', { name: 'Weekend', weekdays: 'fri,sat', amount: '25.00' });
  const august = await create('rate_rules', { name: 'August', from_date: '2026-08-01', to_date: '2026-08-31', amount: '20.00' });
  const breakfast = await create('extras', { label: 'Breakfast', each: '16.00', per: 'person-night' });
  const parking = await create('extras', { label: 'Parking', each: '14.00', per: 'night' });
  const late = await create('extras', { label: 'Late leaving', each: '35.00', per: 'stay' });
  return { garden, harbour, loft, weekend, august, breakfast, parking, late };
}
