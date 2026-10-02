// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Adminium Designer's routes, on a whole server over a real project folder.
 *
 * The model is a small HTTP server on this machine that speaks Ollama's
 * streaming chat, so the turn goes through everything a real one does: the
 * connection from the environment, the address check, the streamed run, the
 * build check, the engine's check, build and apply of the app, the events
 * written and read back.
 */
import { createServer, type Server } from 'node:http';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';

import BetterSqlite3 from 'better-sqlite3';
import { createSqliteMetaDb, firstRun, rolesRepo, usersRepo, type MetaDb } from '@adminium/meta';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { composeServer, type ComposedServer } from '../src/compose.js';
import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import { ConnectionManager } from '../src/connections/manager.js';
import { createApplyService } from '../src/llm/apply-service.js';
import { createRunService } from '../src/llm/run-service.js';
import type { MetaStoreHandle } from '../src/meta/store.js';
import { hashPassword } from '../src/auth/passwords.js';
import { buildProject } from '../src/project/build.js';
import { authorizeChannel, designerChannel } from '../src/realtime/hub.js';
import { APP_VERSION } from '../src/version.js';
import { asProject, canBuildSides } from './app-project-helpers.js';
import { makeInstall, type Install } from './project-fixtures.js';
import { makeEnv, TEST_SECRET } from './helpers.js';

// ── a model on this machine ──────────────────────────────────────────────────

let model: Server;
let modelUrl: string;
/** What the next turn's model says when it is not being checked. */
let reply: { text: string; wait?: boolean } = { text: 'I looked, and the app is fine as it is.' };
const held: (() => void)[] = [];

beforeAll(async () => {
  model = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk: Buffer) => {
      body += chunk.toString('utf8');
    });
    request.on('end', () => {
      if (request.url === '/api/tags') {
        response.end(JSON.stringify({ models: [{ name: 'fake', model: 'fake' }] }));
        return;
      }
      const sent = JSON.parse(body) as { messages: { role: string }[]; tools?: { function: { name: string } }[] };
      const line = (value: unknown): void => {
        response.write(`${JSON.stringify(value)}\n`);
      };
      const done = { model: 'fake', done: true, done_reason: 'stop', prompt_eval_count: 50, eval_count: 5, message: { role: 'assistant', content: '' } };
      // The build check: call `echo`, then answer once the result is back.
      if (sent.tools?.some((tool) => tool.function.name === 'echo') === true) {
        if (sent.messages.at(-1)?.role === 'tool' || sent.messages.some((message) => message.role === 'tool')) {
          line({ model: 'fake', done: false, message: { role: 'assistant', content: 'done' } });
        } else {
          line({ model: 'fake', done: false, message: { role: 'assistant', content: '', tool_calls: [{ function: { name: 'echo', arguments: { word: 'adminium' } } }] } });
        }
        line(done);
        response.end();
        return;
      }
      const finish = (): void => {
        line({ model: 'fake', done: false, message: { role: 'assistant', content: reply.text } });
        line(done);
        response.end();
      };
      if (reply.wait === true) {
        line({ model: 'fake', done: false, message: { role: 'assistant', content: 'Thinking…' } });
        held.push(finish);
        request.on('close', () => response.destroy());
        return;
      }
      finish();
    });
  });
  await new Promise<void>((resolve) => model.listen(0, '127.0.0.1', resolve));
  modelUrl = `http://127.0.0.1:${String((model.address() as AddressInfo).port)}`;
});
afterAll(async () => {
  await new Promise<void>((resolve) => model.close(() => resolve()));
});

// ── a server ─────────────────────────────────────────────────────────────────

let composed: ComposedServer | undefined;
let root: string | undefined;
let install: Install | null = null;
afterEach(async () => {
  for (const release of held.splice(0)) release();
  await composed?.app.close();
  composed = undefined;
  await install?.close();
  install = null;
  root = undefined;
  reply = { text: 'I looked, and the app is fine as it is.' };
});

function memoryStore(meta: MetaDb): MetaStoreHandle {
  return { meta, url: 'sqlite::memory:', engine: 'sqlite', source: 'embedded', close: async () => Promise.resolve() };
}

interface Client {
  meta: MetaDb;
  call: (method: 'GET' | 'POST' | 'PUT' | 'PATCH', url: string, payload?: unknown, cookie?: string) => Promise<{ status: number; body: Record<string, unknown> }>;
  owner: string;
}

async function server(opts: { designer: boolean; environment?: Record<string, string> }): Promise<Client> {
  // A project with its own SQLite database, connected as `main`.
  install = await makeInstall();
  root = asProject(install.dir);
  await buildProject({ root, configFile: join(root, 'adminium.config.ts') }, { version: APP_VERSION });
  const { meta } = install;
  const runService = createRunService({ meta });
  composed = await composeServer({
    env: makeEnv({ HOST: '127.0.0.1', ...(opts.environment ?? { ADMINIUM_AI_OLLAMA_BASE_URL: modelUrl, ADMINIUM_AI_MODEL: 'ollama/fake' }) }),
    metaStore: memoryStore(meta),
    manager: install.manager,
    runService,
    applyService: createApplyService({ meta, runService }),
    allowed: { templates: [], widgets: [], widgetContracts: {} },
    logger: false,
    telemetry: false,
    onMetaRelocated: () => undefined,
    project: { root, mode: 'dev', log: () => undefined, warn: () => undefined, databases: ['main'] },
    ...(opts.designer ? { designer: { mode: 'local' as const } } : {}),
  });
  const { app } = composed;
  await app.ready();
  const setup = await app.inject({
    method: 'POST',
    url: '/api/v1/setup/super-admin',
    payload: { email: 'owner@example.test', password: 'a-long-enough-test-password-1!', name: 'Owner' },
  });
  expect(setup.statusCode, setup.body).toBe(201);
  const owner = String(setup.headers['set-cookie']).split(';')[0] ?? '';
  return {
    meta,
    owner,
    call: async (method, url, payload, cookie = owner) => {
      const res = await app.inject({ method, url, headers: cookie === '' ? {} : { cookie }, ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }) });
      return { status: res.statusCode, body: (res.body === '' ? {} : res.json()) as Record<string, unknown> };
    },
  };
}

const createBody = (over: Record<string, unknown> = {}) => ({ name: 'Repair desk', target: 'auto', connectionId: 'env:ollama', model: 'fake', text: 'Make me a repair desk.', ...over });

type EventRow = { seq: number; kind: string; outcome?: string; ok?: boolean; state?: string };
async function finishedTurn(client: Client, sessionId: string, turn: number): Promise<EventRow[]> {
  let events: EventRow[] = [];
  await vi.waitFor(
    async () => {
      events = (await client.call('GET', `/api/v1/designer/sessions/${sessionId}/events-since?after=0`)).body['events'] as EventRow[];
      expect(events.filter((event) => event.kind === 'turn-finished')).toHaveLength(turn);
    },
    { timeout: 30_000, interval: 100 },
  );
  return events;
}

describe.skipIf(!canBuildSides)('Adminium Designer’s routes', { timeout: 120_000 }, () => {
  it('are not there on a server that does not run the Designer', async () => {
    const client = await server({ designer: false });
    expect((await client.call('GET', '/api/v1/designer/state')).status).toBe(404);
    expect((await client.call('POST', '/api/v1/designer/sessions', createBody())).status).toBe(404);
  });

  it('are for whoever may use the Designer, and nobody else', async () => {
    const client = await server({ designer: true });
    expect((await client.call('GET', '/api/v1/designer/state', undefined, '')).status).toBe(401);

    // An Admin is not given the Designer: its model writes code this server runs.
    const admin = await usersRepo(client.meta).create({ email: 'admin@example.test', name: 'Admin', passwordHash: await hashPassword('another-long-test-password-2!') });
    const adminRole = await rolesRepo(client.meta).findBySlug('admin');
    await rolesRepo(client.meta).assignToUser(admin.id, adminRole!.id);
    const login = await composed!.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'admin@example.test', password: 'another-long-test-password-2!' } });
    expect(login.statusCode, login.body).toBe(200);
    const adminCookie = String(login.headers['set-cookie']).split(';')[0] ?? '';
    expect((await client.call('GET', '/api/v1/designer/state', undefined, adminCookie)).status).toBe(403);
    expect((await client.call('POST', '/api/v1/designer/sessions', createBody(), adminCookie)).status).toBe(403);

    const ok = await client.call('GET', '/api/v1/designer/state');
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body).toMatchObject({ mode: 'local', limits: { maxSteps: 60, turnTokens: 400_000, sessionTokens: 4_000_000 }, active: null });

    const user = { id: admin.id, roles: [] as string[] };
    const can = (_who: unknown, permission: string) => permission !== 'system:designer:use';
    expect(await authorizeChannel(user as never, designerChannel('ds_000000000000000000000000'), { can })).toBe(false);
    expect(await authorizeChannel(user as never, designerChannel('ds_000000000000000000000000'), { can: () => true })).toBe(true);
    expect(await authorizeChannel(user as never, 'designer:../x', { can: () => true })).toBe(false);
  });

  it('make an app from a name, run the first turn, and have the engine apply it', async () => {
    const client = await server({ designer: true });
    const created = await client.call('POST', '/api/v1/designer/sessions', createBody());
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const session = created.body['session'] as { id: string; appKey: string; createdApp: boolean };
    expect(session).toMatchObject({ appKey: 'repair-desk', createdApp: true });
    expect(created.body['turn']).toBe(1);
    expect(existsSync(join(root!, 'apps', 'repair-desk', 'manifest', 'app.json'))).toBe(true);

    const events = await finishedTurn(client, session.id, 1);
    expect(events.map((event) => event.seq)).toEqual(events.map((_event, index) => index + 1));
    expect(events.map((event) => event.kind)).toEqual(['turn-started', 'text', 'usage', 'check', 'build', 'apply', 'turn-finished']);
    expect(events.find((event) => event.kind === 'apply'), JSON.stringify(events.find((event) => event.kind === 'apply'))).toMatchObject({ ok: true, state: 'installed' });
    expect(events.at(-1)).toMatchObject({ outcome: 'done' });

    // The app is installed from the folder, and "Your apps" lists it.
    const apps = (await client.call('GET', '/api/v1/designer/sessions')).body['apps'] as { key: string; sessionId: string }[];
    expect(apps).toEqual([expect.objectContaining({ key: 'repair-desk', name: 'Repair desk', sessionId: session.id })]);
    expect((await client.call('GET', '/api/v1/apps')).body).toMatchObject({ apps: [expect.objectContaining({ key: 'repair-desk' })] });

    // The catch-up read after the last event is empty, and says where it is.
    const last = events.at(-1)!.seq;
    expect((await client.call('GET', `/api/v1/designer/sessions/${session.id}/events-since?after=${String(last)}`)).body).toEqual({ events: [], more: false, last });
  });

  it('let one turn run at a time, and stop it', async () => {
    const client = await server({ designer: true });
    reply = { text: 'Done', wait: true };
    const created = await client.call('POST', '/api/v1/designer/sessions', createBody());
    const session = created.body['session'] as { id: string };
    await vi.waitFor(async () => expect((await client.call('GET', '/api/v1/designer/state')).body['active']).toMatchObject({ sessionId: session.id }));

    const second = await client.call('POST', `/api/v1/designer/sessions/${session.id}/turns`, { text: 'And another thing.' });
    expect(second.status).toBe(409);
    expect(second.body).toMatchObject({ error: { details: { reason: 'TURN_RUNNING' } } });

    expect((await client.call('POST', `/api/v1/designer/sessions/${session.id}/stop`)).body).toEqual({ stopped: true });
    const events = await finishedTurn(client, session.id, 1);
    expect(events.at(-1)).toMatchObject({ kind: 'turn-finished', outcome: 'stopped' });
    expect((await client.call('POST', `/api/v1/designer/sessions/${session.id}/stop`)).body).toEqual({ stopped: false });

    reply = { text: 'Carried on.' };
    expect((await client.call('POST', `/api/v1/designer/sessions/${session.id}/turns`, { text: 'Continue.' })).status).toBe(202);
    expect((await finishedTurn(client, session.id, 2)).at(-1)).toMatchObject({ outcome: 'done' });
  });

  it('refuse a model that cannot build, and a connection that is not there', async () => {
    const client = await server({ designer: true });
    expect((await client.call('POST', '/api/v1/designer/sessions', createBody({ connectionId: 'env:anthropic' }))).status).toBe(404);
    expect((await client.call('POST', '/api/v1/designer/sessions', createBody({ target: 'mobile' }))).status).toBe(422);
    expect((await client.call('GET', '/api/v1/designer/sessions/ds_000000000000000000000000')).status).toBe(404);
    expect((await client.call('GET', '/api/v1/designer/sessions/..%2F..%2Fetc')).status).toBe(422);
  });

  it('test a model without saving it, and save one to the project’s .env', async () => {
    const client = await server({ designer: true });
    const tested = await client.call('POST', '/api/v1/designer/connections/test', { provider: 'ollama', baseUrl: modelUrl, model: 'fake' });
    expect(tested.body).toEqual({ ok: true, models: [{ id: 'fake', label: 'fake' }], canBuild: { canBuild: true, reportsUsage: true }, error: null });

    // This server's own environment selects the model: a model written to the file would not be the one in use.
    const shadowed = await client.call('PUT', '/api/v1/designer/connections', { provider: 'anthropic', apiKey: 'sk-ant-saved-0001', model: 'claude-x' });
    expect(shadowed.status).toBe(422);
    expect(shadowed.body).toMatchObject({ error: { details: { reason: 'ENV_SHADOWED' } } });
  });

  it('keep a model in the project’s .env, never in a reply or the audit log', async () => {
    const client = await server({ designer: true, environment: {} });
    const saved = await client.call('PUT', '/api/v1/designer/connections', { provider: 'anthropic', apiKey: 'sk-ant-saved-0001', model: 'claude-x' });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body).toEqual({ id: 'env:anthropic', provider: 'anthropic', source: 'environment', baseUrl: null, hasKey: true, model: 'claude-x' });
    expect(readFileSync(join(root!, '.env'), 'utf8')).toContain('ADMINIUM_AI_ANTHROPIC_API_KEY=sk-ant-saved-0001');
    expect((await client.call('GET', '/api/v1/llm/connections')).body).toMatchObject({ selected: 'anthropic/claude-x' });
    const audit = await client.meta.db.selectFrom('adminium_audit_log').selectAll().where('action', '=', 'designer.model.saved').execute();
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit)).not.toContain('0001');
    expect(JSON.stringify(audit)).toContain('claude-x');
  });
});
