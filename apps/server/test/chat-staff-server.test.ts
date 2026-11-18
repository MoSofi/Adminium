// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A WEBSITE CHAT FOR STAFF, ON THE REAL SERVER: a live chat add-on attached
 * to a CRM-like app that opens its enquiries to a chat, on SQLite, Postgres
 * and MySQL. Every act is tried as a person who may and one who may not.
 *
 *  - take: the taker's line, "Sam is answering" for a colleague, `force`;
 *  - reply: a waiting chat is taken first; who wrote it and whether it was a
 *    Milo draft; the visitor's window hears it; a chat with the automatic
 *    answers is refused;
 *  - the reply by mail: only once the visitor left the page (or the question
 *    came outside hours) and gave an address; the mail holds the business's
 *    name and the reply, never the visitor's words or a link back; three a
 *    day; refused with its reason while mail is blocked, the reply kept;
 *  - presence and the `left` line: written once, on a staff read, dated at
 *    the last heartbeat, never sent to the visitor;
 *  - close and reopen, each with its line; the visitor writes again;
 *  - "Make an enquiry": the person's own create, pre-filled, source `chat`,
 *    never `may_email`; linked back; refused without create on enquiries, a
 *    second time, and on a chat no app opens a table to;
 *  - "Draft with Milo": only while drafting is on, for a Milo user, on their
 *    allowance, with the transcript and answers only;
 *  - the breaker: its pause read, and resumed by a settings manager only;
 *  - "a chat is waiting": one notice per conversation until it is opened,
 *    the bell alone by default; the chat kinds and the forms kinds listed;
 *  - a person's create or change of a conversation through the data routes
 *    is refused: Adminium alone writes them.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ProviderClient } from '@adminium/llm';
import { formMarksRepo, paymentSettingsRepo, permissionsRepo, rolesRepo, settingsRepo, usersRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { chatAddOn } from '../../../packages/manifest/test/chat-fixture.js';
import { recordDeciderTrust } from '../src/add-ons/decider-trust.js';
import type { ChatAi } from '../src/chat/ai.js';
import type { ChatAnswerer } from '../src/chat/answering.js';
import { chatSubject } from '../src/chat/caps.js';
import type { LiveChat } from '../src/chat/catalog.js';
import { mailChatReply } from '../src/chat/reply-mail.js';
import { composeServer, type ComposedServer } from '../src/compose.js';
import { readInstant } from '../src/crud/moments.js';
import { decryptSecret, encryptSecret } from '../src/config/secrets.js';
import { emailSecretKey } from '../src/email/config.js';
import { emailEnvelopeKey } from '../src/email/send.js';
import type { AiConnection } from '../src/llm/connections.js';
import { createApplyService } from '../src/llm/apply-service.js';
import { createRunService } from '../src/llm/run-service.js';
import { solveProof } from '../src/public-api/proof.js';
import { matrixRowsFromGrants } from '../src/rbac/permissions.js';
import { PAY_PAGE_DOC, payPageSchema } from '../src/routes/payments/ways.js';
import { addOnHarness, type Harness } from './app-add-ons.helpers.js';
import { adminPasswordHash, ADMIN_PASSWORD, sessionCookie } from './auth-helpers.js';
import { makeEnv, TEST_SECRET } from './helpers.js';
import { LEGS } from './invoicing-install.helpers.js';

type Doc = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- a reply read freely

const HOST = 'chat.meridian.example';
const ORIGIN = `https://${HOST}`;
const pk = { ref: 'id', type: 'int', role: 'pk' };
const text = (ref: string, maxLength: number, more: Record<string, unknown> = {}) => ({ ref, type: 'text', maxLength, ...more });
const VISITOR_WORDS = 'My budget is 40k and my phone is 0151 2345 678, can you call?';
const ALL_DAY = { sun: [['00:00', '24:00']], mon: [['00:00', '24:00']], tue: [['00:00', '24:00']], wed: [['00:00', '24:00']], thu: [['00:00', '24:00']], fri: [['00:00', '24:00']], sat: [['00:00', '24:00']] };
const CONNECTION: AiConnection = { id: 'database', provider: 'anthropic', source: 'database', baseUrl: null, hasKey: true, model: 'claude-test' };

/** A CRM-like app whose enquiries a chat may become, by a question left outside hours or "Make an enquiry". */
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
            { ref: 'message', type: 'text', nullable: true },
            { ref: 'state', type: 'enum', enum: ['open', 'claimed', 'closed'], default: 'open' },
            { ref: 'source', type: 'enum', enum: ['form', 'phone', 'show', 'chat'], nullable: true },
            { ref: 'may_email', type: 'bool', default: false },
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
        anonymous: { plainText: ['person'], perIpHour: 50 },
      },
    ],
    pages: [{ ref: 'crm-enquiries', template: 'page-crud', title: { key: 't', fallback: 'Enquiries' }, nav: { group: 'crm', icon: 'home', order: 1 }, bindings: { rows: 'enquiries' } }],
    frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html' }],
  };
}

describe.each(LEGS)('a website chat for staff — %s', (dialect, available) => {
  let h: Harness;
  let composed: ComposedServer;
  let root: string;
  const tables: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const cookies: Record<string, string> = {};
  let seq = 0;
  let signIns = 0;
  const ai: ChatAi = { usable: true, service: 'Anthropic' };
  const answerer: ChatAnswerer = { pick: async () => ({ kind: 'hand-over', outcome: 'hand-over' }) };
  const asked: Parameters<ProviderClient['complete']>[0][] = [];
  const model: ProviderClient = {
    id: 'anthropic',
    listModels: async () => [],
    test: async () => ({ ok: true, model: 'claude-test', latencyMs: 1 }),
    async complete(request) {
      asked.push(request);
      return { text: 'Thanks for asking. A colleague will call you back today.', usage: { inputTokens: 300, outputTokens: 20 } };
    },
  };

  const table = (app: string, ref: string) => tables[`${app}:${ref}`]!;
  const rows = (statement: string) => h.rows(statement) as Promise<Doc[]>;
  const nextIp = () => {
    seq += 1;
    return `198.51.${String(Math.floor(seq / 200))}.${String(seq % 200)}`;
  };
  /** A visitor's request to the door. */
  const door = (method: 'GET' | 'POST', url: string, opts: { payload?: unknown; headers?: Record<string, string>; ip?: string } = {}) =>
    composed.app.inject({ method, url, remoteAddress: opts.ip ?? '203.0.113.50', headers: { host: HOST, origin: ORIGIN, ...(opts.headers ?? {}) }, ...(opts.payload === undefined ? {} : { payload: opts.payload as Doc }) });
  /** A signed-in person's request. */
  const as = (who: string, method: 'GET' | 'POST' | 'PATCH', url: string, payload?: unknown) =>
    composed.app.inject({ method, url, headers: { cookie: cookies[who]! }, ...(payload === undefined ? {} : { payload: payload as Doc }) });
  const staff = (who: string, id: string, act: string, payload: unknown = {}, addOn = 'live-chat') => as(who, act === 'presence' ? 'GET' : 'POST', `/api/v1/chat/${addOn}/conversations/${id}/${act}`, act === 'presence' ? undefined : payload);
  const proof = async (): Promise<string> => {
    const challenge = (await door('POST', '/x/chat/api/live-chat/challenge', { payload: {} })).json() as Doc;
    return `${challenge.id as string}.${solveProof(challenge.salt as string, challenge.difficulty as number)}`;
  };
  /** A visitor starts a chat; answers its token, cursor and conversation id. */
  const started = async (body = 'Do you have booths in stock?', more: Doc = {}): Promise<{ token: string; cursor: string; id: string }> => {
    const answer = await door('POST', '/x/chat/api/live-chat/start', { payload: { language: 'en-US', body, ...more }, headers: { 'x-adminium-proof': await proof() }, ip: nextIp() });
    expect(answer.statusCode, answer.body).toBe(200);
    const doc = answer.json() as Doc;
    const id = String((await rows(`SELECT MAX(id) AS id FROM ${table('live-chat', 'conversations')}`))[0]!['id']);
    return { token: doc.token as string, cursor: doc.cursor as string, id };
  };
  const visitorSays = (token: string, body: string) => door('POST', '/x/chat/api/live-chat/messages', { payload: { token, body } });
  const poll = (token: string, after = '0') => door('GET', `/x/chat/api/live-chat/messages?after=${after}`, { headers: { 'x-adminium-chat': token } });
  const chatOf = async (addOn = 'live-chat'): Promise<LiveChat> => (await composed.chat.catalog.forStaff(addOn))!;
  const conversation = async (id: string) => (await rows(`SELECT * FROM ${table('live-chat', 'conversations')} WHERE id = ${id}`))[0]!;
  const messages = async (id: string) => rows(`SELECT * FROM ${table('live-chat', 'messages')} WHERE conversation_id = ${id} ORDER BY id`);
  /** The visitor's last heartbeat moved into the past: they left the page `minutes` ago. */
  const leftAgo = async (id: string, minutes: number) => composed.chat.store.update(await chatOf(), id, { lastVisitorAt: Date.now() - minutes * 60_000 });
  /** The mails queued since the last look, opened. */
  const mails = async (): Promise<{ to: string; subject: string; html: string; text: string; templateKey: string }[]> => {
    const queued = await h.meta.db.selectFrom('adminium_jobs').select(['id', 'payload']).where('kind', '=', 'email.send').where('status', '=', 'pending').orderBy('createdAt', 'asc').execute();
    for (const row of queued) await h.meta.db.updateTable('adminium_jobs').set({ status: 'cancelled' } as never).where('id', '=', row.id).execute();
    return queued.map((row) => {
      const payload = (typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload) as { envelope: string; templateKey: string };
      return { ...(JSON.parse(decryptSecret(payload.envelope, emailEnvelopeKey(TEST_SECRET))) as { to: string; subject: string; html: string; text: string }), templateKey: payload.templateKey };
    });
  };
  const smtp = () => ({ host: '127.0.0.1', port: 9, user: 'postmaster', passEncrypted: encryptSecret('not-a-real-password', emailSecretKey(TEST_SECRET)), from: 'Desk <no-reply@desk.test>', secure: false });

  /** Someone with these grants (and a name), signed in. */
  async function person(key: string, name: string, grants: string[]): Promise<void> {
    const user = await usersRepo(h.meta).create({ email: `${key}@meridian.example`, name, passwordHash: await adminPasswordHash() });
    ids[key] = user.id;
    const role = await rolesRepo(h.meta).create({ slug: `chat-${key}`, name: `Chat ${key}` });
    for (const row of matrixRowsFromGrants(grants).rows) await permissionsRepo(h.meta).grant(role.id, row.resourceKind, row.resourceRef, row.actions as never);
    await rolesRepo(h.meta).assignToUser(user.id, role.id);
    signIns += 1;
    const res = await composed.app.inject({ method: 'POST', url: '/api/v1/auth/login', remoteAddress: `10.7.${String(Math.floor(signIns / 250))}.${String(signIns % 250)}`, payload: { email: `${key}@meridian.example`, password: ADMIN_PASSWORD } });
    expect(res.statusCode, res.body).toBe(200);
    cookies[key] = sessionCookie(res.headers['set-cookie']);
  }

  beforeAll(async () => {
    if (!available) return;
    h = await addOnHarness(dialect, { unbuiltWords: {} });
    await h.stageApp(crm());
    expect((await h.install('crm', '1.0.0')).statusCode).toBe(200);
    await h.stageAddOn(chatAddOn(), { bundled: true });
    expect((await h.inject({ method: 'POST', url: '/add-ons', payload: { key: 'live-chat', version: '1.0.0', attachTo: ['crm'] } })).statusCode).toBe(200);
    // A second chat with no app to make an enquiry in.
    await h.stageAddOn({ ...chatAddOn(), key: 'desk-chat', name: 'Desk chat' }, { bundled: true });
    expect((await h.inject({ method: 'POST', url: '/add-ons', payload: { key: 'desk-chat', version: '1.0.0', attachTo: ['dashboard'] } })).statusCode).toBe(200);
    for (const key of ['live-chat', 'desk-chat']) await recordDeciderTrust(h.meta, { key, version: '1.0.0', integrity: (await h.addOnStore.verifyTree(key, '1.0.0')).integrity });
    for (const record of await h.meta.db.selectFrom('adminium_app_tables').select(['appKey', 'ref', 'tableName']).execute()) tables[`${record.appKey}:${record.ref}`] = record.tableName;

    // Open all day: a chat is in hours, so a reply is mailed only once the visitor left.
    const { db } = await h.manager.data(h.connectionId);
    const settingsTable = table('live-chat', 'chat_settings');
    if (Number((await rows(`SELECT COUNT(*) AS n FROM ${settingsTable}`))[0]!['n']) === 0) await db.insertInto(settingsTable as never).values({ theme: 'light' } as never).execute();
    await db.updateTable(settingsTable as never).set({ hours: JSON.stringify(ALL_DAY) } as never).execute();

    const settings = settingsRepo(h.meta);
    await settings.set('system.publicOrigin', ORIGIN, { updatedBy: null });
    await settings.set('privacy.businessName', 'Meridian Workplace Ltd', { updatedBy: null });
    await settings.set('privacy.noticeUrl', 'https://www.meridian.example/privacy', { updatedBy: null });
    await settings.set('email.smtp', smtp(), { updatedBy: null });
    await paymentSettingsRepo(h.meta).set(PAY_PAGE_DOC, payPageSchema, { shopName: 'Meridian', logoFileId: null, contactEmail: 'hello@meridian.example', contactPhone: null, shopCountry: 'GB', showLines: false });

    root = await mkdtemp(join(tmpdir(), 'chat-staff-'));
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
      chatSeams: {
        ai: async () => ai,
        answerer,
        drafts: {
          default: async () => ({ connection: CONNECTION, model: 'claude-test' }),
          refusal: () => null,
          client: async () => ({ client: model, provider: 'anthropic', model: 'claude-test', baseUrl: null, maxOutputTokens: 1000 }),
        },
      },
    });
    await composed.app.ready();
    await composed.addOnsLoaded;
    await composed.jobs.worker.stop();
    composed.jobs.scheduler.stop();

    const conn = h.connectionId;
    // Grants name a table by its id in the snapshot (schema-qualified), as the routes check them.
    const live = await chatOf();
    const idOf = (app: string, ref: string) => live.view.table(table(app, ref)).id;
    const t = (app: string, ref: string, ...actions: string[]) => actions.map((action) => `table:${conn}:${idOf(app, ref)}:${action}`);
    await person('avery', 'Avery Stone', [...t('live-chat', 'conversations', 'read', 'update'), ...t('live-chat', 'messages', 'read'), ...t('live-chat', 'chat_settings', 'read'), ...t('crm', 'enquiries', 'read', 'create'), 'system:assistant:use']);
    await person('sam', 'Sam Okafor', [...t('live-chat', 'conversations', 'read', 'update'), ...t('live-chat', 'messages', 'read'), 'system:assistant:use']);
    await person('vic', 'Vic Reader', [...t('live-chat', 'conversations', 'read'), ...t('live-chat', 'messages', 'read'), ...t('live-chat', 'chat_settings', 'read'), ...t('crm', 'enquiries', 'read', 'create'), 'system:assistant:use']);
    await person('nora', 'Nora Field', [...t('live-chat', 'conversations', 'read', 'update'), ...t('live-chat', 'messages', 'read'), ...t('crm', 'enquiries', 'read')]);
    await person('seth', 'Seth Admin', [...t('live-chat', 'chat_settings', 'read', 'update')]);
  }, 300_000);

  afterAll(async () => {
    if (!available) return;
    await composed?.app.close();
    await h?.close();
    if (root !== undefined) await rm(root, { recursive: true, force: true });
  });

  it.skipIf(!available)('take: refused to a reader; the taker’s line reaches the visitor; a colleague is told who answers, unless forced', async () => {
    const chat = await started('Two booths please');
    expect((await staff('vic', chat.id, 'take')).statusCode).toBe(403);
    expect((await staff('seth', chat.id, 'take')).statusCode).toBe(403);
    const taken = await staff('avery', chat.id, 'take');
    expect(taken.statusCode, taken.body).toBe(200);
    expect((taken.json() as Doc).data).toMatchObject({ id: chat.id, state: 'open', takenBy: { id: ids['avery'], firstName: 'Avery', initials: 'AS' } });
    expect(await conversation(chat.id)).toMatchObject({ state: 'open', taken_by: ids['avery'] });
    const seen = (await poll(chat.token, chat.cursor)).json() as Doc;
    expect(seen).toMatchObject({ state: 'open', staff: true });
    expect(seen.messages).toEqual([expect.objectContaining({ kind: 'system', event: 'taken', author: { firstName: 'Avery', initials: 'AS' } })]);

    const busy = await staff('sam', chat.id, 'take');
    expect(busy.statusCode).toBe(409);
    expect((busy.json() as Doc).error).toMatchObject({ message: 'Avery is answering this chat.', details: { reason: 'taken', by: { firstName: 'Avery' } } });
    expect((await staff('sam', chat.id, 'reply', { body: 'Hi' })).statusCode).toBe(409);
    const forced = await staff('sam', chat.id, 'take', { force: true });
    expect(forced.statusCode).toBe(200);
    expect((forced.json() as Doc).data.takenBy.firstName).toBe('Sam');
    // A conversation that is not there, and one of another chat's, is not found.
    expect((await staff('avery', '999999', 'take')).statusCode).toBe(404);
  });

  it.skipIf(!available)('reply: refused to a reader; a waiting chat is taken first; who wrote it and a Milo draft are kept; the visitor reads it', async () => {
    const chat = await started('Do you deliver to Leeds?');
    expect((await staff('vic', chat.id, 'reply', { body: 'Yes' })).statusCode).toBe(403);
    expect((await messages(chat.id)).filter((row) => row['kind'] === 'staff')).toHaveLength(0);
    expect((await staff('avery', chat.id, 'reply', { body: '   ' })).statusCode).toBe(422);
    expect((await staff('avery', chat.id, 'reply', { body: 'a'.repeat(2001) })).statusCode).toBe(422);
    const replied = await staff('avery', chat.id, 'reply', { body: 'Yes, we deliver to Leeds.', drafted: true });
    expect(replied.statusCode, replied.body).toBe(200);
    const data = (replied.json() as Doc).data;
    expect(data).toMatchObject({ presence: 'on-page', mailed: false, reason: null, message: { kind: 'staff', body: 'Yes, we deliver to Leeds.', authorId: ids['avery'], drafted: true, mailedAt: null }, conversation: { state: 'open', takenBy: { firstName: 'Avery' } } });
    const stored = await messages(chat.id);
    expect(stored.map((row) => row['event'] ?? row['kind'])).toEqual(['visitor', 'taken', 'staff']);
    expect((await conversation(chat.id))['last_staff_at']).not.toBeNull();
    const seen = ((await poll(chat.token, chat.cursor)).json() as Doc).messages as Doc[];
    expect(seen.map((one) => one.event ?? one.body)).toEqual(['taken', 'Yes, we deliver to Leeds.']);
    expect(seen[1]).toMatchObject({ kind: 'staff', author: { firstName: 'Avery', initials: 'AS' } });
    // The automatic answers' chat is taken first, never answered over their heads.
    const bot = await composed.chat.store.start(await chatOf(), { state: 'bot', language: 'en-US', cameFrom: null, outsideHours: false, first: { kind: 'visitor', body: 'Hours?' } });
    expect(((await staff('avery', bot.conversation.id, 'reply', { body: 'Hi' })).json() as Doc).error.details.reason).toBe('automatic');
  });

  it.skipIf(!available)('the reply by mail: only once the visitor left; the business’s name and the reply, never their words; three a day', async () => {
    const chat = await started(VISITOR_WORDS);
    await door('POST', '/x/chat/api/live-chat/details', { payload: { token: chat.token, name: 'Marta Kovac', email: 'marta@cobalt.example' } });
    await mails();
    // On the page: read there, nothing mailed.
    expect(((await staff('avery', chat.id, 'reply', { body: 'Let me check.' })).json() as Doc).data).toMatchObject({ presence: 'on-page', mailed: false, reason: null });
    expect(await mails()).toEqual([]);
    await leftAgo(chat.id, 5);
    const presence = ((await staff('avery', chat.id, 'presence')).json() as Doc).data;
    expect(presence).toMatchObject({ presence: 'left', mail: { ready: true, reason: null, used: 0, max: 3 } });
    const replied = ((await staff('avery', chat.id, 'reply', { body: 'We can call you at 3pm on Thursday.' })).json() as Doc).data;
    expect(replied).toMatchObject({ presence: 'left', mailed: true, reason: null, message: { mailedAt: expect.any(String) } });
    const [mail, ...more] = await mails();
    expect(more).toEqual([]);
    expect(mail).toMatchObject({ to: 'marta@cobalt.example', templateKey: 'chat-reply' });
    expect(mail!.subject).toContain('Meridian');
    expect(mail!.text).toContain('We can call you at 3pm on Thursday.');
    // Never the visitor's words, the conversation, the earlier reply or a way back into it.
    for (const said of [mail!.html, mail!.text, mail!.subject]) {
      expect(said).not.toContain('budget is 40k');
      expect(said).not.toContain('0151');
      expect(said).not.toContain('Let me check.');
      expect(said).not.toContain('Marta');
      expect(said).not.toContain('/x/chat');
    }
    expect((await messages(chat.id)).filter((row) => row['mailed_at'] !== null)).toHaveLength(1);
    // Two more in the day, then the day's three are used: the reply is kept and the answer says why.
    for (const body of ['Second', 'Third']) expect(((await staff('avery', chat.id, 'reply', { body })).json() as Doc).data.mailed).toBe(true);
    const fourth = ((await staff('avery', chat.id, 'reply', { body: 'Fourth' })).json() as Doc).data;
    expect(fourth).toMatchObject({ mailed: false, reason: 'cap', message: { body: 'Fourth', mailedAt: null } });
    expect(await mails()).toHaveLength(2);
    expect(((await staff('avery', chat.id, 'presence')).json() as Doc).data.mail).toMatchObject({ ready: false, reason: 'cap', used: 3 });
    // No address given: nothing to mail, said so.
    const quiet = await started('No address here');
    await staff('avery', quiet.id, 'take');
    await leftAgo(quiet.id, 5);
    expect(((await staff('avery', quiet.id, 'reply', { body: 'Hello?' })).json() as Doc).data).toMatchObject({ presence: 'left', mailed: false, reason: 'no-email' });
    // A sample conversation sends nothing.
    expect(await mailChatReply({ meta: h.meta, secret: TEST_SECRET, caps: composed.chat.caps, chat: await chatOf(), conversation: { id: quiet.id, email: 'x@y.example', language: 'en-US' }, reply: 'Hi', sample: true, at: Date.now() })).toEqual({ mailed: false, reason: 'sample' });
    expect(await mails()).toEqual([]);
  });

  it.skipIf(!available)('mail blocked: the reply is written and the answer gives the block’s reason', async () => {
    const settings = settingsRepo(h.meta);
    const chat = await started('Are you open Saturday?');
    await door('POST', '/x/chat/api/live-chat/details', { payload: { token: chat.token, email: 'pat@harbour.example' } });
    await staff('avery', chat.id, 'take');
    await leftAgo(chat.id, 10);
    await mails();
    await settings.set('email.smtp', null as never, { updatedBy: null });
    try {
      expect(((await staff('avery', chat.id, 'presence')).json() as Doc).data.mail).toMatchObject({ ready: false, reason: 'no-mail-server' });
      const blocked = ((await staff('avery', chat.id, 'reply', { body: 'Yes, 10 to 4.' })).json() as Doc).data;
      expect(blocked).toMatchObject({ mailed: false, reason: 'no-mail-server', message: { body: 'Yes, 10 to 4.' } });
    } finally {
      await settings.set('email.smtp', smtp(), { updatedBy: null });
    }
    await settings.set('system.publicOrigin', null as never, { updatedBy: null });
    try {
      expect(((await staff('avery', chat.id, 'reply', { body: 'And Sunday 11 to 3.' })).json() as Doc).data).toMatchObject({ mailed: false, reason: 'no-public-origin' });
    } finally {
      await settings.set('system.publicOrigin', ORIGIN, { updatedBy: null });
    }
    expect((await messages(chat.id)).filter((row) => row['kind'] === 'staff').map((row) => row['body'])).toEqual(['Yes, 10 to 4.', 'And Sunday 11 to 3.']);
    expect(await mails()).toEqual([]);
  });

  it.skipIf(!available)('a question left outside hours is mailed whether or not the visitor is on the page', async () => {
    const chat = await composed.chat.store.start(await chatOf(), { state: 'waiting', language: 'de-DE', cameFrom: null, outsideHours: true, email: 'jan@hafen.example', first: { kind: 'visitor', body: 'Habt ihr Kabinen?' } });
    await mails();
    const replied = ((await staff('avery', chat.conversation.id, 'reply', { body: 'Ja, ab Montag.' })).json() as Doc).data;
    expect(replied).toMatchObject({ presence: 'on-page', mailed: true });
    const [mail] = await mails();
    expect(mail).toMatchObject({ to: 'jan@hafen.example', templateKey: 'chat-reply' });
    expect(mail!.text).toContain('Ja, ab Montag.');
    expect(mail!.text).not.toContain('Kabinen');
  });

  it.skipIf(!available)('presence and the left line: written once on a staff read, dated at the last heartbeat, never sent to the visitor', async () => {
    const chat = await started('Hello?');
    expect((await staff('seth', chat.id, 'presence')).statusCode).toBe(403);
    expect(((await staff('vic', chat.id, 'presence')).json() as Doc).data).toMatchObject({ presence: 'on-page', conversation: { state: 'waiting' } });
    expect((await messages(chat.id)).some((row) => row['event'] === 'left')).toBe(false);
    const gone = (await leftAgo(chat.id, 4))!;
    const read = ((await staff('vic', chat.id, 'presence')).json() as Doc).data;
    expect(read).toMatchObject({ presence: 'left', lastVisitorAt: new Date(gone.lastVisitorAt!).toISOString() });
    await staff('vic', chat.id, 'presence');
    const lines = (await messages(chat.id)).filter((row) => row['event'] === 'left');
    expect(lines).toHaveLength(1);
    // Read as the store reads a moment (each engine's own spelling).
    const at = readInstant(lines[0]!['sent_at'])!.getTime();
    // Dated at the last heartbeat, never at the read (a second either way for an engine's precision).
    expect(Math.abs(at - gone.lastVisitorAt!)).toBeLessThan(1500);
    // The visitor's window never reads it.
    expect(((await poll(chat.token)).json() as Doc).messages.map((one: Doc) => one.event ?? one.kind)).toEqual(['visitor']);
  });

  it.skipIf(!available)('close and reopen: refused to a reader; each with its line; the visitor writes again after a reopen', async () => {
    const chat = await started('Can I visit?');
    await staff('avery', chat.id, 'take');
    expect((await staff('vic', chat.id, 'close')).statusCode).toBe(403);
    const closed = await staff('avery', chat.id, 'close');
    expect((closed.json() as Doc).data).toMatchObject({ state: 'closed', closedAt: expect.any(String) });
    expect((await visitorSays(chat.token, 'Hello?')).statusCode).toBe(409);
    expect((await staff('avery', chat.id, 'reply', { body: 'x' })).statusCode).toBe(409);
    expect((await staff('vic', chat.id, 'reopen')).statusCode).toBe(403);
    expect((await staff('avery', chat.id, 'take')).statusCode).toBe(409);
    const reopened = await staff('sam', chat.id, 'reopen');
    expect((reopened.json() as Doc).data).toMatchObject({ state: 'open', closedAt: null, takenBy: { firstName: 'Sam' } });
    expect((await staff('sam', chat.id, 'reopen')).statusCode).toBe(409);
    expect((await visitorSays(chat.token, 'Thanks for reopening')).statusCode).toBe(200);
    const seen = ((await poll(chat.token, chat.cursor)).json() as Doc).messages as Doc[];
    expect(seen.map((one) => one.event ?? one.body)).toEqual(['taken', 'closed', 'reopened', 'Thanks for reopening']);
    expect(seen[2]).toMatchObject({ author: { firstName: 'Sam', initials: 'SO' } });
  });

  it.skipIf(!available)('Make an enquiry: the person’s own create, pre-filled, source chat, never may_email; refused without the rights, twice, and with no table', async () => {
    const chat = await started('We need ten booths for a new office.');
    await door('POST', '/x/chat/api/live-chat/details', { payload: { token: chat.token, name: 'Marta Kovac', email: 'marta@cobalt.example' } });
    const enquiries = table('crm', 'enquiries');
    const before = (await rows(`SELECT COUNT(*) AS n FROM ${enquiries}`))[0]!['n'];
    expect((await staff('vic', chat.id, 'enquiry')).statusCode).toBe(403);
    const nora = await staff('nora', chat.id, 'enquiry');
    expect(nora.statusCode).toBe(403);
    expect((nora.json() as Doc).error.details.reason).toBe('enquiry-create');
    expect((await rows(`SELECT COUNT(*) AS n FROM ${enquiries}`))[0]!['n']).toEqual(before);
    const made = await staff('avery', chat.id, 'enquiry');
    expect(made.statusCode, made.body).toBe(200);
    const became = (made.json() as Doc).data.became as Doc;
    expect(became).toMatchObject({ table: 'crm:enquiries', key: expect.any(String) });
    const row = (await rows(`SELECT * FROM ${enquiries} WHERE id = ${became.key as string}`))[0]!;
    expect(row).toMatchObject({ person: 'Marta Kovac', email: 'marta@cobalt.example', message: 'We need ten booths for a new office.', source: 'chat' });
    expect([false, 0, '0', 'false']).toContain(row['may_email']);
    expect(await conversation(chat.id)).toMatchObject({ became_table: 'crm:enquiries', became_key: became.key });
    expect((await messages(chat.id)).some((one) => one['event'] === 'enquiry' && one['author_id'] === ids['avery'])).toBe(true);
    // The line is staff's own: the visitor never reads it.
    expect(((await poll(chat.token)).json() as Doc).messages.some((one: Doc) => one.event === 'enquiry')).toBe(false);
    const again = await staff('avery', chat.id, 'enquiry');
    expect((again.json() as Doc).error.details.reason).toBe('already');
    // A chat no app opens a table to says what is missing.
    const desk = await composed.chat.store.start((await chatOf('desk-chat'))!, { state: 'waiting', language: 'en-US', cameFrom: null, outsideHours: false, first: { kind: 'visitor', body: 'Hi' } });
    const deskId = (await chatOf('desk-chat')).conversations.table.id;
    const grantDesk = matrixRowsFromGrants([`table:${h.connectionId}:${deskId}:read`, `table:${h.connectionId}:${deskId}:update`]).rows;
    const role = (await rolesRepo(h.meta).findBySlug('chat-avery'))!;
    for (const one of grantDesk) await permissionsRepo(h.meta).grant(role.id, one.resourceKind, one.resourceRef, one.actions as never);
    const none = await staff('avery', desk.conversation.id, 'enquiry', {}, 'desk-chat');
    expect(none.statusCode).toBe(409);
    expect((none.json() as Doc).error.details.reason).toBe('no-table');
  });

  it.skipIf(!available)('Draft with Milo: only while drafting is on, for a Milo user who may answer, with the transcript and the answers only', async () => {
    const chat = await started(VISITOR_WORDS);
    await door('POST', '/x/chat/api/live-chat/details', { payload: { token: chat.token, name: 'Marta Kovac', email: 'marta@cobalt.example' } });
    const off = await staff('avery', chat.id, 'draft');
    expect(off.statusCode).toBe(409);
    expect((off.json() as Doc).error.details.reason).toBe('off');
    const { db } = await h.manager.data(h.connectionId);
    await db.updateTable(table('live-chat', 'chat_settings')).set({ milo_drafts: dialect === 'postgres' ? true : 1 } as never).execute();
    if ((await rows(`SELECT COUNT(*) AS n FROM ${table('live-chat', 'chat_settings')}`))[0]!['n'] == 0) {
      await db.insertInto(table('live-chat', 'chat_settings')).values({ milo_drafts: dialect === 'postgres' ? true : 1 } as never).execute();
    }
    expect((await staff('vic', chat.id, 'draft')).statusCode).toBe(403);
    expect((await staff('nora', chat.id, 'draft')).statusCode).toBe(403);
    asked.length = 0;
    const drafted = await staff('avery', chat.id, 'draft');
    expect(drafted.statusCode, drafted.body).toBe(200);
    expect((drafted.json() as Doc).data).toEqual({ draft: 'Thanks for asking. A colleague will call you back today.', tokens: 320 });
    expect(asked).toHaveLength(1);
    const sent = JSON.stringify(asked[0]);
    expect(sent).toContain('budget is 40k');
    // The visitor's address, phone and typed name never go; nothing is sent of a row.
    expect(sent).not.toContain('0151');
    expect(sent).not.toContain('marta@cobalt.example');
    expect(sent).not.toContain('Kovac');
    expect(asked[0]!).not.toHaveProperty('tools');
    // Nothing was sent to the visitor.
    expect((await messages(chat.id)).filter((row) => row['kind'] === 'staff')).toEqual([]);
    // The person's own allowance: used up, refused.
    await settingsRepo(h.meta).set('assistant.dailyTokens', 100, { updatedBy: null });
    try {
      const spent = await staff('avery', chat.id, 'draft');
      expect(spent.statusCode).toBe(429);
      expect((spent.json() as Doc).error.details.reason).toBe('allowance');
    } finally {
      await settingsRepo(h.meta).set('assistant.dailyTokens', 500_000, { updatedBy: null });
    }
  });

  it.skipIf(!available)('the breaker: its pause read by a settings reader, resumed by a settings manager only', async () => {
    expect((await as('avery', 'GET', '/api/v1/chat/live-chat/pause')).json()).toEqual({ data: { pausedUntil: null } });
    expect((await as('seth', 'POST', '/api/v1/chat/live-chat/resume', {})).json()).toEqual({ data: { resumed: false } });
    await formMarksRepo(h.meta).mark({ subject: chatSubject('live-chat'), purpose: 'chat-pause' }, Date.now());
    expect(((await as('avery', 'GET', '/api/v1/chat/live-chat/pause')).json() as Doc).data.pausedUntil).toEqual(expect.any(String));
    expect((await as('sam', 'GET', '/api/v1/chat/live-chat/pause')).statusCode).toBe(403);
    expect((await as('avery', 'POST', '/api/v1/chat/live-chat/resume', {})).statusCode).toBe(403);
    expect((await as('vic', 'POST', '/api/v1/chat/live-chat/resume', {})).statusCode).toBe(403);
    expect((await as('seth', 'POST', '/api/v1/chat/live-chat/resume', {})).json()).toEqual({ data: { resumed: true } });
    expect((await as('avery', 'GET', '/api/v1/chat/live-chat/pause')).json()).toEqual({ data: { pausedUntil: null } });
    expect((await door('GET', '/x/chat/api/live-chat/config')).statusCode).toBe(200);
  });

  it.skipIf(!available)('a chat is waiting: ten messages make one notice; opened, the next message makes another; the bell alone by default', async () => {
    const notices = async (id: string) =>
      (await h.meta.db.selectFrom('adminium_notifications').selectAll().where('userId', '=', ids['avery']!).where('kind', '=', 'chat.waiting').execute()).filter((row) => String(row.actionUrl).endsWith(`conversation=${id}`));
    await mails();
    const chat = await started('First');
    for (let n = 0; n < 9; n += 1) expect((await visitorSays(chat.token, `More ${String(n)}`)).statusCode).toBe(200);
    await composed.chat.waiting.settled();
    expect(await notices(chat.id)).toHaveLength(1);
    // Sam and Vic read the conversations too; Seth does not.
    for (const who of ['sam', 'vic']) expect((await h.meta.db.selectFrom('adminium_notifications').select('id').where('userId', '=', ids[who]!).where('kind', '=', 'chat.waiting').where('actionUrl', 'like', `%conversation=${chat.id}`).execute()).length).toBe(1);
    expect(await h.meta.db.selectFrom('adminium_notifications').select('id').where('userId', '=', ids['seth']!).where('kind', '=', 'chat.waiting').execute()).toEqual([]);
    // The bell alone: nobody switched e-mail on for it.
    expect((await mails()).filter((mail) => mail.templateKey === 'notification')).toEqual([]);
    // Opened (its page reads the presence), then the visitor writes again: a second notice.
    await staff('vic', chat.id, 'presence');
    await visitorSays(chat.token, 'Hello? Anyone?');
    await composed.chat.waiting.settled();
    expect(await notices(chat.id)).toHaveLength(2);
    // Taken, it is a person's: the visitor's messages tell nobody.
    await staff('avery', chat.id, 'take');
    await visitorSays(chat.token, 'Thanks');
    await composed.chat.waiting.settled();
    expect(await notices(chat.id)).toHaveLength(2);
    // The prefs list both chat kinds and both forms kinds; the waiting one mails nobody until switched on.
    const prefs = ((await as('avery', 'GET', '/api/v1/me/notification-prefs')).json() as Doc).data.events as Doc[];
    for (const key of ['chat.waiting', 'chat.paused', 'chat.budget', 'forms.answer', 'forms.limit']) expect(prefs.map((one) => one.key)).toContain(key);
    expect(prefs.find((one) => one.key === 'chat.waiting')!.channels).toMatchObject({ inApp: true, email: false });
    expect(prefs.find((one) => one.key === 'chat.paused')!.channels).toMatchObject({ inApp: true, email: true });
  });

  it.skipIf(!available)('a person’s create or change of a conversation through the data routes is refused: Adminium alone writes them', async () => {
    const chat = await started('Write around?');
    const url = `/api/v1/data/${h.connectionId}/${encodeURIComponent((await chatOf()).conversations.table.id)}`;
    const changed = await as('avery', 'PATCH', `${url}/${chat.id}`, { values: { state: 'closed' } });
    expect(changed.statusCode).toBe(403);
    expect((changed.json() as Doc).error.details).toMatchObject({ reason: 'adminium-writes' });
    expect((await conversation(chat.id))['state']).toBe('waiting');
  });
});
