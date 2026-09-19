// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Invoice documents — templates and invoices
 * (`adminium_invoice_documents`, wave 0027), mounted under `/api/v1`. The
 * reply bodies are mirrored type-for-type by the invoices add-on page's
 * `api.ts` (the copied-mirror convention; the
 * SYNC NOTE is in `schema.ts`).
 *
 * THE AUTHORED SURFACE, NOT THE PIPELINE. Everything here lists, creates,
 * edits and saves what a person typed. Nothing here renders, prints or sends
 * — that is the render register's wave (34b), which will point back at these
 * rows. So there is no render, no PDF and no number sequence from the
 * register on this surface yet; `numbering.ts` is the surface's own counter.
 *
 * THE ONE RULE EVERY WRITE OBEYS (model): nothing writes the row while an
 * operator types. `PUT /:id` is the explicit save and it carries the
 * whole on-screen document; the summary and the denormalised number are
 * re-derived from it on every save, never patched piecemeal.
 *
 * DELETE IS A HARD DELETE. This comp has no archive — its `doDelete` (1386)
 * filters the row out of the array after a confirm — and the email surface's
 * archive shelf is a different product decision that this one did not make.
 * An invoice built from a template survives the template's deletion
 * untouched (`originId` is a soft ref).
 *
 * Reads need a session; every write needs `system:settings:manage` (the
 * email rule, — invoice documents add no permission key).
 */
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { invoiceDocumentsRepo, type InvoiceDocument, type MetaDb } from '@adminium/meta';

import { audited } from '../../audit/coverage.js';
import { ConflictError, ForbiddenError, NotFoundError, UnauthorizedError, ValidationFailedError } from '../../errors.js';
import { translatorFor } from '../../i18n/server-i18n.js';
import { acceptInvoiceBody, bodyColumn, normalizeInvoiceBody, type InvoiceBody } from '../../invoices/document.js';
import { isInvoiceLang, languageMeta, localizeBody, type InvoiceLang } from '../../invoices/languages.js';
import { TEMPLATE_NUMBER, nextInvoiceNumber } from '../../invoices/numbering.js';
import { blankBody, isInvoiceStarterKey, renderStarter, starterCards } from '../../invoices/starters.js';
import { summaryOf } from '../../invoices/summary.js';
import { PERMISSIONS } from '../../rbac/permissions.js';
import {
  invoiceAddLanguageBody,
  invoiceCreateBody,
  invoiceDetailView,
  invoiceFromTemplateBody,
  invoiceIdParams,
  invoicePatchBody,
  invoicePutBody,
  invoiceStartersReply,
  invoiceSummaryView,
  invoicesListQuery,
  invoicesListReply,
  type InvoiceDetailView,
  type InvoiceSummaryView,
} from './schema.js';

export interface InvoicesRoutesDeps {
  meta: MetaDb;
}

function requireUserId(request: FastifyRequest): string {
  const user = (request as unknown as { user?: { id?: string } }).user;
  const id = user?.id ?? request.apiKeyPrincipal?.id ?? null;
  if (id === null) throw new UnauthorizedError();
  return id;
}

function summaryView(row: InvoiceDocument): InvoiceSummaryView {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    status: row.status,
    topic: row.topic,
    lang: row.lang,
    starter: row.starter,
    originId: row.originId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    summary: row.summary,
  };
}

/** The comp's `addLangVariant` name (1246): the family name before the first ` · `, then the language's own name. */
function variantName(name: string, lang: InvoiceLang): string {
  return `${name.split(' · ')[0] ?? name} · ${languageMeta(lang).native}`;
}

export function invoicesRoutes(deps: InvoicesRoutesDeps): FastifyPluginAsyncZod {
  const { meta } = deps;
  const repo = invoiceDocumentsRepo(meta);

  async function detailOf(row: InvoiceDocument): Promise<InvoiceDetailView> {
    const siblings = await repo.siblings(row.kind, row.topic);
    return {
      ...summaryView(row),
      body: normalizeInvoiceBody(row.body),
      languages: siblings.map((s) => ({ id: s.id, lang: s.lang, name: s.name, status: s.status })),
    };
  }

  async function mustFind(id: string): Promise<InvoiceDocument> {
    const row = await repo.findById(id);
    if (row === null) throw new NotFoundError(`Invoice document ${id} not found.`);
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

    app.get('/invoices', { schema: { querystring: invoicesListQuery, response: { 200: invoicesListReply } } }, async (request) => {
      requireUserId(request);
      const rows = await repo.list({ kind: request.query.kind });
      // Counts are unfiltered on purpose: the tab badges say how many of each
      // kind exist, whichever tab is open (comp 1423).
      return { items: rows.map(summaryView), counts: await repo.counts() };
    });

    app.get('/invoices/starters', { schema: { response: { 200: invoiceStartersReply } } }, async (request) => {
      requireUserId(request);
      return { starters: starterCards() };
    });

    app.get('/invoices/:id', { schema: { params: invoiceIdParams, response: { 200: invoiceDetailView } } }, async (request) => {
      requireUserId(request);
      return await detailOf(await mustFind(request.params.id));
    });

    // ── create ─────────────────────────────────────────────────────────────

    app.post(
      '/invoices',
      {
        config: { audit: audited('rbac') },
        schema: { body: invoiceCreateBody, response: { 201: invoiceDetailView } },
      },
      async (request, reply) => {
        const userId = requireUserId(request);
        await requireSettingsManage(request, 'create invoice documents');
        const { kind } = request.body;
        const starterKey = request.body.starter ?? null;
        if (starterKey !== null && !isInvoiceStarterKey(starterKey)) {
          throw new ValidationFailedError(`Unknown starter ${starterKey}.`, { starter: starterKey });
        }
        const at = app.rbac.now();
        // A template's number is an example on a design; an invoice's is minted.
        const number = kind === 'invoice' ? await nextInvoiceNumber(repo) : TEMPLATE_NUMBER;
        const ctx = { now: at, lang: 'en' as const, number };
        let name: string;
        let body: InvoiceBody;
        let topic: InvoiceDocument['topic'];
        let status: InvoiceDocument['status'];
        if (starterKey !== null) {
          const starter = renderStarter(starterKey, ctx);
          name = request.body.name ?? starter.card.name;
          body = starter.body;
          topic = starter.topic;
          status = starter.status;
        } else {
          const { t } = await translatorFor(meta, userId);
          name =
            request.body.name ??
            (kind === 'template'
              ? t('invoices.untitled.template', { defaultValue: 'Untitled template' })
              : t('invoices.untitled.invoice', { defaultValue: 'Untitled invoice' }));
          body = blankBody(ctx);
          topic = 'other';
          status = 'draft';
        }
        const row = await repo.create(
          {
            kind,
            name,
            status,
            topic,
            lang: 'en',
            number,
            starter: starterKey,
            originId: null,
            body: bodyColumn(body),
            summary: summaryOf(body),
            createdBy: userId,
          },
          at,
          { at: 'first' },
        );
        await app.rbac.audit(request, {
          category: 'settings',
          action: 'invoice-document.create',
          changes: { after: { id: row.id, kind, name, number, starter: starterKey, topic } },
        });
        return await reply.status(201).send(await detailOf(row));
      },
    );

    // ── the document ───────────────────────────────────────────────────────

    app.put(
      '/invoices/:id',
      {
        config: { audit: audited('rbac') },
        schema: { params: invoiceIdParams, body: invoicePutBody, response: { 200: invoiceDetailView } },
      },
      async (request) => {
        requireUserId(request);
        await requireSettingsManage(request, 'edit invoice documents');
        const row = await mustFind(request.params.id);
        const body = acceptInvoiceBody(request.body.body);
        const { name, status, topic, lang } = request.body;
        const updated = await repo.patch(
          row.id,
          { name, status, topic, lang, body: bodyColumn(body), summary: summaryOf(body), number: body.number },
          app.rbac.now(),
        );
        if (updated === null) throw new NotFoundError(`Invoice document ${row.id} not found.`);
        await app.rbac.audit(request, {
          category: 'settings',
          action: 'invoice-document.update',
          changes: {
            before: { name: row.name, status: row.status, topic: row.topic, lang: row.lang, number: row.number },
            after: { name, status, topic, lang, number: body.number, items: body.items.length },
          },
        });
        return await detailOf(updated);
      },
    );

    app.patch(
      '/invoices/:id',
      {
        config: { audit: audited('rbac') },
        schema: { params: invoiceIdParams, body: invoicePatchBody, response: { 200: invoiceSummaryView } },
      },
      async (request) => {
        requireUserId(request);
        await requireSettingsManage(request, 'edit invoice documents');
        const row = await mustFind(request.params.id);
        const { name } = request.body;
        const next = name === undefined ? row : await repo.patch(row.id, { name }, app.rbac.now());
        if (next === null) throw new NotFoundError(`Invoice document ${row.id} not found.`);
        await app.rbac.audit(request, {
          category: 'settings',
          action: 'invoice-document.rename',
          changes: { before: { name: row.name }, after: { name: next.name } },
        });
        return summaryView(next);
      },
    );

    app.delete(
      '/invoices/:id',
      {
        config: { audit: audited('rbac') },
        schema: { params: invoiceIdParams, response: { 204: z.null() } },
      },
      async (request, reply) => {
        requireUserId(request);
        await requireSettingsManage(request, 'delete invoice documents');
        const row = await mustFind(request.params.id);
        await repo.removeById(row.id);
        await app.rbac.audit(request, {
          category: 'settings',
          action: 'invoice-document.delete',
          changes: { before: { id: row.id, kind: row.kind, name: row.name, number: row.number, topic: row.topic, lang: row.lang } },
        });
        return await reply.status(204).send(null);
      },
    );

    // ── families ───────────────────────────────────────────────────────────

    app.post(
      '/invoices/:id/duplicate',
      {
        config: { audit: audited('rbac') },
        schema: { params: invoiceIdParams, response: { 201: invoiceDetailView } },
      },
      async (request, reply) => {
        const userId = requireUserId(request);
        await requireSettingsManage(request, 'duplicate invoice documents');
        const row = await mustFind(request.params.id);
        const { t } = await translatorFor(meta, userId);
        const name = t('invoices.copySuffix', { name: row.name, defaultValue: '{name} (copy)' });
        // A verbatim copy, the number included (comp 1384) — the operator
        // renumbers when the copy becomes a document of its own.
        const copy = await repo.create(
          {
            kind: row.kind,
            name,
            status: 'draft',
            topic: row.topic,
            lang: row.lang,
            number: row.number,
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
          action: 'invoice-document.duplicate',
          changes: { before: { id: row.id, name: row.name }, after: { id: copy.id, name } },
        });
        return await reply.status(201).send(await detailOf(copy));
      },
    );

    app.post(
      '/invoices/:id/languages',
      {
        config: { audit: audited('rbac') },
        schema: { params: invoiceIdParams, body: invoiceAddLanguageBody, response: { 201: invoiceDetailView } },
      },
      async (request, reply) => {
        const userId = requireUserId(request);
        await requireSettingsManage(request, 'add invoice document languages');
        const row = await mustFind(request.params.id);
        const { lang } = request.body;
        if (!isInvoiceLang(lang)) {
          throw new ValidationFailedError(`${lang} is not a document language.`, { lang });
        }
        const existing = (await repo.siblings(row.kind, row.topic)).find((s) => s.lang === lang && s.id !== row.id);
        if (existing !== undefined) {
          // The client opens it instead (the comp's `addLangVariant`, 1242-1243).
          throw new ConflictError(`This topic already has a ${languageMeta(lang).native} variation.`, 'CONFLICT', {
            existingId: existing.id,
          });
        }
        const body = localizeBody(normalizeInvoiceBody(row.body), lang);
        const name = variantName(row.name, lang);
        const created = await repo.create(
          {
            kind: row.kind,
            name,
            status: 'draft',
            topic: row.topic,
            lang,
            number: row.number,
            starter: row.starter,
            originId: row.originId,
            body: bodyColumn(body),
            summary: summaryOf(body),
            createdBy: userId,
          },
          app.rbac.now(),
          { afterTopic: { kind: row.kind, topic: row.topic } },
        );
        await app.rbac.audit(request, {
          category: 'settings',
          action: 'invoice-document.language.add',
          changes: { before: { id: row.id, lang: row.lang }, after: { id: created.id, lang, name } },
        });
        return await reply.status(201).send(await detailOf(created));
      },
    );

    app.post(
      '/invoices/:id/from-template',
      {
        config: { audit: audited('rbac') },
        schema: { params: invoiceIdParams, body: invoiceFromTemplateBody, response: { 201: invoiceDetailView } },
      },
      async (request, reply) => {
        const userId = requireUserId(request);
        await requireSettingsManage(request, 'create invoices');
        // `:id` is the TEMPLATE the new invoice starts from; the
        // invoice remembers it as `originId` and is its own document from here.
        const source = await mustFind(request.params.id);
        if (source.kind !== 'template') {
          throw new ValidationFailedError('Only a template can start an invoice.', { kind: source.kind });
        }
        const at = app.rbac.now();
        const number = await nextInvoiceNumber(repo);
        // The row's number is denormalised from the body, so the minted number
        // lands on the sheet too; everything else is the template's, verbatim.
        const body: InvoiceBody = { ...normalizeInvoiceBody(source.body), number };
        const name = request.body.name ?? source.name;
        const invoice = await repo.create(
          {
            kind: 'invoice',
            name,
            status: 'draft',
            topic: source.topic,
            lang: source.lang,
            number,
            starter: source.starter,
            originId: source.id,
            body: bodyColumn(body),
            summary: summaryOf(body),
            createdBy: userId,
          },
          at,
          { at: 'first' },
        );
        await app.rbac.audit(request, {
          category: 'settings',
          action: 'invoice-document.from-template',
          changes: { after: { id: invoice.id, name, number, templateId: source.id } },
        });
        return await reply.status(201).send(await detailOf(invoice));
      },
    );
  };
}
