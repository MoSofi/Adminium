/**
 * Email-templates routes (M7 reports/notifications track; 07-meta-store.md
 * §3.28 `adminium_email_templates`), mounted under `/api/v1`. The reply
 * bodies match `apps/dashboard/src/api/emailTemplates.ts` byte-for-byte (the
 * builders track shipped that client against this exact contract):
 *
 * - `GET /email-templates`              → `{ items: EmailTemplateListItem[] }`
 * - `GET /email-templates/:key/:locale` → item + `{ blocks }`
 * - `PUT /email-templates/:key/:locale` → upserted item; every editor write
 *   stamps `is_builtin_copy = false` (§3.28 — the row is now human-owned).
 *
 * Reads need a session (the manager page lists what the workspace sends);
 * writes are guarded by `system:settings:manage` per the track brief. No
 * emails are SENT in this build (no SMTP) — these rows are the editable
 * content for the release where a transport arrives, and the SPA copy says
 * so rather than hiding it.
 */
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { emailTemplatesRepo, type EmailTemplate, type MetaDb } from '@adminium/meta';

import { ForbiddenError, NotFoundError, UnauthorizedError } from '../../errors.js';
import { PERMISSIONS } from '../../rbac/permissions.js';
import {
  emailTemplateDetailReply,
  emailTemplateParams,
  emailTemplatePutBody,
  emailTemplatesListReply,
  type EmailTemplateListItemView,
} from './schema.js';

export interface EmailTemplatesRoutesDeps {
  meta: MetaDb;
}

function requireUserId(request: FastifyRequest): string {
  const user = (request as unknown as { user?: { id?: string } }).user;
  const id = user?.id ?? request.apiKeyPrincipal?.id ?? null;
  if (id === null) throw new UnauthorizedError();
  return id;
}

function toListItem(row: EmailTemplate): EmailTemplateListItemView {
  return {
    id: row.id,
    key: row.key,
    locale: row.locale,
    name: row.name,
    subject: row.subject,
    enabled: row.enabled,
    updatedAt: row.updatedAt,
  };
}

export function emailTemplatesRoutes(deps: EmailTemplatesRoutesDeps): FastifyPluginAsyncZod {
  const templates = emailTemplatesRepo(deps.meta);

  return async (app) => {
    app.get(
      '/email-templates',
      { schema: { response: { 200: emailTemplatesListReply } } },
      async (request) => {
        requireUserId(request);
        return { items: (await templates.list()).map(toListItem) };
      },
    );

    app.get(
      '/email-templates/:key/:locale',
      { schema: { params: emailTemplateParams, response: { 200: emailTemplateDetailReply } } },
      async (request) => {
        requireUserId(request);
        const { key, locale } = request.params;
        const row = await templates.findByKeyLocale(key, locale);
        if (row === null) throw new NotFoundError(`Email template ${key}/${locale} not found.`);
        return { ...toListItem(row), blocks: row.blocks };
      },
    );

    app.put(
      '/email-templates/:key/:locale',
      {
        schema: {
          params: emailTemplateParams,
          body: emailTemplatePutBody,
          response: { 200: emailTemplateDetailReply },
        },
      },
      async (request) => {
        const userId = requireUserId(request);
        if (!(await request.can(PERMISSIONS.settingsManage))) {
          throw new ForbiddenError('You do not have permission to edit email templates.', 'FORBIDDEN', {
            permission: PERMISSIONS.settingsManage,
          });
        }
        const { key, locale } = request.params;
        const { name, subject, blocks, enabled } = request.body;
        const row = await templates.upsert(key, locale, {
          name,
          subject,
          blocks,
          enabled,
          updatedBy: userId,
          isBuiltinCopy: false,
        });
        await app.rbac.audit(request, {
          category: 'settings',
          action: 'email-template.update',
          changes: { after: { key, locale, name, enabled, blocks: blocks.length } },
        });
        return { ...toListItem(row), blocks: row.blocks };
      },
    );
  };
}
