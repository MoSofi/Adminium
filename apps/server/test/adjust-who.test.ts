// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHO IS BUYING, AND WHO GAVE THE DISCOUNT — through a real write service.
 *
 * A reduction taken off by hand is its giver's: held to the most their roles
 * allow, which Adminium reads from the add-on's own table and hands in. A
 * customer's own offers are for a customer somebody PROVED — the door, for a
 * verified session of that very customer, or staff naming them — and never
 * for a link anything else wrote.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { WriteContext } from '../src/crud/write-context.js';
import type { RecordWriteService } from '../src/crud/write-service.js';
import { priceWorld, seedOffers } from './adjust.helpers.js';
import { GUEST, refused, saveWorld, sentLine, type SaveWorld } from './adjust-save.helpers.js';
import { LEGS } from './invoicing-install.helpers.js';

const user = (id: string, label: string): WriteContext => ({ origin: 'dashboard', hops: 0, actor: { kind: 'user', id, label }, request: null });
const CASHIER = user('usr_cash', 'Cas');
const OTHER_CASHIER = user('usr_cash2', 'Cal');
const MANAGER = user('usr_mgr', 'Mona');
const LEAD = user('usr_lead', 'Lee');
const OWNER = user('usr_owner', 'Olive');
const NOBODY = user('usr_new', 'Ned');
const ROLES: Readonly<Record<string, string[]>> = { usr_cash: ['cashier', 'packer'], usr_cash2: ['cashier'], usr_mgr: ['manager'], usr_lead: ['cashier', 'lead'], usr_new: [] };

const lines = (w: SaveWorld) => [sentLine(w, 'Mug, speckled', 2), sentLine(w, 'Canvas tote, natural', 2), sentLine(w, 'Notebook, A5', 1)];
const basket = (w: SaveWorld, codes: readonly string[] = [], order: Record<string, unknown> = {}) => ({
  table: 'market_orders',
  values: order,
  lists: {
    order_lines: { table: 'market_order_lines', via: 'order_id', rows: lines(w) },
    ...(codes.length === 0 ? {} : { order_codes: { table: 'market_order_codes', via: 'order_id', rows: codes.map((typed) => ({ typed })) } }),
  },
});

describe.each(LEGS)('a reduction by hand is held to its giver\'s limit — %s', (dialect, available) => {
  let w: SaveWorld;
  /** A service that knows each user's roles; the owner is a Super Admin. */
  let shop: RecordWriteService;
  const staffOf = async (id: unknown) => {
    const [row] = await w.rows(`SELECT staff_kind, staff_value, staff_by, discount FROM market_orders WHERE id = ${String(id)}`);
    return { kind: String(row!['staff_kind']), value: row!['staff_value'] === null ? null : Number(row!['staff_value']), by: row!['staff_by'], discount: Number(row!['discount']).toFixed(2) };
  };
  const give = (id: unknown, values: Record<string, unknown>, context: WriteContext) => w.update('market_orders', id, values, { context, service: shop });
  const open = async (context: WriteContext = OWNER, order: Record<string, unknown> = {}) => (await w.tree(basket(w, [], order), { context, service: shop })).root['id'];

  beforeAll(async () => {
    if (!available) return;
    w = saveWorld(await priceWorld(dialect));
    await seedOffers(w, { timeless: true });
    shop = w.service(undefined, { rolesOf: async (actor) => (actor?.id === 'usr_owner' ? 'any' : new Set(ROLES[actor?.id ?? ''] ?? [])) });
    // A cashier: ten percent, five dollars. A packer: less of both. A manager: a quarter, any amount. A lead may give a comp.
    await w.insert('price_kit_ceilings', { role: 'cashier', max_percent: '10.00', max_amount: '5.00', may_comp: false });
    await w.insert('price_kit_ceilings', { role: 'packer', max_percent: '2.00', max_amount: '1.00', may_comp: false });
    await w.insert('price_kit_ceilings', { role: 'manager', max_percent: '25.00', max_amount: null, may_comp: false });
    await w.insert('price_kit_ceilings', { role: 'lead', max_percent: '0.00', max_amount: '0.00', may_comp: true });
    await w.insert('price_kit_ceilings', { role: 'generous', max_percent: '100.00', max_amount: null, may_comp: false });
  }, 240_000);
  afterAll(async () => {
    if (available) await w.close();
  });

  it.skipIf(!available)('a cashier\'s 20 % with a 10 % limit is refused, and 10 % is theirs', async () => {
    const id = await open();
    const over = await refused(give(id, { staff_kind: 'percent', staff_value: '20' }, CASHIER));
    expect([over.code, over.statusCode]).toEqual(['ADJUST_REFUSED', 409]);
    expect(over.details).toMatchObject({ column: 'staff_value', reason: 'over-ceiling' });
    // The highest of their roles' limits, never the lowest and never the first.
    expect(Number(over.details!['max'])).toBe(10);
    expect(await staffOf(id)).toMatchObject({ kind: 'none', by: null, discount: '15.00' });
    await give(id, { staff_kind: 'percent', staff_value: '10' }, CASHIER);
    // Ten percent of the 49.50 the pair leaves.
    expect(await staffOf(id)).toEqual({ kind: 'percent', value: 10, by: 'usr_cash', discount: '19.95' });
  });

  it.skipIf(!available)('an amount is held to the amount its giver may take off; a role with no amount limit has none', async () => {
    const id = await open();
    const over = await refused(give(id, { staff_kind: 'amount', staff_value: '5.01' }, CASHIER));
    expect(over.details).toMatchObject({ column: 'staff_value', reason: 'over-ceiling' });
    expect(Number(over.details!['max'])).toBe(5);
    await give(id, { staff_kind: 'amount', staff_value: '5.00' }, CASHIER);
    expect(await staffOf(id)).toMatchObject({ kind: 'amount', by: 'usr_cash', discount: '20.00' });
    // A role with no limit in money is not allowed any sum: an amount is then held to what its percent of the goods comes to — a quarter of 64.50.
    const second = await open();
    const sum = await refused(give(second, { staff_kind: 'amount', staff_value: '16.13' }, MANAGER));
    expect(sum.details).toMatchObject({ column: 'staff_value', reason: 'over-ceiling', max: '16.12' });
    await give(second, { staff_kind: 'amount', staff_value: '16.12' }, MANAGER);
    expect(await staffOf(second)).toMatchObject({ kind: 'amount', by: 'usr_mgr', discount: '31.12' });
    // …and their percent is still held to their percent.
    expect((await refused(give(second, { staff_kind: 'percent', staff_value: '26' }, MANAGER))).details).toMatchObject({ reason: 'over-ceiling' });
  });

  it.skipIf(!available)('a manager\'s 20 % stays when a cashier adds a line: what stands is judged by nobody', async () => {
    const id = await open();
    await give(id, { staff_kind: 'percent', staff_value: '20' }, MANAGER);
    expect(await staffOf(id)).toEqual({ kind: 'percent', value: 20, by: 'usr_mgr', discount: '24.90' });
    await w.create('market_order_lines', { order_id: id, ...sentLine(w, 'Greeting card', 2) }, CASHIER, shop);
    // 71.50 of goods, the pair, then a fifth of 56.50.
    expect(await staffOf(id)).toEqual({ kind: 'percent', value: 20, by: 'usr_mgr', discount: '26.30' });
    // A change of the order that leaves the reduction as it is asks no limit either; the reason beside it is part of it, and not a cashier's to rewrite.
    await give(id, { note: 'by the door' }, CASHIER);
    expect((await refused(give(id, { staff_reason: 'regular' }, CASHIER))).details).toEqual({ column: 'staff_value', reason: 'not-allowed' });
    await give(id, { staff_reason: 'regular' }, MANAGER);
    expect(await staffOf(id)).toMatchObject({ value: 20, by: 'usr_mgr' });
  });

  it.skipIf(!available)('what its giver gave is held to their limit again when THEY make the order bigger', async () => {
    const id = await open();
    // Ten percent of 49.50 is 4.95: within a cashier's five dollars.
    await give(id, { staff_kind: 'percent', staff_value: '10' }, CASHIER);
    // Two cards more and it would come to 5.65: not theirs to give, on the save that would make it so.
    const grown = await refused(w.create('market_order_lines', { order_id: id, ...sentLine(w, 'Greeting card', 2) }, CASHIER, shop));
    expect([grown.code, grown.details?.['column'], grown.details?.['reason'], Number(grown.details?.['max'])]).toEqual(['ADJUST_REFUSED', 'staff_value', 'over-ceiling', 5]);
    expect(await w.figures(id)).toMatchObject({ subtotal: '64.50', discount: '19.95' });
    // Somebody else adding them judges nobody: the reduction stands as its giver gave it.
    await w.create('market_order_lines', { order_id: id, ...sentLine(w, 'Greeting card', 2) }, OTHER_CASHIER, shop);
    expect(await staffOf(id)).toMatchObject({ value: 10, by: 'usr_cash', discount: '20.65' });
  });

  it.skipIf(!available)('a reduction nobody is on record as giving is the next saver\'s to answer for', async () => {
    const id = await open();
    // As a file brought it in, or as it was written while the rule was switched off.
    await w.rows(`UPDATE market_orders SET staff_kind = 'percent', staff_value = 20, staff_by = NULL WHERE id = ${String(id)}`);
    const card = { order_id: id, ...sentLine(w, 'Greeting card', 1) };
    const rule: WriteContext = { origin: 'automation', hops: 1, actor: { kind: 'automation', id: 'rule_1', label: 'Add a card' }, request: null };
    expect((await refused(w.create('market_order_lines', card, rule, shop))).details).toEqual({ column: 'staff_value', reason: 'not-allowed' });
    // Twenty percent is nothing a cashier could have given: not theirs to take on.
    expect((await refused(w.create('market_order_lines', card, CASHIER, shop))).details).toEqual({ column: 'staff_value', reason: 'not-allowed' });
    await w.create('market_order_lines', card, MANAGER, shop);
    expect(await staffOf(id)).toMatchObject({ kind: 'percent', value: 20, by: 'usr_mgr' });
    // From then on it is the manager's, and stands for whoever saves next.
    await w.create('market_order_lines', card, rule, shop);
    expect(await staffOf(id)).toMatchObject({ value: 20, by: 'usr_mgr' });
  });

  it.skipIf(!available)('a file brings in reductions as history, never who gave one or that a customer was proved', async () => {
    const importing: WriteContext = { ...CASHIER, origin: 'import' };
    const orders = w.target('market_orders');
    const brought = await shop.check('create', orders, importing, [{ staff_kind: 'percent', staff_value: '50', staff_by: 'usr_owner', customer_proved: true, discount: '3.00' }], { capacity: 'unchecked' });
    expect(brought.issues).toEqual([null]);
    expect(Number(brought.rows[0]!['discount'])).toBe(3);
    expect(Object.keys(brought.rows[0]!)).not.toContain('staff_by');
    expect(Object.keys(brought.rows[0]!)).not.toContain('customer_proved');
    // On a row already stored, a reduction, a proof or a giver is a change of its price like any other: that row is refused.
    for (const change of [{ discount: '60.00' }, { customer_proved: true }, { staff_by: 'usr_owner' }]) {
      const [column] = Object.keys(change);
      await expect(shop.check('update', orders, importing, [change]), column).resolves.toMatchObject({ issues: [{ [column!]: { code: 'one-at-a-time' } }] });
    }
    await expect(shop.check('update', w.target('market_order_lines'), importing, [{ discount: '9.00' }])).resolves.toMatchObject({ issues: [{ discount: { code: 'one-at-a-time' } }] });
  });

  it.skipIf(!available)('what a percent comes to is the add-on\'s to judge — and one that applies more than the limit, and does not say so, fails the save', async () => {
    const id = await open();
    await w.create('market_order_lines', { order_id: id, ...sentLine(w, 'Greeting card', 2) }, OWNER, shop);
    // Ten percent is a cashier's to give; of 56.50 it comes to 5.65, and five dollars is the most they may take off.
    const over = await refused(give(id, { staff_kind: 'percent', staff_value: '10' }, CASHIER));
    expect([over.details?.['reason'], Number(over.details?.['max'])]).toEqual(['over-ceiling', 5]);
    await w.misbehave('over-ceiling-silent');
    try {
      // The figure asked is judged by Adminium before anybody is asked: an add-on that would let it through is never reached.
      expect((await refused(give(id, { staff_kind: 'percent', staff_value: '20' }, CASHIER))).details).toMatchObject({ reason: 'over-ceiling' });
      expect((await refused(give(id, { staff_kind: 'amount', staff_value: '5.01' }, CASHIER))).details).toMatchObject({ reason: 'over-ceiling' });
      const failed = await refused(give(id, { staff_kind: 'percent', staff_value: '10' }, CASHIER));
      expect([failed.code, failed.details]).toEqual(['POSTING_REFUSED', { reason: 'planner-failed' }]);
      expect(await staffOf(id)).toMatchObject({ kind: 'none', by: null });
    } finally {
      await w.misbehave(null);
    }
  });

  it.skipIf(!available)('a comp is given by a Super Admin, or with leave; a limit of a hundred percent is not leave', async () => {
    const id = await open();
    const generous = w.service(undefined, { rolesOf: async () => new Set(['generous']) });
    const no = await refused(w.update('market_orders', id, { staff_kind: 'comp' }, { context: MANAGER, service: generous }));
    expect(no.details).toMatchObject({ column: 'staff_value', reason: 'over-ceiling', max: '0' });
    expect((await refused(give(id, { staff_kind: 'comp' }, CASHIER))).details).toMatchObject({ reason: 'over-ceiling', max: '0' });
    // …though a hundred percent is theirs to give as a percent.
    await w.update('market_orders', id, { staff_kind: 'percent', staff_value: '100' }, { context: MANAGER, service: generous });
    expect(await w.figures(id)).toMatchObject({ discount: '64.50', net: '0.00' });
    const second = await open();
    await give(second, { staff_kind: 'comp' }, LEAD);
    expect(await staffOf(second)).toMatchObject({ kind: 'comp', by: 'usr_lead', discount: '64.50' });
    const third = await open();
    await give(third, { staff_kind: 'comp' }, OWNER);
    expect(await staffOf(third)).toMatchObject({ kind: 'comp', by: 'usr_owner', discount: '64.50' });
    // A comp that stands is the whole of the goods in every save after — never no reduction at all.
    await w.create('market_order_lines', { order_id: third, ...sentLine(w, 'Greeting card', 2) }, CASHIER, shop);
    expect(await w.figures(third)).toMatchObject({ subtotal: '71.50', discount: '71.50', net: '0.00', total: '0.00' });
    expect(await staffOf(third)).toMatchObject({ kind: 'comp', by: 'usr_owner' });
  });

  it.skipIf(!available)('a user with no limit row has a limit of nothing; a Super Admin has none', async () => {
    const id = await open();
    const none = await refused(give(id, { staff_kind: 'percent', staff_value: '1' }, NOBODY));
    expect(none.details).toMatchObject({ column: 'staff_value', reason: 'over-ceiling' });
    expect(Number(none.details!['max'])).toBe(0);
    expect((await refused(give(id, { staff_kind: 'amount', staff_value: '0.01' }, NOBODY))).details).toMatchObject({ reason: 'over-ceiling' });
    await give(id, { staff_kind: 'percent', staff_value: '90' }, OWNER);
    expect(await staffOf(id)).toMatchObject({ kind: 'percent', value: 90, by: 'usr_owner' });
    // An order made with a reduction on it is judged as a change to one is.
    const made = await refused(w.tree(basket(w, [], { staff_kind: 'percent', staff_value: '20' }), { context: CASHIER, service: shop }));
    expect(made.details).toMatchObject({ column: 'staff_value', reason: 'over-ceiling' });
    const ok = await w.tree(basket(w, [], { staff_kind: 'percent', staff_value: '10' }), { context: CASHIER, service: shop });
    expect(await staffOf(ok.root['id'])).toMatchObject({ value: 10, by: 'usr_cash' });
  });

  it.skipIf(!available)('a reduction with no user behind it is refused', async () => {
    const id = await open();
    const key: WriteContext = { origin: 'dashboard', hops: 0, actor: { kind: 'api-key', id: 'key_1', label: 'Till key' }, request: null };
    const rule: WriteContext = { origin: 'automation', hops: 1, actor: { kind: 'automation', id: 'rule_1', label: 'Happy hour' }, request: null };
    // A rule that runs as the user who made it is still a rule: nobody is at the till.
    const asUser: WriteContext = { ...OWNER, origin: 'automation', hops: 1 };
    for (const context of [key, rule, { ...key, actor: null }, asUser]) {
      const no = await refused(give(id, { staff_kind: 'percent', staff_value: '5' }, context));
      expect([no.code, no.details]).toEqual(['ADJUST_REFUSED', { column: 'staff_value', reason: 'not-allowed' }]);
    }
    expect(await staffOf(id)).toMatchObject({ kind: 'none', by: null });
    // What such a writer leaves alone is saved as ever, with the reduction that stands.
    await give(id, { staff_kind: 'percent', staff_value: '10' }, CASHIER);
    await give(id, { note: 'by the till' }, key);
    await w.create('market_order_lines', { order_id: id, ...sentLine(w, 'Greeting card', 1) }, rule, shop);
    expect(await staffOf(id)).toMatchObject({ kind: 'percent', value: 10, by: 'usr_cash' });
  });

  it.skipIf(!available)('another user\'s reduction is lowered or taken away only within the remover\'s own limit', async () => {
    const id = await open();
    await give(id, { staff_kind: 'percent', staff_value: '20' }, MANAGER);
    for (const change of [{ staff_kind: 'none' }, { staff_value: '5' }, { staff_kind: 'amount', staff_value: '1.00' }]) {
      const no = await refused(give(id, change, CASHIER));
      expect([no.code, no.details], JSON.stringify(change)).toEqual(['ADJUST_REFUSED', { column: 'staff_value', reason: 'not-allowed' }]);
    }
    expect(await staffOf(id)).toMatchObject({ kind: 'percent', value: 20, by: 'usr_mgr' });
    // Its giver may always; and so may anybody who could have given it.
    await give(id, { staff_value: '8' }, MANAGER);
    await give(id, { staff_value: '6' }, CASHIER);
    expect(await staffOf(id)).toMatchObject({ value: 6, by: 'usr_cash' });
    await give(id, { staff_kind: 'none', staff_value: null }, OTHER_CASHIER);
    expect(await staffOf(id)).toEqual({ kind: 'none', value: null, by: null, discount: '15.00' });
    // A comp is taken away only by somebody who may give one.
    await give(id, { staff_kind: 'comp' }, LEAD);
    expect((await refused(give(id, { staff_kind: 'none' }, MANAGER))).details).toMatchObject({ reason: 'not-allowed' });
    await give(id, { staff_kind: 'none' }, OWNER);
    expect(await staffOf(id)).toMatchObject({ kind: 'none', by: null });
    // An amount is covered by an amount: sixteen dollars off is not a cashier's to lower, whatever they lower it to.
    await give(id, { staff_kind: 'amount', staff_value: '16.00' }, MANAGER);
    expect((await refused(give(id, { staff_value: '4.00' }, CASHIER))).details).toMatchObject({ reason: 'not-allowed' });
    expect(await staffOf(id)).toMatchObject({ kind: 'amount', value: 16, by: 'usr_mgr' });
  });

  it.skipIf(!available)('nobody writes who gave a reduction but Adminium', async () => {
    const id = await open();
    await give(id, { staff_kind: 'percent', staff_value: '10', staff_by: 'usr_mgr' }, CASHIER);
    expect(await staffOf(id)).toMatchObject({ by: 'usr_cash' });
  });
});

describe.each(LEGS)('a customer\'s own offers are for a customer somebody proved — %s', (dialect, available) => {
  let w: SaveWorld;
  let ada: unknown;
  let ben: unknown;
  const provedOf = async (id: unknown) => {
    const [row] = await w.rows(`SELECT customer_id, customer_proved FROM market_orders WHERE id = ${String(id)}`);
    const flag = row!['customer_proved'];
    return { customer: row!['customer_id'] === null ? null : Number(row!['customer_id']), proved: flag === null ? null : flag === true || flag === 1 || flag === '1' };
  };
  const session = (link: unknown, over: Record<string, unknown> = {}): WriteContext => ({ ...GUEST, adjust: { proved: { table: w.table('market_orders').id, column: 'customer_id', link, ...over } } });
  const typedRefusal = async (run: Promise<unknown>) => ((await refused(run)).details as { fields?: Record<string, unknown> } | undefined)?.fields;

  beforeAll(async () => {
    if (!available) return;
    w = saveWorld(await priceWorld(dialect));
    await seedOffers(w, { timeless: true });
    ada = (await w.create('market_customers', { name: 'Ada', email: 'ada@example.com' }))['id'];
    ben = (await w.create('market_customers', { name: 'Ben', email: 'ben@example.com' }))['id'];
  }, 240_000);
  afterAll(async () => {
    if (available) await w.close();
  });

  it.skipIf(!available)('a link the address finder made is never a proof: the code asks for a sign-in, in the save and after staff add a line', async () => {
    // The door found Ada by the address typed, and wrote her link: nobody proved the buyer is Ada.
    expect(await typedRefusal(w.tree(basket(w, ['WELCOME10'], { customer_id: ada }), { context: GUEST }))).toEqual({ typed: { code: 'needs-sign-in' } });
    const made = await w.tree(basket(w, [], { customer_id: ada }), { context: GUEST });
    const id = made.root['id'];
    expect(await provedOf(id)).toEqual({ customer: Number(ada), proved: false });
    // A writer cannot say so itself.
    const claimed = await w.tree(basket(w, [], { customer_id: ada, customer_proved: true }), { context: GUEST });
    expect(await provedOf(claimed.root['id'])).toMatchObject({ proved: false });
    // Staff adding a line later prove nothing about who bought.
    await w.create('market_order_lines', { order_id: id, ...sentLine(w, 'Greeting card', 1) });
    expect(await provedOf(id)).toMatchObject({ proved: false });
    expect((await refused(w.create('market_order_codes', { order_id: id, typed: 'WELCOME10' }))).details).toMatchObject({ reason: 'needs-customer' });
  });

  it.skipIf(!available)('a verified session of that very customer is a proof, and the price asked later keeps it', async () => {
    const made = await w.tree(basket(w, ['WELCOME10'], { customer_id: ada }), { context: session(ada) });
    const id = made.root['id'];
    expect(await provedOf(id)).toEqual({ customer: Number(ada), proved: true });
    expect(await w.figures(id)).toEqual({ subtotal: '64.50', discount: '19.95', net: '44.55', tax: '3.56', total: '48.11' });
    // A line added by anyone — the system included — is priced for the same proved customer.
    await w.create('market_order_lines', { order_id: id, ...sentLine(w, 'Greeting card', 2) }, { origin: 'automation', hops: 1, actor: { kind: 'automation', id: 'rule_1', label: 'Add a card' }, request: null });
    expect(await provedOf(id)).toMatchObject({ proved: true });
    // 71.50 of goods, the pair, then a tenth of 56.50.
    expect(await w.figures(id)).toMatchObject({ discount: '20.65' });
  });

  it.skipIf(!available)('a session proves its own customer only, on the order\'s own link only', async () => {
    // Signed in as Ben, naming Ada.
    expect(await typedRefusal(w.tree(basket(w, ['WELCOME10'], { customer_id: ada }), { context: session(ben) }))).toEqual({ typed: { code: 'needs-sign-in' } });
    // A proof of some other table's row, or by another column, is none for this order.
    expect(await typedRefusal(w.tree(basket(w, ['WELCOME10'], { customer_id: ada }), { context: session(ada, { table: w.table('market_customers').id }) }))).toEqual({ typed: { code: 'needs-sign-in' } });
    expect(await typedRefusal(w.tree(basket(w, ['WELCOME10'], { customer_id: ada }), { context: session(ada, { column: 'id' }) }))).toEqual({ typed: { code: 'needs-sign-in' } });
    // A session with nobody in it proves nobody.
    const anonymous = await w.tree(basket(w), { context: session(null) });
    expect(await provedOf(anonymous.root['id'])).toEqual({ customer: null, proved: null });
  });

  it.skipIf(!available)('staff naming the customer is a proof; the link written by anything else, or emptied, takes it away', async () => {
    const made = await w.tree(basket(w));
    const id = made.root['id'];
    expect(await provedOf(id)).toEqual({ customer: null, proved: null });
    await w.update('market_orders', id, { customer_id: ben });
    expect(await provedOf(id)).toEqual({ customer: Number(ben), proved: true });
    await w.create('market_order_codes', { order_id: id, typed: 'WELCOME10' });
    expect(await w.figures(id)).toMatchObject({ discount: '19.95', total: '48.11' });
    // A form that sends the same customer back changes nothing.
    await w.update('market_orders', id, { customer_id: ben, note: 'x' }, { context: { origin: 'automation', hops: 1, actor: { kind: 'automation', id: 'rule_1', label: 'Tidy' }, request: null } });
    expect(await provedOf(id)).toMatchObject({ proved: true });
    // An automation moving the order to Ada proves nothing about Ada: her code no longer stands on it.
    const moved = await refused(w.update('market_orders', id, { customer_id: ada }, { context: { origin: 'automation', hops: 1, actor: { kind: 'automation', id: 'rule_1', label: 'Merge' }, request: null } }));
    expect(moved.details).toMatchObject({ column: 'typed', reason: 'unknown' });
    const [code] = await w.rows(`SELECT id FROM market_order_codes WHERE order_id = ${String(id)}`);
    await w.update('market_order_codes', code!['id'], { removed_at: new Date().toISOString() });
    await w.update('market_orders', id, { customer_id: ada }, { context: { origin: 'automation', hops: 1, actor: { kind: 'automation', id: 'rule_1', label: 'Merge' }, request: null } });
    expect(await provedOf(id)).toEqual({ customer: Number(ada), proved: false });
    await w.update('market_orders', id, { customer_id: null });
    expect(await provedOf(id)).toEqual({ customer: null, proved: false });
    // A rule that runs as a user names nobody on anybody's word.
    await w.update('market_orders', id, { customer_id: ben }, { context: { origin: 'automation', hops: 1, actor: { kind: 'user', id: 'usr_ivy', label: 'Ivy' }, request: null } });
    expect(await provedOf(id)).toEqual({ customer: Number(ben), proved: false });
  });
});
