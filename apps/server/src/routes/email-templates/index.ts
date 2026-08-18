// SPDX-License-Identifier: AGPL-3.0-only
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
 * - `POST /email-templates/:key/test-send` → `202` — renders the template with
 *   placeholder vars and queues it to one address, so an operator can prove the
 *   relay works before a real user depends on it.
 *
 * Reads need a session (the manager page lists what the workspace sends);
 * writes and test sends are guarded by `system:settings:manage` per the track
 * brief.
 *
 * WHY TEST-SEND IS 409 AND NOT 422 when SMTP is unset. The request is
 * well-formed and the caller is authorized; what is wrong is the SERVER's
 * state — there is no transport configured yet. That is a conflict with the
 * current state of the resource, and it lets the SPA tell the operator to go
 * configure SMTP instead of hunting for a bad field in their own payload.
 */
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { emailTemplatesRepo, settingsRepo, type EmailTemplate, type MetaDb } from '@adminium/meta';

import { enqueueEmail, isEmailConfigured, requestOrigin } from '../../email/send.js';
import { ConflictError, ForbiddenError, NotFoundError, UnauthorizedError } from '../../errors.js';
import { recipientLocale } from '../../i18n/server-i18n.js';
import { audited } from '../../audit/coverage.js';
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
  /**
   * `ADMINIUM_SECRET`. Optional: compose registers this plugin with `{ meta }`
   * only, so the default reads it off `app.authContext` — the same place the
   * other bare-plugin routes reach for `Env`.
   */
  secret?: string | undefined;
}

/** Params of `POST /email-templates/:key/test-send` — no locale, see below. */
const emailTemplateKeyParams = z.object({ key: z.string().min(1).max(120) });

/**
 * Address to send the sample to. Deliberately NOT `z.string().email()`: the
 * repo validates addresses the same loose way `POST /users` does, and the SMTP
 * relay is the real authority on what it will accept.
 */
const emailTestSendBody = z.object({ to: z.string().trim().min(3).max(320) });

const emailTestSendReply = z.object({
  queued: z.literal(true),
  /** Which locale's row was rendered — the actor's, resolved server-side. */
  locale: z.string(),
});

/**
 * Placeholder substitutions for a test send. One flat map covering every
 * built-in template's vars, because the route takes no key-specific input: an
 * operator testing `password-reset` and one testing `user-invite` both get a
 * plausible-looking message, and a template whose var is missing here renders
 * whatever the renderer does with an unknown placeholder rather than 500ing.
 */
function sampleVars(appName: string, origin: string, to: string): Record<string, string> {
  return {
    appName,
    name: 'Sample Recipient',
    email: to,
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
    const secret = deps.secret ?? app.authContext?.env.ADMINIUM_SECRET ?? null;

    async function requireSettingsManage(request: FastifyRequest, what: string): Promise<void> {
      if (await request.can(PERMISSIONS.settingsManage)) return;
      throw new ForbiddenError(`You do not have permission to ${what}.`, 'FORBIDDEN', {
        permission: PERMISSIONS.settingsManage,
      });
    }

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
        await requireSettingsManage(request, 'edit email templates');
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

    app.post(
      '/email-templates/:key/test-send',
      {
        // Declared on the route rather than in AUDIT_COVERAGE: the row is
        // written a few lines below, and keeping the claim next to the write is
        // what stops the two drifting apart.
        config: { audit: audited('rbac') },
        schema: {
          params: emailTemplateKeyParams,
          body: emailTestSendBody,
          response: { 202: emailTestSendReply },
        },
      },
      async (request, reply) => {
        const userId = requireUserId(request);
        await requireSettingsManage(request, 'send test emails');
        const { key } = request.params;
        const to = request.body.to.trim();

        // `isEmailConfigured` is the one door that lets a bad stored value
        // surface instead of degrading — a password saved under a different
        // ADMINIUM_SECRET, a host a config-bundle import smuggled in. Both are
        // "your SMTP settings are not usable", which is the same 409.
        let configured = false;
        let reason = 'not configured';
        try {
          configured = await isEmailConfigured(deps.meta, secret);
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

        // The ACTOR's locale, not a path param: the point of a test send is to
        // see what the person clicking the button will receive.
        const locale = await recipientLocale(deps.meta, userId);
        const appName = await settingsRepo(deps.meta).get('branding.appName');
        const queued = await enqueueEmail(
          { meta: deps.meta, ...(secret === null ? {} : { secret }), logger: request.log },
          {
            to,
            templateKey: key,
            locale,
            vars: sampleVars(appName, requestOrigin(request), to),
          },
        );
        // SMTP was just verified, so the only remaining reason to queue nothing
        // is the template itself — absent for every candidate locale, or
        // switched off. Both are the caller's problem, and both are a 404.
        if (queued === null) {
          throw new NotFoundError(`No enabled email template ${key} exists for ${locale}.`, {
            key,
            locale,
          });
        }

        await app.rbac.audit(request, {
          category: 'settings',
          action: 'email-template.test-send',
          // The RECIPIENT is the audit-worthy fact; the rendered body is not,
          // and the token-bearing half of it never leaves the sealed payload.
          changes: { after: { key, locale, to } },
        });
        return await reply.status(202).send({ queued: true as const, locale });
      },
    );
  };
}
