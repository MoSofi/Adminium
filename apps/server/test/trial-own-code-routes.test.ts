// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The doors to own code, on whole composed servers, under trial mode and the
 * hosted profile and on an ordinary server: package uploads, the Designer's
 * uploads and hand save, "Start with an app", and a Designer turn that asks
 * for a hook, its tests and a package. The guards where each effect happens
 * are proved one by one in `trial-own-code.test.ts`.
 */
import { createServer, type Server } from 'node:http';
import { existsSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';

import BetterSqlite3 from 'better-sqlite3';
import { createSqliteMetaDb, firstRun, type MetaDb } from '@adminium/meta';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { composeServer, type ComposedServer } from '../src/compose.js';
import { enforceProfile } from '../src/config/env.js';
import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import { ConnectionManager } from '../src/connections/manager.js';
import { createApplyService } from '../src/llm/apply-service.js';
import { createRunService } from '../src/llm/run-service.js';
import type { MetaStoreHandle } from '../src/meta/store.js';
import { buildProject } from '../src/project/build.js';
import { useOwnCodePolicy } from '../src/trial/own-code.js';
import { ORDINARY_POLICY } from '../src/trial/policy.js';
import { APP_VERSION } from '../src/version.js';
import { asProject, canBuildSides } from './app-project-helpers.js';
import { makeInstall, type Install } from './project-fixtures.js';
import { makeEnv, TEST_SECRET } from './helpers.js';

const PASSWORD = 'a-long-enough-test-password-1!';
const TOKEN = 'a-long-enough-setup-token';
const TRIAL = {
  ADMINIUM_TRIAL_MODE: 'on',
  ADMINIUM_TRIAL_ENDS_AT: '2099-12-01T00:00:00Z',
  ADMINIUM_PUBLIC_ORIGIN: 'https://hollis.try.example.com',
  ADMINIUM_DATABASE_HOSTS: 'pg-trials:5432',
  ADMINIUM_SETUP_TOKEN: TOKEN,
};
const HOSTED = { ADMINIUM_HOSTED_MODE: 'on', ADMINIUM_PUBLIC_ORIGIN: 'https://hollis.example.com', ADMINIUM_DATABASE_HOSTS: 'pg-trials:5432', ADMINIUM_SETUP_TOKEN: TOKEN };

let composed: ComposedServer | undefined;
let meta: MetaDb | undefined;
let install: Install | null = null;
afterEach(async () => {
  vi.unstubAllEnvs();
  await composed?.app.close();
  composed = undefined;
  await meta?.db.destroy();
  meta = undefined;
  await install?.close();
  install = null;
  useOwnCodePolicy(ORDINARY_POLICY);
});

interface Reply {
  status: number;
  body: Record<string, unknown>;
}
type Call = (method: 'GET' | 'POST' | 'PUT', url: string, payload?: unknown, headers?: Record<string, string>) => Promise<Reply>;

/** Signs the first account in and returns a caller with its cookie. */
async function signedIn(app: ComposedServer['app'], host?: string): Promise<Call> {
  const setup = await app.inject({
    method: 'POST',
    url: '/api/v1/setup/super-admin',
    ...(host === undefined ? {} : { headers: { host } }),
    payload: { email: 'owner@example.test', password: PASSWORD, name: 'Dana Price', setupToken: TOKEN },
  });
  expect(setup.statusCode, setup.body).toBe(201);
  const cookie = String(setup.headers['set-cookie']).split(';')[0] ?? '';
  return async (method, url, payload, headers = {}) => {
    const res = await app.inject({
      method,
      url,
      headers: { cookie, ...(host === undefined ? {} : { host }), ...headers },
      ...(payload === undefined ? {} : { payload: payload as object }),
    });
    return { status: res.statusCode, body: (res.body === '' ? {} : res.json()) as Record<string, unknown> };
  };
}

/** A composed server on `env`, as the boot reads it (what a profile implies is enforced). */
async function server(env: Record<string, string>): Promise<Call> {
  const store = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
  meta = store;
  await firstRun(store);
  const parsed = enforceProfile(makeEnv({ HOST: '127.0.0.1', ...env }));
  const runService = createRunService({ meta: store });
  const metaStore: MetaStoreHandle = { meta: store, url: 'sqlite::memory:', engine: 'sqlite', source: 'embedded', close: async () => Promise.resolve() };
  composed = await composeServer({
    env: parsed,
    metaStore,
    manager: new ConnectionManager({ meta: store, crypto: dsnCryptoFromSecret(TEST_SECRET), metaDsn: null, blockLoopback: true, databaseHosts: parsed.ADMINIUM_DATABASE_HOSTS }),
    runService,
    applyService: createApplyService({ meta: store, runService }),
    allowed: { templates: [], widgets: [], widgetContracts: {} },
    logger: false,
    telemetry: false,
    onMetaRelocated: () => undefined,
  });
  await composed.app.ready();
  return signedIn(composed.app);
}

const OCTET = { 'content-type': 'application/octet-stream' };
const SHA = 'sha512-' + 'A'.repeat(86) + '==';
const UPLOADS = [
  ['POST', `/api/v1/add-ons/upload?expectedSha512=${SHA}`],
  ['POST', `/api/v1/apps/upload?expectedSha512=${SHA}`],
  ['POST', `/api/v1/apps/upload-workspace?expectedSha512=${SHA}`],
] as const;

describe.each([
  ['trial mode', TRIAL, 'trial-mode'],
  ['the hosted profile', HOSTED, 'hosted-mode'],
] as const)('package uploads under %s', { timeout: 60_000 }, (_name, env, reason) => {
  it('are refused with PACKAGE_UPLOADS_OFF before the body is read, and /system/info says why', async () => {
    const call = await server(env);
    for (const [method, url] of UPLOADS) {
      const said = await call(method, url, Buffer.from('not a package'), OCTET);
      expect(said.status, url).toBe(403);
      expect(said.body['error'], url).toMatchObject({ code: 'PACKAGE_UPLOADS_OFF', message: expect.stringContaining('from the catalog only'), details: { question: 'packageUploads', reason } });
    }
    const info = (await call('GET', '/api/v1/system/info')).body;
    const off = { allowed: false, reason };
    expect(info['ownCode']).toEqual({ packageUploads: off, designerUploads: off, ownBuilds: off });
  });
});

describe('package uploads on an ordinary server', { timeout: 60_000 }, () => {
  it('reach the upload itself, and /system/info says they are taken', async () => {
    const call = await server({ ADMINIUM_SETUP_TOKEN: TOKEN });
    for (const [method, url] of UPLOADS) {
      const said = await call(method, url, Buffer.from('not a package'), OCTET);
      // Past the operator's word: the bytes themselves are judged, and are not a package.
      expect(said.status, url).not.toBe(403);
      expect((said.body['error'] as { code?: string } | undefined)?.code, url).not.toBe('PACKAGE_UPLOADS_OFF');
    }
    const open = { allowed: true, reason: null };
    expect((await call('GET', '/api/v1/system/info')).body['ownCode']).toEqual({ packageUploads: open, designerUploads: open, ownBuilds: open });
  });
});

// ── the Designer, on a project with a model on this machine ─────────────────

let model: Server;
let modelUrl: string;
/** The model's replies in order: tool calls, or words. */
let script: ({ calls: { name: string; arguments: Record<string, unknown> }[] } | { text: string })[] = [];
/** What the model was told first, request by request. */
let systems: string[] = [];

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
      const sent = JSON.parse(body) as { tools?: { function: { name: string } }[]; messages: { role: string; content?: string }[] };
      const line = (value: unknown): void => void response.write(`${JSON.stringify(value)}\n`);
      const done = { model: 'fake', done: true, done_reason: 'stop', prompt_eval_count: 50, eval_count: 5, message: { role: 'assistant', content: '' } };
      // The connection's build check: call `echo`, then answer.
      if (sent.tools?.some((tool) => tool.function.name === 'echo') === true) {
        const answered = sent.messages.some((message) => message.role === 'tool');
        line({ model: 'fake', done: false, message: { role: 'assistant', content: answered ? 'done' : '', ...(answered ? {} : { tool_calls: [{ function: { name: 'echo', arguments: { word: 'adminium' } } }] }) } });
        line(done);
        response.end();
        return;
      }
      systems.push(sent.messages.find((message) => message.role === 'system')?.content ?? '');
      const step = script.shift() ?? { text: 'Done.' };
      line({ model: 'fake', done: false, message: { role: 'assistant', content: 'text' in step ? step.text : '', ...('calls' in step ? { tool_calls: step.calls.map((call) => ({ function: call })) } : {}) } });
      line(done);
      response.end();
    });
  });
  await new Promise<void>((resolve) => model.listen(0, '127.0.0.1', resolve));
  modelUrl = `http://127.0.0.1:${String((model.address() as AddressInfo).port)}`;
});
afterAll(async () => {
  await new Promise<void>((resolve) => model.close(() => resolve()));
});

const DESIGN_PORT = 4798;
const HOST = `127.0.0.1:${String(DESIGN_PORT)}`;

/** A design server over a project, with the operator's profile in the process's environment (as a trial's container has it). */
async function designServer(profile: Record<string, string>): Promise<{ call: Call; root: string }> {
  install = await makeInstall();
  const root = asProject(install.dir);
  await buildProject({ root, configFile: join(root, 'adminium.config.ts') }, { version: APP_VERSION });
  const runService = createRunService({ meta: install.meta });
  composed = await composeServer({
    env: makeEnv({ HOST: '127.0.0.1', ADMINIUM_SETUP_TOKEN: TOKEN, ADMINIUM_AI_OLLAMA_BASE_URL: modelUrl, ADMINIUM_AI_MODEL: 'ollama/fake' }),
    metaStore: { meta: install.meta, url: 'sqlite::memory:', engine: 'sqlite', source: 'embedded', close: async () => Promise.resolve() },
    manager: install.manager,
    runService,
    applyService: createApplyService({ meta: install.meta, runService }),
    allowed: { templates: [], widgets: [], widgetContracts: {} },
    logger: false,
    telemetry: false,
    onMetaRelocated: () => undefined,
    project: { root, mode: 'dev', log: () => undefined, warn: () => undefined, databases: ['main'] },
    designer: { mode: 'local' as const, token: 'a'.repeat(64), port: DESIGN_PORT },
    designerBundler: () => true,
  });
  await composed.app.ready();
  for (const [name, value] of Object.entries(profile)) vi.stubEnv(name, value);
  return { call: await signedIn(composed.app, HOST), root };
}

const SESSION = 'ds_000000000000000000000000';

describe.skipIf(!canBuildSides).each([
  ['trial mode', { ADMINIUM_TRIAL_MODE: 'on' }, 'trial-mode'],
  ['the hosted profile', { ADMINIUM_HOSTED_MODE: 'on' }, 'hosted-mode'],
] as const)('the Designer under %s', { timeout: 120_000 }, (_name, profile, reason) => {
  afterEach(() => {
    script = [];
    systems = [];
  });

  it('refuses a site’s zip, a style of one’s own, a hand save and "Start with an app", each with its code', async () => {
    const { call, root } = await designServer(profile);
    const refused = async (method: 'POST' | 'PUT', url: string, payload: unknown, headers: Record<string, string>, code: string, question: string) => {
      const said = await call(method, url, payload, headers);
      expect(said.status, url).toBe(403);
      expect(said.body['error'], url).toMatchObject({ code, details: { question, reason } });
    };
    await refused('POST', `/api/v1/designer/sessions/${SESSION}/attachments/site?filename=site.zip`, Buffer.from('PK'), OCTET, 'DESIGNER_UPLOADS_OFF', 'designerUploads');
    await refused('POST', '/api/v1/designer/styles?filename=SKILL.md', Buffer.from('# Mine'), OCTET, 'DESIGNER_UPLOADS_OFF', 'designerUploads');
    await refused('PUT', `/api/v1/designer/sessions/${SESSION}/files`, { files: [{ path: 'hooks/orders.ts', base: 'x', content: 'export default {};' }] }, {}, 'DESIGNER_UPLOADS_OFF', 'designerUploads');
    await refused('POST', '/api/v1/designer/start', { key: 'shop', newKey: 'my-shop', name: 'My shop', approve: 'x', connectionId: 'env:ollama', model: 'fake' }, {}, 'OWN_CODE_OFF', 'ownBuilds');
    expect(existsSync(join(root, 'design-skills'))).toBe(false);
    expect(existsSync(join(root, 'apps', 'my-shop'))).toBe(false);
  });

  it('a turn that asks for a hook, the tests and a package gets the fixed refusal for each, no card, and no file', async () => {
    const { call, root } = await designServer(profile);
    script = [
      { calls: [{ name: 'name_app', arguments: { name: 'Repair desk' } }] },
      {
        calls: [
          { name: 'write_file', arguments: { path: 'hooks/orders.ts', content: 'export default { table: "orders", afterCreate() {} };' } },
          { name: 'write_file', arguments: { path: 'actions/refund.ts', content: 'export default {};' } },
          { name: 'run_tests', arguments: {} },
          { name: 'request_package', arguments: { packages: [{ name: 'left-pad', why: 'padding' }] } },
        ],
      },
      { text: 'This server does not allow server code.' },
    ];
    const created = await call('POST', '/api/v1/designer/sessions', { title: 'Repairs', target: 'auto', connectionId: 'env:ollama', model: 'fake', text: 'Add a hook that emails me on each new order.' });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const session = created.body['session'] as { id: string };
    type Event = { kind: string; tool?: string; state?: string; operator?: string; label?: string; detail?: string };
    let events: Event[] = [];
    await vi.waitFor(
      async () => {
        events = (await call('GET', `/api/v1/designer/sessions/${session.id}/events-since?after=0`)).body['events'] as Event[];
        expect(events.some((event) => event.kind === 'turn-finished')).toBe(true);
      },
      { timeout: 60_000, interval: 100 },
    );
    const refusedSteps = events.filter((event) => event.kind === 'step' && event.state === 'failed');
    expect(refusedSteps.map((event) => event.tool)).toEqual(['write_file', 'write_file', 'run_tests', 'request_package']);
    for (const step of refusedSteps) {
      expect(step, step.tool).toMatchObject({ operator: reason, label: 'Turned off on this server', detail: expect.stringContaining('operator') });
    }
    // Nobody was asked: the server's setting is not the person's to give.
    expect(events.filter((event) => event.kind === 'card')).toEqual([]);
    expect(existsSync(join(root, 'hooks', 'orders.ts'))).toBe(false);
    expect(existsSync(join(root, 'actions', 'refund.ts'))).toBe(false);
    // The model was told up front what this server does not allow, so a turn need not find out by trying.
    expect(systems.at(-1)).toContain('On this server you build with the manifest, pages and screens only.');
  });
});

describe.skipIf(!canBuildSides)('the Designer on an ordinary server', { timeout: 120_000 }, () => {
  afterEach(() => {
    script = [];
    systems = [];
  });

  it('takes the uploads past the operator’s word, and tells the model nothing of it', async () => {
    const { call } = await designServer({});
    const said = await call('POST', '/api/v1/designer/styles?filename=SKILL.md', Buffer.from('# Mine'), OCTET);
    expect((said.body['error'] as { code?: string } | undefined)?.code).not.toBe('DESIGNER_UPLOADS_OFF');
    script = [{ text: 'Hello.' }];
    const created = await call('POST', '/api/v1/designer/sessions', { title: 'Repairs', target: 'auto', connectionId: 'env:ollama', model: 'fake', text: 'Hello.' });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    await vi.waitFor(() => expect(systems.length).toBeGreaterThan(0), { timeout: 30_000 });
    expect(systems.join('\n')).not.toContain('On this server you build with the manifest');
  });
});
