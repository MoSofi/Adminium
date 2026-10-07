// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The test price add-on, as a package: its manifest, the file that decides
 * (`dist/server.js`, a classic script exactly as an add-on ships one), and the
 * shop whose orders ask it. One fixture for every test of the price question.
 *
 * The add-on keeps offers, discount codes, vouchers, what staff may give by
 * hand, and the rows that say what was applied to an order. The shop keeps
 * customers, things to sell, orders with their lines, and the codes typed on
 * an order.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

type Doc = Record<string, unknown>;

export const PRICE_KIT = 'price-kit';
export const MARKET = 'market';

/** The deciding file's bytes. */
export const PRICE_KIT_SERVER = readFileSync(join(import.meta.dirname, 'dist', 'server.js'));

const pk = { ref: 'id', type: 'int', role: 'pk' };
const text = (ref: string, maxLength: number, extra: Doc = {}): Doc => ({ ref, type: 'text', maxLength, ...extra });
const money = (ref: string, extra: Doc = {}): Doc => ({ ref, type: 'money', scale: 2, ...extra });
const fk = (ref: string, references: string, extra: Doc = {}): Doc => ({ ref, type: 'fk', references, ...extra });

/** What the add-on reads to answer, and where it keeps what it keeps. */
export const PRICE_ADJUSTER = {
  offers: [
    // Only the offers that are on: staff asking why an offer does not apply are shown the others too.
    { as: 'offers', table: 'offers', by: [], where: [{ column: 'status', eq: 'active' }], limit: 200 },
    { as: 'typed', table: 'codes', by: [{ column: 'id', from: 'input.codes' }] },
  ],
  codes: { table: 'codes', column: 'code', where: [{ column: 'active', eq: true }], reserved: ['GC', 'VC', 'PK'] },
  vouchers: { table: 'vouchers', column: 'code', prefixes: ['VC-', 'PK-'] },
  applied: {
    table: 'applied',
    source: { table: 'source_table', row: 'source_row', line: 'source_line' },
    columns: { offer: 'offer_id', code: 'code_id', voucher: 'voucher_id', name: 'name', kind: 'kind', amount: 'amount', reason: 'reason', typed: 'typed', at: 'applied_at' },
  },
  person: {
    groups: { table: 'group_members', member: 'member_key', group: 'group_id' },
    uses: { table: 'redemptions', customer: 'customer', offer: 'offer_id', state: 'state', counted: ['held', 'counted'] },
    orders: true,
  },
  ceilings: { table: 'ceilings', role: 'role', maxPercent: 'max_percent', maxAmount: 'max_amount', comp: 'may_comp' },
  customerKey: 'hash',
};

/** The add-on's manifest, version 1.0.0. */
export function priceKitManifest(over: Doc = {}): Doc {
  return {
    kind: 'add-on',
    manifestVersion: 1,
    key: PRICE_KIT,
    name: 'Price kit',
    version: '1.0.0',
    publisher: { id: 'adminium', name: 'Adminium' },
    license: 'MIT',
    description: { key: 'kit.description', fallback: 'Lowers prices.' },
    categories: ['data'],
    compatibility: { minAdminiumVersion: '0.3.18' },
    addOn: {
      attaches: [{ app: '*', range: '*' }],
      connect: { kind: 'none' },
      hostApi: 1,
      provides: [{ contract: 'price-adjust', version: 1, server: 'dist/server.js' }],
      adjuster: PRICE_ADJUSTER,
      settingsTable: 'settings',
    },
    requiredSchema: {
      prefixed: true,
      tables: [
        {
          ref: 'offers',
          columns: [
            pk,
            text('name', 80),
            { ref: 'public_name', type: 'json', nullable: true },
            { ref: 'status', type: 'enum', enum: ['draft', 'active', 'paused', 'ended'], default: 'active' },
            { ref: 'kind', type: 'enum', enum: ['percent', 'amount', 'bonus_item'], default: 'percent' },
            { ref: 'value', type: 'decimal', scale: 2, default: 0 },
            { ref: 'trigger', type: 'enum', enum: ['auto', 'code'], default: 'auto' },
            { ref: 'scope', type: 'enum', enum: ['order', 'lines'], default: 'order' },
            text('target_as', 20, { nullable: true }),
            text('target_table', 128, { nullable: true }),
            text('target_row', 64, { nullable: true }),
            { ref: 'buy_qty', type: 'int', nullable: true },
            money('min_spend', { nullable: true }),
            { ref: 'max_uses', type: 'int', nullable: true },
            { ref: 'uses', type: 'int', default: 0 },
            { ref: 'max_per_customer', type: 'int', nullable: true },
            { ref: 'first_order_only', type: 'bool', default: false },
            { ref: 'group_id', type: 'int', nullable: true },
            text('weekdays', 20, { nullable: true }),
            { ref: 'starts_on', type: 'date', nullable: true },
            { ref: 'ends_on', type: 'date', nullable: true },
            { ref: 'combinable', type: 'bool', default: true },
          ],
        },
        {
          ref: 'codes',
          columns: [
            pk,
            text('code', 40, { unique: true, rules: { normalize: 'code' } }),
            fk('offer_id', 'offers'),
            { ref: 'active', type: 'bool', default: true },
            { ref: 'max_uses', type: 'int', nullable: true },
            { ref: 'uses', type: 'int', default: 0 },
            { ref: 'valid_until', type: 'date', nullable: true },
          ],
        },
        {
          ref: 'vouchers',
          columns: [
            pk,
            // Stored bare: a voucher's word (`VC-`, `PK-`) only says where to look.
            text('code', 24, { nullable: true, rules: { code: { length: 12 } } }),
            { ref: 'worth', type: 'enum', enum: ['amount', 'thing', 'pack'], default: 'amount' },
            money('value', { nullable: true }),
            text('what_table', 128, { nullable: true }),
            text('what_row', 64, { nullable: true }),
            { ref: 'units', type: 'int', default: 1 },
            { ref: 'uses_left', type: 'int', default: 1 },
            { ref: 'status', type: 'enum', enum: ['issued', 'voided', 'expired'], default: 'issued' },
            { ref: 'expires_on', type: 'date', nullable: true },
            text('holder_key', 64, { nullable: true }),
            text('public_name', 80, { nullable: true }),
          ],
        },
        {
          ref: 'applied',
          columns: [
            pk,
            text('source_table', 128, { rules: { tableRef: true } }),
            text('source_row', 64),
            text('source_line', 64),
            fk('offer_id', 'offers', { nullable: true }),
            fk('code_id', 'codes', { nullable: true }),
            fk('voucher_id', 'vouchers', { nullable: true }),
            // The name in every language it has, as it was when it was applied.
            { ref: 'name', type: 'json' },
            text('kind', 20),
            money('amount'),
            text('reason', 200, { nullable: true }),
            { ref: 'typed', type: 'bool', default: false },
            { ref: 'applied_at', type: 'timestamptz' },
          ],
        },
        { ref: 'group_members', columns: [pk, text('member_key', 64), { ref: 'group_id', type: 'int' }] },
        {
          ref: 'redemptions',
          columns: [
            pk,
            text('customer', 64, { nullable: true }),
            fk('offer_id', 'offers', { nullable: true }),
            fk('code_id', 'codes', { nullable: true }),
            fk('voucher_id', 'vouchers', { nullable: true }),
            text('state', 20, { default: 'counted' }),
            money('amount', { default: 0 }),
            text('source_table', 128, { nullable: true, rules: { tableRef: true } }),
            text('source_row', 64, { nullable: true }),
          ],
        },
        {
          ref: 'ceilings',
          columns: [pk, text('role', 80), { ref: 'max_percent', type: 'decimal', scale: 2, default: 0 }, money('max_amount', { nullable: true }), { ref: 'may_comp', type: 'bool', default: false }],
        },
        // One row: how the deciding file is told to misbehave.
        { ref: 'settings', columns: [pk, text('misbehave', 40, { nullable: true })] },
      ],
    },
    ...over,
  };
}

const link = (table: string) => ({ addOnLink: { addOn: PRICE_KIT, table } });

/** The shop's price rule: lines in a child table, a reduction staff give by hand, typed codes, a proved customer. */
export const MARKET_ADJUST = {
  by: { addOn: PRICE_KIT },
  needs: 'offers',
  lines: [
    {
      table: 'order_lines',
      via: 'order_id',
      price: 'unit_price',
      quantity: 'qty',
      discount: 'discount',
      what: [
        { column: 'item_id', as: 'item' },
        { column: 'category_id', as: 'category' },
        { column: 'tag', as: 'tag' },
      ],
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
};

/** The shop's rule with a second kind of line: what an order is charged by the night. */
export const WIDE_ADJUST = {
  ...MARKET_ADJUST,
  lines: [...MARKET_ADJUST.lines, { table: 'order_extras', via: 'order_id', price: 'rate', quantity: 'nights', discount: 'discount', what: [{ column: 'tag', as: 'tag' }] }],
};

/**
 * The shop whose orders ask the price kit. `uncapped`: what is paid may pass
 * what is owed — a table that feeds a balance kept at zero or more takes its
 * rows one at a time for that reason alone, which a test of another reason
 * must not meet first. `wide`: the totals a price can move beyond the order's
 * own reduction — a line's net added up on its order, an order's total on its
 * customer — and rows charged by the night, whose nights follow the order's.
 */
export function marketManifest(over: Doc = {}, adjust: Doc | null = MARKET_ADJUST, options: { uncapped?: boolean; wide?: boolean } = {}): Doc {
  const wide = options.wide === true;
  return {
    kind: 'app',
    manifestVersion: 1,
    key: MARKET,
    name: 'Market',
    version: '1.0.0',
    publisher: { id: 'adminium', name: 'Adminium', url: 'https://adminium.dev' },
    license: 'AGPL-3.0-only',
    description: { key: 'mft.market.desc', fallback: 'A shop.' },
    categories: ['operations'],
    compatibility: { minAdminiumVersion: '0.3.18', engines: ['postgres', 'mysql', 'sqlite'] },
    pages: [{ ref: 'market-orders', template: 'page-crud', title: { key: 'mft.market.page.orders', fallback: 'Orders' }, nav: { group: 'manage', icon: 'list', order: 1 }, bindings: { main: 'orders' } }],
    frontends: [{ side: 'staff', kind: 'none' }],
    addOns: {
      suggests: [{ key: PRICE_KIT, range: '>=1.0.0', reason: { 'en-US': 'Offers and codes.' } }],
      features: [{ id: 'offers', label: { 'en-US': 'Offers' }, requires: [PRICE_KIT] }],
    },
    requiredSchema: {
      prefixed: true,
      tables: [
        {
          ref: 'customers',
          columns: [pk, text('name', 80, { nullable: true }), text('email', 200, { nullable: true, rules: { personal: true } }), ...(wide ? [money('spent', { default: 0, rules: { rollup: { from: 'orders', via: 'customer_id', sum: 'total' } } })] : [])],
        },
        { ref: 'categories', columns: [pk, text('name', 80)] },
        { ref: 'items', columns: [pk, text('name', 80), fk('category_id', 'categories', { nullable: true }), money('price', { default: 0 })] },
        {
          ref: 'orders',
          ...(adjust === null ? {} : { adjust }),
          states: { column: 'status', initial: 'open', moves: { open: ['placed', 'cancelled'], placed: ['paid', 'cancelled'] } },
          columns: [
            pk,
            { ref: 'status', type: 'enum', enum: ['open', 'placed', 'paid', 'cancelled'], default: 'open' },
            fk('customer_id', 'customers', { nullable: true }),
            { ref: 'customer_proved', type: 'bool', nullable: true },
            text('note', 200, { nullable: true }),
            money('subtotal', { default: 0, rules: { rollup: { from: 'order_lines', via: 'order_id', sum: 'amount' } } }),
            money('discount', { default: 0 }),
            ...(wide
              ? [
                  { ref: 'nights', type: 'int', default: 1 },
                  money('extras', { default: 0, rules: { rollup: { from: 'order_extras', via: 'order_id', sum: 'amount' } } }),
                  money('lines_net', { default: 0, rules: { rollup: { from: 'order_lines', via: 'order_id', sum: 'net' } } }),
                ]
              : []),
            money('net', { nullable: true, rules: { formula: { sub: [wide ? { add: ['subtotal', 'extras'] } : 'subtotal', 'discount'] } } }),
            { ref: 'tax_rate', type: 'decimal', scale: 2, default: 8 },
            money('tax', { nullable: true, rules: { formula: { round: [{ div: [{ mul: ['net', 'tax_rate'] }, 100] }, 2] } } }),
            money('total', { nullable: true, rules: { formula: { add: ['net', 'tax'] } } }),
            // What was paid, and what is still to pay: never less than nothing.
            money('paid', { default: 0, rules: { rollup: { from: 'payments', via: 'order_id', sum: 'amount', ...(options.uncapped === true ? {} : { cap: true }), balance: { column: 'due', of: 'total' } } } }),
            money('due', { default: 0 }),
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
            fk('order_id', 'orders'),
            fk('item_id', 'items', { nullable: true }),
            fk('category_id', 'categories', { nullable: true }),
            text('tag', 40, { nullable: true }),
            text('kind', 20, { default: 'item' }),
            money('unit_price', { default: 0 }),
            { ref: 'qty', type: 'int', default: 1 },
            money('amount', { nullable: true, rules: { formula: { mul: ['unit_price', 'qty'] } } }),
            money('discount', { default: 0 }),
            ...(wide ? [money('net', { nullable: true, rules: { formula: { sub: ['amount', 'discount'] } } })] : []),
            { ref: 'card_load', type: 'timestamptz', nullable: true },
            { ref: 'paid_by', type: 'int', nullable: true, rules: link('vouchers') },
            { ref: 'voided_at', type: 'timestamptz', nullable: true },
            // What the kitchen is told: nothing the price reads.
            text('note', 200, { nullable: true }),
          ],
        },
        { ref: 'payments', columns: [pk, fk('order_id', 'orders'), text('method', 20, { default: 'cash' }), money('amount', { default: 0 })] },
        ...(wide
          ? [
              {
                ref: 'order_extras',
                columns: [
                  pk,
                  fk('order_id', 'orders'),
                  text('tag', 40, { nullable: true }),
                  money('rate', { default: 0 }),
                  { ref: 'nights', type: 'int', nullable: true, rules: { copy: { via: 'order_id', from: 'nights', mode: 'always', follow: true } } },
                  money('amount', { nullable: true, rules: { formula: { mul: ['rate', 'nights'] } } }),
                  money('discount', { default: 0 }),
                ],
              },
            ]
          : []),
        {
          ref: 'order_codes',
          columns: [
            pk,
            fk('order_id', 'orders'),
            text('typed', 40, { nullable: true }),
            { ref: 'code_id', type: 'int', nullable: true, rules: link('codes') },
            { ref: 'voucher_id', type: 'int', nullable: true, rules: link('vouchers') },
            { ref: 'removed_at', type: 'timestamptz', nullable: true },
          ],
        },
      ],
    },
    ...over,
  };
}

/** The package an install takes: the manifest and the file that decides. */
export function priceKitFiles(manifest: Doc = priceKitManifest()): Record<string, string> {
  return { 'manifest.json': JSON.stringify(manifest), 'dist/server.js': PRICE_KIT_SERVER.toString('utf8') };
}

/** The things the shop sells, by name: the prices every worked figure starts from. */
export const PRICES = {
  'Mug, speckled': '14.00',
  'Mug, white': '12.00',
  'Canvas tote, natural': '15.00',
  'Canvas tote, black': '16.00',
  'Notebook, A5': '6.50',
  'Greeting card': '3.50',
  'Candle, fig': '18.00',
} as const;
export type Item = keyof typeof PRICES;

/** Which category each thing is in. */
export const CATEGORY: Readonly<Record<Item, string>> = {
  'Mug, speckled': 'Mugs',
  'Mug, white': 'Mugs',
  'Canvas tote, natural': 'Bags',
  'Canvas tote, black': 'Bags',
  'Notebook, A5': 'Paper',
  'Greeting card': 'Paper',
  'Candle, fig': 'Home',
};
