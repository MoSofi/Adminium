// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The assistant's HTTP surface and the job behind it.
 *
 * Three things are being proved here and nothing else needs an HTTP test.
 *
 * WHO MAY KNOCK. Every route needs `system:assistant:use`, and a session
 * belongs to the person who opened it. A viewer is refused at the door; an
 * admin cannot read a super admin's transcript.
 *
 * WHAT THE JOB DOES WITH A TURN. It claims the row once, runs the loop against
 * a scripted provider, and persists what came back — including a failure it
 * can explain and a base URL the outbound guard refuses to dial.
 *
 * WHAT A STORED ROW ANSWERS LATER. A `result` whose shape has moved on still
 * comes back 200 with that field dropped, because the route whose job is to
 * explain a failure must not itself be the failure.
 */

import BetterSqlite3 from 'better-sqlite3';
import { SqliteDialect } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  AdapterRegistry,
  adapterCapabilitiesSchema,
  parseDatabaseModel,
  type AdapterProvider,
  type DatabaseAdapter,
  type DatabaseModel,
} from '@adminium/engine/adapter';
import { ASSISTANT_SCHEMA_VERSION } from '@adminium/llm';
import {
  assistantSessionsRepo,
  emailTemplatesRepo,
  permissionsRepo,
  rolesRepo,
  settingsRepo,
} from '@adminium/meta';

import { executeAssistantTurn, INTERRUPTED_ERROR } from '../src/jobs/assistant-turn.js';
import { sweepAssistantSessions } from '../src/assistant/retention.js';
import { assistantRoutes } from '../src/routes/assistant/index.js';
import { readLlmConfig, writeLlmConfig } from '../src/routes/llm/config-service.js';
import { llmKeyCryptoFromSecret } from '@adminium/llm';
import { decryptSecret, deriveKey, encryptSecret } from '../src/config/secrets.js';
import { asUser, buildDataTestApp, type DataTestContext } from './connections-helpers.js';
import { makeScriptedClient, type ScriptStep } from './llm-fixtures.js';
import type { JobHandlerContext } from '../src/jobs/registry.js';

// --- a source, so a session has a connection to name -------------------------

function fakeModel(): DatabaseModel {
  return parseDatabaseModel({
    dialect: 'postgres',
    name: 'fakedb',
    defaultSchema: 'main',
    schemas: ['main'],
    tables: [
      {
        schema: 'main',
        name: 'orders',
        primaryKey: ['order_id'],
        columns: [
          { name: 'order_id', logicalType: 'integer', nullable: false, isPrimaryKey: true },
          { name: 'status', logicalType: 'varchar', nullable: true },
        ],
      },
    ],
    relations: [],
  });
}

function makeFakeRegistry(): AdapterRegistry<AdapterProvider> {
  const capabilities = adapterCapabilitiesSchema.parse({});
  const adapter = (role: string): DatabaseAdapter =>
    ({
      dialect: 'postgres',
      capabilities,
      role,
      connect: async () => undefined,
      test: async () => ({ ok: true, latencyMs: 1, serverVersion: 'F', currentUser: 'f', canWrite: true, ssl: false }),
      probeCapabilities: async () => ({
        capabilities,
        privileges: { canReadSchema: true, canRead: true, canWrite: true, canDDL: true },
        serverVersion: 'F',
        currentRole: { name: 'f', readOnly: false },
      }),
      introspect: async () => fakeModel(),
      count: async () => ({ value: 0, capped: false }),
      sample: async () => [],
      query: async () => ({ rows: [], columns: [] }),
      mutate: async () => ({ affected: 0, returning: null }),
      close: async () => undefined,
    }) as unknown as DatabaseAdapter;

  const registry = new AdapterRegistry<AdapterProvider>();
  registry.register({
    dialect: 'postgres',
    create: (config) => adapter(config.role) as never,
    createQueryEngine: () => ({
      dialect: new SqliteDialect({ database: new BetterSqlite3(':memory:') }),
      identifiers: { quote: (identifier: string) => `"${identifier}"`, maxLength: 63 },
      serializers: {},
      destroy: async () => undefined,
    }),
  });
  return registry;
}

// --- the suite ----------------------------------------------------------------

let t: DataTestContext;
const AT = 1_750_000_000_000;

/** A reply the turn contract accepts. */
function reply(move: Record<string, unknown>, say = 'Here you go.'): string {
  return JSON.stringify({ schema_version: ASSISTANT_SCHEMA_VERSION, say, ...move });
}

/** A job context with no worker behind it. */
function jobContext(overrides: Partial<JobHandlerContext> = {}): JobHandlerContext {
  return {
    jobId: 'job_test',
    kind: 'assistant.turn',
    attempt: 1,
    maxAttempts: 3,
    signal: new AbortController().signal,
    progress: () => undefined,
    log: () => undefined,
    ...overrides,
  };
}

/** Run one turn against a scripted provider, as the worker would. */
async function runTurn(
  turnId: string,
  script: readonly ScriptStep[],
  userId: string,
  overrides: Partial<JobHandlerContext> = {},
) {
  const scripted = makeScriptedClient(script);
  await executeAssistantTurn({ turnId, userId }, jobContext(overrides), {
    meta: t.meta,
    manager: t.manager,
    resolveClient: () =>
      Promise.resolve({ client: scripted.client, provider: 'anthropic', model: 'm', baseUrl: null }),
    can: () => Promise.resolve(true),
    now: () => AT,
  });
  return scripted;
}

async function openSession(user: 'admin' | 'viewer' = 'admin') {
  const res = await t.app.inject({
    method: 'POST',
    url: '/api/v1/assistant/sessions',
    headers: asUser(t.users[user]),
    payload: { context: 'email', host: { connectionIds: [] } },
  });
  return res;
}

beforeAll(async () => {
  t = await buildDataTestApp({
    registry: makeFakeRegistry(),
    extraRoutes: async (api, ctx) => {
      await api.register(
        assistantRoutes({
          meta: ctx.meta,
          manager: ctx.manager,
          networkFeatures: true,
          secret: null,
        }) as never,
      );
    },
  });
  // Admin is the role the assistant is seeded to; the built-in Admin does not
  // hold `settings.manage`, so the grant is added here for the action cases.
  const admin = await rolesRepo(t.meta).findBySlug('admin');
  await permissionsRepo(t.meta).grant(admin!.id, 'system', 'settings.manage', { allowed: true });
}, 60_000);

beforeEach(async () => {
  await settingsRepo(t.meta).set('llm.provider', 'anthropic');
});

afterAll(async () => {
  await t.app.close();
});

describe('who may knock', () => {
  it('refuses EVERY route to a role without the key', async () => {
    // The whole table, not a sample: a route added later without the guard is
    // exactly the mistake this case exists to catch.
    const routes: { method: 'GET' | 'POST'; url: string; payload?: Record<string, unknown> }[] = [
      { method: 'GET', url: '/api/v1/assistant/availability' },
      {
        method: 'POST',
        url: '/api/v1/assistant/sessions',
        payload: { context: 'email', host: { connectionIds: [] } },
      },
      { method: 'POST', url: '/api/v1/assistant/sessions/ast_x/turns', payload: { text: 'hi' } },
      { method: 'GET', url: '/api/v1/assistant/sessions/ast_x/turns/atn_x' },
      { method: 'POST', url: '/api/v1/assistant/sessions/ast_x/turns/atn_x/cancel' },
      {
        method: 'POST',
        url: '/api/v1/assistant/sessions/ast_x/turns/atn_x/actions',
        payload: { action: 'save' },
      },
      { method: 'POST', url: '/api/v1/assistant/sessions/ast_x/close' },
    ];
    for (const route of routes) {
      const res = await t.app.inject({
        method: route.method,
        url: route.url,
        headers: asUser(t.users.viewer),
        ...(route.payload === undefined ? {} : { payload: route.payload }),
      });
      // 403 and not 404: the guard runs before anything looks a session up, so
      // a viewer cannot learn which ids exist by the shape of the refusal.
      expect(res.statusCode, route.url).toBe(403);
    }
  });

  it('answers 404 for somebody else`s session, not 403', async () => {
    // Which of "no such session" and "not yours" it is, is not the asker's
    // business — and an id that answers differently is an id that enumerates.
    const opened = await openSession('admin');
    const id = (opened.json() as { session: { id: string } }).session.id;

    const editorRole = await rolesRepo(t.meta).findBySlug('editor');
    await permissionsRepo(t.meta).grant(editorRole!.id, 'system', 'assistant.use', { allowed: true });
    const res = await t.app.inject({
      method: 'GET',
      url: `/api/v1/assistant/sessions/${id}/turns/atn_x`,
      headers: asUser(t.users.editor),
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('availability', () => {
  it('says what the modal needs to draw its bars', async () => {
    const res = await t.app.inject({
      method: 'GET',
      url: '/api/v1/assistant/availability?context=email',
      headers: asUser(t.users.admin),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { enabled: boolean; name: string; rowData: boolean; canWrite: boolean };
    expect(body.enabled).toBe(true);
    expect(body.name).toBe('Milo');
    expect(body.rowData).toBe(true);
    expect(body.canWrite).toBe(true);
  });

  it('reports the name the workspace gave it, not the shipped default', async () => {
    // Settings → AI writes `assistant.name`; this reply is where the modal
    // header reads it on the next open, so a rename that stopped here would
    // show the old name for the rest of the session.
    await settingsRepo(t.meta).set('assistant.name', 'Ada');
    try {
      const res = await t.app.inject({
        method: 'GET',
        url: '/api/v1/assistant/availability?context=email',
        headers: asUser(t.users.admin),
      });
      expect((res.json() as { name: string }).name).toBe('Ada');
    } finally {
      await settingsRepo(t.meta).set('assistant.name', 'Milo');
    }
  });

  it('names the reason when no provider is configured', async () => {
    await settingsRepo(t.meta).set('llm.provider', null);
    const res = await t.app.inject({
      method: 'GET',
      url: '/api/v1/assistant/availability',
      headers: asUser(t.users.admin),
    });
    expect(res.json()).toMatchObject({ enabled: false, reason: 'no-provider' });
    // And a session cannot be opened into that state.
    expect((await openSession()).statusCode).toBe(409);
  });
});

describe('a session and its turns', () => {
  it('opens with the page`s facts and queues a turn as a job', async () => {
    const opened = await openSession();
    expect(opened.statusCode).toBe(201);
    const body = opened.json() as {
      session: { id: string; context: string };
      facts: { values: { templates?: number } };
      nextTurnTokens: number;
    };
    expect(body.session.context).toBe('email');
    // Facts, not a sentence — the page's own copy words them.
    expect(body.facts.values.templates).toBeTypeOf('number');
    expect(body.nextTurnTokens).toBeGreaterThan(0);

    const asked = await t.app.inject({
      method: 'POST',
      url: `/api/v1/assistant/sessions/${body.session.id}/turns`,
      headers: asUser(t.users.admin),
      payload: { text: 'Draft a welcome email' },
    });
    expect(asked.statusCode).toBe(202);
    const turn = asked.json() as { turn: { id: string; status: string; seq: number }; jobId: string };
    expect(turn.turn.status).toBe('queued');
    expect(turn.turn.seq).toBe(1);
    expect(turn.jobId).toBeTruthy();

    // One at a time: a second question over a running one would replay a
    // transcript that is still being written.
    const second = await t.app.inject({
      method: 'POST',
      url: `/api/v1/assistant/sessions/${body.session.id}/turns`,
      headers: asUser(t.users.admin),
      payload: { text: 'And another' },
    });
    expect(second.statusCode).toBe(409);
  });

  it('runs the turn and answers what it ended as', async () => {
    const opened = await openSession();
    const sessionId = (opened.json() as { session: { id: string } }).session.id;
    const asked = await t.app.inject({
      method: 'POST',
      url: `/api/v1/assistant/sessions/${sessionId}/turns`,
      headers: asUser(t.users.admin),
      payload: { text: 'Draft a welcome email' },
    });
    const turnId = (asked.json() as { turn: { id: string } }).turn.id;

    await runTurn(
      turnId,
      [
        {
          text: reply({
            result: {
              title: 'Welcome email',
              meta: 'template · 1 block',
              artefact: {
                kind: 'template',
                name: 'Welcome',
                locale: 'en_US',
                document: { subject: 'Welcome', blocks: [{ block: 'email.heading', data: { text: 'Hi' } }] },
              },
            },
          }),
          usage: { inputTokens: 400, outputTokens: 120 },
        },
      ],
      t.users.admin.id,
    );

    const read = await t.app.inject({
      method: 'GET',
      url: `/api/v1/assistant/sessions/${sessionId}/turns/${turnId}`,
      headers: asUser(t.users.admin),
    });
    expect(read.statusCode).toBe(200);
    const view = read.json() as { status: string; result: { title: string; diff: { adds: number } } | null };
    expect(view.status).toBe('done');
    expect(view.result?.title).toBe('Welcome email');
    // A new document: every line of the draft is an addition.
    expect(view.result?.diff.adds).toBeGreaterThan(0);

    // The session's running total moved by what the turn cost.
    const session = await assistantSessionsRepo(t.meta).findSession(sessionId);
    expect(session?.tokensIn).toBe(400);
    expect(session?.tokensOut).toBe(120);
  });

  it('records a failure the card can explain', async () => {
    const opened = await openSession();
    const sessionId = (opened.json() as { session: { id: string } }).session.id;
    const asked = await t.app.inject({
      method: 'POST',
      url: `/api/v1/assistant/sessions/${sessionId}/turns`,
      headers: asUser(t.users.admin),
      payload: { text: 'Draft something' },
    });
    const turnId = (asked.json() as { turn: { id: string } }).turn.id;

    await runTurn(turnId, [{ text: 'not json' }, { text: 'still not' }, { text: 'nope' }], t.users.admin.id);

    const read = await t.app.inject({
      method: 'GET',
      url: `/api/v1/assistant/sessions/${sessionId}/turns/${turnId}`,
      headers: asUser(t.users.admin),
    });
    const view = read.json() as { status: string; error: { kind: string; provider?: string; model?: string } | null };
    expect(view.status).toBe('failed');
    // Three replies nobody could read: it is the model that cannot do this, and the card can say which.
    expect(view.error).toMatchObject({ kind: 'model-format', provider: 'anthropic', model: 'm' });
  });

  it('records a draft the page kept refusing as that, not as the model`s format', async () => {
    const opened = await openSession();
    const sessionId = (opened.json() as { session: { id: string } }).session.id;
    const asked = await t.app.inject({
      method: 'POST',
      url: `/api/v1/assistant/sessions/${sessionId}/turns`,
      headers: asUser(t.users.admin),
      payload: { text: 'Draft something' },
    });
    const turnId = (asked.json() as { turn: { id: string } }).turn.id;
    // Readable every time, and never a document the email page accepts.
    const bad = reply({ result: { title: 'T', meta: '', artefact: { kind: 'template', name: 'x', locale: 'en_US', document: { blocks: [{ block: 'email.nonsense', data: {} }] } } } });
    await runTurn(turnId, [{ text: bad }], t.users.admin.id);
    const turn = await assistantSessionsRepo(t.meta).findTurn(turnId);
    expect(turn?.status).toBe('failed');
    expect(turn?.error).toMatchObject({ kind: 'validation' });
  });

  it('claims a turn once — a second worker leaves it alone', async () => {
    const opened = await openSession();
    const sessionId = (opened.json() as { session: { id: string } }).session.id;
    const asked = await t.app.inject({
      method: 'POST',
      url: `/api/v1/assistant/sessions/${sessionId}/turns`,
      headers: asUser(t.users.admin),
      payload: { text: 'Draft something' },
    });
    const turnId = (asked.json() as { turn: { id: string } }).turn.id;

    await runTurn(turnId, [{ text: reply({}, 'One.') }], t.users.admin.id);
    const second = await runTurn(turnId, [{ text: reply({}, 'Two.') }], t.users.admin.id);
    // The second run found the turn already terminal and dialled nobody.
    expect(second.calls).toHaveLength(0);
  });

  it('fails a turn whose run died with its process, when the job is claimed again', async () => {
    const opened = await openSession();
    const sessionId = (opened.json() as { session: { id: string } }).session.id;
    const asked = await t.app.inject({
      method: 'POST',
      url: `/api/v1/assistant/sessions/${sessionId}/turns`,
      headers: asUser(t.users.admin),
      payload: { text: 'Draft something' },
    });
    const turnId = (asked.json() as { turn: { id: string } }).turn.id;
    const repo = assistantSessionsRepo(t.meta);
    // The first attempt claimed the turn and never came back.
    await repo.setTurnStatus(turnId, 'running', { expected: 'queued', jobId: 'job_test' });

    // Another job finding it running is the race it always was: left alone.
    const other = await runTurn(turnId, [{ text: reply({}, 'No.') }], t.users.admin.id, { jobId: 'job_other', attempt: 2 });
    expect(other.calls).toHaveLength(0);
    expect((await repo.findTurn(turnId))?.status).toBe('running');

    const again = await runTurn(turnId, [{ text: reply({}, 'Again.') }], t.users.admin.id, { attempt: 2 });
    // Ended, not re-run: nobody was dialled a second time.
    expect(again.calls).toHaveLength(0);

    const read = await t.app.inject({
      method: 'GET',
      url: `/api/v1/assistant/sessions/${sessionId}/turns/${turnId}`,
      headers: asUser(t.users.admin),
    });
    const view = read.json() as { status: string; finishedAt: number | null; error: { kind: string; message: string } | null };
    expect(view.status).toBe('failed');
    expect(view.finishedAt).toBe(AT);
    expect(view.error).toEqual({ ...INTERRUPTED_ERROR });
  });

  it('leaves a finished turn alone when its job is claimed again', async () => {
    const opened = await openSession();
    const sessionId = (opened.json() as { session: { id: string } }).session.id;
    const asked = await t.app.inject({
      method: 'POST',
      url: `/api/v1/assistant/sessions/${sessionId}/turns`,
      headers: asUser(t.users.admin),
      payload: { text: 'Draft something' },
    });
    const turnId = (asked.json() as { turn: { id: string } }).turn.id;

    await runTurn(turnId, [{ text: reply({}, 'One.') }], t.users.admin.id);
    await runTurn(turnId, [{ text: reply({}, 'Two.') }], t.users.admin.id, { attempt: 2 });
    const turn = await assistantSessionsRepo(t.meta).findTurn(turnId);
    expect(turn?.status).toBe('done');
    expect(turn?.say).toBe('One.');
  });

  it('fails without dialling when the stored base URL is one the guard refuses', async () => {
    const keyCrypto = llmKeyCryptoFromSecret('a-sufficiently-long-test-secret-value', { deriveKey, encryptSecret, decryptSecret });
    const settings = settingsRepo(t.meta);
    await writeLlmConfig(
      settings,
      keyCrypto,
      { provider: 'openai-compatible', baseUrl: 'https://example.test/v1' },
      { updatedBy: null, at: AT },
    );
    // Planted the way an imported bundle or a direct settings write would: the
    // write-time guard never saw it, which is exactly why the resolver checks
    // again as it dials.
    await settings.set('llm.baseUrl', 'http://169.254.169.254/latest/meta-data');

    const opened = await openSession();
    const sessionId = (opened.json() as { session: { id: string } }).session.id;
    const asked = await t.app.inject({
      method: 'POST',
      url: `/api/v1/assistant/sessions/${sessionId}/turns`,
      headers: asUser(t.users.admin),
      payload: { text: 'Draft something' },
    });
    const turnId = (asked.json() as { turn: { id: string } }).turn.id;

    let dialled = false;
    await executeAssistantTurn({ turnId, userId: t.users.admin.id }, jobContext(), {
      meta: t.meta,
      manager: t.manager,
      // The real, GUARDED resolver.
      resolveClient: async () => {
        dialled = true;
        const { resolveProviderClient } = await import('../src/routes/llm/config-service.js');
        return resolveProviderClient(settings, keyCrypto);
      },
      can: () => Promise.resolve(true),
      now: () => AT,
    });

    const turn = await assistantSessionsRepo(t.meta).findTurn(turnId);
    expect(turn?.status).toBe('failed');
    expect(JSON.stringify(turn?.error)).toContain('config');
    // The resolver was reached and REFUSED; no client was ever built.
    expect(dialled).toBe(true);

    await settings.set('llm.baseUrl', null);
    await settings.set('llm.provider', 'anthropic');
  });
});

describe('a button on the result card', () => {
  /** Open a session, ask, run the turn, and hand back the ids. */
  async function draftedTurn(user: 'admin' | 'editor') {
    const opened = await t.app.inject({
      method: 'POST',
      url: '/api/v1/assistant/sessions',
      headers: asUser(t.users[user]),
      payload: { context: 'email', host: { connectionIds: [] } },
    });
    const sessionId = (opened.json() as { session: { id: string } }).session.id;
    const asked = await t.app.inject({
      method: 'POST',
      url: `/api/v1/assistant/sessions/${sessionId}/turns`,
      headers: asUser(t.users[user]),
      payload: { text: 'Draft a welcome email' },
    });
    const turnId = (asked.json() as { turn: { id: string } }).turn.id;
    await runTurn(
      turnId,
      [
        {
          text: reply({
            result: {
              title: 'Welcome email',
              meta: '',
              artefact: {
                kind: 'template',
                name: 'Route welcome',
                locale: 'en_US',
                document: { subject: 'Welcome', blocks: [{ block: 'email.heading', data: { text: 'Hi' } }] },
              },
            },
          }),
        },
      ],
      t.users[user].id,
    );
    return { sessionId, turnId };
  }

  it('saves the draft through the page`s own create, and says what it made', async () => {
    const { sessionId, turnId } = await draftedTurn('admin');
    const res = await t.app.inject({
      method: 'POST',
      url: `/api/v1/assistant/sessions/${sessionId}/turns/${turnId}/actions`,
      headers: asUser(t.users.admin),
      payload: { action: 'save', open: true },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { echo: { kind: string; open: boolean }; created: { id: string } | null };
    expect(body.echo).toMatchObject({ kind: 'saved', open: true });
    expect(body.created?.id).toBeTruthy();

    const row = await emailTemplatesRepo(t.meta).findById(body.created?.id ?? '');
    expect(row?.name).toBe('Route welcome');
    // A draft, like every save from here.
    expect(row?.enabled).toBe(false);
  });

  it('refuses the save to a role that holds the assistant key and not the page`s', async () => {
    // The ordinary case on a stock install: Admin can draft and preview, and
    // only Super Admin can save. Here the editor stands in for it.
    const { sessionId, turnId } = await draftedTurn('editor');
    const res = await t.app.inject({
      method: 'POST',
      url: `/api/v1/assistant/sessions/${sessionId}/turns/${turnId}/actions`,
      headers: asUser(t.users.editor),
      payload: { action: 'save' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('has nothing to act on when the turn produced no draft', async () => {
    const opened = await openSession();
    const sessionId = (opened.json() as { session: { id: string } }).session.id;
    const asked = await t.app.inject({
      method: 'POST',
      url: `/api/v1/assistant/sessions/${sessionId}/turns`,
      headers: asUser(t.users.admin),
      payload: { text: 'What is a campaign?' },
    });
    const turnId = (asked.json() as { turn: { id: string } }).turn.id;
    await runTurn(turnId, [{ text: reply({}, 'A campaign goes to a list.') }], t.users.admin.id);

    const res = await t.app.inject({
      method: 'POST',
      url: `/api/v1/assistant/sessions/${sessionId}/turns/${turnId}/actions`,
      headers: asUser(t.users.admin),
      payload: { action: 'save' },
    });
    expect(res.statusCode).toBe(422);
  });
});

describe('what a stored row answers later', () => {
  it('drops a result whose shape has moved on rather than 500ing', async () => {
    const opened = await openSession();
    const sessionId = (opened.json() as { session: { id: string } }).session.id;
    const repo = assistantSessionsRepo(t.meta);
    const turn = await repo.createTurn({ sessionId, askText: 'x' }, AT);
    // A result stored as something the reply shape does not describe.
    await repo.finishTurn(turn.id, {
      status: 'done',
      result: { title: 'Old shape' },
      steps: [],
      finishedAt: AT,
    });
    await t.meta.db
      .updateTable('adminium_assistant_turns')
      .set({ result: JSON.stringify(['not', 'an', 'object']) })
      .where('id', '=', turn.id)
      .execute();

    const read = await t.app.inject({
      method: 'GET',
      url: `/api/v1/assistant/sessions/${sessionId}/turns/${turn.id}`,
      headers: asUser(t.users.admin),
    });
    expect(read.statusCode).toBe(200);
    expect((read.json() as { result: unknown }).result).toBeNull();
  });

  it('hands back the page-read step with its facts, so a reloaded turn is not a blank row', async () => {
    const opened = await openSession();
    const sessionId = (opened.json() as { session: { id: string } }).session.id;
    const repo = assistantSessionsRepo(t.meta);
    const turn = await repo.createTurn({ sessionId, askText: 'x' }, AT);
    // The one step the server writes itself: no sentence, only the numbers.
    // The dashboard words it, so the view MUST carry `facts` through — without
    // them the row draws with an empty label and an empty detail.
    await repo.finishTurn(turn.id, {
      status: 'done',
      say: 'Done.',
      steps: [
        { id: 'page', state: 'done', icon: 'file-search', label: '', detail: '', tables: [], facts: { templates: 3, campaigns: 2, connection: 'Warehouse' } },
      ],
      finishedAt: AT,
    });

    const read = await t.app.inject({
      method: 'GET',
      url: `/api/v1/assistant/sessions/${sessionId}/turns/${turn.id}`,
      headers: asUser(t.users.admin),
    });
    expect(read.statusCode).toBe(200);
    const [step] = (read.json() as { steps: { id: string; facts?: Record<string, unknown> }[] }).steps;
    expect(step?.id).toBe('page');
    expect(step?.facts).toEqual({ templates: 3, campaigns: 2, connection: 'Warehouse' });
  });
});

describe('closing and sweeping', () => {
  it('closes a session and cancels what was still running', async () => {
    const opened = await openSession();
    const sessionId = (opened.json() as { session: { id: string } }).session.id;
    await t.app.inject({
      method: 'POST',
      url: `/api/v1/assistant/sessions/${sessionId}/turns`,
      headers: asUser(t.users.admin),
      payload: { text: 'Draft something' },
    });

    const closed = await t.app.inject({
      method: 'POST',
      url: `/api/v1/assistant/sessions/${sessionId}/close`,
      headers: asUser(t.users.admin),
    });
    expect(closed.statusCode).toBe(204);

    const repo = assistantSessionsRepo(t.meta);
    expect((await repo.findSession(sessionId))?.status).toBe('closed');
    expect((await repo.listTurns(sessionId)).every((turn) => turn.status === 'cancelled')).toBe(true);
  });

  it('sweeps a session closed past the window, with its turns', async () => {
    const repo = assistantSessionsRepo(t.meta);
    const old = await repo.create({ context: 'email', host: { connectionIds: [] } }, AT);
    await repo.createTurn({ sessionId: old.id, askText: 'old' }, AT);
    await repo.close(old.id, AT);

    // Thirty-one days later, with the default thirty-day window.
    const swept = await sweepAssistantSessions(t.meta, AT + 31 * 86_400_000);
    expect(swept.deleted).toBeGreaterThanOrEqual(1);
    expect(await repo.findSession(old.id)).toBeNull();
    expect(await repo.listTurns(old.id)).toEqual([]);
  });

  it('closes what a shut browser left open', async () => {
    const repo = assistantSessionsRepo(t.meta);
    const abandoned = await repo.create({ context: 'email', host: { connectionIds: [] } }, AT);
    const swept = await sweepAssistantSessions(t.meta, AT + 2 * 86_400_000);
    expect(swept.closed).toBeGreaterThanOrEqual(1);
    expect((await repo.findSession(abandoned.id))?.status).toBe('closed');
  });
});

describe('the two assistant fields on the LLM config', () => {
  it('keeps them when a PUT omits them', async () => {
    const keyCrypto = llmKeyCryptoFromSecret('a-sufficiently-long-test-secret-value', { deriveKey, encryptSecret, decryptSecret });
    const settings = settingsRepo(t.meta);
    await writeLlmConfig(
      settings,
      keyCrypto,
      { provider: 'anthropic', assistantName: 'Ada', assistantRowData: false },
      { updatedBy: null, at: AT },
    );
    expect(await readLlmConfig(settings, keyCrypto)).toMatchObject({
      assistantName: 'Ada',
      assistantRowData: false,
    });

    // The provider form — which the connect wizard also mounts — sends this
    // body and must not reset either field.
    await writeLlmConfig(settings, keyCrypto, { provider: 'anthropic', model: 'x' }, { updatedBy: null, at: AT });
    expect(await readLlmConfig(settings, keyCrypto)).toMatchObject({
      assistantName: 'Ada',
      assistantRowData: false,
    });

    await writeLlmConfig(
      settings,
      keyCrypto,
      { provider: 'anthropic', assistantName: 'Milo', assistantRowData: true },
      { updatedBy: null, at: AT },
    );
  });
});

describe('what the model is sent of a conversation that goes on', () => {
  const plain = (say: string) => JSON.stringify({ schema_version: ASSISTANT_SCHEMA_VERSION, say });

  /** Ask one question in a session and run its turn; hands back what the provider was sent. */
  async function ask(sessionId: string, text: string, reply: string) {
    const asked = await t.app.inject({
      method: 'POST',
      url: `/api/v1/assistant/sessions/${sessionId}/turns`,
      headers: asUser(t.users.admin),
      payload: { text },
    });
    expect(asked.statusCode, asked.body).toBe(202);
    const turnId = (asked.json() as { turn: { id: string } }).turn.id;
    const scripted = await runTurn(turnId, [{ text: plain(reply) }], t.users.admin.id);
    return { turnId, sent: scripted.calls[0]!.messages.map((message) => message.content) };
  }

  it('says each earlier message once, however long the conversation', async () => {
    const opened = await openSession();
    const sessionId = (opened.json() as { session: { id: string } }).session.id;
    await ask(sessionId, 'first question', 'first answer');
    await ask(sessionId, 'second question', 'second answer');
    await ask(sessionId, 'third question', 'third answer');
    const fourth = await ask(sessionId, 'fourth question', 'fourth answer');

    expect(fourth.sent).toEqual([
      'first question',
      plain('first answer'),
      'second question',
      plain('second answer'),
      'third question',
      plain('third answer'),
      'fourth question',
    ]);
    // And a turn stores its own messages, not the conversation before it.
    const stored = (await assistantSessionsRepo(t.meta).findTurn(fourth.turnId))!.transcript;
    expect(stored.filter((message) => message.role !== 'meta').map((message) => message.content)).toEqual([
      'fourth question',
      plain('fourth answer'),
    ]);
  });

  it('reads the rows an earlier release wrote, which hold the whole conversation each', async () => {
    const repo = assistantSessionsRepo(t.meta);
    const session = await repo.create(
      { context: 'email', host: { connectionIds: [] }, draft: { subject: 'On screen' }, provider: 'anthropic', model: 'm', createdBy: t.users.admin.id },
      AT,
    );
    const draft = (content: string) => content.includes('open_document');
    // Written as 0.3.20 wrote them: the replay before the turn, then the turn.
    const one = await repo.createTurn({ sessionId: session.id, askText: 'same question' }, AT);
    const D = { role: 'user', content: JSON.stringify({ open_document: { subject: 'On screen' }, note: 'This is the document currently open in the editor; it is unsaved.' }) };
    const t1 = [D, { role: 'user', content: 'same question' }, { role: 'assistant', content: plain('a1') }];
    await repo.finishTurn(one.id, { status: 'done', transcript: t1, finishedAt: AT + 1 });
    // A failed turn between two that happened: it holds its prefix and is never replayed.
    const bad = await repo.createTurn({ sessionId: session.id, askText: 'broken' }, AT + 2);
    await repo.finishTurn(bad.id, { status: 'failed', transcript: [D, ...t1, { role: 'user', content: 'broken' }, { role: 'assistant', content: 'not json' }], finishedAt: AT + 3 });
    // The same words again (a follow-up button does this).
    const two = await repo.createTurn({ sessionId: session.id, askText: 'same question' }, AT + 4);
    const t2 = [D, ...t1, { role: 'user', content: 'same question' }, { role: 'assistant', content: plain('a2') }];
    await repo.finishTurn(two.id, { status: 'done', transcript: t2, finishedAt: AT + 5 });

    const next = await ask(session.id, 'and now', 'a3');
    expect(next.sent.filter(draft)).toHaveLength(1);
    expect(next.sent.filter((content) => !draft(content))).toEqual([
      'same question',
      plain('a1'),
      'same question',
      plain('a2'),
      'and now',
    ]);
  });
});

describe('what a turn ends as when something else got there first', () => {
  const plain = (say: string) => JSON.stringify({ schema_version: ASSISTANT_SCHEMA_VERSION, say });

  async function asked(text: string) {
    const opened = await openSession();
    const sessionId = (opened.json() as { session: { id: string } }).session.id;
    const res = await t.app.inject({
      method: 'POST',
      url: `/api/v1/assistant/sessions/${sessionId}/turns`,
      headers: asUser(t.users.admin),
      payload: { text },
    });
    return { sessionId, turnId: (res.json() as { turn: { id: string } }).turn.id };
  }

  it('keeps a turn stopped when the person stopped it while the model was answering', async () => {
    const { sessionId, turnId } = await asked('Draft something long');
    const repo = assistantSessionsRepo(t.meta);
    const scripted = makeScriptedClient([{ text: plain('Here it is.') }], {
      // The person presses Stop while the provider is still answering.
      beforeReply: async () => {
        const res = await t.app.inject({
          method: 'POST',
          url: `/api/v1/assistant/sessions/${sessionId}/turns/${turnId}/cancel`,
          headers: asUser(t.users.admin),
        });
        expect(res.statusCode).toBe(204);
      },
    });
    await executeAssistantTurn({ turnId, userId: t.users.admin.id }, jobContext(), {
      meta: t.meta,
      manager: t.manager,
      resolveClient: () => Promise.resolve({ client: scripted.client, provider: 'anthropic', model: 'm', baseUrl: null }),
      can: () => Promise.resolve(true),
      now: () => AT,
    });
    const turn = await repo.findTurn(turnId);
    expect(turn?.status).toBe('cancelled');
    expect(turn?.say).toBeNull();
  });

  it('leaves a turn that has ended as it ended when Stop arrives late', async () => {
    const { sessionId, turnId } = await asked('What is a campaign?');
    await runTurn(turnId, [{ text: plain('A campaign goes to a list.') }], t.users.admin.id);
    const res = await t.app.inject({
      method: 'POST',
      url: `/api/v1/assistant/sessions/${sessionId}/turns/${turnId}/cancel`,
      headers: asUser(t.users.admin),
    });
    expect(res.statusCode).toBe(204);
    const turn = await assistantSessionsRepo(t.meta).findTurn(turnId);
    expect(turn).toMatchObject({ status: 'done', say: 'A campaign goes to a list.' });
  });

  it('says at once that the page could not be read, instead of trying the job again', async () => {
    const { turnId } = await asked('Draft a welcome email');
    const list = t.manager.connections.list.bind(t.manager.connections);
    t.manager.connections.list = () => Promise.reject(new Error('the meta store went away'));
    try {
      // Thrown, this would be retried and end as "the server restarted" half a minute later.
      await runTurn(turnId, [{ text: plain('unused') }], t.users.admin.id);
    } finally {
      t.manager.connections.list = list;
    }
    const turn = await assistantSessionsRepo(t.meta).findTurn(turnId);
    expect(turn?.status).toBe('failed');
    expect(turn?.error).toMatchObject({ kind: 'setup', message: 'the meta store went away' });
  });

  it('counts a question as use, so a conversation is not swept a day after it was opened', async () => {
    const repo = assistantSessionsRepo(t.meta);
    const session = await repo.create(
      { context: 'email', host: { connectionIds: [] }, provider: 'anthropic', model: 'm', createdBy: t.users.admin.id },
      AT - 30 * 3_600_000,
    );
    // Asked an hour ago, on a provider that reports no usage (nothing else moves the session's clock).
    await repo.createTurn({ sessionId: session.id, askText: 'still here' }, AT - 3_600_000);
    await sweepAssistantSessions(t.meta, AT);
    expect((await repo.findSession(session.id))?.status).toBe('open');
  });
});

describe('a question asked on another page than the one the conversation began on', () => {
  const plain = (say: string) => JSON.stringify({ schema_version: ASSISTANT_SCHEMA_VERSION, say });

  async function askOn(sessionId: string, body: Record<string, unknown>, script: readonly ScriptStep[]) {
    const asked = await t.app.inject({
      method: 'POST',
      url: `/api/v1/assistant/sessions/${sessionId}/turns`,
      headers: asUser(t.users.admin),
      payload: body,
    });
    expect(asked.statusCode, asked.body).toBe(202);
    const turn = (asked.json() as { turn: { id: string; context: string } }).turn;
    const scripted = await runTurn(turn.id, script, t.users.admin.id);
    return { turn, scripted };
  }

  it('is answered as that page: its prompt, its tools, its open document', async () => {
    // Opened on Email templates, with an email on the editor's screen.
    const opened = await t.app.inject({
      method: 'POST',
      url: '/api/v1/assistant/sessions',
      headers: asUser(t.users.admin),
      payload: { context: 'email', host: { connectionIds: [] }, draft: { subject: 'THE EMAIL ON SCREEN' } },
    });
    const sessionId = (opened.json() as { session: { id: string } }).session.id;
    const first = await askOn(sessionId, { text: 'Make it shorter' }, [{ text: plain('Shorter.') }]);
    expect(first.turn.context).toBe('email');
    expect(first.scripted.calls[0]!.system).toContain('"Email templates" page');
    expect(first.scripted.calls[0]!.messages[0]!.content).toContain('THE EMAIL ON SCREEN');

    // The person walks to the report builder and asks there, with a report open.
    const second = await askOn(
      sessionId,
      { text: 'Add a chart', context: 'report', host: { connectionIds: [] }, draft: { name: 'THE REPORT ON SCREEN' } },
      [{ text: plain('Added.') }],
    );
    expect(second.turn.context).toBe('report');
    const call = second.scripted.calls[0]!;
    expect(call.system).toContain('"Report builder" page');
    expect(call.system).not.toContain('"Email templates" page');
    const sent = call.messages.map((message) => message.content);
    // The document open NOW is the report; the email is a page the person has left.
    expect(sent[0]).toContain('THE REPORT ON SCREEN');
    expect(sent.join('\n')).not.toContain('THE EMAIL ON SCREEN');
    // And the conversation came along.
    expect(sent).toContain('Make it shorter');
    expect(sent.at(-1)).toBe('Add a chart');

    // Read back, each turn says where it was asked.
    const stored = await t.app.inject({ method: 'GET', url: `/api/v1/assistant/sessions/${sessionId}/turns/${second.turn.id}`, headers: asUser(t.users.admin) });
    expect(stored.json()).toMatchObject({ context: 'report', answer: null });

    // A page that is not an editor shows no document at all.
    const third = await askOn(sessionId, { text: 'How many rules are there?', context: 'automation', host: { connectionIds: [] } }, [{ text: plain('None.') }]);
    expect(third.scripted.calls[0]!.messages.map((message) => message.content).join('\n')).not.toContain('open_document');
  });

  it('saves a draft through the page it was made on, not the page the conversation began on', async () => {
    // Opened on the report builder; the draft is made on Email templates.
    const opened = await t.app.inject({
      method: 'POST',
      url: '/api/v1/assistant/sessions',
      headers: asUser(t.users.admin),
      payload: { context: 'report', host: { connectionIds: [] } },
    });
    const sessionId = (opened.json() as { session: { id: string } }).session.id;
    const drafted = await askOn(
      sessionId,
      { text: 'Draft a welcome email', context: 'email', host: { connectionIds: [] } },
      [
        {
          text: reply({
            result: {
              title: 'Welcome',
              meta: 'template',
              artefact: { kind: 'template', name: 'Walked welcome', locale: 'en_US', document: { subject: 'Welcome', preheader: '', blocks: [{ block: 'email.text', data: { paras: ['Hello'] } }], footer: '' } },
            },
          }),
        },
      ],
    );
    const stored = await assistantSessionsRepo(t.meta).findTurn(drafted.turn.id);
    expect(stored?.status, JSON.stringify(stored?.error)).toBe('done');
    const res = await t.app.inject({
      method: 'POST',
      url: `/api/v1/assistant/sessions/${sessionId}/turns/${drafted.turn.id}/actions`,
      headers: asUser(t.users.admin),
      payload: { action: 'save' },
    });
    expect(res.statusCode, res.body).toBe(200);
    const created = (res.json() as { created: { id: string; kind: string } }).created;
    // An email template, on the page that drafts emails. The report builder would have made a report of it.
    expect(created.kind).toBe('template');
    expect((await emailTemplatesRepo(t.meta).findById(created.id))?.name).toBe('Walked welcome');
  });
});
