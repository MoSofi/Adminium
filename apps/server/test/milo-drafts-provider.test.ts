// SPDX-License-Identifier: AGPL-3.0-only
/**
 * MILO'S DRAFTS THROUGH A REAL PROVIDER CLIENT: a live chat reply and a
 * landing page, asked of the `@adminium/llm` client itself (only `fetch` is
 * stubbed), so every check the client makes before it calls runs as it does
 * in production.
 *
 *  - the request passes the client's own checks (it asks at temperature 0,
 *    the only one the clients take), reaches the provider, and the draft
 *    comes back;
 *  - a provider that fails is told to the server's log by its kind and
 *    status, never with the prompt or the key, and the draft is refused as
 *    before.
 */
import { createProviderClient } from '@adminium/llm';
import { createSqliteMetaDb, firstRun, usersRepo, type MetaDb } from '@adminium/meta';
import BetterSqlite3 from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { draftChatReply } from '../src/chat/draft.js';
import { draftLandingPage } from '../src/landing/draft.js';
import type { AiConnection } from '../src/llm/connections.js';

const KEY = 'sk-ant-test-not-a-real-key-0000';
const CONNECTION: AiConnection = { id: 'database', provider: 'anthropic', source: 'database', baseUrl: null, hasKey: true, model: 'claude-test' };
const PAGE = { v: 1, title: 'Open day', description: 'Come and see the showroom.', blocks: [{ id: 'h', kind: 'heading', text: 'Open day at our showroom' }] };

let meta: MetaDb;
let userId = '';
let sent: Record<string, unknown>[] = [];
let answer: () => Response;
const warned: { fields: Record<string, unknown>; message: string }[] = [];

/** The AI connections the drafts ask: the real anthropic client, with its key. */
const ai = {
  connections: {
    default: async () => ({ connection: CONNECTION, model: 'claude-test' }),
    refusal: () => null,
    client: async () => ({ client: createProviderClient({ provider: 'anthropic', apiKey: KEY, model: 'claude-test' }), provider: 'anthropic' as const, model: 'claude-test', baseUrl: null, maxOutputTokens: 1000 }),
  },
};
const warn = (fields: Record<string, unknown>, message: string) => warned.push({ fields, message });
const textReply = (text: string) => () => new Response(JSON.stringify({ content: [{ type: 'text', text }], usage: { input_tokens: 40, output_tokens: 12 } }), { status: 200, headers: { 'content-type': 'application/json' } });

beforeEach(async () => {
  meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
  await firstRun(meta);
  userId = (await usersRepo(meta).create({ email: 'rae@meridian.example', name: 'Rae' })).id;
  sent = [];
  warned.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: unknown, init?: RequestInit) => {
      sent.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return answer();
    }),
  );
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await meta.db.destroy();
});

const chatDraft = () =>
  draftChatReply({
    meta,
    ai,
    miloDrafts: true,
    userId,
    business: 'Meridian Workplace',
    language: 'en-US',
    defaultLanguage: 'en-US',
    answers: [],
    messages: [{ id: '1', conversationId: 'c1', kind: 'visitor', body: 'When do you open on Saturday?', event: null, answerRef: null, authorId: null, drafted: false, sentAt: Date.now(), mailedAt: null }],
    at: Date.now(),
    warn,
  });

const pageDraft = () =>
  draftLandingPage({
    meta,
    ai,
    userId,
    description: 'An open day at our Leeds showroom on Thursday.',
    language: 'en-US',
    business: { name: 'Meridian Workplace', email: null },
    forms: [],
    self: null,
    pagesHeld: async () => new Set(),
    at: Date.now(),
    warn,
  });

describe('Milo drafts a live chat reply through the real provider client', () => {
  it('passes the client\'s checks, reaches the provider and gets the draft', async () => {
    answer = textReply('We open at 9 on Saturday.');
    const drafted = await chatDraft();
    expect(drafted).toMatchObject({ ok: true, draft: 'We open at 9 on Saturday.' });
    expect(sent).toHaveLength(1);
    expect(warned).toEqual([]);
  });

  it('tells the log why a call failed, without the prompt or the key', async () => {
    answer = () => new Response(JSON.stringify({ error: { message: 'overloaded' } }), { status: 529, headers: { 'content-type': 'application/json' } });
    expect(await chatDraft()).toEqual({ ok: false, refused: 'failed' });
    expect(warned).toHaveLength(1);
    expect(warned[0]!.fields).toMatchObject({ provider: 'anthropic', status: 529 });
    const said = JSON.stringify(warned);
    expect(said).not.toContain('Saturday');
    expect(said).not.toContain(KEY);
  });
});

describe('Milo drafts a landing page through the real provider client', () => {
  it('passes the client\'s checks, reaches the provider and gets the page', async () => {
    answer = textReply(JSON.stringify(PAGE));
    const drafted = await pageDraft();
    expect(drafted.ok, JSON.stringify(drafted)).toBe(true);
    expect(sent).toHaveLength(1);
    expect(warned).toEqual([]);
  });

  it('tells the log why a call failed, without the prompt or the key', async () => {
    answer = () => new Response('{"error":{"message":"bad gateway"}}', { status: 502, headers: { 'content-type': 'application/json' } });
    expect(await pageDraft()).toMatchObject({ ok: false, refused: 'failed' });
    expect(warned).toHaveLength(1);
    expect(warned[0]!.fields).toMatchObject({ provider: 'anthropic', status: 502 });
    const said = JSON.stringify(warned);
    expect(said).not.toContain('Leeds');
    expect(said).not.toContain(KEY);
  });
});
