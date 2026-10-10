// SPDX-License-Identifier: AGPL-3.0-only
/**
 * SEND EMAIL.
 *
 * --- Why this sends in-process instead of queueing ------------------------
 *
 * Every other outbound mail in the product goes through `enqueueEmail`, which
 * seals an envelope into a job and returns. This one does not, for a reason
 * the comp draws: Workflow Logs shows the SMTP reply as the step's log line —
 * "250 OK · delivered to jordan@acme.io" (Workflow Logs 144). A queued send
 * answers minutes later, by which time the run has finished and there is
 * nothing left to write the line onto. The campaign runner made the same
 * trade for the same reason, and both now share `email/deliver.ts`.
 *
 * --- Why it FAILS on unconfigured SMTP ------------------------------------
 *
 * `enqueueEmail` returns null with no SMTP and says nothing, deliberately: an
 * instance with no email layer must not accumulate a queue. That is the right
 * silence for a password-reset that nobody asked for and the wrong one here —
 * an operator who builds a rule around an email and gets a green run that
 * sent nothing has been lied to. So this step fails loudly, the run goes red,
 * and the message names the settings page (argument).
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
  connectionTenantConfig,
  emailTemplatesRepo,
  settingsRepo,
  type AutomationAction,
  type EmailTemplate,
  type MetaDb,
} from '@adminium/meta';

import { createSmtpTransport, emailSecretKey, resolveSmtpConfig } from '../../email/config.js';
import { deliverPrepared } from '../../email/deliver.js';
import { renderEmail } from '../../email/render.js';
import { inlineRefs, prepareEmail } from '../../email/send.js';
import { formatTag } from '../../i18n/bcp47.js';
import { recipientLocale } from '../../i18n/server-i18n.js';
import { resolveEmailParts } from '../../jobs/email-send.js';
import { valueForms } from '../../outbox/sender.js';
import { parseRelated } from '../related.js';
import { resolveRuleTemplate, templatePlaceholders } from '../templates.js';
import { substitute, tokensFor, type TokenMap } from '../templating.js';
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
  // The address of a related row: the order's customer's, `customer_id.email`.
  const related = parseRelated(to.column);
  if (related !== null) {
    const far = ctx.source.related?.get(related.link);
    if (far === undefined) throw new ActionFailure(`${ctx.source.table.id} no longer links ${related.link} to another table, so this step has nobody to write to.`);
    const address = far.row?.[related.column];
    return address === null || address === undefined || String(address).trim() === '' ? [] : [String(address).trim()];
  }
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
  const template = await resolveRuleTemplate(ctx.meta, action.templateKey, locale);
  if (template === null) {
    // Present but archived or switched off is an operator decision, and
    // falling back to another template would send the wrong mail.
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

// Where a template's placeholders are read: beside what a template key means, which this step also asks.
export { templatePlaceholders } from '../templates.js';

/** What every rule's email can read whatever its record is. */
export const RULE_EMAIL_VARS = ['now', 'ruleName', 'recordLabel', 'appName'] as const;

/**
 * A record's dates and money as a person reads them — "Friday, October 2,
 * 2026 at 3:00 PM" and "$23.82", in the template's language, on the
 * connection's clock and in its currency — where the stored value is an
 * ISO stamp and a bare `23.82`. Only a MAIL reads these: a rule's own fields
 * (a webhook body, a written column) keep the stored value, which is what a
 * machine on the other end expects.
 */
async function formattedValues(ctx: ActionContext, locale: string): Promise<TokenMap> {
  const source = ctx.source;
  if (source === null) return {};
  const tenant = await connectionTenantConfig(ctx.meta, source.connectionId);
  const forms = valueForms({
    locale: formatTag(null, locale),
    zone: tenant?.timezone ?? 'UTC',
    currency: tenant?.currency ?? null,
    now: ctx.now,
  });
  // A row that keeps its own currency prints its money in it.
  const own = source.table.columns.has('currency') ? source.row['currency'] : null;
  const currency = typeof own === 'string' && /^[A-Za-z]{3}$/.test(own.trim()) ? own.trim().toUpperCase() : null;
  const out: TokenMap = {};
  for (const [name, column] of source.table.columns) {
    const value = source.row[name];
    if (value === null || value === undefined || value === '') continue;
    let text: string | undefined;
    if (column.logicalType === 'timestamp' || column.logicalType === 'timestamptz') {
      text = forms.instant(name, value)[name];
    } else if (column.logicalType === 'date') {
      text = forms.day(name, value)[name];
    } else if (source.table.table.columns.find((c) => c.name === name)?.semantics?.primary === 'money') {
      text = forms.money(value, currency);
    }
    if (text === undefined) continue;
    out[`record.${name}`] = text;
    out[name] = text;
  }
  return out;
}

/**
 * The template's `vars`: every token the rule's fields see (D16's one
 * grammar) plus the record's masked-column values, which a TEMPLATE may show
 * even though a rule FIELD may not — the mail goes to the person the data is
 * about, and "Hi {{full_name}}" is the whole point of a welcome email.
 *
 * Then the step's own `vars`, last, so they win: a template is written once
 * and sent about many tables, and `{{first_name}}` on a table whose column
 * is `name` is filled by the step saying so, not by renaming a column.
 */
async function varsFor(action: EmailAction, ctx: ActionContext, locale: string): Promise<Record<string, string>> {
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
          related: ctx.source.related,
        });
  const read: Record<string, string> = { ...ctx.tokens, ...unmasked, ...(await formattedValues(ctx, locale)), appName };
  const mapped: Record<string, string> = {};
  for (const [name, text] of Object.entries(action.vars)) mapped[name] = substitute(text, read);
  return { ...read, ...mapped };
}

/** The placeholders of the template that this send leaves as written. */
function unfilledIn(template: EmailTemplate, vars: Record<string, string>): string[] {
  return templatePlaceholders(template).filter((name) => !Object.hasOwn(vars, name));
}

/** `{{a}}, {{b}}` — at most five named, the rest counted. */
function listed(names: readonly string[]): string {
  const shown = names.slice(0, 5).map((name) => `{{${name}}}`).join(', ');
  return names.length > 5 ? `${shown} +${String(names.length - 5)}` : shown;
}

export async function runEmailAction(
  action: EmailAction,
  ctx: ActionContext,
): Promise<ActionResult> {
  const { template, recipients } = await resolve(action, ctx);

  const config = await resolveSmtpConfig(ctx.meta, emailSecretKey(ctx.secret));
  if (config === null) throw new ActionFailure(ctx.text.emailNoSmtp());

  const prepared = await prepareEmail(ctx.meta, template);
  const vars = await varsFor(action, ctx, template.locale);
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
  // Sent, and said: a placeholder nothing fills goes out as written, so the
  // line under the step is where an operator learns which one.
  const unfilled = unfilledIn(template, vars);
  if (unfilled.length > 0) replies.push(ctx.text.emailUnfilled(listed(unfilled)));
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
  const vars = await varsFor(action, ctx, template.locale);
  const rendered = renderEmail({ ...prepared.render, locale: template.locale, vars, dir: 'ltr' });
  const would = ctx.text.emailWould(rendered.subject, recipients.join(', '));
  const unfilled = unfilledIn(template, vars);
  return { log: unfilled.length === 0 ? would : `${would} · ${ctx.text.emailUnfilled(listed(unfilled))}` };
}
