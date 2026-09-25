// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The schema tools: which databases are connected, and what one of them holds.
 *
 * Both answer only what the ACTING PERSON may read. The predicate is the same
 * one the data routes ask on every request, resolved once per connection for
 * this turn — so a table somebody cannot open in the grid is a table the
 * assistant does not know exists, and a turn that carries no person at all
 * sees nothing.
 */

import { loadSnapshotView } from '../../data-io/snapshot-view.js';
import type { SnapshotView } from '../../crud/identifiers.js';
import { codesMaskedView } from '../../crud/mask.js';
import type { AssistantTool, AssistantToolDeps, CanReadTable } from '../types.js';

/** Tables one `describe_schema` answer may carry. */
export const SCHEMA_TABLE_MAX = 200;

/** A connection whose snapshot cannot be loaded is reported, not thrown. */
export async function viewOrError(
  deps: AssistantToolDeps,
  connectionId: string,
): Promise<{ view: SnapshotView } | { error: { code: string; message: string } }> {
  const connection = await deps.manager.connections.findById(connectionId);
  if (connection === null) {
    return { error: { code: 'CONNECTION_NOT_FOUND', message: `No connection has the id ${JSON.stringify(connectionId)}.` } };
  }
  try {
    // No code Adminium makes (a shared link's) is ever read into an answer: it would leave the instance.
    return { view: codesMaskedView(await loadSnapshotView(deps.meta, connectionId)) };
  } catch {
    return {
      error: {
        code: 'NO_SNAPSHOT',
        message: `The connection ${JSON.stringify(connection.name)} has not been introspected yet, so it has no schema to read.`,
      },
    };
  }
}

/** The tables of one connection this person may read, in snapshot order. */
export async function readableTablesOf(view: SnapshotView, canRead: CanReadTable): Promise<string[]> {
  const out: string[] = [];
  for (const table of view.model.tables) {
    // The same two exclusions `/data` makes: a system table and one the
    // operator un-checked are not addressable at all, so they are not
    // readable here either, whatever a grant says.
    if (table.system || table.excluded === true) continue;
    if (await canRead(table.id)) out.push(table.id);
  }
  return out;
}

export const listConnectionsTool: AssistantTool = {
  name: 'list_connections',
  description: 'The connected databases, with how many of their tables you may read.',
  args: { type: 'object', properties: {}, additionalProperties: false },
  async run(_args, deps) {
    const rows = await deps.manager.connections.list();
    const connections: { id: string; name: string; engine: string; readableTables: number }[] = [];
    for (const row of rows) {
      if (row.disabled) continue;
      const resolved = await viewOrError(deps, row.id);
      if ('error' in resolved) {
        connections.push({ id: row.id, name: row.name, engine: row.engine, readableTables: 0 });
        continue;
      }
      const canRead = await deps.canReadTable(row.id);
      const tables = await readableTablesOf(resolved.view, canRead);
      connections.push({ id: row.id, name: row.name, engine: row.engine, readableTables: tables.length });
    }
    return { result: { connections } };
  },
};

export const describeSchemaTool: AssistantTool = {
  name: 'describe_schema',
  description: `The tables you may read on one connection (at most ${String(SCHEMA_TABLE_MAX)}): columns with their types, which are nullable, which are primary keys, which hold personal data, and the foreign keys between them.`,
  args: {
    type: 'object',
    properties: {
      connectionId: { type: 'string' },
      tables: { type: 'array', items: { type: 'string' }, description: 'Narrow to these tables; omit for all of them.' },
    },
    required: ['connectionId'],
    additionalProperties: false,
  },
  async run(args, deps) {
    const connectionId = typeof args.connectionId === 'string' ? args.connectionId : '';
    if (connectionId === '') {
      return { error: { code: 'BAD_ARGS', message: 'describe_schema needs a `connectionId`.' } };
    }
    const resolved = await viewOrError(deps, connectionId);
    if ('error' in resolved) return { error: resolved.error };
    const view = resolved.view;
    const canRead = await deps.canReadTable(connectionId);

    const asked = Array.isArray(args.tables)
      ? args.tables.filter((name): name is string => typeof name === 'string')
      : null;
    const allowed = await readableTablesOf(view, canRead);
    const wanted = asked === null ? allowed : allowed.filter((id) => asked.includes(id));
    if (asked !== null && wanted.length === 0) {
      return {
        error: {
          code: 'TABLE_FORBIDDEN',
          message: `None of those tables is readable here. The ones you may read are: ${allowed.slice(0, 40).join(', ')}`,
        },
      };
    }

    const tables = wanted.slice(0, SCHEMA_TABLE_MAX).map((id) => {
      const table = view.table(id);
      return {
        id: table.id,
        primaryKey: table.primaryKey,
        readOnly: table.readOnly,
        columns: [...table.columns.values()]
          .filter((column) => !column.secret)
          .map((column) => ({
            name: column.name,
            type: column.logicalType,
            nullable: column.nullable,
            primaryKey: column.isPrimaryKey,
            // A masked column is readable as a COLUMN and never as a value:
            // saying so here stops the model asking for it and then being
            // surprised by nulls.
            personalData: column.masked,
          })),
        // Only the relations between tables this person may read: a foreign key
        // pointing at a table they cannot open names a table they cannot know
        // about.
        foreignKeys: view.model.relations
          .filter((relation) => relation.from.tableId === id && wanted.includes(relation.to.tableId))
          .map((relation) => ({
            columns: [...relation.from.columns],
            references: relation.to.tableId,
            referencedColumns: [...relation.to.columns],
          })),
      };
    });

    return {
      result: { connectionId, tables, omitted: Math.max(wanted.length - tables.length, 0) },
      tables: tables.map((table) => `${connectionId}.${table.id}`),
    };
  },
};
