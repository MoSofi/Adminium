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
 *  - "Delete my details" appends the customer's withdrawal before it empties
 *    the column: the log says yes, then no, from the person, and nothing else.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { parseDatabaseModel } from '@adminium/engine';
import { consentLogRepo, snapshotsRepo } from '@adminium/meta';

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
      }),
  });
  const customers = (manifest['requiredSchema'] as { tables: Doc[] }).tables.find((table) => table['ref'] === 'customers')!;
  (customers['columns'] as Doc[]).push({ ref: 'opt_in', type: 'bool', default: false }, { ref: 'language', type: 'text', maxLength: 8, nullable: true });
  manifest['people'] = [{ table: 'customers', kind: 'people', email: 'email', name: 'name', language: 'language', consent: { column: 'opt_in', purpose: 'newsletter' } }];
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
