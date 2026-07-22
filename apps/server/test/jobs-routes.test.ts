/**
 * routes/jobs (08-server-api.md §2.17, M2-T07) via fastify.inject on the
 * bare-app harness: enqueue (permission-gated, owner-stamped), status +
 * progress reads (owner or system:jobs:read), keyset list, cooperative cancel.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { permissionsRepo, rolesRepo, usersRepo } from '@adminium/meta';

import { NOOP_PROGRESS_KIND } from '../src/jobs/registry.js';
import { matrixRowsFromGrants } from '../src/rbac/permissions.js';
import { permissionSetAllows, resolvePermissionSet } from '../src/rbac/resolver.js';
import { jobsRoutes } from '../src/routes/jobs/index.js';
import {
  buildBareApp,
  makeJobsContext,
  makeStubAuth,
  type BareApp,
  type JobsTestContext,
  type StubAuth,
} from './jobs-helpers.js';

const OWNER = 'user_owner';
const OTHER = 'user_other';
const ADMIN = 'user_admin';

let app: BareApp;
let ctx: JobsTestContext;
let auth: StubAuth;

beforeEach(async () => {
  ctx = await makeJobsContext();
  auth = makeStubAuth();
  auth.grant(OWNER, 'system:jobs:manage');
  auth.grant(ADMIN, 'system:jobs:read', 'system:jobs:manage');

  app = buildBareApp();
  await app.register(
    jobsRoutes({
      meta: ctx.meta,
      registry: ctx.registry,
      worker: ctx.worker,
      hub: ctx.hub,
      resolveUser: auth.resolveUser,
      can: auth.can,
    }),
    { prefix: '/api/v1' },
  );
  await app.ready();
});

async function enqueueViaApi(userId = OWNER, payload: Record<string, unknown> = { steps: 2 }) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/jobs',
    headers: auth.as(userId),
    payload: { kind: NOOP_PROGRESS_KIND, payload },
  });
  expect(res.statusCode).toBe(202);
  return (res.json() as { data: { jobId: string; status: string } }).data;
}

describe('POST /jobs', () => {
  it('401 without a session', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/jobs',
      payload: { kind: NOOP_PROGRESS_KIND },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('UNAUTHENTICATED');
  });

  it('403 without system:jobs:manage', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/jobs',
      headers: auth.as(OTHER),
      payload: { kind: NOOP_PROGRESS_KIND },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('FORBIDDEN');
  });

  it('422 for an unknown kind, listing the known kinds', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/jobs',
      headers: auth.as(OWNER),
      payload: { kind: 'ghost-kind' },
    });
    expect(res.statusCode).toBe(422);
    const body = res.json();
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(body.error.details.known).toContain(NOOP_PROGRESS_KIND);
  });

  it('422 when the payload fails the handler schema at enqueue time', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/jobs',
      headers: auth.as(OWNER),
      payload: { kind: NOOP_PROGRESS_KIND, payload: { steps: 0 } },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.details.issues[0].path).toBe('steps');
  });

  it('202 enqueues pending and stamps the owner (unspoofably)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/jobs',
      headers: auth.as(OWNER),
      payload: { kind: NOOP_PROGRESS_KIND, payload: { steps: 2, userId: OTHER } },
    });
    expect(res.statusCode).toBe(202);
    const { jobId, status } = res.json().data;
    expect(status).toBe('pending');
    const row = await ctx.jobs.findById(jobId);
    expect(row?.payload['userId']).toBe(OWNER); // client-supplied userId overridden
  });
});

describe('GET /jobs/:id', () => {
  it('owner reads status; foreign user is denied; reader permission grants', async () => {
    const { jobId } = await enqueueViaApi(OWNER);

    const asOwner = await app.inject({ url: `/api/v1/jobs/${jobId}`, headers: auth.as(OWNER) });
    expect(asOwner.statusCode).toBe(200);
    expect(asOwner.json().data).toMatchObject({ id: jobId, status: 'pending', progress: null });

    const asOther = await app.inject({ url: `/api/v1/jobs/${jobId}`, headers: auth.as(OTHER) });
    expect(asOther.statusCode).toBe(403);

    const asAdmin = await app.inject({ url: `/api/v1/jobs/${jobId}`, headers: auth.as(ADMIN) });
    expect(asAdmin.statusCode).toBe(200);
  });

  it('404 for a missing job; reports progress after the worker ran', async () => {
    const missing = await app.inject({ url: '/api/v1/jobs/job_missing', headers: auth.as(ADMIN) });
    expect(missing.statusCode).toBe(404);

    const { jobId } = await enqueueViaApi(OWNER);
    await ctx.worker.runOnce();
    const res = await app.inject({ url: `/api/v1/jobs/${jobId}`, headers: auth.as(OWNER) });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({ status: 'succeeded', progress: { pct: 100 } });
  });
});

describe('GET /jobs', () => {
  it('requires system:jobs:read', async () => {
    const res = await app.inject({ url: '/api/v1/jobs', headers: auth.as(OWNER) });
    expect(res.statusCode).toBe(403);
  });

  it('lists newest-first with a walkable keyset cursor and filters', async () => {
    // Distinct createdAt values via the repo clock parameter.
    const ids: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      const job = await ctx.jobs.enqueue(
        { kind: NOOP_PROGRESS_KIND, payload: { steps: 1 } },
        ctx.clock.now() + i,
      );
      ids.push(job.id);
    }

    const page1 = await app.inject({ url: '/api/v1/jobs?limit=2', headers: auth.as(ADMIN) });
    expect(page1.statusCode).toBe(200);
    const body1 = page1.json();
    expect(body1.data.map((j: { id: string }) => j.id)).toEqual([ids[4], ids[3]]);
    expect(body1.cursor.next).not.toBeNull();

    const page2 = await app.inject({
      url: `/api/v1/jobs?limit=2&cursor=${encodeURIComponent(body1.cursor.next)}`,
      headers: auth.as(ADMIN),
    });
    const body2 = page2.json();
    expect(body2.data.map((j: { id: string }) => j.id)).toEqual([ids[2], ids[1]]);

    const page3 = await app.inject({
      url: `/api/v1/jobs?limit=2&cursor=${encodeURIComponent(body2.cursor.next)}`,
      headers: auth.as(ADMIN),
    });
    const body3 = page3.json();
    expect(body3.data.map((j: { id: string }) => j.id)).toEqual([ids[0]]);
    expect(body3.cursor.next).toBeNull();

    // Status filter: run one job to success, then filter.
    await ctx.worker.runOnce();
    const succeeded = await app.inject({
      url: '/api/v1/jobs?status=succeeded',
      headers: auth.as(ADMIN),
    });
    expect(succeeded.json().data).toHaveLength(1);
    expect(succeeded.json().data[0].status).toBe('succeeded');
  });

  it('422 on a malformed cursor', async () => {
    const res = await app.inject({
      url: '/api/v1/jobs?cursor=not-a-cursor',
      headers: auth.as(ADMIN),
    });
    expect(res.statusCode).toBe(422);
  });
});

describe('POST /jobs/:id/cancel', () => {
  it('owner cancels a pending job; a cancelled event is published', async () => {
    const { jobId } = await enqueueViaApi(OWNER);
    const events: string[] = [];
    ctx.hub.subscribe(`jobs:${jobId}`, (e) => events.push(e.type));

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/jobs/${jobId}/cancel`,
      headers: auth.as(OWNER),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.status).toBe('cancelled');
    expect(events).toEqual(['cancelled']);

    // Cancelled job is never claimed.
    expect(await ctx.worker.runOnce()).toBe(0);
  });

  it('409 when the job already finished; 403 for a foreign non-manager', async () => {
    const { jobId } = await enqueueViaApi(OWNER);

    const asOther = await app.inject({
      method: 'POST',
      url: `/api/v1/jobs/${jobId}/cancel`,
      headers: auth.as(OTHER),
    });
    expect(asOther.statusCode).toBe(403);

    await ctx.worker.runOnce();
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/jobs/${jobId}/cancel`,
      headers: auth.as(OWNER),
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('CONFLICT');
  });
});

describe('real RBAC path (closed-set regression)', () => {
  // Regression for the pre-M12 audit finding: `jobs.read`/`jobs.manage` were
  // missing from meta's SYSTEM_ACTION_KEYS, so `system:jobs:read` was
  // unparseable — unstorable through PUT /roles/:id/permissions AND never
  // matched by isGranted. This wires the SAME decision path compose.ts uses
  // (matrix rows → resolvePermissionSet → permissionSetAllows) instead of the
  // stub grant map, and proves a role granted system:jobs:read can GET /jobs.
  it('a role granted system:jobs:read via matrix rows can GET /jobs', async () => {
    const localCtx = await makeJobsContext();
    const roles = rolesRepo(localCtx.meta);
    const users = usersRepo(localCtx.meta);
    const permissions = permissionsRepo(localCtx.meta);

    const role = await roles.create({ slug: 'job-watcher', name: 'Job Watcher' });
    const user = await users.create({
      email: 'watcher@adminium.test',
      name: 'Watcher',
      passwordHash: 'test-hash',
      status: 'active',
    });
    await roles.assignToUser(user.id, role.id);

    // Store the grant exactly like PUT /roles/:id/permissions does.
    const { rows, invalid } = matrixRowsFromGrants(['system:jobs:read']);
    expect(invalid).toEqual([]); // pre-fix: ['system:jobs:read']
    for (const row of rows) {
      await permissions.grant(role.id, row.resourceKind, row.resourceRef, row.actions);
    }

    const stubUsers = makeStubAuth();
    const realApp = buildBareApp();
    await realApp.register(
      jobsRoutes({
        meta: localCtx.meta,
        registry: localCtx.registry,
        worker: localCtx.worker,
        hub: localCtx.hub,
        resolveUser: stubUsers.resolveUser,
        // compose.ts's `can`: resolver → decision function, super-admin bypass included.
        can: async (u, permission) =>
          permissionSetAllows(
            await resolvePermissionSet(localCtx.meta, { kind: 'user', id: u.id, label: u.id }),
            permission,
          ),
      }),
      { prefix: '/api/v1' },
    );
    await realApp.ready();

    const allowed = await realApp.inject({ url: '/api/v1/jobs', headers: stubUsers.as(user.id) });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json().data).toEqual([]);

    // read ≠ manage: enqueueing still requires system:jobs:manage.
    const denied = await realApp.inject({
      method: 'POST',
      url: '/api/v1/jobs',
      headers: stubUsers.as(user.id),
      payload: { kind: NOOP_PROGRESS_KIND },
    });
    expect(denied.statusCode).toBe(403);
    await realApp.close();
  });
});

describe('POST /jobs — internal-kind guard (security review 2026-07-23)', () => {
  it('refuses to enqueue a kind marked internal, even with jobs:manage', async () => {
    // Internal kinds (export-run, import-run, report-run, llm-run, introspect)
    // carry security-sensitive payloads their dedicated routes derive from the
    // caller's authority; POST /jobs must not let a jobs:manage holder hand
    // one in. A stand-in internal kind proves the guard without the real deps.
    ctx.registry.registerJobHandler(
      'test-internal-kind',
      z.object({ userId: z.string().optional() }).passthrough(),
      async () => undefined,
      { internal: true },
    );
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/jobs',
      headers: auth.as(OWNER), // holds system:jobs:manage
      payload: { kind: 'test-internal-kind', payload: {} },
    });
    expect(res.statusCode).toBe(403);
  });

  it('still enqueues a non-internal kind for the same caller', async () => {
    const data = await enqueueViaApi();
    expect(data.jobId).toBeTruthy();
  });
});
