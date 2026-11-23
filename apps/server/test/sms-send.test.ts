// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The text send path on every engine: a text never goes twice, a STOP is
 * obeyed up to the last moment, the daily limit holds under concurrency, and
 * neither the number nor the words reach a record.
 *
 * The consent service and the SMS layer are the real ones. Provider replies are
 * stubs written from the documentation and cannot prove the live APIs.
 */
import { jobsRepo, type EnqueueJobInput } from '@adminium/meta';
import type { Kysely } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createJobRegistry } from '../src/jobs/registry.js';
import { JobWorker } from '../src/jobs/worker.js';
import type { RealtimeHub } from '../src/realtime/hub.js';
import { createTextConsentService, type TextConsentService } from '../src/sms/consent/index.js';
import { createSmsService, SMS_SAME_KEY_WINDOW_MS, type SmsAccountView, type SmsCredentialInput, type SmsService } from '../src/sms/index.js';
import {
  createTextSendPath,
  createTextSendStore,
  earlierOf,
  openText,
  registerSmsSendHandler,
  sealText,
  SMS_SEND_ATTEMPTS,
  SMS_SEND_JOB_KIND,
  textPhoneKeys,
  TextRetryLater,
  type SmsSendPayload,
  type TextDelivery,
  type TextPrepareInput,
  type TextSendDeps,
  type TextSendPath,
  type TextSendStore,
} from '../src/sms/send/index.js';
import type { SmsSender } from '../src/sms/types.js';
import { memorySmsStore } from './helpers/sms-store.js';
import { META_ENGINES, type MetaHandle } from './meta-dialects.js';
import { makeTextConsentTables } from './sms-consent.helpers.js';
import { json, makeTextSendTables, networkError, stubProvider, telnyxAccepted, twilioAccepted, type ProviderStep } from './sms-send.helpers.js';

const SECRET = 'a-text-send-test-secret-of-some-length';
const PROFILE = '11111111-2222-4333-8444-555555555555';
const TWILIO: SmsCredentialInput = { provider: 'twilio', accountSid: `AC${'ab'.repeat(16)}`, authToken: 'made-up-token-for-these-tests' };
const TELNYX: SmsCredentialInput = { provider: 'telnyx', apiKey: 'made-up-telnyx-key-for-tests', publicKey: Buffer.alloc(32, 7).toString('base64'), messagingProfileId: PROFILE };
const FROM = '+14155550100';
const DE = '+4915123456789';
const DE_TWO = '+4915123456780';
/** A US number the library calls mobile-or-landline: `receivesText: 'maybe'`. */
const US_MAYBE = '+12015550123';
const UK_LANDLINE = '+442079460958';
/** A Monday, noon, inside every window. */
const NOON = Date.parse('2026-06-15T12:00:00Z');
const WORDS = 'Your table at Lumen is ready';

const attempt = (n = 1, signal: AbortSignal = new AbortController().signal) => ({ attempt: n, maxAttempts: SMS_SEND_ATTEMPTS, signal });

describe.each(META_ENGINES)('text send path — $name', (engine) => {
  let handle: MetaHandle;
  let consent: TextConsentService;
  let store: TextSendStore;
  let clock: { now: number };

  beforeAll(async () => {
    if (!engine.available) return;
    handle = await engine.make();
    await makeTextConsentTables(handle.meta);
    await makeTextSendTables(handle.meta);
  }, 120_000);
  afterAll(async () => {
    if (engine.available) await handle.destroy();
  });
  beforeEach(async () => {
    if (!engine.available) return;
    const db = handle.meta.db as unknown as Kysely<Record<string, Record<string, unknown>>>;
    for (const table of ['adminium_text_deliveries', 'adminium_text_send_days', 'adminium_text_stop_list', 'adminium_text_consent_log', 'adminium_jobs']) await db.deleteFrom(table).execute();
    clock = { now: NOON };
    consent = createTextConsentService({ meta: handle.meta, secret: SECRET, now: () => clock.now });
    store = createTextSendStore(handle.meta);
  });

  const agree = (phone: string, purpose: 'text-service' | 'text-marketing' = 'text-service') =>
    consent.record({ phone, purpose, state: 'yes', source: 'form', detail: 'Booking form', wording: { text: 'Text me about my bookings.', version: 'v1' }, at: clock.now - 1000 });

  interface RigOptions {
    credentials?: SmsCredentialInput;
    script?: ProviderStep[];
    sender?: SmsSender;
    policy?: unknown;
    over?: Partial<TextSendDeps>;
    replies?: { value: boolean };
    /** What the account's view is changed to, as a caller sees it. */
    view?: (view: SmsAccountView) => SmsAccountView;
  }

  async function rig(options: RigOptions = {}) {
    const credentials = options.credentials ?? TWILIO;
    const provider = stubProvider(credentials.provider, PROFILE, options.script ?? []);
    const sms: SmsService = createSmsService({
      store: memorySmsStore(),
      secret: SECRET,
      fetch: provider.fetchStub,
      now: () => clock.now,
      timeoutMs: 30,
      stopList: { isStopped: (e164) => consent.stop.has(e164, null), recordProviderOptOut: async () => undefined },
    });
    await sms.connect(credentials, null);
    await sms.setSending({ sender: options.sender ?? (credentials.provider === 'twilio' ? { kind: 'number', value: FROM } : { kind: 'number', value: FROM }), defaultCountry: 'DE' }, null);
    const jobs: EnqueueJobInput[] = [];
    const settled: TextDelivery[] = [];
    const warnings: unknown[] = [];
    const replies = options.replies ?? { value: true };
    const seen = options.view;
    const path: TextSendPath = createTextSendPath({
      sms: seen === undefined ? sms : { ...sms, view: async () => { const view = await sms.view(); return view === null ? null : seen(view); } },
      consent,
      store,
      secret: SECRET,
      policy: async () => options.policy ?? {},
      repliesReachUs: () => replies.value,
      operatorAllows: () => true,
      phoneKeys: textPhoneKeys(handle.meta, SECRET),
      enqueue: async (job) => void jobs.push(job),
      onSettled: async (_report, delivery) => void settled.push(delivery),
      onLimitWarning: (warning) => void warnings.push(warning),
      now: () => clock.now,
      ...options.over,
    });
    return { path, sms, provider, jobs, settled, warnings, replies };
  }

  const input = (more: Partial<TextPrepareInput> = {}): TextPrepareInput => ({
    phone: DE,
    textClass: 'service',
    template: `${WORDS}, {{name}}.`,
    values: { name: 'Thomasina' },
    zone: 'UTC',
    business: { name: 'Lumen', email: 'hello@lumen.example' },
    ...more,
  });

  let claims = 0;
  /** Prepared and queued, as the outbox would after its claim. */
  async function queued(built: Awaited<ReturnType<typeof rig>>, more: Partial<TextPrepareInput> = {}, messageKey = `app:table:${String((claims += 1))}`) {
    const ready = await built.path.prepare(input(more));
    if (ready.action !== 'send') throw new Error(`expected a text to send, got ${JSON.stringify(ready)}`);
    const made = await built.path.queue(ready, { messageKey, claimKey: String(clock.now), report: { app: 'bistro', connectionId: 'con_1', table: 'public.outbox', pk: { id: 1 } } });
    if (!made.queued) throw new Error('expected it to queue');
    return { id: made.deliveryId, payload: built.jobs.at(-1)!.payload as SmsSendPayload };
  }
  const reread = async (id: string) => (await store.byId(id))!;
  const usedToday = () => store.usedOn('2026-06-15');

  describe('a text that goes', () => {
    it.runIf(engine.available)('prepares, queues and hands over, and keeps the record', async () => {
      await agree(DE);
      const built = await rig();
      const { id, payload } = await queued(built);
      expect(await built.path.handOver(payload, attempt())).toEqual({ outcome: 'accepted', reason: null });
      expect(built.provider.posts).toHaveLength(1);
      const form = new URLSearchParams(built.provider.posts[0]!.body);
      expect(form.get('To')).toBe(DE);
      expect(form.get('Body')).toBe(`${WORDS}, Thomasina. Reply STOP to opt out.`);
      expect(await reread(id)).toMatchObject({
        state: 'accepted',
        provider: 'twilio',
        providerMessageId: `SM${'cd'.repeat(16)}`,
        providerStatus: 'queued',
        segments: 1,
        price: { amount: '-0.0079', currency: 'USD' },
        estimatedSegments: 1,
        encoding: 'gsm-7',
        attempts: 1,
        attemptStartedAt: null,
        slotDay: '2026-06-15',
        phoneMasked: '+49 ••• 789',
      });
      expect(built.settled.map((one) => one.state)).toEqual(['accepted']);
    });

    it.runIf(engine.available)('queues as an internal job with a key of its own', async () => {
      await agree(DE);
      const built = await rig();
      const { id } = await queued(built);
      expect(built.jobs[0]).toMatchObject({ kind: SMS_SEND_JOB_KIND, maxAttempts: SMS_SEND_ATTEMPTS, dedupeKey: `sms.send:${id}` });
      const registry = createJobRegistry();
      registerSmsSendHandler(registry, built.path.handOver);
      expect(registry.get(SMS_SEND_JOB_KIND)?.internal).toBe(true);
    });

    it.runIf(engine.available)('a second queueing of one claim finds the same record', async () => {
      await agree(DE);
      const built = await rig();
      const ready = await built.path.prepare(input());
      if (ready.action !== 'send') throw new Error('expected send');
      const first = await built.path.queue(ready, { messageKey: 'm', claimKey: 'c' });
      const second = await built.path.queue(ready, { messageKey: 'm', claimKey: 'c' });
      expect(second).toEqual(first);
    });

    it.runIf(engine.available)('sends to a number that may be a mobile, and refuses one that is not', async () => {
      await agree(US_MAYBE);
      const built = await rig();
      const { payload } = await queued(built, { phone: US_MAYBE });
      expect(await built.path.handOver(payload, attempt())).toMatchObject({ outcome: 'accepted' });
      expect(await built.path.prepare(input({ phone: UK_LANDLINE }))).toEqual({ action: 'skip', reason: 'cannot-receive-text' });
    });

    it.runIf(engine.available)('a sender name carries the business, and never says Reply STOP', async () => {
      await agree(DE);
      const built = await rig({ sender: { kind: 'name', value: 'Lumen' } });
      const { payload } = await queued(built, { template: 'Your table is ready. Reply STOP to opt out.', values: {} });
      await built.path.handOver(payload, attempt());
      expect(new URLSearchParams(built.provider.posts[0]!.body).get('Body')).toBe('Your table is ready. To stop these texts, contact hello@lumen.example.');
    });

    it.runIf(engine.available)('a pool counts as a sender that may not take replies', async () => {
      await agree(DE);
      const built = await rig({ sender: { kind: 'pool', value: `MG${'ab'.repeat(16)}` } });
      const ready = await built.path.prepare(input());
      expect(ready).toMatchObject({ action: 'send', text: { optOut: 'through-business' } });
      // Judged the same way at the hand-over, so its line still matches.
      const { payload } = await queued(built);
      expect(await built.path.handOver(payload, attempt())).toMatchObject({ outcome: 'accepted' });
    });

    it.runIf(engine.available)('refuses when the key no longer opens, or no sender is set', async () => {
      await agree(DE);
      const locked = await rig({ view: (view) => ({ ...view, keyReadable: false }) });
      expect(await locked.path.prepare(input())).toEqual({ action: 'skip', reason: 'not-connected' });
      const senderless = await rig({ view: (view) => ({ ...view, sender: null }) });
      expect(await senderless.path.prepare(input())).toEqual({ action: 'skip', reason: 'no-sender' });
    });

    it.runIf(engine.available)('a job that cannot be queued ends the record, and says so', async () => {
      await agree(DE);
      const built = await rig({ over: { enqueue: async () => { throw new Error('queue down'); } } });
      const ready = await built.path.prepare(input());
      if (ready.action !== 'send') throw new Error('expected send');
      expect(await built.path.queue(ready, { messageKey: 'q', claimKey: 'c' })).toEqual({ queued: false, reason: 'could-not-queue' });
      const db = handle.meta.db as unknown as Kysely<{ adminium_text_deliveries: { state: string; reason: string } }>;
      expect(await db.selectFrom('adminium_text_deliveries').select(['state', 'reason']).execute()).toEqual([{ state: 'not-sent', reason: 'could-not-queue' }]);
    });

    it.runIf(engine.available)('queueing a finished claim again makes no new job', async () => {
      await agree(DE);
      const built = await rig();
      const ready = await built.path.prepare(input());
      if (ready.action !== 'send') throw new Error('expected send');
      const first = await built.path.queue(ready, { messageKey: 'f', claimKey: 'c' });
      await built.path.handOver(built.jobs[0]!.payload as SmsSendPayload, attempt());
      expect(await built.path.queue(ready, { messageKey: 'f', claimKey: 'c' })).toEqual(first);
      expect(built.jobs).toHaveLength(1);
    });

    it.runIf(engine.available)('settings that cannot be read stop both steps', async () => {
      await agree(DE);
      const broken = { value: false };
      const built = await rig({ over: { policy: async () => { if (broken.value) throw new Error('settings down'); return {}; } } });
      const { payload } = await queued(built);
      broken.value = true;
      expect(await built.path.prepare(input())).toEqual({ action: 'fail', reason: 'could-not-check' });
      await expect(built.path.handOver(payload, attempt(1))).rejects.toBeInstanceOf(TextRetryLater);
      expect(built.provider.posts).toHaveLength(0);
    });

    it.runIf(engine.available)('refuses a sender name with no way to reach the business', async () => {
      await agree(DE);
      const built = await rig({ sender: { kind: 'name', value: 'Lumen' } });
      expect(await built.path.prepare(input({ business: { name: 'Lumen' } }))).toEqual({ action: 'skip', reason: 'no-opt-out-contact' });
    });

    it.runIf(engine.available)('refuses an unfilled placeholder and a text over the limit', async () => {
      await agree(DE);
      const built = await rig();
      expect(await built.path.prepare(input({ values: {} }))).toEqual({ action: 'skip', reason: 'unfilled-placeholder' });
      expect(await built.path.prepare(input({ template: 'a'.repeat(1000), values: {} }))).toEqual({ action: 'skip', reason: 'too-long' });
      expect(built.jobs).toHaveLength(0);
    });

    it.runIf(engine.available)('refuses without an account, a sender or consent', async () => {
      const built = await rig();
      expect(await built.path.prepare(input())).toEqual({ action: 'skip', reason: 'no-consent' });
      await built.sms.disconnect();
      await agree(DE);
      expect(await built.path.prepare(input())).toEqual({ action: 'skip', reason: 'not-connected' });
    });

    it.runIf(engine.available)('an operator who turned texts off stops both steps', async () => {
      await agree(DE);
      const open = { value: true };
      const built = await rig({ over: { operatorAllows: () => open.value } });
      const { id, payload } = await queued(built);
      open.value = false;
      expect(await built.path.prepare(input())).toEqual({ action: 'skip', reason: 'off-by-operator' });
      expect(await built.path.handOver(payload, attempt())).toMatchObject({ outcome: 'skipped', reason: 'off-by-operator' });
      expect(built.provider.posts).toHaveLength(0);
      expect((await reread(id)).slotDay).toBeNull();
    });
  });

  describe('never twice', () => {
    it.runIf(engine.available)('after a Twilio timeout the row is unknown and is never resent', async () => {
      await agree(DE);
      const built = await rig({ script: ['hang'] });
      const { id, payload } = await queued(built);
      expect(await built.path.handOver(payload, attempt())).toEqual({ outcome: 'unknown', reason: 'timeout' });
      expect(built.provider.posts).toHaveLength(1);
      expect(await reread(id)).toMatchObject({ state: 'unknown', reason: 'timeout', mayHaveGoneAt: NOON, attemptStartedAt: null });
      for (const n of [2, 3, 4, 5]) expect(await built.path.handOver(payload, attempt(n))).toMatchObject({ outcome: 'unknown' });
      expect(built.provider.posts).toHaveLength(1);
    });

    it.runIf(engine.available)('a Twilio 5xx and a lost connection are unknown too', async () => {
      await agree(DE);
      const built = await rig({ script: [json(500, {}), networkError('ECONNRESET')] });
      const first = await queued(built);
      const second = await queued(built);
      expect(await built.path.handOver(first.payload, attempt())).toEqual({ outcome: 'unknown', reason: 'server-error' });
      expect(await built.path.handOver(second.payload, attempt())).toEqual({ outcome: 'unknown', reason: 'connection-lost' });
      expect(built.provider.posts).toHaveLength(2);
    });

    it.runIf(engine.available)('retries only what certainly was not taken', async () => {
      await agree(DE);
      const built = await rig({ script: [json(429, { code: 20429 }), networkError('ECONNREFUSED')] });
      const { id, payload } = await queued(built);
      await expect(built.path.handOver(payload, attempt(1))).rejects.toBeInstanceOf(TextRetryLater);
      expect(await reread(id)).toMatchObject({ state: 'retrying', reason: 'rate-limited', mayHaveGoneAt: null, attemptStartedAt: null });
      await expect(built.path.handOver(payload, attempt(2))).rejects.toBeInstanceOf(TextRetryLater);
      expect(await built.path.handOver(payload, attempt(3))).toMatchObject({ outcome: 'accepted' });
      expect(built.provider.posts).toHaveLength(3);
      expect(new Set(built.provider.posts.map((post) => post.body)).size).toBe(1);
    });

    it.runIf(engine.available)('Telnyx retries a timeout under the same key', async () => {
      await agree(DE);
      const built = await rig({ credentials: TELNYX, script: ['hang', telnyxAccepted(true)] });
      const { id, payload } = await queued(built);
      await expect(built.path.handOver(payload, attempt(1))).rejects.toBeInstanceOf(TextRetryLater);
      expect(await reread(id)).toMatchObject({ state: 'retrying', reason: 'timeout', mayHaveGoneAt: NOON });
      clock.now += 30_000;
      expect(await built.path.handOver(payload, attempt(2))).toMatchObject({ outcome: 'accepted' });
      expect(built.provider.posts.map((post) => post.idempotencyKey)).toEqual([id, id]);
    });

    it.runIf(engine.available)('keeps the first moment through a Telnyx 429 after a timeout', async () => {
      await agree(DE);
      const built = await rig({ credentials: TELNYX, script: ['hang', json(429, { errors: [] })] });
      const { id, payload } = await queued(built);
      await expect(built.path.handOver(payload, attempt(1))).rejects.toBeInstanceOf(TextRetryLater);
      clock.now += 60_000;
      await expect(built.path.handOver(payload, attempt(2))).rejects.toBeInstanceOf(TextRetryLater);
      expect((await reread(id)).mayHaveGoneAt).toBe(NOON);
      // Past the replay window, measured from the first try.
      clock.now = NOON + SMS_SAME_KEY_WINDOW_MS;
      expect(await built.path.handOver(payload, attempt(3))).toEqual({ outcome: 'unknown', reason: 'replay-window-passed' });
      expect(built.provider.posts).toHaveLength(2);
    });

    it.runIf(engine.available)('ends unknown on the last Telnyx try', async () => {
      await agree(DE);
      const built = await rig({ credentials: TELNYX, script: ['hang'] });
      const { payload } = await queued(built);
      expect(await built.path.handOver(payload, attempt(SMS_SEND_ATTEMPTS))).toEqual({ outcome: 'unknown', reason: 'timeout' });
    });

    it.runIf(engine.available)('a refusal after a try that may have gone stays unknown', async () => {
      await agree(DE);
      const built = await rig({ credentials: TELNYX, script: ['hang', json(400, { errors: [{ code: '40012' }] })] });
      const { id, payload } = await queued(built);
      await expect(built.path.handOver(payload, attempt(1))).rejects.toBeInstanceOf(TextRetryLater);
      expect(await built.path.handOver(payload, attempt(2))).toEqual({ outcome: 'unknown', reason: 'earlier-attempt-unknown' });
      expect((await reread(id)).slotDay).toBe('2026-06-15');
      expect(await usedToday()).toBe(1);
    });

    it.runIf(engine.available)('giving up after a try that may have gone stays unknown', async () => {
      await agree(DE);
      const built = await rig({ credentials: TELNYX, script: ['hang', json(429, { errors: [] })] });
      const { payload } = await queued(built);
      await expect(built.path.handOver(payload, attempt(4))).rejects.toBeInstanceOf(TextRetryLater);
      expect(await built.path.handOver(payload, attempt(SMS_SEND_ATTEMPTS))).toEqual({ outcome: 'unknown', reason: 'earlier-attempt-unknown' });
      expect(await usedToday()).toBe(1);
    });

    describe('a crash mid-call', () => {
      /** The worker dies after saving the marker, before any answer. */
      async function crashed(credentials: SmsCredentialInput, script: ProviderStep[] = []) {
        await agree(DE);
        const built = await rig({ credentials, script });
        const dying = createTextSendPath({
          sms: { ...built.sms, send: async () => { throw new Error('worker died'); } },
          consent,
          store,
          secret: SECRET,
          policy: async () => ({}),
          repliesReachUs: () => true,
          operatorAllows: () => true,
          phoneKeys: textPhoneKeys(handle.meta, SECRET),
          enqueue: async () => undefined,
          now: () => clock.now,
        });
        const made = await queued(built);
        await expect(dying.handOver(made.payload, attempt(1))).rejects.toThrow('worker died');
        return { ...built, ...made };
      }

      it.runIf(engine.available)('leaves a saved marker that reads as may-have-gone', async () => {
        const { id } = await crashed(TWILIO);
        const row = await reread(id);
        expect(row).toMatchObject({ state: 'handing-over', attemptStartedAt: NOON, attempts: 1 });
        expect(row.attemptAccount).toMatch(/^[0-9a-f]{32}$/);
        expect(earlierOf(row)).toEqual({ mayHaveGoneAt: NOON, account: row.attemptAccount });
      });

      it.runIf(engine.available)('Twilio: the restarted job calls nobody and ends unknown', async () => {
        const { path, payload, provider, id } = await crashed(TWILIO);
        clock.now += 300_000;
        expect(await path.handOver(payload, attempt(2))).toEqual({ outcome: 'unknown', reason: 'earlier-attempt-unknown' });
        expect(provider.posts).toHaveLength(0);
        expect(await reread(id)).toMatchObject({ state: 'unknown', mayHaveGoneAt: NOON });
        expect(await usedToday()).toBe(1);
      });

      it.runIf(engine.available)('Telnyx: the restarted job retries under the same key', async () => {
        const { path, payload, provider, id } = await crashed(TELNYX, [telnyxAccepted(true)]);
        clock.now += 300_000;
        expect(await path.handOver(payload, attempt(2))).toMatchObject({ outcome: 'accepted' });
        expect(provider.posts.map((post) => post.idempotencyKey)).toEqual([id]);
      });

      it.runIf(engine.available)('Telnyx: past the window it ends unknown, unsent', async () => {
        const { path, payload, provider } = await crashed(TELNYX);
        clock.now = NOON + SMS_SAME_KEY_WINDOW_MS;
        expect(await path.handOver(payload, attempt(2))).toEqual({ outcome: 'unknown', reason: 'replay-window-passed' });
        expect(provider.posts).toHaveLength(0);
      });

      it.runIf(engine.available)('a STOP that came in meanwhile ends it unknown, not skipped', async () => {
        const { path, payload, provider, id } = await crashed(TELNYX);
        await consent.stop.add({ phone: DE, reason: 'text-stop', origin: 'telnyx', at: clock.now });
        expect(await path.handOver(payload, attempt(2))).toEqual({ outcome: 'unknown', reason: 'earlier-attempt-unknown' });
        expect(provider.posts).toHaveLength(0);
        expect((await reread(id)).slotDay).toBe('2026-06-15');
      });

      it.runIf(engine.available)('another claim of that message waits while the marker stands', async () => {
        await agree(DE);
        const built = await rig();
        const dying = createTextSendPath({
          sms: { ...built.sms, send: async () => { throw new Error('worker died'); } },
          consent,
          store,
          secret: SECRET,
          policy: async () => ({}),
          repliesReachUs: () => true,
          operatorAllows: () => true,
          phoneKeys: textPhoneKeys(handle.meta, SECRET),
          enqueue: async () => undefined,
          now: () => clock.now,
        });
        const first = await queued(built, {}, 'app:table:77');
        await expect(dying.handOver(first.payload, attempt(1))).rejects.toThrow('worker died');
        clock.now += 1000;
        const ready = await built.path.prepare(input());
        if (ready.action !== 'send') throw new Error('expected send');
        expect(await built.path.queue(ready, { messageKey: 'app:table:77', claimKey: 'second' })).toEqual({ queued: false, reason: 'earlier-send-open' });
        expect(built.jobs).toHaveLength(1);
        expect(built.provider.posts).toHaveLength(0);
      });

      it.runIf(engine.available)('a marker nobody came back for becomes unknown', async () => {
        const { path, id } = await crashed(TWILIO);
        expect(await path.settleAbandoned(NOON)).toBe(0);
        clock.now += 3_600_000;
        expect(await path.settleAbandoned(clock.now - 60_000)).toBe(1);
        expect(await reread(id)).toMatchObject({ state: 'unknown', reason: 'earlier-attempt-unknown', mayHaveGoneAt: NOON, attemptStartedAt: null });
      });
    });

    it.runIf(engine.available)('of two workers holding one row, one calls the provider', async () => {
      await agree(DE);
      const built = await rig();
      const { payload } = await queued(built);
      const answers = await Promise.all([built.path.handOver(payload, attempt()), built.path.handOver(payload, attempt())]);
      expect(built.provider.posts).toHaveLength(1);
      expect(answers.filter((one) => one.outcome === 'accepted').length).toBeGreaterThanOrEqual(1);
      expect(await usedToday()).toBe(1);
    });

    it.runIf(engine.available)('of two workers past every check on a retry, the marker lets one through', async () => {
      await agree(DE);
      let arrived = 0;
      let armed = false;
      let open: () => void = () => undefined;
      const bothHere = new Promise<void>((resolve) => (open = resolve));
      const built = await rig({
        script: [json(429, { code: 20429 })],
        over: {
          consent: {
            ...consent,
            // Holds each worker just after its last check, so both reach the marker from the same version.
            decide: async (request) => {
              const answer = await consent.decide(request);
              if (armed) {
                arrived += 1;
                if (arrived === 2) open();
                await bothHere;
              }
              return answer;
            },
          },
        },
      });
      const { id, payload } = await queued(built);
      await expect(built.path.handOver(payload, attempt(1))).rejects.toBeInstanceOf(TextRetryLater);
      expect(await reread(id)).toMatchObject({ state: 'retrying', slotDay: '2026-06-15' });
      armed = true;
      const answers = await Promise.all([built.path.handOver(payload, attempt(2)), built.path.handOver(payload, attempt(2))]);
      expect(answers.map((one) => one.outcome).sort()).toEqual(['accepted', 'busy']);
      expect(built.provider.posts).toHaveLength(2);
      expect(await usedToday()).toBe(1);
    });

    it.runIf(engine.available)('a live worker that was presumed dead still lands its message id', async () => {
      await agree(DE);
      let release: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => (release = resolve));
      const built = await rig();
      const slow = createTextSendPath({
        sms: { ...built.sms, send: async (request) => { const answer = await built.sms.send(request); await gate; return answer; } },
        consent,
        store,
        secret: SECRET,
        policy: async () => ({}),
        repliesReachUs: () => true,
        operatorAllows: () => true,
        phoneKeys: textPhoneKeys(handle.meta, SECRET),
        enqueue: async () => undefined,
        now: () => clock.now,
      });
      const { id, payload } = await queued(built);
      const first = slow.handOver(payload, attempt(1));
      for (let turn = 0; turn < 200 && (await reread(id)).state !== 'handing-over'; turn += 1) await new Promise((resolve) => setTimeout(resolve, 2));
      for (let turn = 0; turn < 200 && built.provider.posts.length === 0; turn += 1) await new Promise((resolve) => setTimeout(resolve, 2));
      // The reclaiming worker reads the marker and writes unknown.
      expect(await built.path.handOver(payload, attempt(2))).toMatchObject({ outcome: 'unknown' });
      release();
      expect(await first).toMatchObject({ outcome: 'accepted' });
      expect(built.provider.posts).toHaveLength(1);
      expect(await reread(id)).toMatchObject({ state: 'accepted', providerMessageId: `SM${'cd'.repeat(16)}` });
    });

    it.runIf(engine.available)('a message with an unsettled send is not sent again until someone checks', async () => {
      await agree(DE);
      const built = await rig({ script: ['hang'] });
      const first = await queued(built, {}, 'app:table:42');
      await built.path.handOver(first.payload, attempt());
      clock.now += 60_000;
      const again = await built.path.prepare(input());
      if (again.action !== 'send') throw new Error('expected send');
      expect(await built.path.queue(again, { messageKey: 'app:table:42', claimKey: 'second' })).toEqual({ queued: false, reason: 'earlier-send-open' });
      expect(built.provider.posts).toHaveLength(1);

      expect(await built.path.resolveUnknown(first.id, 'checked-not-sent')).toMatchObject({ state: 'checked-not-sent' });
      expect(await built.path.resolveUnknown(first.id, 'checked-went')).toBeNull();
      clock.now += 60_000;
      const third = await queued(built, {}, 'app:table:42');
      expect(await built.path.handOver(third.payload, attempt())).toMatchObject({ outcome: 'accepted' });
      expect(built.provider.posts).toHaveLength(2);
    });

    it.runIf(engine.available)('a job run again on a finished row calls nobody', async () => {
      await agree(DE);
      const built = await rig();
      const { payload } = await queued(built);
      await built.path.handOver(payload, attempt());
      expect(await built.path.handOver(payload, attempt(2))).toEqual({ outcome: 'accepted', reason: null });
      expect(built.provider.posts).toHaveLength(1);
    });

    it.runIf(engine.available)('reads a failed status on an accepted answer, and does not retry', async () => {
      await agree(DE);
      const built = await rig({ script: [twilioAccepted('failed')] });
      const { id, payload } = await queued(built);
      expect(await built.path.handOver(payload, attempt())).toEqual({ outcome: 'provider-failed', reason: null });
      expect(await reread(id)).toMatchObject({ state: 'provider-failed', providerStatus: 'failed', slotDay: '2026-06-15' });
      expect(await usedToday()).toBe(1);
      expect(await built.path.handOver(payload, attempt(2))).toMatchObject({ outcome: 'provider-failed' });
      expect(built.provider.posts).toHaveLength(1);
    });

    it.runIf(engine.available)('a job stopped before its try ends the row, unsent', async () => {
      await agree(DE);
      const built = await rig();
      const { id, payload } = await queued(built);
      const stop = new AbortController();
      stop.abort();
      expect(await built.path.handOver(payload, attempt(1, stop.signal))).toEqual({ outcome: 'not-sent', reason: 'cancelled' });
      expect(built.provider.posts).toHaveLength(0);
      expect(await reread(id)).toMatchObject({ state: 'not-sent', slotDay: null });
    });

    it.runIf(engine.available)('a Telnyx call stopped midway is unknown, because no later run will settle it', async () => {
      await agree(DE);
      const stop = new AbortController();
      const built = await rig({ credentials: TELNYX, script: ['hang'] });
      const { id, payload } = await queued(built);
      const run = built.path.handOver(payload, attempt(1, stop.signal));
      for (let turn = 0; turn < 200 && built.provider.posts.length === 0; turn += 1) await new Promise((resolve) => setTimeout(resolve, 1));
      stop.abort();
      expect(await run).toMatchObject({ outcome: 'unknown' });
      expect((await reread(id)).state).toBe('unknown');
    });

    it.runIf(engine.available)('gives up after the last certain failure, and hands the slot back', async () => {
      await agree(DE);
      const built = await rig({ script: [json(429, { code: 20429 })] });
      const { id, payload } = await queued(built);
      expect(await built.path.handOver(payload, attempt(SMS_SEND_ATTEMPTS))).toEqual({ outcome: 'not-sent', reason: 'rate-limited' });
      expect(await reread(id)).toMatchObject({ state: 'not-sent', slotDay: null });
      expect(await usedToday()).toBe(0);
    });

    it.runIf(engine.available)('an envelope that cannot be opened never sends', async () => {
      await agree(DE);
      const built = await rig();
      const { id, payload } = await queued(built);
      expect(await built.path.handOver({ ...payload, envelope: 'enc:v1:AAAA' }, attempt())).toEqual({ outcome: 'not-sent', reason: 'envelope-unreadable' });
      expect(built.provider.posts).toHaveLength(0);
      expect((await reread(id)).state).toBe('not-sent');
    });
  });

  describe('consent, up to the last moment', () => {
    it.runIf(engine.available)('a STOP after prepare stops it at the hand-over', async () => {
      await agree(DE);
      const built = await rig();
      const { id, payload } = await queued(built);
      await consent.stop.add({ phone: DE, reason: 'text-stop', origin: 'twilio', at: clock.now });
      expect(await built.path.handOver(payload, attempt())).toEqual({ outcome: 'skipped', reason: 'stopped' });
      expect(built.provider.posts).toHaveLength(0);
      expect(await reread(id)).toMatchObject({ state: 'skipped', slotDay: null });
      expect(await usedToday()).toBe(0);
    });

    it.runIf(engine.available)('a thrown decide at prepare means do not send', async () => {
      const built = await rig({ over: { consent: { ...consent, decide: async () => { throw new Error('keys locked'); } } } });
      expect(await built.path.prepare(input())).toEqual({ action: 'fail', reason: 'could-not-check' });
    });

    it.runIf(engine.available)('a thrown decide at the hand-over retries, then ends unsent', async () => {
      await agree(DE);
      const broken = { value: false };
      const built = await rig({ over: { consent: { ...consent, decide: async (request) => { if (broken.value) throw new Error('keys locked'); return consent.decide(request); } } } });
      const { id, payload } = await queued(built);
      broken.value = true;
      await expect(built.path.handOver(payload, attempt(1))).rejects.toBeInstanceOf(TextRetryLater);
      expect(await built.path.handOver(payload, attempt(SMS_SEND_ATTEMPTS))).toEqual({ outcome: 'not-sent', reason: 'could-not-check' });
      expect(built.provider.posts).toHaveLength(0);
      expect(await reread(id)).toMatchObject({ state: 'not-sent', slotDay: null });
    });

    it.runIf(engine.available)('a provider opt-out writes the stop list', async () => {
      await agree(DE);
      const built = await rig({ script: [json(400, { code: 21610 })] });
      const { id, payload } = await queued(built);
      expect(await built.path.handOver(payload, attempt())).toEqual({ outcome: 'refused', reason: 'opted-out' });
      expect(await consent.stop.has(DE, null)).toBe(true);
      expect((await consent.stop.entryFor(DE, null))?.reason).toBe('provider-opt-out');
      expect(await reread(id)).toMatchObject({ state: 'refused', reason: 'opted-out', stopOwedAt: null, slotDay: null });
      expect(await built.path.prepare(input())).toEqual({ action: 'skip', reason: 'stopped' });
    });

    it.runIf(engine.available)('a stop-list write that failed is finished by the next run, with no new call', async () => {
      await agree(DE);
      const down = { value: true };
      const built = await rig({
        script: [json(400, { code: 21610 })],
        over: { consent: { ...consent, stop: { ...consent.stop, add: async (entry) => { if (down.value) throw new Error('store down'); return consent.stop.add(entry); } } } },
      });
      const { id, payload } = await queued(built);
      await expect(built.path.handOver(payload, attempt(1))).rejects.toThrow('store down');
      expect((await reread(id)).stopOwedAt).toBe(NOON);
      down.value = false;
      expect(await built.path.handOver(payload, attempt(2))).toEqual({ outcome: 'refused', reason: 'opted-out' });
      expect(built.provider.posts).toHaveLength(1);
      expect(await consent.stop.has(DE, null)).toBe(true);
      expect((await reread(id)).stopOwedAt).toBeNull();
    });

    it.runIf(engine.available)('a provider opt-out on a retry still writes the stop list', async () => {
      await agree(DE);
      const built = await rig({ credentials: TELNYX, script: ['hang', json(403, { errors: [{ code: '40300' }] })] });
      const { payload } = await queued(built);
      await expect(built.path.handOver(payload, attempt(1))).rejects.toBeInstanceOf(TextRetryLater);
      expect(await built.path.handOver(payload, attempt(2))).toEqual({ outcome: 'unknown', reason: 'earlier-attempt-unknown' });
      expect(await consent.stop.has(DE, null)).toBe(true);
    });

    it.runIf(engine.available)('a change in how replies arrive stops a text written for the old way', async () => {
      await agree(DE);
      const replies = { value: true };
      const built = await rig({ replies });
      const { payload } = await queued(built);
      replies.value = false;
      expect(await built.path.handOver(payload, attempt())).toEqual({ outcome: 'skipped', reason: 'opt-out-changed' });
      expect(built.provider.posts).toHaveLength(0);
    });
  });

  describe('send windows at the hand-over', () => {
    const night = Date.parse('2026-06-15T23:00:00Z');
    const morning = Date.parse('2026-06-16T08:00:00Z');

    it.runIf(engine.available)('a shut window holds the text in the queue, and never asks a caller to re-date its row', async () => {
      await agree(DE);
      const built = await rig();
      clock.now = night;
      const ready = await built.path.prepare(input());
      expect(ready).toMatchObject({ action: 'send', opensAt: morning });
      expect(Object.keys(ready)).not.toContain('until');
    });

    it.runIf(engine.available)('prepare skips a reminder the window would hold past its visit', async () => {
      await agree(DE);
      const built = await rig();
      clock.now = night;
      expect(await built.path.prepare(input({ notAfter: morning - 1000 }))).toEqual({ action: 'skip', reason: 'past-its-moment' });
    });

    it.runIf(engine.available)('a text held for a shut window runs at the opening, on the count of that day', async () => {
      await agree(DE);
      const built = await rig({ policy: { dailyLimit: 1 } });
      // Today is full. The text would go tomorrow, so today's count does not refuse it.
      const first = await queued(built);
      await built.path.handOver(first.payload, attempt());
      clock.now = night;
      const ready = await built.path.prepare(input());
      expect(ready).toMatchObject({ action: 'send', opensAt: morning });
      if (ready.action !== 'send') throw new Error('expected send');
      await built.path.queue(ready, { messageKey: 'held', claimKey: 'c' });
      expect(built.jobs.at(-1)).toMatchObject({ runAt: morning });
      expect(built.provider.posts).toHaveLength(1);
      clock.now = morning;
      expect(await built.path.handOver(built.jobs.at(-1)!.payload as SmsSendPayload, attempt())).toMatchObject({ outcome: 'accepted' });
    });

    it.runIf(engine.available)('holding in the queue never carries a text past its visit', async () => {
      await agree(DE);
      const built = await rig();
      clock.now = night;
      expect(await built.path.prepare(input({ notAfter: morning - 1000 }))).toEqual({ action: 'skip', reason: 'past-its-moment' });
    });

    it.runIf(engine.available)('a kind the customer is waiting for goes at night', async () => {
      await agree(DE);
      const built = await rig();
      clock.now = night;
      const { payload } = await queued(built, { waiting: true });
      expect(await built.path.handOver(payload, attempt())).toMatchObject({ outcome: 'accepted' });
    });

    it.runIf(engine.available)('a job that reaches a shut window waits for it, under a key of its own', async () => {
      await agree(DE);
      const built = await rig();
      const { id, payload } = await queued(built);
      clock.now = night;
      expect(await built.path.handOver(payload, attempt())).toEqual({ outcome: 'waiting', until: morning });
      expect(built.provider.posts).toHaveLength(0);
      expect(built.jobs.at(-1)).toMatchObject({ runAt: morning, dedupeKey: `sms.send:${id}:${String(morning)}` });
      clock.now = morning;
      expect(await built.path.handOver(payload, attempt())).toMatchObject({ outcome: 'accepted' });
    });

    it.runIf(engine.available)('a job past its visit is skipped', async () => {
      await agree(DE);
      const built = await rig();
      const { payload } = await queued(built, { notAfter: NOON + 60_000 });
      clock.now = NOON + 60_000;
      expect(await built.path.handOver(payload, attempt())).toEqual({ outcome: 'skipped', reason: 'past-its-moment' });
      expect(built.provider.posts).toHaveLength(0);
    });

    it.runIf(engine.available)('marketing waits for the destination country, not the business', async () => {
      const sunday = Date.parse('2026-06-21T12:00:00Z');
      clock.now = sunday;
      await consent.record({ phone: DE, purpose: 'text-marketing', state: 'yes', source: 'form', detail: 'Newsletter form', wording: { text: 'Text me offers.', version: 'v1' }, at: sunday - 1000, confirmedAt: sunday - 500 });
      const built = await rig();
      // Open by the business's service hours, shut for marketing until Monday 09:00 in Berlin.
      expect(await built.path.prepare(input({ textClass: 'marketing', zone: 'UTC' }))).toMatchObject({ action: 'send', opensAt: Date.parse('2026-06-22T07:00:00Z') });
      clock.now = Date.parse('2026-06-22T07:00:00Z');
      expect(await built.path.prepare(input({ textClass: 'marketing', zone: 'UTC' }))).toMatchObject({ action: 'send', text: { timing: 'marketing' } });
    });

    it.runIf(engine.available)('marketing is never timed as a kind the customer waits for', async () => {
      const sunday = Date.parse('2026-06-21T12:00:00Z');
      clock.now = sunday;
      await consent.record({ phone: DE, purpose: 'text-marketing', state: 'yes', source: 'form', detail: 'Newsletter form', wording: { text: 'Text me offers.', version: 'v1' }, at: sunday - 1000, confirmedAt: sunday - 500 });
      const built = await rig();
      expect(await built.path.prepare(input({ textClass: 'marketing', waiting: true }))).toMatchObject({ action: 'send', opensAt: Date.parse('2026-06-22T07:00:00Z'), text: { timing: 'marketing' } });
    });
  });

  describe('the daily limit', () => {
    it.runIf(engine.available)('refuses a text once the day is full', async () => {
      await agree(DE);
      const built = await rig({ policy: { dailyLimit: 1 } });
      const first = await queued(built);
      const second = await queued(built);
      expect(await built.path.handOver(first.payload, attempt())).toMatchObject({ outcome: 'accepted' });
      expect(await built.path.handOver(second.payload, attempt())).toEqual({ outcome: 'skipped', reason: 'daily-limit' });
      expect(built.provider.posts).toHaveLength(1);
      expect(await built.path.prepare(input())).toEqual({ action: 'skip', reason: 'daily-limit' });
    });

    it.runIf(engine.available)('two concurrent sends cannot pass it', async () => {
      await agree(DE);
      await agree(DE_TWO);
      const built = await rig({ policy: { dailyLimit: 5 } });
      const made = [];
      for (let n = 0; n < 16; n += 1) made.push(await queued(built, { phone: n % 2 === 0 ? DE : DE_TWO }));
      const answers = await Promise.all(made.map((one) => built.path.handOver(one.payload, attempt())));
      expect(answers.filter((one) => one.outcome === 'accepted')).toHaveLength(5);
      expect(answers.filter((one) => one.outcome === 'skipped')).toHaveLength(11);
      expect(built.provider.posts).toHaveLength(5);
      expect(await usedToday()).toBe(5);
    }, 30_000);

    it.runIf(engine.available)('a message keeps one slot across its retries', async () => {
      await agree(DE);
      const built = await rig({ script: [json(429, { code: 20429 }), json(429, { code: 20429 })] });
      const { payload } = await queued(built);
      await expect(built.path.handOver(payload, attempt(1))).rejects.toBeInstanceOf(TextRetryLater);
      await expect(built.path.handOver(payload, attempt(2))).rejects.toBeInstanceOf(TextRetryLater);
      expect(await usedToday()).toBe(1);
      await built.path.handOver(payload, attempt(3));
      expect(await usedToday()).toBe(1);
    });

    it.runIf(engine.available)('gives a slot back after a refusal, and only once', async () => {
      await agree(DE);
      const built = await rig({ script: [json(400, { code: 21211 })] });
      const held = await queued(built);
      const other = await queued(built);
      expect(await built.path.handOver(held.payload, attempt())).toEqual({ outcome: 'refused', reason: 'invalid-number' });
      expect(await usedToday()).toBe(0);
      await built.path.handOver(other.payload, attempt());
      expect(await usedToday()).toBe(1);
      await built.path.handOver(held.payload, attempt(2));
      expect(await usedToday()).toBe(1);
    });

    it.runIf(engine.available)('a count that was edited down never goes below zero', async () => {
      await agree(DE);
      const built = await rig({ script: [json(400, { code: 21211 })] });
      const { payload } = await queued(built);
      const db = handle.meta.db as unknown as Kysely<{ adminium_text_send_days: { day: string; used: number } }>;
      const row = await reread(payload.deliveryId);
      await store.reserve(row.id, row.version, '2026-06-15', 500, clock.now);
      await db.updateTable('adminium_text_send_days').set({ used: 0 }).where('day', '=', '2026-06-15').execute();
      await built.path.handOver(payload, attempt());
      expect(await usedToday()).toBe(0);
    });

    it.runIf(engine.available)('never gives one back after an unknown', async () => {
      await agree(DE);
      const built = await rig({ script: ['hang'] });
      const { id, payload } = await queued(built);
      await built.path.handOver(payload, attempt());
      expect(await usedToday()).toBe(1);
      expect((await reread(id)).slotDay).toBe('2026-06-15');
      await built.path.resolveUnknown(id, 'checked-not-sent');
      expect(await usedToday()).toBe(1);
    });

    it.runIf(engine.available)('warns once, at 80%', async () => {
      await agree(DE);
      const built = await rig({ policy: { dailyLimit: 5 } });
      for (let n = 0; n < 5; n += 1) {
        const { payload } = await queued(built);
        await built.path.handOver(payload, attempt());
      }
      expect(built.warnings).toEqual([{ day: '2026-06-15', used: 4, limit: 5 }]);
      expect(await built.path.usage()).toEqual({ day: '2026-06-15', used: 5, limit: 5, warning: true });
    });

    it.runIf(engine.available)('a warning that fails never stops the text', async () => {
      await agree(DE);
      const built = await rig({ policy: { dailyLimit: 1 }, over: { onLimitWarning: () => { throw new Error('no one to tell'); } } });
      const { payload } = await queued(built);
      expect(await built.path.handOver(payload, attempt())).toMatchObject({ outcome: 'accepted' });
    });

    it.runIf(engine.available)('counts on the day of the server zone', async () => {
      await agree(DE);
      const built = await rig({ policy: { dailyLimit: 1, dayZone: 'Asia/Tokyo' } });
      const zone = 'Asia/Tokyo';
      clock.now = Date.parse('2026-06-15T14:00:00Z'); // 23:00 in Tokyo
      const first = await queued(built, { zone, waiting: true });
      await built.path.handOver(first.payload, attempt());
      expect(await store.usedOn('2026-06-15')).toBe(1);
      clock.now = Date.parse('2026-06-15T15:30:00Z'); // 00:30 the next day in Tokyo
      const second = await queued(built, { zone, waiting: true });
      expect(await built.path.handOver(second.payload, attempt())).toMatchObject({ outcome: 'accepted' });
      expect(await store.usedOn('2026-06-16')).toBe(1);
    });
  });

  describe('what is kept', () => {
    it.runIf(engine.available)('no record holds the number or the words', async () => {
      await agree(DE);
      const built = await rig({ script: ['hang'] });
      const { id, payload } = await queued(built);
      await built.path.handOver(payload, attempt());
      const stored = await (handle.meta.db as unknown as Kysely<Record<string, Record<string, unknown>>>).selectFrom('adminium_text_deliveries').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
      for (const text of [JSON.stringify(stored), JSON.stringify(payload)]) {
        expect(text).not.toContain(DE);
        expect(text).not.toContain(DE.slice(1));
        expect(text).not.toContain(WORDS);
        expect(text).not.toContain('Thomasina');
      }
      // The row's own keys are kept hashed too: a primary key can be a person's.
      expect(JSON.stringify(stored)).not.toContain('app:table');
    });

    it.runIf(engine.available)('a sealed text of the wrong shape does not open', async () => {
      await agree(DE);
      const built = await rig();
      const { payload } = await queued(built);
      const text = openText(payload.envelope, SECRET)!;
      expect(openText(sealText({ ...text, to: 'not a number' }, SECRET), SECRET)).toBeNull();
    });

    it.runIf(engine.available)('the store refuses what a job must never do', async () => {
      await agree(DE);
      const built = await rig();
      const { id, payload } = await queued(built);
      const row = await reread(id);
      const slot = await store.reserve(id, row.version, '2026-06-15', 500, clock.now);
      expect(slot.outcome).toBe('held');
      const held = await reread(id);
      // One slot per message, whatever the version.
      expect(await store.reserve(id, held.version, '2026-06-15', 500, clock.now)).toEqual({ outcome: 'lost' });
      expect(await usedToday()).toBe(1);
      // A stale version moves nothing, at either step.
      expect(await store.begin(id, held.version - 1, { at: clock.now, account: null, earlier: null })).toBeNull();
      expect(await store.settle(id, held.version - 1, { state: 'skipped', reason: 'stopped', at: clock.now })).toBeNull();
      expect(await reread(id)).toMatchObject({ state: 'prepared', version: held.version });
      await built.path.handOver(payload, attempt());
      const done = await reread(id);
      expect(await store.begin(id, done.version, { at: clock.now, account: null, earlier: null })).toBeNull();
      const db = handle.meta.db as unknown as Kysely<{ adminium_text_deliveries: { id: string; state: string } }>;
      await db.updateTable('adminium_text_deliveries').set({ state: 'from-a-newer-version' }).where('id', '=', id).execute();
      await expect(store.byId(id)).rejects.toThrow('cannot read');
    });

    it.runIf(engine.available)('the job holds them only sealed', async () => {
      await agree(DE);
      const built = await rig();
      const { payload } = await queued(built);
      const raw = JSON.stringify(payload);
      expect(raw).not.toContain(DE.slice(1));
      expect(raw).not.toContain(WORDS);
      expect(openText(payload.envelope, SECRET)).toMatchObject({ to: DE });
      expect(openText(payload.envelope, 'another-server-secret-of-some-length')).toBeNull();
    });

    it.runIf(engine.available)('what a run throws and returns holds neither', async () => {
      await agree(DE);
      const built = await rig({ script: [json(429, { code: 20429, message: `Too many to ${DE}` }), json(400, { code: 21211, message: `Bad number ${DE}: ${WORDS}` })] });
      const { payload } = await queued(built);
      const thrown = await built.path.handOver(payload, attempt(1)).catch((error: Error) => error.message);
      expect(thrown).toBe('Text not sent yet: rate-limited');
      const answer = JSON.stringify(await built.path.handOver(payload, attempt(2)));
      expect(answer).not.toContain(DE.slice(1));
      expect(answer).not.toContain(WORDS);
    });

    it.runIf(engine.available)('erases every record of a number, and only that number', async () => {
      await agree(DE);
      await agree(DE_TWO);
      const built = await rig();
      const one = await queued(built);
      const other = await queued(built, { phone: DE_TWO });
      await built.path.handOver(one.payload, attempt());
      expect(await built.path.eraseFor(DE, null)).toBe(1);
      expect(await store.byId(one.id)).toBeNull();
      expect(await store.byId(other.id)).not.toBeNull();
      expect(await built.path.eraseFor('not a number', null)).toBe(0);
    });
  });

  describe('delivery reports', () => {
    async function sent() {
      await agree(DE);
      const built = await rig();
      const { id, payload } = await queued(built);
      await built.path.handOver(payload, attempt());
      return { built, id, messageId: `SM${'cd'.repeat(16)}` };
    }

    it.runIf(engine.available)('moves a status forward and records the price', async () => {
      const { built, id, messageId } = await sent();
      await built.path.applyReport({ provider: 'twilio', messageId, status: 'delivered', segments: 2, price: { amount: '-0.0158', currency: 'USD' }, at: clock.now });
      expect(await reread(id)).toMatchObject({ state: 'accepted', providerStatus: 'delivered', segments: 2, price: { amount: '-0.0158', currency: 'USD' } });
    });

    it.runIf(engine.available)('ignores a report out of order', async () => {
      const { built, id, messageId } = await sent();
      await built.path.applyReport({ provider: 'twilio', messageId, status: 'delivered', at: clock.now });
      await built.path.applyReport({ provider: 'twilio', messageId, status: 'sent', at: clock.now });
      expect((await reread(id)).providerStatus).toBe('delivered');
    });

    it.runIf(engine.available)('a failure report marks it failed, and a word nobody listed moves nothing', async () => {
      const { built, id, messageId } = await sent();
      await built.path.applyReport({ provider: 'twilio', messageId, status: 'mystery', at: clock.now });
      expect((await reread(id)).providerStatus).toBe('queued');
      await built.path.applyReport({ provider: 'twilio', messageId, status: 'undelivered', at: clock.now });
      expect(await reread(id)).toMatchObject({ state: 'provider-failed', providerStatus: 'undelivered' });
    });

    it.runIf(engine.available)('answers null for a message it does not know', async () => {
      const { built } = await sent();
      expect(await built.path.applyReport({ provider: 'telnyx', messageId: 'nope', status: 'delivered', at: clock.now })).toBeNull();
    });
  });

  describe('through the real worker', () => {
    const hub = { publish: () => ({}) } as unknown as RealtimeHub;

    it.runIf(engine.available)('retries a not-taken, and a restart after a crash calls nobody', async () => {
      await agree(DE);
      const repo = jobsRepo(handle.meta);
      const built = await rig({ script: [json(429, { code: 20429 })], over: { enqueue: (job) => repo.enqueue(job, clock.now) } });
      const registry = createJobRegistry();
      registerSmsSendHandler(registry, built.path.handOver);
      const worker = new JobWorker({ meta: handle.meta, registry, hub, workerId: 'text-test', backoffBaseMs: 10, now: () => clock.now });
      const ready = await built.path.prepare(input());
      if (ready.action !== 'send') throw new Error('expected send');
      const made = await built.path.queue(ready, { messageKey: 'worker', claimKey: 'c' });
      if (!made.queued) throw new Error('expected queued');

      await worker.runOnce();
      expect((await reread(made.deliveryId)).state).toBe('retrying');
      clock.now += 1000;
      await worker.runOnce();
      expect((await reread(made.deliveryId)).state).toBe('accepted');
      expect(built.provider.posts).toHaveLength(2);
      clock.now += 1000;
      expect(await worker.runOnce()).toBe(0);
      expect(built.provider.posts).toHaveLength(2);
    });

    it.runIf(engine.available)('a job reclaimed from a dead worker reads the marker and stops', async () => {
      await agree(DE);
      const repo = jobsRepo(handle.meta);
      const built = await rig({ over: { enqueue: (job) => repo.enqueue(job, clock.now) } });
      const ready = await built.path.prepare(input());
      if (ready.action !== 'send') throw new Error('expected send');
      const made = await built.path.queue(ready, { messageKey: 'stale', claimKey: 'c' });
      if (!made.queued) throw new Error('expected queued');
      // The first worker took the job, saved the marker and died.
      const taken = await repo.claim('dead-worker', clock.now);
      expect(taken).not.toBeNull();
      const row = await reread(made.deliveryId);
      await store.reserve(row.id, row.version, '2026-06-15', 500, clock.now);
      const held = await reread(made.deliveryId);
      await store.begin(held.id, held.version, { at: clock.now, account: 'a'.repeat(32), earlier: null });

      clock.now += 6 * 60_000;
      const registry = createJobRegistry();
      registerSmsSendHandler(registry, built.path.handOver);
      const worker = new JobWorker({ meta: handle.meta, registry, hub, workerId: 'second', now: () => clock.now });
      expect(await worker.runOnce()).toBe(1);
      expect(built.provider.posts).toHaveLength(0);
      expect(await reread(made.deliveryId)).toMatchObject({ state: 'unknown', reason: 'earlier-attempt-unknown' });
      expect(await repo.findById(taken!.id)).toMatchObject({ status: 'succeeded' });
    });
  });
});

describe.each(META_ENGINES)('before the tables exist — $name', (engine) => {
  it.runIf(engine.available)('a send throws rather than goes', async () => {
    const handle = await engine.make();
    try {
      await makeTextConsentTables(handle.meta);
      const store = createTextSendStore(handle.meta);
      await expect(store.byId('job_x')).rejects.toThrow();
      await expect(store.usedOn('2026-06-15')).rejects.toThrow();
    } finally {
      await handle.destroy();
    }
  }, 60_000);
});
