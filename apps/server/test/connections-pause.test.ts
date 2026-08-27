// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Pausing a connection without deleting it (meta wave 0019).
 *
 * The contract under test is that a pause is an INTENT that outlives health,
 * and that it is enforced where the source database is actually touched rather
 * than only in the UI that offers the button:
 *
 *  - `PATCH { disabled }` flips it, audits it under its own action, and leaves
 *    `status`/`lastError` — the last probe's reading — exactly where they were;
 *  - the two routes that dial the source themselves (`/test`, `/introspect`)
 *    refuse while it is paused, the second one BEFORE enqueuing a job that
 *    would fail out of sight;
 *  - `manager.data` refuses, which is what covers the callers with no operator
 *    in the loop (scheduled reports, exports, widgets, public API);
 *  - `mustFind` does NOT refuse, so Studio can still read and RESUME the row;
 *  - a patch that does not mention `disabled` never resumes anything.
 *
 * No live source database is needed — the refusals all land before any dial.
 */
import BetterSqlite3 from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  auditRepo,
  createSqliteMetaDb,
  firstRun,
  rolesRepo,
  usersRepo,
  type MetaDb,
  type Role,
  type User,
} from '@adminium/meta';

import { buildServer, type AdminiumServer } from '../src/app.js';
import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import { ConnectionManager } from '../src/connections/manager.js';
import { ConnectionDisabledError } from '../src/errors.js';
import { rbacPlugin } from '../src/plugins/rbac.js';
import { connectionsRoutes } from '../src/routes/connections/index.js';
import { makeEnv, TEST_SECRET } from './helpers.js';

interface Harness {
  app: AdminiumServer;
  meta: MetaDb;
  manager: ConnectionManager;
  superAdmin: User;
}

function asUser(user: User): Record<string, string> {
  return { 'x-test-user-id': user.id };
}

async function buildHarness(): Promise<Harness> {
  const meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
  await firstRun(meta);

  const roles = rolesRepo(meta);
  const users = usersRepo(meta);
  const role: Role | null = await roles.findBySlug('super-admin');
  if (role === null) throw new Error('missing built-in role super-admin');
  const superAdmin = await users.create({
    email: 'ava@adminium.test',
    name: 'Ava',
    passwordHash: 'test-hash',
    status: 'active',
  });
  await roles.assignToUser(superAdmin.id, role.id);

  const manager = new ConnectionManager({ meta, crypto: dsnCryptoFromSecret(TEST_SECRET) });

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
  await app.register(rbacPlugin, { meta });
  await app.register(
    async (api) => {
      await api.register(connectionsRoutes({ manager, meta }));
    },
    { prefix: '/api/v1' },
  );
  await app.ready();

  return { app, meta, manager, superAdmin };
}

describe('pausing a connection', () => {
  let t: Harness;

  beforeEach(async () => {
    t = await buildHarness();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await t.app.close();
    await t.meta.db.destroy();
  });

  async function makeConnection(): Promise<string> {
    const created = await t.manager.connections.create({
      name: 'Prod PG',
      engine: 'postgres',
      introspectDsn: 'postgres://ro@db.internal:5432/prod',
      dataDsn: 'postgres://rw@db.internal:5432/prod',
    });
    return created.id;
  }

  function patch(id: string, body: Record<string, unknown>) {
    return t.app.inject({
      method: 'PATCH',
      url: `/api/v1/connections/${id}`,
      headers: asUser(t.superAdmin),
      payload: body,
    });
  }

  it('flips `disabled`, releases the pool, and preserves the failing health reading', async () => {
    const id = await makeConnection();
    // The connection was FAILING when it was paused — the case that would be
    // destroyed by a design that spent `status` on the pause.
    await t.manager.connections.recordTestResult(id, {
      ok: false,
      latencyMs: null,
      error: 'connection timed out',
      errorHint: 'allowlist the egress IP',
      readOnly: false,
    });
    const dispose = vi.spyOn(t.manager, 'dispose');

    const paused = await patch(id, { disabled: true });
    expect(paused.statusCode).toBe(200);
    expect(paused.json()).toMatchObject({
      disabled: true,
      // Untouched: resuming hands back the same problem, not a clean slate.
      status: 'error',
      lastError: 'connection timed out',
      lastErrorHint: 'allowlist the egress IP',
    });
    expect(typeof paused.json().disabledAt).toBe('number');
    // Sockets against a database the operator just declared off-limits are
    // half of why anyone pauses one.
    expect(dispose).toHaveBeenCalledWith(id);

    const resumed = await patch(id, { disabled: false });
    expect(resumed.statusCode).toBe(200);
    expect(resumed.json()).toMatchObject({ disabled: false, disabledAt: null, status: 'error' });
  });

  it('audits the pause under its own action, and does not also log an edit', async () => {
    const id = await makeConnection();
    await patch(id, { disabled: true });
    await patch(id, { disabled: false });

    const actions = (await auditRepo(t.meta).list({ category: 'connection' })).map(
      (entry) => entry.action,
    );
    expect(actions).toContain('connection.disable');
    expect(actions).toContain('connection.enable');
    // "Someone paused production" and "someone renamed a connection" are not
    // the same event, and a pause-only patch edited nothing.
    expect(actions).not.toContain('connection.update');
  });

  it('leaves the pause alone when a patch does not mention it', async () => {
    const id = await makeConnection();
    await patch(id, { disabled: true });

    const renamed = await patch(id, { name: 'Prod PG (EU)' });
    expect(renamed.statusCode).toBe(200);
    // A rename must never resume a paused source as a side effect.
    expect(renamed.json()).toMatchObject({ name: 'Prod PG (EU)', disabled: true });
  });

  it('refuses /test and /introspect with 503 CONNECTION_DISABLED while paused', async () => {
    const id = await makeConnection();
    await patch(id, { disabled: true });

    for (const route of ['test', 'introspect']) {
      const res = await t.app.inject({
        method: 'POST',
        url: `/api/v1/connections/${id}/${route}`,
        headers: asUser(t.superAdmin),
      });
      expect(res.statusCode, route).toBe(503);
      expect(res.json().error.code, route).toBe('CONNECTION_DISABLED');
      expect(res.json().error.details, route).toMatchObject({ connectionId: id });
    }

    // …and the health fields the card is showing were not overwritten by a
    // probe that never ran.
    expect((await t.manager.connections.findById(id))?.lastTestedAt).toBeNull();
  });

  it('refuses the pooled data handle, while `mustFind` still opens the door to resume', async () => {
    const id = await makeConnection();
    await patch(id, { disabled: true });

    // The callers with no operator in the loop: scheduled reports, export and
    // import jobs, widget refreshes, the public API. (Quick search no longer
    // reaches this at all — it drops paused connections from its candidate
    // set, so it never dials one; see routes/search.)
    await expect(t.manager.data(id)).rejects.toBeInstanceOf(ConnectionDisabledError);
    await expect(t.manager.dataAdapter(id)).rejects.toBeInstanceOf(ConnectionDisabledError);
    await expect(t.manager.introspectAdapter(id)).rejects.toBeInstanceOf(ConnectionDisabledError);

    // A find that threw would lock the door from the inside — Studio has to be
    // able to read the row it is about to resume.
    expect((await t.manager.mustFind(id)).disabled).toBe(true);
    const listed = await t.app.inject({
      method: 'GET',
      url: '/api/v1/connections',
      headers: asUser(t.superAdmin),
    });
    expect(listed.json().connections).toHaveLength(1);
    expect(listed.json().connections[0]).toMatchObject({ id, disabled: true });
  });
});
