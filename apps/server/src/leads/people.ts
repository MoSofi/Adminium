// SPDX-License-Identifier: AGPL-3.0-only
/**
 * FOUND PEOPLE IN A PERSON'S DATA: keeping the people a source found, the
 * People switch, and every other mail held back until they are told.
 *
 * ─── Keeping them ({@link keepFoundPeople}) ─────────────────────────────────
 * The lead door hands over the people a staff member ticked at one company.
 * Each is checked before anything is stored, and refused by reason:
 *  - `people-off`: the add-on keeps no people (its settings' `people_on`);
 *  - `stopped`: the address is on the do-not-email list (an objection
 *    outlives the person who made it: an objector is never found again);
 *  - `already-here`: the address is on a declared people row already
 *    (decided as the install, never as the reader: a colleague's contact is
 *    still here), or twice in one hand-over. They get no mail;
 *  - `generic`: a shared address (`info@`, `sales@`) is not a person;
 *  - `no-name`: nobody is named;
 *  - `no-company`: the company they were found at is no row here;
 *  - `not-told-yet`: the mail that tells them cannot go now (no mail server,
 *    no public address, no purpose in a language they could be told in):
 *    nobody is stored who could not be told at once.
 * A person that passes is written into the declared people table as the
 * staff member (`crud/as-person.ts`: their grants, limits, rules and audit
 * apply; "may be e-mailed" left unset), then their found person's row as
 * Adminium (`found-store.ts`), then their tell mail is queued at once
 * (`tell.ts`). Audited as `leads.people.kept` with counts, never an address.
 *
 * ─── The People switch ({@link peopleSwitchProblems}) ──────────────────────
 * What is missing before `people_on` may be true: why they are kept, in the
 * install's language and in English (the languages a tell mail falls back
 * to), how many years they are kept, a mail server, this server's public
 * address and the mail door reachable from outside, the privacy notice, and
 * the add-on's tell mail. A save that switches people on while anything is
 * missing is refused, listing it (`guard.ts`).
 *
 * ─── Not told yet ({@link untoldAddress}) ──────────────────────────────────
 * While a found person has no `told_at`, every other mail to their address
 * is refused: an app's outbox, a campaign, a rule's e-mail step, a reply to
 * a chat. Only their tell mail goes.
 */
import type { FoundPerson } from '@adminium/add-on-contracts';
import { auditRepo, type MetaDb } from '@adminium/meta';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { sql, type Kysely } from 'kysely';

import { resolveTableRef, storedTableRef, tableRefIndex, type TableRefIndex } from '../apps/table-ref.js';
import { looksLikeAddress, type ConsentService } from '../consent/index.js';
import type { ConnectionManager, SourceDatabase } from '../connections/manager.js';
import { createAsPerson } from '../crud/as-person.js';
import type { ResolvedTable, SnapshotView } from '../crud/identifiers.js';
import type { Row } from '../crud/mask.js';
import { fetchByPk } from '../crud/records.js';
import type { RecordWriteService } from '../crud/write-service.js';
import { loadSnapshotView } from '../data-io/snapshot-view.js';
import { plainWords } from '../designer/untrusted.js';
import { mailDoorReach, type MailDoorReachFacts } from '../email/door-reach.js';
import { isEmailConfigured } from '../email/send.js';
import { ValidationFailedError } from '../errors.js';
import { recipientLocale } from '../i18n/server-i18n.js';
import { outboxContext } from '../outbox/context.js';
import { pkOfRowKey, rowKeyOf } from '../payments/payables.js';
import type { DeclaredPeopleTable } from '../people/declared.js';
import { peopleTablesOf } from '../people/tables-of.js';
import { privacyNoticeReady } from '../privacy/business.js';
import { normaliseAddress } from '../public-api/claim-code.js';
import { boundId, foundRowsOf, insertFound, leadsWriteContext, tellByOf, untoldChanged, untoldGeneration, untoldRows, updateFound, zoneOf } from './found-store.js';
import { LEADS_TELL_KIND, leadsAddOnsOn, leadsSettingsRow, readLeadsSettingsRow, storedLeadsAddOns, type LeadsAddOnTables, type LeadsSettings } from './installs.js';
import { companyCountryColumn } from './companies.js';
import { markSoleTrader, unmarkSoleTrader } from './sole-trader.js';
import { tellLanguages, type TellLanguage } from './tell-words.js';

/** Why a found person was not kept. */
export const KEEP_REFUSALS = ['people-off', 'stopped', 'already-here', 'generic', 'no-name', 'no-company', 'not-told-yet'] as const;
export type KeepRefusal = (typeof KEEP_REFUSALS)[number];

/** What a hand-over kept, and what it refused. */
export interface KeptPeople {
  kept: { email: string; personTable: string; personKey: string }[];
  refused: { email: string; reason: KeepRefusal }[];
}

/** The longest name a found person's row is written with. */
const NAME_MAX = 200;

/**
 * The local parts of an address that is a business's, not a person's: a
 * shared inbox in any of the languages the sources' countries write in.
 */
const GENERIC_LOCAL = new Set([
  'info', 'information', 'informations', 'contact', 'contacts', 'contactus', 'contact-us', 'hello', 'hi', 'hallo', 'hej', 'bonjour', 'ahoj',
  'office', 'admin', 'administration', 'support', 'help', 'helpdesk', 'service', 'services', 'customerservice', 'kundeservice', 'kundenservice',
  'sales', 'sale', 'vente', 'ventes', 'verkauf', 'salg', 'obchod', 'commercial', 'enquiries', 'enquiry', 'inquiries', 'inquiry', 'anfrage', 'anfragen',
  'mail', 'email', 'e-mail', 'post', 'postmaster', 'webmaster', 'hostmaster', 'abuse', 'noreply', 'no-reply', 'donotreply', 'do-not-reply',
  'team', 'hr', 'jobs', 'careers', 'career', 'recrutement', 'recruitment', 'billing', 'accounts', 'accounting', 'invoices', 'invoice', 'finance',
  'reception', 'accueil', 'empfang', 'marketing', 'press', 'presse', 'media', 'news', 'newsletter', 'orders', 'order', 'bookings', 'booking',
  'reservations', 'reservation', 'kontakt', 'buero', 'büro', 'bureau', 'kontor', 'secretariat', 'sekretariat', 'podatelna', 'direction', 'privacy',
  'legal', 'compliance', 'dpo', 'it', 'tech', 'general', 'enquire', 'studio', 'company', 'firma', 'societe', 'mailbox', 'all', 'staff',
]);

/** Whether an address is a shared inbox, not a person's own. */
export function genericAddress(address: string): boolean {
  const local = (address.split('@')[0] ?? '').toLowerCase();
  if (GENERIC_LOCAL.has(local)) return true;
  // `info.uk@`, `sales-team@`, `contact2@`: a shared inbox with a qualifier.
  const head = local.split(/[._+-]|\d/)[0] ?? '';
  return head !== '' && head !== local && GENERIC_LOCAL.has(head) && !/^[a-z]+\.[a-z]+$/.test(local);
}

export interface LeadsPeopleDeps {
  meta: MetaDb;
  manager: Pick<ConnectionManager, 'data'>;
  /** `ADMINIUM_SECRET`: whether mail can go is read under it. */
  secret: string;
  /** Whether the mail door can be reached from outside (`email/door-reach.ts`). */
  reach: MailDoorReachFacts;
  /** A database's current schema; the snapshot as others read it when absent. */
  viewFor?: ((connectionId: string) => Promise<SnapshotView | null>) | undefined;
  /**
   * More languages a tell mail may go in, for this install (the countries of
   * its sources that are switched on, once their switches are read): a
   * purpose is then needed in each before people may be switched on. The
   * install's language and English are always needed.
   */
  sourceLanguages?: ((install: LeadsAddOnTables) => Promise<readonly TellLanguage[]>) | undefined;
  now?: (() => number) | undefined;
}

export interface KeepFoundPeopleDeps extends LeadsPeopleDeps {
  /** The server, whose data routes write a person's row as the staff member. */
  app: FastifyInstance;
  consent: Pick<ConsentService, 'stop'>;
  /** The write service: a found person's row is checked by it, and the tell mail queued through it. */
  writes: Pick<RecordWriteService, 'check' | 'create'>;
  /** A tell mail was queued for an add-on: send it now (the outbox's send job). */
  onQueued?: ((addOnKey: string) => void) | undefined;
}

export interface KeepFoundPeopleInput {
  /** The add-on's install (`adminium_manifests` id) and key. */
  installId: string;
  addOnKey: string;
  /** Who keeps them: the staff member behind the request, whose rights write the person's row. */
  staff: { id: string; label: string; request: FastifyRequest };
  /** The company row they were found at: its table (its id, or its stored name `<app>:<ref>`) and its row key. */
  company: { table: string; key: string };
  /** The source id that found them (`addOn.sources[].id`). */
  source: string;
  people: readonly FoundPerson[];
  /**
   * The company row is this one person's own: a sole trader the lead door
   * added, whose address a member of staff typed. It is marked as theirs
   * before they are kept (`sole-trader.ts`), so every erasure of them empties
   * it too; the mark goes again when they are not kept.
   */
  soleTrader?: boolean | undefined;
}

async function viewOf(deps: LeadsPeopleDeps, connectionId: string): Promise<SnapshotView | null> {
  if (deps.viewFor !== undefined) return deps.viewFor(connectionId);
  try {
    return await loadSnapshotView(deps.meta, connectionId, { forOthers: true });
  } catch {
    return null;
  }
}

/** One add-on that finds people, by its install, with its tables; null when it is not installed. */
export async function leadsInstall(deps: Pick<LeadsPeopleDeps, 'meta' | 'manager' | 'viewFor'>, installId: string): Promise<{ addOn: LeadsAddOnTables; view: SnapshotView } | null> {
  const stored = (await storedLeadsAddOns(deps.meta)).find((one) => one.installId === installId);
  if (stored === undefined) return null;
  const view = await viewOf(deps as LeadsPeopleDeps, stored.connectionId);
  if (view === null) return null;
  const addOn = (await leadsAddOnsOn(deps.meta, stored.connectionId, view, [stored])).find((one) => one.installId === installId);
  return addOn === undefined ? null : { addOn, view };
}

/** `lower(trim(column)) = address`. */
const addressIs = (column: string, address: string) => sql<boolean>`lower(trim(${sql.ref(column)})) = ${address}`;

/** The install's language, as a mail's language tag (`en-US`). */
export async function installLanguage(meta: MetaDb): Promise<string> {
  return (await recipientLocale(meta, null)).replace('_', '-');
}

// ── The People switch ────────────────────────────────────────────────────────

/**
 * What may be missing before people may be switched on, by a STABLE code: an
 * add-on's screen reads these (in a refusal's `details.problems`) and says
 * each in its reader's language, rather than reading the English message.
 *  - `purpose-missing`: why they are kept, not written in a language needed;
 *  - `keep-time`: how long they are kept, not chosen;
 *  - `smtp`: e-mail is not set up;
 *  - `public-origin`: the address in e-mail links is not set;
 *  - `mail-door`: the Object page cannot be reached from outside;
 *  - `privacy-notice`: the business name or the privacy notice is not set;
 *  - `tell-outbox`: the add-on declares no mail that tells a person;
 *  - `tables`: the add-on, or its tables for found people, are not here.
 */
export const PEOPLE_SWITCH_CODES = ['purpose-missing', 'keep-time', 'smtp', 'public-origin', 'mail-door', 'privacy-notice', 'tell-outbox', 'tables'] as const;
export type PeopleSwitchCode = (typeof PEOPLE_SWITCH_CODES)[number];

/** One thing missing before people may be switched on. */
export interface PeopleSwitchProblem {
  code: PeopleSwitchCode;
  /** For a missing purpose: the language it is missing in (`fr-FR`). */
  language?: string;
  message: string;
}

/** One thing missing, as a refusal carries it: a missing purpose names every language it is missing in. */
export interface PeopleSwitchProblemData {
  code: PeopleSwitchCode;
  /** For `purpose-missing`: the languages (BCP 47 tags, `fr-FR`), sorted. */
  languages?: string[];
  /** The same thing in English, as the refusal's message says it. */
  message: string;
}

/** The problems as a refusal's `details.problems`: one entry per code, in the order they were found. */
export function peopleSwitchProblemsData(problems: readonly PeopleSwitchProblem[]): PeopleSwitchProblemData[] {
  const out: PeopleSwitchProblemData[] = [];
  for (const problem of problems) {
    const same = out.find((one) => one.code === problem.code);
    if (problem.code === 'purpose-missing') {
      if (same === undefined) out.push({ code: problem.code, languages: problem.language === undefined ? [] : [problem.language], message: problem.message });
      else {
        if (problem.language !== undefined) same.languages = [...(same.languages ?? []), problem.language].sort();
        same.message = `${same.message} ${problem.message}`;
      }
    } else if (same === undefined) out.push({ code: problem.code, message: problem.message });
  }
  return out;
}

const LANGUAGE_NAMES: Readonly<Record<string, string>> = {
  'en-US': 'English',
  'de-DE': 'German',
  'fr-FR': 'French',
  'cs-CZ': 'Czech',
  'da-DK': 'Danish',
  'ar-EG': 'Arabic',
  'zh-CN': 'Chinese (Simplified)',
  'zh-TW': 'Chinese (Traditional)',
};

/**
 * What is missing before people may be kept (see the header). `settings`
 * reads a save's values over the row as it stands: a save may write the
 * purpose and switch people on at once.
 */
export async function peopleSwitchProblems(deps: LeadsPeopleDeps, install: { installId: string } | LeadsAddOnTables, settings?: Row): Promise<PeopleSwitchProblem[]> {
  const found = 'manifest' in install ? { addOn: install } : await leadsInstall(deps, install.installId);
  if (found === null) return [{ code: 'tables', message: 'The add-on that finds people is not installed here.' }];
  const { addOn } = found;
  const out: PeopleSwitchProblem[] = [];
  if (addOn.foundPeople === null || addOn.settings === null) out.push({ code: 'tables', message: 'The add-on’s tables for the people it finds are not here.' });
  if (addOn.tell === null) out.push({ code: 'tell-outbox', message: 'The add-on has no mail that tells a person where their details came from.' });
  const { db } = await deps.manager.data(addOn.connectionId);
  const stored = addOn.settings === null ? null : await leadsSettingsRow(db, addOn);
  const read: LeadsSettings = readLeadsSettingsRow({ ...(stored ?? {}), ...(settings ?? {}) });
  const needed = new Set<string>([await installLanguage(deps.meta), 'en-US', ...((await deps.sourceLanguages?.(addOn)) ?? [])]);
  for (const language of [...needed].sort()) {
    if ((read.purpose as Record<string, string | undefined>)[language] === undefined) {
      out.push({ code: 'purpose-missing', language, message: `Write the ${LANGUAGE_NAMES[language] ?? language} version of why you keep them.` });
    }
  }
  if (read.keepYearsSet === null) out.push({ code: 'keep-time', message: 'Choose how long found people are kept: 1 to 10 years.' });
  if (!(await isEmailConfigured(deps.meta, deps.secret))) out.push({ code: 'smtp', message: 'E-mail isn’t set up: Settings → Email.' });
  const door = await mailDoorReach(deps.meta, deps.reach);
  if (door.origin === null) out.push({ code: 'public-origin', message: 'Set the address in e-mail links: Settings → Senders.' });
  else if (!door.open) out.push({ code: 'mail-door', message: 'The page a person objects on can’t be reached from outside: check this server’s public address.' });
  if (!(await privacyNoticeReady(deps.meta))) out.push({ code: 'privacy-notice', message: 'Set the business name and the privacy notice’s address: Server settings → Privacy & public pages.' });
  return out;
}

// ── Not told yet ─────────────────────────────────────────────────────────────

/** Addresses being kept right now in this process: not told, and their row not written yet. */
const KEEPING = new Map<MetaDb, Map<string, number>>();

function keepingNow(meta: MetaDb, address: string, delta: 1 | -1): void {
  let held = KEEPING.get(meta);
  if (held === undefined) {
    held = new Map();
    KEEPING.set(meta, held);
  }
  const count = (held.get(address) ?? 0) + delta;
  if (count <= 0) held.delete(address);
  else held.set(address, count);
}

/** The names a stored table name may be read by, for a people table: its id and its maker's `<app>:<ref>`. */
function namesOf(index: TableRefIndex, tableId: string): string[] {
  return [...new Set([tableId, storedTableRef(index, tableId)])];
}

/** The address a people row holds, as every door normalises it; null when it holds none. */
function addressOfRow(declared: DeclaredPeopleTable, row: Row): string | null {
  const value = declared.email === null ? null : row[declared.email];
  return typeof value === 'string' && looksLikeAddress(value) ? normaliseAddress(value) : null;
}

/**
 * Every address a found person not told yet has (waiting, or their mail
 * failed), on every install: no other mail may reach them.
 */
export async function untoldAddresses(deps: Pick<LeadsPeopleDeps, 'meta' | 'manager' | 'viewFor'>): Promise<Set<string>> {
  const out = new Set<string>(KEEPING.get(deps.meta)?.keys() ?? []);
  const stored = await storedLeadsAddOns(deps.meta);
  for (const connectionId of [...new Set(stored.map((one) => one.connectionId))]) {
    const view = await viewOf(deps as LeadsPeopleDeps, connectionId);
    if (view === null) continue;
    const { db } = await deps.manager.data(connectionId);
    let index: TableRefIndex | null = null;
    let declared: DeclaredPeopleTable[] | null = null;
    for (const addOn of await leadsAddOnsOn(deps.meta, connectionId, view, stored)) {
      if (addOn.foundPeople === null) continue;
      const rows = await untoldRows(db, addOn.foundPeople);
      if (rows.length === 0) continue;
      // The address they were found with (where their tell mail goes), and the one their row holds now.
      for (const row of rows) if (row.email !== null) out.add(row.email);
      index ??= await tableRefIndex(deps.meta, connectionId, view.model);
      declared ??= await peopleTablesOf(deps.meta).all(connectionId, view.model);
      const byTable = new Map<string, string[]>();
      for (const row of rows) byTable.set(row.personTable, [...(byTable.get(row.personTable) ?? []), row.personKey]);
      for (const [stored, keys] of byTable) {
        const tableId = resolveTableRef(index, stored)?.tableId ?? null;
        const entry = tableId === null ? undefined : declared.find((one) => one.table === tableId);
        if (entry === undefined || entry.email === null) continue;
        const table = view.table(tableId!);
        for (const key of keys) {
          const pk = pkOfRowKey(table, key);
          const row = pk === null ? undefined : ((await fetchByPk(db, table, pk)) as Row | undefined);
          const address = row === undefined ? null : addressOfRow(entry, row);
          if (address !== null) out.add(address);
        }
      }
    }
  }
  return out;
}

/**
 * How long the set of people not told yet is kept between reads, at most: a
 * campaign of thousands, or a sender's batch, asks once, not once a message.
 * It is read again at once when it may have changed in this process (a person
 * kept, a tell mail gone or failed: `found-store.ts`); this bound covers a
 * contact's address changed meanwhile.
 */
const UNTOLD_KEEP_MS = 15_000;
const UNTOLD_HELD = new WeakMap<MetaDb, { at: number; generation: number; set: Promise<Set<string>> }>();

/** Whether an address belongs to a found person who has not been told yet (see the header). */
export async function untoldAddress(deps: Pick<LeadsPeopleDeps, 'meta' | 'manager' | 'viewFor' | 'now'>, address: string): Promise<boolean> {
  if (!looksLikeAddress(address)) return false;
  const wanted = normaliseAddress(address);
  if (KEEPING.get(deps.meta)?.has(wanted) === true) return true;
  const at = (deps.now ?? Date.now)();
  const generation = untoldGeneration(deps.meta);
  let held = UNTOLD_HELD.get(deps.meta);
  if (held === undefined || held.generation !== generation || at - held.at >= UNTOLD_KEEP_MS || at < held.at) {
    const set = (async () => ((await storedLeadsAddOns(deps.meta)).length === 0 ? new Set<string>() : untoldAddresses(deps)))();
    held = { at, generation, set };
    UNTOLD_HELD.set(deps.meta, held);
    // A read that failed is not kept: the next asks again.
    set.catch(() => {
      if (UNTOLD_HELD.get(deps.meta) === held) UNTOLD_HELD.delete(deps.meta);
    });
  }
  return (await held.set).has(wanted);
}

/** The sentence a mail held back for this reason says. */
export const UNTOLD_SENTENCE = 'Not sent: this person was found by Lead finder and has not been told yet';

/** Whether a people row is a found person (a found person's row links it), on any add-on of its database. */
export async function isFoundPerson(deps: Pick<LeadsPeopleDeps, 'meta' | 'manager' | 'viewFor'>, person: { connectionId: string; table: string; key: string }): Promise<boolean> {
  const stored = (await storedLeadsAddOns(deps.meta)).filter((one) => one.connectionId === person.connectionId);
  if (stored.length === 0) return false;
  const view = await viewOf(deps as LeadsPeopleDeps, person.connectionId);
  if (view === null) return false;
  const index = await tableRefIndex(deps.meta, person.connectionId, view.model);
  const { db } = await deps.manager.data(person.connectionId);
  for (const addOn of await leadsAddOnsOn(deps.meta, person.connectionId, view, stored)) {
    if (addOn.foundPeople === null) continue;
    if ((await foundRowsOf(db, addOn.foundPeople, namesOf(index, person.table), [person.key])).length > 0) return true;
  }
  return false;
}

// ── Keeping them ─────────────────────────────────────────────────────────────

/** Deletes one row by its key columns, as the engine. */
async function deleteByKey(db: Kysely<SourceDatabase>, table: ResolvedTable, key: Row): Promise<void> {
  let query = db.deleteFrom(table.id as never);
  for (const [column, value] of Object.entries(key)) query = query.where(sql.ref(column), '=', value as never);
  await query.execute();
}

/** Whether the address is on a declared people row of the database already. */
async function alreadyHere(db: Kysely<SourceDatabase>, view: SnapshotView, declared: readonly DeclaredPeopleTable[], address: string): Promise<boolean> {
  for (const entry of declared) {
    if (entry.email === null) continue;
    let table: ResolvedTable;
    try {
      table = view.table(entry.table);
    } catch {
      continue;
    }
    if (!table.columns.has(entry.email)) continue;
    const hit = await db.selectFrom(table.id as never).select(sql<number>`1`.as('one') as never).where(addressIs(entry.email, address)).limit(1).executeTakeFirst();
    if (hit !== undefined) return true;
  }
  return false;
}

/** The people table a person found at a company of `companyTable` is kept in: one that links to it, else the first with an address and a name. */
function peopleTableFor(view: SnapshotView, declared: readonly DeclaredPeopleTable[], companyTable: string): DeclaredPeopleTable | null {
  const candidates = declared.filter((entry) => entry.kind === 'people' && entry.email !== null && entry.name !== null);
  const linked = candidates.find(
    (entry) =>
      entry.company !== null &&
      view.model.relations.some((relation) => relation.through === null && relation.from.tableId === entry.table && relation.from.columns.length === 1 && relation.from.columns[0] === entry.company && relation.to.tableId === companyTable),
  );
  return linked ?? candidates[0] ?? null;
}

/** The value a link column takes for a row of its table: the row's own key column's value. */
function linkValue(view: SnapshotView, from: DeclaredPeopleTable, companyTable: ResolvedTable, companyRow: Row): unknown {
  const relation = view.model.relations.find((one) => one.through === null && one.from.tableId === from.table && one.from.columns.length === 1 && one.from.columns[0] === from.company && one.to.tableId === companyTable.id);
  const column = relation?.to.columns[0] ?? companyTable.primaryKey[0];
  return column === undefined ? undefined : companyRow[column];
}

/** The tell mail's outbox row, queued for a found person; answers its key, or null when it could not be. */
async function queueTell(deps: KeepFoundPeopleDeps, addOn: LeadsAddOnTables, view: SnapshotView, foundId: string, address: string, language: TellLanguage): Promise<string | null> {
  const tell = addOn.tell;
  if (tell === null) return null;
  const { db, dialect } = await deps.manager.data(addOn.connectionId);
  const cols = tell.definition.columns;
  const values: Row = { [cols.kind]: LEADS_TELL_KIND, [cols.status]: 'queued', [cols.to]: address, [tell.link]: boundId(foundId) };
  if (cols.language !== undefined) values[cols.language] = language;
  const made = await deps.writes.create({
    target: { connectionId: addOn.connectionId, view, table: tell.table, db, dialect },
    values,
    context: outboxContext(addOn.key, tell.table.id),
    announce: async () => {},
  });
  const key = tell.table.primaryKey[0];
  return key === undefined || made[key] === undefined || made[key] === null ? null : String(made[key]);
}

/**
 * Keeps the people a source found at one company (see the header): each
 * checked, then written as the staff member, their found person's row
 * written as Adminium, and their tell mail queued at once.
 */
export async function keepFoundPeople(deps: KeepFoundPeopleDeps, input: KeepFoundPeopleInput): Promise<KeptPeople> {
  const now = deps.now ?? Date.now;
  const out: KeptPeople = { kept: [], refused: [] };
  const refuseAll = (reason: KeepRefusal) => {
    for (const person of input.people) out.refused.push({ email: person.email, reason });
    return out;
  };
  const found = await leadsInstall(deps, input.installId);
  if (found === null || found.addOn.key !== input.addOnKey) throw new ValidationFailedError('The add-on that finds people is not installed here.', { reason: 'NOT_INSTALLED' });
  const { addOn, view } = found;
  const { connectionId } = addOn;
  const { db, dialect } = await deps.manager.data(connectionId);
  const settings = await readLeadsSettingsRow(await leadsSettingsRow(db, addOn));
  if (!settings.peopleOn || addOn.foundPeople === null) return finish(refuseAll('people-off'));

  // The company they were found at: a row here, read as the install.
  const index = await tableRefIndex(deps.meta, connectionId, view.model);
  const companyTableId = resolveTableRef(index, input.company.table)?.tableId ?? null;
  let companyTable: ResolvedTable | null = null;
  let companyRow: Row | null = null;
  if (companyTableId !== null) {
    companyTable = view.table(companyTableId);
    const pk = pkOfRowKey(companyTable, input.company.key);
    companyRow = pk === null ? null : (((await fetchByPk(db, companyTable, pk)) as Row | undefined) ?? null);
  }
  const declared = await peopleTablesOf(deps.meta).all(connectionId, view.model);
  const into = companyTable === null ? null : peopleTableFor(view, declared, companyTable.id);
  // The company's country: the language its people are told in, when it is one of the eight.
  const companies = companyTable === null ? undefined : declared.find((entry) => entry.table === companyTable.id && entry.kind === 'companies');
  const countryColumn = companies === undefined || companyTable === null ? null : companyCountryColumn(companies, companyTable);
  const country = countryColumn === null || companyRow === null ? null : companyRow[countryColumn];
  if (into === null && companyTable !== null) throw new ValidationFailedError('No app keeps people on this database, so nobody found here can be kept.', { reason: 'NO_PEOPLE_TABLE' });

  // The mail must be able to go now, in a language they could be told in.
  const mailProblems = (await peopleSwitchProblems(deps, addOn)).filter((problem) => problem.code !== 'purpose-missing');
  const zone = await zoneOf(deps.meta, connectionId);
  const fallback = await installLanguage(deps.meta);

  const seen = new Set<string>();
  for (const person of input.people) {
    const raw = person.email.trim();
    const address = looksLikeAddress(raw) ? normaliseAddress(raw) : null;
    const name = plainWords(person.name, NAME_MAX);
    const refuse = (reason: KeepRefusal) => out.refused.push({ email: person.email, reason });
    if (address === null || (await deps.consent.stop.has(address))) {
      refuse(address === null ? 'generic' : 'stopped');
      continue;
    }
    if (seen.has(address) || (await alreadyHere(db, view, declared, address))) {
      refuse('already-here');
      continue;
    }
    if (genericAddress(address)) {
      refuse('generic');
      continue;
    }
    if (name === '') {
      refuse('no-name');
      continue;
    }
    if (companyTable === null || companyRow === null || into === null) {
      refuse('no-company');
      continue;
    }
    const languages = tellLanguages(typeof country === 'string' ? country : null, fallback, settings.purpose);
    if (mailProblems.length > 0 || languages.length === 0) {
      refuse('not-told-yet');
      continue;
    }
    // A sole trader's company row is marked as theirs before they are: nothing of them is ever kept unlinked.
    if (input.soleTrader === true && addOn.fieldSources === null) {
      refuse('no-company');
      continue;
    }
    seen.add(address);
    keepingNow(deps.meta, address, 1);
    const peopleTable = view.table(into.table);
    const company = { table: storedTableRef(index, companyTable.id), key: rowKeyOf(companyTable, companyRow) };
    const foundPlace = { target: { connectionId, view, table: addOn.foundPeople, db, dialect }, writes: deps.writes, context: leadsWriteContext(addOn.name) };
    let made: Row | null = null;
    let foundId: string | null = null;
    let marked = false;
    try {
      const foundAt = now();
      if (input.soleTrader === true) {
        await markSoleTrader({ ...foundPlace, target: { ...foundPlace.target, table: addOn.fieldSources! } }, company, address, input.source, foundAt);
        marked = true;
      }
      // Their row in the people table, as the staff member writes it: "may be e-mailed" left unset.
      const values: Record<string, unknown> = { [into.email!]: address, [into.name!]: name };
      if (into.company !== null) values[into.company] = linkValue(view, into, companyTable, companyRow);
      made = await createAsPerson(deps.app, input.staff.request, connectionId, into.table, values, { code: 'PERSON_REFUSED', message: 'The person was refused.' });
      const personKey = rowKeyOf(peopleTable, made);
      const personTable = storedTableRef(index, into.table);
      const purpose = settings.purpose[languages[0]!] ?? '';
      foundId = await insertFound(foundPlace, {
        personTable,
        personKey,
        companyTable: company.table,
        companyKey: company.key,
        source: input.source,
        foundAt,
        purpose,
        tellBy: tellByOf(foundAt, zone),
        pages: person.sources,
        email: address,
      });
      untoldChanged(deps.meta);
      const outboxId = await queueTell(deps, addOn, view, foundId, address, languages[0]!);
      if (outboxId !== null) await updateFound({ db, dialect, table: addOn.foundPeople }, foundId, { outbox_id: outboxId });
      out.kept.push({ email: address, personTable, personKey });
    } catch (error) {
      // Kept whole or not at all: their found person's row, their contact (as the engine: nobody's rights
      // decide whether a row Adminium half-made goes) and a sole trader's mark go again, so nobody stays
      // stored who is never told, never swept and in no found person's row.
      if (foundId !== null) {
        // Its tell mail first: the mail names the row.
        if (addOn.tell !== null) await deleteByKey(db, addOn.tell.table, { [addOn.tell.link]: boundId(foundId) }).catch(() => undefined);
        await deleteByKey(db, addOn.foundPeople, { [addOn.foundPeople.primaryKey[0]!]: boundId(foundId) }).catch(() => undefined);
        untoldChanged(deps.meta);
      }
      if (made !== null) await deleteByKey(db, peopleTable, Object.fromEntries(peopleTable.primaryKey.map((column) => [column, made![column]]))).catch(() => undefined);
      if (marked) await unmarkSoleTrader(db, addOn.fieldSources!, company).catch(() => undefined);
      throw error;
    } finally {
      keepingNow(deps.meta, address, -1);
    }
  }
  return finish(out);

  async function finish(result: KeptPeople): Promise<KeptPeople> {
    if (result.kept.length > 0) deps.onQueued?.(input.addOnKey);
    const reasons: Record<string, number> = {};
    for (const one of result.refused) reasons[one.reason] = (reasons[one.reason] ?? 0) + 1;
    await auditRepo(deps.meta).append(
      {
        actorKind: 'user',
        actorId: input.staff.id,
        actorLabel: input.staff.label,
        category: 'leads',
        action: 'leads.people.kept',
        connectionId: found?.addOn.connectionId ?? null,
        changes: { after: { addOn: input.addOnKey, source: input.source, company: { table: input.company.table, key: input.company.key }, kept: result.kept.length, refused: reasons } },
        ip: input.staff.request.ip ?? null,
      },
      now(),
    );
    return result;
  }
}
