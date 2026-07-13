/**
 * M2 exit criteria, end-to-end (workplan/16-milestones.md — "M2 — Server
 * core", Exit criteria) against ONE composed server instance on a fresh
 * in-memory SQLite meta store:
 *
 *  (a) firstRun migrates + seeds; createFirstSuperAdmin;
 *  (b) super admin signs in (cookie session) and provisions Admin/Editor/
 *      Viewer users — users are created via the meta repos (no user-creation
 *      route exists yet; the invite flow is an M4 gap) and roles are assigned
 *      through the real POST /api/v1/users/:id/roles route;
 *  (c) Viewer hits POST /api/v1/roles → 403 + `permission.denied` audit row;
 *      Admin (granted system:roles:manage through the matrix PUT) → 201 +
 *      `role.create` audit row;
 *  (d) super admin enrolls TOTP, logs out, logs back in → 202 challenge →
 *      verify → the new session works;
 *  (e) a queued noop-progress job streams ordered 0→100 progress over the SSE
 *      endpoint and the job row finishes `succeeded`;
 *  (f) the same journey over the /ws WebSocket gateway — and a SECOND server
 *      booted without @fastify/websocket (GET /ws → 404) proves the SSE
 *      fallback still streams when WS is disabled.
 *
 * Wiring note: buildServer() only assembles core+auth; the rbac plugin, the
 * roles/audit routes, and jobs+realtime are composed here exactly the way
 * jobs/register.ts documents (resolveUser → request.user, can → permission
 * resolver). `registerJobsAndRealtime` has no "disable WS" option, so the
 * WS-disabled server wires registerSseRoute + jobsRoutes manually — worth an
 * opts flag when the integrated boot path lands.
 *
 * Deterministic: the worker never polls (startWorker: false) — every run is
 * an explicit `worker.runOnce()`; the only waits are on observed stream state.
 */
import type { AddressInfo } from 'node:net';

import BetterSqlite3 from 'better-sqlite3';
import type { FastifyRequest } from 'fastify';
import * as OTPAuth from 'otpauth';
import { WebSocket as WsClient } from 'ws';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  auditRepo,
  createFirstSuperAdmin,
  createSqliteMetaDb,
  firstRun,
  jobsRepo,
  rolesRepo,
  usersRepo,
  type MetaDb,
  type Role,
  type User,
} from '@adminium/meta';

import { buildServer, type AdminiumServer } from '../src/app.js';
import { NOOP_PROGRESS_KIND, createJobRegistry, registerNoopProgressHandler } from '../src/jobs/registry.js';
import { registerJobsAndRealtime } from '../src/jobs/register.js';
import { JobWorker } from '../src/jobs/worker.js';
import { rbacPlugin } from '../src/plugins/rbac.js';
import { permissionSetAllows, resolvePermissionSet } from '../src/rbac/resolver.js';
import { RealtimeHub, type RealtimeUser } from '../src/realtime/hub.js';
import { registerSseRoute } from '../src/realtime/sse.js';
import { auditRoutes } from '../src/routes/audit/index.js';
import { jobOwnerId, jobsRoutes } from '../src/routes/jobs/index.js';
import { rolesRoutes } from '../src/routes/roles/index.js';
import { ADMIN_EMAIL, ADMIN_PASSWORD, adminPasswordHash, sessionCookie } from './auth-helpers.js';
import { until } from './jobs-helpers.js';
import { makeEnv } from './helpers.js';

// --- composition ----------------------------------------------------------------

interface ComposedServer {
  app: AdminiumServer;
  meta: MetaDb;
  worker: JobWorker;
  superAdmin: User;
  appliedMigrations: string[];
  destroy: () => Promise<void>;
}

/**
 * Fresh sqlite meta + firstRun + first super admin, then the full M2 server:
 * buildServer (core/auth/me) + rbac plugin + roles/audit routes + jobs and
 * realtime — over WS+SSE (`websocket: true`) or SSE-only (`websocket: false`).
 */
async function composeServer(opts: { websocket: boolean }): Promise<ComposedServer> {
  const meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
  const { appliedMigrations } = await firstRun(meta);
  const superAdmin = await createFirstSuperAdmin(meta, {
    email: ADMIN_EMAIL,
    name: 'Ava Reyes',
    passwordHash: await adminPasswordHash(),
  });

  const app = await buildServer({ env: makeEnv(), logger: false, metaDb: meta });
  await app.register(rbacPlugin, { meta });
  await app.register(
    async (api) => {
      await api.register(rolesRoutes);
      await api.register(auditRoutes);
    },
    { prefix: '/api/v1' },
  );

  // The documented integration contract (jobs/register.ts header).
  const resolveUser = (request: FastifyRequest): RealtimeUser | null =>
    request.user === null ? null : { id: request.user.id };
  const can = async (user: RealtimeUser, permission: string): Promise<boolean> =>
    permissionSetAllows(
      await resolvePermissionSet(meta, { kind: 'user', id: user.id, label: user.id }),
      permission,
    );

  let worker: JobWorker;
  if (opts.websocket) {
    const rt = await registerJobsAndRealtime(app, {
      meta,
      resolveUser,
      can,
      startWorker: false, // deterministic: tests drive worker.runOnce()
      startScheduler: false,
    });
    worker = rt.worker;
  } else {
    // "SSE fallback verified when WS disabled": same routes, same deps, but
    // neither @fastify/websocket nor GET /ws are registered.
    const hub = new RealtimeHub();
    const registry = createJobRegistry();
    registerNoopProgressHandler(registry);
    worker = new JobWorker({ meta, registry, hub, workerId: 'm2-exit:sse-only' });
    const jobs = jobsRepo(meta);
    const gatewayDeps = {
      hub,
      resolveUser,
      can,
      getJobOwner: async (jobId: string) => jobOwnerId(await jobs.findById(jobId)),
    };
    await app.register(
      async (api) => {
        registerSseRoute(api, gatewayDeps, { keepAliveMs: 40 });
        await api.register(jobsRoutes({ meta, registry, worker, hub, resolveUser, can }));
      },
      { prefix: '/api/v1' },
    );
    app.addHook('onClose', async () => {
      await worker.stop();
      hub.close();
    });
  }

  await app.ready();
  return {
    app,
    meta,
    worker,
    superAdmin,
    appliedMigrations,
    destroy: async () => {
      await app.close();
      await meta.db.destroy();
    },
  };
}

async function loginAs(
  app: AdminiumServer,
  email: string,
  password: string = ADMIN_PASSWORD,
): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email, password },
  });
  expect(res.statusCode).toBe(200);
  return sessionCookie(res.headers['set-cookie']);
}

function totpCode(secretBase32: string): string {
  return new OTPAuth.TOTP({
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secretBase32),
  }).generate();
}

// --- SSE stream harness ---------------------------------------------------------

interface SseFrame {
  channel: string;
  type: string;
  data: { pct?: number };
  ts: string;
}

interface SseStream {
  status: number;
  contentType: string | null;
  buffer: () => string;
  frames: () => SseFrame[];
  close: () => Promise<void>;
}

/** Opens a real-HTTP SSE stream and accumulates its frames until closed. */
async function openSse(baseUrl: string, channels: string, cookie: string): Promise<SseStream> {
  const controller = new AbortController();
  const res = await fetch(`${baseUrl}/api/v1/events?channels=${encodeURIComponent(channels)}`, {
    headers: { cookie },
    signal: controller.signal,
  });
  let buffer = '';
  const reader = res.body?.getReader();
  const decoder = new TextDecoder();
  const pump =
    reader === undefined
      ? Promise.resolve()
      : (async () => {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
          }
        })().catch(() => {
          // aborted at the end of the test
        });
  return {
    status: res.status,
    contentType: res.headers.get('content-type'),
    buffer: () => buffer,
    frames: () =>
      buffer
        .split('\n')
        .filter((line) => line.startsWith('data: '))
        .map((line) => JSON.parse(line.slice('data: '.length)) as SseFrame),
    close: async () => {
      controller.abort();
      await pump;
    },
  };
}

/** Progress percentages in arrival order for one jobs:<id> channel. */
function progressPcts(frames: readonly SseFrame[], channel: string): number[] {
  return frames
    .filter((frame) => frame.channel === channel && frame.type === 'progress')
    .map((frame) => frame.data.pct ?? -1);
}

// --- the continuous scenario ------------------------------------------------------

describe('M2 exit criteria — one continuous scenario on a single server', () => {
  let ctx: ComposedServer;
  let baseUrl: string;
  let roles: { superAdmin: Role; admin: Role; editor: Role; viewer: Role };
  let adminUser: User;
  let editorUser: User;
  let viewerUser: User;
  /** Session cookies, keyed by actor. */
  const cookies: Record<string, string> = {};
  /** The super admin's TOTP secret once enrolled. */
  let totpSecret = '';

  beforeAll(async () => {
    ctx = await composeServer({ websocket: true });
    // Real socket for the streaming legs; inject() keeps working alongside.
    await ctx.app.listen({ port: 0, host: '127.0.0.1' });
    const { port } = ctx.app.server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await ctx.destroy();
  });

  it('(a) fresh DB: firstRun provisions every adminium_* table and seeds the built-ins', async () => {
    expect(ctx.appliedMigrations.length).toBeGreaterThan(0);

    const tables = (await ctx.meta.db.introspection.getTables()).map((table) => table.name);
    for (const required of [
      'adminium_users',
      'adminium_sessions',
      'adminium_roles',
      'adminium_role_permissions',
      'adminium_user_roles',
      'adminium_api_keys',
      'adminium_audit_log',
      'adminium_jobs',
    ]) {
      expect(tables, `expected migrations to create ${required}`).toContain(required);
    }

    const repo = rolesRepo(ctx.meta);
    const findRole = async (slug: string): Promise<Role> => {
      const role = await repo.findBySlug(slug);
      if (role === null) throw new Error(`built-in role ${slug} missing`);
      return role;
    };
    roles = {
      superAdmin: await findRole('super-admin'),
      admin: await findRole('admin'),
      editor: await findRole('editor'),
      viewer: await findRole('viewer'),
    };

    // createFirstSuperAdmin: exactly one user, holding super-admin.
    expect(await usersRepo(ctx.meta).count()).toBe(1);
    const held = await repo.rolesForUser(ctx.superAdmin.id);
    expect(held.map((role) => role.slug)).toContain('super-admin');
  });

  it('(b) super admin signs in and provisions Admin/Editor/Viewer via the roles routes', async () => {
    cookies['super'] = await loginAs(ctx.app, ADMIN_EMAIL);

    // GAP (M4 invite flow): there is no user-creation route in M2 — only
    // /setup first-admin bootstrap and role assignment for existing users.
    // Users are created via the meta repo; role assignment goes through the
    // real API so it lands in the audit log.
    const users = usersRepo(ctx.meta);
    const passwordHash = await adminPasswordHash();
    adminUser = await users.create({
      email: 'noah@example.com',
      name: 'Noah Kim',
      passwordHash,
      status: 'active',
    });
    editorUser = await users.create({
      email: 'mia@example.com',
      name: 'Mia Chen',
      passwordHash,
      status: 'active',
    });
    viewerUser = await users.create({
      email: 'liam@example.com',
      name: 'Liam Ortiz',
      passwordHash,
      status: 'active',
    });

    const assignments: Array<[User, Role]> = [
      [adminUser, roles.admin],
      [editorUser, roles.editor],
      [viewerUser, roles.viewer],
    ];
    for (const [user, role] of assignments) {
      const res = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/users/${user.id}/roles`,
        headers: { cookie: cookies['super'] ?? '' },
        payload: { roleId: role.id },
      });
      expect(res.statusCode).toBe(200);
      expect((res.json() as { roleIds: string[] }).roleIds).toContain(role.id);
    }

    const assigns = (await auditRepo(ctx.meta).list({ category: 'rbac' })).filter(
      (entry) => entry.action === 'user.role.assign',
    );
    expect(assigns).toHaveLength(3);
    expect(assigns.every((entry) => entry.actorId === ctx.superAdmin.id)).toBe(true);
  });

  it('(c) Viewer is denied the RBAC-protected mutation (403 + audit); Admin is allowed (2xx + audit)', async () => {
    // Viewer → POST /api/v1/roles → 403 FORBIDDEN with the missing permission.
    cookies['viewer'] = await loginAs(ctx.app, viewerUser.email);
    const denied = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/roles',
      headers: { cookie: cookies['viewer'] ?? '' },
      payload: { name: 'Should Never Exist' },
    });
    expect(denied.statusCode).toBe(403);
    const deniedBody = denied.json() as {
      error: { code: string; details: { permission: string } };
    };
    expect(deniedBody.error.code).toBe('FORBIDDEN');
    expect(deniedBody.error.details.permission).toBe('system:roles:manage');

    // The denial is audited: rbac / permission.denied, actor = viewer.
    const deniedRows = (await auditRepo(ctx.meta).list({ category: 'rbac' })).filter(
      (entry) => entry.action === 'permission.denied',
    );
    expect(deniedRows.length).toBeGreaterThan(0);
    expect(deniedRows[0]?.actorId).toBe(viewerUser.id);

    // Editor is equally denied (deny-by-default beyond seeded grants).
    cookies['editor'] = await loginAs(ctx.app, editorUser.email);
    const editorDenied = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/roles',
      headers: { cookie: cookies['editor'] ?? '' },
    });
    expect(editorDenied.statusCode).toBe(403);

    // The built-in admin seed does not include roles.manage — the super admin
    // grants it through the real permission-matrix routes.
    const current = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/roles/${roles.admin.id}/permissions`,
      headers: { cookie: cookies['super'] ?? '' },
    });
    expect(current.statusCode).toBe(200);
    const grants = (current.json() as { grants: string[] }).grants;
    const put = await ctx.app.inject({
      method: 'PUT',
      url: `/api/v1/roles/${roles.admin.id}/permissions`,
      headers: { cookie: cookies['super'] ?? '' },
      payload: { grants: [...grants, 'system:roles:manage'] },
    });
    expect(put.statusCode).toBe(200);
    expect((put.json() as { grants: string[] }).grants).toContain('system:roles:manage');

    // Admin → the same mutation → 201.
    cookies['admin'] = await loginAs(ctx.app, adminUser.email);
    const allowed = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/roles',
      headers: { cookie: cookies['admin'] ?? '' },
      payload: { name: 'Support Team', description: 'Handles tickets' },
    });
    expect(allowed.statusCode).toBe(201);
    expect((allowed.json() as { slug: string }).slug).toBe('support-team');

    // The mutation is audited: rbac / role.create, actor = admin.
    const created = (await auditRepo(ctx.meta).list({ category: 'rbac' })).filter(
      (entry) => entry.action === 'role.create',
    );
    expect(created.length).toBe(1);
    expect(created[0]?.actorId).toBe(adminUser.id);

    // And the role the viewer tried to create never appeared.
    expect(await rolesRepo(ctx.meta).findBySlug('should-never-exist')).toBeNull();
  });

  it('(d) TOTP: enroll → activate → logout → login 202 challenge → verify → session works', async () => {
    const cookie = cookies['super'] ?? '';

    const enroll = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/2fa/enroll',
      headers: { cookie },
    });
    expect(enroll.statusCode).toBe(200);
    totpSecret = (enroll.json() as { data: { secret: string } }).data.secret;

    const activate = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/2fa/activate',
      headers: { cookie },
      payload: { code: totpCode(totpSecret) },
    });
    expect(activate.statusCode).toBe(200);
    expect((activate.json() as { data: { recoveryCodes: string[] } }).data.recoveryCodes).toHaveLength(10);

    const logout = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { cookie },
    });
    expect(logout.statusCode).toBe(200);
    const dead = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/auth/session',
      headers: { cookie },
    });
    expect(dead.statusCode).toBe(401);

    // Password alone now yields the 202 MFA challenge — no session cookie.
    const stepUp = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    });
    expect(stepUp.statusCode).toBe(202);
    const challenge = (
      stepUp.json() as { data: { twoFactorRequired: boolean; challengeToken: string } }
    ).data;
    expect(challenge.twoFactorRequired).toBe(true);
    expect(stepUp.headers['set-cookie']).toBeUndefined();

    const verify = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/2fa/verify',
      payload: { challengeToken: challenge.challengeToken, code: totpCode(totpSecret) },
    });
    expect(verify.statusCode).toBe(200);
    cookies['super'] = sessionCookie(verify.headers['set-cookie']);

    const session = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/auth/session',
      headers: { cookie: cookies['super'] ?? '' },
    });
    expect(session.statusCode).toBe(200);
  });

  it('(e) SSE: an enqueued noop-progress job streams ordered 0→100 and lands succeeded', async () => {
    const cookie = cookies['super'] ?? '';
    const enqueue = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/jobs',
      headers: { cookie },
      payload: { kind: NOOP_PROGRESS_KIND, payload: { steps: 4 } },
    });
    expect(enqueue.statusCode).toBe(202);
    const { jobId, status } = (enqueue.json() as { data: { jobId: string; status: string } }).data;
    expect(status).toBe('pending');

    const stream = await openSse(baseUrl, `jobs:${jobId}`, cookie);
    expect(stream.status).toBe(200);
    expect(stream.contentType).toContain('text/event-stream');
    // Subscription is live once the retry hint has been flushed.
    await until(() => stream.buffer().includes('retry:'));

    expect(await ctx.worker.runOnce()).toBe(1);
    await until(() => stream.buffer().includes('event: completed'));
    await stream.close();

    const frames = stream.frames();
    expect(progressPcts(frames, `jobs:${jobId}`)).toEqual([0, 25, 50, 75, 100]);
    expect(frames.at(-1)?.type).toBe('completed');

    const row = await jobsRepo(ctx.meta).findById(jobId);
    expect(row?.status).toBe('succeeded');
    expect(row?.finishedAt).not.toBeNull();
  });

  it('(f) WS: a second job streams the same ordered progress over the /ws gateway', async () => {
    const cookie = cookies['super'] ?? '';
    const enqueue = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/jobs',
      headers: { cookie },
      payload: { kind: NOOP_PROGRESS_KIND, payload: { steps: 4 } },
    });
    expect(enqueue.statusCode).toBe(202);
    const jobId = (enqueue.json() as { data: { jobId: string } }).data.jobId;
    const channel = `jobs:${jobId}`;

    // The session cookie authenticates the upgrade — same principal as REST.
    const socket = new WsClient(`${baseUrl.replace('http:', 'ws:')}/ws`, {
      headers: { cookie },
    });
    socket.on('error', () => {});
    interface Frame {
      op?: string;
      channel?: string;
      type?: string;
      data?: { pct?: number };
    }
    const frames: Frame[] = [];
    socket.on('message', (raw) => frames.push(JSON.parse(String(raw)) as Frame));
    await new Promise<void>((resolve, reject) => {
      socket.once('open', resolve);
      socket.once('error', reject);
    });

    try {
      socket.send(JSON.stringify({ op: 'subscribe', channel }));
      await until(() => frames.some((frame) => frame.op === 'subscribed'));

      expect(await ctx.worker.runOnce()).toBe(1);
      await until(() => frames.some((frame) => frame.type === 'completed'));

      const pcts = frames
        .filter((frame) => frame.channel === channel && frame.type === 'progress')
        .map((frame) => frame.data?.pct ?? -1);
      expect(pcts).toEqual([0, 25, 50, 75, 100]);
      expect(frames.at(-1)?.type).toBe('completed');
    } finally {
      socket.terminate();
    }

    const row = await jobsRepo(ctx.meta).findById(jobId);
    expect(row?.status).toBe('succeeded');
  });

  it('WS gateway rejects anonymous upgrades pre-handshake (401)', async () => {
    const socket = new WsClient(`${baseUrl.replace('http:', 'ws:')}/ws`);
    socket.on('error', () => {});
    const status = await new Promise<number>((resolve, reject) => {
      socket.once('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0));
      socket.once('open', () => reject(new Error('handshake unexpectedly succeeded')));
    });
    expect(status).toBe(401);
    socket.terminate();
  });
});

// --- SSE fallback with WebSocket disabled -----------------------------------------

describe('M2 exit criteria — SSE fallback when WS is disabled', () => {
  let ctx: ComposedServer;
  let baseUrl: string;

  beforeAll(async () => {
    ctx = await composeServer({ websocket: false });
    await ctx.app.listen({ port: 0, host: '127.0.0.1' });
    const { port } = ctx.app.server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await ctx.destroy();
  });

  it('has no /ws route at all', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/ws' });
    expect(res.statusCode).toBe(404);
  });

  it('still streams job progress over /api/v1/events', async () => {
    const cookie = await loginAs(ctx.app, ADMIN_EMAIL);
    const enqueue = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/jobs',
      headers: { cookie },
      payload: { kind: NOOP_PROGRESS_KIND, payload: { steps: 2 } },
    });
    expect(enqueue.statusCode).toBe(202);
    const jobId = (enqueue.json() as { data: { jobId: string } }).data.jobId;

    const stream = await openSse(baseUrl, `jobs:${jobId}`, cookie);
    expect(stream.status).toBe(200);
    await until(() => stream.buffer().includes('retry:'));

    expect(await ctx.worker.runOnce()).toBe(1);
    await until(() => stream.buffer().includes('event: completed'));
    await stream.close();

    expect(progressPcts(stream.frames(), `jobs:${jobId}`)).toEqual([0, 50, 100]);
    expect((await jobsRepo(ctx.meta).findById(jobId))?.status).toBe('succeeded');
  });
});
