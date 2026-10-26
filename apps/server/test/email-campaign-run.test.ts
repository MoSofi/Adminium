// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Campaign runs: the `email.campaign-run` batches and the `email.send` queue
 * behind them through a recorder transport, and the campaign routes through a
 * bare app with the real rbac plugin — on SQLite, PostgreSQL and MySQL.
 *
 * The assertions that carry the wave: the audience is resolved LIVE at the
 * start (an opted-out account is written to the log as skipped and counted,
 * a suspended one is not there at all), a recipient whose locale has a
 * translated sibling gets that sibling, a refused message is tried again by
 * the mail queue and counted as a failure with the address only when it gives
 * up, a cancel mid-run stops the run for good with the counts so far, a run a
 * crash left behind is never sent twice, a scheduled send rides `runAt`, and a
 * second send while one is scheduled is a 409. The ledger's own promises
 * (crash and clean-stop resume, pause, the cap, the log) are
 * `email-campaign-ledger.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  emailRunsRepo,
  emailSendsRepo,
  JOB_STALE_LOCK_MS,
  jobsRepo,
  notificationPrefsRepo,
  notificationsRepo,
  rolesRepo,
  settingsRepo,
  userPrefsRepo,
  usersRepo,
  type MetaDb,
  type Role,
  type User,
} from '@adminium/meta';

import { encryptSecret } from '../src/config/secrets.js';
import { EMAIL_CAMPAIGN_PREF_KIND, EMAIL_CAMPAIGN_SENT_KIND, resolveCampaignAudience } from '../src/email/audience.js';
import { seedBuiltinEmailTemplates } from '../src/email/builtins.js';
import { emailSecretKey } from '../src/email/config.js';
import { resetEmailRuntime } from '../src/email/send.js';
import type { EmailTransport, OutboundEmail, SmtpConfig } from '../src/email/types.js';
import {
  EMAIL_CAMPAIGN_RUN_KIND,
  EMAIL_CAMPAIGN_RUN_MAX_ATTEMPTS,
  registerEmailCampaignRunHandler,
  withCampaignGiveUp,
} from '../src/jobs/email-campaign-run.js';
import { registerEmailSendHandler } from '../src/jobs/email-send.js';
import { createJobRegistry } from '../src/jobs/registry.js';
import { JobWorker } from '../src/jobs/worker.js';
import { RealtimeHub } from '../src/realtime/hub.js';
import { rbacPlugin } from '../src/plugins/rbac.js';
import { emailTemplatesRoutes } from '../src/routes/email-templates/index.js';
import type { EmailDocumentDetailView, EmailRunView } from '../src/routes/email-templates/schema.js';
import { buildBareApp, type BareApp } from './jobs-helpers.js';
import { TEST_SECRET } from './helpers.js';
import { META_ENGINES, type MetaHandle } from './meta-dialects.js';

/** The jobs-helpers poll takes a sync predicate; the run row is read through the repo, so this one is async. */
async function pollUntil(condition: () => Promise<boolean> | boolean, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error('pollUntil(): condition not met in time');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function configureSmtp(meta: MetaDb): Promise<void> {
  await settingsRepo(meta).set(
    'email.smtp',
    {
      host: 'localhost',
      port: 587,
      user: 'postmaster',
      passEncrypted: encryptSecret('relay-password', emailSecretKey(TEST_SECRET)),
      from: 'Adminium <no-reply@adminium.test>',
      secure: false,
    },
    { updatedBy: null },
  );
}

interface Recorder {
  sent: OutboundEmail[];
  /** Addresses that are refused; the count is how many times each still refuses. */
  refuse: Map<string, number>;
  /** When set, the transport waits here before each send (cancel tests). */
  gate: (() => Promise<void>) | null;
  make: (cfg: SmtpConfig) => EmailTransport;
}

function recorder(): Recorder {
  const rec: Recorder = {
    sent: [],
    refuse: new Map(),
    gate: null,
    make: () => ({
      send: async (msg) => {
        if (rec.gate !== null) await rec.gate();
        const left = rec.refuse.get(msg.to) ?? 0;
        if (left > 0) {
          rec.refuse.set(msg.to, left - 1);
          throw new Error(`451 try again later (${msg.to})`);
        }
        rec.sent.push(msg);
      },
    }),
  };
  return rec;
}

for (const engine of META_ENGINES) {
  describe.skipIf(!engine.available)(`email.campaign-run [${engine.name}]`, () => {
    let handle: MetaHandle;
    let meta: MetaDb;
    let app: BareApp;
    let manager: User;
    let viewer: User;
    let transport: Recorder;
    let registry: ReturnType<typeof createJobRegistry>;
    let worker: JobWorker;
    let hub: RealtimeHub;
    /** The batches' row check: where a test holds a batch between two rows. */
    let gate: () => Promise<'send'>;

    async function role(slug: string): Promise<Role> {
      const found = await rolesRepo(meta).findBySlug(slug);
      if (found === null) throw new Error(`missing built-in role ${slug}`);
      return found;
    }

    beforeEach(async () => {
      resetEmailRuntime();
      handle = await engine.make();
      meta = handle.meta;
      await seedBuiltinEmailTemplates(meta, 1_000);
      await configureSmtp(meta);
      const users = usersRepo(meta);
      manager = await users.create({ email: 'ava@adminium.test', name: 'Ava Reyes', status: 'active' });
      viewer = await users.create({ email: 'liam@adminium.test', name: 'Liam Ng', status: 'active' });
      await rolesRepo(meta).assignToUser(manager.id, (await role('super-admin')).id);
      await rolesRepo(meta).assignToUser(viewer.id, (await role('viewer')).id);

      transport = recorder();
      registry = createJobRegistry();
      hub = new RealtimeHub();
      registerEmailSendHandler(registry, { meta, secret: TEST_SECRET, createTransport: transport.make, onGiveUp: withCampaignGiveUp(meta) });
      gate = async () => 'send';
      registerEmailCampaignRunHandler(registry, { meta, secret: TEST_SECRET, hub, seams: { checkRow: () => gate() } });
      worker = new JobWorker({ meta, registry, hub, workerId: 'campaign-test:1', backoffBaseMs: 1, pollIntervalMs: 5 });

      app = buildBareApp();
      app.addHook('onRequest', async (request) => {
        const id = request.headers['x-test-user-id'];
        if (typeof id === 'string' && id.length > 0) {
          (request as unknown as { user: { id: string; name: string } }).user = { id, name: id };
        }
      });
      await app.register(rbacPlugin, { meta });
      await app.register(
        emailTemplatesRoutes({ meta, secret: TEST_SECRET, cancelRunningJob: (jobId) => worker.requestCancel(jobId) }),
      );
      await app.ready();
    });

    afterEach(async () => {
      await worker.stop();
      hub.close();
      resetEmailRuntime();
      await app.close();
      await handle.destroy();
    });

    const as = (user: User) => ({ 'x-test-user-id': user.id });

    async function campaign(): Promise<EmailDocumentDetailView> {
      const res = await app.inject({
        method: 'POST',
        url: '/email-templates',
        headers: as(manager),
        payload: { kind: 'campaign', name: 'Weekly digest', starter: 'digest' },
      });
      expect(res.statusCode, res.body).toBe(201);
      return res.json() as EmailDocumentDetailView;
    }

    async function send(id: string, body: Record<string, unknown> = { audience: { kind: 'users' } }, user = manager) {
      return await app.inject({ method: 'POST', url: `/email-templates/${id}/send`, headers: as(user), payload: body });
    }

    it('a placeholder no recipient\'s send would fill stops the send, by name, and a backup lets it go', async () => {
      const doc = await campaign();
      const save = async (subject: string) => {
        const put = await app.inject({ method: 'PUT', url: `/email-templates/${doc.id}`, headers: as(manager), payload: { name: doc.name, category: doc.category, enabled: true, document: { ...doc.document, subject } } });
        expect(put.statusCode, put.body).toBe(200);
      };
      const preview = async () => (await app.inject({ method: 'POST', url: `/email-templates/${doc.id}/audience/preview`, headers: as(manager), payload: { audience: { kind: 'users' } } })).json() as { unfilled: string[] };

      // What a campaign gives every recipient is asked of nobody.
      await save('Your week, {{first_name}} ({{email}}, {{name}}, {{appName}})');
      expect((await preview()).unfilled).toEqual([]);

      // A misspelt name would reach everyone as written: the dialog is told, and the send is refused.
      await save('Your week, {{frist_name}}');
      expect((await preview()).unfilled).toEqual(['frist_name']);
      const refused = await send(doc.id);
      expect(refused.statusCode).toBe(422);
      expect(refused.json()).toMatchObject({ error: { code: 'PLACEHOLDER_UNFILLED', details: { placeholders: ['frist_name'] } } });
      expect(refused.json().error.message).toContain('Nothing fills {{frist_name}} in this campaign.');
      expect(await emailRunsRepo(meta).listByTemplate(doc.id)).toHaveLength(0);

      // With a backup of its own it says what to write, and goes.
      await save('Your week, {{frist_name|there}}');
      expect((await preview()).unfilled).toEqual([]);
      expect((await send(doc.id)).statusCode).toBe(202);
    });

    it('resolves the audience live: opted-out and suspended are skipped, a translated sibling serves its locale', async () => {
      const users = usersRepo(meta);
      const optedOut = await users.create({ email: 'no@adminium.test', name: 'No Thanks', status: 'active' });
      await notificationPrefsRepo(meta).upsert(optedOut.id, EMAIL_CAMPAIGN_PREF_KIND, { inApp: true, email: false, push: false });
      await users.create({ email: 'gone@adminium.test', name: 'Gone', status: 'suspended' });
      const german = await users.create({ email: 'ute@adminium.test', name: 'Ute Berger', status: 'active' });
      await userPrefsRepo(meta).set(german.id, { locale: 'de_DE' });

      const doc = await campaign();
      // A German variation, saved (so it counts as translated), with its own subject.
      const de = (
        await app.inject({ method: 'POST', url: `/email-templates/${doc.id}/languages`, headers: as(manager), payload: { locale: 'de_DE' } })
      ).json() as EmailDocumentDetailView;
      const put = await app.inject({
        method: 'PUT',
        url: `/email-templates/${de.id}`,
        headers: as(manager),
        payload: { name: de.name, category: de.category, enabled: false, document: { ...de.document, subject: 'Deine Woche, {{first_name}}' } },
      });
      expect(put.statusCode, put.body).toBe(200);

      const preview = await app.inject({
        method: 'POST',
        url: `/email-templates/${doc.id}/audience/preview`,
        headers: as(manager),
        payload: { audience: { kind: 'users' } },
      });
      expect(preview.json()).toEqual({ total: 4, skipped: 1, unfilled: [], estimateMinutes: null });
      expect((await resolveCampaignAudience(meta, { kind: 'users' })).recipients.map((u) => u.email)).toEqual([
        'ava@adminium.test',
        'liam@adminium.test',
        'ute@adminium.test',
      ]);

      const res = await send(doc.id);
      expect(res.statusCode, res.body).toBe(202);
      const { run } = res.json() as { run: EmailRunView };
      expect(run.status).toBe('scheduled');
      expect(run.jobId).not.toBeNull();

      worker.start();
      await pollUntil(async () => (await emailRunsRepo(meta).findById(run.id))?.status === 'sent' && transport.sent.length === 3);
      await worker.stop();

      const finished = await emailRunsRepo(meta).findById(run.id);
      expect(finished).toMatchObject({ status: 'sent', state: 'done', total: 4, sent: 3, failed: 0, skipped: 1, failures: [] });
      // The opted-out account is in the log, skipped; the suspended one is not there at all.
      expect(await emailSendsRepo(meta).counts(run.id)).toEqual({ sent: 3, 'skipped-consent': 1 });
      const toUte = transport.sent.find((m) => m.to === 'ute@adminium.test');
      expect(toUte?.subject).toBe('Deine Woche, Ute');
      expect(transport.sent.find((m) => m.to === 'liam@adminium.test')?.subject).toBe(doc.document.subject);
      // Per-recipient vars, the mark by cid, the configured From untouched (no brand sender).
      expect(toUte?.html).toContain('cid:mark');
      expect(toUte?.attachments?.[0]?.cid).toBe('mark');
      expect(toUte?.from).toBeUndefined();

      // The creator's notice.
      const notes = await notificationsRepo(meta).listForUser(manager.id);
      expect(notes.some((n) => n.kind === EMAIL_CAMPAIGN_SENT_KIND && n.body === '3 sent · 0 failed')).toBe(true);

      // The manager's summary derives the pill from the latest run (D2).
      const list = (await app.inject({ method: 'GET', url: '/email-templates?kind=campaign', headers: as(viewer) })).json() as {
        items: { id: string; run?: EmailRunView }[];
      };
      expect(list.items.find((i) => i.id === doc.id)?.run).toMatchObject({ status: 'sent', sent: 3, skipped: 1 });
      const runs = (await app.inject({ method: 'GET', url: `/email-templates/${doc.id}/runs`, headers: as(viewer) })).json() as { runs: EmailRunView[] };
      expect(runs.runs).toHaveLength(1);
    });

    it('the mail queue tries a refused message again, and counts the address as a failure only when it gives up', async () => {
      transport.refuse.set('liam@adminium.test', 1); // one refusal, then accepted
      transport.refuse.set('ava@adminium.test', 99); // always refused
      const doc = await campaign();
      const { run } = (await send(doc.id)).json() as { run: EmailRunView };
      worker.start();
      await pollUntil(async () => (await emailRunsRepo(meta).findById(run.id))?.failed === 1 && transport.sent.length === 1);
      await worker.stop();
      const finished = await emailRunsRepo(meta).findById(run.id);
      expect(finished).toMatchObject({ status: 'sent', sent: 1, failed: 1, skipped: 0 });
      expect(finished?.failures).toEqual([{ to: 'ava@adminium.test', error: '451 try again later (ava@adminium.test)' }]);
      expect(transport.sent.map((m) => m.to)).toEqual(['liam@adminium.test']);
      expect(await emailSendsRepo(meta).counts(run.id)).toEqual({ sent: 1, failed: 1 });
    });

    it('a cancel mid-run stops it for good: who got it keeps it, nobody after is sent', async () => {
      await usersRepo(meta).create({ email: 'third@adminium.test', name: 'Third', status: 'active' });
      const doc = await campaign();
      let release: () => void = () => {};
      let checks = 0;
      gate = async () => {
        checks += 1;
        if (checks === 2) await new Promise<void>((resolve) => (release = resolve));
        return 'send';
      };
      const { run } = (await send(doc.id)).json() as { run: EmailRunView };
      worker.start();
      await pollUntil(() => checks === 2);
      // The route reaches the worker through `cancelRunningJob`.
      const cancel = await app.inject({ method: 'POST', url: `/email-runs/${run.id}/cancel`, headers: as(manager) });
      expect(cancel.statusCode, cancel.body).toBe(200);
      expect((cancel.json() as { run: EmailRunView }).run).toMatchObject({ status: 'cancelled', state: 'stopped' });
      release();
      await pollUntil(() => transport.sent.length === 1);
      await worker.stop();
      const finished = await emailRunsRepo(meta).findById(run.id);
      expect(finished).toMatchObject({ status: 'cancelled', state: 'stopped', sent: 1 });
      // The first went before the cancel; the second was being checked when it came; the third never started.
      expect(transport.sent.map((m) => m.to)).toEqual(['ava@adminium.test']);
      expect(await emailSendsRepo(meta).counts(run.id)).toEqual({ sent: 1, queued: 2 });
    });

    it('a run from before the ledger that a crash left sending is never sent again', async () => {
      const doc = await campaign();
      const { run } = (await send(doc.id)).json() as { run: EmailRunView };
      // How such a run looked: claimed by a process that died, `running`, no state, nobody written down.
      expect((await jobsRepo(meta).claim('campaign-test:gone'))?.id).toBe(run.jobId);
      await meta.db.updateTable('adminium_email_runs').set({ status: 'running', state: null, startedAt: Date.now() }).where('id', '=', run.id).execute();

      // A second process, past the stale window, reclaims the job.
      const later = new JobWorker({
        meta,
        registry,
        hub,
        workerId: 'campaign-test:later',
        backoffBaseMs: 1,
        now: () => Date.now() + JOB_STALE_LOCK_MS + 1_000,
      });
      expect(await later.runOnce()).toBe(1);

      // Nobody is mailed: who already got it is not known.
      expect(transport.sent).toHaveLength(0);
      const finished = await emailRunsRepo(meta).findById(run.id);
      expect(finished).toMatchObject({ status: 'failed', state: 'done' });
      expect(finished?.failures[0]?.error).toContain('stopped while this run was sending');
      expect(await emailSendsRepo(meta).counts(run.id)).toEqual({});
    });

    it('a run that finished before its job was marked done is not sent again', async () => {
      const doc = await campaign();
      const { run } = (await send(doc.id)).json() as { run: EmailRunView };
      // The process claimed the job, sent the run, then died before `complete`.
      expect((await jobsRepo(meta).claim('campaign-test:gone'))?.id).toBe(run.jobId);
      await emailRunsRepo(meta).update(run.id, { status: 'sent', sent: 2, total: 2 });

      const later = new JobWorker({
        meta,
        registry,
        hub,
        workerId: 'campaign-test:later',
        now: () => Date.now() + JOB_STALE_LOCK_MS + 1_000,
      });
      expect(await later.runOnce()).toBe(1);
      expect(transport.sent).toHaveLength(0);
      expect(await emailRunsRepo(meta).findById(run.id)).toMatchObject({ status: 'sent', sent: 2 });
      expect((await jobsRepo(meta).findById(run.jobId ?? ''))?.status).toBe('succeeded');
    });

    it('schedules with runAt, refuses a second send while scheduled, and cancels the scheduled job', async () => {
      const doc = await campaign();
      const later = Date.now() + 60 * 60_000;
      const res = await send(doc.id, { audience: { kind: 'users', roleIds: [] }, scheduleAt: later });
      expect(res.statusCode, res.body).toBe(202);
      const { run } = res.json() as { run: EmailRunView };
      expect(run.scheduledAt).toBe(later);
      const job = await jobsRepo(meta).findById(run.jobId ?? '');
      expect(job?.runAt).toBe(later);
      expect(job?.kind).toBe(EMAIL_CAMPAIGN_RUN_KIND);
      expect(job?.maxAttempts).toBe(EMAIL_CAMPAIGN_RUN_MAX_ATTEMPTS);

      const again = await send(doc.id);
      expect(again.statusCode).toBe(409);
      expect((again.json() as { error: { details: { status: string } } }).error.details.status).toBe('scheduled');

      const cancel = await app.inject({ method: 'POST', url: `/email-runs/${run.id}/cancel`, headers: as(manager) });
      expect(cancel.statusCode).toBe(200);
      expect((cancel.json() as { run: EmailRunView }).run.status).toBe('cancelled');
      expect((await jobsRepo(meta).findById(run.jobId ?? ''))?.status).toBe('cancelled');
      expect((await app.inject({ method: 'POST', url: `/email-runs/${run.id}/cancel`, headers: as(manager) })).statusCode).toBe(409);
      // Cancelled → a new send is allowed again.
      expect((await send(doc.id)).statusCode).toBe(202);
    });

    it('refuses a template, an archived campaign, a past schedule, an unconfigured relay, and a viewer', async () => {
      const template = (
        await app.inject({ method: 'POST', url: '/email-templates', headers: as(manager), payload: { kind: 'template', name: 'T' } })
      ).json() as EmailDocumentDetailView;
      expect((await send(template.id)).statusCode).toBe(409);

      const doc = await campaign();
      expect((await send(doc.id, { audience: { kind: 'users' }, scheduleAt: Date.now() - 3_600_000 })).statusCode).toBe(422);
      expect((await send(doc.id, { audience: { kind: 'users' } }, viewer)).statusCode).toBe(403);

      await app.inject({ method: 'PATCH', url: `/email-templates/${doc.id}`, headers: as(manager), payload: { archived: true } });
      expect((await send(doc.id)).statusCode).toBe(409);
      await app.inject({ method: 'PATCH', url: `/email-templates/${doc.id}`, headers: as(manager), payload: { archived: false } });

      await settingsRepo(meta).set('email.smtp', null, { updatedBy: null });
      expect((await send(doc.id)).statusCode).toBe(409);
    });

    it('archiving a scheduled campaign cancels its run and job', async () => {
      const doc = await campaign();
      const { run } = (await send(doc.id, { audience: { kind: 'users' }, scheduleAt: Date.now() + 3_600_000 })).json() as { run: EmailRunView };
      await app.inject({ method: 'PATCH', url: `/email-templates/${doc.id}`, headers: as(manager), payload: { archived: true } });
      expect((await emailRunsRepo(meta).findById(run.id))?.status).toBe('cancelled');
      expect((await jobsRepo(meta).findById(run.jobId ?? ''))?.status).toBe('cancelled');
    });
  });
}
