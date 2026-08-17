// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The daily retention sweep (`compose.ts` `RETENTION_GC_SCHEDULE_NAME`).
 *
 * THE BUG THIS PINS. `sessionsRepo`, `passwordResetsRepo`, `jobsRepo` and
 * `auditRepo` each ship a `gc()` written against the BRIEF §8 retention policy,
 * and no line of the product called any of them. Four meta tables grew for the
 * life of every install — one `adminium_sessions` row per login forever, one
 * `adminium_jobs` row per scheduled-report tick, one `adminium_audit_log` row
 * per mutation — while `retention.auditLogDays` and `retention.jobsDays` sat in
 * Settings, writable, adjusting nothing.
 *
 * These assertions go through the SCHEDULE, not the repos: the repos were
 * already correct and already tested. What was missing was the caller, so what
 * is tested here is that composing a server registers it, that firing it deletes
 * what the policy says and keeps what it does not, and that the settings keys
 * reach the sweep.
 */

import BetterSqlite3 from 'better-sqlite3';
import {
  auditRepo,
  createSqliteMetaDb,
  firstRun,
  jobsRepo,
  passwordResetsRepo,
  sessionsRepo,
  settingsRepo,
  usersRepo,
  type MetaDb,
} from '@adminium/meta';
import { afterEach, describe, expect, it } from 'vitest';

import {
  composeServer,
  EXPORTS_RETENTION_SCHEDULE_NAME,
  RETENTION_GC_CRON,
  RETENTION_GC_SCHEDULE_NAME,
  TELEMETRY_CRON,
  type ComposedServer,
} from '../src/compose.js';
import { ConnectionManager } from '../src/connections/manager.js';
import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import { createApplyService } from '../src/llm/apply-service.js';
import { createRunService } from '../src/llm/run-service.js';
import type { MetaStoreHandle } from '../src/meta/store.js';
import { makeEnv, TEST_SECRET } from './helpers.js';

const DAY_MS = 86_400_000;

let composed: ComposedServer | undefined;
afterEach(async () => {
  await composed?.app.close();
  composed = undefined;
});

async function compose(): Promise<{ meta: MetaDb; server: ComposedServer }> {
  const meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
  await firstRun(meta);

  const storeHandle: MetaStoreHandle = {
    meta,
    url: 'sqlite::memory:',
    engine: 'sqlite',
    source: 'embedded',
    close: async () => Promise.resolve(),
  };
  const manager = new ConnectionManager({
    meta,
    crypto: dsnCryptoFromSecret(TEST_SECRET),
    metaDsn: null,
  });
  const runService = createRunService({ meta });

  composed = await composeServer({
    env: makeEnv(),
    metaStore: storeHandle,
    manager,
    runService,
    applyService: createApplyService({ meta, runService }),
    allowed: null,
    logger: false,
    // The ping's own schedule would otherwise hold the process open past the
    // test; the sweep under test is registered unconditionally.
    telemetry: false,
  });
  return { meta, server: composed };
}

/** A user to hang sessions and reset tokens off — both columns are FKs. */
async function seedUser(meta: MetaDb): Promise<string> {
  const user = await usersRepo(meta).create({ email: 'ops@acme.io', name: 'Ops' });
  return user.id;
}

/** `auditRepo` is append-only and exposes no `findById`; the row is the proof. */
async function auditRowExists(meta: MetaDb, id: string): Promise<boolean> {
  const row = await meta.db
    .selectFrom('adminium_audit_log')
    .select('id')
    .where('id', '=', id)
    .executeTakeFirst();
  return row !== undefined;
}

describe('the retention sweep is registered, and does not collide with the other dailies', () => {
  it('registers exactly one schedule for all four tables, at 03:00', async () => {
    const { server } = await compose();
    expect(server.jobs.scheduler.names()).toContain(RETENTION_GC_SCHEDULE_NAME);
    // `registerSchedule` throws on a duplicate name, so a second registration
    // anywhere (jobs/register.ts is the tempting second home) is a hard boot
    // failure rather than a double sweep. One entry proves there is only one.
    expect(
      server.jobs.scheduler.names().filter((name) => name === RETENTION_GC_SCHEDULE_NAME),
    ).toHaveLength(1);
  });

  it('avoids the hour the telemetry ping owns', () => {
    // Telemetry fires at 04:00 with up to 60 minutes of jitter, so it occupies
    // 04:00–05:00 entirely, and the exports sweep already sits inside that
    // window at 04:30. A third daily in there contends with both on one store.
    expect(TELEMETRY_CRON).toBe('0 4 * * *');
    expect(RETENTION_GC_CRON).toBe('0 3 * * *');
    expect(RETENTION_GC_CRON).not.toBe(TELEMETRY_CRON);
    expect(RETENTION_GC_SCHEDULE_NAME).not.toBe(EXPORTS_RETENTION_SCHEDULE_NAME);
  });
});

describe('firing the sweep deletes what the policy says', () => {
  it('drops expired sessions and used/expired reset tokens, keeping live ones', async () => {
    const { meta, server } = await compose();
    const userId = await seedUser(meta);
    const sessions = sessionsRepo(meta);
    const resets = passwordResetsRepo(meta);
    const now = Date.now();

    const dead = await sessions.create({ userId, tokenHash: 'a', expiresAt: now - DAY_MS });
    const live = await sessions.create({ userId, tokenHash: 'b', expiresAt: now + DAY_MS });
    const staleToken = await resets.create({
      userId,
      kind: 'reset',
      tokenHash: 'c',
      // Past its own expiry by more than the 24 h grace both policies keep.
      expiresAt: now - 3 * DAY_MS,
    });
    const liveToken = await resets.create({
      userId,
      kind: 'invite',
      tokenHash: 'd',
      expiresAt: now + 7 * DAY_MS,
    });

    await server.jobs.scheduler.trigger(RETENTION_GC_SCHEDULE_NAME);

    expect(await sessions.findById(dead.id)).toBeNull();
    expect(await sessions.findById(live.id)).not.toBeNull();
    const remaining = await meta.db.selectFrom('adminium_password_resets').selectAll().execute();
    expect(remaining.map((row) => row.id)).toEqual([liveToken.id]);
    expect(remaining.map((row) => row.id)).not.toContain(staleToken.id);
  });

  it('drops finished jobs past retention.jobsDays and keeps pending ones', async () => {
    const { meta, server } = await compose();
    const jobs = jobsRepo(meta);
    await settingsRepo(meta).set('retention.jobsDays', 7, { updatedBy: null });

    // Succeeded 30 days ago — well past the 7-day policy just written.
    const longAgo = Date.now() - 30 * DAY_MS;
    const old = await jobs.enqueue({ kind: 'export-run', payload: {} }, longAgo);
    await jobs.claim('worker-1', longAgo);
    await jobs.complete(old.id, longAgo);
    const pending = await jobs.enqueue({ kind: 'export-run', payload: {} });

    await server.jobs.scheduler.trigger(RETENTION_GC_SCHEDULE_NAME);

    expect(await jobs.findById(old.id)).toBeNull();
    // A pending job has no `finished_at`; the sweep must never touch work that
    // has not run, however old its `run_at` is.
    expect(await jobs.findById(pending.id)).not.toBeNull();
  });

  it('reads retention.auditLogDays rather than a hardcoded window', async () => {
    const { meta, server } = await compose();
    const audit = auditRepo(meta);
    const now = Date.now();
    // 100 days is inside the 365-day default and outside a 30-day override: one
    // row, two policies, and only the setting decides which way it goes.
    const entry = () =>
      audit.append(
        { actorKind: 'user', actorLabel: 'ops', category: 'auth', action: 'login' },
        now - 100 * DAY_MS,
      );

    const underDefault = await entry();
    await server.jobs.scheduler.trigger(RETENTION_GC_SCHEDULE_NAME);
    expect(await auditRowExists(meta, underDefault.id)).toBe(true);

    await settingsRepo(meta).set('retention.auditLogDays', 30, { updatedBy: null });
    await server.jobs.scheduler.trigger(RETENTION_GC_SCHEDULE_NAME);
    expect(await auditRowExists(meta, underDefault.id)).toBe(false);
  });

  it('does not delete audit rows while retention.auditArchive promises to archive them', async () => {
    // `retention.auditArchive` reads "archive audit batches to adminium_files
    // before deleting" and no archiver exists. Honouring the delete half alone
    // would destroy precisely the rows the operator asked to keep, so the sweep
    // skips the audit table entirely and says so in its log line. The table
    // growing is a problem that can still be fixed; the rows being gone is not.
    const { meta, server } = await compose();
    const audit = auditRepo(meta);
    await settingsRepo(meta).set('retention.auditArchive', true, { updatedBy: null });
    await settingsRepo(meta).set('retention.auditLogDays', 30, { updatedBy: null });

    const ancient = await audit.append(
      { actorKind: 'user', actorLabel: 'ops', category: 'auth', action: 'login' },
      Date.now() - 400 * DAY_MS,
    );

    await server.jobs.scheduler.trigger(RETENTION_GC_SCHEDULE_NAME);
    expect(await auditRowExists(meta, ancient.id)).toBe(true);
  });

  it('leaves the exports lifecycle alone — the exports sweep owns it', async () => {
    // `retention.exportsDays` is read by `jobs/export-run.ts` and enforced by
    // EXPORTS_RETENTION_SCHEDULE_NAME, which also removes the artifact BYTES.
    // A second reader here would expire snapshots without deleting their files.
    const { server } = await compose();
    expect(server.jobs.scheduler.names()).toContain(EXPORTS_RETENTION_SCHEDULE_NAME);
    const source = await import('node:fs/promises').then((fs) =>
      fs.readFile(new URL('../src/compose.ts', import.meta.url), 'utf8'),
    );
    const sweep = source.slice(source.indexOf('RETENTION_GC_SCHEDULE_NAME, RETENTION_GC_CRON'));
    expect(sweep).not.toContain("get('retention.exportsDays')");
  });
});
