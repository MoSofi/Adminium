// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE STORED NAME OF A TABLE inside another manifest's rows.
 *
 * An add-on's row may say which table of an app it belongs to ("this stock
 * movement is for a row of the shop's orders"). It cannot keep the table's
 * real name: that changes with a prefix, a rename, another database. So the
 * stored form is:
 *
 *  - `<maker key>:<ref>` when a manifest MADE the table (`shop:orders`): the
 *    key of the earliest record that owns it, and that manifest's own short
 *    name for it. It survives a rename, because the record follows one;
 *  - the table's id in the snapshot (`public.orders`, `main.orders`) when
 *    nobody made it — a table an app only adopted has no maker.
 *
 * This is the ONE place that writes or reads the form. Nobody else splits it.
 */
import { appTablesRepo, type AppTableRecord, type MetaDb } from '@adminium/meta';

export interface TableRefIndex {
  /** Every record of the connection, oldest first. */
  records: readonly AppTableRecord[];
  tables: readonly { id: string; name: string }[];
}

/** The records and tables a stored name is read against: one meta read, made before any source transaction. */
export async function tableRefIndex(meta: MetaDb, connectionId: string, model: { tables: readonly { id: string; name: string }[] }): Promise<TableRefIndex> {
  return { records: await appTablesRepo(meta).forConnection(connectionId), tables: model.tables.map((table) => ({ id: table.id, name: table.name })) };
}

/** A record that still stands for a table: not one whose table was dropped. */
const live = (record: AppTableRecord): boolean => record.state !== 'dropped';

/** The manifest that made a real table: its earliest record that owns it. None for a table nobody made. */
function makerOf(index: TableRefIndex, tableName: string): AppTableRecord | null {
  return index.records.find((record) => record.tableName === tableName && record.owned && live(record)) ?? null;
}

/**
 * The table a stored name stands for, or null when it names nothing here: a
 * key with no record, a table that was dropped, an id the database no longer
 * has. A caller treats such a row as linked to nothing.
 */
export function resolveTableRef(index: TableRefIndex, stored: string): { tableId: string; maker: string | null; ref: string | null } | null {
  // A table's id is tried first: an id may itself hold a colon on no engine Adminium reads, and an id that is one is one.
  const byId = index.tables.find((table) => table.id === stored);
  if (byId !== undefined) return { tableId: byId.id, maker: null, ref: null };
  const cut = stored.indexOf(':');
  if (cut <= 0) return null;
  const maker = stored.slice(0, cut);
  const ref = stored.slice(cut + 1);
  const record = index.records.find((candidate) => candidate.appKey === maker && candidate.ref === ref && live(candidate));
  if (record === undefined) return null;
  const table = index.tables.find((candidate) => candidate.name === record.tableName);
  // Only the maker's own name for it is a name: another manifest's record of the same table says nothing here.
  if (table === undefined || makerOf(index, record.tableName)?.id !== record.id) return null;
  return { tableId: table.id, maker, ref };
}

/** How a table is named in another manifest's rows: by who made it, else by its id. */
export function storedTableRef(index: TableRefIndex, tableId: string): string {
  const table = index.tables.find((candidate) => candidate.id === tableId);
  if (table === undefined) return tableId;
  const maker = makerOf(index, table.name);
  return maker === null ? tableId : `${maker.appKey}:${maker.ref}`;
}
