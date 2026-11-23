// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE "SEND TEXT" STEP, walked by the real runner over the real send path, the
 * real consent and delivery stores and a stubbed provider, on SQLite, Postgres
 * and MySQL. What a text must never do is the point of each case: go twice,
 * go past a refusal, go with a raw placeholder, or leave the number or the
 * words in the run log.
 */
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { validateManifest, SMS_WORDS_FLOOR, type Manifest } from '@adminium/manifest';
import { AdapterRegistry, type AdapterProvider } from '@adminium/engine/adapter';
import { automationsRepo, jobsRepo, textTemplatesRepo, type Automation, type AutomationGraph, type AutomationTriggerEvent, type MetaDb } from '@adminium/meta';
import BetterSqlite3 from 'better-sqlite3';
import type { Kysely } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { installAutomations, outboundSteps } from '../src/apps/manifest-automations.js';
import { actionKinds, ruleFormat } from '../src/assistant/contexts/automation-format.js';
import { TEXT_NOT_SENT } from '../src/automations/actions/text.js';
import { walkRule, type RunOutcome } from '../src/automations/runner.js';
import { TRACE_EN } from '../src/automations/trace.js';
import { wasColumnsOf } from '../src/automations/matcher.js';
import { requiredGrants, resolveRule } from '../src/automations/validate.js';
import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import { runIntrospection } from '../src/connections/introspect.js';
import { loadSnapshotView } from '../src/data-io/snapshot-view.js';
import { ConnectionManager } from '../src/connections/manager.js';
import { registerAdapters } from '../src/connections/register-adapters.js';
import { MANIFEST_WORDS_RUN, UNBUILT_MANIFEST_WORDS, unbuiltInManifest } from '../src/crud/unbuilt-rules.js';
import { installTemplateKey } from '../src/installs/resolve.js';
import { createTextConsentService, type TextConsentService } from '../src/sms/consent/index.js';
import { createTextSendPath, createTextSendStore, SMS_SEND_ATTEMPTS, SMS_SEND_JOB_KIND, textPhoneKeys, type SmsSendPayload, type TextSendPath, type TextSendStore } from '../src/sms/send/index.js';
import { createSmsService } from '../src/sms/service.js';
import type { SmsCredentialInput } from '../src/sms/index.js';
import { TEST_SECRET } from './helpers.js';
import { memorySmsStore } from './helpers/sms-store.js';
import { META_ENGINES, type MetaHandle } from './meta-dialects.js';
import { stubProvider, type ProviderStep } from './sms-send.helpers.js';
import { LEGS, said, wholeServer, type WholeServer } from './whole-server.helpers.js';

const SECRET = TEST_SECRET;
const TWILIO: SmsCredentialInput = { provider: 'twilio', accountSid: `AC${'ab'.repeat(16)}`, authToken: 'made-up-token-for-these-tests' };
const FROM = '+14155550100';
const DE = '+4915123456789';
const CN = '+8613812345678';
const NOON = Date.parse('2026-06-15T12:00:00Z');
const LATE = Date.parse('2026-06-15T23:00:00Z');
const MORNING = Date.parse('2026-06-16T08:00:00.000Z');
const WORDS = 'Your visit is confirmed';
const attempt = () => ({ attempt: 1, maxAttempts: SMS_SEND_ATTEMPTS, signal: new AbortController().signal });

const step = (action: Record<string, unknown>, id = 'send') => ({ id, kind: 'action', title: 'Send text', onError: false, action });
const textStep = (more: Record<string, unknown> = {}) => step({ kind: 'text', templateKey: 'visit-text', to: { kind: 'field', column: 'mobile' }, ...more });
const graphOf = (...nodes: unknown[]): AutomationGraph => ({ version: 1, nodes: [{ id: 't', kind: 'trigger', title: 'When' }, ...nodes, { id: 'after', kind: 'stop', title: 'After' }] }) as AutomationGraph;

const logOf = (outcome: RunOutcome, id = 'send') => outcome.trace.steps.find((one) => one.nodeId === id);
const finished = (outcome: RunOutcome) => {
  if (outcome.kind !== 'finished') throw new Error('the run is waiting');
  return outcome;
};

describe.each(META_ENGINES)('the Send text step — $name', (engine) => {
  let handle: MetaHandle;
  let meta: MetaDb;
  let manager: ConnectionManager;
  let connectionId: string;
  let dir: string;
  let source: BetterSqlite3.Database;
  let consent: TextConsentService;
  let store: TextSendStore;
  let clock: { now: number };
  let runs = 0;

  beforeAll(async () => {
    if (!engine.available) return;
    handle = await engine.make();
    meta = handle.meta;
    dir = await mkdtemp(join(tmpdir(), 'text-step-'));
    const file = join(dir, 'source.db');
    source = new BetterSqlite3(file);
    source.exec(`
      CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT, mobile TEXT, cell TEXT, visit_at DATETIME, notes TEXT);
      CREATE TABLE orders (id INTEGER PRIMARY KEY, customer_id INTEGER REFERENCES customers(id), status TEXT);
    `);
    const registry = new AdapterRegistry<AdapterProvider>();
    await registerAdapters(registry);
    manager = new ConnectionManager({ meta, crypto: dsnCryptoFromSecret(SECRET), registry, metaDsn: null, blockLoopback: false });
    const connection = await manager.connections.create({ name: 'Source', engine: 'sqlite', introspectDsn: `sqlite:${file}`, dataDsn: `sqlite:${file}` });
    connectionId = connection.id;
    await runIntrospection({ manager, meta, connectionId });
    // The business's clock: the sending hours below are read on it.
    await meta.db.updateTable('adminium_connections').set({ timezone: 'UTC' }).where('id', '=', connectionId).execute();
  }, 120_000);

  afterAll(async () => {
    if (!engine.available) return;
    await manager.disposeAll().catch(() => undefined);
    source.close();
    await rm(dir, { recursive: true, force: true });
    await handle.destroy();
  });

  beforeEach(async () => {
    if (!engine.available) return;
    const db = meta.db as unknown as Kysely<Record<string, Record<string, unknown>>>;
    for (const table of ['adminium_text_deliveries', 'adminium_text_send_days', 'adminium_text_stop_list', 'adminium_text_consent_log', 'adminium_jobs', 'adminium_text_templates']) await db.deleteFrom(table).execute();
    source.exec(`DELETE FROM orders; DELETE FROM customers;
      INSERT INTO customers (id, name, mobile, cell, notes) VALUES (1, 'Ada', '${DE}', '${DE}', 'plain');
      INSERT INTO customers (id, name, mobile) VALUES (2, 'Bo', '${CN}');
      INSERT INTO customers (id, name, mobile) VALUES (3, NULL, '${DE}');
      INSERT INTO customers (id, name, mobile) VALUES (4, 'Cy', NULL);
      INSERT INTO orders (id, customer_id, status) VALUES (9, 1, 'ready');`);
    clock = { now: NOON };
    consent = createTextConsentService({ meta, secret: SECRET, now: () => clock.now });
    store = createTextSendStore(meta);
    await template(`${WORDS}, {{name}}.`);
  });

  const template = (body: string, key = 'visit-text', enabled = true) => textTemplatesRepo(meta).upsert(key, 'en_US', { name: 'Visit', body, enabled });
  const agree = (phone = DE) => consent.record({ phone, purpose: 'text-service', state: 'yes', source: 'form', detail: 'Booking form', wording: { text: 'Text me about my visits.', version: 'v1' }, at: clock.now - 1000 });

  async function wire(options: { script?: ProviderStep[]; policy?: unknown; connected?: boolean } = {}) {
    const provider = stubProvider('twilio', 'profile', options.script ?? []);
    const sms = createSmsService({ store: memorySmsStore(), secret: SECRET, fetch: provider.fetchStub, now: () => clock.now, timeoutMs: 30, stopList: { isStopped: (e164) => consent.stop.has(e164, null), recordProviderOptOut: async () => undefined } });
    if (options.connected !== false) {
      await sms.connect(TWILIO, null);
      await sms.setSending({ sender: { kind: 'number', value: FROM }, defaultCountry: 'DE' }, null);
    }
    const texts: TextSendPath = createTextSendPath({
      sms,
      consent,
      store,
      secret: SECRET,
      policy: async () => options.policy ?? {},
      repliesReachUs: async () => true,
      operatorAllows: () => true,
      phoneKeys: textPhoneKeys(meta, SECRET),
      enqueue: (job) => jobsRepo(meta).enqueue(job, clock.now),
      now: () => clock.now,
    });
    return { texts, provider };
  }

  const ruleOf = (graph: AutomationGraph): Promise<Automation> =>
    automationsRepo(meta).create({ connectionId, name: 'Text them', trigger: { kind: 'record', event: 'created', connectionId, table: 'main.customers', watch: false }, graph, enabled: true, createdBy: null } as never, clock.now);

  const eventFor = (id: number, label = `Customer ${String(id)}`): AutomationTriggerEvent => ({ event: 'record.created', origin: 'dashboard', ruleId: null, hops: 0, record: { connectionId, table: 'main.customers', pk: { id }, label }, snapshot: null, occurredAt: clock.now }) as AutomationTriggerEvent;

  const walk = (rule: Automation, id = 1, given: { texts?: Pick<TextSendPath, 'prepare' | 'queue'>; runId?: string; dryRun?: boolean; label?: string } = {}) => {
    const opts = { ...given, path: given.texts };
    runs += 1;
    return walkRule(
      { meta, manager, secret: SECRET, now: () => clock.now, ...(opts.path === undefined ? {} : { texts: () => opts.path }) },
      { rule, runId: opts.runId ?? `run_${String(runs)}`, event: eventFor(id, opts.label), ...(opts.dryRun === true ? { dryRun: true } : {}) },
    );
  };

  const smsJobs = async () => {
    const rows = await meta.db.selectFrom('adminium_jobs').select(['id', 'payload', 'runAt', 'kind']).where('kind', '=', SMS_SEND_JOB_KIND).execute();
    return rows.map((row) => ({ ...row, payload: (typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload) as SmsSendPayload }));
  };
  const deliveries = () => meta.db.selectFrom('adminium_text_deliveries').selectAll().execute();

  describe('sending', () => {
    it.runIf(engine.available)('queues one text through the real send path, and the provider gets it', async () => {
      await agree();
      const { texts, provider } = await wire();
      const outcome = finished(await walk(await ruleOf(graphOf(textStep())), 1, { texts }));
      expect(outcome.status).toBe('succeeded');
      expect(logOf(outcome)).toMatchObject({ status: 'ok', log: 'Text queued for +49 ••• 789' });
      expect(provider.posts).toHaveLength(0);
      const [job] = await smsJobs();
      await texts.handOver(job!.payload, attempt());
      expect(provider.posts).toHaveLength(1);
      const sent = new URLSearchParams(provider.posts[0]!.body);
      expect(sent.get('To')).toBe(DE);
      expect(sent.get('Body')).toContain(`${WORDS}, Ada.`);
    });

    it.runIf(engine.available)('reads the number from a linked row, and the consent of that row', async () => {
      await agree();
      const { texts } = await wire();
      const rule = await automationsRepo(meta).create({ connectionId, name: 'Order', trigger: { kind: 'record', event: 'created', connectionId, table: 'main.orders', watch: false }, graph: graphOf(step({ kind: 'text', templateKey: 'visit-text', to: { kind: 'field', column: 'customer_id.mobile' }, vars: { name: '{{customer_id.name}}' } })), enabled: true, createdBy: null } as never, clock.now);
      const event: AutomationTriggerEvent = { ...eventFor(9), record: { connectionId, table: 'main.orders', pk: { id: 9 }, label: 'Order 9' } } as AutomationTriggerEvent;
      const outcome = finished(await walkRule({ meta, manager, secret: SECRET, now: () => clock.now, texts: () => texts }, { rule, runId: 'run_linked', event }));
      expect(logOf(outcome)).toMatchObject({ status: 'ok', log: 'Text queued for +49 ••• 789' });
      expect(await smsJobs()).toHaveLength(1);
    });

    it.runIf(engine.available)('holds across a shut window in the queue, and writes nothing to the row', async () => {
      clock.now = LATE;
      await agree();
      const { texts, provider } = await wire();
      const before = source.prepare('SELECT * FROM customers WHERE id = 1').get();
      const outcome = finished(await walk(await ruleOf(graphOf(textStep())), 1, { texts }));
      expect(logOf(outcome)).toMatchObject({ status: 'ok', log: `Text held for +49 ••• 789 until ${new Date(MORNING).toISOString()}: outside the sending hours` });
      const [job] = await smsJobs();
      expect(Number(job!.runAt)).toBe(MORNING);
      expect(provider.posts).toHaveLength(0);
      expect(source.prepare('SELECT * FROM customers WHERE id = 1').get()).toEqual(before);
    });

    it.runIf(engine.available)('skips a text the window would hold past the moment it is about', async () => {
      clock.now = LATE;
      await agree();
      source.prepare('UPDATE customers SET visit_at = ? WHERE id = 1').run('2026-06-16T07:00:00.000Z');
      const { texts } = await wire();
      const outcome = finished(await walk(await ruleOf(graphOf(textStep({ notAfter: 'visit_at' }))), 1, { texts }));
      expect(logOf(outcome)).toMatchObject({ status: 'skip' });
      expect(logOf(outcome)?.log).toContain('past-its-moment');
      expect(await smsJobs()).toHaveLength(0);
    });
  });

  describe('never twice', () => {
    it.runIf(engine.available)('walking the same run and step again makes no second delivery or job', async () => {
      await agree();
      const { texts, provider } = await wire();
      const rule = await ruleOf(graphOf(textStep()));
      await walk(rule, 1, { texts, runId: 'run_same' });
      await walk(rule, 1, { texts, runId: 'run_same' });
      expect(await deliveries()).toHaveLength(1);
      const jobs = await smsJobs();
      expect(jobs).toHaveLength(1);
      await texts.handOver(jobs[0]!.payload, attempt());
      await walk(rule, 1, { texts, runId: 'run_same' });
      expect(await deliveries()).toHaveLength(1);
      expect(await smsJobs()).toHaveLength(1);
      expect(provider.posts).toHaveLength(1);
    });

    it.runIf(engine.available)('two steps of one run are two messages', async () => {
      await agree();
      const { texts } = await wire();
      await walk(await ruleOf(graphOf(textStep(), step({ kind: 'text', templateKey: 'visit-text', to: { kind: 'field', column: 'mobile' } }, 'second'))), 1, { texts });
      expect(await deliveries()).toHaveLength(2);
    });

    it.runIf(engine.available)('a provider timeout is never resent, also when the run is walked again', async () => {
      await agree();
      const { texts, provider } = await wire({ script: ['hang'] });
      const rule = await ruleOf(graphOf(textStep()));
      await walk(rule, 1, { texts, runId: 'run_timeout' });
      const [job] = await smsJobs();
      expect(await texts.handOver(job!.payload, attempt())).toMatchObject({ outcome: 'unknown' });
      expect(provider.posts).toHaveLength(1);
      await walk(rule, 1, { texts, runId: 'run_timeout' });
      await texts.handOver(job!.payload, attempt());
      expect(provider.posts).toHaveLength(1);
      expect(await deliveries()).toHaveLength(1);
      expect((await deliveries())[0]).toMatchObject({ state: 'unknown' });
    });
  });

  describe('a refusal is a skipped step, and the run goes on', () => {
    const refused = async (rule: Automation, id: number, reason: string, texts: TextSendPath) => {
      const outcome = finished(await walk(rule, id, { texts }));
      expect(outcome.status).toBe('succeeded');
      expect(outcome.error).toBeNull();
      expect(logOf(outcome)).toMatchObject({ status: 'skip' });
      expect(logOf(outcome)?.log).toContain(`(${reason})`);
      expect(logOf(outcome, 'after')).toMatchObject({ status: 'ok' });
    };

    it.runIf(engine.available)('nobody agreed', async () => {
      const { texts, provider } = await wire();
      await refused(await ruleOf(graphOf(textStep())), 1, 'no-consent', texts);
      expect(await smsJobs()).toHaveLength(0);
      expect(provider.posts).toHaveLength(0);
    });

    it.runIf(engine.available)('the number is on the stop list', async () => {
      await agree();
      await consent.stop.add({ phone: DE, reason: 'text-stop', origin: 'test' });
      const { texts } = await wire();
      await refused(await ruleOf(graphOf(textStep())), 1, 'stopped', texts);
      expect(await smsJobs()).toHaveLength(0);
    });

    it.runIf(engine.available)('+86', async () => {
      await agree(CN);
      const { texts } = await wire();
      await refused(await ruleOf(graphOf(textStep())), 2, 'country-blocked', texts);
      expect(await smsJobs()).toHaveLength(0);
    });

    it.runIf(engine.available)('the daily limit is used', async () => {
      await agree();
      const { texts } = await wire({ policy: { dailyLimit: 1 } });
      const rule = await ruleOf(graphOf(textStep()));
      await walk(rule, 1, { texts });
      const [job] = await smsJobs();
      await texts.handOver(job!.payload, attempt());
      await refused(rule, 1, 'daily-limit', texts);
      expect(await smsJobs()).toHaveLength(1);
    });

    it.runIf(engine.available)('no provider is connected, and a server with no send path says the same', async () => {
      const { texts } = await wire({ connected: false });
      const rule = await ruleOf(graphOf(textStep()));
      await refused(rule, 1, 'not-connected', texts);
      const bare = finished(await walk(rule, 1));
      expect(bare.status).toBe('succeeded');
      expect(logOf(bare)?.log).toContain('(not-connected)');
    });

    it.runIf(engine.available)('a row with no number', async () => {
      const { texts } = await wire();
      const outcome = finished(await walk(await ruleOf(graphOf(textStep())), 4, { texts }));
      expect(outcome.status).toBe('succeeded');
      expect(logOf(outcome)).toMatchObject({ status: 'skip', log: 'No recipient: mobile is empty' });
    });
  });

  describe('what a template may say', () => {
    it.runIf(engine.available)('an unfilled placeholder is refused, never sent', async () => {
      await agree();
      await template(`${WORDS}, {{nickname}}.`);
      const { texts, provider } = await wire();
      const outcome = finished(await walk(await ruleOf(graphOf(textStep())), 1, { texts }));
      expect(logOf(outcome)?.log).toContain('(unfilled-placeholder)');
      expect(await smsJobs()).toHaveLength(0);
      expect(provider.posts).toHaveLength(0);
    });

    it.runIf(engine.available)('a column that is empty on this row counts as unfilled', async () => {
      await agree();
      const { texts } = await wire();
      const outcome = finished(await walk(await ruleOf(graphOf(textStep())), 3, { texts }));
      expect(logOf(outcome)?.log).toContain('(unfilled-placeholder)');
      expect(await smsJobs()).toHaveLength(0);
    });

    it.runIf(engine.available).each(['Sign in: {{signInLink}}', 'Tell us: {{survey_link}}', 'Your code {{code}}', 'Scan {{qr_code}}'])('refuses a credential: %s', async (body) => {
      await agree();
      await template(body);
      const { texts } = await wire();
      const outcome = finished(await walk(await ruleOf(graphOf(textStep({ vars: { signInLink: 'x', survey_link: 'x', code: 'x', qr_code: 'x' } }))), 1, { texts }));
      expect(logOf(outcome)?.log).toContain('(credential-in-template)');
      expect(await smsJobs()).toHaveLength(0);
    });

    it.runIf(engine.available)('a step that names a missing template fails by name, and the worker is fine', async () => {
      await agree();
      const { texts } = await wire();
      const outcome = finished(await walk(await ruleOf(graphOf(textStep({ templateKey: 'no-such-text' }))), 1, { texts }));
      expect(outcome.status).toBe('failed');
      expect(outcome.error).toBe('Text template no-such-text no longer exists.');
      expect(logOf(outcome)).toMatchObject({ status: 'fail' });
      expect(await smsJobs()).toHaveLength(0);
    });

    it.runIf(engine.available)('a switched-off template fails by name', async () => {
      await template('Hello', 'off-text', false);
      const { texts } = await wire();
      const outcome = finished(await walk(await ruleOf(graphOf(textStep({ templateKey: 'off-text' }))), 1, { texts }));
      expect(outcome.error).toBe('Text template off-text is switched off.');
    });
  });

  describe('the run log', () => {
    it.runIf(engine.available)('never holds the number or a word of the message', async () => {
      await agree();
      const { texts } = await wire();
      const outcome = finished(await walk(await ruleOf(graphOf(textStep())), 1, { texts }));
      const written = JSON.stringify(outcome.trace);
      for (const held of [DE, DE.slice(1), '15123456789', WORDS]) expect(written).not.toContain(held);
    });

    it.runIf(engine.available)('leaves a number out of the first line, in a column no classifier calls personal, and as the record label', async () => {
      await agree();
      const { texts } = await wire();
      const rule = await ruleOf(graphOf(textStep({ to: { kind: 'field', column: 'cell' } })));
      const outcome = finished(await walk(rule, 1, { texts, label: `Customer ${DE}` }));
      expect(logOf(outcome, 't')?.log).toBeDefined();
      expect(JSON.stringify(outcome.trace)).not.toContain(DE.slice(1));
    });

    it.runIf(engine.available)('never quotes an error from the send path', async () => {
      const broken = { prepare: async () => { throw new Error(`could not read ${DE}`); }, queue: async () => { throw new Error(`could not queue ${DE}`); } };
      const outcome = finished(await walk(await ruleOf(graphOf(textStep())), 1, { texts: broken as never }));
      expect(outcome.status).toBe('failed');
      expect(outcome.error).toBe('The text could not be checked, so it was not sent.');
      expect(JSON.stringify(outcome.trace)).not.toContain(DE.slice(1));
    });

    it.runIf(engine.available)('a queue that throws says so, without the error', async () => {
      await agree();
      const { texts } = await wire();
      const broken = { prepare: texts.prepare, queue: async () => { throw new Error(`could not queue ${DE}`); } };
      const outcome = finished(await walk(await ruleOf(graphOf(textStep())), 1, { texts: broken as never }));
      expect(outcome.error).toBe('The text could not be queued, so it was not sent.');
      expect(JSON.stringify(outcome.trace)).not.toContain(DE.slice(1));
    });
  });

  describe('the Test button', () => {
    it.runIf(engine.available)('says what would go, and queues nothing', async () => {
      await agree();
      const { texts, provider } = await wire();
      const outcome = finished(await walk(await ruleOf(graphOf(textStep())), 1, { texts, dryRun: true }));
      expect(logOf(outcome)).toMatchObject({ status: 'ok', log: 'Would send a text to +49 ••• 789' });
      expect(await deliveries()).toHaveLength(0);
      expect(await smsJobs()).toHaveLength(0);
      expect(provider.posts).toHaveLength(0);
    });

    it.runIf(engine.available)('says when it would be held, and says a refusal', async () => {
      clock.now = LATE;
      await agree();
      const { texts } = await wire();
      const held = finished(await walk(await ruleOf(graphOf(textStep())), 1, { texts, dryRun: true }));
      expect(logOf(held)?.log).toBe(`Would hold a text for +49 ••• 789 until ${new Date(MORNING).toISOString()}: outside the sending hours`);
      const refused = finished(await walk(await ruleOf(graphOf(textStep())), 2, { texts, dryRun: true }));
      expect(logOf(refused)).toMatchObject({ status: 'skip' });
      expect(await deliveries()).toHaveLength(0);
    });
  });

  describe('saving a rule', () => {
    const check = async (graph: AutomationGraph) => {
      const view = await loadSnapshotView(meta, connectionId);
      const textTemplateKeys = new Set(await textTemplatesRepo(meta).liveKeys());
      return () => resolveRule({ kind: 'record', event: 'created', connectionId, table: 'main.customers', watch: false } as never, graph, { view, templateKeys: new Set(), textTemplateKeys, blockLoopback: false });
    };

    it.runIf(engine.available)('takes a whole step', async () => {
      const run = await check(graphOf(textStep({ notAfter: 'visit_at' })));
      expect(run()).not.toBeNull();
    });

    it.runIf(engine.available)('refuses a template that is not installed', async () => {
      const run = await check(graphOf(textStep({ templateKey: 'no-such-text' })));
      expect(run).toThrow(/no live text template with the key no-such-text/);
    });

    it.runIf(engine.available)('refuses a column that is not there', async () => {
      const run = await check(graphOf(textStep({ to: { kind: 'field', column: 'nope' } })));
      expect(run).toThrow(/has no column nope/);
    });

    it.runIf(engine.available)('lets a linked row\'s personal column fill the text, and asks the author to read that table', async () => {
      const view = await loadSnapshotView(meta, connectionId);
      const trigger = { kind: 'record', event: 'created', connectionId, table: 'main.orders', watch: false } as never;
      const graph = graphOf(step({ kind: 'text', templateKey: 'visit-text', to: { kind: 'field', column: 'customer_id.mobile' }, vars: { name: '{{customer_id.mobile}}' } }));
      expect(view.table('main.customers').columns.get('mobile')?.masked).toBe(true);
      expect(() => resolveRule(trigger, graph, { view, templateKeys: new Set(), textTemplateKeys: new Set(['visit-text']), blockLoopback: false })).not.toThrow();
      const toOnly = graphOf(step({ kind: 'text', templateKey: 'visit-text', to: { kind: 'field', column: 'customer_id.mobile' } }));
      expect(requiredGrants(trigger, toOnly, connectionId, view).map((one) => one.permission)).toContain(`table:${connectionId}:main.customers:read`);
    });

    it.runIf(engine.available)('keeps the column a text template reads as it was', async () => {
      await template('It was {{was.notes}}.');
      const rule = await ruleOf(graphOf(textStep()));
      expect([...(await wasColumnsOf(meta, rule))]).toContain('notes');
    });

    it.runIf(engine.available)('a second install of an app sends its own copy of the template', async () => {
      const checked = validateManifest(shipped(step1()), { allowLocalPublisher: true });
      if (!checked.ok) throw new Error(JSON.stringify(checked.issues));
      const install = { id: 'mfs_second', key: 'clinic', slug: 'second' };
      await installAutomations({ meta, manifest: checked.manifest, install: install as never, connectionId, view: await loadSnapshotView(meta, connectionId), realId: () => 'main.customers', sampleTables: new Set() });
      const [stored] = await automationsRepo(meta).listManagedBy('clinic', connectionId);
      const node = stored!.graph.nodes.find((one) => one.kind === 'action');
      expect(node?.kind === 'action' ? node.action : null).toMatchObject({ kind: 'text', templateKey: installTemplateKey('clinic-reminder-text', install) });
      await automationsRepo(meta).remove(stored!.id);
    });

    it.runIf(engine.available)('refuses a moment that is not a date and time', async () => {
      const run = await check(graphOf(textStep({ notAfter: 'notes' })));
      expect(run).toThrow(/holds no date and time/);
    });
  });
});

// ── as a role that may author it, and one that may not ──────────────────────

const id = { ref: 'id', type: 'int', role: 'pk' };
const en = (text: string) => ({ 'en-US': text });

function salon(): Record<string, unknown> {
  return {
    kind: 'app',
    manifestVersion: 1,
    key: 'salon',
    name: 'Salon',
    version: '0.1.0',
    publisher: { id: 'adminium', name: 'Adminium', url: 'https://adminium.dev' },
    license: 'AGPL-3.0-only',
    description: { key: 'mft.salon.desc', fallback: 'A salon.' },
    categories: ['operations'],
    compatibility: { minAdminiumVersion: '0.3.28', engines: ['postgres', 'mysql', 'sqlite'] },
    navGroups: [{ key: 'work', label: en('Work'), order: 1 }],
    requiredSchema: {
      prefixed: true,
      tables: [{ ref: 'clients', columns: [id, { ref: 'name', type: 'text', maxLength: 80 }, { ref: 'mobile', type: 'text', maxLength: 32, nullable: true, rules: { personal: true } }, { ref: 'pin', type: 'text', maxLength: 16, nullable: true, rules: { code: { length: 8 } } }] }],
    },
    roles: [
      { key: 'desk', name: 'Desk', permissions: ['table:@clients:read', 'page:@salon-clients:view'] },
      { key: 'clerk', name: 'Clerk', permissions: ['table:@clients:read', 'page:@salon-clients:view'], limits: { clients: { readable: ['id', 'name'] } } },
    ],
    pages: [{ ref: 'salon-clients', template: 'page-crud', title: { key: 't.clients', fallback: 'Clients' }, nav: { group: 'work', icon: 'list', order: 1 }, bindings: { rows: 'clients' } }],
    sampleData: { file: 'seeds/salon.sample.json' },
    frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html', routes: { desk: '/' } }],
  };
}

const SALON_SAMPLE = { format: 'adminium.sample/1', app: 'salon', tables: [{ ref: 'clients', rows: [{ name: 'Sample Sue', mobile: DE }] }] };

for (const [dialect, reachable] of LEGS) {
  describe.skipIf(!reachable)(`who may author a text step, on ${dialect}`, () => {
    let s: WholeServer;
    const body = (name: string, column = 'mobile') => ({
      name,
      connectionId: s.connectionId,
      trigger: { kind: 'record', connectionId: s.connectionId, table: s.t('clients'), event: 'created', watch: false, when: [] },
      graph: { version: 1, nodes: [{ id: 't', kind: 'trigger', title: 'T' }, { id: 'send', kind: 'action', title: 'Send text', action: { kind: 'text', templateKey: 'salon-visit', to: { kind: 'field', column } } }] },
      enabled: false,
    });
    const grantRules = async (who: string, slug: string, tables: string[] = []) => {
      const { rolesRepo, permissionsRepo } = await import('@adminium/meta');
      const { matrixRowsFromGrants } = await import('../src/rbac/permissions.js');
      const own = await rolesRepo(s.meta).create({ slug, name: slug });
      for (const row of matrixRowsFromGrants([...tables.map((table) => `table:${s.connectionId}:${s.t(table)}:read`), 'system:automations:manage']).rows) await permissionsRepo(s.meta).grant(own.id, row.resourceKind, row.resourceRef, row.actions as never);
      await rolesRepo(s.meta).assignToUser(s.ids[who]!, own.id);
    };

    beforeAll(async () => {
      s = await wholeServer(dialect, salon(), { people: { ann: ['desk'], cleo: ['clerk'], reed: ['desk'] }, files: { 'seeds/salon.sample.json': JSON.stringify(SALON_SAMPLE) } });
      await textTemplatesRepo(s.meta).upsert('salon-visit', 'en_US', { name: 'Visit', body: 'See you soon, {{name}}.', enabled: true });
      await grantRules('ann', 'rule-author', ['clients']);
      // Cleo reads the clients through her clerk role, which is not shown their mobile.
      await grantRules('cleo', 'rule-author-limited');
    }, 180_000);
    afterAll(async () => {
      await s?.close();
    });

    it('a role with the automations permission may save the step, and reads it back', async () => {
      const saved = await s.send('ann', 'POST', '/api/v1/automations', body('By Ann'));
      expect(said(saved), saved.body).toBe('ok');
      const ruleId = (saved.json() as { id: string }).id;
      const read = await s.get('ann', `/api/v1/automations/${ruleId}`);
      const nodes = (read.json() as { graph: { nodes: { action?: { kind: string; templateKey?: string } }[] } }).graph.nodes;
      expect(nodes[1]?.action).toMatchObject({ kind: 'text', templateKey: 'salon-visit' });
    });

    it('a role without it may not', async () => {
      const refused = await s.send('reed', 'POST', '/api/v1/automations', body('By Reed'));
      expect(refused.statusCode).toBe(403);
    });

    it('an author whose role is not shown the number column may not send to it', async () => {
      const refused = await s.send('cleo', 'POST', '/api/v1/automations', body('By Cleo'));
      expect(refused.statusCode).toBe(422);
      expect(refused.body).toContain('not a column your role is shown');
    });

    it('a template that is not installed is refused at the save', async () => {
      const refused = await s.send('ann', 'POST', '/api/v1/automations', { ...body('Wrong key'), graph: { version: 1, nodes: [{ id: 't', kind: 'trigger', title: 'T' }, { id: 'send', kind: 'action', title: 'Send text', action: { kind: 'text', templateKey: 'nope', to: { kind: 'field', column: 'mobile' } } }] } });
      expect(refused.statusCode).toBe(422);
    });

    it('a sample row is never texted, and a declared code column is refused', async () => {
      const added = await s.send('owner', 'POST', '/api/v1/apps/salon/sample-data', {});
      expect(said(added), added.body).toBe('ok');
      await s.jobs();
      const [row] = await s.rows(`SELECT id FROM salon_clients WHERE name = 'Sample Sue'`);
      const asked: unknown[] = [];
      const counting = { prepare: async (input: unknown) => { asked.push(input); return { action: 'skip', reason: 'no-consent' } as const; }, queue: async () => ({ queued: false, reason: 'could-not-queue' }) as const };
      const rule = await automationsRepo(s.meta).create({ connectionId: s.connectionId, name: 'Sample', trigger: { kind: 'record', event: 'created', connectionId: s.connectionId, table: s.t('clients'), watch: false }, graph: { version: 1, nodes: [{ id: 't', kind: 'trigger', title: 'T' }, { id: 'send', kind: 'action', title: 'Send text', onError: false, action: { kind: 'text', templateKey: 'salon-visit', to: { kind: 'field', column: 'mobile' }, vars: {} } }] }, enabled: true, createdBy: null } as never);
      const event = { event: 'record.created', origin: 'dashboard', ruleId: null, hops: 0, record: { connectionId: s.connectionId, table: s.t('clients'), pk: { id: Number(row!['id']) }, label: 'Sample Sue' }, snapshot: null, occurredAt: Date.now() } as AutomationTriggerEvent;
      const outcome = finished(await walkRule({ meta: s.meta, manager: s.manager, secret: TEST_SECRET, texts: () => counting as never }, { rule, runId: 'run_sample', event }));
      expect(asked).toHaveLength(0);
      expect(logOf(outcome)).toMatchObject({ status: 'skip', log: 'No text sent: this is a sample row' });

      // A real row, and a template that reads the declared code column under a name no check would guess.
      await textTemplatesRepo(s.meta).upsert('salon-code', 'en_US', { name: 'Code', body: 'Yours: {{pin}}', enabled: true });
      expect(said(await s.make('owner', 'clients', { name: 'Real Rae', mobile: DE }))).toBe('ok');
      const [real] = await s.rows(`SELECT id FROM salon_clients WHERE name = 'Real Rae'`);
      const seen: { codeNames?: readonly string[] }[] = [];
      const path = { prepare: async (input: { codeNames?: readonly string[] }) => { seen.push(input); return { action: 'skip', reason: 'credential-in-template' } as const; }, queue: counting.queue };
      const coded = await automationsRepo(s.meta).create({ connectionId: s.connectionId, name: 'Coded', trigger: { kind: 'record', event: 'created', connectionId: s.connectionId, table: s.t('clients'), watch: false }, graph: { version: 1, nodes: [{ id: 't', kind: 'trigger', title: 'T' }, { id: 'send', kind: 'action', title: 'Send text', onError: false, action: { kind: 'text', templateKey: 'salon-code', to: { kind: 'field', column: 'mobile' }, vars: {} } }] }, enabled: true, createdBy: null } as never);
      await walkRule({ meta: s.meta, manager: s.manager, secret: TEST_SECRET, texts: () => path as never }, { rule: coded, runId: 'run_coded', event: { ...event, record: { ...event.record!, pk: { id: Number(real!['id']) }, label: 'Real Rae' } } });
      expect(seen[0]?.codeNames).toEqual(['pin']);
    });
  });
}

// ── what a manifest may say, and what an older server does with it ──────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- a loose fixture, changed by path in each case
type Doc = Record<string, any>;

const shipped = (action: Doc, more: Doc = {}): Doc => ({
  manifestVersion: 1,
  publisher: { id: 'adminium', name: 'Adminium' },
  license: 'MIT',
  description: { key: 'd', fallback: 'd' },
  kind: 'app',
  key: 'clinic',
  name: 'Clinic',
  version: '1.0.0',
  categories: ['operations'],
  compatibility: { minAdminiumVersion: SMS_WORDS_FLOOR },
  pages: [{ ref: 'patients', template: 'page-crud', title: { key: 't', fallback: 'Patients' }, nav: { group: 'manage', icon: 'list', order: 1 }, bindings: { main: 'patients' } }],
  frontends: [{ side: 'staff', kind: 'none' }],
  requiredSchema: { prefixed: true, tables: [{ ref: 'patients', keyField: 'name', columns: [{ ref: 'id', type: 'int', role: 'pk' }, { ref: 'name', type: 'text', maxLength: 80 }, { ref: 'mobile', type: 'text', maxLength: 32, nullable: true }, { ref: 'visit_at', type: 'timestamptz', nullable: true }, { ref: 'visit_day', type: 'date', nullable: true }] }] },
  textTemplates: [{ key: 'clinic-reminder-text', name: 'Reminder', locales: { 'en-US': { body: 'See you soon, {{name}}. Reply STOP to opt out.' } } }],
  automations: [{ key: 'remind', name: 'Remind', enabled: true, trigger: { kind: 'record', event: 'created', table: 'patients' }, graph: { version: 1, nodes: [{ id: 't', kind: 'trigger', title: 'When' }, { id: 'send', kind: 'action', title: 'Send', action }] } }],
  ...more,
});
const step1 = (more: Doc = {}): Doc => ({ kind: 'text', templateKey: 'clinic-reminder-text', to: { kind: 'field', column: 'mobile' }, ...more });
const problems = (doc: Doc): string => {
  const checked = validateManifest(doc, { allowLocalPublisher: true });
  return checked.ok ? '' : JSON.stringify(checked.issues);
};

describe('the assistant', () => {
  it('is not told of the step, so a draft cannot guess at a template', () => {
    expect(actionKinds()).not.toContain('text');
    expect(ruleFormat()).not.toContain('{ kind: "text"');
    expect(ruleFormat()).not.toContain('notAfter');
  });
});

describe('the run log\'s words', () => {
  const catalogue = JSON.parse(readFileSync(new URL('../../../packages/i18n/locales/en-US/automations.json', import.meta.url), 'utf8')).trace.text as { queued: string; held: string; would: string; wouldHold: string; notSent: string; reason: Record<string, string> };

  it('are the catalogue\'s, each of them', () => {
    const known = new Set(Object.values(catalogue.reason));
    for (const sentence of Object.values(TEXT_NOT_SENT)) expect(known.has(sentence), sentence).toBe(true);
    expect(TRACE_EN.textQueued('X')).toBe(catalogue.queued.replace('{to}', 'X'));
    expect(TRACE_EN.textHeld('X', 'Y')).toBe(catalogue.held.replace('{to}', 'X').replace('{at}', 'Y'));
    expect(TRACE_EN.textWould('X')).toBe(catalogue.would.replace('{to}', 'X'));
    expect(TRACE_EN.textWouldHold('X', 'Y')).toBe(catalogue.wouldHold.replace('{to}', 'X').replace('{at}', 'Y'));
    expect(TRACE_EN.textNotSent('X')).toBe(catalogue.notSent.replace('{reason}', 'X'));
    expect(known.has('this is a sample row')).toBe(true);
    expect(known.has('an earlier send of this step is still open')).toBe(true);
  });
});

describe('a text step in a manifest', () => {
  it('passes when it names the app\'s own template and a column of the record', () => {
    expect(problems(shipped(step1({ notAfter: 'visit_at' })))).toBe('');
  });

  it('needs the release that reads it: an older floor is refused by name', () => {
    const checked = validateManifest(shipped(step1(), { compatibility: { minAdminiumVersion: '0.3.40' } }), { allowLocalPublisher: true });
    if (checked.ok) throw new Error('an older floor was accepted');
    // The step's own word, at the place it is written: the templates' word alone would not say so.
    const atStep = checked.issues.filter((issue) => [issue.path].flat().join('.').includes('automations.0.graph.nodes.1.action'));
    expect(atStep.map((issue) => issue.message).join(' ')).toContain(SMS_WORDS_FLOOR);
  });

  it('this server runs it, so the install is not refused for the word', () => {
    const checked = validateManifest(shipped(step1()), { allowLocalPublisher: true });
    if (!checked.ok) throw new Error(JSON.stringify(checked.issues));
    expect(unbuiltInManifest(checked.manifest as Manifest).map((one) => one.word)).not.toContain('automations.text');
    expect(UNBUILT_MANIFEST_WORDS['automations.text']).toBeUndefined();
    expect(MANIFEST_WORDS_RUN).toContain('automations.text');
  });

  it('refuses a template that is not one of its own', () => {
    expect(problems(shipped(step1({ templateKey: 'clinic-other-text' })))).toContain('is not one of this manifest\'s textTemplates');
  });

  it('refuses a column the record does not have', () => {
    expect(problems(shipped(step1({ to: { kind: 'field', column: 'nope' } })))).toContain('nope');
  });

  it('refuses a placeholder no rule can fill, and takes one with a backup or a value', () => {
    const body = (text: string): Doc => ({ textTemplates: [{ key: 'clinic-reminder-text', name: 'Reminder', locales: { 'en-US': { body: text } } }] });
    expect(problems(shipped(step1(), body('Hi {{nickname}}')))).toContain('which a rule cannot fill');
    expect(problems(shipped(step1(), body('Hi {{nickname|there}}')))).toBe('');
    expect(problems(shipped(step1({ vars: { nickname: '{{record.name}}' } }), body('Hi {{nickname}}')))).toBe('');
  });

  it('refuses a moment that is a day, which has no time', () => {
    expect(problems(shipped(step1({ notAfter: 'visit_day' })))).toContain('a text is held to a moment');
  });

  it('counts as sending out when the file itself chose the number or the words carry a value to a link', () => {
    const seeded = validateManifest(shipped(step1(), { seeds: [{ table: 'patients', rows: [{ id: 1, name: 'Seed', mobile: DE }] }] }), { allowLocalPublisher: true });
    if (!seeded.ok) throw new Error(JSON.stringify(seeded.issues));
    expect(outboundSteps(seeded.manifest).get('remind')).toEqual(['send']);
    const linked = validateManifest(shipped(step1(), { textTemplates: [{ key: 'clinic-reminder-text', name: 'Reminder', locales: { 'en-US': { body: 'Hi https://evil.example/?who={{name}}' } } }] }), { allowLocalPublisher: true });
    if (!linked.ok) throw new Error(JSON.stringify(linked.issues));
    expect(outboundSteps(linked.manifest).get('remind')).toEqual(['send']);
    const plain = validateManifest(shipped(step1()), { allowLocalPublisher: true });
    if (!plain.ok) throw new Error(JSON.stringify(plain.issues));
    expect(outboundSteps(plain.manifest).get('remind')).toBeUndefined();
  });
});

