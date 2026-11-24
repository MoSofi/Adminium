// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Marketing texts are locked in this release (`sms/marketing/availability.ts`),
 * on SQLite, Postgres and MySQL: the preflight names the lock first, a run
 * cannot be made, and recording a German yes mails no confirmation. The lock
 * is the send path's own, so no caller can miss it: an app's marketing outbox
 * kind, a rule's step with a marketing template and a text queued before the
 * lock all stop there, at prepare and again at the hand-over. The unlocked
 * behaviour is `sms-marketing-routes.test.ts`.
 */
import { SMS_WORDS_FLOOR } from '@adminium/manifest';
import { settingsRepo, type EnqueueJobInput } from '@adminium/meta';
import type { Kysely } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { textRowMark, textReasonSentence } from '../src/outbox/text-words.js';
import { createTextConsentService, type TextConsentService } from '../src/sms/consent/index.js';
import { createSmsService } from '../src/sms/index.js';
import { TEXT_MARKETING_AVAILABLE } from '../src/sms/marketing/availability.js';
import { preflight } from '../src/sms/marketing/preflight.js';
import { createTextSendPath, createTextSendStore, SMS_SEND_ATTEMPTS, textPhoneKeys, type SmsSendPayload, type TextPrepareInput } from '../src/sms/send/index.js';
import { memorySmsStore } from './helpers/sms-store.js';
import { META_ENGINES, type MetaHandle } from './meta-dialects.js';
import { LEGS, wholeServer, type Reply, type WholeServer } from './whole-server.helpers.js';
import { stubProvider } from './sms-send.helpers.js';

vi.mock('../src/version.js', async (original) => ({ ...(await original<typeof import('../src/version.js')>()), APP_VERSION: SMS_WORDS_FLOOR }));

const DE_DORA = '+4915123456701';
const WORDING = { text: 'Text me offers from Wren House.', version: 'v1' };

function app(): Record<string, unknown> {
  const id = { ref: 'id', type: 'int', role: 'pk' };
  const text = (ref: string, maxLength = 120, more: Record<string, unknown> = {}) => ({ ref, type: 'text', maxLength, nullable: true, ...more });
  return {
    kind: 'app',
    manifestVersion: 1,
    key: 'stays',
    name: 'Stays',
    version: '0.1.0',
    publisher: { id: 'adminium', name: 'Adminium', url: 'https://adminium.dev' },
    license: 'AGPL-3.0-only',
    description: { key: 'mft.stays.desc', fallback: 'A small hotel.' },
    categories: ['crm'],
    compatibility: { minAdminiumVersion: SMS_WORDS_FLOOR, engines: ['postgres', 'mysql', 'sqlite'] },
    navGroups: [{ key: 'stays', label: { 'en-US': 'Stays' }, order: 1 }],
    requiredSchema: {
      prefixed: true,
      tables: [{ ref: 'guests', keyField: 'name', columns: [id, text('name'), text('mobile', 32, { rules: { personal: true } }), text('email', 254, { rules: { personal: true } }), text('language', 8)] }],
    },
    people: [{ table: 'guests', kind: 'people', phone: 'mobile', email: 'email', name: 'name', language: 'language' }],
    textTemplates: [{ key: 'stays-autumn', name: 'Autumn stays', locales: { 'en-US': { body: '{{business}}: Hi {{first_name}}, autumn stays are 15% off.' } } }],
    pages: [{ ref: 'stays-guests', template: 'page-crud', title: { key: 't.guests', fallback: 'Guests' }, nav: { group: 'stays', icon: 'list', order: 1 }, bindings: { rows: 'guests' } }],
    frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html', routes: { stays: '/' } }],
  };
}

describe('the marketing lock', () => {
  it('is on in this release', () => {
    expect(TEXT_MARKETING_AVAILABLE).toBe(false);
  });

  it('comes first in the preflight, whatever else is right', async () => {
    const checked = await preflight({
      sms: { view: async () => ({ keyReadable: true, sender: { kind: 'number', value: '+447400000000' } }) } as never,
      replyReach: async () => ({ state: 'ready', canReceiveStop: true }),
      operator: () => ({ allowed: true }),
    });
    expect(checked.ok).toBe(false);
    expect(checked.refusals).toEqual([{ reason: 'marketing-not-yet-available', detail: null }]);
  });
});

describe.each(META_ENGINES)('the lock in the send path — $name', (engine) => {
  const SECRET = 'a-text-lock-test-secret-of-some-length';
  const DE = '+4915123456789';
  let handle: MetaHandle;
  let consent: TextConsentService;
  const clock = { now: Date.parse('2026-06-15T12:00:00Z') };

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
    for (const table of ['adminium_text_deliveries', 'adminium_text_send_days', 'adminium_text_consent_log', 'adminium_jobs']) await db.deleteFrom(table).execute();
    consent = createTextConsentService({ meta: handle.meta, secret: SECRET, now: () => clock.now });
    // A yes that would let the text go, were marketing offered: only the lock stops it.
    await consent.record({ phone: DE, purpose: 'text-marketing', state: 'yes', source: 'form', detail: 'Newsletter form', wording: { text: 'Text me offers.', version: 'v1' }, at: clock.now - 1000, confirmedAt: clock.now - 500 });
  });

  async function rig() {
    const provider = stubProvider('twilio', 'profile');
    const sms = createSmsService({ store: memorySmsStore(), secret: SECRET, fetch: provider.fetchStub, now: () => clock.now, timeoutMs: 30, stopList: { isStopped: async () => false, recordProviderOptOut: async () => undefined } });
    await sms.connect({ provider: 'twilio', accountSid: `AC${'ab'.repeat(16)}`, authToken: 'made-up-token-for-these-tests' }, null);
    await sms.setSending({ sender: { kind: 'number', value: '+14155550100' }, defaultCountry: 'DE' }, null);
    const jobs: EnqueueJobInput[] = [];
    const path = createTextSendPath({ sms, consent, store: createTextSendStore(handle.meta), secret: SECRET, policy: async () => ({}), repliesReachUs: () => true, operatorAllows: () => true, phoneKeys: textPhoneKeys(handle.meta, SECRET), enqueue: async (job) => void jobs.push(job), now: () => clock.now });
    return { path, provider, jobs };
  }
  const input = (textClass: 'service' | 'marketing'): TextPrepareInput => ({ phone: DE, textClass, template: 'Autumn stays are 15% off.', values: {}, zone: 'UTC', business: { name: 'Wren House' } });

  it.runIf(engine.available)('refuses a marketing text at prepare, whoever asks, and leaves service texts alone', async () => {
    await consent.record({ phone: DE, purpose: 'text-service', state: 'yes', source: 'form', detail: 'Booking form', wording: { text: 'Remind me by text.', version: 'v1' }, at: clock.now - 1000 });
    const built = await rig();
    expect(await built.path.prepare(input('marketing'))).toEqual({ action: 'skip', reason: 'marketing-not-yet-available' });
    expect(await built.path.prepare(input('service'))).toMatchObject({ action: 'send' });
  });

  it.runIf(engine.available)('refuses a marketing text already queued, at the hand-over', async () => {
    const built = await rig();
    // As one queued by a build without the lock would stand in the queue.
    const text = { to: DE, body: 'Autumn stays are 15% off. Reply STOP to opt out.', textClass: 'marketing' as const, timing: 'marketing' as const, country: 'DE', zone: null, notAfter: null, sender: { kind: 'number' as const, value: '+14155550100' }, accountSender: true, optOut: 'reply-stop' as const, person: null };
    const queued = await built.path.queue({ action: 'send', text, estimate: { segments: 1, encoding: 'gsm-7', units: text.body.length }, opensAt: null }, { messageKey: 'old', claimKey: 'c' });
    expect(queued.queued).toBe(true);
    const outcome = await built.path.handOver(built.jobs.at(-1)!.payload as SmsSendPayload, { attempt: 1, maxAttempts: SMS_SEND_ATTEMPTS, signal: new AbortController().signal });
    expect(outcome).toEqual({ outcome: 'skipped', reason: 'marketing-not-yet-available' });
    expect(built.provider.posts).toEqual([]);
  });

  it.runIf(engine.available)('an outbox row and a rule\'s step say why, in words of their own', async () => {
    expect(textRowMark({ state: 'skipped', reason: 'marketing-not-yet-available' })).toEqual({ mark: 'failed', error: textReasonSentence('marketing-not-yet-available') });
    expect(textReasonSentence('marketing-not-yet-available')).toBe('Not sent: marketing texts are not available in this release');
  });
});

for (const [dialect, reachable] of LEGS) {
  describe.skipIf(!reachable)(`locked marketing texts on the whole server, on ${dialect}`, () => {
    let s: WholeServer;
    let dora = '';
    const provider = stubProvider('twilio', 'unused');
    const table = () => s.t('guests');
    const data = (res: Reply) => (res.json() as { data: Record<string, unknown> }).data;

    beforeAll(async () => {
      vi.stubGlobal('fetch', provider.fetchStub);
      s = await wholeServer(dialect, app(), { smtp: true });
      await settingsRepo(s.meta).set('privacy.businessName', 'Wren House', { updatedBy: null });
      await settingsRepo(s.meta).set('system.publicOrigin', 'https://stays.example', { updatedBy: null });
      const made = await s.make('owner', 'guests', { name: 'Dora Brandt', mobile: DE_DORA, email: 'dora@stays.example', language: 'de' });
      expect(made.statusCode, made.body).toBeLessThan(300);
      dora = String((made.json() as { data: { id: unknown } }).data.id);
    }, 240_000);

    afterAll(async () => {
      await s?.close();
      vi.unstubAllGlobals();
    });

    it('the setup names the lock, and a run is refused with it', async () => {
      const setup = data(await s.get('owner', '/api/v1/sms/marketing/setup'));
      expect((setup['preflight'] as { refusals: { reason: string }[] }).refusals[0]).toEqual({ reason: 'marketing-not-yet-available', detail: null });
      const made = await s.send('owner', 'POST', '/api/v1/sms/marketing/runs', { name: 'Autumn', templateKey: 'stays-autumn', audience: { connectionId: s.connectionId, table: table() } });
      expect(made.statusCode).toBeGreaterThanOrEqual(400);
      expect(made.body).toContain('marketing-not-yet-available');
    });

    it('a German yes is kept, and no confirmation mail goes', async () => {
      const person = { connectionId: s.connectionId, table: table(), key: dora };
      const res = await s.send('owner', 'POST', '/api/v1/sms/marketing/consent', { ...person, how: 'phone', wording: WORDING });
      expect(res.statusCode, res.body).toBe(200);
      expect(data(res)).toMatchObject({ state: 'yes', confirmed: false, needsConfirm: true });
      expect(data(await s.send('owner', 'POST', '/api/v1/sms/marketing/consent/confirm-request', person))).toEqual({ outcome: 'not-yet-available' });
      await s.jobs();
      expect((await s.emails()).filter((one) => one.templateKey === 'text-marketing-confirm')).toEqual([]);
      expect(provider.posts).toEqual([]);
    });
  });
}
