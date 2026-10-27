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
 *  4. their campaign sends lose the address and the name; their downloads
 *     ("Download everything") and the files on their own rows are deleted;
 *  5. the audit log's and the removed-row history's images of their rows
 *     lose the fields the erasure empties, and any text that still holds the
 *     address is nulled (the entries stay: who changed what, and when);
 *  6. their rows in the apps' databases are emptied (`erase-rows.ts`), in
 *     one transaction per database; an entry written about one of those rows
 *     while the erasure ran is emptied too;
 *  7. one audit entry of its own says what was done: counts, and the keyed
 *     hash of the address. Never the address, never the name.
 *
 * Done in that order so that one cut short can be run again: until step 6
 * their rows still hold the address, and the next run finds them and does
 * every step again (each changes nothing the second time).
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
import type { FileStore } from '../files/store.js';
import { translatorFor } from '../i18n/server-i18n.js';
import { blankCampaignSends, campaignSendIds, purgeRowFiles, rowFileIds, scrubAuditImages, scrubRemovedRows, sweepAddress, type CopyLink, type ImageTarget, type PersonRowRef } from './erase-meta.js';
import { findPersonRows, writePersonRows, type ErasedSource, type LeftColumn, type PersonRows } from './erase-rows.js';
import { personHash, personHashes } from './export.js';
import { findPerson, searchAddress } from './sources.js';
import { whatStays, type StaysItem } from './what-stays.js';

export interface EraseDeps {
  meta: MetaDb;
  manager: Pick<ConnectionManager, 'data'>;
  consent: ConsentService;
  storage: FileStore;
  secret: string;
  /**
   * Told of each of their rows as if it were gone: the public door's address
   * watch ends the sessions it opened and takes back open sign-in links to
   * its address, and sends nothing (`public-api/identity-email-watch.ts`).
   */
  signIns?: ((event: RecordWriteEvent) => Promise<void>) | undefined;
  now?: (() => number) | undefined;
}

/** What goes, as the erase dialog counts it. */
export type GoesKind = 'people' | 'copy' | 'outbox' | 'consent' | 'campaign-mail' | 'files';

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
  /** Rows (or entries) changed, by source: `people-crm-contacts`, `copy-…`, `outbox-crm`, `consent`, `campaign-mail`, `files`, `downloads`, `audit`, `removed-rows`. */
  counts: Record<string, number>;
  left: LeftColumn[];
  /** Files that could not be deleted (their bytes are still stored). */
  filesFailed: number;
  /** The keyed hash the erasure's own audit entry keeps. */
  address: { hash: string; version: number };
}

/** "Erased person", in the install's own language (D21): what a name that may not be empty reads from now on. */
async function erasedNameOf(meta: MetaDb): Promise<string> {
  const { t } = await translatorFor(meta, null);
  return t('studio:privacy.erasedPerson', { defaultValue: 'Erased person' });
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

/** Their consent rows: by the address, and by each of their rows. */
async function consentIds(consent: ConsentService, address: string, people: readonly PersonRowRef[]): Promise<number> {
  const ids = new Set<string>();
  for (const one of await consent.history({ address }, { limit: 500 })) ids.add(one.id);
  for (const row of people) for (const one of await consent.history({ person: { connectionId: row.connectionId, table: row.table, key: row.key } }, { limit: 500 })) ids.add(one.id);
  return ids.size;
}

/** What an erasure of this address would do, and what it would leave (nothing is written). */
export async function previewErasure(deps: EraseDeps, rawAddress: string): Promise<ErasePreview> {
  const address = searchAddress(rawAddress);
  const now = deps.now ?? Date.now;
  const rows = await findPersonRows({ meta: deps.meta, manager: deps.manager, erasedName: await erasedNameOf(deps.meta), now }, address);
  const people = peopleRefs(rows);
  const goes: GoesItem[] = [];
  for (const database of rows.databases) {
    for (const source of database.sources) {
      if (source.rows.length === 0) continue;
      goes.push({ kind: source.kind, count: source.rows.length, connectionId: source.connectionId, table: source.table.id, app: source.app, label: source.label });
    }
  }
  const consent = await consentIds(deps.consent, address, people);
  if (consent > 0) goes.push({ kind: 'consent', count: consent });
  const sends = (await campaignSendIds(deps.meta, address, people)).length;
  if (sends > 0) goes.push({ kind: 'campaign-mail', count: sends });
  const files = (await rowFileIds(deps.meta, people)).length;
  if (files > 0) goes.push({ kind: 'files', count: files });
  const stays = await whatStays(deps.meta, await findPerson(deps, address));
  const found = goes.length > 0 || stays.some((item) => item.count !== null && item.count > 0) || (await deps.consent.stop.entryFor(address)) !== null;
  return { address, found, goes, stays, left: rows.left };
}

/** Erases the person with this address (see the header). */
export async function erasePerson(deps: EraseDeps, rawAddress: string): Promise<EraseResult> {
  const { meta, consent } = deps;
  const now = deps.now ?? Date.now;
  const address = searchAddress(rawAddress);
  const started = now();
  // The keys first: while they cannot be read, nothing is touched (the caller answers 503).
  const hash = await personHash(meta, deps.secret, address);
  const hashes = await personHashes(meta, deps.secret, address);
  const rows = await findPersonRows({ meta, manager: deps.manager, erasedName: await erasedNameOf(meta), now }, address);
  const people = peopleRefs(rows);
  const counts: Record<string, number> = {};

  // 1. Still stopped, by the hash alone.
  await consent.eraseDisplay(address, { addIfMissing: true, at: started });
  counts['stop-list'] = 1;

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
  let deleted = await consent.deleteForPerson({ address });
  for (const row of people) deleted += await consent.deleteForPerson({ person: { connectionId: row.connectionId, table: row.table, key: row.key } });
  counts['consent'] = deleted;

  // 4. Campaign sends, downloads, files on their rows.
  counts['campaign-mail'] = await blankCampaignSends(meta, await campaignSendIds(meta, address, people), now());
  const downloads = await privacyExportsRepo(meta).deleteAboutPerson(hashes);
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
  const files = await purgeRowFiles(meta, deps.storage, await rowFileIds(meta, people));
  counts['files'] = files.purged;
  filesFailed += files.failed;

  // 5. The audit log and the removed-row history.
  const targets = rows.databases.flatMap((database) => database.sources.map(imageTarget));
  const removed = await scrubRemovedRows(meta, targets, copyLinks(rows));
  let audit = await scrubAuditImages(meta, [...targets, ...removed.copies]);
  const swept = await sweepAddress(meta, address);
  counts['removed-rows'] = removed.changed + swept.removedRows;

  // 6. Their rows.
  Object.assign(counts, await writePersonRows(rows));
  // An entry written about one of their rows while this ran.
  audit += await scrubAuditImages(meta, targets, started);
  counts['audit'] = audit + swept.audit;

  return { counts, left: rows.left, filesFailed, address: { hash: hash.hash, version: hash.version } };
}
