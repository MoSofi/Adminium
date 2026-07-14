/**
 * `/api/v1/llm/*` route tests (06-llm-assist.md §10.5, §3.2, acceptance #10/#13).
 *
 * Runs on an in-memory SQLite meta store with the stub session-auth hook
 * (`x-test-user-id` → `request.user`) + the real rbac plugin — no live source
 * database and no provider network (the provider client is a fake injected via
 * `createClient`; stats collection defaults to sample-free `[]`). Covers:
 *  - RBAC: Editor/Viewer → 403 on every route; anonymous → 401 (acceptance #13);
 *  - config: PUT encrypts the key, GET returns `apiKeySet` + last-4 only and
 *    never the key (acceptance #10), with an audit entry that omits the key;
 *  - config/test + models via the fake provider client;
 *  - run create (BYO + direct), execute enqueue, BYO paste validation,
 *    list/detail, prompt re-download, diff, and apply-through-to-the-executor.
 */

import BetterSqlite3 from 'better-sqlite3';
import { parseDatabaseModel, type DatabaseModel } from '@adminium/engine';
import { llmKeyCryptoFromSecret, type LlmKeyCrypto, type ProviderClient } from '@adminium/llm';
import {
  auditRepo,
  connectionsRepo,
  createSqliteMetaDb,
  firstRun,
  llmOverridesRepo,
  rolesRepo,
  settingsRepo,
  snapshotsRepo,
  usersRepo,
  type DsnCrypto,
  type MetaDb,
  type Role,
  type User,
} from '@adminium/meta';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildServer, type AdminiumServer } from '../src/app.js';
import { decryptSecret, deriveKey, encryptSecret } from '../src/config/secrets.js';
import { createApplyService } from '../src/llm/apply-service.js';
import { createRunService } from '../src/llm/run-service.js';
import { LLM_RUN_KIND } from '../src/jobs/llm-run.js';
import { rbacPlugin } from '../src/plugins/rbac.js';
import { llmRoutes } from '../src/routes/llm/index.js';
import { makeEnv, TEST_SECRET } from './helpers.js';

const testDsnCrypto: DsnCrypto = {
  encrypt: (plaintext) => `enc:test:${Buffer.from(plaintext, 'utf8').toString('base64')}`,
  decrypt: (token) => Buffer.from(token.slice('enc:test:'.length), 'base64').toString('utf8'),
};

const ALLOWED = {
  templates: ['page-crud', 'page-dashboard', 'page-queue-inbox', 'page-board', 'page-directory'],
  widgets: ['kpi-stat-card', 'chart-line-area', 'chart-donut', 'top-movers-list'],
};

const schemaIr: DatabaseModel = parseDatabaseModel({
  irVersion: 1,
  dialect: 'postgres',
  name: 'shop',
  defaultSchema: 'public',
  tables: [
    {
      schema: 'public',
      name: 'orders',
      columns: [
        { name: 'id', logicalType: 'uuid', isPrimaryKey: true, nullable: false },
        { name: 'order_number', logicalType: 'text', isUnique: true, nullable: false },
        { name: 'status', logicalType: 'text', nullable: false },
      ],
      primaryKey: ['id'],
    },
  ],
});

/** A clean, referentially-valid single-locale response for `public.orders`. */
function validResponse(runId: string): string {
  return JSON.stringify({
    schema_version: 'adminium.llm/v1',
    run_id: runId,
    tables: [
      {
        table: 'public.orders',
        confidence: 0.9,
        label: { en_US: 'Orders' },
        description: { en_US: 'Customer orders.' },
        icon: 'shopping-cart',
        displayColumn: 'order_number',
        naturalKey: ['order_number'],
        columns: [
          { column: 'order_number', label: { en_US: 'Order number' } },
          { column: 'status', label: { en_US: 'Status' } },
        ],
      },
    ],
  });
}

/** A fake provider client — no network; `test()`/`listModels()` return fixtures. */
function fakeClient(): ProviderClient {
  return {
    id: 'anthropic',
    listModels: async () => [{ id: 'claude-x', label: 'Claude X' }],
    complete: async () => ({ text: '{}' }),
    test: async () => ({ ok: true, model: 'claude-x', latencyMs: 12 }),
  };
}

/** Minimal `app.jobs` stub so the execute route can enqueue without the runtime. */
const stubJobs = {
  registry: { has: (kind: string) => kind === LLM_RUN_KIND },
  enqueue: async () => ({ id: 'job_test' }),
};

interface Harness {
  app: AdminiumServer;
  meta: MetaDb;
  keyCrypto: LlmKeyCrypto;
  users: { superAdmin: User; admin: User; editor: User; viewer: User };
  connectionId: string;
  snapshotId: string;
}

function asUser(user: User): Record<string, string> {
  return { 'x-test-user-id': user.id };
}

async function buildHarness(opts: { client?: ProviderClient } = {}): Promise<Harness> {
  const meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
  await firstRun(meta);

  const roles = rolesRepo(meta);
  const users = usersRepo(meta);
  async function makeUser(name: string, slug: string): Promise<User> {
    const role: Role | null = await roles.findBySlug(slug);
    if (role === null) throw new Error(`missing built-in role ${slug}`);
    const user = await users.create({
      email: `${name.toLowerCase()}@adminium.test`,
      name,
      passwordHash: 'test-hash',
      status: 'active',
    });
    await roles.assignToUser(user.id, role.id);
    return user;
  }
  const userSet = {
    superAdmin: await makeUser('Ava', 'super-admin'),
    admin: await makeUser('Noah', 'admin'),
    editor: await makeUser('Mia', 'editor'),
    viewer: await makeUser('Liam', 'viewer'),
  };

  const connection = await connectionsRepo(meta, testDsnCrypto).create({
    name: 'shop',
    engine: 'postgres',
    introspectDsn: 'postgres://ro@localhost/shop',
  });
  const snap = await snapshotsRepo(meta).create({
    connectionId: connection.id,
    source: 'introspection',
    schema: schemaIr,
    checksum: 'sha-shop-1',
  });

  const keyCrypto = llmKeyCryptoFromSecret(TEST_SECRET, { deriveKey, encryptSecret, decryptSecret });
  const runService = createRunService({ meta });
  const applyService = createApplyService({ meta, runService });

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
  // Minimal jobs stub for the execute route (guarded by app.hasDecorator('jobs')).
  app.decorate('jobs', stubJobs as never);

  await app.register(
    async (api) => {
      await api.register(
        llmRoutes({
          meta,
          runService,
          applyService,
          keyCrypto,
          allowed: ALLOWED,
          createClient: () => opts.client ?? fakeClient(),
        }),
      );
    },
    { prefix: '/api/v1' },
  );
  await app.ready();

  return {
    app,
    meta,
    keyCrypto,
    users: userSet,
    connectionId: connection.id,
    snapshotId: snap.snapshot.id,
  };
}

/** POST /runs as the admin and return the created run id (+ full body). */
async function createByoRun(t: Harness): Promise<{ id: string; body: Record<string, unknown> }> {
  const res = await t.app.inject({
    method: 'POST',
    url: '/api/v1/llm/runs',
    headers: asUser(t.users.admin),
    payload: { connectionId: t.connectionId, path: 'byo', locales: ['en_US'] },
  });
  if (res.statusCode !== 201) throw new Error(`createRun failed: ${res.statusCode} ${res.body}`);
  const body = res.json() as { run: { id: string } };
  return { id: body.run.id, body: body as unknown as Record<string, unknown> };
}

/** Drive a BYO run to `validated` by pasting a clean response. */
async function validatedRun(t: Harness): Promise<string> {
  const { id } = await createByoRun(t);
  const res = await t.app.inject({
    method: 'POST',
    url: `/api/v1/llm/runs/${id}/response`,
    headers: asUser(t.users.admin),
    payload: { text: validResponse(id) },
  });
  if (res.statusCode !== 200) throw new Error(`response failed: ${res.statusCode} ${res.body}`);
  return id;
}

describe('llm routes — RBAC (acceptance #13)', () => {
  let t: Harness;
  beforeEach(async () => {
    t = await buildHarness();
  });
  afterEach(async () => {
    await t.app.close();
    await t.meta.db.destroy();
  });

  // Valid bodies so schema validation (422) never masks the 403 guard.
  const ROUTES: { method: 'GET' | 'POST' | 'PUT'; url: string; payload?: unknown }[] = [
    { method: 'GET', url: '/api/v1/llm/config' },
    { method: 'PUT', url: '/api/v1/llm/config', payload: { provider: 'anthropic' } },
    { method: 'POST', url: '/api/v1/llm/config/test' },
    { method: 'GET', url: '/api/v1/llm/models' },
    { method: 'POST', url: '/api/v1/llm/runs', payload: { connectionId: 'c', path: 'byo' } },
    { method: 'POST', url: '/api/v1/llm/runs/r1/execute' },
    { method: 'POST', url: '/api/v1/llm/runs/r1/response', payload: { text: 'x' } },
    { method: 'GET', url: '/api/v1/llm/runs?connectionId=c' },
    { method: 'GET', url: '/api/v1/llm/runs/r1' },
    { method: 'GET', url: '/api/v1/llm/runs/r1/prompt' },
    { method: 'GET', url: '/api/v1/llm/runs/r1/diff' },
    { method: 'POST', url: '/api/v1/llm/runs/r1/apply', payload: { accepted: [] } },
  ];

  it('Editor and Viewer get 403 on every route', async () => {
    for (const user of [t.users.editor, t.users.viewer]) {
      for (const route of ROUTES) {
        const res = await t.app.inject({
          method: route.method,
          url: route.url,
          headers: asUser(user),
          ...(route.payload !== undefined ? { payload: route.payload } : {}),
        });
        expect(res.statusCode, `${route.method} ${route.url}`).toBe(403);
        expect(res.json().error.details.permission).toBe('system:llm:run');
      }
    }
  });

  it('anonymous requests get 401', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/api/v1/llm/config' });
    expect(res.statusCode).toBe(401);
  });

  it('Admin and Super-Admin are allowed (not 403)', async () => {
    for (const user of [t.users.admin, t.users.superAdmin]) {
      const res = await t.app.inject({ method: 'GET', url: '/api/v1/llm/config', headers: asUser(user) });
      expect(res.statusCode).toBe(200);
    }
  });
});

describe('llm routes — config (§3.2, acceptance #10)', () => {
  let t: Harness;
  beforeEach(async () => {
    t = await buildHarness();
  });
  afterEach(async () => {
    await t.app.close();
    await t.meta.db.destroy();
  });

  it('GET returns registry defaults with no key on a fresh install', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/api/v1/llm/config', headers: asUser(t.users.admin) });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ provider: null, model: null, apiKeySet: false, apiKeyLast4: null });
    expect(body).not.toHaveProperty('apiKey');
  });

  it('PUT encrypts the key at rest; GET returns apiKeySet + last-4 only, never the key', async () => {
    const secretKey = 'sk-ant-SUPERSECRET1234';
    const put = await t.app.inject({
      method: 'PUT',
      url: '/api/v1/llm/config',
      headers: asUser(t.users.admin),
      payload: { provider: 'anthropic', model: 'claude-x', apiKey: secretKey },
    });
    expect(put.statusCode).toBe(200);
    const putBody = put.json();
    // The reply never carries the key, only presence + last-4.
    expect(putBody).not.toHaveProperty('apiKey');
    expect(putBody.apiKeySet).toBe(true);
    expect(putBody.apiKeyLast4).toBe('1234');
    expect(JSON.stringify(putBody)).not.toContain(secretKey);

    // Stored value is an AES-256-GCM token, not the plaintext (acceptance #10).
    const stored = await settingsRepo(t.meta).get('llm.apiKey');
    expect(stored).not.toBeNull();
    expect(stored).toMatch(/^enc:v1:/);
    expect(stored).not.toContain(secretKey);
    // …and it decrypts back to the original.
    expect(t.keyCrypto.decrypt(stored as string)).toBe(secretKey);

    // GET never returns the key either.
    const get = await t.app.inject({ method: 'GET', url: '/api/v1/llm/config', headers: asUser(t.users.admin) });
    const getBody = get.json();
    expect(getBody).toMatchObject({ provider: 'anthropic', model: 'claude-x', apiKeySet: true, apiKeyLast4: '1234' });
    expect(JSON.stringify(getBody)).not.toContain(secretKey);
  });

  it('PUT audits the change without leaking the key', async () => {
    const secretKey = 'sk-ant-DONT-LEAK-ME-9999';
    await t.app.inject({
      method: 'PUT',
      url: '/api/v1/llm/config',
      headers: asUser(t.users.admin),
      payload: { provider: 'openai', apiKey: secretKey },
    });
    const entries = await auditRepo(t.meta).list({ category: 'llm' });
    const entry = entries.find((e) => e.action === 'llm.config.update');
    expect(entry).toBeDefined();
    expect(entry?.actorId).toBe(t.users.admin.id);
    expect(JSON.stringify(entry?.changes)).not.toContain(secretKey);
    expect((entry?.changes?.after as { apiKeySet?: boolean }).apiKeySet).toBe(true);
  });

  it('an empty-string apiKey clears the stored key', async () => {
    await t.app.inject({
      method: 'PUT',
      url: '/api/v1/llm/config',
      headers: asUser(t.users.admin),
      payload: { provider: 'anthropic', apiKey: 'sk-first' },
    });
    await t.app.inject({
      method: 'PUT',
      url: '/api/v1/llm/config',
      headers: asUser(t.users.admin),
      payload: { provider: 'anthropic', apiKey: '' },
    });
    const get = await t.app.inject({ method: 'GET', url: '/api/v1/llm/config', headers: asUser(t.users.admin) });
    expect(get.json().apiKeySet).toBe(false);
  });

  it('POST /config/test pings the active provider (never the key)', async () => {
    await t.app.inject({
      method: 'PUT',
      url: '/api/v1/llm/config',
      headers: asUser(t.users.admin),
      payload: { provider: 'anthropic', model: 'claude-x', apiKey: 'sk-test' },
    });
    const res = await t.app.inject({ method: 'POST', url: '/api/v1/llm/config/test', headers: asUser(t.users.admin) });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, model: 'claude-x', latencyMs: 12, error: null });
  });

  it('POST /config/test is a 409 when no provider is configured', async () => {
    const res = await t.app.inject({ method: 'POST', url: '/api/v1/llm/config/test', headers: asUser(t.users.admin) });
    expect(res.statusCode).toBe(409);
  });

  it('GET /models returns the active provider models', async () => {
    await t.app.inject({
      method: 'PUT',
      url: '/api/v1/llm/config',
      headers: asUser(t.users.admin),
      payload: { provider: 'anthropic', apiKey: 'sk-test' },
    });
    const res = await t.app.inject({ method: 'GET', url: '/api/v1/llm/models', headers: asUser(t.users.admin) });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ models: [{ id: 'claude-x', label: 'Claude X' }], source: 'live' });
  });
});

describe('llm routes — runs', () => {
  let t: Harness;
  beforeEach(async () => {
    t = await buildHarness();
  });
  afterEach(async () => {
    await t.app.close();
    await t.meta.db.destroy();
  });

  it('POST /runs (byo) returns an awaiting run + prompt, with provider/model NULL (§9)', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/v1/llm/runs',
      headers: asUser(t.users.admin),
      payload: { connectionId: t.connectionId, path: 'byo', locales: ['en_US'] },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.run.mode).toBe('byo');
    expect(body.run.status).toBe('awaiting_response');
    expect(body.run.provider).toBeNull();
    expect(body.run.model).toBeNull();
    expect(body.prompt.chunks.length).toBeGreaterThan(0);
    expect(body.prompt.chunks[0].byo).toContain('=== SYSTEM ===');
    expect(body.prompt.tokenEstimate).toBeGreaterThan(0);
  });

  it('POST /runs without an introspected snapshot is a 409', async () => {
    const other = await connectionsRepo(t.meta, testDsnCrypto).create({
      name: 'empty',
      engine: 'postgres',
      introspectDsn: 'postgres://ro@localhost/empty',
    });
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/v1/llm/runs',
      headers: asUser(t.users.admin),
      payload: { connectionId: other.id, path: 'byo' },
    });
    expect(res.statusCode).toBe(409);
  });

  it('POST /runs (provider) is a 409 until a provider is configured, then records it', async () => {
    const denied = await t.app.inject({
      method: 'POST',
      url: '/api/v1/llm/runs',
      headers: asUser(t.users.admin),
      payload: { connectionId: t.connectionId, path: 'provider' },
    });
    expect(denied.statusCode).toBe(409);

    await t.app.inject({
      method: 'PUT',
      url: '/api/v1/llm/config',
      headers: asUser(t.users.admin),
      payload: { provider: 'anthropic', model: 'claude-x', apiKey: 'sk-test' },
    });
    const ok = await t.app.inject({
      method: 'POST',
      url: '/api/v1/llm/runs',
      headers: asUser(t.users.admin),
      payload: { connectionId: t.connectionId, path: 'provider' },
    });
    expect(ok.statusCode).toBe(201);
    expect(ok.json().run).toMatchObject({ mode: 'provider', status: 'draft', provider: 'anthropic', model: 'claude-x' });
  });

  it('POST /runs/:id/execute enqueues the llm-run job for a draft provider run (202)', async () => {
    await t.app.inject({
      method: 'PUT',
      url: '/api/v1/llm/config',
      headers: asUser(t.users.admin),
      payload: { provider: 'anthropic', model: 'claude-x', apiKey: 'sk-test' },
    });
    const created = await t.app.inject({
      method: 'POST',
      url: '/api/v1/llm/runs',
      headers: asUser(t.users.admin),
      payload: { connectionId: t.connectionId, path: 'provider' },
    });
    const runId = created.json().run.id;
    const exec = await t.app.inject({
      method: 'POST',
      url: `/api/v1/llm/runs/${runId}/execute`,
      headers: asUser(t.users.admin),
    });
    expect(exec.statusCode).toBe(202);
    expect(exec.json()).toEqual({ jobId: 'job_test' });
  });

  it('POST /runs/:id/execute rejects a BYO run (409)', async () => {
    const { id } = await createByoRun(t);
    const res = await t.app.inject({ method: 'POST', url: `/api/v1/llm/runs/${id}/execute`, headers: asUser(t.users.admin) });
    expect(res.statusCode).toBe(409);
  });

  it('POST /runs/:id/response validates a clean paste → validated', async () => {
    const { id } = await createByoRun(t);
    const res = await t.app.inject({
      method: 'POST',
      url: `/api/v1/llm/runs/${id}/response`,
      headers: asUser(t.users.admin),
      payload: { text: validResponse(id) },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.validation.ok).toBe(true);
    expect(body.validation.errors).toEqual([]);
    expect(body.run.status).toBe('validated');
    expect(body.run.validationStatus).toBe('valid');
  });

  it('POST /runs/:id/response keeps a fatal paste awaiting_response with errors preserved', async () => {
    const { id } = await createByoRun(t);
    const res = await t.app.inject({
      method: 'POST',
      url: `/api/v1/llm/runs/${id}/response`,
      headers: asUser(t.users.admin),
      payload: { text: 'this is not json {' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.validation.ok).toBe(false);
    expect(body.validation.errors.length).toBeGreaterThan(0);
    expect(body.run.status).toBe('awaiting_response');
    expect(Array.isArray(body.run.validationErrors)).toBe(true);
  });

  it('GET /runs lists a connection’s runs; GET /runs/:id returns detail', async () => {
    const { id } = await createByoRun(t);
    const list = await t.app.inject({
      method: 'GET',
      url: `/api/v1/llm/runs?connectionId=${t.connectionId}`,
      headers: asUser(t.users.admin),
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().runs.map((r: { id: string }) => r.id)).toContain(id);

    const detail = await t.app.inject({ method: 'GET', url: `/api/v1/llm/runs/${id}`, headers: asUser(t.users.admin) });
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toMatchObject({ id, review: null });
    expect(detail.json()).toHaveProperty('validationErrors');
  });

  it('GET /runs/:id is a 404 for an unknown run', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/api/v1/llm/runs/nope', headers: asUser(t.users.admin) });
    expect(res.statusCode).toBe(404);
  });

  it('GET /runs/:id/prompt re-downloads the prompt chunks', async () => {
    const { id } = await createByoRun(t);
    const res = await t.app.inject({ method: 'GET', url: `/api/v1/llm/runs/${id}/prompt`, headers: asUser(t.users.admin) });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.promptVersion).toBe('adminium.prompt/v1');
    expect(body.chunks[0].byo).toContain('=== USER ===');
  });

  it('GET /runs/:id/diff is a 409 before validation, then returns the diff', async () => {
    const { id } = await createByoRun(t);
    const early = await t.app.inject({ method: 'GET', url: `/api/v1/llm/runs/${id}/diff`, headers: asUser(t.users.admin) });
    expect(early.statusCode).toBe(409);

    await t.app.inject({
      method: 'POST',
      url: `/api/v1/llm/runs/${id}/response`,
      headers: asUser(t.users.admin),
      payload: { text: validResponse(id) },
    });
    const diff = await t.app.inject({ method: 'GET', url: `/api/v1/llm/runs/${id}/diff`, headers: asUser(t.users.admin) });
    expect(diff.statusCode).toBe(200);
    expect(Array.isArray(diff.json().diff)).toBe(true);
    expect(diff.json().diff.length).toBeGreaterThan(0);
    const labelRow = diff.json().diff.find((d: { id: string }) => d.id === 'label:public.orders');
    expect(labelRow).toBeDefined();
  });

  it('POST /runs/:id/apply applies accepted suggestions and terminates the run', async () => {
    const id = await validatedRun(t);
    const diff = await t.app.inject({ method: 'GET', url: `/api/v1/llm/runs/${id}/diff`, headers: asUser(t.users.admin) });
    const accepted = (diff.json().diff as { id: string; status: string }[])
      .filter((d) => d.status === 'conflict' || d.status === 'llm-new' || d.status === 'agree')
      .map((d) => d.id);

    const res = await t.app.inject({
      method: 'POST',
      url: `/api/v1/llm/runs/${id}/apply`,
      headers: asUser(t.users.admin),
      payload: { accepted },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(['applied', 'partially_applied']).toContain(body.run.status);
    expect(body.counts).toHaveProperty('overrides');
    expect(body.review.accepted.length + body.review.rejected.length).toBeGreaterThan(0);

    // Audit entry recorded (category llm).
    const entries = await auditRepo(t.meta).list({ category: 'llm' });
    expect(entries.some((e) => e.action === 'llm.run.apply')).toBe(true);

    // Re-applying the terminal run is a 409 (immutable, §7.4).
    const again = await t.app.inject({
      method: 'POST',
      url: `/api/v1/llm/runs/${id}/apply`,
      headers: asUser(t.users.admin),
      payload: { accepted },
    });
    expect(again.statusCode).toBe(409);
  });

  it('POST /runs/:id/apply returns a working undo token that reverts the apply (§10.3)', async () => {
    const id = await validatedRun(t);
    const diff = await t.app.inject({ method: 'GET', url: `/api/v1/llm/runs/${id}/diff`, headers: asUser(t.users.admin) });
    const accepted = (diff.json().diff as { id: string; status: string }[])
      .filter((d) => d.status === 'conflict' || d.status === 'llm-new' || d.status === 'agree')
      .map((d) => d.id);

    const apply = await t.app.inject({
      method: 'POST',
      url: `/api/v1/llm/runs/${id}/apply`,
      headers: asUser(t.users.admin),
      payload: { accepted },
    });
    expect(apply.statusCode).toBe(200);
    const token = apply.json().undoToken as string | null;
    // The apply wrote overrides, so a revert token must be present (the toast's Undo).
    expect(typeof token).toBe('string');
    expect(token).not.toBe('');
    expect((await llmOverridesRepo(t.meta).listForConnection(t.connectionId)).length).toBeGreaterThan(0);

    const undo = await t.app.inject({
      method: 'POST',
      url: `/api/v1/llm/runs/${id}/undo/${token}`,
      headers: asUser(t.users.admin),
    });
    expect(undo.statusCode).toBe(200);
    expect(undo.json().overrides).toBeGreaterThan(0);
    // The apply's overrides are gone; the audit trail records the undo.
    expect(await llmOverridesRepo(t.meta).listForConnection(t.connectionId)).toEqual([]);
    const entries = await auditRepo(t.meta).list({ category: 'llm' });
    expect(entries.some((e) => e.action === 'llm.run.undo')).toBe(true);

    // The token is single-use — a second undo is a 404.
    const twice = await t.app.inject({
      method: 'POST',
      url: `/api/v1/llm/runs/${id}/undo/${token}`,
      headers: asUser(t.users.admin),
    });
    expect(twice.statusCode).toBe(404);
  });
});
