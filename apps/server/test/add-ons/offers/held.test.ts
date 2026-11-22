// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHAT A SIGNED-IN CUSTOMER HOLDS, AND WHO CAN SPEND IT.
 *
 * A studio on the built add-on, each person acting through the public door as
 * themselves. A pack is made only when its order is paid, with the buyer who
 * proved their address as its holder. They read their packs and cards by that
 * address and spend them with no code in their browser. One booking takes a
 * pack and a card in one save. The last use and the last of a card go to one
 * booking of two. Somebody who only typed the holder's address spends nothing.
 */
import { rolesRepo, usersRepo } from '@adminium/meta';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { addOnHarness, type Harness } from '../../app-add-ons.helpers.js';
import { ADMIN_PASSWORD, adminPasswordHash, sessionCookie } from '../../auth-helpers.js';
import { LEGS } from '../../invoicing-install.helpers.js';
import { guest, mailReady } from '../../person-fixture.js';
import { servePublic, type Served } from '../../public-lane.helpers.js';
import { builtAddOn } from '../harness.js';

type Doc = Record<string, unknown>;
const offers = builtAddOn('offers');
const OFFERS = 'offers';
const pk = { ref: 'id', type: 'int', role: 'pk' };
const text = (ref: string, maxLength: number, more: Doc = {}) => ({ ref, type: 'text', maxLength, ...more });
const money = (ref: string, more: Doc = {}) => ({ ref, type: 'money', scale: 'currency', ...more });
const fk = (ref: string, references: string, more: Doc = {}) => ({ ref, type: 'fk', references, ...more });
const link = (ref: string, table: string, rules: Doc = {}) => ({ ref, type: 'int', nullable: true, rules: { addOnLink: { addOn: OFFERS, table }, ...rules } });
const into = (action: string) => ({ addOn: OFFERS, ledger: 'value', action });
const copied = (from: string) => ({ copy: { via: 'pack_product_id', from, mode: 'always' } });

function studio(): Doc {
  return {
    kind: 'app',
    manifestVersion: 1,
    key: 'studio',
    name: 'Studio',
    version: '1.0.0',
    publisher: { id: 'adminium', name: 'Adminium', url: 'https://adminium.dev' },
    license: 'AGPL-3.0-only',
    description: { key: 'mft.studio.desc', fallback: 'A studio that sells packs.' },
    categories: ['operations'],
    compatibility: { minAdminiumVersion: '0.3.71', engines: ['postgres', 'mysql', 'sqlite'] },
    pages: [{ ref: 'studio-bookings', template: 'page-crud', title: { key: 'mft.studio.page.bookings', fallback: 'Bookings' }, nav: { group: 'manage', icon: 'list', order: 1 }, bindings: { rows: 'bookings' } }],
    frontends: [{ side: 'staff', kind: 'none' }],
    publicKeys: { link: {} },
    addOns: {
      suggests: [{ key: OFFERS, range: '>=1.0.0', reason: { 'en-US': 'Packs and gift cards.' } }],
      features: [{ id: 'offers', label: { 'en-US': 'Packs and gift cards' }, requires: [OFFERS] }],
    },
    requiredSchema: {
      prefixed: true,
      tables: [
        { ref: 'customers', columns: [pk, text('email', 254, { nullable: true, unique: true, rules: { normalize: 'email', validation: { format: 'email' } } }), text('name', 80, { nullable: true }), { ref: 'forgotten_at', type: 'timestamptz', nullable: true }] },
        { ref: 'categories', columns: [pk, text('name', 80)] },
        { ref: 'services', columns: [pk, text('name', 80), fk('category_id', 'categories'), money('price', { default: 0 })] },
        { ref: 'pack_products', columns: [pk, text('name', 120), money('price', { default: 0 }), { ref: 'uses', type: 'int', default: 1 }, { ref: 'what', type: 'enum', enum: ['item', 'category', 'type', 'tag'], default: 'category' }, fk('category_id', 'categories')] },
        {
          ref: 'purchases',
          columns: [pk, text('note', 80, { nullable: true }), fk('customer_id', 'customers', { nullable: true }), text('buyer_email', 254, { nullable: true, rules: { copy: { via: 'customer_id', from: 'email', mode: 'always' } } }), { ref: 'customer_proved', type: 'bool', default: false }, { ref: 'paid_at', type: 'timestamptz', nullable: true }, { ref: 'cancelled_at', type: 'timestamptz', nullable: true }],
        },
        {
          ref: 'purchase_lines',
          postings: [
            {
              id: 'pack-make',
              into: into('sell-pack'),
              via: 'purchase_id',
              reserve: { on: { create: true } },
              post: { on: { column: 'paid_at', set: true } },
              reverse: { on: { column: 'cancelled_at', set: true } },
              map: { amount: 'amount', name: 'pack_name', uses: 'uses', what: 'what', target: 'category_id', holder_email: { parent: 'buyer_email' }, proved: { parent: 'customer_proved' } },
            },
            { id: 'pack-recall', into: into('recall-pack'), via: 'purchase_id', post: { on: { column: 'cancelled_at', set: true } }, reverse: { on: { column: 'paid_at', set: true } }, map: { sale: { row: true } } },
          ],
          columns: [
            pk,
            fk('purchase_id', 'purchases'),
            fk('pack_product_id', 'pack_products'),
            money('amount', { nullable: true, rules: copied('price') }),
            text('pack_name', 120, { nullable: true, rules: copied('name') }),
            { ref: 'uses', type: 'int', nullable: true, rules: copied('uses') },
            { ref: 'what', type: 'enum', enum: ['item', 'category', 'type', 'tag'], nullable: true, rules: copied('what') },
            fk('category_id', 'categories', { nullable: true, rules: copied('category_id') }),
          ],
        },
        {
          ref: 'bookings',
          adjust: {
            by: { addOn: OFFERS },
            needs: 'offers',
            lines: [{ self: true, price: 'unit', quantity: 'seats', discount: 'line_discount', what: [{ column: 'category_id', as: 'category' }] }],
            order: { discount: 'discount', customer: { link: 'customer_id', address: 'email', proved: 'customer_proved' } },
            codes: { table: 'booking_codes', via: 'booking_id', typed: 'typed', code: 'code_id', voucher: 'voucher_id' },
            uses: 'uses',
          },
          postings: [{ id: 'uses', into: into('redeem'), post: { on: { create: true } }, reverse: { on: { column: 'cancelled_at', set: true } }, map: {} }],
          columns: [
            pk,
            fk('service_id', 'services'),
            fk('category_id', 'categories', { nullable: true, rules: { copy: { via: 'service_id', from: 'category_id', mode: 'always' } } }),
            fk('customer_id', 'customers', { nullable: true }),
            { ref: 'customer_proved', type: 'bool', nullable: true },
            text('email', 254, { rules: { validation: { format: 'email' } } }),
            { ref: 'seats', type: 'int', default: 1, rules: { validation: { min: 1, max: 4 } } },
            money('unit', { nullable: true, rules: { copy: { via: 'service_id', from: 'price', mode: 'always' } } }),
            money('price', { nullable: true, rules: { formula: { mul: [{ coalesce: ['unit', 0] }, { coalesce: ['seats', 1] }] } } }),
            money('line_discount', { default: 0 }),
            money('discount', { default: 0 }),
            money('total', { nullable: true, rules: { formula: { sub: [{ coalesce: ['price', 0] }, { coalesce: ['discount', 0] }] } } }),
            money('paid', { default: 0, rules: { rollup: { from: 'payments', via: 'booking_id', sum: 'amount', unlessSet: 'voided_at', cap: true, balance: { column: 'due', of: 'total' } } } }),
            money('due', { default: 0 }),
            { ref: 'cancelled_at', type: 'timestamptz', nullable: true },
            text('link_token', 16, { nullable: true, rules: { code: { length: 16 } } }),
          ],
        },
        { ref: 'booking_codes', columns: [pk, fk('booking_id', 'bookings'), text('typed', 64, { nullable: true }), link('code_id', 'codes'), link('voucher_id', 'vouchers')] },
        {
          ref: 'payments',
          postings: [
            {
              id: 'card',
              into: into('spend'),
              via: 'booking_id',
              only: { column: 'card_code', set: true },
              post: { on: { create: true } },
              reverse: { on: { column: 'voided_at', set: true, own: true } },
              map: { card: 'card_id', due: { parent: 'total' }, amount: 'amount', balance_after: 'card_balance_after' },
            },
          ],
          columns: [
            pk,
            fk('booking_id', 'bookings'),
            text('card_code', 64, { nullable: true }),
            link('card_id', 'gift_cards', { lookup: { from: 'card_code', table: { addOn: OFFERS, table: 'gift_cards' }, column: 'code', where: [{ column: 'status', eq: 'active' }], held: 'recipient_email' } }),
            money('amount', { nullable: true }),
            money('card_balance_after', { nullable: true }),
            { ref: 'voided_at', type: 'timestamptz', nullable: true },
          ],
        },
      ],
    },
    publicAccess: [
      { table: 'customers', methods: ['GET'], select: ['name'], claim: { verify: 'email-link', email: 'email' }, humanCheck: true },
      { table: 'services', methods: ['GET'], select: ['id', 'name', 'price'] },
      { table: 'pack_products', methods: ['GET'], select: ['id', 'name', 'price'] },
      {
        table: 'bookings',
        methods: ['POST'],
        humanCheck: true,
        level: 'verified',
        select: ['id', 'discount', 'total', 'paid', 'due'],
        writable: ['service_id', 'email', 'seats'],
        requires: ['email'],
        claimedBy: { table: 'customers', column: 'customer_id', optional: true },
        identity: { table: 'customers', email: 'email', link: 'customer_id' },
        shareLink: 'link_token',
        anonymous: { perValue: { columns: ['email'], n: 20 }, perKeyHour: 600, perIpHour: 60 },
        children: {
          booking_codes: { via: 'booking_id', writable: ['typed'], select: ['id'], max: 4 },
          payments: { via: 'booking_id', writable: ['card_code'], select: ['id', 'amount'], max: 2 },
        },
      },
      {
        table: 'purchases',
        methods: ['POST'],
        level: 'verified',
        select: ['id'],
        writable: ['note'],
        claimedBy: { table: 'customers', column: 'customer_id' },
        defaults: { customer_proved: true },
        children: { purchase_lines: { via: 'purchase_id', writable: ['pack_product_id'], select: ['id'], max: 2 } },
      },
      // A booking's own link, which may have been forwarded: it opens the booking and may add a code to it.
      { table: 'bookings', key: 'link', methods: ['GET'], select: ['id', 'discount'], claim: { by: 'token', column: 'link_token', own: true, address: 'email' } },
      { table: 'booking_codes', key: 'link', methods: ['POST'], level: 'verified', visibleWith: { table: 'bookings', via: 'booking_id' }, writable: ['booking_id', 'typed'], select: ['id'] },
    ],
  };
}

/** The same studio, signing people in by what they know and then a mailed code: a session that has only found them proves no mailbox. */
function finderStudio(): Doc {
  const app = studio();
  const entries = (app['publicAccess'] as Doc[]).filter((entry) => entry['key'] === undefined && entry['table'] !== 'purchases');
  return {
    ...app,
    publicKeys: undefined,
    key: 'finder',
    name: 'Finder',
    description: { key: 'mft.finder.desc', fallback: 'A studio that finds its people.' },
    pages: [{ ref: 'finder-bookings', template: 'page-crud', title: { key: 'mft.finder.page.bookings', fallback: 'Bookings' }, nav: { group: 'manage', icon: 'list', order: 1 }, bindings: { rows: 'bookings' } }],
    publicAccess: entries.map((entry) => {
      if (entry['table'] === 'customers') return { table: 'customers', methods: ['GET'], select: ['name'], claim: { match: ['email', 'name'], verify: 'email-code', email: 'email' } };
      if (entry['table'] !== 'bookings') return entry;
      const { identity: _identity, shareLink: _share, anonymous: _anonymous, humanCheck: _check, ...rest } = entry;
      return { ...rest, level: 'lookup', claimedBy: { table: 'customers', column: 'customer_id' } };
    }),
  };
}

const PACKS = 'offers_vouchers_verified';
const CARDS = 'offers_gift_cards_verified';

describe.each(LEGS)('what a signed-in customer holds — %s', (dialect, available) => {
  const run = available && offers !== null;
  let h: Harness;
  let served: Served;
  let g: ReturnType<typeof guest>;
  let cookie = '';
  let ava = '';
  let ben = '';
  const trusted = process.env['ADMINIUM_ADD_ON_DEV_TRUST'];

  const staff = (method: string, url: string, payload?: unknown) =>
    served.composed.app.inject({ method: method as 'POST', url: `/api/v1/data/${h.connectionId}/${url}`, headers: { cookie }, ...(payload === undefined ? {} : { payload: { values: payload } as Doc }) });
  const rows = (table: string, where = '1 = 1') => h.rows(`select * from ${table} where ${where} order by id`);
  const list = async (ref: string, session?: string) => g.request('GET', `/records/${ref}`, session === undefined ? {} : { session });
  const dataOf = (res: { json: () => unknown }) => (res.json() as { data: Doc[] }).data;
  const buy = (session?: string) => g.request('POST', '/records/studio_purchases_verified', { ...(session === undefined ? {} : { session }), payload: { values: { note: 'A pack' }, children: { purchase_lines: [{ values: { pack_product_id: 1 } }] } } });
  const book = (session: string | undefined, asked: Doc) => {
    const { booking_codes: codes, payments, ...values } = asked as { booking_codes?: Doc[]; payments?: Doc[] } & Doc;
    const children = {
      ...(codes === undefined ? {} : { booking_codes: codes.map((row) => ({ values: row })) }),
      ...(payments === undefined ? {} : { payments: payments.map((row) => ({ values: row })) }),
    };
    return g.request('POST', '/records/studio_bookings_verified', {
      proof: 'write' as const,
      ...(session === undefined ? {} : { session }),
      payload: { values: { service_id: 1, email: 'ava@lumen.example', ...values }, ...(Object.keys(children).length === 0 ? {} : { children }) },
    });
  };
  /** A paid purchase of Movement Ten for this session: the pack it made. */
  const packFor = async (session: string): Promise<Doc> => {
    const bought = await buy(session);
    expect(bought.statusCode, bought.body).toBe(201);
    const id = (bought.json() as { data: { id: number } }).data.id;
    const paid = await staff('PATCH', `studio_purchases/${String(id)}`, { paid_at: new Date().toISOString() });
    expect(paid.statusCode, paid.body).toBe(200);
    const [line] = await rows('studio_purchase_lines', `purchase_id = ${String(id)}`);
    const [pack] = await rows('offers_vouchers', `sale_row = '${String(line!['id'])}'`);
    return { ...pack!, purchase: id };
  };
  const card = async (recipient: string, amount: string): Promise<number> => {
    const made = await staff('POST', 'offers_gift_cards', { kind: 'card', recipient_email: recipient });
    expect(made.statusCode, made.body).toBe(201);
    const id = (made.json() as { data: { id: number } }).data.id;
    const loaded = await staff('POST', 'offers_card_actions', { card_id: id, action: 'issue', amount, reason: 'Sold at the desk' });
    expect(loaded.statusCode, loaded.body).toBe(201);
    return id;
  };

  beforeAll(async () => {
    if (!run) return;
    process.env['ADMINIUM_ADD_ON_DEV_TRUST'] = OFFERS;
    h = await addOnHarness(dialect, { unbuiltWords: {} });
    await h.stageApp(studio());
    const installed = await h.install('studio', '1.0.0');
    expect(installed.statusCode, installed.body).toBe(200);
    const keyId = (installed.json() as { publicAccess: { keyId: string } }).publicAccess.keyId;
    await h.stageAddOn(offers!.manifest, { bundled: true, files: offers!.files });
    const added = await h.inject({ method: 'POST', url: '/add-ons', payload: { key: OFFERS, version: offers!.version, attachTo: ['studio'], publicAccess: true } });
    expect(added.statusCode, added.body).toBe(200);
    await mailReady(h.meta);
    await h.rows(`insert into studio_customers (id, email, name) values (1, 'ava@lumen.example', 'Ava'), (2, 'ben@lumen.example', 'Ben')`);
    await h.rows(`insert into studio_categories (id, name) values (1, 'Movement')`);
    await h.rows(`insert into studio_services (id, name, category_id, price) values (1, 'Reformer', 1, 40), (2, 'Mat', 1, 60)`);
    await h.rows(`insert into studio_pack_products (id, name, price, uses, what, category_id) values (1, 'Movement Ten', 360, 2, 'category', 1)`);
    served = await servePublic(h as never, keyId, { ADMINIUM_DATA_DIR: h.dataDir });
    g = guest(served, h as never);
    const desk = await usersRepo(h.meta).create({ email: 'desk@lumen.example', name: 'Desk', passwordHash: await adminPasswordHash(), status: 'active' });
    await rolesRepo(h.meta).assignToUser(desk.id, (await rolesRepo(h.meta).findBySlug('super-admin'))!.id);
    const login = await served.composed.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'desk@lumen.example', password: ADMIN_PASSWORD } });
    cookie = sessionCookie(login.headers['set-cookie']);
    ava = await g.signIn('ava@lumen.example');
    ben = await g.signIn('ben@lumen.example');
  }, 600_000);
  afterAll(async () => {
    if (!run) return;
    if (trusted === undefined) delete process.env['ADMINIUM_ADD_ON_DEV_TRUST'];
    else process.env['ADMINIUM_ADD_ON_DEV_TRUST'] = trusted;
    await served.close();
    await h.close();
  });

  it.skipIf(!run)('a pack needs a signed-in buyer, and nothing exists until it is paid', async () => {
    expect((await buy()).statusCode).toBeGreaterThanOrEqual(400);
    const before = (await rows('offers_vouchers')).length;
    const bought = await buy(ava);
    expect(bought.statusCode, bought.body).toBe(201);
    expect(await rows('offers_vouchers')).toHaveLength(before);
    expect(dataOf(await list(PACKS, ava))).toEqual([]);
    // Given up before it was paid: nothing to undo, and no pack ever appears.
    const id = (bought.json() as { data: { id: number } }).data.id;
    const cancelled = await staff('PATCH', `studio_purchases/${String(id)}`, { cancelled_at: new Date().toISOString() });
    expect(cancelled.statusCode, cancelled.body).toBe(200);
    expect(await rows('offers_vouchers')).toHaveLength(before);
  });

  it.skipIf(!run)('paying makes it, sold, in the buyer\'s name, and mails it once', async () => {
    const pack = await packFor(ava);
    expect(pack).toMatchObject({ worth: 'pack', public_name: 'Movement Ten', uses_total: 2, holder_email: 'ava@lumen.example', status: 'issued' });
    expect(pack['holder_key']).toEqual(expect.any(String));
    expect(Number(pack['sale_price'])).toBe(360);
    const mails = await rows('offers_messages', `voucher_id = ${String(pack['id'])}`);
    expect(mails.map((mail) => mail['kind'])).toEqual(['voucher']);
    await staff('PATCH', `offers_vouchers/${String(pack['id'])}`, { status: 'voided' });
  });

  it.skipIf(!run)('a customer reads only what is held in the address they proved, with no code in the reply', async () => {
    const pack = await packFor(ava);
    const cardId = await card('Ava@Lumen.example', '25.00');
    const packs = await list(PACKS, ava);
    expect(packs.statusCode, packs.body).toBe(200);
    expect(dataOf(packs).map((row) => row['id'])).toContain(pack['id']);
    expect(Object.keys(dataOf(packs)[0]!).sort()).toEqual(['code_last4', 'expires_on', 'id', 'public_name', 'uses_left', 'uses_total', 'worth']);
    expect(packs.body).not.toContain(String(pack['code']));
    const cards = await list(CARDS, ava);
    expect(dataOf(cards).map((row) => row['id'])).toEqual([cardId]);
    expect(cards.body).not.toMatch(/GC-/);
    // Somebody else, and nobody at all, read none of it.
    expect(dataOf(await list(PACKS, ben))).toEqual([]);
    expect(dataOf(await list(CARDS, ben))).toEqual([]);
    expect((await list(PACKS)).statusCode).toBe(404);
    expect((await list(CARDS)).statusCode).toBe(404);
    await staff('PATCH', `offers_vouchers/${String(pack['id'])}`, { status: 'voided' });
    await h.rows(`update offers_gift_cards set status = 'void' where id = ${String(cardId)}`);
  });

  it.skipIf(!run)('one booking takes a pack and a card in one save, each named without its code', async () => {
    const pack = await packFor(ava);
    const cardId = await card('ava@lumen.example', '100.00');
    const handle = `held:${String(pack['id'])}`;
    // One use goes on a booking of its own: the pack then has one left.
    const first = await book(ava, { booking_codes: [{ typed: handle }] });
    expect(first.statusCode, first.body).toBe(201);
    expect(Number((first.json() as { data: Doc }).data['discount'])).toBe(40);
    expect(Number((await rows('offers_vouchers', `id = ${String(pack['id'])}`))[0]!['uses_left'])).toBe(1);
    // Two seats at $40: the last use covers one, and the card pays the other, in the same save.
    const both = await book(ava, { seats: 2, booking_codes: [{ typed: handle }], payments: [{ card_code: `held:${String(cardId)}` }] });
    expect(both.statusCode, both.body).toBe(201);
    const saved = (both.json() as { data: Doc }).data;
    expect(Number(saved['discount'])).toBe(40);
    expect(Number(saved['paid'])).toBe(40);
    expect(Number(saved['due'])).toBe(0);
    expect((await rows('offers_vouchers', `id = ${String(pack['id'])}`))[0]).toMatchObject({ status: 'used' });
    expect(Number((await rows('offers_vouchers', `id = ${String(pack['id'])}`))[0]!['uses_left'])).toBe(0);
    expect(Number((await rows('offers_gift_cards', `id = ${String(cardId)}`))[0]!['balance'])).toBe(60);
  });

  it.skipIf(!run)('a pack that covers the whole price leaves a card nothing to pay: the save is refused and spends neither', async () => {
    const pack = await packFor(ava);
    const cardId = await card('ava@lumen.example', '20.00');
    const refused = await book(ava, { booking_codes: [{ typed: `held:${String(pack['id'])}` }], payments: [{ card_code: `held:${String(cardId)}` }] });
    expect(refused.statusCode, refused.body).toBe(409);
    expect((refused.json() as { error: { code: string } }).error.code).toBe('PUBLIC_CARD_REFUSED');
    expect(Number((await rows('offers_vouchers', `id = ${String(pack['id'])}`))[0]!['uses_left'] ?? 2)).toBe(2);
    expect(Number((await rows('offers_gift_cards', `id = ${String(cardId)}`))[0]!['balance'])).toBe(20);
  });

  it.skipIf(!run)('a refund is refused once a use stands, and goes through once it was given back', async () => {
    const pack = await packFor(ava);
    const used = await book(ava, { booking_codes: [{ typed: `held:${String(pack['id'])}` }] });
    expect(used.statusCode, used.body).toBe(201);
    const refused = await staff('PATCH', `studio_purchases/${String(pack['purchase'])}`, { cancelled_at: new Date().toISOString() });
    expect(refused.statusCode, refused.body).toBe(409);
    expect((await rows('offers_vouchers', `id = ${String(pack['id'])}`))[0]!['status']).toBe('issued');
    const bookingId = (used.json() as { data: { id: number } }).data.id;
    const back = await staff('PATCH', `studio_bookings/${String(bookingId)}`, { cancelled_at: new Date().toISOString() });
    expect(back.statusCode, back.body).toBe(200);
    const undone = await staff('PATCH', `studio_purchases/${String(pack['purchase'])}`, { cancelled_at: new Date().toISOString() });
    expect(undone.statusCode, undone.body).toBe(200);
    expect((await rows('offers_vouchers', `id = ${String(pack['id'])}`))[0]!['status']).toBe('voided');
  });

  it.skipIf(!run)('a cancel, a new payment and a second cancel: each payment\'s pack is recalled', async () => {
    const bought = await buy(ava);
    expect(bought.statusCode, bought.body).toBe(201);
    const id = (bought.json() as { data: { id: number } }).data.id;
    const [line] = await rows('studio_purchase_lines', `purchase_id = ${String(id)}`);
    const packs = () => rows('offers_vouchers', `sale_row = '${String(line!['id'])}'`);
    const set = async (values: Doc) => {
      const res = await staff('PATCH', `studio_purchases/${String(id)}`, values);
      expect(res.statusCode, res.body).toBe(200);
    };
    // Given up before it was paid, then taken up again and paid.
    await set({ cancelled_at: new Date().toISOString() });
    await set({ cancelled_at: null });
    await set({ paid_at: new Date().toISOString() });
    expect((await packs()).map((pack) => pack['status'])).toEqual(['issued']);
    await set({ cancelled_at: new Date().toISOString() });
    expect((await packs()).map((pack) => pack['status'])).toEqual(['voided']);
    // Paid once more: a pack of its own, and the next cancel recalls that one too.
    await set({ paid_at: null, cancelled_at: null });
    await set({ paid_at: new Date().toISOString() });
    expect((await packs()).map((pack) => pack['status'])).toEqual(['voided', 'issued']);
    await set({ cancelled_at: new Date().toISOString() });
    expect((await packs()).map((pack) => pack['status'])).toEqual(['voided', 'voided']);
  });

  it.skipIf(!run)('two tabs on the last use: one booking gets it', async () => {
    const pack = await packFor(ava);
    const first = await book(ava, { booking_codes: [{ typed: `held:${String(pack['id'])}` }] });
    expect(first.statusCode, first.body).toBe(201);
    const typed = `held:${String(pack['id'])}`;
    const answers = await Promise.all([book(ava, { booking_codes: [{ typed }] }), book(ava, { booking_codes: [{ typed }] })]);
    expect(answers.map((res) => res.statusCode).filter((status) => status === 201), answers.map((res) => res.body).join('\n')).toHaveLength(1);
    expect((await rows('offers_vouchers', `id = ${String(pack['id'])}`))[0]).toMatchObject({ uses_left: 0 });
  });

  it.skipIf(!run)('one card, two bookings: it is never spent past what it holds', async () => {
    const cardId = await card('ava@lumen.example', '50.00');
    const handle = `held:${String(cardId)}`;
    const answers = await Promise.all([book(ava, { payments: [{ card_code: handle }] }), book(ava, { payments: [{ card_code: handle }] })]);
    // $50 pays the first $40 in full and the second booking's last $10: never more than it holds.
    expect(answers.map((res) => res.statusCode), answers.map((res) => res.body).join('\n')).toEqual([201, 201]);
    const [row] = await rows('offers_gift_cards', `id = ${String(cardId)}`);
    expect(Number(row!['balance'])).toBe(0);
    const spent = await rows('offers_card_ledger', `card_id = ${String(cardId)} and kind = 'spend'`);
    expect(spent.map((one) => Number(one['taken'])).sort((a, b) => a - b)).toEqual([10, 40]);
  });

  it.skipIf(!run)('a guest who types the holder\'s address spends neither a pack nor a card', async () => {
    const pack = await packFor(ava);
    const cardId = await card('ava@lumen.example', '30.00');
    const before = (await rows('offers_vouchers', `id = ${String(pack['id'])}`))[0]!['uses_left'];
    // By the row, by the pack's real code, and from another signed-in customer's session.
    for (const typed of [`held:${String(pack['id'])}`, String(pack['code'])]) {
      const res = await book(undefined, { booking_codes: [{ typed }] });
      expect(res.statusCode, res.body).toBeGreaterThanOrEqual(400);
      const other = await book(ben, { email: 'ben@lumen.example', booking_codes: [{ typed }] });
      expect(other.statusCode, other.body).toBeGreaterThanOrEqual(400);
    }
    expect((await rows('offers_vouchers', `id = ${String(pack['id'])}`))[0]!['uses_left']).toBe(before);
    for (const session of [undefined, ben]) {
      const res = await book(session, { ...(session === ben ? { email: 'ben@lumen.example' } : {}), payments: [{ card_code: `held:${String(cardId)}` }] });
      expect(res.statusCode, res.body).toBeGreaterThanOrEqual(400);
    }
    expect(Number((await rows('offers_gift_cards', `id = ${String(cardId)}`))[0]!['balance'])).toBe(30);
  });
});

describe.each(LEGS)('nobody but the holder spends what is held — %s', (dialect, available) => {
  const run = available && offers !== null;
  const logs: string[] = [];
  const replies: string[] = [];
  let h: Harness;
  let served: Served;
  let finder: Served;
  let linked: Served;
  let g: ReturnType<typeof guest>;
  let f: ReturnType<typeof guest>;
  let l: ReturnType<typeof guest>;
  let cookie = '';
  let ava = '';
  let ben = '';
  const trusted = process.env['ADMINIUM_ADD_ON_DEV_TRUST'];

  const staff = (method: string, url: string, payload?: unknown) =>
    served.composed.app.inject({ method: method as 'POST', url: `/api/v1/data/${h.connectionId}/${url}`, headers: { cookie }, ...(payload === undefined ? {} : { payload: { values: payload } as Doc }) });
  const one = async (table: string, id: unknown) => (await h.rows(`select * from ${table} where id = ${String(id)}`))[0]!;
  const kept = <T extends { body: string }>(res: T): T => {
    replies.push(res.body);
    return res;
  };
  const bookOn = (who: ReturnType<typeof guest>, ref: string, session: string | undefined, children: Doc, email = 'ava@lumen.example', proof = true) =>
    who
      .request('POST', `/records/${ref}`, { ...(proof ? { proof: 'write' as const } : {}), ...(session === undefined ? {} : { session }), payload: { values: { service_id: 1, email }, children } })
      .then(kept);
  const typedCode = (typed: string) => ({ booking_codes: [{ values: { typed } }] });
  const cardCode = (card_code: string) => ({ payments: [{ values: { card_code } }] });
  const book = (session: string | undefined, children: Doc, email?: string) => bookOn(g, 'studio_bookings_verified', session, children, email);
  /** A pack held by Ava, sold at the desk, with so many uses. */
  const pack = async (status = 'issued', more = ''): Promise<Doc> => {
    await h.rows(`insert into offers_vouchers (code, worth, what, source_table, source_row, units, public_name, uses_total, holder_email, holder_key, sold, status${more === '' ? '' : ', expires_on'}) select 'PACK' || '${String(nextCode())}', 'pack', 'category', 'studio:categories', '1', 1, 'Movement Ten', 2, 'ava@lumen.example', holder_key, ${dialect === 'postgres' ? 'true' : '1'}, '${status}'${more === '' ? '' : `, '${more}'`} from offers_vouchers where holder_email = 'ava@lumen.example' limit 1`.replace("'PACK' || '", dialect === 'mysql' ? "CONCAT('PACK', '" : "'PACK' || '").replace(dialect === 'mysql' ? "', 'pack'," : '\u0000', dialect === 'mysql' ? "'), 'pack'," : ''));
    const rows = await h.rows(`select * from offers_vouchers where holder_email = 'ava@lumen.example' order by id desc limit 1`);
    return rows[0]!;
  };
  let codes = 0;
  const nextCode = () => {
    codes += 1;
    return String(100000 + codes);
  };
  const card = async (amount: string): Promise<number> => {
    const made = await staff('POST', 'offers_gift_cards', { kind: 'card', recipient_email: 'ava@lumen.example' });
    expect(made.statusCode, made.body).toBe(201);
    const id = (made.json() as { data: { id: number } }).data.id;
    const loaded = await staff('POST', 'offers_card_actions', { card_id: id, action: 'issue', amount, reason: 'Sold at the desk' });
    expect(loaded.statusCode, loaded.body).toBe(201);
    return id;
  };
  /** A real pack, bought and paid for by Ava: the row every other pack here copies its holder's key from. */
  const firstPack = async (): Promise<Doc> => {
    const bought = await g.request('POST', '/records/studio_purchases_verified', { session: ava, payload: { values: { note: 'A pack' }, children: { purchase_lines: [{ values: { pack_product_id: 1 } }] } } });
    expect(bought.statusCode, bought.body).toBe(201);
    const id = (bought.json() as { data: { id: number } }).data.id;
    expect((await staff('PATCH', `studio_purchases/${String(id)}`, { paid_at: new Date().toISOString() })).statusCode).toBe(200);
    return (await h.rows("select * from offers_vouchers where holder_email = 'ava@lumen.example' order by id desc limit 1"))[0]!;
  };
  let held: Doc;
  let cardId = 0;
  const untouched = async () => {
    expect(Number((await one('offers_vouchers', held['id']))['uses_left'] ?? 2)).toBe(2);
    expect(Number((await one('offers_gift_cards', cardId))['balance'])).toBe(30);
  };

  beforeAll(async () => {
    if (!run) return;
    process.env['ADMINIUM_ADD_ON_DEV_TRUST'] = OFFERS;
    h = await addOnHarness(dialect, { unbuiltWords: {} });
    await h.stageApp(studio());
    const installed = await h.install('studio', '1.0.0');
    expect(installed.statusCode, installed.body).toBe(200);
    const access = (installed.json() as { publicAccess: { keyId: string; keys: Record<string, string> } }).publicAccess;
    await h.stageApp(finderStudio());
    const second = await h.install('finder', '1.0.0');
    expect(second.statusCode, second.body).toBe(200);
    const finderKey = (second.json() as { publicAccess: { keyId: string } }).publicAccess.keyId;
    await h.stageAddOn(offers!.manifest, { bundled: true, files: offers!.files });
    const added = await h.inject({ method: 'POST', url: '/add-ons', payload: { key: OFFERS, version: offers!.version, attachTo: ['studio', 'finder'], publicAccess: true } });
    expect(added.statusCode, added.body).toBe(200);
    await mailReady(h.meta);
    for (const app of ['studio', 'finder']) {
      await h.rows(`insert into ${app}_customers (id, email, name) values (1, 'ava@lumen.example', 'Ava'), (2, 'ben@lumen.example', 'Ben')`);
      await h.rows(`insert into ${app}_categories (id, name) values (1, 'Movement')`);
      await h.rows(`insert into ${app}_services (id, name, category_id, price) values (1, 'Reformer', 1, 40)`);
      await h.rows(`insert into ${app}_pack_products (id, name, price, uses, what, category_id) values (1, 'Movement Ten', 360, 2, 'category', 1)`);
    }
    const logger = pino({ level: 'trace' }, { write: (line: string) => void logs.push(line) });
    served = await servePublic(h as never, access.keyId, { ADMINIUM_DATA_DIR: h.dataDir }, { logger: logger as never });
    finder = await servePublic(h as never, finderKey, { ADMINIUM_DATA_DIR: h.dataDir });
    linked = await servePublic(h as never, access.keys['link']!, { ADMINIUM_DATA_DIR: h.dataDir });
    g = guest(served, h as never);
    f = guest(finder, h as never, 3000);
    l = guest(linked, h as never, 6000);
    const desk = await usersRepo(h.meta).create({ email: 'desk@lumen.example', name: 'Desk', passwordHash: await adminPasswordHash(), status: 'active' });
    await rolesRepo(h.meta).assignToUser(desk.id, (await rolesRepo(h.meta).findBySlug('super-admin'))!.id);
    const login = await served.composed.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'desk@lumen.example', password: ADMIN_PASSWORD } });
    cookie = sessionCookie(login.headers['set-cookie']);
    ava = await g.signIn('ava@lumen.example');
    ben = await g.signIn('ben@lumen.example');
    held = await firstPack();
    cardId = await card('30.00');
  }, 600_000);
  afterAll(async () => {
    if (!run) return;
    if (trusted === undefined) delete process.env['ADMINIUM_ADD_ON_DEV_TRUST'];
    else process.env['ADMINIUM_ADD_ON_DEV_TRUST'] = trusted;
    await linked.close();
    await finder.close();
    await served.close();
    await h.close();
  });

  it.skipIf(!run)('no session: a guest who types the holder\'s address names neither by its row', async () => {
    expect((await book(undefined, typedCode(`held:${String(held['id'])}`))).statusCode).toBeGreaterThanOrEqual(400);
    expect((await book(undefined, cardCode(`held:${String(cardId)}`))).statusCode).toBeGreaterThanOrEqual(400);
    await untouched();
  });

  it.skipIf(!run)('another customer\'s session: their own address is not the holder\'s', async () => {
    expect((await book(ben, typedCode(`held:${String(held['id'])}`), 'ben@lumen.example')).statusCode).toBeGreaterThanOrEqual(400);
    expect((await book(ben, cardCode(`held:${String(cardId)}`), 'ben@lumen.example')).statusCode).toBeGreaterThanOrEqual(400);
    await untouched();
  });

  it.skipIf(!run)('a session that only found the person: it reads nothing and spends nothing', async () => {
    const found = await f.request('POST', '/claim', { payload: { match: { email: 'ava@lumen.example', name: 'Ava' } } });
    expect(found.statusCode, found.body).toBe(200);
    const session = (found.json() as { data: { session: string } }).data.session;
    const packs = await f.request('GET', `/records/${PACKS}`, { session });
    expect(packs.statusCode, packs.body).toBe(403);
    expect((await f.request('GET', `/records/${CARDS}`, { session })).statusCode).toBe(403);
    expect((await bookOn(f, 'finder_bookings_claimed', session, typedCode(`held:${String(held['id'])}`), 'ava@lumen.example', false)).statusCode).toBeGreaterThanOrEqual(400);
    expect((await bookOn(f, 'finder_bookings_claimed', session, cardCode(`held:${String(cardId)}`), 'ava@lumen.example', false)).statusCode).toBeGreaterThanOrEqual(400);
    await untouched();
  });

  it.skipIf(!run)('a booking\'s own link: whoever holds it adds no pack to it, even a booking in the holder\'s name', async () => {
    // A stranger books in Ava's address, so the booking is linked to her, and keeps its link.
    const made = await book(undefined, {});
    expect(made.statusCode, made.body).toBe(201);
    const reply = made.json() as { data: { id: number }; link: { token: string } };
    const opened = await l.request('POST', '/claim/token', { payload: { token: reply.link.token } });
    expect(opened.statusCode, opened.body).toBe(200);
    const session = (opened.json() as { data: { session: string } }).data.session;
    expect((await l.request('GET', `/records/${PACKS}`, { session })).statusCode).toBe(404);
    expect((await l.request('GET', `/records/${CARDS}`, { session })).statusCode).toBe(404);
    const added = kept(await l.request('POST', '/records/studio_booking_codes_verified', { session, payload: { values: { booking_id: reply.data.id, typed: `held:${String(held['id'])}` } } }));
    expect(added.statusCode, added.body).toBeGreaterThanOrEqual(400);
    expect(Number((await one('studio_bookings', reply.data.id))['discount'])).toBe(0);
    await untouched();
  });

  it.skipIf(!run)('a forwarded link to the holder\'s own proved booking adds no pack to it', async () => {
    const made = await book(ava, {});
    expect(made.statusCode, made.body).toBe(201);
    const reply = made.json() as { data: { id: number }; link: { token: string } };
    expect((await one('studio_bookings', reply.data.id))['customer_proved']).toBeTruthy();
    const opened = await l.request('POST', '/claim/token', { payload: { token: reply.link.token } });
    const session = (opened.json() as { data: { session: string } }).data.session;
    const added = kept(await l.request('POST', '/records/studio_booking_codes_verified', { session, payload: { values: { booking_id: reply.data.id, typed: `held:${String(held['id'])}` } } }));
    expect(added.statusCode, added.body).toBeGreaterThanOrEqual(400);
    expect(Number((await one('studio_bookings', reply.data.id))['discount'])).toBe(0);
    await untouched();
  });

  it.skipIf(!run)('a look-alike address reads and spends nothing of the real one\'s', async () => {
    // On MySQL's default collation these two compare equal. Cara has a card and no customer row; the other is somebody else.
    const made = await staff('POST', 'offers_gift_cards', { kind: 'card', recipient_email: 'cara@lumen.example' });
    const caraCard = (made.json() as { data: { id: number } }).data.id;
    expect((await staff('POST', 'offers_card_actions', { card_id: caraCard, action: 'issue', amount: '25.00', reason: 'Sold at the desk' })).statusCode).toBe(201);
    await h.rows("insert into studio_customers (id, email, name) values (3, 'c\u00e0ra@lumen.example', 'Twin')");
    const twin = await g.signIn('c\u00e0ra@lumen.example');
    const cards = await g.request('GET', `/records/${CARDS}`, { session: twin });
    expect(cards.statusCode, cards.body).toBe(200);
    expect((cards.json() as { data: Doc[] }).data).toEqual([]);
    expect((await book(twin, cardCode(`held:${String(caraCard)}`), 'c\u00e0ra@lumen.example')).statusCode).toBeGreaterThanOrEqual(400);
    expect(Number((await one('offers_gift_cards', caraCard))['balance'])).toBe(25);
  });

  it.skipIf(!run)('a card dated for a later day is neither listed nor spent before it', async () => {
    const dated = await card('15.00');
    const later = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
    await h.rows(`update offers_gift_cards set send_on = '${later}', notify = 'card_dated' where id = ${String(dated)}`);
    const listed = async () => ((await g.request('GET', `/records/${CARDS}`, { session: ava })).json() as { data: Doc[] }).data.map((row) => Number(row['id']));
    expect(await listed()).not.toContain(dated);
    expect((await book(ava, cardCode(`held:${String(dated)}`))).statusCode).toBeGreaterThanOrEqual(400);
    expect(Number((await one('offers_gift_cards', dated))['balance'])).toBe(15);
    const past = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
    await h.rows(`update offers_gift_cards set send_on = '${past}' where id = ${String(dated)}`);
    expect(await listed()).toContain(dated);
    await h.rows(`update offers_gift_cards set status = 'void' where id = ${String(dated)}`);
  });

  it.skipIf(!run)('a key past what any key column holds is an unknown code, and never a server error', async () => {
    for (const typed of ['held:99999999999', 'held:2147483648']) {
      const code = await book(ava, typedCode(typed));
      expect(code.statusCode, code.body).toBeGreaterThanOrEqual(400);
      expect(code.statusCode, code.body).toBeLessThan(500);
      const pay = await book(ava, cardCode(typed));
      expect(pay.statusCode, pay.body).toBeGreaterThanOrEqual(400);
      expect(pay.statusCode, pay.body).toBeLessThan(500);
    }
  });

  it.skipIf(!run)('a row nobody holds, or that is not there, is the answer an unknown code gets', async () => {
    await h.rows(`update offers_vouchers set holder_email = null, holder_key = null where id = ${String((await pack())['id'])}`);
    const nobodys = (await h.rows('select id from offers_vouchers where holder_key is null order by id desc limit 1'))[0]!;
    const free = await book(ava, typedCode(`held:${String(nobodys['id'])}`));
    const none = await book(ava, typedCode('held:999999'));
    expect(free.statusCode).toBeGreaterThanOrEqual(400);
    expect(free.body).toBe(none.body);
  });

  it.skipIf(!run)('even the holder cannot spend a pack that is cancelled, past its day or used up', async () => {
    const voided = await pack('voided');
    const late = await pack('issued', '2020-01-01');
    const spent = await pack('used');
    await h.rows(`update offers_vouchers set uses_taken = 2, uses_left = 0 where id = ${String(spent['id'])}`);
    for (const row of [voided, late, spent]) {
      const res = await book(ava, typedCode(`held:${String(row['id'])}`));
      expect(res.statusCode, `${String(row['status'])}: ${res.body}`).toBeGreaterThanOrEqual(400);
    }
  });

  it.skipIf(!run)('even the holder cannot spend a card that is cancelled, past its day or empty', async () => {
    const voided = await card('10.00');
    await h.rows(`update offers_gift_cards set status = 'void' where id = ${String(voided)}`);
    const late = await card('10.00');
    await h.rows(`update offers_gift_cards set expires_on = '2020-01-01' where id = ${String(late)}`);
    const empty = await card('10.00');
    await h.rows(`update offers_gift_cards set balance = 0 where id = ${String(empty)}`);
    for (const id of [voided, late, empty]) {
      const res = await book(ava, cardCode(`held:${String(id)}`));
      expect(res.statusCode, `card ${String(id)}: ${res.body}`).toBeGreaterThanOrEqual(400);
    }
  });

  it.skipIf(!run)('the holder can: their own pack and card go through by the row alone', async () => {
    const res = await book(ava, typedCode(`held:${String(held['id'])}`));
    expect(res.statusCode, res.body).toBe(201);
    expect(Number((await one('offers_vouchers', held['id']))['uses_left'])).toBe(1);
    const paid = await book(ava, cardCode(`held:${String(cardId)}`));
    expect(paid.statusCode, paid.body).toBe(201);
    expect(Number((await one('offers_gift_cards', cardId))['balance'])).toBe(0);
    // A desk saving that payment back whole, with the row name in it, is no new lookup.
    const bookingId = (paid.json() as { data: { id: number } }).data.id;
    const [payment] = await h.rows(`select * from studio_payments where booking_id = ${String(bookingId)}`);
    const resaved = await staff('PATCH', `studio_payments/${String(payment!['id'])}`, { card_code: `held:${String(cardId)}` });
    expect(resaved.statusCode, resaved.body).toBe(200);
    expect(Number((await one('studio_payments', payment!['id']))['card_id'])).toBe(cardId);
  });

  it.skipIf(!run)('no reply and no line of the log ever carries a code', async () => {
    const rows = [...(await h.rows('select code from offers_vouchers')), ...(await h.rows('select code from offers_gift_cards where code is not null'))];
    expect(rows.length).toBeGreaterThan(3);
    const said = `${replies.join('\n')}\n${logs.join('')}`;
    expect(logs.length).toBeGreaterThan(0);
    for (const row of rows) expect(said.includes(String(row['code'])), 'a code was said').toBe(false);
  });
});
