// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Email documents — templates and campaigns (39-email-templates-and-campaigns.md
 * §3.1; 07-meta-store.md §3.28 `adminium_email_templates`), mounted under
 * `/api/v1`. The reply bodies are mirrored type-for-type by
 * `apps/dashboard/src/email/api.ts` (the copied-mirror convention).
 *
 * THE ONE RULE EVERY WRITE HERE OBEYS (39 D1): nothing writes the row while
 * an operator types. `PUT /:id` is the explicit save; the test send and the
 * mirror-to-siblings op both carry the ON-SCREEN document — the test send in
 * its body, the mirror ops on the save — so a half-typed password reset is
 * never the row `enqueueEmail` renders from between keystrokes.
 *
 * WHAT 39 RETIRED (D20). `PUT /email-templates/:key/:locale` (implicit create
 * by key, the M7 autosave's target) and `POST /email-templates/:key/test-send`
 * (one address, the stored row, the actor's locale) are gone; their semantics
 * are the ones this module replaces. `GET /email-templates/:key/:locale` stays
 * as a read alias.
 *
 * Reads need a session (the manager lists what the workspace sends); every
 * write, test send, import, export and campaign send needs
 * `system:settings:manage` (39 D19 — email documents add no permission key,
 * the json-payloads standing note).
 *
 * WHY TEST-SEND IS 409 AND NOT 422 when SMTP is unset. The request is
 * well-formed and the caller is authorized; what is wrong is the SERVER's
 * state — there is no transport configured yet. That is a conflict with the
 * current state of the resource, and it lets the SPA tell the operator to go
 * configure SMTP instead of hunting for a bad field in their own payload.
 */
import { createHash } from 'node:crypto';

import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  EmailTemplateExistsError,
  compareLocales,
  emailBlocksRepo,
  emailRunsRepo,
  emailTemplatesRepo,
  filesRepo,
  jobsRepo,
  localesRepo,
  newId,
  settingsRepo,
  type EmailAttachment,
  type EmailDocumentKind,
  type EmailRun,
  type EmailTemplate,
  type MetaDb,
} from '@adminium/meta';
import { allLocales, dirForLocale, isLocaleId, localeEntry } from '@adminium/i18n';

import { audited, auditExempt } from '../../audit/coverage.js';
import { resolveCampaignAudience } from '../../email/audience.js';
import { EMAIL_CAMPAIGN_RUN_KIND, EMAIL_CAMPAIGN_RUN_MAX_ATTEMPTS } from '../../jobs/email-campaign-run.js';
import { resetBuiltinEmailTemplate, translatorForLocale } from '../../email/builtins.js';
import {
  documentColumns,
  documentVars,
  isBuiltinEmailKey,
  mintKey,
  normalizeDocument,
  slugKey,
  validateDocument,
  type EmailDocument,
} from '../../email/document.js';
import { renderEmail } from '../../email/render.js';
import {
  enqueueRenderedEmail,
  isEmailConfigured,
  prepareEmail,
  requestOrigin,
  resolveGeneratedAttachments,
} from '../../email/send.js';
import { isEmailStarterKey, renderStarter, starterCards, starterSampleVars } from '../../email/starters.js';
import { ConflictError, ForbiddenError, NotFoundError, UnauthorizedError, ValidationFailedError } from '../../errors.js';
import type { FileStore } from '../../files/store.js';
import { translatorFor } from '../../i18n/server-i18n.js';
import { PERMISSIONS } from '../../rbac/permissions.js';
import {
  emailAddLanguageBody,
  emailAudiencePreviewBody,
  emailAudiencePreviewReply,
  emailBundle,
  emailCreateBody,
  emailDocumentDetail,
  emailDocumentsListQuery,
  emailDocumentsListReply,
  emailDocumentSummary,
  emailExportQuery,
  emailFromTemplateBody,
  emailIdParams,
  emailImportBody,
  emailImportReply,
  emailKeyLocaleParams,
  emailPatchBody,
  emailPutBody,
  emailRunCancelReply,
  emailRunsReply,
  emailSendBody,
  emailSendReply,
  emailStartersReply,
  emailTestSendBody,
  emailTestSendReply,
  savedBlockCreateBody,
  savedBlockDetailReply,
  savedBlocksListReply,
  type EmailBundle,
  type EmailDocumentDetailView,
  type EmailDocumentSummaryView,
  type EmailRunView,
} from './schema.js';

export interface EmailTemplatesRoutesDeps {
  meta: MetaDb;
  /**
   * `ADMINIUM_SECRET`. Optional: compose registers this plugin with `{ meta }`
   * only, so the default reads it off `app.authContext` — the same place the
   * other bare-plugin routes reach for `Env`.
   */
  secret?: string | undefined;
  /** Bytes for export (fixed attachments inline) and import (files re-created in the library). */
  storage?: FileStore | undefined;
  /**
   * `app.jobs.worker.requestCancel` — the cooperative cancel of a RUNNING
   * campaign (08 §2.17). Optional: a harness without a worker cancels only
   * scheduled runs.
   */
  cancelRunningJob?: ((jobId: string) => boolean) | undefined;
}

function requireUserId(request: FastifyRequest): string {
  const user = (request as unknown as { user?: { id?: string } }).user;
  const id = user?.id ?? request.apiKeyPrincipal?.id ?? null;
  if (id === null) throw new UnauthorizedError();
  return id;
}

function headingOf(row: EmailTemplate): string {
  for (const block of row.blocks) {
    if (block['block'] !== 'email.heading') continue;
    const data = block['data'];
    const text = typeof data === 'object' && data !== null ? (data as Record<string, unknown>)['text'] : undefined;
    return typeof text === 'string' ? text : '';
  }
  return '';
}

function runView(run: EmailRun): EmailRunView {
  return {
    id: run.id,
    status: run.status,
    total: run.total,
    sent: run.sent,
    failed: run.failed,
    skipped: run.skipped,
    scheduledAt: run.scheduledAt,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    jobId: run.jobId,
    audience: run.audience,
    failures: run.failures,
    createdAt: run.createdAt,
  };
}

/** The registry's picker order — what `compareLocales` sorts siblings by (39 D3). */
function localeOrder(): string[] {
  return allLocales().map((entry) => entry.id);
}

/** `topicLabel` per key: the `en_US` sibling's name, else the first in locale order (39 D3). */
function topicLabels(rows: readonly EmailTemplate[]): Map<string, string> {
  const order = localeOrder();
  const byKey = new Map<string, EmailTemplate[]>();
  for (const row of rows) byKey.set(row.key, [...(byKey.get(row.key) ?? []), row]);
  const out = new Map<string, string>();
  for (const [key, family] of byKey) {
    const sorted = [...family].sort((a, b) => compareLocales(a.locale, b.locale, order));
    out.set(key, sorted[0]?.name ?? key);
  }
  return out;
}

/** Sample substitutions for a test send — every built-in's and every starter's var, plausible and obviously fake. */
function testSendVars(appName: string, origin: string, to: string): Record<string, string> {
  return {
    ...starterSampleVars({ appName, origin, to }),
    inviterName: 'Sample Admin',
    resetUrl: `${origin}/reset/sample-token`,
    activationUrl: `${origin}/reset/sample-token`,
    expiresInMinutes: '30',
    expiresInDays: '7',
    title: `Test message from ${appName}`,
    body: 'This is a test message. If you received it, your SMTP settings work.',
    actionUrl: `${origin}/`,
  };
}

export function emailTemplatesRoutes(deps: EmailTemplatesRoutesDeps): FastifyPluginAsyncZod {
  const { meta } = deps;
  const templates = emailTemplatesRepo(meta);
  const blocks = emailBlocksRepo(meta);
  const runs = emailRunsRepo(meta);
  const files = filesRepo(meta);
  const settings = settingsRepo(meta);
  const jobs = jobsRepo(meta);

  async function knownLocale(locale: string): Promise<boolean> {
    if (!isLocaleId(locale)) return false;
    if (allLocales().some((entry) => entry.id === locale)) return true;
    return (await localesRepo(meta).list()).some((row) => row.locale === locale);
  }

  async function summaryOf(
    row: EmailTemplate,
    labels: Map<string, string>,
    latest: Map<string, EmailRun>,
  ): Promise<EmailDocumentSummaryView> {
    const run = latest.get(row.id);
    return {
      id: row.id,
      kind: row.kind,
      key: row.key,
      locale: row.locale,
      name: row.name,
      subject: row.subject,
      category: row.category,
      enabled: row.enabled,
      needsTranslation: row.needsTranslation,
      archivedAt: row.archivedAt,
      updatedAt: row.updatedAt,
      isBuiltin: isBuiltinEmailKey(row.key),
      isBuiltinCopy: row.isBuiltinCopy,
      starter: row.starter,
      brand: row.brand === null ? null : { accent: row.brand.accent, mark: row.brand.mark },
      heading: headingOf(row),
      topicLabel: labels.get(row.key) ?? row.name,
      ...(run === undefined ? {} : { run: runView(run) }),
    };
  }

  async function detailOf(row: EmailTemplate): Promise<EmailDocumentDetailView> {
    const siblings = await templates.siblings(row.key, { localeOrder: localeOrder() });
    const labels = topicLabels(siblings.length === 0 ? [row] : siblings);
    const latest = row.kind === 'campaign' ? await runs.latestByTemplates([row.id]) : new Map<string, EmailRun>();
    const attachmentsResolved = [];
    for (const attachment of row.attachments) {
      if (attachment.kind !== 'file') continue;
      const file = await files.findById(attachment.fileId);
      const missing = file === null || file.deletedAt !== null;
      attachmentsResolved.push({
        id: attachment.id,
        fileId: attachment.fileId,
        filename: missing ? attachment.fileId : file.filename,
        sizeBytes: missing ? 0 : file.sizeBytes,
        mime: missing ? '' : file.mime,
        missing,
      });
    }
    return {
      ...(await summaryOf(row, labels, latest)),
      document: normalizeDocument(row),
      vars: [...documentVars(row.key, row.starter)],
      languages: siblings.map((s) => ({
        id: s.id,
        locale: s.locale,
        needsTranslation: s.needsTranslation,
        enabled: s.enabled,
        archived: s.archivedAt !== null,
      })),
      attachmentsResolved,
    };
  }

  async function mustFind(id: string): Promise<EmailTemplate> {
    const row = await templates.findById(id);
    if (row === null) throw new NotFoundError(`Email document ${id} not found.`);
    return row;
  }

  /** The configured From addresses — `email.smtp.from` plus `email.senders` (39 D7). */
  async function senders(): Promise<string[]> {
    const [smtp, list] = await Promise.all([settings.get('email.smtp'), settings.get('email.senders')]);
    return [...(smtp === null ? [] : [smtp.from]), ...list.map((s) => s.address)];
  }

  /** Normalize + validate a wire document against the workspace (39 D7/D8/D9). */
  async function acceptDocument(input: Parameters<typeof normalizeDocument>[0]): Promise<EmailDocument> {
    const doc = normalizeDocument(input);
    const attachmentSizes = new Map<string, number | null>();
    for (const attachment of doc.attachments) {
      if (attachment.kind !== 'file') continue;
      const file = await files.findById(attachment.fileId);
      attachmentSizes.set(attachment.fileId, file === null || file.deletedAt !== null ? null : file.sizeBytes);
    }
    validateDocument(doc, {
      senders: await senders(),
      maxAttachmentBytes: await settings.get('email.maxAttachmentBytes'),
      attachmentSizes,
    });
    return doc;
  }

  /** A scheduled run cannot outlive its campaign's archive or deletion (39 D11). */
  async function cancelScheduledRun(templateId: string, at: number): Promise<void> {
    const run = await runs.active(templateId);
    if (run === null || run.status !== 'scheduled') return;
    if (run.jobId !== null) await jobs.cancel(run.jobId, at);
    await runs.update(run.id, { status: 'cancelled', finishedAt: at, jobId: null }, at);
  }

  async function mintFor(name: string): Promise<string> {
    return mintKey(name, await templates.keysLike(slugKey(name)));
  }

  /** The comp's `createBlank` (1055), through the target locale's translator. */
  function blankDocument(t: Awaited<ReturnType<typeof translatorForLocale>>['t']): EmailDocument {
    return normalizeDocument({
      subject: t('email.blank.subject', { defaultValue: 'Subject line' }),
      preheader: t('email.blank.preheader', { defaultValue: 'Preview text' }),
      blocks: [
        { block: 'email.heading', data: { text: t('email.blank.heading', { defaultValue: 'Heading goes here' }), level: 1 } },
        { block: 'email.text', data: { paras: [t('email.blank.para', { defaultValue: 'Start writing your email…' })] } },
        { block: 'email.button', data: { label: t('email.blank.cta', { defaultValue: 'Call to action' }), url: 'https://example.com/' } },
      ],
      footer: '',
      brand: null,
      attachments: [],
    });
  }

  return async (app) => {
    const secret = deps.secret ?? app.authContext?.env.ADMINIUM_SECRET ?? null;

    async function requireSettingsManage(request: FastifyRequest, what: string): Promise<void> {
      if (await request.can(PERMISSIONS.settingsManage)) return;
      throw new ForbiddenError(`You do not have permission to ${what}.`, 'FORBIDDEN', {
        permission: PERMISSIONS.settingsManage,
      });
    }

    // ── reads ──────────────────────────────────────────────────────────────

    app.get(
      '/email-templates',
      { schema: { querystring: emailDocumentsListQuery, response: { 200: emailDocumentsListReply } } },
      async (request) => {
        requireUserId(request);
        const { kind, archived, q } = request.query;
        const rows = await templates.list({ kind, archived: archived ?? false, q });
        // Topic labels come from the whole family, not the filtered page: a
        // search that matches only the German variant still labels the topic
        // with the English name.
        const familyRows = q === undefined || q === '' ? rows : await templates.list({ kind, archived: archived ?? false });
        const labels = topicLabels(familyRows);
        const latest = await runs.latestByTemplates(rows.filter((r) => r.kind === 'campaign').map((r) => r.id));
        const items = [];
        for (const row of rows) items.push(await summaryOf(row, labels, latest));
        return { items, counts: await templates.counts(archived ?? false) };
      },
    );

    app.get('/email-templates/starters', { schema: { response: { 200: emailStartersReply } } }, async (request) => {
      const userId = requireUserId(request);
      const { t } = await translatorFor(meta, userId);
      return { starters: starterCards(t) };
    });

    app.get(
      '/email-templates/export',
      { schema: { querystring: emailExportQuery, response: { 200: emailBundle } } },
      async (request, reply) => {
        requireUserId(request);
        await requireSettingsManage(request, 'export email templates');
        const wanted = request.query.ids === undefined ? null : new Set(request.query.ids.split(',').map((s) => s.trim()).filter(Boolean));
        const rows = (await templates.list({ kind: request.query.kind })).filter((r) => wanted === null || wanted.has(r.id));
        const cap = await settings.get('email.maxAttachmentBytes');
        const documents: EmailBundle['documents'] = [];
        for (const row of rows) {
          const doc = normalizeDocument(row);
          const bundled: EmailBundle['documents'][number]['files'] = [];
          for (const attachment of doc.attachments) {
            if (attachment.kind !== 'file' || deps.storage === undefined) continue;
            const file = await files.findById(attachment.fileId);
            if (file === null || file.deletedAt !== null || file.sizeBytes > cap) continue;
            const opened = await deps.storage.open({ destinationId: file.destinationId, storageKey: file.storageKey });
            const chunks: Buffer[] = [];
            for await (const chunk of opened.stream) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
            bundled.push({
              attachmentId: attachment.id,
              filename: file.filename,
              mime: file.mime,
              sha256: file.sha256,
              base64: Buffer.concat(chunks).toString('base64'),
            });
          }
          documents.push({
            kind: row.kind,
            key: row.key,
            locale: row.locale,
            name: row.name,
            category: row.category,
            starter: row.starter,
            subject: doc.subject,
            preheader: doc.preheader,
            blocks: documentColumns(doc).blocks,
            footer: doc.footer,
            brand: doc.brand,
            attachments: doc.attachments,
            files: bundled,
          });
        }
        const date = new Date(app.rbac.now()).toISOString().slice(0, 10);
        void reply.header('content-disposition', `attachment; filename="adminium-email-templates-${date}.json"`);
        return { adminium: { kind: 'email-templates' as const, version: 1 as const }, documents };
      },
    );

    app.get('/email-blocks', { schema: { response: { 200: savedBlocksListReply } } }, async (request) => {
      requireUserId(request);
      return { blocks: (await blocks.list()).map((b) => ({ id: b.id, name: b.name, block: b.block, createdAt: b.createdAt })) };
    });

    app.get(
      '/email-templates/:key/:locale',
      { schema: { params: emailKeyLocaleParams, response: { 200: emailDocumentDetail } } },
      async (request) => {
        requireUserId(request);
        const { key, locale } = request.params;
        const row = await templates.findByKeyLocale(key, locale);
        if (row === null) throw new NotFoundError(`Email template ${key}/${locale} not found.`);
        return await detailOf(row);
      },
    );

    app.get(
      '/email-templates/:id',
      { schema: { params: emailIdParams, response: { 200: emailDocumentDetail } } },
      async (request) => {
        requireUserId(request);
        return await detailOf(await mustFind(request.params.id));
      },
    );

    // ── create ─────────────────────────────────────────────────────────────

    app.post(
      '/email-templates',
      {
        config: { audit: audited('rbac') },
        schema: { body: emailCreateBody, response: { 201: emailDocumentDetail } },
      },
      async (request, reply) => {
        const userId = requireUserId(request);
        await requireSettingsManage(request, 'create email templates');
        const { kind } = request.body;
        const locale = request.body.locale ?? 'en_US';
        if (!(await knownLocale(locale))) {
          throw new ValidationFailedError(`${locale} is not a locale this workspace knows.`, { locale });
        }
        const starterKey = request.body.starter ?? null;
        if (starterKey !== null && !isEmailStarterKey(starterKey)) {
          throw new ValidationFailedError(`Unknown starter ${starterKey}.`, { starter: starterKey });
        }
        const { t: tl } = await translatorForLocale(meta, locale);
        let name: string;
        let doc: EmailDocument;
        let category: EmailTemplate['category'];
        if (starterKey !== null) {
          const starter = renderStarter(starterKey, tl);
          name = request.body.name ?? starter.name;
          doc = starter.document;
          category = starter.category;
        } else {
          const { t } = await translatorFor(meta, userId);
          name =
            request.body.name ??
            (kind === 'template'
              ? t('email.untitled.template', { defaultValue: 'Untitled template' })
              : t('email.untitled.campaign', { defaultValue: 'Untitled campaign' }));
          doc = blankDocument(tl);
          category = 'lifecycle';
        }
        const row = await templates.create(
          {
            kind,
            key: await mintFor(name),
            locale,
            name,
            category,
            starter: starterKey,
            enabled: false,
            createdBy: userId,
            ...documentColumns(doc),
          },
          app.rbac.now(),
        );
        await app.rbac.audit(request, {
          category: 'settings',
          action: 'email-template.create',
          changes: { after: { id: row.id, kind, key: row.key, locale, name, starter: starterKey } },
        });
        return await reply.status(201).send(await detailOf(row));
      },
    );

    // ── the document ───────────────────────────────────────────────────────

    app.put(
      '/email-templates/:id',
      {
        config: { audit: audited('rbac') },
        schema: { params: emailIdParams, body: emailPutBody, response: { 200: emailDocumentDetail } },
      },
      async (request) => {
        const userId = requireUserId(request);
        await requireSettingsManage(request, 'edit email templates');
        const row = await mustFind(request.params.id);
        const doc = await acceptDocument(request.body.document);
        const at = app.rbac.now();
        const { name, category, enabled } = request.body;
        const updated = await templates.patch(
          row.id,
          {
            name,
            category,
            enabled,
            ...documentColumns(doc),
            // The row is human-owned now, and a saved variant is a translated one (39 D3).
            isBuiltinCopy: false,
            needsTranslation: false,
            updatedBy: userId,
          },
          at,
        );
        if (updated === null) throw new NotFoundError(`Email document ${row.id} not found.`);
        const mirrored =
          request.body.mirrorOps === undefined || request.body.mirrorOps.length === 0
            ? []
            : await templates.applyMirrorOps(row.id, request.body.mirrorOps, { updatedBy: userId, at });
        await app.rbac.audit(request, {
          category: 'settings',
          action: 'email-template.update',
          changes: {
            before: { name: row.name, enabled: row.enabled, blocks: row.blocks.length },
            after: { key: row.key, locale: row.locale, name, enabled, blocks: doc.blocks.length, mirrored: mirrored.length },
          },
        });
        return await detailOf(updated);
      },
    );

    app.patch(
      '/email-templates/:id',
      {
        config: { audit: audited('rbac') },
        schema: { params: emailIdParams, body: emailPatchBody, response: { 200: emailDocumentSummary } },
      },
      async (request) => {
        const userId = requireUserId(request);
        await requireSettingsManage(request, 'edit email templates');
        const row = await mustFind(request.params.id);
        const at = app.rbac.now();
        const { name, enabled, category, archived } = request.body;
        let next: EmailTemplate | null = row;
        if (name !== undefined || category !== undefined || enabled !== undefined) {
          next = await templates.patch(
            row.id,
            {
              ...(name === undefined ? {} : { name }),
              ...(category === undefined ? {} : { category }),
              ...(enabled === undefined ? {} : { enabled }),
              // A rename or a re-categorisation is a human edit the seed must respect; the
              // Draft/Live pill alone is not (the seed has always preserved `enabled`).
              ...(name === undefined && category === undefined ? {} : { isBuiltinCopy: false }),
              updatedBy: userId,
            },
            at,
          );
        }
        if (archived === true) {
          await cancelScheduledRun(row.id, at);
          next = await templates.archive(row.id, at);
        } else if (archived === false) {
          next = await templates.restore(row.id, at);
        }
        if (next === null) throw new NotFoundError(`Email document ${row.id} not found.`);
        await app.rbac.audit(request, {
          category: 'settings',
          action: archived === undefined ? 'email-template.update' : archived ? 'email-template.archive' : 'email-template.restore',
          changes: { before: { name: row.name, enabled: row.enabled, archived: row.archivedAt !== null }, after: { ...request.body } },
        });
        const siblings = await templates.siblings(next.key, { localeOrder: localeOrder() });
        const latest = next.kind === 'campaign' ? await runs.latestByTemplates([next.id]) : new Map<string, EmailRun>();
        return await summaryOf(next, topicLabels(siblings), latest);
      },
    );

    app.delete(
      '/email-templates/:id',
      {
        config: { audit: audited('rbac') },
        schema: { params: emailIdParams, response: { 200: emailDocumentDetail, 204: z.null() } },
      },
      async (request, reply) => {
        requireUserId(request);
        await requireSettingsManage(request, 'delete email templates');
        const row = await mustFind(request.params.id);
        const at = app.rbac.now();
        await cancelScheduledRun(row.id, at);
        if (isBuiltinEmailKey(row.key)) {
          // A built-in can never be absent: "delete for good" resets it (39 D4).
          const reset = await resetBuiltinEmailTemplate(meta, row.key, row.locale, at);
          if (reset === null) throw new NotFoundError(`Email document ${row.id} not found.`);
          await app.rbac.audit(request, {
            category: 'settings',
            action: 'email-template.reset',
            changes: { before: { name: row.name }, after: { key: row.key, locale: row.locale, isBuiltinCopy: true } },
          });
          return await detailOf(reset);
        }
        await templates.removeById(row.id);
        await app.rbac.audit(request, {
          category: 'settings',
          action: 'email-template.delete',
          changes: { before: { id: row.id, kind: row.kind, key: row.key, locale: row.locale, name: row.name } },
        });
        return await reply.status(204).send(null);
      },
    );

    // ── families ───────────────────────────────────────────────────────────

    app.post(
      '/email-templates/:id/duplicate',
      {
        config: { audit: audited('rbac') },
        schema: { params: emailIdParams, response: { 201: emailDocumentDetail } },
      },
      async (request, reply) => {
        const userId = requireUserId(request);
        await requireSettingsManage(request, 'duplicate email templates');
        const row = await mustFind(request.params.id);
        const { t } = await translatorFor(meta, userId);
        const name = t('email.copySuffix', { name: row.name, defaultValue: '{name} (copy)' });
        const copy = await templates.create(
          {
            kind: row.kind,
            key: await mintFor(name),
            locale: row.locale,
            name,
            category: row.category,
            starter: row.starter,
            needsTranslation: row.needsTranslation,
            enabled: false,
            createdBy: userId,
            ...documentColumns(normalizeDocument(row)),
          },
          app.rbac.now(),
        );
        await app.rbac.audit(request, {
          category: 'settings',
          action: 'email-template.duplicate',
          changes: { before: { id: row.id, key: row.key }, after: { id: copy.id, key: copy.key, name } },
        });
        return await reply.status(201).send(await detailOf(copy));
      },
    );

    app.post(
      '/email-templates/:id/languages',
      {
        config: { audit: audited('rbac') },
        schema: { params: emailIdParams, body: emailAddLanguageBody, response: { 201: emailDocumentDetail } },
      },
      async (request, reply) => {
        const userId = requireUserId(request);
        await requireSettingsManage(request, 'add email template languages');
        const row = await mustFind(request.params.id);
        const { locale } = request.body;
        if (!(await knownLocale(locale))) {
          throw new ValidationFailedError(`${locale} is not a locale this workspace knows.`, { locale });
        }
        const existing = await templates.findByKeyLocale(row.key, locale);
        if (existing !== null) {
          // The client opens it instead (39 §3.1).
          throw new ConflictError(`${row.key} already has a ${locale} variation.`, 'CONFLICT', { existingId: existing.id });
        }
        const siblings = await templates.siblings(row.key, { localeOrder: localeOrder() });
        const topicLabel = topicLabels(siblings).get(row.key) ?? row.name;
        let name: string;
        let doc: EmailDocument;
        let needsTranslation: boolean;
        if (row.starter !== null && isEmailStarterKey(row.starter)) {
          // A starter family: the starter itself, in the target language (39 D3).
          const { t } = await translatorForLocale(meta, locale);
          const starter = renderStarter(row.starter, t);
          name = starter.name;
          // Structure the operator set on the family travels; copy comes from the starter.
          doc = { ...starter.document, brand: row.brand, attachments: row.attachments };
          needsTranslation = false;
        } else {
          name = `${topicLabel} · ${localeEntry(locale).native}`;
          doc = normalizeDocument(row);
          needsTranslation = true;
        }
        let created: EmailTemplate;
        try {
          created = await templates.create(
            {
              kind: row.kind,
              key: row.key,
              locale,
              name,
              category: row.category,
              starter: row.starter,
              needsTranslation,
              enabled: false,
              createdBy: userId,
              ...documentColumns(doc),
            },
            app.rbac.now(),
          );
        } catch (error) {
          if (error instanceof EmailTemplateExistsError) {
            throw new ConflictError(`${row.key} already has a ${locale} variation.`, 'CONFLICT');
          }
          throw error;
        }
        await app.rbac.audit(request, {
          category: 'settings',
          action: 'email-template.language.add',
          changes: { after: { id: created.id, key: row.key, locale, needsTranslation } },
        });
        return await reply.status(201).send(await detailOf(created));
      },
    );

    app.post(
      '/email-templates/:id/from-template',
      {
        config: { audit: audited('rbac') },
        schema: { params: emailIdParams, body: emailFromTemplateBody, response: { 201: emailDocumentDetail } },
      },
      async (request, reply) => {
        const userId = requireUserId(request);
        await requireSettingsManage(request, 'create campaigns');
        // `:id` is the TEMPLATE the new campaign starts from (39 D21: the
        // campaign tab's New modal lists the workspace's templates); the
        // campaign is minted here, in one request, from the template's document.
        const source = await mustFind(request.params.id);
        if (source.kind !== 'template' || source.archivedAt !== null) {
          throw new ConflictError('Only a live template can start a campaign.', 'CONFLICT', { kind: source.kind });
        }
        const name = request.body.name ?? source.name;
        const doc = normalizeDocument(source);
        const campaign = await templates.create(
          {
            kind: 'campaign',
            key: await mintFor(name),
            locale: source.locale,
            name,
            category: source.category,
            starter: source.starter,
            enabled: false,
            createdBy: userId,
            ...documentColumns(doc),
          },
          app.rbac.now(),
        );
        await app.rbac.audit(request, {
          category: 'settings',
          action: 'email-template.from-template',
          changes: { after: { id: campaign.id, key: campaign.key, templateId: source.id } },
        });
        return await reply.status(201).send(await detailOf(campaign));
      },
    );

    // ── test send (39 D1: the on-screen document) ──────────────────────────

    app.post(
      '/email-templates/:id/test-send',
      {
        config: { audit: audited('rbac') },
        schema: { params: emailIdParams, body: emailTestSendBody, response: { 202: emailTestSendReply } },
      },
      async (request, reply) => {
        requireUserId(request);
        await requireSettingsManage(request, 'send test emails');
        const row = await mustFind(request.params.id);

        // `isEmailConfigured` is the one door that lets a bad stored value
        // surface instead of degrading — a password saved under a different
        // ADMINIUM_SECRET, a host a config-bundle import smuggled in. Both are
        // "your SMTP settings are not usable", which is the same 409.
        let configured = false;
        let reason = 'not configured';
        try {
          configured = await isEmailConfigured(meta, secret);
        } catch (error) {
          reason = error instanceof Error ? error.message : 'unreadable';
        }
        if (!configured) {
          throw new ConflictError(
            reason === 'not configured'
              ? 'No SMTP transport is configured — set one up before sending a test message.'
              : reason,
            'CONFLICT',
            { setting: 'email.smtp', reason },
          );
        }

        const doc = await acceptDocument(request.body.document);
        const appName = await settings.get('branding.appName');
        const origin = requestOrigin(request);
        const prepared = await prepareEmail(meta, doc);
        const locale = row.locale;
        let queued = 0;
        for (const to of request.body.to) {
          const vars = testSendVars(appName, origin, to);
          const generated = await resolveGeneratedAttachments(meta, doc.attachments, vars, request.log);
          const rendered = renderEmail({
            ...prepared.render,
            locale,
            vars,
            dir: isLocaleId(locale) ? dirForLocale(locale) : 'ltr',
          });
          const job = await enqueueRenderedEmail(
            { meta, ...(secret === null ? {} : { secret }), logger: request.log },
            {
              to,
              templateKey: row.key,
              locale,
              rendered,
              from: prepared.from,
              attachments: [...prepared.attachments, ...generated],
            },
          );
          if (job !== null) queued += 1;
        }
        await app.rbac.audit(request, {
          category: 'settings',
          action: 'email-template.test-send',
          // The RECIPIENTS are the audit-worthy fact; the rendered body is not,
          // and the token-bearing half of it never leaves the sealed payload.
          changes: { after: { id: row.id, key: row.key, locale, to: request.body.to } },
        });
        return await reply.status(202).send({ queued, locale });
      },
    );

    // ── campaigns (39 D11) ─────────────────────────────────────────────────

    app.post(
      '/email-templates/:id/audience/preview',
      {
        // A recipient COUNT: reads the directory and the prefs matrix, writes nothing.
        config: { audit: auditExempt('a recipient count — reads the directory and the prefs matrix, writes nothing') },
        schema: { params: emailIdParams, body: emailAudiencePreviewBody, response: { 200: emailAudiencePreviewReply } },
      },
      async (request) => {
        requireUserId(request);
        await requireSettingsManage(request, 'send campaigns');
        await mustFind(request.params.id);
        const audience = await resolveCampaignAudience(meta, request.body.audience);
        return { total: audience.total, skipped: audience.skipped };
      },
    );

    app.post(
      '/email-templates/:id/send',
      {
        config: { audit: audited('rbac') },
        schema: { params: emailIdParams, body: emailSendBody, response: { 202: emailSendReply } },
      },
      async (request, reply) => {
        const userId = requireUserId(request);
        await requireSettingsManage(request, 'send campaigns');
        const row = await mustFind(request.params.id);
        if (row.kind !== 'campaign') {
          throw new ConflictError('Only a campaign can be sent to an audience.', 'CONFLICT', { kind: row.kind });
        }
        if (row.archivedAt !== null) throw new ConflictError('An archived campaign cannot be sent.', 'CONFLICT');
        let configured = false;
        try {
          configured = await isEmailConfigured(meta, secret);
        } catch {
          configured = false;
        }
        if (!configured) {
          throw new ConflictError('No SMTP transport is configured — set one up before sending a campaign.', 'CONFLICT', {
            setting: 'email.smtp',
          });
        }
        const active = await runs.active(row.id);
        if (active !== null) {
          throw new ConflictError(
            active.status === 'running' ? 'This campaign is being sent right now.' : 'This campaign is already scheduled.',
            'CONFLICT',
            { runId: active.id, status: active.status },
          );
        }
        const at = app.rbac.now();
        const scheduleAt = request.body.scheduleAt;
        if (scheduleAt !== undefined && scheduleAt < at - 60_000) {
          throw new ValidationFailedError('The scheduled time is in the past.', { scheduleAt });
        }
        const runAt = scheduleAt ?? at;
        const run = await runs.create(
          { templateId: row.id, audience: request.body.audience, scheduledAt: runAt, createdBy: userId },
          at,
        );
        const job = await jobs.enqueue(
          {
            kind: EMAIL_CAMPAIGN_RUN_KIND,
            payload: { runId: run.id, templateId: row.id, userId },
            runAt,
            maxAttempts: EMAIL_CAMPAIGN_RUN_MAX_ATTEMPTS,
          },
          at,
        );
        const withJob = (await runs.update(run.id, { jobId: job.id }, at)) ?? run;
        await app.rbac.audit(request, {
          category: 'settings',
          action: scheduleAt === undefined ? 'email-campaign.send' : 'email-campaign.schedule',
          changes: { after: { id: row.id, key: row.key, runId: run.id, jobId: job.id, audience: request.body.audience, runAt } },
        });
        return await reply.status(202).send({ run: runView(withJob) });
      },
    );

    app.get(
      '/email-templates/:id/runs',
      { schema: { params: emailIdParams, response: { 200: emailRunsReply } } },
      async (request) => {
        requireUserId(request);
        const row = await mustFind(request.params.id);
        return { runs: (await runs.listByTemplate(row.id)).map(runView) };
      },
    );

    app.post(
      '/email-runs/:id/cancel',
      {
        config: { audit: audited('rbac') },
        schema: { params: emailIdParams, response: { 200: emailRunCancelReply } },
      },
      async (request) => {
        requireUserId(request);
        await requireSettingsManage(request, 'cancel campaign sends');
        const run = await runs.findById(request.params.id);
        if (run === null) throw new NotFoundError(`Campaign run ${request.params.id} not found.`);
        const at = app.rbac.now();
        let next = run;
        if (run.status === 'scheduled') {
          if (run.jobId !== null) await jobs.cancel(run.jobId, at);
          next = (await runs.update(run.id, { status: 'cancelled', finishedAt: at, jobId: null }, at)) ?? run;
        } else if (run.status === 'running') {
          // Cooperative (08 §2.17): the worker aborts the handler's signal, and
          // the handler records `cancelled` with the counts so far.
          if (run.jobId !== null) deps.cancelRunningJob?.(run.jobId);
        } else {
          throw new ConflictError(`This run is already ${run.status}.`, 'CONFLICT', { status: run.status });
        }
        await app.rbac.audit(request, {
          category: 'settings',
          action: 'email-campaign.cancel',
          changes: { before: { runId: run.id, status: run.status }, after: { status: next.status } },
        });
        return { run: runView(next) };
      },
    );

    // ── import (39 D14) ────────────────────────────────────────────────────

    app.post(
      '/email-templates/import',
      {
        config: { audit: audited('rbac') },
        schema: { body: emailImportBody, response: { 200: emailImportReply } },
      },
      async (request) => {
        const userId = requireUserId(request);
        await requireSettingsManage(request, 'import email templates');
        const { bundle, mode } = request.body;
        const at = app.rbac.now();

        // Refuse the WHOLE bundle before writing anything when a document names
        // a sender this workspace has not configured (39 D7): the 422 names them
        // so the operator can add them and retry.
        const configured = (await senders()).map((s) => s.toLowerCase());
        const unconfigured = new Set<string>();
        for (const document of bundle.documents) {
          const from = document.brand?.fromEmail.trim() ?? '';
          if (from !== '' && !configured.some((s) => s.includes(from.toLowerCase()))) unconfigured.add(from);
        }
        if (unconfigured.size > 0) {
          throw new ValidationFailedError(`The bundle sends from addresses that are not configured senders: ${[...unconfigured].join(', ')}.`, {
            code: 'SENDER_NOT_CONFIGURED',
            addresses: [...unconfigured],
          });
        }

        let created = 0;
        let replaced = 0;
        let skipped = 0;
        const errors: { key: string; locale: string; reason: string }[] = [];
        for (const document of bundle.documents) {
          try {
            // Attachment bytes first (dedupe on sha256), so the document's ids resolve.
            const fileIds = new Map<string, string>();
            for (const file of document.files) {
              const bytes = Buffer.from(file.base64, 'base64');
              const sha256 = createHash('sha256').update(bytes).digest('hex');
              if (sha256 !== file.sha256) throw new Error(`attachment ${file.filename} does not match its sha256`);
              const existingFile = await files.findBySha256(sha256);
              if (existingFile !== null) {
                fileIds.set(file.attachmentId, existingFile.id);
                continue;
              }
              if (deps.storage === undefined) throw new Error('no file store is wired — attachments cannot be imported');
              const id = newId('file');
              const stored = await deps.storage.write({ id, kind: 'upload', filename: file.filename, mime: file.mime, bytes });
              await files.create(
                {
                  id,
                  storage: stored.storage,
                  storageKey: stored.storageKey,
                  filename: file.filename,
                  mime: file.mime,
                  sizeBytes: stored.sizeBytes,
                  sha256: stored.sha256,
                  kind: 'upload',
                  uploadedBy: userId,
                  destinationId: stored.destinationId,
                  // A library file (38 D4): claimed, so the unattached sweep leaves it.
                  attachedAt: at,
                },
                at,
              );
              fileIds.set(file.attachmentId, id);
            }
            const attachments: EmailAttachment[] = [];
            for (const attachment of document.attachments) {
              if (attachment.kind !== 'file') {
                attachments.push(attachment);
                continue;
              }
              const fileId = fileIds.get(attachment.id);
              if (fileId !== undefined) attachments.push({ ...attachment, fileId });
            }
            const doc = normalizeDocument({
              subject: document.subject,
              preheader: document.preheader,
              blocks: document.blocks,
              footer: document.footer,
              brand: document.brand,
              attachments,
            });
            const existing = await templates.findByKeyLocale(document.key, document.locale);
            if (existing !== null) {
              if (mode === 'skip') {
                skipped += 1;
                continue;
              }
              await templates.patch(
                existing.id,
                {
                  name: document.name,
                  category: document.category,
                  starter: document.starter,
                  ...documentColumns(doc),
                  isBuiltinCopy: false,
                  updatedBy: userId,
                },
                at,
              );
              replaced += 1;
              continue;
            }
            if (isBuiltinEmailKey(document.key)) {
              // A built-in pair that does not exist is one the seed has not run for; it is never minted here.
              errors.push({ key: document.key, locale: document.locale, reason: 'built-in keys can only replace an existing row' });
              continue;
            }
            await templates.create(
              {
                kind: document.kind as EmailDocumentKind,
                key: document.key,
                locale: document.locale,
                name: document.name,
                category: document.category,
                starter: document.starter,
                enabled: false,
                createdBy: userId,
                ...documentColumns(doc),
              },
              at,
            );
            created += 1;
          } catch (error) {
            errors.push({
              key: document.key,
              locale: document.locale,
              reason: error instanceof Error ? error.message : String(error),
            });
          }
        }
        await app.rbac.audit(request, {
          category: 'settings',
          action: 'email-template.import',
          changes: { after: { mode, documents: bundle.documents.length, created, replaced, skipped, errors: errors.length } },
        });
        return { created, replaced, skipped, errors };
      },
    );

    // ── saved blocks ───────────────────────────────────────────────────────

    app.post(
      '/email-blocks',
      {
        config: { audit: audited('rbac') },
        schema: { body: savedBlockCreateBody, response: { 201: savedBlockDetailReply } },
      },
      async (request, reply) => {
        const userId = requireUserId(request);
        await requireSettingsManage(request, 'save email blocks');
        const saved = await blocks.create({ name: request.body.name, block: request.body.block, createdBy: userId }, app.rbac.now());
        await app.rbac.audit(request, {
          category: 'settings',
          action: 'email-block.create',
          changes: { after: { id: saved.id, name: saved.name, block: String(saved.block['block'] ?? '') } },
        });
        return await reply.status(201).send({ block: { id: saved.id, name: saved.name, block: saved.block, createdAt: saved.createdAt } });
      },
    );

    app.delete(
      '/email-blocks/:id',
      {
        config: { audit: audited('rbac') },
        schema: { params: emailIdParams, response: { 204: z.null() } },
      },
      async (request, reply) => {
        requireUserId(request);
        await requireSettingsManage(request, 'delete email blocks');
        const saved = await blocks.findById(request.params.id);
        if (saved === null) throw new NotFoundError(`Saved block ${request.params.id} not found.`);
        await blocks.remove(saved.id);
        await app.rbac.audit(request, {
          category: 'settings',
          action: 'email-block.delete',
          changes: { before: { id: saved.id, name: saved.name } },
        });
        return await reply.status(204).send(null);
      },
    );
  };
}
