// SPDX-License-Identifier: AGPL-3.0-only
/**
 * SEND NOTIFICATION — the in-app notice named and the picker's second
 * tile (D10).
 *
 * It goes through `notify()`, which is what makes it honour each recipient's
 * own channel preferences and mail them a copy when they asked for one. A
 * rule that wrote notification rows directly would bypass that, and a person
 * who muted a kind would keep getting it.
 *
 * `automation.notice` is a new prefs-matrix kind under the Workspace
 * category, so it can be muted like every other. An unknown kind falls back
 * to the default channels (`notification-prefs.ts`), which is what it does
 * until the matrix row lands.
 *
 * --- The link -------------------------------------------------------------
 *
 * A notice about a record is nearly useless without a way to open it, so
 * `actionUrl` points at the record's own page when the trigger table has one
 * (30's `/p/<slug>/r/<id>`), and at the run in Workflow Logs otherwise —
 * which is the honest fallback, because the run IS what happened.
 */

import { pagesRepo, rolesRepo, teamsRepo, usersRepo, type AutomationAction } from '@adminium/meta';

import { notify } from '../../notifications/notify.js';
import { opensRecord } from '../record-link.js';
import { substitute } from '../templating.js';
import { AUTOMATION_NOTICE_KIND } from './notice-kind.js';
import { staffAt } from '../staff-recipient.js';
import { ActionFailure, type ActionContext, type ActionResult } from './types.js';

type NotificationAction = Extract<AutomationAction, { kind: 'notification' }>;

export { AUTOMATION_NOTICE_KIND };

/**
 * The people who lead a team the person is in, other than the person: each
 * once, and only those who sign in and can open the record the notice is
 * about. Somebody who leads their own team and is led by nobody else has none.
 */
async function leadsOf(ctx: ActionContext, userId: string): Promise<string[]> {
  const teams = teamsRepo(ctx.meta);
  const users = usersRepo(ctx.meta);
  const out: string[] = [];
  for (const membership of await teams.teamsOf(userId)) {
    for (const member of await teams.members(membership.teamId)) {
      if (!member.lead || member.userId === userId || out.includes(member.userId)) continue;
      if ((await users.findById(member.userId))?.status !== 'active') continue;
      if (await opensRecord(ctx, member.userId)) out.push(member.userId);
    }
  }
  return out;
}

async function holdersOf(ctx: ActionContext, roleIds: readonly string[]): Promise<string[]> {
  const roles = rolesRepo(ctx.meta);
  const ids = new Set<string>();
  for (const roleId of roleIds) {
    for (const userId of await roles.usersInRole(roleId)) ids.add(userId);
  }
  return [...ids];
}

/**
 * Of the people a step names by role or by hand, those who can open the
 * record the notice is about: its title and body carry the record's values,
 * and somebody whose roles do not reach the row (a manager of another team)
 * is not told of it. Nobody left is said in the run's log, not a failure. A
 * rule about no record tells everybody it names.
 */
async function readersOf(ctx: ActionContext, ids: readonly string[]): Promise<string[] | { note: string }> {
  if (ctx.source === null || ids.length === 0) return [...ids];
  const out: string[] = [];
  for (const id of ids) if (await opensRecord(ctx, id)) out.push(id);
  return out.length === 0 ? { note: ctx.text.notifOk(0) } : out;
}

/** Who a notice goes to; `note` says why nobody, where that is not a failure (an empty staff column). */
async function recipientsFor(action: NotificationAction, ctx: ActionContext): Promise<string[] | { note: string }> {
  const to = action.to;
  if (to === null) throw new ActionFailure('This step has nobody to notify.');
  if ('users' in to) return readersOf(ctx, [...new Set(to.users)]);
  // The person on the row, or whoever leads them: a record that names nobody tells the step's other roles, else nobody, and the run says so.
  if ('column' in to) {
    const found = await staffAt(ctx.meta, ctx, to.column);
    const fallback = to.else?.roles ?? [];
    if (!('user' in found)) return fallback.length > 0 ? readersOf(ctx, await holdersOf(ctx, fallback)) : { note: ctx.text.staffNobody(to.column, found.nobody) };
    if (to.lead !== true) return [found.user.id];
    // Never the person themselves: a lead of nobody, or led by nobody who can open the record, is the roles' to hear.
    const leads = await leadsOf(ctx, found.user.id);
    if (leads.length > 0) return leads;
    if (fallback.length === 0) throw new ActionFailure(`Nobody leads the person in ${to.column}, and this step names no roles to tell instead.`);
    const others = (await holdersOf(ctx, fallback)).filter((id) => id !== found.user.id);
    return others.length === 0 ? others : readersOf(ctx, others);
  }
  return readersOf(ctx, await holdersOf(ctx, to.roles));
}

/**
 * `config.source.table` — the same read `files/column-blocks.ts` and the
 * exports route make. A page's config is an opaque envelope to the repo, so
 * "which page shows this table" is answered here rather than by a query.
 */
function sourceTableOf(config: unknown): string | null {
  const source = (config as { source?: { table?: unknown } } | null)?.source;
  return typeof source?.table === 'string' && source.table.length > 0 ? source.table : null;
}

async function actionUrlFor(ctx: ActionContext): Promise<string> {
  const runUrl = `/workflow-logs?run=${ctx.runId}`;
  if (ctx.source === null) return runUrl;
  const pages = await pagesRepo(ctx.meta).listForConnection(ctx.source.connectionId);
  const page = pages.find(
    (row) => row.isEnabled && sourceTableOf(row.config) === ctx.source?.table.id,
  );
  if (page === undefined) return runUrl;
  const values = Object.values(ctx.source.record.pk);
  const recordId = values.length === 1 ? String(values[0]) : JSON.stringify(values);
  return `/p/${page.slug}/r/${encodeURIComponent(recordId)}`;
}

function renderText(action: NotificationAction, ctx: ActionContext): { title: string; body: string | null } {
  const title = substitute(action.title, ctx.tokens).trim();
  if (title === '') throw new ActionFailure('This step has no title.');
  const body = action.body === null ? null : substitute(action.body, ctx.tokens);
  return { title, body };
}

export async function runNotificationAction(
  action: NotificationAction,
  ctx: ActionContext,
): Promise<ActionResult> {
  const recipients = await recipientsFor(action, ctx);
  if (!Array.isArray(recipients)) return { log: recipients.note };
  if (recipients.length === 0) throw new ActionFailure('Nobody holds the roles this step notifies.');
  const { title, body } = renderText(action, ctx);
  const actionUrl = await actionUrlFor(ctx);

  const users = usersRepo(ctx.meta);
  let sent = 0;
  for (const userId of recipients) {
    // A user deleted between the rule's save and this run is skipped, not a
    // failure: the rule is still doing what it was asked.
    if ((await users.findById(userId)) === null) continue;
    await notify(
      ctx.meta,
      {
        userId,
        kind: AUTOMATION_NOTICE_KIND,
        // The RULE is the actor, denormalised onto the row so the notice still
        // says who sent it after the rule is deleted (own reasoning).
        actorLabel: ctx.rule.name,
        title,
        body,
        ...(ctx.source === null ? {} : { entity: ctx.source.record }),
        actionUrl,
      },
      { ...(ctx.hub === undefined ? {} : { hub: ctx.hub }), at: ctx.now, ...(action.urgent === true ? { urgent: true } : {}) },
    );
    sent += 1;
  }
  return { log: ctx.text.notifOk(sent) };
}

export async function dryRunNotificationAction(
  action: NotificationAction,
  ctx: ActionContext,
): Promise<ActionResult> {
  const recipients = await recipientsFor(action, ctx);
  renderText(action, ctx);
  return { log: Array.isArray(recipients) ? ctx.text.notifOk(recipients.length) : recipients.note };
}
