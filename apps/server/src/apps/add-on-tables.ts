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

/** The real table an add-on link points at, and its one-column key; null while the link is inert. */
export type AddOnTables = (addOn: string, ref: string, fromTableId: string | null) => { tableId: string; key: string | null } | null;

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

let revision = 0;

/**
 * Counts each time what is installed, attached or switched may have changed
 * in this process. A view of a database is kept until its snapshot or its
 * rules move; a link into an add-on also moves when the add-on arrives, goes
 * or is switched, so the keepers of those views read this beside the rest.
 */
export const addOnInstallsRevision = (): number => revision;
export function addOnInstallsChanged(): void {
  revision += 1;
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
    return { tableId: table.id, key: key.length === 1 ? (key[0] as string) : null };
  };
}
