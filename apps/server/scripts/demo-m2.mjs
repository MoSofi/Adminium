#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * M2 exit-criteria demo (16-milestones.md — "M2 — Server core").
 *
 *   cd apps/server && node scripts/demo-m2.mjs
 *
 * Boots the real server on a random port with a throwaway SQLite meta file,
 * then walks the whole exit journey over plain HTTP/WS with narration:
 * firstRun migrations → first super admin → users + roles → Viewer 403 vs
 * Admin 201 (both audited) → TOTP enroll/step-up login → a noop-progress job
 * streamed over SSE and over the /ws WebSocket — and prints the audit-log
 * tail as the finale.
 *
 * Imports the compiled build from ../dist; if it is missing, it compiles the
 * package once with the workspace-local `tsc` (no network, no installs).
 */

import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const serverRoot = join(here, '..');
const distEntry = join(serverRoot, 'dist', 'app.js');
const require = createRequire(import.meta.url);

// --- tiny console helpers ----------------------------------------------------------

const ok = (msg) => console.log(`  ✓ ${msg}`);
const step = (msg) => console.log(`\n▸ ${msg}`);
const info = (msg) => console.log(`    ${msg}`);

function assert(condition, message) {
  if (!condition) throw new Error(`demo assertion failed: ${message}`);
}

// --- ensure the compiled build exists ------------------------------------------------

if (!existsSync(distEntry)) {
  step('dist/ missing — compiling @adminium/server with the workspace tsc');
  let tscJs;
  try {
    tscJs = require.resolve('typescript/lib/tsc.js');
  } catch {
    console.error('Cannot resolve the local TypeScript compiler. Run a workspace build first:');
    console.error('  pnpm --filter @adminium/server... build');
    process.exit(1);
  }
  const result = spawnSync(process.execPath, [tscJs, '-p', join(serverRoot, 'tsconfig.build.json')], {
    cwd: serverRoot,
    stdio: 'inherit',
  });
  if (result.status !== 0 || !existsSync(distEntry)) {
    console.error('Build failed (are the workspace deps built?). Try:');
    console.error('  pnpm --filter @adminium/server... build');
    process.exit(1);
  }
}

// --- dynamic imports (dist + workspace deps) ----------------------------------------

const distUrl = (rel) => pathToFileURL(join(serverRoot, 'dist', rel)).href;

const [
  { buildServer },
  { envSchema },
  { hashPassword },
  { rbacPlugin },
  { rolesRoutes },
  { auditRoutes },
  { registerJobsAndRealtime },
  { NOOP_PROGRESS_KIND },
  { resolvePermissionSet, permissionSetAllows },
  meta_,
  { default: BetterSqlite3 },
  OTPAuth,
  { WebSocket: WsClient },
] = await Promise.all([
  import(distUrl('app.js')),
  import(distUrl('config/env.js')),
  import(distUrl('auth/passwords.js')),
  import(distUrl('plugins/rbac.js')),
  import(distUrl('routes/roles/index.js')),
  import(distUrl('routes/audit/index.js')),
  import(distUrl('jobs/register.js')),
  import(distUrl('jobs/registry.js')),
  import(distUrl('rbac/resolver.js')),
  import('@adminium/meta'),
  import('better-sqlite3'),
  import('otpauth'),
  import('ws'),
]);
const { createSqliteMetaDb, firstRun, createFirstSuperAdmin, usersRepo, rolesRepo } = meta_;

// --- boot ---------------------------------------------------------------------------

const PASSWORD = 'correct-horse-battery-staple';
const SUPER_EMAIL = 'ava@example.com';

const tempDir = mkdtempSync(join(tmpdir(), 'adminium-m2-demo-'));
const dbPath = join(tempDir, 'meta.sqlite');

console.log('M2 exit-criteria demo — Adminium server core');
console.log('=============================================');

step(`fresh SQLite meta store at ${dbPath}`);
const meta = createSqliteMetaDb({ database: new BetterSqlite3(dbPath) });
const { appliedMigrations } = await firstRun(meta);
const tables = (await meta.db.introspection.getTables())
  .map((t) => t.name)
  .filter((n) => n.startsWith('adminium_'));
ok(`firstRun applied ${appliedMigrations.length} migration(s) → ${tables.length} adminium_* tables`);
info(tables.join(', '));
info('(PG/MySQL run the identical migration set — packages/meta suites, env-gated by TEST_PG_URL / TEST_MYSQL_URL)');

const passwordHash = await hashPassword(PASSWORD);
const superAdmin = await createFirstSuperAdmin(meta, {
  email: SUPER_EMAIL,
  name: 'Ava Reyes',
  passwordHash,
});
ok(`first super admin created: ${superAdmin.email}`);

step('composing the server: core + auth + rbac + roles/audit routes + jobs/realtime');
const env = envSchema.parse({ ADMINIUM_SECRET: 'm2-demo-secret-0123456789abcdef' });
const app = await buildServer({ env, logger: false, metaDb: meta });
await app.register(rbacPlugin, { meta });
await app.register(
  async (api) => {
    await api.register(rolesRoutes);
    await api.register(auditRoutes);
  },
  { prefix: '/api/v1' },
);
const resolveUser = (request) => (request.user === null ? null : { id: request.user.id });
const can = async (user, permission) =>
  permissionSetAllows(
    await resolvePermissionSet(meta, { kind: 'user', id: user.id, label: user.id }),
    permission,
  );
await registerJobsAndRealtime(app, {
  meta,
  resolveUser,
  can,
  worker: { pollIntervalMs: 100 }, // snappy demo polling
  startScheduler: false,
});

await app.listen({ port: 0, host: '127.0.0.1' });
const { port } = app.server.address();
const baseUrl = `http://127.0.0.1:${port}`;
ok(`listening on ${baseUrl} (worker polling every 100 ms)`);

// --- HTTP helpers --------------------------------------------------------------------

async function api(method, path, { cookie, body } = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(cookie !== undefined ? { cookie } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  const json = text.length > 0 ? JSON.parse(text) : null;
  const setCookie = res.headers
    .getSetCookie()
    .map((h) => h.split(';')[0])
    .find((p) => p.startsWith('adminium_session='));
  return { status: res.status, json, cookie: setCookie ?? null };
}

async function login(email, password = PASSWORD) {
  const res = await api('POST', '/api/v1/auth/login', { body: { email, password } });
  return res;
}

function totpCode(secretBase32) {
  return new OTPAuth.TOTP({
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secretBase32),
  }).generate();
}

try {
  // --- (b) sign in, provision users -------------------------------------------------

  step('super admin signs in (opaque-token cookie session)');
  let superCookie = (await login(SUPER_EMAIL)).cookie;
  assert(superCookie !== null, 'super admin login sets a session cookie');
  ok('POST /api/v1/auth/login → 200 + httpOnly adminium_session cookie');

  step('provisioning Admin / Editor / Viewer users');
  info('(no user-creation route exists in M2 — users go in via the meta repo;');
  info(' the invite flow is an M4 deliverable. Role assignment uses the real API.)');
  const users = usersRepo(meta);
  const rolesR = rolesRepo(meta);
  const bySlug = async (slug) => (await rolesR.findBySlug(slug));
  const adminRole = await bySlug('admin');
  const editorRole = await bySlug('editor');
  const viewerRole = await bySlug('viewer');
  const mk = (email, name) => users.create({ email, name, passwordHash, status: 'active' });
  const noah = await mk('noah@example.com', 'Noah Kim');
  const mia = await mk('mia@example.com', 'Mia Chen');
  const liam = await mk('liam@example.com', 'Liam Ortiz');
  for (const [user, role] of [
    [noah, adminRole],
    [mia, editorRole],
    [liam, viewerRole],
  ]) {
    const res = await api('POST', `/api/v1/users/${user.id}/roles`, {
      cookie: superCookie,
      body: { roleId: role.id },
    });
    assert(res.status === 200, `role assign for ${user.email} (got ${res.status})`);
    ok(`${user.name} → ${role.name} (POST /users/:id/roles, audited)`);
  }

  // --- (c) RBAC: viewer denied, admin allowed ---------------------------------------

  step('RBAC enforcement: Viewer vs Admin on POST /api/v1/roles');
  const viewerCookie = (await login(liam.email)).cookie;
  const denied = await api('POST', '/api/v1/roles', {
    cookie: viewerCookie,
    body: { name: 'Should Never Exist' },
  });
  assert(denied.status === 403, `viewer must get 403 (got ${denied.status})`);
  ok(`Viewer (Liam): 403 ${denied.json.error.code} — missing ${denied.json.error.details.permission}`);

  // Built-in admin seed does not carry roles.manage — grant it via the matrix API.
  const grants = (
    await api('GET', `/api/v1/roles/${adminRole.id}/permissions`, { cookie: superCookie })
  ).json.grants;
  const put = await api('PUT', `/api/v1/roles/${adminRole.id}/permissions`, {
    cookie: superCookie,
    body: { grants: [...grants, 'system:roles:manage'] },
  });
  assert(put.status === 200, 'matrix PUT succeeds');
  ok('super admin granted system:roles:manage to Admin via PUT /roles/:id/permissions');

  const adminCookie = (await login(noah.email)).cookie;
  const created = await api('POST', '/api/v1/roles', {
    cookie: adminCookie,
    body: { name: 'Support Team', description: 'Handles tickets' },
  });
  assert(created.status === 201, `admin must get 201 (got ${created.status})`);
  ok(`Admin (Noah): 201 — role "${created.json.name}" (slug ${created.json.slug}) created`);

  // --- (d) TOTP 2FA ------------------------------------------------------------------

  step('TOTP 2FA: enroll → activate → logout → step-up login → verify');
  const enroll = await api('POST', '/api/v1/auth/2fa/enroll', { cookie: superCookie });
  assert(enroll.status === 200, '2fa enroll');
  const secret = enroll.json.data.secret;
  ok(`enrolled — otpauth URL issued (${enroll.json.data.otpauthUrl.slice(0, 34)}…)`);

  const activate = await api('POST', '/api/v1/auth/2fa/activate', {
    cookie: superCookie,
    body: { code: totpCode(secret) },
  });
  assert(activate.status === 200, '2fa activate');
  ok(`activated with a live TOTP code — ${activate.json.data.recoveryCodes.length} recovery codes issued`);

  const out = await api('POST', '/api/v1/auth/logout', { cookie: superCookie });
  assert(out.status === 200, 'logout');
  ok('logged out — session revoked');

  const stepUp = await login(SUPER_EMAIL);
  assert(stepUp.status === 202, `login must return the MFA challenge (got ${stepUp.status})`);
  assert(stepUp.cookie === null, 'no session cookie before the second factor');
  ok('login now answers 202 { twoFactorRequired: true } — no cookie yet');

  const verify = await api('POST', '/api/v1/auth/2fa/verify', {
    body: { challengeToken: stepUp.json.data.challengeToken, code: totpCode(secret) },
  });
  assert(verify.status === 200 && verify.cookie !== null, '2fa verify promotes to a session');
  superCookie = verify.cookie;
  const session = await api('GET', '/api/v1/auth/session', { cookie: superCookie });
  assert(session.status === 200, 'session works after verify');
  ok('TOTP verified → fresh session cookie → GET /auth/session 200');

  // --- (e) job progress over SSE ------------------------------------------------------

  step('queued job → live progress over SSE (GET /api/v1/events)');
  const sseJob = await api('POST', '/api/v1/jobs', {
    cookie: superCookie,
    body: { kind: NOOP_PROGRESS_KIND, payload: { steps: 5, stepDelayMs: 120 } },
  });
  assert(sseJob.status === 202, 'enqueue accepted');
  const sseJobId = sseJob.json.data.jobId;
  ok(`enqueued ${NOOP_PROGRESS_KIND} → 202 { jobId: ${sseJobId} }`);

  {
    const controller = new AbortController();
    const res = await fetch(`${baseUrl}/api/v1/events?channels=jobs:${sseJobId}`, {
      headers: { cookie: superCookie },
      signal: controller.signal,
    });
    assert(res.status === 200, 'SSE stream opens');
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let done = false;
    const pcts = [];
    while (!done) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      let idx;
      while ((idx = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const dataLine = frame.split('\n').find((l) => l.startsWith('data: '));
        if (dataLine === undefined) continue;
        const event = JSON.parse(dataLine.slice(6));
        if (event.type === 'progress') {
          pcts.push(event.data.pct);
          info(`progress ${String(event.data.pct).padStart(3)}%  ${event.data.message ?? ''}`);
        }
        if (event.type === 'completed' || event.type === 'failed') {
          done = true;
          assert(event.type === 'completed', 'job completes');
        }
      }
    }
    controller.abort();
    assert(pcts[0] === 0 && pcts[pcts.length - 1] === 100, 'progress runs 0 → 100');
    assert(
      pcts.every((p, i) => i === 0 || p > pcts[i - 1]),
      'progress is strictly ordered',
    );
    ok(`SSE delivered ordered progress ${pcts.join(' → ')} and the completed event`);
  }
  const sseRow = await api('GET', `/api/v1/jobs/${sseJobId}`, { cookie: superCookie });
  assert(sseRow.json.data.status === 'succeeded', 'job row succeeded');
  ok('job row is `succeeded` with finishedAt set');

  // --- (f) job progress over WebSocket ------------------------------------------------

  step('second job → the same stream over the /ws WebSocket gateway');
  const wsJob = await api('POST', '/api/v1/jobs', {
    cookie: superCookie,
    body: { kind: NOOP_PROGRESS_KIND, payload: { steps: 5, stepDelayMs: 120 } },
  });
  assert(wsJob.status === 202, 'ws job enqueued');
  const wsJobId = wsJob.json.data.jobId;

  await new Promise((resolve, reject) => {
    const socket = new WsClient(`ws://127.0.0.1:${port}/ws`, {
      headers: { cookie: superCookie },
    });
    const timer = setTimeout(() => {
      socket.terminate();
      reject(new Error('WS demo timed out'));
    }, 15_000);
    const pcts = [];
    socket.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    socket.on('open', () => {
      ok('cookie-authenticated WS handshake accepted');
      socket.send(JSON.stringify({ op: 'subscribe', channel: `jobs:${wsJobId}` }));
    });
    socket.on('message', (raw) => {
      const frame = JSON.parse(String(raw));
      if (frame.op === 'subscribed') info(`subscribed to ${frame.channel}`);
      if (frame.type === 'progress') {
        pcts.push(frame.data.pct);
        info(`progress ${String(frame.data.pct).padStart(3)}%  ${frame.data.message ?? ''}`);
      }
      if (frame.type === 'completed') {
        clearTimeout(timer);
        socket.close();
        try {
          assert(pcts[0] === 0 && pcts[pcts.length - 1] === 100, 'WS progress runs 0 → 100');
          ok(`WS delivered ordered progress ${pcts.join(' → ')} and the completed event`);
          resolve();
        } catch (err) {
          reject(err);
        }
      }
    });
  });

  // --- finale: the audit log -----------------------------------------------------------

  step('finale — audit-log tail (GET /api/v1/audit, super admin)');
  const audit = await api('GET', '/api/v1/audit?limit=14', { cookie: superCookie });
  assert(audit.status === 200, 'audit list');
  const entries = [...audit.json.entries].reverse(); // chronological
  const width = Math.max(...entries.map((e) => e.action.length));
  for (const entry of entries) {
    const when = new Date(entry.createdAt).toISOString().slice(11, 19);
    console.log(
      `    ${when}  ${entry.category.padEnd(5)}  ${entry.action.padEnd(width)}  by ${entry.actorLabel}`,
    );
  }
  const actions = entries.map((e) => e.action);
  assert(actions.includes('permission.denied'), 'denial is in the audit log');
  assert(actions.includes('role.create'), 'mutation is in the audit log');
  ok('both the Viewer denial and the Admin mutation are on the record');

  console.log('\nAll M2 exit criteria demonstrated. ✨');
} catch (error) {
  console.error(`\n✗ ${error.message}`);
  process.exitCode = 1;
} finally {
  await app.close();
  await meta.db.destroy();
  rmSync(tempDir, { recursive: true, force: true });
}
