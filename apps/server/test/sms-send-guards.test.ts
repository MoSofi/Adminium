// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The send path's guards at its edges, on SQLite, Postgres and MySQL:
 *
 *  - whose yes counts: a yes given to one app stands for that app's texts, not
 *    for whatever another app's staff or rules write (`TextConsentScope`);
 *  - the service window with no business clock reads the destination
 *    country's zones, never UTC;
 *  - a filled value cannot carry a bare domain, an address or a number to call;
 *  - a text held for its window goes from the account's sender as it is when it
 *    goes, and a marketing one never from a sender that changed;
 *  - a test text is the person's own, counted in meta and in the day's limit.
 *
 * Marketing is unlocked here, as `sms-marketing.test.ts` does: the lock itself
 * is `sms-marketing-lock.test.ts`.
 */
import type { ConsentPerson, EnqueueJobInput } from '@adminium/meta';
import type { Kysely } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { RateLimitedError } from '../src/errors.js';
import { createTextConsentService, type TextConsentService } from '../src/sms/consent/index.js';
import { createSmsService, type SmsService } from '../src/sms/index.js';
import { createTextSendPath, createTextSendStore, fillText, judgeWindow, openText, SMS_SEND_ATTEMPTS, textPhoneKeys, type SmsSendPayload, type TextPrepareInput, type TextSendStore } from '../src/sms/send/index.js';
import { createSmsTestGate, SMS_TEST_NUMBERS_PER_PERSON_DAY, SMS_TEST_PER_DAY } from '../src/sms/test-gate.js';
import { SMS_TEST_LIMIT } from '../src/sms/service.js';
import type { SmsSender } from '../src/sms/types.js';
import { memorySmsStore } from './helpers/sms-store.js';
import { META_ENGINES, type MetaHandle } from './meta-dialects.js';
import { stubProvider } from './sms-send.helpers.js';

vi.mock('../src/sms/marketing/availability.js', () => ({ TEXT_MARKETING_AVAILABLE: true }));

const SECRET = 'a-text-guards-test-secret-of-some-length';
const FROM = '+14155550100';
const OTHER = '+14155550199';
const DE = '+4915123456789';
const SEATTLE = '+12065550123';
/** A Monday, noon UTC: open for service and marketing in Germany. */
const NOON = Date.parse('2026-06-15T12:00:00Z');
const attempt = () => ({ attempt: 1, maxAttempts: SMS_SEND_ATTEMPTS, signal: new AbortController().signal });

const CLINIC_ROW: ConsentPerson = { connectionId: 'con_1', table: 'public.patients', key: '7' };
const CRM_ROW: ConsentPerson = { connectionId: 'con_1', table: 'public.contacts', key: '7' };
const APPS: Readonly<Record<string, string>> = { 'public.patients': 'clinic', 'public.contacts': 'crm' };
const appOf = async (person: ConsentPerson): Promise<string | null> => APPS[person.table] ?? null;

describe('the service window with no business clock', () => {
  const hours = { from: '08:00', to: '21:00' };
  /** 09:00 UTC in November: 01:00 in Seattle. */
  const at = Date.parse('2026-11-24T09:00:00Z');
  const seattleEight = Date.parse('2026-11-24T16:00:00Z');

  it('reads every zone of the destination country, not UTC', () => {
    const verdict = judgeWindow({ timing: 'service', at, zone: null, country: 'US', serviceHours: hours, notAfter: null });
    expect(verdict.go).toBe(false);
    if (verdict.go || !('until' in verdict)) throw new Error('expected a wait');
    expect(verdict.until).toBeGreaterThanOrEqual(seattleEight);
  });

  it('reads a zone that cannot be used the same way', () => {
    expect(judgeWindow({ timing: 'service', at, zone: 'Not/A_Zone', country: 'US', serviceHours: hours, notAfter: null })).toEqual(judgeWindow({ timing: 'service', at, zone: null, country: 'US', serviceHours: hours, notAfter: null }));
  });

  it('keeps the business clock when one is set, UTC included', () => {
    expect(judgeWindow({ timing: 'service', at, zone: 'UTC', country: 'US', serviceHours: hours, notAfter: null })).toEqual({ go: true });
    expect(judgeWindow({ timing: 'service', at, zone: 'Europe/Berlin', country: 'US', serviceHours: hours, notAfter: null })).toEqual({ go: true });
  });

  it('is open in a one-zone country within its own hours', () => {
    expect(judgeWindow({ timing: 'service', at: NOON, zone: null, country: 'DE', serviceHours: hours, notAfter: null })).toEqual({ go: true });
  });
});

describe('a filled value that reaches out', () => {
  it.each([
    ['a bare domain', 'name', 'Your stay is unpaid, pay at hotel-pay.io now'],
    ['a bare domain with a path', 'name', 'see hotel-pay.io/now'],
    ['a bare domain in capitals', 'name', 'HOTEL-PAY.IO'],
    ['an e-mail address', 'name', 'tom@lumen.example'],
    ['a number to call', 'name', 'call +1 900 555 0100'],
    ['a dotted number', 'name', '06.12.34.56.78'],
    ['seven digits together', 'notes', 'Order 1234567'],
  ])('refuses %s', (_label, name, value) => {
    expect(fillText(`Hi {{${name}}}`, { [name]: value })).toEqual({ ok: false, reason: 'value-has-link' });
  });

  it.each([
    ['an abbreviation', 'name', 'St. Mary'],
    ['initials', 'name', 'J.R.R. Tolkien'],
    ['a written date and time', 'visit', 'Monday, 24 November 2026 at 10:30'],
    ['a numeric date and time', 'visit', '24.11.2026, 10:30'],
    ['a stored timestamp', 'visit', '2026-11-24T10:00:00.000Z'],
    ['a reference', 'booking.reference', 'BK-20261124-0042'],
    ['an amount', 'order.total', '1.250.000 €'],
    ['a phone the app prints', 'clinic.phone', '+49 30 1234567'],
    ['the business name with a domain in it', 'business', 'Wren.shop'],
  ])('keeps %s', (_label, name, value) => {
    expect(fillText(`Hi {{${name}}}`, { [name]: value })).toMatchObject({ ok: true });
  });
});

describe.each(META_ENGINES)('the send path\'s guards — $name', (engine) => {
  let handle: MetaHandle;
  let consent: TextConsentService;
  let store: TextSendStore;
  let clock: { now: number };

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
    for (const table of ['adminium_text_deliveries', 'adminium_text_send_days', 'adminium_text_stop_list', 'adminium_text_consent_log', 'adminium_jobs', 'adminium_form_marks']) await db.deleteFrom(table).execute();
    clock = { now: NOON };
    consent = createTextConsentService({ meta: handle.meta, secret: SECRET, appOf, now: () => clock.now });
    store = createTextSendStore(handle.meta);
  });

  const yes = (person: ConsentPerson | null, at = clock.now - 1000, purpose: 'text-service' | 'text-marketing' = 'text-service') =>
    consent.record({ phone: DE, person, purpose, state: 'yes', source: 'form', detail: 'Booking form', wording: { text: 'Remind me by text.', version: 'v1' }, at, ...(purpose === 'text-marketing' ? { confirmedAt: at } : {}) });
  const no = (at: number) => consent.record({ phone: DE, purpose: 'text-service', state: 'no', source: 'person', at });
  const decide = (scope?: Parameters<TextConsentService['decide']>[0]['scope']) =>
    consent.decide({ phone: DE, country: 'DE', class: 'service', sender: { kind: 'number' }, repliesReachUs: true, ...(scope === undefined ? {} : { scope }) });

  describe('whose yes counts', () => {
    it.runIf(engine.available)('a yes given on one app\'s row does not let another app\'s staff text', async () => {
      await yes(CLINIC_ROW);
      expect(await decide({ app: 'crm', record: CRM_ROW })).toEqual({ send: false, reason: 'no-consent' });
      expect(await decide({ app: 'clinic', record: null })).toMatchObject({ send: true });
      // Unscoped, as an app's own outbox asks: unchanged.
      expect(await decide()).toMatchObject({ send: true });
    });

    it.runIf(engine.available)('a business rule on a record counts a yes of that record\'s own app', async () => {
      await yes(CLINIC_ROW);
      expect(await decide({ record: { ...CLINIC_ROW, key: '8' } })).toMatchObject({ send: true });
      expect(await decide({ record: CRM_ROW })).toEqual({ send: false, reason: 'no-consent' });
    });

    it.runIf(engine.available)('a yes on the record itself counts with no app', async () => {
      const loose: ConsentPerson = { connectionId: 'con_1', table: 'public.leads', key: '1' };
      await yes(loose);
      expect(await decide({ app: null, record: loose })).toMatchObject({ send: true });
      expect(await decide({ app: null, record: { ...loose, key: '2' } })).toEqual({ send: false, reason: 'no-consent' });
    });

    it.runIf(engine.available)('a yes recorded with no row is the business\'s, and counts for every app', async () => {
      await yes(null);
      expect(await decide({ app: 'crm', record: CRM_ROW })).toMatchObject({ send: true });
    });

    it.runIf(engine.available)('an older yes of its own still counts behind another app\'s newer one, until a no', async () => {
      await yes(CRM_ROW, clock.now - 5000);
      await yes(CLINIC_ROW, clock.now - 1000);
      expect(await decide({ app: 'crm' })).toMatchObject({ send: true });
      await no(clock.now - 3000);
      expect(await decide({ app: 'crm' })).toEqual({ send: false, reason: 'no-consent' });
    });

    it.runIf(engine.available)('the standing a conversation shows is scoped the same way', async () => {
      await yes(CLINIC_ROW);
      expect((await consent.standing({ phone: DE }, 'text-service', { app: 'crm' })).state).toBe('not-asked');
      expect((await consent.standing({ phone: DE }, 'text-service', { app: 'clinic' })).state).toBe('yes');
    });
  });

  async function rig(sender: SmsSender = { kind: 'number', value: FROM }) {
    const provider = stubProvider('twilio', 'profile');
    const sms: SmsService = createSmsService({
      store: memorySmsStore(),
      secret: SECRET,
      fetch: provider.fetchStub,
      now: () => clock.now,
      timeoutMs: 30,
      stopList: { isStopped: (e164) => consent.stop.has(e164, null), recordProviderOptOut: async () => undefined },
    });
    await sms.connect({ provider: 'twilio', accountSid: `AC${'ab'.repeat(16)}`, authToken: 'made-up-token-for-these-tests' }, null);
    await sms.setSending({ sender, defaultCountry: 'DE' }, null);
    const jobs: EnqueueJobInput[] = [];
    const path = createTextSendPath({
      sms,
      consent,
      store,
      secret: SECRET,
      policy: async () => ({}),
      repliesReachUs: () => true,
      operatorAllows: () => true,
      phoneKeys: textPhoneKeys(handle.meta, SECRET),
      enqueue: async (job) => void jobs.push(job),
      now: () => clock.now,
    });
    return { path, sms, provider, jobs };
  }

  const input = (more: Partial<TextPrepareInput> = {}): TextPrepareInput => ({
    phone: DE,
    textClass: 'service',
    template: 'Your table is ready, {{name}}.',
    values: { name: 'Thomasina' },
    zone: 'UTC',
    business: { name: 'Lumen', email: 'hello@lumen.example' },
    ...more,
  });

  async function queue(built: Awaited<ReturnType<typeof rig>>, more: Partial<TextPrepareInput> = {}) {
    const ready = await built.path.prepare(input(more));
    if (ready.action !== 'send') throw new Error(`expected a text to send, got ${JSON.stringify(ready)}`);
    const made = await built.path.queue(ready, { messageKey: `m:${String(built.jobs.length)}`, claimKey: 'c' });
    if (!made.queued) throw new Error('expected it to queue');
    return built.jobs.at(-1)!.payload as SmsSendPayload;
  }

  describe('the scope through the send path', () => {
    it.runIf(engine.available)('refuses at prepare, and seals the scope for the hand-over to ask again', async () => {
      await yes(CLINIC_ROW);
      const built = await rig();
      expect(await built.path.prepare(input({ scope: { app: 'crm', record: CRM_ROW } }))).toEqual({ action: 'skip', reason: 'no-consent' });
      const payload = await queue(built, { scope: { app: 'clinic', record: CLINIC_ROW } });
      expect(openText(payload.envelope, SECRET)?.scope).toEqual({ app: 'clinic', record: CLINIC_ROW });
      expect(await built.path.handOver(payload, attempt())).toMatchObject({ outcome: 'accepted' });
    });

    it.runIf(engine.available)('a text prepared with no business clock waits for the destination\'s hours', async () => {
      await consent.record({ phone: SEATTLE, purpose: 'text-service', state: 'yes', source: 'form', detail: 'Booking form', wording: { text: 'Remind me by text.', version: 'v1' }, at: clock.now - 1000 });
      clock.now = Date.parse('2026-11-24T09:00:00Z');
      const built = await rig();
      const ready = await built.path.prepare(input({ phone: SEATTLE, zone: null }));
      expect(ready).toMatchObject({ action: 'send' });
      if (ready.action !== 'send') throw new Error('expected send');
      expect(ready.opensAt).toBeGreaterThanOrEqual(Date.parse('2026-11-24T16:00:00Z'));
    });
  });

  describe('a sender that changed while a text waited', () => {
    it.runIf(engine.available)('a marketing text is not sent from a sender that became a name', async () => {
      await yes(null, clock.now - 1000, 'text-marketing');
      const built = await rig();
      const payload = await queue(built, { textClass: 'marketing' });
      await built.sms.setSending({ sender: { kind: 'name', value: 'Lumen' }, defaultCountry: 'DE' }, null);
      expect(await built.path.handOver(payload, attempt())).toEqual({ outcome: 'skipped', reason: 'marketing-from-name' });
      expect(built.provider.posts).toHaveLength(0);
    });

    it.runIf(engine.available)('a marketing text is not sent from a number the account no longer sends from', async () => {
      await yes(null, clock.now - 1000, 'text-marketing');
      const built = await rig();
      const payload = await queue(built, { textClass: 'marketing' });
      await built.sms.setSending({ sender: { kind: 'number', value: OTHER }, defaultCountry: 'DE' }, null);
      expect(await built.path.handOver(payload, attempt())).toEqual({ outcome: 'skipped', reason: 'sender-changed' });
      expect(built.provider.posts).toHaveLength(0);
    });

    it.runIf(engine.available)('a service text goes from the account\'s number as it is now', async () => {
      await yes(null);
      const built = await rig();
      const payload = await queue(built);
      await built.sms.setSending({ sender: { kind: 'number', value: OTHER }, defaultCountry: 'DE' }, null);
      expect(await built.path.handOver(payload, attempt())).toMatchObject({ outcome: 'accepted' });
      expect(new URLSearchParams(built.provider.posts[0]!.body).get('From')).toBe(OTHER);
    });

    it.runIf(engine.available)('a service text whose opt-out line no longer fits is not sent', async () => {
      await yes(null);
      const built = await rig();
      const payload = await queue(built);
      await built.sms.setSending({ sender: { kind: 'name', value: 'Lumen' }, defaultCountry: 'DE' }, null);
      expect(await built.path.handOver(payload, attempt())).toEqual({ outcome: 'skipped', reason: 'opt-out-changed' });
    });

    it.runIf(engine.available)('a conversation\'s own line is kept as it was given', async () => {
      await yes(null);
      const built = await rig();
      const payload = await queue(built, { sender: { kind: 'number', value: FROM } });
      await built.sms.setSending({ sender: { kind: 'number', value: OTHER }, defaultCountry: 'DE' }, null);
      expect(await built.path.handOver(payload, attempt())).toMatchObject({ outcome: 'accepted' });
      expect(new URLSearchParams(built.provider.posts[0]!.body).get('From')).toBe(FROM);
    });
  });

  describe('a test text', () => {
    const gate = (policy: unknown = {}) => createSmsTestGate({ meta: handle.meta, secret: SECRET, store, policy: async () => policy, now: () => clock.now });
    const ANN = 'usr_ann';
    const own = (n: number) => `+4915123450${String(n).padStart(3, '0')}`;

    it.runIf(engine.available)('goes to the person\'s own number, and to one more a day at most', async () => {
      const take = gate();
      await take(ANN, own(1));
      await take(ANN, own(1));
      await take(ANN, own(2));
      expect(SMS_TEST_NUMBERS_PER_PERSON_DAY).toBe(2);
      await expect(take(ANN, own(3))).rejects.toMatchObject({ details: { reason: 'test-number' } });
      // Another person tests their own.
      await take('usr_bo', own(3));
      clock.now += 24 * 60 * 60 * 1000 + 1;
      await take(ANN, own(3));
    });

    it.runIf(engine.available)('is limited in meta, so a second gate (a restart, a replica) starts nothing afresh', async () => {
      for (let i = 0; i < SMS_TEST_LIMIT; i += 1) await gate()(ANN, own(1));
      await expect(gate()(ANN, own(1))).rejects.toBeInstanceOf(RateLimitedError);
      clock.now += 10 * 60 * 1000 + 1;
      await gate()(ANN, own(1));
    });

    it.runIf(engine.available)('is limited per day across the server', async () => {
      for (let i = 0; i < SMS_TEST_PER_DAY; i += 1) {
        await gate()(`usr_${String(i)}`, own(i));
        clock.now += 3 * 60 * 1000;
      }
      await expect(gate()('usr_last', own(99))).rejects.toMatchObject({ details: { reason: 'test-limit' } });
    });

    it.runIf(engine.available)('takes a slot of the day\'s text limit, and stops when the day is used', async () => {
      await gate({ dailyLimit: 2 })(ANN, own(1));
      expect(await store.usedOn('2026-06-15')).toBe(1);
      await gate({ dailyLimit: 2 })(ANN, own(1));
      await expect(gate({ dailyLimit: 2 })(ANN, own(1))).rejects.toMatchObject({ details: { reason: 'daily-limit' } });
      expect(await store.usedOn('2026-06-15')).toBe(2);
    });
  });
});
