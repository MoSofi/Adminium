// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHERE A LINK INTO AN ADD-ON'S TABLE POINTS, on one database, right now.
 *
 * A column of an app may link to a row of an add-on's table with no foreign
 * key (`addOnLink`), so the app installs whether or not the add-on is there.
 * This answers the real table behind such a link — and answers nothing when
 * the link is inert:
 *
 *  - the add-on is not installed, is still being installed or changed, or
 *    keeps its tables in another database;
 *  - the table is not one it made or took here;
 *  - the link is an APP's, and the add-on is not attached to that app, or is
 *    switched off there. A link the owner drew, or the add-on's own, asks no
 *    app's leave.
 *
 * Whose link it is is read from who made the linking table. One meta read,
 * made before any source transaction; the answer is a plain function.
 */
import { appTablesRepo, manifestsRepo, type MetaDb } from '@adminium/meta';

import { listedColumnsOf, type ListedColumns } from '../crud/adjust/listed.js';

/** The real table an add-on link points at, and its one-column key; null while the link is inert. */
export type AddOnTables = (
  addOn: string,
  ref: string,
  fromTableId: string | null,
) => {
  tableId: string;
  key: string | null;
  /** Set when this is the table the add-on keeps what it applied to an order in: where its rows keep each part. */
  applied?: ListedColumns;
} | null;

const NO_SECRETS = {
  encrypt: (): string => {
    throw new Error('reading add-on tables never stores a credential');
  },
  decrypt: (): string => {
    throw new Error('reading add-on tables never reads a credential');
  },
};

interface ModelTable {
  id: string;
  name: string;
  primaryKey?: readonly string[] | null | undefined;
}

/**
 * A stamp that moves whenever what is installed, attached, switched or
 * recorded may have changed: an add-on arriving or going, a row's status, an
 * attachment made, removed or switched, a table record written or renamed, a
 * database read again. A view of a database is kept until its snapshot or its
 * rules move; a link into an add-on moves with these too, so whoever keeps
 * such a view reads this beside the rest.
 *
 * It is read from the store, not counted in this process: a second server
 * process, and an install done from the project folder, move it just the same.
 * One statement.
 */
export async function addOnInstallsStamp(meta: MetaDb): Promise<string> {
  const row = await meta.db
    .selectNoFrom((eb) => [
      eb.selectFrom('adminium_manifests').select((e) => e.fn.countAll<number>().as('n')).as('manifests'),
      // A sum, not the newest: a row written by a process whose clock runs behind still moves it.
      eb.selectFrom('adminium_manifests').select((e) => e.fn.sum('updatedAt').as('at')).as('manifestsAt'),
      eb.selectFrom('adminium_manifest_attachments').select((e) => e.fn.countAll<number>().as('n')).as('attachments'),
      eb.selectFrom('adminium_manifest_attachments').select((e) => e.fn.count<number>('disabledAt').as('n')).as('switchedOff'),
      eb.selectFrom('adminium_manifest_attachments').select((e) => e.fn.max('createdAt').as('at')).as('attachmentsAt'),
      eb.selectFrom('adminium_manifest_attachments').select((e) => e.fn.max('disabledAt').as('at')).as('switchedOffAt'),
      eb.selectFrom('adminium_app_tables').select((e) => e.fn.countAll<number>().as('n')).as('records'),
      eb.selectFrom('adminium_app_tables').select((e) => e.fn.sum('updatedAt').as('at')).as('recordsAt'),
      eb.selectFrom('adminium_schema_snapshots').select((e) => e.fn.countAll<number>().as('n')).as('snapshots'),
      eb.selectFrom('adminium_schema_snapshots').select((e) => e.fn.max('createdAt').as('at')).as('snapshotsAt'),
    ])
    .executeTakeFirstOrThrow();
  return [row.manifests, row.manifestsAt, row.attachments, row.switchedOff, row.attachmentsAt, row.switchedOffAt, row.records, row.recordsAt, row.snapshots, row.snapshotsAt].map((part) => String(part ?? '')).join(':');
}

export async function addOnTablesFor(meta: MetaDb, connectionId: string, model: { tables: readonly ModelTable[] }): Promise<AddOnTables> {
  const manifests = await manifestsRepo(meta, NO_SECRETS).list();
  const kindOf = new Map(manifests.map((entry) => [entry.row.manifestKey, entry.row.kind]));
  const records = await appTablesRepo(meta).forConnection(connectionId);
  const byName = new Map(model.tables.map((table) => [table.name, table]));
  const nameOf = new Map(model.tables.map((table) => [table.id, table.name]));

  /** An installed add-on's own tables on this database, by its short name for each. */
  const own = new Map<string, Map<string, ModelTable>>();
  /** The apps each add-on is attached to and switched on for. */
  const on = new Map<string, Set<string>>();
  /** The table each add-on keeps what it applied to an order in, and where its rows keep each part. */
  const appliedIn = new Map<string, { ref: string; columns: ListedColumns }>();
  for (const entry of manifests) {
    if (entry.row.kind !== 'add-on' || entry.row.status !== 'installed' || entry.row.connectionId !== connectionId) continue;
    const key = entry.row.manifestKey;
    const tables = new Map<string, ModelTable>();
    for (const record of records) {
      if (record.appKey !== key || (record.state !== 'created' && record.state !== 'adopted')) continue;
      const table = byName.get(record.tableName);
      if (table !== undefined) tables.set(record.ref, table);
    }
    own.set(key, tables);
    const kept = (entry.document as { addOn?: { adjuster?: { applied?: { table?: unknown } } } } | null)?.addOn?.adjuster?.applied;
    const columns = listedColumnsOf(kept);
    if (typeof kept?.table === 'string' && columns !== null) appliedIn.set(key, { ref: kept.table, columns });
    on.set(key, new Set(entry.attachments.filter((attachment) => attachment.disabledAt === null).map((attachment) => attachment.attachedTo)));
  }

  /** The app whose table a link sits on: the earliest record that owns it, when that is an app's. */
  const appOf = (tableId: string | null): string | null => {
    const name = tableId === null ? undefined : nameOf.get(tableId);
    if (name === undefined) return null;
    const maker = records.find((record) => record.tableName === name && record.owned && record.state !== 'dropped');
    return maker !== undefined && kindOf.get(maker.appKey) === 'app' ? maker.appKey : null;
  };

  return (addOn, ref, fromTableId) => {
    const table = own.get(addOn)?.get(ref);
    if (table === undefined) return null;
    const host = appOf(fromTableId);
    if (host !== null && on.get(addOn)?.has(host) !== true) return null;
    const key = table.primaryKey ?? [];
    const applied = appliedIn.get(addOn);
    return { tableId: table.id, key: key.length === 1 ? (key[0] as string) : null, ...(applied?.ref === ref ? { applied: applied.columns } : {}) };
  };
}
