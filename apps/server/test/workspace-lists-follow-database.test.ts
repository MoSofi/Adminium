// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Public scopes and endpoints, payable tables and document profiles follow
 * their database's workspace, on every available engine:
 *  - `?workspaceId=` narrows each list in its query to the workspace's
 *    databases: a subset of the list without it, holding only theirs;
 *  - "Other databases" narrows to the databases in no workspace;
 *  - a workspace that is not there, or that this person does not see, is not
 *    found, and a workspace beside a database is refused.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  connectionsRepo,
  documentProfilesRepo,
  payableProfilesRepo,
  publicEndpointsRepo,
  publicScopesRepo,
  rolesRepo,
  usersRepo,
  workspacesRepo,
  type MetaDb,
  type User,
} from '@adminium/meta';

import { rbacPlugin } from '../src/plugins/rbac.js';
import { documentRoutes } from '../src/routes/documents/index.js';
import { paymentPayablesRoutes } from '../src/routes/payments/payables.js';
import { publicAdminRoutes } from '../src/routes/public-admin/index.js';
import { makeEnv } from './helpers.js';
import { buildBareApp, type BareApp } from './jobs-helpers.js';
import { META_ENGINES, type MetaHandle } from './meta-dialects.js';

const PLAIN = { encrypt: (v: string) => v, decrypt: (v: string) => v };

const MAPPING = {
  label: 'number',
  amount: { column: 'total', unit: null },
  currency: { fixed: 'GBP' },
  due: null,
  payments: { kind: 'kept' as const },
  status: { column: 'status', paid: 'paid', refunded: null },
  customerEmail: 'email',
  customerCountry: null,
  pageFields: ['number', 'total'],
};

describe.each(META_ENGINES)('lists that follow their database\'s workspace — $name', (engine) => {
  let handle: MetaHandle;
  let meta: MetaDb;
  let app: BareApp;
  let owner: User;
  let viewer: User;
  let db: { fernhill: string; kiln: string; loose: string };
  let ws: { coffee: string; kiln: string };

  beforeAll(async () => {
    if (!engine.available) return;
    handle = await engine.make();
    meta = handle.meta;
    const users = usersRepo(meta);
    owner = await users.create({ email: 'owner@adminium.test', name: 'Owner', status: 'active' });
    viewer = await users.create({ email: 'viewer@adminium.test', name: 'Viewer', status: 'active' });
    await rolesRepo(meta).assignToUser(owner.id, (await rolesRepo(meta).findBySlug('super-admin'))!.id);
    await rolesRepo(meta).assignToUser(viewer.id, (await rolesRepo(meta).findBySlug('viewer'))!.id);
    app = buildBareApp();
    app.addHook('onRequest', async (request) => {
      const id = request.headers['x-test-user-id'];
      if (typeof id === 'string' && id.length > 0) (request as unknown as { user: { id: string; name: string } }).user = { id, name: id };
    });
    await app.register(rbacPlugin, { meta });
    await app.register(publicAdminRoutes({ meta, env: makeEnv(), crypto: PLAIN }));
    await app.register(paymentPayablesRoutes({ meta, manager: { data: async () => { throw new Error('no data reads in a list'); } } }));
    await app.register(documentRoutes({ meta, storage: {} as never, runtime: () => null, enqueue: () => Promise.resolve({ id: 'job_1' }) }));
    await app.ready();
  }, 120_000);
  afterAll(async () => {
    if (!engine.available) return;
    await app.close();
    await handle.destroy();
  });
  beforeEach(async () => {
    if (!engine.available) return;
    for (const table of [
      'adminium_workspace_connections',
      'adminium_workspaces',
      'adminium_public_endpoints',
      'adminium_public_scopes',
      'adminium_payable_profiles',
      'adminium_document_profiles',
      'adminium_audit_log',
    ] as const) {
      await meta.db.deleteFrom(table).execute();
    }
    await meta.db.deleteFrom('adminium_connections').execute();
    const connections = connectionsRepo(meta, PLAIN);
    const make = async (name: string) => (await connections.create({ name, engine: 'postgres', introspectDsn: `postgres://ro@db.internal:5432/${name}` })).id;
    db = { fernhill: await make('fernhill'), kiln: await make('kiln'), loose: await make('loose') };
    ws = {
      coffee: (await workspacesRepo(meta).create({ name: 'Fernhill Coffee', connectionIds: [db.fernhill] })).id,
      kiln: (await workspacesRepo(meta).create({ name: 'Kiln Street Pottery', connectionIds: [db.kiln] })).id,
    };
    for (const [name, connectionId] of Object.entries(db)) {
      await publicScopesRepo(meta).create({ connectionId, side: 'customer', name: `${name} web`, timezone: 'UTC', document: '{"version":1}', createdBy: null });
      await publicEndpointsRepo(meta).create({ connectionId, ref: `${name}_orders`, origin: 'custom', definition: '{"source":"orders","methods":["GET"]}', createdBy: null });
      await payableProfilesRepo(meta).create({ connectionId, tableName: `${name}_invoices`, mapping: MAPPING, ownerApp: null, createdBy: null });
      await documentProfilesRepo(meta).create({ addOnKey: 'invoices', kind: 'invoice', name: `${name} invoice`, connectionId, table: 'invoices', mapping: {} });
    }
  });

  const get = (url: string, user: User = owner) => app.inject({ method: 'GET', url, headers: { 'x-test-user-id': user.id } });

  /** Each list, as the database id of every row it answers. */
  const lists: { name: string; url: (query: string) => string; databases: (body: unknown) => string[] }[] = [
    { name: 'public scopes', url: (q) => `/public-scopes${q === '' ? '' : `?${q}`}`, databases: (body) => (body as { scopes: { connectionId: string }[] }).scopes.map((one) => one.connectionId) },
    {
      name: 'public endpoints',
      // The list without a workspace names every database; the endpoints say their database by their ref here.
      url: (q) => `/public-endpoints?${q === '' ? `connectionIds=${[db.fernhill, db.kiln, db.loose].join(',')}` : q}`,
      databases: (body) => (body as { endpoints: { ref: string }[] }).endpoints.map((one) => db[one.ref.replace('_orders', '') as keyof typeof db]),
    },
    { name: 'payable tables', url: (q) => `/payments/payables${q === '' ? '' : `?${q}`}`, databases: (body) => (body as { data: { profiles: { connectionId: string }[] } }).data.profiles.map((one) => one.connectionId) },
    { name: 'document profiles', url: (q) => `/documents/profiles${q === '' ? '' : `?${q}`}`, databases: (body) => (body as { profiles: { connectionId: string }[] }).profiles.map((one) => one.connectionId) },
  ];

  for (const list of lists) {
    it.runIf(engine.available)(`narrows the ${list.name} to a workspace's databases, a subset of the whole list`, async () => {
      const whole = await get(list.url(''));
      expect(whole.statusCode, whole.body).toBe(200);
      const all = list.databases(whole.json());
      expect([...all].sort()).toEqual([db.fernhill, db.kiln, db.loose].sort());

      for (const [workspaceId, expected] of [
        [ws.coffee, [db.fernhill]],
        [ws.kiln, [db.kiln]],
        ['other', [db.loose]],
      ] as const) {
        const narrowed = await get(list.url(`workspaceId=${workspaceId}`));
        expect(narrowed.statusCode, narrowed.body).toBe(200);
        const held = list.databases(narrowed.json());
        expect(held).toEqual(expected);
        // Never wider than the list without it.
        for (const one of held) expect(all).toContain(one);
      }

      expect((await get(list.url('workspaceId=wsp_absent'))).statusCode).toBe(404);
      expect((await get(list.url(`workspaceId=${ws.kiln}&connectionId=${db.kiln}`))).statusCode).toBe(422);
    });
  }

  it.runIf(engine.available)('refuses a workspace this person does not see, and a list of databases beside one', async () => {
    // The viewer reaches no page of any database: neither workspace is theirs to see.
    expect((await get(`/public-scopes?workspaceId=${ws.kiln}`, viewer)).statusCode).toBeGreaterThanOrEqual(403);
    expect((await get(`/public-endpoints?workspaceId=${ws.kiln}&connectionIds=${db.kiln}`)).statusCode).toBe(422);
    // A workspace whose databases went: an empty list, not everything.
    await workspacesRepo(meta).setForConnection(db.kiln, []);
    for (const list of lists) {
      const empty = await get(list.url(`workspaceId=${ws.kiln}`));
      expect(empty.statusCode, `${list.name}: ${empty.body}`).toBe(200);
      expect(list.databases(empty.json()), list.name).toEqual([]);
    }
  });
});
