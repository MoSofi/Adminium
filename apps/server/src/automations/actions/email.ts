// SPDX-License-Identifier: AGPL-3.0-only
/**
 * SEND EMAIL (42-automations-and-workflow-logs.md D15, D16, 42-T09).
 *
 * --- Why this sends in-process instead of queueing ------------------------
 *
 * Every other outbound mail in the product goes through `enqueueEmail`, which
 * seals an envelope into a job and returns. This one does not, for a reason
 * the comp draws: Workflow Logs shows the SMTP reply as the step's log line —
 * "250 OK · delivered to jordan@acme.io" (Workflow Logs 144). A queued send
 * answers minutes later, by which time the run has finished and there is
 * nothing left to write the line onto. The campaign runner made the same
 * trade for the same reason (39 D11), and both now share `email/deliver.ts`.
 *
 * --- Why it FAILS on unconfigured SMTP ------------------------------------
 *
 * `enqueueEmail` returns null with no SMTP and says nothing, deliberately: an
 * instance with no email layer must not accumulate a queue. That is the right
 * silence for a password-reset that nobody asked for and the wrong one here —
 * an operator who builds a rule around an email and gets a green run that
 * sent nothing has been lied to. So this step fails loudly, the run goes red,
 * and the message names the settings page (39 D8's argument).
 *
 * --- The recipient, and the one masked column it may read -----------------
 *
 * "This record's `<column>`" is the normal case, and that column is very
 * often `email` — which the classifier masks as PII. The RUN reads the record
 * unmasked, so the address is there; what the step must not do is put it in
 * the trace, and the trace line is built from the trimmed address the same
 * way the comp draws it. A masked column stays out of the token map for
 * every other purpose (`templating.ts`).
 */

import {
  emailTemplatesRepo,
  settingsRepo,
  type AutomationAction,
  type MetaDb,
} from '@adminium/meta';

import { resolveEmailTemplate } from '../../email/builtins.js';
import { createSmtpTransport, emailSecretKey, resolveSmtpConfig } from '../../email/config.js';
import { deliverPrepared } from '../../email/deliver.js';
import { renderEmail } from '../../email/render.js';
import { inlineRefs, prepareEmail } from '../../email/send.js';
import { recipientLocale } from '../../i18n/server-i18n.js';
import { resolveEmailParts } from '../../jobs/email-send.js';
import { tokensFor } from '../templating.js';
import { ActionFailure, type ActionContext, type ActionResult } from './types.js';

type EmailAction = Extract<AutomationAction, { kind: 'email' }>;

/** Addresses this step will send to, resolved from the record or the fixed list. */
export function recipientsFor(action: EmailAction, ctx: ActionContext): string[] {
  const to = action.to;
  if (to === null) return [];
  if (to.kind === 'fixed') {
    return to.addresses.map((address) => address.trim()).filter((address) => address.length > 0);
  }
  if (ctx.source === null) return [];
  // The address may live in a masked column — see the header.
  const value = ctx.source.row[to.column];
  const address = value === null || value === undefined ? '' : String(value).trim();
  return address.length === 0 ? [] : [address];
}

async function resolve(action: EmailAction, ctx: ActionContext) {
  if (action.templateKey === null || action.templateKey === '') {
    throw new ActionFailure('This step has no template.');
  }
  const locale = await recipientLocale(ctx.meta, null);
  const template = await resolveEmailTemplate(ctx.meta, action.templateKey, locale);
  if (template === null) {
    // Present but archived or switched off is an operator decision, and
    // falling back to another template would send the wrong mail (39 D4).
    const exists = await existsInAnyLocale(ctx.meta, action.templateKey, locale);
    throw new ActionFailure(
      exists
        ? `Template ${action.templateKey} is archived or switched off.`
        : `Template ${action.templateKey} no longer exists.`,
    );
  }
  const recipients = recipientsFor(action, ctx);
  if (recipients.length === 0) {
    const column = action.to?.kind === 'field' ? action.to.column : 'the address list';
    throw new ActionFailure(ctx.text.emailNoRecipient(column));
  }
  return { template, recipients, locale };
}

async function existsInAnyLocale(meta: MetaDb, key: string, locale: string): Promise<boolean> {
  const repo = emailTemplatesRepo(meta);
  if ((await repo.findByKeyLocale(key, locale)) !== null) return true;
  return (await repo.findByKeyLocale(key, 'en_US')) !== null;
}

/**
 * The template's `vars`: every token the rule's fields see (D16's one
 * grammar) plus the record's masked-column values, which a TEMPLATE may show
 * even though a rule FIELD may not — the mail goes to the person the data is
 * about, and "Hi {{full_name}}" is the whole point of a welcome email.
 */
async function varsFor(ctx: ActionContext): Promise<Record<string, string>> {
  const appName = await settingsRepo(ctx.meta).get('branding.appName');
  const unmasked =
    ctx.source === null
      ? {}
      : tokensFor({
          row: ctx.source.row,
          table: ctx.source.table,
          ruleName: ctx.rule.name,
          recordLabel: ctx.source.record.label,
          now: ctx.now,
          includeMasked: true,
        });
  return { ...ctx.tokens, ...unmasked, appName };
}

export async function runEmailAction(
  action: EmailAction,
  ctx: ActionContext,
): Promise<ActionResult> {
  const { template, recipients } = await resolve(action, ctx);

  const config = await resolveSmtpConfig(ctx.meta, emailSecretKey(ctx.secret));
  if (config === null) throw new ActionFailure(ctx.text.emailNoSmtp());

  const prepared = await prepareEmail(ctx.meta, template);
  const vars = await varsFor(ctx);
  const probe = renderEmail({ ...prepared.render, locale: template.locale, vars, dir: 'ltr' });
  const parts = await resolveEmailParts(
    { meta: ctx.meta, secret: ctx.secret, ...(ctx.storage === undefined ? {} : { storage: ctx.storage }) },
    { inline: inlineRefs(probe), attachments: prepared.attachments },
  );
  const transport = (ctx.createTransport ?? createSmtpTransport)(config);

  const replies: string[] = [];
  for (const to of recipients) {
    try {
      const result = await deliverPrepared({ transport, prepared, locale: template.locale, to, vars, parts });
      replies.push(ctx.text.emailOk(result.response ?? '250 OK', to));
    } catch (error) {
      throw new ActionFailure(
        ctx.text.emailFail(error instanceof Error ? error.message : String(error)),
      );
    }
  }
  return { log: replies.join(' · ') };
}

export async function dryRunEmailAction(
  action: EmailAction,
  ctx: ActionContext,
): Promise<ActionResult> {
  const { template, recipients } = await resolve(action, ctx);
  // Everything the real send does except the last line: the document is
  // resolved and RENDERED, so a broken template fails the test too.
  const prepared = await prepareEmail(ctx.meta, template);
  const rendered = renderEmail({
    ...prepared.render,
    locale: template.locale,
    vars: await varsFor(ctx),
    dir: 'ltr',
  });
  return { log: ctx.text.emailWould(rendered.subject, recipients.join(', ')) };
}
