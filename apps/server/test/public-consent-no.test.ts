// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE BOX THAT SAYS NO ("Don't send me a review request", FIL-2, ACC-11, MOD-11,
 * REV-2, cQ10), through a real public create, on SQLite, Postgres and MySQL.
 *
 * The box, the mail's stop link and the signed-in switch are one setting: the
 * person's consent for `surveys`.
 *  - ticked, it writes the person's "no" to the log with the sentence shown,
 *    and their column follows;
 *  - unticked, it writes nothing: nobody said yes;
 *  - a stranger's box may stop mail (a no is safe), and is logged once;
 *  - the person, signed in, turns it back on, and a later unticked booking
 *    does not undo that.
 */
import { parseDatabaseModel } from '@adminium/engine';
import { consentLogRepo, snapshotsRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createConsentService } from '../src/consent/index.js';
import { TEST_SECRET } from './helpers.js';
import { installInvoicing, LEGS, type InvoicingHarness } from './invoicing-install.helpers.js';
import { guest, mailReady, shopManifest } from './person-fixture.js';
import { servePublic, type Served } from './public-lane.helpers.js';

vi.mock('../src/version.js', () => ({ APP_VERSION: '0.3.71' }));

type Doc = Record<string, unknown>;
const WORDING = { version: 2, text: { 'en-US': "Don't send me a review request", 'fr-FR': "Ne m'envoyez pas de demande d'avis" } };

function shop(): Doc {
  const manifest = shopManifest({
    orders: { columns: [{ ref: 'no_reviews', type: 'bool', default: false }, { ref: 'language', type: 'text', maxLength: 8, nullable: true }] },
    entries: (entries) =>
      entries.map((entry) => {
        const methods = (entry['methods'] as string[]).join();
        if (entry['table'] === 'customers') return { ...entry, methods: ['GET', 'PATCH'], writable: ['review_requests'] };
        if (entry['table'] === 'orders' && methods === 'POST') {
          return {
            ...entry,
            writable: [...(entry['writable'] as string[]), 'no_reviews', 'language'],
            identity: { table: 'customers', email: 'email', link: 'customer_id', fill: { name: 'name', language: 'language' } },
            consent: { column: 'no_reviews', purpose: 'surveys', means: 'no', wording: WORDING },
          };
        }
        return entry;
      }),
  });
  const customers = (manifest['requiredSchema'] as { tables: Doc[] }).tables.find((table) => table['ref'] === 'customers')!;
  (customers['columns'] as Doc[]).push({ ref: 'review_requests', type: 'bool', default: true }, { ref: 'language', type: 'text', maxLength: 8, nullable: true });
  manifest['people'] = [{ table: 'customers', kind: 'people', email: 'email', name: 'name', language: 'language', consent: { column: 'review_requests', purpose: 'surveys' } }];
  (manifest['outbox'] as Doc)['classes'] = { 'order-placed': 'service' };
  manifest['compatibility'] = { minAdminiumVersion: '0.3.71' };
  return manifest;
}

const yes = (value: unknown): boolean => value === true || value === 1 || value === '1';

describe.each(LEGS)('a public box that says no — %s', (dialect, available) => {
  let h: InvoicingHarness & { reply: Record<string, unknown> };
  let served: Served;
  let g: ReturnType<typeof guest>;
  let customersId = '';
  beforeAll(async () => {
    if (!available) return;
    h = await installInvoicing(dialect, shop());
    await mailReady(h.meta);
    served = await servePublic(h, (h.reply['publicAccess'] as { keys: Record<string, string> }).keys['customer']!);
    g = guest(served, h);
    const model = parseDatabaseModel((await snapshotsRepo(h.meta).latest(h.connectionId))!.schema);
    customersId = model.tables.find((table) => table.name === h.real('customers'))!.id;
  }, 180_000);
  afterAll(async () => {
    if (!available) return;
    await served.close();
    await h.close();
  });

  const customerOf = async (email: string) => (await h.rows(`select * from ${h.real('customers')} where email = '${email}'`))[0]!;
  const logOf = async (key: unknown) => (await consentLogRepo(h.meta).history({ person: { connectionId: h.connectionId, table: customersId, key: String(key) }, hashes: [] }, { limit: 20 })).reverse();
  const order = (values: Record<string, unknown>, session?: string) =>
    g.request('POST', `/records/${h.real('orders')}_verified_2`, { payload: { values, children: { order_items: [{ values: { dish: 'Soup', qty: 1 } }] } }, proof: 'write', ...(session === undefined ? {} : { session }) });
  const standing = async (row: Record<string, unknown>, email: string) =>
    (await createConsentService({ meta: h.meta, secret: TEST_SECRET }).stateFor({ person: { connectionId: h.connectionId, table: customersId, key: String(row['id']) }, address: email }, 'surveys')).state;

  it.skipIf(!available)('ticked, writes the person\'s no with the sentence shown, and their column follows', async () => {
    const made = await order({ email: 'ines@fieldmail.io', name: 'Ines', language: 'fr-FR', no_reviews: true });
    expect(made.statusCode, made.body).toBe(201);
    const ines = await customerOf('ines@fieldmail.io');
    const log = await logOf(ines['id']);
    expect(log.map((row) => [row.state, row.source, row.purpose, row.wording, row.wordingVersion])).toEqual([['no', 'form', 'surveys', "Ne m'envoyez pas de demande d'avis", 'v2 fr-FR']]);
    expect(yes(ines['review_requests'])).toBe(false);
    expect(await standing(ines, 'ines@fieldmail.io')).toBe('no');
  });

  it.skipIf(!available)('unticked, says nothing: no row in the log, and the column keeps its default', async () => {
    expect((await order({ email: 'nora@fieldmail.io', name: 'Nora' })).statusCode).toBe(201);
    const nora = await customerOf('nora@fieldmail.io');
    expect(await logOf(nora['id'])).toEqual([]);
    expect(yes(nora['review_requests'])).toBe(true);
    expect(await standing(nora, 'nora@fieldmail.io')).not.toBe('no');
  });

  it.skipIf(!available)('a second box from anybody is not logged twice', async () => {
    expect((await order({ email: 'otto@fieldmail.io', name: 'Otto', no_reviews: true })).statusCode).toBe(201);
    expect((await order({ email: 'otto@fieldmail.io', name: 'Otto', no_reviews: true })).statusCode).toBe(201);
    const otto = await customerOf('otto@fieldmail.io');
    expect((await logOf(otto['id'])).map((row) => row.state)).toEqual(['no']);
  });

  it.skipIf(!available)('a "no" given before the person had a row stands: their new row does not read yes', async () => {
    await createConsentService({ meta: h.meta, secret: TEST_SECRET }).withdraw({ person: null, address: 'wren@fieldmail.io', purpose: 'surveys', source: 'unsubscribe', detail: 'link' });
    expect((await order({ email: 'wren@fieldmail.io', name: 'Wren' })).statusCode).toBe(201);
    const wren = await customerOf('wren@fieldmail.io');
    expect(yes(wren['review_requests'])).toBe(false);
    expect(await standing(wren, 'wren@fieldmail.io')).toBe('no');
    expect(await logOf(wren['id'])).toEqual([]);
  });

  it.skipIf(!available)('stays until the person, signed in, switches it back on, and an unticked booking does not undo that', async () => {
    expect((await order({ email: 'pia@fieldmail.io', name: 'Pia', no_reviews: true })).statusCode).toBe(201);
    const pia = await customerOf('pia@fieldmail.io');
    expect(await standing(pia, 'pia@fieldmail.io')).toBe('no');
    const session = await g.signIn('pia@fieldmail.io');
    const on = await g.request('PATCH', `/records/${h.real('customers')}_claimed/${String(pia['id'])}`, { session, payload: { values: { review_requests: true } } });
    expect(on.statusCode, on.body).toBe(200);
    expect(await standing(pia, 'pia@fieldmail.io')).toBe('yes');
    expect((await order({ email: 'pia@fieldmail.io', name: 'Pia' })).statusCode).toBe(201);
    expect(await standing(pia, 'pia@fieldmail.io')).toBe('yes');
    expect(yes((await customerOf('pia@fieldmail.io'))['review_requests'])).toBe(true);
  });
});
