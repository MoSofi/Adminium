// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The rows that are a person's.
 *
 * A row says whose it is by the ways its table declares (`table.belongs`):
 * here, the staff columns among them. When a person is removed or suspended,
 * the rows that are theirs would be nobody's that anyone limited to "their
 * own" could reach: so the removal asks whom to hand them to. This file
 * counts those rows, connection by connection, and moves them.
 *
 * ONLY THE COLUMNS THAT DECIDE WHOSE A ROW IS. A staff column that records
 * something else (who approved, who made the row) is history: it is neither
 * counted nor moved, and a table that declares no way has no row of anybody's.
 *
 * A PRIVATE table's rows are never handed over: a one-to-one is read by its
 * two people and by nobody else. They stay as they are, named for somebody
 * who is gone, and whoever manages people is told only THAT there are some:
 * not how many, not in which table.
 *
 * A connection that cannot be read now (an outside database that is down) is
 * told as such, and holds nobody back: whoever removes the person decides.
 * One that could be read and not written is told apart from it.
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
}

export interface RowsNaming {
  /** The rows that are the person's, by table and column: never a private table's. */
  named: NamedRows[];
  /** Whether rows of a private table name the person. Said, never counted. */
  private: boolean;
  /** Connections that could not be read: nothing is known of their rows. */
  unreadable: { connectionId: string; connectionName: string }[];
  /** Rows a hand-over would move, or did. */
  total: number;
}

export interface RowsHandedOver extends RowsNaming {
  /** Connections whose rows could be counted and not moved: nothing of them changed. */
  failed: { connectionId: string; connectionName: string }[];
}

interface Found {
  connectionId: string;
  connectionName: string;
  db: Kysely<SourceDatabase>;
  /** Every staff column a table's own ways name, with what it holds for the person. */
  columns: (NamedRows & { private: boolean })[];
}

/** The staff columns a table's rows are somebody's by: its plain column ways, and nothing a way reads through another row. */
function ownerColumns(table: { belongs?: readonly unknown[]; columns: readonly { name: string; staff?: boolean }[] }): string[] {
  const out: string[] = [];
  for (const way of table.belongs ?? []) {
    const one = way as { column?: string; person?: string };
    if (typeof one.column !== 'string' || one.person !== undefined) continue;
    if (table.columns.some((column) => column.name === one.column && column.staff === true) && !out.includes(one.column)) out.push(one.column);
  }
  return out;
}

/** Counts, and changes nothing. */
async function count(meta: MetaDb, manager: ConnectionManager, userId: string): Promise<{ found: Found[]; unreadable: RowsNaming['unreadable'] }> {
  const found: Found[] = [];
  const unreadable: RowsNaming['unreadable'] = [];
  for (const connection of await meta.db.selectFrom('adminium_connections').select(['id', 'name']).orderBy('createdAt', 'asc').execute()) {
    try {
      const view = await loadSnapshotView(meta, connection.id);
      const owned = view.model.tables.flatMap((table) => ownerColumns(table).map((column) => ({ table, column })));
      if (owned.length === 0) continue;
      const db = (await manager.data(connection.id)).db as unknown as Kysely<SourceDatabase>;
      const columns: Found['columns'] = [];
      for (const { table, column } of owned) {
        const counted = await db
          .selectFrom(table.id as never)
          .select(sql<number>`count(*)`.as('n'))
          .where(sql.ref(column), '=', userId)
          .executeTakeFirst();
        const rows = Number((counted as { n?: unknown } | undefined)?.n ?? 0);
        if (rows > 0) columns.push({ connectionId: connection.id, connectionName: connection.name, tableId: table.id, tableLabel: table.label ?? table.name, column, rows, private: table.private === true });
      }
      if (columns.length > 0) found.push({ connectionId: connection.id, connectionName: connection.name, db, columns });
    } catch {
      unreadable.push({ connectionId: connection.id, connectionName: connection.name });
    }
  }
  return { found, unreadable };
}

const open = (found: readonly Found[]): NamedRows[] => found.flatMap((one) => one.columns.filter((column) => !column.private).map(({ private: _private, ...rest }) => rest));

/** Every column that makes a row the person's, with how many rows; of private tables, only whether there are any. */
export async function rowsNaming(meta: MetaDb, manager: ConnectionManager, userId: string): Promise<RowsNaming> {
  const { found, unreadable } = await count(meta, manager, userId);
  const named = open(found);
  return { named, private: found.some((one) => one.columns.some((column) => column.private)), unreadable, total: named.reduce((sum, one) => sum + one.rows, 0) };
}

/**
 * Give every row that is `from`'s to `to`, but for a private table's.
 * Counted in one pass and moved in a second: a connection's rows move in
 * one transaction, all of them or none, and what is answered is what each
 * UPDATE itself said it changed.
 */
export async function handRowsOver(meta: MetaDb, manager: ConnectionManager, from: string, to: string): Promise<RowsHandedOver> {
  const { found, unreadable } = await count(meta, manager, from);
  const named: NamedRows[] = [];
  const failed: RowsHandedOver['failed'] = [];
  for (const connection of found) {
    const moving = connection.columns.filter((column) => !column.private);
    if (moving.length === 0) continue;
    try {
      const moved = await connection.db.transaction().execute(async (trx) => {
        const done: NamedRows[] = [];
        for (const { private: _private, ...column } of moving) {
          const result = await trx
            .updateTable(column.tableId as never)
            .set({ [column.column]: to } as never)
            .where(sql.ref(column.column), '=', from)
            .executeTakeFirst();
          done.push({ ...column, rows: Number(result.numUpdatedRows ?? 0) });
        }
        return done;
      });
      named.push(...moved.filter((one) => one.rows > 0));
    } catch {
      failed.push({ connectionId: connection.connectionId, connectionName: connection.connectionName });
    }
  }
  return { named, private: found.some((one) => one.columns.some((column) => column.private)), unreadable, failed, total: named.reduce((sum, one) => sum + one.rows, 0) };
}

/** The tables a hand-over would move rows of: what the taker must be able to read. */
export async function tablesHandedOver(meta: MetaDb, manager: ConnectionManager, from: string): Promise<{ connectionId: string; tableId: string; tableLabel: string }[]> {
  const seen = new Set<string>();
  return (await rowsNaming(meta, manager, from)).named.flatMap((one) => {
    const key = `${one.connectionId}\u0000${one.tableId}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ connectionId: one.connectionId, tableId: one.tableId, tableLabel: one.tableLabel }];
  });
}
