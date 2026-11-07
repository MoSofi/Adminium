// SPDX-License-Identifier: AGPL-3.0-only
/**
 * An app's public entry never takes over an endpoint that is not its own.
 *
 * An endpoint's name comes from its table's real name, or from the `path` a
 * self-made file gives an entry. An endpoint already here under that name
 * that is not the app's (the operator's own, here) is never written over: the
 * check refuses it by name, for an install and for an update, and the
 * operator's endpoint is left exactly as it was.
 *
 * An update that changes what the app's live key serves is allowing public
 * access again: it needs someone who may manage API keys, as an install does.
 * And an update of one copy never borrows another copy's consent.
 */
import { publicEndpointsRepo } from '@adminium/meta';
import { afterEach, describe, expect, it } from 'vitest';

import { runIntrospection } from '../src/connections/introspect.js';
import { loadSnapshotView } from '../src/data-io/snapshot-view.js';
import { PERMISSIONS } from '../src/rbac/permissions.js';
import { ENGINES, installHarness, type Harness } from './app-install-harness.js';

type Doc = Record<string, unknown>;

/** A self-made shop: one table, and the public entries given. */
function shop(version: string, publicAccess: Doc[]): Doc {
  return {
    kind: 'app',
    manifestVersion: 1,
    key: 'shop',
    name: 'Shop',
    version,
    publisher: { id: 'local', name: 'Made here' },
    license: 'AGPL-3.0-only',
    description: { key: 'd', fallback: 'A shop.' },
    categories: ['operations'],
    compatibility: { minAdminiumVersion: '0.3.49' },
    requiredSchema: {
      tables: [
        {
          ref: 'orders',
          columns: [
            { ref: 'id', type: 'int', role: 'pk' },
            { ref: 'code', type: 'text', maxLength: 12, nullable: true },
            { ref: 'note', type: 'text', maxLength: 80, nullable: true },
          ],
        },
      ],
    },
    pages: [{ ref: 'orders', template: 'page-crud', title: { key: 't', fallback: 'Orders' }, nav: { group: 'records', icon: 'list', order: 1 }, bindings: { rows: 'orders' } }],
    publicAccess,
    frontends: [{ side: 'staff', kind: 'none' }],
  };
}

const LIST = { table: 'orders', methods: ['GET'], select: ['id', 'code', 'note'] };

let harness: Harness | null = null;
afterEach(async () => {
  await harness?.close();
  harness = null;
});

/** The operator's own endpoint `notes`, on a table of their own. */
async function operatorEndpoint(h: Harness): Promise<string> {
  await h.run('create table notes (id int primary key, body varchar(100))');
  await runIntrospection({ manager: h.manager, meta: h.meta, connectionId: h.connectionId });
  const view = await loadSnapshotView(h.meta, h.connectionId);
  const source = view.model.tables.find((table) => table.name === 'notes')!.id;
  await h.deps.publicAccess!.service.saveEndpoint({
    connectionId: h.connectionId,
    ref: 'notes',
    definition: {
      path: '/notes',
      source,
      filters: [],
      pagination: { default_limit: 20, max_limit: 100, order: 'id.asc' },
      rate_limit: { requests: 30, window: '1m' },
      response: { shape: 'object', envelope: 'data' },
      methods: ['GET'],
      select: ['id', 'body'],
      auth: { role: 'anon' },
    } as never,
    origin: 'custom',
  });
  return (await publicEndpointsRepo(h.meta).findByRef(h.connectionId, 'notes'))!.definition;
}

function said(reply: { statusCode: number; body: string }): string {
  const body = JSON.parse(reply.body) as { error?: { code: string; message: string; details?: { problems?: { code: string; message: string }[] } } };
  return `${String(reply.statusCode)} ${body.error?.code ?? 'ok'} ${(body.error?.details?.problems ?? []).map((problem) => `${problem.code}: ${problem.message}`).join(' | ')} ${body.error?.message ?? ''}`;
}

for (const [dialect, available] of ENGINES) {
  describe.skipIf(!available)(`a public entry never takes over another endpoint [${dialect}]`, () => {
    it('refuses an install whose entry has the name of the operator’s endpoint, and leaves it as it was', async () => {
      const h = (harness = await installHarness(dialect, { full: true }));
      const before = await operatorEndpoint(h);
      const refused = await h.install(shop('1.0.0', [{ ...LIST, path: '/notes' }]), { publicAccess: true });
      expect(said(refused)).toMatch(/^422 VALIDATION_FAILED SHARE_REF_TAKEN: The public access "notes" this app asks for has the name of an endpoint here that is an endpoint of this server\. It is never written over/);
      const after = await publicEndpointsRepo(h.meta).findByRef(h.connectionId, 'notes');
      expect(after?.definition).toBe(before);
      expect(after?.managedBy).toBeNull();
    });

    it('reads a name in other letters as the same endpoint: refused on the check, and by the endpoint service', async () => {
      const h = (harness = await installHarness(dialect, { full: true }));
      const before = await operatorEndpoint(h);
      const refused = await h.install(shop('1.0.0', [{ ...LIST, path: '/nOTES' }]), { publicAccess: true });
      expect(said(refused)).toMatch(/^422 VALIDATION_FAILED SHARE_REF_TAKEN: The public access "nOTES" this app asks for has the name of an endpoint here that is an endpoint of this server\./);
      expect((await publicEndpointsRepo(h.meta).listByConnection(h.connectionId)).map((endpoint) => endpoint.ref)).toEqual(['notes']);
      expect((await publicEndpointsRepo(h.meta).findByRef(h.connectionId, 'notes'))?.definition).toBe(before);
      // A second endpoint saved under the name in other letters is the first one's name: refused, never stored beside it.
      const parsed = JSON.parse(before) as Record<string, unknown>;
      await expect(h.deps.publicAccess!.service.saveEndpoint({ connectionId: h.connectionId, ref: 'nOTES', definition: { ...parsed, path: '/nOTES' } as never, origin: 'custom' })).rejects.toMatchObject({ name: 'EndpointRefTaken' });
      expect((await publicEndpointsRepo(h.meta).listByConnection(h.connectionId)).map((endpoint) => endpoint.ref)).toEqual(['notes']);
    });

    it('refuses an update that adds such an entry, and leaves the operator’s endpoint as it was', async () => {
      const h = (harness = await installHarness(dialect, { full: true }));
      const before = await operatorEndpoint(h);
      const first = await h.install(shop('1.0.0', [LIST]), { publicAccess: true });
      expect(first.statusCode, first.body).toBe(200);
      await h.stage(shop('1.0.1', [LIST, { table: 'orders', methods: ['GET'], select: ['id'], path: '/notes' }]));
      const update = await h.inject({ method: 'POST', url: '/apps/shop/update', payload: { publicAccess: true } });
      expect(said(update)).toMatch(/^422 VALIDATION_FAILED SHARE_REF_TAKEN: The public access "notes"/);
      expect((await publicEndpointsRepo(h.meta).findByRef(h.connectionId, 'notes'))?.definition).toBe(before);
    });
  });

  describe.skipIf(!available)(`an update's public access is allowed as an install's [${dialect}]`, () => {
    it('changes what a live key serves only for someone who may manage API keys', async () => {
      let mayManageKeys = true;
      const h = (harness = await installHarness(dialect, { full: true, can: (permission) => permission !== PERMISSIONS.apiKeysManage || mayManageKeys }));
      const first = await h.install(shop('1.0.0', [LIST]), { publicAccess: true });
      expect(first.statusCode, first.body).toBe(200);
      const served = async () => (await publicEndpointsRepo(h.meta).findByRef(h.connectionId, 'orders'))?.definition;
      const before = await served();
      expect(before).toContain('"note"');
      // v2 serves the list without its note: a change to what strangers reach through the key the operator allowed.
      await h.stage(shop('1.0.1', [{ ...LIST, select: ['id', 'code'] }]));
      mayManageKeys = false;
      const refused = await h.inject({ method: 'POST', url: '/apps/shop/update', payload: {} });
      expect(said(refused)).toMatch(/^403 .*changes what its public access serves \("orders"\), which only someone who may manage API keys can allow/);
      expect(await served()).toBe(before);
      // Someone who may: the endpoint follows the version.
      mayManageKeys = true;
      const updated = await h.inject({ method: 'POST', url: '/apps/shop/update', payload: {} });
      expect(updated.statusCode, updated.body).toBe(200);
      expect(await served()).not.toContain('"note"');
    });

    it('holds a key of the app with no install named to the same: its consent carries the update, and what it serves changes only for someone who may manage API keys', async () => {
      let mayManageKeys = true;
      const h = (harness = await installHarness(dialect, { full: true, can: (permission) => permission !== PERMISSIONS.apiKeysManage || mayManageKeys }));
      const first = await h.install(shop('1.0.0', [LIST]), { publicAccess: true });
      expect(first.statusCode, first.body).toBe(200);
      // The app's key as one made by hand, or before installs were recorded on keys: no install named.
      await h.meta.db.updateTable('adminium_public_keys').set({ installId: null }).where('managedBy', '=', 'shop').execute();
      const served = async () => (await publicEndpointsRepo(h.meta).findByRef(h.connectionId, 'orders'))?.definition;
      const before = await served();
      await h.stage(shop('1.0.1', [{ ...LIST, select: ['id', 'code'] }]));
      mayManageKeys = false;
      const refused = await h.inject({ method: 'POST', url: '/apps/shop/update', payload: {} });
      expect(said(refused)).toMatch(/^403 .*changes what its public access serves \("orders"\)/);
      expect(await served()).toBe(before);
      mayManageKeys = true;
      const updated = await h.inject({ method: 'POST', url: '/apps/shop/update', payload: {} });
      expect(updated.statusCode, updated.body).toBe(200);
      expect(await served()).not.toContain('"note"');
    });

    it('never borrows another copy’s consent: a copy installed without public access gets no endpoints on update', async () => {
      const h = (harness = await installHarness(dialect, { full: true }));
      const first = await h.install(shop('1.0.0', [LIST]), { publicAccess: true });
      expect(first.statusCode, first.body).toBe(200);
      const other = await h.otherConnection('Kiln');
      const second = await h.inject({ method: 'POST', url: '/apps/install', payload: { key: 'shop', version: '1.0.0', connectionId: other.id, publicAccess: false } });
      expect(second.statusCode, second.body).toBe(200);
      expect(await publicEndpointsRepo(h.meta).listByConnection(other.id)).toEqual([]);
      await h.stage(shop('1.0.1', [LIST, { table: 'orders', methods: ['GET'], select: ['id'], path: '/order_ids' }]));
      // Kiln's copy, updated with nothing said about public access: Fernhill's live key allows nothing here.
      const kiln = await h.inject({ method: 'POST', url: `/apps/shop/update?connectionId=${encodeURIComponent(other.id)}`, payload: {} });
      expect(kiln.statusCode, kiln.body).toBe(200);
      expect(await publicEndpointsRepo(h.meta).listByConnection(other.id)).toEqual([]);
      // Fernhill's own consent still carries its own update.
      const fernhill = await h.inject({ method: 'POST', url: `/apps/shop/update?connectionId=${encodeURIComponent(h.connectionId)}`, payload: {} });
      expect(fernhill.statusCode, fernhill.body).toBe(200);
      expect((await publicEndpointsRepo(h.meta).listByConnection(h.connectionId)).map((endpoint) => endpoint.ref).sort()).toEqual(['order_ids', 'orders']);
    });
  });
}
