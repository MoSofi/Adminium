// SPDX-License-Identifier: AGPL-3.0-only
/**
 * MARKETING TEXTS on every engine this run can reach: the text consent log,
 * the stop list, the deliveries and the runs on a meta store of that engine,
 * and the people on a source database of that engine, with an app installed by
 * the real installer. The send path, its `sms.send` job and the run's batch job
 * are the real ones, run by hand on the real jobs table. Only the provider is a
 * stub, written from its public documentation, so this proves the join and not
 * the live API.
 *
 * Marketing needs its own yes (never an
 * e-mail one), double opt-in where the country expects it, no found lead, no
 * country where nobody can reply STOP, no +86, no sender name, a server that
 * reads STOP, 09:00–20:00 Monday to Saturday, and the day's limit.
 */
import { SMS_WORDS_FLOOR } from '@adminium/manifest';
import { jobsRepo, rolesRepo, settingsRepo, usersRepo, type EnqueueJobInput, type MetaDb } from '@adminium/meta';
import type { Kysely } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { decryptSecret, encryptSecret } from '../src/config/secrets.js';
import { createConsentService } from '../src/consent/index.js';
import { loadSnapshotView } from '../src/data-io/snapshot-view.js';
import { seedBuiltinEmailTemplates } from '../src/email/builtins.js';
import { emailSecretKey } from '../src/email/config.js';
import { emailEnvelopeKey } from '../src/email/send.js';
import { createTextConsentService, type TextConsentService } from '../src/sms/consent/index.js';
import { createTextErasure } from '../src/sms/erasure.js';
import { createSmsService, type SmsCredentialInput } from '../src/sms/index.js';
import { createTextMarketing, createTextMarketingStore, nextDayStart, TEXT_RUN_JOB, TextRunRefusedError, type TextMarketing, type TextMarketingStore } from '../src/sms/marketing/index.js';
import { SMS_SEND_JOB_KIND, TextRetryLater, createTextSendPath, createTextSendStore, smsSendPayloadSchema, textPhoneKeys, type TextSendPath, type TextSendStore } from '../src/sms/send/index.js';
import type { InboundCore } from '../src/inbound/index.js';
import { memorySmsStore } from './helpers/sms-store.js';
import { TEST_SECRET } from './helpers.js';
import { LEGS, installInvoicing, invoicingManifest, invoicingTables, type InvoicingHarness } from './invoicing-install.helpers.js';
import { META_ENGINES, type MetaHandle } from './meta-dialects.js';
import { stubProvider } from './sms-send.helpers.js';

vi.mock('../src/version.js', async (original) => ({ ...(await original<typeof import('../src/version.js')>()), APP_VERSION: SMS_WORDS_FLOOR }));

const ACCOUNT_SID = `AC${'ab'.repeat(16)}`;
const TWILIO: SmsCredentialInput = { provider: 'twilio', accountSid: ACCOUNT_SID, authToken: 'made-up-token-for-these-tests' };
const FROM = '+14155550100';
/** Wednesday 17 June 2026, 12:00 UTC: 13:00 in London, 14:00 in Berlin. */
const WEDNESDAY = Date.parse('2026-06-17T12:00:00Z');
/** Sunday 21 June 2026, 12:00 UTC: no marketing anywhere. */
const SUNDAY = Date.parse('2026-06-21T12:00:00Z');
/** Monday 22 June 2026, 09:00 in London (BST). */
const MONDAY_LONDON = Date.parse('2026-06-22T08:00:00Z');
const WORDS = { text: 'Text me offers from Wren House. Message and data rates may apply.', version: 'v1' };
const OFFER = '{{business}}: Hi {{first_name}}, autumn stays are 15% off.';

const GB_ANNA = '+447400123451';
const GB_BEN = '+447400123452';
const GB_CARA = '+447400123453';
const DE_DORA = '+4915123456701';
const DE_EMIL = '+4915123456702';
const AE_FARAH = '+971501234567';
const CN_GUO = '+8613812345678';

const id = { ref: 'id', type: 'int', role: 'pk' };
const text = (ref: string, maxLength = 120, more: Record<string, unknown> = {}) => ({ ref, type: 'text', maxLength, nullable: true, ...more });

function staysManifest(): Record<string, unknown> {
  return {
    ...invoicingManifest([
      ...invoicingTables(),
      {
        ref: 'guests',
        columns: [id, text('name'), text('mobile', 32, { rules: { personal: true } }), text('email', 254, { rules: { personal: true } }), text('language', 8), { ref: 'news', type: 'bool', nullable: true }],
      },
    ]),
    key: 'stays',
    compatibility: { minAdminiumVersion: SMS_WORDS_FLOOR },
    people: [{ table: 'guests', kind: 'people', phone: 'mobile', email: 'email', name: 'name', language: 'language', consent: { column: 'news', purpose: 'newsletter' } }],
    textTemplates: [{ key: 'stays-autumn', name: 'Autumn stays', locales: { 'en-US': { body: OFFER }, 'de-DE': { body: '{{business}}: Hallo {{first_name}}, Herbstaufenthalte 15 % günstiger.' } } }],
  };
}

describe.each(LEGS)('marketing texts — %s', (dialect, available) => {
  const engine = META_ENGINES.find((one) => one.name === dialect)!;
  let h: InvoicingHarness;
  let handle: MetaHandle;
  let meta: MetaDb;
  let owner: string;
  let clock: { now: number };
  let consent: TextConsentService;
  let deliveries: TextSendStore;
  let store: TextMarketingStore;
  let reach: { state: string; canReceiveStop: boolean };

  const cell = (value: unknown) => (value === undefined || value === null ? 'NULL' : typeof value === 'boolean' ? (value ? (dialect === 'postgres' ? 'true' : '1') : dialect === 'postgres' ? 'false' : '0') : `'${String(value).replaceAll("'", "''")}'`);
  const guest = async (name: string, mobile: string | null, more: { email?: string; language?: string; news?: boolean } = {}): Promise<string> => {
    await h.rows(`INSERT INTO ${h.real('guests')} (name, mobile, email, language, news) VALUES (${cell(name)}, ${cell(mobile)}, ${cell(more.email ?? null)}, ${cell(more.language ?? null)}, ${cell(more.news ?? null)})`);
    return String((await h.rows(`SELECT max(id) AS id FROM ${h.real('guests')}`))[0]!['id']);
  };
  let guestsId: string;
  const person = (key: string) => ({ connectionId: h.connectionId, table: guestsId, key });
  const agree = (phone: string, key: string, at = clock.now - 60_000) =>
    consent.record({ phone, person: person(key), purpose: 'text-marketing', state: 'yes', source: 'form', detail: 'stays:guests', wording: WORDS, at });
  const audience = () => ({ connectionId: h.connectionId, table: h.real('guests') });

  beforeAll(async () => {
    if (!available) return;
    handle = await engine.make();
    meta = handle.meta;
    h = await installInvoicing(dialect, staysManifest());
    await h.meta.db.updateTable('adminium_connections').set({ timezone: 'UTC', currency: 'USD' }).where('id', '=', h.connectionId).execute();
    owner = (await usersRepo(h.meta).findByEmail('owner@test'))!.id;
    await rolesRepo(h.meta).assignToUser(owner, (await rolesRepo(h.meta).findBySlug('super-admin'))!.id);
    await seedBuiltinEmailTemplates(h.meta);
    guestsId = (await loadSnapshotView(h.meta, h.connectionId)).table(h.real('guests')).id;
  }, 180_000);

  afterAll(async () => {
    if (!available) return;
    await h.close();
    await handle.destroy();
  });

  beforeEach(async () => {
    if (!available) return;
    const db = meta.db as unknown as Kysely<Record<string, Record<string, unknown>>>;
    for (const table of ['adminium_text_deliveries', 'adminium_text_send_days', 'adminium_text_stop_list', 'adminium_text_consent_log', 'adminium_text_runs', 'adminium_text_run_recipients', 'adminium_text_confirmations', 'adminium_jobs']) await db.deleteFrom(table).execute();
    await (h.meta.db as unknown as Kysely<Record<string, Record<string, unknown>>>).deleteFrom('adminium_jobs').execute();
    await h.rows(`DELETE FROM ${h.real('guests')}`);
    await settingsRepo(h.meta).unset('system.publicOrigin');
    await settingsRepo(h.meta).unset('email.smtp');
    await settingsRepo(h.meta).set('privacy.businessName', 'Wren House', { updatedBy: null });
    clock = { now: WEDNESDAY };
    reach = { state: 'reachable', canReceiveStop: true };
    consent = createTextConsentService({ meta, secret: TEST_SECRET, now: () => clock.now });
    deliveries = createTextSendStore(meta);
    store = createTextMarketingStore(meta);
  });

  interface Wired {
    marketing: TextMarketing;
    texts: TextSendPath;
    provider: ReturnType<typeof stubProvider>;
    runJobs: () => Promise<string[]>;
  }

  async function wire(options: { sender?: 'number' | 'name'; policy?: unknown } = {}): Promise<Wired & { setSender: (kind: 'number' | 'name') => Promise<void> }> {
    const provider = stubProvider('twilio', 'unused');
    const sms = createSmsService({ store: memorySmsStore(), secret: TEST_SECRET, fetch: provider.fetchStub, now: () => clock.now, timeoutMs: 30, stopList: { isStopped: (e164) => consent.stop.has(e164, null), recordProviderOptOut: async () => undefined } });
    await sms.connect(TWILIO, null);
    const setSender = async (kind: 'number' | 'name') => {
      await sms.setSending({ sender: kind === 'number' ? { kind: 'number', value: FROM } : { kind: 'name', value: 'WrenHouse' }, defaultCountry: 'GB' }, null);
    };
    await setSender(options.sender ?? 'number');
    const enqueue = (job: EnqueueJobInput) => jobsRepo(meta).enqueue(job, clock.now);
    const late: { marketing?: TextMarketing } = {};
    const texts = createTextSendPath({
      sms,
      consent,
      store: deliveries,
      secret: TEST_SECRET,
      policy: async () => options.policy ?? {},
      repliesReachUs: async () => reach.canReceiveStop,
      operatorAllows: () => true,
      phoneKeys: textPhoneKeys(meta, TEST_SECRET),
      enqueue,
      stillWanted: (report, e164) => late.marketing!.stillWanted(report, e164),
      onSettled: (report, delivery) => late.marketing!.settled(report, delivery),
      now: () => clock.now,
    });
    const marketing = createTextMarketing({
      meta: h.meta,
      secret: TEST_SECRET,
      manager: h.manager,
      consent,
      store,
      sms,
      texts: () => texts,
      replyReach: async () => reach,
      policy: { allows: () => ({ allowed: true, reason: null }) },
      country: async () => 'GB',
      sendPolicy: async () => options.policy ?? {},
      phoneKeys: textPhoneKeys(meta, TEST_SECRET),
      enqueue,
      now: () => clock.now,
    });
    late.marketing = marketing;

    /** The worker's own moves on the real jobs table: claim what is due, run, complete or fail. */
    const runJobs = async (): Promise<string[]> => {
      const repo = jobsRepo(meta);
      const ran: string[] = [];
      for (let turn = 0; turn < 60; turn += 1) {
        const job = await repo.claim('test-worker', clock.now);
        if (job === null) return ran;
        ran.push(job.kind);
        try {
          if (job.kind === TEXT_RUN_JOB) await marketing.runs.batch(String(job.payload['runId']), { jobId: job.id, signal: new AbortController().signal });
          else if (job.kind === SMS_SEND_JOB_KIND) await texts.handOver(smsSendPayloadSchema.parse(job.payload), { attempt: job.attempts, maxAttempts: job.maxAttempts, signal: new AbortController().signal });
          await repo.complete(job.id, clock.now);
        } catch (error) {
          await repo.fail(job.id, error instanceof TextRetryLater ? error.message : String(error), clock.now);
        }
      }
      return ran;
    };
    return { marketing, texts, provider, runJobs, setSender };
  }

  const bodies = (provider: ReturnType<typeof stubProvider>) => provider.posts.map((post) => new URLSearchParams(post.body));

  it.skipIf(!available)('only a marketing yes to texts counts: an e-mail yes, a ticked newsletter column and a service yes never unlock one', async () => {
    const { marketing } = await wire();
    const anna = await guest('Anna Fry', GB_ANNA, { email: 'anna@stays.example', news: true });
    const ben = await guest('Ben Ode', GB_BEN, { email: 'ben@stays.example' });
    // Anna said yes to e-mail, her newsletter column is ticked, and she agreed to service texts. None of it is a marketing yes.
    const mail = createConsentService({ meta, secret: TEST_SECRET, now: () => clock.now });
    await mail.record({ person: person(anna), address: 'anna@stays.example', purpose: 'newsletter', state: 'yes', source: 'form', detail: 'stays:guests', wording: WORDS });
    await consent.record({ phone: GB_ANNA, person: person(anna), purpose: 'text-service', state: 'yes', source: 'form', detail: 'stays:guests', wording: WORDS });
    await agree(GB_BEN, ben);

    const preview = await marketing.runs.preview(owner, { templateKey: 'stays-autumn', audience: audience() });
    expect(preview).toMatchObject({ people: 2, canSend: 1, skipped: { 'no-consent': 1 } });
    const who = await marketing.runs.peopleFor(owner, audience(), 'no-consent', { limit: 10, offset: 0 });
    expect(who.people.map((one) => one.key)).toEqual([anna]);
    expect(who.people[0]!.masked).not.toContain('123451');
    expect((await marketing.runs.peopleFor(owner, audience(), 'ok', { limit: 10, offset: 0 })).people.map((one) => one.key)).toEqual([ben]);
  });

  it.skipIf(!available)('leaves out every country nobody can reply STOP from, mainland China, a stopped number, no number, and one number twice', async () => {
    const { marketing } = await wire();
    for (const [name, phone] of [
      ['Farah', AE_FARAH],
      ['Guo', CN_GUO],
      ['Egypt', '+201001234567'],
      ['Saudi', '+966501234567'],
      ['Taiwan', '+886912345678'],
      ['Anna', GB_ANNA],
      ['Ben', GB_BEN],
      ['Again', GB_BEN],
    ] as const) await agree(phone, await guest(name, phone));
    await guest('Nobody', null);
    await consent.stop.add({ phone: GB_ANNA, reason: 'text-stop', origin: 'twilio' });

    const preview = await marketing.runs.preview(owner, { templateKey: 'stays-autumn', audience: audience() });
    expect(preview.skipped).toEqual({ 'country-blocked-for-marketing': 4, 'country-blocked': 1, stopped: 1, 'no-phone': 1, 'same-number': 1 });
    expect(preview.canSend).toBe(1);
    expect(preview.countries.find((one) => one.country === 'AE')).toMatchObject({ people: 1, canSend: 0 });
  });

  it.skipIf(!available)('a run reaches only who agreed, as a marketing text with its STOP line, and its totals say why each was left out', async () => {
    const { marketing, provider, runJobs } = await wire();
    const anna = await guest('Anna Fry', GB_ANNA);
    await agree(GB_ANNA, anna);
    await guest('Ben Ode', GB_BEN);
    await agree(AE_FARAH, await guest('Farah', AE_FARAH));

    const run = await marketing.runs.create(owner, { name: 'Autumn', templateKey: 'stays-autumn', audience: audience() });
    expect(run.status).toBe('scheduled');
    expect(await runJobs()).toEqual([TEXT_RUN_JOB, SMS_SEND_JOB_KIND]);
    expect(bodies(provider).map((body) => [body.get('To'), body.get('Body')])).toEqual([[GB_ANNA, 'Wren House: Hi Anna, autumn stays are 15% off. Reply STOP to opt out.']]);

    const view = await marketing.runs.view((await marketing.runs.byId(run.id))!);
    expect(view.status).toBe('done');
    expect(view.totals).toMatchObject({ people: 3, sent: 1, queued: 0, skipped: { 'no-consent': 1, 'country-blocked-for-marketing': 1 } });
    const delivery = (await meta.db.selectFrom('adminium_text_deliveries').selectAll().execute())[0]!;
    expect(delivery.textClass).toBe('marketing');
    // No record of the run holds a number.
    expect(JSON.stringify(await meta.db.selectFrom('adminium_text_run_recipients').selectAll().execute())).not.toContain('7400123');
    expect(JSON.stringify(await meta.db.selectFrom('adminium_jobs').select(['payload', 'lastError']).execute())).not.toContain('7400123');

    // Her STOP afterwards counts as an opt-out from this run.
    clock.now += 60_000;
    await consent.stop.add({ phone: GB_ANNA, reason: 'text-stop', origin: 'twilio' });
    expect((await marketing.runs.totals(run.id)).optOuts).toBe(1);
    const listed = await marketing.runs.recipients(run.id, { limit: 10 });
    expect(listed.people.map((one) => one.state).sort()).toEqual(['handed', 'skipped', 'skipped']);
  });

  it.skipIf(!available)('refuses a run from a sender name, or on a server no STOP can reach, and stops a running one at its next batch', async () => {
    const named = await wire({ sender: 'name' });
    await agree(GB_ANNA, await guest('Anna Fry', GB_ANNA));
    await agree(GB_BEN, await guest('Ben Ode', GB_BEN));
    const refused = await named.marketing.runs.create(owner, { name: 'Autumn', templateKey: 'stays-autumn', audience: audience() }).catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(TextRunRefusedError);
    expect((refused as TextRunRefusedError).refusals.map((one) => one.reason)).toEqual(['marketing-from-name']);

    reach = { state: 'not-set', canReceiveStop: false };
    const doorless = await wire();
    const both = await doorless.marketing.runs.create(owner, { name: 'Autumn', templateKey: 'stays-autumn', audience: audience() }).catch((error: unknown) => error);
    expect((both as TextRunRefusedError).refusals).toEqual([{ reason: 'marketing-without-replies', detail: 'not-set' }]);
    expect((await doorless.marketing.runs.preview(owner, { templateKey: 'stays-autumn', audience: audience() })).preflight).toMatchObject({ ok: false, refusals: [{ reason: 'marketing-without-replies' }] });

    // Made while all was well; the sender turned into a name before it started.
    reach = { state: 'reachable', canReceiveStop: true };
    const wired = await wire();
    const run = await wired.marketing.runs.create(owner, { name: 'Autumn', templateKey: 'stays-autumn', audience: audience() });
    await wired.setSender('name');
    await wired.runJobs();
    expect(await wired.marketing.runs.byId(run.id)).toMatchObject({ status: 'failed', reason: 'marketing-from-name' });
    expect(wired.provider.posts).toHaveLength(0);
  });

  it.skipIf(!available)('holds a Sunday run’s texts until Monday 09:00 in the country, and a cancel stops one still waiting', async () => {
    clock.now = SUNDAY;
    const { marketing, provider, runJobs } = await wire();
    await agree(GB_ANNA, await guest('Anna Fry', GB_ANNA));
    const preview = await marketing.runs.preview(owner, { templateKey: 'stays-autumn', audience: audience() });
    expect(preview.countries).toEqual([{ country: 'GB', people: 1, canSend: 1, opensAt: MONDAY_LONDON, noWindow: false }]);

    const run = await marketing.runs.create(owner, { name: 'Autumn', templateKey: 'stays-autumn', audience: audience() });
    await runJobs();
    expect(provider.posts).toHaveLength(0);
    const held = await meta.db.selectFrom('adminium_jobs').select(['kind', 'runAt']).where('kind', '=', SMS_SEND_JOB_KIND).where('status', '=', 'pending').execute();
    expect(held.map((job) => Number(job.runAt))).toEqual([MONDAY_LONDON]);
    expect((await marketing.runs.totals(run.id)).sending).toBe(1);

    await marketing.runs.cancel(run.id, owner);
    clock.now = MONDAY_LONDON;
    await runJobs();
    expect(provider.posts).toHaveLength(0);
    expect((await meta.db.selectFrom('adminium_text_deliveries').select(['state', 'reason']).execute()).map((row) => [row.state, row.reason])).toEqual([['skipped', 'no-longer-needed']]);
    expect((await marketing.runs.totals(run.id)).skipped).toMatchObject({ 'no-longer-needed': 1 });
  });

  it.skipIf(!available)('takes no more than the day leaves, and goes on the next day', async () => {
    const policy = { dailyLimit: 2 };
    const { marketing, provider, runJobs } = await wire({ policy });
    for (const [name, phone] of [['Anna', GB_ANNA], ['Ben', GB_BEN], ['Cara', GB_CARA]] as const) await agree(phone, await guest(name, phone));
    const preview = await marketing.runs.preview(owner, { templateKey: 'stays-autumn', audience: audience() });
    expect(preview.daily).toEqual({ limit: 2, used: 0, left: 2, days: 2 });

    const run = await marketing.runs.create(owner, { name: 'Autumn', templateKey: 'stays-autumn', audience: audience() });
    await runJobs();
    expect(provider.posts).toHaveLength(2);
    const tomorrow = nextDayStart(clock.now, 'UTC');
    expect(tomorrow).toBe(Date.parse('2026-06-18T00:00:00Z'));
    expect(await marketing.runs.byId(run.id)).toMatchObject({ status: 'waiting', waitingUntil: tomorrow });

    // At midnight the window is shut: the third waits for its hours, and then goes.
    clock.now = tomorrow;
    await runJobs();
    expect(await marketing.runs.byId(run.id)).toMatchObject({ status: 'done' });
    clock.now = Date.parse('2026-06-18T08:00:00Z');
    await runJobs();
    expect(provider.posts).toHaveLength(3);
    expect((await marketing.runs.totals(run.id))).toMatchObject({ sent: 3, people: 3 });
  });

  it.skipIf(!available)('a text the hand-over refused for the day’s limit goes back in the queue for the next day', async () => {
    const { marketing } = await wire();
    const anna = await guest('Anna Fry', GB_ANNA);
    await agree(GB_ANNA, anna);
    const run = await marketing.runs.create(owner, { name: 'Autumn', templateKey: 'stays-autumn', audience: audience() });
    // The run hands her over, and the day fills up before her text goes.
    await jobsRepo(meta).claim('nobody', clock.now);
    await marketing.runs.batch(run.id, { jobId: (await marketing.runs.byId(run.id))!.jobId!, signal: new AbortController().signal });
    const [recipient] = (await marketing.runs.recipients(run.id, { limit: 5 })).people;
    expect(recipient?.state).toBe('handed');
    await marketing.settled({ app: '@adminium/text-runs', connectionId: h.connectionId, table: 'adminium_text_run_recipients', pk: { id: recipient!.id } }, { ...(await deliveries.byId(recipient!.delivery!.id))!, state: 'skipped', reason: 'daily-limit' });
    expect((await marketing.runs.recipients(run.id, { limit: 5 })).people[0]?.state).toBe('queued');
    expect(await marketing.runs.byId(run.id)).toMatchObject({ status: 'waiting', waitingUntil: nextDayStart(clock.now, 'UTC') });
  });

  it.skipIf(!available)('double opt-in: a German yes waits for its confirmation by e-mail, never by a reply, and counts once confirmed', async () => {
    const { marketing } = await wire();
    const dora = await guest('Dora Brandt', DE_DORA, { email: 'dora@stays.example', language: 'de' });
    await agree(DE_DORA, dora);
    const judged = async () => (await marketing.runs.preview(owner, { templateKey: 'stays-autumn', audience: audience() })).skipped;
    expect(await judged()).toEqual({ 'unconfirmed-consent': 1 });
    expect(await marketing.confirm.standing(person(dora))).toMatchObject({ state: 'yes', confirmed: false, needsConfirm: true, canEmail: true, country: 'DE' });

    // No public address, no mail server: nothing is sent, and the console is told which.
    expect(await marketing.confirm.request({ person: person(dora) })).toBe('no-public-origin');
    await settingsRepo(h.meta).set('system.publicOrigin', 'https://stays.example', { updatedBy: null });
    await settingsRepo(h.meta).set(
      'email.smtp',
      { host: '127.0.0.1', port: 9, user: 'postmaster', passEncrypted: encryptSecret('not-a-real-password', emailSecretKey(TEST_SECRET)), from: 'Desk <no-reply@stays.example>', secure: false },
      { updatedBy: null },
    );
    expect(await marketing.confirm.request({ person: person(dora) })).toBe('sent');
    expect(await marketing.confirm.request({ person: person(dora) })).toBe('held');

    const [job] = await h.meta.db.selectFrom('adminium_jobs').select(['payload']).where('kind', '=', 'email.send').execute();
    const payload = (typeof job!.payload === 'string' ? JSON.parse(job!.payload) : job!.payload) as { envelope: string; templateKey: string };
    expect(payload.templateKey).toBe('text-marketing-confirm');
    const mail = JSON.parse(decryptSecret(payload.envelope, emailEnvelopeKey(TEST_SECRET))) as { to: string; subject: string; text: string; html: string };
    expect(mail.to).toBe('dora@stays.example');
    expect(mail.text).not.toMatch(/\bYES\b|\bJA\b/);
    expect(mail.text).not.toContain('123456701');
    const token = /\/m\/t\/([A-Za-z0-9_~-]+)/.exec(mail.text)?.[1];
    expect(token).toBeDefined();

    // A link scanner's GET changes nothing; the button confirms once.
    expect((await marketing.confirm.read(token!)).state).toMatchObject({ state: 'waiting', phone: expect.stringMatching(/^\+49/) as unknown as string, language: 'de_DE' });
    expect(await judged()).toEqual({ 'unconfirmed-consent': 1 });
    expect(await marketing.confirm.confirmByLink(token!, { ip: '203.0.113.9', userAgent: 'Mail' })).toEqual({ state: 'done', language: 'de_DE' });
    expect((await marketing.confirm.confirmByLink(token!, { ip: null, userAgent: null })).state).toBe('already');
    expect(await judged()).toEqual({});
    const history = await consent.history({ phone: DE_DORA, person: person(dora) });
    expect(history[0]).toMatchObject({ state: 'yes', purpose: 'text-marketing', detail: 'confirmed-by-email', wording: WORDS.text, wordingVersion: WORDS.version, ip: '203.0.113.9' });
    expect(history[0]!.confirmedAt).toBe(clock.now);
    expect(history[1]).toMatchObject({ state: 'yes', confirmedAt: null });

    // A changed or tampered link confirms nobody.
    expect((await marketing.confirm.read(`${token!.slice(0, -2)}xx`)).state).toEqual({ state: 'dead' });
  });

  it.skipIf(!available)('double opt-in in person for someone with no e-mail; a STOP before the click leaves nothing to confirm', async () => {
    const { marketing } = await wire();
    const emil = await guest('Emil Roth', DE_EMIL);
    await agree(DE_EMIL, emil);
    expect(await marketing.confirm.request({ person: person(emil) })).toBe('no-email');
    const staff = { id: owner, label: 'Owner' };
    expect(await marketing.confirm.confirmInPerson({ person: person(emil), staff, how: 'in-person' })).toBe('confirmed');
    expect(await marketing.confirm.confirmInPerson({ person: person(emil), staff, how: 'in-person' })).toBe('already');
    expect((await consent.history({ phone: DE_EMIL, person: person(emil) }))[0]).toMatchObject({ source: 'staff', how: 'in-person', staffId: owner, detail: 'confirmed-in-person' });
    expect((await marketing.runs.preview(owner, { templateKey: 'stays-autumn', audience: audience() })).canSend).toBe(1);

    // Dora agreed, was mailed, and replied STOP before she clicked.
    await settingsRepo(h.meta).set('system.publicOrigin', 'https://stays.example', { updatedBy: null });
    await settingsRepo(h.meta).set('email.smtp', { host: '127.0.0.1', port: 9, user: 'postmaster', passEncrypted: encryptSecret('x', emailSecretKey(TEST_SECRET)), from: 'Desk <no-reply@stays.example>', secure: false }, { updatedBy: null });
    const dora = await guest('Dora Brandt', DE_DORA, { email: 'dora@stays.example' });
    await agree(DE_DORA, dora);
    expect(await marketing.confirm.request({ person: person(dora) })).toBe('sent');
    const [job] = await h.meta.db.selectFrom('adminium_jobs').select(['payload']).where('kind', '=', 'email.send').execute();
    const payload = (typeof job!.payload === 'string' ? JSON.parse(job!.payload) : job!.payload) as { envelope: string };
    const token = /\/m\/t\/([A-Za-z0-9_~-]+)/.exec((JSON.parse(decryptSecret(payload.envelope, emailEnvelopeKey(TEST_SECRET))) as { text: string }).text)![1]!;
    clock.now += 1_000;
    await consent.stop.add({ phone: DE_DORA, reason: 'text-stop', origin: 'twilio' });
    expect((await marketing.confirm.read(token)).state).toEqual({ state: 'withdrawn' });
    expect((await marketing.confirm.confirmByLink(token, { ip: null, userAgent: null })).state).toBe('withdrawn');
    expect(await consent.decide({ phone: DE_DORA, country: null, class: 'marketing', sender: { kind: 'number' }, repliesReachUs: true, person: person(dora) })).toEqual({ send: false, reason: 'stopped' });
  });

  it.skipIf(!available)('erasing a marketing recipient by phone takes their run rows and requests, and keeps the stop entry as a hash', async () => {
    const { marketing, runJobs } = await wire();
    const anna = await guest('Anna Fry', GB_ANNA);
    await agree(GB_ANNA, anna);
    const ben = await guest('Ben Ode', GB_BEN);
    await agree(GB_BEN, ben);
    const run = await marketing.runs.create(owner, { name: 'Autumn', templateKey: 'stays-autumn', audience: audience() });
    await runJobs();
    expect((await marketing.runs.totals(run.id)).people).toBe(2);

    const erasure = createTextErasure({
      meta,
      consent,
      inbound: { erase: async () => ({ events: 0 }), countFrom: async () => 0 } as unknown as Pick<InboundCore, 'erase' | 'countFrom'>,
      deliveries,
      phoneKeys: textPhoneKeys(meta, TEST_SECRET),
      country: async () => 'GB',
      marketing: { eraseFor: async (who) => (await store.recipients.eraseFor(who)) + (await store.confirmations.eraseFor(who)), countFor: async (who) => (await store.recipients.countFor(who)) + (await store.confirmations.countFor(who)) },
    });
    expect((await erasure.count({ phone: GB_ANNA, country: 'GB', person: null, everywhere: true })).marketing).toBe(1);
    const erased = await erasure.erase({ phone: GB_ANNA, country: 'GB', person: null, at: clock.now, everywhere: true });
    expect(erased).toMatchObject({ marketing: 1, deliveries: 1, stopEntry: 1 });
    const left = await marketing.runs.recipients(run.id, { limit: 10 });
    expect(left.people).toHaveLength(1);
    expect(left.people[0]!.name).toBe('Ben Ode');
    expect(await consent.stop.has(GB_ANNA, null)).toBe(true);
    expect((await consent.stop.entryFor(GB_ANNA, null))?.phone).toBeNull();
    // By their row alone (an erasure narrowed to some apps): the row's own run records go.
    expect((await erasure.erase({ phone: null, country: 'GB', person: person(ben), at: clock.now, everywhere: false })).marketing).toBe(1);
    expect((await marketing.runs.recipients(run.id, { limit: 10 })).people).toHaveLength(0);
  });
});
