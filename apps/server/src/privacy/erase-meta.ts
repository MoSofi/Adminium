// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHAT ADMINIUM ITSELF KEEPS OF AN ERASED PERSON, EMPTIED (`erase.ts` runs
 * it; `erase-rows.ts` does the apps' own databases):
 *
 *  - THE AUDIT LOG keeps every entry (who changed what, and when), but the
 *    images of their rows lose the fields the erasure empties: an entry
 *    about one of their rows, a copy of them or their mail has those columns
 *    nulled wherever its changes hold them (before, after, a public write's
 *    values). Their own writes through a public page also lose the network
 *    address and the browser they came from. Then the whole log is swept for
 *    the address itself: any text in an entry that holds it is nulled.
 *  - THE REMOVED-ROW HISTORY likewise: a removed row of theirs, or a removed
 *    copy that linked to one of their rows, loses the same fields (and the
 *    audit entries about such a removed copy too); then the address sweep.
 *  - THE CAMPAIGN SEND LOG keeps each send to them (its state, its counts)
 *    with the address and the name emptied; a send still waiting is skipped
 *    as stopped, since the address is on the do-not-email list from now on.
 *    A run's failure list loses its entries to them, and any send's reason
 *    or job's last error that holds the address is emptied (`sweepMailAddress`).
 *  - FILES attached to their own rows are deleted past the bin: bytes first,
 *    then the row (as the bin's own sweep does).
 *
 * Addresses are compared as `normaliseAddress` spells them, and a text is
 * said to hold one only when it holds it whole (`holdsAddress`): `xmarta@…`
 * is somebody else.
 */
import { auditEntityKeyPart, filesRepo, packJson, readJson, type MetaDb } from '@adminium/meta';
import { sql } from 'kysely';

import type { FileStore } from '../files/store.js';
import { removeCleanedPicture } from '../public-api/picture-store.js';
import { holdsAny } from './meta-sources.js';
import { holdsAddress } from './values.js';

/** How many entries are read at a time, and how many keys go in one `in (…)`. */
const BATCH = 500;

/** Rows of one table whose images lose some columns. */
export interface ImageTarget {
  connectionId: string;
  /** The table's snapshot id. */
  table: string;
  keys: readonly string[];
  /** Per row key: the columns its images lose. */
  columns: ReadonlyMap<string, readonly string[]>;
  /** Their own rows (a public write's network address goes too). */
  own: boolean;
}

/** A declared copy table: a removed row of it that linked to one of their rows loses the copy columns. */
export interface CopyLink {
  connectionId: string;
  copyTable: string;
  via: string;
  columns: readonly string[];
  /** The people table the link points at, and their keys there. */
  parentTable: string;
  parentKeys: readonly string[];
}

/** Each column named, nulled wherever an object of `value` holds it (nested too). Whether anything changed. */
export function nullColumns(value: unknown, columns: ReadonlySet<string>): boolean {
  if (Array.isArray(value)) return value.map((item) => nullColumns(item, columns)).some(Boolean);
  if (value === null || typeof value !== 'object') return false;
  let changed = false;
  const object = value as Record<string, unknown>;
  for (const [key, item] of Object.entries(object)) {
    if (columns.has(key) && item !== null && item !== undefined) {
      object[key] = null;
      changed = true;
    } else if (nullColumns(item, columns)) changed = true;
  }
  return changed;
}

/** Every text in `value` that holds `address`, nulled (keys holding it go). Answers the value as left, and whether it changed. */
export function nullAddress(value: unknown, address: string): { value: unknown; changed: boolean } {
  if (typeof value === 'string') return holdsAddress(value, address) ? { value: null, changed: true } : { value, changed: false };
  if (Array.isArray(value)) {
    let changed = false;
    const out = value.map((item) => {
      const next = nullAddress(item, address);
      changed ||= next.changed;
      return next.value;
    });
    return { value: out, changed };
  }
  if (value === null || typeof value !== 'object') return { value, changed: false };
  let changed = false;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (holdsAddress(key, address)) {
      changed = true;
      continue;
    }
    const next = nullAddress(item, address);
    changed ||= next.changed;
    out[key] = next.value;
  }
  return { value: out, changed };
}

const chunks = <T>(items: readonly T[]): T[][] => {
  const out: T[][] = [];
  for (let at = 0; at < items.length; at += BATCH) out.push(items.slice(at, at + BATCH));
  return out;
};

/** The audit entries about these rows lose their columns. `since`: only entries written from then on. Answers the entries changed. */
export async function scrubAuditImages(meta: MetaDb, targets: readonly ImageTarget[], since?: number): Promise<number> {
  const { db } = meta;
  let changed = 0;
  for (const target of targets) {
    for (const keys of chunks(target.keys)) {
      let query = db
        .selectFrom('adminium_audit_log')
        .select(['id', 'connectionId', 'entity', 'changes', 'actorKind', 'actorLabel', 'ip', 'userAgent', 'entityId'])
        .where('entityTable', '=', auditEntityKeyPart(target.table))
        .where('entityId', 'in', keys.map((key) => auditEntityKeyPart(key)));
      if (since !== undefined) query = query.where('createdAt', '>=', since);
      for (const row of await query.execute()) {
        const entity = readJson<{ connectionId?: unknown } | null>(row.entity);
        if ((entity?.connectionId ?? row.connectionId) !== target.connectionId) continue;
        const key = keys.find((one) => auditEntityKeyPart(one) === row.entityId);
        const columns = new Set(key === undefined ? [] : (target.columns.get(key) ?? []));
        const changes = readJson<unknown>(row.changes);
        const imageChanged = changes !== null && changes !== undefined && nullColumns(changes, columns);
        // Their own write through a public page: where they wrote from goes with them.
        const theirs = target.own && row.actorKind === 'api-key' && row.actorLabel.startsWith('public:') && (row.ip !== null || row.userAgent !== null);
        if (!imageChanged && !theirs) continue;
        await db
          .updateTable('adminium_audit_log')
          .set({ ...(imageChanged ? { changes: packJson(changes) } : {}), ...(theirs ? { ip: null, userAgent: null } : {}) })
          .where('id', '=', row.id)
          .execute();
        changed += 1;
      }
    }
  }
  return changed;
}

/** The removed rows of theirs, and removed copies linked to them, lose their columns. Answers the rows changed, and the removed copies' keys (their audit entries go too). */
export async function scrubRemovedRows(meta: MetaDb, targets: readonly ImageTarget[], links: readonly CopyLink[]): Promise<{ changed: number; copies: ImageTarget[] }> {
  const { db } = meta;
  let changed = 0;
  const write = async (id: string, image: unknown) => {
    await db.updateTable('adminium_removed_rows').set({ image: packJson(image) }).where('id', '=', id).execute();
    changed += 1;
  };
  for (const target of targets) {
    for (const keys of chunks(target.keys)) {
      const rows = await db
        .selectFrom('adminium_removed_rows')
        .select(['id', 'entityId', 'image'])
        .where('connectionId', '=', target.connectionId)
        .where('entityTable', '=', auditEntityKeyPart(target.table))
        .where('entityId', 'in', keys.map((key) => auditEntityKeyPart(key)))
        .execute();
      for (const row of rows) {
        const key = keys.find((one) => auditEntityKeyPart(one) === row.entityId);
        const image = readJson<unknown>(row.image);
        if (nullColumns(image, new Set(key === undefined ? [] : (target.columns.get(key) ?? []))) && key !== undefined) await write(row.id, image);
      }
    }
  }
  // A copy removed while it still linked to them: its image, and the audit entries about it.
  const copies = new Map<string, { connectionId: string; table: string; keys: Set<string>; columns: Map<string, string[]> }>();
  for (const link of links) {
    for (const keys of chunks(link.parentKeys)) {
      const rows = await db
        .selectFrom('adminium_removed_rows')
        .select(['id', 'entityId', 'image'])
        .where('connectionId', '=', link.connectionId)
        .where('entityTable', '=', auditEntityKeyPart(link.copyTable))
        .where('via', '=', auditEntityKeyPart(link.via))
        .where('parentTable', '=', auditEntityKeyPart(link.parentTable))
        .where('parentValue', 'in', keys.map((key) => auditEntityKeyPart(key)))
        .execute();
      for (const row of rows) {
        const image = readJson<unknown>(row.image);
        if (nullColumns(image, new Set(link.columns))) await write(row.id, image);
        const id = `${link.connectionId}\u0000${link.copyTable}`;
        let held = copies.get(id);
        if (held === undefined) copies.set(id, (held = { connectionId: link.connectionId, table: link.copyTable, keys: new Set(), columns: new Map() }));
        held.keys.add(row.entityId);
        held.columns.set(row.entityId, [...new Set([...(held.columns.get(row.entityId) ?? []), ...link.columns])]);
      }
    }
  }
  return { changed, copies: [...copies.values()].map((one) => ({ connectionId: one.connectionId, table: one.table, keys: [...one.keys], columns: one.columns, own: false })) };
}

/** Every audit entry and removed-row image that still holds the address in a text: that text nulled. Answers the entries and rows changed. */
export async function sweepAddress(meta: MetaDb, address: string): Promise<{ audit: number; removedRows: number }> {
  const { db } = meta;
  let changed = 0;
  let audit = 0;
  let after: string | null = null;
  for (;;) {
    let query = db.selectFrom('adminium_audit_log').select(['id', 'changes', 'entity']).where((eb) => eb.or([holdsAny(meta, 'changes', [address]), holdsAny(meta, 'entity', [address])]));
    if (after !== null) query = query.where('id', '>', after);
    const rows = await query.orderBy('id', 'asc').limit(BATCH).execute();
    for (const row of rows) {
      const changes = nullAddress(readJson<unknown>(row.changes), address);
      const entity = nullAddress(readJson<unknown>(row.entity), address);
      if (!changes.changed && !entity.changed) continue;
      await db
        .updateTable('adminium_audit_log')
        .set({ ...(changes.changed ? { changes: changes.value === null ? null : packJson(changes.value) } : {}), ...(entity.changed ? { entity: null, entityTable: null, entityId: null } : {}) })
        .where('id', '=', row.id)
        .execute();
      changed += 1;
    }
    if (rows.length < BATCH) break;
    after = rows.at(-1)!.id;
  }
  audit = changed;
  changed = 0;
  after = null;
  for (;;) {
    let query = db.selectFrom('adminium_removed_rows').select(['id', 'image']).where(holdsAny(meta, 'image', [address]));
    if (after !== null) query = query.where('id', '>', after);
    const rows = await query.orderBy('id', 'asc').limit(BATCH).execute();
    for (const row of rows) {
      const image = nullAddress(readJson<unknown>(row.image), address);
      if (!image.changed) continue;
      await db.updateTable('adminium_removed_rows').set({ image: packJson(image.value ?? {}) }).where('id', '=', row.id).execute();
      changed += 1;
    }
    if (rows.length < BATCH) break;
    after = rows.at(-1)!.id;
  }
  return { audit, removedRows: changed };
}

/** One of their rows, as a store that keeps the table by id or by name finds it. */
export interface PersonRowRef {
  connectionId: string;
  table: string;
  tableName: string;
  key: string;
}

/** Their campaign sends: to the address, or to one of their rows (whatever address it went to). */
export async function campaignSendIds(meta: MetaDb, address: string, people: readonly PersonRowRef[]): Promise<string[]> {
  const { db } = meta;
  const ids = new Set<string>();
  const byAddress = await db.selectFrom('adminium_email_sends').select(['id']).where(sql<boolean>`lower(trim(${sql.ref('address')})) = ${address}`).execute();
  for (const row of byAddress) ids.add(row.id);
  const tables = [...new Set(people.flatMap((row) => [row.table, row.tableName]))];
  for (const connectionId of new Set(people.map((row) => row.connectionId))) {
    const keys = [...new Set(people.filter((row) => row.connectionId === connectionId).map((row) => row.key))];
    for (const chunk of chunks(keys)) {
      const rows = await db.selectFrom('adminium_email_sends').select(['id']).where('connectionId', '=', connectionId).where('personTable', 'in', tables).where('personKey', 'in', chunk).execute();
      for (const row of rows) ids.add(row.id);
    }
  }
  return [...ids];
}

/**
 * Their campaign sends keep their state and counts, with the address and the
 * name emptied; one still waiting is skipped as stopped (it could not go to
 * an empty address, and the address is on the do-not-email list now, reason
 * `erased`). Answers the sends changed.
 */
export async function blankCampaignSends(meta: MetaDb, ids: readonly string[], at: number): Promise<number> {
  const { db } = meta;
  for (const chunk of chunks(ids)) {
    await db.updateTable('adminium_email_sends').set({ state: 'skipped-stop', reason: 'erased', updatedAt: at }).where('id', 'in', chunk).where('state', '=', 'queued').execute();
    await db.updateTable('adminium_email_sends').set({ address: '', name: '', updatedAt: at }).where('id', 'in', chunk).execute();
  }
  return ids.length;
}

/**
 * What the mail side still holds of the address in its own words, emptied
 * (as `sweepAddress` does for the audit log): every campaign run's failure
 * list loses its entries to the address (their error repeats it, and they
 * say nothing once it is gone), and an entry about somebody else whose error
 * names it keeps its place with the error emptied; any send's reason that
 * holds it (a relay's "550 … <address>: …") is emptied; and so is the last
 * error of any job that holds it (the mail queue's `email.send` keeps the
 * relay's answer there). Answers the runs, sends and jobs changed.
 */
export async function sweepMailAddress(meta: MetaDb, address: string, at: number): Promise<{ runs: number; sends: number; jobs: number }> {
  const { db } = meta;
  let runs = 0;
  let after: string | null = null;
  for (;;) {
    let query = db.selectFrom('adminium_email_runs').select(['id', 'failures']).where(holdsAny(meta, 'failures', [address]));
    if (after !== null) query = query.where('id', '>', after);
    const rows = await query.orderBy('id', 'asc').limit(BATCH).execute();
    for (const row of rows) {
      const list = readJson<unknown>(row.failures);
      if (!Array.isArray(list)) continue;
      let changed = false;
      const kept: unknown[] = [];
      for (const item of list) {
        const entry = (item ?? {}) as { to?: unknown; error?: unknown };
        if (typeof entry.to === 'string' && holdsAddress(entry.to, address)) {
          changed = true;
          continue;
        }
        if (typeof entry.error === 'string' && holdsAddress(entry.error, address)) {
          kept.push({ ...entry, error: '' });
          changed = true;
          continue;
        }
        kept.push(item);
      }
      if (!changed) continue;
      await db.updateTable('adminium_email_runs').set({ failures: packJson(kept), updatedAt: at }).where('id', '=', row.id).execute();
      runs += 1;
    }
    if (rows.length < BATCH) break;
    after = rows.at(-1)!.id;
  }
  const textSweep = async (table: 'adminium_email_sends' | 'adminium_jobs', column: 'reason' | 'lastError'): Promise<number> => {
    let changed = 0;
    let from: string | null = null;
    for (;;) {
      let query = db.selectFrom(table).select(['id', `${column} as text`] as never).where(holdsAny(meta, column, [address]));
      if (from !== null) query = query.where('id', '>', from);
      const rows = (await query.orderBy('id', 'asc').limit(BATCH).execute()) as unknown as { id: string; text: string | null }[];
      const hit = rows.filter((row) => typeof row.text === 'string' && holdsAddress(row.text, address)).map((row) => row.id);
      for (const ids of chunks(hit)) {
        await db.updateTable(table).set({ [column]: null } as never).where('id', 'in', ids).execute();
        changed += ids.length;
      }
      if (rows.length < BATCH) break;
      from = rows.at(-1)!.id;
    }
    return changed;
  };
  return { runs, sends: await textSweep('adminium_email_sends', 'reason'), jobs: await textSweep('adminium_jobs', 'lastError') };
}

/** The files attached to their own rows. */
export async function rowFileIds(meta: MetaDb, people: readonly PersonRowRef[]): Promise<string[]> {
  const { db } = meta;
  const out: string[] = [];
  for (const connectionId of new Set(people.map((row) => row.connectionId))) {
    const mine = people.filter((row) => row.connectionId === connectionId);
    const tables = [...new Set(mine.flatMap((row) => [auditEntityKeyPart(row.table), auditEntityKeyPart(row.tableName)]))];
    const wanted = new Set(mine.flatMap((row) => [`${auditEntityKeyPart(row.table)}\u0000${auditEntityKeyPart(row.key)}`, `${auditEntityKeyPart(row.tableName)}\u0000${auditEntityKeyPart(row.key)}`]));
    for (const keys of chunks([...new Set(mine.map((row) => auditEntityKeyPart(row.key)))])) {
      const rows = await db.selectFrom('adminium_files').select(['id', 'entityTable', 'entityId']).where('entityConnectionId', '=', connectionId).where('entityTable', 'in', tables).where('entityId', 'in', keys).execute();
      for (const row of rows) if (wanted.has(`${row.entityTable ?? ''}\u0000${row.entityId ?? ''}`)) out.push(row.id);
    }
  }
  return [...new Set(out)];
}

/** Files deleted past the bin: bytes first, then the row (as the bin's own sweep does). Answers how many went and how many could not. */
export async function purgeRowFiles(meta: MetaDb, storage: FileStore, ids: readonly string[]): Promise<{ purged: number; failed: number }> {
  const files = filesRepo(meta);
  let purged = 0;
  let failed = 0;
  for (const id of ids) {
    const file = await files.findById(id);
    if (file === null) continue;
    try {
      await removeCleanedPicture(storage, file);
      await storage.remove(file);
      await files.purge(file.id);
      purged += 1;
    } catch {
      failed += 1;
    }
  }
  return { purged, failed };
}
