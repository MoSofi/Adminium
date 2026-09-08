// SPDX-License-Identifier: AGPL-3.0-only
/**
 * SEND NOTIFICATION (42-automations-and-workflow-logs.md D20, 42-T10) — the
 * in-app notice 08 §2.13 named and the picker's second tile (D10).
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

import { pagesRepo, rolesRepo, usersRepo, type AutomationAction } from '@adminium/meta';

import { notify } from '../../notifications/notify.js';
import { substitute } from '../templating.js';
import { ActionFailure, type ActionContext, type ActionResult } from './types.js';

type NotificationAction = Extract<AutomationAction, { kind: 'notification' }>;

/** The kind an automation notice publishes under; mutable per user. */
export const AUTOMATION_NOTICE_KIND = 'automation.notice';

async function recipientsFor(action: NotificationAction, ctx: ActionContext): Promise<string[]> {
  const to = action.to;
  if (to === null) throw new ActionFailure('This step has nobody to notify.');
  if ('users' in to) return [...new Set(to.users)];

  const roles = rolesRepo(ctx.meta);
  const ids = new Set<string>();
  for (const roleId of to.roles) {
    for (const userId of await roles.usersInRole(roleId)) ids.add(userId);
  }
  return [...ids];
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
        // says who sent it after the rule is deleted (§3.20's own reasoning).
        actorLabel: ctx.rule.name,
        title,
        body,
        ...(ctx.source === null ? {} : { entity: ctx.source.record }),
        actionUrl,
      },
      ctx.hub === undefined ? {} : { hub: ctx.hub },
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
  return { log: ctx.text.notifOk(recipients.length) };
}
