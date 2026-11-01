// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A TABLE OPENED TO FORMS IS NOT OPENED TO THE PUBLIC API.
 *
 * An app opens a table to a form's answers through an entry under the
 * reserved key `forms`. The install makes no endpoint for it and no key of
 * that name, so a stranger holding the app's own customer key, asking for
 * that table, is answered exactly as for a table the app never opened. The
 * key the install would make for it cannot be made by any other way either.
 * On every engine this run can reach.
 */
import { publicEndpointsRepo, publicKeysRepo } from '@adminium/meta';
import { afterEach, describe, expect, it } from 'vitest';

import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import { createEndpointService, KeyCreateRefused } from '../src/public-api/endpoint-service.js';
import { generatePublishableKey, sealPublishableKey } from '../src/public-api/keys.js';
import { addOnHarness, type Harness } from './app-add-ons.helpers.js';
import { shopManifest } from './fixtures/cards-kit/index.js';
import { TEST_SECRET } from './helpers.js';
import { LEGS } from './invoicing-install.helpers.js';
import { servePublic } from './public-lane.helpers.js';

const pk = { ref: 'id', type: 'int', role: 'pk' };

/** The shop, with its messages opened to forms beside its public product list. */
function shopWithForms(): Record<string, unknown> {
  const base = shopManifest();
  const schema = base['requiredSchema'] as { prefixed: true; tables: unknown[] };
  return {
    ...base,
    compatibility: { minAdminiumVersion: '0.3.40', engines: ['postgres', 'mysql', 'sqlite'] },
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
    publicAccess: [
      { table: 'products', methods: ['GET'], select: ['id', 'name', 'price'] },
      { table: 'messages', methods: ['POST'], key: 'forms', writable: ['name', 'email', 'body'], anonymous: { perKeyHour: 100, plainText: ['name'] } },
    ],
  };
}

describe.each(LEGS)('a table opened to forms, asked for through the public API — %s', (dialect, available) => {
  let h: Harness;
  afterEach(async () => {
    if (available) await h.close();
  });

  it.skipIf(!available)('gets no endpoint and no key, and answers a stranger as a table nobody opened', async () => {
    h = await addOnHarness(dialect);
    await h.stageApp(shopWithForms());
    const installed = await h.install('shop', '1.0.0');
    expect(installed.statusCode, installed.body).toBe(200);
    const keyId = installed.json().publicAccess.keyId as string;

    // The products are served; the messages are not an endpoint at all, and no key is named after forms.
    const refs = (await publicEndpointsRepo(h.meta).listByConnection(h.connectionId)).map((endpoint) => endpoint.ref);
    expect(refs).toEqual(['shop_products']);
    const purposes = (await publicKeysRepo(h.meta).listManagedBy('shop')).map((key) => key.purpose);
    expect(purposes).toEqual(['customer']);

    const served = await servePublic(h as never, keyId);
    try {
      // The key works: the products answer.
      const products = await served.get('/records/shop_products');
      expect(products.statusCode, products.body).toBe(200);
      // A table opened to forms, and one opened to nobody, answer the same, by every method.
      const payload = { name: 'Dana', email: 'dana@meridian.example', body: 'Hello' };
      for (const [method, url] of [
        ['POST', '/records/'],
        ['GET', '/records/'],
      ] as const) {
        const ask = (table: string) => (method === 'POST' ? served.post(`${url}${table}`, payload) : served.get(`${url}${table}`));
        const formed = await ask('shop_messages');
        const closed = await ask('shop_hours');
        expect(formed.statusCode, `${method} ${formed.body}`).toBe(closed.statusCode);
        expect(formed.statusCode).toBeGreaterThanOrEqual(400);
        expect(served.codeOf(formed)).toBe(served.codeOf(closed));
        expect(formed.body.replaceAll('shop_messages', 'X')).toBe(closed.body.replaceAll('shop_hours', 'X'));
      }
      // Nothing was written.
      expect(Number((await h.rows('SELECT COUNT(*) AS n FROM shop_messages'))[0]!['n'])).toBe(0);
    } finally {
      await served.close();
    }
  });

  it.skipIf(!available)('never makes a key named forms, however it is asked', async () => {
    h = await addOnHarness(dialect);
    await h.stageApp(shopWithForms());
    expect((await h.install('shop', '1.0.0')).statusCode).toBe(200);
    const service = createEndpointService({ meta: h.meta, viewFor: async () => null, tenantConfigOf: async () => undefined });
    const generated = generatePublishableKey('browser');
    const attempt = service.createKey({
      connectionId: h.connectionId,
      name: 'shop · forms',
      access: [{ ref: 'shop_products', methods: ['GET'] }],
      secret: { prefix: generated.prefix, tokenHash: generated.tokenHash, tokenEncrypted: sealPublishableKey(dsnCryptoFromSecret(TEST_SECRET), generated.token) },
      appKey: 'shop',
      managedBy: 'shop',
      purpose: 'forms',
    });
    await expect(attempt).rejects.toBeInstanceOf(KeyCreateRefused);
    await expect(attempt).rejects.toMatchObject({ issues: [{ code: 'KEY_PURPOSE_RESERVED' }] });
    expect((await publicKeysRepo(h.meta).listManagedBy('shop')).map((key) => key.purpose)).toEqual(['customer']);
  });
});
