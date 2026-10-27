// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Campaign runs on the send ledger, on SQLite, PostgreSQL and MySQL: the
 * batches, the real `email.send` queue behind them (with a recorder for a
 * mail server), and the campaign routes as a person with the grant and as one
 * without it.
 *
 * What it proves:
 *  - a run of 500 whose server dies HARD with a batch in flight after 120 are
 *    handed over (the batch never comes back, its job's lock goes stale and
 *    is reclaimed) ends with all 500 mailed and nobody twice — and the dead
 *    batch waking later changes nothing;
 *  - the same after a CLEAN stop mid-batch (`JobWorker.stop`) and a new worker;
 *  - a paused run hands nothing, "go on" resumes it, "stop for good" leaves
 *    the rest queued and says how many;
 *  - batches are spaced by the cap on a moved clock, and two runs share the
 *    hour's count;
 *  - an edit after the start changes nothing in flight, and a deleted
 *    campaign keeps its runs and their logs;
 *  - the log's summary, filters, search, pages and CSV match the rows, a
 *    message the mail queue gives up on reads `failed` (and "will try again"
 *    only while it is tried), and a role without the grant gets 403.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  emailRunsRepo,
  emailSendsRepo,
  jobsRepo,
  notificationPrefsRepo,
  rolesRepo,
  settingsRepo,
  usersRepo,
  JOB_STALE_LOCK_MS,
  type EmailSendState,
  type MetaDb,
  type Role,
  type User,
} from '@adminium/meta';

import { encryptSecret } from '../src/config/secrets.js';
import { EMAIL_CAMPAIGN_PREF_KIND } from '../src/email/audience.js';
import { seedBuiltinEmailTemplates } from '../src/email/builtins.js';
import { emailSecretKey } from '../src/email/config.js';
import { resetEmailRuntime } from '../src/email/send.js';
import type { EmailTransport, OutboundEmail } from '../src/email/types.js';
import {
  EMAIL_CAMPAIGN_RUN_KIND,
  registerEmailCampaignRunHandler,
  withCampaignGiveUp,
  type CampaignRowVerdict,
} from '../src/jobs/email-campaign-run.js';
import { registerEmailSendHandler } from '../src/jobs/email-send.js';
import { sendIdOfMessageId } from '../src/email/message-id.js';
import { markSendLog } from '../src/routes/mail-door/notices.js';
import { createJobRegistry } from '../src/jobs/registry.js';
import { JobWorker } from '../src/jobs/worker.js';
import { rbacPlugin } from '../src/plugins/rbac.js';
import { RealtimeHub } from '../src/realtime/hub.js';
import { emailTemplatesRoutes } from '../src/routes/email-templates/index.js';
import type { EmailDocumentDetailView, EmailRunView } from '../src/routes/email-templates/schema.js';
import { TEST_SECRET } from './helpers.js';
import { buildBareApp, type BareApp } from './jobs-helpers.js';
import { META_ENGINES, type MetaHandle } from './meta-dialects.js';

const HOUR = 3_600_000;

async function pollUntil(condition: () => Promise<boolean> | boolean, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error('pollUntil(): condition not met in time');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/** Runs due jobs until none is left (`runOnce` returns 0), with a deadline. */
async function drain(worker: JobWorker, timeoutMs = 60_000): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  let total = 0;
  for (;;) {
    const ran = await worker.runOnce();
    total += ran;
    if (ran === 0) return total;
    if (Date.now() > deadline) throw new Error('drain(): jobs still due after the deadline');
  }
}

interface Recorder {
  sent: OutboundEmail[];
  /** Every try that was refused, as it was handed over. */
  refused: OutboundEmail[];
  /** Addresses refused; the count is how many times each still refuses. */
  refuse: Map<string, number>;
  make: () => EmailTransport;
}

function recorder(): Recorder {
  const rec: Recorder = {
    sent: [],
    refused: [],
    refuse: new Map(),
    make: () => ({
      send: async (msg) => {
        const left = rec.refuse.get(msg.to) ?? 0;
        if (left > 0) {
          rec.refuse.set(msg.to, left - 1);
          rec.refused.push(msg);
          throw new Error(`451 try again later (${msg.to})`);
        }
        rec.sent.push(msg);
      },
    }),
  };
  return rec;
}

for (const engine of META_ENGINES) {
  describe.skipIf(!engine.available)(`campaign runs on the send ledger [${engine.name}]`, () => {
    let handle: MetaHandle;
    let meta: MetaDb;
    let app: BareApp;
    let manager: User;
    let viewer: User;
    let transport: Recorder;
    let registry: ReturnType<typeof createJobRegistry>;
    let hub: RealtimeHub;
    let clock: number;
    let checkRow: (row: { address: string; name: string }) => Promise<CampaignRowVerdict>;
    const workers: JobWorker[] = [];
    /** Every gate a test holds a batch at: opened before the workers stop, so a failed test never leaves one waiting. */
    const gates: (() => void)[] = [];
    const held = (): Promise<void> => new Promise<void>((resolve) => gates.push(resolve));
    const now = (): number => clock;

    const worker = (id: string, more: Partial<ConstructorParameters<typeof JobWorker>[0]> = {}): JobWorker => {
      const made = new JobWorker({ meta, registry, hub, workerId: `ledger-test:${id}`, backoffBaseMs: 1, concurrency: 4, now, ...more });
      workers.push(made);
      return made;
    };

    async function role(slug: string): Promise<Role> {
      const found = await rolesRepo(meta).findBySlug(slug);
      if (found === null) throw new Error(`missing built-in role ${slug}`);
      return found;
    }

    beforeEach(async () => {
      resetEmailRuntime();
      handle = await engine.make();
      meta = handle.meta;
      // A whole hour ahead of the real clock, a minute into it: every job queued at a real moment is due.
      clock = Math.ceil(Date.now() / HOUR) * HOUR + HOUR + 60_000;
      await seedBuiltinEmailTemplates(meta, 1_000);
      await settingsRepo(meta).set(
        'email.smtp',
        { host: 'localhost', port: 587, user: 'postmaster', passEncrypted: encryptSecret('relay-password', emailSecretKey(TEST_SECRET)), from: 'Shop <news@shop.test>', secure: false },
        { updatedBy: null },
      );
      const users = usersRepo(meta);
      manager = await users.create({ email: 'ava@shop.test', name: 'Ava Reyes', status: 'active' });
      viewer = await users.create({ email: 'liam@shop.test', name: 'Liam Ng', status: 'active' });
      await rolesRepo(meta).assignToUser(manager.id, (await role('super-admin')).id);
      await rolesRepo(meta).assignToUser(viewer.id, (await role('viewer')).id);

      transport = recorder();
      checkRow = async () => 'send';
      registry = createJobRegistry();
      hub = new RealtimeHub();
      registerEmailSendHandler(registry, { meta, secret: TEST_SECRET, createTransport: transport.make, onGiveUp: withCampaignGiveUp(meta) });
      registerEmailCampaignRunHandler(registry, { meta, secret: TEST_SECRET, hub, now, seams: { checkRow: (row) => checkRow(row) } });

      app = buildBareApp();
      app.addHook('onRequest', async (request) => {
        const id = request.headers['x-test-user-id'];
        if (typeof id === 'string' && id.length > 0) (request as unknown as { user: { id: string; name: string } }).user = { id, name: id };
      });
      await app.register(rbacPlugin, { meta, now });
      await app.register(
        emailTemplatesRoutes({
          meta,
          secret: TEST_SECRET,
          cancelRunningJob: (jobId) => workers.some((w) => w.requestCancel(jobId)),
        }),
      );
      await app.ready();
    });

    afterEach(async () => {
      for (const open of gates.splice(0)) open();
      for (const w of workers.splice(0)) await w.stop({ drainTimeoutMs: 50 });
      hub.close();
      resetEmailRuntime();
      await app.close();
      await handle.destroy();
    });

    const as = (user: User) => ({ 'x-test-user-id': user.id });

    async function people(count: number, from = 1): Promise<void> {
      const users = usersRepo(meta);
      for (let i = from; i < from + count; i += 1) {
        await users.create({ email: `p${String(i).padStart(3, '0')}@shop.test`, name: `Person ${String(i)}`, status: 'active' });
      }
    }

    async function campaign(name = 'Weekly digest'): Promise<EmailDocumentDetailView> {
      const res = await app.inject({ method: 'POST', url: '/email-templates', headers: as(manager), payload: { kind: 'campaign', name, starter: 'digest' } });
      expect(res.statusCode, res.body).toBe(201);
      return res.json() as EmailDocumentDetailView;
    }

    async function send(id: string, more: Record<string, unknown> = {}): Promise<EmailRunView> {
      const res = await app.inject({ method: 'POST', url: `/email-templates/${id}/send`, headers: as(manager), payload: { audience: { kind: 'users' }, ...more } });
      expect(res.statusCode, res.body).toBe(202);
      return (res.json() as { run: EmailRunView }).run;
    }

    async function states(runId: string): Promise<Partial<Record<EmailSendState, number>>> {
      return await emailSendsRepo(meta).counts(runId);
    }

    /** Every message the recorder took, by address: each must be there once. */
    function mailedOnce(expected: number): void {
      const byAddress = new Map<string, number>();
      for (const msg of transport.sent) byAddress.set(msg.to, (byAddress.get(msg.to) ?? 0) + 1);
      expect(transport.sent).toHaveLength(expected);
      expect(byAddress.size).toBe(expected);
      expect([...byAddress.values()].every((n) => n === 1)).toBe(true);
    }

    async function emailSendJobs(): Promise<number> {
      const row = await meta.db.selectFrom('adminium_jobs').select((eb) => eb.fn.countAll<number>().as('n')).where('kind', '=', 'email.send').executeTakeFirst();
      return Number(row?.n ?? 0);
    }

    it('a server killed hard after 120 of 500 goes on from where it was: 500 mailed, nobody twice', async () => {
      await people(498);
      const doc = await campaign();
      const run = await send(doc.id);

      // The 121st row's check never returns: the batch is stuck holding the rest of its claim, as a crash leaves it.
      let calls = 0;
      const asleep = held();
      const wake = gates.at(-1)!;
      checkRow = async () => {
        calls += 1;
        if (calls === 121) await asleep;
        return 'send';
      };
      const crashed = worker('crashed', { concurrency: 1, lockRefreshMs: 1_000_000_000 });
      const crashedLoop = drain(crashed, 120_000);
      await pollUntil(() => calls === 121);
      const atCrash = await states(run.id);
      expect(atCrash.sent).toBe(120);
      expect(atCrash.sending).toBeGreaterThan(0);

      // Another process, once the dead batch's lock is stale, reclaims its job and carries on.
      clock += JOB_STALE_LOCK_MS + 1_000;
      await drain(worker('later'));
      expect(await emailRunsRepo(meta).findById(run.id)).toMatchObject({ status: 'sent', state: 'done', total: 500, sent: 500, failed: 0 });
      expect(await states(run.id)).toEqual({ sent: 500 });
      mailedOnce(500);
      expect(await emailSendJobs()).toBe(500);
      // The rows the dead batch held were claimed a second time; none was handed twice.
      const claimedTwice = await meta.db.selectFrom('adminium_email_sends').select((eb) => eb.fn.countAll<number>().as('n')).where('runId', '=', run.id).where('attempts', '=', 2).executeTakeFirst();
      expect(Number(claimedTwice?.n)).toBeGreaterThan(0);

      // The dead batch comes back to life: everything it held is someone else's now.
      wake();
      await crashedLoop;
      mailedOnce(500);
      expect(await emailSendJobs()).toBe(500);
    });

    it('a clean stop mid-batch puts the rest back, and a new worker sends them: 500 mailed, nobody twice', async () => {
      await people(498);
      const doc = await campaign();
      const run = await send(doc.id);

      let calls = 0;
      const gate = held();
      const release = gates.at(-1)!;
      checkRow = async () => {
        calls += 1;
        if (calls === 121) await gate;
        return 'send';
      };
      const first = worker('first', { pollIntervalMs: 5 });
      first.start();
      await pollUntil(() => calls === 121);
      // A deploy: the worker stops, waits a moment, aborts what is in flight.
      const stopping = first.stop({ drainTimeoutMs: 20 });
      await new Promise((resolve) => setTimeout(resolve, 80));
      release();
      await stopping;
      const atStop = await states(run.id);
      expect(atStop.sent).toBe(120);
      expect(atStop.sending ?? 0).toBe(0);
      expect(atStop.queued).toBe(380);
      // The stopped batch queued the next one before it ended.
      const head = await emailRunsRepo(meta).findById(run.id);
      expect((await jobsRepo(meta).findById(head?.jobId ?? ''))?.status).toBe('pending');

      await drain(worker('second'));
      expect(await emailRunsRepo(meta).findById(run.id)).toMatchObject({ status: 'sent', state: 'done', sent: 500 });
      mailedOnce(500);
      expect(await emailSendJobs()).toBe(500);
    });

    it('pause holds, go on resumes, stop for good leaves the rest queued and says how many', async () => {
      await people(3);
      const doc = await campaign();
      // One an hour per minute: a batch of one, the next a minute later.
      const run = await send(doc.id, { ratePerHour: 60 });
      const w = worker('pause');
      await drain(w);
      expect((await states(run.id)).sent).toBe(1);

      const pause = await app.inject({ method: 'POST', url: `/email-runs/${run.id}/pause`, headers: as(manager) });
      expect(pause.statusCode, pause.body).toBe(200);
      expect((pause.json() as { run: EmailRunView }).run).toMatchObject({ status: 'running', state: 'paused' });
      expect((await app.inject({ method: 'POST', url: `/email-runs/${run.id}/pause`, headers: as(manager) })).statusCode).toBe(409);
      clock += 30 * 60_000;
      await drain(w);
      expect((await states(run.id)).sent).toBe(1);

      const resume = await app.inject({ method: 'POST', url: `/email-runs/${run.id}/resume`, headers: as(manager) });
      expect(resume.statusCode, resume.body).toBe(200);
      expect((resume.json() as { run: EmailRunView }).run.state).toBe('running');
      expect((await app.inject({ method: 'POST', url: `/email-runs/${run.id}/resume`, headers: as(manager) })).statusCode).toBe(409);
      await drain(w);
      expect((await states(run.id)).sent).toBe(2);
      clock += 60_000;
      await drain(w);
      expect((await states(run.id)).sent).toBe(3);

      const progress = await app.inject({ method: 'GET', url: `/email-runs/${run.id}`, headers: as(viewer) });
      expect(progress.json()).toMatchObject({ name: 'Weekly digest', done: 3, total: 5, left: 2, estimateMinutes: 2 });

      // A viewer may not stop it.
      expect((await app.inject({ method: 'POST', url: `/email-runs/${run.id}/stop`, headers: as(viewer) })).statusCode).toBe(403);
      expect((await app.inject({ method: 'POST', url: `/email-runs/${run.id}/pause`, headers: as(viewer) })).statusCode).toBe(403);
      const stop = await app.inject({ method: 'POST', url: `/email-runs/${run.id}/stop`, headers: as(manager) });
      expect(stop.statusCode, stop.body).toBe(200);
      expect(stop.json()).toMatchObject({ left: 2, run: { status: 'cancelled', state: 'stopped' } });
      expect((await app.inject({ method: 'POST', url: `/email-runs/${run.id}/stop`, headers: as(manager) })).statusCode).toBe(409);
      expect((await app.inject({ method: 'POST', url: `/email-runs/${run.id}/resume`, headers: as(manager) })).statusCode).toBe(409);

      clock += 2 * HOUR;
      await drain(w);
      expect(await states(run.id)).toEqual({ sent: 3, queued: 2 });
      mailedOnce(3);
      const actions = (await meta.db.selectFrom('adminium_audit_log').select(['action']).where('action', 'like', 'email-campaign.%').execute()).map((row) => row.action);
      expect(actions).toEqual(expect.arrayContaining(['email-campaign.pause', 'email-campaign.resume', 'email-campaign.stop']));
    });

    it('a pause that lands in the middle of a batch stops it at the next row; go on sends the rest once', async () => {
      await people(3);
      const doc = await campaign();
      const run = await send(doc.id);
      let calls = 0;
      const gate = held();
      const release = gates.at(-1)!;
      checkRow = async () => {
        calls += 1;
        if (calls === 2) await gate;
        return 'send';
      };
      const w = worker('midway', { pollIntervalMs: 5 });
      w.start();
      await pollUntil(() => calls === 2);
      const pause = await app.inject({ method: 'POST', url: `/email-runs/${run.id}/pause`, headers: as(manager) });
      expect(pause.statusCode, pause.body).toBe(200);
      release();
      const head = (await emailRunsRepo(meta).findById(run.id))?.jobId ?? '';
      await pollUntil(async () => (await jobsRepo(meta).findById(head))?.status === 'succeeded');
      await w.stop();
      // The row being checked when the pause came went back; nothing after it was handed.
      expect(await states(run.id)).toEqual({ sent: 1, queued: 4 });

      expect((await app.inject({ method: 'POST', url: `/email-runs/${run.id}/resume`, headers: as(manager) })).statusCode).toBe(200);
      await drain(worker('after'));
      expect(await states(run.id)).toEqual({ sent: 5 });
      mailedOnce(5);
    });

    it('a batch that wakes after its rows were taken back hands none of them, even as the head of a running run', async () => {
      await people(1);
      const doc = await campaign();
      const run = await send(doc.id);
      // Two runs of the same job, as a reclaim makes them: the first stuck on its first row.
      const entry = registry.get(EMAIL_CAMPAIGN_RUN_KIND)!;
      const ctx = (signal = new AbortController().signal) => ({ jobId: run.jobId!, kind: EMAIL_CAMPAIGN_RUN_KIND, attempt: 1, maxAttempts: 5, signal, progress: () => {}, log: () => {} });
      const wakes: (() => void)[] = [];
      let calls = 0;
      checkRow = async () => {
        calls += 1;
        // The first run's first row, and the second run's last row, wait to be woken.
        if (calls === 1 || calls === 4) {
          const waiting = held();
          wakes.push(gates.at(-1)!);
          await waiting;
        }
        return 'send';
      };
      const first = entry.run({ runId: run.id }, ctx());
      await pollUntil(() => calls === 1);
      const second = entry.run({ runId: run.id }, ctx());
      await pollUntil(() => calls === 4);
      // The second took the first's rows back and handed two; the run is still running, under the same job.
      expect(await states(run.id)).toMatchObject({ sent: 2, sending: 1 });
      wakes[0]!();
      await first;
      wakes[1]!();
      await second;
      // The first, as the head, queued the next batch; the second lost the head at its last row.
      await drain(worker('rest'));
      expect(await states(run.id)).toEqual({ sent: 3 });
      expect(await emailSendJobs()).toBe(3);
      mailedOnce(3);
    });

    it('a batch job that is not the head of its run hands nothing', async () => {
      await people(3);
      const doc = await campaign();
      const run = await send(doc.id, { ratePerHour: 60 });
      const w = worker('stray');
      await drain(w);
      expect((await states(run.id)).sent).toBe(1);
      // A job for the same run that its chain no longer names (left over from a pause, say).
      const stray = await jobsRepo(meta).enqueue({ kind: EMAIL_CAMPAIGN_RUN_KIND, payload: { runId: run.id }, runAt: clock, maxAttempts: 5 }, clock);
      await drain(w);
      expect((await states(run.id)).sent).toBe(1);
      expect((await jobsRepo(meta).findById(stray.id))?.status).toBe('succeeded');
      // One batch waits for the run: the chain did not fork.
      const pending = await meta.db.selectFrom('adminium_jobs').select(['id']).where('kind', '=', EMAIL_CAMPAIGN_RUN_KIND).where('status', '=', 'pending').execute();
      expect(pending.map((job) => job.id)).toEqual([(await emailRunsRepo(meta).findById(run.id))?.jobId]);
    });

    it('spaces batches by the cap, and two runs share the hour', async () => {
      await people(3);
      const a = await campaign('A');
      const b = await campaign('B');
      const t0 = clock;
      const runA = await send(a.id, { ratePerHour: 4 });
      const runB = await send(b.id, { ratePerHour: 4 });
      const w = worker('cap');
      const headAt = async (runId: string): Promise<number | undefined> => {
        const run = await emailRunsRepo(meta).findById(runId);
        return (await jobsRepo(meta).findById(run?.jobId ?? ''))?.runAt;
      };
      const handed = async (): Promise<number> => ((await states(runA.id)).sent ?? 0) + ((await states(runB.id)).sent ?? 0);

      // Four an hour: one each, then a quarter of an hour's wait.
      await drain(w);
      expect(await handed()).toBe(2);
      expect(await headAt(runA.id)).toBe(t0 + 15 * 60_000);
      expect(await headAt(runB.id)).toBe(t0 + 15 * 60_000);
      clock += 14 * 60_000;
      await drain(w);
      expect(await handed()).toBe(2);
      clock += 60_000;
      await drain(w);
      expect(await handed()).toBe(4);

      // The hour's four are used, by the two runs together: both wait for the next hour.
      clock += 15 * 60_000;
      await drain(w);
      expect(await handed()).toBe(4);
      const nextHour = Math.floor(clock / HOUR) * HOUR + HOUR;
      expect(await headAt(runA.id)).toBe(nextHour);
      expect(await headAt(runB.id)).toBe(nextHour);
      clock = nextHour;
      await drain(w);
      expect(await handed()).toBe(6);
      // Each run handed three, never more than four an hour between them.
      expect((await states(runA.id)).sent).toBe(3);
      expect((await states(runB.id)).sent).toBe(3);
    });

    it('sends the content frozen at the start, and a deleted campaign keeps its runs and their logs', async () => {
      await people(1);
      const doc = await campaign();
      const save = async (subject: string) => {
        const put = await app.inject({ method: 'PUT', url: `/email-templates/${doc.id}`, headers: as(manager), payload: { name: doc.name, category: doc.category, enabled: true, document: { ...doc.document, subject } } });
        expect(put.statusCode, put.body).toBe(200);
      };
      await save('Version one');
      const run = await send(doc.id, { ratePerHour: 60 });
      const w = worker('frozen');
      await drain(w);
      await save('Version two');
      clock += 60_000;
      await drain(w);
      clock += 60_000;
      await drain(w);
      expect(transport.sent.map((m) => m.subject)).toEqual(['Version one', 'Version one', 'Version one']);
      expect(await emailRunsRepo(meta).findById(run.id)).toMatchObject({ status: 'sent', state: 'done' });

      // A second run, in flight when its campaign is deleted: it stops, and both runs keep their logs.
      await save('Version three');
      const second = await send(doc.id, { ratePerHour: 60 });
      await drain(w);
      const del = await app.inject({ method: 'DELETE', url: `/email-templates/${doc.id}`, headers: as(manager) });
      expect(del.statusCode, del.body).toBe(204);
      clock += HOUR;
      await drain(w);
      expect(await emailRunsRepo(meta).findById(run.id)).toMatchObject({ templateId: null, status: 'sent', sent: 3 });
      expect(await emailRunsRepo(meta).findById(second.id)).toMatchObject({ templateId: null, status: 'cancelled', state: 'stopped', sent: 1 });
      for (const [id, sent] of [[run.id, 3], [second.id, 1]] as const) {
        const log = await app.inject({ method: 'GET', url: `/email-runs/${id}/log`, headers: as(manager) });
        expect(log.statusCode, log.body).toBe(200);
        expect((log.json() as { summary: { sent: number } }).summary.sent).toBe(sent);
        expect((await app.inject({ method: 'GET', url: `/email-runs/${id}`, headers: as(manager) })).json()).toMatchObject({ name: 'Weekly digest' });
      }
      expect(transport.sent.map((m) => m.subject)).toEqual(['Version one', 'Version one', 'Version one', 'Version three']);
    });

    it('the send log: summary, filters, search, pages and CSV match the rows; the grant is asked', async () => {
      const users = usersRepo(meta);
      const ruth = await users.create({ email: 'ruth@shop.test', name: 'Ruth Adeyemi', status: 'active' });
      await users.create({ email: 'callum@shop.test', name: 'Callum Brookes', status: 'active' });
      const aisha = await users.create({ email: 'aisha@shop.test', name: 'Aisha Rahman', status: 'active' });
      await users.create({ email: 'formula@shop.test', name: '=HYPERLINK("http://x")', status: 'active' });
      await notificationPrefsRepo(meta).upsert(aisha.id, EMAIL_CAMPAIGN_PREF_KIND, { inApp: true, email: false, push: false });
      transport.refuse.set(ruth.email, 99);
      checkRow = async (row) => (row.address === 'callum@shop.test' ? { skip: 'skipped-stop', reason: 'on-the-list' } : 'send');
      const doc = await campaign();
      const run = await send(doc.id);
      const w = worker('log');
      await drain(w);

      const log = async (query = '', user = manager) => {
        const res = await app.inject({ method: 'GET', url: `/email-runs/${run.id}/log${query}`, headers: as(user) });
        expect(res.statusCode, res.body).toBe(200);
        return res.json() as { summary: Record<string, number>; rows: { name: string; address: string; state: string; reason: string | null; retrying: boolean; time: number | null }[]; next: number | null };
      };
      // Ruth's first try was refused: handed over, and still being tried.
      const early = await log('?q=ruth');
      expect(early.rows).toEqual([expect.objectContaining({ state: 'sent', retrying: true, reason: '451 try again later (ruth@shop.test)' })]);

      // The mail queue's last try fails: the row reads failed, the run counts it.
      for (let i = 0; i < 6; i += 1) {
        clock += 60_000;
        await drain(w);
      }
      const all = await log();
      expect(all.summary).toEqual({ total: 6, sent: 3, waiting: 0, skipped: 2, bounced: 0, spam: 0, failed: 1, unsubscribed: 0 });
      expect(all.rows.map((row) => [row.address, row.state])).toEqual([
        ['ava@shop.test', 'sent'],
        ['liam@shop.test', 'sent'],
        ['ruth@shop.test', 'failed'],
        ['callum@shop.test', 'skipped-stop'],
        ['formula@shop.test', 'sent'],
        ['aisha@shop.test', 'skipped-consent'],
      ]);
      expect(all.rows.find((row) => row.address === 'ruth@shop.test')).toMatchObject({ retrying: false, reason: '451 try again later (ruth@shop.test)' });
      expect(all.rows.find((row) => row.address === 'aisha@shop.test')?.reason).toBe('campaign-mail-off');
      expect(all.next).toBeNull();
      expect(await emailRunsRepo(meta).findById(run.id)).toMatchObject({ status: 'sent', total: 6, sent: 3, failed: 1, skipped: 2, failures: [{ to: 'ruth@shop.test', error: '451 try again later (ruth@shop.test)' }] });

      expect((await log('?filter=skipped')).rows.map((row) => row.name)).toEqual(['Callum Brookes', 'Aisha Rahman']);
      expect((await log('?filter=failed')).rows.map((row) => row.name)).toEqual(['Ruth Adeyemi']);
      expect((await log('?filter=waiting')).rows).toEqual([]);
      expect((await log('?q=RAHMAN')).rows.map((row) => row.address)).toEqual(['aisha@shop.test']);
      expect((await log('?q=shop.test&filter=sent')).rows.length).toBe(3);
      const page1 = await log('?limit=4');
      expect(page1.rows).toHaveLength(4);
      const page2 = await log(`?limit=4&after=${String(page1.next)}`);
      expect([...page1.rows, ...page2.rows].map((row) => row.address)).toEqual(all.rows.map((row) => row.address));
      expect(page2.next).toBeNull();

      const csv = await app.inject({ method: 'GET', url: `/email-runs/${run.id}/log.csv?filter=all`, headers: as(manager) });
      expect(csv.statusCode, csv.body).toBe(200);
      expect(csv.headers['content-type']).toContain('text/csv');
      const lines = csv.body.replace(/^﻿/, '').trimEnd().split('\r\n');
      expect(lines[0]).toBe('name,address,state,time,detail');
      expect(lines).toHaveLength(7);
      expect(lines[3]).toMatch(/^Ruth Adeyemi,ruth@shop\.test,failed,\d{4}-\d\d-\d\dT[^,]+,451 try again later \(ruth@shop\.test\)$/);
      expect(lines[5]).toBe(`"'=HYPERLINK(""http://x"")",formula@shop.test,sent,${new Date(all.rows[4]!.time!).toISOString()},`);
      expect(lines[6]).toBe('Aisha Rahman,aisha@shop.test,skipped-consent,' + new Date(all.rows[5]!.time!).toISOString() + ',campaign-mail-off');
      const skippedCsv = await app.inject({ method: 'GET', url: `/email-runs/${run.id}/log.csv?filter=skipped&q=callum`, headers: as(manager) });
      expect(skippedCsv.body.replace(/^﻿/, '').trimEnd().split('\r\n')).toHaveLength(2);
      const downloads = await meta.db.selectFrom('adminium_audit_log').select(['action']).where('action', '=', 'email-campaign.log-download').execute();
      expect(downloads).toHaveLength(2);

      // Without the grant: no log, no file.
      expect((await app.inject({ method: 'GET', url: `/email-runs/${run.id}/log`, headers: as(viewer) })).statusCode).toBe(403);
      expect((await app.inject({ method: 'GET', url: `/email-runs/${run.id}/log.csv`, headers: as(viewer) })).statusCode).toBe(403);
    });

    it('every campaign mail leaves with a Message-ID naming its row (the same on a retry); a notice naming it marks that row, and the summary counts it', async () => {
      const users = usersRepo(meta);
      const ruth = await users.create({ email: 'ruth@shop.test', name: 'Ruth Adeyemi', status: 'active' });
      await users.create({ email: 'callum@shop.test', name: 'Callum Brookes', status: 'active' });
      transport.refuse.set(ruth.email, 1);
      const doc = await campaign();
      const run = await send(doc.id);
      const w = worker('message-id');
      await drain(w);
      clock += 60_000;
      await drain(w);
      const rows = await emailSendsRepo(meta).list(run.id, { limit: 50 });
      expect(transport.sent).toHaveLength(4);
      for (const msg of transport.sent) {
        const row = rows.find((one) => one.address === msg.to)!;
        // The From is news@shop.test: its domain is the Message-ID's right-hand side.
        expect(msg.messageId).toBe(`<${row.id}@shop.test>`);
        expect(sendIdOfMessageId(msg.messageId)).toBe(row.id);
      }
      // The refused first try went with the same Message-ID as the one that got through.
      expect(transport.refused.map((msg) => msg.messageId)).toEqual([`<${rows.find((one) => one.address === ruth.email)!.id}@shop.test>`]);

      const idOf = (address: string) => rows.find((one) => one.address === address)!.id;
      const marked = await markSendLog(
        meta,
        'other',
        [
          // A bounce for good naming Ruth's mail: her row reads bounced.
          { address: 'ruth@shop.test', kind: 'bounce', permanent: true, relayEventId: null, at: null, messageId: `<${idOf('ruth@shop.test')}@shop.test>` },
          // A spam report naming Callum's mail, as a service may hand it back: no brackets, other case.
          { address: 'CALLUM@shop.test', kind: 'complaint', permanent: true, relayEventId: null, at: null, messageId: `${idOf('callum@shop.test').toLowerCase()}@shop.test` },
          // A soft bounce marks nothing; nor does a notice whose address is not the row's, or a Message-ID of another shape.
          { address: 'ava@shop.test', kind: 'bounce', permanent: false, relayEventId: null, at: null, messageId: `<${idOf('ava@shop.test')}@shop.test>` },
          { address: 'someone@else.test', kind: 'bounce', permanent: true, relayEventId: null, at: null, messageId: `<${idOf('liam@shop.test')}@shop.test>` },
          { address: 'liam@shop.test', kind: 'bounce', permanent: true, relayEventId: null, at: null, messageId: '<0100018c.relay-own-id@email.amazonses.com>' },
        ],
        clock,
      );
      expect(marked).toBe(2);
      // A second notice about a row already marked changes nothing.
      expect(await markSendLog(meta, 'other', [{ address: 'ruth@shop.test', kind: 'complaint', permanent: true, relayEventId: null, at: null, messageId: `<${idOf('ruth@shop.test')}@shop.test>` }], clock)).toBe(0);
      const log = await app.inject({ method: 'GET', url: `/email-runs/${run.id}/log`, headers: as(manager) });
      expect(log.statusCode, log.body).toBe(200);
      const body = log.json() as { summary: Record<string, number>; rows: { address: string; state: string; reason: string | null }[] };
      expect(body.summary).toEqual({ total: 4, sent: 2, waiting: 0, skipped: 0, bounced: 1, spam: 1, failed: 0, unsubscribed: 0 });
      expect(body.rows.filter((row) => row.state !== 'sent').map((row) => [row.address, row.state, row.reason])).toEqual([
        ['ruth@shop.test', 'bounced', 'notice:other'],
        ['callum@shop.test', 'spam', 'notice:other'],
      ]);
    });

    it('the preview and the run say how long a capped send takes', async () => {
      await people(468);
      const doc = await campaign();
      const preview = await app.inject({ method: 'POST', url: `/email-templates/${doc.id}/audience/preview`, headers: as(manager), payload: { audience: { kind: 'users' }, ratePerHour: 100 } });
      expect(preview.json()).toEqual({ total: 470, skipped: 0, unfilled: [], estimateMinutes: 282 });
      const uncapped = await app.inject({ method: 'POST', url: `/email-templates/${doc.id}/audience/preview`, headers: as(manager), payload: { audience: { kind: 'users' } } });
      expect((uncapped.json() as { estimateMinutes: number | null }).estimateMinutes).toBeNull();
      const run = await send(doc.id, { ratePerHour: 100 });
      expect(run).toMatchObject({ ratePerHour: 100, state: 'running', status: 'scheduled' });
      expect((await jobsRepo(meta).findById(run.jobId ?? ''))?.kind).toBe(EMAIL_CAMPAIGN_RUN_KIND);
      await drain(worker('estimate'));
      // Two handed in the first batch; the rest at a hundred an hour.
      expect((await app.inject({ method: 'GET', url: `/email-runs/${run.id}`, headers: as(manager) })).json()).toMatchObject({ done: 2, total: 470, left: 468, estimateMinutes: 281 });
    });
  });
}
