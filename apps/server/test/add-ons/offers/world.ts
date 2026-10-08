// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A SHOP THAT USES OFFERS, AS AN APP WOULD.
 *
 * The built add-on installed beside a small app whose tables spell out all
 * four of its shapes under the app's own names: orders that take discounts
 * and typed codes, payments a gift card may make, a line that loads a card
 * and one that sells a voucher, a refund that goes back to the card. What a
 * test saves goes through a real write service — the app's rules, the price
 * question, the postings, the add-on's own built file run in its bare
 * context — on each database.
 */
import { priceWorld } from '../../adjust.helpers.js';
import { saveWorld, type SaveWorld } from '../../adjust-save.helpers.js';
import type { Dialect } from '../../app-add-ons.helpers.js';
import { builtAddOn, type BuiltAddOn } from '../harness.js';

type Doc = Record<string, unknown>;

export const SHOP = 'shop';
export const OFFERS = 'offers';
/** The sample day of the add-on's own worked orders. */
export const TAX_RATE = 8;

const pk = { ref: 'id', type: 'int', role: 'pk' };
const text = (ref: string, maxLength: number, more: Doc = {}) => ({ ref, type: 'text', maxLength, ...more });
const money = (ref: string, more: Doc = {}) => ({ ref, type: 'money', scale: 'currency', ...more });
const fk = (ref: string, references: string, more: Doc = {}) => ({ ref, type: 'fk', references, ...more });
const link = (ref: string, table: string, rules: Doc = {}) => ({ ref, type: 'int', nullable: true, rules: { addOnLink: { addOn: OFFERS, table }, ...rules } });
const into = (action: string) => ({ addOn: OFFERS, ledger: 'value', action });

/** The app: customers, things, orders with their lines, typed codes, payments and refunds. */
export function shopManifest(): Doc {
  return {
    kind: 'app',
    manifestVersion: 1,
    key: SHOP,
    name: 'Shop',
    version: '1.0.0',
    publisher: { id: 'adminium', name: 'Adminium', url: 'https://adminium.dev' },
    license: 'AGPL-3.0-only',
    description: { key: 'mft.shop.desc', fallback: 'A shop that takes offers and gift cards.' },
    categories: ['operations'],
    compatibility: { minAdminiumVersion: '0.3.18', engines: ['postgres', 'mysql', 'sqlite'] },
    pages: [{ ref: 'shop-orders', template: 'page-crud', title: { key: 'mft.shop.page.orders', fallback: 'Orders' }, nav: { group: 'manage', icon: 'list', order: 1 }, bindings: { main: 'orders' } }],
    frontends: [{ side: 'staff', kind: 'none' }],
    addOns: {
      suggests: [{ key: OFFERS, range: '>=1.0.0', reason: { 'en-US': 'Discounts, codes, vouchers and gift cards.' } }],
      features: [{ id: 'offers', label: { 'en-US': 'Offers and gift cards' }, requires: [OFFERS] }],
    },
    requiredSchema: {
      prefixed: true,
      tables: [
        { ref: 'customers', columns: [pk, text('name', 80, { nullable: true }), text('email', 200, { nullable: true, rules: { personal: true } })] },
        { ref: 'items', columns: [pk, text('name', 80), money('price', { default: 0 }), text('tag', 40, { nullable: true })] },
        {
          ref: 'orders',
          // discountable@1, part `order`.
          adjust: {
            by: { addOn: OFFERS },
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
                  { column: 'tag', as: 'tag' },
                ],
                excludes: { column: 'gift_card_id', set: true },
                paidBy: { column: 'sold_voucher_id' },
              },
            ],
            order: {
              discount: 'discount',
              customer: { link: 'customer_id', address: 'email', proved: 'customer_proved', counts: { column: 'status', in: ['paid'] } },
              staff: { kind: 'discount_kind', value: 'discount_value', reason: 'discount_reason', by: 'discount_by' },
              currency: { value: 'USD' },
            },
            codes: { table: 'order_codes', via: 'order_id', typed: 'typed', code: 'code_id', voucher: 'voucher_id', removed: 'removed_at' },
            uses: 'uses',
            frozen: { to: ['paid', 'cancelled'] },
            expect: 'total',
          },
          postings: [{ id: 'uses', into: into('redeem'), post: { on: { to: ['paid'] } }, reverse: { on: { to: ['cancelled'], from: ['paid'] } }, map: { reason: 'discount_reason', label: 'note' } }],
          states: { column: 'status', initial: 'open', moves: { open: ['paid', 'cancelled'], paid: ['cancelled'] } },
          columns: [
            pk,
            { ref: 'status', type: 'enum', enum: ['open', 'paid', 'cancelled'], default: 'open' },
            fk('customer_id', 'customers', { nullable: true }),
            { ref: 'customer_proved', type: 'bool', nullable: true },
            text('note', 80, { nullable: true }),
            money('subtotal', { default: 0, rules: { rollup: { from: 'order_lines', via: 'order_id', sum: 'amount' } } }),
            money('discount', { default: 0 }),
            money('net', { nullable: true, rules: { formula: { sub: ['subtotal', 'discount'] } } }),
            // What tax is charged on: the goods, never value loaded on a card.
            money('loads', { default: 0, rules: { rollup: { from: 'order_lines', via: 'order_id', sum: 'load' } } }),
            { ref: 'tax_rate', type: 'decimal', scale: 2, default: TAX_RATE },
            money('tax', { nullable: true, rules: { formula: { round: [{ div: [{ mul: [{ sub: ['net', 'loads'] }, 'tax_rate'] }, 100] }, 2] } } }),
            money('total', { nullable: true, rules: { formula: { add: ['net', 'tax'] } } }),
            money('paid', { default: 0, rules: { rollup: { from: 'payments', via: 'order_id', sum: 'amount', unlessSet: 'voided_at', cap: true, balance: { column: 'due', of: 'total' } } } }),
            money('due', { default: 0 }),
            { ref: 'discount_kind', type: 'enum', enum: ['percent', 'amount', 'comp'], nullable: true },
            { ref: 'discount_value', type: 'decimal', scale: 3, nullable: true },
            link('discount_reason', 'reasons'),
            text('discount_by', 120, { nullable: true }),
          ],
        },
        {
          ref: 'order_lines',
          // discountable@1 `lines`, card-sale@1 `lines` and voucher-sale@1 `lines`, in one table.
          postings: [
            { id: 'card-load', into: into('issue'), via: 'order_id', post: { on: { to: ['paid'] } }, reverse: { on: { to: ['cancelled'], from: ['paid'] } }, map: { card: 'gift_card_id', amount: 'unit_price', label: 'label' } },
            { id: 'voucher-sold', into: into('sell'), via: 'order_id', post: { on: { to: ['paid'] } }, reverse: { on: { to: ['cancelled'], from: ['paid'] } }, map: { voucher: 'sold_voucher_id', amount: 'amount', tax_later: 'tax_later' } },
          ],
          columns: [
            pk,
            fk('order_id', 'orders'),
            fk('item_id', 'items', { nullable: true }),
            text('tag', 40, { nullable: true }),
            text('label', 80, { nullable: true }),
            money('unit_price', { default: 0, rules: { validation: { min: 0, max: 100000 } } }),
            { ref: 'qty', type: 'int', default: 1, rules: { validation: { min: 0, max: 1000 } } },
            money('amount', { nullable: true, rules: { formula: { mul: ['unit_price', 'qty'] } } }),
            money('discount', { default: 0 }),
            link('gift_card_id', 'gift_cards'),
            // What a line that loads a card puts on it: its amount, where it names a card; nothing otherwise.
            money('load', { nullable: true, rules: { formula: { if: [{ isNull: 'gift_card_id' }, 0, { mul: ['unit_price', 'qty'] }] } } }),
            link('sold_voucher_id', 'vouchers'),
            { ref: 'tax_later', type: 'bool', default: false, nullable: true },
          ],
        },
        {
          ref: 'order_codes',
          columns: [pk, fk('order_id', 'orders'), text('typed', 64, { nullable: true }), link('code_id', 'codes'), link('voucher_id', 'vouchers'), { ref: 'removed_at', type: 'timestamptz', nullable: true }],
        },
        {
          ref: 'payments',
          // card-payment@1, part `payments`: cash rows beside card rows.
          postings: [
            {
              id: 'card',
              into: into('spend'),
              via: 'order_id',
              // Cash rows are no card's business: without this, an order that loads a card could not be paid in cash either
              // (the rule below refuses EVERY row this posting is handed).
              only: { column: 'method', eq: 'gift_card' },
              post: { on: { create: true } },
              reverse: { on: { column: 'voided_at', set: true, own: true } },
              heldUntil: 'held_until',
              map: { card: 'card_id', due: { parent: 'due' }, ask: 'asked', amount: 'amount', balance_after: 'card_balance_after', label: 'note' },
              refuses: [{ table: 'order_lines', via: 'order_id', column: 'gift_card_id', set: true }],
            },
          ],
          columns: [
            pk,
            fk('order_id', 'orders'),
            { ref: 'method', type: 'enum', enum: ['cash', 'gift_card'], default: 'cash' },
            text('note', 80, { nullable: true }),
            text('card_code', 64, { nullable: true }),
            link('card_id', 'gift_cards', { lookup: { from: 'card_code', table: { addOn: OFFERS, table: 'gift_cards' }, column: 'code', where: [{ column: 'status', eq: 'active' }] } }),
            // A payment of exactly so much, where the customer says how much the card is to pay.
            money('asked', { nullable: true }),
            money('amount', { default: 0 }),
            money('card_balance_after', { nullable: true }),
            { ref: 'held_until', type: 'timestamptz', nullable: true },
            { ref: 'voided_at', type: 'timestamptz', nullable: true },
          ],
        },
        {
          ref: 'refunds',
          postings: [{ id: 'card-refund', into: into('refund'), post: { on: { create: true } }, map: { against_table: { value: 'shop:payments' }, against_row: 'payment_id', amount: 'amount', label: 'note' } }],
          columns: [pk, fk('order_id', 'orders'), fk('payment_id', 'payments'), text('note', 80, { nullable: true }), money('amount', { default: 0 })],
        },
      ],
    },
  };
}

export const offers: BuiltAddOn | null = builtAddOn(OFFERS);

export interface OffersWorld extends SaveWorld {
  /** One of the add-on's rows by its key, as the database holds it now. */
  row(table: string, id: unknown): Promise<Doc>;
  /** Every row of one of the add-on's tables, oldest first. */
  all(table: string, where?: string): Promise<Doc[]>;
  /** A gift card made active with value on it, by a manager's hand; answers its key and its code. */
  card(amount: string, more?: Doc): Promise<{ id: number; code: string }>;
}

/** The shop and the built add-on installed side by side; the add-on's tables go by `offers_<name>`, the shop's by `shop_<name>`. */
export async function offersWorld(dialect: Dialect): Promise<OffersWorld> {
  if (offers === null) throw new Error('Offers is not built: set ADMINIUM_ADD_ONS_REPO and run `npm run build` in packages/offers');
  const server = offers.files['dist/server.js']!;
  const w = saveWorld(await priceWorld(dialect, { market: shopManifest(), app: SHOP, noThings: true, kit: offers.manifest, addOn: { key: OFFERS, files: offers.files, server } }));
  const all: OffersWorld['all'] = (table, where) => w.rows(`SELECT * FROM ${table}${where === undefined ? '' : ` WHERE ${where}`} ORDER BY id`);
  const row: OffersWorld['row'] = async (table, id) => {
    const [found] = await all(table, `id = ${String(id)}`);
    if (found === undefined) throw new Error(`no row ${String(id)} in ${table}`);
    return found;
  };
  return {
    ...w,
    all,
    row,
    async card(amount, more = {}) {
      const made = await w.tree({ table: 'offers_gift_cards', values: more, lists: { actions: { table: 'offers_card_actions', via: 'card_id', rows: [{ action: 'issue', amount, reason: 'Sold at the desk', paid_by: 'cash' }] } } });
      const id = Number(made.root['id']);
      return { id, code: String((await row('offers_gift_cards', id))['code']) };
    },
  };
}

export const money2 = (value: unknown): string => (value === null || value === undefined ? 'null' : Number(value).toFixed(2));
