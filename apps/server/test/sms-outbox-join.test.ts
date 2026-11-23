// SPDX-License-Identifier: AGPL-3.0-only
/**
 * AN OUTBOX KIND SENT AS A TEXT, joined to the real engine on every engine this
 * run can reach: an app installed by the real installer, its real outbox
 * producers and sender, the real `sms.send` job through the jobs table, the real
 * send path, and the real inbound door. Only the provider is a stub, written
 * from its public documentation, so this proves the join and not the live API.
 *
 * The app's people table has NO email column: a person known only by phone.
 */
import { createHmac } from 'node:crypto';

import { SMS_WORDS_FLOOR, validateManifest } from '@adminium/manifest';
import { appTablesRepo, documentSequencesRepo, jobsRepo, settingsRepo, type EnqueueJobInput, type MetaDb } from '@adminium/meta';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import type { Kysely } from 'kysely';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createWriteService } from '../src/crud/write-service.js';
import { createInboundCore, inboundRoutes, type InboundCore } from '../src/inbound/index.js';
import { createOutboxProducers } from '../src/outbox/producers.js';
import { createOutboxSender, type OutboxSender } from '../src/outbox/sender.js';
import { TEXT_EARLIER_OPEN, TEXT_NOT_CHECKED, TEXT_NOT_CONNECTED, TEXT_NOT_PREPARED, TEXT_NO_NUMBER, TEXT_REHEARSAL, TEXT_SAMPLE, TEXT_UNKNOWN, textReasonSentence } from '../src/outbox/text-words.js';
import { noteRehearsalRow } from '../src/payments/rehearsal-state.js';
import { createPublicViews } from '../src/public-api/runtime.js';
import { createTextConsentService, textSubject, type TextConsentService } from '../src/sms/consent/index.js';
import { createTextErasure } from '../src/sms/erasure.js';
import { SMS_STOP_CONFIRMATION, SMS_STOP_EVENT_KINDS, createSmsInboundChannel, type SmsInboundChannel } from '../src/sms/inbound/index.js';
import { createSmsService, type SmsCredentialInput } from '../src/sms/index.js';
import { SEALED_TEXT_GONE, SMS_SEND_JOB_KIND, TextRetryLater, createTextSendPath, createTextSendStore, smsSendPayloadSchema, textPhoneKeys, type TextSendPath, type TextSendStore } from '../src/sms/send/index.js';
import { memorySmsStore } from './helpers/sms-store.js';
import { TEST_SECRET } from './helpers.js';
import { LEGS, installInvoicing, invoicingManifest, invoicingTables, type InvoicingHarness } from './invoicing-install.helpers.js';
import { META_ENGINES, type MetaHandle } from './meta-dialects.js';
import { SMTP } from './outbox-rows-fixture.js';
import { json, stubProvider, type ProviderStep } from './sms-send.helpers.js';

vi.mock('../src/version.js', async (original) => ({ ...(await original<typeof import('../src/version.js')>()), APP_VERSION: SMS_WORDS_FLOOR }));

const ORIGIN = 'https://texts.lumen.example';
const SIGNING_VALUE = 'made-up-token-for-these-tests';
const ACCOUNT_SID = `AC${'ab'.repeat(16)}`;
const TWILIO: SmsCredentialInput = { provider: 'twilio', accountSid: ACCOUNT_SID, authToken: SIGNING_VALUE };
const FROM = '+14155550100';
const MIA = '+4915123456789';
const KAI = '+4915123456780';
const TWILIO_MESSAGE = `SM${'cd'.repeat(16)}`;
const NOON = Date.parse('2026-06-15T12:00:00Z');
const NIGHT = Date.parse('2026-06-15T22:00:00Z');
const MORNING = Date.parse('2026-06-16T08:00:00Z');
const VISIT = '2026-06-16T10:00:00.000Z';
const WORDS = 'Your visit is confirmed.';

const id = { ref: 'id', type: 'int', role: 'pk' };
const text = (ref: string, maxLength = 120, more: Record<string, unknown> = {}) => ({ ref, type: 'text', maxLength, nullable: true, ...more });
const fk = (ref: string, references: string) => ({ ref, type: 'fk', references, nullable: true });

/** A clinic whose patients are known only by their mobile. */
function clinicManifest(): Record<string, unknown> {
  return {
    ...invoicingManifest([
      ...invoicingTables(),
      { ref: 'patients', columns: [id, text('name'), text('mobile', 32, { rules: { personal: true } }), { ref: 'lead_hours', type: 'int', nullable: true }] },
      { ref: 'visits', columns: [id, fk('patient_id', 'patients'), { ref: 'starts_at', type: 'timestamptz', nullable: true }, text('state', 16)] },
      {
        ref: 'messages',
        columns: [
          id,
          { ref: 'kind', type: 'enum', enum: ['confirm_text', 'reminder_text'] },
          { ref: 'status', type: 'enum', enum: ['queued', 'sent', 'failed', 'skipped'], default: 'queued' },
          text('to_address', 254),
          fk('patient_id', 'patients'),
          fk('visit_id', 'visits'),
          text('error', 200),
          { ref: 'sent_at', type: 'timestamptz', nullable: true },
          { ref: 'due_at', type: 'timestamptz', nullable: true },
        ],
      },
    ]),
    key: 'clinic',
    compatibility: { minAdminiumVersion: SMS_WORDS_FLOOR },
    people: [{ table: 'patients', kind: 'people', phone: 'mobile', name: 'name' }],
    textTemplates: [
      { key: 'clinic-confirm', name: 'Visit confirmed', locales: { 'en-US': { body: WORDS } } },
      { key: 'clinic-reminder', name: 'Visit reminder', locales: { 'en-US': { body: 'Your visit is at {{visit.starts_at.time}}.' } } },
    ],
    outbox: {
      table: 'messages',
      columns: { kind: 'kind', status: 'status', to: 'to_address', error: 'error', sentAt: 'sent_at', due: 'due_at' },
      links: { visit: 'visit_id' },
      recipient: { via: 'patient_id', table: 'patients', name: 'name', phone: 'mobile' },
      kinds: { confirm_text: 'clinic-confirm', reminder_text: 'clinic-reminder' },
      channels: { confirm_text: 'sms', reminder_text: 'sms' },
      classes: { confirm_text: 'service', reminder_text: 'service' },
      producers: [
        {
          kind: 'reminder_text',
          link: 'visit_id',
          before: { table: 'visits', at: 'starts_at', lead: { via: 'patient_id', table: 'patients', column: 'lead_hours', max: 48 }, where: { column: 'state', eq: 'booked' } },
        },
      ],
    },
  };
}

describe.each(LEGS)('a text kind joined to the engine — %s', (dialect, available) => {
  const engine = META_ENGINES.find((one) => one.name === dialect)!;
  let h: InvoicingHarness;
  let handle: MetaHandle;
  let meta: MetaDb;
  let clock: { now: number };
  let consent: TextConsentService;
  let store: TextSendStore;
  let producers: ReturnType<typeof createOutboxProducers>;
  let app: FastifyInstance | null = null;
  const logged: string[] = [];
  const logger = {
    info: (fields: unknown, message?: string) => void logged.push(JSON.stringify([fields, message])),
    warn: (fields: unknown, message?: string) => void logged.push(JSON.stringify([fields, message])),
  };

  const cell = (value: unknown) => (value === undefined || value === null ? 'NULL' : typeof value === 'number' ? String(value) : `'${String(value).replaceAll("'", "''")}'`);
  /** The visit's moment in raw SQL: the MySQL driver reads a DATETIME on this process's own clock, so it is written on it too. */
  const visitAt = () => (dialect === 'mysql' ? cell(new Date(VISIT).toLocaleString('sv')) : cell(VISIT));
  const patient = async (name: string, mobile: string | null, lead = 14) => {
    await h.rows(`INSERT INTO ${h.real('patients')} (name, mobile, lead_hours) VALUES (${cell(name)}, ${cell(mobile)}, ${lead})`);
    return Number((await h.rows(`SELECT max(id) AS id FROM ${h.real('patients')}`))[0]!['id']);
  };
  const queued = async (who: number, kind = 'confirm_text') => {
    await h.rows(`INSERT INTO ${h.real('messages')} (kind, status, patient_id) VALUES (${cell(kind)}, 'queued', ${who})`);
    return Number((await h.rows(`SELECT max(id) AS id FROM ${h.real('messages')}`))[0]!['id']);
  };
  const message = async (mid: number) => {
    const [row] = await h.rows(`SELECT status, error, to_address, due_at FROM ${h.real('messages')} WHERE id = ${mid}`);
    return { status: row!['status'], error: (row!['error'] ?? null) as string | null, to: row!['to_address'] ?? null, due: row!['due_at'] ?? null };
  };
  const jobRows = async () => {
    const rows = await jobsRepo(meta).ofKindSince(SMS_SEND_JOB_KIND, 0);
    const done = await meta.db.selectFrom('adminium_jobs').selectAll().where('kind', '=', SMS_SEND_JOB_KIND).execute();
    return { open: rows, all: done };
  };
  const envelopes = async () => {
    const rows = await meta.db.selectFrom('adminium_jobs').select('payload').where('kind', '=', SMS_SEND_JOB_KIND).execute();
    return rows.map((row) => (typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload) as { envelope: string; deliveryId: string });
  };

  beforeAll(async () => {
    if (!available) return;
    handle = await engine.make();
    meta = handle.meta;
    h = await installInvoicing(dialect, clinicManifest());
    await h.meta.db.updateTable('adminium_connections').set({ timezone: 'UTC', currency: 'USD' }).where('id', '=', h.connectionId).execute();
  }, 180_000);

  afterAll(async () => {
    if (!available) return;
    await h.close();
    await handle.destroy();
  });

  beforeEach(async () => {
    if (!available) return;
    logged.length = 0;
    const db = meta.db as unknown as Kysely<Record<string, Record<string, unknown>>>;
    for (const table of ['adminium_text_deliveries', 'adminium_text_send_days', 'adminium_text_stop_list', 'adminium_text_consent_log', 'adminium_inbound_events', 'adminium_jobs']) await db.deleteFrom(table).execute();
    for (const table of ['messages', 'visits', 'patients']) await h.rows(`DELETE FROM ${h.real(table)}`);
    await settingsRepo(meta).set('system.publicOrigin', ORIGIN, { updatedBy: null });
    clock = { now: NOON };
    consent = createTextConsentService({ meta, secret: TEST_SECRET, now: () => clock.now });
    store = createTextSendStore(meta);
  });

  afterEach(async () => {
    await app?.close();
    app = null;
  });

  const agree = (phone: string) => consent.record({ phone, purpose: 'text-service', state: 'yes', source: 'form', detail: 'Booking form', wording: { text: 'Text me about my visits.', version: 'v1' }, at: clock.now - 1000 });

  interface WireOptions {
    script?: ProviderStep[];
    policy?: unknown;
    connected?: boolean;
    consent?: TextConsentService;
  }

  async function wire(options: WireOptions = {}) {
    const provider = stubProvider('twilio', 'unused', options.script ?? []);
    const fetchStub = (async (url: string | URL | Request, init?: RequestInit) => {
      if ((init?.method ?? 'GET') === 'GET' && String(url).includes('/Messages.json')) return json(200, { messages: [], next_page_uri: null });
      return provider.fetchStub(url, init);
    }) as typeof fetch;
    const sms = createSmsService({ store: memorySmsStore(), secret: TEST_SECRET, fetch: fetchStub, now: () => clock.now, timeoutMs: 30, stopList: { isStopped: (e164) => consent.stop.has(e164, null), recordProviderOptOut: async () => undefined } });
    if (options.connected !== false) {
      await sms.connect(TWILIO, null);
      await sms.setSending({ sender: { kind: 'number', value: FROM }, defaultCountry: 'DE' }, null);
    }
    const views = createPublicViews(h.meta);
    const writes = createWriteService({ sequences: documentSequencesRepo(h.meta) });
    producers = createOutboxProducers({ meta: h.meta, manager: h.manager, viewFor: views.viewFor, writes });
    const late: { channel?: SmsInboundChannel; core?: InboundCore; sender?: OutboxSender } = {};
    const texts: TextSendPath = createTextSendPath({
      sms,
      consent: options.consent ?? consent,
      store,
      secret: TEST_SECRET,
      policy: async () => options.policy ?? {},
      repliesReachUs: async () => (await late.channel!.replyReach()).canReceiveStop,
      callbackUrl: async () => (await late.channel!.replyReach()).address,
      inboundWaiting: (e164) => late.core!.waitingFrom(textSubject(e164), SMS_STOP_EVENT_KINDS),
      operatorAllows: () => true,
      phoneKeys: textPhoneKeys(meta, TEST_SECRET),
      enqueue: (job: EnqueueJobInput) => jobsRepo(meta).enqueue(job, clock.now),
      stillWanted: (report, e164) => late.sender!.textStillWanted(report, e164),
      onSettled: (report, delivery) => late.sender!.markText(report, delivery),
      now: () => clock.now,
    });
    const sender = createOutboxSender({ meta: h.meta, manager: h.manager, viewFor: views.viewFor, writes, live: () => producers.live(), secret: TEST_SECRET, logger, texts: () => texts });
    late.sender = sender;
    const inboundJobs: string[] = [];
    const channel = createSmsInboundChannel({ meta, secret: TEST_SECRET, sms, consent, reports: (report) => texts.applyReport(report), confirmations: (request) => texts.confirmStop(request), networkFeatures: true, desktop: false, trustProxy: false, fetch: fetchStub, now: () => clock.now });
    const core = createInboundCore({ meta, secret: TEST_SECRET, channels: [channel], now: () => clock.now, enqueue: async (eventId) => inboundJobs.push(eventId) });
    late.channel = channel;
    late.core = core;

    app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    await app.register(async (api) => api.register(inboundRoutes({ core, channels: [channel], secret: TEST_SECRET, now: () => clock.now })), { prefix: '/api/v1' });
    await app.ready();
    const address = (await channel.replyReach()).address;
    const door = address === null ? '/none' : new URL(address).pathname;
    const postTwilio = (fields: Record<string, string>) => {
      const form = new URLSearchParams({ AccountSid: ACCOUNT_SID, ...fields });
      let signed = `${ORIGIN}${door}`;
      for (const name of [...new Set(form.keys())].sort()) for (const value of [...new Set(form.getAll(name))].sort()) signed += name + value;
      return app!.inject({ method: 'POST', url: door, payload: form.toString(), headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-twilio-signature': createHmac('sha1', SIGNING_VALUE).update(signed, 'utf8').digest('base64') } });
    };
    const drain = async () => {
      for (const eventId of inboundJobs.splice(0)) await core.run(eventId, { attempt: 1, maxAttempts: 5 });
    };

    /** The worker's own moves on the real jobs table: claim, run, complete or fail. */
    const runJobs = async () => {
      const repo = jobsRepo(meta);
      for (let turn = 0; turn < 12; turn += 1) {
        const job = await repo.claim('test-worker', clock.now);
        if (job === null) return;
        try {
          await texts.handOver(smsSendPayloadSchema.parse(job.payload), { attempt: job.attempts, maxAttempts: job.maxAttempts, signal: new AbortController().signal });
          await repo.complete(job.id, clock.now);
        } catch (error) {
          await repo.fail(job.id, error instanceof TextRetryLater ? error.message : 'failed', clock.now);
        }
      }
    };
    return { sender, texts, provider, postTwilio, drain, runJobs };
  }

  it.skipIf(!available)('a person known only by phone: row, job, provider, delivery report, STOP, and the next text refused', async () => {
    const { sender, provider, postTwilio, drain, runJobs } = await wire();
    const mia = await patient('Mia Okada', MIA);
    await agree(MIA);

    const first = await queued(mia);
    await sender.sendApp('clinic', clock.now);
    expect(await message(first)).toMatchObject({ status: 'sent', error: null, to: MIA });
    expect(provider.posts).toHaveLength(0);

    await runJobs();
    expect(provider.posts).toHaveLength(1);
    const body = new URLSearchParams(provider.posts[0]!.body);
    expect(body.get('To')).toBe(MIA);
    expect(body.get('Body')).toContain(WORDS);
    expect((await envelopes()).every((one) => one.envelope === SEALED_TEXT_GONE)).toBe(true);

    expect((await postTwilio({ MessageSid: TWILIO_MESSAGE, SmsSid: TWILIO_MESSAGE, MessageStatus: 'delivered', From: FROM, To: MIA })).statusCode).toBeLessThan(300);
    await drain();
    expect((await store.byProviderMessage('twilio', TWILIO_MESSAGE))?.providerStatus).toBe('delivered');
    expect(await message(first)).toMatchObject({ status: 'sent', error: null });

    const stop = `SM${'ef'.repeat(16)}`;
    expect((await postTwilio({ MessageSid: stop, SmsSid: stop, From: MIA, To: FROM, Body: 'STOP PLEASE', NumSegments: '1' })).statusCode).toBeLessThan(300);
    await drain();
    await runJobs();
    expect(await consent.stop.has(MIA, null)).toBe(true);
    const confirmation = provider.posts.slice(1).map((post) => new URLSearchParams(post.body).get('Body'));
    expect(confirmation).toEqual([SMS_STOP_CONFIRMATION]);

    const sent = provider.posts.length;
    const next = await queued(mia);
    await sender.sendApp('clinic', clock.now);
    await runJobs();
    expect(await message(next)).toMatchObject({ status: 'skipped', error: textReasonSentence('stopped') });
    expect(provider.posts).toHaveLength(sent);

    // Nothing the server wrote about it quotes the number or the words.
    expect(logged.join('\n')).not.toContain(MIA);
    expect(logged.join('\n')).not.toContain(WORDS);
    expect(JSON.stringify(await meta.db.selectFrom('adminium_jobs').selectAll().execute())).not.toContain(MIA);
  });

  it.skipIf(!available)('one reminder across a shut window stays one row, keeps its due, and sends one text', async () => {
    const { sender, provider, runJobs } = await wire();
    const mia = await patient('Mia Okada', MIA);
    await agree(MIA);
    await h.rows(`INSERT INTO ${h.real('visits')} (patient_id, starts_at, state) VALUES (${mia}, ${visitAt()}, 'booked')`);
    clock.now = NIGHT;

    for (let minute = 0; minute < 5; minute += 1) {
      await producers.scan(clock.now);
      await sender.sendApp('clinic', clock.now);
      await runJobs();
      clock.now += 60_000;
    }
    const rows = await h.rows(`SELECT id, due_at FROM ${h.real('messages')}`);
    expect(rows).toHaveLength(1);
    const before = await message(Number(rows[0]!['id']));
    expect(before.status).toBe('sent');
    expect(new Date(String(before.due)).getTime()).toBe(Date.parse(VISIT));
    expect(provider.posts).toHaveLength(0);
    const [job] = (await jobRows()).open;
    expect(job?.runAt).toBe(MORNING);

    clock.now = MORNING;
    await producers.scan(clock.now);
    await sender.sendApp('clinic', clock.now);
    await runJobs();
    expect(provider.posts).toHaveLength(1);
    expect(await h.rows(`SELECT id FROM ${h.real('messages')}`)).toHaveLength(1);
    expect(new Date(String((await message(Number(rows[0]!['id']))).due)).getTime()).toBe(Date.parse(VISIT));
  });

  it.skipIf(!available)('a visit called off while its text waits for the window sends nothing, and the row says so', async () => {
    const { sender, provider, runJobs } = await wire();
    const mia = await patient('Mia Okada', MIA);
    await agree(MIA);
    await h.rows(`INSERT INTO ${h.real('visits')} (patient_id, starts_at, state) VALUES (${mia}, ${visitAt()}, 'booked')`);
    clock.now = NIGHT;
    await producers.scan(clock.now);
    await sender.sendApp('clinic', clock.now);
    await h.rows(`UPDATE ${h.real('visits')} SET state = 'cancelled'`);
    clock.now = MORNING;
    await runJobs();
    expect(provider.posts).toHaveLength(0);
    const [row] = await h.rows(`SELECT id FROM ${h.real('messages')}`);
    expect(await message(Number(row!['id']))).toMatchObject({ status: 'skipped', error: textReasonSentence('no-longer-needed') });
    expect((await envelopes()).every((one) => one.envelope === SEALED_TEXT_GONE)).toBe(true);
  });

  it.skipIf(!available)('with no provider connected the row says so and nothing is queued', async () => {
    const { sender, provider } = await wire({ connected: false });
    const mia = await patient('Mia Okada', MIA);
    const mid = await queued(mia);
    await sender.sendApp('clinic', clock.now);
    expect(await message(mid)).toMatchObject({ status: 'skipped', error: TEXT_NOT_CONNECTED });
    expect((await jobRows()).all).toHaveLength(0);
    expect(provider.posts).toHaveLength(0);
  });

  it.skipIf(!available)('a person with no number, or one that cannot be read, is a clear row and no call', async () => {
    const { sender, provider, runJobs } = await wire();
    const none = await queued(await patient('No Number', null));
    const junk = await queued(await patient('Junk Number', '12345'));
    await sender.sendApp('clinic', clock.now);
    await runJobs();
    expect(await message(none)).toMatchObject({ status: 'skipped', error: TEXT_NO_NUMBER });
    expect(await message(junk)).toMatchObject({ status: 'skipped', error: textReasonSentence('unreadable-phone') });
    expect(provider.posts).toHaveLength(0);
  });

  it.skipIf(!available)('no consent, +86, the daily limit and a thrown decide each stop the send', async () => {
    const first = await wire({ policy: { dailyLimit: 1 } });
    const refuser = await queued(await patient('Never Agreed', KAI));
    await agree('+8613800138000');
    const china = await queued(await patient('Li Wei', '+8613800138000'));
    await first.sender.sendApp('clinic', clock.now);
    expect(await message(refuser)).toMatchObject({ status: 'skipped', error: textReasonSentence('no-consent') });
    expect(await message(china)).toMatchObject({ status: 'skipped', error: textReasonSentence('country-blocked') });

    await agree(MIA);
    const day = new Date(clock.now).toISOString().slice(0, 10);
    await meta.db.insertInto('adminium_text_send_days').values({ day, used: 1, updatedAt: clock.now }).execute();
    const full = await queued(await patient('Mia Okada', MIA));
    await first.sender.sendApp('clinic', clock.now);
    expect(await message(full)).toMatchObject({ status: 'skipped', error: textReasonSentence('daily-limit') });
    expect(first.provider.posts).toHaveLength(0);
    await app?.close();
    app = null;

    const broken = { ...consent, decide: async () => { throw new Error(`decide failed for ${MIA}`); } } as TextConsentService;
    const second = await wire({ consent: broken });
    const thrown = await queued(await patient('Mia Again', MIA));
    await second.sender.sendApp('clinic', clock.now);
    expect(await message(thrown)).toMatchObject({ status: 'failed', error: TEXT_NOT_CHECKED });
    expect(second.provider.posts).toHaveLength(0);
    expect(logged.join('\n')).not.toContain(MIA);
  });

  it.skipIf(!available)('a Twilio timeout is never resent: the row stays sent and unknown, and a re-queue opens nothing', async () => {
    const { sender, provider, runJobs } = await wire({ script: ['hang'] });
    const mia = await patient('Mia Okada', MIA);
    await agree(MIA);
    const mid = await queued(mia);
    await sender.sendApp('clinic', clock.now);
    await runJobs();
    expect(provider.posts).toHaveLength(1);
    expect(await message(mid)).toMatchObject({ status: 'sent', error: TEXT_UNKNOWN });

    // A person forces the row back to queued, past the desk's own rules.
    await h.rows(`UPDATE ${h.real('messages')} SET status = 'queued' WHERE id = ${mid}`);
    clock.now += 60_000;
    await sender.sendApp('clinic', clock.now);
    await runJobs();
    expect(provider.posts).toHaveLength(1);
    expect(await message(mid)).toMatchObject({ status: 'sent', error: TEXT_EARLIER_OPEN });
  });

  it.skipIf(!available)('two workers holding one row send one text', async () => {
    const { sender, provider, runJobs } = await wire();
    const mia = await patient('Mia Okada', MIA);
    await agree(MIA);
    await queued(mia);
    await Promise.all([sender.sendApp('clinic', clock.now), sender.sendApp('clinic', clock.now)]);
    await Promise.all([runJobs(), runJobs()]);
    expect(provider.posts).toHaveLength(1);
    expect((await meta.db.selectFrom('adminium_text_deliveries').select('id').execute())).toHaveLength(1);
  });

  it.skipIf(!available)('an erasure blanks the queued text of that person only, and their text never goes', async () => {
    const { sender, provider, runJobs, texts } = await wire();
    await agree(MIA);
    await agree(KAI);
    await h.rows(`INSERT INTO ${h.real('visits')} (patient_id, starts_at, state) VALUES (${await patient('Mia Okada', MIA)}, ${visitAt()}, 'booked'), (${await patient('Kai Renner', KAI)}, ${visitAt()}, 'booked')`);
    clock.now = NIGHT;
    await producers.scan(clock.now);
    await sender.sendApp('clinic', clock.now);
    const held = await envelopes();
    expect(held).toHaveLength(2);
    expect(held.every((one) => one.envelope !== SEALED_TEXT_GONE)).toBe(true);

    const inbound = createInboundCore({ meta, secret: TEST_SECRET, channels: [], now: () => clock.now, enqueue: async () => undefined });
    const erasure = createTextErasure({ meta, consent, inbound, deliveries: store, phoneKeys: textPhoneKeys(meta, TEST_SECRET), country: async () => 'DE' });
    const erased = await erasure.erase({ phone: MIA, country: 'DE', person: null, at: clock.now, everywhere: true });
    expect(erased.deliveries).toBe(1);

    const after = await envelopes();
    expect(after.filter((one) => one.envelope === SEALED_TEXT_GONE)).toHaveLength(1);
    expect(after.filter((one) => one.envelope !== SEALED_TEXT_GONE)).toHaveLength(1);
    const kept = after.find((one) => one.envelope !== SEALED_TEXT_GONE)!;
    expect((await texts.delivery(kept.deliveryId))?.phoneMasked).toContain('780');

    clock.now = MORNING;
    await runJobs();
    expect(provider.posts).toHaveLength(1);
    expect(new URLSearchParams(provider.posts[0]!.body).get('To')).toBe(KAI);
  });

  it.skipIf(!available)('an envelope a dead job left behind is blanked by the sweep once its delivery has ended', async () => {
    const { sender, runJobs, texts } = await wire();
    const mia = await patient('Mia Okada', MIA);
    await agree(MIA);
    await queued(mia);
    await sender.sendApp('clinic', clock.now);
    await runJobs();
    const [done] = await envelopes();
    // As if the job had died before it could blank its own envelope.
    await meta.db.updateTable('adminium_jobs').set({ payload: JSON.stringify({ v: 1, deliveryId: done!.deliveryId, envelope: 'still-sealed' }) as never }).where('kind', '=', SMS_SEND_JOB_KIND).execute();
    await texts.settleAbandoned(clock.now - 3_600_000);
    expect((await envelopes()).every((one) => one.envelope === SEALED_TEXT_GONE)).toBe(true);
  });

  it.skipIf(!available)('a late failure reaches the row, a later delivered clears it, and repeating either changes nothing', async () => {
    const { sender, postTwilio, drain, runJobs } = await wire();
    const mia = await patient('Mia Okada', MIA);
    await agree(MIA);
    const mid = await queued(mia);
    await sender.sendApp('clinic', clock.now);
    await runJobs();
    const report = (word: string) => postTwilio({ MessageSid: TWILIO_MESSAGE, SmsSid: TWILIO_MESSAGE, MessageStatus: word, From: FROM, To: MIA, ErrorCode: word === 'undelivered' ? '30003' : '' });
    await report('undelivered');
    await drain();
    expect(await message(mid)).toMatchObject({ status: 'failed', error: 'Not delivered: the provider reports it failed' });
    const delivery = await store.byProviderMessage('twilio', TWILIO_MESSAGE);
    await sender.markText(delivery!.reportTarget!, delivery!);
    expect(await message(mid)).toMatchObject({ status: 'failed' });

    await sender.markText(delivery!.reportTarget!, { ...delivery!, state: 'accepted', reason: null });
    expect(await message(mid)).toMatchObject({ status: 'sent', error: null });
    await sender.markText(delivery!.reportTarget!, { ...delivery!, state: 'accepted', reason: null });
    expect(await message(mid)).toMatchObject({ status: 'sent', error: null });
  });

  it.skipIf(!available)('a failure report for an earlier send leaves a row sent again since alone', async () => {
    const { sender, runJobs } = await wire();
    const mia = await patient('Mia Okada', MIA);
    await agree(MIA);
    const mid = await queued(mia);
    await sender.sendApp('clinic', clock.now);
    await runJobs();
    const first = await store.byProviderMessage('twilio', TWILIO_MESSAGE);
    await h.rows(`UPDATE ${h.real('messages')} SET status = 'queued', sent_at = NULL WHERE id = ${mid}`);
    clock.now += 120_000;
    await sender.sendApp('clinic', clock.now);
    await runJobs();
    expect(await message(mid)).toMatchObject({ status: 'sent', error: null });
    await sender.markText(first!.reportTarget!, { ...first!, state: 'provider-failed' });
    expect(await message(mid)).toMatchObject({ status: 'sent', error: null });
  });

  it.skipIf(!available)('a worker that died holding the marker never sends again', async () => {
    const { sender, provider, runJobs } = await wire();
    const mia = await patient('Mia Okada', MIA);
    await agree(MIA);
    const mid = await queued(mia);
    await sender.sendApp('clinic', clock.now);
    const [{ deliveryId }] = (await envelopes()) as [{ deliveryId: string; envelope: string }];
    const row = await store.byId(deliveryId);
    // What a worker saves just before it calls the provider, and then the process is gone.
    await store.begin(deliveryId, row!.version, { at: clock.now, account: 'acct-ref', earlier: null });
    await runJobs();
    expect(provider.posts).toHaveLength(0);
    expect((await store.byId(deliveryId))?.state).toBe('unknown');
    expect(await message(mid)).toMatchObject({ status: 'sent', error: TEXT_UNKNOWN });
  });

  it.skipIf(!available)('a person whose number was blanked sends nothing', async () => {
    const { sender, provider, runJobs } = await wire();
    const none = await queued(await patient('Erased Person', ''));
    await sender.sendApp('clinic', clock.now);
    await runJobs();
    expect(await message(none)).toMatchObject({ status: 'skipped', error: TEXT_NO_NUMBER });
    expect(provider.posts).toHaveLength(0);
  });

  it.skipIf(!available)('a visit moved while its text waits sends nothing for the old time', async () => {
    const { sender, provider, runJobs } = await wire();
    const mia = await patient('Mia Okada', MIA);
    await agree(MIA);
    await h.rows(`INSERT INTO ${h.real('visits')} (patient_id, starts_at, state) VALUES (${mia}, ${visitAt()}, 'booked')`);
    clock.now = NIGHT;
    await producers.scan(clock.now);
    await sender.sendApp('clinic', clock.now);
    const later = new Date(Date.parse(VISIT) + 3_600_000).toISOString();
    await h.rows(`UPDATE ${h.real('visits')} SET starts_at = ${dialect === 'mysql' ? cell(new Date(later).toLocaleString('sv')) : cell(later)}`);
    clock.now = MORNING;
    await runJobs();
    expect(provider.posts).toHaveLength(0);
    const [row] = await h.rows(`SELECT id FROM ${h.real('messages')} ORDER BY id`);
    expect(await message(Number(row!['id']))).toMatchObject({ status: 'skipped', error: textReasonSentence('no-longer-needed') });
  });

  it.skipIf(!available)('a row whose number an erasure blanked while it waited sends nothing', async () => {
    const { sender, provider, runJobs } = await wire();
    const mia = await patient('Mia Okada', MIA);
    await agree(MIA);
    await h.rows(`INSERT INTO ${h.real('visits')} (patient_id, starts_at, state) VALUES (${mia}, ${visitAt()}, 'booked')`);
    clock.now = NIGHT;
    await producers.scan(clock.now);
    await sender.sendApp('clinic', clock.now);
    await h.rows(`UPDATE ${h.real('messages')} SET to_address = NULL`);
    clock.now = MORNING;
    await runJobs();
    expect(provider.posts).toHaveLength(0);
    expect((await envelopes()).every((one) => one.envelope === SEALED_TEXT_GONE)).toBe(true);
  });

  it.skipIf(!available)('a send path that throws leaves a clear row and no number in the log', async () => {
    const { sender, texts, provider } = await wire();
    const original = texts.prepare;
    texts.prepare = async () => {
      throw new Error(`could not read ${MIA}`);
    };
    const mid = await queued(await patient('Mia Okada', MIA));
    await sender.sendApp('clinic', clock.now);
    texts.prepare = original;
    expect(await message(mid)).toMatchObject({ status: 'failed', error: TEXT_NOT_PREPARED });
    expect(provider.posts).toHaveLength(0);
    expect(logged.join('\n')).not.toContain(MIA);
  });

  it.skipIf(!available)('a sample row and a rehearsal never reach the send path', async () => {
    const { sender, texts, provider, runJobs } = await wire();
    const asked: unknown[] = [];
    const original = texts.prepare;
    texts.prepare = async (input) => {
      asked.push(input);
      return original(input);
    };
    const mia = await patient('Mia Okada', MIA);
    await agree(MIA);
    // Keys of their own: SQLite hands a deleted row's key out again, and these two stay marked.
    await h.rows(`INSERT INTO ${h.real('messages')} (id, kind, status, patient_id) VALUES (9001, 'confirm_text', 'queued', ${mia}), (9002, 'confirm_text', 'queued', ${mia})`);
    const ledger = 'clinic_sample_rows';
    await h.rows(`CREATE TABLE ${ledger} (seq INTEGER PRIMARY KEY, table_ref VARCHAR(64) NOT NULL, pk VARCHAR(200) NOT NULL)`);
    await h.rows(`INSERT INTO ${ledger} (seq, table_ref, pk) VALUES (1, 'messages', '{"id":9001}')`);
    await appTablesRepo(h.meta).record({ appKey: 'clinic', manifestId: null, connectionId: h.connectionId, ref: 'sample_data', tableName: ledger, owned: true, state: 'created', role: 'sample-ledger' });
    const view = await createPublicViews(h.meta).viewFor(h.connectionId);
    await noteRehearsalRow(h.meta, h.connectionId, view!.model.tables.find((table) => table.name === h.real('messages'))!.id, { id: 9002 }, 'usr_rehearsing');

    await sender.sendApp('clinic', clock.now);
    await runJobs();
    expect(await message(9001)).toMatchObject({ status: 'skipped', error: TEXT_SAMPLE });
    expect(await message(9002)).toMatchObject({ status: 'skipped', error: TEXT_REHEARSAL });
    expect(asked).toHaveLength(0);
    expect(provider.posts).toHaveLength(0);
  });
});

describe('an outbox with no email column', () => {
  const withKinds = (more: Record<string, unknown>) => {
    const manifest = clinicManifest();
    const outbox = manifest['outbox'] as Record<string, unknown>;
    return { ...manifest, outbox: { ...outbox, ...more } };
  };

  it('is valid when every kind is a text', () => {
    expect(validateManifest(clinicManifest(), { allowLocalPublisher: true }).ok).toBe(true);
  });

  it('is refused when any kind is an email, naming the column it needs', () => {
    const verdict = validateManifest(withKinds({ channels: { reminder_text: 'sms' } }), { allowLocalPublisher: true });
    expect(verdict.ok).toBe(false);
    expect(JSON.stringify(verdict)).toContain('outbox that sends email names the column');
  });
});

/** The same clinic with an email column and one email kind beside its text kind. */
function bothChannelsManifest(): Record<string, unknown> {
  const manifest = clinicManifest();
  const tables = (manifest['requiredSchema'] as { tables: { ref: string; columns: Record<string, unknown>[] }[] }).tables.map((table) => {
    if (table.ref === 'patients') return { ...table, columns: [...table.columns, text('email', 254, { rules: { personal: true } })] };
    if (table.ref === 'messages') return { ...table, columns: table.columns.map((column) => (column['ref'] === 'kind' ? { ...column, enum: ['confirm_text', 'reminder_text', 'confirm_mail'] } : column)) };
    return table;
  });
  const outbox = manifest['outbox'] as Record<string, Record<string, unknown>>;
  return {
    ...manifest,
    requiredSchema: { prefixed: true, tables },
    people: [{ table: 'patients', kind: 'people', email: 'email', phone: 'mobile', name: 'name' }],
    emailTemplates: [{ key: 'clinic-confirm-mail', name: 'Visit confirmed', locales: { 'en-US': { subject: 'Your visit', blocks: [{ block: 'email.text', data: { text: 'See you soon.' } }] } } }],
    outbox: {
      ...outbox,
      recipient: { ...outbox['recipient'], email: 'email' },
      kinds: { ...outbox['kinds'], confirm_mail: 'clinic-confirm-mail' },
      classes: { ...outbox['classes'], confirm_mail: 'service' },
    },
  };
}

describe.each(LEGS)('an app with both channels and no text provider — %s', (dialect, available) => {
  let h: InvoicingHarness;

  beforeAll(async () => {
    if (!available) return;
    h = await installInvoicing(dialect, bothChannelsManifest());
    await settingsRepo(h.meta).set('email.smtp', SMTP as never);
  }, 180_000);
  afterAll(async () => {
    if (available) await h.close();
  });

  it.skipIf(!available)('its email still goes, and its text says no provider is connected', async () => {
    const views = createPublicViews(h.meta);
    const writes = createWriteService({ sequences: documentSequencesRepo(h.meta) });
    const producers = createOutboxProducers({ meta: h.meta, manager: h.manager, viewFor: views.viewFor, writes });
    const sender = createOutboxSender({ meta: h.meta, manager: h.manager, viewFor: views.viewFor, writes, live: () => producers.live(), secret: TEST_SECRET, texts: () => null });
    await h.rows(`INSERT INTO ${h.real('patients')} (name, mobile, email) VALUES ('Mia Okada', '${MIA}', 'mia@waveform.dev')`);
    await h.rows(`INSERT INTO ${h.real('messages')} (kind, status, patient_id) VALUES ('confirm_mail', 'queued', 1), ('confirm_text', 'queued', 1)`);
    await sender.sendApp('clinic', NOON);
    const rows = await h.rows(`SELECT kind, status, error FROM ${h.real('messages')} ORDER BY id`);
    expect(rows[0]).toMatchObject({ kind: 'confirm_mail', status: 'sent' });
    expect(rows[1]).toMatchObject({ kind: 'confirm_text', status: 'skipped', error: TEXT_NOT_CONNECTED });
    expect(await h.meta.db.selectFrom('adminium_jobs').select('id').where('kind', '=', 'email.send').execute()).toHaveLength(1);
    expect(await h.meta.db.selectFrom('adminium_jobs').select('id').where('kind', '=', SMS_SEND_JOB_KIND).execute()).toHaveLength(0);
  });
});
