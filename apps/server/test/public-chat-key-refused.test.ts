// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A TABLE OPENED TO A CHAT IS NOT OPENED TO THE PUBLIC API.
 *
 * An app opens a table to a question a visitor leaves in a live chat outside
 * hours through an entry under the reserved key `chat`, beside its `forms`
 * entry on the same table. The install makes no endpoint for either and no
 * key of either name, so a stranger holding the app's own customer key,
 * asking for that table, is answered exactly as for a table the app never
 * opened. A key named `chat` cannot be made any other way either. On every
 * engine this run can reach.
 */
import { publicEndpointsRepo, publicKeysRepo } from '@adminium/meta';
import { afterEach, describe, expect, it } from 'vitest';

import { anonymousAddAndRead } from '../src/apps/anonymous-access.js';
import { servedPublicEntries, type PublicAccessEntry } from '../src/apps/manifest-public.js';
import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import { createEndpointService, KeyCreateRefused } from '../src/public-api/endpoint-service.js';
import { generatePublishableKey, sealPublishableKey } from '../src/public-api/keys.js';
import { addOnHarness, type Harness } from './app-add-ons.helpers.js';
import { shopManifest } from './fixtures/cards-kit/index.js';
import { TEST_SECRET } from './helpers.js';
import { LEGS } from './invoicing-install.helpers.js';
import { servePublic } from './public-lane.helpers.js';

const pk = { ref: 'id', type: 'int', role: 'pk' };
const CHAT_ENTRY = { table: 'messages', methods: ['POST'], key: 'chat', writable: ['name', 'email', 'body'], anonymous: { perKeyHour: 100, plainText: ['name'] } };
const FORMS_ENTRY = { ...CHAT_ENTRY, key: 'forms' };

/** The shop, with its messages opened to forms and to chat beside its public product list. */
function shopWithChat(): Record<string, unknown> {
  const base = shopManifest();
  const schema = base['requiredSchema'] as { prefixed: true; tables: unknown[] };
  return {
    ...base,
    compatibility: { minAdminiumVersion: '0.3.64', engines: ['postgres', 'mysql', 'sqlite'] },
    requiredSchema: {
      ...schema,
      tables: [
        ...schema.tables,
        {
          ref: 'messages',
          columns: [pk, { ref: 'name', type: 'text', maxLength: 80 }, { ref: 'email', type: 'text', maxLength: 254, nullable: true }, { ref: 'body', type: 'text', maxLength: 1000, nullable: true }],
        },
      ],
    },
    publicAccess: [{ table: 'products', methods: ['GET'], select: ['id', 'name', 'price'] }, FORMS_ENTRY, CHAT_ENTRY],
  };
}

describe('the entries the public API serves', () => {
  it('leave out every entry under the key chat, as under forms', () => {
    const entries = [{ table: 'products', methods: ['GET'] }, FORMS_ENTRY, CHAT_ENTRY, { table: 'products', methods: ['GET'], key: 'partner' }] as unknown as PublicAccessEntry[];
    expect(servedPublicEntries({ publicAccess: entries, compatibility: { minAdminiumVersion: '0.3.64' } }).map((entry) => entry.key ?? 'customer')).toEqual(['customer', 'partner']);
  });

  it('keep an app’s own key named chat when the app was written for an older Adminium', () => {
    const link = { table: 'products', methods: ['GET'], key: 'chat', claim: { by: 'token', column: 'link_token' } };
    const entries = [{ table: 'products', methods: ['GET'] }, FORMS_ENTRY, link] as unknown as PublicAccessEntry[];
    expect(servedPublicEntries({ publicAccess: entries, compatibility: { minAdminiumVersion: '0.3.63' } }).map((entry) => entry.key ?? 'customer')).toEqual(['customer', 'chat']);
    expect(servedPublicEntries({ publicAccess: entries, compatibility: { minAdminiumVersion: '0.3.64' } }).map((entry) => entry.key ?? 'customer')).toEqual(['customer']);
  });

  it('let nobody read a table opened to chat, through any key', () => {
    const reader = { table: 'messages', methods: ['GET'], select: ['id'], key: 'partner' };
    expect(anonymousAddAndRead([CHAT_ENTRY, reader] as unknown as PublicAccessEntry[])).toEqual([1]);
    expect(anonymousAddAndRead([{ ...CHAT_ENTRY, table: 'other' }, reader] as unknown as PublicAccessEntry[])).toEqual([]);
    // Under an older floor the entry is an ordinary key's: no door holds the table.
    expect(anonymousAddAndRead([{ ...CHAT_ENTRY, anonymous: undefined, claim: { by: 'token', column: 'x' } }, reader] as unknown as PublicAccessEntry[], ['forms'])).toEqual([]);
  });
});

/** A shop written for 0.3.63, whose products open by a link under a key of its own it named `chat`. */
function olderShopWithChatKey(): Record<string, unknown> {
  const base = shopManifest();
  const schema = base['requiredSchema'] as { prefixed: true; tables: { ref: string; columns: unknown[] }[] };
  return {
    ...base,
    compatibility: { minAdminiumVersion: '0.3.63', engines: ['postgres', 'mysql', 'sqlite'] },
    requiredSchema: {
      ...schema,
      tables: schema.tables.map((table) => (table.ref === 'products' ? { ...table, columns: [...table.columns, { ref: 'link_token', type: 'text', maxLength: 24, nullable: true, rules: { code: { length: 16 } } }] } : table)),
    },
    publicKeys: { chat: {} },
    publicAccess: [{ table: 'products', methods: ['GET'], select: ['id', 'name', 'price'] }, { table: 'products', key: 'chat', methods: ['GET'], select: ['id', 'name'], claim: { by: 'token', column: 'link_token' } }],
  };
}

describe.each(LEGS)('a table opened to chat, asked for through the public API — %s', (dialect, available) => {
  let h: Harness;
  afterEach(async () => {
    if (available) await h.close();
  });

  it.skipIf(!available)('an app written for an older Adminium keeps its own key named chat: its endpoint and its key are made', async () => {
    h = await addOnHarness(dialect);
    await h.stageApp(olderShopWithChatKey());
    const installed = await h.install('shop', '1.0.0');
    expect(installed.statusCode, installed.body).toBe(200);
    const endpoints = await publicEndpointsRepo(h.meta).listByConnection(h.connectionId);
    expect(endpoints).toHaveLength(2);
    const purposes = (await publicKeysRepo(h.meta).listManagedBy('shop')).map((key) => key.purpose).sort();
    expect(purposes).toEqual(['chat', 'customer']);
  });

  it.skipIf(!available)('gets no endpoint and no key, and answers a stranger as a table nobody opened', async () => {
    h = await addOnHarness(dialect);
    await h.stageApp(shopWithChat());
    const installed = await h.install('shop', '1.0.0');
    expect(installed.statusCode, installed.body).toBe(200);
    const keyId = installed.json().publicAccess.keyId as string;

    // The products are served; the messages are not an endpoint at all, and no key is named after chat or forms.
    const refs = (await publicEndpointsRepo(h.meta).listByConnection(h.connectionId)).map((endpoint) => endpoint.ref);
    expect(refs).toEqual(['shop_products']);
    const purposes = (await publicKeysRepo(h.meta).listManagedBy('shop')).map((key) => key.purpose);
    expect(purposes).toEqual(['customer']);

    const served = await servePublic(h as never, keyId);
    try {
      const products = await served.get('/records/shop_products');
      expect(products.statusCode, products.body).toBe(200);
      // A table opened to chat, and one opened to nobody, answer the same, by every method.
      const payload = { name: 'Dana', email: 'dana@meridian.example', body: 'Are you open on Sunday?' };
      for (const method of ['POST', 'GET'] as const) {
        const ask = (table: string) => (method === 'POST' ? served.post(`/records/${table}`, payload) : served.get(`/records/${table}`));
        const opened = await ask('shop_messages');
        const closed = await ask('shop_hours');
        expect(opened.statusCode, `${method} ${opened.body}`).toBe(closed.statusCode);
        expect(opened.statusCode).toBeGreaterThanOrEqual(400);
        expect(served.codeOf(opened)).toBe(served.codeOf(closed));
        expect(opened.body.replaceAll('shop_messages', 'X')).toBe(closed.body.replaceAll('shop_hours', 'X'));
      }
      // Nothing was written.
      expect(Number((await h.rows('SELECT COUNT(*) AS n FROM shop_messages'))[0]!['n'])).toBe(0);
    } finally {
      await served.close();
    }
  });

  it.skipIf(!available)('never makes a key named chat, however it is asked', async () => {
    h = await addOnHarness(dialect);
    await h.stageApp(shopWithChat());
    expect((await h.install('shop', '1.0.0')).statusCode).toBe(200);
    const service = createEndpointService({ meta: h.meta, viewFor: async () => null, tenantConfigOf: async () => undefined });
    const generated = generatePublishableKey('browser');
    const attempt = service.createKey({
      connectionId: h.connectionId,
      name: 'shop · chat',
      access: [{ ref: 'shop_products', methods: ['GET'] }],
      secret: { prefix: generated.prefix, tokenHash: generated.tokenHash, tokenEncrypted: sealPublishableKey(dsnCryptoFromSecret(TEST_SECRET), generated.token) },
      appKey: 'shop',
      managedBy: 'shop',
      purpose: 'chat',
    });
    await expect(attempt).rejects.toBeInstanceOf(KeyCreateRefused);
    await expect(attempt).rejects.toMatchObject({ issues: [{ code: 'KEY_PURPOSE_RESERVED', message: expect.stringContaining('"chat"') }] });
    expect((await publicKeysRepo(h.meta).listManagedBy('shop')).map((key) => key.purpose)).toEqual(['customer']);
  });
});
