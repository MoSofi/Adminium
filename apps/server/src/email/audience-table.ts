// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A CAMPAIGN TO THE PEOPLE OF A TABLE: a table an installed app declares as
 * people (`people/declared.ts`), narrowed by a saved view of it ("Only
 * these"), mailed for one purpose, read as the person who sends it.
 *
 * ─── Read as the sender, the way an export reads ──────────────────────────
 * The table is read as the export job reads one (`jobs/export-run.ts`): the
 * sender's own view of the connection (`readViewOf`: a column their role does
 * not show is hidden), their row limits, their right to the table's personal
 * columns. A saved view stands for its page's table and adds its filters
 * (`routes/exports/source.ts`): a view of another table, a view that belongs
 * to somebody else, or a view with a search term (it would mail more people
 * than it shows) is refused. The sender must read the e-mail column in clear:
 * somebody who sees the addresses masked, or not at all, may not mail them.
 * All of it is asked again at every batch of the run, as the sender stands
 * then: a grant taken away mid-run stops the run before the next message.
 *
 * ─── Who is mailed, and on what ground ────────────────────────────────────
 * Each row is judged once, the same way for the dialog's breakdown and the
 * run's ledger (`judge`), in this order:
 *   1. no address that reads as one: left out, written nowhere;
 *   2. a sample row, an address on a reserved domain: skipped, counted apart;
 *   3. on the do-not-email list: skipped;
 *   4. the consent log says yes for the purpose: mailed;
 *   5. the log says no: skipped, not agreed;
 *   6. never asked, and existing customers asked for on a table that offers
 *      them, switched on by the owner, a customer: mailed when the row
 *      carries the opt-out mark, else counted "not marked" and left out;
 *   7. never asked, and the declared consent column says yes (ticked before
 *      the log kept records): left out until the first-send review settles
 *      it (`reviewList`);
 *   8. otherwise: skipped, not agreed.
 * Rows left out are written as already skipped, with a reason code the send
 * log words, so nothing about the run's arithmetic is hidden.
 *
 * ─── What a message says ──────────────────────────────────────────────────
 * The table's own columns as the sender reads them (never one their role
 * hides or masks), the person's name and first name by the app's rule
 * (a column, or the first word of the name), the address, and the app's
 * name; written in the language the table's declared language column names
 * when the campaign has it, else the install's.
 */
import { BUILTIN_LOCALE_IDS } from '@adminium/i18n';
import { FIRST_WORD_OF_NAME } from '@adminium/manifest';
import {
  manifestsRepo,
  pagesRepo,
  usersRepo,
  viewsRepo,
  type EmailAudience,
  type EmailRun,
  type EmailSend,
  type EmailSendInput,
  type MetaDb,
} from '@adminium/meta';
import type { Kysely } from 'kysely';
import type { Dialect } from '@adminium/engine';

import { sampleKeyOf, sampleKeysOf } from '../apps/sample-data.js';
import { looksLikeAddress, type ConsentService, type StaffMember } from '../consent/index.js';
import type { ConnectionManager, SourceDatabase } from '../connections/manager.js';
import type { ResolvedTable, SnapshotView } from '../crud/identifiers.js';
import { LIST_LIMIT_MAX, runList } from '../crud/list.js';
import { maskRow, UNMASK_PERMISSION, type Row } from '../crud/mask.js';
import { readViewOf } from '../crud/read-view.js';
import { rowLimitContextOf, rowTestOf } from '../crud/row-limit-context.js';
import { fetchVisible, type RowLimitContext, type RowTest } from '../crud/row-limit.js';
import { fetchByPk } from '../crud/records.js';
import { loadSnapshotView } from '../data-io/snapshot-view.js';
import { AppError } from '../errors.js';
import { filtersToWhere } from '../export/definition.js';
import { recipientLocale } from '../i18n/server-i18n.js';
import { CAMPAIGN_SKIP_DO_NOT_EMAIL, CAMPAIGN_SKIP_NOT_AGREED, runPurpose } from '../jobs/email-campaign-checks.js';
import type { CampaignRowVerdict, CampaignSeams } from '../jobs/email-campaign-run.js';
import { customerRow, markedForOptOut, offersExistingCustomers } from '../outbox/marketing.js';
import { reservedAddress } from '../outbox/sender.js';
import { pkOfRowKey, rowKeyOf } from '../payments/payables.js';
import { peopleTablesOf } from '../people/tables-of.js';
import type { DeclaredPeopleTable } from '../people/declared.js';
import { normaliseAddress } from '../public-api/claim-code.js';
import { PERMISSIONS } from '../rbac/permissions.js';
import { permissionSetAllows, resolvePermissionSet, type PermissionSet } from '../rbac/resolver.js';
import { pageSourceTable } from '../routes/exports/source.js';
import { existingCustomersSwitch, type ExistingCustomersSwitch } from './existing-customers.js';
import { recipientVars } from './audience.js';

export type TableAudience = Extract<EmailAudience, { kind: 'table' }>;
export type AudiencePurpose = TableAudience['purpose'];

/**
 * Why a table audience is refused, as a code the screens word: the run's
 * failure reason when a batch refuses it, the `reason` of the routes' errors.
 */
export const AUDIENCE_REFUSALS = [
  /** Not a people table an installed app declares with an address, or the owner switched its campaigns off. */
  'not-people',
  /** The sender is no longer an active person who may send campaigns. */
  'cannot-send',
  /** The sender cannot read the table (no grant, or its rows are private to the people they belong to). */
  'cannot-read',
  /** The sender's role does not show the e-mail column. */
  'addresses-hidden',
  /** The sender sees the e-mail column masked. */
  'addresses-masked',
  /** The saved view is gone, belongs to somebody else, or stands for another table. */
  'view-gone',
  /** The saved view has a search term: it would mail more people than it shows. */
  'view-search',
  /** The saved view filters by a column the sender's role does not show. */
  'view-hidden-column',
  /** Existing customers asked for on a table that does not offer them, or whose owner has not switched them on. */
  'existing-customers-off',
] as const;
export type AudienceRefusal = (typeof AUDIENCE_REFUSALS)[number];

/** The ledger's reason codes for the rows an audience leaves out (besides `do-not-email` and `not-agreed`). */
export const AUDIENCE_SKIP_SAMPLE = 'sample';
export const AUDIENCE_SKIP_RESERVED = 'reserved-domain';
export const AUDIENCE_SKIP_NOT_MARKED = 'not-marked';
export const AUDIENCE_SKIP_REVIEW = 'awaiting-review';
/** At a later batch: the row is gone, or out of the sender's reach now. */
export const AUDIENCE_SKIP_OUT_OF_REACH = 'out-of-reach';
/** At a later batch: the row holds another address now than the one written down. */
export const AUDIENCE_SKIP_ADDRESS_CHANGED = 'address-changed';

/** A refusal, with the table's name for the sentence. */
export class AudienceRefusedError extends AppError {
  constructor(
    readonly reason: AudienceRefusal,
    label: string,
  ) {
    super(AUDIENCE_STATUS[reason], 'AUDIENCE_REFUSED', audienceRefusalSentence(reason, label), { reason, table: label });
  }
}

const AUDIENCE_STATUS: Record<AudienceRefusal, number> = {
  'not-people': 409,
  'cannot-send': 403,
  'cannot-read': 403,
  'addresses-hidden': 403,
  'addresses-masked': 403,
  'view-gone': 404,
  'view-search': 422,
  'view-hidden-column': 403,
  'existing-customers-off': 409,
};

/** The refusal in a sentence, naming the table, as the send dialog says it. */
export function audienceRefusalSentence(reason: AudienceRefusal, label: string): string {
  switch (reason) {
    case 'not-people':
      return `${label} is not a table of people that campaigns may mail.`;
    case 'cannot-send':
      return 'You may no longer send campaigns.';
    case 'cannot-read':
      return `You can no longer read ${label}, so you can't send to it.`;
    case 'addresses-hidden':
    case 'addresses-masked':
      return `You can't see ${label}'s addresses, so you can't send to it.`;
    case 'view-gone':
      return 'That saved view is not there for you any more.';
    case 'view-search':
      return 'That saved view has a search term, and a send cannot carry one: it would reach more people than the view shows.';
    case 'view-hidden-column':
      return `That saved view filters by a column of ${label} your role does not show.`;
    case 'existing-customers-off':
      return `Existing customers are not switched on for ${label}.`;
  }
}

export interface AudienceDeps {
  meta: MetaDb;
  manager: Pick<ConnectionManager, 'data'>;
  consent: ConsentService;
}

/** One people table as the sender reaches it: everything a read of it needs, resolved once. */
export interface PeopleTableAccess {
  userId: string;
  set: PermissionSet;
  declared: DeclaredPeopleTable;
  /** The connection read whole (what a judgement of the row reads), and as the sender reads it. */
  whole: SnapshotView;
  view: SnapshotView;
  wholeTable: ResolvedTable;
  /** The table as the sender's view shows it. */
  table: ResolvedTable;
  db: Kysely<SourceDatabase>;
  dialect: Dialect;
  canReadPii: boolean;
  reach: RowLimitContext | null;
  rowTest: RowTest | undefined;
  /** The table's own name for a sentence ("Contacts"). */
  label: string;
  /** The app declares the opt-out mark and the customer column. */
  offered: boolean;
  switched: ExistingCustomersSwitch | null;
}

/** A table audience as the sender reaches it: the table, and the saved view's filters. */
export interface AudienceAccess extends PeopleTableAccess {
  audience: TableAudience;
  filters: unknown[] | undefined;
  /** Existing customers asked for, and allowed. */
  existing: boolean;
}

type Opened<T> = { ok: T } | { refuse: AudienceRefusal; label: string };

/** Whether a user may read one table's personal columns in clear (`crud/mask.ts`, without a request). */
function piiAllowedFor(set: PermissionSet, connectionId: string, tableId: string): boolean {
  return permissionSetAllows(set, UNMASK_PERMISSION) || permissionSetAllows(set, `table:${connectionId}:${tableId}:read_pii`);
}

/**
 * The people table `table` on `connectionId` as `userId` reaches it now, or
 * why they may not mail it.
 */
export async function openPeopleTable(deps: AudienceDeps, userId: string | null, connectionId: string, tableName: string): Promise<Opened<PeopleTableAccess>> {
  let whole: SnapshotView;
  try {
    whole = await loadSnapshotView(deps.meta, connectionId);
  } catch {
    return { refuse: 'not-people', label: tableName };
  }
  let wholeTable: ResolvedTable;
  try {
    wholeTable = whole.table(tableName);
  } catch {
    return { refuse: 'not-people', label: tableName };
  }
  const label = wholeTable.table.label ?? wholeTable.name;
  const declared = await peopleTablesOf(deps.meta).of(connectionId, whole.model, wholeTable.id);
  if (declared === null || !declared.canEmail || declared.email === null || declared.appStatus !== 'installed' || wholeTable.primaryKey.length === 0) {
    return { refuse: 'not-people', label };
  }
  const user = userId === null ? null : await usersRepo(deps.meta).findById(userId);
  if (user === null || user.status !== 'active') return { refuse: 'cannot-send', label };
  const set = await resolvePermissionSet(deps.meta, { kind: 'user', id: user.id, label: user.name });
  if (!permissionSetAllows(set, PERMISSIONS.settingsManage)) return { refuse: 'cannot-send', label };
  if (!permissionSetAllows(set, `table:${connectionId}:${wholeTable.id}:read`) || wholeTable.table.private === true) return { refuse: 'cannot-read', label };
  const view = readViewOf(whole, set);
  const table = view.linkTable(wholeTable.id) ?? wholeTable;
  const email = table.columns.get(declared.email);
  if (email === undefined || email.secret || email.unreadable === true) return { refuse: 'addresses-hidden', label };
  const canReadPii = piiAllowedFor(set, connectionId, wholeTable.id);
  if (email.masked && !canReadPii) return { refuse: 'addresses-masked', label };
  const reach = await rowLimitContextOf(deps.meta, set, connectionId, whole.model);
  const { db, dialect } = await deps.manager.data(connectionId);
  return {
    ok: {
      userId: user.id,
      set,
      declared,
      whole,
      view,
      wholeTable,
      table,
      db,
      dialect: dialect as Dialect,
      canReadPii,
      reach,
      rowTest: rowTestOf(reach, wholeTable.id, 'read') ?? undefined,
      label,
      offered: offersExistingCustomers(declared),
      switched: await existingCustomersSwitch(deps.meta, connectionId, wholeTable.id),
    },
  };
}

/** The saved grid state a filters view stores. */
interface ViewQuery {
  search?: unknown;
  filters?: unknown;
}

/** The filters of a saved view of the table, as the sender may use it, or why not. */
async function viewFilters(meta: MetaDb, access: PeopleTableAccess, viewId: string | null | undefined): Promise<{ filters: unknown[] | undefined } | { refuse: AudienceRefusal }> {
  if (viewId === null || viewId === undefined) return { filters: undefined };
  const saved = await viewsRepo(meta).findById(viewId);
  // Somebody else's private view reads as no view at all: whether it exists is its owner's business.
  if (saved === null || saved.kind !== 'filters' || (saved.userId !== null && saved.userId !== access.userId)) return { refuse: 'view-gone' };
  const page = await pagesRepo(meta).findById(saved.pageId);
  const pageTable = page === null ? null : pageSourceTable(page.config);
  if (page === null || pageTable === null || (page.connectionId !== null && page.connectionId !== access.whole.connectionId)) return { refuse: 'view-gone' };
  let bound: ResolvedTable;
  try {
    bound = access.whole.table(pageTable);
  } catch {
    return { refuse: 'view-gone' };
  }
  if (bound.id !== access.wholeTable.id) return { refuse: 'view-gone' };
  const query = (saved.config ?? {}) as ViewQuery;
  if (typeof query.search === 'string' && query.search.length > 0) return { refuse: 'view-search' };
  return { filters: Array.isArray(query.filters) && query.filters.length > 0 ? query.filters : undefined };
}

/** One list read as the sender, `limit` rows from `cursor`; a filter on a column they may not read is refused by name. */
async function listAsSender(access: PeopleTableAccess, filters: unknown[] | undefined, page: { cursor?: string; offset?: number; limit: number }) {
  const where = filtersToWhere(filters);
  return runList({
    db: access.db,
    view: access.view,
    table: access.table,
    params: {
      ...(where === undefined ? {} : { where }),
      limit: page.limit,
      ...(page.cursor === undefined ? { offset: page.offset ?? 0, count: 'none' as const } : { cursor: page.cursor }),
    },
    canReadPii: access.canReadPii,
    dialect: access.dialect,
    rowTest: access.rowTest,
  });
}

/**
 * A table audience as `userId` reaches it now, or why they may not send it:
 * the table, the view's filters (tried once, so a filter on a column their
 * role hides is refused here rather than half-way), and existing customers.
 */
export async function openTableAudience(deps: AudienceDeps, userId: string | null, audience: TableAudience, options: { running?: boolean } = {}): Promise<Opened<AudienceAccess>> {
  const opened = await openPeopleTable(deps, userId, audience.connectionId, audience.table);
  if (!('ok' in opened)) return opened;
  const access = opened.ok;
  const view = await viewFilters(deps.meta, access, audience.viewId);
  if ('refuse' in view) return { refuse: view.refuse, label: access.label };
  try {
    await listAsSender(access, view.filters, { limit: 1, offset: 0 });
  } catch (error) {
    if ((error as { code?: unknown }).code === 'COLUMN_FORBIDDEN') return { refuse: 'view-hidden-column', label: access.label };
    throw error;
  }
  const asked = audience.existingCustomers === true;
  const allowed = access.offered && access.switched?.on === true;
  // Asked for where they are not on: refused at the dialog and the send. A run whose owner switched them off
  // since goes on for the people who agreed, and its existing customers are left out (`tableAudienceSeams`).
  if (asked && !allowed && options.running !== true) return { refuse: 'existing-customers-off', label: access.label };
  return { ok: { ...access, audience, filters: view.filters, existing: asked && allowed } };
}

/** One row of the table, as the sender reads it and as it is. */
export interface PersonRow {
  key: string;
  /** What the sender's view shows of it: hidden columns left out, personal ones masked unless they read them. */
  seen: Row;
  /** The row whole: what the judgement reads (the consent column, the mark, the customer column, the language). */
  whole: Row;
  /** Its address as kept (trimmed, lower case), or null when it holds none that reads as one. */
  address: string | null;
}

/** Rows of `table` by their keys, in one statement. */
async function wholeRowsOf(db: Kysely<SourceDatabase>, table: ResolvedTable, rows: readonly Row[]): Promise<Map<string, Row>> {
  const out = new Map<string, Row>();
  if (rows.length === 0) return out;
  const pk = table.primaryKey;
  const found = (await db
    .selectFrom(table.id)
    .selectAll()
    .where((eb) => eb.or(rows.map((row) => eb.and(pk.map((column) => eb(eb.ref(column as never), '=', row[column] as never))))))
    .execute()) as Row[];
  for (const row of found) out.set(rowKeyOf(table, row), row);
  return out;
}

/** Every row the sender's view of the table lists under `filters`, a page at a time. */
export async function* peoplePages(access: PeopleTableAccess, filters: unknown[] | undefined): AsyncGenerator<PersonRow[]> {
  const email = access.declared.email!;
  // A key the sender sees masked cannot ride in a cursor; such a table is read by offset, as an export reads it.
  const byCursor = access.canReadPii || !access.table.primaryKey.some((column) => access.table.columns.get(column)?.masked === true);
  let cursor = '';
  let offset = 0;
  for (;;) {
    const page = await listAsSender(access, filters, byCursor ? { cursor, limit: LIST_LIMIT_MAX } : { offset, limit: LIST_LIMIT_MAX });
    if (page.data.length === 0) return;
    const wholes = await wholeRowsOf(access.db, access.wholeTable, page.data);
    const rows: PersonRow[] = [];
    for (const seen of page.data) {
      const key = rowKeyOf(access.wholeTable, seen);
      const whole = wholes.get(key);
      if (whole === undefined) continue;
      const value = seen[email];
      rows.push({ key, seen, whole, address: typeof value === 'string' && looksLikeAddress(value) ? normaliseAddress(value) : null });
    }
    yield rows;
    if (byCursor) {
      const next = page.cursor?.next ?? null;
      if (next === null) return;
      cursor = next;
    } else {
      if (page.data.length < LIST_LIMIT_MAX) return;
      offset += page.data.length;
    }
  }
}

/** Where one row stands for a send (see the header). */
export type Standing = 'consent' | 'existing-customer' | 'do-not-email' | 'not-agreed' | 'awaiting-review' | 'not-marked' | 'sample' | 'reserved-domain' | 'no-address';

/** Whether a stored yes/no value says yes. */
function saysYes(value: unknown): boolean {
  if (value === true || value === 1 || value === 1n) return true;
  if (typeof value === 'string') return ['true', 't', '1', 'yes'].includes(value.trim().toLowerCase());
  return false;
}

/** Whether the declared consent column ticks yes for this purpose with nothing in the log behind it. */
function tickedWithoutRecord(declared: DeclaredPeopleTable, purpose: AudiencePurpose, whole: Row): boolean {
  return declared.consent !== null && declared.consent.purpose === purpose && saysYes(whole[declared.consent.column]);
}

/**
 * Each row of a page judged for a send (see the header): one stop-list read
 * for the page, one consent read per row with an address.
 */
export async function judge(
  deps: Pick<AudienceDeps, 'consent'>,
  access: PeopleTableAccess,
  rows: readonly PersonRow[],
  options: { purpose: AudiencePurpose; existing: boolean; samples: ReadonlySet<string> },
): Promise<Standing[]> {
  const stopped = await deps.consent.stop.stoppedAmong(rows.flatMap((row) => (row.address === null ? [] : [row.address])));
  const out: Standing[] = [];
  for (const row of rows) {
    if (row.address === null) {
      out.push('no-address');
      continue;
    }
    const sample = sampleKeyOf(access.wholeTable, row.whole);
    if (sample !== null && options.samples.has(sample)) out.push('sample');
    else if (reservedAddress(row.address)) out.push('reserved-domain');
    else if (stopped.has(row.address)) out.push('do-not-email');
    else {
      const person = { connectionId: access.declared.connectionId, table: access.wholeTable.id, key: row.key };
      const standing = await deps.consent.stateFor({ person, address: row.address }, options.purpose);
      if (standing.state === 'yes') out.push('consent');
      else if (standing.state === 'no') out.push('not-agreed');
      else if (options.existing && customerRow(access.declared, row.whole) && markedForOptOut(access.declared, row.whole)) out.push('existing-customer');
      else if (tickedWithoutRecord(access.declared, options.purpose, row.whole)) out.push('awaiting-review');
      else if (options.existing && customerRow(access.declared, row.whole)) out.push('not-marked');
      else out.push('not-agreed');
    }
  }
  return out;
}

/** The send dialog's breakdown: how many each way, worked out as the run will. */
export interface AudienceBreakdown {
  /** Rows the sender's view lists, with or without an address. */
  rows: number;
  /** Who gets it: `consent + existingCustomers`. */
  recipients: number;
  consent: number;
  existingCustomers: number;
  doNotEmail: number;
  notAgreed: number;
  /** Say yes in the table, ticked before the log kept records: the first-send review asks about them. */
  awaitingReview: number;
  /** Customers left out because no screen showed them the opt-out line. */
  notMarked: number;
  sample: number;
  reservedDomain: number;
  noAddress: number;
}

const BREAKDOWN_FIELD: Record<Standing, keyof AudienceBreakdown> = {
  consent: 'consent',
  'existing-customer': 'existingCustomers',
  'do-not-email': 'doNotEmail',
  'not-agreed': 'notAgreed',
  'awaiting-review': 'awaitingReview',
  'not-marked': 'notMarked',
  sample: 'sample',
  'reserved-domain': 'reservedDomain',
  'no-address': 'noAddress',
};

/** Every row of an audience judged, a page at a time. */
async function* judged(deps: AudienceDeps, access: AudienceAccess): AsyncGenerator<{ row: PersonRow; standing: Standing }[]> {
  const samples = await sampleKeysOf(deps.meta, access.db, access.declared.connectionId, access.wholeTable);
  for await (const rows of peoplePages(access, access.filters)) {
    const standings = await judge(deps, access, rows, { purpose: access.audience.purpose, existing: access.existing, samples });
    yield rows.map((row, i) => ({ row, standing: standings[i]! }));
  }
}

/** The breakdown of an audience the sender reaches. */
export async function audienceBreakdown(deps: AudienceDeps, access: AudienceAccess): Promise<AudienceBreakdown> {
  const out: AudienceBreakdown = { rows: 0, recipients: 0, consent: 0, existingCustomers: 0, doNotEmail: 0, notAgreed: 0, awaitingReview: 0, notMarked: 0, sample: 0, reservedDomain: 0, noAddress: 0 };
  for await (const page of judged(deps, access)) {
    for (const { standing } of page) {
      out.rows += 1;
      out[BREAKDOWN_FIELD[standing]] += 1;
    }
  }
  out.recipients = out.consent + out.existingCustomers;
  return out;
}

/** The variables a campaign to this table may name: its columns the sender reads in clear, and the four every campaign gives. */
export function audienceVariableNames(access: PeopleTableAccess): string[] {
  return [...access.table.columns.values()].filter((column) => !column.secret && column.unreadable !== true && !(column.masked && !access.canReadPii)).map((column) => column.name);
}

/** A value as a mail prints it; null for one it does not (a list, a map position). */
function asText(value: unknown): string | null {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') return String(value);
  if (value instanceof Date) return value.toISOString();
  return null;
}

/** The person's name and first name, by the app's rule (a column, or the first word of the name). */
function namesOf(declared: DeclaredPeopleTable, seen: Row): { name: string; first: string } {
  const raw = declared.name === null ? '' : seen[declared.name];
  const name = typeof raw === 'string' ? raw.trim() : '';
  const firstWord = name.split(/\s+/)[0] ?? '';
  if (declared.firstName !== null && declared.firstName !== FIRST_WORD_OF_NAME) {
    const own = seen[declared.firstName.column];
    return { name, first: typeof own === 'string' && own.trim() !== '' ? own.trim() : firstWord };
  }
  return { name, first: firstWord };
}

/** What one person's message fills its placeholders with (see the header). */
export function audienceVars(access: PeopleTableAccess, seen: Row, address: string, appName: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of audienceVariableNames(access)) {
    const text = asText(seen[name]);
    if (text !== null) out[name] = text;
  }
  const { name, first } = namesOf(access.declared, seen);
  return { ...out, ...recipientVars({ name, email: address }, appName), first_name: first };
}

/** The eight languages a mail is written in, by their two-letter language. */
const BY_LANGUAGE = new Map<string, string>();
for (const id of BUILTIN_LOCALE_IDS) {
  const language = id.split('_')[0]!;
  if (!BY_LANGUAGE.has(language)) BY_LANGUAGE.set(language, id);
}

/** A language column's value as a locale id (`de`, `de-DE`, `de_de` → `de_DE`); null when it names none of the eight. */
export function localeOfLanguage(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const parts = value.trim().replace(/-/g, '_').split('_').filter((part) => part !== '');
  if (parts.length === 0) return null;
  const language = parts[0]!.toLowerCase();
  const region = parts.length > 1 ? parts[parts.length - 1]!.toUpperCase() : null;
  if (region !== null) {
    const exact = BUILTIN_LOCALE_IDS.find((id) => id === `${language}_${region}`);
    if (exact !== undefined) return exact;
    if (language === 'zh' && ['HK', 'MO', 'HANT'].includes(region)) return 'zh_TW';
  }
  return BY_LANGUAGE.get(language) ?? null;
}

/**
 * The audience's ledger rows: everyone judged, those mailed `queued`, the
 * rest written as skipped with their reason; a row with no address is not
 * written. Nothing when the sender may not send it now (the batch check that
 * follows refuses the run with the reason).
 */
export async function* tableAudienceRecipients(deps: AudienceDeps, run: Pick<EmailRun, 'createdBy'>, audience: TableAudience): AsyncGenerator<EmailSendInput> {
  const opened = await openTableAudience(deps, run.createdBy, audience, { running: true });
  if (!('ok' in opened)) return;
  const access = opened.ok;
  const install = await recipientLocale(deps.meta, null);
  for await (const page of judged(deps, access)) {
    for (const { row, standing } of page) {
      if (standing === 'no-address' || row.address === null) continue;
      const own = access.declared.language === null ? null : localeOfLanguage(row.whole[access.declared.language]);
      const base: EmailSendInput = {
        address: row.address,
        name: namesOf(access.declared, row.seen).name,
        language: own ?? install,
        connectionId: access.declared.connectionId,
        personTable: access.wholeTable.id,
        personKey: row.key,
      };
      const skipped = SKIPS[standing];
      yield skipped === null ? base : { ...base, ...skipped };
    }
  }
}

const SKIPS: Record<Standing, Pick<EmailSendInput, 'state' | 'reason'> | null> = {
  consent: null,
  'existing-customer': null,
  'do-not-email': { state: 'skipped-stop', reason: CAMPAIGN_SKIP_DO_NOT_EMAIL },
  'not-agreed': { state: 'skipped-consent', reason: CAMPAIGN_SKIP_NOT_AGREED },
  'awaiting-review': { state: 'skipped-consent', reason: AUDIENCE_SKIP_REVIEW },
  'not-marked': { state: 'skipped-consent', reason: AUDIENCE_SKIP_NOT_MARKED },
  sample: { state: 'skipped-consent', reason: AUDIENCE_SKIP_SAMPLE },
  'reserved-domain': { state: 'skipped-consent', reason: AUDIENCE_SKIP_RESERVED },
  'no-address': null,
};

/** How many runs' access a process keeps between a batch's check and its rows. */
const KEPT_RUNS = 64;

/**
 * The seams a table audience gives the campaign batches (run after the
 * marketing checks, `jobs/register.ts` `withMarketingChecks`):
 *  - `tableRecipients`: the first batch's ledger rows;
 *  - `checkBatch`: the sender's rights as they stand now (see the header);
 *    a refusal stops the run for good with its code as the reason;
 *  - `checkRow`: the row read again as the sender: gone or out of their
 *    reach, or holding another address now, it is skipped; on the existing-
 *    customers basis, a person with no yes in the log still goes only while
 *    the owner's switch is on and the row is a marked customer;
 *  - `varsFor`: the row's own columns as the sender reads them.
 */
export function tableAudienceSeams(deps: AudienceDeps): Required<Pick<CampaignSeams, 'tableRecipients' | 'checkBatch' | 'checkRow' | 'varsFor'>> {
  const kept = new Map<string, AudienceAccess>();
  const vars = new Map<string, Row>();

  const keep = (runId: string, access: AudienceAccess): void => {
    kept.delete(runId);
    kept.set(runId, access);
    while (kept.size > KEPT_RUNS) kept.delete(kept.keys().next().value!);
  };

  async function accessFor(run: EmailRun): Promise<AudienceAccess | AudienceRefusal> {
    const audience = run.audience as TableAudience;
    const opened = await openTableAudience(deps, run.createdBy, audience, { running: true });
    if (!('ok' in opened)) return opened.refuse;
    keep(run.id, opened.ok);
    return opened.ok;
  }

  /** The row as it stands, read as the sender reaches it; undefined when gone or out of their reach. */
  async function rowNow(access: AudienceAccess, row: EmailSend): Promise<Row | undefined> {
    if (row.personKey === null) return undefined;
    const pk = pkOfRowKey(access.wholeTable, row.personKey);
    if (pk === null) return undefined;
    return access.reach === null ? fetchByPk(access.db, access.wholeTable, pk) : fetchVisible(access.reach, access.db, access.wholeTable, pk, 'read');
  }

  return {
    tableRecipients: (run, audience) => tableAudienceRecipients(deps, run, audience),

    async checkBatch(run) {
      if (run.audience.kind !== 'table') return 'send';
      const access = await accessFor(run);
      return typeof access === 'string' ? { refuse: access } : 'send';
    },

    async checkRow(row, run): Promise<CampaignRowVerdict> {
      if (run.audience.kind !== 'table') return 'send';
      const access = kept.get(run.id) ?? (await accessFor(run));
      // The batch check stops a refused run before any row; a row reaching here without it goes nowhere.
      if (typeof access === 'string') return { skip: 'skipped-consent', reason: AUDIENCE_SKIP_OUT_OF_REACH };
      const whole = await rowNow(access, row);
      if (whole === undefined) return { skip: 'skipped-consent', reason: AUDIENCE_SKIP_OUT_OF_REACH };
      const value = whole[access.declared.email!];
      if (typeof value !== 'string' || normaliseAddress(value) !== normaliseAddress(row.address)) return { skip: 'skipped-consent', reason: AUDIENCE_SKIP_ADDRESS_CHANGED };
      if (run.basis === 'existing-customers') {
        const person = { connectionId: access.declared.connectionId, table: access.wholeTable.id, key: row.personKey! };
        const standing = await deps.consent.stateFor({ person, address: row.address }, runPurpose(run));
        const carried = access.existing && customerRow(access.declared, whole) && markedForOptOut(access.declared, whole);
        if (standing.state !== 'yes' && !carried) return { skip: 'skipped-consent', reason: CAMPAIGN_SKIP_NOT_AGREED };
      }
      vars.set(row.id, maskRow(whole, access.table, access.canReadPii));
      return 'send';
    },

    async varsFor(row, run, appName) {
      if (run.audience.kind !== 'table') return null;
      let seen = vars.get(row.id);
      vars.delete(row.id);
      const access = kept.get(run.id);
      if (access === undefined) return null;
      if (seen === undefined) {
        const whole = await rowNow(access, row);
        if (whole === undefined) return null;
        seen = maskRow(whole, access.table, access.canReadPii);
      }
      return audienceVars(access, seen, row.address, appName);
    },
  };
}

// ─── The first-send review ─────────────────────────────────────────────────

/** One person the review asks about. */
export interface ReviewPerson {
  key: string;
  name: string;
  address: string;
  /** Who ticked the box and when, as the table's own stamps say (when it keeps them and the reviewer reads them). */
  tickedBy: string | null;
  tickedAt: number | null;
}

/** The table's stamps of who ticked its consent column and when: columns stamped when it changes. */
function tickStamps(table: ResolvedTable, column: string): { by: { column: string; id: boolean } | null; at: string | null } {
  let by: { column: string; id: boolean } | null = null;
  let at: string | null = null;
  for (const one of table.table.columns) {
    const stamp = one.stamp;
    if (stamp === undefined) continue;
    const triggers = Array.isArray(stamp.on) ? stamp.on : [stamp.on];
    const watches = triggers.some((trigger) => typeof trigger === 'object' && (('column' in trigger && trigger.column === column) || ('columns' in trigger && trigger.columns.includes(column))));
    if (!watches) continue;
    if (stamp.set === 'now' && at === null) at = one.name;
    else if ((stamp.set === 'user-id' || stamp.set === 'user-name') && by === null) by = { column: one.name, id: stamp.set === 'user-id' };
  }
  return { by, at };
}

/** A stamp's moment as epoch ms; null when it reads as none. */
function momentOf(value: unknown): number | null {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const ms = Date.parse(value.includes('T') || value.endsWith('Z') ? value : `${value.replace(' ', 'T')}Z`);
    return Number.isNaN(ms) ? null : ms;
  }
  return null;
}

/**
 * The people of a table who say yes in its declared consent column with no
 * answer in the consent log behind it (ticked before records were kept, or
 * carried over by an update), as the reviewer reaches them: never a sample
 * row, an address on a reserved domain, or one on the do-not-email list.
 * Nobody once answered (Confirm, Leave out) is asked again: the log has them.
 */
export async function reviewList(deps: AudienceDeps, access: PeopleTableAccess, limit: number): Promise<{ purpose: AudiencePurpose | null; total: number; people: ReviewPerson[] }> {
  const consent = access.declared.consent;
  if (consent === null) return { purpose: null, total: 0, people: [] };
  const purpose = consent.purpose;
  const samples = await sampleKeysOf(deps.meta, access.db, access.declared.connectionId, access.wholeTable);
  const stamps = tickStamps(access.wholeTable, consent.column);
  const names = new Map<string, string>();
  const people: ReviewPerson[] = [];
  let total = 0;
  for await (const rows of peoplePages(access, undefined)) {
    const ticked = rows.filter((row) => tickedWithoutRecord(access.declared, purpose, row.whole));
    if (ticked.length === 0) continue;
    const standings = await judge(deps, access, ticked, { purpose, existing: false, samples });
    for (const [i, row] of ticked.entries()) {
      if (standings[i] !== 'awaiting-review') continue;
      total += 1;
      if (people.length >= limit) continue;
      let tickedBy: string | null = null;
      const by = stamps.by === null ? undefined : row.seen[stamps.by.column];
      if (typeof by === 'string' && by !== '') {
        if (stamps.by!.id) {
          if (!names.has(by)) names.set(by, (await usersRepo(deps.meta).findById(by))?.name ?? '');
          tickedBy = names.get(by) || null;
        } else tickedBy = by;
      }
      people.push({ key: row.key, name: namesOf(access.declared, row.seen).name, address: row.address!, tickedBy, tickedAt: stamps.at === null ? null : momentOf(row.seen[stamps.at]) });
    }
  }
  return { purpose, total, people };
}

/** The review's answer about one person was not taken: they are not (or no longer) one the review asks about. */
export class NotInReviewError extends AppError {
  constructor() {
    super(409, 'NOT_IN_REVIEW', 'That person is not waiting for review: their answer is already in the consent log, or they are not one the review asks about.');
  }
}

/**
 * The reviewer's answer about one person: "Confirm" records a yes in
 * their name ("ticked before records were kept"); "Leave out" records a no
 * ("left out at the send review"). Either is one row in the consent log,
 * after which the review never asks about them again; the table's declared
 * column then follows the log (`mirror`).
 */
export async function answerReview(
  deps: AudienceDeps & { mirror: (event: Awaited<ReturnType<ConsentService['record']>>) => Promise<number> },
  access: PeopleTableAccess,
  input: { key: string; answer: 'confirm' | 'leave-out'; staff: StaffMember },
): Promise<Awaited<ReturnType<ConsentService['record']>>> {
  const consent = access.declared.consent;
  if (consent === null) throw new NotInReviewError();
  const pk = pkOfRowKey(access.wholeTable, input.key);
  // As "Record consent" judges it: a change of this row, inside the reviewer's update reach (the route asks the grant).
  const whole = pk === null ? undefined : access.reach === null ? await fetchByPk(access.db, access.wholeTable, pk) : await fetchVisible(access.reach, access.db, access.wholeTable, pk, 'update');
  if (whole === undefined) throw new NotInReviewError();
  const key = rowKeyOf(access.wholeTable, whole);
  const seen = maskRow(whole, access.table, access.canReadPii);
  const value = seen[access.declared.email!];
  const row: PersonRow = { key, seen, whole, address: typeof value === 'string' && looksLikeAddress(value) ? normaliseAddress(value) : null };
  if (!tickedWithoutRecord(access.declared, consent.purpose, whole)) throw new NotInReviewError();
  const samples = await sampleKeysOf(deps.meta, access.db, access.declared.connectionId, access.wholeTable);
  const [standing] = await judge(deps, access, [row], { purpose: consent.purpose, existing: false, samples });
  if (standing !== 'awaiting-review') throw new NotInReviewError();
  const person = { connectionId: access.declared.connectionId, table: access.wholeTable.id, key };
  const event =
    input.answer === 'confirm'
      ? await deps.consent.record({ person, address: row.address, purpose: consent.purpose, state: 'yes', source: 'review', detail: 'before-records', staff: input.staff })
      : await deps.consent.withdraw({ person, address: row.address, purpose: consent.purpose, source: 'review', detail: 'send-review', staff: input.staff });
  await deps.mirror(event);
  return event;
}

// ─── The picker ────────────────────────────────────────────────────────────

/** One table the send dialog's table picker offers. */
export interface AudienceTableEntry {
  connectionId: string;
  table: string;
  label: string;
  appKey: string;
  appName: string;
  kind: 'people' | 'companies';
  /** The purpose the table's own consent column stands for, when it has one. */
  consentPurpose: AudiencePurpose | null;
  /** Whether the sender sees the addresses in clear: a masked or hidden one is offered, and its send refused by name. */
  addresses: 'readable' | 'masked' | 'hidden';
  existingCustomers: { offered: boolean; on: boolean; at: number | null; by: { id: string; name: string } | null };
}

/** An app's name as its manifest says it. */
function appNameOf(document: unknown, fallback: string): string {
  const name = (document as { name?: unknown } | null)?.name;
  return typeof name === 'string' && name !== '' ? name : fallback;
}

const NO_SECRETS = {
  encrypt: (): string => {
    throw new Error('the audience picker never stores a credential');
  },
  decrypt: (): string => {
    throw new Error('the audience picker never reads a credential');
  },
};

/** Who set a switch, by name. */
async function setter(meta: MetaDb, id: string | null): Promise<{ id: string; name: string } | null> {
  if (id === null) return null;
  const user = await usersRepo(meta).findById(id);
  return user === null ? null : { id: user.id, name: user.name };
}

/** The switch as the dialog and the table's e-mail settings show it. */
export async function existingCustomersView(meta: MetaDb, access: Pick<PeopleTableAccess, 'offered' | 'switched'>): Promise<AudienceTableEntry['existingCustomers']> {
  const on = access.offered && access.switched?.on === true;
  return { offered: access.offered, on, at: access.switched?.at ?? null, by: await setter(meta, access.switched?.by ?? null) };
}

/** Every people table of the install that `userId` may send to, with what the dialog shows of each. */
export async function audienceTables(deps: AudienceDeps, userId: string): Promise<AudienceTableEntry[]> {
  const installed = await manifestsRepo(deps.meta, NO_SECRETS).list('app');
  const out: AudienceTableEntry[] = [];
  for (const app of installed) {
    const connectionId = app.row.connectionId;
    if (connectionId === null || app.row.status !== 'installed') continue;
    let whole: SnapshotView;
    try {
      whole = await loadSnapshotView(deps.meta, connectionId);
    } catch {
      continue;
    }
    for (const declared of await peopleTablesOf(deps.meta).all(connectionId, whole.model)) {
      if (declared.appKey !== app.row.manifestKey || !declared.canEmail) continue;
      const opened = await openPeopleTable(deps, userId, connectionId, declared.table);
      let addresses: AudienceTableEntry['addresses'];
      let access: PeopleTableAccess | null = null;
      if ('ok' in opened) {
        addresses = 'readable';
        access = opened.ok;
      } else if (opened.refuse === 'addresses-masked' || opened.refuse === 'addresses-hidden') {
        addresses = opened.refuse === 'addresses-masked' ? 'masked' : 'hidden';
      } else continue;
      const table = whole.table(declared.table);
      const offered = offersExistingCustomers(declared);
      const switched = access?.switched ?? (await existingCustomersSwitch(deps.meta, connectionId, table.id));
      out.push({
        connectionId,
        table: table.id,
        label: table.table.label ?? table.name,
        appKey: app.row.manifestKey,
        appName: appNameOf(app.document, app.row.manifestKey),
        kind: declared.kind,
        consentPurpose: declared.consent?.purpose ?? null,
        addresses,
        existingCustomers: await existingCustomersView(deps.meta, { offered, switched }),
      });
    }
  }
  return out;
}

/** One saved view the "Only these" list offers. */
export interface AudienceViewEntry {
  id: string;
  name: string;
  /** Shared with everyone, or the sender's own. */
  shared: boolean;
  /** Why it cannot be sent to as it is, when it cannot. */
  refused: 'view-search' | 'view-hidden-column' | null;
}

/** The saved views of a table the sender may narrow a send by (their own and the shared ones). */
export async function audienceViews(deps: AudienceDeps, access: PeopleTableAccess): Promise<AudienceViewEntry[]> {
  const out: AudienceViewEntry[] = [];
  for (const page of await pagesRepo(deps.meta).listForConnection(access.whole.connectionId)) {
    const source = pageSourceTable(page.config);
    if (source === null) continue;
    let bound: ResolvedTable;
    try {
      bound = access.whole.table(source);
    } catch {
      continue;
    }
    if (bound.id !== access.wholeTable.id) continue;
    for (const saved of await viewsRepo(deps.meta).listForPageUser(page.id, access.userId)) {
      const checked = await viewFilters(deps.meta, access, saved.id);
      let refused: AudienceViewEntry['refused'] = null;
      if ('refuse' in checked) {
        if (checked.refuse !== 'view-search') continue;
        refused = 'view-search';
      } else {
        try {
          await listAsSender(access, checked.filters, { limit: 1, offset: 0 });
        } catch (error) {
          if ((error as { code?: unknown }).code !== 'COLUMN_FORBIDDEN') throw error;
          refused = 'view-hidden-column';
        }
      }
      out.push({ id: saved.id, name: saved.name, shared: saved.userId === null, refused });
    }
  }
  return out;
}
