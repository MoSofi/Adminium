// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A small add-on that answers a price question, and an app whose orders ask
 * it: what the price rule's checks are run against.
 */
import { ADD_ON_INSTALL_FLOOR } from '../src/index.js';

const pk = { ref: 'id', type: 'int', role: 'pk' };
const text = (ref: string, maxLength: number, extra: Record<string, unknown> = {}) => ({ ref, type: 'text', maxLength, ...extra });
const money = (ref: string, extra: Record<string, unknown> = {}) => ({ ref, type: 'money', scale: 2, ...extra });

export const ADJUSTER = {
  offers: [
    { as: 'offers', table: 'offers', by: [], where: [{ column: 'status', eq: 'live' }], limit: 500 },
    { as: 'rules', table: 'offer_rules', by: [{ column: 'offer_id', from: 'offers.id' }] },
    { as: 'typed', table: 'codes', by: [{ column: 'code', from: 'input.codes' }] },
  ],
  codes: { table: 'codes', column: 'code', where: [{ column: 'status', eq: 'active' }], reserved: ['GC', 'VC', 'PK'] },
  vouchers: { table: 'vouchers', column: 'code', prefixes: ['VC-', 'PK-'] },
  applied: {
    table: 'applied',
    source: { table: 'source_table', row: 'source_row', line: 'source_line' },
    columns: { offer: 'offer_id', code: 'code_id', voucher: 'voucher_id', name: 'name', kind: 'kind', amount: 'amount', reason: 'reason', typed: 'typed', at: 'applied_at' },
  },
  person: {
    groups: { table: 'group_members', member: 'member_key', group: 'group_id' },
    uses: { table: 'redemptions', customer: 'customer', offer: 'offer_id', state: 'state', counted: ['held', 'used'] },
    orders: true,
  },
  ceilings: { table: 'ceilings', role: 'role', maxPercent: 'max_percent', maxAmount: 'max_amount', comp: 'may_comp' },
  customerKey: 'hash',
};

export const OFFERS_KIT = {
  kind: 'add-on',
  manifestVersion: 1,
  key: 'offers-kit',
  name: 'Offers kit',
  version: '1.0.0',
  publisher: { id: 'adminium', name: 'Adminium' },
  license: 'MIT',
  description: { key: 'kit.description', fallback: 'Lowers prices.' },
  categories: ['data'],
  compatibility: { minAdminiumVersion: ADD_ON_INSTALL_FLOOR },
  addOn: {
    attaches: [{ app: '*', range: '*' }],
    connect: { kind: 'none' },
    provides: [{ contract: 'price-adjust', version: 1, server: 'dist/server.js' }],
    adjuster: ADJUSTER,
  },
  requiredSchema: {
    prefixed: true,
    tables: [
      { ref: 'offers', columns: [pk, text('name', 80), text('status', 20, { default: 'live' })] },
      { ref: 'offer_rules', columns: [pk, { ref: 'offer_id', type: 'fk', references: 'offers' }, { ref: 'percent', type: 'decimal', scale: 2, default: 0 }] },
      { ref: 'codes', columns: [pk, text('code', 40, { unique: true, rules: { normalize: 'code' } }), { ref: 'offer_id', type: 'fk', references: 'offers' }, text('status', 20, { default: 'active' })] },
      { ref: 'vouchers', columns: [pk, text('code', 24, { nullable: true, rules: { code: { length: 12 } } }), money('balance', { default: 0 })] },
      {
        ref: 'applied',
        columns: [
          pk,
          text('source_table', 128, { rules: { tableRef: true } }),
          text('source_row', 64),
          text('source_line', 64),
          { ref: 'offer_id', type: 'fk', references: 'offers', nullable: true },
          { ref: 'code_id', type: 'fk', references: 'codes', nullable: true },
          { ref: 'voucher_id', type: 'fk', references: 'vouchers', nullable: true },
          text('name', 200),
          text('kind', 20),
          money('amount'),
          text('reason', 200, { nullable: true }),
          { ref: 'typed', type: 'bool', default: false },
          { ref: 'applied_at', type: 'timestamptz' },
        ],
      },
      { ref: 'group_members', columns: [pk, text('member_key', 64), { ref: 'group_id', type: 'int' }] },
      { ref: 'redemptions', columns: [pk, text('customer', 64, { nullable: true }), { ref: 'offer_id', type: 'fk', references: 'offers', nullable: true }, text('state', 20)] },
      { ref: 'ceilings', columns: [pk, text('role', 80), { ref: 'max_percent', type: 'decimal', scale: 2, default: 0 }, money('max_amount', { default: 0 }), { ref: 'may_comp', type: 'bool', default: false }] },
    ],
  },
} as const;

/** The host's rule: lines in a child table, a staff reduction, typed codes, a proved customer, refunds. */
export const ADJUST = {
  by: { addOn: 'offers-kit' },
  needs: 'offers',
  lines: [
    {
      table: 'order_lines',
      via: 'order_id',
      price: 'unit_price',
      quantity: 'qty',
      discount: 'discount',
      what: [{ column: 'item_id', as: 'item' }, { column: 'tag', as: 'tag' }],
      excludes: { column: 'card_load', set: true },
      paidBy: { column: 'paid_by' },
      only: { column: 'kind', in: ['item', 'extra'] },
      unlessSet: 'voided_at',
    },
  ],
  order: {
    discount: 'discount',
    customer: { link: 'customer_id', address: 'email', proved: 'customer_proved', counts: { column: 'status', in: ['placed', 'paid'] } },
    staff: { kind: 'staff_kind', value: 'staff_value', reason: 'staff_reason', by: 'staff_by' },
    currency: { value: 'USD' },
  },
  codes: { table: 'order_codes', via: 'order_id', typed: 'typed', code: 'code_id', voucher: 'voucher_id', removed: 'removed_at' },
  frozen: { to: ['paid'] },
  expect: 'total',
  refunds: { table: 'refunds', via: 'order_id', amount: 'amount', tax: 'tax', of: 'total', taxOf: 'tax', against: 'payment_id', lines: { table: 'refund_lines', via: 'refund_id', line: 'line_id', quantity: 'qty' } },
};

const link = (table: string) => ({ addOnLink: { addOn: 'offers-kit', table } });

export const ADJUST_HOST = {
  kind: 'app',
  manifestVersion: 1,
  key: 'adjust-host',
  name: 'Adjust host',
  version: '0.3.0',
  publisher: { id: 'adminium', name: 'Adminium' },
  license: 'MIT',
  description: { key: 'host.description', fallback: 'Takes orders.' },
  categories: ['commerce'],
  compatibility: { minAdminiumVersion: ADD_ON_INSTALL_FLOOR },
  pages: [{ ref: 'orders', template: 'page-crud', title: { key: 't', fallback: 'Orders' }, nav: { group: 'manage', icon: 'list', order: 1 }, bindings: { main: 'orders' } }],
  frontends: [{ side: 'staff', kind: 'none' }],
  addOns: {
    suggests: [{ key: 'offers-kit', range: '>=1.0.0', reason: { 'en-US': 'Offers and codes.' } }],
    features: [{ id: 'offers', label: { 'en-US': 'Offers' }, requires: ['offers-kit'] }],
  },
  requiredSchema: {
    prefixed: true,
    tables: [
      { ref: 'customers', columns: [pk, text('email', 200, { nullable: true, rules: { personal: true } })] },
      { ref: 'items', columns: [pk, text('name', 80)] },
      { ref: 'payments', columns: [pk, { ref: 'order_id', type: 'fk', references: 'orders' }, money('amount')] },
      {
        ref: 'orders',
        adjust: ADJUST,
        states: { column: 'status', initial: 'placed', moves: { placed: ['paid', 'cancelled'] } },
        columns: [
          pk,
          { ref: 'status', type: 'enum', enum: ['placed', 'paid', 'cancelled'], default: 'placed' },
          { ref: 'customer_id', type: 'fk', references: 'customers', nullable: true },
          { ref: 'customer_proved', type: 'bool', nullable: true },
          money('subtotal', { default: 0, rules: { rollup: { from: 'order_lines', via: 'order_id', sum: 'amount' } } }),
          money('discount', { default: 0 }),
          money('net', { nullable: true, rules: { formula: { sub: ['subtotal', 'discount'] } } }),
          { ref: 'tax_rate', type: 'decimal', scale: 2, default: 0 },
          money('tax', { nullable: true, rules: { formula: { round: [{ div: [{ mul: ['net', 'tax_rate'] }, 100] }, 2] } } }),
          money('total', { nullable: true, rules: { formula: { add: ['net', 'tax'] } } }),
          { ref: 'staff_kind', type: 'enum', enum: ['none', 'percent', 'amount', 'comp'], default: 'none' },
          { ref: 'staff_value', type: 'decimal', scale: 2, nullable: true },
          text('staff_reason', 200, { nullable: true }),
          text('staff_by', 80, { nullable: true }),
        ],
      },
      {
        ref: 'order_lines',
        columns: [
          pk,
          { ref: 'order_id', type: 'fk', references: 'orders' },
          { ref: 'item_id', type: 'fk', references: 'items', nullable: true },
          text('tag', 40, { nullable: true }),
          text('kind', 20, { default: 'item' }),
          money('unit_price', { default: 0 }),
          { ref: 'qty', type: 'int', default: 1 },
          money('amount', { nullable: true, rules: { formula: { mul: ['unit_price', 'qty'] } } }),
          money('discount', { default: 0 }),
          { ref: 'card_load', type: 'timestamptz', nullable: true },
          { ref: 'paid_by', type: 'int', nullable: true, rules: link('vouchers') },
          { ref: 'voided_at', type: 'timestamptz', nullable: true },
        ],
      },
      {
        ref: 'order_codes',
        columns: [
          pk,
          { ref: 'order_id', type: 'fk', references: 'orders' },
          text('typed', 40, { nullable: true }),
          { ref: 'code_id', type: 'int', nullable: true, rules: link('codes') },
          { ref: 'voucher_id', type: 'int', nullable: true, rules: link('vouchers') },
          { ref: 'removed_at', type: 'timestamptz', nullable: true },
        ],
      },
      { ref: 'refunds', columns: [pk, { ref: 'order_id', type: 'fk', references: 'orders' }, { ref: 'payment_id', type: 'fk', references: 'payments', nullable: true }, money('amount', { nullable: true }), money('tax', { nullable: true })] },
      { ref: 'refund_lines', columns: [pk, { ref: 'refund_id', type: 'fk', references: 'refunds' }, { ref: 'line_id', type: 'fk', references: 'order_lines' }, { ref: 'qty', type: 'int', default: 1 }] },
    ],
  },
} as const;
