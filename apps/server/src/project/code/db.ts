// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The `db` helper project code receives.
 *
 * `db.table(name)` reads and writes the way the dashboard does: every write
 * goes through the write service, so the project's hooks run, the audit trail
 * gets a row naming the person behind it, and automations hear about it.
 * It does not check that person's table permissions: the code is the owner's,
 * and an action's own `permission` is the gate.
 *
 * `db.raw` is Kysely for the same database, and skips all of that.
 */

import type { FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import type { Dialect } from '@adminium/engine';
import type { AutomationOrigin, Connection, MetaDb, RecordRef } from '@adminium/meta';

import type { ConnectionManager, SourceDatabase } from '../../connections/manager.js';
import { afterRecordWrite, type AfterRecordWriteInput, type RecordWriteAction } from '../../crud/after-record-write.js';
import type { ResolvedTable, SnapshotView } from '../../crud/identifiers.js';
import type { Row } from '../../crud/mask.js';
import { fetchByPk, pkLabel } from '../../crud/records.js';
import {
  bindValue,
  type RecordWriteService,
  type WriteContext,
  type WriteTarget,
} from '../../crud/write-service.js';
import { normalizeWriteValue } from '../../crud/write-values.js';
import { loadSnapshotView } from '../../data-io/snapshot-view.js';
import type { FileReconciler } from '../../files/reconcile.js';
import { getPrincipal } from '../../rbac/principal.js';
import type { AnyRecord, ListOptions, ProjectDb, ProjectTable, RawDatabase, RecordId } from './define.js';

export const DEFAULT_LIST_LIMIT = 100;
export const MAX_LIST_LIMIT = 1000;

export interface ProjectDbDeps {
  app: FastifyInstance;
  meta: MetaDb;
  manager: ConnectionManager;
  /** Read when a write happens: the service and the hooks are built from each other. */
  writes: () => RecordWriteService;
  files?: FileReconciler | undefined;
}

export interface ProjectDbScope {
  /** The database the code belongs to. */
  database: string;
  /** Kysely for that database, and its dialect. */
  raw: Kysely<SourceDatabase>;
  dialect: Dialect;
  /** What this code's writes carry: origin, hops and who is behind them. */
  context: WriteContext;
}

interface Resolved {
  connection: Connection;
  view: SnapshotView;
  table: ResolvedTable;
  target: WriteTarget;
}

/** The primary key a `RecordId` names. */
export function recordKey(table: ResolvedTable, id: RecordId): Row {
  if (table.primaryKey.length === 0) {
    throw new Error(`${table.id} has no primary key, so its records cannot be picked out one by one.`);
  }
  if (typeof id === 'object' && id !== null) {
    const pk: Row = {};
    for (const column of table.primaryKey) {
      if (!(column in id)) throw new Error(`The id for ${table.id} needs a value for ${column}.`);
      pk[column] = (id as Record<string, unknown>)[column];
    }
    return pk;
  }
  if (table.primaryKey.length > 1) {
    throw new Error(`${table.id} has a key of several columns (${table.primaryKey.join(', ')}); pass the id as an object.`);
  }
  return { [table.primaryKey[0] as string]: id };
}

function refOf(connectionId: string, table: ResolvedTable, row: Row): RecordRef {
  const pk = Object.fromEntries(table.primaryKey.map((column) => [column, row[column]]));
  return { connectionId, table: table.id, pk, label: pkLabel(table, pk) };
}

/** The audit attribution for a write made by project code. */
function attribution(context: WriteContext): Pick<AfterRecordWriteInput, 'request' | 'actor'> {
  if (context.request !== null && getPrincipal(context.request) !== null) return { request: context.request };
  const actor = context.actor;
  const kind = actor === null || actor.kind === 'public' ? 'api-key' : actor.kind;
  return {
    request: null,
    actor: {
      id: actor?.id ?? null,
      label: actor?.label ?? 'Project code',
      kind: actor === null ? 'system' : kind,
    },
  };
}

export function createProjectDb(deps: ProjectDbDeps, scope: ProjectDbScope): ProjectDb {
  const connections = new Map<string, Promise<Connection>>();
  const views = new Map<string, Promise<SnapshotView>>();

  function connectionFor(database: string): Promise<Connection> {
    let found = connections.get(database);
    if (found === undefined) {
      found = deps.manager.connections
        .findByProjectKey(database)
        .then((connection) => {
          if (connection === null) throw new Error(`There is no database "${database}" in adminium.config.ts.`);
          return connection;
        });
      connections.set(database, found);
    }
    return found;
  }

  function viewFor(connectionId: string): Promise<SnapshotView> {
    let found = views.get(connectionId);
    if (found === undefined) {
      found = loadSnapshotView(deps.meta, connectionId);
      views.set(connectionId, found);
    }
    return found;
  }

  async function resolve(name: string, database: string): Promise<Resolved> {
    const connection = await connectionFor(database);
    const view = await viewFor(connection.id);
    const table = view.table(name);
    const handle =
      database === scope.database ? { db: scope.raw, dialect: scope.dialect } : await deps.manager.data(connection);
    return {
      connection,
      view,
      table,
      target: { connectionId: connection.id, view, table, db: handle.db, dialect: handle.dialect },
    };
  }

  function writable(resolved: Resolved): void {
    if (resolved.connection.readOnly) {
      throw new Error(`The database "${resolved.connection.projectKey ?? resolved.connection.name}" is read-only in Adminium.`);
    }
    if (resolved.table.readOnly) throw new Error(`${resolved.table.id} is read-only: it is a view, or has no primary key.`);
  }

  function valuesFor(resolved: Resolved, values: AnyRecord): Row {
    const out: Row = {};
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) continue;
      const column = resolved.table.columns.get(key);
      if (column === undefined) throw new Error(`${resolved.table.id} has no column "${key}".`);
      out[key] = bindValue(resolved.target.dialect, normalizeWriteValue(column, value));
    }
    return out;
  }

  const origin: AutomationOrigin = scope.context.origin === 'action' ? 'action' : 'hook';

  function announce(resolved: Resolved, action: RecordWriteAction, entityRow: Row, before: Row | null, after: Row | null) {
    return afterRecordWrite(deps.app, {
      ...attribution(scope.context),
      meta: deps.meta,
      connectionId: resolved.connection.id,
      table: resolved.table,
      action,
      entity: refOf(resolved.connection.id, resolved.table, entityRow),
      before,
      after,
      origin,
      hops: scope.context.hops,
      files: deps.files,
    });
  }

  function table<R extends AnyRecord>(name: string, options: { database?: string } = {}): ProjectTable<R> {
    const database = options.database ?? scope.database;
    const resolving = (): Promise<Resolved> => resolve(name, database);

    return {
      async get(id) {
        const resolved = await resolving();
        const row = await fetchByPk(resolved.target.db, resolved.table, recordKey(resolved.table, id));
        return (row ?? null) as R | null;
      },

      async list(listOptions: ListOptions<R> = {}) {
        const resolved = await resolving();
        const { db } = resolved.target;
        const columnOf = (key: string): string => {
          if (!resolved.table.columns.has(key)) throw new Error(`${resolved.table.id} has no column "${key}".`);
          return key;
        };
        let query = db.selectFrom(resolved.table.id).selectAll();
        for (const [key, value] of Object.entries(listOptions.where ?? {})) {
          if (value === undefined) continue;
          const ref = db.dynamic.ref(columnOf(key));
          query =
            value === null
              ? query.where(ref, 'is', null as never)
              : query.where(ref, '=', bindValue(resolved.target.dialect, value) as never);
        }
        if (listOptions.orderBy !== undefined) {
          const descending = listOptions.orderBy.startsWith('-');
          const key = columnOf(descending ? listOptions.orderBy.slice(1) : listOptions.orderBy);
          query = query.orderBy(db.dynamic.ref(key), descending ? 'desc' : 'asc');
        }
        const limit = Math.min(Math.max(Math.trunc(listOptions.limit ?? DEFAULT_LIST_LIMIT), 1), MAX_LIST_LIMIT);
        query = query.limit(limit);
        if (listOptions.offset !== undefined && listOptions.offset > 0) query = query.offset(Math.trunc(listOptions.offset));
        return (await query.execute()) as R[];
      },

      async insert(values) {
        const resolved = await resolving();
        writable(resolved);
        const row = await deps.writes().create({
          target: resolved.target,
          values: valuesFor(resolved, values),
          context: scope.context,
          announce: (stored) => announce(resolved, 'create', stored, null, stored),
        });
        return row as R;
      },

      async update(id, values) {
        const resolved = await resolving();
        writable(resolved);
        const pk = recordKey(resolved.table, id);
        const before = await fetchByPk(resolved.target.db, resolved.table, pk);
        if (before === undefined) return null;
        const outcome = await deps.writes().update({
          target: resolved.target,
          pk,
          values: valuesFor(resolved, values),
          before,
          context: scope.context,
          announce: ({ after }) => announce(resolved, 'update', before, before, after ?? before),
        });
        return (outcome.after ?? null) as R | null;
      },

      async delete(id) {
        const resolved = await resolving();
        writable(resolved);
        const pk = recordKey(resolved.table, id);
        const before = await fetchByPk(resolved.target.db, resolved.table, pk);
        if (before === undefined) return false;
        const count = await deps.writes().delete({
          target: resolved.target,
          pk,
          before,
          context: scope.context,
          announce: () => announce(resolved, 'delete', before, before, null),
        });
        return count > 0;
      },
    };
  }

  return {
    table,
    raw: scope.raw as RawDatabase,
    async rawFor(database) {
      if (database === scope.database) return scope.raw as RawDatabase;
      const connection = await connectionFor(database);
      return (await deps.manager.data(connection)).db as RawDatabase;
    },
  };
}
