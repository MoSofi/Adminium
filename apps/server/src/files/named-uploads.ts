// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Whether a row already names an upload the sweep is about to bin.
 *
 * An upload is attached by the post-commit reconcile of the write that names
 * it. That hook never throws (`reconcile.ts`): a meta store that was down for
 * a moment leaves the row saved and the upload unattached, and the sweep would
 * bin it a day later while the row still shows it. So before binning, the
 * sweep asks the upload's connection: does a row's file column name it? If one
 * does, the upload is that row's, as the reconcile would have made it.
 *
 * An upload records its connection but not the table it was made for, so every
 * file column of the connection is asked, once a pass per column. When the
 * answer cannot be had (the database is not reachable), the upload is kept: a
 * sweep that is unsure leaves the file for the next day.
 */
import type { FastifyBaseLogger } from 'fastify';
import { sql, type Kysely, type SqlBool } from 'kysely';
import { parseDatabaseModel } from '@adminium/engine';
import { overridesRepo, snapshotsRepo, type MetaDb, type RecordRef, type StoredFile } from '@adminium/meta';

import { addOnTablesFor } from '../apps/add-on-tables.js';
import type { ConnectionManager, SourceDatabase } from '../connections/manager.js';
import { applyOverrides } from '../connections/effective-schema.js';
import { SnapshotView, type ResolvedTable } from '../crud/identifiers.js';
import { pkLabel } from '../crud/records.js';
import { ruledBlocksOf, type ColumnBlockReader } from './column-blocks.js';
import type { DestinationResolver } from './destinations.js';
import { parseRefList } from './refs.js';

/** The row that names the upload; `null` when none does; `'unsure'` when the connection could not be asked. */
export type NamedBy = RecordRef | null | 'unsure';

export interface NamedUploads {
  namedBy(file: StoredFile): Promise<NamedBy>;
}

export interface NamedUploadsDeps {
  meta: MetaDb;
  manager: Pick<ConnectionManager, 'data'>;
  blocks: ColumnBlockReader;
  destinations: DestinationResolver;
  logger?: FastifyBaseLogger | undefined;
}

interface FileColumn {
  table: ResolvedTable;
  column: string;
}

/** One sweep pass: each connection's file columns are read once. */
export function createNamedUploads(deps: NamedUploadsDeps): NamedUploads {
  const columns = new Map<string, Promise<FileColumn[] | null>>();

  async function fileColumnsOf(connectionId: string): Promise<FileColumn[] | null> {
    const snapshot = await snapshotsRepo(deps.meta).latest(connectionId);
    if (snapshot === null) return null;
    const model = parseDatabaseModel(snapshot.schema);
    const active = await overridesRepo(deps.meta).listForConnection(connectionId, { status: 'active' });
    const view = new SnapshotView(connectionId, applyOverrides(model, active, { addOnTables: await addOnTablesFor(deps.meta, connectionId, model) }), new Map());
    const out: FileColumn[] = [];
    for (const { id } of view.model.tables) {
      const table = view.table(id);
      if (table.primaryKey.length === 0) continue;
      const names = new Set([...ruledBlocksOf(table.columns.values()).keys(), ...(await deps.blocks.forTable(connectionId, id)).byColumn.keys()]);
      for (const column of names) if (table.columns.has(column)) out.push({ table, column });
    }
    return out;
  }

  return {
    async namedBy(file) {
      const connectionId = file.entityConnectionId;
      if (connectionId === null) return null;
      try {
        if (!columns.has(connectionId)) columns.set(connectionId, fileColumnsOf(connectionId));
        const found = await columns.get(connectionId)!;
        if (found === null || found.length === 0) return null;
        const { db, dialect } = await deps.manager.data(connectionId);
        const bases = await deps.destinations.publicBases();
        const source = db as unknown as Kysely<SourceDatabase>;
        for (const { table, column } of found) {
          // As text, so a JSON list of files is searched as its values are written.
          const asText = dialect === 'mysql' ? sql`CAST(${sql.ref(column)} AS CHAR)` : sql`CAST(${sql.ref(column)} AS TEXT)`;
          const rows = await source
            .selectFrom(table.id)
            .select([...new Set([...table.primaryKey, column])].map((name) => sql.ref(name).as(name)))
            .where(sql<SqlBool>`(${asText} LIKE ${`%${file.id}%`} OR ${asText} LIKE ${`%${file.storageKey}%`})`)
            .limit(20)
            .execute();
          for (const row of rows as Record<string, unknown>[]) {
            const named = parseRefList(row[column], bases).some((ref) => (ref.kind === 'id' ? ref.id === file.id : ref.kind === 'key' && ref.key === file.storageKey));
            if (!named) continue;
            const pk = Object.fromEntries(table.primaryKey.map((name) => [name, row[name]]));
            return { connectionId, table: table.id, pk, label: pkLabel(table, pk) };
          }
        }
        return null;
      } catch (error) {
        deps.logger?.warn({ err: error, fileId: file.id, connectionId }, 'could not ask whether a row names an unattached upload; it is kept');
        return 'unsure';
      }
    },
  };
}
