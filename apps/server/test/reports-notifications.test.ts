// SPDX-License-Identifier: AGPL-3.0-only
/**
 * M7 reports/notifications track: croner schedule math, the /me notification
 * routes (keyset + unread + read transitions + the §8.2 prefs matrix), the
 * scheduled-reports resource (manage-guarded admin verbs, croner-computed
 * next_run_at, enable toggle), the email-templates contract (byte-for-byte
 * with apps/dashboard/src/api/emailTemplates.ts), and the report-run job
 * end-to-end over the fake SQLite-backed adapter (same harness as
 * data-io-routes.test.ts): due report → report-run → CSV snapshot through the
 * EXPORT pipeline → notification linking page + export → run bookkeeping.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import BetterSqlite3 from 'better-sqlite3';
import { SqliteDialect } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  AdapterRegistry,
  adapterCapabilitiesSchema,
  parseDatabaseModel,
  type AdapterProvider,
  type DatabaseAdapter,
  type DatabaseModel,
} from '@adminium/engine/adapter';
import {
  exportsRepo,
  jobsRepo,
  notificationsRepo,
  pagesRepo,
  permissionsRepo,
  rolesRepo,
  scheduledReportsRepo,
  usersRepo,
  type Job,
  type JobsRepo,
  type ReportSchedule,
  type User,
} from '@adminium/meta';

import { createFileStorage, type FileStorage } from '../src/files/storage.js';
import { registerExportRunHandler } from '../src/jobs/export-run.js';
import {
  REPORT_FAILED_KIND,
  REPORT_READY_KIND,
  REPORT_RUN_KIND,
  enqueueDueReports,
  registerReportRunHandler,
} from '../src/jobs/report-run.js';
import { createJobRegistry, type JobRegistry } from '../src/jobs/registry.js';
import {
  NOTIFICATION_CREATED_EVENT,
  NOTIFICATION_READ_EVENT,
  notify,
} from '../src/notifications/notify.js';
import { ReportScheduleError, cronExprFor, nextRunAtOf } from '../src/reports/schedule.js';
import { emailTemplatesRoutes } from '../src/routes/email-templates/index.js';
import {
  EMAIL_CHANNEL_UNAVAILABLE_REASON,
  notificationsRoutes,
} from '../src/routes/notifications/index.js';
import { scheduledReportsRoutes } from '../src/routes/scheduled-reports/index.js';
import {
  asUser,
  buildDataTestApp,
  createConnectionViaApi,
  introspectViaApi,
  type DataTestContext,
} from './connections-helpers.js';

// --- croner schedule math (pure) --------------------------------------------------

describe('reports/schedule: §3.24 fields → croner next occurrence', () => {
  it('morphs frequency fields into cron expressions', () => {
    expect(cronExprFor({ frequency: 'daily', time: '09:05', timezone: 'UTC' })).toBe('5 9 * * *');
    expect(
      cronExprFor({ frequency: 'weekly', dayOfWeek: 5, time: '18:30', timezone: 'UTC' }),
    ).toBe('30 18 * * 5');
    expect(cronExprFor({ frequency: 'weekly', time: '08:00', timezone: 'UTC' })).toBe(
      '0 8 * * 1', // dayOfWeek defaults to Monday
    );
    expect(
      cronExprFor({ frequency: 'monthly', dayOfMonth: 15, time: '00:45', timezone: 'UTC' }),
    ).toBe('45 0 15 * *');
  });

  it('computes the next weekly occurrence strictly after `from`', () => {
    // Wed 2026-01-14 12:00 UTC → next Monday 08:30 UTC is 2026-01-19.
    const from = Date.UTC(2026, 0, 14, 12, 0);
    const next = nextRunAtOf(
      { frequency: 'weekly', dayOfWeek: 1, time: '08:30', timezone: 'UTC' },
      from,
    );
    expect(next).toBe(Date.UTC(2026, 0, 19, 8, 30));
  });

  it('is timezone-correct across DST (croner owns the IANA math)', () => {
    const schedule: ReportSchedule = {
      frequency: 'daily',
      time: '09:00',
      timezone: 'America/New_York',
    };
    // Winter (EST, UTC-5): 09:00 NY = 14:00 UTC.
    expect(nextRunAtOf(schedule, Date.UTC(2026, 0, 15, 0, 0))).toBe(Date.UTC(2026, 0, 15, 14, 0));
    // Summer (EDT, UTC-4): 09:00 NY = 13:00 UTC.
    expect(nextRunAtOf(schedule, Date.UTC(2026, 6, 15, 0, 0))).toBe(Date.UTC(2026, 6, 15, 13, 0));
  });

  it('monthly on the 31st skips short months', () => {
    const next = nextRunAtOf(
      { frequency: 'monthly', dayOfMonth: 31, time: '00:00', timezone: 'UTC' },
      Date.UTC(2026, 1, 1), // February 2026 has 28 days
    );
    expect(next).toBe(Date.UTC(2026, 2, 31, 0, 0));
  });

  it('rejects unusable time / timezone fields with ReportScheduleError', () => {
    expect(() =>
      cronExprFor({ frequency: 'daily', time: '25:00', timezone: 'UTC' }),
    ).toThrowError(ReportScheduleError);
    expect(() =>
      nextRunAtOf({ frequency: 'daily', time: '09:00', timezone: 'Not/AZone' }),
    ).toThrowError(ReportScheduleError);
  });
});

// --- fake source database (the data-io harness) -----------------------------------

function seedSqlite(): BetterSqlite3.Database {
  const db = new BetterSqlite3(':memory:');
  db.exec(`
    CREATE TABLE customers (
      customer_id TEXT PRIMARY KEY,
      company_name TEXT NOT NULL,
      credit_limit REAL
    );
    INSERT INTO customers VALUES
      ('ALFKI', 'Alfreds Futterkiste', 1200.5),
      ('ANATR', 'Ana Trujillo', 800),
      ('BLAUS', 'Blauer See', 99.9);
  `);
  return db;
}

function fakeModel(): DatabaseModel {
  return parseDatabaseModel({
    dialect: 'postgres',
    name: 'fakedb',
    defaultSchema: 'main',
    schemas: ['main'],
    tables: [
      {
        schema: 'main',
        name: 'customers',
        primaryKey: ['customer_id'],
        columns: [
          { name: 'customer_id', logicalType: 'varchar', nullable: false, isPrimaryKey: true },
          { name: 'company_name', logicalType: 'varchar', nullable: false },
          { name: 'credit_limit', logicalType: 'decimal', nullable: true },
        ],
      },
    ],
    relations: [],
  });
}

function makeFakeRegistry(sqlite: BetterSqlite3.Database): AdapterRegistry<AdapterProvider> {
  const capabilities = adapterCapabilitiesSchema.parse({});
  const makeAdapter = (role: string): DatabaseAdapter =>
    ({
      dialect: 'postgres',
      capabilities,
      role,
      connect: async () => undefined,
      test: async () => ({
        ok: true,
        latencyMs: 1,
        serverVersion: 'FakeSQL 1.0',
        currentUser: 'fake',
        canWrite: true,
        ssl: false,
      }),
      probeCapabilities: async () => ({
        capabilities,
        privileges: { canReadSchema: true, canRead: true, canWrite: true, canDDL: true },
        serverVersion: 'FakeSQL 1.0',
        currentRole: { name: 'fake', readOnly: false },
      }),
      introspect: async () => fakeModel(),
      count: async () => ({ value: 0, capped: false }),
      sample: async () => [],
      query: async () => ({ rows: [], columns: [] }),
      mutate: async () => ({ affected: 0, returning: null }),
      close: async () => undefined,
    }) as unknown as DatabaseAdapter;

  const registry = new AdapterRegistry<AdapterProvider>();
  registry.register({
    dialect: 'postgres',
    create: (config) => makeAdapter(config.role) as never,
    createQueryEngine: () => ({
      dialect: new SqliteDialect({ database: sqlite }),
      identifiers: { quote: (identifier: string) => `"${identifier}"`, maxLength: 63 },
      serializers: {},
      destroy: async () => undefined,
    }),
  });
  return registry;
}

async function runNextJob(jobs: JobsRepo, registry: JobRegistry): Promise<Job> {
  const claimed = await jobs.claim('test-worker');
  if (claimed === null) throw new Error('no claimable job');
  const entry = registry.get(claimed.kind);
  if (entry === undefined) throw new Error(`no handler for ${claimed.kind}`);
  const payload = entry.schema.parse(claimed.payload);
  await entry.run(payload, {
    jobId: claimed.id,
    kind: claimed.kind,
    attempt: claimed.attempts,
    maxAttempts: claimed.maxAttempts,
    signal: new AbortController().signal,
    progress: () => undefined,
    log: () => undefined,
  });
  await jobs.complete(claimed.id);
  const done = await jobs.findById(claimed.id);
  if (done === null) throw new Error('job vanished');
  return done;
}

// --- suite -------------------------------------------------------------------------

const WEEKLY: ReportSchedule = { frequency: 'weekly', dayOfWeek: 1, time: '09:00', timezone: 'UTC' };

interface HubEvent {
  channel: string;
  type: string;
  data: unknown;
}

describe('notifications + scheduled-reports + email-templates routes, report-run job', () => {
  let t: DataTestContext;
  let superAdmin: User;
  let connId: string;
  let dataDir: string;
  let storage: FileStorage;
  let registry: JobRegistry;
  let jobs: JobsRepo;
  const hubEvents: HubEvent[] = [];
  /** Flip on to simulate a WS-layer outage — the next publish throws. */
  let hubDown = false;
  const hub = {
    publish: (channel: string, type: string, data: unknown) => {
      if (hubDown) throw new Error('hub down (simulated)');
      hubEvents.push({ channel, type, data });
    },
  };

  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'adminium-reports-'));
    storage = createFileStorage({ dataDir });
    t = await buildDataTestApp({
      registry: makeFakeRegistry(seedSqlite()),
      extraRoutes: async (api, ctx) => {
        await api.register(notificationsRoutes({ meta: ctx.meta, hub }));
        await api.register(scheduledReportsRoutes({ meta: ctx.meta }));
        await api.register(emailTemplatesRoutes({ meta: ctx.meta }));
      },
    });
    // A super-admin exercises the manage-guarded verbs (permission set
    // short-circuits to allow-all; the reports.manage key itself lands with
    // assembly's SYSTEM_ACTION_KEYS entry).
    const roles = rolesRepo(t.meta);
    const sa = await roles.findBySlug('super-admin');
    if (sa === null) throw new Error('missing built-in super-admin role');
    superAdmin = await usersRepo(t.meta).create({
      email: 'root@adminium.test',
      name: 'Root',
      passwordHash: 'test-hash',
      status: 'active',
    });
    await roles.assignToUser(superAdmin.id, sa.id);

    registry = createJobRegistry();
    registerExportRunHandler(registry, { meta: t.meta, manager: t.manager, storage });
    registerReportRunHandler(registry, { meta: t.meta, registry, hub });
    jobs = jobsRepo(t.meta);

    connId = await createConnectionViaApi(t, 'postgres://fake@fake-host:5432/fakedb');
    await introspectViaApi(t, connId);
    await t.grantTable(t.roles.admin, connId, '*', { read: true, export: true, import: true });
    await t.grantTable(t.roles.viewer, connId, '*', { read: true });
  });

  afterAll(async () => {
    await t.app.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  // --- /me/notifications ------------------------------------------------------------

  it('lists notifications newest-first with keyset paging and the badge count', async () => {
    const repo = notificationsRepo(t.meta);
    const user = t.users.viewer;
    const a = await repo.create({ userId: user.id, kind: 'report.ready', title: 'A' }, 1_000);
    const b = await repo.create({ userId: user.id, kind: 'report.ready', title: 'B' }, 2_000);
    const c = await repo.create({ userId: user.id, kind: 'report.ready', title: 'C' }, 3_000);
    // Another user's row must never leak into the list.
    await repo.create({ userId: t.users.editor.id, kind: 'report.ready', title: 'other' }, 4_000);

    const page1 = await t.app.inject({
      method: 'GET',
      url: '/api/v1/me/notifications?limit=2',
      headers: asUser(user),
    });
    expect(page1.statusCode).toBe(200);
    const d1 = page1.json().data as {
      items: { id: string; title: string }[];
      unreadCount: number;
      nextCursor: string | null;
    };
    expect(d1.items.map((n) => n.id)).toEqual([c.id, b.id]);
    expect(d1.unreadCount).toBe(3);
    expect(d1.nextCursor).toBe(`2000:${b.id}`);

    const page2 = await t.app.inject({
      method: 'GET',
      url: `/api/v1/me/notifications?limit=2&before=${encodeURIComponent(d1.nextCursor ?? '')}`,
      headers: asUser(user),
    });
    const d2 = page2.json().data as { items: { id: string }[]; nextCursor: string | null };
    expect(d2.items.map((n) => n.id)).toEqual([a.id]);
    expect(d2.nextCursor).toBeNull();

    // Read one → unread filter narrows, badge count drops, WS event fired.
    hubEvents.length = 0;
    const read = await t.app.inject({
      method: 'POST',
      url: `/api/v1/me/notifications/${c.id}/read`,
      headers: asUser(user),
    });
    expect(read.json().data).toMatchObject({ updated: true, unreadCount: 2 });
    expect(hubEvents).toEqual([
      {
        channel: `notifications:${user.id}`,
        type: NOTIFICATION_READ_EVENT,
        data: { unreadCount: 2 },
      },
    ]);

    const unread = await t.app.inject({
      method: 'GET',
      url: '/api/v1/me/notifications?unread=true',
      headers: asUser(user),
    });
    expect((unread.json().data as { items: { id: string }[] }).items.map((n) => n.id)).toEqual([
      b.id,
      a.id,
    ]);

    // A foreign id is a silent no-op, never a leak or a 404 oracle.
    const foreign = await t.app.inject({
      method: 'POST',
      url: `/api/v1/me/notifications/${c.id}/read`,
      headers: asUser(t.users.editor),
    });
    expect(foreign.json().data.updated).toBe(false);

    const all = await t.app.inject({
      method: 'POST',
      url: '/api/v1/me/notifications/read-all',
      headers: asUser(user),
    });
    expect(all.json().data).toMatchObject({ updated: 2, unreadCount: 0 });
  });

  it('rejects notification routes without a session', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/api/v1/me/notifications' });
    expect(res.statusCode).toBe(401);
  });

  // --- /me/notification-prefs ---------------------------------------------------------

  it('prefs matrix: defaults, stored intent verbatim, email explained-not-hidden', async () => {
    const user = t.users.editor;
    const initial = await t.app.inject({
      method: 'GET',
      url: '/api/v1/me/notification-prefs',
      headers: asUser(user),
    });
    expect(initial.statusCode).toBe(200);
    const d = initial.json().data as {
      channels: { id: string; available: boolean; reason?: string }[];
      events: { key: string; channels: Record<string, boolean>; custom: boolean }[];
    };
    // §8.2: email/push are IN the matrix, marked unavailable WITH a reason.
    const email = d.channels.find((ch) => ch.id === 'email');
    expect(email?.available).toBe(false);
    expect(email?.reason).toBe(EMAIL_CHANNEL_UNAVAILABLE_REASON);
    expect(d.channels.find((ch) => ch.id === 'inApp')?.available).toBe(true);
    // The known-producer catalog renders with defaults before any write.
    const reportReady = d.events.find((event) => event.key === 'report.ready');
    expect(reportReady).toMatchObject({
      custom: false,
      channels: { inApp: true, email: true, push: false },
    });

    // PUT stores intent verbatim — email included, despite being undeliverable.
    const put = await t.app.inject({
      method: 'PUT',
      url: '/api/v1/me/notification-prefs',
      headers: asUser(user),
      payload: {
        events: [
          { key: 'report.ready', channels: { inApp: false, email: true, push: true } },
          { key: 'custom.integration', channels: { inApp: true, email: false, push: false } },
        ],
      },
    });
    expect(put.statusCode).toBe(200);
    const updated = put.json().data as typeof d;
    expect(updated.events.find((event) => event.key === 'report.ready')).toMatchObject({
      custom: true,
      channels: { inApp: false, email: true, push: true },
    });
    // Stored keys outside the catalog merge in — they never vanish.
    expect(updated.events.find((event) => event.key === 'custom.integration')).toMatchObject({
      custom: true,
    });

    // The writer honours the stored inApp=false: no row lands.
    expect(
      await notify(t.meta, { userId: user.id, kind: 'report.ready', title: 'suppressed' }),
    ).toBeNull();
  });

  // --- /scheduled-reports ---------------------------------------------------------------

  let pageId: string;
  let reportId: string;

  it('scheduled reports: manage-guarded create with croner-computed nextRunAt', async () => {
    pageId = (
      await pagesRepo(t.meta).create({
        connectionId: connId,
        slug: 'customers',
        type: 'page-crud',
        title: 'Customers',
        config: { source: { connectionId: connId, table: 'main.customers' } },
      })
    ).id;

    // Editor lacks reports.manage → 403 (fail-closed until the key lands).
    const denied = await t.app.inject({
      method: 'POST',
      url: '/api/v1/scheduled-reports',
      headers: asUser(t.users.editor),
      payload: { pageId, name: 'Weekly customers', schedule: WEEKLY },
    });
    expect(denied.statusCode).toBe(403);

    const created = await t.app.inject({
      method: 'POST',
      url: '/api/v1/scheduled-reports',
      headers: asUser(superAdmin),
      payload: { pageId, name: 'Weekly customers', schedule: WEEKLY, recipients: ['ava@x.test'] },
    });
    expect(created.statusCode).toBe(201);
    const view = created.json().data as {
      id: string;
      pageTitle: string;
      format: string;
      enabled: boolean;
      nextRunAt: number | null;
    };
    reportId = view.id;
    expect(view.pageTitle).toBe('Customers');
    expect(view.format).toBe('pdf'); // stored §3.24 intent
    expect(view.enabled).toBe(true);
    // croner computed a real future occurrence on the Monday-09:00 lattice.
    expect(view.nextRunAt).not.toBeNull();
    expect(view.nextRunAt ?? 0).toBeGreaterThan(Date.now());
    expect(new Date(view.nextRunAt ?? 0).getUTCDay()).toBe(1);

    // A bogus page 422s instead of hitting the FK.
    const badPage = await t.app.inject({
      method: 'POST',
      url: '/api/v1/scheduled-reports',
      headers: asUser(superAdmin),
      payload: { pageId: 'page_missing', name: 'x', schedule: WEEKLY },
    });
    expect(badPage.statusCode).toBe(422);

    // An unusable timezone 422s through ReportScheduleError.
    const badTz = await t.app.inject({
      method: 'POST',
      url: '/api/v1/scheduled-reports',
      headers: asUser(superAdmin),
      payload: { pageId, name: 'x', schedule: { ...WEEKLY, timezone: 'Not/AZone' } },
    });
    expect(badTz.statusCode).toBe(422);
  });

  it('scheduled reports: list scope, enable toggle parks/recomputes, delete', async () => {
    // Mine-only for non-manage callers: the editor sees nothing.
    const editorList = await t.app.inject({
      method: 'GET',
      url: '/api/v1/scheduled-reports',
      headers: asUser(t.users.editor),
    });
    expect(editorList.json().data).toEqual([]);

    const manageList = await t.app.inject({
      method: 'GET',
      url: '/api/v1/scheduled-reports',
      headers: asUser(superAdmin),
    });
    expect((manageList.json().data as { id: string }[]).map((row) => row.id)).toContain(reportId);

    // Disable parks next_run_at at null.
    const disabled = await t.app.inject({
      method: 'PATCH',
      url: `/api/v1/scheduled-reports/${reportId}`,
      headers: asUser(superAdmin),
      payload: { enabled: false },
    });
    expect(disabled.json().data).toMatchObject({ enabled: false, nextRunAt: null });

    // Re-enable recomputes from croner.
    const enabled = await t.app.inject({
      method: 'PATCH',
      url: `/api/v1/scheduled-reports/${reportId}`,
      headers: asUser(superAdmin),
      payload: { enabled: true },
    });
    const enabledView = enabled.json().data as { enabled: boolean; nextRunAt: number | null };
    expect(enabledView.enabled).toBe(true);
    expect(enabledView.nextRunAt).not.toBeNull();

    // Editor cannot toggle or delete.
    const deniedPatch = await t.app.inject({
      method: 'PATCH',
      url: `/api/v1/scheduled-reports/${reportId}`,
      headers: asUser(t.users.editor),
      payload: { enabled: false },
    });
    expect(deniedPatch.statusCode).toBe(403);
  });

  // --- report-run job (LOCKED v1 semantics) ----------------------------------------------

  it('report-run: due report → CSV snapshot via export pipeline → notification + bookkeeping', async () => {
    const reports = scheduledReportsRepo(t.meta);
    // Make the schedule due now (the poll's listDue worklist).
    await reports.update(reportId, { nextRunAt: Date.now() - 1_000 });

    hubEvents.length = 0;
    const enqueued = await enqueueDueReports(t.meta, (input) => jobs.enqueue(input));
    expect(enqueued?.kind).toBe(REPORT_RUN_KIND);

    // The poll is idempotent per occurrence: a second tick collapses into the
    // same dedupe-keyed job instead of double-running.
    const again = await enqueueDueReports(t.meta, (input) => jobs.enqueue(input));
    expect(again?.id).toBe(enqueued?.id);

    const done = await runNextJob(jobs, registry);
    expect(done.status).toBe('succeeded');

    // The snapshot went THROUGH the export pipeline: a ready adminium_exports
    // row with a CSV artifact owned by the report's creator.
    const exportRows = await exportsRepo(t.meta).list({ requestedBy: superAdmin.id });
    expect(exportRows).toHaveLength(1);
    const exportRow = exportRows[0];
    if (exportRow === undefined) throw new Error('export row vanished');
    expect(exportRow.status).toBe('ready');
    expect(exportRow.format).toBe('csv');
    expect(exportRow.rowCount).toBe(3);

    // In-app notification links page + export and explains the delivery.
    const rows = await notificationsRepo(t.meta).listForUser(superAdmin.id);
    expect(rows).toHaveLength(1);
    const ntf = rows[0];
    if (ntf === undefined) throw new Error('notification vanished');
    expect(ntf.kind).toBe(REPORT_READY_KIND);
    expect(ntf.entity).toMatchObject({
      reportId,
      pageId,
      pageSlug: 'customers',
      exportId: exportRow.id,
      requestedFormat: 'pdf',
      delivered: 'csv-snapshot',
    });
    expect(ntf.actionUrl).toBe('/exports');

    // Realtime fan-out on notifications:<userId>.
    expect(hubEvents.some(
      (event) =>
        event.channel === `notifications:${superAdmin.id}` &&
        event.type === NOTIFICATION_CREATED_EVENT,
    )).toBe(true);

    // Run bookkeeping: lastRunAt stamped, nextRunAt parked on the next occurrence.
    const after = await reports.findById(reportId);
    expect(after?.lastRunAt).not.toBeNull();
    expect(after?.nextRunAt ?? 0).toBeGreaterThan(Date.now());

    // The artifact really landed in file storage as CSV (the export
    // pipeline's writer, not a fork): 3 data rows + header.
    const stored = await storage.read(exportRow.fileId ?? '');
    let csv = '';
    for await (const chunk of stored) csv += String(chunk);
    expect(csv).toContain('customer_id,company_name,credit_limit');
    expect(csv.trim().split('\n')).toHaveLength(4);
  });

  it('report-run: a page without a table source fails HONESTLY and advances the schedule', async () => {
    const badPage = await pagesRepo(t.meta).create({
      slug: 'dashboard-home',
      type: 'page-dashboard',
      title: 'Overview',
      config: { source: { connectionId: null, table: null } },
    });
    const report = await scheduledReportsRepo(t.meta).create({
      pageId: badPage.id,
      name: 'Broken report',
      schedule: WEEKLY,
      recipients: [],
      format: 'png',
      nextRunAt: Date.now() - 1_000,
      createdBy: t.users.admin.id,
    });

    await enqueueDueReports(t.meta, (input) => jobs.enqueue(input));
    const done = await runNextJob(jobs, registry);
    expect(done.status).toBe('succeeded'); // deterministic failure ≠ retry loop

    const rows = await notificationsRepo(t.meta).listForUser(t.users.admin.id);
    const failed = rows.find((row) => row.kind === REPORT_FAILED_KIND);
    expect(failed?.title).toContain('Broken report');
    expect(failed?.body).toContain('no table source');

    // The schedule advanced — no hot loop on the same occurrence.
    const after = await scheduledReportsRepo(t.meta).findById(report.id);
    expect(after?.lastRunAt).not.toBeNull();
    expect(after?.nextRunAt ?? 0).toBeGreaterThan(Date.now());
    expect((await enqueueDueReports(t.meta, (input) => jobs.enqueue(input)))).toBeNull();
  });

  it('report-run: a ready-notification failure cannot re-loop the schedule (advance-first)', async () => {
    const reports = scheduledReportsRepo(t.meta);
    await reports.update(reportId, { nextRunAt: Date.now() - 1_000 });
    await enqueueDueReports(t.meta, (input) => jobs.enqueue(input));

    hubDown = true;
    try {
      // The snapshot itself succeeds; only the courtesy fan-out throws.
      const done = await runNextJob(jobs, registry);
      expect(done.status).toBe('succeeded');
    } finally {
      hubDown = false;
    }

    // finishRun ran BEFORE the notify attempt: the schedule advanced, so the
    // next poll tick re-enqueues nothing — no fresh-export-per-minute loop.
    const after = await reports.findById(reportId);
    expect(after?.nextRunAt ?? 0).toBeGreaterThan(Date.now());
    expect(await enqueueDueReports(t.meta, (input) => jobs.enqueue(input))).toBeNull();

    // The row insert preceded the failed publish — the export is listed and
    // the bell catches up on its next poll (recoverable, per the handler doc).
    const ready = (await notificationsRepo(t.meta).listForUser(superAdmin.id)).filter(
      (row) => row.kind === REPORT_READY_KIND,
    );
    expect(ready).toHaveLength(2); // the first run test's row + this run's
  });

  // --- /email-templates -------------------------------------------------------------------

  it('email templates: the exact client contract, manage-guarded writes', async () => {
    // Empty list first — the client renders its empty state from `{ items: [] }`.
    const empty = await t.app.inject({
      method: 'GET',
      url: '/api/v1/email-templates',
      headers: asUser(t.users.editor),
    });
    expect(empty.statusCode).toBe(200);
    expect(empty.json()).toEqual({ items: [] });

    // Writes need system:settings:manage — the editor is refused.
    const denied = await t.app.inject({
      method: 'PUT',
      url: '/api/v1/email-templates/welcome/en_US',
      headers: asUser(t.users.editor),
      payload: { name: 'Welcome', subject: 'Hi', blocks: [], enabled: true },
    });
    expect(denied.statusCode).toBe(403);

    const put = await t.app.inject({
      method: 'PUT',
      url: '/api/v1/email-templates/welcome/en_US',
      headers: asUser(superAdmin),
      payload: {
        name: 'Welcome',
        subject: 'Welcome to the workspace',
        blocks: [{ block: 'block-hero', data: { heading: 'Hello' } }, { custom: 'preserved' }],
        enabled: true,
      },
    });
    expect(put.statusCode).toBe(200);
    const putBody = put.json() as { id: string; key: string; locale: string; blocks: unknown[] };
    expect(putBody.key).toBe('welcome');
    expect(putBody.locale).toBe('en_US');
    expect(putBody.blocks).toHaveLength(2);

    // GET detail = list item + blocks, un-enveloped.
    const detail = await t.app.inject({
      method: 'GET',
      url: '/api/v1/email-templates/welcome/en_US',
      headers: asUser(t.users.editor),
    });
    expect(detail.statusCode).toBe(200);
    const detailBody = detail.json() as Record<string, unknown>;
    expect(detailBody).toMatchObject({
      id: putBody.id,
      key: 'welcome',
      locale: 'en_US',
      name: 'Welcome',
      subject: 'Welcome to the workspace',
      enabled: true,
    });
    expect(detailBody.blocks).toEqual([
      { block: 'block-hero', data: { heading: 'Hello' } },
      { custom: 'preserved' },
    ]);

    // List shape: `{ items: [...] }` with NO blocks on the rows.
    const list = await t.app.inject({
      method: 'GET',
      url: '/api/v1/email-templates',
      headers: asUser(t.users.editor),
    });
    const items = (list.json() as { items: Record<string, unknown>[] }).items;
    expect(items).toHaveLength(1);
    expect(items[0]).not.toHaveProperty('blocks');

    // Unknown template → 404.
    const missing = await t.app.inject({
      method: 'GET',
      url: '/api/v1/email-templates/welcome/fr_FR',
      headers: asUser(t.users.editor),
    });
    expect(missing.statusCode).toBe(404);
  });

  // --- report-run + schedule-time table grants (wave-2 audit) ------------------------------

  it('report-run: a creator without the LIVE export grant fails closed and advances', async () => {
    // The editor holds no table export grant in this harness — a schedule
    // they own must stop producing snapshots (revocation semantics: the
    // run-time re-check, not the schedule-time capture, is authoritative).
    const report = await scheduledReportsRepo(t.meta).create({
      pageId,
      name: 'Revoked-creator report',
      schedule: WEEKLY,
      recipients: [],
      format: 'pdf',
      nextRunAt: Date.now() - 1_000,
      createdBy: t.users.editor.id,
    });

    await enqueueDueReports(t.meta, (input) => jobs.enqueue(input));
    const done = await runNextJob(jobs, registry);
    expect(done.status).toBe('succeeded'); // deterministic denial ≠ retry loop

    // No export row was created for the non-granted creator — the bypass
    // around POST /exports' table:…:export check is closed.
    expect(await exportsRepo(t.meta).list({ requestedBy: t.users.editor.id })).toHaveLength(0);

    // The creator is told, and the schedule advanced (no hot loop).
    const rows = await notificationsRepo(t.meta).listForUser(t.users.editor.id);
    const failed = rows.find(
      (row) => row.kind === REPORT_FAILED_KIND && row.title.includes('Revoked-creator report'),
    );
    expect(failed?.body).toContain('export access');
    const after = await scheduledReportsRepo(t.meta).findById(report.id);
    expect(after?.lastRunAt).not.toBeNull();
    expect(after?.nextRunAt ?? 0).toBeGreaterThan(Date.now());
  });

  it('scheduled reports: reports.manage alone cannot schedule over an unexported table', async () => {
    // Grant the editor reports.manage but no table export grant: the POST
    // fail-fast guard refuses (the run-time check above stays authoritative).
    await permissionsRepo(t.meta).grant(t.roles.editor.id, 'system', 'reports.manage', {
      allowed: true,
    });
    const denied = await t.app.inject({
      method: 'POST',
      url: '/api/v1/scheduled-reports',
      headers: asUser(t.users.editor),
      payload: { pageId, name: 'Sneaky snapshots', schedule: WEEKLY },
    });
    expect(denied.statusCode).toBe(403);
    expect((denied.json() as { error: { code: string } }).error.code).toBe('TABLE_FORBIDDEN');

    // With the table export grant, the same create passes.
    await t.grantTable(t.roles.editor, connId, 'main.customers', { read: true, export: true });
    const allowed = await t.app.inject({
      method: 'POST',
      url: '/api/v1/scheduled-reports',
      headers: asUser(t.users.editor),
      payload: { pageId, name: 'Granted snapshots', schedule: WEEKLY },
    });
    expect(allowed.statusCode).toBe(201);
  });
});
