// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Mail on a trial (`email/trial-relay.ts`): all of it on, only through the
 * operator's relay, each rule shown both ways (on a trial, and as an ordinary
 * server has it), on SQLite, PostgreSQL and MySQL.
 *
 *  - From is fixed to the relay's address with the instance's name filtered;
 *    Reply-To is a staff address; user mail carries the footer. Read off a
 *    real SMTP conversation (`smtp-sink.ts`).
 *  - Account mail says the shipped words and has a quota user mail never
 *    spends.
 *  - At most 20 people a day; the hour and day caps hold user mail in the
 *    outbox and the queue sends it when the window opens (a faked clock);
 *    nothing is queued past the trial's end, and held mail does not go then.
 *  - Bounces and spam reports hold user mail until the next day.
 *  - Marketing mail and campaigns are off; the user's own mail server is
 *    refused and shown read-only.
 *  - The operator's counters say what went out today and this hour.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import BetterSqlite3 from 'better-sqlite3';
import {
  createSqliteMetaDb,
  emailTemplatesRepo,
  firstRun,
  jobsRepo,
  rolesRepo,
  settingsRepo,
  stopListRepo,
  usersRepo,
  type MetaDb,
} from '@adminium/meta';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { composeServer, type ComposedServer } from '../src/compose.js';
import { enforceProfile } from '../src/config/env.js';
import { encryptSecret } from '../src/config/secrets.js';
import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import { ConnectionManager } from '../src/connections/manager.js';
import { seedBuiltinEmailTemplates } from '../src/email/builtins.js';
import { emailSecretKey } from '../src/email/config.js';
import {
  configureEmailRuntime,
  enqueueEmail,
  enqueueRenderedEmail,
  PASSWORD_RESET_TEMPLATE_KEY,
  resetEmailRuntime,
} from '../src/email/send.js';
import { trialMailSetupOf } from '../src/email/trial-mail-setup.js';
import { configureTrialMail, onEmailCapReached, safeSenderName, trialMailPanel, waitingEmails, type EmailCapReached } from '../src/email/trial-relay.js';
import { registerEmailSendHandler } from '../src/jobs/email-send.js';
import { createJobRegistry } from '../src/jobs/registry.js';
import { JobWorker } from '../src/jobs/worker.js';
import { createApplyService } from '../src/llm/apply-service.js';
import { createRunService } from '../src/llm/run-service.js';
import type { MetaStoreHandle } from '../src/meta/store.js';
import type { HostLookup } from '../src/net/address-guard.js';
import { relayMailSent } from '../src/operator/counters.js';
import { RealtimeHub } from '../src/realtime/hub.js';
import { trialPolicy } from '../src/trial/policy.js';
import { makeEnv, TEST_SECRET } from './helpers.js';
import { META_ENGINES, type MetaHandle } from './meta-dialects.js';
import { decodedBody, headersOf, startSmtpSink, type SmtpSink } from './smtp-sink.js';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** Monday 5 January 2099, 10:00 UTC. */
const T0 = Date.UTC(2099, 0, 5, 10, 0, 0);
const ADDRESS = 'i-7f3a9c@relay.example.com';
const ORIGIN = 'https://hollis.try.example.com';
const OWNER = 'dana@hollisbakery.example';
const SETUP_TOKEN = 'a-long-enough-setup-token';

/** A trial whose relay is `port`, its user mail capped at 25 a day so a day fills fast. */
const trialEnv = (port: number, extra: Record<string, string> = {}): Record<string, string> => ({
  ADMINIUM_TRIAL_MODE: 'on',
  ADMINIUM_TRIAL_ENDS_AT: '2099-12-01T00:00:00Z',
  ADMINIUM_PUBLIC_ORIGIN: ORIGIN,
  ADMINIUM_DATABASE_HOSTS: 'pg-trials:5432',
  ADMINIUM_SETUP_TOKEN: SETUP_TOKEN,
  ADMINIUM_TRIAL_SMTP_URL: `smtp://127.0.0.1:${String(port)}`,
  ADMINIUM_TRIAL_MAIL_FROM: ADDRESS,
  ADMINIUM_OPERATOR_NAME: 'Example Trials',
  ADMINIUM_TRIAL_EMAIL_MAX_PER_DAY: '25',
  ...extra,
});

/** A user-authored message, already drawn. */
const drawn = (subject = 'Your order shipped') => ({
  subject,
  html: `<!DOCTYPE html><html><body><p>${subject}</p></body></html>`,
  text: `${subject}\n`,
  inline: [],
});

describe('the relay’s variables', () => {
  const base = trialEnv(2525);
  const refuses = (raw: Record<string, string>, variable: string) => {
    expect(() => makeEnv(raw), variable).toThrow(variable);
  };

  it('a relay needs the address it pins; the report link and the operator’s name are checked', () => {
    const env = makeEnv(base);
    expect([env.ADMINIUM_TRIAL_MAIL_FROM, env.ADMINIUM_OPERATOR_NAME, env.ADMINIUM_TRIAL_MAIL_REPORT_URL]).toEqual([ADDRESS, 'Example Trials', undefined]);
    expect(makeEnv({ ...base, ADMINIUM_TRIAL_MAIL_REPORT_URL: 'MAILTO:Abuse@Example.com' }).ADMINIUM_TRIAL_MAIL_REPORT_URL).toBe('mailto:abuse@example.com');
    const { ADMINIUM_TRIAL_MAIL_FROM: _from, ...noFrom } = base;
    refuses(noFrom, 'ADMINIUM_TRIAL_MAIL_FROM');
    refuses({ ...base, ADMINIUM_TRIAL_MAIL_FROM: 'Trials <i-1@relay.example.com>' }, 'ADMINIUM_TRIAL_MAIL_FROM');
    refuses({ ...base, ADMINIUM_TRIAL_MAIL_REPORT_URL: 'http://example.com/report' }, 'ADMINIUM_TRIAL_MAIL_REPORT_URL');
    refuses({ ...base, ADMINIUM_TRIAL_MAIL_REPORT_URL: 'javascript:alert(1)' }, 'ADMINIUM_TRIAL_MAIL_REPORT_URL');
    refuses({ ...base, ADMINIUM_OPERATOR_NAME: 'Trials <abuse@example.com>' }, 'ADMINIUM_OPERATOR_NAME');
  });

  it('with no relay, a trial needs no address, and an ordinary server reads none of them', () => {
    const { ADMINIUM_TRIAL_SMTP_URL: _url, ADMINIUM_TRIAL_MAIL_FROM: _from, ...noRelay } = base;
    expect(makeEnv(noRelay).ADMINIUM_TRIAL_SMTP_URL).toBeUndefined();
    expect(makeEnv({}).ADMINIUM_TRIAL_MAIL_FROM).toBeUndefined();
  });
});

describe('the sender name filter', () => {
  it('keeps a plain business name, and takes out what a header is made of and invisible characters', () => {
    expect(safeSenderName('Hollis Bakery')).toBe('Hollis Bakery');
    expect(safeSenderName('Riverbank Café')).toBe('Riverbank Café');
    expect(safeSenderName('Hollis‮Bakery')).toBe('HollisBakery');
    expect(safeSenderName('Dana <dana@x.example>')).not.toContain('@');
    expect(safeSenderName('Dana <dana@x.example>')).not.toContain('<');
    expect(safeSenderName('   ')).toBeNull();
  });

  it('refuses a brand or an account-safety word in any spelling', () => {
    for (const name of ['PayPal', 'my-paypal-shop', 'PayPa1 Shop', 'P a y P a l', 'Аpple Store', 'G00gle Docs', 'Microsoft 365', 'rnicrosoft', 'Secure Login Team', 'Adminium', 'Password reset desk']) {
      expect(safeSenderName(name), name).toBeNull();
    }
  });
});

for (const engine of META_ENGINES) {
  describe.skipIf(!engine.available)(`trial mail through the operator's relay [${engine.name}]`, () => {
    let handle: MetaHandle;
    let meta: MetaDb;
    let sink: SmtpSink;
    let worker: JobWorker;
    let clock: number;
    const now = () => clock;

    /** This server as a trial (or with `extra` on the trial's variables). */
    function trial(extra: Record<string, string> = {}): void {
      const env = enforceProfile(makeEnv(trialEnv(sink.port, extra)));
      configureTrialMail(trialMailSetupOf(env, trialPolicy(env, now), now));
    }
    /** This server as an ordinary one: its own mail server, no caps. */
    function ordinary(): void {
      configureTrialMail(null);
    }
    const userMail = async (to: string, opts: { replyTo?: string; subject?: string; mailClass?: 'marketing' | 'service'; runAt?: number } = {}) =>
      await enqueueRenderedEmail(
        { meta, secret: TEST_SECRET, ...(opts.runAt === undefined ? {} : { runAt: opts.runAt }) },
        { to, templateKey: 'order-shipped', locale: 'en_US', rendered: drawn(opts.subject), ...(opts.replyTo === undefined ? {} : { replyTo: opts.replyTo }), ...(opts.mailClass === undefined ? {} : { mailClass: opts.mailClass }) },
      );
    const resetMail = async (to = OWNER, appName = 'Hollis Bakery') =>
      await enqueueEmail(
        { meta, secret: TEST_SECRET },
        {
          to,
          templateKey: PASSWORD_RESET_TEMPLATE_KEY,
          locale: 'en_US',
          vars: { appName, name: 'Dana Price', email: to, resetUrl: `${ORIGIN}/reset#t=abc` },
          counts: { expiresInMinutes: 30 },
        },
      );
    const runAt = async (id: string | undefined) => (id === undefined ? null : ((await jobsRepo(meta).findById(id))?.runAt ?? null));
    const drain = async () => {
      while ((await worker.runOnce()) > 0) {
        // until nothing is due
      }
    };

    beforeEach(async () => {
      resetEmailRuntime();
      clock = T0;
      handle = await engine.make();
      meta = handle.meta;
      sink = await startSmtpSink();
      configureEmailRuntime({ secret: TEST_SECRET });
      const settings = settingsRepo(meta);
      await settings.set('branding.appName', 'Hollis Bakery', { updatedBy: null });
      // The user's own mail server, which only an ordinary server uses.
      await settings.set(
        'email.smtp',
        { host: '127.0.0.1', port: sink.port, user: 'shop', passEncrypted: encryptSecret('pw', emailSecretKey(TEST_SECRET)), from: 'Hollis Bakery <shop@hollisbakery.example>', secure: false },
        { updatedBy: null },
      );
      await seedBuiltinEmailTemplates(meta, 1_000);
      const owner = await usersRepo(meta).create({ email: OWNER, name: 'Dana Price', status: 'active' });
      const superAdmin = await rolesRepo(meta).findBySlug('super-admin');
      await rolesRepo(meta).assignToUser(owner.id, superAdmin!.id);
      await usersRepo(meta).create({ email: 'sam@hollisbakery.example', name: 'Sam Lee', status: 'active' });
      const registry = createJobRegistry();
      registerEmailSendHandler(registry, { meta, secret: TEST_SECRET });
      worker = new JobWorker({ meta, registry, hub: new RealtimeHub(), workerId: 'trial-email', backoffBaseMs: 1, concurrency: 1, now });
    }, 180_000);

    afterEach(async () => {
      configureTrialMail(null);
      resetEmailRuntime();
      await sink.close();
      await handle.destroy();
    });

    describe('From, Reply-To and the footer', () => {
      it('on a trial: the relay’s address with the instance’s name, a staff Reply-To, the footer with the report link', async () => {
        trial();
        await userMail('pat@customer.example', { replyTo: 'stranger@elsewhere.example' });
        await userMail('pat@customer.example', { replyTo: 'sam@hollisbakery.example' });
        await drain();
        expect(sink.messages).toHaveLength(2);
        const [first, second] = sink.messages.map((m) => ({ head: headersOf(m.raw), body: decodedBody(m.raw), from: m.from }));
        expect(first!.from).toBe(ADDRESS);
        expect(first!.head.get('from')).toBe(`Hollis Bakery via Example Trials <${ADDRESS}>`);
        // An address nobody signs in with gives way to the owner's; a staff member's own is kept.
        expect(first!.head.get('reply-to')).toBe(OWNER);
        expect(second!.head.get('reply-to')).toBe('sam@hollisbakery.example');
        expect(first!.body).toContain(`Sent from the installation at ${ORIGIN}`);
        expect(first!.body).toContain('mailto:abuse@relay.example.com');
      });

      it('a name the filter refuses gives way to the instance’s host', async () => {
        trial();
        await settingsRepo(meta).set('branding.appName', 'PayPa1 Support', { updatedBy: null });
        await userMail('pat@customer.example');
        await drain();
        expect(headersOf(sink.messages[0]!.raw).get('from')).toBe(`"hollis.try.example.com via Example Trials" <${ADDRESS}>`);
      });

      it('on an ordinary server: its own mail server’s From, the Reply-To asked for, no footer', async () => {
        ordinary();
        await userMail('pat@customer.example', { replyTo: 'stranger@elsewhere.example' });
        await drain();
        const head = headersOf(sink.messages[0]!.raw);
        expect(head.get('from')).toBe('Hollis Bakery <shop@hollisbakery.example>');
        expect(head.get('reply-to')).toBe('stranger@elsewhere.example');
        expect(decodedBody(sink.messages[0]!.raw)).not.toContain('Sent from the installation');
      });
    });

    describe('account mail', () => {
      beforeEach(async () => {
        // An admin's edit of the reset mail, worded to fish.
        await emailTemplatesRepo(meta).upsert(PASSWORD_RESET_TEMPLATE_KEY, 'en_US', {
          name: 'Password reset',
          subject: 'URGENT: confirm your bank login',
          blocks: [{ id: 'b1', block: 'email.text', data: { text: 'Sign in at our bank right now.' } }],
          enabled: true,
        });
      });

      it('on a trial: the shipped words, the names filtered, no Reply-To, no footer', async () => {
        trial();
        await resetMail(OWNER, 'PayPal Security');
        await drain();
        const raw = sink.messages[0]!.raw;
        expect(headersOf(raw).get('subject')).toBe('Reset your hollis.try.example.com password');
        expect(decodedBody(raw)).not.toContain('our bank');
        expect(headersOf(raw).get('reply-to')).toBeUndefined();
        expect(decodedBody(raw)).not.toContain('Sent from the installation');
      });

      it('on an ordinary server: the admin’s own wording', async () => {
        ordinary();
        await resetMail();
        await drain();
        expect(headersOf(sink.messages[0]!.raw).get('subject')).toBe('URGENT: confirm your bank login');
      });

      it('keeps its own quota through a flood of user mail, and that quota has an end', async () => {
        trial();
        for (let i = 0; i < 40; i += 1) await userMail(`person${String(i % 20)}@customer.example`);
        const reset = await resetMail();
        expect(reset).not.toBeNull();
        expect(await runAt(reset?.id)).toBe(T0);
        // 20 account mails an hour and 50 a day, none of it spent by the user mail above; past them, not queued.
        for (let i = 1; i < 20; i += 1) expect(await resetMail(), `reset ${String(i)}`).not.toBeNull();
        expect(await resetMail()).toBeNull();
        clock = T0 + HOUR;
        for (let i = 0; i < 20; i += 1) expect(await resetMail(), `reset ${String(20 + i)}`).not.toBeNull();
        clock = T0 + 2 * HOUR;
        for (let i = 0; i < 10; i += 1) expect(await resetMail(), `reset ${String(40 + i)}`).not.toBeNull();
        clock = T0 + 3 * HOUR;
        expect(await resetMail()).toBeNull();
      }, 60_000);

      it('on an ordinary server: no quota', async () => {
        ordinary();
        for (let i = 0; i < 51; i += 1) expect(await resetMail()).not.toBeNull();
      }, 60_000);
    });

    describe('at most 20 people a day', () => {
      it('on a trial: a 21st person waits for tomorrow; someone already written to does not', async () => {
        trial();
        for (let i = 0; i < 19; i += 1) expect(await runAt((await userMail(`person${String(i)}@customer.example`))?.id)).toBe(T0);
        expect(await runAt((await userMail('person19@customer.example'))?.id)).toBe(T0);
        expect(await runAt((await userMail('person20@customer.example'))?.id)).toBe(T0 - 10 * HOUR + DAY);
        // The hour is full too, so a person already written to waits for the next hour, not the next day.
        expect(await runAt((await userMail('person0@customer.example'))?.id)).toBe(T0 + HOUR);
      });

      it('on an ordinary server: everyone now', async () => {
        ordinary();
        for (let i = 0; i < 22; i += 1) expect(await runAt((await userMail(`person${String(i)}@customer.example`))?.id)).toBeLessThanOrEqual(Date.now());
      });
    });

    describe('held in the outbox, sent when the window opens', () => {
      it('on a trial: past 20 an hour waits for the next hour, past the day’s cap for the next day; the queue sends each then', async () => {
        trial();
        const events: EmailCapReached[] = [];
        const stop = onEmailCapReached((event) => events.push(event));
        for (let i = 0; i < 21; i += 1) await userMail(`person${String(i % 5)}@customer.example`, { subject: `Order ${String(i)}` });
        clock = T0 + 30 * 60_000;
        await drain();
        expect(sink.messages).toHaveLength(20);
        expect(await relayMailSent(meta, clock)).toEqual({ today: 20, thisHour: 20 });
        const panel = await trialMailPanel(meta);
        expect(panel).toMatchObject({ today: 21, thisHour: 20, waiting: 1, limit: 'hour', nextAt: T0 + HOUR });
        expect((await waitingEmails(meta, 10))?.map((mail) => [mail.to, mail.subject, mail.goesOutAt])).toEqual([['person0@customer.example', 'Order 20', T0 + HOUR]]);

        // The next hour: the held one goes, then four more fill the day's 25, and the 26th waits for tomorrow.
        clock = T0 + HOUR;
        await drain();
        expect(sink.messages).toHaveLength(21);
        for (let i = 0; i < 4; i += 1) await userMail('person1@customer.example');
        const tomorrow = await userMail('person1@customer.example', { subject: 'Tomorrow' });
        expect(await runAt(tomorrow?.id)).toBe(T0 - 10 * HOUR + DAY);
        expect((await trialMailPanel(meta))?.limit).toBe('day');
        await drain();
        expect(sink.messages).toHaveLength(25);

        clock = T0 - 10 * HOUR + DAY;
        await drain();
        expect(sink.messages).toHaveLength(26);
        expect(await relayMailSent(meta, clock)).toEqual({ today: 1, thisHour: 1 });
        // Told once per cap and window, for an operator event.
        expect(events.map((event) => event.cap)).toEqual(['hour', 'day']);
        stop();
      }, 60_000);

      it('a server that wakes counts on from the queue', async () => {
        trial();
        for (let i = 0; i < 20; i += 1) await userMail('pat@customer.example');
        await drain();
        trial();
        expect(await runAt((await userMail('pat@customer.example'))?.id)).toBe(T0 + HOUR);
      });

      it('nothing is queued to go past the trial’s end, and what waits does not go once it has passed', async () => {
        trial({ ADMINIUM_TRIAL_ENDS_AT: new Date(T0 + HOUR).toISOString() });
        for (let i = 0; i < 20; i += 1) expect(await userMail('pat@customer.example')).not.toBeNull();
        expect(await userMail('pat@customer.example')).toBeNull();
        clock = T0 + HOUR;
        await drain();
        expect(sink.messages).toHaveLength(0);
        // Account mail still goes.
        await resetMail();
        await drain();
        expect(sink.messages).toHaveLength(1);
      });

      it('on an ordinary server: no hold, and nothing counted', async () => {
        ordinary();
        for (let i = 0; i < 26; i += 1) await userMail('pat@customer.example');
        await drain();
        expect(sink.messages).toHaveLength(26);
        expect(await relayMailSent(meta, clock)).toEqual({ today: null, thisHour: null });
        expect(await trialMailPanel(meta)).toBeNull();
        expect(await waitingEmails(meta, 10)).toBeNull();
      }, 60_000);
    });

    describe('bounces and spam reports', () => {
      const listed = async (reason: 'bounce' | 'spam', count: number) => {
        for (let i = 0; i < count; i += 1) {
          await stopListRepo(meta).add({ address: { hash: `${reason}-${String(i)}`, version: 1 }, addressEncrypted: null, reason, addedAt: clock });
        }
      };

      it('on a trial: five bounces, or one spam report, today hold user mail until tomorrow', async () => {
        trial();
        await listed('bounce', 4);
        expect(await runAt((await userMail('pat@customer.example'))?.id)).toBe(T0);
        await listed('bounce', 5);
        expect(await runAt((await userMail('pat@customer.example'))?.id)).toBe(T0 - 10 * HOUR + DAY);
        expect((await trialMailPanel(meta))?.limit).toBe('bounces');
        // Account mail is not held.
        expect(await runAt((await resetMail())?.id)).toBe(T0);
      });

      it('one spam report is enough', async () => {
        trial();
        await listed('spam', 1);
        expect(await runAt((await userMail('pat@customer.example'))?.id)).toBe(T0 - 10 * HOUR + DAY);
      });

      it('on an ordinary server: not held', async () => {
        ordinary();
        await listed('bounce', 9);
        expect(await runAt((await userMail('pat@customer.example'))?.id)).toBeLessThanOrEqual(Date.now());
      });
    });

    describe('marketing mail', () => {
      it('on a trial: not queued', async () => {
        trial();
        expect(await userMail('pat@customer.example', { mailClass: 'marketing' })).toBeNull();
        expect(await userMail('pat@customer.example', { mailClass: 'service' })).not.toBeNull();
      });

      it('on an ordinary server: queued', async () => {
        ordinary();
        expect(await userMail('pat@customer.example', { mailClass: 'marketing' })).not.toBeNull();
      });
    });
  });
}

// --- the routes, on a whole server -------------------------------------------------------

const NOTHING_RESOLVES: HostLookup = async () => Promise.reject(new Error('ENOTFOUND'));
const PASSWORD = 'a-long-enough-test-password-1!';
let dist: string;
let composed: ComposedServer | undefined;
let store: MetaDb | undefined;

beforeAll(async () => {
  dist = await mkdtemp(join(tmpdir(), 'trial-email-'));
  await writeFile(join(dist, 'index.html'), '<!doctype html><html><body></body></html>');
});
afterAll(async () => {
  await rm(dist, { recursive: true, force: true });
});

interface Served {
  api: (method: 'GET' | 'PUT' | 'POST', url: string, payload?: unknown) => Promise<{ status: number; body: Record<string, unknown> }>;
}

/** A composed server on `env`, its first Super Admin signed in. */
async function serve(env: Record<string, string>): Promise<Served> {
  const meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
  store = meta;
  await firstRun(meta);
  const parsed = enforceProfile(makeEnv({ HOST: '127.0.0.1', ...env }));
  const runService = createRunService({ meta });
  const metaStore: MetaStoreHandle = { meta, url: 'sqlite::memory:', engine: 'sqlite', source: 'embedded', close: async () => Promise.resolve() };
  composed = await composeServer({
    env: parsed,
    metaStore,
    manager: new ConnectionManager({
      meta,
      crypto: dsnCryptoFromSecret(TEST_SECRET),
      metaDsn: null,
      blockLoopback: true,
      databaseHosts: parsed.ADMINIUM_DATABASE_HOSTS,
      networkPolicy: parsed.ADMINIUM_NETWORK_POLICY,
      lookup: NOTHING_RESOLVES,
      policy: trialPolicy(parsed),
      operatorSourceUrl: parsed.ADMINIUM_SOURCE_URL,
    }),
    runService,
    applyService: createApplyService({ meta, runService }),
    allowed: { templates: [], widgets: [], widgetContracts: {} },
    logger: false,
    telemetry: false,
    onMetaRelocated: () => undefined,
    staticRoot: dist,
  });
  const { app } = composed;
  await app.ready();
  const host = parsed.ADMINIUM_PUBLIC_ORIGIN === undefined ? 'localhost' : new URL(parsed.ADMINIUM_PUBLIC_ORIGIN).host;
  const setup = await app.inject({
    method: 'POST',
    url: '/api/v1/setup/super-admin',
    headers: { host, origin: `https://${host}` },
    payload: { email: OWNER, password: PASSWORD, name: 'Dana Price', consent: { telemetry: false, updateCheck: false }, ...(env['ADMINIUM_SETUP_TOKEN'] === undefined ? {} : { setupToken: SETUP_TOKEN }) },
  });
  expect(setup.statusCode, setup.body).toBe(201);
  const cookie = String(setup.headers['set-cookie']).split(';')[0] ?? '';
  return {
    api: async (method, url, payload) => {
      const res = await app.inject({ method, url, headers: { host, cookie }, ...(payload === undefined ? {} : { payload: payload as object }) });
      return { status: res.statusCode, body: res.json() };
    },
  };
}

describe('the Email settings and campaign routes', () => {
  afterEach(async () => {
    await composed?.app.close();
    composed = undefined;
    await store?.db.destroy();
    store = undefined;
    configureTrialMail(null);
    resetEmailRuntime();
  });

  const SMTP = { smtp: { host: '127.0.0.1', port: 2525, user: '', from: 'shop@hollisbakery.example', secure: false } };

  it('on a trial: the user’s own mail server is refused, the relay is shown read-only, and campaigns are off', async () => {
    const server = await serve({ ...trialEnv(2525), ADMINIUM_SOURCE_URL: 'postgres://trial_hollis:secret@pg-trials:5432/trial_hollis' });
    const put = await server.api('PUT', '/api/v1/settings/email', SMTP);
    expect(put.status).toBe(409);
    expect(put.body).toMatchObject({ error: { code: 'SET_BY_OPERATOR', details: { setting: 'email.smtp' } } });
    const read = await server.api('GET', '/api/v1/settings/email');
    expect(read.status).toBe(200);
    expect(read.body['data']).toMatchObject({
      configured: true,
      host: null,
      locks: { smtp: { allowed: false, reason: 'trial-mode' } },
      // The default workspace name is the product's own, which the filter refuses: the host stands in.
      relay: { from: `"hollis.try.example.com via Example Trials" <${ADDRESS}>`, replyTo: OWNER, caps: { perDay: 25, perHour: 20, recipientsPerDay: 20 }, waiting: 0, limit: null },
    });
    expect((await server.api('GET', '/api/v1/settings/email/waiting')).body).toEqual({ data: [] });
    const send = await server.api('POST', '/api/v1/email-templates/etpl_missing/send', { audience: { kind: 'users' } });
    expect(send.status).toBe(403);
    expect(send.body).toMatchObject({ error: { code: 'OFF_BY_OPERATOR', details: { question: 'marketingCampaigns', reason: 'trial-mode' } } });
  }, 60_000);

  it('on an ordinary server: the mail server is saved, nothing is locked, and a campaign send goes on to find its campaign', async () => {
    const server = await serve({});
    const put = await server.api('PUT', '/api/v1/settings/email', SMTP);
    expect(put.status, JSON.stringify(put.body)).toBe(200);
    expect(put.body['data']).toMatchObject({ configured: true, host: '127.0.0.1', locks: { smtp: { allowed: true, reason: null } }, relay: null });
    expect((await server.api('GET', '/api/v1/settings/email/waiting')).body).toEqual({ data: [] });
    const send = await server.api('POST', '/api/v1/email-templates/etpl_missing/send', { audience: { kind: 'users' } });
    expect(send.status).toBe(404);
  }, 60_000);
});
