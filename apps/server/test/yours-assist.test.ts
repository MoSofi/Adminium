// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Build box W4: the schema assistant's one run on the user's own database (`llm/yours-assist.ts`), the notes it
 * reads (`config/your-database.ts` `cleanNotes`, `POST /llm/runs` `notes`), and the key-based guard that keeps
 * app and add-on tables off `yours` (`connections/no-app-tables.ts`).
 *
 * On every meta engine (SQLite always; Postgres and MySQL with TEST_POSTGRES_URL / TEST_MYSQL_URL): the claim is a
 * row in `adminium_operator_tallies`, the record and its undo image a JSON setting, and the apply a transaction.
 */
import { connectionsRepo, operatorTalliesRepo, settingsRepo, snapshotsRepo, usersRepo, type DsnCrypto, type MetaDb } from '@adminium/meta';
import { type LlmKeyCrypto } from '@adminium/llm';
import type { InstallPlan, Manifest } from '@adminium/manifest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { applyPlanTo } from '../src/add-ons/schema-target.js';
import { assertNoAppTables, YOURS_KEY } from '../src/connections/no-app-tables.js';
import { cleanNotes, YOUR_DATABASE_NOTES_MAX_CHARS } from '../src/config/your-database.js';
import type { ConnectionManager } from '../src/connections/manager.js';
import { createApplyService } from '../src/llm/apply-service.js';
import { createPromptService } from '../src/llm/prompt-service.js';
import { createProviderResolver } from '../src/llm/provider-resolver.js';
import { createRunService } from '../src/llm/run-service.js';
import { createYoursAssist, hasOperatorBuildKey, undoYoursAssist, YOURS_ASSIST_TALLY, type YoursAssistDeps } from '../src/llm/yours-assist.js';
import { yourDatabaseStatus, type YourDatabaseStatus } from '../src/project/your-database-state.js';
import { ALLOWED, makeScriptedClient, ordersSchema, validOrdersResponse, type ScriptedClient } from './llm-fixtures.js';
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
  const managerWith = (projectKey: string | null) =>
    ({ mustFind: async () => ({ id: 'conn_1', name: 'Yours', projectKey, readOnly: false, canDdl: true }) }) as unknown as ConnectionManager;

  it('refuses by the key alone, before any other check', async () => {
    expect(() => assertNoAppTables({ projectKey: YOURS_KEY, name: 'Yours' }, ['shop_orders'])).toThrow(/do not make or change tables in your own database/);
    await expect(applyPlanTo({ meta: {} as MetaDb, manager: managerWith(YOURS_KEY) }, 'conn_1', plan, manifest)).rejects.toMatchObject({
      statusCode: 403,
      details: { code: 'NO_APP_TABLES', tables: ['shop_orders'] },
    });
  });

  it('lets every other database be, and a plan that makes nothing', () => {
    expect(() => assertNoAppTables({ projectKey: 'main', name: 'Main' }, ['shop_orders'])).not.toThrow();
    expect(() => assertNoAppTables({ projectKey: null, name: 'Shop' }, ['shop_orders'])).not.toThrow();
    expect(() => assertNoAppTables({ projectKey: YOURS_KEY, name: 'Yours' }, [])).not.toThrow();
  });
});

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

    async function fixture(opts: { owner?: boolean; key?: boolean; ready?: boolean } = {}): Promise<Fixture> {
      const meta = handle!.meta;
      // A clean slate: no claim, no record, no owner; what earlier runs applied is left (the run re-applies over it).
      await operatorTalliesRepo(meta).release(YOURS_ASSIST_TALLY);
      await settingsRepo(meta).set('llm.yoursAssist', null);
      await meta.db.deleteFrom('adminium_users').execute();
      if (opts.owner !== false) await usersRepo(meta).create({ email: 'owner@adminium.test', name: 'Owner' });

      const scripted = makeScriptedClient([{ text: validOrdersResponse(), usage: { inputTokens: 900, outputTokens: 200 } }]);
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
        resolve: createProviderResolver({ meta, keyCrypto, allowedTemplates: ALLOWED.templates, allowedWidgets: ALLOWED.widgets, createClient: () => scripted.client }),
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

    it('gives the tally back when no run could be made (no model)', async () => {
      const f = await fixture();
      const result = await createYoursAssist({ ...f.deps, promptService: createPromptService({ meta: f.meta, runService: f.deps.runService, allowed: ALLOWED, defaultModel: async () => null }) }).maybeStart();
      expect(result.started).toBe(true);
      if (result.started) expect(await result.done).toMatchObject({ state: 'failed', reason: 'no-model' });
      expect(await operatorTalliesRepo(f.meta).get(YOURS_ASSIST_TALLY)).toBeNull();
    });
  });
}
