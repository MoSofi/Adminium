// SPDX-License-Identifier: AGPL-3.0-only
/**
 * SEND TEXT: one installed text template, to the number on the record.
 *
 * --- One send path ---------------------------------------------------------
 *
 * The step decides nothing about whether a text may go. Consent, the stop
 * list, +86, the country rules, the words of the template, the send window and
 * the daily limit are all `texts.prepare`, the same call an outbox text makes.
 * It is handed in (`ctx.texts`), so there is no second copy to drift. It is
 * never sent inline: `texts.queue` writes one delivery record and one sealed
 * job, and the `sms.send` job is what talks to the provider.
 *
 * --- Never twice -----------------------------------------------------------
 *
 * The message key is the rule, the run and the step, and a run makes one claim
 * of it. A run walked again meets its own delivery record and queues nothing
 * new. What a provider's timeout means is the job's to decide (`handover.ts`).
 *
 * --- A shut window ---------------------------------------------------------
 *
 * The send path holds the job in the queue until the window opens. A rule has
 * no row to re-date, and a text never writes a due column.
 *
 * --- What the run log may say ---------------------------------------------
 *
 * The number only as `+49 ••• 789`, and never a word of the message. An error
 * from below is never quoted, because it could carry either. A line says what
 * happened in words of this file, with the send path's stable reason beside
 * them.
 *
 * --- Skipped or failed -----------------------------------------------------
 *
 * What the send path refuses is a SKIPPED step with its reason, and the run
 * goes on: a customer who said stop is the rule working, not a fault, and
 * neither is a server with no text provider yet. A step that names a template
 * that is gone, or a store that could not be asked, FAILS by name, as an email
 * step does. A run is never retried by the queue (`jobs/automation-run.ts`),
 * so neither answer can send anything again.
 *
 * --- Sample rows ------------------------------------------------------------
 *
 * A sample row's number belongs to nobody who agreed to anything. Its run
 * skips the step before the send path is asked.
 */
import { codeNamesIn } from '@adminium/manifest';
import { connectionTenantConfig, textTemplatesRepo, type AutomationAction, type AutomationGraph, type StoredTextTemplate } from '@adminium/meta';

import { keptCodeColumnsOf } from '../../crud/mask.js';
import { readInstant } from '../../crud/moments.js';
import { resolveMailSender } from '../../email/workspace-sender.js';
import { recipientLocale } from '../../i18n/server-i18n.js';
import { appContact } from '../../outbox/sender.js';
import { businessName } from '../../privacy/business.js';
import { maskPhone } from '../../sms/consent/redact.js';
import type { BusinessContact, TextPrepared, TextPrepareSkipReason, TextSendPath } from '../../sms/send/index.js';
import { parseRelated } from '../related.js';
import { sampleListsOfRun } from '../sample-rows.js';
import { flattenNodes } from '../validate.js';
import { personOf, recipientsFor, varsFor } from './email.js';
import { ActionFailure, type ActionContext, type ActionResult, type ActionSource } from './types.js';

type TextAction = Extract<AutomationAction, { kind: 'text' }>;
type Ready = Extract<TextPrepared, { action: 'send' }>;

/** Said in the run log for each reason, as `automations:trace.text.reason.*` has them, with the exact reason beside them. */
export const TEXT_NOT_SENT: Readonly<Record<TextPrepareSkipReason, string>> = {
  'unreadable-phone': 'the number cannot be read',
  'cannot-receive-text': 'this number cannot receive texts',
  'country-blocked': 'texts do not go to this country',
  'country-blocked-for-marketing': 'texts do not go to this country',
  'marketing-from-name': 'this kind of text cannot go from here',
  'marketing-without-replies': 'this kind of text cannot go from here',
  'unknown-class': 'this kind of text cannot go from here',
  stopped: 'this person asked for no more texts',
  'no-consent': 'this person has not agreed to texts',
  'unconfirmed-consent': 'this person has not agreed to texts',
  'template-empty': 'the template or a value in it cannot be sent',
  'credential-in-template': 'the template or a value in it cannot be sent',
  'asks-for-yes': 'the template or a value in it cannot be sent',
  'value-too-long': 'the template or a value in it cannot be sent',
  'value-has-link': 'the template or a value in it cannot be sent',
  'too-long': 'the template or a value in it cannot be sent',
  'promises-reply': 'the template or a value in it cannot be sent',
  'unfilled-placeholder': 'a placeholder has no value',
  'no-opt-out-contact': 'no way to opt out can be given for this sender',
  'opt-out-changed': 'no way to opt out can be given for this sender',
  'not-connected': 'no text provider is connected',
  'no-sender': 'no text provider is connected',
  'off-by-operator': 'texts are switched off on this server',
  'daily-limit': 'today’s text limit is used',
  'past-its-moment': 'the sending hours would hold it too long',
  'no-send-window': 'the sending hours would hold it too long',
};

const COULD_NOT_CHECK = 'The text could not be checked, so it was not sent.';
const COULD_NOT_QUEUE = 'The text could not be queued, so it was not sent.';

function skipped(ctx: ActionContext, reason: TextPrepareSkipReason): ActionResult {
  return { log: ctx.text.textNotSent(`${TEXT_NOT_SENT[reason]} (${reason})`), skipped: true };
}

/** The template in the language this server writes to people in. Gone or switched off is the operator's to put right. */
async function templateFor(action: TextAction, ctx: ActionContext): Promise<StoredTextTemplate> {
  const key = action.templateKey;
  if (key === null || key === '') throw new ActionFailure('This step has no template.');
  const repo = textTemplatesRepo(ctx.meta);
  const found = await repo.findSendable(key, await recipientLocale(ctx.meta, null));
  if (found !== null) return found;
  const exists = (await repo.listByKey(key)).length > 0;
  throw new ActionFailure(exists ? `Text template ${key} is switched off.` : `Text template ${key} no longer exists.`);
}

/** The columns of the record and its linked rows that hold a code: a template that reads one is refused, whatever the column is called. */
function codeColumnsOf(ctx: ActionContext): Set<string> {
  const out = new Set<string>();
  const source = ctx.source;
  if (source === null) return out;
  for (const name of keptCodeColumnsOf(source.table)) out.add(name);
  for (const far of source.related?.values() ?? []) for (const name of keptCodeColumnsOf(far.table)) out.add(name);
  return out;
}

/** Who the text is from, for the opt-out line of a sender that cannot take a reply. */
async function businessOf(ctx: ActionContext, connectionId: string): Promise<BusinessContact> {
  const app = ctx.rule.managedBy === null ? { name: null, phone: null } : await appContact(ctx.meta, ctx.manager, ctx.rule.managedBy, connectionId);
  const sender = await resolveMailSender(ctx.meta, { connectionId });
  return { name: app.name ?? sender.name ?? (await businessName(ctx.meta)), phone: app.phone, email: sender.replyTo };
}

/** The moment the text is about, from the record; null when the step names none or the record holds none. */
function momentOf(action: TextAction, ctx: ActionContext): number | null {
  if (action.notAfter === undefined) return null;
  const value = ctx.source?.row[action.notAfter];
  if (value === null || value === undefined || value === '') return null;
  const at = readInstant(value);
  if (at === null) throw new ActionFailure(`${action.notAfter} does not hold a date and time, so this text cannot be held to it.`);
  return at.getTime();
}

/** Everything but the last line: what the real run and the Test button both do. */
async function prepareStep(action: TextAction, ctx: ActionContext): Promise<{ result: ActionResult } | { ready: Ready; texts: Pick<TextSendPath, 'queue'> }> {
  if (action.to === null || action.to.column === '') throw new ActionFailure('This step has nobody to text.');
  const source = ctx.source;
  if (source === null) throw new ActionFailure('This rule has no record to read a number from.');
  const template = await templateFor(action, ctx);
  if ((await sampleListsOfRun(ctx)).length > 0) return { result: { log: ctx.text.textNotSent('this is a sample row'), skipped: true } };
  const texts = ctx.texts?.();
  if (texts === undefined) return { result: skipped(ctx, 'not-connected') };
  const [phone] = recipientsFor(action, ctx);
  if (phone === undefined) return { result: { log: ctx.text.emailNoRecipient(action.to.column), skipped: true } };
  const notAfter = momentOf(action, ctx);

  let prepared: TextPrepared;
  try {
    const tenant = await connectionTenantConfig(ctx.meta, source.connectionId);
    prepared = await texts.prepare({
      phone,
      textClass: 'service',
      template: template.body,
      values: await varsFor(action, ctx, template.locale),
      codeNames: codeNamesIn(template.body, codeColumnsOf(ctx)),
      zone: tenant?.timezone ?? null,
      notAfter,
      business: await businessOf(ctx, source.connectionId),
      person: personOf(action, ctx),
    });
  } catch {
    // Never the error's own words: it could quote the number.
    throw new ActionFailure(COULD_NOT_CHECK);
  }
  if (prepared.action === 'fail') throw new ActionFailure(COULD_NOT_CHECK);
  if (prepared.action === 'skip') return { result: skipped(ctx, prepared.reason) };
  return { ready: prepared, texts };
}

export async function runTextAction(action: TextAction, ctx: ActionContext, nodeId: string): Promise<ActionResult> {
  const step = await prepareStep(action, ctx);
  if ('result' in step) return step.result;
  const { ready, texts } = step;
  let queued: Awaited<ReturnType<TextSendPath['queue']>>;
  try {
    // One claim per run and step: walking this run again finds this delivery and queues nothing new.
    queued = await texts.queue(ready, { messageKey: `automation:${ctx.rule.id}:${ctx.runId}:${nodeId}`, claimKey: 'step' });
  } catch {
    throw new ActionFailure(COULD_NOT_QUEUE);
  }
  if (!queued.queued) {
    if (queued.reason === 'could-not-queue') throw new ActionFailure(COULD_NOT_QUEUE);
    return { log: ctx.text.textNotSent('an earlier send of this step is still open'), skipped: true };
  }
  const to = maskPhone(ready.text.to);
  return { log: ready.opensAt === null ? ctx.text.textQueued(to) : ctx.text.textHeld(to, new Date(ready.opensAt).toISOString()) };
}

/** The same answer as a real run, one line short of queueing: `prepare` writes nothing. */
export async function dryRunTextAction(action: TextAction, ctx: ActionContext): Promise<ActionResult> {
  const step = await prepareStep(action, ctx);
  if ('result' in step) return step.result;
  const to = maskPhone(step.ready.text.to);
  return { log: step.ready.opensAt === null ? ctx.text.textWould(to) : ctx.text.textWouldHold(to, new Date(step.ready.opensAt).toISOString()) };
}

/**
 * The numbers a rule's text steps would send to on this record, as the row
 * holds them, its own or a linked row's. The run's first line prints a few of
 * the record's values, so these are taken out of it, whatever column they
 * also sit in and whatever that column is called.
 */
export function textRecipientNumbers(graph: AutomationGraph, source: Pick<ActionSource, 'row' | 'related'>): string[] {
  const out = new Set<string>();
  for (const node of flattenNodes(graph)) {
    if (node.kind !== 'action' || node.action.kind !== 'text' || node.action.to === null) continue;
    const related = parseRelated(node.action.to.column);
    const value = related === null ? source.row[node.action.to.column] : source.related?.get(related.link)?.row?.[related.column];
    if (value !== null && value !== undefined && String(value).trim() !== '') out.add(String(value).trim());
  }
  return [...out];
}
