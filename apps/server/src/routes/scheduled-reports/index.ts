/**
 * Scheduled-reports routes (M7 reports track; 07-meta-store.md §3.24),
 * mounted under `/api/v1`:
 *
 * - `GET    /scheduled-reports`     — own schedules; everyone's with
 *   {@link REPORTS_MANAGE_PERMISSION} (fail-closed until the key lands).
 * - `POST   /scheduled-reports`     — create; `next_run_at` from croner over
 *   the §3.24 schedule fields (reports/schedule.ts).
 * - `PATCH  /scheduled-reports/:id` — update; schedule/enable changes
 *   recompute `next_run_at` (disable parks it at null).
 * - `DELETE /scheduled-reports/:id`
 *
 * All admin verbs require the manage grant. v1 runs deliver a CSV data
 * snapshot through the export pipeline (jobs/report-run.ts LOCKED SEMANTICS);
 * `format` stores the §3.24 `pdf | png` intent and the SPA labels delivery
 * "Data snapshot (PDF/PNG rendering arrives in a later release)".
 */
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  pagesRepo,
  scheduledReportsRepo,
  type MetaDb,
  type Page,
  type ScheduledReport,
} from '@adminium/meta';
import { z } from 'zod';

import { loadSnapshotView } from '../../data-io/snapshot-view.js';
import { ForbiddenError, NotFoundError, UnauthorizedError, ValidationFailedError } from '../../errors.js';
import { ReportScheduleError, nextRunAtOf } from '../../reports/schedule.js';
import {
  scheduledReportIdParams,
  scheduledReportsCreateBody,
  scheduledReportsDeleteReply,
  scheduledReportsItemReply,
  scheduledReportsListQuery,
  scheduledReportsListReply,
  scheduledReportsPatchBody,
  type ScheduledReportView,
} from './schema.js';

/**
 * `system:reports:manage` — the scheduled-reports admin grant. Declared in
 * this track's handoff for meta's SYSTEM_ACTION_KEYS (`reports.manage`);
 * until assembly lands the key the check denies for everyone except
 * super-admin (whose permission set short-circuits to allow-all).
 */
export const REPORTS_MANAGE_PERMISSION = 'system:reports:manage';

export interface ScheduledReportsRoutesDeps {
  meta: MetaDb;
  now?: (() => number) | undefined;
}

/** The page-envelope slice a report snapshots (mirrors jobs/report-run.ts). */
const envelopeSourceSchema = z.object({
  source: z.object({ connectionId: z.string().nullable(), table: z.string().nullable() }),
});

function requireUserId(request: FastifyRequest): string {
  const user = (request as unknown as { user?: { id?: string } }).user;
  const id = user?.id ?? request.apiKeyPrincipal?.id ?? null;
  if (id === null) throw new UnauthorizedError();
  return id;
}

export function scheduledReportsRoutes(deps: ScheduledReportsRoutesDeps): FastifyPluginAsyncZod {
  const { meta } = deps;
  const now = deps.now ?? Date.now;
  const reports = scheduledReportsRepo(meta);
  const pages = pagesRepo(meta);

  async function requireManage(request: FastifyRequest): Promise<void> {
    requireUserId(request);
    if (await request.can(REPORTS_MANAGE_PERMISSION)) return;
    throw new ForbiddenError('You do not have permission to manage scheduled reports.', 'FORBIDDEN', {
      permission: REPORTS_MANAGE_PERMISSION,
    });
  }

  async function toView(row: ScheduledReport, page?: Page | null): Promise<ScheduledReportView> {
    const resolved = page === undefined ? await pages.findById(row.pageId) : page;
    return {
      id: row.id,
      pageId: row.pageId,
      pageTitle: resolved?.title ?? null,
      pageSlug: resolved?.slug ?? null,
      name: row.name,
      schedule: row.schedule,
      recipients: row.recipients,
      format: row.format,
      enabled: row.enabled,
      lastRunAt: row.lastRunAt,
      nextRunAt: row.nextRunAt,
      createdBy: row.createdBy,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  /**
   * Fail-fast UX guard (wave-2 audit): when the page's table source resolves,
   * the CALLER must hold its `table:<conn>:<table>:export` grant — otherwise
   * `system:reports:manage` alone would let them schedule recurring snapshots
   * of tables they cannot read. The authoritative re-check runs at run time
   * in jobs/report-run.ts (revocation must also stop EXISTING schedules);
   * unresolvable sources are left to that check rather than 500ing here.
   */
  async function requireExportGrantForPage(request: FastifyRequest, page: Page): Promise<void> {
    const parsed = envelopeSourceSchema.safeParse(page.config);
    const source = parsed.success ? parsed.data.source : null;
    if (source === null || source.connectionId === null || source.table === null) return;
    let permission: string | null = null;
    try {
      const view = await loadSnapshotView(meta, source.connectionId);
      permission = `table:${source.connectionId}:${view.table(source.table).id}:export`;
    } catch {
      return; // no snapshot / table gone — the run-time check owns this case
    }
    if (!(await request.can(permission))) {
      throw new ForbiddenError(
        'You do not have export access to this report’s table.',
        'TABLE_FORBIDDEN',
        { permission },
      );
    }
  }

  /** croner evaluation with the §1.4 422 on unusable time/timezone fields. */
  function nextRunOrThrow(schedule: ScheduledReport['schedule'], from: number): number | null {
    try {
      return nextRunAtOf(schedule, from);
    } catch (error) {
      if (error instanceof ReportScheduleError) {
        throw new ValidationFailedError(error.message, { schedule });
      }
      throw error;
    }
  }

  return async (app) => {
    app.get(
      '/scheduled-reports',
      { schema: { querystring: scheduledReportsListQuery, response: { 200: scheduledReportsListReply } } },
      async (request) => {
        const userId = requireUserId(request);
        const manage = await request.can(REPORTS_MANAGE_PERMISSION);
        const rows = await reports.list({
          ...(manage ? {} : { createdBy: userId }),
          limit: request.query.limit,
        });
        const views: ScheduledReportView[] = [];
        for (const row of rows) views.push(await toView(row));
        return { data: views };
      },
    );

    app.post(
      '/scheduled-reports',
      { schema: { body: scheduledReportsCreateBody, response: { 201: scheduledReportsItemReply } } },
      async (request, reply) => {
        await requireManage(request);
        const userId = requireUserId(request);
        const { pageId, name, schedule, recipients, format, enabled } = request.body;
        const page = await pages.findById(pageId);
        if (page === null) {
          throw new ValidationFailedError(`Page ${pageId} does not exist.`, { pageId });
        }
        await requireExportGrantForPage(request, page);
        const at = now();
        const row = await reports.create(
          {
            pageId,
            name,
            schedule,
            recipients,
            format,
            enabled,
            nextRunAt: enabled ? nextRunOrThrow(schedule, at) : null,
            createdBy: userId,
          },
          at,
        );
        await app.rbac.audit(request, {
          category: 'export',
          action: 'report.schedule',
          changes: { after: { reportId: row.id, pageId, name, enabled } },
        });
        return reply.status(201).send({ data: await toView(row, page) });
      },
    );

    app.patch(
      '/scheduled-reports/:id',
      {
        schema: {
          params: scheduledReportIdParams,
          body: scheduledReportsPatchBody,
          response: { 200: scheduledReportsItemReply },
        },
      },
      async (request) => {
        await requireManage(request);
        const existing = await reports.findById(request.params.id);
        if (existing === null) {
          throw new NotFoundError(`Scheduled report ${request.params.id} not found.`);
        }
        const patch = request.body;
        if (patch.pageId !== undefined) {
          const nextPage = await pages.findById(patch.pageId);
          if (nextPage === null) {
            throw new ValidationFailedError(`Page ${patch.pageId} does not exist.`, {
              pageId: patch.pageId,
            });
          }
          // Retargeting a schedule is scheduling: same export-grant guard.
          await requireExportGrantForPage(request, nextPage);
        }
        const at = now();
        // Schedule/enable changes recompute next_run_at; disable parks it.
        const enabled = patch.enabled ?? existing.enabled;
        const schedule = patch.schedule ?? existing.schedule;
        const nextRunAt = !enabled
          ? null
          : patch.schedule !== undefined || patch.enabled === true
            ? nextRunOrThrow(schedule, at)
            : existing.nextRunAt;
        const row = await reports.update(existing.id, { ...patch, nextRunAt }, at);
        if (row === null) throw new NotFoundError(`Scheduled report ${existing.id} not found.`);
        await app.rbac.audit(request, {
          category: 'export',
          action: 'report.schedule.update',
          changes: {
            before: { enabled: existing.enabled, nextRunAt: existing.nextRunAt },
            after: { reportId: row.id, enabled: row.enabled, nextRunAt: row.nextRunAt },
          },
        });
        return { data: await toView(row) };
      },
    );

    app.delete(
      '/scheduled-reports/:id',
      { schema: { params: scheduledReportIdParams, response: { 200: scheduledReportsDeleteReply } } },
      async (request) => {
        await requireManage(request);
        const existing = await reports.findById(request.params.id);
        if (existing === null) {
          throw new NotFoundError(`Scheduled report ${request.params.id} not found.`);
        }
        const deleted = await reports.remove(existing.id);
        await app.rbac.audit(request, {
          category: 'export',
          action: 'report.schedule.delete',
          changes: { before: { reportId: existing.id, name: existing.name } },
        });
        return { data: { deleted } };
      },
    );
  };
}
