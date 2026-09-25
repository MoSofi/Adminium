// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The subject resolver.
 *
 * This is where a database row meets the contract's wire law, and the whole
 * file is about that boundary being exact: money as integer minor units,
 * percentages as basis points, and no floating point anywhere between a
 * column and a provider.
 */
import { describe, expect, it } from 'vitest';

import {
  buildSubject,
  coerceSlot,
  mappedTables,
  toBasisPoints,
  toMinorUnits,
  type SubjectSlot,
} from './subject.js';

const NOW = { iso: '2026-09-10T09:15:00.000Z', timezone: 'Europe/Lisbon' };
const BUSINESS = { name: 'Northwind', lines: ['18 Harbour Road'] };

const SLOTS: SubjectSlot[] = [
  { id: 'customerName', type: 'text', required: true },
  { id: 'customerLines', type: 'text[]', required: false },
  { id: 'issuedAt', type: 'date', required: false },
  { id: 'taxRate', type: 'percent', required: false },
  {
    id: 'items',
    type: 'collection',
    required: false,
    columns: [
      { id: 'desc', type: 'text' },
      { id: 'qty', type: 'number' },
      { id: 'rate', type: 'money' },
    ],
  },
];

function build(over: Partial<Parameters<typeof buildSubject>[0]> = {}) {
  return buildSubject({
    slots: SLOTS,
    mapping: {
      customerName: { column: 'customer' },
      customerLines: { column: 'address' },
      issuedAt: { column: 'created_on' },
      taxRate: { column: 'vat_rate' },
      items: {
        collection: {
          table: 'public.order_lines',
          fkColumn: 'order_id',
          columns: { desc: 'description', qty: 'quantity', rate: 'unit_price' },
        },
      },
    },
    row: {
      customer: 'Acme Corporation',
      address: '400 Market Street\nSan Francisco',
      created_on: '2026-09-01T00:00:00.000Z',
      vat_rate: '20',
    },
    collections: {
      items: [
        { id: 7, description: 'Audit', quantity: 12, unit_price: '180.00' },
        { id: 8, description: 'Report', quantity: 1, unit_price: '94.50' },
      ],
    },
    now: NOW,
    locale: 'en-US',
    currency: 'EUR',
    business: BUSINESS,
    entity: null,
    number: null,
    ...over,
  });
}

describe('money never goes through a float', () => {
  it('coerces the values that break a naive multiply', () => {
    // `0.1 * 100` is 10.000000000000002 and `12.34 * 100` is
    // 1233.9999999999998. Every one of these would be a cent out.
    expect(toMinorUnits('0.1')).toBe(10);
    expect(toMinorUnits('12.34')).toBe(1234);
    expect(toMinorUnits('1234')).toBe(123_400);
    expect(toMinorUnits('.5')).toBe(50);
  });

  it('rounds a third decimal half away from zero, in both directions', () => {
    expect(toMinorUnits('0.005')).toBe(1);
    expect(toMinorUnits('-0.005')).toBe(-1);
    expect(toMinorUnits('10.004')).toBe(1000);
  });

  it('accepts what a driver actually hands back', () => {
    // `pg` returns `numeric` as a string; SQLite returns a number; a comma
    // decimal mark reaches us from a locale-formatted column.
    expect(toMinorUnits(12.34)).toBe(1234);
    expect(toMinorUnits('12,34')).toBe(1234);
    expect(toMinorUnits('−5')).toBe(-500);
  });

  it('answers null for a column with nothing in it, never zero', () => {
    // Zero is a PRICE. Null is "nobody said", and a document that printed
    // 0.00 for an unmapped column would be stating an amount nobody agreed.
    expect(toMinorUnits(null)).toBeNull();
    expect(toMinorUnits('')).toBeNull();
    expect(toMinorUnits('not a number')).toBeNull();
  });

  it('turns a percentage into basis points with the same arithmetic', () => {
    expect(toBasisPoints('20')).toBe(2000);
    expect(toBasisPoints('7.5')).toBe(750);
    expect(toBasisPoints('0')).toBe(0);
  });
});

describe('coercion per slot type', () => {
  it('splits a multi-line column into address lines and drops the empties', () => {
    expect(coerceSlot('text[]', 'Acme\n\n400 Market Street')).toEqual([
      'Acme',
      '400 Market Street',
    ]);
  });

  it('takes the ISO day from whatever the driver spelled', () => {
    expect(coerceSlot('date', new Date('2026-09-01T12:00:00Z'))).toBe('2026-09-01');
    expect(coerceSlot('date', '2026-09-01T00:00:00.000Z')).toBe('2026-09-01');
    // A column formatted the operator's own way passes through untouched
    // rather than being reinterpreted into a different day.
    expect(coerceSlot('date', '01/09/2026')).toBe('01/09/2026');
  });

  it('never lets an object reach a provider as "[object Object]"', () => {
    expect(coerceSlot('text', { nested: true })).toBe('');
    expect(coerceSlot('text', null)).toBe('');
  });
});

describe('building a subject from a mapped row', () => {
  it('coerces every scalar slot to the wire law', () => {
    const { subject, missing } = build();
    expect(missing).toEqual([]);
    expect(subject.fields.customerName).toBe('Acme Corporation');
    expect(subject.fields.customerLines).toEqual(['400 Market Street', 'San Francisco']);
    expect(subject.fields.issuedAt).toBe('2026-09-01');
    expect(subject.fields.taxRate).toBe(2000);
  });

  it('coerces a collection column by column, keeping a stable row id', () => {
    const { subject } = build();
    expect(subject.collections.items).toEqual([
      { id: '7', desc: 'Audit', qty: 12, rate: 18_000 },
      { id: '8', desc: 'Report', qty: 1, rate: 9450 },
    ]);
  });

  it('carries the clock, the locale and the business through untouched', () => {
    const { subject } = build();
    expect(subject.now).toEqual(NOW);
    expect(subject.currency).toBe('EUR');
    expect(subject.business).toEqual(BUSINESS);
  });

  it('REPORTS an unmapped required slot rather than throwing', () => {
    // The caller is the render job, which turns this into a `failed` register
    // row naming the slots. An exception would leave the operator with a job
    // error and no row to look at.
    const { missing, subject } = build({ mapping: { customerLines: { column: 'address' } } });
    expect(missing).toEqual(['customerName']);
    expect(subject.fields.customerName).toBeUndefined();
  });

  it('reports a required slot that is MAPPED but empty on this row', () => {
    // The mapping is right and the data is not — a different fault with the
    // same consequence, and the operator needs to be told which.
    const { missing } = build({ row: { customer: '', address: 'x' } });
    expect(missing).toEqual(['customerName']);
  });

  it('leaves an optional unmapped slot out entirely', () => {
    const { subject, missing } = build({ mapping: { customerName: { column: 'customer' } } });
    expect(missing).toEqual([]);
    expect('taxRate' in subject.fields).toBe(false);
    expect(subject.collections.items).toEqual([]);
  });

  it('resolves a value across a foreign key from the caller’s lookups', () => {
    const { subject } = build({
      mapping: { customerName: { ref: 'customer_id', column: 'name' } },
      lookups: { 'customer_id.name': 'Acme Corporation' },
    });
    expect(subject.fields.customerName).toBe('Acme Corporation');
  });
});

describe('a value typed into the mapping instead of a column', () => {
  it('fills the slot, through the SAME coercion a column goes through', () => {
    // The whole point of routing it through `coerceSlot`: "20" typed into a
    // percent slot has to become 2000 basis points, exactly as the numeric
    // column does above. A literal that skipped it would be the one value in
    // the subject not written in the wire law.
    const { subject, missing } = build({
      mapping: { customerName: { column: 'customer' } },
      values: { taxRate: '20' },
    });
    expect(missing).toEqual([]);
    expect(subject.fields.taxRate).toBe(2000);
  });

  it('gives way to a mapped column, so the LIVE half of a document wins', () => {
    /*
     * O20 says a field is authored or mapped, never both — and the editor
     * enforces it. This is what happens when a profile carries both anyway:
     * an older mapping whose typed value was left behind when somebody chose
     * a column. Drawing the constant there would quietly freeze a field the
     * operator believes is live.
     */
    const { subject } = build({ values: { taxRate: '99' } });
    expect(subject.fields.taxRate).toBe(2000);
  });

  it('satisfies a REQUIRED slot, because a typed value is a value', () => {
    const { missing, subject } = build({
      mapping: {},
      values: { customerName: 'Cash sale' },
    });
    expect(missing).toEqual([]);
    expect(subject.fields.customerName).toBe('Cash sale');
  });

  it('treats an empty typed value as nothing typed at all', () => {
    // An operator who opens the control and types nothing has not authored an
    // empty customer name — they have left the slot alone. Storing '' would
    // draw a blank line where the provider would otherwise omit the field.
    const { missing, subject } = build({ mapping: {}, values: { customerName: '' } });
    expect(missing).toEqual(['customerName']);
    expect(subject.fields.customerName).toBeUndefined();
  });

  it('leaves a collection slot alone — a typed value cannot be a list', () => {
    const { subject } = build({ mapping: {}, values: { items: 'one, two' } });
    expect(subject.collections.items).toEqual([]);
  });

  it('takes collection ROWS outright, in the slot’s own column ids (D15)', () => {
    /*
     * A request-shaped intent has no source table, so its lines arrive already
     * named for the slot. They go through the same coercion a mapped row does —
     * `'180.00'` is 18 000 minor units whether it came from a column or a POST.
     */
    const { subject, missing } = build({
      mapping: { customerName: { column: 'customer' } },
      collectionValues: { items: [{ desc: 'Audit', qty: 12, rate: '180.00' }] },
    });
    expect(missing).toEqual([]);
    expect(subject.collections.items).toEqual([{ desc: 'Audit', qty: 12, rate: 18_000 }]);
  });

  it('ignores a column the slot does not declare, rather than passing it through', () => {
    // The outline is the contract. A caller that sends `{secret: …}` on a line
    // must not have it end up in a frozen subject the provider then draws.
    const { subject } = build({
      mapping: { customerName: { column: 'customer' } },
      collectionValues: { items: [{ desc: 'Audit', secret: 'x' }] },
    });
    expect(subject.collections.items).toEqual([{ desc: 'Audit' }]);
  });
});

describe('which tables a profile reads', () => {
  it('names the base table and every collection’s table', () => {
    // What the routes resolve read grants over: a caller holding `orders:read`
    // but not `order_lines:read` may not see a document built from both.
    expect(
      mappedTables(
        {
          customerName: { column: 'customer' },
          items: {
            collection: { table: 'public.order_lines', fkColumn: 'order_id', columns: {} },
          },
        },
        'public.orders',
      ),
    ).toEqual(['public.orders', 'public.order_lines']);
  });

  it('does not repeat the base table when a collection points back at it', () => {
    expect(
      mappedTables(
        { items: { collection: { table: 'public.orders', fkColumn: 'parent_id', columns: {} } } },
        'public.orders',
      ),
    ).toEqual(['public.orders']);
  });
});

describe('money in the minor units of the document\'s own currency', () => {
  it('uses the currency\'s decimals, not a fixed two', () => {
    expect(toMinorUnits('1200', 0)).toBe(1200);
    expect(toMinorUnits('1200.0000', 0)).toBe(1200);
    expect(toMinorUnits('1199.5', 0)).toBe(1200);
    expect(toMinorUnits('1.250', 3)).toBe(1250);
    expect(toMinorUnits('1.2505', 3)).toBe(1251);
    expect(toMinorUnits('-0.0015', 3)).toBe(-2);
  });

  it('coerces every money slot of a subject at its currency\'s scale', () => {
    const slots = [
      { id: 'total', type: 'money' as const, required: true },
      { id: 'lines', type: 'collection' as const, required: false, columns: [{ id: 'amount', type: 'money' as const }] },
    ];
    const build = (currency: string) =>
      buildSubject({
        slots,
        mapping: { total: { column: 'total' }, lines: { collection: { table: 't', fkColumn: 'p', columns: { amount: 'amount' } } } },
        row: { total: '1.250' },
        collections: { lines: [{ amount: '0.125' }] },
        now: { iso: '2026-09-25T00:00:00Z', timezone: 'UTC' },
        locale: 'en-US',
        currency,
        business: { name: 'B', lines: [] },
        entity: null,
        number: null,
      }).subject;
    expect(build('KWD').fields['total']).toBe(1250);
    expect(build('KWD').collections['lines']?.[0]?.['amount']).toBe(125);
    expect(build('JPY').fields['total']).toBe(1);
    expect(build('EUR').fields['total']).toBe(125);
  });

  it('names a linked row\'s table among those a document reads, when the profile knows it', () => {
    expect(mappedTables({ client: { ref: 'client_id', column: 'company', table: 'public.clients' } }, 'public.invoices')).toEqual([
      'public.invoices',
      'public.clients',
    ]);
  });
});
