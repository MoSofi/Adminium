// SPDX-License-Identifier: AGPL-3.0-only
/**
 * ERASING A PERSON, IN PLACE: "Erase everything about this person" on the
 * privacy page, by their e-mail address.
 *
 * Their rows are kept and emptied, so every link to them stays whole (a deal
 * still opens, a sent quote still reads as sent); what is only about them
 * goes; what the law keeps stays and is listed. Step by step:
 *
 *  1. their address stays on the do-not-email list as a keyed hash alone
 *     (added when it was not there), so they are never mailed again: first,
 *     so even an erasure cut short leaves them stopped;
 *  2. their customer sessions end and open sign-in links to the address are
 *     taken back (the public door's address watch, told the address is gone);
 *  3. their consent rows are deleted, by their rows and by the address under
 *     every key version (no log row is written for the consent column the
 *     erasure empties: it is the log that goes);
 *  4. their campaign sends lose the address and the name, campaign runs'
 *     failure lists their entries, and a send's reason or a job's last error
 *     that holds the address is emptied; their downloads
 *     ("Download everything"), the files on their own rows and the files a
 *     copy column of theirs names (a design version's file) are deleted,
 *     with those the bin still keeps of them (a proof made again: the one
 *     it replaced), as the search lists them;
 *  5. the audit log's and the removed-row history's images of their rows
 *     lose the fields the erasure empties, and any text that still holds the
 *     address is nulled (the entries stay: who changed what, and when);
 *  6. their rows in the apps' databases are emptied (`erase-rows.ts`), in
 *     one transaction per database; their form answers are deleted (with
 *     their files) and the survey invitations sent to them lose the address
 *     and the name (`form-answers.ts`); their website chats are deleted with
 *     their messages and the answerer's choices (`chat-transcripts.ts`),
 *     found by the address and by the rows of theirs a chat became; a person
 *     a source found loses their found person's rows, their tell mails and
 *     their fields' sources (`found-people.ts`), and only the days they were
 *     told on are kept, in the audit entry below; an entry written about one of those
 *     rows while the erasure ran is emptied too;
 *  7. one audit entry of its own says what was done: counts, the keyed
 *     hash of the address, and the days a found person was told on. Never
 *     the address, never the name.
 *
 * Done in that order so that one cut short can be run again: until step 6
 * their rows still hold the address, and the next run finds them and does
 * every step again (each changes nothing the second time).
 *
 * An erasure narrowed to some apps (`scope.ts`: a shop owner's
 * `privacy.people`) empties only those apps' rows and copies, the consent
 * rows and Adminium's own rows about them, and the downloads its caller made;
 * it leaves the do-not-email list, a forms add-on's answers and every store
 * matched by the address alone (mail errors among them) to whoever manages
 * privacy for the whole workspace. The audit log's and the removed-row
 * history's text that holds the address is still swept: it is the
 * customer's (a staff account's address never comes this far).
 *
 * ─── A person known only by phone ──────────────────────────────────────────
 * {@link erasePhonePerson} runs these same steps from one exact number. Their
 * row is one on a people table that holds the number and names no address. A
 * row that names an address may be someone else's on a shared line, so only
 * the number leaves it. The stores found by address alone are not touched.
 * Either way in, the number's text records go too (`sms/erasure.ts`): its stop
 * entry stays as a hash alone, and its consent log, inbound events, delivery
 * records and any job error quoting it are removed.
 *
 * "What stays" (`what-stays.ts`) is what the erasure leaves on purpose: rows
 * of a table the law keeps (an invoice), the documents and payments Adminium
 * keeps, the stores kept for a set time, and the do-not-email entry.
 */
import { privacyExportsRepo, filesRepo, type MetaDb } from '@adminium/meta';

import type { ConsentService } from '../consent/index.js';
import type { ConnectionManager } from '../connections/manager.js';
import type { RecordWriteEvent } from '../crud/after-record-write.js';
import { pkLabel } from '../crud/records.js';
import { ValidationFailedError } from '../errors.js';
import type { FileStore } from '../files/store.js';
import { textSubject } from '../sms/consent/service.js';
import type { TextErased, TextErasure } from '../sms/erasure.js';
import { blankCampaignSends, campaignSendIds, copyFileIds, purgeRowFiles, rowFileIds, scrubAuditImages, scrubRemovedRows, sweepAddress, sweepMailAddress, type CopyLink, type CopyRowFiles, type ImageTarget, type PersonRowRef } from './erase-meta.js';
import { blankRow, findPersonRows, pkOf, writePersonRows, type ErasedSource, type LeftColumn, type PersonRows, type PhoneTarget } from './erase-rows.js';
import { phoneColumnsOf } from './copy-rows.js';
import { eraseFormRows, findFormRows, formImageTargets } from './form-answers.js';
import { blankReviews } from '../reviews/erase.js';
import { findReviewsOf } from './reviews.js';
import type { AddOnInstalls } from '../apps/table-ref.js';
import { eraseChatRows, findChatRows, type TheirRow } from './chat-transcripts.js';
import { eraseFoundPeopleRows, findFoundPeopleRows, type FoundPersonRows } from './found-people.js';
import { loadSnapshotView } from '../data-io/snapshot-view.js';
import { erasePageVisits, findPageVisits } from './page-visits.js';
import type { ChatForget } from '../chat/transcripts.js';
import type { AnswerFilesRemover } from '../forms/answers.js';
import { personHash, personHashes } from './export.js';
import type { AppScope } from './scope.js';
import { erasedNameOf, findPerson, searchAddress, type PersonFound } from './sources.js';
import { bookingsOfRows, eraseLabelsOfRows, type LabelPersonRow } from '../shipping/labels.js';
import { countHeldByAddress, forgetHeldByAddress } from './held-values.js';
import { whatStays, type StaysItem } from './what-stays.js';

export interface EraseDeps {
  meta: MetaDb;
  manager: Pick<ConnectionManager, 'data'>;
  consent: ConsentService;
  storage: FileStore;
  secret: string;
  /** The strangers' file store's remover: their form answers' files leave the store with the answers. */
  answerFiles?: AnswerFilesRemover | undefined;
  /** Makes the chat store forget an erased conversation, so a visitor's poll on it is told it is lost. */
  chatForget?: ChatForget | undefined;
  /**
   * Told of each of their rows as if it were gone: the public door's address
   * watch ends the sessions it opened and takes back open sign-in links to
   * its address, and sends nothing (`public-api/identity-email-watch.ts`).
   */
  signIns?: ((event: RecordWriteEvent) => Promise<void>) | undefined;
  /** What is installed: a reviews add-on's reviews of theirs keep their stars and words and lose their name (`reviews/erase.ts`). */
  reviewInstalls?: (() => Promise<AddOnInstalls>) | undefined;
  /** The calendar sync: their events in staff calendars lose their name, and a connected account at this address ends. */
  calendars?: { onErased(input: { address: string; rows: readonly { connectionId: string; table: string; key: string }[] }): Promise<{ events: number; accounts: number }> } | undefined;
  /** What an erasure does to a phone number (`sms/erasure.ts`). */
  texts?: TextErasure | undefined;
  now?: (() => number) | undefined;
}

/** Whom an erasure narrowed to some apps is for: those apps, and who asks (their own downloads go). */
export interface EraseScope {
  apps: AppScope;
  by: string;
  /**
   * The keeping sweep's erasure of one found person (`leads/sweep.ts`): only
   * these people rows of theirs (their contact, while it still holds the
   * address), and these found people's own rows (`findFoundPersonRows`).
   * Nothing else kept at the address: what they gave the business since is
   * kept for its own purpose. Their address goes on the do-not-email list.
   */
  only?: { rows: readonly TheirRow[]; found: readonly FoundPersonRows[] } | undefined;
}

/** The rows of `found` that are these people rows of theirs, and nothing else (no copy, no mail). */
function onlyTheseRows(found: PersonRows, rows: readonly TheirRow[]): PersonRows {
  const wanted = new Set(rows.map((row) => `${row.connectionId}\u0000${row.table}\u0000${row.key}`));
  const databases = found.databases
    .map((database) => ({
      ...database,
      sources: database.sources
        .filter((source) => source.kind === 'people')
        .map((source) => ({ ...source, rows: source.rows.filter((row) => wanted.has(`${source.connectionId}\u0000${source.table.id}\u0000${row.key}`)) }))
        .filter((source) => source.rows.length > 0),
    }))
    .filter((database) => database.sources.length > 0);
  const tables = new Set(databases.flatMap((database) => database.sources.map((source) => `${source.connectionId}\u0000${source.table.id}`)));
  return { address: found.address, databases, left: found.left.filter((one) => tables.has(`${one.connectionId}\u0000${one.table}`)) };
}

/**
 * A sole trader's company rows (`found-people.ts`), emptied in place with their rows: each a source of the erasure's
 * own, so its audit images are scrubbed and it is written in its database's one transaction.
 */
async function withSoleTraders(deps: EraseDeps, rows: PersonRows, found: readonly FoundPersonRows[], erasedName: string): Promise<PersonRows> {
  const out: PersonRows = { ...rows, databases: [...rows.databases], left: [...rows.left] };
  for (const one of found) {
    if (one.companies.length === 0) continue;
    let database = out.databases.find((held) => held.connectionId === one.connectionId);
    if (database === undefined) {
      database = { connectionId: one.connectionId, db: one.db, dialect: one.dialect, view: await loadSnapshotView(deps.meta, one.connectionId, { forOthers: true }), sources: [] };
      out.databases.push(database);
    } else {
      database = { ...database, sources: [...database.sources] };
      out.databases[out.databases.findIndex((held) => held.connectionId === one.connectionId)] = database;
    }
    const left = new Map<string, number>();
    for (const company of one.companies) {
      const blank = blankRow(company.table, company.row, company.columns, one.dialect, erasedName, left);
      database.sources.push({
        id: `found-people-company-${one.addOn.key}`,
        kind: 'copy',
        connectionId: one.connectionId,
        table: company.table,
        app: one.addOn.key,
        ref: 'sole-trader',
        label: company.table.table.label ?? company.table.name,
        copies: [],
        rows: [{ key: company.key, pk: pkOf(company.table, company.row), before: company.row, ...blank }],
      });
      for (const [column, count] of left) out.left.push({ connectionId: one.connectionId, table: company.table.id, column, rows: count });
      left.clear();
    }
  }
  return out;
}

/** What goes, as the erase dialog counts it. */
export type GoesKind = 'people' | 'copy' | 'outbox' | 'consent' | 'campaign-mail' | 'files' | 'shipping-labels' | 'form-answers' | 'form-invitations' | 'form-files' | 'chat-conversations' | 'page-visits' | 'found-people' | 'reviews' | 'text-records';

export interface GoesItem {
  kind: GoesKind;
  count: number;
  /** An app table's: its database, table, app and label. */
  connectionId?: string;
  table?: string;
  app?: string;
  label?: string;
}

export interface ErasePreview {
  address: string;
  found: boolean;
  goes: GoesItem[];
  stays: StaysItem[];
  /** Columns of theirs that cannot be emptied (not null, and neither text nor yes/no): left as they are. */
  left: LeftColumn[];
}

export interface EraseResult {
  /** Rows (or entries) changed, by source: `people-crm-contacts`, `copy-…`, `outbox-crm`, `consent`, `campaign-mail`, `campaign-failures`, `mail-errors`, `files`, `downloads`, `audit`, `removed-rows`. */
  counts: Record<string, number>;
  left: LeftColumn[];
  /** Files that could not be deleted (their bytes are still stored). */
  filesFailed: number;
  /** The keyed hash the erasure's own audit entry keeps. */
  address: { hash: string; version: number };
  /**
   * The days a person a source found was told on (`YYYY-MM-DD`), one per
   * found person erased who was told: all the erasure keeps of them, in its
   * own audit entry beside the hash ("told on {date}").
   */
  told: string[];
}

/** Their copies' rows, with the columns of each that are theirs: what their files are read from (`copyFileIds`). */
function copyRows(rows: PersonRows): CopyRowFiles[] {
  return rows.databases.flatMap((database) =>
    database.sources.filter((source) => source.kind === 'copy').flatMap((source) => source.rows.map((row) => ({ connectionId: source.connectionId, table: source.table, key: row.key, row: row.before, columns: new Set(row.columns) }))),
  );
}

/** Their own rows, as Adminium's stores find a row (by the table's id or its name). */
function peopleRefs(rows: PersonRows): PersonRowRef[] {
  return rows.databases.flatMap((database) =>
    database.sources.filter((source) => source.kind === 'people').flatMap((source) => source.rows.map((row) => ({ connectionId: source.connectionId, table: source.table.id, tableName: source.table.name, key: row.key }))),
  );
}

const imageTarget = (source: ErasedSource): ImageTarget => ({
  connectionId: source.connectionId,
  table: source.table.id,
  keys: source.rows.map((row) => row.key),
  columns: new Map(source.rows.map((row) => [row.key, row.columns])),
  own: source.kind === 'people',
});

/** Each declared copy kept through a link to one of their rows: a removed copy of it is theirs too. */
function copyLinks(rows: PersonRows): CopyLink[] {
  const out: CopyLink[] = [];
  for (const database of rows.databases) {
    for (const source of database.sources) {
      if (source.kind !== 'people' || source.entry === undefined) continue;
      const parentKeys = source.rows.map((row) => row.key);
      const byLink = new Map<string, { table: string; via: string; columns: string[] }>();
      for (const copy of source.entry.copies) {
        if (copy.via === null) continue;
        const id = `${copy.table}\u0000${copy.via}`;
        const held = byLink.get(id) ?? { table: copy.table, via: copy.via, columns: [] };
        held.columns.push(copy.column);
        byLink.set(id, held);
      }
      for (const link of byLink.values()) out.push({ connectionId: source.connectionId, copyTable: link.table, via: link.via, columns: link.columns, parentTable: source.table.id, parentKeys });
    }
  }
  return out;
}

/** Their own rows and their copies: what a chat that became one of them is found by. */
/** Every row the search found of theirs, those of a table the law keeps too. */
function rowsInSources(found: PersonFound): LabelPersonRow[] {
  const own = found.sources
    .filter((source) => (source.kind === 'people' || source.kind === 'copy') && source.connectionId !== null && source.table !== null)
    .flatMap((source) => source.keys.map((key) => ({ connectionId: source.connectionId!, table: source.table!, key })));
  const linked = found.lawLinked.flatMap((one) => one.keys.map((key) => ({ connectionId: one.connectionId, table: one.table, key })));
  return [...own, ...linked, ...found.parcelRows.map(({ connectionId, table, key }) => ({ connectionId, table, key }))];
}
function theirRows(rows: PersonRows): TheirRow[] {
  return rows.databases.flatMap((database) =>
    database.sources.filter((source) => (source.kind === 'people' || source.kind === 'copy') && source.numberOnly !== true).flatMap((source) => source.rows.map((row) => ({ connectionId: source.connectionId, table: source.table.id, key: row.key }))),
  );
}

/** The numbers on their own rows, each with the row it is on. A row with no number is listed too: its log rows are still theirs. */
function textTargets(rows: PersonRows): { phone: unknown; person: { connectionId: string; table: string; key: string } }[] {
  const out: { phone: unknown; person: { connectionId: string; table: string; key: string } }[] = [];
  for (const database of rows.databases) {
    for (const source of database.sources) {
      if (source.kind !== 'people') continue;
      const columns = phoneColumnsOf(source.table);
      for (const row of source.rows) {
        const person = { connectionId: source.connectionId, table: source.table.id, key: row.key };
        const held = columns.map((column) => row.before[column]).filter((value) => value !== null && value !== undefined && String(value).trim() !== '');
        if (held.length === 0) out.push({ phone: null, person });
        for (const phone of held) out.push({ phone, person });
      }
    }
  }
  return out;
}

const addErased = (total: TextErased, more: TextErased): void => {
  total.stopEntry += more.stopEntry;
  total.consentRows += more.consentRows;
  total.inboundEvents += more.inboundEvents;
  total.deliveries += more.deliveries;
  total.marketing += more.marketing;
};

/** What the erasure takes of their text records: by each number on their rows, and by the number they were found with. */
async function countTexts(texts: TextErasure, rows: PersonRows, phone: PhoneTarget | undefined, whole: boolean): Promise<TextErased> {
  const total: TextErased = { stopEntry: 0, consentRows: 0, inboundEvents: 0, deliveries: 0, marketing: 0 };
  const country = phone?.country ?? (await texts.country());
  const seen = new Set<string>();
  if (phone !== undefined) {
    seen.add(phone.e164);
    addErased(total, await texts.count({ phone: phone.e164, country, person: null, everywhere: whole }));
  }
  for (const target of textTargets(rows)) {
    const e164 = texts.exact(target.phone, country);
    const repeat = e164 !== null && seen.has(e164);
    if (e164 !== null) seen.add(e164);
    addErased(total, await texts.count({ phone: repeat ? null : target.phone, country, person: target.person, everywhere: whole && !repeat }));
  }
  return total;
}

/** Their text records gone, and the numbers that were read, for the job errors. */
async function eraseTexts(texts: TextErasure, rows: PersonRows, phone: PhoneTarget | undefined, whole: boolean, at: number): Promise<{ erased: TextErased; numbers: string[]; country: string | null }> {
  const total: TextErased = { stopEntry: 0, consentRows: 0, inboundEvents: 0, deliveries: 0, marketing: 0 };
  const country = phone?.country ?? (await texts.country());
  const numbers = new Set<string>();
  if (phone !== undefined) {
    numbers.add(phone.e164);
    addErased(total, await texts.erase({ phone: phone.e164, country, person: null, at, everywhere: whole }));
  }
  for (const target of textTargets(rows)) {
    const e164 = texts.exact(target.phone, country);
    const repeat = e164 !== null && numbers.has(e164);
    if (e164 !== null) numbers.add(e164);
    addErased(total, await texts.erase({ phone: repeat ? null : target.phone, country, person: target.person, at, everywhere: whole && !repeat }));
  }
  return { erased: total, numbers: [...numbers], country };
}

/** One exact number from what was typed, read in the server's country. */
async function phoneTargetOf(deps: EraseDeps, raw: string): Promise<PhoneTarget> {
  if (deps.texts === undefined) throw new ValidationFailedError('Erasing by phone is not available here.', { field: 'phone' });
  const country = await deps.texts.country();
  const e164 = deps.texts.exact(raw, country);
  if (e164 === null) throw new ValidationFailedError('That is not a phone number that can be read. Write it with its country code.', { field: 'phone' });
  return { e164, country };
}

/** Their consent rows: by the address, and by each of their rows. */
async function consentIds(consent: ConsentService, address: string, people: readonly PersonRowRef[], byAddress: boolean): Promise<number> {
  const ids = new Set<string>();
  if (byAddress) for (const one of await consent.history({ address }, { limit: 500 })) ids.add(one.id);
  for (const row of people) for (const one of await consent.history({ person: { connectionId: row.connectionId, table: row.table, key: row.key } }, { limit: 500 })) ids.add(one.id);
  return ids.size;
}

/** What an erasure of this address would do, and what it would leave (nothing is written). */
export async function previewErasure(deps: EraseDeps, rawAddress: string, scope?: EraseScope): Promise<ErasePreview> {
  return previewTarget(deps, searchAddress(rawAddress), undefined, scope);
}

/** {@link previewErasure} for a person known only by phone. `address` in the answer is the number, masked by the route. */
export async function previewPhoneErasure(deps: EraseDeps, rawPhone: string, scope?: EraseScope): Promise<ErasePreview> {
  return previewTarget(deps, '', await phoneTargetOf(deps, rawPhone), scope);
}

async function previewTarget(deps: EraseDeps, address: string, phone: PhoneTarget | undefined, scope?: EraseScope): Promise<ErasePreview> {
  const now = deps.now ?? Date.now;
  const apps = scope?.apps ?? null;
  const whole = apps === null;
  // The stores found by the address alone: never asked about an empty one.
  const byAddress = whole && address !== '';
  const rows = await findPersonRows({ meta: deps.meta, manager: deps.manager, erasedName: await erasedNameOf(deps.meta), now }, address, apps, phone);
  const people = peopleRefs(rows);
  const goes: GoesItem[] = [];
  for (const database of rows.databases) {
    for (const source of database.sources) {
      if (source.rows.length === 0) continue;
      goes.push({ kind: source.kind, count: source.rows.length, connectionId: source.connectionId, table: source.table.id, app: source.app, label: source.label });
    }
  }
  for (const one of byAddress ? await findFormRows(deps, address) : []) {
    if (one.answers.length > 0 && one.addOn.answers !== null) goes.push({ kind: 'form-answers', count: one.answers.length, connectionId: one.connectionId, table: one.addOn.answers.id, app: one.addOn.key, label: one.addOn.answers.table.label ?? one.addOn.answers.name });
    if (one.files.length > 0 && one.addOn.files !== null) goes.push({ kind: 'form-files', count: one.files.length, connectionId: one.connectionId, table: one.addOn.files.id, app: one.addOn.key, label: one.addOn.files.table.label ?? one.addOn.files.name });
    if (one.invitations.length > 0 && one.addOn.invitations !== null) {
      goes.push({ kind: 'form-invitations', count: one.invitations.length, connectionId: one.connectionId, table: one.addOn.invitations.id, app: one.addOn.key, label: one.addOn.invitations.table.label ?? one.addOn.invitations.name });
    }
  }
  for (const one of whole ? await findChatRows(deps, address, theirRows(rows)) : []) {
    const table = one.addOn.conversations;
    if (table !== null && one.conversations.length > 0) goes.push({ kind: 'chat-conversations', count: one.conversations.length, connectionId: one.connectionId, table: table.id, app: one.addOn.key, label: table.table.label ?? table.name });
  }
  // A narrowed erasure reaches the found people its rows' links reach, never one found by the address alone.
  for (const one of await findFoundPeopleRows(deps, byAddress ? address : '', theirRows(rows))) {
    const table = one.addOn.foundPeople;
    if (table !== null && one.found.length > 0) goes.push({ kind: 'found-people', count: one.found.length, connectionId: one.connectionId, table: table.id, app: one.addOn.key, label: table.table.label ?? table.name });
  }
  // Their reviews: kept, without their name or whose they are.
  for (const { found } of await findReviewsOf(deps, people, apps)) {
    goes.push({ kind: 'reviews', count: found.keys.length, connectionId: found.connectionId, table: found.table.id, app: found.addOn, label: found.table.table.label ?? found.table.name });
  }
  const texts = deps.texts === undefined ? null : await countTexts(deps.texts, rows, phone, whole);
  const consent = (await consentIds(deps.consent, address, people, byAddress)) + (texts?.consentRows ?? 0);
  if (consent > 0) goes.push({ kind: 'consent', count: consent });
  const textRecords = (texts?.inboundEvents ?? 0) + (texts?.deliveries ?? 0) + (texts?.marketing ?? 0);
  if (textRecords > 0) goes.push({ kind: 'text-records', count: textRecords });
  const visits = byAddress ? (await findPageVisits(deps.meta, deps.secret, address, 0)).count : 0;
  if (visits > 0) goes.push({ kind: 'page-visits', count: visits });
  const sends = (await campaignSendIds(deps.meta, address, people, byAddress)).length;
  if (sends > 0) goes.push({ kind: 'campaign-mail', count: sends });
  // Every row of theirs, a kept one too: an order the law keeps stays, and its label is not that record.
  const labelFiles = new Set((await bookingsOfRows(deps.meta, [...theirRows(rows), ...(address === '' ? [] : rowsInSources(await findPerson(deps, address, apps, { rowsOnly: true })))])).flatMap((one) => [one.labelRef, one.customsRef].filter((id): id is string => id !== null)));
  if (labelFiles.size > 0) goes.push({ kind: 'shipping-labels', count: labelFiles.size });
  const files = new Set([...(await rowFileIds(deps.meta, people)), ...(await copyFileIds(deps.meta, copyRows(rows)))].filter((id) => !labelFiles.has(id))).size;
  if (files > 0) goes.push({ kind: 'files', count: files });
  // By phone there is no address to search the stores with: what stays is the law's tables that hold the number.
  const stays: StaysItem[] =
    address === ''
      ? (rows.keptByPhone ?? []).map((one) => ({ kind: 'app-rows', reason: one.reason, count: one.count, keptDays: null, forever: true, connectionId: one.connectionId, table: one.table, app: one.app, label: one.label }))
      : await whatStays(deps.meta, await findPerson(deps, address, apps));
  // What they still hold with a balance keeps them until the balance ends (`held-values.ts`).
  if (byAddress) for (const one of await countHeldByAddress({ meta: deps.meta, manager: deps.manager, now }, address)) stays.push({ kind: 'held-values', reason: 'live-balance', count: one.count, keptDays: null, forever: false, connectionId: one.connectionId, table: one.table, label: one.label });
  const found = goes.length > 0 || stays.some((item) => item.count !== null && item.count > 0) || (texts?.stopEntry ?? 0) > 0 || (byAddress && (await deps.consent.stop.entryFor(address)) !== null);
  return { address, found, goes, stays, left: rows.left };
}

/** Erases the person with this address (see the header). */
export async function erasePerson(deps: EraseDeps, rawAddress: string, scope?: EraseScope): Promise<EraseResult> {
  return eraseTarget(deps, searchAddress(rawAddress), undefined, scope);
}

/** Erases the person known by this phone number (see the header). */
export async function erasePhonePerson(deps: EraseDeps, rawPhone: string, scope?: EraseScope): Promise<EraseResult> {
  return eraseTarget(deps, '', await phoneTargetOf(deps, rawPhone), scope);
}

async function eraseTarget(deps: EraseDeps, address: string, phone: PhoneTarget | undefined, scope?: EraseScope): Promise<EraseResult> {
  const { meta, consent } = deps;
  const now = deps.now ?? Date.now;
  const apps = scope?.apps ?? null;
  const only = scope?.only;
  const workspace = apps === null && only === undefined;
  // The stores found by the address alone: never asked about an empty one.
  const whole = workspace && address !== '';
  const started = now();
  // The keys first: while they cannot be read, nothing is touched (the caller answers 503).
  const subject = phone === undefined ? address : textSubject(phone.e164);
  const hash = await personHash(meta, deps.secret, subject);
  const hashes = await personHashes(meta, deps.secret, subject);
  const erasedName = await erasedNameOf(meta);
  const all = await findPersonRows({ meta, manager: deps.manager, erasedName, now }, address, apps, phone);
  const narrowed = only === undefined ? all : onlyTheseRows(all, only.rows);
  const forms = whole ? await findFormRows(deps, address) : [];
  // Found before their rows are emptied: a chat that became one of them is found by the row's key, which stays.
  const chats = workspace ? await findChatRows(deps, address, theirRows(narrowed)) : [];
  // …and so is a found person's row, which names their row by its key (a narrowed erasure: only by their rows).
  const foundPeople = only !== undefined ? only.found : await findFoundPeopleRows(deps, whole ? address : '', theirRows(narrowed));
  // A sole trader's company row is theirs: emptied with them.
  const rows = await withSoleTraders(deps, narrowed, foundPeople, erasedName);
  const people = peopleRefs(rows);
  // Found while their rows still hold their address. A narrowed erasure takes only the rows it was given.
  const labelRows = [...theirRows(rows), ...(only === undefined && address !== '' ? rowsInSources(await findPerson(deps, address, apps, { rowsOnly: true })) : [])];
  const counts: Record<string, number> = {};

  // 1. Still stopped, by the hash alone. The do-not-email list is the workspace's: an erasure for some apps leaves it.
  //    The keeping sweep's stops the found person: a source that finds them again is refused.
  if (whole || (only !== undefined && address !== '')) {
    await consent.eraseDisplay(address, { addIfMissing: true, at: started });
    counts['stop-list'] = 1;
  }

  // The number's stop entry too, first for the same reason. The keeping sweep's found person was never texted.
  let quoted: { numbers: string[]; country: string | null } | null = null;
  if (deps.texts !== undefined && only === undefined) {
    const { erased, numbers, country } = await eraseTexts(deps.texts, rows, phone, workspace, started);
    if (erased.stopEntry > 0) counts['text-stop-list'] = erased.stopEntry;
    if (erased.consentRows > 0) counts['text-consent'] = erased.consentRows;
    if (erased.inboundEvents > 0) counts['inbound-events'] = erased.inboundEvents;
    if (erased.deliveries > 0) counts['text-deliveries'] = erased.deliveries;
    if (erased.marketing > 0) counts['text-marketing'] = erased.marketing;
    if (workspace) quoted = { numbers, country };
  }

  // 2. Their sessions and open sign-in links.
  if (deps.signIns !== undefined) {
    for (const database of rows.databases) {
      for (const source of database.sources) {
        if (source.kind !== 'people') continue;
        for (const row of source.rows) {
          await deps.signIns({
            connectionId: source.connectionId,
            table: source.table,
            action: 'delete',
            entity: { connectionId: source.connectionId, table: source.table.id, pk: row.pk, label: pkLabel(source.table, row.pk) },
            before: row.before,
            after: null,
            origin: 'dashboard',
          });
        }
      }
    }
  }

  // 3. Their consent rows.
  let deleted = whole ? await consent.deleteForPerson({ address }) : 0;
  for (const row of people) deleted += await consent.deleteForPerson({ person: { connectionId: row.connectionId, table: row.table, key: row.key } });
  counts['consent'] = deleted;

  // 4. Campaign sends, downloads, files on their rows.
  counts['campaign-mail'] = await blankCampaignSends(meta, await campaignSendIds(meta, address, people, whole), now());
  if (whole) {
    const mail = await sweepMailAddress(meta, address, now());
    counts['campaign-failures'] = mail.runs;
    counts['mail-errors'] = mail.sends + mail.jobs;
  }
  if (quoted !== null && deps.texts !== undefined) {
    const cleared = await deps.texts.clearQuotedErrors(quoted.numbers, quoted.country);
    if (cleared > 0) counts['text-errors'] = cleared;
  }
  const downloads = await privacyExportsRepo(meta).deleteAboutPerson(hashes, whole || scope === undefined ? {} : { requestedBy: scope.by });
  let filesFailed = 0;
  for (const fileId of downloads.fileIds) {
    const file = await filesRepo(meta).findById(fileId);
    if (file === null) continue;
    try {
      await deps.storage.remove(file);
      await filesRepo(meta).purge(file.id);
    } catch {
      filesFailed += 1;
    }
  }
  counts['downloads'] = downloads.deleted;
  const labels = await eraseLabelsOfRows({ meta, storage: deps.storage }, labelRows, now());
  if (labels.deleted > 0) counts['shipping-labels'] = labels.deleted;
  filesFailed += labels.failed;
  const files = await purgeRowFiles(meta, deps.storage, [...new Set([...(await rowFileIds(meta, people)), ...(await copyFileIds(meta, copyRows(rows)))])]);
  counts['files'] = files.purged;
  filesFailed += files.failed;

  // Their reviews, found while their rows still name them: blanked with their rows, and scrubbed from the log with them.
  const reviewed = await findReviewsOf(deps, people, apps);

  // 5. The audit log and the removed-row history.
  const targets = [
    ...rows.databases.flatMap((database) => database.sources.map(imageTarget)),
    ...formImageTargets(forms),
    // A review's name and whose it is, in what the log kept of it.
    ...reviewed.map(({ found }): ImageTarget => ({ connectionId: found.connectionId, table: found.table.id, keys: found.keys, columns: new Map(found.keys.map((key) => [key, ['shown_name', 'person_table', 'person_key']])), own: false })),
  ];
  const removed = await scrubRemovedRows(meta, targets, copyLinks(rows));
  let audit = await scrubAuditImages(meta, [...targets, ...removed.copies]);
  // With no address there is nothing to look for, and the search would read the whole log.
  const swept = address === '' ? { audit: 0, removedRows: 0, rows: [] } : await sweepAddress(meta, address);
  counts['removed-rows'] = removed.changed + swept.removedRows;
  // An order already deleted is in no search, and its label is still in the bin until its 90 days are up.
  const removedLabels = await eraseLabelsOfRows(
    { meta, storage: deps.storage },
    [...removed.copies.flatMap((one) => one.keys.map((key) => ({ connectionId: one.connectionId, table: one.table, key }))), ...(whole ? swept.rows : [])],
    now(),
  );
  if (removedLabels.deleted > 0) counts['shipping-labels'] = (counts['shipping-labels'] ?? 0) + removedLabels.deleted;
  filesFailed += removedLabels.failed;

  // 6. Their rows.
  Object.assign(counts, await writePersonRows(rows));
  // What they hold on an add-on's table: emptied where its value has ended, kept and marked where it has not.
  if (whole) {
    const held = await forgetHeldByAddress({ meta, manager: deps.manager, now }, address);
    if (held.emptied > 0) counts['held-emptied'] = held.emptied;
    if (held.kept > 0) counts['held-kept'] = held.kept;
  }
  Object.assign(counts, await eraseFormRows(forms, erasedName, deps.answerFiles));
  let blanked = 0;
  for (const { db, found } of reviewed) blanked += await blankReviews(db, found);
  if (blanked > 0) counts['reviews'] = blanked;
  Object.assign(counts, await eraseChatRows(chats, deps.chatForget));
  // The people a source found: gone, but for the days they were told on.
  const found = await eraseFoundPeopleRows(foundPeople);
  Object.assign(counts, found.counts);
  // "Pages they saw": the visitors joined to their address, with their visits.
  if (whole) {
    const gone = await erasePageVisits(meta, deps.secret, address);
    if (gone.visits > 0 || gone.visitors > 0) Object.assign(counts, { 'page-visits': gone.visits, visitors: gone.visitors });
  }
  // Written without an announcement, so the sync is told: what their rows put in staff calendars is written again, nameless.
  if (deps.calendars !== undefined) {
    const told = await deps.calendars
      .onErased({
        address: whole ? address : '',
        rows: rows.databases.flatMap((database) => database.sources.flatMap((source) => source.rows.map((row) => ({ connectionId: source.connectionId, table: source.table.id, key: row.key })))),
      })
      .catch(() => ({ events: 0, accounts: 0 }));
    if (told.events > 0) counts['calendar-events'] = told.events;
    if (told.accounts > 0) counts['calendar-accounts'] = told.accounts;
  }
  // An entry written about one of their rows while this ran.
  audit += await scrubAuditImages(meta, targets, started);
  counts['audit'] = audit + swept.audit;

  return { counts, left: rows.left, filesFailed, address: { hash: hash.hash, version: hash.version }, told: found.told };
}
