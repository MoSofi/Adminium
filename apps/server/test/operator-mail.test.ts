// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The operator's mail server for an installation that is not a trial
 * (`ADMINIUM_OPERATOR_SMTP_URL`, `email/trial-relay.ts` kind `operator`):
 *
 *  - the variables: the URL and the From need each other, the cap defaults to
 *    500, the URL takes `_FILE` and is held out of `process.env`, and trial
 *    mode refuses all three (its relay is the trial's);
 *  - the order: the installation's own mail server wins, uncounted; with none,
 *    the operator's, From pinned as `"<name> via <operator>"`; with neither, no
 *    mail. Removing its own falls back to the operator's;
 *  - the daily cap holds the mail people write (held, not dropped), never
 *    account mail, and survives a restart; marketing mail is not sent through it;
 *  - Settings → Mail says the operator's server is in use, with its cap, until
 *    the installation saves its own.
 *
 * Read off a real SMTP conversation (`smtp-sink.ts`), on every meta engine
 * available.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { jobsRepo, rolesRepo, settingsRepo, usersRepo, type MetaDb } from '@adminium/meta';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv, profileIssues } from '../src/config/env.js';
import { isOperatorSecretName } from '../src/config/operator-secrets.js';
import { encryptSecret } from '../src/config/secrets.js';
import { seedBuiltinEmailTemplates } from '../src/email/builtins.js';
import { emailSecretKey, resolveSmtpConfig } from '../src/email/config.js';
import { configureEmailRuntime, enqueueEmail, enqueueRenderedEmail, PASSWORD_RESET_TEMPLATE_KEY, resetEmailRuntime } from '../src/email/send.js';
import { operatorMailSetupOf } from '../src/email/trial-mail-setup.js';
import { configureTrialMail, operatorMailOn, relayInUse, trialMailOn, trialMailPanel } from '../src/email/trial-relay.js';
import { registerEmailSendHandler } from '../src/jobs/email-send.js';
import { createJobRegistry } from '../src/jobs/registry.js';
import { JobWorker } from '../src/jobs/worker.js';
import { RealtimeHub } from '../src/realtime/hub.js';
import { makeEnv, TEST_SECRET } from './helpers.js';
import { META_ENGINES, type MetaHandle } from './meta-dialects.js';
import { HOSTED, makeFixture, ORDINARY, serveProfile, TRIAL, type Fixture } from './profile-server.helpers.js';
import { decodedBody, headersOf, startSmtpSink, type SmtpSink } from './smtp-sink.js';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** Monday 5 January 2099, 10:00 UTC. */
const T0 = Date.UTC(2099, 0, 5, 10, 0, 0);
const ADDRESS = 'shop-7f3a9c@mail.example.com';
const ORIGIN = 'https://hollis.example.com';
const OWNER = 'dana@hollisbakery.example';
const OWN_FROM = 'Hollis Bakery <shop@hollisbakery.example>';

const operatorVars = (port: number, extra: Record<string, string> = {}): Record<string, string> => ({
  ADMINIUM_OPERATOR_SMTP_URL: `smtp://127.0.0.1:${String(port)}`,
  ADMINIUM_OPERATOR_MAIL_FROM: ADDRESS,
  ADMINIUM_OPERATOR_NAME: 'Example Hosting',
  ...extra,
});

describe('the operator mail variables', () => {
  it('the URL needs the From and the From needs the URL; the cap defaults to 500', () => {
    const env = makeEnv(operatorVars(2525));
    expect([env.ADMINIUM_OPERATOR_SMTP_URL, env.ADMINIUM_OPERATOR_MAIL_FROM, env.ADMINIUM_OPERATOR_EMAIL_MAX_PER_DAY]).toEqual(['smtp://127.0.0.1:2525', ADDRESS, 500]);
    const { ADMINIUM_OPERATOR_MAIL_FROM: _from, ...noFrom } = operatorVars(2525);
    expect(() => makeEnv(noFrom)).toThrow('ADMINIUM_OPERATOR_MAIL_FROM');
    const { ADMINIUM_OPERATOR_SMTP_URL: _url, ...noUrl } = operatorVars(2525);
    expect(() => makeEnv(noUrl)).toThrow('ADMINIUM_OPERATOR_SMTP_URL');
    expect(() => makeEnv(operatorVars(2525, { ADMINIUM_OPERATOR_SMTP_URL: 'https://mail.example.com' }))).toThrow('ADMINIUM_OPERATOR_SMTP_URL');
    expect(() => makeEnv(operatorVars(2525, { ADMINIUM_OPERATOR_MAIL_FROM: 'Shop <shop@mail.example.com>' }))).toThrow('ADMINIUM_OPERATOR_MAIL_FROM');
    expect(makeEnv(operatorVars(2525, { ADMINIUM_OPERATOR_EMAIL_MAX_PER_DAY: '40' })).ADMINIUM_OPERATOR_EMAIL_MAX_PER_DAY).toBe(40);
    expect(makeEnv({}).ADMINIUM_OPERATOR_SMTP_URL).toBeUndefined();
  });

  it('trial mode refuses all three; the hosted profile and an ordinary server take them', () => {
    const vars = { ...operatorVars(2525), ADMINIUM_OPERATOR_EMAIL_MAX_PER_DAY: '40' };
    const refused = profileIssues({ ...TRIAL, ...vars }).map((problem) => problem.variable);
    expect(refused.sort()).toEqual(['ADMINIUM_OPERATOR_EMAIL_MAX_PER_DAY', 'ADMINIUM_OPERATOR_MAIL_FROM', 'ADMINIUM_OPERATOR_SMTP_URL']);
    expect(profileIssues({ ...HOSTED, ...vars })).toEqual([]);
    expect(profileIssues({ ...ORDINARY, ...vars })).toEqual([]);
  });

  it('the URL is a secret: it takes `_FILE`, and is held out of process.env', async () => {
    expect(isOperatorSecretName('ADMINIUM_OPERATOR_SMTP_URL')).toBe(true);
    expect(isOperatorSecretName('ADMINIUM_OPERATOR_SMTP_URL_FILE')).toBe(true);
    const dir = await mkdtemp(join(tmpdir(), 'operator-mail-'));
    try {
      const file = join(dir, 'smtp_url');
      await writeFile(file, 'smtp://shop:pw@mail.example.com:587\n');
      const env = loadEnv({ ADMINIUM_SECRET: TEST_SECRET, ADMINIUM_OPERATOR_SMTP_URL_FILE: file, ADMINIUM_OPERATOR_MAIL_FROM: ADDRESS }, { write: () => true });
      expect(env.ADMINIUM_OPERATOR_SMTP_URL).toBe('smtp://shop:pw@mail.example.com:587');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('builds the operator kind of the mail rules only when both are set', () => {
    expect(operatorMailSetupOf(makeEnv({}))).toBeNull();
    const setup = operatorMailSetupOf(makeEnv(operatorVars(2525, { ADMINIUM_OPERATOR_EMAIL_MAX_PER_DAY: '40' })));
    expect(setup).toMatchObject({ kind: 'operator', endsAt: null, relay: { address: ADDRESS, operatorName: 'Example Hosting', smtp: { host: '127.0.0.1', port: 2525, from: ADDRESS } } });
    expect(setup?.caps.perDay).toBe(40);
    expect(setup?.caps.systemPerDay).toBe(Infinity);
  });
});

for (const engine of META_ENGINES) {
  describe.skipIf(!engine.available)(`mail through the operator's server [${engine.name}]`, () => {
    let handle: MetaHandle;
    let meta: MetaDb;
    let sink: SmtpSink;
    let worker: JobWorker;
    let clock: number;
    const now = () => clock;

    /** This installation with the operator's mail server, its people's mail capped at `perDay`. */
    function operator(perDay = 3): void {
      configureTrialMail(operatorMailSetupOf(makeEnv({ ...operatorVars(sink.port), ADMINIUM_OPERATOR_EMAIL_MAX_PER_DAY: String(perDay), ADMINIUM_PUBLIC_ORIGIN: ORIGIN }), now));
    }
    /** Saves the installation's own mail server (the same sink, its own From). */
    const ownServer = async () =>
      await settingsRepo(meta).set(
        'email.smtp',
        { host: '127.0.0.1', port: sink.port, user: 'shop', passEncrypted: encryptSecret('pw', emailSecretKey(TEST_SECRET)), from: OWN_FROM, secure: false },
        { updatedBy: null },
      );
    const userMail = async (to: string, opts: { replyTo?: string; mailClass?: 'marketing' | 'service' } = {}) =>
      await enqueueRenderedEmail(
        { meta, secret: TEST_SECRET },
        {
          to,
          templateKey: 'order-shipped',
          locale: 'en_US',
          rendered: { subject: 'Your order shipped', html: '<!DOCTYPE html><html><body><p>Shipped</p></body></html>', text: 'Shipped\n', inline: [] },
          ...(opts.replyTo === undefined ? {} : { replyTo: opts.replyTo }),
          ...(opts.mailClass === undefined ? {} : { mailClass: opts.mailClass }),
        },
      );
    const resetMail = async () =>
      await enqueueEmail(
        { meta, secret: TEST_SECRET },
        {
          to: OWNER,
          templateKey: PASSWORD_RESET_TEMPLATE_KEY,
          locale: 'en_US',
          vars: { appName: 'Hollis Bakery', name: 'Dana Price', email: OWNER, resetUrl: `${ORIGIN}/reset#t=abc` },
          counts: { expiresInMinutes: 30 },
          account: true,
        },
      );
    const runAt = async (id: string | undefined) => (id === undefined ? null : ((await jobsRepo(meta).findById(id))?.runAt ?? null));
    const drain = async () => {
      while ((await worker.runOnce()) > 0) {
        // until nothing is due
      }
    };
    const fromOf = (index: number) => headersOf(sink.messages[index]!.raw).get('from');

    beforeEach(async () => {
      resetEmailRuntime();
      clock = T0;
      handle = await engine.make();
      meta = handle.meta;
      sink = await startSmtpSink();
      configureEmailRuntime({ secret: TEST_SECRET });
      await settingsRepo(meta).set('branding.appName', 'Hollis Bakery', { updatedBy: null });
      await seedBuiltinEmailTemplates(meta, 1_000);
      const owner = await usersRepo(meta).create({ email: OWNER, name: 'Dana Price', status: 'active' });
      const superAdmin = await rolesRepo(meta).findBySlug('super-admin');
      await rolesRepo(meta).assignToUser(owner.id, superAdmin!.id);
      const registry = createJobRegistry();
      registerEmailSendHandler(registry, { meta, secret: TEST_SECRET });
      worker = new JobWorker({ meta, registry, hub: new RealtimeHub(), workerId: 'operator-mail', backoffBaseMs: 1, concurrency: 1, now });
    }, 180_000);

    afterEach(async () => {
      configureTrialMail(null);
      resetEmailRuntime();
      await sink.close();
      await handle.destroy();
    });

    describe('which server carries the mail', () => {
      it('none of its own: the operator’s, From pinned with the instance’s name, the mail’s own Reply-To, no footer', async () => {
        operator();
        expect([operatorMailOn(), trialMailOn(), await relayInUse(meta)]).toEqual([true, false, true]);
        expect(await resolveSmtpConfig(meta, emailSecretKey(TEST_SECRET))).toMatchObject({ host: '127.0.0.1', port: sink.port, from: ADDRESS });
        await userMail('pat@customer.example', { replyTo: 'help@hollisbakery.example' });
        await userMail('kim@customer.example');
        await drain();
        expect(sink.messages).toHaveLength(2);
        expect(sink.messages[0]!.from).toBe(ADDRESS);
        expect(fromOf(0)).toBe(`Hollis Bakery via Example Hosting <${ADDRESS}>`);
        expect(headersOf(sink.messages[0]!.raw).get('reply-to')).toBe('help@hollisbakery.example');
        // No Reply-To asked for: the first Super Admin's, so a reply never lands at the operator's address.
        expect(headersOf(sink.messages[1]!.raw).get('reply-to')).toBe(OWNER);
        expect(decodedBody(sink.messages[0]!.raw)).not.toContain('Sent from the installation');
      });

      it('its own server wins, uncounted; removing it falls back to the operator’s', async () => {
        // The real clock: mail through its own server is queued by it, and must fall in the day the operator's server counts.
        clock = Date.now();
        operator(1);
        await ownServer();
        expect(await relayInUse(meta)).toBe(false);
        const own = [await userMail('a@customer.example'), await userMail('b@customer.example'), await userMail('c@customer.example')];
        clock = Date.now();
        // No cap: all three are due at once.
        for (const job of own) expect(await runAt(job?.id)).toBeLessThanOrEqual(clock);
        await drain();
        expect(sink.messages.map((_, i) => fromOf(i))).toEqual([OWN_FROM, OWN_FROM, OWN_FROM]);
        expect(await trialMailPanel(meta)).toBeNull();

        await settingsRepo(meta).unset('email.smtp');
        expect(await relayInUse(meta)).toBe(true);
        // What went through its own server is not the operator's to count: today's one email is still free.
        const first = await userMail('d@customer.example');
        expect(await runAt(first?.id)).toBe(clock);
        await drain();
        expect(fromOf(3)).toBe(`Hollis Bakery via Example Hosting <${ADDRESS}>`);
        expect(await trialMailPanel(meta)).toMatchObject({ kind: 'operator', today: 1, caps: { perDay: 1 } });
      });

      it('a mail queued on the operator’s server and sent after its own was saved goes From its own', async () => {
        operator();
        await userMail('pat@customer.example');
        await ownServer();
        await drain();
        expect(fromOf(0)).toBe(OWN_FROM);
      });

      it('neither: no mail at all', async () => {
        configureTrialMail(null);
        expect(await relayInUse(meta)).toBe(false);
        expect(await resolveSmtpConfig(meta, emailSecretKey(TEST_SECRET))).toBeNull();
        expect(await resetMail()).toBeNull();
        operator();
        expect(await resetMail()).not.toBeNull();
      });
    });

    describe('the daily cap', () => {
      it('holds the mail people write until tomorrow, never account mail, and counts on after a restart', async () => {
        operator(3);
        const jobs = [];
        for (let i = 0; i < 4; i += 1) jobs.push(await userMail(`person${String(i)}@customer.example`));
        for (const job of jobs.slice(0, 3)) expect(await runAt(job?.id)).toBe(T0);
        const tomorrow = Math.floor(T0 / DAY) * DAY + DAY;
        expect(await runAt(jobs[3]?.id)).toBe(tomorrow);
        // Account mail is not counted, nor held.
        for (let i = 0; i < 10; i += 1) {
          const reset = await resetMail();
          expect(await runAt(reset?.id), `reset ${String(i)}`).toBe(T0);
        }
        expect(await trialMailPanel(meta)).toMatchObject({ kind: 'operator', from: `"Hollis Bakery via Example Hosting" <${ADDRESS}>`, today: 3, waiting: 1, limit: 'day', caps: { perDay: 3 } });

        // A restart counts on from the queue.
        operator(3);
        const after = await userMail('late@customer.example');
        expect(await runAt(after?.id)).toBe(tomorrow);

        await drain();
        expect(sink.messages).toHaveLength(13);
        clock = tomorrow + 1;
        await drain();
        expect(sink.messages).toHaveLength(15);
      });

      it('sends no marketing mail: that needs the installation’s own server', async () => {
        operator();
        expect(await userMail('pat@customer.example', { mailClass: 'marketing' })).toBeNull();
        expect(await userMail('pat@customer.example', { mailClass: 'service' })).not.toBeNull();
        await ownServer();
        expect(await userMail('pat@customer.example', { mailClass: 'marketing' })).not.toBeNull();
      });
    });
  });
}

// --- Settings → Mail, on a whole hosted server ------------------------------------------

describe('Settings → Mail on a hosted installation with the operator’s mail server', () => {
  let fixture: Fixture;
  beforeAll(async () => {
    fixture = await makeFixture('operator-mail-');
  });
  afterAll(async () => {
    await fixture.remove();
  });
  afterEach(() => {
    configureTrialMail(null);
  });

  const OWN = { smtp: { host: '93.184.216.34', port: 587, user: '', from: 'shop@hollisbakery.example', secure: false } };

  it('shows the operator’s server and its cap until its own is saved, and again once that is removed', async () => {
    const server = await serveProfile({ ...HOSTED, ...operatorVars(2525), ADMINIUM_OPERATOR_EMAIL_MAX_PER_DAY: '200' }, { fixture });
    try {
      const read = await server.api('GET', '/api/v1/settings/email');
      expect(read.status, JSON.stringify(read.body)).toBe(200);
      expect(read.body['data']).toMatchObject({
        configured: false,
        host: null,
        locks: { smtp: { allowed: true } },
        relay: { kind: 'operator', from: expect.stringContaining(`<${ADDRESS}>`), caps: { perDay: 200 }, today: 0, waiting: 0, limit: null },
      });

      const put = await server.api('PUT', '/api/v1/settings/email', OWN);
      expect(put.status, JSON.stringify(put.body)).toBe(200);
      expect(put.body['data']).toMatchObject({ configured: true, host: '93.184.216.34', relay: null });

      const removed = await server.api('PUT', '/api/v1/settings/email', { smtp: null });
      expect(removed.status, JSON.stringify(removed.body)).toBe(200);
      expect(removed.body['data']).toMatchObject({ configured: false, relay: { kind: 'operator', caps: { perDay: 200 } } });
    } finally {
      await server.close();
    }
  }, 60_000);

  it('without the operator’s variables a hosted installation shows no operator panel', async () => {
    const server = await serveProfile(HOSTED, { fixture });
    try {
      const read = await server.api('GET', '/api/v1/settings/email');
      expect(read.body['data']).toMatchObject({ configured: false, relay: null });
    } finally {
      await server.close();
    }
  }, 60_000);
});
