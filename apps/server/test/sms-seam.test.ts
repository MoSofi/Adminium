// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The real send path and the real inbound channel, wired as the server wires
 * them, on every engine. Only the provider is a stub, written from its public
 * documentation, so this proves the seam between the two halves and cannot
 * prove the live APIs.
 */
import { createHmac, generateKeyPairSync, randomUUID, sign } from 'node:crypto';

import { settingsRepo, type EnqueueJobInput } from '@adminium/meta';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import type { Kysely } from 'kysely';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createInboundCore, inboundRoutes, type InboundCore } from '../src/inbound/index.js';
import { createTextConsentService, textSubject, type TextConsentService } from '../src/sms/consent/index.js';
import { SMS_STOP_CONFIRMATION, SMS_STOP_EVENT_KINDS, SMS_SWEEP_CATCH_UP_EVERY_MS, createSmsInboundChannel, type SmsInboundChannel, type SmsStopConfirmation } from '../src/sms/inbound/index.js';
import { createSmsService, type SmsCredentialInput } from '../src/sms/index.js';
import {
  SMS_SEND_ATTEMPTS,
  TextRetryLater,
  createTextSendPath,
  createTextSendStore,
  textPhoneKeys,
  type SmsSendPayload,
  type TextDelivery,
  type TextPrepareInput,
  type TextSendPath,
  type TextSendReport,
  type TextSendStore,
} from '../src/sms/send/index.js';
import { memorySmsStore } from './helpers/sms-store.js';
import { META_ENGINES, type MetaHandle } from './meta-dialects.js';
import { json, stubProvider, type ProviderStep } from './sms-send.helpers.js';

const SECRET = 'a-seam-test-secret-of-some-length';
const ORIGIN = 'https://texts.lumen.example';
const PROFILE = '11111111-2222-4333-8444-555555555555';
const SIGNING_VALUE = 'made-up-token-for-these-tests';
const ACCOUNT_SID = `AC${'ab'.repeat(16)}`;
const keys = generateKeyPairSync('ed25519');
const PUBLIC_KEY = keys.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64');
const TWILIO: SmsCredentialInput = { provider: 'twilio', accountSid: ACCOUNT_SID, authToken: SIGNING_VALUE };
const TELNYX: SmsCredentialInput = { provider: 'telnyx', apiKey: 'made-up-telnyx-key-for-tests', publicKey: PUBLIC_KEY, messagingProfileId: PROFILE };
const FROM = '+14155550100';
const DE = '+4915123456789';
const DE_TWO = '+4915123456780';
const TWILIO_MESSAGE = `SM${'cd'.repeat(16)}`;
const TELNYX_MESSAGE = '40385f64-5717-4562-b3fc-2c963f66afa6';
const NOON = Date.parse('2026-06-15T12:00:00Z');
const TARGET: TextSendReport = { app: 'bistro', connectionId: 'con_1', table: 'public.outbox', pk: { id: 7 } };

const attempt = (n = 1) => ({ attempt: n, maxAttempts: SMS_SEND_ATTEMPTS, signal: new AbortController().signal });

describe.each(META_ENGINES)('the send path and the inbound channel, wired — $name', (engine) => {
  let handle: MetaHandle;
  let clock: { now: number };
  let consent: TextConsentService;
  let store: TextSendStore;
  let app: FastifyInstance | null = null;

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
    for (const table of ['adminium_text_deliveries', 'adminium_text_send_days', 'adminium_text_stop_list', 'adminium_text_consent_log', 'adminium_inbound_events', 'adminium_jobs']) await db.deleteFrom(table).execute();
    await settingsRepo(handle.meta).set('system.publicOrigin', ORIGIN, { updatedBy: null });
    clock = { now: NOON };
    consent = createTextConsentService({ meta: handle.meta, secret: SECRET, now: () => clock.now });
    store = createTextSendStore(handle.meta);
  });
  afterEach(async () => {
    await app?.close();
    app = null;
  });

  const agree = (phone: string) => consent.record({ phone, purpose: 'text-service', state: 'yes', source: 'form', detail: 'Booking form', wording: { text: 'Text me about my bookings.', version: 'v1' }, at: clock.now - 1000 });

  const input = (more: Partial<TextPrepareInput> = {}): TextPrepareInput => ({ phone: DE, textClass: 'service', template: 'Your table is ready.', values: {}, zone: 'UTC', business: { name: 'Lumen', email: 'hello@lumen.example' }, ...more });

  interface WireOptions {
    credentials?: SmsCredentialInput;
    script?: ProviderStep[];
    policy?: unknown;
    /** What the provider lists as inbound messages. */
    messages?: unknown[];
    onSettled?: (report: TextSendReport, delivery: TextDelivery) => Promise<void>;
  }

  async function wire(options: WireOptions = {}) {
    const credentials = options.credentials ?? TWILIO;
    const provider = stubProvider(credentials.provider, PROFILE, options.script ?? []);
    const listCalls: string[] = [];
    const fetchStub = (async (url: string | URL | Request, init?: RequestInit) => {
      if ((init?.method ?? 'GET') === 'GET' && String(url).includes('/Messages.json')) {
        listCalls.push(String(url));
        return json(200, { messages: options.messages ?? [], next_page_uri: null });
      }
      return provider.fetchStub(url, init);
    }) as typeof fetch;
    const sms = createSmsService({ store: memorySmsStore(), secret: SECRET, fetch: fetchStub, now: () => clock.now, timeoutMs: 30, stopList: { isStopped: (e164) => consent.stop.has(e164, null), recordProviderOptOut: async () => undefined } });
    await sms.connect(credentials, null);
    await sms.setSending({ sender: { kind: 'number', value: FROM }, defaultCountry: 'DE' }, null);

    const jobs: EnqueueJobInput[] = [];
    const settled: { report: TextSendReport; delivery: TextDelivery }[] = [];
    const inboundJobs: string[] = [];
    // Each side needs the other, as in the server's own wiring.
    const late: { channel?: SmsInboundChannel; core?: InboundCore } = {};
    const texts: TextSendPath = createTextSendPath({
      sms,
      consent,
      store,
      secret: SECRET,
      policy: async () => options.policy ?? {},
      repliesReachUs: async () => (await late.channel!.replyReach()).canReceiveStop,
      callbackUrl: async () => (await late.channel!.replyReach()).address,
      inboundWaiting: (e164) => late.core!.waitingFrom(textSubject(e164), SMS_STOP_EVENT_KINDS),
      operatorAllows: () => true,
      phoneKeys: textPhoneKeys(handle.meta, SECRET),
      enqueue: async (job) => void jobs.push(job),
      onSettled: options.onSettled ?? (async (report, delivery) => void settled.push({ report, delivery })),
      now: () => clock.now,
    });
    const channel = createSmsInboundChannel({
      meta: handle.meta,
      secret: SECRET,
      sms,
      consent,
      reports: (report) => texts.applyReport(report),
      confirmations: (request) => texts.confirmStop(request),
      networkFeatures: true,
      desktop: false,
      trustProxy: false,
      fetch: fetchStub,
      now: () => clock.now,
    });
    const core = createInboundCore({ meta: handle.meta, secret: SECRET, channels: [channel], now: () => clock.now, enqueue: async (id) => inboundJobs.push(id) });
    late.channel = channel;
    late.core = core;

    app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    await app.register(async (api) => api.register(inboundRoutes({ core, channels: [channel], secret: SECRET, now: () => clock.now })), { prefix: '/api/v1' });
    await app.ready();

    const address = (await channel.replyReach()).address!;
    const door = new URL(address).pathname;

    const postTwilio = (fields: Record<string, string>) => {
      const form = new URLSearchParams({ AccountSid: ACCOUNT_SID, ...fields });
      // What Twilio signs: the address without its `#` part.
      let signed = `${ORIGIN}${door}`;
      for (const name of [...new Set(form.keys())].sort()) for (const value of [...new Set(form.getAll(name))].sort()) signed += name + value;
      return app!.inject({ method: 'POST', url: door, payload: form.toString(), headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-twilio-signature': createHmac('sha1', SIGNING_VALUE).update(signed, 'utf8').digest('base64') } });
    };
    const postTelnyx = (envelope: unknown) => {
      const raw = JSON.stringify(envelope);
      const timestamp = String(Math.floor(clock.now / 1000));
      const signature = sign(null, Buffer.from(`${timestamp}|${raw}`), keys.privateKey).toString('base64');
      return app!.inject({ method: 'POST', url: door, payload: raw, headers: { 'content-type': 'application/json', 'telnyx-signature-ed25519': signature, 'telnyx-timestamp': timestamp } });
    };
    const drain = async (): Promise<void> => {
      for (const id of inboundJobs.splice(0)) await core.run(id, { attempt: 1, maxAttempts: 5 });
    };
    const sendOne = async (more: Partial<TextPrepareInput> = {}, messageKey = 'app-outbox:bistro:outbox:7') => {
      const ready = await texts.prepare(input(more));
      if (ready.action !== 'send') throw new Error(`expected a text to send, got ${JSON.stringify(ready)}`);
      const queued = await texts.queue(ready, { messageKey, claimKey: String(clock.now), report: TARGET });
      if (!queued.queued) throw new Error('expected it to queue');
      const outcome = await texts.handOver(jobs.at(-1)!.payload as SmsSendPayload, attempt());
      return { id: queued.deliveryId, outcome };
    };
    return { texts, channel, core, provider, jobs, settled, listCalls, address, postTwilio, postTelnyx, drain, sendOne };
  }

  const twilioStatus = (word: string, extra: Record<string, string> = {}) => ({ MessageSid: TWILIO_MESSAGE, SmsSid: TWILIO_MESSAGE, MessageStatus: word, From: FROM, To: DE, ...extra });
  const twilioReply = (text: string, sid = `SM${randomUUID().replaceAll('-', '')}`) => ({ MessageSid: sid, SmsSid: sid, From: DE, To: FROM, Body: text, NumSegments: '1' });
  const telnyxFinal = (status: string, errors: unknown[] = []) => ({
    data: { event_type: 'message.finalized', id: randomUUID(), occurred_at: new Date(clock.now).toISOString(), record_type: 'event', payload: { id: TELNYX_MESSAGE, direction: 'outbound', from: { phone_number: FROM }, to: [{ phone_number: DE, status }], messaging_profile_id: PROFILE, errors } },
  });

  describe('delivery reports', () => {
    it.runIf(engine.available)('gives the provider the door with its retry override, and a signed report moves the real row', async () => {
      await agree(DE);
      const wired = await wire();
      const { id, outcome } = await wired.sendOne();
      expect(outcome).toMatchObject({ outcome: 'accepted' });
      expect(new URLSearchParams(wired.provider.posts[0]!.body).get('StatusCallback')).toBe(wired.address);
      expect(wired.address.endsWith('#rp=all&rc=5')).toBe(true);
      expect((await wired.postTwilio(twilioStatus('delivered'))).statusCode).toBe(200);
      await wired.drain();
      expect(await store.byId(id)).toMatchObject({ state: 'accepted', providerStatus: 'delivered' });
    });

    it.runIf(engine.available)('keeps the provider word the send path ranks: Telnyx "unconfirmed" is not lost', async () => {
      await agree(DE);
      const wired = await wire({ credentials: TELNYX });
      const { id } = await wired.sendOne();
      await wired.postTelnyx(telnyxFinal('delivery_unconfirmed'));
      await wired.drain();
      expect(await store.byId(id)).toMatchObject({ providerStatus: 'delivery_unconfirmed' });
      await wired.postTelnyx(telnyxFinal('delivered'));
      await wired.drain();
      expect(await store.byId(id)).toMatchObject({ state: 'accepted', providerStatus: 'delivered' });
    });

    it.runIf(engine.available)('a report out of order moves nothing', async () => {
      await agree(DE);
      const wired = await wire();
      const { id } = await wired.sendOne();
      await wired.postTwilio(twilioStatus('delivered'));
      await wired.postTwilio(twilioStatus('sent'));
      await wired.drain();
      expect(await store.byId(id)).toMatchObject({ providerStatus: 'delivered' });
    });

    it.runIf(engine.available)('a late failure reaches the source row, with its error code, once', async () => {
      await agree(DE);
      const wired = await wire();
      const { id } = await wired.sendOne();
      expect(wired.settled.map((one) => one.delivery.state)).toEqual(['accepted']);
      await wired.postTwilio(twilioStatus('undelivered', { ErrorCode: '30003' }));
      await wired.drain();
      expect(await store.byId(id)).toMatchObject({ state: 'provider-failed', providerErrorCode: '30003', settleOwedAt: null });
      expect(wired.settled.map((one) => one.delivery.state)).toEqual(['accepted', 'provider-failed']);
      expect(wired.settled[1]!.report).toEqual(TARGET);
    });

    it.runIf(engine.available)('a source row that could not be told is told by the sweep', async () => {
      await agree(DE);
      const told: string[] = [];
      let down = true;
      const wired = await wire({ onSettled: async (_report, delivery) => {
        if (down) throw new Error('the app database is away');
        told.push(delivery.state);
      } });
      const { id } = await wired.sendOne();
      expect((await store.byId(id))?.settleOwedAt).not.toBeNull();
      down = false;
      await wired.texts.settleAbandoned(clock.now - 60_000);
      expect(told).toEqual(['accepted']);
      expect((await store.byId(id))?.settleOwedAt).toBeNull();
      await wired.texts.settleAbandoned(clock.now - 60_000);
      expect(told).toEqual(['accepted']);
    });
  });

  describe('the STOP confirmation', () => {
    it.runIf(engine.available)('a STOP the provider does not catch gets the one fixed text, from the number they texted', async () => {
      await agree(DE);
      const wired = await wire();
      const reply = twilioReply('STOP PLEASE');
      await wired.postTwilio(reply);
      await wired.drain();
      expect(await consent.stop.has(DE, null)).toBe(true);
      expect(wired.provider.posts).toHaveLength(1);
      const form = new URLSearchParams(wired.provider.posts[0]!.body);
      expect(form.get('Body')).toBe(SMS_STOP_CONFIRMATION);
      expect(form.get('To')).toBe(DE);
      expect(form.get('From')).toBe(FROM);

      await wired.postTwilio(reply);
      await wired.drain();
      expect(wired.provider.posts).toHaveLength(1);
      expect(await wired.texts.prepare(input())).toEqual({ action: 'skip', reason: 'stopped' });
    });

    const request = (over: Partial<SmsStopConfirmation> = {}): SmsStopConfirmation => ({ to: DE, from: FROM, body: SMS_STOP_CONFIRMATION, language: null, sendBy: clock.now + 60_000, dedupeKey: 'sms-stop-confirm:evt_1', ...over });

    it.runIf(engine.available)('sends nothing but the fixed words', async () => {
      await consent.stop.add({ phone: DE, reason: 'text-stop', origin: 'twilio' });
      const wired = await wire();
      expect(await wired.texts.confirmStop(request({ body: 'One last offer!' }))).toEqual({ sent: false, reason: 'not-the-confirmation' });
      expect(wired.provider.posts).toHaveLength(0);
    });

    it.runIf(engine.available)('sends to nobody who is not stopped by their own STOP', async () => {
      const wired = await wire();
      expect(await wired.texts.confirmStop(request())).toEqual({ sent: false, reason: 'not-stopped' });
      await consent.stop.add({ phone: DE, reason: 'staff', staff: { id: 'usr_1', label: 'Dana' } });
      expect(await wired.texts.confirmStop(request())).toEqual({ sent: false, reason: 'not-stopped' });
      expect(wired.provider.posts).toHaveLength(0);
    });

    it.runIf(engine.available)('does not send after its time', async () => {
      await consent.stop.add({ phone: DE, reason: 'text-stop', origin: 'twilio' });
      const wired = await wire();
      expect(await wired.texts.confirmStop(request({ sendBy: clock.now }))).toEqual({ sent: false, reason: 'too-late' });
      expect(wired.provider.posts).toHaveLength(0);
    });

    it.runIf(engine.available)('is never repeated, even when the first try may not have gone', async () => {
      await consent.stop.add({ phone: DE, reason: 'text-stop', origin: 'twilio' });
      const wired = await wire({ script: ['hang'] });
      expect(await wired.texts.confirmStop(request())).toEqual({ sent: false, reason: 'unknown' });
      expect(await wired.texts.confirmStop(request())).toEqual({ sent: false, reason: 'already-asked' });
      expect(wired.provider.posts).toHaveLength(1);
    });

    it.runIf(engine.available)('takes no slot of the daily limit, and a full day does not stop it', async () => {
      await agree(DE_TWO);
      await consent.stop.add({ phone: DE, reason: 'text-stop', origin: 'twilio' });
      const wired = await wire({ policy: { dailyLimit: 1 } });
      await wired.sendOne({ phone: DE_TWO });
      expect(await store.usedOn('2026-06-15')).toBe(1);
      expect(await wired.texts.confirmStop(request())).toMatchObject({ sent: true });
      expect(await store.usedOn('2026-06-15')).toBe(1);
    });
  });

  describe('one open delivery per message', () => {
    const queueAgain = async (texts: TextSendPath, claimKey: string, messageKey = 'app-outbox:bistro:outbox:7') => {
      const ready = await texts.prepare(input());
      if (ready.action !== 'send') throw new Error('expected send');
      return texts.queue(ready, { messageKey, claimKey });
    };

    it.runIf(engine.available)('a re-queue while the first is still queued opens nothing', async () => {
      await agree(DE);
      const wired = await wire();
      expect(await queueAgain(wired.texts, 'one')).toMatchObject({ queued: true });
      expect(await queueAgain(wired.texts, 'two')).toEqual({ queued: false, reason: 'earlier-send-open' });
      expect(wired.jobs).toHaveLength(1);
    });

    it.runIf(engine.available)('a re-queue while Telnyx is being retried under its key cannot send a second text', async () => {
      await agree(DE);
      const wired = await wire({ credentials: TELNYX, script: ['hang'] });
      await queueAgain(wired.texts, 'one');
      await expect(wired.texts.handOver(wired.jobs[0]!.payload as SmsSendPayload, attempt())).rejects.toBeInstanceOf(TextRetryLater);
      expect(await queueAgain(wired.texts, 'two')).toEqual({ queued: false, reason: 'earlier-send-open' });
      expect(wired.provider.posts).toHaveLength(1);
    });

    it.runIf(engine.available)('many claims at once leave one open row', async () => {
      await agree(DE);
      const wired = await wire();
      const made = await Promise.all(Array.from({ length: 8 }, (_, index) => queueAgain(wired.texts, `claim-${String(index)}`)));
      expect(made.filter((one) => one.queued)).toHaveLength(1);
      const db = handle.meta.db as unknown as Kysely<Record<string, Record<string, unknown>>>;
      expect(await db.selectFrom('adminium_text_deliveries').select('id').execute()).toHaveLength(1);
    });

    it.runIf(engine.available)('the slot frees when the delivery ends, and only then', async () => {
      await agree(DE);
      const wired = await wire({ script: ['hang'] });
      const { id, outcome } = await wired.sendOne();
      expect(outcome).toMatchObject({ outcome: 'unknown' });
      expect(await queueAgain(wired.texts, 'two')).toEqual({ queued: false, reason: 'earlier-send-open' });
      await wired.texts.resolveUnknown(id, 'checked-not-sent');
      expect(await queueAgain(wired.texts, 'three')).toMatchObject({ queued: true });
    });

    it.runIf(engine.available)('a queued row that lost its job does not hold the message for good', async () => {
      await agree(DE);
      const wired = await wire();
      const first = await queueAgain(wired.texts, 'one');
      clock.now += 2 * 3_600_000;
      expect(await wired.texts.settleAbandoned(clock.now - 3_600_000)).toBe(1);
      expect(await store.byId((first as { deliveryId: string }).deliveryId)).toMatchObject({ state: 'not-sent', reason: 'could-not-queue' });
      expect(await queueAgain(wired.texts, 'two')).toMatchObject({ queued: true });
    });

    it.runIf(engine.available)('a queued row whose job is still waiting is left alone', async () => {
      await agree(DE);
      const wired = await wire();
      const first = (await queueAgain(wired.texts, 'one')) as { deliveryId: string };
      const db = handle.meta.db as unknown as Kysely<Record<string, Record<string, unknown>>>;
      await db.insertInto('adminium_jobs').values({ id: `job_${randomUUID().replaceAll('-', '').slice(0, 20)}`, kind: 'sms.send', payload: '{}', status: 'pending', priority: 0, runAt: clock.now, attempts: 0, maxAttempts: 5, dedupeKey: `sms.send:${first.deliveryId}:${String(clock.now + 1)}`, createdAt: clock.now }).execute();
      clock.now += 2 * 3_600_000;
      expect(await wired.texts.settleAbandoned(clock.now - 3_600_000)).toBe(0);
      expect(await store.byId(first.deliveryId)).toMatchObject({ state: 'prepared' });
    });
  });

  describe('the daily limit', () => {
    it.runIf(engine.available)('is one count across every business zone', async () => {
      clock.now = Date.parse('2026-06-15T20:00:00Z');
      await agree(DE);
      await agree(DE_TWO);
      const wired = await wire({ policy: { dailyLimit: 1 } });
      // On their own clocks these two are on different calendar days.
      const first = await wired.sendOne({ phone: DE, zone: 'America/Los_Angeles', waiting: true }, 'one');
      expect(first.outcome).toMatchObject({ outcome: 'accepted' });
      expect(await wired.texts.prepare(input({ phone: DE_TWO, zone: 'Asia/Tokyo', waiting: true }))).toEqual({ action: 'skip', reason: 'daily-limit' });
      expect(wired.provider.posts).toHaveLength(1);
      expect(await wired.texts.usage()).toMatchObject({ day: '2026-06-15', used: 1 });
    });

    it.runIf(engine.available)('counts on the server zone it is given', async () => {
      clock.now = Date.parse('2026-06-15T23:30:00Z');
      await agree(DE);
      const wired = await wire({ policy: { dayZone: 'Asia/Tokyo' } });
      await wired.sendOne({ waiting: true });
      expect(await store.usedOn('2026-06-16')).toBe(1);
      expect(await store.usedOn('2026-06-15')).toBe(0);
    });
  });

  describe('a STOP on its way in', () => {
    it.runIf(engine.available)('a text about to go waits for a reply not yet read, and obeys it', async () => {
      await agree(DE);
      const wired = await wire();
      const ready = await wired.texts.prepare(input());
      if (ready.action !== 'send') throw new Error('expected send');
      await wired.texts.queue(ready, { messageKey: 'm', claimKey: 'c' });
      await wired.postTwilio(twilioReply('STOP'));
      const payload = wired.jobs[0]!.payload as SmsSendPayload;
      await expect(wired.texts.handOver(payload, attempt())).rejects.toBeInstanceOf(TextRetryLater);
      expect(wired.provider.posts).toHaveLength(0);
      await wired.drain();
      expect(await wired.texts.handOver(payload, attempt(2))).toEqual({ outcome: 'skipped', reason: 'stopped' });
      expect(wired.provider.posts).toHaveLength(0);
    });

    it.runIf(engine.available)('on the last try it gives up unsent', async () => {
      await agree(DE);
      const wired = await wire();
      const ready = await wired.texts.prepare(input());
      if (ready.action !== 'send') throw new Error('expected send');
      await wired.texts.queue(ready, { messageKey: 'm', claimKey: 'c' });
      await wired.postTwilio(twilioReply('STOP'));
      expect(await wired.texts.handOver(wired.jobs[0]!.payload as SmsSendPayload, attempt(SMS_SEND_ATTEMPTS))).toEqual({ outcome: 'not-sent', reason: 'could-not-check' });
      expect(wired.provider.posts).toHaveLength(0);
    });

    it.runIf(engine.available)('a START arriving late may lift the block, and the STOP\'s no still refuses until a fresh yes', async () => {
      await agree(DE);
      const wired = await wire();
      await wired.postTwilio(twilioReply('STOP'));
      await wired.drain();
      clock.now += 60_000;
      // Twilio's webhook has no time in it, so this START reads as newer whatever order it was sent in.
      await wired.postTwilio(twilioReply('START'));
      await wired.drain();
      expect(await consent.stop.has(DE, null)).toBe(false);
      expect(await wired.texts.prepare(input())).toEqual({ action: 'skip', reason: 'no-consent' });
      clock.now += 60_000;
      await agree(DE);
      clock.now += 1;
      expect(await wired.texts.prepare(input())).toMatchObject({ action: 'send' });
    });
  });

  describe('the sweep', () => {
    const missed = (body: string, to: string) => ({ sid: `SM${randomUUID().replaceAll('-', '')}`, direction: 'inbound', from: DE, to, body, date_sent: new Date(NOON - 60_000).toUTCString() });

    it.runIf(engine.available)('finds a STOP sent to another number of the account, bounded in how often it asks', async () => {
      const wired = await wire({ messages: [missed('STOP', '+14155550199')] });
      await wired.core.sweep();
      expect(new URL(wired.listCalls[0]!).searchParams.has('To')).toBe(false);
      await wired.drain();
      expect(await consent.stop.has(DE, null)).toBe(true);

      await wired.core.sweep();
      expect(wired.listCalls).toHaveLength(1);
      clock.now += SMS_SWEEP_CATCH_UP_EVERY_MS;
      await wired.core.sweep();
      expect(wired.listCalls).toHaveLength(2);
      const db = handle.meta.db as unknown as Kysely<Record<string, Record<string, unknown>>>;
      expect(await db.selectFrom('adminium_inbound_events').select('id').execute()).toHaveLength(1);
    });
  });
});
