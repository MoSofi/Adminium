// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The price question's words as one manifest can check them: the host's
 * `adjust` on an order's table, the add-on's `adjuster`, and what the rule
 * makes Adminium's own.
 */
import { describe, expect, it } from 'vitest';

import { adjustDecidedColumns, adjustSchema, adjusterOf, adjusterSchema, installFloorWords, validateManifest, type Adjust, type Manifest } from '../src/index.js';
import { ADJUST, ADJUSTER, ADJUST_HOST, OFFERS_KIT } from './adjust-fixture.js';

type Doc = Record<string, unknown>;
interface TableDoc {
  ref: string;
  columns: Doc[];
  [key: string]: unknown;
}

const issuesOf = (doc: unknown): string[] => {
  const result = validateManifest(doc);
  return result.ok ? [] : result.issues.map((issue) => `${issue.path}: ${issue.message}`);
};

/** The host with its rule changed, a table changed, or anything at the top. */
function host(over: { adjust?: Doc; table?: [string, (table: TableDoc) => TableDoc]; top?: Doc } = {}): Doc {
  const doc = structuredClone(ADJUST_HOST) as unknown as { requiredSchema: { tables: TableDoc[] } };
  doc.requiredSchema.tables = doc.requiredSchema.tables.map((table) => {
    let next = table;
    if (table.ref === 'orders' && over.adjust !== undefined) next = { ...next, adjust: { ...structuredClone(ADJUST), ...over.adjust } };
    if (over.table !== undefined && over.table[0] === table.ref) next = over.table[1](next);
    return next;
  });
  return { ...(doc as unknown as Doc), ...(over.top ?? {}) };
}
const column = (ref: string, change: (column: Doc) => Doc) => (table: TableDoc): TableDoc => ({ ...table, columns: table.columns.map((c) => (c['ref'] === ref ? change(c) : c)) });
const order = (over: Doc) => ({ order: { ...ADJUST.order, ...over } });
const part = (over: Doc) => ({ lines: [{ ...ADJUST.lines[0], ...over }] });

function kit(over: { adjuster?: Doc; addOn?: Doc; table?: [string, (table: TableDoc) => TableDoc] } = {}): Doc {
  const doc = structuredClone(OFFERS_KIT) as unknown as { requiredSchema: { tables: TableDoc[] }; addOn: Doc };
  doc.addOn = { ...doc.addOn, adjuster: { ...structuredClone(ADJUSTER), ...(over.adjuster ?? {}) }, ...(over.addOn ?? {}) };
  if (over.table !== undefined) doc.requiredSchema.tables = doc.requiredSchema.tables.map((table) => (table.ref === over.table![0] ? over.table![1](table) : table));
  return doc as unknown as Doc;
}

describe('the two fixtures', () => {
  it('validate, and the adjuster reads back typed', () => {
    expect(issuesOf(ADJUST_HOST)).toEqual([]);
    expect(issuesOf(OFFERS_KIT)).toEqual([]);
    const result = validateManifest(OFFERS_KIT);
    expect(result.ok && adjusterOf(result.manifest as Manifest)?.codes.reserved).toEqual(['GC', 'VC', 'PK']);
    expect(adjustSchema.safeParse(ADJUST).success).toBe(true);
    expect(adjusterSchema.safeParse(ADJUSTER).success).toBe(true);
  });

  it('use words that need the install floor', () => {
    expect(installFloorWords(ADJUST_HOST).map((found) => found.word)).toContain('table.adjust');
    expect(installFloorWords(OFFERS_KIT).map((found) => found.word)).toContain('addOn.adjuster');
    expect(issuesOf({ ...ADJUST_HOST, compatibility: { minAdminiumVersion: '0.3.17' } }).join('\n')).toContain('"table.adjust" is read by Adminium 0.3.18 and later');
  });
});

describe('the host\'s rule', () => {
  it('is answered by an add-on the manifest names, switched by a feature that needs it', () => {
    expect(issuesOf(host({ adjust: { by: { addOn: 'coupons' } } })).join('\n')).toContain('"coupons" is not an add-on this manifest names');
    expect(issuesOf(host({ adjust: { needs: 'printing' } })).join('\n')).toContain('"printing" is not one of the app\'s addOns.features');
    expect(issuesOf(host({ adjust: { by: { addOn: 'adjust-host' } } })).join('\n')).toContain('a price is adjusted by an add-on, not by the app itself');
  });

  it('reads lines of a child the order totals: at most three parts, the order itself at most once', () => {
    expect(issuesOf(host({ adjust: part({ via: 'item_id' }) })).join('\n')).toContain('"order_lines.item_id" is not a foreign key to "orders"');
    const untotalled = host({ table: ['orders', column('subtotal', (c) => ({ ref: c['ref'], type: 'money', scale: 2, default: 0 }))] });
    expect(issuesOf(untotalled).join('\n')).toContain('"orders" adds up no column of "order_lines" through "order_id"');
    const self = { self: true, price: 'subtotal', discount: 'discount', what: [] };
    expect(adjustSchema.safeParse({ ...ADJUST, lines: [self, self] }).success).toBe(false);
    expect(adjustSchema.safeParse({ ...ADJUST, lines: [ADJUST.lines[0], ADJUST.lines[0], ADJUST.lines[0], ADJUST.lines[0]] }).success).toBe(false);
  });

  it('a reduction is a money column with its scale, empty or zero to start, with no rule of its own, on one scale', () => {
    const lines = (change: (column: Doc) => Doc) => issuesOf(host({ table: ['order_lines', column('discount', change)] })).join('\n');
    expect(lines((c) => ({ ...c, type: 'int', scale: undefined }))).toContain('"order_lines.discount" holds a reduction: a money or decimal column with a "scale"');
    expect(lines((c) => ({ ref: c['ref'], type: 'money', scale: 2 }))).toContain('"order_lines.discount" starts with no reduction: make it nullable, or give it "default": 0');
    expect(lines((c) => ({ ...c, rules: { formula: { mul: ['unit_price', 'qty'] } } }))).toContain('"order_lines.discount" is written by Adminium from the add-on\'s answer: it takes no rule of its own');
    expect(lines((c) => ({ ...c, scale: 3 }))).toContain("an order's reduction and its lines' keep one scale: 2, 3");
  });

  it('names columns of the part: its price, its quantity, what it sells, what leaves a row out', () => {
    expect(issuesOf(host({ adjust: part({ price: 'cost' }) })).join('\n')).toContain('"order_lines" has no column "cost"');
    expect(issuesOf(host({ adjust: part({ quantity: 'tag' }) })).join('\n')).toContain('"order_lines.tag" is not a whole or a decimal number');
    expect(issuesOf(host({ adjust: part({ what: [{ column: 'tag', as: 'item' }] }) })).join('\n')).toContain('"order_lines.tag" says which item a line is: a foreign key, or a link into an add-on\'s table');
    expect(issuesOf(host({ adjust: part({ what: [{ column: 'item_id', as: 'tag' }] }) })).join('\n')).toContain('a tag is a text or an enum column');
    expect(issuesOf(host({ adjust: part({ unlessSet: 'removed_at' }) })).join('\n')).toContain('"order_lines" has no column "removed_at"');
    // With no quantity, the price is the line's amount.
    expect(issuesOf(host({ adjust: part({ quantity: undefined }) }))).toEqual([]);
  });

  it('a stay priced by the night is the order itself, and its rate is its price', () => {
    const stays = (nights: Doc) => ({ lines: [{ self: true, price: 'subtotal', discount: 'discount', what: [], nights }] });
    expect(issuesOf(host({ adjust: stays({ from: 'arrive', to: 'depart', rate: 'subtotal' }) })).join('\n')).toContain('"orders" has no column "arrive"');
    expect(issuesOf(host({ adjust: stays({ from: 'status', to: 'status', rate: 'total' }) })).join('\n')).toContain('a stay\'s price by the night is its "price" column');
  });

  it('knows who is buying only by a link, an address and a yes/no Adminium sets', () => {
    expect(issuesOf(host({ adjust: order({ customer: { ...ADJUST.order.customer, link: 'status' } }) })).join('\n')).toContain('"orders.status" is not a foreign key to one of this manifest\'s tables');
    expect(issuesOf(host({ adjust: order({ customer: { ...ADJUST.order.customer, address: 'phone' } }) })).join('\n')).toContain('"customers" has no column "phone"');
    const proved = host({ table: ['orders', column('customer_proved', (c) => ({ ...c, nullable: false, default: false }))] });
    expect(issuesOf(proved).join('\n')).toContain('"orders.customer_proved" is a nullable yes/no with no rule of its own');
  });

  it('a reduction staff give has a kind, a value, a reason, and who gave it — never from a browser', () => {
    const kind = host({ table: ['orders', column('staff_kind', (c) => ({ ...c, enum: ['none', 'percent'] }))] });
    expect(issuesOf(kind).join('\n')).toContain('"orders.staff_kind" is an enum holding "percent" and "amount"');
    const by = host({ table: ['orders', column('staff_by', (c) => ({ ...c, rules: { normalize: 'trim' } }))] });
    expect(issuesOf(by).join('\n')).toContain('"orders.staff_by" is text with no rule of its own: Adminium writes who gave the reduction');
    const open = host({ top: { publicAccess: [{ table: 'orders', methods: ['POST'], select: ['status'], writable: ['staff_value'] }] } });
    expect(issuesOf(open).join('\n')).toContain('"orders.staff_value" is a reduction staff give: no public entry may write it');
  });

  it('the codes typed are rows of a child, with the links Adminium fills into the add-on\'s tables', () => {
    expect(issuesOf(host({ adjust: { codes: { ...ADJUST.codes, table: 'payments' } } })).join('\n')).toContain('"payments" has no column "typed"');
    const plain = host({ table: ['order_codes', column('code_id', (c) => ({ ref: c['ref'], type: 'int', nullable: true }))] });
    expect(issuesOf(plain).join('\n')).toContain('"order_codes.code_id" is the link Adminium fills when the typed code is found: a nullable column with rules.addOnLink into "offers-kit"');
    const long = host({ table: ['order_codes', column('typed', (c) => ({ ...c, maxLength: 200 }))] });
    expect(issuesOf(long).join('\n')).toContain('a code is typed into a text column of up to 64 characters');
  });

  it('records uses through a posting of the order\'s own table into the same add-on', () => {
    expect(issuesOf(host({ adjust: { uses: 'redeem' } })).join('\n')).toContain('"redeem" is not a posting of "orders"');
  });

  it('stands from a state or a column of the order', () => {
    expect(issuesOf(host({ adjust: { frozen: { column: 'paid_at', set: true } } })).join('\n')).toContain('"orders" has no column "paid_at"');
    const noStates = host({ table: ['orders', (table) => ({ ...table, states: undefined })] });
    expect(issuesOf(noStates).join('\n')).toContain('"orders" declares no states: name a column and its values instead');
  });

  it('a price check compares a money figure that moves with the reduction', () => {
    expect(issuesOf(host({ adjust: { expect: 'subtotal' } })).join('\n')).toContain('"orders.subtotal" is not worked out from "discount", so a price check on it would check nothing');
    // Through two formulas: total reads net, net reads the discount.
    expect(issuesOf(host({ adjust: { expect: 'total' } }))).toEqual([]);
    expect(issuesOf(host({ adjust: { expect: 'status' } })).join('\n')).toContain('"orders.status" is not a money column');
  });

  it('money given back names the refund rows, what the order cost, and the lines returned', () => {
    expect(issuesOf(host({ adjust: { refunds: { ...ADJUST.refunds, of: 'status' } } })).join('\n')).toContain('"orders.status" is not a money column');
    expect(issuesOf(host({ adjust: { refunds: { ...ADJUST.refunds, against: 'amount' } } })).join('\n')).toContain('"refunds.amount" is not a foreign key to the payment it gives back');
    expect(issuesOf(host({ adjust: { refunds: { ...ADJUST.refunds, lines: { table: 'refund_lines', via: 'refund_id', line: 'refund_id', quantity: 'qty' } } } })).join('\n')).toContain(
      '"refund_lines.refund_id" names the line returned: a foreign key to one of the rule\'s line tables',
    );
  });
});

describe('what the rule makes Adminium\'s own', () => {
  it('every reduction, who gave one, whether the customer was proved, the links a code fills, a refund\'s amount and tax', () => {
    expect(Object.fromEntries(adjustDecidedColumns('orders', adjustSchema.parse(ADJUST) as Adjust))).toEqual({
      orders: ['discount', 'staff_by', 'customer_proved'],
      order_lines: ['discount'],
      order_codes: ['code_id', 'voucher_id'],
      refunds: ['amount', 'tax'],
    });
  });

  it('no public entry writes one of them', () => {
    const entry = (table: string, writable: string[]) => host({ top: { publicAccess: [{ table, methods: ['POST'], select: ['id'], writable }] } });
    expect(issuesOf(entry('orders', ['discount'])).join('\n')).toContain('"discount" is decided by Adminium and cannot be written publicly');
    expect(issuesOf(entry('orders', ['customer_proved'])).join('\n')).toContain('"customer_proved" is decided by Adminium');
    expect(issuesOf(entry('order_lines', ['discount'])).join('\n')).toContain('"discount" is decided by Adminium');
    expect(issuesOf(entry('order_codes', ['code_id'])).join('\n')).toContain('"code_id" is decided by Adminium');
    expect(issuesOf(entry('refunds', ['amount'])).join('\n')).toContain('"amount" is decided by Adminium');
    expect(issuesOf(entry('order_codes', ['typed']))).toEqual([]);
  });
});

describe('the add-on\'s adjuster', () => {
  it('reads and writes its own tables and no others', () => {
    expect(issuesOf(kit({ adjuster: { codes: { ...ADJUSTER.codes, table: 'orders' } } })).join('\n')).toContain('addOn.adjuster.codes.table: "orders" is not one of this add-on\'s own tables');
    expect(issuesOf(kit({ adjuster: { applied: { ...ADJUSTER.applied, table: 'order_lines' } } })).join('\n')).toContain('"order_lines" is not one of this add-on\'s own tables');
    expect(issuesOf(kit({ adjuster: { offers: [{ as: 'x', table: 'customers', by: [], limit: 10 }] } })).join('\n')).toContain('"customers" is not one of this add-on\'s own tables');
  });

  it('keys its reads by the moment, the typed codes, a setting or an earlier read', () => {
    const offers = (reads: unknown[]) => issuesOf(kit({ adjuster: { offers: reads } })).join('\n');
    expect(offers([{ as: 'offers', table: 'offers', by: [{ column: 'status', from: 'now' }] }])).toBe('');
    expect(offers([{ as: 'rules', table: 'offer_rules', by: [{ column: 'offer_id', from: 'offers.id' }] }])).toContain('"offers.id": an adjuster\'s read is keyed by "now", "input.codes", a setting or a column of an earlier read');
    expect(offers([{ as: 'offers', table: 'offers', by: [] }])).toContain('the read "offers" has no key: bound it with a "limit"');
  });

  it('keeps discount codes and vouchers in two tables, so a typed value is one or the other by where it is found', () => {
    expect(issuesOf(kit({ adjuster: { vouchers: { ...ADJUSTER.vouchers, table: 'codes' } } })).join('\n')).toContain('"codes" keeps the discount codes: vouchers are kept in a table of their own');
  });

  it('reserves every routing prefix, so no discount code looks like a voucher', () => {
    expect(issuesOf(kit({ adjuster: { codes: { ...ADJUSTER.codes, reserved: ['GC'] } } })).join('\n')).toContain('"VC-" routes a typed code to a voucher, so no discount code may start with it: add "VC" to codes.reserved');
    expect(adjusterSchema.safeParse({ ...ADJUSTER, codes: { ...ADJUSTER.codes, reserved: ['gift'] } }).success).toBe(false);
  });

  it('the rows of what was applied are Adminium\'s to rewrite: no states, no limit, no rule on a written column', () => {
    const states = kit({ table: ['applied', (table) => ({ ...table, states: { column: 'kind', initial: 'offer', moves: { offer: ['code'] } } })] });
    expect(issuesOf(states).join('\n')).toContain('"applied" is rewritten by Adminium on every save: it carries no states and no limit');
    const ruled = kit({ table: ['applied', (table) => ({ ...table, columns: table.columns.map((c) => (c['ref'] === 'name' ? { ...c, rules: { normalize: 'trim' } } : c)) })] });
    expect(issuesOf(ruled).join('\n')).toContain('"applied.name" is written by Adminium from the answer: it takes no normalize rule');
    const plain = kit({ table: ['applied', (table) => ({ ...table, columns: table.columns.map((c) => (c['ref'] === 'source_table' ? { ref: 'source_table', type: 'text', maxLength: 128 } : c)) })] });
    expect(issuesOf(plain).join('\n')).toContain('"applied.source_table" holds a table\'s stored name: give it rules.tableRef');
  });

  it('a ceiling names a role in text, and whether it may comp as a yes/no', () => {
    expect(issuesOf(kit({ adjuster: { ceilings: { ...ADJUSTER.ceilings, comp: 'role' } } })).join('\n')).toContain('"ceilings.role" says whether the role may give a comp: a yes/no');
    expect(issuesOf(kit({ adjuster: { ceilings: { ...ADJUSTER.ceilings, role: 'max_percent' } } })).join('\n')).toContain('"ceilings.max_percent" names a role: text');
  });

  it('passes the customer as a keyed hash, and provides price-adjust exactly once', () => {
    expect(issuesOf(kit({ adjuster: { customerKey: 'email' } })).join('\n')).toContain('addOn.adjuster.customerKey');
    expect(issuesOf(kit({ addOn: { provides: [] } })).join('\n')).toContain('an add-on with an adjuster provides the contract "price-adjust" exactly once');
  });
});
