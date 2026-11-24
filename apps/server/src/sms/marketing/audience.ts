// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHO A MARKETING TEXT REACHES: the people of one table an installed app
 * declares with a mobile column (`people.phone`), narrowed by a saved view of
 * it, read as the person who sends it.
 *
 * ─── The shape is e-mail's, the rules are not ─────────────────────────────
 * The table is opened and read as an e-mail campaign to a table's people is
 * (`email/audience-table.ts`): the sender's own view of the connection, their
 * row limits, their right to read the mobile column in clear, a saved view's
 * filters. All of it is asked again when the run starts and at every batch.
 *
 * Who gets the text is text's own rule, and nothing of e-mail's:
 *   1. no number on the row: left out (`no-phone`);
 *   2. a row of the app's sample data: left out (`sample`);
 *   3. a person a lead finder found: left out (`found-lead`), whatever the
 *      log says. A found lead, or a bought or imported list, never gets a
 *      marketing text;
 *   4. the text consent service decides the rest, exactly as it decides at
 *      the last moment before the provider: mainland China, a number that
 *      cannot take a text, a country where nobody can reply STOP, the stop
 *      list, no marketing yes to texts on this exact number, and a yes not
 *      yet confirmed where the country expects double opt-in;
 *   5. two rows holding one number: the first one only (`same-number`).
 * A newsletter yes, an e-mail yes and e-mail's "existing customers" switch are
 * never read: the text log is a store of its own, and the only yes that counts
 * came from the person's own form tick or a named staff member's record, each
 * with the words they were shown. An import writes no row of that log.
 *
 * Here rows are judged as though the sender were a number on a server that
 * reads replies, so the console can say who would get it once the run itself
 * can go. Whether it can is `preflight.ts`, and the send path judges each text
 * again with the real sender before it is handed over.
 */
import { manifestsRepo, usersRepo, type ConsentPerson, type MetaDb } from '@adminium/meta';
import type { Dialect } from '@adminium/engine';
import type { Kysely } from 'kysely';

import { sampleKeyOf, sampleKeysOf } from '../../apps/sample-data.js';
import { storedTableRef, tableRefIndex } from '../../apps/table-ref.js';
import type { ConnectionManager, SourceDatabase } from '../../connections/manager.js';
import type { ResolvedTable, SnapshotView } from '../../crud/identifiers.js';
import { LIST_LIMIT_MAX } from '../../crud/list.js';
import { keptCodeColumnsOf, maskRow, type Row } from '../../crud/mask.js';
import { readViewOf } from '../../crud/read-view.js';
import { rowLimitContextOf, rowTestOf } from '../../crud/row-limit-context.js';
import { fetchVisible, type RowLimitContext, type RowTest } from '../../crud/row-limit.js';
import { fetchByPk } from '../../crud/records.js';
import { loadSnapshotView } from '../../data-io/snapshot-view.js';
import { appNameOf, asText, listAsSender, localeOfLanguage, namesOf, piiAllowedFor, viewFilters, wholeRowsOf } from '../../email/audience-table.js';
import { foundRowsOf } from '../../leads/found-store.js';
import { leadsAddOnsOn, storedLeadsAddOns } from '../../leads/installs.js';
import { pkOfRowKey, rowKeyOf } from '../../payments/payables.js';
import type { DeclaredPeopleTable } from '../../people/declared.js';
import { peopleTablesOf } from '../../people/tables-of.js';
import { parsePhone } from '../../phone/index.js';
import { PERMISSIONS } from '../../rbac/permissions.js';
import { permissionSetAllows, resolvePermissionSet, type PermissionSet } from '../../rbac/resolver.js';
import { maskPhone } from '../consent/redact.js';
import type { TextConsentService } from '../consent/types.js';
import type { TextAudienceRefusal, TextRecipientSkip } from './types.js';

/** One table's people, narrowed by a saved view of it. */
export interface TextAudience {
  connectionId: string;
  table: string;
  viewId?: string | null | undefined;
}

export interface TextAudienceDeps {
  meta: MetaDb;
  manager: Pick<ConnectionManager, 'data'>;
  consent: Pick<TextConsentService, 'decide'>;
  /** The business's country, to read a local number in. */
  country: () => Promise<string | null>;
}

/** The table as the sender reaches it: everything a read of it needs, resolved once. */
export interface TextAudienceAccess {
  userId: string;
  set: PermissionSet;
  declared: DeclaredPeopleTable & { phone: string };
  whole: SnapshotView;
  view: SnapshotView;
  wholeTable: ResolvedTable;
  table: ResolvedTable;
  db: Kysely<SourceDatabase>;
  dialect: Dialect;
  canReadPii: boolean;
  reach: RowLimitContext | null;
  rowTest: RowTest | undefined;
  label: string;
  filters: unknown[] | undefined;
}

export type Opened = { ok: TextAudienceAccess } | { refuse: TextAudienceRefusal; label: string };

/** A sentence for each refusal, naming the table, as an error says it. The console words the code itself. */
export function audienceRefusalSentence(reason: TextAudienceRefusal, label: string): string {
  switch (reason) {
    case 'not-people':
      return `${label} is not a table of people with a mobile number that texts may go to.`;
    case 'cannot-send':
      return 'You may no longer send marketing texts.';
    case 'cannot-read':
      return `You can no longer read ${label}, so you can't send to it.`;
    case 'phones-hidden':
    case 'phones-masked':
      return `You can't see ${label}'s mobile numbers, so you can't text them.`;
    case 'view-gone':
      return 'That saved view is not there for you any more.';
    case 'view-search':
      return 'That saved view has a search term, and a send cannot carry one: it would reach more people than the view shows.';
    case 'view-hidden-column':
      return `That saved view filters by a column of ${label} your role does not show.`;
  }
}

/**
 * The audience as `userId` reaches it now, or why they may not send it. The
 * view's filters are tried once, so a filter on a column their role hides is
 * refused here rather than half-way through a run.
 */
export async function openTextAudience(deps: TextAudienceDeps, userId: string | null, audience: TextAudience): Promise<Opened> {
  let whole: SnapshotView;
  let wholeTable: ResolvedTable;
  try {
    whole = await loadSnapshotView(deps.meta, audience.connectionId);
    wholeTable = whole.table(audience.table);
  } catch {
    return { refuse: 'not-people', label: audience.table };
  }
  const label = wholeTable.table.label ?? wholeTable.name;
  const declared = await peopleTablesOf(deps.meta).of(audience.connectionId, whole.model, wholeTable.id);
  if (declared === null || declared.kind !== 'people' || declared.phone === undefined || declared.appStatus !== 'installed' || wholeTable.primaryKey.length === 0) return { refuse: 'not-people', label };
  const user = userId === null ? null : await usersRepo(deps.meta).findById(userId);
  if (user === null || user.status !== 'active') return { refuse: 'cannot-send', label };
  const set = await resolvePermissionSet(deps.meta, { kind: 'user', id: user.id, label: user.name });
  // Both, for as long as the run goes on: settings for the audience, as e-mail asks, and texts for the money.
  if (!permissionSetAllows(set, PERMISSIONS.settingsManage) || !permissionSetAllows(set, PERMISSIONS.smsManage)) return { refuse: 'cannot-send', label };
  if (!permissionSetAllows(set, `table:${audience.connectionId}:${wholeTable.id}:read`) || wholeTable.table.private === true) return { refuse: 'cannot-read', label };
  const view = readViewOf(whole, set);
  const table = view.linkTable(wholeTable.id) ?? wholeTable;
  const phone = table.columns.get(declared.phone);
  if (phone === undefined || phone.secret || phone.unreadable === true) return { refuse: 'phones-hidden', label };
  const canReadPii = piiAllowedFor(set, audience.connectionId, wholeTable.id);
  if (phone.masked && !canReadPii) return { refuse: 'phones-masked', label };
  const reach = await rowLimitContextOf(deps.meta, set, audience.connectionId, whole.model);
  const { db, dialect } = await deps.manager.data(audience.connectionId);
  const base = {
    userId: user.id,
    set,
    declared: declared as DeclaredPeopleTable & { phone: string },
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
  };
  const filtered = await viewFilters(deps.meta, base, audience.viewId);
  if ('refuse' in filtered) return { refuse: filtered.refuse as TextAudienceRefusal, label };
  try {
    await listAsSender(base, filtered.filters, { limit: 1, offset: 0 });
  } catch (error) {
    if ((error as { code?: unknown }).code === 'COLUMN_FORBIDDEN') return { refuse: 'view-hidden-column', label };
    throw error;
  }
  return { ok: { ...base, filters: filtered.filters } };
}

/** One row of the table, as the sender reads it and as it is. */
export interface TextPersonRow {
  key: string;
  /** What the sender's view shows of it. */
  seen: Row;
  whole: Row;
}

/** Every row the sender's view of the table lists under its filters, a page at a time. */
export async function* textPeoplePages(access: TextAudienceAccess): AsyncGenerator<TextPersonRow[]> {
  // A key the sender sees masked cannot ride in a cursor; such a table is read by offset, as an export reads it.
  const byCursor = access.canReadPii || !access.table.primaryKey.some((column) => access.table.columns.get(column)?.masked === true);
  let cursor = '';
  let offset = 0;
  for (;;) {
    const page = await listAsSender(access, access.filters, byCursor ? { cursor, limit: LIST_LIMIT_MAX } : { offset, limit: LIST_LIMIT_MAX });
    if (page.data.length === 0) return;
    const wholes = await wholeRowsOf(access.db, access.wholeTable, page.data);
    const rows: TextPersonRow[] = [];
    for (const seen of page.data) {
      const key = rowKeyOf(access.wholeTable, seen);
      const whole = wholes.get(key);
      if (whole !== undefined) rows.push({ key, seen, whole });
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

/** The row as it stands now, read as the sender reaches it; undefined when gone or out of their reach. */
export async function rowNow(access: TextAudienceAccess, key: string): Promise<Row | undefined> {
  const pk = pkOfRowKey(access.wholeTable, key);
  if (pk === null) return undefined;
  return access.reach === null ? fetchByPk(access.db, access.wholeTable, pk) : fetchVisible(access.reach, access.db, access.wholeTable, pk, 'read');
}

/** The keys of the rows among `keys` that a lead finder's found person names, on any such add-on of the database. */
export async function foundAmong(meta: MetaDb, access: Pick<TextAudienceAccess, 'whole' | 'wholeTable' | 'db'>, keys: readonly string[]): Promise<Set<string>> {
  const out = new Set<string>();
  if (keys.length === 0) return out;
  const connectionId = access.whole.connectionId;
  const stored = (await storedLeadsAddOns(meta)).filter((one) => one.connectionId === connectionId);
  if (stored.length === 0) return out;
  const index = await tableRefIndex(meta, connectionId, access.whole.model);
  const names = [...new Set([access.wholeTable.id, storedTableRef(index, access.wholeTable.id)])];
  for (const addOn of await leadsAddOnsOn(meta, connectionId, access.whole, stored)) {
    if (addOn.foundPeople === null) continue;
    for (const found of await foundRowsOf(access.db, addOn.foundPeople, names, keys)) out.add(found.personKey);
  }
  return out;
}

/** One person judged. `e164` and `country` are set whenever the number reads. */
export interface JudgedPerson {
  key: string;
  person: ConsentPerson;
  name: string | null;
  e164: string | null;
  masked: string | null;
  country: string | null;
  /** The person's own language, when their row names one of the eight. */
  locale: string | null;
  /** Null: they get the text. */
  skip: TextRecipientSkip | null;
}

/**
 * Each row of a page judged (see the header). `seenNumbers` carries the
 * numbers already judged in earlier pages, so one number gets one text.
 */
export async function judgeRows(
  deps: TextAudienceDeps,
  access: TextAudienceAccess,
  rows: readonly TextPersonRow[],
  options: { samples: ReadonlySet<string>; seenNumbers: Set<string>; country: string | null },
): Promise<JudgedPerson[]> {
  const found = await foundAmong(deps.meta, access, rows.map((row) => row.key));
  const out: JudgedPerson[] = [];
  for (const row of rows) {
    const person: ConsentPerson = { connectionId: access.whole.connectionId, table: access.wholeTable.id, key: row.key };
    const raw = row.whole[access.declared.phone];
    const parsed = parsePhone(raw, options.country);
    const e164 = parsed.ok ? parsed.e164 : null;
    const own = access.declared.language === null ? null : localeOfLanguage(row.whole[access.declared.language]);
    const name = namesOf(access.declared, row.seen).name;
    const base = { key: row.key, person, name: name === '' ? null : name, e164, masked: e164 === null ? null : maskPhone(e164), country: parsed.ok ? parsed.country : null, locale: own };
    const sample = sampleKeyOf(access.wholeTable, row.whole);
    let skip: TextRecipientSkip | null = null;
    if (typeof raw !== 'string' || raw.trim() === '') skip = 'no-phone';
    else if (sample !== null && options.samples.has(sample)) skip = 'sample';
    else if (found.has(row.key)) skip = 'found-lead';
    else {
      const decision = await deps.consent.decide({ phone: raw, country: options.country, class: 'marketing', sender: { kind: 'number' }, repliesReachUs: true, person });
      if (!decision.send) skip = decision.reason;
      else if (options.seenNumbers.has(decision.e164)) skip = 'same-number';
      else options.seenNumbers.add(decision.e164);
    }
    out.push({ ...base, skip });
  }
  return out;
}

/** Every row of an audience judged, a page at a time. */
export async function* judgedPages(deps: TextAudienceDeps, access: TextAudienceAccess): AsyncGenerator<JudgedPerson[]> {
  const samples = await sampleKeysOf(deps.meta, access.db, access.whole.connectionId, access.wholeTable);
  const country = await deps.country();
  const seenNumbers = new Set<string>();
  for await (const rows of textPeoplePages(access)) yield judgeRows(deps, access, rows, { samples, seenNumbers, country });
}

/** The placeholders a marketing text may name: the table's columns the sender reads in clear, and the three every run gives. */
export function textVariableNames(access: Pick<TextAudienceAccess, 'table' | 'canReadPii'>): string[] {
  const columns = [...access.table.columns.values()].filter((column) => !column.secret && column.unreadable !== true && !(column.masked && !access.canReadPii)).map((column) => column.name);
  return [...new Set([...columns, 'name', 'first_name', 'business'])];
}

/** The columns of the table that hold a code: a template that reads one is refused, whatever the column is called. */
export function textCodeColumns(access: Pick<TextAudienceAccess, 'wholeTable'>): Set<string> {
  return keptCodeColumnsOf(access.wholeTable);
}

/** What one person's text fills its placeholders with: their row as the sender reads it, their names, and the business. */
export function textValues(access: TextAudienceAccess, whole: Row, business: string): Record<string, string> {
  const seen = maskRow(whole, access.table, access.canReadPii);
  const out: Record<string, string> = {};
  for (const name of textVariableNames(access)) {
    if (!Object.hasOwn(seen, name)) continue;
    const text = asText(seen[name]);
    if (text !== null) out[name] = text;
  }
  const names = namesOf(access.declared, seen);
  return { ...out, name: names.name, first_name: names.first, business };
}

const NO_SECRETS = {
  encrypt: (): string => {
    throw new Error('listing the tables texts may go to never stores a credential');
  },
  decrypt: (): string => {
    throw new Error('listing the tables texts may go to never reads a credential');
  },
};

/** One table the console may offer as an audience. */
export interface TextAudienceTable {
  connectionId: string;
  table: string;
  label: string;
  appKey: string;
  appName: string;
  /** Whether this person reads its mobile numbers in clear; a table they cannot read at all is not listed. */
  phones: 'readable' | 'masked' | 'hidden';
}

/** Every people table with a mobile column, of every installed app, as `userId` reaches it. */
export async function textAudienceTables(deps: TextAudienceDeps, userId: string): Promise<TextAudienceTable[]> {
  const out: TextAudienceTable[] = [];
  for (const app of await manifestsRepo(deps.meta, NO_SECRETS).list('app')) {
    const connectionId = app.row.connectionId;
    if (connectionId === null || app.row.status !== 'installed') continue;
    let whole: SnapshotView;
    try {
      whole = await loadSnapshotView(deps.meta, connectionId);
    } catch {
      continue;
    }
    for (const declared of await peopleTablesOf(deps.meta).all(connectionId, whole.model)) {
      if (declared.appKey !== app.row.manifestKey || declared.kind !== 'people' || declared.phone === undefined) continue;
      const opened = await openTextAudience(deps, userId, { connectionId, table: declared.table });
      let phones: TextAudienceTable['phones'];
      if ('ok' in opened) phones = 'readable';
      else if (opened.refuse === 'phones-masked') phones = 'masked';
      else if (opened.refuse === 'phones-hidden') phones = 'hidden';
      else continue;
      const table = whole.table(declared.table);
      out.push({ connectionId, table: table.id, label: table.table.label ?? table.name, appKey: app.row.manifestKey, appName: appNameOf(app.document, app.row.manifestKey), phones });
    }
  }
  return out;
}
