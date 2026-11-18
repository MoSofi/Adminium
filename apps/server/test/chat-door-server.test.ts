// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE CHAT DOOR ON THE REAL SERVER, as a visitor's window uses it: a live chat
 * add-on attached to a CRM-like app whose enquiries are opened to a chat's
 * question left outside hours, on a real database per engine.
 *
 * - config: who the business is and its look, the languages, the words in
 *   the visitor's language, whether mail works, and "automatic" as it really
 *   is now; a package nobody vouches for serves no chat; the breaker's pause
 *   hides the chat from a new visitor only.
 * - start: one proof, bound to the chat, spent once; the trap writes nothing;
 *   "came from" keeps the origin and path only.
 * - the token: another install's, a changed one and a lapsed one are refused;
 *   a closed conversation is read, not written; reopened, it writes again.
 * - polls: only after the cursor, never another conversation's; one with
 *   nothing new reads none of the add-on's tables; the hours ride along.
 * - messages: each staff author's first name and initials, an automatic
 *   answer's language, who handed over; "Talk to a person"; the details and
 *   a language change; the per-minute cap on its own subject.
 * - every message insert publishes the two widget-data channels.
 * - a question outside hours becomes an enquiry through the app's `chat`
 *   entry with source `chat`, under its limits; with no entry it is the
 *   conversation alone; in hours it is refused; no mail is ever queued.
 * - a bigint messages key keeps every digit through the cursor (Postgres).
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { formMarksRepo, paymentSettingsRepo, settingsRepo, usersRepo } from '@adminium/meta';

import { chatAddOn } from '../../../packages/manifest/test/chat-fixture.js';
import { recordDeciderTrust } from '../src/add-ons/decider-trust.js';
import type { ChatAi } from '../src/chat/ai.js';
import type { ChatAnswerer, ChatAnswererInput, ChatChoice } from '../src/chat/answering.js';
import { chatSubject } from '../src/chat/caps.js';
import type { LiveChat } from '../src/chat/catalog.js';
import { chatTokenKey, makeChatToken } from '../src/chat/token.js';
import { composeServer, type ComposedServer } from '../src/compose.js';
import { encryptSecret } from '../src/config/secrets.js';
import { emailSecretKey } from '../src/email/config.js';
import { createApplyService } from '../src/llm/apply-service.js';
import { createRunService } from '../src/llm/run-service.js';
import { solveProof } from '../src/public-api/proof.js';
import { PAY_PAGE_DOC, payPageSchema } from '../src/routes/payments/ways.js';
import { addOnHarness, type Harness } from './app-add-ons.helpers.js';
import { makeEnv, TEST_SECRET } from './helpers.js';
import { LEGS } from './invoicing-install.helpers.js';

type Doc = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- a reply read freely

const HOST = 'chat.meridian.example';
const ORIGIN = `https://${HOST}`;
const pk = { ref: 'id', type: 'int', role: 'pk' };
const text = (ref: string, maxLength: number, more: Record<string, unknown> = {}) => ({ ref, type: 'text', maxLength, ...more });

/** A CRM-like app whose enquiries a question left outside hours may become. */
function crm(): Record<string, unknown> {
  return {
    kind: 'app',
    manifestVersion: 1,
    key: 'crm',
    name: 'CRM',
    version: '1.0.0',
    publisher: { id: 'adminium', name: 'Adminium' },
    license: 'AGPL-3.0-only',
    description: { key: 'd', fallback: 'A small CRM.' },
    categories: ['crm'],
    compatibility: { minAdminiumVersion: '0.3.64', engines: ['postgres', 'mysql', 'sqlite'] },
    requiredSchema: {
      prefixed: true,
      tables: [
        {
          ref: 'enquiries',
          columns: [
            pk,
            text('person', 80, { nullable: true }),
            text('email', 254, { nullable: true }),
            text('message', 2000, { nullable: true }),
            { ref: 'state', type: 'enum', enum: ['open', 'claimed', 'closed'], default: 'open' },
            { ref: 'source', type: 'enum', enum: ['form', 'phone', 'show', 'chat'], nullable: true },
          ],
        },
      ],
    },
    publicAccess: [
      {
        table: 'enquiries',
        methods: ['POST'],
        key: 'chat',
        writable: ['person', 'email', 'message'],
        defaults: { state: 'open', source: 'chat' },
        anonymous: { plainText: ['person'], perIpHour: 2 },
      },
    ],
    pages: [{ ref: 'crm-enquiries', template: 'page-crud', title: { key: 't', fallback: 'Enquiries' }, nav: { group: 'crm', icon: 'home', order: 1 }, bindings: { rows: 'enquiries' } }],
    frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html' }],
  };
}

/** The chat fixture under another key: its own tables, its own chat. */
function chatKeyed(key: string): Record<string, unknown> {
  return { ...chatAddOn(), key, name: `Chat ${key}` };
}

const ALL_DAY = { sun: [['00:00', '24:00']], mon: [['00:00', '24:00']], tue: [['00:00', '24:00']], wed: [['00:00', '24:00']], thu: [['00:00', '24:00']], fri: [['00:00', '24:00']], sat: [['00:00', '24:00']] };

describe.each(LEGS)('the chat door — %s', (dialect, available) => {
  let h: Harness;
  let composed: ComposedServer;
  let root: string;
  const tables: Record<string, string> = {};
  let enquiries = '';
  let dana = '';
  let seq = 0;
  /** What the fake AI says, and what the fake answerer picks: each test sets its own. */
  let ai: ChatAi = { usable: false, service: null };
  let pick: (input: ChatAnswererInput) => ChatChoice = () => ({ kind: 'hand-over', outcome: 'hand-over' });
  const answerer: ChatAnswerer = { pick: async (input) => pick(input) };

  const table = (addOn: string, ref: string) => tables[`${addOn}:${ref}`]!;
  const rows = (statement: string) => h.rows(statement) as Promise<Doc[]>;
  const count = async (name: string, where = '1=1') => Number((await rows(`SELECT COUNT(*) AS n FROM ${name} WHERE ${where}`))[0]!['n']);
  const nextIp = () => {
    seq += 1;
    return `198.51.${String(Math.floor(seq / 200))}.${String(seq % 200)}`;
  };
  const call = (method: 'GET' | 'POST', url: string, opts: { payload?: unknown; headers?: Record<string, string>; ip?: string } = {}) =>
    composed.app.inject({ method, url, remoteAddress: opts.ip ?? '203.0.113.50', headers: { host: HOST, origin: ORIGIN, ...(opts.headers ?? {}) }, ...(opts.payload === undefined ? {} : { payload: opts.payload as Doc }) });
  /** A solved human check for a chat. */
  const proof = async (addOn: string): Promise<string> => {
    const challenge = (await call('POST', `/x/chat/api/${addOn}/challenge`, { payload: {} })).json() as Doc;
    return typeof challenge.salt === 'string' ? `${challenge.id as string}.${solveProof(challenge.salt, challenge.difficulty as number)}` : 'none';
  };
  const start = async (addOn: string, payload: Doc, opts: { proof?: string; ip?: string } = {}) =>
    call('POST', `/x/chat/api/${addOn}/start`, { payload, headers: { 'x-adminium-proof': opts.proof ?? (await proof(addOn)) }, ip: opts.ip ?? nextIp() });
  const started = async (body = 'Do you have booths in stock?', more: Doc = {}) => {
    const answer = await start('live-chat', { language: 'en-US', body, ...more });
    expect(answer.statusCode, answer.body).toBe(200);
    return answer.json() as Doc;
  };
  const poll = (token: string, after = '0', addOn = 'live-chat') => call('GET', `/x/chat/api/${addOn}/messages?after=${after}`, { headers: { 'x-adminium-chat': token } });
  const post = (token: string, payload: Doc, addOn = 'live-chat') => call('POST', `/x/chat/api/${addOn}/messages`, { payload: { token, ...payload } });
  const chatOf = async (addOn = 'live-chat'): Promise<LiveChat> => (await composed.chat.catalog.forStaff(addOn))!;
  /** The chat's settings row changed, and the door told at once. */
  const settle = async (addOn: string, values: Doc) => {
    const { db } = await h.manager.data(h.connectionId);
    const json = (value: unknown) => (value === null ? null : JSON.stringify(value));
    const out: Doc = {};
    for (const [column, value] of Object.entries(values)) out[column] = ['hours', 'welcome', 'outside_words', 'tell'].includes(column) ? json(value) : typeof value === 'boolean' && dialect !== 'postgres' ? (value ? 1 : 0) : value;
    await db.updateTable(table(addOn, 'chat_settings')).set(out as never).execute();
    composed.chat.catalog.forget();
  };
  const conversationRow = async (id: string) => (await rows(`SELECT * FROM ${table('live-chat', 'conversations')} WHERE id = ${id}`))[0]!;
  const mailsQueued = async () => Number((await h.meta.db.selectFrom('adminium_jobs').select((eb) => eb.fn.countAll<number>().as('n')).where('kind', '=', 'email.send').executeTakeFirst())?.n ?? 0);

  beforeAll(async () => {
    if (!available) return;
    h = await addOnHarness(dialect, { unbuiltWords: {} });
    await h.stageApp(crm());
    const app = await h.install('crm', '1.0.0');
    expect(app.statusCode, app.body).toBe(200);
    await h.stageAddOn(chatAddOn(), { bundled: true });
    const added = await h.inject({ method: 'POST', url: '/add-ons', payload: { key: 'live-chat', version: '1.0.0', attachTo: ['crm'] } });
    expect(added.statusCode, added.body).toBe(200);
    // A second chat with no app to write a question into, and a third nobody vouches for.
    for (const key of ['desk-chat', 'stray-chat']) {
      await h.stageAddOn(chatKeyed(key), { bundled: true });
      const more = await h.inject({ method: 'POST', url: '/add-ons', payload: { key, version: '1.0.0', attachTo: ['dashboard'] } });
      expect(more.statusCode, more.body).toBe(200);
    }
    for (const key of ['live-chat', 'desk-chat']) await recordDeciderTrust(h.meta, { key, version: '1.0.0', integrity: (await h.addOnStore.verifyTree(key, '1.0.0')).integrity });
    for (const record of await h.meta.db.selectFrom('adminium_app_tables').select(['appKey', 'ref', 'tableName']).execute()) tables[`${record.appKey}:${record.ref}`] = record.tableName;
    enquiries = table('crm', 'enquiries');

    const settings = settingsRepo(h.meta);
    await settings.set('system.publicOrigin', ORIGIN, { updatedBy: null });
    await settings.set('privacy.businessName', 'Meridian Workplace Ltd', { updatedBy: null });
    await settings.set('privacy.noticeUrl', 'https://www.meridian.example/privacy', { updatedBy: null });
    await settings.set('appearance.accent', 'teal', { updatedBy: null });
    await settings.set('email.smtp', { host: '127.0.0.1', port: 9, user: 'postmaster', passEncrypted: encryptSecret('not-a-real-password', emailSecretKey(TEST_SECRET)), from: 'Desk <no-reply@desk.test>', secure: false }, { updatedBy: null });
    await paymentSettingsRepo(h.meta).set(PAY_PAGE_DOC, payPageSchema, { shopName: 'Meridian', logoFileId: null, contactEmail: 'hello@meridian.example', contactPhone: null, shopCountry: 'GB', showLines: false });
    dana = (await usersRepo(h.meta).create({ email: 'dana.whitfield@meridian.example', name: 'Dana Whitfield' })).id;

    root = await mkdtemp(join(tmpdir(), 'chat-door-'));
    await mkdir(join(root, 'dist', 'x'), { recursive: true });
    await writeFile(join(root, 'dist', 'index.html'), '<!doctype html><html><body></body></html>');
    await writeFile(join(root, 'dist', 'x', 'index.html'), '<!doctype html><html><body><noscript>x</noscript></body></html>');
    const runService = createRunService({ meta: h.meta });
    composed = await composeServer({
      env: makeEnv({ ADMINIUM_DATA_DIR: h.dataDir, HOST: '127.0.0.1', ADMINIUM_SECRET: TEST_SECRET }),
      metaStore: { meta: h.meta, url: 'sqlite::memory:', engine: 'sqlite', source: 'embedded', close: async () => Promise.resolve() },
      manager: h.manager,
      runService,
      applyService: createApplyService({ meta: h.meta, runService }),
      allowed: null,
      staticRoot: join(root, 'dist'),
      logger: false,
      telemetry: false,
      chatSeams: { ai: async () => ai, answerer },
    });
    await composed.app.ready();
    await composed.addOnsLoaded;
    await composed.jobs.worker.stop();
    composed.jobs.scheduler.stop();
  }, 300_000);

  afterAll(async () => {
    if (!available) return;
    await composed?.app.close();
    await h?.close();
    if (root !== undefined) await rm(root, { recursive: true, force: true });
  });

  it.skipIf(!available)('config: who the business is and its look, the languages, mail, and no automatic answers while AI is not usable', async () => {
    await settle('live-chat', { hours: null, welcome: { 'en-US': 'Hi, how can we help?', 'de-DE': 'Hallo!' }, outside_words: { 'en-US': 'We are away.' } });
    const answer = await call('GET', '/x/chat/api/live-chat/config?lang=de-DE');
    expect(answer.statusCode, answer.body).toBe(200);
    const config = answer.json() as Doc;
    expect(config).toMatchObject({
      state: 'live',
      business: { name: 'Meridian', privacyNotice: 'https://www.meridian.example/privacy', hasLogo: false },
      accent: 'teal',
      language: 'de-DE',
      languages: ['en-US', 'de-DE'],
      defaultLanguage: 'en-US',
      theme: 'light',
      // No hours: always outside hours.
      open: false,
      closesAt: null,
      nextOpen: null,
      welcome: 'Hallo!',
      // No German version: the default language's words.
      outsideWords: 'We are away.',
      automatic: false,
      miloDrafts: false,
      aiService: null,
      mail: true,
    });
    // A language the chat does not offer: the default.
    expect(((await call('GET', '/x/chat/api/live-chat/config?lang=fr-FR')).json() as Doc).language).toBe('en-US');
  });

  it.skipIf(!available)('"automatic" is what really runs: on, in hours, a day of tokens, AI usable', async () => {
    const automatic = async () => ((await call('GET', '/x/chat/api/live-chat/config')).json() as Doc).automatic as boolean;
    await settle('live-chat', { hours: ALL_DAY, automatic: true, daily_tokens: 5000 });
    ai = { usable: true, service: 'Anthropic' };
    expect(await automatic()).toBe(true);
    expect(((await call('GET', '/x/chat/api/live-chat/config')).json() as Doc).aiService).toBe('Anthropic');
    ai = { usable: false, service: null };
    expect(await automatic()).toBe(false);
    ai = { usable: true, service: 'Anthropic' };
    await settle('live-chat', { daily_tokens: 0 });
    expect(await automatic()).toBe(false);
    await settle('live-chat', { daily_tokens: 5000, hours: null });
    expect(await automatic()).toBe(false);
    await settle('live-chat', { hours: ALL_DAY, automatic: false });
    expect(await automatic()).toBe(false);
    ai = { usable: false, service: null };
  });

  it.skipIf(!available)('a package nobody vouches for serves no chat; one vouched for does', async () => {
    expect((await call('GET', '/x/chat/api/stray-chat/config')).statusCode).toBe(404);
    expect((await call('POST', '/x/chat/api/stray-chat/challenge', { payload: {} })).statusCode).toBe(404);
    expect((await call('GET', '/x/chat/api/desk-chat/config')).statusCode).toBe(200);
    expect((await call('GET', '/x/chat/api/no-such-chat/config')).statusCode).toBe(404);
  });

  it.skipIf(!available)('start without a spent proof, with one bound to another chat, or with one spent already is refused; nothing is written', async () => {
    const conversations = table('live-chat', 'conversations');
    const before = await count(conversations);
    expect((await start('live-chat', { body: 'Hello' }, { proof: 'none' })).statusCode).toBe(403);
    expect((await start('live-chat', { body: 'Hello' }, { proof: await proof('desk-chat') })).statusCode).toBe(403);
    const once = await proof('live-chat');
    expect((await start('live-chat', { body: 'Hello' }, { proof: once })).statusCode).toBe(200);
    expect((await start('live-chat', { body: 'Hello again' }, { proof: once })).statusCode).toBe(403);
    expect(await count(conversations)).toBe(before + 1);
  });

  it.skipIf(!available)('the trap field answers as a start does and writes nothing; its token opens nothing', async () => {
    const conversations = table('live-chat', 'conversations');
    const before = await count(conversations);
    const trapped = await start('live-chat', { body: 'Buy cheap pills', website: 'https://spam.example' });
    expect(trapped.statusCode).toBe(200);
    expect((trapped.json() as Doc).state).toBe('started');
    expect(await count(conversations)).toBe(before);
    expect((await poll((trapped.json() as Doc).token as string)).statusCode).toBe(410);
  });

  it.skipIf(!available)('"came from" keeps the origin and path only; the body is kept as typed, cut to what a person typed', async () => {
    const begun = await started('  Two booths?\u0007 ', { cameFrom: 'https://www.meridian.example/showroom?utm_source=mail&email=marta@cobalt.example#top' });
    const row = await conversationRow(String((await rows(`SELECT MAX(id) AS id FROM ${table('live-chat', 'conversations')}`))[0]!['id']));
    expect(row['came_from']).toBe('https://www.meridian.example/showroom');
    expect((begun.messages as Doc[])[0]!.body).toBe('Two booths?');
    expect(JSON.stringify(row)).not.toContain('203.0.113');
    // Too long: refused, nothing written.
    expect((await start('live-chat', { body: 'a'.repeat(2001) })).statusCode).toBe(400);
  });

  it.skipIf(!available)('polls return only the messages after the cursor, and never another conversation’s', async () => {
    const a = await started('First from A');
    const b = await started('First from B');
    const first = (await poll(a.token as string)).json() as Doc;
    expect((first.messages as Doc[]).map((one) => one.body)).toEqual(['First from A']);
    expect(first.cursor).toBe(a.cursor);
    await post(a.token as string, { body: 'Second from A' });
    await post(b.token as string, { body: 'Second from B' });
    const after = (await poll(a.token as string, a.cursor as string)).json() as Doc;
    expect((after.messages as Doc[]).map((one) => one.body)).toEqual(['Second from A']);
    const none = (await poll(a.token as string, after.cursor as string)).json() as Doc;
    expect(none.messages).toEqual([]);
    expect(none).toMatchObject({ state: 'waiting', staff: false, cursor: after.cursor });
    // B's token never reads A's messages.
    expect(((await poll(b.token as string)).json() as Doc).messages.map((one: Doc) => one.body)).toEqual(['First from B', 'Second from B']);
  });

  it.skipIf(!available)('a poll with nothing new reads none of the add-on’s tables', async () => {
    const a = await started('Anyone there?');
    // Every statement on the chat's database, counted from here.
    let statements = 0;
    const real = h.manager.data.bind(h.manager);
    const spy = vi.spyOn(h.manager, 'data').mockImplementation(async (connectionId: string) => {
      const handle = await real(connectionId);
      const db = new Proxy(handle.db, {
        get(target, property, receiver) {
          if (property === 'selectFrom' || property === 'updateTable' || property === 'insertInto' || property === 'deleteFrom' || property === 'transaction') statements += 1;
          const value = Reflect.get(target, property, receiver) as unknown;
          return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
        },
      });
      return { ...handle, db } as typeof handle;
    });
    try {
      composed.chat.catalog.forget();
      // The first poll reads the chat (and its settings, kept a few seconds) and writes the heartbeat.
      expect((await poll(a.token as string, a.cursor as string)).statusCode).toBe(200);
      statements = 0;
      for (let one = 0; one < 3; one += 1) {
        const answer = await poll(a.token as string, a.cursor as string);
        expect((answer.json() as Doc).messages).toEqual([]);
      }
      expect(statements).toBe(0);
    } finally {
      spy.mockRestore();
      composed.chat.catalog.forget();
    }
  });

  it.skipIf(!available)('the poll carries the hours: open and when it closes, or when it opens next', async () => {
    const a = await started('Hours?');
    await settle('live-chat', { hours: ALL_DAY });
    expect((await poll(a.token as string)).json()).toMatchObject({ open: true, nextOpen: null });
    expect(((await poll(a.token as string)).json() as Doc).closesAt).toEqual(expect.any(String));
    await settle('live-chat', { hours: { mon: [['09:00', '17:00']] }, closed_until: '2099-01-05' });
    expect((await poll(a.token as string)).json()).toMatchObject({ open: false, closesAt: null, nextOpen: { date: '2099-01-05', time: '09:00', day: 'date' } });
    await settle('live-chat', { hours: null, closed_until: null });
  });

  it.skipIf(!available)('a staff reply and the lines staff cause carry a first name and initials only; staff are answering', async () => {
    const a = await started('Is anyone in?');
    const chat = await chatOf();
    const id = String((await rows(`SELECT MAX(id) AS id FROM ${table('live-chat', 'conversations')}`))[0]!['id']);
    await composed.chat.store.add(chat, id, { kind: 'system', body: 'Dana joined the chat.', event: 'taken', authorId: dana }, { state: 'open', takenBy: dana, takenAt: Date.now() });
    await composed.chat.store.add(chat, id, { kind: 'staff', body: 'Hello, I can help.', authorId: dana }, { lastStaffAt: Date.now() });
    const answer = (await poll(a.token as string, a.cursor as string)).json() as Doc;
    expect(answer).toMatchObject({ state: 'open', staff: true });
    expect(answer.messages).toEqual([
      expect.objectContaining({ kind: 'system', event: 'taken', author: { firstName: 'Dana', initials: 'DW' } }),
      expect.objectContaining({ kind: 'staff', body: 'Hello, I can help.', author: { firstName: 'Dana', initials: 'DW' } }),
    ]);
    const said = JSON.stringify(answer);
    expect(said).not.toContain(dana);
    expect(said).not.toContain('Whitfield');
    expect(said).not.toContain('dana.whitfield@');
  });

  it.skipIf(!available)('a chat closed by staff is read until it lapses, never written; reopened, the same token writes again', async () => {
    const a = await started('Can I come by?');
    const chat = await chatOf();
    const id = String((await rows(`SELECT MAX(id) AS id FROM ${table('live-chat', 'conversations')}`))[0]!['id']);
    await composed.chat.store.add(chat, id, { kind: 'system', body: 'The chat was closed.', event: 'closed', authorId: dana }, { state: 'closed', closedAt: Date.now() });
    const read = (await poll(a.token as string, a.cursor as string)).json() as Doc;
    expect(read.state).toBe('closed');
    expect(read.messages).toEqual([expect.objectContaining({ event: 'closed', author: { firstName: 'Dana', initials: 'DW' } })]);
    expect((await post(a.token as string, { body: 'Hello?' })).statusCode).toBe(409);
    expect((await call('POST', '/x/chat/api/live-chat/details', { payload: { token: a.token, name: 'Marta' } })).statusCode).toBe(409);
    await composed.chat.store.add(chat, id, { kind: 'system', body: 'The chat was reopened.', event: 'reopened', authorId: dana }, { state: 'open', takenBy: dana, closedAt: null });
    expect((await post(a.token as string, { body: 'Hello again' })).statusCode).toBe(200);
    expect(((await poll(a.token as string, read.cursor as string)).json() as Doc).messages.map((one: Doc) => one.event ?? one.body)).toEqual(['reopened', 'Hello again']);
  });

  it.skipIf(!available)('a token from another install, a changed token and a lapsed one are refused', async () => {
    const a = await started('Token test');
    const id = String((await rows(`SELECT MAX(id) AS id FROM ${table('live-chat', 'conversations')}`))[0]!['id']);
    const elsewhere = makeChatToken(chatTokenKey(TEST_SECRET), 'another-install', { addOn: 'live-chat', conversation: id, issuedAt: Date.now() });
    expect((await poll(elsewhere)).statusCode).toBe(410);
    expect((await post(elsewhere, { body: 'x' })).statusCode).toBe(410);
    const token = a.token as string;
    const changed = `${token.slice(0, 10)}${token[10] === 'A' ? 'B' : 'A'}${token.slice(11)}`;
    expect((await poll(changed)).statusCode).toBe(410);
    // A day and more since the last message.
    const { db } = await h.manager.data(h.connectionId);
    const old = new Date(Date.now() - 25 * 60 * 60_000).toISOString();
    await db.updateTable(table('live-chat', 'conversations')).set({ last_message_at: dialect === 'mysql' ? old.slice(0, 19).replace('T', ' ') : old } as never).where('id' as never, '=', Number(id) as never).execute();
    expect((await post(token, { body: 'Still there?' })).statusCode).toBe(410);
    composed.chat.store.forget();
    expect((await poll(token)).statusCode).toBe(410);
  });

  it.skipIf(!available)('automatic answers: in the visitor’s language when written, else the default language’s, marked; who handed over', async () => {
    const { db } = await h.manager.data(h.connectionId);
    const answers = table('live-chat', 'answers');
    await db.deleteFrom(answers).execute();
    const versions = (de: boolean) => JSON.stringify({ 'en-US': { title: 'Hours', text: 'We are open 9 to 5.', examples: ['When are you open?'] }, ...(de ? { 'de-DE': { title: 'Zeiten', text: 'Wir haben von 9 bis 17 Uhr geöffnet.', examples: [] } } : {}) });
    await db.insertInto(answers).values({ ref: 'hours', versions: versions(true), active: dialect === 'postgres' ? true : 1, position: 1 } as never).execute();
    await db.insertInto(answers).values({ ref: 'stock', versions: versions(false).replace('We are open 9 to 5.', 'Booths ship in a week.'), active: dialect === 'postgres' ? true : 1, position: 2 } as never).execute();
    await settle('live-chat', { hours: ALL_DAY, automatic: true, daily_tokens: 5000, welcome: { 'en-US': 'Hi', 'de-DE': 'Hallo' } });
    ai = { usable: true, service: 'Anthropic' };
    try {
      const seen: ChatAnswererInput[] = [];
      pick = (input) => {
        seen.push(input);
        return { kind: 'answer', ref: input.visitorMessages.at(-1)!.includes('Lager') ? 'stock' : 'hours' };
      };
      const a = (await start('live-chat', { language: 'de-DE', body: 'Wann habt ihr offen?' })).json() as Doc;
      expect(a.conversation).toMatchObject({ state: 'bot', language: 'de-DE' });
      await composed.chat.door.settled();
      await post(a.token as string, { body: 'Habt ihr Kabinen auf Lager?' });
      await composed.chat.door.settled();
      const read = (await poll(a.token as string, a.cursor as string)).json() as Doc;
      const automatic = (read.messages as Doc[]).filter((one) => one.kind === 'automatic');
      expect(automatic).toEqual([
        expect.objectContaining({ body: 'Wir haben von 9 bis 17 Uhr geöffnet.', language: 'de-DE' }),
        expect.objectContaining({ body: 'Booths ship in a week.', language: 'en-US' }),
      ]);
      // The answerer was given the default language's answers and the visitor's messages, never an address.
      expect(seen[1]).toMatchObject({ addOn: 'live-chat', language: 'de-DE', defaultLanguage: 'en-US', automaticCount: 1, dailyTokens: 5000, visitorMessages: ['Wann habt ihr offen?', 'Habt ihr Kabinen auf Lager?'] });
      expect(seen[1]!.answers.map((one) => one.ref)).toEqual(['hours', 'stock']);
      expect(seen[1]!.addressHash).not.toContain('203.0.113');
      // "Talk to a person": the visitor's own hand-over.
      const talk = (await post(a.token as string, { talk: true })).json() as Doc;
      expect(talk.message).toMatchObject({ kind: 'system', event: 'handed-over', by: 'visitor' });
      expect(talk.conversation).toEqual({ state: 'waiting' });
      // The answerer's hand-over is marked as its own.
      pick = () => ({ kind: 'hand-over', outcome: 'hand-over' });
      const b = (await start('live-chat', { language: 'en-US', body: 'What does a booth cost?' })).json() as Doc;
      await composed.chat.door.settled();
      const handed = (await poll(b.token as string, b.cursor as string)).json() as Doc;
      expect(handed.state).toBe('waiting');
      expect(handed.messages).toEqual([expect.objectContaining({ kind: 'system', event: 'handed-over', by: 'automatic' })]);
    } finally {
      ai = { usable: false, service: null };
      pick = () => ({ kind: 'hand-over', outcome: 'hand-over' });
      await settle('live-chat', { hours: null, automatic: false, daily_tokens: 0 });
    }
  });

  it.skipIf(!available)('details: a name, an address and a language change are kept; one that is not an address is refused', async () => {
    await settle('live-chat', { welcome: { 'en-US': 'Hi', 'de-DE': 'Hallo' } });
    const a = await started('Details test');
    const id = String((await rows(`SELECT MAX(id) AS id FROM ${table('live-chat', 'conversations')}`))[0]!['id']);
    const details = (payload: Doc) => call('POST', '/x/chat/api/live-chat/details', { payload: { token: a.token, ...payload } });
    expect((await details({ email: 'not an address' })).statusCode).toBe(400);
    expect((await details({ name: 'Marta 2000' })).statusCode).toBe(400);
    expect((await details({ language: 'xx-XX' })).statusCode).toBe(400);
    const saved = await details({ name: 'Marta Kovac', email: ' Marta@Cobalt.example ', language: 'de-DE' });
    expect(saved.statusCode, saved.body).toBe(200);
    expect((saved.json() as Doc).conversation).toMatchObject({ language: 'de-DE' });
    expect(await conversationRow(id)).toMatchObject({ name: 'Marta Kovac', email: 'marta@cobalt.example', language: 'de-DE' });
  });

  it.skipIf(!available)('a conversation’s minute trips at 21; another visitor’s messages go on', async () => {
    const a = await started('Cap test A');
    const b = await started('Cap test B');
    for (let one = 0; one < 20; one += 1) expect((await post(a.token as string, { body: `Message ${String(one)}` })).statusCode).toBe(200);
    const refused = await post(a.token as string, { body: 'One too many' });
    expect(refused.statusCode).toBe(429);
    expect(refused.json()).toMatchObject({ state: 'too-many', cap: 'minute', retryAfter: expect.any(Number) });
    expect((await post(b.token as string, { body: 'Mine still goes' })).statusCode).toBe(200);
  }, 120_000);

  it.skipIf(!available)('every message insert publishes the messages and the conversations channels', async () => {
    const a = await started('Publish test');
    const chat = await chatOf();
    const spy = vi.spyOn(composed.app.realtime, 'publish');
    try {
      expect((await post(a.token as string, { body: 'Heard?' })).statusCode).toBe(200);
      const channels = spy.mock.calls.map((callArgs) => callArgs[0]);
      expect(channels).toContain(`widget-data:${chat.connectionId}:${chat.messages.table.id}`);
      expect(channels).toContain(`widget-data:${chat.connectionId}:${chat.conversations.table.id}`);
    } finally {
      spy.mockRestore();
    }
  });

  it.skipIf(!available)("the breaker's pause hides the chat from a new visitor; a visitor already chatting goes on", async () => {
    const a = await started('Before the pause');
    const mark = await formMarksRepo(h.meta).mark({ subject: chatSubject('live-chat'), purpose: 'chat-pause' }, Date.now());
    try {
      expect((await call('GET', '/x/chat/api/live-chat/config')).statusCode).toBe(404);
      expect((await start('live-chat', { body: 'New here' })).statusCode).toBe(404);
      expect((await post(a.token as string, { body: 'Still chatting' })).statusCode).toBe(200);
      expect(await composed.chat.caps.resume('live-chat', Date.now())).toBe(true);
      expect((await call('GET', '/x/chat/api/live-chat/config')).statusCode).toBe(200);
    } finally {
      await formMarksRepo(h.meta).unmark([mark]);
    }
  });

  it.skipIf(!available)('a question outside hours becomes an enquiry with source chat through the entry, linked; no mail is queued', async () => {
    await settle('live-chat', { hours: null });
    const mails = await mailsQueued();
    const before = await count(enquiries);
    const ip = nextIp();
    const asked = await call('POST', '/x/chat/api/live-chat/question', {
      payload: { language: 'en-US', question: 'Can you quote for six booths?', name: 'Marta Kovac', email: 'marta@cobalt.example', cameFrom: 'https://www.meridian.example/booths?x=1' },
      headers: { 'x-adminium-proof': await proof('live-chat') },
      ip,
    });
    expect(asked.statusCode, asked.body).toBe(200);
    expect(await count(enquiries)).toBe(before + 1);
    const made = (await rows(`SELECT * FROM ${enquiries} ORDER BY id DESC`))[0]!;
    expect(made).toMatchObject({ person: 'Marta Kovac', email: 'marta@cobalt.example', message: 'Can you quote for six booths?', state: 'open', source: 'chat' });
    const conversation = (await rows(`SELECT * FROM ${table('live-chat', 'conversations')} ORDER BY id DESC`))[0]!;
    expect(conversation).toMatchObject({ state: 'waiting', name: 'Marta Kovac', email: 'marta@cobalt.example', came_from: 'https://www.meridian.example/booths', became_key: String(made['id']) });
    expect(String(conversation['became_table'])).toContain('enquiries');
    expect([true, 1, '1'].includes(conversation['outside_hours'] as never)).toBe(true);
    // The entry's own limit (two an hour from one address): the third writes nothing, and says so.
    const again = (question: string) =>
      call('POST', '/x/chat/api/live-chat/question', { payload: { language: 'en-US', question, name: 'Marta Kovac', email: 'marta@cobalt.example' }, headers: { 'x-adminium-proof': 'x' }, ip });
    for (const question of ['Second question', 'Third question']) {
      const answer = await call('POST', '/x/chat/api/live-chat/question', { payload: { language: 'en-US', question, name: 'Marta Kovac', email: 'marta@cobalt.example' }, headers: { 'x-adminium-proof': await proof('live-chat') }, ip });
      if (question === 'Third question') {
        expect(answer.statusCode, answer.body).toBe(429);
        expect(await count(enquiries)).toBe(before + 2);
        expect(await count(table('live-chat', 'messages'), `body = 'Third question'`)).toBe(0);
      } else {
        expect(answer.statusCode, answer.body).toBe(200);
      }
    }
    expect((await again('No proof')).statusCode).toBe(403);
    expect(await mailsQueued()).toBe(mails);
  });

  it.skipIf(!available)('with no table opened to it, a question is the conversation alone; in hours a question is refused', async () => {
    await settle('desk-chat', { hours: null });
    const before = await count(enquiries);
    const conversations = table('desk-chat', 'conversations');
    const was = await count(conversations);
    const left = await call('POST', '/x/chat/api/desk-chat/question', {
      payload: { language: 'en-US', question: 'Are you open on Saturday?', email: 'sam@example.org' },
      headers: { 'x-adminium-proof': await proof('desk-chat') },
      ip: nextIp(),
    });
    expect(left.statusCode, left.body).toBe(200);
    expect(await count(conversations)).toBe(was + 1);
    expect(await count(enquiries)).toBe(before);
    await settle('desk-chat', { hours: ALL_DAY });
    const inHours = await call('POST', '/x/chat/api/desk-chat/question', {
      payload: { language: 'en-US', question: 'Are you there?', email: 'sam@example.org' },
      headers: { 'x-adminium-proof': await proof('desk-chat') },
      ip: nextIp(),
    });
    expect(inHours.statusCode).toBe(409);
    expect(await count(conversations)).toBe(was + 1);
    await settle('desk-chat', { hours: null });
  });

  it.skipIf(!available || dialect !== 'postgres')('a bigint messages key keeps every digit through the cursor', async () => {
    const messages = table('live-chat', 'messages');
    const sequence = (await rows(`SELECT pg_get_serial_sequence('${messages}', 'id') AS name`))[0]!['name'] as string;
    await rows(`ALTER SEQUENCE ${sequence} RESTART WITH 9007199254740993`);
    const a = await started('Big numbers');
    expect(a.cursor).toBe('9007199254740993');
    await post(a.token as string, { body: 'Next one' });
    const after = (await poll(a.token as string, a.cursor as string)).json() as Doc;
    expect(after.messages).toEqual([expect.objectContaining({ id: '9007199254740994', body: 'Next one' })]);
    expect(((await poll(a.token as string, after.cursor as string)).json() as Doc).messages).toEqual([]);
  });
});
