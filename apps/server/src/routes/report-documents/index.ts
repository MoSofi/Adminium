// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Report documents — templates and reports (`adminium_report_documents`, wave
 * 0030), mounted under `/api/v1`. The reply bodies are mirrored type-for-type
 * by `apps/dashboard/src/report-builder/api.ts` (the copied-mirror
 * convention; the SYNC NOTE is in `schema.ts`).
 *
 * NOT `/api/v1/scheduled-reports`. That resource drives Scheduled Reports —
 * the recurring CSV snapshot of a page. This one is the report BUILDER's
 * authored surface (trap 1).
 *
 * THE AUTHORED SURFACE, NOT A PIPELINE. Everything here lists, creates,
 * edits and saves what a person typed. Nothing here renders, prints, exports
 * or sends: the comp draws no such action, and the *Publish* primary does
 * the smallest thing the comp's own vocabulary supports — it saves and sets
 * `status: 'sent'`.
 *
 * THE ONE RULE EVERY WRITE OBEYS: nothing writes the row while an operator
 * types. `PUT /:id` is the explicit save and it
 * carries the whole on-screen document; the summary is re-derived from it
 * on every save, never patched piecemeal.
 *
 * DELETE IS A HARD DELETE. This comp has no archive — its `doDelete` (560)
 * filters the row out of the array after a confirm. A report built from a
 * template survives the template's deletion untouched (`originId` is a soft
 * ref).
 *
 * Reads need a session; every write needs `system:settings:manage` (the email
 * rule, ruled again — report documents add no permission key, and
 * `system:reports:manage` belongs to Scheduled Reports).
 */
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { reportDocumentsRepo, type MetaDb, type ReportDocument } from '@adminium/meta';

import { audited } from '../../audit/coverage.js';
import { ForbiddenError, NotFoundError, UnauthorizedError, ValidationFailedError } from '../../errors.js';
import { translatorFor } from '../../i18n/server-i18n.js';
import { acceptReportBody, bodyColumn, normalizeReportBody, type ReportBody } from '../../report-documents/document.js';
import { BLANK_ICON, blankBody, isReportStarterKey, renderStarter, starterCards } from '../../report-documents/starters.js';
import { summaryOf } from '../../report-documents/summary.js';
import { PERMISSIONS } from '../../rbac/permissions.js';
import {
  reportCreateBody,
  reportDetailView,
  reportFromTemplateBody,
  reportIdParams,
  reportPatchBody,
  reportPutBody,
  reportStartersReply,
  reportSummaryView,
  reportsListQuery,
  reportsListReply,
  type ReportDetailView,
  type ReportSummaryView,
} from './schema.js';

export interface ReportDocumentsRoutesDeps {
  meta: MetaDb;
}

function requireUserId(request: FastifyRequest): string {
  const user = (request as unknown as { user?: { id?: string } }).user;
  const id = user?.id ?? request.apiKeyPrincipal?.id ?? null;
  if (id === null) throw new UnauthorizedError();
  return id;
}

function summaryView(row: ReportDocument): ReportSummaryView {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    status: row.status,
    starter: row.starter,
    originId: row.originId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    summary: row.summary,
  };
}

function detailOf(row: ReportDocument): ReportDetailView {
  return { ...summaryView(row), body: normalizeReportBody(row.body) };
}

/** The icon a row's card draws — the starter's, or `file-text` for a blank one.
 * */
function starterIcon(starter: string | null): string {
  if (starter === null || !isReportStarterKey(starter)) return BLANK_ICON;
  return renderStarter(starter).card.icon;
}

export function reportDocumentsRoutes(deps: ReportDocumentsRoutesDeps): FastifyPluginAsyncZod {
  const { meta } = deps;
  const repo = reportDocumentsRepo(meta);

  async function mustFind(id: string): Promise<ReportDocument> {
    const row = await repo.findById(id);
    if (row === null) throw new NotFoundError(`Report document ${id} not found.`);
    return row;
  }

  return async (app) => {
    async function requireSettingsManage(request: FastifyRequest, what: string): Promise<void> {
      if (await request.can(PERMISSIONS.settingsManage)) return;
      throw new ForbiddenError(`You do not have permission to ${what}.`, 'FORBIDDEN', {
        permission: PERMISSIONS.settingsManage,
      });
    }

    // ── reads ──────────────────────────────────────────────────────────────

    app.get(
      '/report-documents',
      { schema: { querystring: reportsListQuery, response: { 200: reportsListReply } } },
      async (request) => {
        requireUserId(request);
        const rows = await repo.list({ kind: request.query.kind });
        // Counts are unfiltered on purpose: the tab badges say how many of each
        // kind exist, whichever tab is open (comp 580).
        return { items: rows.map(summaryView), counts: await repo.counts() };
      },
    );

    app.get('/report-documents/starters', { schema: { response: { 200: reportStartersReply } } }, async (request) => {
      requireUserId(request);
      return { starters: starterCards() };
    });

    app.get('/report-documents/:id', { schema: { params: reportIdParams, response: { 200: reportDetailView } } }, async (request) => {
      requireUserId(request);
      return detailOf(await mustFind(request.params.id));
    });

    // ── create ─────────────────────────────────────────────────────────────

    app.post(
      '/report-documents',
      {
        config: { audit: audited('rbac') },
        schema: { body: reportCreateBody, response: { 201: reportDetailView } },
      },
      async (request, reply) => {
        const userId = requireUserId(request);
        await requireSettingsManage(request, 'create report documents');
        const { kind } = request.body;
        const starterKey = request.body.starter ?? null;
        if (starterKey !== null && !isReportStarterKey(starterKey)) {
          throw new ValidationFailedError(`Unknown starter ${starterKey}.`, { starter: starterKey });
        }
        const at = app.rbac.now();
        let name: string;
        let body: ReportBody;
        let icon: string;
        if (starterKey !== null) {
          const starter = renderStarter(starterKey);
          name = request.body.name ?? starter.card.name;
          body = starter.body;
          icon = starter.card.icon;
        } else {
          const { t } = await translatorFor(meta, userId);
          name =
            request.body.name ??
            (kind === 'template'
              ? t('reportBuilder.untitled.template', { defaultValue: 'Untitled template' })
              : t('reportBuilder.untitled.report', { defaultValue: 'Untitled report' }));
          body = blankBody();
          icon = BLANK_ICON;
        }
        const row = await repo.create(
          {
            kind,
            name,
            status: 'draft',
            starter: starterKey,
            originId: null,
            body: bodyColumn(body),
            summary: summaryOf(body, { starterIcon: icon }),
            createdBy: userId,
          },
          at,
          { at: 'first' },
        );
        await app.rbac.audit(request, {
          category: 'settings',
          action: 'report-document.create',
          changes: { after: { id: row.id, kind, name, starter: starterKey } },
        });
        return await reply.status(201).send(detailOf(row));
      },
    );

    // ── the document ───────────────────────────────────────────────────────

    app.put(
      '/report-documents/:id',
      {
        config: { audit: audited('rbac') },
        schema: { params: reportIdParams, body: reportPutBody, response: { 200: reportDetailView } },
      },
      async (request) => {
        requireUserId(request);
        await requireSettingsManage(request, 'edit report documents');
        const row = await mustFind(request.params.id);
        const body = acceptReportBody(request.body.body);
        const { name, status } = request.body;
        const updated = await repo.patch(
          row.id,
          { name, status, body: bodyColumn(body), summary: summaryOf(body, { starterIcon: starterIcon(row.starter) }) },
          app.rbac.now(),
        );
        if (updated === null) throw new NotFoundError(`Report document ${row.id} not found.`);
        await app.rbac.audit(request, {
          category: 'settings',
          action: 'report-document.update',
          changes: {
            before: { name: row.name, status: row.status },
            after: { name, status, blocks: body.blocks.length },
          },
        });
        return detailOf(updated);
      },
    );

    app.patch(
      '/report-documents/:id',
      {
        config: { audit: audited('rbac') },
        schema: { params: reportIdParams, body: reportPatchBody, response: { 200: reportSummaryView } },
      },
      async (request) => {
        requireUserId(request);
        await requireSettingsManage(request, 'edit report documents');
        const row = await mustFind(request.params.id);
        const { name } = request.body;
        const next = name === undefined ? row : await repo.patch(row.id, { name }, app.rbac.now());
        if (next === null) throw new NotFoundError(`Report document ${row.id} not found.`);
        await app.rbac.audit(request, {
          category: 'settings',
          action: 'report-document.rename',
          changes: { before: { name: row.name }, after: { name: next.name } },
        });
        return summaryView(next);
      },
    );

    app.delete(
      '/report-documents/:id',
      {
        config: { audit: audited('rbac') },
        schema: { params: reportIdParams, response: { 204: z.null() } },
      },
      async (request, reply) => {
        requireUserId(request);
        await requireSettingsManage(request, 'delete report documents');
        const row = await mustFind(request.params.id);
        await repo.removeById(row.id);
        await app.rbac.audit(request, {
          category: 'settings',
          action: 'report-document.delete',
          changes: { before: { id: row.id, kind: row.kind, name: row.name } },
        });
        return await reply.status(204).send(null);
      },
    );

    // ── copies ─────────────────────────────────────────────────────────────

    app.post(
      '/report-documents/:id/duplicate',
      {
        config: { audit: audited('rbac') },
        schema: { params: reportIdParams, response: { 201: reportDetailView } },
      },
      async (request, reply) => {
        const userId = requireUserId(request);
        await requireSettingsManage(request, 'duplicate report documents');
        const row = await mustFind(request.params.id);
        const { t } = await translatorFor(meta, userId);
        const name = t('reportBuilder.copySuffix', { name: row.name, defaultValue: '{name} (copy)' });
        // A verbatim copy that starts as a draft (comp 555), placed directly
        // after its source.
        const copy = await repo.create(
          {
            kind: row.kind,
            name,
            status: 'draft',
            starter: row.starter,
            originId: row.originId,
            body: row.body,
            summary: row.summary,
            createdBy: userId,
          },
          app.rbac.now(),
          { after: row.id },
        );
        await app.rbac.audit(request, {
          category: 'settings',
          action: 'report-document.duplicate',
          changes: { before: { id: row.id, name: row.name }, after: { id: copy.id, name } },
        });
        return await reply.status(201).send(detailOf(copy));
      },
    );

    app.post(
      '/report-documents/:id/from-template',
      {
        config: { audit: audited('rbac') },
        schema: { params: reportIdParams, body: reportFromTemplateBody, response: { 201: reportDetailView } },
      },
      async (request, reply) => {
        const userId = requireUserId(request);
        await requireSettingsManage(request, 'create reports');
        // `:id` is the TEMPLATE the new report starts from; the
        // report remembers it as `originId` and is its own document from here.
        const source = await mustFind(request.params.id);
        if (source.kind !== 'template') {
          throw new ValidationFailedError('Only a template can start a report.', { kind: source.kind });
        }
        const body = normalizeReportBody(source.body);
        const name = request.body.name ?? source.name;
        const created = await repo.create(
          {
            kind: 'report',
            name,
            status: 'draft',
            starter: source.starter,
            originId: source.id,
            body: bodyColumn(body),
            summary: summaryOf(body, { starterIcon: starterIcon(source.starter) }),
            createdBy: userId,
          },
          app.rbac.now(),
          { at: 'first' },
        );
        await app.rbac.audit(request, {
          category: 'settings',
          action: 'report-document.from-template',
          changes: { after: { id: created.id, name, templateId: source.id } },
        });
        return await reply.status(201).send(detailOf(created));
      },
    );
  };
}
