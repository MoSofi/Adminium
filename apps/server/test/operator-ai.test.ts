// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The operator's own AI with a hard limit, and the Designer's start prompt.
 *
 *  - `ADMINIUM_AI_OPERATOR_BUDGET_TOKENS` is counted at the one place every model call passes (the client, runner and
 *    picture maker `llm/connections.ts` hands out), for every feature on the operator's connection; it survives a
 *    restart and travels with no archive or export.
 *  - `ADMINIUM_AI_OPERATOR_SCOPE=dashboard` holds a Designer turn on the operator's connection to dashboards where things
 *    take effect: the jail, the build, the apply, `add_side` and `use_site`, whatever the model is offered. Each guard
 *    both ways: on the person's own key the same turn goes through.
 *  - `ADMINIUM_AI_OPERATOR_ONLY` refuses a typed address for every provider, and a refused saved connection gives way to
 *    the operator's.
 *  - The start prompt runs once, as the first user turn, every question answered no.
 *
 * The model is a small HTTP server on this machine that speaks Ollama's streaming chat, as in `designer-routes.test.ts`.
 */
import { createServer, type Server } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createProviderClient, createProviderRunner, PictureError, type PictureMaker, type ProviderConfig } from '@adminium/llm';
import { operatorTalliesRepo, settingsRepo, type MetaDb } from '@adminium/meta';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { createArchive } from '../src/archive/create.js';
import { NEVER_ARCHIVED_TABLES, sanitizeDump } from '../src/archive/policy.js';
import { composeServer, type ComposedServer } from '../src/compose.js';
import { gateTools } from '../src/designer/declarative.js';
import { createEventLog } from '../src/designer/events.js';
import { createJail, JailError } from '../src/designer/jail.js';
import { enterScope, publicReach, reachRefusal } from '../src/designer/operator-scope.js';
import { SCOPE_REACH, scopeTools } from '../src/designer/scope-gate.js';
import type { DesignerSession } from '../src/designer/session-store.js';
import type { DesignerTool, ToolContext } from '../src/designer/tool-types.js';
import { DESIGNER_TOOL_NAMES } from '../src/designer/tool-types.js';
import { exportZip } from '../src/export/zip-service.js';
import { createAiEnv } from '../src/llm/ai-env.js';
import { createAiConnections } from '../src/llm/connections.js';
import { AI_TOKENS_TALLY, createOperatorAiMeter, OperatorAiUsedUpError, operatorAiRules, PICTURE_TOKENS, USED_UP_MESSAGE } from '../src/llm/operator-ai.js';
import { createApplyService } from '../src/llm/apply-service.js';
import { createRunService } from '../src/llm/run-service.js';
import type { MetaStoreHandle } from '../src/meta/store.js';
import { operatorAiTokensUsed } from '../src/operator/counters.js';
import { starterParts } from '../src/project/apps/scaffold-app.js';
import { buildProject } from '../src/project/build.js';
import { writeLlmConfig } from '../src/routes/llm/config-service.js';
import { trialPolicy } from '../src/trial/policy.js';
import { APP_VERSION } from '../src/version.js';
import { asProject, canBuildSides } from './app-project-helpers.js';
import { AVAILABLE, CRYPTO, makeStore, SECRET, SIGNING, type EngineName } from './archive.helpers.js';
import { makeInstall, type Install } from './project-fixtures.js';
import { makeEnv } from './helpers.js';

// ── a model on this machine ──────────────────────────────────────────────────

let model: Server;
let modelUrl: string;
type ScriptStep = () => { text: string } | { calls: { name: string; arguments: Record<string, unknown> }[] };
let script: ScriptStep[] = [];
/** Each request to the model: its messages (the system prompt first) and the tools it was offered. */
let asked: { messages: { role: string; content?: string }[]; tools: string[] }[] = [];
/** What each reply reports it used, in and out. */
const USED = { in: 50, out: 5 };

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
      const sent = JSON.parse(body) as { messages: { role: string; content?: string }[]; tools?: { function: { name: string } }[] };
      const line = (value: unknown): void => {
        response.write(`${JSON.stringify(value)}\n`);
      };
      const done = { model: 'fake', done: true, done_reason: 'stop', prompt_eval_count: USED.in, eval_count: USED.out, message: { role: 'assistant', content: '' } };
      // The build check a new session makes: call `echo`, then answer once the result is back.
      if (sent.tools?.some((tool) => tool.function.name === 'echo') === true) {
        line(
          sent.messages.some((message) => message.role === 'tool')
            ? { model: 'fake', done: false, message: { role: 'assistant', content: 'done' } }
            : { model: 'fake', done: false, message: { role: 'assistant', content: '', tool_calls: [{ function: { name: 'echo', arguments: { word: 'adminium' } } }] } },
        );
        line(done);
        response.end();
        return;
      }
      asked.push({ messages: sent.messages, tools: (sent.tools ?? []).map((tool) => tool.function.name) });
      const made = script.shift()?.() ?? { text: 'Done.' };
      line('calls' in made ? { model: 'fake', done: false, message: { role: 'assistant', content: '', tool_calls: made.calls.map((call) => ({ function: call })) } } : { model: 'fake', done: false, message: { role: 'assistant', content: made.text } });
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

// ── the budget, at the client ────────────────────────────────────────────────

const OPERATOR_ENV = { ADMINIUM_AI_OPENAI_API_KEY: 'sk-operator-test', ADMINIUM_AI_GOOGLE_API_KEY: 'g-operator-test', ADMINIUM_AI_MODEL: 'openai/gpt-test' };
const PLAIN_KEYS = { encrypt: (value: string) => value, decrypt: (value: string) => value };

describe.each((['sqlite', 'postgres', 'mysql'] as EngineName[]).filter((engine) => AVAILABLE[engine]))('the operator’s AI budget [%s]', (engine) => {
  let meta: MetaDb;
  let destroy: () => Promise<void> = async () => undefined;
  afterEach(async () => {
    await destroy();
  });

  /** Connections as a server has them, with every call answered by fakes that report what they used. */
  async function connections(budget: number | undefined, opts: { counted?: boolean } = {}) {
    const rules = operatorAiRules(makeEnv(budget === undefined ? (opts.counted === false ? {} : { ADMINIUM_AI_OPERATOR_ONLY: 'on' }) : { ADMINIUM_AI_OPERATOR_BUDGET_TOKENS: String(budget) }));
    const meter = createOperatorAiMeter(meta, rules);
    await meter.open();
    const calls: string[] = [];
    const made = createAiConnections({
      settings: settingsRepo(meta),
      keyCrypto: PLAIN_KEYS,
      aiEnv: createAiEnv({ root: null, fromEnvironment: OPERATOR_ENV }),
      networkFeatures: true,
      production: false,
      resolve: async () => [{ address: '93.184.216.34', family: 4 }],
      operatorAi: meter,
      createClient: (config: ProviderConfig) => ({
        id: config.provider,
        listModels: async () => [],
        test: async () => ({ ok: true as const, model: 'm', latencyMs: 1 }),
        complete: async () => (calls.push(`complete:${config.apiKey ?? ''}`), { text: 'an answer', usage: { inputTokens: 30, outputTokens: 10 } }),
        transcribe: async () => (calls.push('transcribe'), { text: 'four words were said', seconds: 3 }),
      }),
      createRunner: (config: ProviderConfig) => ({
        id: config.provider,
        run: async (req) => (calls.push(`run:${String(req.maxTokens)}`), { blocks: [{ type: 'text' as const, text: 'ok' }], stop: 'end' as const, malformed: [], usage: { inputTokens: 70, outputTokens: 30 } }),
      }),
      createPictureMaker: (kind): PictureMaker => ({
        kind,
        listModels: async () => [],
        make: async (req) => (calls.push('picture'), { pictures: Array.from({ length: req.count }, () => ({ bytes: new Uint8Array([1]), type: 'image/png' as const, width: 1, height: 1 })), dropped: 0, refused: 0 }),
      }),
    });
    return { made, meter, calls };
  }

  async function ownKeySaved(): Promise<void> {
    await settingsRepo(meta).set('llm.provider', 'anthropic', { updatedBy: null });
    await settingsRepo(meta).set('llm.apiKey', 'sk-own', { updatedBy: null });
    await settingsRepo(meta).set('llm.model', 'claude-test', { updatedBy: null });
  }

  it('counts every feature on the operator’s connection, and nothing on the person’s own key', async () => {
    ({ meta, destroy } = await makeStore(engine, true));
    const { made, calls } = await connections(1_000_000);
    expect(await operatorAiTokensUsed(meta)).toBe(0);

    // The Designer's runner, the page assistant's complete(), voice, and a picture made with Gemini's key.
    const runner = await made.runner('env:openai', 'gpt-test');
    await runner.runner.run({ system: 's', messages: [], tools: [], model: 'gpt-test', maxTokens: 1000 });
    const assistant = await made.client('env:openai');
    await assistant.client.complete({ system: 's', messages: [{ role: 'user', content: 'hi' }], model: 'gpt-test', maxTokens: 100, temperature: 0 });
    await assistant.client.transcribe!({ audio: new Uint8Array(10), mime: 'audio/webm' });
    const maker = await made.pictureMaker('google', 'gemini-3.1-flash-image');
    await maker.maker.make({ prompt: 'a loaf', model: 'gemini-3.1-flash-image', shape: 'square', count: 2 });
    const used = (await operatorAiTokensUsed(meta)) ?? 0;
    // 100 for the run, 40 for the answer, three seconds of speech and its words, two pictures and their words.
    expect(used).toBeGreaterThanOrEqual(100 + 40 + 30 + 2 * PICTURE_TOKENS);
    expect(used).toBeLessThan(100 + 40 + 30 + 2 * PICTURE_TOKENS + 20);
    expect(calls).toEqual(['run:1000', 'complete:sk-operator-test', 'transcribe', 'picture']);

    // The person's own key, saved in Settings → AI: not the operator's, not counted.
    await ownKeySaved();
    expect(made.isOperator('database')).toBe(false);
    expect(made.isOperator('env:openai')).toBe(true);
    expect(made.isOperator('google')).toBe(true);
    const own = await made.client('database');
    await own.client.complete({ system: 's', messages: [], model: 'claude-test', maxTokens: 100, temperature: 0 });
    expect(await operatorAiTokensUsed(meta)).toBe(used);
  });

  it('refuses the next call past the budget, for every feature, holds a reply to what is left, and survives a restart', async () => {
    ({ meta, destroy } = await makeStore(engine, true));
    const first = await connections(150);
    const runner = await first.made.runner('env:openai', 'gpt-test');
    await runner.runner.run({ system: 's', messages: [], tools: [], model: 'gpt-test', maxTokens: 1000 });
    // Each reply may use no more than is left: 150, then 50.
    await runner.runner.run({ system: 's', messages: [], tools: [], model: 'gpt-test', maxTokens: 1000 });
    expect(first.calls).toEqual(['run:150', 'run:50']);
    expect(await operatorAiTokensUsed(meta)).toBe(200);

    // A restart: a new meter over the same store reads what was spent.
    const again = await connections(150);
    const assistant = await again.made.client('env:openai');
    await expect(assistant.client.complete({ system: 's', messages: [], model: 'gpt-test', maxTokens: 100, temperature: 0 })).rejects.toBeInstanceOf(OperatorAiUsedUpError);
    await expect(assistant.client.transcribe!({ audio: new Uint8Array(10), mime: 'audio/webm' })).rejects.toThrow(USED_UP_MESSAGE);
    await expect((await again.made.runner('env:openai', 'gpt-test')).runner.run({ system: 's', messages: [], tools: [], model: 'gpt-test', maxTokens: 10 })).rejects.toBeInstanceOf(OperatorAiUsedUpError);
    const maker = await again.made.pictureMaker('google', 'gemini-3.1-flash-image');
    await expect(maker.maker.make({ prompt: 'a loaf', model: 'm', shape: 'square', count: 1 })).rejects.toBeInstanceOf(PictureError);
    expect(again.calls).toEqual([]);

    // The person's own key goes on.
    await ownKeySaved();
    await (await again.made.client('database')).client.complete({ system: 's', messages: [], model: 'claude-test', maxTokens: 100, temperature: 0 });
    expect(again.calls).toEqual(['complete:sk-own']);
  });

  it('counts nothing where no operator variable is set', async () => {
    ({ meta, destroy } = await makeStore(engine, true));
    const { made } = await connections(undefined, { counted: false });
    await (await made.client('env:openai')).client.complete({ system: 's', messages: [], model: 'gpt-test', maxTokens: 100, temperature: 0 });
    expect(await operatorAiTokensUsed(meta)).toBeNull();
  });

  it('travels with no archive and no export, and a restore never writes it', async () => {
    ({ meta, destroy } = await makeStore(engine, true));
    await operatorTalliesRepo(meta).add(AI_TOKENS_TALLY, 987_654_321);
    expect(NEVER_ARCHIVED_TABLES).toContain('adminium_operator_tallies');
    const dir = mkdtempSync(join(tmpdir(), 'adminium-operator-ai-'));
    try {
      mkdirSync(join(dir, 'data'));
      for (const kind of ['full', 'export'] as const) {
        const archive = join(dir, `archive-${kind}.zip`);
        const created = await createArchive({ meta, outPath: archive, dataDir: join(dir, 'data'), projectRoot: null, kind, secret: SECRET, dsnCrypto: CRYPTO, signing: SIGNING });
        expect(JSON.stringify(created.manifest)).not.toContain('adminium_operator_tallies');
        const tables = new Map([['adminium_operator_tallies', { columns: ['name', 'amount', 'changed_at'], kinds: {}, rows: [[AI_TOKENS_TALLY, 0, 1]] }]]);
        expect(sanitizeDump(tables as never, { kind, dialect: 'sqlite' }).droppedTables).toContain('adminium_operator_tallies');
        expect(tables.size).toBe(0);
      }
      const bundle = await exportZip({ meta, outPath: join(dir, 'bundle.zip'), dataDir: join(dir, 'data') });
      expect(readFileSync(bundle.path).includes(Buffer.from('987654321'))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    expect(await operatorAiTokensUsed(meta)).toBe(987_654_321);
  });
});

// ── operator only: the typed address, and the saved connection that gives way ──

describe('ADMINIUM_AI_OPERATOR_ONLY', () => {
  it('refuses a typed llm.baseUrl for every provider, and only with the variable set', async () => {
    const store = await makeStore('sqlite', true);
    try {
      const settings = settingsRepo(store.meta);
      for (const provider of ['anthropic', 'openai', 'openai-compatible', 'ollama'] as const) {
        const body = { provider, model: 'm', baseUrl: 'https://models.example.test/v1' };
        await expect(writeLlmConfig(settings, PLAIN_KEYS, body as never, { updatedBy: null, at: 1, policy: trialPolicy(makeEnv({ ADMINIUM_AI_OPERATOR_ONLY: 'on' })) })).rejects.toThrow(/operator/i);
        await writeLlmConfig(settings, PLAIN_KEYS, body as never, { updatedBy: null, at: 1, policy: trialPolicy(makeEnv()) });
      }
    } finally {
      await store.destroy();
    }
  });

  it('a saved connection the operator refuses gives way to the operator’s for every feature', async () => {
    const store = await makeStore('sqlite', true);
    try {
      const settings = settingsRepo(store.meta);
      await settings.set('llm.provider', 'ollama', { updatedBy: null });
      await settings.set('llm.baseUrl', 'http://10.0.0.5:11434', { updatedBy: null });
      await settings.set('llm.model', 'own', { updatedBy: null });
      const made = (env: Record<string, string>) =>
        createAiConnections({
          settings,
          keyCrypto: PLAIN_KEYS,
          aiEnv: createAiEnv({ root: null, fromEnvironment: OPERATOR_ENV }),
          networkFeatures: true,
          production: false,
          policy: trialPolicy(makeEnv(env)),
          createClient: createProviderClient,
          createRunner: createProviderRunner,
        });
      expect((await made({ ADMINIUM_AI_OPERATOR_ONLY: 'on' }).default())?.connection.id).toBe('env:openai');
      expect((await made({}).default())?.connection.id).toBe('database');
    } finally {
      await store.destroy();
    }
  });
});

// ── the dashboard scope, tool by tool ────────────────────────────────────────

describe('every Designer tool is listed with what it may reach on the operator’s AI', () => {
  it('the table names exactly the tools the Designer has', () => {
    expect(Object.keys(SCOPE_REACH).sort()).toEqual([...DESIGNER_TOOL_NAMES].sort());
  });

  it('a tool the table does not name is refused whole in a scoped turn, and runs in any other', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'adminium-scope-'));
    try {
      let ran = 0;
      const unknown: DesignerTool = { name: 'publish_everything', description: '', inputSchema: { type: 'object' }, running: () => '', run: async () => ((ran += 1), { content: 'ran', label: 'Ran' }) };
      const [gated] = gateTools(scopeTools(dir, 'repairs', [unknown]));
      const signal = new AbortController().signal;
      const ask = async () => ({ type: 'question' as const, text: 'no' });
      const ctx: ToolContext = { session: { id: 'ds_x', appKey: 'repairs' } as DesignerSession, turn: 1, signal, ask, handle: { turn: 1, by: { id: null, label: 'x' }, signal, ask, events: createEventLog({ lastSeq: 0, append: () => undefined, publish: () => undefined }) } };
      expect(await gated!.run({}, ctx)).toMatchObject({ content: 'ran' });
      const scope = enterScope(dir, 'repairs');
      expect(await gated!.run({}, ctx)).toMatchObject({ isError: true, facts: { operator: 'operator-ai-scope' } });
      expect(scope.tripped()).toBe(true);
      scope.end();
      expect(ran).toBe(1);

      // The doors that are customer-facing whatever they are given, and add_side by the side it is asked for.
      const named = (name: string): DesignerTool => ({ ...unknown, name });
      const [site, side] = scopeTools(dir, 'repairs', [named('use_site'), named('add_side')]);
      const again = enterScope(dir, 'repairs');
      expect(await site!.run({}, ctx)).toMatchObject({ isError: true, facts: { operator: 'operator-ai-scope' } });
      expect(await side!.run({ side: 'customer' }, ctx)).toMatchObject({ isError: true });
      expect(await side!.run({ side: 'staff' }, ctx)).toMatchObject({ content: 'ran' });
      again.end();
      expect(await site!.run({}, ctx)).toMatchObject({ content: 'ran' });
      expect(ran).toBe(3);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('the jail refuses customer, phone and site folders only in a scoped turn', () => {
    const dir = mkdtempSync(join(tmpdir(), 'adminium-scope-'));
    try {
      mkdirSync(join(dir, 'apps', 'repairs'), { recursive: true });
      const jail = createJail(dir, 'repairs');
      const paths = ['apps/repairs/customer/src/App.tsx', 'apps/repairs/mobile/App.tsx', 'apps/repairs/staff/src/site/index.css'];
      const scope = enterScope(dir, 'repairs');
      for (const path of paths) expect(() => jail.write(path, 'x'), path).toThrow(JailError);
      expect(scope.tripped()).toBe(true);
      // Dashboard work goes on.
      jail.write('apps/repairs/manifest/tables/jobs.json', '{}');
      scope.end();
      for (const path of paths) jail.write(path, 'x');
      expect(existsSync(join(dir, 'apps', 'repairs', 'customer', 'src', 'App.tsx'))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('what an app reaches of the public: a side, a public entry, a form, mail, a pay page, a site', () => {
    const dir = mkdtempSync(join(tmpdir(), 'adminium-scope-'));
    try {
      const parts = join(dir, 'apps', 'repairs', 'manifest');
      mkdirSync(parts, { recursive: true });
      const bare = (): void => writeFileSync(join(parts, 'app.json'), JSON.stringify({ kind: 'app', key: 'repairs', frontends: [{ side: 'staff', kind: 'spa' }] }));
      bare();
      const scope = enterScope(dir, 'repairs');
      expect(reachRefusal(dir, 'repairs')).toBeNull();
      const grows: [string, unknown][] = [
        ['app.json', { kind: 'app', key: 'repairs', frontends: [{ side: 'staff', kind: 'spa' }, { side: 'customer', kind: 'spa' }] }],
        ['access.json', { publicAccess: [{ table: 'jobs', methods: ['GET'], select: ['id'] }] }],
        ['access.json', { publicAccess: [{ key: 'forms', table: 'jobs', methods: ['POST'], writable: ['note'] }] }],
        ['emails.json', { outbox: { table: 'mail' } }],
        ['saved.json', { payments: { links: [] } }],
      ];
      for (const [file, content] of grows) {
        writeFileSync(join(parts, file), JSON.stringify(content));
        expect(reachRefusal(dir, 'repairs'), file).not.toBeNull();
        if (file !== 'app.json') rmSync(join(parts, file));
        bare();
        expect(reachRefusal(dir, 'repairs'), `${file} taken back`).toBeNull();
      }
      mkdirSync(join(dir, 'apps', 'repairs', 'staff', 'src', 'site'), { recursive: true });
      expect(publicReach(dir, 'repairs').has('site:staff')).toBe(true);
      expect(reachRefusal(dir, 'repairs')).not.toBeNull();
      scope.end();
      expect(reachRefusal(dir, 'repairs')).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ── a whole server ───────────────────────────────────────────────────────────

let composed: ComposedServer | undefined;
let root: string | undefined;
let install: Install | null = null;
afterEach(async () => {
  await composed?.app.close();
  composed = undefined;
  await install?.close();
  install = null;
  root = undefined;
  script = [];
  asked = [];
});

const DESIGN_PORT = 4802;
const HOST = `127.0.0.1:${String(DESIGN_PORT)}`;

interface Client {
  meta: MetaDb;
  cookie: string;
  call: (method: 'GET' | 'POST' | 'PATCH', url: string, payload?: unknown) => Promise<{ status: number; body: Record<string, unknown> }>;
}

const memoryStore = (meta: MetaDb): MetaStoreHandle => ({ meta, url: 'sqlite::memory:', engine: 'sqlite', source: 'embedded', close: async () => Promise.resolve() });

async function compose(meta: MetaDb, environment: Record<string, string>): Promise<ComposedServer> {
  const runService = createRunService({ meta });
  const made = await composeServer({
    env: makeEnv({ HOST: '127.0.0.1', ADMINIUM_AI_OLLAMA_BASE_URL: modelUrl, ADMINIUM_AI_MODEL: 'ollama/fake', ...environment }),
    metaStore: memoryStore(meta),
    manager: install!.manager,
    runService,
    applyService: createApplyService({ meta, runService }),
    allowed: { templates: [], widgets: [], widgetContracts: {} },
    logger: false,
    telemetry: false,
    onMetaRelocated: () => undefined,
    project: { root: root!, mode: 'dev', log: () => undefined, warn: () => undefined, databases: ['main'] },
    designer: { mode: 'local' as const, token: 'a'.repeat(64), port: DESIGN_PORT },
    designerBundler: () => true,
  });
  await made.app.ready();
  return made;
}

async function server(environment: Record<string, string>): Promise<Client> {
  install = await makeInstall();
  root = asProject(install.dir);
  await buildProject({ root, configFile: join(root, 'adminium.config.ts') }, { version: APP_VERSION });
  composed = await compose(install.meta, environment);
  const setup = await composed.app.inject({ method: 'POST', url: '/api/v1/setup/super-admin', headers: { host: HOST }, payload: { email: 'owner@example.test', password: 'a-long-enough-test-password-1!', name: 'Owner' } });
  expect(setup.statusCode, setup.body).toBe(201);
  const cookie = String(setup.headers['set-cookie']).split(';')[0] ?? '';
  return {
    meta: install.meta,
    cookie,
    call: async (method, url, payload) => {
      const res = await composed!.app.inject({ method, url, headers: { host: HOST, cookie }, ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }) });
      return { status: res.statusCode, body: (res.body === '' ? {} : res.json()) as Record<string, unknown> };
    },
  };
}

type EventRow = { seq: number; kind: string; outcome?: string; card?: unknown; tool?: string; state?: string; stage?: string; value?: unknown; text?: string; delta?: string };
async function finishedTurn(client: Client, sessionId: string, turn = 1): Promise<EventRow[]> {
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

const SCOPED = { ADMINIUM_AI_OPERATOR_SCOPE: 'dashboard' };
const cardOf = (events: EventRow[]): unknown => events.find((event) => event.kind === 'operator-ai')?.card ?? null;
/** The starter's parts, as a model would write them: the bare app given its table, page and grants. */
const writesStarter =
  (key: string): ScriptStep =>
  () => ({
    calls: Object.entries(starterParts({ key, name: 'Repair desk', sides: [], version: APP_VERSION }))
      .filter(([file]) => file !== 'manifest/app.json')
      .map(([file, value]) => ({ name: 'write_file', arguments: { path: `apps/${key}/${file}`, content: JSON.stringify(value, null, 2) } })),
  });

/** The person's own key: a connection saved in Settings → AI, to the same model. */
async function ownKey(client: Client): Promise<void> {
  const settings = settingsRepo(client.meta);
  await settings.set('llm.provider', 'ollama', { updatedBy: null });
  await settings.set('llm.baseUrl', modelUrl, { updatedBy: null });
  await settings.set('llm.model', 'fake', { updatedBy: null });
}

async function turn(client: Client, connectionId: string, steps: ScriptStep[], text = 'Make me a repair desk.'): Promise<{ session: { id: string; appKey: string; target: string }; events: EventRow[] }> {
  script = steps;
  const created = await client.call('POST', '/api/v1/designer/sessions', { name: 'Repair desk', target: 'web', connectionId, model: 'fake', text });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const session = created.body['session'] as { id: string; appKey: string; target: string };
  return { session, events: await finishedTurn(client, session.id) };
}

describe.skipIf(!canBuildSides)('a Designer turn on the operator’s AI', { timeout: 120_000 }, () => {
  it('writes no customer side by hand, and ends with the card, never the model’s words; on the person’s own key it is written', async () => {
    const write = (key: string) => ({ name: 'write_file', arguments: { path: `apps/${key}/customer/src/App.tsx`, content: 'export default function App() { return null; }' } });
    const client = await server(SCOPED);
    const scoped = await turn(client, 'env:ollama', [() => ({ calls: [write('repair-desk')] }), () => ({ text: 'I have built your customer site.' })], 'now make the customer ordering site');
    expect(scoped.session.target).toBe('dashboard');
    expect(existsSync(join(root!, 'apps', 'repair-desk', 'customer'))).toBe(false);
    expect(cardOf(scoped.events)).toBe('scope');
    // The model was asked once: the refusal is the card's to say, never the model's.
    expect(asked).toHaveLength(1);
    expect(JSON.stringify(scoped.events)).not.toContain('built your customer site');
    // What it was told: dashboards only, the card's tool, and no "call add_side first".
    const system = asked[0]!.messages[0]!.content ?? '';
    expect(system).toContain('needs_own_ai_key');
    expect(system).not.toContain('call add_side ("staff" or "customer") first');
    expect(asked[0]!.tools).toContain('needs_own_ai_key');

    // The person's own key: the same request writes the file.
    asked = [];
    await ownKey(client);
    const own = await turn(client, 'database', [() => ({ calls: [write('repair-desk-2')] })]);
    expect(own.session.target).toBe('web');
    expect(existsSync(join(root!, 'apps', 'repair-desk-2', 'customer', 'src', 'App.tsx'))).toBe(true);
    expect(cardOf(own.events)).toBeNull();
    expect(asked[0]!.messages[0]!.content ?? '').toContain('call add_side ("staff" or "customer") first');
    expect(asked[0]!.tools).not.toContain('needs_own_ai_key');
  });

  it('add_side for customers or the phone is refused at its door; the card’s own tool ends the turn', async () => {
    const client = await server(SCOPED);
    for (const call of [{ name: 'add_side', arguments: { side: 'customer' } }, { name: 'add_side', arguments: { side: 'mobile' } }, { name: 'needs_own_ai_key', arguments: {} }]) {
      asked = [];
      const { events } = await turn(client, 'env:ollama', [() => ({ calls: [call] })]);
      expect(cardOf(events), call.name).toBe('scope');
      expect(events.find((event) => event.kind === 'step' && event.state === 'failed')?.tool).toBe(call.name);
      expect(asked).toHaveLength(1);
    }
  });

  it('a manifest that opens the app to the public is neither built nor applied, whichever tool wrote it; on the person’s own key it is', async () => {
    const client = await server(SCOPED);
    const access = (key: string) => ({ name: 'write_file', arguments: { path: `apps/${key}/manifest/access.json`, content: JSON.stringify({ publicAccess: [{ table: 'items', methods: ['GET'], select: ['id', 'title'] }] }) } });
    for (const tool of ['build_sides', 'apply_app']) {
      const { session, events } = await turn(client, 'env:ollama', [writesStarter('repair-desk'), () => ({ calls: [access('repair-desk')] }), () => ({ calls: [{ name: tool, arguments: {} }] })]);
      expect(cardOf(events), tool).toBe('scope');
      expect(events.some((event) => event.kind === 'apply' && event.state === 'installed'), tool).toBe(false);
      const apps = (await client.call('GET', '/api/v1/apps')).body['apps'] as { key: string }[] | undefined;
      expect((apps ?? []).some((app) => app.key === session.appKey), tool).toBe(false);
      rmSync(join(root!, 'apps', session.appKey), { recursive: true, force: true });
    }
    // Dashboard work on the same connection is applied as ever.
    const dashboard = await turn(client, 'env:ollama', [writesStarter('repair-desk')]);
    expect(cardOf(dashboard.events)).toBeNull();
    expect(dashboard.events.find((event) => event.kind === 'apply')).toMatchObject({ state: 'installed' });
    // On the person's own key, the public entry is applied.
    await ownKey(client);
    const own = await turn(client, 'database', [writesStarter('repair-desk-2'), () => ({ calls: [access('repair-desk-2')] }), () => ({ calls: [{ name: 'apply_app', arguments: {} }] })]);
    expect(cardOf(own.events)).toBeNull();
    expect(own.events.some((event) => event.kind === 'apply' && event.state === 'installed')).toBe(true);
  });

  it('the AI used up ends the turn with its card, keeps what was made, and stays used up', async () => {
    // Each reply reports 55 tokens. The build check made when a session is made counts too.
    const client = await server({ ADMINIUM_AI_OPERATOR_BUDGET_TOKENS: '300' });
    const { events } = await turn(client, 'env:ollama', [writesStarter('repair-desk'), writesStarter('repair-desk'), writesStarter('repair-desk'), writesStarter('repair-desk'), writesStarter('repair-desk'), writesStarter('repair-desk')]);
    expect(cardOf(events)).toBe('used-up');
    // What was made before it ran out is checked and applied.
    expect(events.find((event) => event.kind === 'apply')).toMatchObject({ state: 'installed' });
    expect(await operatorAiTokensUsed(client.meta)).toBeGreaterThanOrEqual(300);
    asked = [];
    const again = await turn(client, 'env:ollama', [() => ({ text: 'hi' })]);
    expect(cardOf(again.events)).toBe('used-up');
    expect(asked).toHaveLength(0);
    expect(again.events.some((event) => event.kind === 'check')).toBe(false);
  });
});

// ── the start prompt ─────────────────────────────────────────────────────────

describe.skipIf(!canBuildSides)('the Designer’s start prompt', { timeout: 120_000 }, () => {
  const PROMPT = 'Make a bakery order system: pickup orders, products, and stock of flour.';
  const b64 = Buffer.from(PROMPT).toString('base64');

  it('runs once, as the first user turn of a dashboard session, every question answered no; never again after a restart', async () => {
    const client = await server({ ADMINIUM_DESIGNER_START_PROMPT_B64: b64 });
    script = [() => ({ calls: [{ name: 'ask_person', arguments: { question: 'Shall I add a website too?', choices: ['Yes', 'No'] } }] }), () => ({ text: 'Built.' })];
    const started = await client.call('POST', '/api/v1/designer/start-prompt');
    expect(started.status, JSON.stringify(started.body)).toBe(201);
    const sessionId = started.body['sessionId'] as string;
    const events = await finishedTurn(client, sessionId);
    const session = (await client.call('GET', `/api/v1/designer/sessions/${sessionId}`)).body['session'] as { target: string };
    expect(session.target).toBe('dashboard');
    // The prompt is the person's first message, never the system prompt.
    expect(asked[0]!.messages[0]!.role).toBe('system');
    expect(asked[0]!.messages[0]!.content).not.toContain(PROMPT);
    expect(asked[0]!.messages.find((message) => message.role === 'user')?.content).toContain(PROMPT);
    expect(events.find((event) => event.kind === 'turn-started')).toMatchObject({ text: PROMPT });
    // The question was answered no, at once, by nobody.
    expect(events.find((event) => event.kind === 'card-answered')).toMatchObject({ value: { type: 'question', text: 'No.' } });
    expect(JSON.stringify(asked[1]?.messages)).toContain('No.');

    const twice = await client.call('POST', '/api/v1/designer/start-prompt');
    expect(twice.status).toBe(409);
    expect(twice.body).toMatchObject({ error: { details: { reason: 'START_PROMPT_RAN' } } });
    await composed!.app.close();
    composed = await compose(client.meta, { ADMINIUM_DESIGNER_START_PROMPT_B64: b64 });
    const again = await composed.app.inject({ method: 'POST', url: '/api/v1/designer/start-prompt', headers: { host: HOST, cookie: client.cookie } });
    expect(again.statusCode, again.body).toBe(409);
  });

  it('is not there without the variable', async () => {
    const client = await server({});
    const none = await client.call('POST', '/api/v1/designer/start-prompt');
    expect(none.status).toBe(404);
    expect(none.body).toMatchObject({ error: { details: { reason: 'NO_START_PROMPT' } } });
  });
});
