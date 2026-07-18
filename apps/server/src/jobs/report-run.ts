/**
 * `report-run` job handler (M7 reports track; 07-meta-store.md §3.24,
 * 09-generated-app.md §5.4).
 *
 * LOCKED v1 SEMANTICS: a run resolves the report's page, produces a **CSV
 * data snapshot THROUGH the M7-T07 export pipeline** (the export-run handler
 * is invoked in-process via the shared registry — reuse, not a fork), stamps
 * `last_run_at`/`next_run_at`, and delivers an in-app notification linking
 * page + export. The stored `format` stays `pdf | png` (§3.24 vocabulary):
 * that is the user's rendering INTENT, preserved for the release where a
 * renderer exists; the UI labels delivery "Data snapshot (PDF/PNG rendering
 * arrives in a later release)".
 *
 * Grants: the snapshot always runs MASKED (`unmasked: false`). An export
 * request captures the caller's live PII capability at request time; a
 * scheduled run has no request to capture from, and replaying a capability
 * the creator held at schedule time could outlive a revocation — masked is
 * the only honest default. The same revocation logic applies to ROW data:
 * every run re-resolves the creator's live permission set and requires the
 * `table:<conn>:<table>:export` grant before creating the export row (this
 * path bypasses POST /exports, the only other place that grant is checked).
 *
 * Failures advance the schedule (recordRun still fires) so a misconfigured
 * report never hot-loops the queue, and the creator is TOLD via a
 * `report.failed` notification instead of a silent skip.
 */
import { exportsRepo, pagesRepo, scheduledReportsRepo, type Job, type MetaDb } from '@adminium/meta';
import type { EnqueueJobInput } from '@adminium/meta';
import { z } from 'zod';

import { loadSnapshotView } from '../data-io/snapshot-view.js';
import { nextRunAtOf } from '../reports/schedule.js';
import { notify, type NotificationPublisher } from '../notifications/notify.js';
import { permissionSetAllows, resolvePermissionSet } from '../rbac/resolver.js';
import { EXPORT_RUN_KIND, exportRunPayloadSchema } from './export-run.js';
import type { JobHandlerContext, JobRegistry } from './registry.js';

export const REPORT_RUN_KIND = 'report-run';

export const reportRunPayloadSchema = z.object({
  reportId: z.string().min(1),
  /** Owner convention (routes/jobs): the report's creator. */
  userId: z.string().optional(),
});
export type ReportRunPayload = z.infer<typeof reportRunPayloadSchema>;

/** Notification kinds this handler produces (stable localization keys). */
export const REPORT_READY_KIND = 'report.ready';
export const REPORT_FAILED_KIND = 'report.failed';

/** compose.ts poll-schedule identity (jobs.scheduler.registerSchedule). */
export const SCHEDULED_REPORTS_POLL_NAME = 'scheduled-reports-poll';
export const SCHEDULED_REPORTS_POLL_CRON = '* * * * *';

export interface ReportRunDeps {
  meta: MetaDb;
  /**
   * The SAME registry the export-run handler is registered on — report-run
   * drives the export pipeline through it (`registry.get(EXPORT_RUN_KIND)`),
   * so the two handlers can never drift apart on snapshot semantics.
   */
  registry: JobRegistry;
  /** `app.realtime` — notifications fan out on `notifications:<userId>`. */
  hub?: NotificationPublisher | undefined;
  now?: (() => number) | undefined;
}

/** The page-envelope slice a report needs (01-architecture.md §6.1). */
const envelopeSourceSchema = z.object({
  source: z.object({ connectionId: z.string().nullable(), table: z.string().nullable() }),
});

export function registerReportRunHandler(registry: JobRegistry, deps: ReportRunDeps): void {
  const now = deps.now ?? Date.now;
  registry.registerJobHandler(REPORT_RUN_KIND, reportRunPayloadSchema, async (payload, ctx) => {
    return executeReportRun(payload, ctx, deps, now);
  });
}

async function executeReportRun(
  payload: ReportRunPayload,
  ctx: JobHandlerContext,
  deps: ReportRunDeps,
  now: () => number,
): Promise<{ reportId: string; exportId: string | null }> {
  const reports = scheduledReportsRepo(deps.meta);
  const report = await reports.findById(payload.reportId);
  if (report === null) {
    ctx.log('report-run: report not found, skipping', { reportId: payload.reportId });
    return { reportId: payload.reportId, exportId: null };
  }
  if (!report.enabled) {
    ctx.log('report-run: report disabled, skipping', { reportId: report.id });
    return { reportId: report.id, exportId: null };
  }

  /** Stamp the run + park the next occurrence — fires on EVERY outcome. */
  const finishRun = async (): Promise<void> => {
    const at = now();
    await reports.recordRun(report.id, { lastRunAt: at, nextRunAt: nextRunAtOf(report.schedule, at) });
  };

  const fail = async (reason: string): Promise<{ reportId: string; exportId: string | null }> => {
    ctx.log('report-run: failed', { reportId: report.id, reason });
    // Schedule advance FIRST: it must never depend on notification delivery —
    // a lost notification is recoverable, a per-minute re-run loop is not.
    await finishRun();
    if (report.createdBy !== null) {
      try {
        await notify(
          deps.meta,
          {
            userId: report.createdBy,
            kind: REPORT_FAILED_KIND,
            title: `Report failed: ${report.name}`,
            body: reason,
            entity: { reportId: report.id, pageId: report.pageId, reason },
            actionUrl: '/reports',
          },
          { hub: deps.hub, at: now() },
        );
      } catch (error) {
        ctx.log('report-run: failed-notification delivery failed', {
          reportId: report.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return { reportId: report.id, exportId: null };
  };

  const page = await pagesRepo(deps.meta).findById(report.pageId);
  if (page === null) return fail('The report’s page no longer exists.');
  const parsed = envelopeSourceSchema.safeParse(page.config);
  const source = parsed.success ? parsed.data.source : null;
  if (source === null || source.connectionId === null || source.table === null) {
    return fail('The report’s page has no table source to snapshot.');
  }
  if (report.createdBy === null) {
    // adminium_exports.requested_by is NOT NULL — without a creator there is
    // no principal to own the artifact (or receive the notification).
    return fail('The report has no owner to run as (its creator was deleted).');
  }

  // LIVE grant re-check (wave-2 audit): scheduling requires only
  // `system:reports:manage`, and the export row below is created OUTSIDE the
  // POST /exports route — the only place `table:<conn>:<table>:export` is
  // otherwise enforced. The creator must STILL hold the export grant at run
  // time, so a revoked creator stops receiving snapshots (the doc-comment's
  // revocation concern, applied to row data, not just PII).
  let resolvedTableId: string;
  try {
    const view = await loadSnapshotView(deps.meta, source.connectionId);
    resolvedTableId = view.table(source.table).id;
  } catch {
    return fail('The report’s table no longer exists in the schema snapshot.');
  }
  const exportPermission = `table:${source.connectionId}:${resolvedTableId}:export`;
  const creatorSet = await resolvePermissionSet(deps.meta, {
    kind: 'user',
    id: report.createdBy,
    label: report.createdBy,
  });
  if (!permissionSetAllows(creatorSet, exportPermission)) {
    return fail('You no longer have export access to this report’s table.');
  }

  const exportEntry = deps.registry.get(EXPORT_RUN_KIND);
  if (exportEntry === undefined) {
    // Registration bug, not a data problem — surface it as a job failure.
    throw new Error('report-run: the export-run handler is not registered on this registry');
  }

  ctx.progress(10, { step: 'snapshot', message: `Snapshotting ${source.table}` });
  const exportRow = await exportsRepo(deps.meta).create({
    connectionId: source.connectionId,
    requestedBy: report.createdBy,
    source: { kind: 'table', table: source.table },
    format: 'csv',
  });

  try {
    const exportPayload = exportRunPayloadSchema.parse({
      exportId: exportRow.id,
      userId: report.createdBy,
      unmasked: false,
    });
    await exportEntry.run(exportPayload, ctx);
  } catch (error) {
    // export-run absorbs deterministic failures itself (marks the row); a
    // throw here is unexpected — mark our side and advance the schedule.
    return fail(error instanceof Error ? error.message : String(error));
  }

  const finished = await exportsRepo(deps.meta).findById(exportRow.id);
  if (finished === null || finished.status !== 'ready') {
    return fail(finished?.error ?? `Snapshot export ended ${finished?.status ?? 'missing'}.`);
  }

  // Advance the schedule BEFORE the ready-notification: a notify/hub throw
  // with `next_run_at` still in the past would re-run the whole snapshot on
  // every poll tick — one fresh export artifact per minute (wave-2 audit).
  await finishRun();
  try {
    await notify(
      deps.meta,
      {
        userId: report.createdBy,
        kind: REPORT_READY_KIND,
        title: `Report ready: ${report.name}`,
        body: `${String(finished.rowCount ?? 0)} rows · CSV data snapshot`,
        entity: {
          reportId: report.id,
          reportName: report.name,
          pageId: report.pageId,
          pageSlug: page.slug,
          pageTitle: page.title,
          exportId: finished.id,
          rowCount: finished.rowCount,
          // The stored intent vs. what this build delivers — the client copy
          // explains the degradation (§8.2), it is never hidden.
          requestedFormat: report.format,
          delivered: 'csv-snapshot',
        },
        actionUrl: '/exports',
      },
      { hub: deps.hub, at: now() },
    );
  } catch (error) {
    // The export is ready and listed under /exports — a lost notification is
    // recoverable there and must not fail (and re-loop) the run.
    ctx.log('report-run: ready-notification delivery failed', {
      reportId: report.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  ctx.progress(100, { step: 'done', message: `Report ${report.name} ready` });
  ctx.log('report-run: ready', { reportId: report.id, exportId: finished.id });
  return { reportId: report.id, exportId: finished.id };
}

/**
 * The compose.ts poll body (scheduler → queue seam): enqueue one `report-run`
 * per due report. The `dedupeKey` carries the due stamp, so a poll tick that
 * fires while the previous run of the SAME occurrence is still queued/running
 * collapses into it, while the next occurrence gets a fresh key.
 */
export async function enqueueDueReports(
  meta: MetaDb,
  enqueue: (input: EnqueueJobInput) => Promise<Job>,
  at: number = Date.now(),
): Promise<Job | null> {
  const due = await scheduledReportsRepo(meta).listDue(at);
  let last: Job | null = null;
  for (const report of due) {
    last = await enqueue({
      kind: REPORT_RUN_KIND,
      payload: {
        reportId: report.id,
        ...(report.createdBy === null ? {} : { userId: report.createdBy }),
      },
      dedupeKey: `report-run:${report.id}:${String(report.nextRunAt ?? at)}`,
    });
  }
  return last;
}
