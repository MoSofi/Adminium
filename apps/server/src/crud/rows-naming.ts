// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The rows that name a person.
 *
 * A row says whose it is in a staff column (`column.staff`). When a person is
 * removed for good, the rows that name them would be nobody's that anyone
 * limited to "their own" could reach: so the removal first asks whom to hand
 * them to. This file counts those rows, connection by connection, and moves
 * them.
 *
 * A PRIVATE table's rows are counted and never handed over: a one-to-one is
 * read by its two people and by nobody else, and giving a colleague the
 * leaver's notes would break exactly that. They stay as they are, named for
 * somebody who is gone.
 *
 * A connection that cannot be read now (an outside database that is down) is
 * told as such, and holds nobody back: whoever removes the person decides.
 */
import type { MetaDb } from '@adminium/meta';
import { sql, type Kysely } from 'kysely';

import type { ConnectionManager, SourceDatabase } from '../connections/manager.js';
import { loadSnapshotView } from '../data-io/snapshot-view.js';

export interface NamedRows {
  connectionId: string;
  connectionName: string;
  tableId: string;
  tableLabel: string;
  column: string;
  rows: number;
  /** Rows of a private table: counted, and left where they are. */
  private: boolean;
}

export interface RowsNaming {
  named: NamedRows[];
  /** Connections that could not be read: nothing is known of their rows. */
  unreadable: { connectionId: string; connectionName: string }[];
  /** Rows a hand-over would move (everything but the private tables'). */
  total: number;
}

type Each = (found: NamedRows, db: Kysely<SourceDatabase>) => Promise<void>;

async function walk(meta: MetaDb, manager: ConnectionManager, userId: string, each: Each): Promise<RowsNaming> {
  const out: RowsNaming = { named: [], unreadable: [], total: 0 };
  for (const connection of await meta.db.selectFrom('adminium_connections').select(['id', 'name']).orderBy('createdAt', 'asc').execute()) {
    try {
      const view = await loadSnapshotView(meta, connection.id);
      const staffed = view.model.tables.flatMap((table) => table.columns.filter((column) => column.staff === true).map((column) => ({ table, column })));
      if (staffed.length === 0) continue;
      const db = (await manager.data(connection.id)).db as unknown as Kysely<SourceDatabase>;
      for (const { table, column } of staffed) {
        const counted = await db
          .selectFrom(table.id as never)
          .select(sql<number>`count(*)`.as('n'))
          .where(sql.ref(column.name), '=', userId)
          .executeTakeFirst();
        const rows = Number((counted as { n?: unknown } | undefined)?.n ?? 0);
        if (rows === 0) continue;
        const found: NamedRows = { connectionId: connection.id, connectionName: connection.name, tableId: table.id, tableLabel: table.label ?? table.name, column: column.name, rows, private: table.private === true };
        out.named.push(found);
        if (!found.private) out.total += rows;
        await each(found, db);
      }
    } catch {
      out.unreadable.push({ connectionId: connection.id, connectionName: connection.name });
    }
  }
  return out;
}

/** Every staff column that names the person, with how many rows. */
export function rowsNaming(meta: MetaDb, manager: ConnectionManager, userId: string): Promise<RowsNaming> {
  return walk(meta, manager, userId, async () => {});
}

/** Give every row that names `from` to `to`, but for a private table's; answers what was there before the move. */
export function handRowsOver(meta: MetaDb, manager: ConnectionManager, from: string, to: string): Promise<RowsNaming> {
  return walk(meta, manager, from, async (found, db) => {
    if (found.private) return;
    await db
      .updateTable(found.tableId as never)
      .set({ [found.column]: to } as never)
      .where(sql.ref(found.column), '=', from)
      .execute();
  });
}
