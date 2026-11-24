// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Two-way conversations on every engine: the real send path, the real inbound
 * channel and door, the real thread store and the real routes under the real
 * grants. Only the provider is a stub, written from its public documentation,
 * so this proves how the parts meet and cannot prove the live APIs.
 */
import { createHmac, randomUUID } from 'node:crypto';

import { apiKeysRepo, auditRepo, BUILTIN_ROLES, permissionsRepo, rolesRepo, settingsRepo, usersRepo, type EnqueueJobInput, type User } from '@adminium/meta';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import type { Kysely } from 'kysely';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { errorEnvelope, UnauthorizedError } from '../src/errors.js';
import { createInboundCore, inboundRoutes, type InboundCore } from '../src/inbound/index.js';
import { rbacPlugin } from '../src/plugins/rbac.js';
import { generateApiKey } from '../src/rbac/api-keys.js';
import { appTextsPermission, grantsFromMatrixRows, matrixRowsFromGrants, parsePermission, PERMISSIONS } from '../src/rbac/permissions.js';
import { authorizeChannel } from '../src/realtime/hub.js';
import { createTextConsentService, textSubject, type TextConsentService } from '../src/sms/consent/index.js';
import { createTextErasure } from '../src/sms/erasure.js';
import { SMS_STOP_EVENT_KINDS, createSmsInboundChannel, type SmsInboundChannel } from '../src/sms/inbound/index.js';
import { createSmsService, type SmsService } from '../src/sms/index.js';
import { createTextSendPath, createTextSendStore, SMS_SEND_ATTEMPTS, textPhoneKeys, type SmsSendPayload, type TextPrepareInput, type TextSendPath, type TextSendStore } from '../src/sms/send/index.js';
import {
  createTextThreads,
  NOT_READ_DAILY_MAX,
  NOT_READ_EVERY_MS,
  OFF_APP_HOLDS_MS,
  NOT_READ_LANGUAGES,
  notReadText,
  TEXT_ANSWER_WINDOW_MS,
  TEXT_THREAD_RETAIN_MS,
  TEXTS_READ_PERMISSION,
  TEXTS_REPLY_PERMISSION,
  textsRoutes,
  type RecordPhone,
  type TextApp,
  type TextThreads,
} from '../src/sms/threads/index.js';
import { memorySmsStore } from './helpers/sms-store.js';
import { META_ENGINES, type MetaHandle } from './meta-dialects.js';
import { stubProvider } from './sms-send.helpers.js';

const SECRET = 'a-threads-test-secret-of-some-length';
const ORIGIN = 'https://texts.lumen.example';
const SIGNING_VALUE = 'made-up-token-for-these-tests';
const ACCOUNT_SID = `AC${'ab'.repeat(16)}`;
const FROM = '+14155550100';
const GUEST = '+4915123456789';
const PATIENT = '+4915123456780';
const STRANGER = '+4915123456781';
const NOON = Date.parse('2026-06-15T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const KEY = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const ONE_SID = `SM${'1f'.repeat(16)}`;

const attempt = () => ({ attempt: 1, maxAttempts: SMS_SEND_ATTEMPTS, signal: new AbortController().signal });

describe.each(META_ENGINES)('two-way text conversations — $name', (engine) => {
  let handle: MetaHandle;
  let clock: { now: number };
  let consent: TextConsentService;
  let store: TextSendStore;
  let server: FastifyInstance | null = null;

  beforeAll(async () => {
    if (!engine.available) return;
    handle = await engine.make();
  }, 120_000);
  afterAll(async () => {
    if (engine.available) await handle.destroy();
  });
  beforeEach(async () => {
    if (!engine.available) return;
    const db = handle.meta.db as unknown as Kysely<Record<string, Record<string, unknown>>>;
    for (const table of ['adminium_text_thread_messages', 'adminium_text_threads', 'adminium_text_reply_switches', 'adminium_text_auto_answers', 'adminium_text_deliveries', 'adminium_text_send_days', 'adminium_text_stop_list', 'adminium_text_consent_log', 'adminium_inbound_events', 'adminium_jobs', 'adminium_audit_log', 'adminium_api_keys']) {
      await db.deleteFrom(table).execute();
    }
    await settingsRepo(handle.meta).set('system.publicOrigin', ORIGIN, { updatedBy: null });
    clock = { now: NOON };
    consent = createTextConsentService({ meta: handle.meta, secret: SECRET, now: () => clock.now });
    store = createTextSendStore(handle.meta);
  });
  afterEach(async () => {
    await server?.close();
    server = null;
  });

  interface Stack {
    sms: SmsService;
    texts: TextSendPath;
    threads: TextThreads;
    channel: SmsInboundChannel;
    core: InboundCore;
    provider: ReturnType<typeof stubProvider>;
    jobs: EnqueueJobInput[];
    notices: { threadId: string; app: string | null }[];
    apps: TextApp[];
    /** A text the customer sends, through the signed door, processed. */
    reply: (from: string, text: string, sid?: string) => Promise<void>;
    /** An app's text to a number, sent through the real path and handed over. */
    appText: (to: string, app: string, template: string) => Promise<string>;
    /** Hands every queued text to the provider. */
    handOverAll: () => Promise<void>;
    people: Record<'owner' | 'reader' | 'bistroDesk' | 'bistroReplier' | 'clerk', User>;
    call: (who: User | null, method: 'GET' | 'POST' | 'PUT', url: string, payload?: object, headers?: Record<string, string>) => Promise<Awaited<ReturnType<FastifyInstance['inject']>>>;
    recordPhone: { value: RecordPhone | null };
  }

  async function stack(options: { apps?: TextApp[] } = {}): Promise<Stack> {
    const provider = stubProvider('twilio', '', []);
    const sms = createSmsService({ store: memorySmsStore(), secret: SECRET, fetch: provider.fetchStub, now: () => clock.now, timeoutMs: 30, stopList: { isStopped: (e164) => consent.stop.has(e164, null), recordProviderOptOut: async () => undefined } });
    await sms.connect({ provider: 'twilio', accountSid: ACCOUNT_SID, authToken: SIGNING_VALUE }, null);
    await sms.setSending({ sender: { kind: 'number', value: FROM }, defaultCountry: 'DE' }, null);
    const jobs: Stack['jobs'] = [];
    const notices: Stack['notices'] = [];
    const apps: TextApp[] = options.apps ?? [
      { key: 'bistro', name: 'Bistro', replies: 'on' },
      { key: 'clinic', name: 'Clinic', replies: 'off' },
    ];
    const late: { channel?: SmsInboundChannel; core?: InboundCore } = {};
    const texts = createTextSendPath({
      sms,
      consent,
      store,
      secret: SECRET,
      policy: async () => ({}),
      repliesReachUs: async () => (await late.channel!.replyReach()).canReceiveStop,
      callbackUrl: async () => (await late.channel!.replyReach()).address,
      inboundWaiting: (e164) => late.core!.waitingFrom(textSubject(e164), SMS_STOP_EVENT_KINDS),
      operatorAllows: () => true,
      phoneKeys: textPhoneKeys(handle.meta, SECRET),
      enqueue: async (job) => void jobs.push(job),
      onSettled: async () => undefined,
      now: () => clock.now,
    });
    const threads = createTextThreads({
      meta: handle.meta,
      secret: SECRET,
      consent,
      sms,
      texts: () => texts,
      business: async () => ({ name: 'Lumen', email: 'hello@lumen.example' }),
      zone: async () => 'UTC',
      locale: async () => 'de_DE',
      apps: async () => apps,
      notify: (change) => void notices.push(change),
      now: () => clock.now,
    });
    const channel = createSmsInboundChannel({
      meta: handle.meta,
      secret: SECRET,
      sms,
      consent,
      reports: (report) => texts.applyReport(report),
      confirmations: (request) => texts.confirmStop(request),
      replies: (reply) => threads.received(reply),
      networkFeatures: true,
      desktop: false,
      trustProxy: false,
      now: () => clock.now,
    });
    const inboundJobs: string[] = [];
    const core = createInboundCore({ meta: handle.meta, secret: SECRET, channels: [channel], now: () => clock.now, enqueue: async (id) => void inboundJobs.push(id) });
    late.channel = channel;
    late.core = core;

    const users = usersRepo(handle.meta);
    const roles = rolesRepo(handle.meta);
    const grants = permissionsRepo(handle.meta);
    const suffix = randomUUID().slice(0, 8);
    const person = async (name: string, grantList: string[], superAdmin = false): Promise<User> => {
      const user = await users.create({ email: `${name}-${suffix}@lumen.test`, name, status: 'active' });
      if (superAdmin) {
        await roles.assignToUser(user.id, (await roles.findBySlug('super-admin'))!.id);
        return user;
      }
      const role = await roles.create({ slug: `${name.toLowerCase()}-${suffix}`, name });
      for (const row of matrixRowsFromGrants(grantList).rows) await grants.grant(role.id, row.resourceKind, row.resourceRef, row.actions);
      await roles.assignToUser(user.id, role.id);
      return user;
    };
    const people: Stack['people'] = {
      owner: await person('Owner', [], true),
      reader: await person('Reader', [TEXTS_READ_PERMISSION]),
      bistroDesk: await person('Desk', [appTextsPermission('bistro', 'read')]),
      bistroReplier: await person('Replier', [appTextsPermission('bistro', 'reply'), 'system:sms:manage', 'table:con_1:main.crm_contacts:read']),
      clerk: await person('Clerk', []),
    };

    const recordPhone: Stack['recordPhone'] = { value: null };
    const app = Fastify({ logger: false });
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.setErrorHandler((error: { statusCode?: number; code?: string; message: string; details?: unknown }, request, reply) => {
      void reply.status(error.statusCode ?? 500).send(errorEnvelope(error.code ?? 'INTERNAL', error.message, request.id, error.details));
    });
    app.addHook('onRequest', async (request) => {
      const id = request.headers['x-test-user-id'];
      if (typeof id !== 'string') return;
      const user = await users.findById(id);
      if (user !== null) (request as unknown as { user: object }).user = { id: user.id, name: user.name, email: user.email };
    });
    app.decorate('requireAuth', async (request: FastifyRequest) => {
      if ((request as unknown as { user?: object }).user === undefined && request.apiKeyPrincipal == null) throw new UnauthorizedError();
    });
    await app.register(rbacPlugin, { meta: handle.meta, now: () => clock.now });
    await app.register(
      async (api) => {
        await api.register(inboundRoutes({ core, channels: [channel], secret: SECRET, now: () => clock.now }));
        await api.register(textsRoutes({ threads, manageGrant: PERMISSIONS.smsManage, replyReach: () => channel.replyReach(), country: async () => 'DE', recordPhone: async () => recordPhone.value }));
      },
      { prefix: '/api/v1' },
    );
    await app.ready();
    server = app;

    const door = new URL((await channel.replyReach()).address!).pathname;
    const reply = async (from: string, text: string, sid = `SM${randomUUID().replaceAll('-', '')}`) => {
      const form = new URLSearchParams({ AccountSid: ACCOUNT_SID, MessageSid: sid, SmsSid: sid, From: from, To: FROM, Body: text, NumSegments: '1' });
      let signed = `${ORIGIN}${door}`;
      for (const name of [...new Set(form.keys())].sort()) for (const value of [...new Set(form.getAll(name))].sort()) signed += name + value;
      const res = await app.inject({ method: 'POST', url: door, payload: form.toString(), headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-twilio-signature': createHmac('sha1', SIGNING_VALUE).update(signed, 'utf8').digest('base64') } });
      expect(res.statusCode, res.body).toBe(200);
      for (const id of inboundJobs.splice(0)) await core.run(id);
    };
    const handOverAll = async () => {
      for (const job of jobs.splice(0)) await texts.handOver(job.payload as SmsSendPayload, attempt());
    };
    const appText = async (to: string, appKey: string, template: string) => {
      await consent.record({ phone: to, purpose: 'text-service', state: 'yes', source: 'form', detail: 'Booking form', wording: { text: 'Text me about my bookings.', version: 'v1' }, at: clock.now - 1000 });
      const input: TextPrepareInput = { phone: to, textClass: 'service', template: 'Your table is ready.', values: {}, zone: 'UTC', business: { name: 'Lumen', email: 'hello@lumen.example' } };
      const ready = await texts.prepare(input);
      if (ready.action !== 'send') throw new Error(`expected a text, got ${JSON.stringify(ready)}`);
      const queued = await texts.queue(ready, { messageKey: `app-outbox:${appKey}:${randomUUID()}`, claimKey: String(clock.now), about: { app: appKey, template } });
      if (!queued.queued) throw new Error('expected it to queue');
      await handOverAll();
      return queued.deliveryId;
    };
    const call: Stack['call'] = (who, method, url, payload, headers = {}) =>
      app.inject({ method, url: `/api/v1${url}`, headers: { ...(who === null ? {} : { 'x-test-user-id': who.id }), ...headers }, ...(payload === undefined ? {} : { payload }) });
    return { sms, texts, threads, channel, core, provider, jobs, notices, apps, reply, appText, handOverAll, people, call, recordPhone };
  }

  const raw = (table: string) => (handle.meta.db as unknown as Kysely<Record<string, Record<string, unknown>>>).selectFrom(table).selectAll().execute();
  const auditText = async () => JSON.stringify(await auditRepo(handle.meta).list({ limit: 200 }));
  type ListReply = { data: { threads: { id: string; app: string | null; phone: string | null; unread: number; preview: string | null; stopped: boolean; lastKind: string }[]; unread: number; replies: { canArrive: boolean } } };
  type ThreadReply = { data: { thread: { id: string }; items: { source: string; kind: string; body: string | null; template: string | null; direction: string; confirmed: boolean | null; delivery: { status: string } | null }[]; answering: boolean; canReply: { ok: boolean; reason: string | null } } };

  describe('threading', () => {
    it.runIf(engine.available)('keeps a reply in the thread of the app that texted the number, once, sealed, and unread', async () => {
      const s = await stack();
      await s.appText(GUEST, 'bistro', 'table-ready');
      clock.now += 60_000;
      await s.reply(GUEST, 'Can we bring a dog?', ONE_SID);
      await s.reply(GUEST, 'Can we bring a dog?', ONE_SID);
      clock.now += 60_000;
      await s.reply(GUEST, 'And a high chair, please.');
      const threads = await raw('adminium_text_threads');
      expect(threads).toHaveLength(1);
      expect(threads[0]).toMatchObject({ appKey: 'bistro', unread: 2 });
      const messages = await raw('adminium_text_thread_messages');
      expect(messages).toHaveLength(2);
      // At rest: neither the words nor the number.
      const stored = JSON.stringify([...threads, ...messages]);
      expect(stored).not.toContain('dog');
      expect(stored).not.toContain('high chair');
      expect(stored).not.toContain(GUEST);
      expect(stored).not.toContain(GUEST.slice(1));
      expect(s.notices.map((one) => one.app)).toEqual(['bistro', 'bistro']);

      const list = await s.call(s.people.owner, 'GET', '/texts/threads');
      expect(list.statusCode, list.body).toBe(200);
      const listed = (list.json() as ListReply).data;
      expect(listed.unread).toBe(1);
      expect(listed.replies.canArrive).toBe(true);
      expect(listed.threads[0]).toMatchObject({ app: 'bistro', phone: GUEST, unread: 2, preview: 'And a high chair, please.', stopped: false });

      const read = await s.call(s.people.owner, 'GET', `/texts/threads/${listed.threads[0]!.id}`);
      expect(read.statusCode, read.body).toBe(200);
      const detail = (read.json() as ThreadReply).data;
      expect(detail.items.map((item) => [item.source, item.direction, item.kind, item.body ?? item.template])).toEqual([
        ['message', 'in', 'message', 'And a high chair, please.'],
        ['message', 'in', 'message', 'Can we bring a dog?'],
        ['app', 'out', 'template', 'table-ready'],
      ]);
      expect(detail.items[2]!.delivery?.status).toBe('sent');
      expect(detail.answering).toBe(true);
      expect(detail.canReply).toEqual({ ok: true, reason: null });
    });

    it.runIf(engine.available)('one thread per number and app: another app\'s text moves the next reply to that app\'s thread, and a number no app texted gets one of its own', async () => {
      const s = await stack({ apps: [{ key: 'bistro', name: 'Bistro', replies: 'on' }, { key: 'salon', name: 'Salon', replies: 'on' }] });
      await s.appText(GUEST, 'bistro', 'table-ready');
      await s.reply(GUEST, 'Thanks!');
      clock.now += 1000;
      await s.appText(GUEST, 'salon', 'appointment');
      await s.reply(GUEST, 'See you then.');
      await s.reply(STRANGER, 'Who is this?');
      const threads = (await raw('adminium_text_threads')).map((row) => row['appKey']).sort();
      expect(threads).toEqual(['', 'bistro', 'salon']);
    });

    it.runIf(engine.available)('marks a thread read for everyone, and a list reads unread threads alone when asked', async () => {
      const s = await stack();
      await s.appText(GUEST, 'bistro', 'table-ready');
      await s.reply(GUEST, 'On our way.');
      const id = (await raw('adminium_text_threads'))[0]!['id'] as string;
      expect((await s.call(s.people.bistroDesk, 'POST', `/texts/threads/${id}/read`)).statusCode).toBe(204);
      expect((await raw('adminium_text_threads'))[0]).toMatchObject({ unread: 0, readById: s.people.bistroDesk.id });
      const unread = (await s.call(s.people.owner, 'GET', '/texts/threads?unread=true')).json() as ListReply;
      expect(unread.data.threads).toEqual([]);
      expect(await auditText()).toContain('texts.thread.marked-read');
    });
  });

  describe('who may read and answer', () => {
    it.runIf(engine.available)('refuses a role without a grant, an API key, and an app role outside its app', async () => {
      const s = await stack({ apps: [{ key: 'bistro', name: 'Bistro', replies: 'on' }, { key: 'salon', name: 'Salon', replies: 'on' }] });
      await s.appText(GUEST, 'bistro', 'table-ready');
      await s.reply(GUEST, 'Hello');
      await s.appText(PATIENT, 'salon', 'appointment');
      await s.reply(PATIENT, 'Hi there');
      await s.reply(STRANGER, 'Anyone?');
      const all = await raw('adminium_text_threads');
      const id = (app: string) => all.find((row) => row['appKey'] === app)!['id'] as string;

      expect((await s.call(s.people.clerk, 'GET', '/texts/threads')).statusCode).toBe(403);
      expect((await s.call(s.people.clerk, 'GET', `/texts/threads/${id('bistro')}`)).statusCode).toBe(403);
      expect((await s.call(null, 'GET', '/texts/threads')).statusCode).toBe(401);
      expect(await auditText()).toContain('permission.denied');

      // One app's role reads that app's threads alone; one no app owns is the console's.
      const desk = (await s.call(s.people.bistroDesk, 'GET', '/texts/threads')).json() as ListReply;
      expect(desk.data.threads.map((thread) => thread.app)).toEqual(['bistro']);
      expect((await s.call(s.people.bistroDesk, 'GET', `/texts/threads/${id('salon')}`)).statusCode).toBe(404);
      expect((await s.call(s.people.bistroDesk, 'GET', `/texts/threads/${id('')}`)).statusCode).toBe(404);
      const canReply = ((await s.call(s.people.bistroDesk, 'GET', `/texts/threads/${id('bistro')}`)).json() as ThreadReply).data.canReply;
      expect(canReply).toEqual({ ok: false, reason: 'not-allowed' });
      const refused = await s.call(s.people.bistroDesk, 'POST', `/texts/threads/${id('bistro')}/replies`, { body: 'Yes, of course.', clientKey: KEY });
      expect(refused.statusCode).toBe(403);
      expect(s.jobs).toHaveLength(0);

      // `texts.read` reads every thread.
      const reader = (await s.call(s.people.reader, 'GET', '/texts/threads')).json() as ListReply;
      expect(reader.data.threads.map((thread) => thread.app ?? '').sort()).toEqual(['', 'bistro', 'salon']);

      // An API key, even one whose role reads every thread.
      const generated = generateApiKey();
      const role = (await rolesRepo(handle.meta).findBySlug('super-admin'))!;
      await apiKeysRepo(handle.meta).create({ name: 'script', prefix: generated.prefix, tokenHash: generated.tokenHash, roleId: role.id });
      const byKey = await s.call(null, 'GET', '/texts/threads', undefined, { authorization: `Bearer ${generated.key}` });
      expect(byKey.statusCode).toBe(403);
    });

    it.runIf(engine.available)('audits every read and every answer, with the number masked and never a word', async () => {
      const s = await stack();
      await s.appText(GUEST, 'bistro', 'table-ready');
      await s.reply(GUEST, 'Is the terrace open?');
      const id = (await raw('adminium_text_threads'))[0]!['id'] as string;
      await s.call(s.people.bistroReplier, 'GET', '/texts/threads');
      await s.call(s.people.bistroReplier, 'GET', `/texts/threads/${id}`);
      const sent = await s.call(s.people.bistroReplier, 'POST', `/texts/threads/${id}/replies`, { body: 'Yes, until ten tonight.', clientKey: KEY });
      expect(sent.statusCode, sent.body).toBe(200);
      const entries = await auditRepo(handle.meta).list({ limit: 50 });
      const actions = entries.map((entry) => entry.action);
      expect(actions).toEqual(expect.arrayContaining(['texts.threads.read', 'texts.thread.read', 'texts.thread.replied']));
      // The list's row names the threads it showed.
      expect(JSON.stringify(entries.find((entry) => entry.action === 'texts.threads.read'))).toContain(id);
      for (const entry of entries.filter((one) => one.action.startsWith('texts.'))) expect(entry.actorId).toBe(s.people.bistroReplier.id);
      const text = await auditText();
      expect(text).toContain('+49 ••• 789');
      expect(text).not.toContain(GUEST);
      expect(text).not.toContain('terrace');
      expect(text).not.toContain('until ten');
    });

    it.runIf(engine.available)('the keys are of the closed list, an app grant round-trips through the matrix, and no built-in role but the Super Admin holds them', () => {
      expect(parsePermission(TEXTS_READ_PERMISSION)).not.toBeNull();
      expect(parsePermission(TEXTS_REPLY_PERMISSION)).not.toBeNull();
      expect(PERMISSIONS.textsRead).toBe(TEXTS_READ_PERMISSION);
      expect(parsePermission('texts:*:read')).toBeNull();
      expect(parsePermission('texts:bistro:write')).toBeNull();
      const grant = appTextsPermission('bistro', 'reply');
      expect(grantsFromMatrixRows(matrixRowsFromGrants([grant]).rows.map((row) => ({ ...row, roleId: 'r', id: 'p' }) as never))).toEqual([grant]);
      for (const role of BUILTIN_ROLES) {
        expect(role.systemActions.includes('texts.read'), role.slug).toBe(role.slug === 'super-admin');
        expect(role.systemActions.includes('texts.reply'), role.slug).toBe(role.slug === 'super-admin');
      }
    });

    it.runIf(engine.available)('a realtime notice reaches only whoever may read those threads', async () => {
      const holds = (granted: string[]) => ({ can: (_user: { id: string }, permission: string) => granted.includes(permission) });
      expect(await authorizeChannel({ id: 'u' }, 'texts', holds([TEXTS_READ_PERMISSION]))).toBe(true);
      expect(await authorizeChannel({ id: 'u' }, 'texts', holds([appTextsPermission('bistro', 'read')]))).toBe(false);
      expect(await authorizeChannel({ id: 'u' }, 'texts:bistro', holds([appTextsPermission('bistro', 'read')]))).toBe(true);
      expect(await authorizeChannel({ id: 'u' }, 'texts:salon', holds([appTextsPermission('bistro', 'reply')]))).toBe(false);
      expect(await authorizeChannel({ id: 'u' }, 'texts:bistro', holds([]))).toBe(false);
      expect(await authorizeChannel({ id: 'u' }, 'texts:Not An App', holds([TEXTS_READ_PERMISSION]))).toBe(false);
    });
  });

  describe('answering', () => {
    it.runIf(engine.available)('a reply goes through the send path once per key, from the number they wrote to, with its opt-out line', async () => {
      const s = await stack({ apps: [{ key: 'bistro', name: 'Bistro', replies: 'on' }] });
      // Never agreed to texts: they wrote first, so the answer they asked for may go.
      await s.reply(GUEST, 'Do you have a table for two?');
      const id = (await raw('adminium_text_threads'))[0]!['id'] as string;
      const first = await s.call(s.people.owner, 'POST', `/texts/threads/${id}/replies`, { body: 'We do, at eight.', clientKey: KEY });
      expect(first.statusCode, first.body).toBe(200);
      // The opt-out line is in the business's language (German here), whatever the words typed.
      expect((first.json() as { data: { result: { outcome: string }; item: { body: string } } }).data).toMatchObject({ result: { outcome: 'queued' }, item: { body: 'We do, at eight. Antworten Sie STOP zum Abmelden.' } });
      const again = await s.call(s.people.owner, 'POST', `/texts/threads/${id}/replies`, { body: 'We do, at eight.', clientKey: KEY });
      expect(again.statusCode).toBe(200);
      expect(await raw('adminium_text_thread_messages')).toHaveLength(2);
      expect(await raw('adminium_text_deliveries')).toHaveLength(1);
      await s.handOverAll();
      expect(s.provider.posts).toHaveLength(1);
      const posted = new URLSearchParams(s.provider.posts[0]!.body);
      expect(posted.get('To')).toBe(GUEST);
      expect(posted.get('From')).toBe(FROM);
      expect(posted.get('Body')).toBe('We do, at eight. Antworten Sie STOP zum Abmelden.');
      expect((await raw('adminium_text_threads'))[0]).toMatchObject({ unread: 0, lastDirection: 'out', lastKind: 'reply' });
      const items = ((await s.call(s.people.owner, 'GET', `/texts/threads/${id}`)).json() as ThreadReply).data.items;
      expect(items[0]).toMatchObject({ direction: 'out', kind: 'reply', delivery: { status: 'sent' } });
    });

    it.runIf(engine.available)('after the answer window a reply needs their yes, and a later no still refuses it', async () => {
      const s = await stack({ apps: [{ key: 'bistro', name: 'Bistro', replies: 'on' }] });
      await s.reply(GUEST, 'Hello?');
      const id = (await raw('adminium_text_threads'))[0]!['id'] as string;
      clock.now += TEXT_ANSWER_WINDOW_MS + 1000;
      const late = await s.call(s.people.owner, 'POST', `/texts/threads/${id}/replies`, { body: 'Sorry for the wait.', clientKey: KEY });
      expect((late.json() as { data: { result: unknown } }).data.result).toEqual({ outcome: 'refused', deliveryId: null, opensAt: null, reason: 'no-consent' });
      expect(((await s.call(s.people.owner, 'GET', `/texts/threads/${id}`)).json() as ThreadReply).data.canReply).toEqual({ ok: false, reason: 'no-consent' });
      await s.reply(GUEST, 'Still there?');
      await consent.record({ phone: GUEST, purpose: 'text-service', state: 'no', source: 'person', at: clock.now });
      const no = await s.call(s.people.owner, 'POST', `/texts/threads/${id}/replies`, { body: 'Yes!', clientKey: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' });
      expect((no.json() as { data: { result: { reason: string } } }).data.result.reason).toBe('no-consent');
      expect(s.jobs).toHaveLength(0);
    });

    it.runIf(engine.available)('a STOP is a line in the thread with its confirmation, and a reply to that number is refused', async () => {
      const s = await stack();
      await s.appText(GUEST, 'bistro', 'table-ready');
      await s.reply(GUEST, 'What time?');
      // Twilio answers its own STOP itself; "OPT OUT" is one it misses, so Adminium confirms it.
      await s.reply(GUEST, 'OPT OUT');
      const id = (await raw('adminium_text_threads'))[0]!['id'] as string;
      const detail = ((await s.call(s.people.owner, 'GET', `/texts/threads/${id}`)).json() as ThreadReply).data;
      expect(detail.items[0]).toMatchObject({ kind: 'stop', body: 'OPT OUT', confirmed: true });
      expect(detail.canReply).toEqual({ ok: false, reason: 'stopped' });
      const listed = ((await s.call(s.people.owner, 'GET', '/texts/threads')).json() as ListReply).data.threads[0];
      expect(listed).toMatchObject({ stopped: true, lastKind: 'stop' });
      const jobsBefore = s.jobs.length;
      const refused = await s.call(s.people.owner, 'POST', `/texts/threads/${id}/replies`, { body: 'Noted.', clientKey: KEY });
      expect((refused.json() as { data: { result: { outcome: string; reason: string } } }).data.result).toMatchObject({ outcome: 'refused', reason: 'stopped' });
      expect(s.jobs).toHaveLength(jobsBefore);
      // A STOP from a number with no thread starts none.
      await s.reply(STRANGER, 'STOP');
      expect(await raw('adminium_text_threads')).toHaveLength(1);
    });
  });

  describe('replies off', () => {
    it.runIf(engine.available)('keeps nothing, answers "not read" once in its period in the business\'s language, and again after it', async () => {
      const s = await stack();
      await s.appText(PATIENT, 'clinic', 'visit-reminder');
      await s.reply(PATIENT, 'I have a fever, can I still come?');
      expect(await raw('adminium_text_threads')).toEqual([]);
      expect(await raw('adminium_text_thread_messages')).toEqual([]);
      expect(s.jobs).toHaveLength(1);
      await s.handOverAll();
      const body = new URLSearchParams(s.provider.posts.at(-1)!.body).get('Body');
      expect(body).toBe('Lumen: Diese Nummer wird nicht gelesen. Kontakt: hello@lumen.example Antworten Sie STOP zum Abmelden.');
      // Two automatic answerers writing to each other stop at one answer.
      for (let n = 0; n < 3; n += 1) await s.reply(PATIENT, 'This is an automatic reply.');
      expect(s.jobs).toHaveLength(0);
      clock.now += NOT_READ_EVERY_MS + 1000;
      await s.reply(PATIENT, 'Hello again');
      expect(s.jobs).toHaveLength(1);
    });

    it.runIf(engine.available)('two replies at once get one answer', async () => {
      const s = await stack();
      await s.appText(PATIENT, 'clinic', 'visit-reminder');
      const reply = (sid: string) => s.threads.received({ eventId: `ibe_${sid}`, from: PATIENT, to: FROM, text: 'Hello', kind: 'message', at: clock.now, answered: false });
      const outcomes = await Promise.all([reply('a'), reply('b'), reply('c')]);
      expect(outcomes.filter((one) => one === 'answered-not-read')).toHaveLength(1);
      expect(s.jobs).toHaveLength(1);
    });

    it.runIf(engine.available)('never answers a stopped number, the business\'s own number, or a HELP the provider answered', async () => {
      const s = await stack();
      await s.appText(PATIENT, 'clinic', 'visit-reminder');
      await consent.stop.add({ phone: PATIENT, reason: 'staff', staff: { id: s.people.owner.id, label: 'Owner' } });
      await s.reply(PATIENT, 'Hello');
      expect(s.jobs).toHaveLength(0);
      expect(await s.threads.received({ eventId: 'ibe_own', from: FROM, to: FROM, text: 'Loop', kind: 'message', at: clock.now, answered: false })).toBe('own-sender');
      await s.appText(STRANGER, 'clinic', 'visit-reminder');
      expect(await s.threads.received({ eventId: 'ibe_help', from: STRANGER, to: FROM, text: 'HELP', kind: 'help', at: clock.now, answered: true })).toBe('not-read');
      expect(s.jobs).toHaveLength(0);
    });

    it.runIf(engine.available)('a stranger\'s text is off while any app keeps its replies unread, and the switch turns an app\'s on', async () => {
      const s = await stack();
      await s.reply(STRANGER, 'Hello?');
      expect(await raw('adminium_text_threads')).toEqual([]);
      // Nobody here ever texted that number: whoever writes from it gets no paid answer.
      expect(s.jobs).toHaveLength(0);
      const switches = await s.call(s.people.bistroReplier, 'GET', '/texts/replies');
      expect((switches.json() as { data: unknown }).data).toMatchObject({ noApp: 'off', apps: [{ app: 'bistro', replies: 'on', starts: 'on' }, { app: 'clinic', replies: 'off', starts: 'off' }] });
      expect((await s.call(s.people.bistroDesk, 'PUT', '/texts/replies/clinic', { replies: 'on' })).statusCode).toBe(403);
      const on = await s.call(s.people.bistroReplier, 'PUT', '/texts/replies/clinic', { replies: 'on' });
      expect(on.statusCode, on.body).toBe(200);
      expect((await s.call(s.people.bistroReplier, 'PUT', '/texts/replies/nothing-here', { replies: 'on' })).statusCode).toBe(404);
      expect(await auditText()).toContain('texts.replies.switched');
      await s.reply(STRANGER, 'Hello again?');
      expect(await raw('adminium_text_threads')).toHaveLength(1);
    });
  });

  describe('"not read" answers cannot be farmed', () => {
    it.runIf(engine.available)('at most twenty go in a day, and texts the business sends still go', async () => {
      const s = await stack();
      const numbers = Array.from({ length: NOT_READ_DAILY_MAX + 5 }, (_, i) => `+49151200000${String(i).padStart(2, '0')}`);
      for (const number of numbers) await s.appText(number, 'clinic', 'visit-reminder');
      for (const number of numbers) await s.reply(number, 'Hello?');
      expect(s.jobs).toHaveLength(NOT_READ_DAILY_MAX);
      await s.handOverAll();
      // A reminder that day still goes.
      await s.appText(GUEST, 'bistro', 'table-ready');
      expect(new URLSearchParams(s.provider.posts.at(-1)!.body).get('To')).toBe(GUEST);
      // A day on, the next one is answered again.
      clock.now += 24 * 60 * 60 * 1000 + 1000;
      await s.appText(STRANGER, 'clinic', 'visit-reminder');
      await s.reply(STRANGER, 'Hello?');
      expect(s.jobs).toHaveLength(1);
    });

    it.runIf(engine.available)('keeps to the service hours: written at three in the morning, answered when they open', async () => {
      const s = await stack();
      await s.appText(PATIENT, 'clinic', 'visit-reminder');
      clock.now = Date.parse('2026-06-16T03:00:00Z');
      await s.reply(PATIENT, 'Hello?');
      expect(s.jobs).toHaveLength(1);
      expect(s.jobs[0]!.runAt).toBe(Date.parse('2026-06-16T08:00:00Z'));
    });
  });

  describe('whose conversation a reply joins', () => {
    it.runIf(engine.available)('another app\'s one line cannot pull a patient\'s reply out of a clinic whose replies are off', async () => {
      const s = await stack();
      await s.appText(PATIENT, 'clinic', 'visit-reminder');
      clock.now += 60_000;
      await s.appText(PATIENT, 'bistro', 'table-ready');
      await s.reply(PATIENT, 'About my visit: the rash is worse.');
      expect(await raw('adminium_text_threads')).toEqual([]);
      expect(await raw('adminium_text_thread_messages')).toEqual([]);
      // Once the clinic has not texted them for a month, the bistro's own conversation takes their replies.
      clock.now += OFF_APP_HOLDS_MS + 60_000;
      await s.appText(PATIENT, 'bistro', 'table-ready');
      await s.reply(PATIENT, 'Table for two, please.');
      expect(await raw('adminium_text_threads')).toEqual([expect.objectContaining({ appKey: 'bistro' })]);
    });
  });

  describe('a reply the catch-up found', () => {
    const found = (s: Stack, from: string, to: string, text = 'Hello') => s.threads.received({ eventId: `ibe_${randomUUID().slice(0, 12)}`, from, to, text, kind: 'message', at: clock.now, answered: false, via: 'catch-up' });

    const open = () => stack({ apps: [{ key: 'bistro', name: 'Bistro', replies: 'on' }] });

    it.runIf(engine.available)('to another number of the account, from someone never texted, is not this business\'s: nothing is kept', async () => {
      const s = await open();
      expect(await found(s, GUEST, '+14155550999')).toBe('not-ours');
      expect(await raw('adminium_text_threads')).toEqual([]);
      // To the business's own sender, it is kept.
      expect(await found(s, GUEST, FROM)).toBe('kept');
    });

    it.runIf(engine.available)('from someone this business texted is kept, whichever number it reached', async () => {
      const s = await open();
      await s.appText(GUEST, 'bistro', 'table-ready');
      expect(await found(s, GUEST, '+14155550999')).toBe('kept');
    });

    it.runIf(engine.available)('is never answered "not read", days later, at any hour', async () => {
      const s = await stack();
      await s.appText(PATIENT, 'clinic', 'visit-reminder');
      expect(await found(s, PATIENT, FROM)).toBe('not-read');
      expect(s.jobs).toHaveLength(0);
    });
  });

  describe('a text from a record', () => {
    const SEND = { connection: 'con_1', table: 'main.crm_contacts', row: '7', column: 'phone', body: 'Your quote is ready.', clientKey: KEY };

    it.runIf(engine.available)('goes to the number on the record, as the app\'s, into its thread, and needs the app\'s reply right', async () => {
      const s = await stack({ apps: [{ key: 'crm', name: 'Sales CRM', replies: 'on' }] });
      await consent.record({ phone: GUEST, purpose: 'text-service', state: 'yes', source: 'staff', staff: { id: s.people.owner.id, label: 'Owner' }, wording: { text: 'May we text you?', version: 'v1' }, at: clock.now - 1000 });
      s.recordPhone.value = { rowKey: '7', app: 'crm', phoneColumn: true, value: '0151 23456789', mayReadNumber: false };
      // The record is not read without the table's own read.
      expect((await s.call(s.people.reader, 'POST', '/texts/send', SEND)).statusCode).toBe(404);
      const sent = await s.call(s.people.owner, 'POST', '/texts/send', SEND);
      expect(sent.statusCode, sent.body).toBe(200);
      expect((sent.json() as { data: unknown }).data).toMatchObject({ sentTo: null, result: { outcome: 'queued' } });
      const [delivery] = await raw('adminium_text_deliveries');
      expect(delivery).toMatchObject({ aboutApp: 'crm', aboutTemplate: null });
      const [thread] = await raw('adminium_text_threads');
      expect(thread).toMatchObject({ appKey: 'crm', recordConnection: 'con_1', recordTable: 'main.crm_contacts', recordKey: '7', lastKind: 'text' });
      expect(await auditText()).toContain('texts.record.texted');
      // A column that is not a phone, and a record out of reach.
      s.recordPhone.value = { rowKey: '7', app: 'crm', phoneColumn: false, value: null, mayReadNumber: true };
      expect((await s.call(s.people.owner, 'POST', '/texts/send', { ...SEND, clientKey: 'cccccccccccccccccccccccccccccccc' })).statusCode).toBe(422);
      s.recordPhone.value = null;
      expect((await s.call(s.people.owner, 'POST', '/texts/send', SEND)).statusCode).toBe(404);
    });

    it.runIf(engine.available)('is refused to a role without the app\'s reply right, and by the send path to someone who never agreed', async () => {
      const s = await stack({ apps: [{ key: 'crm', name: 'Sales CRM', replies: 'on' }] });
      s.recordPhone.value = { rowKey: '7', app: 'crm', phoneColumn: true, value: GUEST, mayReadNumber: true };
      // Reads the table, but holds bistro's right, not crm's.
      expect((await s.call(s.people.bistroReplier, 'POST', '/texts/send', SEND)).statusCode).toBe(403);
      const refused = await s.call(s.people.owner, 'POST', '/texts/send', SEND);
      expect((refused.json() as { data: unknown }).data).toMatchObject({ threadId: null, sentTo: '+49 ••• 789', result: { outcome: 'refused', reason: 'no-consent' } });
      expect(await raw('adminium_text_threads')).toEqual([]);
    });

    it.runIf(engine.available)('counts only a yes given to the app it is sent as: another app\'s yes is no blank cheque', async () => {
      const tables: Record<string, string> = { 'main.patients': 'clinic', 'main.crm_contacts': 'crm', 'main.crm_leads': 'crm' };
      consent = createTextConsentService({ meta: handle.meta, secret: SECRET, appOf: async (person) => tables[person.table] ?? null, now: () => clock.now });
      const s = await stack({ apps: [{ key: 'crm', name: 'Sales CRM', replies: 'on' }, { key: 'clinic', name: 'Clinic', replies: 'off' }] });
      const yes = (person: { connectionId: string; table: string; key: string }, at: number) =>
        consent.record({ phone: GUEST, person, purpose: 'text-service', state: 'yes', source: 'form', detail: 'Booking form', wording: { text: 'Remind me of my visits by text.', version: 'v1' }, at });
      s.recordPhone.value = { rowKey: '7', app: 'crm', phoneColumn: true, value: GUEST, mayReadNumber: true };
      // The patient ticked the clinic's box: the sales team may not write to them on it.
      await yes({ connectionId: 'con_1', table: 'main.patients', key: '3' }, clock.now - 2000);
      const refused = await s.call(s.people.owner, 'POST', '/texts/send', SEND);
      expect((refused.json() as { data: unknown }).data).toMatchObject({ threadId: null, result: { outcome: 'refused', reason: 'no-consent' } });
      // A yes given on one of the CRM's own rows counts for the CRM.
      await yes({ connectionId: 'con_1', table: 'main.crm_leads', key: '1' }, clock.now - 1000);
      const sent = await s.call(s.people.owner, 'POST', '/texts/send', { ...SEND, clientKey: 'dddddddddddddddddddddddddddddddd' });
      expect((sent.json() as { data: unknown }).data).toMatchObject({ result: { outcome: 'queued' } });
    });
  });

  describe('keeping and erasing', () => {
    it.runIf(engine.available)('an erasure by the number takes its threads and messages, and counts them first', async () => {
      const s = await stack();
      await s.appText(GUEST, 'bistro', 'table-ready');
      await s.reply(GUEST, 'Lovely, thanks.');
      await s.reply(STRANGER, 'Who is this?');
      const erasure = createTextErasure({
        meta: handle.meta,
        consent,
        inbound: s.core,
        deliveries: store,
        threads: s.threads,
        phoneKeys: textPhoneKeys(handle.meta, SECRET),
        country: async () => 'DE',
      });
      const counted = await erasure.count({ phone: GUEST, country: 'DE', person: null, everywhere: true });
      expect(counted.conversations).toBe(2);
      const erased = await erasure.erase({ phone: GUEST, country: 'DE', person: null, at: clock.now, everywhere: true });
      expect(erased.conversations).toBe(2);
      const left = await raw('adminium_text_threads');
      expect(left).toHaveLength(0);
      expect(await raw('adminium_text_thread_messages')).toHaveLength(0);
    });

    it.runIf(engine.available)('a message goes after a year, and a thread left with none', async () => {
      const s = await stack();
      await s.reply(STRANGER, 'Hello?');
      await s.call(s.people.bistroReplier, 'PUT', '/texts/replies/clinic', { replies: 'on' });
      await s.reply(STRANGER, 'Anyone?');
      clock.now += 2 * DAY;
      await s.reply(STRANGER, 'Hello again');
      clock.now += TEXT_THREAD_RETAIN_MS - DAY;
      expect(await s.threads.sweep()).toMatchObject({ messages: 1, threads: 0 });
      clock.now += 2 * DAY;
      expect(await s.threads.sweep()).toMatchObject({ messages: 1, threads: 1 });
      expect(await raw('adminium_text_threads')).toEqual([]);
    });
  });
});

describe('the "not read" answer', () => {
  it('is written in all eight languages, names the business, and gives a contact only where a text may carry one', () => {
    expect(NOT_READ_LANGUAGES).toEqual(['en-US', 'de-DE', 'fr-FR', 'da-DK', 'cs-CZ', 'ar-EG', 'zh-CN', 'zh-TW']);
    const business = { name: 'Rowan Health', phone: '+44 20 7946 0958' };
    expect(notReadText({ locale: 'en_US', business, to: GUEST })).toBe('Rowan Health: This number is not read. Contact us: +44 20 7946 0958');
    expect(notReadText({ locale: 'zh-Hant-TW', business, to: GUEST })).toBe('Rowan Health：此號碼無人查看。請聯絡：+44 20 7946 0958');
    expect(notReadText({ locale: 'fr', business: { name: 'Rowan', email: 'desk@rowan.example' }, to: GUEST })).toBe("Rowan : ce numéro n'est pas consulté. Contact : desk@rowan.example");
    expect(notReadText({ locale: 'ar-EG', business: { name: 'Rowan' }, to: GUEST })).toBe('Rowan: هذا الرقم غير مُتابَع.');
    // The UAE allows no number or address in a text.
    expect(notReadText({ locale: 'en-US', business, to: '+971501234567' })).toBe('Rowan Health: This number is not read.');
    expect(notReadText({ locale: 'xx', business: { name: '' }, to: GUEST })).toBe('This number is not read.');
  });
});
