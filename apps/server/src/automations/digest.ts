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
 * section. A section that says `reach: team` reads the rows of the person
 * and of the people they LEAD WHEN IT IS SENT, and nothing wider: there is
 * no "all", and what their own roles do not reach is left out of it as well.
 *
 * EVERY FIGURE IS THE READER'S OWN REACH OR NOTHING. A sum, a line a person
 * and a target are each read by the database over the same rows the section
 * may list (never over the fifty it prints), through the reader's row test
 * and with the reader's columns. A column their roles do not show is not
 * added up; a target they do not reach is not divided by; a figure that
 * cannot be answered is left out of the mail, never written as zero.
 *
 * What a section counts as "this week" is the rule's condition, cut on the
 * business's clock like every other rule: only the hour of delivery is the
 * reader's.
 */
import { sql } from 'kysely';
import { z } from 'zod';
import {
  automationDigestSectionSchema,
  automationsRepo,
  connectionTenantConfig,
  jobsRepo,
  notificationSchedulesRepo,
  rolesRepo,
  teamsRepo,
  usersRepo,
  type AutomationAction,
  type AutomationDigestSection,
  type AutomationNode,
  type MetaDb,
} from '@adminium/meta';

import type { ConnectionManager } from '../connections/manager.js';
import { compileFilter, type RecordFilter } from '../crud/filters.js';
import type { ResolvedTable } from '../crud/identifiers.js';
import { runList } from '../crud/list.js';
import { readTableOf, readViewOf } from '../crud/read-view.js';
import { rowLimitContextOf, rowTestOf } from '../crud/row-limit-context.js';
import { venueClock } from '../crud/venue-time.js';
import { loadSnapshotView } from '../data-io/snapshot-view.js';
import { enqueueEmail } from '../email/send.js';
import { formatTag } from '../i18n/bcp47.js';
import { recipientLocale, translatorFor } from '../i18n/server-i18n.js';
import type { JobHandlerContext, JobRegistry } from '../jobs/registry.js';
import { digestAt } from '../notifications/quiet.js';
import { valueForms } from '../outbox/sender.js';
import { offeredRoles, rulePartOff } from '../rbac/app-parts.js';
import { permissionSetAllows, resolvePermissionSet } from '../rbac/resolver.js';
import { ActionFailure, type ActionContext, type ActionResult } from './actions/types.js';
import { toRecordFilterAll } from './relative-time.js';
import { resolveRuleTemplate, templatePlaceholders, templateRequiredPlaceholders } from './templates.js';

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

export type DigestOutcome = { sent: true; rows: Record<string, number> } | { sent: false; why: 'gone' | 'away' | 'no-role' | 'rule-off' | 'nothing' | 'no-template' | 'no-email' };

/** Read one person's summary as that person, and queue its email. */
export async function sendDigest(deps: DigestSendDeps, payload: DigestSendPayload, now: number = Date.now(), opts: { /** Asked for by the person themselves: sent also while the rule is switched off. */ asked?: boolean } = {}): Promise<DigestOutcome> {
  const { meta } = deps;
  const user = await usersRepo(meta).findById(payload.userId);
  if (user === null) return { sent: false, why: 'gone' };
  if (user.status !== 'active') return { sent: false, why: 'away' };
  // Still one of the people the step writes to: a role taken away since, or one whose part of its app is now off, ends it.
  const held = await offeredRoles(meta, await rolesRepo(meta).rolesForUser(user.id));
  if (!held.some((role) => payload.roles.includes(role.id))) return { sent: false, why: 'no-role' };
  // A summary may wait days for the hour its reader chose. A rule deleted or switched off since, or one of a part
  // of its app that is off now, writes to nobody.
  const rule = await automationsRepo(meta).findById(payload.ruleId);
  if (rule === null || (!rule.enabled && opts.asked !== true) || (await rulePartOff(meta, rule))) return { sent: false, why: 'rule-off' };

  // As a rule reads (a private table is not in the view), then as this person reads: their rows, their columns.
  const whole = await loadSnapshotView(meta, payload.connectionId, { forOthers: true });
  const set = await resolvePermissionSet(meta, { kind: 'user', id: user.id, label: user.name });
  const view = readViewOf(whole, set);
  const { db, dialect } = await deps.manager.data(payload.connectionId);
  const reach = await rowLimitContextOf(meta, set, payload.connectionId, whole.model, new Date(now));
  const tenant = await connectionTenantConfig(meta, payload.connectionId);
  const locale = await recipientLocale(meta, user.id);
  const forms = valueForms({ locale: formatTag(null, locale), zone: tenant?.timezone ?? 'UTC', currency: tenant?.currency ?? null, now });

  // The people this person leads NOW, read once and only when a section asks for the team's rows.
  const led = payload.sections.some((section) => section.reach === 'team') ? (await teamsRepo(meta).leadReach(user.id)).ids : [];
  const year = Number(venueClock(new Date(payload.madeAt), tenant?.timezone ?? 'UTC').day.slice(0, 4));

  const listed = new Map<string, Record<string, string>[]>();
  const counts: Record<string, number> = {};
  const figures: Record<string, string> = {};
  for (const section of payload.sections) {
    // A section that cannot be read as this person (it sorts or chooses by a column their roles do not show)
    // lists nothing for them: their other sections, and everybody else's summary, are not lost with it.
    const read = await sectionRows({ section, view, whole, set, reach, db, dialect, meta, userId: user.id, led, year, connectionId: payload.connectionId, madeAt: payload.madeAt, forms }).catch(() => ({ rows: [], total: 0, figures: {} }));
    listed.set(section.key, read.rows);
    // How many there are, not how many of them the e-mail lists.
    counts[section.key] = read.total;
    Object.assign(figures, read.figures);
  }
  if (!payload.sendEmpty && [...listed.values()].every((rows) => rows.length === 0)) return { sent: false, why: 'nothing' };

  const found = await resolveRuleTemplate(meta, payload.templateKey, locale);
  if (found === null) return { sent: false, why: 'no-template' };
  // WHEN THE FIGURES WERE READ, in the reader's language and on the business's clock. A summary may be held
  // for hours after this (the reader's quiet hours), so the mail says the moment itself: a template writes it
  // where it likes with {{readAt}}, and one that does not gets it as a last line.
  const readAt = forms.instant('at', new Date(now).toISOString())['at'] ?? new Date(now).toISOString();
  const { t } = await translatorFor(meta, user.id);
  const says = templatePlaceholders(found).includes('readAt');
  const template = says ? found : { ...found, blocks: [...found.blocks, { block: 'email.text', id: 'adm-read-at', data: { text: t('automations:digest.readAt', { when: readAt, defaultValue: 'Figures read on {when}.' }) } }] };
  // Each rows block lists the section it names, by the block's own id.
  const rows: Record<string, Record<string, string>[]> = {};
  for (const block of template.blocks as readonly { id?: unknown; block?: unknown; data?: { section?: unknown } }[]) {
    if (block.block !== 'email.rows' || typeof block.id !== 'string' || typeof block.data?.section !== 'string') continue;
    rows[block.id] = listed.get(block.data.section) ?? [];
  }
  const vars: Record<string, string> = {
    name: user.name,
    ruleName: payload.ruleName,
    now: new Date(now).toISOString(),
    readAt,
    ...Object.fromEntries(Object.entries(counts).map(([key, count]) => [`count.${key}`, String(count)])),
    ...figures,
  };
  // A figure that was not answered for this person is written as nothing: where the template gave it a backup
  // or tied its block to it, that speaks; anywhere else the words stand with the figure left out. Never the
  // braces, and never a zero that nobody worked out.
  for (const name of templateRequiredPlaceholders(template, vars)) {
    if (!(name in vars) && /^(?:count|sum|target|cover)\./.test(name)) vars[name] = '';
  }
  const job = await enqueueEmail(
    { meta, ...(deps.secret === undefined ? {} : { secret: deps.secret }) },
    { to: user.email, templateKey: payload.templateKey, locale, template, rows, vars, dedupeKey: `digest-mail:${payload.runId}:${user.id}` } as never,
  );
  return job === null ? { sent: false, why: 'no-email' } : { sent: true, rows: counts };
}

type Source = Awaited<ReturnType<ConnectionManager['data']>>;
type Forms = ReturnType<typeof valueForms>;

const SUMMED: ReadonlySet<string> = new Set(['integer', 'bigint', 'decimal', 'float']);
/** The most values one `in` of a filter takes (`MAX_IN_VALUES`): a larger team is asked in parts. */
const IN_PART = 200;

/** "`column` names one of `ids`", as a filter. */
function namesOneOf(column: string, ids: readonly string[]): RecordFilter {
  if (ids.length === 1) return { column, op: 'eq', value: ids[0] };
  const parts: RecordFilter[] = [];
  for (let at = 0; at < ids.length; at += IN_PART) parts.push({ column, op: 'in', value: ids.slice(at, at + IN_PART) });
  return parts.length === 1 ? parts[0]! : { or: parts };
}

/** A database's sum as a number: a decimal comes back as text on two engines. Null for no rows, or no number. */
function numberOf(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const found = Number(value);
  return Number.isFinite(found) ? found : null;
}

interface Reader {
  view: ReturnType<typeof readViewOf>;
  whole: Awaited<ReturnType<typeof loadSnapshotView>>;
  set: Awaited<ReturnType<typeof resolvePermissionSet>>;
  reach: Awaited<ReturnType<typeof rowLimitContextOf>>;
  db: Source['db'];
  dialect: Source['dialect'];
  connectionId: string;
}

/**
 * A table as this person reads it, with the staff column that says whose its
 * rows are: null when the table is not there (or is private), their roles do
 * not read it, or the column no longer holds a staff member or is one their
 * roles do not show (a hidden one would say who by its rows).
 */
function readAs(reader: Reader, tableId: string, owner: string): { base: ResolvedTable; table: ResolvedTable } | null {
  const base = reader.whole.linkTable(tableId);
  if (base === null) return null;
  if (!permissionSetAllows(reader.set, `table:${reader.connectionId}:${base.id}:read`)) return null;
  const table = readTableOf(reader.view, base);
  const column = base.table.columns.find((candidate: { name: string }) => candidate.name === owner) as { staff?: boolean } | undefined;
  if (column?.staff !== true || table.columns.get(owner)?.unreadable === true) return null;
  return { base, table };
}

/** A number column this person's roles show, by its name; null for any other (hidden, masked, not a number, not there). */
function summable(reader: Reader, table: ResolvedTable, name: string): string | null {
  try {
    const column = reader.view.readableColumn(table, name, false);
    return SUMMED.has(column.logicalType) ? column.name : null;
  } catch {
    return null;
  }
}

/**
 * Figures over EVERY row of a table that meets `mandatory` and that the person
 * reaches (also what a dashboard's team figures are added up with,
 * `widget-data/team-figures.ts`): how many, and each column added up; for the whole, or a line an
 * owner. Read by the database in one statement, through the same row test a
 * list of theirs is read through, so a figure is never of a row they could
 * not open.
 */
export async function fold(
  reader: Pick<Reader, 'db' | 'dialect' | 'view' | 'reach'>,
  table: ResolvedTable,
  /** Null: every row the person reaches. */
  mandatory: RecordFilter | null,
  columns: readonly string[],
  by: string | null,
): Promise<{ owner: string | null; count: number; sums: Record<string, number | null>; currency: string | null | undefined }[]> {
  const { db, dialect, view } = reader;
  const rowTest = rowTestOf(reader.reach, table.id, 'read');
  await rowTest?.prepare?.(db);
  const dynamic = db.dynamic;
  // The row's own currency, where the table keeps one this person reads: a sum over two currencies is no figure.
  const currency = table.columns.has('currency') && table.columns.get('currency')?.unreadable !== true && table.columns.get('currency')?.secret !== true;
  let qb = db
    .selectFrom(table.id)
    .select((eb) => [
      eb.fn.countAll().as('adm_n'),
      ...columns.map((name, n) => eb.fn.sum(dynamic.ref(name)).as(`adm_s${String(n)}`)),
      ...(currency ? [eb.fn.min(dynamic.ref('currency')).as('adm_c0'), eb.fn.max(dynamic.ref('currency')).as('adm_c1')] : []),
      ...(by === null ? [] : [sql`${sql.ref(by)}`.as('adm_by')]),
    ]);
  if (mandatory !== null) qb = qb.where((eb) => compileFilter(eb as never, { view, table, canReadPii: false, dynamic, dialect }, mandatory)) as typeof qb;
  // Selected plainly, the table goes by its own name: that is what the test's subqueries reach back to.
  if (rowTest !== null) qb = qb.where(rowTest(db, table.name));
  if (by !== null) qb = qb.groupBy(dynamic.ref(by));
  const found = (await qb.execute()) as Record<string, unknown>[];
  return found.map((row) => {
    const [low, high] = [row['adm_c0'], row['adm_c1']];
    const one = typeof low === 'string' && low === high && /^[A-Za-z]{3}$/.test(low.trim()) ? low.trim().toUpperCase() : null;
    return {
      owner: by === null ? null : String(row['adm_by'] ?? ''),
      count: Number(row['adm_n'] ?? 0),
      sums: Object.fromEntries(columns.map((name, n) => [name, numberOf(row[`adm_s${String(n)}`])])),
      // `undefined`: rows in more than one currency, which no single figure adds up.
      currency: !currency || low === null || low === undefined ? null : low === high ? one : undefined,
    };
  });
}

/** One section as the person reads it: its lines, how many rows it has, and the figures a template may write. */
async function sectionRows(input: Reader & {
  section: AutomationDigestSection;
  meta: MetaDb;
  userId: string;
  /** The people this person leads now. */
  led: readonly string[];
  /** The calendar year on the business's clock, when the rule ran. */
  year: number;
  madeAt: number;
  forms: Forms;
}): Promise<{ rows: Record<string, string>[]; total: number; figures: Record<string, string> }> {
  const { section, view, reach, db, dialect, userId, madeAt, forms } = input;
  const none = { rows: [], total: 0, figures: {} };
  // A table that is not there (or is private), or one the person's roles do not read: the section lists nothing.
  const read = readAs(input, section.table, section.owner);
  if (read === null) return none;
  const { base, table } = read;
  // WHOSE ROWS: the person's own; for a team section, also those of the people they lead now. Never more than
  // that, whatever their roles read: the row test below can only take rows away from it.
  const ids = section.reach === 'team' ? [userId, ...input.led.filter((id) => id !== userId)] : [userId];
  const theirs = namesOneOf(section.owner, ids);
  const where = toRecordFilterAll(section.where, { table: base, dialect, now: madeAt });
  const mandatory: RecordFilter = where === null ? theirs : { and: [where, theirs] };
  const rowTest = rowTestOf(reach, base.id, 'read');
  const money = (name: string): boolean => (base.table.columns.find((candidate: { name: string }) => candidate.name === name) as { semantics?: { primary?: string } } | undefined)?.semantics?.primary === 'money';
  /** A sum as the mail writes it: money in the rows' own currency, else a number. */
  const written = (name: string, value: number, currency: string | null): string => (money(name) ? forms.money(value, currency) : forms.number(value));

  // The columns added up: only those this person's roles show. Another is left out, with everything measured by it.
  const columns = (section.sum ?? []).map((name) => summable(input, table, name)).filter((name): name is string => name !== null);
  const figures: Record<string, string> = {};
  let total = 0;
  let rows: Record<string, string>[] = [];

  if (section.by !== 'owner') {
    const page = await runList({
      db,
      view,
      table,
      params: { limit: section.limit, count: 'exact', ...(section.orderBy === null ? {} : { order: `${section.orderBy.column}.${section.orderBy.dir}` }) },
      canReadPii: false,
      dialect,
      mandatory,
      countMandatory: true,
      ...(rowTest === null ? {} : { rowTest }),
    });
    rows = page.data.map((row) => {
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
        } else if (money(name)) {
          out[`row.${name}`] = forms.money(value, currency);
        }
      }
      return out;
    });
    total = 'page' in page && typeof page.page.total === 'number' ? page.page.total : rows.length;
  }

  // THE WHOLE SECTION'S SUMS: over every row there is, not the rows listed.
  let whole: Awaited<ReturnType<typeof fold>>[number] | null = null;
  if (columns.length > 0 || section.by === 'owner') {
    whole = (await fold(input, table, mandatory, columns, null))[0] ?? null;
    if (section.by === 'owner') total = whole?.count ?? 0;
    for (const name of columns) {
      // No row is a sum of nothing, which is a figure; rows in two currencies are not one.
      if (whole !== null && whole.currency !== undefined) figures[`sum.${section.key}.${name}`] = written(name, whole.sums[name] ?? 0, whole.currency);
    }
  }
  if (section.by !== 'owner' && section.target === undefined) return { rows, total, figures };

  // A LINE A PERSON, and what each is measured against.
  const each = await fold(input, table, mandatory, columns, section.owner);
  const targets = section.target === undefined ? null : await targetsOf(input, section.target, ids, input.year).catch(() => null);
  const of = section.target !== undefined && columns.includes(section.target.of) ? section.target.of : null;
  const cover = (sum: number | null, target: number | undefined): string | null => (sum === null || target === undefined || !(target > 0) ? null : forms.percent(Math.round((sum / target) * 100)));
  if (targets !== null && of !== null && whole !== null && whole.currency !== undefined) {
    // The whole's cover is answered only when every person whose rows are in the sum has a target the reader
    // reaches: a sum over four people against the targets of three would read better than it is.
    const measured = each.every((line) => (line.sums[of] ?? 0) === 0 || (targets.get(line.owner ?? '') ?? 0) > 0);
    const all = [...targets.values()].reduce((sum, value) => sum + value, 0);
    // A target reads as the sum it measures does: money beside money.
    if (all > 0) figures[`target.${section.key}`] = written(of, all, whole.currency);
    const answer = measured ? cover(whole.sums[of] ?? 0, all) : null;
    if (answer !== null) figures[`cover.${section.key}`] = answer;
  }
  if (section.by !== 'owner') return { rows, total, figures };

  // Everybody with a row, and everybody with a target and none: by the name they go by in Adminium.
  const people = new Map<string, (typeof each)[number] | null>();
  for (const line of each) if (line.owner !== null && ids.includes(line.owner)) people.set(line.owner, line);
  for (const id of targets?.keys() ?? []) if (!people.has(id) && ids.includes(id)) people.set(id, null);
  const users = usersRepo(input.meta);
  const lines: { name: string; out: Record<string, string> }[] = [];
  for (const [id, line] of people) {
    const person = await users.findById(id);
    // Somebody who is no longer here has no name to write: their rows stay in the section's own sums.
    if (person === null) continue;
    const out: Record<string, string> = { 'row.owner': person.name, 'row.count': forms.number(line?.count ?? 0) };
    const currency = line === null ? (whole?.currency ?? null) : line.currency;
    for (const name of columns) if (currency !== undefined) out[`row.sum.${name}`] = written(name, line?.sums[name] ?? 0, currency);
    const target = targets?.get(id);
    if (target !== undefined && target > 0 && of !== null && currency !== undefined) {
      out['row.target'] = written(of, target, currency);
      const answer = cover(line?.sums[of] ?? 0, target);
      if (answer !== null) out['row.cover'] = answer;
    }
    lines.push({ name: person.name, out });
  }
  const collator = new Intl.Collator(formatTag(null, forms.locale));
  lines.sort((a, b) => collator.compare(a.name, b.name));
  return { rows: lines.slice(0, section.limit).map((line) => line.out), total, figures };
}

/**
 * Each person's target, among `ids`, as the reader reaches the targets'
 * table: its own read grant, its own row test, its own columns. A table,
 * a column or a row outside their reach is no target at all.
 */
async function targetsOf(reader: Reader, target: NonNullable<AutomationDigestSection['target']>, ids: readonly string[], year: number): Promise<Map<string, number> | null> {
  const read = readAs(reader, target.table, target.owner);
  if (read === null) return null;
  const column = summable(reader, read.table, target.column);
  if (column === null) return null;
  const whose = namesOneOf(target.owner, ids);
  const filter: RecordFilter = target.year === undefined ? whose : { and: [whose, { column: target.year, op: 'eq', value: year }] };
  const out = new Map<string, number>();
  for (const line of await fold(reader, read.table, filter, [column], target.owner)) {
    const value = line.sums[column];
    if (line.owner !== null && value !== null && value !== undefined) out.set(line.owner, value);
  }
  return out;
}

/**
 * The summaries a rule makes for one person: every `digest` step of its
 * graph that writes to a role the person holds. Empty for a rule that makes
 * them none, which is also what a rule that is not there answers.
 */
export function digestStepsFor(nodes: readonly AutomationNode[], roleIds: ReadonlySet<string>): DigestAction[] {
  const out: DigestAction[] = [];
  const walk = (list: readonly AutomationNode[]): void => {
    for (const node of list) {
      if (node.kind === 'action' && node.action.kind === 'digest' && (node.action.to?.roles ?? []).some((role) => roleIds.has(role))) out.push(node.action);
      if (node.kind === 'branch') for (const branch of node.branches) walk(branch.nodes as readonly AutomationNode[]);
    }
  };
  walk(nodes);
  return out;
}

/**
 * INTERNAL: only a rule's own step queues one. A summary job names a person
 * and the sections to read as them, so a job anybody with the jobs page could
 * queue would be a summary of any rows for any person; `POST /jobs` refuses
 * the kind. What the job keeps of its work is whether a mail was queued and
 * why not: never how many rows somebody has.
 */
export function registerDigestSendHandler(registry: JobRegistry, deps: DigestSendDeps): void {
  registry.registerJobHandler(
    DIGEST_SEND_KIND,
    digestSendPayloadSchema,
    async (payload, ctx: JobHandlerContext) => {
      const outcome = await sendDigest(deps, payload);
      ctx.log(outcome.sent ? 'digest: queued its email' : `digest: nothing sent (${outcome.why})`, { ruleId: payload.ruleId, userId: payload.userId });
      return outcome.sent ? { sent: true } : outcome;
    },
    { internal: true },
  );
}
