// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHAT A WEBSITE CHAT'S SETTINGS PAGE READS ABOUT ITS AUTOMATIC ANSWERS, on
 * SQLite, Postgres and MySQL, each asked as the person it is for:
 *
 *  - `GET /chat/<addOn>/ai` answers someone who may read the chat's settings
 *    table: whether the answerer can call an AI service here (and why not),
 *    the service's name as the server decides it, the sentence beside the
 *    switch in the reader's own language, and today's spent and reserved
 *    tokens against the chat's limit. Someone who may change the answers but
 *    not read the settings, a reader of another table and nobody signed in
 *    are refused; an add-on with no chat is 404;
 *  - `POST /chat/<addOn>/ai/try` runs the real answerer on one question for
 *    someone who may change the answers: it is counted in today's tokens,
 *    writes no choice row, and is audited without the question; a reader of
 *    the settings alone is refused.
 */
import { permissionsRepo, rolesRepo, userPrefsRepo, usersRepo, type MetaDb } from '@adminium/meta';
import type { ProviderClient } from '@adminium/llm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { ChatAnswererInput } from '../src/chat/answerer.js';
import { chatServiceName } from '../src/chat/ai-notice.js';
import { AppError, errorEnvelope, UnauthorizedError } from '../src/errors.js';
import type { AiConnection } from '../src/llm/connections.js';
import { rbacPlugin } from '../src/plugins/rbac.js';
import { chatAiRoutes, type ChatAiInstall } from '../src/routes/chat-ai/index.js';
import { META_ENGINES } from './meta-dialects.js';

const CONNECTION: AiConnection = { id: 'database', provider: 'anthropic', source: 'database', baseUrl: null, hasKey: true, model: 'claude-test' };
const NOW = Date.UTC(2026, 10, 18, 9, 30, 0);
const ANSWERS: ChatAnswererInput['answers'] = [
  { ref: 'opening-hours', title: 'Opening hours', text: 'We are open 9 to 5.', examples: ['When are you open?'] },
  { ref: 'delivery', title: 'Delivery', text: 'We deliver in 3 working days.', examples: ['How long does shipping take?'] },
];

describe.each(META_ENGINES.map((engine) => [engine.name, engine] as const))('a chat\'s automatic answers, for its staff — %s', (_name, engine) => {
  let meta: MetaDb;
  let destroy: () => Promise<void>;
  let app: FastifyInstance;
  const people = new Map<string, string>();
  const asked: Parameters<ProviderClient['complete']>[0][] = [];
  let offHere = false;
  let dailyTokens = 50_000;

  const install = (): ChatAiInstall => ({ installId: 'inst-chat', connectionId: 'conn-1', settingsTable: 'tbl_settings', answersTable: 'tbl_answers', dailyTokens, defaultLanguage: 'en-US', answers: ANSWERS });

  async function person(name: string, grants: Record<string, Record<string, boolean>>, locale?: string): Promise<void> {
    const user = await usersRepo(meta).create({ email: `${name}@chat.test`, name });
    const role = await rolesRepo(meta).create({ slug: `${name}-role`, name: `${name} role` } as never);
    for (const [table, actions] of Object.entries(grants)) {
      await permissionsRepo(meta).grant(role.id, 'table', `conn-1/${table}`, { read: false, create: false, update: false, delete: false, export: false, import: false, ...actions } as never);
    }
    await rolesRepo(meta).assignToUser(user.id, role.id);
    if (locale !== undefined) await userPrefsRepo(meta).set(user.id, { locale } as never);
    people.set(name, user.id);
  }

  const call = (method: 'GET' | 'POST', url: string, as: string | null, payload?: unknown) =>
    app.inject({ method, url, headers: { 'x-test-user-id': as === null ? 'anonymous' : people.get(as)! }, ...(payload === undefined ? {} : { payload: payload as never }) });

  beforeAll(async () => {
    if (!engine.available) return;
    const handle = await engine.make();
    meta = handle.meta;
    destroy = handle.destroy;
    const model: ProviderClient = {
      id: 'anthropic',
      listModels: async () => [],
      test: async () => ({ ok: true, model: 'claude-test', latencyMs: 1 }),
      async complete(request) {
        asked.push(request);
        return { text: '{"answer":"delivery"}', usage: { inputTokens: 200, outputTokens: 6 } };
      },
    };
    const Fastify = (await import('fastify')).default;
    const { serializerCompiler, validatorCompiler } = await import('fastify-type-provider-zod');
    app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.setErrorHandler((error, _request, reply) => {
      if (error instanceof AppError) return reply.status(error.statusCode).send(errorEnvelope(error.code, error.message, 'req_test', error.details));
      return reply.status((error as { statusCode?: number }).statusCode ?? 500).send(errorEnvelope('INTERNAL', String(error), 'req_test'));
    });
    app.decorate('requireAuth', (async (request: { user?: unknown }) => {
      if (request.user === null || request.user === undefined) throw new UnauthorizedError('UNAUTHENTICATED');
    }) as never);
    app.decorateRequest('user', null);
    app.addHook('onRequest', async (request) => {
      const id = request.headers['x-test-user-id'];
      if (typeof id !== 'string' || id === 'anonymous') return;
      const user = await usersRepo(meta).findById(id);
      if (user !== null) (request as { user?: unknown }).user = { id: user.id, name: user.name, email: user.email };
    });
    await app.register(rbacPlugin, { meta });
    await app.register(
      chatAiRoutes({
        meta,
        install: async (addOn) => (addOn === 'live-chat' ? install() : null),
        answerer: {
          meta,
          connections: {
            default: async () => ({ connection: CONNECTION, model: 'claude-test' }),
            refusal: () => null,
            client: async () => ({ client: model, provider: 'anthropic', model: 'claude-test', baseUrl: null, maxOutputTokens: 1000 }),
          },
          offHere: () => offHere,
          now: () => NOW,
        },
      }),
    );
    await app.ready();
    await person('reader', { tbl_settings: { read: true } });
    await person('leser', { tbl_settings: { read: true } }, 'de_DE');
    await person('editor', { tbl_answers: { read: true, update: true } });
    await person('other', { tbl_other: { read: true, update: true } });
  });
  afterAll(async () => {
    if (!engine.available) return;
    await app.close();
    await destroy();
  });

  it.skipIf(!engine.available)('the read answers a reader of the settings, in their language, and refuses everyone else', async () => {
    const read = await call('GET', '/chat/live-chat/ai', 'reader');
    expect(read.statusCode, read.body).toBe(200);
    expect(read.json().data).toEqual({
      usable: true,
      refusal: null,
      service: { provider: 'anthropic', name: 'Anthropic' },
      notice: 'Visitors’ messages are sent to Anthropic to pick an answer. Nothing else is sent.',
      today: { day: '2026-11-18', spent: 0, reserved: 0, limit: 50_000 },
    });
    const german = await call('GET', '/chat/live-chat/ai', 'leser');
    expect(german.json().data.notice).toBe('Die Nachrichten der Besucher werden an Anthropic gesendet, um eine Antwort auszuwählen. Sonst wird nichts gesendet.');

    // Changing the answers is not reading the settings; another table is not this chat's; nobody is nobody.
    expect((await call('GET', '/chat/live-chat/ai', 'editor')).statusCode).toBe(403);
    expect((await call('GET', '/chat/live-chat/ai', 'other')).statusCode).toBe(403);
    expect((await call('GET', '/chat/live-chat/ai', null)).statusCode).toBe(401);
    expect((await call('GET', '/chat/no-chat/ai', 'reader')).statusCode).toBe(404);

    // Switched off here (a trial): not usable, and said why; the service is still named.
    offHere = true;
    const off = await call('GET', '/chat/live-chat/ai', 'reader');
    expect(off.json().data).toMatchObject({ usable: false, refusal: 'off-here', service: { name: 'Anthropic' } });
    offHere = false;
  });

  it.skipIf(!engine.available)('"Try a question" runs the real answerer for an editor of the answers, counted and audited, never logged as a choice', async () => {
    expect((await call('POST', '/chat/live-chat/ai/try', 'reader', { question: 'How long is delivery?' })).statusCode).toBe(403);
    expect((await call('POST', '/chat/live-chat/ai/try', 'other', { question: 'How long is delivery?' })).statusCode).toBe(403);
    expect((await call('POST', '/chat/live-chat/ai/try', null, { question: 'How long is delivery?' })).statusCode).toBe(401);
    expect(asked).toHaveLength(0);

    const tried = await call('POST', '/chat/live-chat/ai/try', 'editor', { question: 'How long is delivery? Mail me at a@b.example' });
    expect(tried.statusCode, tried.body).toBe(200);
    expect(tried.json().data).toEqual({ answerRef: 'delivery', outcome: 'answered', tokensIn: 200, tokensOut: 6 });
    expect(asked).toHaveLength(1);
    expect(asked[0]!.messages[0]!.content).not.toContain('a@b.example');

    // Counted against today's tokens, as a visitor's question is.
    const read = await call('GET', '/chat/live-chat/ai', 'reader');
    expect(read.json().data.today).toMatchObject({ spent: 206, reserved: 0 });

    // Audited: who, the outcome and the tokens; never the question.
    const rows = await meta.db.selectFrom('adminium_audit_log').selectAll().where('action', '=', 'chat.ai.try').execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.actorId).toBe(people.get('editor'));
    expect(JSON.stringify(rows[0]!.changes)).toContain('answered');
    expect(JSON.stringify(rows[0]!.changes)).not.toContain('delivery?');

    // With no automatic answers set, a try says so and calls nothing.
    dailyTokens = 0;
    const off = await call('POST', '/chat/live-chat/ai/try', 'editor', { question: 'When are you open?' });
    expect(off.json().data).toEqual({ answerRef: null, outcome: 'off', tokensIn: 0, tokensOut: 0 });
    expect(asked).toHaveLength(1);
    dailyTokens = 50_000;
  });
});

describe('naming the AI service', () => {
  it('names a fixed provider by its name, an address by its host, and an Ollama by where it runs', () => {
    expect(chatServiceName({ provider: 'openai', baseUrl: null }, 'gpt')).toBe('OpenAI');
    expect(chatServiceName({ provider: 'openai-compatible', baseUrl: 'https://api.groq.com/openai/v1' }, 'llama')).toBe('api.groq.com');
    expect(chatServiceName({ provider: 'ollama', baseUrl: null }, 'llama3')).toBe('Ollama');
    expect(chatServiceName({ provider: 'ollama', baseUrl: 'http://gpu-box.lan:11434' }, 'llama3')).toBe('gpu-box.lan');
    expect(chatServiceName({ provider: 'ollama', baseUrl: null }, 'gpt-oss:120b-cloud')).toBe('ollama.com');
  });
});
