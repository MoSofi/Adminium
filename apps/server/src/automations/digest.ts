// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A SUMMARY FOR EACH PERSON (a rule's `digest` step).
 *
 * The step queues one job a person; the job reads and sends. Two things
 * follow from that split, and both are the point of it:
 *
 *  - WHEN is the person's own. Each job is given the start a person chose
 *    for their summaries (their weekday and time, on their own clock); a
 *    person who chose none gets theirs when the rule runs.
 *  - WHAT is decided when it is sent, not when it was queued. The job reads
 *    each section AS THE RECIPIENT: only rows whose `owner` column is the
 *    person, that meet the section's conditions, of a table their roles read,
 *    among the rows their roles reach, with the columns their roles show. A
 *    person who no longer holds one of the step's roles by then is sent
 *    nothing; a table made private since is not read at all.
 *
 * "All rows" does not widen it: a manager whose role reads every deal still
 * gets a summary of THEIR deals, because the owner test is part of every
 * section. A team's rows are a section of their own, over a column that
 * names the manager.
 *
 * What a section counts as "this week" is the rule's condition, cut on the
 * business's clock like every other rule: only the hour of delivery is the
 * reader's.
 */
import { z } from 'zod';
import {
  automationDigestSectionSchema,
  connectionTenantConfig,
  jobsRepo,
  notificationSchedulesRepo,
  rolesRepo,
  usersRepo,
  type AutomationAction,
  type AutomationDigestSection,
  type MetaDb,
} from '@adminium/meta';

import type { ConnectionManager } from '../connections/manager.js';
import type { RecordFilter } from '../crud/filters.js';
import { runList } from '../crud/list.js';
import { readTableOf, readViewOf } from '../crud/read-view.js';
import { rowLimitContextOf, rowTestOf } from '../crud/row-limit-context.js';
import { loadSnapshotView } from '../data-io/snapshot-view.js';
import { enqueueEmail } from '../email/send.js';
import { formatTag } from '../i18n/bcp47.js';
import { recipientLocale } from '../i18n/server-i18n.js';
import type { JobHandlerContext, JobRegistry } from '../jobs/registry.js';
import { digestAt } from '../notifications/quiet.js';
import { valueForms } from '../outbox/sender.js';
import { offeredRoles } from '../rbac/app-parts.js';
import { permissionSetAllows, resolvePermissionSet } from '../rbac/resolver.js';
import { ActionFailure, type ActionContext, type ActionResult } from './actions/types.js';
import { toRecordFilterAll } from './relative-time.js';
import { resolveRuleTemplate } from './templates.js';

type DigestAction = Extract<AutomationAction, { kind: 'digest' }>;

export const DIGEST_SEND_KIND = 'digest.send';

export const digestSendPayloadSchema = z.object({
  ruleId: z.string(),
  ruleName: z.string(),
  runId: z.string(),
  connectionId: z.string(),
  userId: z.string(),
  templateKey: z.string(),
  roles: z.array(z.string()),
  sections: z.array(automationDigestSectionSchema),
  sendEmpty: z.boolean(),
  /** When the rule ran: what a section's "in the last 7 days" counts from, whatever hour the person reads it. */
  madeAt: z.number().int(),
});
export type DigestSendPayload = z.infer<typeof digestSendPayloadSchema>;

/** The people a summary is made for: everybody who holds one of its roles and can sign in. */
async function recipientsOf(meta: MetaDb, roleIds: readonly string[]): Promise<string[]> {
  const roles = rolesRepo(meta);
  const out = new Set<string>();
  for (const roleId of roleIds) for (const userId of await roles.usersInRole(roleId)) out.add(userId);
  return [...out];
}

function checked(action: DigestAction, ctx: Pick<ActionContext, 'rule' | 'source'>): { templateKey: string; roles: string[]; connectionId: string } {
  if (action.templateKey === null || action.templateKey === '') throw new ActionFailure('This step has no template.');
  if (action.to === null || action.to.roles.length === 0) throw new ActionFailure('This step has nobody to write to.');
  if (action.sections.length === 0) throw new ActionFailure('This step has no section to list.');
  const connectionId = ctx.source?.connectionId ?? ctx.rule.connectionId;
  if (connectionId === null) throw new ActionFailure('This rule reads no database, so a summary has nothing to list.');
  return { templateKey: action.templateKey, roles: action.to.roles, connectionId };
}

/** Queue one summary a person, each at the hour that person chose. */
export async function runDigestAction(action: DigestAction, ctx: ActionContext): Promise<ActionResult> {
  const { templateKey, roles, connectionId } = checked(action, ctx);
  const people = await recipientsOf(ctx.meta, roles);
  if (people.length === 0) return { log: ctx.text.digestNobody() };
  const tenant = await connectionTenantConfig(ctx.meta, connectionId);
  const schedules = notificationSchedulesRepo(ctx.meta);
  const jobs = jobsRepo(ctx.meta);
  let queued = 0;
  let later = 0;
  for (const userId of people) {
    const runAt = digestAt(await schedules.find(userId), tenant?.timezone, ctx.now);
    const payload: DigestSendPayload = {
      ruleId: ctx.rule.id,
      ruleName: ctx.rule.name,
      runId: ctx.runId,
      connectionId,
      userId,
      templateKey,
      roles,
      sections: action.sections,
      sendEmpty: action.sendEmpty,
      madeAt: ctx.now,
    };
    await jobs.enqueue({ kind: DIGEST_SEND_KIND, payload: payload as unknown as Record<string, unknown>, maxAttempts: 3, runAt, dedupeKey: `digest:${ctx.runId}:${userId}` });
    queued += 1;
    if (runAt > ctx.now) later += 1;
  }
  return { log: ctx.text.digestQueued(queued, later) };
}

/** A test run queues nothing: it says how many people a summary would be made for. */
export async function dryRunDigestAction(action: DigestAction, ctx: ActionContext): Promise<ActionResult> {
  const { roles } = checked(action, ctx);
  return { log: ctx.text.digestWould((await recipientsOf(ctx.meta, roles)).length) };
}

export interface DigestSendDeps {
  meta: MetaDb;
  manager: ConnectionManager;
  /** The queue a summary's email goes to; the email layer's own when absent. */
  secret?: string | undefined;
}

export type DigestOutcome = { sent: true; rows: Record<string, number> } | { sent: false; why: 'gone' | 'away' | 'no-role' | 'nothing' | 'no-template' | 'no-email' };

/** Read one person's summary as that person, and queue its email. */
export async function sendDigest(deps: DigestSendDeps, payload: DigestSendPayload, now: number = Date.now()): Promise<DigestOutcome> {
  const { meta } = deps;
  const user = await usersRepo(meta).findById(payload.userId);
  if (user === null) return { sent: false, why: 'gone' };
  if (user.status !== 'active') return { sent: false, why: 'away' };
  // Still one of the people the step writes to: a role taken away since, or one whose part of its app is now off, ends it.
  const held = await offeredRoles(meta, await rolesRepo(meta).rolesForUser(user.id));
  if (!held.some((role) => payload.roles.includes(role.id))) return { sent: false, why: 'no-role' };

  // As a rule reads (a private table is not in the view), then as this person reads: their rows, their columns.
  const whole = await loadSnapshotView(meta, payload.connectionId, { forOthers: true });
  const set = await resolvePermissionSet(meta, { kind: 'user', id: user.id, label: user.name });
  const view = readViewOf(whole, set);
  const { db, dialect } = await deps.manager.data(payload.connectionId);
  const reach = await rowLimitContextOf(meta, set, payload.connectionId, whole.model, new Date(now));
  const tenant = await connectionTenantConfig(meta, payload.connectionId);
  const locale = await recipientLocale(meta, user.id);
  const forms = valueForms({ locale: formatTag(null, locale), zone: tenant?.timezone ?? 'UTC', currency: tenant?.currency ?? null, now });

  const listed = new Map<string, Record<string, string>[]>();
  for (const section of payload.sections) {
    listed.set(section.key, await sectionRows({ section, view, whole, set, reach, db, dialect, userId: user.id, connectionId: payload.connectionId, madeAt: payload.madeAt, forms }));
  }
  const counts = Object.fromEntries([...listed].map(([key, rows]) => [key, rows.length]));
  if (!payload.sendEmpty && [...listed.values()].every((rows) => rows.length === 0)) return { sent: false, why: 'nothing' };

  const template = await resolveRuleTemplate(meta, payload.templateKey, locale);
  if (template === null) return { sent: false, why: 'no-template' };
  // Each rows block lists the section it names, by the block's own id.
  const rows: Record<string, Record<string, string>[]> = {};
  for (const block of template.blocks as readonly { id?: unknown; block?: unknown; data?: { section?: unknown } }[]) {
    if (block.block !== 'email.rows' || typeof block.id !== 'string' || typeof block.data?.section !== 'string') continue;
    rows[block.id] = listed.get(block.data.section) ?? [];
  }
  const job = await enqueueEmail(
    { meta, ...(deps.secret === undefined ? {} : { secret: deps.secret }) },
    {
      to: user.email,
      templateKey: payload.templateKey,
      locale,
      template,
      rows,
      vars: {
        name: user.name,
        ruleName: payload.ruleName,
        now: new Date(now).toISOString(),
        ...Object.fromEntries(Object.entries(counts).map(([key, count]) => [`count.${key}`, String(count)])),
      },
      dedupeKey: `digest-mail:${payload.runId}:${user.id}`,
    } as never,
  );
  return job === null ? { sent: false, why: 'no-email' } : { sent: true, rows: counts };
}

/** One section's rows as the person reads them, each as the `{{row.*}}` a line of the email is written with. */
async function sectionRows(input: {
  section: AutomationDigestSection;
  view: ReturnType<typeof readViewOf>;
  whole: Awaited<ReturnType<typeof loadSnapshotView>>;
  set: Awaited<ReturnType<typeof resolvePermissionSet>>;
  reach: Awaited<ReturnType<typeof rowLimitContextOf>>;
  db: Awaited<ReturnType<ConnectionManager['data']>>['db'];
  dialect: Awaited<ReturnType<ConnectionManager['data']>>['dialect'];
  userId: string;
  connectionId: string;
  madeAt: number;
  forms: ReturnType<typeof valueForms>;
}): Promise<Record<string, string>[]> {
  const { section, view, whole, set, reach, db, dialect, userId, connectionId, madeAt, forms } = input;
  // A table that is not there (or is private), or one the person's roles do not read: the section lists nothing.
  const base = whole.linkTable(section.table);
  if (base === null) return [];
  if (!permissionSetAllows(set, `table:${connectionId}:${base.id}:read`)) return [];
  const table = readTableOf(view, base);
  const owner = base.table.columns.find((column: { name: string }) => column.name === section.owner) as { staff?: boolean } | undefined;
  // The owner column must still hold a staff member, and be one the person's roles show: a hidden one would say who by its rows.
  if (owner?.staff !== true || table.columns.get(section.owner)?.unreadable === true) return [];
  const theirs: RecordFilter = { column: section.owner, op: 'eq', value: userId };
  const where = toRecordFilterAll(section.where, { table: base, dialect, now: madeAt });
  const mandatory: RecordFilter = where === null ? theirs : { and: [where, theirs] };
  const rowTest = rowTestOf(reach, base.id, 'read');
  const page = await runList({
    db,
    view,
    table,
    params: { limit: section.limit, count: 'none', ...(section.orderBy === null ? {} : { order: `${section.orderBy.column}.${section.orderBy.dir}` }) },
    canReadPii: false,
    dialect,
    mandatory,
    ...(rowTest === null ? {} : { rowTest }),
  });
  return page.data.map((row) => {
    const own = base.columns.has('currency') ? row['currency'] : null;
    const currency = typeof own === 'string' && /^[A-Za-z]{3}$/.test(own.trim()) ? own.trim().toUpperCase() : null;
    const out: Record<string, string> = {};
    for (const [name, column] of table.columns) {
      const value = row[name];
      if (value === null || value === undefined || value === '') continue;
      out[`row.${name}`] = typeof value === 'object' ? JSON.stringify(value) : String(value);
      if (column.logicalType === 'timestamp' || column.logicalType === 'timestamptz') {
        for (const [form, text] of Object.entries(forms.instant(name, value))) out[`row.${form}`] = text;
      } else if (column.logicalType === 'date') {
        for (const [form, text] of Object.entries(forms.day(name, value))) out[`row.${form}`] = text;
      } else if ((base.table.columns.find((candidate: { name: string }) => candidate.name === name) as { semantics?: { primary?: string } } | undefined)?.semantics?.primary === 'money') {
        out[`row.${name}`] = forms.money(value, currency);
      }
    }
    return out;
  });
}

export function registerDigestSendHandler(registry: JobRegistry, deps: DigestSendDeps): void {
  registry.registerJobHandler(DIGEST_SEND_KIND, digestSendPayloadSchema, async (payload, ctx: JobHandlerContext) => {
    const outcome = await sendDigest(deps, payload);
    ctx.log(outcome.sent ? 'digest: queued its email' : `digest: nothing sent (${outcome.why})`, { ruleId: payload.ruleId, userId: payload.userId });
    return outcome;
  });
}
