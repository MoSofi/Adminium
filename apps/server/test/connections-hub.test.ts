// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Offline connections-hub route tests (M5-T05): the list DTO's
 * included-table + generated-page counts (settings allowlist wins, else the
 * latest snapshot's model, null before introspection; grouped page counts)
 * and the type-to-confirm delete contract (409 on mismatch, pages pruned by
 * connection delete is out of scope here). No live database needed — rows
 * are created through the repos on the in-memory SQLite meta store.
 */
import BetterSqlite3 from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createSqliteMetaDb,
  firstRun,
  pagesRepo,
  rolesRepo,
  snapshotsRepo,
  usersRepo,
  type MetaDb,
  type Role,
  type User,
} from '@adminium/meta';

import { buildServer, type AdminiumServer } from '../src/app.js';
import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import { ConnectionManager } from '../src/connections/manager.js';
import { rbacPlugin } from '../src/plugins/rbac.js';
import { connectionsRoutes } from '../src/routes/connections/index.js';
import { makeEnv, TEST_SECRET } from './helpers.js';

interface Harness {
  app: AdminiumServer;
  meta: MetaDb;
  manager: ConnectionManager;
  superAdmin: User;
  viewer: User;
}

function asUser(user: User): Record<string, string> {
  return { 'x-test-user-id': user.id };
}

async function buildHarness(): Promise<Harness> {
  const meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
  await firstRun(meta);

  const roles = rolesRepo(meta);
  const users = usersRepo(meta);
  async function makeUser(name: string, roleSlug: string): Promise<User> {
    const role: Role | null = await roles.findBySlug(roleSlug);
    if (role === null) throw new Error(`missing built-in role ${roleSlug}`);
    const user = await users.create({
      email: `${name.toLowerCase()}@adminium.test`,
      name,
      passwordHash: 'test-hash',
      status: 'active',
    });
    await roles.assignToUser(user.id, role.id);
    return user;
  }
  const superAdmin = await makeUser('Ava', 'super-admin');
  const viewer = await makeUser('Liam', 'viewer');

  const manager = new ConnectionManager({ meta, crypto: dsnCryptoFromSecret(TEST_SECRET) });

  const app = await buildServer({ env: makeEnv(), logger: false });
  app.addHook('onRequest', async (request) => {
    const id = request.headers['x-test-user-id'];
    if (typeof id === 'string') {
      const user = await users.findById(id);
      if (user !== null) {
        (request as unknown as { user: { id: string; name: string; email: string } }).user = {
          id: user.id,
          name: user.name,
          email: user.email,
        };
      }
    }
  });
  await app.register(rbacPlugin, { meta });
  await app.register(
    async (api) => {
      await api.register(connectionsRoutes({ manager, meta }));
    },
    { prefix: '/api/v1' },
  );
  await app.ready();

  return { app, meta, manager, superAdmin, viewer };
}

const MODEL = {
  tables: [
    { id: 'public.customers', schema: 'public', name: 'customers', columns: [] },
    { id: 'public.orders', schema: 'public', name: 'orders', columns: [] },
    { id: 'public.sessions', schema: 'public', name: 'sessions', columns: [] },
  ],
};

function crudPage(connectionId: string, slug: string) {
  return {
    // Globally unique + ≤ char(36): slug plus a short connection suffix.
    id: `page_${slug}-${connectionId.slice(-6)}`,
    slug,
    type: 'page-crud',
    title: slug,
    navGroup: 'workspace',
    navOrder: 0,
    config: { v: 1 },
  };
}

describe('connections hub list counts', () => {
  let t: Harness;

  beforeEach(async () => {
    t = await buildHarness();
  });

  afterEach(async () => {
    await t.app.close();
    await t.meta.db.destroy();
  });

  it('reports tableCount (allowlist > snapshot model > null) and grouped pageCount', async () => {
    // A: explicit allowlist + snapshot + 2 generated pages.
    const a = await t.manager.connections.create({
      name: 'Prod PG',
      engine: 'postgres',
      introspectDsn: 'postgres://ro@db.internal:5432/prod',
      settings: { includedTables: ['public.customers', 'public.orders'] },
      status: 'connected',
    });
    await snapshotsRepo(t.meta).create({
      connectionId: a.id,
      source: 'introspection',
      schema: MODEL,
      checksum: 'sum-a',
    });
    await pagesRepo(t.meta).upsertGenerated(a.id, [crudPage(a.id, 'customers'), crudPage(a.id, 'orders')]);

    // B: no allowlist — falls back to the snapshot's 3 model tables, 1 page.
    const b = await t.manager.connections.create({
      name: 'Analytics',
      engine: 'mysql',
      introspectDsn: 'mysql://ro@replica.internal:3306/wh',
      status: 'connected',
    });
    await snapshotsRepo(t.meta).create({
      connectionId: b.id,
      source: 'introspection',
      schema: MODEL,
      checksum: 'sum-b',
    });
    await pagesRepo(t.meta).upsertGenerated(b.id, [crudPage(b.id, 'events')]);

    // C: never introspected — null tables, zero pages.
    const c = await t.manager.connections.create({
      name: 'Draft SQLite',
      engine: 'sqlite',
      introspectDsn: 'sqlite:/tmp/dev.db',
    });

    const res = await t.app.inject({
      method: 'GET',
      url: '/api/v1/connections',
      headers: asUser(t.superAdmin),
    });
    expect(res.statusCode).toBe(200);
    const byId = new Map(
      (res.json().connections as Array<{ id: string; tableCount: number | null; pageCount: number; snapshot: unknown }>).map(
        (row) => [row.id, row],
      ),
    );
    expect(byId.get(a.id)).toMatchObject({ tableCount: 2, pageCount: 2 });
    expect(byId.get(b.id)).toMatchObject({ tableCount: 3, pageCount: 1 });
    expect(byId.get(c.id)).toMatchObject({ tableCount: null, pageCount: 0 });
    expect(byId.get(c.id)?.snapshot).toBeNull();

    // The single-connection GET carries the same counters.
    const single = await t.app.inject({
      method: 'GET',
      url: `/api/v1/connections/${a.id}`,
      headers: asUser(t.superAdmin),
    });
    expect(single.json()).toMatchObject({ tableCount: 2, pageCount: 2 });
  });

  it('DELETE stays type-to-confirm: mismatched name 409s, exact name deletes', async () => {
    const connection = await t.manager.connections.create({
      name: 'Prod PG',
      engine: 'postgres',
      introspectDsn: 'postgres://ro@db.internal:5432/prod',
    });

    const mismatch = await t.app.inject({
      method: 'DELETE',
      url: `/api/v1/connections/${connection.id}`,
      headers: asUser(t.superAdmin),
      payload: { confirmName: 'prod pg' },
    });
    expect(mismatch.statusCode).toBe(409);
    expect(mismatch.json().error.details.expectedName).toBe('Prod PG');
    expect(await t.manager.connections.findById(connection.id)).not.toBeNull();

    const ok = await t.app.inject({
      method: 'DELETE',
      url: `/api/v1/connections/${connection.id}`,
      headers: asUser(t.superAdmin),
      payload: { confirmName: 'Prod PG' },
    });
    expect(ok.statusCode).toBe(200);
    expect(await t.manager.connections.findById(connection.id)).toBeNull();
  });

  it('list requires system:connections:manage', async () => {
    const res = await t.app.inject({
      method: 'GET',
      url: '/api/v1/connections',
      headers: asUser(t.viewer),
    });
    expect(res.statusCode).toBe(403);
  });
});

/**
 * A connection created under one ADMINIUM_SECRET and read back under another.
 * Before the fix the whole list 500'd on the undecryptable row, so the one
 * screen that could have explained the failure was the one screen you could
 * not open — while the row itself still claimed `status: 'connected'`.
 */
describe('connection whose DSN was encrypted under a different ADMINIUM_SECRET', () => {
  let t: Harness;

  beforeEach(async () => {
    t = await buildHarness();
  });

  afterEach(async () => {
    await t.app.close();
    await t.meta.db.destroy();
  });

  /** A second app over the SAME meta store, holding a different secret. */
  async function appWithOtherSecret(): Promise<AdminiumServer> {
    const manager = new ConnectionManager({
      meta: t.meta,
      crypto: dsnCryptoFromSecret(`${TEST_SECRET}-rotated-and-definitely-different`),
    });
    const users = usersRepo(t.meta);
    const app = await buildServer({ env: makeEnv(), logger: false });
    app.addHook('onRequest', async (request) => {
      const id = request.headers['x-test-user-id'];
      if (typeof id !== 'string') return;
      const user = await users.findById(id);
      if (user === null) return;
      (request as unknown as { user: { id: string; name: string; email: string } }).user = {
        id: user.id,
        name: user.name,
        email: user.email,
      };
    });
    await app.register(rbacPlugin, { meta: t.meta });
    await app.register(
      async (api) => {
        await api.register(connectionsRoutes({ manager, meta: t.meta }));
      },
      { prefix: '/api/v1' },
    );
    await app.ready();
    return app;
  }

  it('lists the connection as errored instead of 500ing, and names ADMINIUM_SECRET', async () => {
    const created = await t.manager.connections.create({
      name: 'Prod PG',
      engine: 'postgres',
      introspectDsn: 'postgres://ro@db.internal:5432/prod',
      dataDsn: 'postgres://rw@db.internal:5432/prod',
    });
    // The stored row is healthy — that is exactly what makes the lie possible.
    await t.manager.connections.recordTestResult(created.id, {
      ok: true,
      latencyMs: 4,
      error: null,
      readOnly: false,
    });
    expect((await t.manager.connections.findById(created.id))?.status).toBe('connected');

    const other = await appWithOtherSecret();
    try {
      const res = await other.inject({
        method: 'GET',
        url: '/api/v1/connections',
        headers: asUser(t.superAdmin),
      });

      expect(res.statusCode).toBe(200);
      const row = (
        res.json().connections as Array<{
          id: string;
          status: string;
          lastError: string | null;
          dsnMasked: string | null;
        }>
      ).find((c) => c.id === created.id);
      expect(row?.status).toBe('error');
      expect(row?.dsnMasked).toBeNull();
      expect(row?.lastError).toContain('ADMINIUM_SECRET');
    } finally {
      await other.close();
    }
  });
});
