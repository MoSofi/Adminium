// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The SMS channel end to end, on every engine: a request signed with a test-only
 * key goes through the real door, the store-once table, the queued job and the
 * real text stop list. Payloads follow the providers' documented shapes. No
 * provider is called, so this cannot prove the live APIs.
 */
import { createHmac, generateKeyPairSync, randomUUID, sign } from 'node:crypto';

import { settingsRepo } from '@adminium/meta';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { sql } from 'kysely';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { InboundJobError, createInboundCore, inboundRoutes, inboundToken, type InboundCore } from '../src/inbound/index.js';
import { createTextConsentService, type TextConsentService } from '../src/sms/consent/index.js';
import { SmsSecret, accountRefOf, type SmsCredentials } from '../src/sms/credentials.js';
import {
  SMS_CONTROL_RETAIN_MS,
  SMS_INBOUND_BODY_LIMIT,
  SMS_STOP_CONFIRMATION,
  createSmsCatchUp,
  createSmsInboundChannel,
  deliveryMoves,
  deliveryStatusOf,
  type SmsDeliveryStatus,
  type SmsInboundChannel,
  type SmsInboundDeps,
  type SmsReplyReceived,
  type SmsStopConfirmation,
} from '../src/sms/inbound/index.js';
import type { SmsAccountView } from '../src/sms/service.js';
import { META_ENGINES, type MetaHandle } from './meta-dialects.js';

const SECRET = 'an-sms-inbound-test-secret-of-length';
const ORIGIN = 'https://texts.lumen.example';
const T0 = 1_800_000_000_000;
/** Runs the job until it stops asking for another try, as the worker would. */
async function toTheEnd(core: Pick<InboundCore, 'run'>, id: string): Promise<{ state: string }> {
  for (let tries = 0; tries < 5; tries += 1) {
    try {
      return await core.run(id);
    } catch (error) {
      if (!(error instanceof InboundJobError)) throw error;
    }
  }
  throw new Error('The event never ended.');
}
const PERSON = '+4915123456789';
const OURS = '+15005550006';
const ACCOUNT_SID = `AC${'ab'.repeat(16)}`;
const SIGNING_VALUE = 'made-up-value-for-these-tests';
const PROFILE = '4001767e-ce0f-4cae-9d5f-0d5e636e7809';
const keys = generateKeyPairSync('ed25519');
const PUBLIC_KEY = keys.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64');

const twilio: SmsCredentials = { provider: 'twilio', accountSid: ACCOUNT_SID, authToken: new SmsSecret(SIGNING_VALUE) };
const telnyx: SmsCredentials = { provider: 'telnyx', apiKey: new SmsSecret('made-up-api-value-for-tests'), publicKey: PUBLIC_KEY, messagingProfileId: PROFILE };

let sidCounter = 0;
const nextSid = (): string => `SM${(++sidCounter).toString(16).padStart(32, '0')}`;

const viewOf = (credentials: SmsCredentials, sender: SmsAccountView['sender'] = { kind: 'number', value: OURS }): SmsAccountView => ({
  provider: credentials.provider,
  accountName: null,
  accountHint: '…0000',
  accountType: 'full',
  keyReadable: true,
  sender,
  senderTakesReplies: 'yes',
  defaultCountry: null,
  check: { ok: true, reason: null, at: T0 },
  savedAt: T0,
  timeoutRetry: credentials.provider === 'twilio' ? 'never' : 'same-key',
});

const json = (status: number, value: unknown): Response => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });

/** The send path's `applyReport` as this channel sees it. `sms-seam.test.ts` runs the real one. */
function memoryLedger() {
  const rows = new Map<string, { status: SmsDeliveryStatus; errorCode: string | null }>();
  const reports: SmsInboundDeps['reports'] = async (report) => {
    const row = rows.get(report.messageId);
    if (row === undefined) return null;
    const incoming = deliveryStatusOf(report.provider, report.status);
    if (incoming !== null && deliveryMoves(row.status, incoming)) rows.set(report.messageId, { status: incoming, errorCode: report.errorCode ?? null });
    return rows.get(report.messageId);
  };
  return { rows, reports, track: (id: string) => rows.set(id, { status: 'queued', errorCode: null }) };
}

describe.each(META_ENGINES)('SMS inbound — $name', (engine) => {
  let handle: MetaHandle;
  let app: FastifyInstance;
  let clock: number;
  let queued: string[];
  let credentials: SmsCredentials | null;
  let view: SmsAccountView | null;
  let consent: TextConsentService;
  let channel: SmsInboundChannel;
  let core: InboundCore;
  let ledger: ReturnType<typeof memoryLedger>;
  let asked: SmsStopConfirmation[];
  let replies: SmsReplyReceived[];
  let logs: string[];
  let facts: { networkFeatures: boolean; desktop: boolean };
  let operatorOff: boolean;

  const only = engine.available ? it : it.skip;

  const path = (provider: 'twilio' | 'telnyx', creds: SmsCredentials): string => `/api/v1/inbound/sms/${provider}/${inboundToken(SECRET, 'sms', provider, accountRefOf(creds))}`;

  function signTwilio(url: string, form: URLSearchParams, value = SIGNING_VALUE): string {
    let text = url;
    for (const name of [...new Set(form.keys())].sort()) for (const one of [...new Set(form.getAll(name))].sort()) text += name + one;
    return createHmac('sha1', value).update(text, 'utf8').digest('base64');
  }

  function postTwilio(fields: Record<string, string>, opts: { value?: string; signAs?: string; headers?: Record<string, string> } = {}) {
    const form = new URLSearchParams({ AccountSid: ACCOUNT_SID, ...fields });
    const target = path('twilio', twilio);
    return app.inject({
      method: 'POST',
      url: target,
      payload: form.toString(),
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-twilio-signature': signTwilio(opts.signAs ?? `${ORIGIN}${target}`, form, opts.value), ...opts.headers },
    });
  }

  const twilioReply = (text: string, sid = nextSid(), from = PERSON) => postTwilio({ MessageSid: sid, SmsSid: sid, From: from, To: OURS, Body: text, NumSegments: '1', NumMedia: '0' });

  function postTelnyx(envelope: unknown, opts: { at?: number; raw?: string } = {}) {
    const raw = opts.raw ?? JSON.stringify(envelope);
    const timestamp = String(Math.floor((opts.at ?? clock) / 1000));
    const signature = sign(null, Buffer.from(`${timestamp}|${raw}`), keys.privateKey).toString('base64');
    return app.inject({
      method: 'POST',
      url: path('telnyx', telnyx),
      payload: raw,
      headers: { 'content-type': 'application/json', 'telnyx-signature-ed25519': signature, 'telnyx-timestamp': timestamp },
    });
  }

  const telnyxReply = (text: string, over: Record<string, unknown> = {}, id: string = randomUUID()) => ({
    data: {
      event_type: 'message.received',
      id,
      occurred_at: new Date(clock).toISOString(),
      record_type: 'event',
      payload: {
        id: randomUUID(),
        direction: 'inbound',
        from: { phone_number: PERSON, carrier: 'x', line_type: 'Wireless' },
        to: [{ phone_number: OURS, status: 'webhook_delivered' }],
        text,
        type: 'SMS',
        messaging_profile_id: PROFILE,
        errors: [],
        ...over,
      },
    },
    meta: { attempt: 1, delivered_to: 'https://example.test' },
  });

  const telnyxStatus = (messageId: string, status: string, type = 'message.finalized', errors: unknown[] = [], id: string = randomUUID()) => ({
    data: {
      event_type: type,
      id,
      occurred_at: new Date(clock).toISOString(),
      record_type: 'event',
      payload: { id: messageId, direction: 'outbound', from: { phone_number: OURS }, to: [{ phone_number: PERSON, status }], text: 'hello', messaging_profile_id: PROFILE, errors },
    },
  });

  async function drain(): Promise<void> {
    const ids = queued;
    queued = [];
    for (const id of ids) await core.run(id);
  }

  const stopped = (phone = PERSON) => consent.stop.has(phone, null);

  async function rows(): Promise<Record<string, unknown>[]> {
    return (await sql<Record<string, unknown>>`select * from adminium_inbound_events`.execute(handle.meta.db)).rows;
  }

  async function serve(over: Partial<SmsInboundDeps> = {}): Promise<void> {
    channel = createSmsInboundChannel({
      meta: handle.meta,
      secret: SECRET,
      sms: { credentials: async () => credentials, view: async () => view },
      consent,
      reports: ledger.reports,
      confirmations: async (request) => {
        asked.push(request);
      },
      replies: async (reply) => {
        replies.push(reply);
      },
      get networkFeatures() {
        return facts.networkFeatures;
      },
      get desktop() {
        return facts.desktop;
      },
      trustProxy: false,
      operatorOff: () => operatorOff,
      now: () => clock,
      ...over,
    });
    core = createInboundCore({ meta: handle.meta, secret: SECRET, channels: [channel], now: () => clock, enqueue: async (id) => queued.push(id) });
    logs = [];
    app = Fastify({ logger: { level: 'trace', stream: { write: (line: string) => logs.push(line) } } });
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    await app.register(async (api) => api.register(inboundRoutes({ core, channels: [channel], secret: SECRET, now: () => clock })), { prefix: '/api/v1' });
    await app.ready();
  }

  beforeAll(async () => {
    if (!engine.available) return;
    handle = await engine.make();
  });
  afterAll(async () => {
    if (engine.available) await handle.destroy();
  });
  beforeEach(async () => {
    if (!engine.available) return;
    for (const table of ['adminium_inbound_events', 'adminium_text_stop_list', 'adminium_text_consent_log']) await sql`delete from ${sql.table(table)}`.execute(handle.meta.db);
    await settingsRepo(handle.meta).set('system.publicOrigin', ORIGIN, { updatedBy: null });
    clock = T0;
    queued = [];
    asked = [];
    replies = [];
    credentials = twilio;
    view = viewOf(twilio);
    facts = { networkFeatures: true, desktop: false };
    operatorOff = false;
    ledger = memoryLedger();
    consent = createTextConsentService({ meta: handle.meta, secret: SECRET, now: () => clock });
    await serve();
  });
  afterEach(async () => {
    if (engine.available) await app.close();
  });

  const useTelnyx = (): void => {
    credentials = telnyx;
    view = viewOf(telnyx);
  };

  describe('Twilio replies', () => {
    only('a signed STOP reaches the stop list through the job, and the answer sends nothing', async () => {
      const reply = await twilioReply('STOP');
      expect(reply.statusCode).toBe(200);
      expect(reply.headers['content-type']).toContain('text/xml');
      expect(reply.body).toContain('<Response></Response>');
      expect(await stopped()).toBe(false);
      await drain();
      expect(await stopped()).toBe(true);
    });

    only('never puts the business own sender on the stop list: the event goes to the failed list', async () => {
      await twilioReply('STOP', nextSid(), OURS);
      await drain();
      expect(await stopped(OURS)).toBe(false);
      expect((await core.failed.list({ limit: 5 })).events.map((one) => one.reason)).toEqual(['own-sender']);
    });

    only('stores before acting: the door itself touches no stop list', async () => {
      await twilioReply('STOP');
      expect((await rows())[0]?.['state']).toBe('pending');
      expect(await consent.stop.entryFor(PERSON, null)).toBeNull();
    });

    only.each(['OPT OUT', 'STOP PLEASE', 'ABMELDEN', 'désabonner', '退订', 'إيقاف'])('catches %s, which a default filter would miss', async (word) => {
      await twilioReply(word);
      await drain();
      expect(await stopped()).toBe(true);
    });

    only('an ordinary sentence with the word in it stops nothing, and reaches the replies', async () => {
      await twilioReply('I will stop by at 3');
      await drain();
      expect(await stopped()).toBe(false);
      expect(replies).toHaveLength(1);
      expect(replies[0]).toMatchObject({ text: 'I will stop by at 3', kind: 'message', from: PERSON });
    });

    only('a STOP stops every text from the business, whichever number it was sent to', async () => {
      await postTwilio({ MessageSid: nextSid(), From: PERSON, To: '+15005550099', Body: 'STOP' });
      await drain();
      const decision = await consent.decide({ phone: PERSON, country: null, class: 'service', sender: { kind: 'number' }, repliesReachUs: true });
      expect(decision).toMatchObject({ send: false, reason: 'stopped' });
    });

    only('the same delivery twice is one event', async () => {
      const sid = nextSid();
      await twilioReply('STOP', sid);
      await twilioReply('STOP', sid);
      expect(await rows()).toHaveLength(1);
      await drain();
      const history = await consent.history({ phone: PERSON });
      expect(history.filter((event) => event.purpose === 'text-service')).toHaveLength(1);
    });

    only('a recorded START sent again long after does nothing', async () => {
      const startSid = nextSid();
      await twilioReply('STOP');
      await drain();
      clock += 1000;
      await twilioReply('START', startSid);
      await drain();
      expect(await stopped()).toBe(false);
      clock += 1000;
      await twilioReply('STOP');
      await drain();
      expect(await stopped()).toBe(true);
      clock += 300 * 24 * 60 * 60 * 1000;
      await core.sweep();
      await twilioReply('START', startSid);
      await drain();
      expect(await stopped()).toBe(true);
    });

    only('keeps a control row longer than an ordinary reply', async () => {
      await twilioReply('STOP');
      await drain();
      expect(Number((await rows())[0]?.['retainUntil'])).toBe(T0 + SMS_CONTROL_RETAIN_MS);
    });

    only.each([
      ['a wrong key', { value: 'another-made-up-value' }],
      ['another address', { signAs: 'https://evil.example/api/v1/inbound/sms/twilio/x' }],
    ])('refuses %s and writes nothing', async (_name, opts) => {
      const reply = await postTwilio({ MessageSid: nextSid(), From: PERSON, To: OURS, Body: 'START' }, opts);
      expect(reply.statusCode).toBe(403);
      expect(await rows()).toHaveLength(0);
    });

    only('a signature over the address the request claims is refused', async () => {
      const form = { MessageSid: nextSid(), From: PERSON, To: OURS, Body: 'STOP' };
      const claimed = `https://proxy.internal${path('twilio', twilio)}`;
      const reply = await postTwilio(form, { signAs: claimed, headers: { host: 'proxy.internal', 'x-forwarded-host': 'proxy.internal' } });
      expect(reply.statusCode).toBe(403);
    });

    only('checks against the stored address behind a proxy that changes the host and scheme', async () => {
      const reply = await postTwilio({ MessageSid: nextSid(), From: PERSON, To: OURS, Body: 'STOP' }, { headers: { host: '10.0.0.5:4600', 'x-forwarded-proto': 'http' } });
      expect(reply.statusCode).toBe(200);
    });

    only('refuses another account\'s event, even signed', async () => {
      const form = new URLSearchParams({ AccountSid: `AC${'cd'.repeat(16)}`, MessageSid: nextSid(), From: PERSON, To: OURS, Body: 'STOP' });
      const target = path('twilio', twilio);
      const reply = await app.inject({ method: 'POST', url: target, payload: form.toString(), headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-twilio-signature': signTwilio(`${ORIGIN}${target}`, form) } });
      expect(reply.statusCode).toBe(403);
      expect(await rows()).toHaveLength(0);
    });

    only('a signed delivery with no message id is a 400 and writes nothing', async () => {
      expect((await postTwilio({ From: PERSON, Body: 'STOP' })).statusCode).toBe(400);
      expect((await postTwilio({ MessageSid: 'nope', From: PERSON, Body: 'STOP' })).statusCode).toBe(400);
      expect(await rows()).toHaveLength(0);
    });

    only('a call to the provider that is not connected is a 503, even with that account\'s token and key', async () => {
      const target = `/api/v1/inbound/sms/telnyx/${inboundToken(SECRET, 'sms', 'telnyx', accountRefOf(twilio))}`;
      const form = new URLSearchParams({ AccountSid: ACCOUNT_SID, MessageSid: nextSid(), From: PERSON, To: OURS, Body: 'START' });
      const reply = await app.inject({ method: 'POST', url: target, payload: form.toString(), headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-twilio-signature': signTwilio(`${ORIGIN}${target}`, form) } });
      expect(reply.statusCode).toBe(503);
      expect(await rows()).toHaveLength(0);
    });

    only('the old token stops working when the account changes', async () => {
      const old = path('twilio', twilio);
      credentials = { provider: 'twilio', accountSid: `AC${'ef'.repeat(16)}`, authToken: new SmsSecret(SIGNING_VALUE) };
      const form = new URLSearchParams({ AccountSid: ACCOUNT_SID, MessageSid: nextSid(), From: PERSON, To: OURS, Body: 'STOP' });
      const reply = await app.inject({ method: 'POST', url: old, payload: form.toString(), headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-twilio-signature': signTwilio(`${ORIGIN}${old}`, form) } });
      expect(reply.statusCode).toBe(401);
    });
  });

  describe('Telnyx replies', () => {
    beforeEach(() => {
      if (engine.available) useTelnyx();
    });

    only('a signed STOP reaches the stop list', async () => {
      expect((await postTelnyx(telnyxReply('STOP PLEASE'))).statusCode).toBe(200);
      await drain();
      expect(await stopped()).toBe(true);
    });

    only('de-duplicates on data.id', async () => {
      const envelope = telnyxReply('STOP');
      await postTelnyx(envelope);
      await postTelnyx({ ...envelope, meta: { attempt: 2 } });
      expect(await rows()).toHaveLength(1);
    });

    only('two events about one message are two rows', async () => {
      const messageId = randomUUID();
      ledger.track(messageId);
      await postTelnyx(telnyxStatus(messageId, 'sent', 'message.sent'));
      await postTelnyx(telnyxStatus(messageId, 'delivered'));
      expect(await rows()).toHaveLength(2);
    });

    only('refuses a delivery outside the five-minute window, and writes nothing', async () => {
      const reply = await postTelnyx(telnyxReply('START'), { at: clock - 301_000 });
      expect(reply.statusCode).toBe(403);
      expect(await rows()).toHaveLength(0);
    });

    only('refuses a changed body', async () => {
      const raw = JSON.stringify(telnyxReply('START'));
      const timestamp = String(clock / 1000);
      const signature = sign(null, Buffer.from(`${timestamp}|${raw}`), keys.privateKey).toString('base64');
      const reply = await app.inject({ method: 'POST', url: path('telnyx', telnyx), payload: raw.replace('START', 'STOP'), headers: { 'content-type': 'application/json', 'telnyx-signature-ed25519': signature, 'telnyx-timestamp': timestamp } });
      expect(reply.statusCode).toBe(403);
    });

    only('a STOP stamped with another profile is never dropped', async () => {
      const reply = await postTelnyx(telnyxReply('STOP', { messaging_profile_id: randomUUID(), to: [{ phone_number: '+15005550099', status: 'webhook_delivered' }] }));
      expect(reply.statusCode).toBe(200);
      expect(await rows()).toHaveLength(1);
      await drain();
      expect(await stopped()).toBe(true);
    });

    only('an ordinary reply on another profile is kept when it reached our sender, and not otherwise', async () => {
      await postTelnyx(telnyxReply('see you at 5', { messaging_profile_id: randomUUID() }));
      expect(await rows()).toHaveLength(1);
      await postTelnyx(telnyxReply('see you at 6', { messaging_profile_id: randomUUID(), to: [{ phone_number: '+15005550099', status: 'webhook_delivered' }] }));
      expect(await rows()).toHaveLength(1);
    });

    only('an opt-out code in second place, on another profile, still stops the person', async () => {
      const envelope = telnyxStatus(randomUUID(), 'delivery_failed', 'message.finalized', [{ code: '40008' }, { code: '40300' }]);
      envelope.data.payload.messaging_profile_id = randomUUID();
      envelope.data.payload.from = { phone_number: '+15005550099' };
      await postTelnyx(envelope);
      await toTheEnd(core, queued[0]!);
      expect(await stopped()).toBe(true);
    });

    only('takes a genuine event of another type as nothing', async () => {
      const envelope = telnyxReply('STOP');
      envelope.data.event_type = 'number_order.complete';
      expect((await postTelnyx(envelope)).statusCode).toBe(200);
      expect(await rows()).toHaveLength(0);
    });

    only('a signed body that is not readable is a 400', async () => {
      expect((await postTelnyx(null, { raw: '{not json' })).statusCode).toBe(400);
      expect((await postTelnyx({ data: { id: 'x' } })).statusCode).toBe(400);
    });

    only('answers JSON, not TwiML', async () => {
      const reply = await postTelnyx(telnyxReply('hello'));
      expect(reply.json()).toEqual({ received: true });
    });
  });

  describe('STOP and START', () => {
    only('START lifts the block and never records a yes', async () => {
      await consent.record({ phone: PERSON, purpose: 'text-service', state: 'yes', source: 'form', wording: { text: 'Text me.', version: 'v1' }, at: clock - 5000 });
      await twilioReply('STOP');
      await drain();
      clock += 1000;
      await twilioReply('START');
      await drain();
      expect(await stopped()).toBe(false);
      expect((await consent.standing({ phone: PERSON }, 'text-service')).state).toBe('no');
      const decision = await consent.decide({ phone: PERSON, country: null, class: 'service', sender: { kind: 'number' }, repliesReachUs: true });
      expect(decision).toMatchObject({ send: false, reason: 'no-consent' });
      const history = await consent.history({ phone: PERSON });
      expect(history.filter((event) => event.state === 'yes')).toHaveLength(1);
    });

    only('YES lifts nothing', async () => {
      await twilioReply('STOP');
      await drain();
      clock += 1000;
      await twilioReply('YES');
      await drain();
      expect(await stopped()).toBe(true);
    });

    only('a START does not lift a staff-recorded stop', async () => {
      await consent.stop.add({ phone: PERSON, reason: 'staff', staff: { id: 'usr_1', label: 'Dana' }, at: clock - 1000 });
      await twilioReply('START');
      await drain();
      expect(await stopped()).toBe(true);
      expect((await rows())[0]?.['reason']).toBe('start-kept');
    });

    only('a START older than the STOP leaves it in place, whichever is processed first', async () => {
      useTelnyx();
      const startAt = clock;
      const startEvent = telnyxReply('START');
      await postTelnyx(startEvent);
      clock += 2000;
      await postTelnyx(telnyxReply('STOP'));
      const [first, second] = queued;
      queued = [];
      await core.run(second!);
      expect(await stopped()).toBe(true);
      await core.run(first!);
      expect(await stopped()).toBe(true);
      expect(startAt).toBeLessThan(clock);
    });

    only('a START at the very moment of the STOP leaves it in place', async () => {
      await twilioReply('STOP');
      await drain();
      await twilioReply('START');
      await drain();
      expect(await stopped()).toBe(true);
    });

    only('a future-dated event cannot outrank a later real one', async () => {
      useTelnyx();
      const envelope = telnyxReply('STOP');
      envelope.data.occurred_at = new Date(clock + 3_600_000).toISOString();
      await postTelnyx(envelope);
      await drain();
      clock += 1000;
      await postTelnyx(telnyxReply('START'));
      await drain();
      expect(await stopped()).toBe(false);
    });

    only('a STOP whose write fails is retried, then kept on the failed list, never dropped', async () => {
      await app.close();
      let failing = true;
      await serve({
        consent: {
          stop: {
            add: async (input) => {
              if (failing) throw new Error(`insert failed for ${String(input.phone)}`);
              return consent.stop.add(input);
            },
            start: consent.stop.start,
            entryFor: consent.stop.entryFor,
          },
        },
      });
      expect((await twilioReply('STOP')).statusCode).toBe(200);
      const id = queued[0]!;
      const error = await core.run(id).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(InboundJobError);
      expect((error as Error).message).not.toContain('+49');
      expect(await toTheEnd(core, id)).toEqual({ state: 'failed' });
      const { events } = await core.failed.list({ limit: 5 });
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ kind: 'reply', reason: 'handler-error', retryable: true });
      expect(JSON.stringify(events)).not.toContain(PERSON);

      failing = false;
      queued = [];
      expect(await core.failed.retry(id)).toBe(true);
      await drain();
      expect(await stopped()).toBe(true);
      expect((await core.failed.list({ limit: 5 })).events).toHaveLength(0);
    });

    only('a sender that is no number goes on the failed list at once', async () => {
      await postTwilio({ MessageSid: nextSid(), From: 'not-a-number', To: OURS, Body: 'STOP' });
      await drain();
      expect((await core.failed.list({ limit: 5 })).events[0]).toMatchObject({ reason: 'unreadable-number' });
    });

    only('answers 503 when the event cannot be stored, so the provider retries', async () => {
      await sql`alter table adminium_inbound_events rename to adminium_inbound_events_gone`.execute(handle.meta.db);
      try {
        const reply = await twilioReply('STOP');
        expect(reply.statusCode).toBe(503);
        expect(reply.body).not.toContain(PERSON);
      } finally {
        await sql`alter table adminium_inbound_events_gone rename to adminium_inbound_events`.execute(handle.meta.db);
      }
    });
  });

  describe('the one confirmation', () => {
    only('asks for one on a STOP the provider did not catch', async () => {
      await twilioReply('STOP PLEASE');
      await drain();
      expect(asked).toHaveLength(1);
      expect(asked[0]).toMatchObject({ to: PERSON, from: OURS, body: SMS_STOP_CONFIRMATION, sendBy: T0 + 300_000 });
      expect(asked[0]?.dedupeKey).toMatch(/^sms-stop-confirm:/);
      expect((await rows())[0]?.['reason']).toBe('confirmation-asked');
    });

    only('names the language of a local word', async () => {
      await twilioReply('ABMELDEN');
      await drain();
      expect(asked[0]?.language).toBe('de-DE');
    });

    only('asks for none on a word the provider already answers', async () => {
      await twilioReply('STOP');
      await drain();
      expect(asked).toHaveLength(0);
      expect((await rows())[0]?.['reason']).toBe('provider-answered');
    });

    only('asks for none when Twilio says Advanced Opt-Out answered', async () => {
      await postTwilio({ MessageSid: nextSid(), From: PERSON, To: OURS, Body: 'STOP PLEASE', OptOutType: 'STOP' });
      await drain();
      expect(asked).toHaveLength(0);
    });

    only('asks for none when Telnyx says it answered', async () => {
      useTelnyx();
      await postTelnyx(telnyxReply('STOP PLEASE', { autoresponse_type: 'STOP' }));
      await drain();
      expect(asked).toHaveLength(0);
    });

    only('a second STOP gets no second confirmation', async () => {
      await twilioReply('STOP PLEASE');
      await twilioReply('STOP PLEASE');
      await drain();
      expect(asked).toHaveLength(1);
    });

    only('asks for none past the five minutes', async () => {
      useTelnyx();
      await postTelnyx(telnyxReply('STOP PLEASE'));
      clock += 300_000;
      await drain();
      expect(await stopped()).toBe(true);
      expect(asked).toHaveLength(0);
      expect((await rows())[0]?.['reason']).toBe('too-late');
    });

    only('a confirmation that fails leaves the STOP in place and is not retried', async () => {
      await app.close();
      let calls = 0;
      await serve({ confirmations: async () => { calls += 1; throw new Error('send path down'); } });
      await twilioReply('STOP PLEASE');
      await drain();
      expect(await stopped()).toBe(true);
      expect(calls).toBe(1);
      expect((await rows())[0]).toMatchObject({ state: 'processed', reason: 'confirmation-failed' });
    });

    only('START gets no confirmation', async () => {
      await twilioReply('STOP PLEASE');
      await drain();
      asked = [];
      clock += 1000;
      await twilioReply('START');
      await drain();
      expect(asked).toHaveLength(0);
    });
  });

  describe('delivery reports', () => {
    const status = (sid: string, word: string, extra: Record<string, string> = {}) => postTwilio({ MessageSid: sid, SmsSid: sid, MessageStatus: word, SmsStatus: word, From: OURS, To: PERSON, ...extra });

    only('moves a message on', async () => {
      const sid = nextSid();
      ledger.track(sid);
      await status(sid, 'sent');
      await status(sid, 'delivered');
      await drain();
      expect(ledger.rows.get(sid)?.status).toBe('delivered');
    });

    only('out of order: a late "sent" does not undo "delivered"', async () => {
      const sid = nextSid();
      ledger.track(sid);
      await status(sid, 'delivered');
      await drain();
      await status(sid, 'sent');
      await drain();
      expect(ledger.rows.get(sid)?.status).toBe('delivered');
      expect((await rows()).map((row) => row['reason'])).toEqual(['applied', 'applied']);
    });

    only('a repeated callback is one event', async () => {
      const sid = nextSid();
      ledger.track(sid);
      await status(sid, 'sent');
      await status(sid, 'sent');
      expect(await rows()).toHaveLength(1);
    });

    only('keeps the error code of a failure', async () => {
      const sid = nextSid();
      ledger.track(sid);
      await status(sid, 'undelivered', { ErrorCode: '30003' });
      await drain();
      expect(ledger.rows.get(sid)).toMatchObject({ status: 'undelivered', errorCode: '30003' });
    });

    only('a report that outran the send path is retried, then let go without a failed entry', async () => {
      const sid = nextSid();
      await status(sid, 'sent');
      const id = queued[0]!;
      await expect(core.run(id)).rejects.toBeInstanceOf(InboundJobError);
      ledger.track(sid);
      expect(await core.run(id)).toEqual({ state: 'processed' });

      const stranger = nextSid();
      await status(stranger, 'sent');
      const other = queued.at(-1)!;
      expect(await toTheEnd(core, other)).toEqual({ state: 'ignored' });
      expect((await core.failed.list({ limit: 5 })).events).toHaveLength(0);
    });

    only('a word that is no status is ignored', async () => {
      const sid = nextSid();
      ledger.track(sid);
      await status(sid, 'receiving');
      await drain();
      expect((await rows())[0]).toMatchObject({ state: 'ignored', reason: 'not-a-status' });
      expect(ledger.rows.get(sid)?.status).toBe('queued');
    });

    only('Twilio\'s "opted out" error goes on the stop list', async () => {
      const sid = nextSid();
      ledger.track(sid);
      await status(sid, 'failed', { ErrorCode: '21610' });
      await drain();
      expect((await consent.stop.entryFor(PERSON, null))?.reason).toBe('provider-opt-out');
    });

    only('Telnyx\'s "opted out" error goes on the stop list, even for a message it does not know', async () => {
      useTelnyx();
      await postTelnyx(telnyxStatus(randomUUID(), 'sending_failed', 'message.finalized', [{ code: '40300', title: 'blocked' }]));
      await toTheEnd(core, queued[0]!);
      expect(await stopped()).toBe(true);
    });

    only.each(['30003', '21211', '21612'])('failure code %s, which is no opt-out, does not stop the person', async (code) => {
      const sid = nextSid();
      ledger.track(sid);
      await status(sid, 'failed', { ErrorCode: code });
      await drain();
      expect(await stopped()).toBe(false);
    });

    only('reads Telnyx statuses', async () => {
      useTelnyx();
      const messageId = randomUUID();
      ledger.track(messageId);
      await postTelnyx(telnyxStatus(messageId, 'delivery_unconfirmed'));
      await drain();
      expect(ledger.rows.get(messageId)?.status).toBe('unconfirmed');
      await postTelnyx(telnyxStatus(messageId, 'delivered'));
      await drain();
      expect(ledger.rows.get(messageId)?.status).toBe('delivered');
    });
  });

  describe('catch-up', () => {
    const page = (messages: unknown[], next: string | null = null) => json(200, { messages, next_page_uri: next });
    const inbound = (body: string, sid = nextSid(), at = clock - 60_000, from = PERSON) => ({ sid, direction: 'inbound', from, to: OURS, body, status: 'received', date_sent: new Date(at).toUTCString(), date_created: new Date(at).toUTCString(), account_sid: ACCOUNT_SID });
    const catchUp = (fetchStub: typeof fetch, extra: { maxPages?: number } = {}) => createSmsCatchUp({ core, sms: { credentials: async () => credentials, view: async () => view }, fetch: fetchStub, now: () => clock, ...extra });

    only('the sweep asks no provider while network features or the operator say no', async () => {
      await app.close();
      let calls = 0;
      await serve({ fetch: (async () => {
        calls += 1;
        return page([]);
      }) as unknown as typeof fetch });
      facts.networkFeatures = false;
      await core.sweep();
      facts.networkFeatures = true;
      operatorOff = true;
      await core.sweep();
      expect(calls).toBe(0);
      operatorOff = false;
      await core.sweep();
      expect(calls).toBe(1);
    });

    only('finds a STOP missed while down, and it reaches the stop list', async () => {
      const urls: string[] = [];
      const result = await catchUp((async (url: string | URL | Request) => {
        urls.push(String(url));
        return page([inbound('STOP'), { ...inbound('STOP'), direction: 'outbound-api', from: OURS, to: '+4915199999999' }]);
      }) as typeof fetch).run();
      expect(result).toMatchObject({ outcome: 'done', stored: 1, pages: 1, truncated: false });
      expect(urls[0]).toContain(`/Accounts/${ACCOUNT_SID}/Messages.json`);
      // Every inbound message: a STOP sent to an earlier or second number counts too.
      expect(new URL(urls[0]!).searchParams.has('To')).toBe(false);
      expect(new URL(urls[0]!).searchParams.get('DateSent>')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      await drain();
      expect(await stopped()).toBe(true);
      expect(await stopped('+4915199999999')).toBe(false);
    });

    only('is safe to repeat, and a message its webhook already brought is a duplicate', async () => {
      const sid = nextSid();
      await twilioReply('STOP', sid);
      await drain();
      const fetchStub = (async () => page([inbound('STOP', sid)])) as unknown as typeof fetch;
      expect(await catchUp(fetchStub).run()).toMatchObject({ outcome: 'done', stored: 0, duplicates: 1 });
      expect(await catchUp(fetchStub).run()).toMatchObject({ outcome: 'done', stored: 0, duplicates: 1 });
      expect(await rows()).toHaveLength(1);
    });

    only('never sends a confirmation for what it found', async () => {
      await catchUp((async () => page([inbound('STOP PLEASE', nextSid(), clock - 1000)])) as unknown as typeof fetch).run();
      await drain();
      expect(await stopped()).toBe(true);
      expect(asked).toHaveLength(0);
    });

    only('queues in the order sent: a STOP after a START wins', async () => {
      await catchUp((async () => page([inbound('STOP', nextSid(), clock - 1000), inbound('START', nextSid(), clock - 5000)])) as unknown as typeof fetch).run();
      await drain();
      expect(await stopped()).toBe(true);
    });

    only('a START after a STOP lifts it', async () => {
      await catchUp((async () => page([inbound('START', nextSid(), clock - 1000), inbound('STOP', nextSid(), clock - 5000)])) as unknown as typeof fetch).run();
      await drain();
      expect(await stopped()).toBe(false);
    });

    only('follows pages on the same list, and stops at the budget', async () => {
      let calls = 0;
      const base = `/2010-04-01/Accounts/${ACCOUNT_SID}/Messages.json`;
      const result = await catchUp((async () => {
        calls += 1;
        return page([inbound('hello')], `${base}?Page=${calls}&PageToken=x`);
      }) as unknown as typeof fetch, { maxPages: 3 }).run();
      expect(calls).toBe(3);
      expect(result).toMatchObject({ outcome: 'partial', truncated: true, stored: 3, pages: 3 });
    });

    only('stops at messages older than the window', async () => {
      let calls = 0;
      const base = `/2010-04-01/Accounts/${ACCOUNT_SID}/Messages.json`;
      const old = clock - 8 * 24 * 60 * 60 * 1000;
      const result = await catchUp((async () => {
        calls += 1;
        return page([inbound('hello'), inbound('STOP', nextSid(), old)], `${base}?Page=${calls}`);
      }) as unknown as typeof fetch).run();
      expect(calls).toBe(1);
      expect(result.stored).toBe(1);
    });

    only.each(['https://evil.example/2010-04-01/x', '//evil.example/x', '/2010-04-01/Accounts/ACother/Messages.json?x=1', `/2010-04-01/Accounts/${ACCOUNT_SID}/Messages.json?x=1#y`])('will not carry the key to the next page %s', async (next) => {
      const urls: string[] = [];
      const result = await catchUp((async (url: string | URL | Request) => {
        urls.push(String(url));
        return page([inbound('STOP')], next);
      }) as typeof fetch).run();
      expect(urls).toHaveLength(1);
      expect(result).toMatchObject({ outcome: 'partial', reason: 'unreadable-reply', stored: 1 });
    });

    only('keeps what it read when a later page fails', async () => {
      let calls = 0;
      const base = `/2010-04-01/Accounts/${ACCOUNT_SID}/Messages.json`;
      const result = await catchUp((async () => {
        calls += 1;
        return calls === 1 ? page([inbound('STOP')], `${base}?Page=1`) : json(500, {});
      }) as unknown as typeof fetch).run();
      expect(result).toMatchObject({ outcome: 'partial', reason: 'provider-refused', stored: 1 });
    });

    only('never throws when the provider cannot be reached', async () => {
      const result = await catchUp((async () => { throw new Error('down'); }) as unknown as typeof fetch).run();
      expect(result).toMatchObject({ outcome: 'partial', reason: 'provider-unreachable', stored: 0 });
    });

    only('says when the store failed', async () => {
      const broken = createSmsCatchUp({ core: { accept: async () => { throw new Error('db down'); } }, sms: { credentials: async () => credentials, view: async () => view }, fetch: (async () => page([inbound('STOP')])) as unknown as typeof fetch, now: () => clock });
      expect(await broken.run()).toMatchObject({ outcome: 'partial', reason: 'store-failed' });
    });

    only('with no account, it does nothing', async () => {
      credentials = null;
      let calls = 0;
      const result = await catchUp((async () => { calls += 1; return json(200, {}); }) as unknown as typeof fetch).run();
      expect(result.outcome).toBe('not-connected');
      expect(calls).toBe(0);
    });

    only('runs one at a time', async () => {
      let release: (value: Response) => void = () => undefined;
      const held = new Promise<Response>((resolve) => { release = resolve; });
      const runner = catchUp((async () => held) as unknown as typeof fetch);
      const first = runner.run();
      await new Promise((resolve) => setTimeout(resolve, 5));
      expect((await runner.run()).outcome).toBe('already-running');
      release(page([]));
      expect((await first).outcome).toBe('done');
    });

    only('on a pool sender it reads the whole account', async () => {
      view = viewOf(twilio, { kind: 'pool', value: `MG${'ab'.repeat(16)}` });
      let seen = '';
      await catchUp((async (url: string | URL | Request) => { seen = String(url); return page([]); }) as typeof fetch).run();
      expect(new URL(seen).searchParams.has('To')).toBe(false);
    });

    describe('Telnyx', () => {
      const optOut = (phone: string, at = clock - 60_000, profile: string | null = PROFILE) => ({ from: OURS, to: phone, messaging_profile_id: profile, keyword: 'STOP', created_at: new Date(at).toISOString() });
      const list = (data: unknown[], page_number = 1, total_pages = 1) => json(200, { data, meta: { page_number, total_pages, page_size: 250, total_results: data.length } });

      beforeEach(() => {
        if (engine.available) useTelnyx();
      });

      only('reads the opt-out list, for this profile, unredacted', async () => {
        const urls: string[] = [];
        const result = await catchUp((async (url: string | URL | Request) => {
          urls.push(String(url));
          return list([optOut(PERSON)]);
        }) as typeof fetch).run();
        expect(result).toMatchObject({ outcome: 'done', stored: 1 });
        const url = new URL(urls[0]!);
        expect(url.pathname).toBe('/v2/messaging_optouts');
        expect(url.searchParams.get('filter[messaging_profile_id]')).toBe(PROFILE);
        expect(url.searchParams.get('redaction_enabled')).toBe('false');
        expect(url.searchParams.get('created_at[gte]')).toBe(new Date(clock - 7 * 24 * 60 * 60 * 1000).toISOString());
        await drain();
        expect((await consent.stop.entryFor(PERSON, null))?.reason).toBe('provider-opt-out');
        expect(asked).toHaveLength(0);
      });

      only('is safe to repeat', async () => {
        const entry = optOut(PERSON);
        const fetchStub = (async () => list([entry])) as unknown as typeof fetch;
        await catchUp(fetchStub).run();
        expect(await catchUp(fetchStub).run()).toMatchObject({ stored: 0, duplicates: 1 });
      });

      only('counts a redacted number and skips it', async () => {
        const result = await catchUp((async () => list([optOut('+447766****')])) as unknown as typeof fetch).run();
        expect(result).toMatchObject({ stored: 0, unreadable: 1 });
      });

      only('counts another profile instead of dropping it unseen', async () => {
        const elsewhere = { ...optOut(PERSON, clock - 1000, randomUUID()), from: '+15005550099' };
        const result = await catchUp((async () => list([elsewhere])) as unknown as typeof fetch).run();
        expect(result).toMatchObject({ stored: 0, otherProfile: 1 });
      });

      only('keeps an opt-out stamped with another profile when it was from our sender', async () => {
        const result = await catchUp((async () => list([optOut(PERSON, clock - 1000, randomUUID())])) as unknown as typeof fetch).run();
        expect(result).toMatchObject({ stored: 1, otherProfile: 0 });
        await drain();
        expect(await stopped()).toBe(true);
      });

      only('never puts the business own sender on the stop list, and reads such a record by its other number', async () => {
        const swapped = { ...optOut(OURS, clock - 1000), from: PERSON };
        const result = await catchUp((async () => list([swapped])) as unknown as typeof fetch).run();
        expect(result).toMatchObject({ stored: 1, unreadable: 0 });
        await drain();
        expect(await stopped(OURS)).toBe(false);
        expect(await stopped(PERSON)).toBe(true);
      });

      only('counts a record that names no customer', async () => {
        const own = { ...optOut(OURS, clock - 1000), from: OURS };
        const result = await catchUp((async () => list([own])) as unknown as typeof fetch).run();
        expect(result).toMatchObject({ stored: 0, unreadable: 1 });
        expect(await stopped(OURS)).toBe(false);
      });

      only('walks the pages and stops at the budget', async () => {
        let calls = 0;
        const result = await catchUp((async () => {
          calls += 1;
          return list([optOut(`+49151234567${String(calls).padStart(2, '0')}`)], calls, 99);
        }) as unknown as typeof fetch, { maxPages: 2 }).run();
        expect(calls).toBe(2);
        expect(result).toMatchObject({ outcome: 'partial', truncated: true, stored: 2 });
      });
    });
  });

  describe('can this server hear a STOP', () => {
    only('reachable: yes, with the address to give the provider', async () => {
      const reach = await channel.replyReach();
      expect(reach).toMatchObject({ state: 'reachable', canReceiveStop: true, origin: ORIGIN });
      expect(reach.address).toBe(`${ORIGIN}${path('twilio', twilio)}#rp=all&rc=5`);
    });

    only.each([
      ['http://texts.lumen.example', 'not-https'],
      ['https://localhost:4600', 'this-computer'],
      ['https://192.168.1.20', 'private-network'],
      ['https://shop.local', 'dot-local'],
    ])('at %s: no (%s)', async (origin, state) => {
      await settingsRepo(handle.meta).set('system.publicOrigin', origin, { updatedBy: null });
      expect(await channel.replyReach()).toMatchObject({ state, canReceiveStop: false, address: null });
      expect((await channel.reach()).open).toBe(false);
      expect((await twilioReply('STOP')).statusCode).toBe(503);
      expect(await rows()).toHaveLength(0);
    });

    only('no public address: no', async () => {
      await settingsRepo(handle.meta).set('system.publicOrigin', null, { updatedBy: null });
      expect(await channel.replyReach()).toMatchObject({ state: 'not-set', canReceiveStop: false });
    });

    only('the desktop app: no', async () => {
      facts.desktop = true;
      expect(await channel.replyReach()).toMatchObject({ state: 'desktop', canReceiveStop: false });
    });

    only('network features off: no', async () => {
      facts.networkFeatures = false;
      expect(await channel.replyReach()).toMatchObject({ state: 'network-off', canReceiveStop: false });
    });

    only('the operator switched it off: no', async () => {
      operatorOff = true;
      expect(await channel.replyReach()).toMatchObject({ state: 'operator-off', canReceiveStop: false });
    });

    only('no account: no, and the door answers 503 so nothing is lost', async () => {
      const target = path('twilio', twilio);
      view = null;
      credentials = null;
      expect(await channel.replyReach()).toMatchObject({ state: 'not-connected', canReceiveStop: false });
      expect((await app.inject({ method: 'POST', url: target, payload: 'x=1', headers: { 'content-type': 'application/x-www-form-urlencoded' } })).statusCode).toBe(503);
    });

    only('a key that no longer opens: no, and 503', async () => {
      const target = path('twilio', twilio);
      view = { ...viewOf(twilio), keyReadable: false };
      credentials = null;
      expect(await channel.replyReach()).toMatchObject({ state: 'key-unreadable', canReceiveStop: false });
      expect((await app.inject({ method: 'POST', url: target, payload: 'x=1', headers: { 'content-type': 'application/x-www-form-urlencoded' } })).statusCode).toBe(503);
    });

    only('the marketing check refuses when it cannot', async () => {
      facts.desktop = true;
      await consent.record({ phone: PERSON, purpose: 'text-marketing', state: 'yes', source: 'form', wording: { text: 'Offers.', version: 'v1' } });
      const { canReceiveStop } = await channel.replyReach();
      const decision = await consent.decide({ phone: PERSON, country: null, class: 'marketing', sender: { kind: 'number' }, repliesReachUs: canReceiveStop });
      expect(decision).toMatchObject({ send: false, reason: 'marketing-without-replies' });
    });
  });

  describe('privacy', () => {
    only('holds no body and no number in clear, in the row or the logs', async () => {
      await twilioReply('STOP please, my rash is back');
      await twilioReply('STOP PLEASE');
      for (const row of await rows()) {
        const flat = JSON.stringify(row);
        expect(flat).not.toContain('rash');
        expect(flat).not.toContain(PERSON);
        expect(flat).not.toContain(PERSON.slice(1));
      }
      await drain();
      for (const row of await rows()) expect(row['sealedBody']).toBeNull();
      const log = logs.join('\n');
      expect(log).not.toContain('rash');
      expect(log).not.toContain(PERSON.slice(1));
      expect(log).not.toContain(SIGNING_VALUE);
    });

    only('a refused call logs no body either', async () => {
      await postTwilio({ MessageSid: nextSid(), From: PERSON, To: OURS, Body: 'my rash' }, { value: 'wrong-made-up-value' });
      expect(logs.join('\n')).not.toContain('rash');
    });

    only('erasing a number blanks its events and a re-delivery cannot bring them back', async () => {
      const sid = nextSid();
      await twilioReply('hello there', sid);
      expect((await core.erase({ subject: `tel:${PERSON}` })).events).toBe(1);
      const row = (await rows())[0]!;
      expect(row).toMatchObject({ state: 'erased', sealedBody: null, subjectHash: null });
      queued = [];
      await twilioReply('hello there', sid);
      expect(queued).toHaveLength(0);
      expect((await rows())[0]?.['sealedBody']).toBeNull();
    });

    only('erases a delivery report by the number it was sent to', async () => {
      const sid = nextSid();
      ledger.track(sid);
      await postTwilio({ MessageSid: sid, MessageStatus: 'sent', From: OURS, To: PERSON });
      expect((await core.erase({ subject: `tel:${PERSON}` })).events).toBe(1);
    });

    only('holds the channel to its body limit', async () => {
      const reply = await postTwilio({ MessageSid: nextSid(), From: PERSON, To: OURS, Body: 'x'.repeat(SMS_INBOUND_BODY_LIMIT) });
      expect(reply.statusCode).toBe(413);
      expect(await rows()).toHaveLength(0);
    });
  });
});
