// SPDX-License-Identifier: AGPL-3.0-only
/**
 * SAVING WHAT STRANGERS MAY DO ON A DATABASE, AND INSTALLING IT.
 *
 * Endpoints an operator made and granted to a key become the file's public
 * entries, with the key's methods and their own address; the install makes
 * the same endpoints on a fresh database and a new key holding them. A key's
 * token, hash, prefix and origins never travel, nor does an endpoint no key
 * holds, a server key, or anything an install made. An entry that would not
 * install exactly as it is here is left out and said. On every engine.
 */
import { connectionTenantConfig, publicEndpointsRepo, publicKeysRepo } from '@adminium/meta';
import { afterEach, describe, expect, it } from 'vitest';

import { convertToApp } from '../src/apps/save/convert.js';
import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import { createEndpointService } from '../src/public-api/endpoint-service.js';
import { generatePublishableKey, sealPublishableKey } from '../src/public-api/keys.js';
import { createPublicViews } from '../src/public-api/runtime.js';
import { ENGINES } from './app-add-ons.helpers.js';
import { addOnHarness, choices, expectNoneOf, expectValid, handMadeShop, installSaved, sourceOf, withOtherParts, type Doc, type Harness } from './app-save-parts.helpers.js';
import { TEST_SECRET } from './helpers.js';

const crypto = dsnCryptoFromSecret(TEST_SECRET);

function service(h: Harness) {
  const views = createPublicViews(h.meta);
  return createEndpointService({ meta: h.meta, viewFor: views.viewFor, tenantConfigOf: async (cid) => (await connectionTenantConfig(h.meta, cid)) ?? undefined });
}

const common = (path: string, source: string, order: string) => ({
  path,
  source,
  filters: [],
  pagination: { default_limit: 20, max_limit: 100, order },
  rate_limit: { requests: 30, window: '1m' },
  response: { shape: 'object', envelope: 'data' },
});

/** What an operator made in the builder: a sign-in by email, a client's own orders, a public list of open orders. */
function definitions(id: (name: string) => string): Record<string, Doc> {
  return {
    my_client: { ...common('/my_client', id('clients'), 'id.asc'), methods: ['GET'], select: ['id', 'email', 'name'], auth: { role: 'authenticated' }, identity: { strategy: 'lookup', match: ['email'], column: 'id' } },
    my_orders: { ...common('/my_orders', id('orders'), 'number.desc'), methods: ['GET', 'PATCH'], select: ['id', 'number', 'status', 'total', 'note'], writable: ['note'], auth: { role: 'authenticated' }, claim: { column: 'client_id', ref: 'my_client' } },
    open_orders: { ...common('/open_orders', id('orders'), 'number.asc'), methods: ['GET'], select: ['number', 'total'], filters: [{ column: 'status', op: 'eq', value: 'open' }], auth: { role: 'anon' }, orderable: ['number'] },
    // A bare list: an app's key is never granted one (an app's pages read `{ data }`).
    order_list: { ...common('/order_list', id('orders'), 'id.asc'), methods: ['GET'], select: ['id', 'number'], auth: { role: 'anon' }, response: { shape: 'array' } },
    drafts: { ...common('/drafts', id('orders'), 'id.asc'), methods: ['GET'], select: ['id', 'number'], auth: { role: 'anon' } },
  };
}

for (const [dialect, available] of ENGINES) {
  describe.skipIf(!available)(`saving a database's public access [${dialect}]`, () => {
    const open: Harness[] = [];
    afterEach(async () => {
      for (const h of open.splice(0)) await h.close();
    });

    it('the endpoints a key holds travel by ref, and install as the same endpoints behind a new key', async () => {
      const h = await handMadeShop(dialect);
      open.push(h);
      await h.meta.db.updateTable('adminium_connections').set({ timezone: 'Europe/London' }).where('id', '=', h.connectionId).execute();
      const model = (await sourceOf(h)).model;
      const id = (name: string) => model.tables.find((table) => table.name === name)!.id;
      const svc = service(h);
      const defs = definitions(id);
      for (const [ref, definition] of Object.entries(defs)) {
        await svc.saveEndpoint({ connectionId: h.connectionId, ref, definition: definition as never, origin: 'custom', actorId: h.owner.id });
      }
      const browser = generatePublishableKey('browser');
      const made = await svc.createKey({
        connectionId: h.connectionId,
        name: 'Shop site',
        // The key holds less than the endpoint offers: only reading its own orders.
        access: [{ ref: 'my_client', methods: ['GET'] }, { ref: 'my_orders', methods: ['GET'] }, { ref: 'open_orders', methods: ['GET'] }],
        secret: { prefix: browser.prefix, tokenHash: browser.tokenHash, tokenEncrypted: sealPublishableKey(crypto, browser.token) },
        origins: ['https://shop.example.test'],
        actorId: h.owner.id,
      });
      const server = generatePublishableKey('server');
      await svc.createKey({ connectionId: h.connectionId, name: 'Back office sync', kind: 'server', access: [{ ref: 'drafts', methods: ['GET'] }], secret: { prefix: server.prefix, tokenHash: server.tokenHash, tokenEncrypted: 'none' }, actorId: h.owner.id });

      const result = await convertToApp(await sourceOf(h), choices());
      const doc = withOtherParts(result);
      expect(doc['publicAccess']).toEqual([
        { table: 'clients', methods: ['GET'], path: '/my_client', select: ['id', 'email', 'name'], pagination: { defaultLimit: 20, maxLimit: 100, order: 'id.asc' }, rateLimit: { requests: 30, window: '1m' }, response: 'wrapped', claim: { match: ['email'] } },
        { table: 'orders', methods: ['GET'], path: '/my_orders', select: ['id', 'number', 'status', 'total', 'note'], pagination: { defaultLimit: 20, maxLimit: 100, order: 'number.desc' }, rateLimit: { requests: 30, window: '1m' }, response: 'wrapped', writable: ['note'], claimedBy: { table: 'clients', column: 'client_id' } },
        { table: 'orders', methods: ['GET'], path: '/open_orders', select: ['number', 'total'], filters: [{ column: 'status', op: 'eq', value: 'open' }], pagination: { defaultLimit: 20, maxLimit: 100, order: 'number.asc' }, rateLimit: { requests: 30, window: '1m' }, response: 'wrapped' },
      ]);
      expect(doc['publicKeys']).toBeUndefined();
      const key = (await publicKeysRepo(h.meta).findById(made.key.id))!;
      expectNoneOf(doc, [browser.token, browser.tokenHash, browser.prefix, key.tokenEncrypted, 'shop.example.test', made.key.id, h.connectionId, id('orders'), server.prefix]);
      const codes = result.check.map((item) => [item.code, item.item]);
      expect(codes).toEqual(expect.arrayContaining([['PUBLIC_KEY_LEFT_OUT', 'Back office sync'], ['PUBLIC_ENDPOINT_UNUSED', 'drafts'], ['PUBLIC_ENDPOINT_NARROWED', 'open_orders'], ['PUBLIC_KEYS_NEW', 'keys']]));
      expectValid(doc);

      const target = await addOnHarness(dialect, { unbuiltWords: {} });
      open.push(target);
      await target.meta.db.updateTable('adminium_connections').set({ timezone: 'Europe/London' }).where('id', '=', target.connectionId).execute();
      await installSaved(target, doc);
      const targetModel = (await sourceOf(target)).model;
      const tid = (name: string) => targetModel.tables.find((table) => table.name === name)!.id;
      const stored = (await publicEndpointsRepo(target.meta).listByConnection(target.connectionId)).filter((one) => one.managedBy === 'corner-shop');
      expect(stored.map((one) => one.ref).sort()).toEqual(['my_client', 'my_orders', 'open_orders']);
      const byRef = (ref: string) => JSON.parse(stored.find((one) => one.ref === ref)!.definition) as Doc;
      // The same endpoint, on the target's own table, with the key's methods; what only narrowed did not travel.
      expect(byRef('my_client')).toEqual({ ...defs['my_client'], source: tid('clients') });
      expect(byRef('my_orders')).toEqual({ ...defs['my_orders'], source: tid('orders'), methods: ['GET'] });
      const { orderable: _narrowing, ...openOrders } = defs['open_orders']!;
      expect(byRef('open_orders')).toEqual({ ...openOrders, source: tid('orders') });
      // A new key, made there: never the source's token, prefix or origins.
      const minted = (await publicKeysRepo(target.meta).list()).filter((one) => one.managedBy === 'corner-shop' && one.revokedAt === null);
      expect(minted).toHaveLength(1);
      expect(minted[0]).toMatchObject({ purpose: 'customer', origins: '[]' });
      expect(minted[0]!.prefix).not.toBe(browser.prefix);
      expect(minted[0]!.tokenHash).not.toBe(browser.tokenHash);
      expect(Object.values(JSON.parse(minted[0]!.access as string) as Doc).sort()).toEqual([['GET'], ['GET'], ['GET']]);
    });

    it('an entry that would not install as it is here is left out, with what it needs', async () => {
      const h = await handMadeShop(dialect);
      open.push(h);
      const model = (await sourceOf(h)).model;
      const id = (name: string) => model.tables.find((table) => table.name === name)!.id;
      const svc = service(h);
      const defs = definitions(id);
      await svc.saveEndpoint({ connectionId: h.connectionId, ref: 'order_list', definition: defs['order_list'] as never, origin: 'custom', actorId: h.owner.id });
      const browser = generatePublishableKey('browser');
      await svc.createKey({ connectionId: h.connectionId, name: 'Shop site', access: [{ ref: 'order_list', methods: ['GET'] }], secret: { prefix: browser.prefix, tokenHash: browser.tokenHash, tokenEncrypted: sealPublishableKey(crypto, browser.token) }, actorId: h.owner.id });

      const result = await convertToApp(await sourceOf(h), choices());
      // The install would refuse it under the app's key, so the file never carries it.
      expect(result.manifest.publicAccess).toBeUndefined();
      expect(result.check).toEqual(expect.arrayContaining([expect.objectContaining({ group: 'info', code: 'PUBLIC_ENDPOINT_LEFT_OUT', item: 'order_list' })]));
      expect(result.check.map((item) => item.code)).not.toContain('PUBLIC_KEYS_NEW');
    });
  });
}
