// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Build box W4: the schema assistant's one run on the user's own database (`llm/yours-assist.ts`), the notes it
 * reads (`config/your-database.ts` `cleanNotes`, `POST /llm/runs` `notes`), and the key-based guard that keeps
 * app and add-on tables off `yours` (`connections/no-app-tables.ts`).
 *
 * On every meta engine (SQLite always; Postgres and MySQL with TEST_POSTGRES_URL / TEST_MYSQL_URL): the claim is a
 * row in `adminium_operator_tallies`, the record and its undo image a JSON setting, and the apply a transaction.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import BetterSqlite3 from 'better-sqlite3';
import {
  connectionsRepo,
  createSqliteMetaDb,
  firstRun,
  operatorTalliesRepo,
  rolesRepo,
  settingsRepo,
  snapshotsRepo,
  usersRepo,
  type DsnCrypto,
  type MetaDb,
} from '@adminium/meta';
import { createProviderClient, ProviderError, type LlmKeyCrypto, type ProviderClient } from '@adminium/llm';
import type { InstallPlan, Manifest } from '@adminium/manifest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { applyPlanTo } from '../src/add-ons/schema-target.js';
import { buildServer } from '../src/app.js';
import { rbacPlugin } from '../src/plugins/rbac.js';
import { llmRoutes } from '../src/routes/llm/index.js';
import { assertNoAppTables, YOURS_KEY } from '../src/connections/no-app-tables.js';
import { cleanNotes, YOUR_DATABASE_NOTES_MAX_CHARS } from '../src/config/your-database.js';
import type { ConnectionManager } from '../src/connections/manager.js';
import { createApplyService } from '../src/llm/apply-service.js';
import { createPromptService } from '../src/llm/prompt-service.js';
import { createProviderResolver } from '../src/llm/provider-resolver.js';
import { createRunService } from '../src/llm/run-service.js';
import {
  assistEndedReporter,
  createYoursAssist,
  hasOperatorBuildKey,
  ranBefore,
  refusedBeforeAnswer,
  undoYoursAssist,
  waitFor,
  YOURS_ASSIST_CAP_WAIT_MS,
  YOURS_ASSIST_TALLY,
  YOURS_ASSIST_WAIT_TALLY,
  type AssistFinishedEvent,
  type YoursAssistDeps,
} from '../src/llm/yours-assist.js';
import { yourDatabaseStatus, type YourDatabaseStatus } from '../src/project/your-database-state.js';
import { ALLOWED, makeScriptedClient, ordersSchema, validOrdersResponse, type ScriptedClient, type ScriptStep } from './llm-fixtures.js';
import { makeEnv } from './helpers.js';
import { META_ENGINES, type MetaHandle } from './meta-dialects.js';

const testCrypto: DsnCrypto = {
  encrypt: (plaintext) => `enc:test:${Buffer.from(plaintext, 'utf8').toString('base64')}`,
  decrypt: (token) => Buffer.from(token.slice('enc:test:'.length), 'base64').toString('utf8'),
};
const keyCrypto: LlmKeyCrypto = {
  encrypt: (plaintext) => `enc:${plaintext}`,
  decrypt: (token) => (token.startsWith('enc:') ? token.slice('enc:'.length) : token),
};

const NOTES_RAW = 'orders.status: 1 = paid, 2 = shipped. Admin login postgres://ava:hunter2@db.acme.io:5432/shop password=hunter2';

describe('cleanNotes: what of the owner’s notes reaches a model', () => {
  it('takes out connection strings, passwords and addresses, and keeps the words', () => {
    const cleaned = cleanNotes(NOTES_RAW);
    expect(cleaned).toContain('orders.status: 1 = paid, 2 = shipped.');
    expect(cleaned).not.toContain('hunter2');
    expect(cleaned).not.toContain('db.acme.io');
    expect(cleanNotes('the box is at 203.0.113.7:5432 and db.example.com:6543')).not.toMatch(/203\.0\.113\.7|db\.example\.com/);
  });

  it('drops control characters but a line break and a tab, and caps at 2,000 characters', () => {
    expect(cleanNotes('a\u0000b\u001bc\td\r\ne')).toBe('abc\td\ne');
    expect([...(cleanNotes('é'.repeat(YOUR_DATABASE_NOTES_MAX_CHARS + 50)) ?? '')]).toHaveLength(YOUR_DATABASE_NOTES_MAX_CHARS);
    expect(cleanNotes(' \u0007 ')).toBeNull();
  });
});

describe('hasOperatorBuildKey', () => {
  it('is the build key, or the compatible gateway with its address', () => {
    expect(hasOperatorBuildKey({ ADMINIUM_AI_BUILD_API_KEY: 'b' })).toBe(true);
    expect(hasOperatorBuildKey({ ADMINIUM_AI_COMPATIBLE_API_KEY: 'k', ADMINIUM_AI_COMPATIBLE_BASE_URL: 'https://gw.example.com/v1' })).toBe(true);
    expect(hasOperatorBuildKey({ ADMINIUM_AI_COMPATIBLE_API_KEY: 'k' })).toBe(false);
    expect(hasOperatorBuildKey({})).toBe(false);
  });
});

describe('noAppTables: no app or add-on makes tables on `yours`', () => {
  const plan = { create: [{ ref: 'shop_orders' }] } as unknown as InstallPlan;
  const manifest = { key: 'shop' } as unknown as Manifest;
  const managerWith = (projectKey: string | null, operatorProject = true) =>
    ({ operatorProject, mustFind: async () => ({ id: 'conn_1', name: 'Yours', projectKey, readOnly: false, canDdl: true }) }) as unknown as ConnectionManager;

  it('refuses by the key alone in an operator project, before any other check', async () => {
    expect(() => assertNoAppTables({ projectKey: YOURS_KEY, name: 'Yours' }, ['shop_orders'], true)).toThrow(/do not make or change tables in your own database/);
    await expect(applyPlanTo({ meta: {} as MetaDb, manager: managerWith(YOURS_KEY) }, 'conn_1', plan, manifest)).rejects.toMatchObject({
      statusCode: 403,
      details: { code: 'NO_APP_TABLES', tables: ['shop_orders'] },
    });
  });

  it('lets every other database be, and a plan that makes nothing', () => {
    expect(() => assertNoAppTables({ projectKey: 'main', name: 'Main' }, ['shop_orders'], true)).not.toThrow();
    expect(() => assertNoAppTables({ projectKey: null, name: 'Shop' }, ['shop_orders'], true)).not.toThrow();
    expect(() => assertNoAppTables({ projectKey: YOURS_KEY, name: 'Yours' }, [], true)).not.toThrow();
  });

  it('a self-hosted project (no operator project) that names its own database `yours` is not held', async () => {
    expect(() => assertNoAppTables({ projectKey: YOURS_KEY, name: 'Yours' }, ['shop_orders'], false)).not.toThrow();
    // Past the guard, the install goes on to its next check (here: a meta store that is not there).
    const past = await applyPlanTo({ meta: {} as MetaDb, manager: managerWith(YOURS_KEY, false) }, 'conn_1', plan, manifest).catch((error: unknown) => error as { details?: { code?: string } });
    expect(past?.details?.code).not.toBe('NO_APP_TABLES');
  });
});

describe('the run service’s assist.finished', () => {
  const events: AssistFinishedEvent[] = [];
  const report = assistEndedReporter({
    projectKeyOf: async (connectionId) => (connectionId === 'con_yours' ? YOURS_KEY : connectionId === 'con_gone' ? null : 'main'),
    assistFinished: (event) => events.push(event),
  });
  const run = { id: 'run_1', connectionId: 'con_main', status: 'applied' as const, tokensIn: 900, tokensOut: 200, createdBy: 'usr_1' };
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  it('one per run that ends, with `notes` for a run on yours', async () => {
    events.length = 0;
    report(run);
    report({ ...run, id: 'run_2', connectionId: 'con_yours', status: 'failed' });
    report({ ...run, id: 'run_3', connectionId: 'con_gone', status: 'discarded' });
    report({ ...run, id: 'run_4', status: 'validated' as never });
    await settle();
    expect(events).toEqual([
      { runId: 'run_1', connectionId: 'con_main', status: 'applied', tokens: 1100, notes: false },
      { runId: 'run_2', connectionId: 'con_yours', status: 'failed', tokens: 1100, notes: true },
      { runId: 'run_3', connectionId: 'con_gone', status: 'discarded', tokens: 1100, notes: false },
    ]);
  });

  it('none for the notes run’s own tries (on yours, started by nobody): the notes run says how it ended', async () => {
    events.length = 0;
    report({ ...run, connectionId: 'con_yours', createdBy: null, status: 'failed', tokensIn: null, tokensOut: null });
    report({ ...run, connectionId: 'con_yours', createdBy: null });
    await settle();
    expect(events).toEqual([]);
  });
});

describe('whether a record says the run happened', () => {
  const base = { runId: 'r', connectionId: 'c', at: 1, counts: null, undo: null, reason: null };
  it('anything but none, a wait, or a run that could not be made', () => {
    expect(ranBefore(null)).toBe(false);
    expect(ranBefore({ ...base, state: 'waiting', reason: 'busy' })).toBe(false);
    expect(ranBefore({ ...base, state: 'failed', reason: 'no-model' })).toBe(false);
    for (const state of ['running', 'applied', 'undone', 'interrupted'] as const) expect(ranBefore({ ...base, state })).toBe(true);
    for (const reason of ['provider', 'invalid', 'apply']) expect(ranBefore({ ...base, state: 'failed', reason })).toBe(true);
  });
});

describe('how long a run refused by the operator’s AI waits', () => {
  it('the Retry-After it was given, at least 5 s; 30 s when it said nothing', () => {
    expect(waitFor(30_000, 0)).toEqual({ ms: 30_000, reason: 'busy', short: true });
    expect(waitFor(0, 0)).toEqual({ ms: 5_000, reason: 'busy', short: true });
    expect(waitFor(undefined, 0)).toEqual({ ms: 30_000, reason: 'busy', short: true });
  });

  it('a longer one is the daily cap, and too many in a row are a busy server: 15 minutes either way', () => {
    // The gateway's cap says "until midnight UTC".
    expect(waitFor(6 * 3_600_000, 0)).toEqual({ ms: YOURS_ASSIST_CAP_WAIT_MS, reason: 'cap', short: false });
    expect(waitFor(30_000, 10)).toEqual({ ms: YOURS_ASSIST_CAP_WAIT_MS, reason: 'busy', short: false });
    expect(YOURS_ASSIST_CAP_WAIT_MS).toBe(15 * 60_000);
  });

  it('only a 429 before any answer is a refusal; a run the model answered keeps its tally', () => {
    const refused = { status: 'failed' as const, tokensIn: null, tokensOut: null, chunksReceived: 0, validationErrors: [{ kind: 'provider', code: 'rate_limit', retryAfterMs: 30_000 }] };
    expect(refusedBeforeAnswer(refused)).toEqual({ retryAfterMs: 30_000 });
    expect(refusedBeforeAnswer({ ...refused, validationErrors: [{ kind: 'provider', code: 'rate_limit' }] })).toEqual({ retryAfterMs: undefined });
    expect(refusedBeforeAnswer({ ...refused, chunksReceived: 1 })).toBeNull();
    expect(refusedBeforeAnswer({ ...refused, tokensIn: 900 })).toBeNull();
    expect(refusedBeforeAnswer({ ...refused, validationErrors: [{ kind: 'provider', code: 'server' }] })).toBeNull();
    expect(refusedBeforeAnswer({ ...refused, validationErrors: [] })).toBeNull();
    expect(refusedBeforeAnswer({ ...refused, status: 'validated' as never })).toBeNull();
  });
});

/** The operator gateway's answer when the server's build slots are full (adminium-app `lib/ai.ts`). */
const busy = (retryAfterMs?: number): ScriptStep => ({
  throw: new ProviderError({
    provider: 'openai-compatible',
    code: 'rate_limit',
    status: 429,
    message: 'openai-compatible: HTTP 429 — Other builds are running on this server. This one starts in a moment.',
    ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
  }),
});

async function until<T>(read: () => Promise<T>, done: (value: T) => boolean, ms = 10_000): Promise<T> {
  const deadline = Date.now() + ms;
  let value = await read();
  while (!done(value) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    value = await read();
  }
  return value;
}

for (const engine of META_ENGINES) {
  describe.skipIf(!engine.available)(`yours-assist on ${engine.name}`, () => {
    // One database per engine (a fresh one per test costs MySQL its migrations each time); each test starts clean.
    let handle: MetaHandle | null = null;
    let connectionId = '';
    beforeAll(async () => {
      if (!engine.available) return;
      handle = await engine.make();
      const connection = await connectionsRepo(handle.meta, testCrypto).create({
        name: 'Harbor books',
        engine: 'postgres',
        introspectDsn: 'postgres://ro@db.acme.io/shop',
        projectKey: YOURS_KEY,
      });
      connectionId = connection.id;
      await snapshotsRepo(handle.meta).create({ connectionId, source: 'introspection', schema: ordersSchema, checksum: 'sha-yours-1' });
      const settings = settingsRepo(handle.meta);
      await settings.set('llm.provider', 'anthropic');
      await settings.set('llm.apiKey', keyCrypto.encrypt('sk-test'));
      await settings.set('llm.model', 'claude-x');
    }, 600_000);
    afterAll(async () => {
      await handle?.destroy();
      handle = null;
    });

    interface Fixture {
      meta: MetaDb;
      status: YourDatabaseStatus;
      connectionId: string;
      scripted: ScriptedClient;
      deps: YoursAssistDeps;
      finished: unknown[];
    }

    async function fixture(opts: { owner?: boolean; key?: boolean; ready?: boolean; script?: readonly ScriptStep[]; client?: ProviderClient } = {}): Promise<Fixture> {
      const meta = handle!.meta;
      // A clean slate: no claim, no wait, no record, no owner; what earlier runs applied is left (the run re-applies over it).
      await operatorTalliesRepo(meta).release(YOURS_ASSIST_TALLY);
      await operatorTalliesRepo(meta).release(YOURS_ASSIST_WAIT_TALLY);
      await settingsRepo(meta).set('llm.yoursAssist', null);
      await meta.db.deleteFrom('adminium_users').execute();
      if (opts.owner !== false) await usersRepo(meta).create({ email: 'owner@adminium.test', name: 'Owner' });

      const scripted = makeScriptedClient(opts.script ?? [{ text: validOrdersResponse(), usage: { inputTokens: 900, outputTokens: 200 } }]);
      const client = opts.client ?? scripted.client;
      const runService = createRunService({ meta });
      const status = yourDatabaseStatus();
      if (opts.ready !== false) status.set({ state: 'ready', reason: null, host: 'db.acme.io', label: 'Harbor books', readOnly: false });
      const finished: unknown[] = [];
      const deps: YoursAssistDeps = {
        meta,
        yoursConnectionId: async () => connectionId,
        notes: cleanNotes(NOTES_RAW),
        operatorKey: opts.key !== false,
        status,
        promptService: createPromptService({ meta, runService, allowed: ALLOWED, defaultModel: async () => ({ provider: 'anthropic', model: 'claude-x' }) }),
        runService,
        applyService: createApplyService({ meta, runService }),
        resolve: createProviderResolver({ meta, keyCrypto, allowedTemplates: ALLOWED.templates, allowedWidgets: ALLOWED.widgets, createClient: () => client }),
        onFinished: (outcome) => finished.push(outcome),
      };
      return { meta, status, connectionId, scripted, deps, finished };
    }

    it('runs once with the cleaned notes, applies, keeps an undo, and never runs again', async () => {
      const f = await fixture();
      const assist = createYoursAssist(f.deps);
      const first = await assist.maybeStart();
      expect(first.started).toBe(true);
      const outcome = first.started ? await first.done : null;
      expect(outcome).toMatchObject({ state: 'applied', connectionId: f.connectionId, tokens: 1100 });

      // The notes reached the model as data, cleaned.
      const user = f.scripted.calls[0]?.messages.map((message) => message.content).join('\n') ?? '';
      expect(user).toContain('OWNER_NOTES_JSON:');
      expect(user).toContain('orders.status: 1 = paid, 2 = shipped.');
      expect(user).not.toContain('hunter2');

      const held = await settingsRepo(f.meta).get('llm.yoursAssist');
      expect(held).toMatchObject({ state: 'applied', connectionId: f.connectionId });
      expect(held?.undo).not.toBeNull();
      expect(f.finished).toHaveLength(1);

      // Once for the instance's life: a second call, a second process, never runs it again.
      expect(await assist.maybeStart()).toEqual({ started: false, reason: 'taken' });
      expect(await createYoursAssist(f.deps).maybeStart()).toEqual({ started: false, reason: 'taken' });
      expect(f.scripted.calls).toHaveLength(1);

      // The owner can undo it later, once.
      const undone = await undoYoursAssist(f.meta, f.deps.applyService as ReturnType<typeof createApplyService>);
      expect(undone?.state).toBe('undone');
      expect(await undoYoursAssist(f.meta, f.deps.applyService as ReturnType<typeof createApplyService>)).toBeNull();
    });

    it('with no operator key: no run, and the tally left for a later boot with one', async () => {
      const f = await fixture({ key: false });
      expect(await createYoursAssist(f.deps).maybeStart()).toEqual({ started: false, reason: 'no-key' });
      expect(await operatorTalliesRepo(f.meta).get(YOURS_ASSIST_TALLY)).toBeNull();
      expect(f.scripted.calls).toHaveLength(0);

      const later = await createYoursAssist({ ...f.deps, operatorKey: true }).maybeStart();
      expect(later.started).toBe(true);
      if (later.started) expect((await later.done).state).toBe('applied');
    });

    it('waits for the owner’s account and for the database to be ready, then starts by itself', async () => {
      const f = await fixture({ owner: false, ready: false });
      const assist = createYoursAssist(f.deps);
      expect(await assist.maybeStart()).toEqual({ started: false, reason: 'not-ready' });
      f.status.set({ state: 'ready', reason: null, host: 'db.acme.io', label: 'Harbor books', readOnly: false });
      expect(await assist.maybeStart()).toEqual({ started: false, reason: 'no-owner' });
      expect(await operatorTalliesRepo(f.meta).get(YOURS_ASSIST_TALLY)).toBeNull();

      await usersRepo(f.meta).create({ email: 'owner@adminium.test', name: 'Owner' });
      const stop = assist.watch();
      try {
        // `watch` checks once at once; wait for the run it started to land.
        for (let i = 0; i < 100 && (await settingsRepo(f.meta).get('llm.yoursAssist'))?.state !== 'applied'; i += 1) await new Promise((resolve) => setTimeout(resolve, 20));
        expect((await settingsRepo(f.meta).get('llm.yoursAssist'))?.state).toBe('applied');
      } finally {
        stop();
      }
    });

    it('a 429 before any answer: the tally goes back, it waits, then runs once and applies', async () => {
      const valid = { text: validOrdersResponse(), usage: { inputTokens: 900, outputTokens: 200 } };
      const f = await fixture({ script: [busy(60), valid] });
      const assist = createYoursAssist({ ...f.deps, waits: { minMs: 10 } });
      try {
        const before = Date.now();
        const first = await assist.maybeStart();
        expect(first.started).toBe(true);
        expect(first.started ? await first.done : null).toMatchObject({ state: 'waiting', reason: 'busy', tokens: 0 });

        // Nothing kept, the time said, nobody told it finished.
        const tallies = operatorTalliesRepo(f.meta);
        expect(await tallies.get(YOURS_ASSIST_TALLY)).toBeNull();
        const held = await settingsRepo(f.meta).get('llm.yoursAssist');
        expect(held).toMatchObject({ state: 'waiting', reason: 'busy', connectionId: f.connectionId });
        expect(held?.until).toBeGreaterThanOrEqual(before + 60);
        expect(held?.until).toBeLessThan(Date.now() + 60 + 1_000);
        expect((await tallies.get(YOURS_ASSIST_WAIT_TALLY))?.amount).toBe(held?.until);
        expect(f.finished).toHaveLength(0);

        // Asked again before its time: it waits, it does not call.
        expect(await assist.maybeStart()).toEqual({ started: false, reason: 'waiting' });
        expect(f.scripted.calls).toHaveLength(1);

        // At its time it starts again by itself, and applies.
        const done = await until(() => settingsRepo(f.meta).get('llm.yoursAssist'), (value) => value?.state === 'applied');
        expect(done).toMatchObject({ state: 'applied', connectionId: f.connectionId });
        expect(f.scripted.calls).toHaveLength(2);
        expect((await tallies.get(YOURS_ASSIST_TALLY))?.amount).toBe(1);
        expect(await tallies.get(YOURS_ASSIST_WAIT_TALLY)).toBeNull();
        expect(f.finished).toEqual([expect.objectContaining({ state: 'applied', tokens: 1100 })]);
        expect(await assist.maybeStart()).toEqual({ started: false, reason: 'taken' });
      } finally {
        assist.stop();
      }
    });

    it('one assist.finished per notes run, however many tries it waited for', async () => {
      const valid = { text: validOrdersResponse(), usage: { inputTokens: 900, outputTokens: 200 } };
      const f = await fixture({ script: [busy(30), busy(30), valid] });
      // Wired as compose wires the operator's events: the run service's end listener, and the notes run's own end.
      const events: AssistFinishedEvent[] = [];
      const connections = connectionsRepo(f.meta, testCrypto);
      const stopEnded = f.deps.runService.onEnded(
        assistEndedReporter({ projectKeyOf: async (id) => (await connections.findById(id))?.projectKey ?? null, assistFinished: (event) => events.push(event) }),
      );
      const assist = createYoursAssist({
        ...f.deps,
        waits: { minMs: 10 },
        onFinished: (outcome) => events.push({ runId: outcome.runId ?? 'none', connectionId: outcome.connectionId, status: outcome.state === 'applied' ? 'applied' : 'failed', tokens: outcome.tokens, notes: true }),
      });
      try {
        await assist.maybeStart();
        await until(() => settingsRepo(f.meta).get('llm.yoursAssist'), (value) => value?.state === 'applied');
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(f.scripted.calls).toHaveLength(3);
        expect(events).toEqual([expect.objectContaining({ status: 'applied', tokens: 1100, notes: true })]);
      } finally {
        stopEnded();
        assist.stop();
      }
    });

    it('a 429 forever: no tally kept, waiting, and the short tries bounded (no tight loop)', async () => {
      const f = await fixture({ script: [busy(20)] });
      const assist = createYoursAssist({ ...f.deps, waits: { minMs: 0, shortTries: 2 } });
      try {
        const first = await assist.maybeStart();
        expect(first.started).toBe(true);
        // Two short waits, then the third refusal waits the long wait.
        const held = await until(() => settingsRepo(f.meta).get('llm.yoursAssist'), (value) => (value?.until ?? 0) > Date.now() + 10 * 60_000);
        expect(held).toMatchObject({ state: 'waiting', reason: 'busy' });
        expect(held?.until).toBeLessThanOrEqual(Date.now() + YOURS_ASSIST_CAP_WAIT_MS);
        expect(f.scripted.calls).toHaveLength(3);
        await new Promise((resolve) => setTimeout(resolve, 300));
        expect(f.scripted.calls).toHaveLength(3);
        expect(await operatorTalliesRepo(f.meta).get(YOURS_ASSIST_TALLY)).toBeNull();
        expect(f.finished).toHaveLength(0);
      } finally {
        assist.stop();
      }
    });

    it('at the operator’s daily cap it waits 15 minutes, and a boot meanwhile starts it again at its time', async () => {
      const valid = { text: validOrdersResponse(), usage: { inputTokens: 900, outputTokens: 200 } };
      const f = await fixture({ script: [busy(6 * 3_600_000), valid] });
      const first = createYoursAssist(f.deps);
      const started = await first.maybeStart();
      expect(started.started ? await started.done : null).toMatchObject({ state: 'waiting', reason: 'cap' });
      first.stop();
      const held = await settingsRepo(f.meta).get('llm.yoursAssist');
      expect(held?.until).toBeGreaterThan(Date.now() + YOURS_ASSIST_CAP_WAIT_MS - 60_000);
      expect(held?.until).toBeLessThanOrEqual(Date.now() + YOURS_ASSIST_CAP_WAIT_MS);

      // A restart before its time: it waits.
      const booted = createYoursAssist(f.deps);
      expect(await booted.maybeStart()).toEqual({ started: false, reason: 'waiting' });
      booted.stop();
      expect(f.scripted.calls).toHaveLength(1);

      // A restart after it: it runs.
      const tallies = operatorTalliesRepo(f.meta);
      await tallies.release(YOURS_ASSIST_WAIT_TALLY);
      await tallies.raise(YOURS_ASSIST_WAIT_TALLY, Date.now() - 1_000);
      const later = await createYoursAssist(f.deps).maybeStart();
      expect(later.started ? await later.done : null).toMatchObject({ state: 'applied' });
      expect(await tallies.get(YOURS_ASSIST_WAIT_TALLY)).toBeNull();
    });

    it('a real gateway’s 429 with Retry-After: 30 waits 30 seconds', async () => {
      let asked = 0;
      const gateway: Server = createServer((request, response) => {
        asked += 1;
        request.resume();
        response.writeHead(429, { 'content-type': 'application/json', 'retry-after': '30' });
        response.end(JSON.stringify({ error: { message: 'Other builds are running on this server. This one starts in a moment.', type: 'rate_limit_exceeded' } }));
      });
      await new Promise<void>((resolve) => gateway.listen(0, '127.0.0.1', resolve));
      const port = (gateway.address() as AddressInfo).port;
      const client = createProviderClient({ provider: 'openai-compatible', apiKey: 'sk-operator', baseUrl: `http://127.0.0.1:${String(port)}/v1` });
      const f = await fixture({ client });
      const assist = createYoursAssist(f.deps);
      try {
        const before = Date.now();
        const started = await assist.maybeStart();
        expect(started.started ? await started.done : null).toMatchObject({ state: 'waiting', reason: 'busy', tokens: 0 });
        expect(asked).toBe(1);
        const held = await settingsRepo(f.meta).get('llm.yoursAssist');
        expect(held?.until).toBeGreaterThanOrEqual(before + 30_000);
        expect(held?.until).toBeLessThan(Date.now() + 31_000);
        expect(await operatorTalliesRepo(f.meta).get(YOURS_ASSIST_TALLY)).toBeNull();
      } finally {
        assist.stop();
        await new Promise<void>((resolve) => gateway.close(() => resolve()));
      }
    });

    it('restored from an archive (the record back, the tally not): it ran, and it does not run again', async () => {
      const f = await fixture();
      const settings = settingsRepo(f.meta);
      const tallies = operatorTalliesRepo(f.meta);
      const at = Date.now();
      for (const state of ['applied', 'undone', 'interrupted', 'running'] as const) {
        await tallies.release(YOURS_ASSIST_TALLY);
        await settings.set('llm.yoursAssist', { state, runId: 'run_before', connectionId: f.connectionId, at, counts: null, undo: null, reason: null });
        expect(await createYoursAssist(f.deps).maybeStart()).toEqual({ started: false, reason: 'taken' });
        expect((await tallies.get(YOURS_ASSIST_TALLY))?.amount).toBe(1);
      }
      // One archived mid-run is said to have stopped.
      expect((await settings.get('llm.yoursAssist'))?.state).toBe('interrupted');
      // One the model answered and that failed: the operator paid for it, so it is taken too.
      await tallies.release(YOURS_ASSIST_TALLY);
      await settings.set('llm.yoursAssist', { state: 'failed', runId: 'run_before', connectionId: f.connectionId, at, counts: null, undo: null, reason: 'invalid' });
      expect(await createYoursAssist(f.deps).maybeStart()).toEqual({ started: false, reason: 'taken' });
      expect(f.scripted.calls).toHaveLength(0);

      // A wait (nothing spent) restored: it waits for its time, then runs.
      await tallies.release(YOURS_ASSIST_TALLY);
      await settings.set('llm.yoursAssist', { state: 'waiting', runId: 'run_before', connectionId: f.connectionId, at, counts: null, undo: null, reason: 'busy', until: at + 30_000 });
      const ahead = createYoursAssist(f.deps);
      expect(await ahead.maybeStart()).toEqual({ started: false, reason: 'waiting' });
      ahead.stop();
      await settings.set('llm.yoursAssist', { state: 'waiting', runId: 'run_before', connectionId: f.connectionId, at, counts: null, undo: null, reason: 'busy', until: at - 1 });
      const waited = await createYoursAssist(f.deps).maybeStart();
      expect(waited.started ? await waited.done : null).toMatchObject({ state: 'applied' });
      expect(f.scripted.calls).toHaveLength(1);
    });

    it('a stop between the wait’s record and its tallies: the record says when, and the run is not lost', async () => {
      const f = await fixture();
      const settings = settingsRepo(f.meta);
      const tallies = operatorTalliesRepo(f.meta);
      const at = Date.now();
      // Written: the record. Not yet: the wait's tally, and the run's tally given back.
      await tallies.claim(YOURS_ASSIST_TALLY);
      await settings.set('llm.yoursAssist', { state: 'waiting', runId: 'run_before', connectionId: f.connectionId, at, counts: null, undo: null, reason: 'busy', until: at + 60_000 });
      const early = createYoursAssist(f.deps);
      expect(await early.maybeStart()).toEqual({ started: false, reason: 'waiting' });
      early.stop();
      expect(f.scripted.calls).toHaveLength(0);

      // Its time over: the tally is given back and it runs, once.
      await settings.set('llm.yoursAssist', { state: 'waiting', runId: 'run_before', connectionId: f.connectionId, at, counts: null, undo: null, reason: 'busy', until: at - 1 });
      const due = await createYoursAssist(f.deps).maybeStart();
      expect(due.started ? await due.done : null).toMatchObject({ state: 'applied' });
      expect(f.scripted.calls).toHaveLength(1);
      expect((await tallies.get(YOURS_ASSIST_TALLY))?.amount).toBe(1);
    });

    it('gives the tally back when no run could be made (no model)', async () => {
      const f = await fixture();
      const result = await createYoursAssist({ ...f.deps, promptService: createPromptService({ meta: f.meta, runService: f.deps.runService, allowed: ALLOWED, defaultModel: async () => null }) }).maybeStart();
      expect(result.started).toBe(true);
      if (result.started) expect(await result.done).toMatchObject({ state: 'failed', reason: 'no-model' });
      expect(await operatorTalliesRepo(f.meta).get(YOURS_ASSIST_TALLY)).toBeNull();
    });
  });
}

describe('GET /llm/yours-assist while it waits', () => {
  it('says waiting, with the time it starts again', async () => {
    const meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
    await firstRun(meta);
    const roles = rolesRepo(meta);
    const adminRole = await roles.findBySlug('admin');
    const admin = await usersRepo(meta).create({ email: 'owner@adminium.test', name: 'Owner', passwordHash: 'test-hash', status: 'active' });
    await roles.assignToUser(admin.id, adminRole!.id);
    const runService = createRunService({ meta });
    const app = await buildServer({ env: makeEnv(), logger: false });
    app.addHook('onRequest', async (request) => {
      if (request.headers['x-test-user-id'] === admin.id) (request as unknown as { user: unknown }).user = { id: admin.id, name: admin.name, email: admin.email };
    });
    await app.register(rbacPlugin, { meta });
    await app.register(async (api) => api.register(llmRoutes({ meta, runService, applyService: createApplyService({ meta, runService }), keyCrypto, allowed: ALLOWED })), { prefix: '/api/v1' });
    await app.ready();
    try {
      const at = Date.now();
      await settingsRepo(meta).set('llm.yoursAssist', { state: 'waiting', runId: 'run_1', connectionId: 'conn_1', at, counts: null, undo: null, reason: 'busy', until: at + 30_000 });
      const waiting = await app.inject({ method: 'GET', url: '/api/v1/llm/yours-assist', headers: { 'x-test-user-id': admin.id } });
      expect(waiting.statusCode, waiting.body).toBe(200);
      expect(waiting.json()).toEqual({ assist: { state: 'waiting', runId: 'run_1', connectionId: 'conn_1', at, counts: null, reason: 'busy', until: at + 30_000, undoable: false } });

      // A record from before `until` existed, and every other state: null.
      await settingsRepo(meta).set('llm.yoursAssist', { state: 'failed', runId: 'run_1', connectionId: 'conn_1', at, counts: null, undo: null, reason: 'provider' });
      const failed = await app.inject({ method: 'GET', url: '/api/v1/llm/yours-assist', headers: { 'x-test-user-id': admin.id } });
      expect(failed.json()).toMatchObject({ assist: { state: 'failed', until: null } });
    } finally {
      await app.close();
      await meta.db.destroy();
    }
  });
});
