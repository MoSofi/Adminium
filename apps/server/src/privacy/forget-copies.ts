// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "DELETE MY DETAILS", ON THE ROWS LINKED TO THE PERSON: what `forget.copies`
 * adds to the public delete.
 *
 * The person proved their mailbox moments ago and is signed in on their own
 * row, so that row's key is the only thing that says what is theirs. A row is
 * found by the declared link to that key and by nothing else: never by an
 * address or a name, so a row that merely holds the same typed address, with
 * no link to them, is somebody else's to answer for and stays as it is.
 *
 * On such a row the declared copies kept through that link are emptied, as
 * the staff erasure empties them (`erase-rows.ts`, `erase-values.ts`). Never a
 * key, a link or a secret. A table the law keeps stays whole.
 *
 * The writes are direct, inside the transaction that empties the person's own
 * row: all of it happens or none does. Not a save: a save would judge the
 * booking again, move or lock on a state, stamp, mail and fire the app's rules.
 * A second run finds every column already blank and writes nothing.
 */
import type { Dialect } from '@adminium/engine';
import { manifestsRepo, type MetaDb } from '@adminium/meta';
import { sql, type Kysely } from 'kysely';

import type { SourceDatabase } from '../connections/manager.js';
import type { ResolvedTable, SnapshotView } from '../crud/identifiers.js';
import type { Row } from '../crud/mask.js';
import type { DeclaredCopy } from '../people/declared.js';
import { peopleTablesOf } from '../people/tables-of.js';
import { rowKeyOf } from '../payments/payables.js';
import { linkColumnsOf } from './copy-rows.js';
import { blankRow, pkOf } from './erase-rows.js';
import type { ErasedRole } from './erase-values.js';
import { keptTablesOf, NO_SECRETS, PRESENT, tableOf, type AppOnDatabase } from './sources.js';

/** One table's copies kept through one link to the person. */
export interface OwnCopyTable {
  table: ResolvedTable;
  via: string;
  columns: Map<string, ErasedRole>;
}

const roleOf = (copy: DeclaredCopy): ErasedRole => (copy.json === true ? 'json' : copy.holds === 'email' ? 'email' : copy.holds === 'name' ? 'name' : 'other');

/** The declared copies of this people table that are reached by a link of their own, on tables the law does not keep. */
export async function ownCopyTables(meta: MetaDb, connectionId: string, view: SnapshotView, person: ResolvedTable): Promise<OwnCopyTable[]> {
  const installed = (await manifestsRepo(meta, NO_SECRETS).list('app')).filter((entry) => entry.row.connectionId === connectionId && PRESENT.has(entry.row.status));
  const apps: AppOnDatabase[] = installed.map((entry) => ({ appKey: entry.row.manifestKey, document: entry.document as AppOnDatabase['document'] }));
  const kept = await keptTablesOf(meta, connectionId, apps, view);
  const declared = (await peopleTablesOf(meta).all(connectionId, view.model)).filter((entry) => tableOf(view, entry.table)?.id === person.id);
  const out = new Map<string, OwnCopyTable>();
  for (const entry of declared) {
    for (const copy of entry.copies) {
      // A copy on an add-on's table is reached through the app's own line: the add-on keeps it, and other people's lines may name it.
      if (copy.via === null || copy.through !== undefined) continue;
      const table = tableOf(view, copy.table);
      if (table === null || table.primaryKey.length === 0 || kept.has(table.id)) continue;
      // Only a link that really points at the person's table.
      const linked = view.model.relations.some((relation) => relation.from.tableId === table.id && relation.to.tableId === person.id && relation.from.columns.length === 1 && relation.from.columns[0] === copy.via);
      if (!linked) continue;
      const column = table.columns.get(copy.column);
      if (column === undefined || column.isPrimaryKey || column.secret || linkColumnsOf(view, table.id).has(copy.column)) continue;
      const key = `${table.id}\u0000${copy.via}`;
      const held = out.get(key) ?? { table, via: copy.via, columns: new Map<string, ErasedRole>() };
      held.columns.set(copy.column, roleOf(copy));
      out.set(key, held);
    }
  }
  return [...out.values()];
}

/** Empties those copies on the rows linked to this person, inside the caller's transaction. Answers the rows changed, for whatever keeps a copy elsewhere. */
export async function blankOwnCopies(db: Kysely<SourceDatabase>, dialect: Dialect, tables: readonly OwnCopyTable[], personKey: unknown, erasedName: string): Promise<{ table: string; key: string }[]> {
  if (personKey === null || personKey === undefined) return [];
  const changed: { table: string; key: string }[] = [];
  for (const { table, via, columns } of tables) {
    const rows = (await db.selectFrom(table.id as never).selectAll().where(sql.ref(via), '=', personKey as never).execute()) as Row[];
    for (const row of rows) {
      const { values } = blankRow(table, row, columns, dialect, erasedName, new Map());
      if (Object.keys(values).length === 0) continue;
      let update = db.updateTable(table.id as never).set(values as never);
      for (const [column, value] of Object.entries(pkOf(table, row))) update = update.where(sql.ref(column), '=', value as never);
      // Still theirs at the moment of the write.
      update = update.where(sql.ref(via), '=', personKey as never);
      await update.execute();
      changed.push({ table: table.id, key: rowKeyOf(table, row) });
    }
  }
  return changed;
}
