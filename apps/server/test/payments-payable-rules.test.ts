// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Marking a table payable: every problem with a mapping is found before it is
 * saved, each beside the field it is about.
 */
import { payableMappingSchema, type PayableMapping } from '@adminium/meta';
import { describe, expect, it } from 'vitest';

import { payableIssues, type PayableRulesInput } from '../src/payments/payable-rules.js';

type Col = Record<string, unknown> & { name: string; logicalType: string };

function column(name: string, logicalType: string, extra: Record<string, unknown> = {}): Col {
  return { name, logicalType, isPrimaryKey: false, isUnique: false, isGenerated: false, references: null, nullable: true, semantics: { flags: { pii: null, secret: false, maskedByDefault: false } }, ...extra };
}

const orders = {
  id: 'public.orders',
  name: 'orders',
  indexes: [],
  columns: [
    column('id', 'integer', { isPrimaryKey: true }),
    column('number', 'text'),
    column('total', 'decimal', { numericScale: 2 }),
    column('total_cents', 'integer'),
    column('price_rough', 'float'),
    column('due', 'decimal', { numericScale: 2 }),
    column('currency', 'text'),
    column('status', 'enum', { enumRef: 'order_status' }),
    column('note', 'text'),
    column('code', 'text', { sequence: { prefix: 'ORD-' } }),
    column('customer_id', 'integer', { references: { table: 'public.customers', column: 'id' } }),
    column('email', 'text', { semantics: { flags: { pii: 'email', secret: false, maskedByDefault: true } } }),
    column('country', 'text'),
    column('jpy_total', 'decimal', { numericScale: 0 }),
  ],
};

const deposits = {
  id: 'public.deposits',
  name: 'deposits',
  indexes: [{ name: 'deposits_ref_key', columns: ['ref'], unique: true, partial: false }],
  columns: [
    column('id', 'integer', { isPrimaryKey: true }),
    column('order_id', 'integer', { references: { table: 'public.orders', column: 'id' } }),
    column('amount', 'decimal', { numericScale: 2 }),
    column('paid_on', 'date'),
    column('way', 'text'),
    column('ref', 'text'),
    column('loose_ref', 'text'),
  ],
};

const model = {
  tables: [orders, deposits, { ...orders, id: 'public.secrets', name: 'secrets', private: true }],
  enums: [{ id: 'order_status', name: 'order_status', values: ['open', 'paid', 'refunded'] }],
} as unknown as PayableRulesInput['model'];

const base: PayableMapping = {
  label: 'number',
  amount: { column: 'total', unit: null },
  currency: { column: 'currency' },
  due: null,
  payments: { kind: 'kept' },
  status: null,
  customerEmail: 'email',
  customerCountry: 'country',
  pageFields: ['number', 'note'],
};

const issues = (mapping: Partial<PayableMapping>, extra: Partial<PayableRulesInput> = {}) =>
  payableIssues({ model, tableId: 'public.orders', mapping: payableMappingSchema.parse({ ...base, ...mapping }), connectionCurrency: 'EUR', ...extra }).map((one) => `${one.code} ${one.path}`);

describe('marking a table payable', () => {
  it('takes a plain mapping with payments kept by Adminium', () => {
    expect(issues({})).toEqual([]);
  });

  it('refuses a private table', () => {
    expect(payableIssues({ model, tableId: 'public.secrets', mapping: payableMappingSchema.parse(base), connectionCurrency: 'EUR' }).map((one) => one.code)).toEqual(['TABLE_UNAVAILABLE']);
  });

  it('refuses a float amount, and asks an integer amount for its unit', () => {
    expect(issues({ amount: { column: 'price_rough', unit: null } })).toEqual(['NOT_A_MONEY_COLUMN amount']);
    expect(issues({ amount: { column: 'total_cents', unit: null } })).toEqual(['NEEDS_UNIT amount.unit']);
    expect(issues({ amount: { column: 'total_cents', unit: 'minor' } })).toEqual([]);
  });

  it('refuses a decimal column with fewer places than the currency', () => {
    expect(issues({ amount: { column: 'jpy_total', unit: null }, currency: { fixed: 'EUR' } })).toEqual(['TOO_FEW_DECIMALS amount']);
    expect(issues({ amount: { column: 'jpy_total', unit: null }, currency: { fixed: 'JPY' } })).toEqual([]);
  });

  it('needs the connection currency when told to use it', () => {
    expect(issues({ currency: { connection: true } }, { connectionCurrency: null })).toEqual(['NO_CURRENCY currency']);
    expect(issues({ currency: { connection: true } })).toEqual([]);
  });

  it('names a missing column beside its field', () => {
    expect(issues({ label: 'nope' })).toEqual(['NO_SUCH_COLUMN label']);
  });

  describe('payments that land in the table own payments table', () => {
    const own = (reference: string) => ({
      due: { column: 'due' },
      payments: { kind: 'table' as const, table: 'public.deposits', link: 'order_id', amount: 'amount', date: 'paid_on', method: { column: 'way', values: { card: 'Card' } }, note: null, voided: null, reference, amountUnit: 'units' as const },
    });

    it('takes a unique reference column', () => {
      expect(issues(own('ref'))).toEqual([]);
    });

    it('refuses a reference column that is not unique', () => {
      expect(issues(own('loose_ref'))).toEqual(['REFERENCE_NOT_UNIQUE payments.reference']);
    });

    it('refuses an empty way-to-pay value map', () => {
      const mapping = own('ref');
      expect(issues({ ...mapping, payments: { ...mapping.payments, method: { column: 'way', values: {} } } })).toEqual(['NO_METHOD_VALUES payments.method.values']);
    });
  });

  describe('the status Adminium may set', () => {
    it('takes an enum with the paid and refunded values', () => {
      expect(issues({ status: { column: 'status', paid: 'paid', refunded: 'refunded' } })).toEqual([]);
    });

    it('refuses a value the column does not have', () => {
      expect(issues({ status: { column: 'status', paid: 'settled', refunded: null } })).toEqual(['STATUS_VALUE_UNKNOWN status.paid']);
    });

    it('refuses a key, a link, a decided or a personal column', () => {
      expect(issues({ status: { column: 'id', paid: 'x', refunded: null } })).toEqual(['STATUS_NOT_WRITABLE status']);
      expect(issues({ status: { column: 'customer_id', paid: 'x', refunded: null } })).toEqual(['STATUS_NOT_WRITABLE status']);
      expect(issues({ status: { column: 'code', paid: 'x', refunded: null } })).toEqual(['STATUS_NOT_WRITABLE status']);
      expect(issues({ status: { column: 'email', paid: 'x', refunded: null } })).toEqual(['STATUS_NOT_WRITABLE status']);
    });

    it('refuses free text with no value list', () => {
      expect(issues({ status: { column: 'note', paid: 'paid', refunded: null } })).toEqual(['STATUS_NOT_A_CHOICE status']);
    });
  });

  it('never lets the pay page show a personal column', () => {
    expect(issues({ pageFields: ['number', 'email'] })).toEqual(['FIELD_PERSONAL pageFields']);
  });
});
