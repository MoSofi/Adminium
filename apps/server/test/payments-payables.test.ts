// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What can be paid, by kind, against fake sources: the shape tables (`@1`
 * takes manual payments only, `@2` online too), the designer invoices (which
 * need an ISO currency before they can be paid), and the money rules every
 * kind shares — exact at the currency's decimals or refused, never rounded.
 */
import type { ParsedPayableMapping, PayableRef } from '@adminium/meta';
import { describe, expect, it } from 'vitest';

import { exactAmount, fromMinorUnits, pkOfRowKey, resolvePayable, rowKeyOf, type PayableSources } from '../src/payments/payables.js';

type Row = Record<string, unknown>;

function sources(over: Partial<PayableSources> & { rows?: Record<string, Row>; shape?: { version: number; paymentsTable: string | null } | null } = {}): PayableSources {
  return {
    table: async () => ({ table: { primaryKey: ['id'] } as never, target: {} as never }),
    readRow: async (_connection, _table, rowKey) => over.rows?.[rowKey] ?? null,
    shapeOf: async () => (over.shape === undefined ? { version: 2, paymentsTable: 'public.payments' } : over.shape),
    connectionCurrency: async () => 'EUR',
    profile: async () => null,
    keptPaid: async () => '0',
    document: async () => null,
    ...over,
  };
}

const SHAPE: PayableRef = { kind: 'shape', connectionId: 'conn_1', tableName: 'public.invoices', rowKey: '42' };
const DOC: PayableRef = { kind: 'document', connectionId: null, tableName: null, rowKey: 'idoc_1' };
const invoice = (over: Row = {}): Row => ({ id: 42, number: 'INV-0042', status: 'sent', currency: 'EUR', total: '120.00', balance: '120.00', ...over });

describe('a table built on the invoice shape', () => {
  it('is payable while sent with a balance, its due the balance', async () => {
    const payable = await resolvePayable(sources({ rows: { '42': invoice({ balance: '70.00' }) } }), SHAPE);
    expect(payable).toMatchObject({ label: 'INV-0042', currency: 'EUR', total: '120.00', due: '70.00', refusal: null, manualOnly: false });
    expect(payable?.recordInto).toMatchObject({ kind: 'table', tableName: 'public.payments', link: 'document_id', reference: 'payment_ref', shapeColumns: true, linkValue: 42 });
  });

  it.each([
    [{ status: 'draft' }, 'NOT_SENT'],
    [{ status: 'void' }, 'VOIDED'],
    [{ balance: '0.00' }, 'NOTHING_DUE'],
    [{ balance: '0.005' }, 'AMOUNT_UNCLEAR'],
    [{ currency: null }, null],
  ] as const)('%o → %s', async (over, code) => {
    const payable = await resolvePayable(sources({ rows: { '42': invoice(over as Row) } }), SHAPE);
    expect(payable?.refusal?.code ?? null).toBe(code);
  });

  it('takes manual payments only on @1: online needs the app\'s update', async () => {
    const payable = await resolvePayable(sources({ rows: { '42': invoice() }, shape: { version: 1, paymentsTable: 'public.payments' } }), SHAPE);
    expect(payable).toMatchObject({ manualOnly: true, refusal: { code: 'NEEDS_UPDATE' } });
  });

  it('is not payable online when its payments part cannot be reached, and never falls back to keeping them', async () => {
    const payable = await resolvePayable(sources({ rows: { '42': invoice() }, shape: { version: 2, paymentsTable: null } }), SHAPE);
    expect(payable?.refusal?.code).toBe('NOT_PAYABLE');
  });

  it('is nothing when the row or the shape is gone', async () => {
    expect(await resolvePayable(sources({ rows: {} }), SHAPE)).toBeNull();
    expect(await resolvePayable(sources({ rows: { '42': invoice() }, shape: null }), SHAPE)).toBeNull();
  });

  it('falls back to the connection\'s currency, and refuses when there is none', async () => {
    expect((await resolvePayable(sources({ rows: { '42': invoice({ currency: null }) } }), SHAPE))?.currency).toBe('EUR');
    const none = await resolvePayable(sources({ rows: { '42': invoice({ currency: null }) }, connectionCurrency: async () => null }), SHAPE);
    expect(none?.refusal?.code).toBe('NO_CURRENCY');
  });
});

describe('an invoice made on the Invoices page', () => {
  it('needs an ISO currency before it can be paid (the page stores a symbol)', async () => {
    const payable = await resolvePayable(sources({ document: async () => ({ status: 'sent', number: 'INV-7', currency: null, totalMinor: 12000 }) }), DOC);
    expect(payable?.refusal?.code).toBe('NO_CURRENCY');
  });

  it('is payable once sent, its due the total less what Adminium holds', async () => {
    const payable = await resolvePayable(
      sources({ document: async () => ({ status: 'sent', number: 'INV-7', currency: 'EUR', totalMinor: 12000 }), keptPaid: async () => '50' }),
      DOC,
    );
    expect(payable).toMatchObject({ label: 'INV-7', total: '120.00', due: '70.00', refusal: null, recordInto: { kind: 'kept' } });
  });

  it('reads its total in hundredths whatever the currency, in the currency\'s decimals as the sheet prints it', async () => {
    const doc = (currency: string, totalMinor: number, status = 'sent') => sources({ document: async () => ({ status, number: 'INV-9', currency, totalMinor }) });
    expect(await resolvePayable(doc('JPY', 100000), DOC)).toMatchObject({ total: '1000', due: '1000', refusal: null });
    // ¥1,000.50 prints as ¥1,001 (rounded half up), and is due as that.
    expect(await resolvePayable(doc('JPY', 100050), DOC)).toMatchObject({ total: '1001', refusal: null });
    // The page never offers a currency with three decimals: such an invoice is not payable.
    expect((await resolvePayable(doc('KWD', 4525), DOC))?.refusal?.code).toBe('NOT_PAYABLE');
    expect((await resolvePayable(doc('EUR', 100, 'live'), DOC))?.refusal).toBeNull();
    expect((await resolvePayable(doc('EUR', 100, 'overdue'), DOC))?.refusal).toBeNull();
  });

  it('is refused as a draft, when marked paid, or when paid in full', async () => {
    const draft = await resolvePayable(sources({ document: async () => ({ status: 'draft', number: 'INV-8', currency: 'EUR', totalMinor: 100 }) }), DOC);
    expect(draft?.refusal?.code).toBe('NOT_SENT');
    const marked = await resolvePayable(sources({ document: async () => ({ status: 'paid', number: 'INV-8', currency: 'EUR', totalMinor: 100 }) }), DOC);
    expect(marked?.refusal?.code).toBe('NOTHING_DUE');
    const paid = await resolvePayable(sources({ document: async () => ({ status: 'sent', number: 'INV-8', currency: 'JPY', totalMinor: 50000 }), keptPaid: async () => '500' }), DOC);
    expect(paid).toMatchObject({ total: '500', due: '0', refusal: { code: 'NOTHING_DUE' } });
  });
});

describe('a marked table', () => {
  const mapping: ParsedPayableMapping = {
    label: 'order_no',
    amount: { column: 'total_cents', unit: 'minor' },
    currency: { fixed: 'EUR' },
    due: null,
    payments: { kind: 'kept' },
    status: null,
    customerEmail: 'email',
    customerCountry: 'country',
    pageFields: ['order_no'],
  };
  const PROFILE: PayableRef = { kind: 'profile', connectionId: 'conn_1', tableName: 'public.orders', rowKey: '7' };

  it('reads an amount kept in cents, and the customer\'s email and country', async () => {
    const payable = await resolvePayable(
      sources({
        profile: async () => ({ id: 'ppf_1', enabled: true, mapping }),
        rows: { '7': { id: 7, order_no: 'C-1042', total_cents: 3500, email: 'lena@example.com', country: ' de ' } },
      }),
      PROFILE,
    );
    expect(payable).toMatchObject({ label: 'C-1042', total: '35.00', due: '35.00', customerEmail: 'lena@example.com', customerCountry: 'DE', refusal: null });
  });

  it('names a currency column value that is no code, so the mapping can be put right', async () => {
    const byColumn: ParsedPayableMapping = { ...mapping, currency: { column: 'currency' } };
    const read = (currency: unknown) => resolvePayable(sources({ profile: async () => ({ id: 'ppf_1', enabled: true, mapping: byColumn }), rows: { '7': { id: 7, order_no: 'C-1042', total_cents: 3500, currency } } }), PROFILE);
    expect((await read('ORD-1001'))?.refusal).toEqual({ code: 'NO_CURRENCY', message: 'ORD-1001 is not a currency code.' });
    expect((await read(null))?.refusal).toEqual({ code: 'NO_CURRENCY', message: 'This record has no currency.' });
    expect((await read('  '))?.refusal).toEqual({ code: 'NO_CURRENCY', message: 'This record has no currency.' });
    expect((await read('eur'))?.refusal).toBeNull();
  });

  it('is not payable when switched off or when its mapping no longer reads', async () => {
    const off = await resolvePayable(sources({ profile: async () => ({ id: 'ppf_1', enabled: false, mapping }), rows: { '7': { id: 7, total_cents: 1 } } }), PROFILE);
    expect(off?.refusal?.code).toBe('NOT_PAYABLE');
    const broken = await resolvePayable(sources({ profile: async () => ({ id: 'ppf_1', enabled: true, mapping: null }), rows: { '7': { id: 7 } } }), PROFILE);
    expect(broken?.refusal?.code).toBe('NOT_PAYABLE');
  });
});

describe('money from a stored value', () => {
  it.each([
    ['120', 2, '120.00'],
    [120.5, 2, '120.50'],
    ['45.25', 3, '45.250'],
    ['12000', 0, '12000'],
    // A REAL column's 0.1 + 0.2: the float's noise lies past six places, so the amount is 0.30.
    [0.30000000000000004, 2, '0.30'],
    ['120.005', 2, null],
    ['10.0000004', 2, null],
    ['-1', 2, null],
    [null, 2, null],
  ] as const)('%s at %i places → %s', (value, scale, expected) => {
    expect(exactAmount(value, scale)).toBe(expected);
  });

  it('reads minor units exactly', () => {
    expect(fromMinorUnits(12000, 2)).toBe('120.00');
    expect(fromMinorUnits('5', 2)).toBe('0.05');
    expect(fromMinorUnits(12000, 0)).toBe('12000');
    expect(fromMinorUnits(1.5, 2)).toBeNull();
  });
});

describe('row keys', () => {
  const one = { primaryKey: ['id'], columns: new Map([['id', { logicalType: 'integer' }]]) } as never;
  const two = { primaryKey: ['shop', 'no'], columns: new Map([['shop', { logicalType: 'text' }], ['no', { logicalType: 'integer' }]]) } as never;
  it('round-trips one key and several, typed as the columns are', () => {
    expect(rowKeyOf(one, { id: 42 })).toBe('42');
    expect(pkOfRowKey(one, '42')).toEqual({ id: 42 });
    const key = rowKeyOf(two, { shop: 'berlin', no: 7 });
    expect(key).toBe('["berlin",7]');
    expect(pkOfRowKey(two, key)).toEqual({ shop: 'berlin', no: 7 });
    expect(pkOfRowKey(two, 'not json')).toBeNull();
  });
});
