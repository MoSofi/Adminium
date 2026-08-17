// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The `introspect` job kind (08 §2.4) — pre-M12 audit regression pins.
 *
 * The bug: `registerIntrospectJob` existed but had ZERO call sites, so the
 * async 202+jobId contract was dead code in every deployment — the route's
 * `app.jobs.registry.has('introspect')` gate was always false and large-schema
 * introspection ran synchronously on the request thread. Two pins here:
 *
 *  1. the composition root registers the kind (the wiring that was missing);
 *  2. the route path: POST /connections/:id/introspect returns 202 + jobId
 *     with the jobs runtime wired, stamps the OWNER (`payload.userId` — the
 *     routes/jobs convention), and the enqueuing user can poll their job
 *     WITHOUT holding `system:jobs:read`.
 *
 * No live source database anywhere: the job is enqueued, never run (the
 * worker is not started), and the connection row is inserted via the repo.
 */
import BetterSqlite3 from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  connectionsRepo,
  createSqliteMetaDb,
  firstRun,
  jobsRepo,
  rolesRepo,
  usersRepo,
  type DsnCrypto,
  type MetaDb,
  type User,
} from '@adminium/meta';

import { buildServer, type AdminiumServer } from '../src/app.js';
import { INTROSPECT_JOB_KIND } from '../src/connections/introspect.js';
import { ConnectionManager } from '../src/connections/manager.js';
import { registerIntrospectJob } from '../src/connections/introspect.js';
import { registerJobsAndRealtime } from '../src/jobs/register.js';
import { jobOwnerId } from '../src/routes/jobs/index.js';
import { rbacPlugin } from '../src/plugins/rbac.js';
import { connectionsRoutes } from '../src/routes/connections/index.js';
import { makeEnv } from './helpers.js';

const testDsnCrypto: DsnCrypto = {
  encrypt: (plaintext) => `enc:test:${Buffer.from(plaintext, 'utf8').toString('base64')}`,
  decrypt: (token) => Buffer.from(token.slice('enc:test:'.length), 'base64').toString('utf8'),
};

interface Harness {
  app: AdminiumServer;
  meta: MetaDb;
  admin: User;
  connectionId: string;
}

function asUser(user: User): Record<string, string> {
  return { 'x-test-user-id': user.id };
}

async function buildHarness(): Promise<Harness> {
  const meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
  await firstRun(meta);

  const roles = rolesRepo(meta);
  const users = usersRepo(meta);
  // The built-in admin role carries `connections.manage` (meta §6 baseline)
  // but NOT `jobs.read` — exactly the principal the ownership path exists for.
  const adminRole = await roles.findBySlug('admin');
  if (adminRole === null) throw new Error('missing built-in role admin');
  const admin = await users.create({
    email: 'ava@adminium.test',
    name: 'Ava',
    passwordHash: 'test-hash',
    status: 'active',
  });
  await roles.assignToUser(admin.id, adminRole.id);

  const connection = await connectionsRepo(meta, testDsnCrypto).create({
    name: 'shop',
    engine: 'postgres',
    introspectDsn: 'postgres://ro@localhost/shop',
  });

  const manager = new ConnectionManager({ meta, crypto: testDsnCrypto, metaDsn: null });

  const app = await buildServer({ env: makeEnv(), logger: false });
  app.addHook('onRequest', async (request) => {
    const id = request.headers['x-test-user-id'];
    if (typeof id === 'string') {
      const user = await users.findById(id);
      if (user !== null) {
        (request as unknown as { user: unknown }).user = user;
      }
    }
  });
  await app.register(rbacPlugin, { meta });

  // The SAME wiring order compose.ts uses: jobs runtime, then the introspect
  // kind on its registry, then the connections routes.
  const jobs = await registerJobsAndRealtime(app, {
    meta,
    resolveUser: (req) => (req as unknown as { user?: { id: string } | null }).user ?? null,
    can: async () => false, // no system:jobs:* anywhere — ownership must carry the poll
    startWorker: false, // enqueue-only: the job must never actually run (no source DB)
    startScheduler: false,
  });
  registerIntrospectJob(jobs.registry, { manager, meta });

  await app.register(
    async (api) => {
      await api.register(connectionsRoutes({ manager, meta }));
    },
    { prefix: '/api/v1' },
  );
  await app.ready();

  return { app, meta, admin, connectionId: connection.id };
}

describe('introspect job wiring (08 §2.4)', () => {
  let t: Harness;
  beforeEach(async () => {
    t = await buildHarness();
  });
  afterEach(async () => {
    await t.app.close();
    await t.meta.db.destroy();
  });

  it('the jobs registry carries the introspect kind once compose-style wiring ran', () => {
    expect(t.app.jobs.registry.has(INTROSPECT_JOB_KIND)).toBe(true);
  });

  it('POST /connections/:id/introspect 202s with a jobId the enqueuing user can poll (owner, no jobs.read)', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: `/api/v1/connections/${t.connectionId}/introspect`,
      headers: asUser(t.admin),
    });
    expect(res.statusCode, res.body).toBe(202);
    const { jobId } = res.json() as { jobId: string };
    expect(jobId).toBeTruthy();

    // Owner convention: the route stamps payload.userId with the actor.
    const row = await jobsRepo(t.meta).findById(jobId);
    expect(row?.kind).toBe(INTROSPECT_JOB_KIND);
    expect(jobOwnerId(row)).toBe(t.admin.id);

    // And that stamp is what lets the enqueuing user poll: `can` is
    // hard-wired to false here, so a 200 can ONLY come from ownership.
    const poll = await t.app.inject({
      method: 'GET',
      url: `/api/v1/jobs/${jobId}`,
      headers: asUser(t.admin),
    });
    expect(poll.statusCode, poll.body).toBe(200);
    expect((poll.json() as { data: { id: string; status: string } }).data.id).toBe(jobId);
  });
});
