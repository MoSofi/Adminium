// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Built-in transactional email templates and their boot-time seed.
 *
 * A fresh install has ZERO rows in `adminium_email_templates` — the table, the
 * repo, the CRUD route and the editor all shipped, but nothing ever wrote a
 * template. So the first thing every install needs is content, and it has to
 * arrive the way `seedBuiltinRoles` delivers roles (packages/meta
 * bootstrap.ts): idempotent natural-key upserts, re-run at EVERY boot so an
 * existing install picks up new built-ins without a migration.
 *
 * WHO OWNS A ROW. `is_builtin_copy` is the whole distinction (07-meta-store.md
 * §3.28): true means "the server wrote this verbatim", and every editor write
 * clears it to false. So this module:
 *
 *   - inserts a missing row  → `is_builtin_copy = true`
 *   - refreshes a `true` row → only when the rendered content actually
 *     differs, which is how a re-translated string reaches installs that
 *     never touched the template
 *   - NEVER touches a `false` row — an admin's wording is theirs, and an
 *     upgrade that silently reverted it would be indistinguishable from data
 *     loss.
 *
 * LOCALE. Rows are keyed `(key, locale)`, so the seed writes one row per
 * COMPILED locale and the copy comes from `createServerI18n` — this module is
 * that function's first consumer. Send-time lookup falls back to `en_US`
 * (see {@link resolveEmailTemplate}).
 *
 * ICU → `{{var}}`. The locale bundles hold ordinary ICU messages with ordinary
 * `{name}` arguments, which is what translators and the message validator
 * expect. The seed calls `t()` with the PLACEHOLDER TEXT as each argument's
 * value (`{ url: '{{url}}' }`), so ICU substitutes it verbatim and the stored
 * row ends up holding `{{url}}` for the renderer to fill per send. That keeps
 * one template row serving every recipient, and it is not the banned
 * `.replace()`-on-a-`t()`-result pattern (`adminium/no-t-result-replace`) —
 * the substitution happens inside ICU, through declared arguments.
 *
 * NO ICU PLURAL/SELECT IN THESE MESSAGES. Every argument is substituted with a
 * PLACEHOLDER STRING at seed time, so `{expiresInMinutes, plural, …}` would ask
 * ICU to pluralize the literal text `{{expiresInMinutes}}` and throw. Keep the
 * built-in messages to plain `{arg}` arguments — the count is not known until
 * the send, and by then ICU is long gone.
 *
 * BRANDING. `{{appName}}` only, which every call site already passes from
 * `branding.appName` (default "Adminium"). No logo, no colours, no import from
 * `src/branding/` — that is a separate track.
 */

import { BUILTIN_LOCALE_IDS, type BuiltinLocaleId } from '@adminium/i18n';
import { createServerI18n, type I18nInstance } from '@adminium/i18n/server';
import { emailTemplatesRepo, type EmailTemplate, type MetaDb } from '@adminium/meta';

import { loadOverrideMap } from '../i18n/server-i18n.js';

/** One stored block, in the `{ block, id?, label?, data? }` shape §3.28 holds. */
export type EmailTemplateBlock = Record<string, unknown>;

export interface BuiltinEmailTemplate {
  key: string;
  /** Admin-facing label in the templates list — localized like everything else. */
  name: string;
  subject: string;
  blocks: EmailTemplateBlock[];
}

/**
 * The keys a fresh install is guaranteed to have — one per flow that is
 * otherwise DEAD without mail: forgot-password 202s into the void, an invite
 * degrades to a link the inviter hands over out of band, and the notification
 * `email` channel is stored intent nothing reads.
 *
 * These MUST stay in step with the `*_TEMPLATE_KEY` constants in
 * `./send.ts` — a key an enqueue site names but this module never seeds
 * resolves to no row, and `enqueueEmail` then quietly sends nothing.
 */
export const BUILTIN_EMAIL_TEMPLATE_KEYS = ['password-reset', 'user-invite', 'notification'] as const;

export type BuiltinEmailTemplateKey = (typeof BUILTIN_EMAIL_TEMPLATE_KEYS)[number];

/**
 * The `vars` each built-in reads, matching what the enqueue sites pass
 * (`routes/auth/handlers.ts`, `routes/users/index.ts`,
 * `notifications/notify.ts`, and the test-send route's `sampleVars`).
 *
 * A caller that omits one does not get a blank: `renderEmail` re-emits
 * `{{resetUrl}}` verbatim, on purpose, because a visibly broken sentence gets
 * reported and a silently missing one does not. Read this list rather than
 * guess, and change it and the call sites in the same commit.
 */
export const BUILTIN_EMAIL_TEMPLATE_VARS: Readonly<
  Record<BuiltinEmailTemplateKey, readonly string[]>
> = {
  'password-reset': ['appName', 'name', 'email', 'resetUrl', 'expiresInMinutes'],
  'user-invite': ['appName', 'name', 'email', 'inviterName', 'activationUrl', 'expiresInDays'],
  notification: ['appName', 'name', 'title', 'body', 'actionUrl'],
};

/**
 * What the seed hands ICU as each argument's value: the literal placeholder
 * the renderer will later substitute.
 */
const VAR = {
  appName: '{{appName}}',
  name: '{{name}}',
  email: '{{email}}',
  inviterName: '{{inviterName}}',
  resetUrl: '{{resetUrl}}',
  activationUrl: '{{activationUrl}}',
  actionUrl: '{{actionUrl}}',
  title: '{{title}}',
  body: '{{body}}',
  expiresInMinutes: '{{expiresInMinutes}}',
  expiresInDays: '{{expiresInDays}}',
} as const;

function heading(text: string): EmailTemplateBlock {
  return { block: 'email.heading', id: 'heading', data: { text, level: 1 } };
}

function paragraph(id: string, text: string): EmailTemplateBlock {
  return { block: 'email.text', id, data: { text } };
}

function button(label: string, url: string): EmailTemplateBlock {
  return { block: 'email.button', id: 'action', data: { label, url } };
}

const divider: EmailTemplateBlock = { block: 'email.divider', id: 'rule' };

function footer(text: string): EmailTemplateBlock {
  return { block: 'email.footer', id: 'footer', data: { text } };
}

/**
 * i18next's `t` narrowed to what this module uses. Keys are always string
 * literals at the call sites below — `adminium/no-dynamic-i18n-key` forbids
 * assembling them, and it is right to: a fabricated key is invisible to the
 * extractor and renders as a raw dotted string in someone's inbox.
 */
type Translate = I18nInstance['t'];

/** The "paste this link" footer, shared by every built-in that has a button. */
function linkFallback(t: Translate, url: string): EmailTemplateBlock {
  return footer(
    t('email.linkFallback', {
      url,
      defaultValue: 'If the button doesn’t work, paste this link into your browser: {url}',
    }),
  );
}

function passwordResetTemplate(t: Translate): BuiltinEmailTemplate {
  return {
    key: 'password-reset',
    name: t('email.passwordReset.name', { defaultValue: 'Password reset' }),
    subject: t('email.passwordReset.subject', {
      appName: VAR.appName,
      defaultValue: 'Reset your {appName} password',
    }),
    blocks: [
      heading(t('email.passwordReset.heading', { defaultValue: 'Reset your password' })),
      paragraph(
        'intro',
        t('email.passwordReset.intro', {
          name: VAR.name,
          email: VAR.email,
          defaultValue: 'Hi {name}, we received a request to reset the password for {email}.',
        }),
      ),
      button(t('email.passwordReset.action', { defaultValue: 'Choose a new password' }), VAR.resetUrl),
      // SINGLE-USE AND TIME-LIMITED, both stated. The reset token is stored as
      // a hash and consumed on first use; a recipient who does not know that
      // reads a second click failing as "the email is broken" and asks for
      // another one, which invalidates the link they still have open.
      paragraph(
        'notice',
        t('email.passwordReset.notice', {
          expiresInMinutes: VAR.expiresInMinutes,
          defaultValue:
            'This link works only once and expires in {expiresInMinutes} minutes. If you didn’t ' +
            'ask to reset your password, you can ignore this email — your current password ' +
            'stays active.',
        }),
      ),
      divider,
      linkFallback(t, VAR.resetUrl),
    ],
  };
}

function userInviteTemplate(t: Translate): BuiltinEmailTemplate {
  return {
    key: 'user-invite',
    name: t('email.userInvite.name', { defaultValue: 'Team invitation' }),
    subject: t('email.userInvite.subject', {
      appName: VAR.appName,
      defaultValue: 'You have been invited to {appName}',
    }),
    blocks: [
      heading(t('email.userInvite.heading', { defaultValue: 'You’ve been invited' })),
      paragraph(
        'intro',
        t('email.userInvite.intro', {
          appName: VAR.appName,
          email: VAR.email,
          inviterName: VAR.inviterName,
          defaultValue:
            '{inviterName} invited you to join {appName}. Accept the invitation to set a ' +
            'password for {email} and sign in.',
        }),
      ),
      button(t('email.userInvite.action', { defaultValue: 'Accept the invitation' }), VAR.activationUrl),
      paragraph(
        'notice',
        t('email.userInvite.notice', {
          expiresInDays: VAR.expiresInDays,
          defaultValue:
            'This invitation works only once and expires in {expiresInDays} days. If you weren’t ' +
            'expecting it, you can ignore this email.',
        }),
      ),
      divider,
      linkFallback(t, VAR.activationUrl),
    ],
  };
}

/**
 * ONE row for every notification kind, not thirty. The notification's own
 * `title`/`body` are the content (see `notifications/notify.ts`), so a per-kind
 * template would be a wall of near-identical rows for an operator to keep in
 * sync — and any kind added later would silently have no email at all.
 */
function notificationTemplate(t: Translate): BuiltinEmailTemplate {
  return {
    key: 'notification',
    name: t('email.notification.name', { defaultValue: 'Notification' }),
    subject: VAR.title,
    blocks: [
      heading(VAR.title),
      // `body` and `actionUrl` are both optional on a notification row; the
      // renderer drops a block whose text resolves to nothing, so an empty one
      // costs an absent paragraph rather than a blank box.
      paragraph('body', VAR.body),
      button(
        t('email.notification.action', { appName: VAR.appName, defaultValue: 'Open {appName}' }),
        VAR.actionUrl,
      ),
      divider,
      footer(
        t('email.notification.footer', {
          appName: VAR.appName,
          defaultValue:
            'You are receiving this because email notifications are on for your {appName} ' +
            'account. You can turn them off in your notification preferences.',
        }),
      ),
    ],
  };
}

/**
 * Every built-in, rendered through one recipient-locale translator. Exported
 * for the seed and for tests that need the exact bytes without a database.
 */
export function builtinEmailTemplates(t: Translate): BuiltinEmailTemplate[] {
  return [passwordResetTemplate(t), userInviteTemplate(t), notificationTemplate(t)];
}

/** A translator for one locale (no user involved — the row IS the locale). */
async function translatorForLocale(meta: MetaDb, locale: BuiltinLocaleId): Promise<I18nInstance> {
  return createServerI18n({ locale, overrides: await loadOverrideMap(meta, locale) });
}

function sameContent(row: EmailTemplate, def: BuiltinEmailTemplate): boolean {
  return (
    row.name === def.name &&
    row.subject === def.subject &&
    JSON.stringify(row.blocks) === JSON.stringify(def.blocks)
  );
}

/**
 * Seed (and keep current) the built-in templates for every compiled locale.
 * Safe at every boot; never overwrites a row an admin has edited.
 */
export async function seedBuiltinEmailTemplates(meta: MetaDb, at: number = Date.now()): Promise<void> {
  const repo = emailTemplatesRepo(meta);

  for (const locale of BUILTIN_LOCALE_IDS) {
    // i18next binds `t` to its translator during init, so destructuring is safe.
    const { t } = await translatorForLocale(meta, locale);
    for (const def of builtinEmailTemplates(t)) {
      const existing = await repo.findByKeyLocale(def.key, locale);

      // Human-owned. Their wording wins, forever.
      if (existing !== null && !existing.isBuiltinCopy) continue;
      // Unchanged built-in copy: skip the write so `updatedAt` does not churn
      // on every restart (the templates list sorts and displays it).
      if (existing !== null && sameContent(existing, def)) continue;

      await repo.upsert(
        def.key,
        locale,
        {
          name: def.name,
          subject: def.subject,
          blocks: def.blocks,
          enabled: existing?.enabled ?? true,
          isBuiltinCopy: true,
          updatedBy: null,
        },
        at,
      );
    }
  }
}

/**
 * The template a message to a `locale` recipient should render from.
 *
 * Falls back to `en_US` when the locale has no row — a partially seeded
 * install still sends a complete email rather than none. A row that EXISTS but
 * is disabled returns null with no fallback: disabling `password-reset/de_DE`
 * is an explicit choice, and quietly sending the English one instead would
 * override it.
 */
export async function resolveEmailTemplate(
  meta: MetaDb,
  key: string,
  locale: string,
): Promise<EmailTemplate | null> {
  const repo = emailTemplatesRepo(meta);
  const row = await repo.findByKeyLocale(key, locale);
  if (row !== null) return row.enabled ? row : null;
  if (locale === 'en_US') return null;
  const fallback = await repo.findByKeyLocale(key, 'en_US');
  return fallback !== null && fallback.enabled ? fallback : null;
}
