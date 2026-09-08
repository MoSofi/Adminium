// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Campaign runs (39-email-templates-and-campaigns.md D11, D12; 39-T15): the
 * `email.campaign-run` handler through a recorder transport, and the four
 * campaign routes through a bare app with the real rbac plugin.
 *
 * The assertions that carry the wave: the audience is resolved LIVE (an opted
 * -out and a suspended account are skipped and counted), a recipient whose
 * locale has a translated sibling gets that sibling, a refused send retries
 * once and then counts as a failure with the address, a cancel mid-run keeps
 * the counts so far, a scheduled send rides `runAt`, and a second send while
 * one is scheduled is a 409.
 */
import BetterSqlite3 from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createSqliteMetaDb,
  emailRunsRepo,
  firstRun,
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
import { EMAIL_CAMPAIGN_RUN_KIND, registerEmailCampaignRunHandler } from '../src/jobs/email-campaign-run.js';
import { createJobRegistry } from '../src/jobs/registry.js';
import { JobWorker } from '../src/jobs/worker.js';
import { RealtimeHub } from '../src/realtime/hub.js';
import { rbacPlugin } from '../src/plugins/rbac.js';
import { emailTemplatesRoutes } from '../src/routes/email-templates/index.js';
import type { EmailDocumentDetailView, EmailRunView } from '../src/routes/email-templates/schema.js';
import { buildBareApp, type BareApp } from './jobs-helpers.js';
import { TEST_SECRET } from './helpers.js';

/** The jobs-helpers poll takes a sync predicate; the run row is read through the repo, so this one is async. */
async function pollUntil(condition: () => Promise<boolean> | boolean, timeoutMs = 5_000): Promise<void> {
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

describe('email.campaign-run (39-T15)', () => {
  let meta: MetaDb;
  let app: BareApp;
  let manager: User;
  let viewer: User;
  let transport: Recorder;
  let registry: ReturnType<typeof createJobRegistry>;
  let worker: JobWorker;
  let hub: RealtimeHub;

  async function role(slug: string): Promise<Role> {
    const found = await rolesRepo(meta).findBySlug(slug);
    if (found === null) throw new Error(`missing built-in role ${slug}`);
    return found;
  }

  beforeEach(async () => {
    resetEmailRuntime();
    meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
    await firstRun(meta);
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
    registerEmailCampaignRunHandler(registry, {
      meta,
      secret: TEST_SECRET,
      createTransport: transport.make,
      hub,
      retryDelayMs: 1,
    });
    worker = new JobWorker({ meta, registry, hub, workerId: 'campaign-test:1', backoffBaseMs: 1 });

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
    await meta.db.destroy();
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
    expect(preview.json()).toEqual({ total: 4, skipped: 1 });
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
    await pollUntil(async () => (await emailRunsRepo(meta).findById(run.id))?.status === 'sent');
    await worker.stop();

    const finished = await emailRunsRepo(meta).findById(run.id);
    expect(finished).toMatchObject({ status: 'sent', total: 4, sent: 3, failed: 0, skipped: 1, failures: [] });
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

  it('retries a refused send once, then counts the address as a failure and moves on', async () => {
    transport.refuse.set('liam@adminium.test', 1); // one refusal, then accepted
    transport.refuse.set('ava@adminium.test', 5); // always refused
    const doc = await campaign();
    const { run } = (await send(doc.id)).json() as { run: EmailRunView };
    worker.start();
    await pollUntil(async () => (await emailRunsRepo(meta).findById(run.id))?.status === 'sent');
    await worker.stop();
    const finished = await emailRunsRepo(meta).findById(run.id);
    expect(finished).toMatchObject({ status: 'sent', sent: 1, failed: 1, skipped: 0 });
    expect(finished?.failures).toEqual([{ to: 'ava@adminium.test', error: '451 try again later (ava@adminium.test)' }]);
  });

  it('a cancel mid-run keeps the counts so far and lands in `cancelled`', async () => {
    await usersRepo(meta).create({ email: 'third@adminium.test', name: 'Third', status: 'active' });
    const doc = await campaign();
    let release: () => void = () => {};
    let sends = 0;
    transport.gate = async () => {
      sends += 1;
      if (sends === 2) await new Promise<void>((resolve) => (release = resolve));
    };
    const { run } = (await send(doc.id)).json() as { run: EmailRunView };
    worker.start();
    await pollUntil(() => sends === 2);
    // The route reaches the worker through `cancelRunningJob`.
    const cancel = await app.inject({ method: 'POST', url: `/email-runs/${run.id}/cancel`, headers: as(manager) });
    expect(cancel.statusCode, cancel.body).toBe(200);
    release();
    await pollUntil(async () => (await emailRunsRepo(meta).findById(run.id))?.status === 'cancelled');
    await worker.stop();
    const finished = await emailRunsRepo(meta).findById(run.id);
    expect(finished?.status).toBe('cancelled');
    // The first send landed before the cancel; the second was in flight when it
    // arrived; the third never started.
    expect(finished?.sent).toBe(2);
    expect(transport.sent).toHaveLength(2);
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
    expect(job?.maxAttempts).toBe(1);

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
