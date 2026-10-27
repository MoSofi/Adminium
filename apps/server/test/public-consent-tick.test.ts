// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A STRANGER'S CONSENT TICK, over the public API of a shop installed by the
 * real installer, on SQLite, Postgres and MySQL. The shop's customers declare
 * `opt_in` as the newsletter's consent column; an order carries the tick
 * ("Email me about new dishes"), on its create and on a change at "Confirm",
 * with the sentence declared in two languages.
 *
 *  - A tick on the PATCH at confirm writes one form-sourced row in the consent
 *    log: the declared sentence in the buyer's language and its version, the
 *    network address and the browser, keyed to the customer (not the order);
 *    the customer's `opt_in` is set through the column door.
 *  - An unticked confirm writes nothing (it is no withdrawal).
 *  - A tick sent while signed in, with another customer's address typed,
 *    reaches only the one signed in: the order is theirs, and so is the
 *    tick. Nobody signed in, it is the typed address's.
 *  - Anybody's tick (no mailbox proved) never overrules a "no" standing in
 *    the log or on the do-not-email list: it writes nothing and leaves the
 *    column at no. Signed in by the link mailed to them, the customer's own
 *    tick counts. A customer signed in as themselves who signs somebody
 *    else's address up has proved nothing about that mailbox: the same.
 *  - "Delete my details" appends the customer's withdrawal before it empties
 *    the column: the log says yes, then no, from the person, and nothing else.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { parseDatabaseModel } from '@adminium/engine';
import { consentLogRepo, snapshotsRepo } from '@adminium/meta';

import { createConsentService } from '../src/consent/index.js';
import { TEST_SECRET } from './helpers.js';
import { installInvoicing, LEGS, type InvoicingHarness } from './invoicing-install.helpers.js';
import { guest, mailReady, shopManifest } from './person-fixture.js';
import { servePublic, type Served } from './public-lane.helpers.js';

// The people word and the public tick are read from the release to come.
vi.mock('../src/version.js', () => ({ APP_VERSION: '0.3.37' }));

type Doc = Record<string, unknown>;

const WORDING = { version: 1, text: { 'en-US': 'Email me about new dishes', 'fr-FR': 'Envoyez-moi les nouveaux plats' } };

function tickingShop(): Doc {
  const manifest = shopManifest({
    orders: {
      columns: [
        { ref: 'opt_in', type: 'bool', default: false },
        { ref: 'language', type: 'text', maxLength: 8, nullable: true },
      ],
    },
    entries: (entries) =>
      entries.map((entry) => {
        const methods = (entry['methods'] as string[]).join();
        if (entry['table'] === 'customers') return { ...entry, forget: { columns: ['email', 'name', 'phone', 'opt_in'], stamp: 'forgotten_at' } };
        if (entry['table'] === 'orders' && methods === 'POST') {
          return {
            ...entry,
            writable: [...(entry['writable'] as string[]), 'opt_in', 'language'],
            identity: { table: 'customers', email: 'email', link: 'customer_id', fill: { name: 'name', language: 'language' } },
            consent: { column: 'opt_in', purpose: 'newsletter', wording: WORDING },
          };
        }
        if (entry['table'] === 'orders' && entry['key'] === undefined && methods === 'GET') {
          return { ...entry, methods: ['GET', 'PATCH'], writable: ['opt_in'], consent: { column: 'opt_in', purpose: 'newsletter', wording: WORDING } };
        }
        return entry;
      })
        // A newsletter sign-up straight into a people table: its consent column is written by the stranger's own create.
        .concat([{ table: 'subscribers', methods: ['POST'], humanCheck: true, select: ['id'], writable: ['email', 'opt_in'], requires: ['email'] }]),
  });
  (manifest['requiredSchema'] as { tables: Doc[] }).tables.push({
    ref: 'subscribers',
    columns: [{ ref: 'id', type: 'int', role: 'pk' }, { ref: 'email', type: 'text', maxLength: 254, rules: { normalize: 'email', validation: { format: 'email' } } }, { ref: 'name', type: 'text', maxLength: 60, nullable: true }, { ref: 'opt_in', type: 'bool', default: false }],
  });
  const customers = (manifest['requiredSchema'] as { tables: Doc[] }).tables.find((table) => table['ref'] === 'customers')!;
  (customers['columns'] as Doc[]).push({ ref: 'opt_in', type: 'bool', default: false }, { ref: 'language', type: 'text', maxLength: 8, nullable: true });
  manifest['people'] = [
    { table: 'customers', kind: 'people', email: 'email', name: 'name', language: 'language', consent: { column: 'opt_in', purpose: 'newsletter' } },
    { table: 'subscribers', kind: 'people', email: 'email', name: 'name', consent: { column: 'opt_in', purpose: 'newsletter' } },
  ];
  (manifest['outbox'] as Doc)['classes'] = { 'order-placed': 'service' };
  manifest['compatibility'] = { minAdminiumVersion: '0.3.37' };
  return manifest;
}

const yes = (value: unknown): boolean => value === true || value === 1 || value === '1';

describe.each(LEGS)('a stranger\'s consent tick — %s', (dialect, available) => {
  let h: InvoicingHarness & { reply: Record<string, unknown> };
  let shop: Served;
  let g: ReturnType<typeof guest>;
  let customersId = '';
  beforeAll(async () => {
    if (!available) return;
    h = await installInvoicing(dialect, tickingShop());
    await mailReady(h.meta);
    const keys = (h.reply['publicAccess'] as { keys: Record<string, string> }).keys;
    shop = await servePublic(h, keys['customer']!);
    g = guest(shop, h);
    const model = parseDatabaseModel((await snapshotsRepo(h.meta).latest(h.connectionId))!.schema);
    customersId = model.tables.find((table) => table.name === h.real('customers'))!.id;
  }, 180_000);
  afterAll(async () => {
    if (!available) return;
    await shop.close();
    await h.close();
  });

  const customerOf = async (email: string) => (await h.rows(`select * from ${h.real('customers')} where email = '${email}'`))[0]!;
  const logOf = async (key: unknown) => (await consentLogRepo(h.meta).history({ person: { connectionId: h.connectionId, table: customersId, key: String(key) }, hashes: [] }, { limit: 20 })).reverse();
  const order = async (values: Record<string, unknown>, session?: string) =>
    g.request('POST', `/records/${h.real('orders')}_verified_2`, { payload: { values, children: { order_items: [{ values: { dish: 'Soup', qty: 1 } }] } }, proof: 'write', ...(session === undefined ? {} : { session }) });

  it.skipIf(!available)('a tick on the PATCH at confirm writes one form row, in the buyer\'s language, for the customer', async () => {
    const made = await order({ email: 'ines@fieldmail.io', name: 'Ines', language: 'fr-FR' });
    expect(made.statusCode, made.body).toBe(201);
    const orderId = (made.json() as { data: { id: number } }).data.id;
    const ines = await customerOf('ines@fieldmail.io');
    // Left unticked on the create: nothing.
    expect(await logOf(ines['id'])).toEqual([]);
    const session = await g.signIn('ines@fieldmail.io');
    const confirm = await g.request('PATCH', `/records/${h.real('orders')}_verified/${String(orderId)}`, { session, payload: { values: { opt_in: true } }, address: '10.77.0.9' });
    expect(confirm.statusCode, confirm.body).toBe(200);
    const log = await logOf(ines['id']);
    expect(log.map((row) => [row.state, row.source, row.purpose, row.wording, row.wordingVersion, row.ip, row.detail, row.staffId])).toEqual([
      ['yes', 'form', 'newsletter', 'Envoyez-moi les nouveaux plats', 'v1 fr-FR', '10.77.0.9', 'shop:orders', null],
    ]);
    expect(log[0]!.userAgent).toEqual(expect.any(String));
    // The customer's own column, set through the column door.
    expect(yes((await customerOf('ines@fieldmail.io'))['opt_in'])).toBe(true);
    // The same tick sent again ticks nothing new.
    const again = await g.request('PATCH', `/records/${h.real('orders')}_verified/${String(orderId)}`, { session, payload: { values: { opt_in: true } } });
    expect(again.statusCode, again.body).toBe(200);
    expect(await logOf(ines['id'])).toHaveLength(1);
  });

  it.skipIf(!available)('an unticked confirm writes nothing', async () => {
    const made = await order({ email: 'nora@fieldmail.io', name: 'Nora' });
    expect(made.statusCode, made.body).toBe(201);
    const orderId = (made.json() as { data: { id: number } }).data.id;
    const session = await g.signIn('nora@fieldmail.io');
    const confirm = await g.request('PATCH', `/records/${h.real('orders')}_verified/${String(orderId)}`, { session, payload: { values: { opt_in: false } } });
    expect(confirm.statusCode, confirm.body).toBe(200);
    const nora = await customerOf('nora@fieldmail.io');
    expect(await logOf(nora['id'])).toEqual([]);
    expect(yes(nora['opt_in'])).toBe(false);
  });

  it.skipIf(!available)('a tick sent for another customer reaches only the one signed in; anonymous, it is the address typed\'s, in English when nothing else is asked', async () => {
    expect((await order({ email: 'otto@fieldmail.io', name: 'Otto' })).statusCode).toBe(201);
    expect((await order({ email: 'pia@fieldmail.io', name: 'Pia' })).statusCode).toBe(201);
    const otto = await customerOf('otto@fieldmail.io');
    const pia = await customerOf('pia@fieldmail.io');
    const session = await g.signIn('pia@fieldmail.io');
    // Pia, signed in, types Otto's address and ticks: the order is hers, and so is the tick.
    const aimed = await order({ email: 'otto@fieldmail.io', name: 'Pia', opt_in: true }, session);
    expect(aimed.statusCode, aimed.body).toBe(201);
    const made = (await h.rows(`select customer_id, email from ${h.real('orders')} where id = ${String((aimed.json() as { data: { id: number } }).data.id)}`))[0]!;
    expect([String(made['customer_id']), made['email']]).toEqual([String(pia['id']), 'pia@fieldmail.io']);
    expect(await logOf(otto['id'])).toEqual([]);
    expect(yes((await customerOf('otto@fieldmail.io'))['opt_in'])).toBe(false);
    expect((await logOf(pia['id'])).map((row) => [row.state, row.source, row.wordingVersion, row.wording])).toEqual([['yes', 'form', 'v1 en-US', 'Email me about new dishes']]);
    // Nobody signed in: the tick is the typed address's, as on any checkout.
    expect((await order({ email: 'otto@fieldmail.io', name: 'Otto', opt_in: true })).statusCode).toBe(201);
    expect((await logOf(otto['id'])).map((row) => [row.state, row.source])).toEqual([['yes', 'form']]);
  });

  it.skipIf(!available)('anybody\'s tick never overrules a "no", in the log or on the do-not-email list; the customer signed in still changes their mind', async () => {
    const consent = createConsentService({ meta: h.meta, secret: TEST_SECRET });
    const personOf = (row: Record<string, unknown>) => ({ connectionId: h.connectionId, table: customersId, key: String(row['id']) });
    // Quinn said no (an unsubscribe that knew her row).
    expect((await order({ email: 'quinn@fieldmail.io', name: 'Quinn' })).statusCode).toBe(201);
    const quinn = await customerOf('quinn@fieldmail.io');
    await consent.withdraw({ person: personOf(quinn), address: 'quinn@fieldmail.io', purpose: 'newsletter', source: 'unsubscribe', detail: 'link' });
    // Somebody, signed in as nobody, types her address and ticks: the order is made, the tick writes nothing.
    expect((await order({ email: 'quinn@fieldmail.io', name: 'Quinn', opt_in: true })).statusCode).toBe(201);
    expect((await logOf(quinn['id'])).map((row) => [row.state, row.source])).toEqual([['no', 'unsubscribe']]);
    expect(yes((await customerOf('quinn@fieldmail.io'))['opt_in'])).toBe(false);
    // A "no" the mail door wrote by the address alone holds the same.
    expect((await order({ email: 'sam@fieldmail.io', name: 'Sam' })).statusCode).toBe(201);
    await consent.withdraw({ address: 'sam@fieldmail.io', purpose: 'newsletter', source: 'unsubscribe', detail: 'one-click' });
    expect((await order({ email: 'sam@fieldmail.io', name: 'Sam', opt_in: true })).statusCode).toBe(201);
    const sam = await customerOf('sam@fieldmail.io');
    expect(await logOf(sam['id'])).toEqual([]);
    expect((await consent.stateFor({ person: personOf(sam), address: 'sam@fieldmail.io' }, 'newsletter')).state).toBe('no');
    expect(yes(sam['opt_in'])).toBe(false);
    // So does the do-not-email list, with nothing in the log.
    expect((await order({ email: 'rex@fieldmail.io', name: 'Rex' })).statusCode).toBe(201);
    await consent.stop.add({ address: 'rex@fieldmail.io', reason: 'link' });
    expect((await order({ email: 'rex@fieldmail.io', name: 'Rex', opt_in: true })).statusCode).toBe(201);
    const rex = await customerOf('rex@fieldmail.io');
    expect(await logOf(rex['id'])).toEqual([]);
    expect(yes(rex['opt_in'])).toBe(false);
    // With nothing standing, an anonymous tick still counts (as on any checkout): Tess.
    expect((await order({ email: 'tess@fieldmail.io', name: 'Tess', opt_in: true })).statusCode).toBe(201);
    expect((await logOf((await customerOf('tess@fieldmail.io'))['id'])).map((row) => row.state)).toEqual(['yes']);
    // Quinn herself, signed in by the link mailed to her, ticks at confirm: her own tick counts.
    const mine = await order({ email: 'quinn@fieldmail.io', name: 'Quinn' });
    const session = await g.signIn('quinn@fieldmail.io');
    const confirm = await g.request('PATCH', `/records/${h.real('orders')}_verified/${String((mine.json() as { data: { id: number } }).data.id)}`, { session, payload: { values: { opt_in: true } } });
    expect(confirm.statusCode, confirm.body).toBe(200);
    expect((await logOf(quinn['id'])).map((row) => [row.state, row.source])).toEqual([
      ['no', 'unsubscribe'],
      ['yes', 'form'],
    ]);
    expect(yes((await customerOf('quinn@fieldmail.io'))['opt_in'])).toBe(true);
  });

  it.skipIf(!available)('a stranger\'s sign-up that sets the consent column itself is held to the same rule', async () => {
    const consent = createConsentService({ meta: h.meta, secret: TEST_SECRET });
    const signUp = (email: string) => g.request('POST', `/records/${h.real('subscribers')}`, { payload: { values: { email, opt_in: true } }, proof: 'write' });
    const subscriberOf = async (email: string) => (await h.rows(`select * from ${h.real('subscribers')} where email = '${email}'`))[0]!;
    const subscribersId = parseDatabaseModel((await snapshotsRepo(h.meta).latest(h.connectionId))!.schema).tables.find((table) => table.name === h.real('subscribers'))!.id;
    const subscriberLog = async (key: unknown) => consentLogRepo(h.meta).history({ person: { connectionId: h.connectionId, table: subscribersId, key: String(key) }, hashes: [] }, { limit: 20 });
    // Una unsubscribed by her address alone, before she had a row.
    await consent.withdraw({ address: 'una@fieldmail.io', purpose: 'newsletter', source: 'unsubscribe', detail: 'one-click' });
    const made = await signUp('una@fieldmail.io');
    expect(made.statusCode, made.body).toBe(201);
    const una = await subscriberOf('una@fieldmail.io');
    // The log hears nothing, and the column is put back to what the log says.
    expect(await subscriberLog(una['id'])).toEqual([]);
    expect(yes(una['opt_in'])).toBe(false);
    // Only the do-not-email list stands against Uma (nothing in the log): the column is put back to no all the
    // same, so taking her off the list later never turns the stranger's yes into hers.
    await consent.stop.add({ address: 'uma@fieldmail.io', reason: 'link' });
    expect((await signUp('uma@fieldmail.io')).statusCode).toBe(201);
    const uma = await subscriberOf('uma@fieldmail.io');
    expect(await subscriberLog(uma['id'])).toEqual([]);
    expect(yes(uma['opt_in'])).toBe(false);
    // With nothing standing, the sign-up's yes is the person's own, as before.
    expect((await signUp('vic@fieldmail.io')).statusCode).toBe(201);
    const vic = await subscriberOf('vic@fieldmail.io');
    expect((await subscriberLog(vic['id'])).map((row) => [row.state, row.source])).toEqual([['yes', 'person']]);
    expect(yes(vic['opt_in'])).toBe(true);
  });

  it.skipIf(!available)('a customer who proved their own mailbox cannot overrule another person\'s "no"; that person, signed in, still can', async () => {
    const consent = createConsentService({ meta: h.meta, secret: TEST_SECRET });
    const subscribed = async (email: string) => (await h.rows(`select * from ${h.real('subscribers')} where email = '${email}' order by id`)).map((row) => yes(row['opt_in']));
    const signUp = (email: string, session: string) => g.request('POST', `/records/${h.real('subscribers')}`, { payload: { values: { email, opt_in: true } }, proof: 'write', session });
    // Wes, a customer, unsubscribed by the mail door (his address alone).
    expect((await order({ email: 'wes@fieldmail.io', name: 'Wes' })).statusCode).toBe(201);
    await consent.withdraw({ address: 'wes@fieldmail.io', purpose: 'newsletter', source: 'unsubscribe', detail: 'one-click' });
    // Mallory signs in by the link mailed to HER, and signs Wes up, ticked: the row is made, his "no" stands.
    expect((await order({ email: 'mallory@fieldmail.io', name: 'Mallory' })).statusCode).toBe(201);
    const mallory = await g.signIn('mallory@fieldmail.io');
    const made = await signUp('wes@fieldmail.io', mallory);
    expect(made.statusCode, made.body).toBe(201);
    expect((await consent.stateFor({ address: 'wes@fieldmail.io' }, 'newsletter')).state).toBe('no');
    expect(await subscribed('wes@fieldmail.io')).toEqual([false]);
    // The same over a do-not-email entry alone.
    expect((await order({ email: 'wyn@fieldmail.io', name: 'Wyn' })).statusCode).toBe(201);
    await consent.stop.add({ address: 'wyn@fieldmail.io', reason: 'link' });
    expect((await signUp('Wyn@Fieldmail.io ', mallory)).statusCode).toBe(201);
    expect(await subscribed('wyn@fieldmail.io')).toEqual([false]);
    // Wes himself, signed in by the link mailed to him: his own yes counts.
    const wes = await g.signIn('wes@fieldmail.io');
    const own = await signUp('wes@fieldmail.io', wes);
    expect(own.statusCode, own.body).toBe(201);
    expect((await consent.stateFor({ address: 'wes@fieldmail.io' }, 'newsletter')).state).toBe('yes');
    expect(await subscribed('wes@fieldmail.io')).toEqual([false, true]);
  });

  it.skipIf(!available)('"delete my details" appends the withdrawal first, from the person, and nothing more', async () => {
    const made = await order({ email: 'vera@fieldmail.io', name: 'Vera', opt_in: true });
    expect(made.statusCode, made.body).toBe(201);
    const vera = await customerOf('vera@fieldmail.io');
    expect(yes(vera['opt_in'])).toBe(true);
    const session = await g.signIn('vera@fieldmail.io');
    const gone = await g.request('DELETE', '/account', { session });
    expect(gone.statusCode, gone.body).toBe(200);
    const after = (await h.rows(`select * from ${h.real('customers')} where id = ${String(vera['id'])}`))[0]!;
    expect(yes(after['opt_in'])).toBe(false);
    // Had the column been emptied first, the log would hold the write's own "no" (from the person's page) beside it.
    expect((await logOf(vera['id'])).map((row) => [row.state, row.source, row.detail])).toEqual([
      ['yes', 'form', 'shop:orders'],
      ['no', 'person', 'forget'],
    ]);
  });
});
