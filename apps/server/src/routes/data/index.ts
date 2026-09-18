// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The generated CRUD API (`routes/data/`): list (filter DSL + `q` +
 * keyset/offset), get (+ inbound counts), the cascade preflight,
 * create/update/delete, bulk, and undo.
 *
 * Invariants: every table/column string that reaches SQL is the schema snapshot's
 * own; RBAC (`table:<conn>:<schema.table>:<action>`) runs after identifier
 * resolution; PII columns mask for callers without the unmask grant; every
 * mutation is audited with a RecordRef and fans out on
 * `table:<connectionId>:<schema.table>` when the realtime hub is wired.
 */

import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { optionListsRepo, overridesRepo, snapshotsRepo, type MetaDb, type RecordRef } from '@adminium/meta';
import type { DatabaseModel, Dialect } from '@adminium/engine';
import { builtinOptionValues } from '@adminium/engine/config';
import type { Kysely } from 'kysely';

import { AppError, ConflictError, ForbiddenError, NotFoundError, ValidationFailedError } from '../../errors.js';
import { applyOverrides } from '../../connections/effective-schema.js';
import type { ConnectionManager, SourceDatabase } from '../../connections/manager.js';
import { SnapshotView, type ResolvedTable } from '../../crud/identifiers.js';
import { applyDerivedFields } from '../../crud/derive.js';
import { applyMeasureMask, fetchMeasureValues } from '../../crud/measures.js';
import { runList } from '../../crud/list.js';
import { applyLookupMask, fetchLookupValues } from '../../crud/lookups.js';
import {
  resolveProjections,
  type ProjectionRefusal,
  type Projections,
} from '../../crud/projections.js';
import { canReadPii, maskRow, type Row } from '../../crud/mask.js';
import {
  fetchByPk,
  parseRecordId,
  pkLabel,
  referenceCounts,
  type ReferenceCount,
} from '../../crud/records.js';
import { readDbRefusal } from '../../crud/db-errors.js';
import { labelColumnFor } from '../../crud/labels.js';
import {
  rowsEqual,
  UndoStore,
  type UndoAction,
  type UndoChildren,
  type UndoEntry,
  type UndoLinks,
} from '../../crud/undo.js';
import {
  afterRecordWrite,
  emitRecordEvent,
  type RecordWriteAction,
} from '../../crud/after-record-write.js';
import type { FileReconciler } from '../../files/reconcile.js';
import { normalizeWriteValue } from '../../crud/write-values.js';
import { diffLinks, resolveLink, sameKeys, type ResolvedLink } from '../../crud/links.js';
import {
  diffChildRows,
  MAX_CHILD_ROWS,
  resolveChild,
  type ChildDiff,
  type RequestedChildRow,
  type ResolvedChild,
} from '../../crud/child-rows.js';
import { availabilityColumns, readAvailability } from '../../crud/availability.js';

/**
 * How many links one record's field reads and replaces.
 *
 * A record with more links than this has an association LIST, not a field:
 * the picker cannot draw two thousand chips and nobody can review them in a
 * dialog. The read says `hasMore`, and the related tab is where that record's
 * links are actually managed.
 */
const LINK_READ_CAP = 200;
import {
  createWriteService,
  deleteRows,
  insertRow,
  insertRows,
  requestWriteContext,
  uncheckedForUndo,
  updateRows,
  type PreparedRow,
  type RecordWriteService,
  type WriteAction,
  type WriteContext,
  type WriteTarget,
  type WrittenRow,
} from '../../crud/write-service.js';
import {
  dataRecordParams,
  dataTableParams,
  recordBulkBody,
  recordBulkReply,
  recordCreateBody,
  recordDeleteQuery,
  recordDeleteReply,
  recordGetQuery,
  recordListQuery,
  availabilityQuery,
  availabilityReply,
  recordLinksParams,
  recordLinksQuery,
  recordLinksReply,
  recordListReply,
  recordMutationReply,
  recordReply,
  recordUpdateBody,
  referencesReply,
  undoParams,
  undoReply,
} from './schema.js';

type TableAction = 'read' | 'create' | 'update' | 'delete';

/** What an undo does to the rows: a deleted row comes back, a created one goes. */
const UNDO_WRITE: Record<UndoAction, WriteAction> = { create: 'delete', update: 'update', delete: 'create' };

/**
 * The columns a bulk update changed. Hooks may add columns to some rows, and
 * the undo must put every one of them back.
 */
function changedColumns(values: Row, prepared: readonly PreparedRow[]): string[] {
  const columns = new Set(Object.keys(values));
  for (const row of prepared) for (const key of Object.keys(row.values)) columns.add(key);
  return [...columns];
}

export interface DataRoutesDeps {
  manager: ConnectionManager;
  meta: MetaDb;
  /** Injectable for TTL tests; a fresh store otherwise. */
  undoStore?: UndoStore | undefined;
  /**
   * Keeps `adminium_files` in step with what the customer's own file columns
   * say. ABSENT ⇒ no file behaviour at all, which is what every test that
   * predates 37 gets and is why they are unchanged: a store with no file
   * columns configured reconciles nothing.
   */
  files?: FileReconciler | undefined;
  /** Where every write goes, with the project's hooks. A service with no hooks otherwise. */
  writes?: RecordWriteService | undefined;
}

interface DataContext {
  connectionId: string;
  view: SnapshotView;
  table: ResolvedTable;
  db: Kysely<SourceDatabase>;
  dialect: Dialect;
  unmasked: boolean;
  target: WriteTarget;
}

/**
 * PG SQLSTATE / MySQL errno symbol / SQLite message → envelope codes for
 * inline form errors.
 *
 * Unique and foreign-key keep the shapes they have always had. Everything else
 * used to be rethrown, which the global handler answered as HTTP 500
 * `INTERNAL` with no column named — a NOT NULL, CHECK, enum, length or type
 * refusal told the person filling in the form nothing at all. With the target
 * TABLE in hand, `crud/db-errors.ts` reads those and this raises 422
 * `VALIDATION_FAILED` with `details.fields`, which the dashboard renders under
 * the field. The table is optional only because the export predates it.
 */
export function mapDbError(error: unknown, table?: ResolvedTable): never {
  const dbError = error as { code?: string; detail?: string; constraint?: string; message?: string };
  const message = typeof dbError.message === 'string' ? dbError.message : '';
  if (
    dbError.code === '23505' ||
    dbError.code === 'ER_DUP_ENTRY' ||
    message.includes('UNIQUE constraint failed')
  ) {
    throw new ConflictError('A record with this value already exists.', 'UNIQUE_VIOLATION', {
      constraint: dbError.constraint ?? null,
      detail: dbError.detail ?? null,
    });
  }
  if (
    dbError.code === '23503' ||
    dbError.code === 'ER_NO_REFERENCED_ROW' ||
    dbError.code === 'ER_NO_REFERENCED_ROW_2' ||
    dbError.code === 'ER_ROW_IS_REFERENCED' ||
    dbError.code === 'ER_ROW_IS_REFERENCED_2' ||
    message.includes('FOREIGN KEY constraint failed')
  ) {
    throw new ConflictError('The change violates a foreign-key constraint.', 'FK_VIOLATION', {
      constraint: dbError.constraint ?? null,
      detail: dbError.detail ?? null,
    });
  }
  if (table !== undefined) {
    const refusal = readDbRefusal(error, table);
    if (refusal !== null) {
      // The WORDS are chosen on the client from the code, so a
      // translated screen never shows the server's English.
      throw new ValidationFailedError(
        'Some values were refused.',
        refusal.column === null
          ? { code: refusal.code }
          : { fields: { [refusal.column]: { code: refusal.code } } },
      );
    }
  }
  throw error as Error;
}

/** The row primitive now lives with every other source write. */
export { insertRow } from '../../crud/write-service.js';

export function dataRoutes(deps: DataRoutesDeps): FastifyPluginAsyncZod {
  const { manager, meta } = deps;
  const undoStore = deps.undoStore ?? new UndoStore();
  const writes = deps.writes ?? createWriteService();
  const snapshots = snapshotsRepo(meta);
  const overrides = overridesRepo(meta);
  const lists = optionListsRepo(meta);
  const viewCache = new Map<string, { stamp: string; view: SnapshotView }>();

  async function viewFor(connectionId: string): Promise<SnapshotView> {
    const snapshot = await snapshots.latest(connectionId);
    if (snapshot === null) {
      throw new NotFoundError('No schema snapshot — introspect the connection first.', { connectionId });
    }
    const active = await overrides.listForConnection(connectionId, { status: 'active' });
    const last = active.at(-1);
    /*
     * The OPTION LISTS' revision is part of the stamp.
     *
     * A `column.options` rule that names a list is enforced from the list's
     * values, and the list lives in another table — so a view keyed only on the
     * snapshot and the override set would go on refusing a value somebody added
     * to the list a moment ago, until something else happened to move the stamp.
     * That is finding C7's stale memo wearing a different hat.
     */
    const listRevision = await lists.revision();
    const stamp = `${snapshot.id}:${String(active.length)}:${last?.id ?? ''}:${String(last?.updatedAt ?? 0)}:${listRevision}`;
    const cached = viewCache.get(connectionId);
    if (cached !== undefined && cached.stamp === stamp) return cached.view;
    const view = new SnapshotView(
      connectionId,
      applyOverrides(snapshot.schema as DatabaseModel, active),
      await listValuesFor(active),
    );
    viewCache.set(connectionId, { stamp, view });
    return view;
  }

  /**
   * The VALUES of every list a rule on this connection names, resolved once per
   * view rather than per write.
   *
   * Built-ins answer from code; a custom list answers from the store. A rule
   * naming a list that no longer exists contributes NOTHING — the column goes
   * back to accepting anything, which is the same degradation a rule this build
   * cannot read gets, and the alternative is a column nobody can write to
   * because of a list somebody deleted.
   */
  async function listValuesFor(
    active: readonly { op: string; value: Record<string, unknown> }[],
  ): Promise<Map<string, readonly string[]>> {
    const keys = new Set<string>();
    for (const row of active) {
      if (row.op !== 'column.options') continue;
      const key = (row.value as { list?: unknown }).list;
      if (typeof key === 'string') keys.add(key);
    }
    const resolved = new Map<string, readonly string[]>();
    for (const key of keys) {
      const builtin = builtinOptionValues(key);
      if (builtin !== null) {
        resolved.set(key, builtin);
        continue;
      }
      const stored = await lists.findByKey(key);
      if (stored !== null) resolved.set(key, stored.items.map((item) => item.value));
    }
    return resolved;
  }

  return async (app) => {
    function principalId(request: FastifyRequest): string | null {
      const user = (request as unknown as { user?: { id?: string } }).user;
      return user?.id ?? request.apiKeyPrincipal?.id ?? null;
    }

    async function contextFor(request: FastifyRequest, action: TableAction): Promise<DataContext> {
      const { connectionId, table: tableParam } = request.params as {
        connectionId: string;
        table: string;
      };
      const connection = await manager.mustFind(connectionId);
      const view = await viewFor(connectionId);
      // Identifier resolution FIRST, then RBAC on the resolved name.
      const table = view.table(tableParam);
      const permission = `table:${connectionId}:${table.id}:${action}`;
      if (!(await request.can(permission))) {
        await app.rbac.audit(request, {
          category: 'rbac',
          action: 'permission.denied',
          connectionId,
          changes: { after: { permission, method: request.method, url: request.url } },
        });
        throw new ForbiddenError('You do not have access to this table.', 'TABLE_FORBIDDEN', {
          permission,
        });
      }
      if (action !== 'read') {
        if (connection.readOnly) {
          throw new ForbiddenError(
            'This connection is read-only — Adminium never writes to it.',
            'READ_ONLY_MODE',
            { connectionId },
          );
        }
        if (table.readOnly) {
          throw new ForbiddenError(
            'This table has no primary key (or is a view) and is read-only.',
            'READ_ONLY_MODE',
            { table: table.id },
          );
        }
      }
      // The row is already in hand from `mustFind` above — passing it spares
      // this path a second primary-key read on every CRUD request.
      const { db, dialect } = await manager.data(connection);
      return {
        connectionId,
        view,
        table,
        db,
        dialect,
        unmasked: await canReadPii(request),
        target: { connectionId, view, table, db, dialect },
      };
    }

    /**
     * Refuse a write whose file columns do not hold what they are configured
     * to hold — a `multiple` column handed a non-array, or a list past the
     * column's `maxCount`.
     *
     * PRE-COMMIT, and it is the only file check that can be: the reconcile
     * hook runs after the row is written and is forbidden from throwing, so a
     * cap enforced there would be reported after being exceeded.
     *
     * No-op when the table has no `multiple` file column, which is every table
     * that predates 38 — so nothing existing pays for this beyond one cached
     * block lookup.
     */
    async function assertFileColumns(ctx: DataContext, values: Row): Promise<void> {
      if (deps.files === undefined) return;
      const problem = await deps.files.validateWrite({
        connectionId: ctx.connectionId,
        table: ctx.table.id,
        values,
      });
      if (problem === null) return;
      if (problem.reason === 'too-many') {
        throw new ValidationFailedError(
          `${problem.column} accepts at most ${String(problem.maxCount)} file(s); this record would have ${String(problem.count)}.`,
          { column: problem.column, maxCount: problem.maxCount, count: problem.count },
        );
      }
      throw new ValidationFailedError(
        `${problem.column} stores a list of files, so its value must be a JSON array.`,
        { column: problem.column },
      );
    }

    /** Allowlist incoming row keys against the snapshot (422 otherwise). */
    function allowlistValues(ctx: DataContext, values: Row): Row {
      const entries = Object.entries(values);
      if (entries.length === 0) {
        throw new ValidationFailedError('`values` must contain at least one column.', {});
      }
      const out: Row = {};
      for (const [key, value] of entries) {
        const column = ctx.view.column(ctx.table, key); // 422 unknown/secret
        // Zoned instants aimed at naive timestamp columns re-encode to the
        // server-local wall clock — see crud/write-values.ts for the drift
        // this prevents. (Undo binds driver Date objects and is unaffected.)
        out[column.name] = normalizeWriteValue(column, value);
      }
      return out;
    }

    function pkFromLoose(table: ResolvedTable, id: unknown): Row {
      if (table.primaryKey.length === 1) {
        const name = table.primaryKey[0] as string;
        return { [name]: id };
      }
      if (typeof id === 'object' && id !== null && !Array.isArray(id)) {
        const pk: Row = {};
        for (const name of table.primaryKey) {
          const value = (id as Row)[name];
          if (value === undefined) {
            throw new ValidationFailedError(`Bulk id missing PK component ${JSON.stringify(name)}.`, {});
          }
          pk[name] = value;
        }
        return pk;
      }
      throw new ValidationFailedError('Composite-PK bulk ids must be objects.', { expected: table.primaryKey });
    }

    function recordRef(ctx: DataContext, pk: Row): RecordRef {
      return { connectionId: ctx.connectionId, table: ctx.table.id, pk, label: pkLabel(ctx.table, pk) };
    }

    /**
     * Every single-row write ends here, and here is now a thin call into
     * `crud/after-record-write.ts` — the body moved out so the bulk route,
     * the public surface and the automation runner reach the same downstream.
     * What stays is the origin: a write made through this route is
     * `dashboard`, which is the origin whose rules wait out the undo window.
     */
    async function afterMutation(
      request: FastifyRequest,
      ctx: DataContext,
      action: RecordWriteAction,
      entity: RecordRef,
      before: Row | null,
      after: Row | null,
    ): Promise<void> {
      await afterRecordWrite(app, {
        request,
        connectionId: ctx.connectionId,
        table: ctx.table,
        action,
        entity,
        before,
        after,
        origin: 'dashboard',
        files: deps.files,
      });
    }

    /**
     * A relation named by a write: resolved, authorized, and asked whether its
     * table has hooks.
     *
     * Everything that can be decided BEFORE the transaction is decided here —
     * which table and columns, whether this caller may add, whether they may
     * remove, and whether a before hook is waiting on the link table. The DIFF
     * is taken inside the transaction, against the set that is really there;
     * a removal this caller was never allowed to make is refused rather than
     * quietly skipped, which is why both answers ride along.
     */
    interface RequestedLink {
      link: ResolvedLink;
      /** The target keys the request wants this record linked to. */
      wanted: string[];
      canAdd: boolean;
      canRemove: boolean;
      /** The link table has a before hook, so its rows cannot be written blind. */
      hooked: boolean;
    }

    /** The link table as a write target — same connection, same transaction. */
    function linkTargetOf(ctx: DataContext, link: ResolvedLink, db: Kysely<SourceDatabase>): WriteTarget {
      return {
        connectionId: ctx.connectionId,
        view: ctx.view,
        table: link.linkTable,
        db,
        dialect: ctx.dialect,
      };
    }

    async function requestedLinks(
      request: FastifyRequest,
      ctx: DataContext,
      context: WriteContext,
      raw: Record<string, (string | number)[]> | undefined,
    ): Promise<RequestedLink[]> {
      if (raw === undefined) return [];
      const out: RequestedLink[] = [];
      for (const [relationId, keys] of Object.entries(raw)) {
        const resolution = resolveLink(ctx.view, ctx.table, relationId);
        if (!resolution.ok) {
          // The reason IS the message: a relation that cannot be written is
          // something an operator can act on, and `fields` puts it under the
          // relation rather than under an innocent column.
          throw new ValidationFailedError(resolution.refusal.reason, {
            fields: { [relationId]: { code: 'not-allowed' } },
            relation: relationId,
          });
        }
        const { link } = resolution;
        out.push({
          link,
          wanted: keys.map((key) => String(key)),
          canAdd: await request.can(`table:${ctx.connectionId}:${link.linkTable.id}:create`),
          canRemove: await request.can(`table:${ctx.connectionId}:${link.linkTable.id}:delete`),
          hooked: await writes.wants('before', 'create', linkTargetOf(ctx, link, ctx.db), context),
        });
      }
      return out;
    }

    /**
     * A child relation named by a write: resolved, authorized, and asked
     * whether its table has hooks.
     *
     * Everything decidable BEFORE the transaction is decided here. The grants
     * are the CHILD table's, not the parent's: a line-items field writes real
     * rows into a real table, and trusting the parent's `create` would write
     * them for a caller who was never given that table.
     */
    interface RequestedChildren {
      child: ResolvedChild;
      rows: RequestedChildRow[];
      canCreate: boolean;
      canUpdate: boolean;
      canDelete: boolean;
      /** The child table has a before hook, so its rows cannot be written blind. */
      hooked: boolean;
    }

    function childTargetOf(
      ctx: DataContext,
      child: ResolvedChild,
      db: Kysely<SourceDatabase>,
    ): WriteTarget {
      return {
        connectionId: ctx.connectionId,
        view: ctx.view,
        table: child.child,
        db,
        dialect: ctx.dialect,
      };
    }

    async function requestedChildren(
      request: FastifyRequest,
      ctx: DataContext,
      context: WriteContext,
      raw: Record<string, { key?: Row | undefined; values: Row }[]> | undefined,
    ): Promise<RequestedChildren[]> {
      if (raw === undefined) return [];
      const out: RequestedChildren[] = [];
      for (const [relationId, rows] of Object.entries(raw)) {
        const resolution = resolveChild(ctx.view, ctx.table, relationId);
        if (!resolution.ok) {
          throw new ValidationFailedError(resolution.refusal.reason, {
            fields: { [relationId]: { code: 'not-allowed' } },
            relation: relationId,
          });
        }
        const { child } = resolution;
        const id = child.child.id;
        out.push({
          child,
          rows: rows.map((row) => ({
            ...(row.key === undefined ? {} : { key: row.key }),
            values: allowlistChild(ctx, child, row.values),
          })),
          canCreate: await request.can(`table:${ctx.connectionId}:${id}:create`),
          canUpdate: await request.can(`table:${ctx.connectionId}:${id}:update`),
          canDelete: await request.can(`table:${ctx.connectionId}:${id}:delete`),
          hooked: await writes.wants('before', 'create', childTargetOf(ctx, child, ctx.db), context),
        });
      }
      return out;
    }

    /**
     * A child row's values, allowlisted against the CHILD's own columns.
     *
     * The foreign key is stripped rather than refused: the parent decides it,
     * and a request naming it is describing a row that belongs to a different
     * parent — which a field on this one has no business writing.
     */
    function allowlistChild(ctx: DataContext, child: ResolvedChild, values: Row): Row {
      const out: Row = {};
      for (const [key, value] of Object.entries(values)) {
        if (key === child.foreignColumn) continue;
        const column = ctx.view.column(child.child, key);
        out[column.name] = normalizeWriteValue(column, value);
      }
      return out;
    }

    /** The child rows one parent has right now. */
    async function currentChildren(
      db: Kysely<SourceDatabase>,
      child: ResolvedChild,
      parentKey: unknown,
    ): Promise<Row[]> {
      const rows = await db
        .selectFrom(child.child.id)
        .selectAll()
        .where((eb) => eb(db.dynamic.ref(child.foreignColumn), '=', parentKey))
        .limit(MAX_CHILD_ROWS)
        .execute();
      return rows as Row[];
    }

    /**
     * Bring one parent's child rows in line with the request, inside the
     * caller's transaction. Returns what changed, for the undo entry.
     *
     * Every row goes through the write service — fills, rules, hooks — because
     * a child row is a record and the rules on its columns are the table's, not
     * this field's. `prepared` are the rows a hooked table already ran through
     * it OUTSIDE the transaction, for the same reason links do it: a hook
     * writing through its own connection would wait for this very transaction
     * on SQLite.
     */
    async function applyChildren(
      ctx: DataContext,
      db: Kysely<SourceDatabase>,
      requested: RequestedChildren,
      parentKey: unknown,
      context: WriteContext,
      options: { existing?: Row[] | undefined } = {},
    ): Promise<UndoChildren> {
      const { child } = requested;
      const target = childTargetOf(ctx, child, db);
      const existing = options.existing ?? (await currentChildren(db, child, parentKey));
      const diff: ChildDiff = diffChildRows(child.child.primaryKey, existing, requested.rows);

      const refuse = (action: string): never => {
        throw new ForbiddenError(
          `You do not have permission to ${action} rows of ${child.child.name}.`,
          'TABLE_FORBIDDEN',
          { permission: `table:${ctx.connectionId}:${child.child.id}:${action}` },
        );
      };
      if (diff.added.length > 0 && !requested.canCreate) refuse('create');
      if (diff.changed.length > 0 && !requested.canUpdate) refuse('update');
      if (diff.removed.length > 0 && !requested.canDelete) refuse('delete');

      const undo: UndoChildren = {
        relationId: child.relationId,
        added: [],
        removed: [],
        changed: [],
      };

      for (const values of diff.added) {
        const row = { ...values, [child.foreignColumn]: parentKey };
        const [prepared] = await writes.beforeEach('create', target, context, [{ values: row }]);
        if (prepared === undefined) throw new AppError(500, 'INTERNAL', 'The write could not be prepared.');
        if (prepared.issues !== null) {
          throw new ValidationFailedError('Some values were refused.', {
            fields: prepared.issues,
            relation: child.relationId,
          });
        }
        const written = await (async () => {
          try {
            return await insertRow(db, ctx.dialect, child.child, prepared.values);
          } catch (error) {
            return mapDbError(error, child.child);
          }
        })();
        undo.added.push(Object.fromEntries(child.child.primaryKey.map((name) => [name, written[name]])));
      }

      for (const change of diff.changed) {
        const before = existing.find((row) =>
          child.child.primaryKey.every((name) => String(row[name]) === String(change.key[name])),
        );
        const [prepared] = await writes.beforeEach('update', target, context, [
          { match: change.key, values: change.values },
        ]);
        if (prepared === undefined) throw new AppError(500, 'INTERNAL', 'The write could not be prepared.');
        if (prepared.issues !== null) {
          throw new ValidationFailedError('Some values were refused.', {
            fields: prepared.issues,
            relation: child.relationId,
          });
        }
        try {
          await updateRows(db, child.child, prepared.values, change.key);
        } catch (error) {
          mapDbError(error, child.child);
        }
        if (before !== undefined) undo.changed.push({ key: change.key, before });
      }

      for (const key of diff.removed) {
        const before = existing.find((row) =>
          child.child.primaryKey.every((name) => String(row[name]) === String(key[name])),
        );
        await deleteRows(db, child.child, key);
        if (before !== undefined) undo.removed.push(before);
      }
      return undo;
    }

    /** The target keys this record is linked to right now. */
    async function currentLinks(
      db: Kysely<SourceDatabase>,
      link: ResolvedLink,
      ownKey: unknown,
    ): Promise<string[]> {
      const rows = await db
        .selectFrom(link.linkTable.id)
        .select((eb) => [eb.ref(link.targetColumn).as('key')])
        .where((eb) => eb(db.dynamic.ref(link.ownColumn), '=', ownKey))
        .limit(LINK_READ_CAP + 1)
        .execute();
      return (rows as { key: unknown }[]).map((row) => String(row.key));
    }

    /**
     * One link row's values, with the two keys coerced the way the link
     * table's own columns want them: a target key travels as a string and an
     * integer column must not be handed one.
     */
    function linkRowValues(link: ResolvedLink, ownKey: unknown, targetKey: string): Row {
      const targetColumn = link.linkTable.columns.get(link.targetColumn);
      const numeric =
        targetColumn !== undefined &&
        ['integer', 'bigint', 'decimal', 'float'].includes(targetColumn.logicalType);
      const coerced = numeric && targetKey.trim() !== '' && !Number.isNaN(Number(targetKey))
        ? Number(targetKey)
        : targetKey;
      return { [link.ownColumn]: ownKey, [link.targetColumn]: coerced };
    }

    /**
     * Bring one record's links in line with the request, inside the caller's
     * transaction. Returns what changed, for the undo entry.
     *
     * `prepared` are rows the caller already ran through the write service
     * OUTSIDE the transaction — the path a hooked link table has to take,
     * because a project hook may write through its own connection and would
     * wait for this transaction on SQLite.
     */
    async function applyLinks(
      ctx: DataContext,
      db: Kysely<SourceDatabase>,
      requested: RequestedLink,
      ownKey: unknown,
      context: WriteContext,
      opts: { existing?: string[] | undefined } = {},
    ): Promise<{ relationId: string; before: string[]; after: string[] }> {
      const { link } = requested;
      const before = opts.existing ?? (await currentLinks(db, link, ownKey));
      const { add, remove } = diffLinks(before, requested.wanted);
      if (add.length > 0 && !requested.canAdd) {
        throw new ForbiddenError(`You cannot add rows to ${link.linkTable.name}.`, 'TABLE_FORBIDDEN', {
          permission: `table:${ctx.connectionId}:${link.linkTable.id}:create`,
        });
      }
      if (remove.length > 0 && !requested.canRemove) {
        throw new ForbiddenError(`You cannot remove rows from ${link.linkTable.name}.`, 'TABLE_FORBIDDEN', {
          permission: `table:${ctx.connectionId}:${link.linkTable.id}:delete`,
        });
      }
      if (add.length > 0) {
        const target = linkTargetOf(ctx, link, db);
        const prepared = await writes.beforeEach(
          'create',
          target,
          context,
          add.map((key) => ({ values: linkRowValues(link, ownKey, key) })),
        );
        for (const row of prepared) {
          if (row.issues !== null) {
            throw new ValidationFailedError('Some values were refused.', {
              fields: { [link.relationId]: { code: 'not-allowed' } },
              relation: link.relationId,
            });
          }
          await insertRow(db, ctx.dialect, link.linkTable, row.values);
        }
      }
      for (const key of remove) {
        await deleteRows(db, link.linkTable, linkRowValues(link, ownKey, key));
      }
      return { relationId: link.relationId, before, after: [...requested.wanted] };
    }

    /**
     * The link sets a write changed, in the audit trail.
     *
     * The record's own audit row carries its columns; a relation lives in
     * another table, so "who linked this booking to the X-ray" would otherwise
     * be visible only as an unexplained row appearing in a join table nobody
     * audits. Written once per relation that actually moved.
     */
    async function auditLinks(
      request: FastifyRequest,
      ctx: DataContext,
      entity: RecordRef,
      written: readonly UndoLinks[],
    ): Promise<void> {
      for (const links of written) {
        if (sameKeys(links.before, links.after)) continue;
        await app.rbac.audit(request, {
          category: 'data',
          action: 'record.links',
          connectionId: ctx.connectionId,
          entity,
          changes: {
            before: { relation: links.relationId, keys: links.before },
            after: { relation: links.relationId, keys: links.after },
          },
        });
      }
    }

    function issueUndo(
      request: FastifyRequest,
      ctx: DataContext,
      action: UndoAction,
      before: Row[],
      after: Row[],
      changedColumns: string[] = [],
      /** Files trashed alongside this write; the undo restores them. */
      fileIds: string[] = [],
      /** Link sets this write replaced; the undo puts them back. */
      links: UndoLinks[] = [],
      /** Child rows this write touched; the undo puts them back too. */
      children: UndoChildren[] = [],
    ): string | null {
      const userId = principalId(request);
      if (userId === null || ctx.table.primaryKey.length === 0) return null;
      const { token } = undoStore.issue({
        auditId: null,
        userId,
        connectionId: ctx.connectionId,
        tableId: ctx.table.id,
        action,
        pkColumns: ctx.table.primaryKey,
        before,
        after,
        changedColumns,
        fileIds,
        links,
        children,
      });
      return token;
    }

    /**
     * Everything a deleted record owned: its sidecar attachments, and whatever
     * its file columns pointed at. Returns the ids so the undo entry can carry
     * them — nothing else knows which files a `DELETE` took with it once the
     * row is gone.
     */
    async function trashRecordFiles(ctx: DataContext, entity: RecordRef, before: Row): Promise<string[]> {
      if (deps.files === undefined) return [];
      const trashed = await deps.files.trashForRecord({
        connectionId: ctx.connectionId,
        table: ctx.table.id,
        entity,
        row: before,
      });
      return trashed;
    }

    /**
     * Resolve `lookup=`, `agg=` and `compute=` for one request through the
     * shared resolver (crud/projections.ts) and audit every refused projection
     * (D16). The export preview and the export job call the same resolver, so
     * the per-reached-table permission decision is made in one place for every
     * reader of a row.
     */
    async function projectionsFor(
      request: FastifyRequest,
      ctx: DataContext,
      query: { lookup?: string | string[] | undefined; agg?: string | string[] | undefined; compute?: string | string[] | undefined },
    ): Promise<Projections> {
      const projections = await resolveProjections({
        view: ctx.view,
        table: ctx.table,
        canReadPii: ctx.unmasked,
        canReadTable: (tableId) => request.can(`table:${ctx.connectionId}:${tableId}:read`),
        lookup: query.lookup,
        agg: query.agg,
        compute: query.compute,
      });
      await auditRefusedProjections(request, ctx, projections.refusals);
      return projections;
    }

    /**
     * One `app.rbac.audit` row per refused projection (D16).
     *
     * The gap this closes: `contextFor` audits a denied TABLE read one file
     * over, while a lookup or a measure that resolves to `null` because the
     * caller cannot read the table it reaches wrote nothing at all — the
     * refusals that degrade were the ones invisible to the trail. Widening
     * the disclosure from a row count to an invoice total is exactly the
     * moment to close it.
     */
    async function auditRefusedProjections(
      request: FastifyRequest,
      ctx: DataContext,
      refusals: readonly ProjectionRefusal[],
    ): Promise<void> {
      for (const entry of refusals) {
        await app.rbac.audit(request, {
          category: 'rbac',
          action: 'projection.denied',
          connectionId: ctx.connectionId,
          changes: {
            after: {
              alias: entry.alias,
              table: entry.table,
              reason: entry.reason,
              method: request.method,
              url: request.url,
            },
          },
        });
      }
    }

    // --- list -----------------------------------------------------------------

    app.get(
      '/data/:connectionId/:table',
      { schema: { params: dataTableParams, querystring: recordListQuery, response: { 200: recordListReply } } },
      async (request) => {
        const ctx = await contextFor(request, 'read');
        const { lookups, measures, requiredColumns, fields } = await projectionsFor(
          request,
          ctx,
          request.query,
        );
        return runList({
          db: ctx.db,
          view: ctx.view,
          table: ctx.table,
          params: request.query,
          canReadPii: ctx.unmasked,
          dialect: ctx.dialect,
          lookups,
          measures,
          requiredColumns,
          derivedFields: fields,
        });
      },
    );

    // --- undo (static segment — registered before the :recordId matcher) -------

    app.post(
      '/data/undo/:token',
      { schema: { params: undoParams, response: { 200: undoReply } } },
      async (request) => {
        await app.rbac.resolve(request); // 401 without a principal
        const actor = principalId(request);
        const result = undoStore.consume(request.params.token);
        if (result.status === 'unknown') {
          throw new NotFoundError('Unknown or already-used undo token.', {});
        }
        if (result.status === 'expired') {
          throw new AppError(410, 'UNDO_EXPIRED', 'The undo window has closed.');
        }
        const entry = result.entry;
        if (entry.userId !== actor) {
          throw new ForbiddenError('Only the user who made the change can undo it.', 'FORBIDDEN', {});
        }
        // The caller must still hold the original action's write permission.
        const permission = `table:${entry.connectionId}:${entry.tableId}:${entry.action}`;
        if (!(await request.can(permission))) {
          throw new ForbiddenError('You no longer hold the permission this undo needs.', 'TABLE_FORBIDDEN', {
            permission,
          });
        }
        const view = await viewFor(entry.connectionId);
        const table = view.table(entry.tableId);
        const { db, dialect } = await manager.data(entry.connectionId);
        const target: WriteTarget = { connectionId: entry.connectionId, view, table, db, dialect };
        const context = requestWriteContext(request, 'undo');
        const hookAction = UNDO_WRITE[entry.action];
        // Before hooks judge the restore like any other write, before the
        // transaction opens (see crud/write-service.ts).
        /*
         * `rules: false` — an undo restores HISTORY. A column rule added since
         * the row was written must not stop it coming back, or a validation
         * becomes a data loss. The named escape is `uncheckedForUndo`.
         */
        const prepared = await writes.beforeEach(hookAction, target, context, undoRows(entry), {
          rules: false,
        });
        const { restored: restoredIds, written } = await executeUndo(target, entry, prepared, context);
        // The record is back; so are its files. Before the audit row,
        // so a partial restore is visible in the same entry that claims it.
        if (entry.fileIds.length > 0 && deps.files !== undefined) {
          await deps.files.restoreAll(entry.fileIds);
        }
        await app.rbac.audit(request, {
          category: 'data',
          action: 'record.undo',
          connectionId: entry.connectionId,
          changes: { after: { table: entry.tableId, action: entry.action, restored: restoredIds.length } },
        });
        if (app.hasDecorator('realtime')) {
          app.realtime.publish(`table:${entry.connectionId}:${entry.tableId}`, 'record.undo', {
            action: entry.action,
          });
        }
        /*
         * D7 — the undo window is the reason a dashboard-origin rule waits 60 s
         * before it runs. Now that the write is taken back, the runs it queued
         * must never happen: `onUndo` flips the ones still pending to skipped
         * and cancels their jobs. An `update` undo is NOT included — the row
         * still exists and its rule (if any) fired on a change that has now
         * been reversed by a second change, which is itself an event.
         */
        if (app.hasDecorator('automations') && entry.action !== 'update') {
          const images = entry.action === 'create' ? entry.after : entry.before;
          await app.automations.onUndo(
            images.map((row) => ({
              connectionId: entry.connectionId,
              table: entry.tableId,
              pk: Object.fromEntries(entry.pkColumns.map((c) => [c, row[c]])),
              label: '',
            })),
          );
        }
        await writes.afterEach(hookAction, target, context, written);
        return { restoredIds };
      },
    );

    /**
     * The rows an undo writes, in the order `executeUndo` writes them: the
     * deleted rows go back, an update's changed columns go back, and created
     * rows go away.
     */
    function undoRows(entry: UndoEntry): { match?: Row; values: Row }[] {
      const pkOf = (row: Row): Row => Object.fromEntries(entry.pkColumns.map((c) => [c, row[c]]));
      if (entry.action === 'delete') return entry.before.map((before) => ({ values: before }));
      if (entry.action === 'update') {
        const columns = undoColumns(entry);
        return entry.before.map((before) => ({
          match: pkOf(before),
          values: Object.fromEntries(columns.map((c) => [c, before[c]])),
        }));
      }
      return entry.after.map((after) => ({ match: pkOf(after), values: {} }));
    }

    function undoColumns(entry: UndoEntry): string[] {
      return entry.changedColumns.length > 0 ? entry.changedColumns : Object.keys(entry.after[0] ?? {});
    }

    /**
     * Put one record's link sets back the way the undone write found them.
     *
     * The conflict rule is the one the columns follow: if the set is no longer
     * what this write left behind, somebody else has edited it since and the
     * undo aborts rather than overwriting their edit. An undo of a CREATE ends
     * with the set empty, which is what deleting the parent needs.
     */
    async function undoLinks(
      db: Kysely<SourceDatabase>,
      target: WriteTarget,
      entry: UndoEntry,
      record: Row,
      conflict: () => never,
    ): Promise<void> {
      for (const links of entry.links) {
        const resolution = resolveLink(target.view, target.table, links.relationId);
        // The relation is gone (a re-introspection dropped it, an override
        // removed it). There is nothing to restore and nothing to overwrite.
        if (!resolution.ok) continue;
        const { link } = resolution;
        const ownKey = record[link.ownKeyColumn];
        const now = await currentLinks(db, link, ownKey);
        const wanted = entry.action === 'create' ? [] : links.before;
        if (!sameKeys(now, links.after)) conflict();
        const { add, remove } = diffLinks(now, wanted);
        for (const key of add) {
          await insertRows(db, link.linkTable, uncheckedForUndo([linkRowValues(link, ownKey, key)]));
        }
        for (const key of remove) {
          await deleteRows(db, link.linkTable, linkRowValues(link, ownKey, key));
        }
      }
    }

    /**
     * Put a write's child rows back.
     *
     * The order matters on a create undo: the children go BEFORE the parent, or
     * the parent's delete meets its own foreign keys. And it is a write in the
     * opposite direction for each of the three lists — delete what was added,
     * insert what was removed, restore what was changed — which is why the
     * entry carries whole rows for removals and keys for additions.
     *
     * A relation that has since disappeared is skipped rather than refused:
     * there is nothing left to restore and nothing left to overwrite.
     */
    async function undoChildren(
      db: Kysely<SourceDatabase>,
      target: WriteTarget,
      entry: UndoEntry,
    ): Promise<void> {
      for (const children of entry.children) {
        const resolution = resolveChild(target.view, target.table, children.relationId);
        if (!resolution.ok) continue;
        const child = resolution.child.child;
        for (const key of children.added) {
          await deleteRows(db, child, key);
        }
        for (const row of children.removed) {
          await insertRows(db, child, uncheckedForUndo([row]));
        }
        for (const change of children.changed) {
          await updateRows(db, child, uncheckedForUndo([change.before])[0]!, change.key);
        }
      }
    }

    async function executeUndo(
      target: WriteTarget,
      entry: UndoEntry,
      prepared: PreparedRow[],
      context: WriteContext,
    ): Promise<{ restored: unknown[]; written: WrittenRow[] }> {
      const { table } = target;
      const pkOf = (row: Row): Row => Object.fromEntries(entry.pkColumns.map((c) => [c, row[c]]));
      const conflict = (): never => {
        throw new ConflictError('Rows changed since the mutation — undo aborted.', 'CONFLICT', {
          code: 'UNDO_CONFLICT',
        });
      };
      const outcome = await target.db.transaction().execute(async (trx) => {
        const tdb = trx as unknown as Kysely<SourceDatabase>;
        const restored: unknown[] = [];
        const written: { pk: Row; before: Row | null; record: Row | null }[] = [];
        if (entry.action === 'delete') {
          // Restore rows with their ORIGINAL PKs.
          for (const [i, before] of entry.before.entries()) {
            const existing = await fetchByPk(tdb, table, pkOf(before));
            if (existing !== undefined) conflict();
            await insertRows(tdb, table, [prepared[i]?.values ?? uncheckedForUndo([before])[0]!]);
            restored.push(pkLabel(table, pkOf(before)));
            written.push({ pk: pkOf(before), before: null, record: null });
          }
          return { restored, written };
        }
        if (entry.action === 'update') {
          const compareColumns = undoColumns(entry);
          for (let i = 0; i < entry.before.length; i += 1) {
            const before = entry.before[i] as Row;
            const after = entry.after[i] as Row;
            const pk = pkOf(before);
            const current = await fetchByPk(tdb, table, pk);
            if (current === undefined || !rowsEqual(current, after, compareColumns)) conflict();
            const restoreValues =
              prepared[i]?.values ??
              uncheckedForUndo([Object.fromEntries(compareColumns.map((c) => [c, before[c]]))])[0]!;
            await updateRows(tdb, table, restoreValues, pk);
            await undoLinks(tdb, target, entry, before, conflict);
            await undoChildren(tdb, target, entry);
            restored.push(pkLabel(table, pk));
            written.push({ pk, before: current ?? null, record: null });
          }
          return { restored, written };
        }
        // create undo: delete the inserted rows if untouched.
        for (const after of entry.after) {
          const pk = pkOf(after);
          const current = await fetchByPk(tdb, table, pk);
          if (current === undefined) continue; // already gone
          if (!rowsEqual(current, after, Object.keys(after))) conflict();
          /*
           * The link rows FIRST, in the same transaction: a parent deleted with
           * its links still pointing at it is either an orphan or a foreign-key
           * failure, and both are worse than the mistake being undone.
           */
          await undoLinks(tdb, target, entry, after, conflict);
          // …and the child rows for the same reason, before the parent they
          // point at is gone.
          await undoChildren(tdb, target, entry);
          await deleteRows(tdb, table, pk);
          restored.push(pkLabel(table, pk));
          written.push({ pk, before: null, record: current });
        }
        return { restored, written };
      });
      // The rows as they stand now, for after hooks — read only when one runs.
      const written: WrittenRow[] = [];
      if (outcome.written.length > 0 && (await writes.wants('after', UNDO_WRITE[entry.action], target, context))) {
        for (const row of outcome.written) {
          const record = row.record ?? (await fetchByPk(target.db, table, row.pk));
          if (record !== undefined) written.push({ record, before: row.before });
        }
      }
      return { restored: outcome.restored, written };
    }

    // --- bulk (static segment) --------------------------------------------------

    app.post(
      '/data/:connectionId/:table/bulk',
      { schema: { params: dataTableParams, body: recordBulkBody, response: { 200: recordBulkReply } } },
      async (request) => {
        const action = request.body.action;
        const ctx = await contextFor(request, action);
        const values = action === 'update' ? allowlistValues(ctx, request.body.values ?? {}) : null;
        const context = requestWriteContext(request, 'bulk');
        const pks = request.body.ids.map((id) => pkFromLoose(ctx.table, id));
        // Before hooks for every row, before the transaction opens.
        const prepared = await writes.beforeEach(
          action,
          ctx.target,
          context,
          pks.map((pk) => ({ match: pk, values: values ?? {} })),
        );
        /*
         * A bulk update sends ONE `values` object for every id, so a refused
         * value is a property of the request, not of a row: the whole thing
         * fails before the transaction opens and nothing is written. (A hook
         * may still have changed one row's values, so the row is named.)
         */
        for (const [i, row] of prepared.entries()) {
          if (row.issues === null) continue;
          throw new ValidationFailedError('Some values were refused.', {
            fields: row.issues,
            row: i,
            id: request.body.ids[i],
          });
        }
        const results: { id: unknown; ok: boolean; error?: string }[] = [];
        const beforeImages: Row[] = [];
        const afterImages: Row[] = [];
        /*
         * O7 — a bulk write fires record triggers, per row, bounded by this
         * route's own 1,000-id cap. Collected inside the transaction and
         * emitted after it commits: a rule must never see a row that a later
         * failure rolled back.
         */
        const events: { pk: Row; before: Row; after: Row | null }[] = [];

        await ctx.db.transaction().execute(async (trx) => {
          const tdb = trx as unknown as Kysely<SourceDatabase>;
          for (const [i, id] of request.body.ids.entries()) {
            const pk = pks[i] as Row;
            const before = await fetchByPk(tdb, ctx.table, pk);
            if (before === undefined) {
              results.push({ id, ok: false, error: 'NOT_FOUND' });
              continue;
            }
            try {
              if (action === 'delete') {
                await deleteRows(tdb, ctx.table, pk);
                beforeImages.push(before);
                events.push({ pk, before, after: null });
              } else {
                await updateRows(tdb, ctx.table, prepared[i]!.values, pk);
                const after = await fetchByPk(tdb, ctx.table, pk);
                beforeImages.push(before);
                if (after !== undefined) afterImages.push(after);
                events.push({ pk, before, after: after ?? before });
              }
              results.push({ id, ok: true });
            } catch (error) {
              mapDbError(error, ctx.table);
            }
          }
        });

        const okCount = results.filter((r) => r.ok).length;
        const undoToken =
          okCount === 0
            ? null
            : issueUndo(
                request,
                ctx,
                action,
                beforeImages,
                afterImages,
                action === 'update' && values !== null ? changedColumns(values, prepared) : [],
              );
        await app.rbac.audit(request, {
          category: 'data',
          action: `record.bulk-${action}`,
          connectionId: ctx.connectionId,
          changes: {
            after: { table: ctx.table.id, requested: request.body.ids.length, succeeded: okCount },
          },
        });
        if (app.hasDecorator('realtime')) {
          app.realtime.publish(`table:${ctx.connectionId}:${ctx.table.id}`, `record.bulk-${action}`, {
            count: okCount,
          });
        }
        // Events, not the full helper: one operator action stays ONE audit row
        // and one counted publish (see `crud/after-record-write.ts`).
        for (const event of events) {
          await emitRecordEvent(app, {
            connectionId: ctx.connectionId,
            table: ctx.table,
            action: action === 'delete' ? 'delete' : 'update',
            entity: recordRef(ctx, event.pk),
            before: event.before,
            after: event.after,
            origin: 'bulk',
          });
        }
        await writes.afterEach(
          action,
          ctx.target,
          context,
          events.map((event) =>
            action === 'delete'
              ? { record: event.before, before: null }
              : { record: event.after ?? event.before, before: event.before },
          ),
        );
        return { results, undoToken };
      },
    );

    // --- references preflight -----------------------------------------------------

    app.get(
      '/data/:connectionId/:table/:recordId/references',
      { schema: { params: dataRecordParams, response: { 200: referencesReply } } },
      async (request) => {
        const ctx = await contextFor(request, 'read');
        const pk = parseRecordId(ctx.table, request.params.recordId);
        const row = await fetchByPk(ctx.db, ctx.table, pk);
        if (row === undefined) throw new NotFoundError('Record not found.', { pk });
        return { references: await referenceCounts(ctx.db, ctx.view, ctx.table, pk) };
      },
    );

    // --- single record --------------------------------------------------------------

    app.get(
      '/data/:connectionId/:table/:recordId',
      {
        schema: { params: dataRecordParams, querystring: recordGetQuery, response: { 200: recordReply } },
      },
      async (request) => {
        const ctx = await contextFor(request, 'read');
        const pk = parseRecordId(ctx.table, request.params.recordId);
        const row = await fetchByPk(ctx.db, ctx.table, pk);
        if (row === undefined) throw new NotFoundError('Record not found.', { pk });
        let data = maskRow(row, ctx.table, ctx.unmasked);
        const { lookups, measures, fields } = await projectionsFor(request, ctx, request.query);
        if (lookups.length > 0) {
          const values = await fetchLookupValues(ctx.db, ctx.table, pk, lookups);
          data = applyLookupMask([{ ...data, ...values }], lookups)[0] as Row;
        }
        if (measures.length > 0) {
          const values = await fetchMeasureValues(ctx.db, ctx.table, pk, measures);
          data = applyMeasureMask([{ ...data, ...values }], measures)[0] as Row;
        }
        // The fourth stage, in the same position the list runs it: after the
        // whole masking chain, so list and record answer the same numbers and
        // the same markers for the same row.
        data = applyDerivedFields([data], fields)[0] as Row;
        if (request.query.include === 'inboundCounts') {
          return { data, inboundCounts: await referenceCounts(ctx.db, ctx.view, ctx.table, pk) };
        }
        return { data };
      },
    );

    /**
     * The records one relation links this record to.
     *
     * Two reads rather than a join: the link table answers which keys, the
     * target answers what they are called, and the target's own masking policy
     * is applied to the second read exactly as it would be to a list. A join
     * would have to re-derive that policy for aliased columns.
     *
     * `name` and `detail` are the FIELD's settings, sent by the caller and
     * resolved through the allowlist like any other column — which is what
     * keeps a masked column out of a picker label.
     */
    /*
     * WHICH INSTANTS ARE ALREADY TAKEN — one read per visible month, behind a
     * calendar control. It is a READ of the same table under the same grant,
     * so it hangs here rather than anywhere new: `contextFor` is the whole of
     * its authorization, and the leaf owns everything else.
     */
    app.get(
      '/data/:connectionId/:table/availability',
      {
        schema: {
          params: dataTableParams,
          querystring: availabilityQuery,
          response: { 200: availabilityReply },
        },
      },
      async (request) => {
        const ctx = await contextFor(request, 'read');
        const query = request.query;
        const { exclude: excludeId, ...rest } = query;
        const columns = availabilityColumns(ctx.view, ctx.table, rest, await canReadPii(request));
        const exclude = excludeId === undefined ? undefined : parseRecordId(ctx.table, excludeId);
        return await readAvailability(ctx.db, ctx.dialect, ctx.table, columns, {
          ...rest,
          ...(exclude === undefined ? {} : { exclude }),
        });
      },
    );

    app.get(
      '/data/:connectionId/:table/:recordId/links/:relationId',
      {
        schema: {
          params: recordLinksParams,
          querystring: recordLinksQuery,
          response: { 200: recordLinksReply },
        },
      },
      async (request) => {
        const ctx = await contextFor(request, 'read');
        const pk = parseRecordId(ctx.table, request.params.recordId);
        const resolution = resolveLink(ctx.view, ctx.table, request.params.relationId);
        if (!resolution.ok) {
          throw new ValidationFailedError(resolution.refusal.reason, {
            relation: request.params.relationId,
          });
        }
        const { link } = resolution;
        for (const table of [link.linkTable, link.target]) {
          const permission = `table:${ctx.connectionId}:${table.id}:read`;
          if (!(await request.can(permission))) {
            throw new ForbiddenError('You do not have access to this table.', 'TABLE_FORBIDDEN', {
              permission,
            });
          }
        }
        const record = await fetchByPk(ctx.db, ctx.table, pk);
        if (record === undefined) throw new NotFoundError('Record not found.', { pk });
        const ownKey = record[link.ownKeyColumn];

        const keys = await currentLinks(ctx.db, link, ownKey);
        const hasMore = keys.length > LINK_READ_CAP;
        const page = keys.slice(0, LINK_READ_CAP);
        if (page.length === 0) return { data: [], hasMore: false };

        const pii = await canReadPii(request);
        /*
         * The name the picker shows: the field's own setting, else the target's
         * classified display column — the same answer the search palette
         * labels a record with, and never a masked one.
         */
        const nameColumn = ctx.view.readableColumn(
          link.target,
          request.query.name ?? labelColumnFor(ctx.view, link.target) ?? link.targetKeyColumn,
          pii,
        );
        const detailColumns = (request.query.detail ?? '')
          .split(',')
          .map((name) => name.trim())
          .filter((name) => name !== '')
          .slice(0, 2)
          .map((name) => ctx.view.readableColumn(link.target, name, pii));
        const keyColumn = ctx.view.readableColumn(link.target, link.targetKeyColumn, pii);

        const rows = await ctx.db
          .selectFrom(link.target.id)
          .select((eb) =>
            [keyColumn, nameColumn, ...detailColumns].map((column) => eb.ref(column.name).as(column.name)),
          )
          .where((eb) => eb(ctx.db.dynamic.ref(keyColumn.name), 'in', page))
          .limit(LINK_READ_CAP)
          .execute();

        const byKey = new Map(
          (rows as Row[]).map((row) => [String(row[keyColumn.name]), row] as const),
        );
        return {
          // The request's order, so a picker's chips do not reshuffle on every
          // read; a key whose row is gone still shows, as itself.
          data: page.map((key) => {
            const row = byKey.get(key);
            const name = row === undefined ? key : String(row[nameColumn.name] ?? key);
            const detail = detailColumns
              .map((column) => row?.[column.name])
              .filter((value) => value !== null && value !== undefined && value !== '')
              .map((value) => String(value))
              .join(' · ');
            return { key, name, ...(detail === '' ? {} : { detail }) };
          }),
          hasMore,
        };
      },
    );

    app.post(
      '/data/:connectionId/:table',
      { schema: { params: dataTableParams, body: recordCreateBody, response: { 201: recordMutationReply } } },
      async (request, reply) => {
        const ctx = await contextFor(request, 'create');
        const values = allowlistValues(ctx, request.body.values);
        await assertFileColumns(ctx, values);
        const context = requestWriteContext(request, 'dashboard');
        const links = await requestedLinks(request, ctx, context, request.body.links);
        const children = await requestedChildren(request, ctx, context, request.body.children);
        const repeat = request.body.repeat;
        let undoToken: string | null = null;

        /*
         * ONE ROW PER VALUE. The column is allowlisted like any other, and the
         * rows are written in ONE transaction under ONE undo token: an
         * invitation list half sent is worse than one refused, and two people
         * invited out of five with no way back is the failure this shape is
         * for. Links and child rows are refused alongside it rather than
         * silently applied to whichever row won — "the same links on five rows"
         * is a decision nobody has made.
         */
        if (repeat !== undefined) {
          if (links.length > 0 || children.length > 0) {
            throw new ValidationFailedError(
              'A field that makes one record per value cannot be combined with relation fields.',
              { column: repeat.column },
            );
          }
          const column = ctx.view.column(ctx.table, repeat.column);
          const prepared = await writes.beforeEach(
            'create',
            ctx.target,
            context,
            repeat.values.map((value) => ({
              values: { ...values, [column.name]: normalizeWriteValue(column, value) },
            })),
          );
          for (const [index, row] of prepared.entries()) {
            if (row.issues === null) continue;
            throw new ValidationFailedError('Some values were refused.', {
              fields: row.issues,
              row: index,
              value: repeat.values[index],
            });
          }
          const rows = await ctx.db.transaction().execute(async (trx) => {
            const tdb = trx as unknown as Kysely<SourceDatabase>;
            const written: Row[] = [];
            for (const row of prepared) {
              try {
                written.push(await insertRow(tdb, ctx.dialect, ctx.table, row.values));
              } catch (error) {
                return mapDbError(error, ctx.table);
              }
            }
            return written;
          });
          // One token over every row: the create-undo path already deletes
          // each `after` it holds, in order.
          undoToken = issueUndo(request, ctx, 'create', [], rows);
          for (const row of rows) {
            const pk = Object.fromEntries(ctx.table.primaryKey.map((c) => [c, row[c]]));
            await afterMutation(request, ctx, 'create', recordRef(ctx, pk), null, row);
          }
          await writes.afterEach(
            'create',
            ctx.target,
            context,
            rows.map((record) => ({ record, before: null })),
          );
          const first = rows[0] as Row;
          return reply
            .status(201)
            .send({ data: maskRow(first, ctx.table, ctx.unmasked), undoToken, created: rows.length });
        }

        /*
         * WITH NO RELATIONS, NOTHING CHANGES. The write service holds the whole
         * order for one row — fill, hooks, check, statement, announce, after
         * hooks — and a create that names no relation still goes through it,
         * untouched, without opening a transaction it does not need.
         */
        if (links.length === 0 && children.length === 0) {
          const inserted = await writes.create({
            target: ctx.target,
            values,
            context,
            recheck: (final) => assertFileColumns(ctx, final),
            mapError: (error) => mapDbError(error, ctx.table),
            announce: async (row) => {
              const pk = Object.fromEntries(ctx.table.primaryKey.map((c) => [c, row[c]]));
              undoToken = issueUndo(request, ctx, 'create', [], [row]);
              await afterMutation(request, ctx, 'create', recordRef(ctx, pk), null, row);
            },
          });
          return reply.status(201).send({ data: maskRow(inserted, ctx.table, ctx.unmasked), undoToken });
        }

        /*
         * WITH LINKS, the route drives the steps itself — the shape the undo
         * path already uses. The parent and its link rows are one transaction,
         * and the announcement (undo token, audit, realtime) happens only after
         * it commits: announcing inside would publish a write that can still
         * roll back.
         */
        /*
         * A CHILD TABLE'S before hook cannot run on a row whose foreign key
         * does not exist yet — and child tables carry hooks far more often than
         * join tables do, so this refusal is one real people will meet. It says
         * which table and which column rather than throwing a shape at them.
         */
        for (const requested of children) {
          if (!requested.hooked) continue;
          if (values[requested.child.parentKeyColumn] === undefined) {
            throw new ValidationFailedError(
              `${requested.child.child.name} runs a hook, so its rows cannot be added while ` +
                `${ctx.table.name}.${requested.child.parentKeyColumn} is filled in by the database.`,
              {
                fields: { [requested.child.relationId]: { code: 'not-allowed' } },
                relation: requested.child.relationId,
              },
            );
          }
        }

        const hooked = links.filter((requested) => requested.hooked);
        for (const requested of hooked) {
          const key = values[requested.link.ownKeyColumn];
          if (key === undefined || key === null) {
            /*
             * A link row's foreign key does not exist until the parent's INSERT,
             * and a before hook cannot be run outside the transaction on a row
             * that has no key yet — nor inside it, because a hook writing
             * through its own connection would wait for this very transaction
             * on SQLite. Refusing is the only honest answer: skipping the hook
             * would enforce nothing while looking like it had.
             */
            throw new ValidationFailedError(
              `${requested.link.linkTable.name} runs a hook, so its rows cannot be added while ` +
                `${ctx.table.name}.${requested.link.ownKeyColumn} is filled in by the database.`,
              {
                fields: { [requested.link.relationId]: { code: 'not-allowed' } },
                relation: requested.link.relationId,
              },
            );
          }
        }

        const [prepared] = await writes.beforeEach('create', ctx.target, context, [{ values }]);
        if (prepared === undefined) throw new AppError(500, 'INTERNAL', 'The write could not be prepared.');
        if (prepared.issues !== null) {
          throw new ValidationFailedError('Some values were refused.', { fields: prepared.issues });
        }
        await assertFileColumns(ctx, prepared.values as Row);

        const written: { relationId: string; before: string[]; after: string[] }[] = [];
        const childWrites: UndoChildren[] = [];
        const inserted = await ctx.db.transaction().execute(async (trx) => {
          const tdb = trx as unknown as Kysely<SourceDatabase>;
          const row = await (async () => {
            try {
              return await insertRow(tdb, ctx.dialect, ctx.table, prepared.values);
            } catch (error) {
              return mapDbError(error, ctx.table);
            }
          })();
          for (const requested of links) {
            // A brand-new record has no links yet, so the diff is the whole
            // list — and saying so spares a SELECT per relation.
            written.push(
              await applyLinks(ctx, tdb, requested, row[requested.link.ownKeyColumn], context, {
                existing: [],
              }),
            );
          }
          for (const requested of children) {
            childWrites.push(
              await applyChildren(ctx, tdb, requested, row[requested.child.parentKeyColumn], context, {
                existing: [],
              }),
            );
          }
          return row;
        });

        const pk = Object.fromEntries(ctx.table.primaryKey.map((c) => [c, inserted[c]]));
        undoToken = issueUndo(request, ctx, 'create', [], [inserted], [], [], written, childWrites);
        await afterMutation(request, ctx, 'create', recordRef(ctx, pk), null, inserted);
        await auditLinks(request, ctx, recordRef(ctx, pk), written);
        await writes.afterEach('create', ctx.target, context, [{ record: inserted, before: null }]);
        return reply.status(201).send({ data: maskRow(inserted, ctx.table, ctx.unmasked), undoToken });
      },
    );

    app.patch(
      '/data/:connectionId/:table/:recordId',
      {
        schema: { params: dataRecordParams, body: recordUpdateBody, response: { 200: recordMutationReply } },
      },
      async (request) => {
        const ctx = await contextFor(request, 'update');
        const pk = parseRecordId(ctx.table, request.params.recordId);
        const values = allowlistValues(ctx, request.body.values);
        await assertFileColumns(ctx, values);
        const before = await fetchByPk(ctx.db, ctx.table, pk);
        if (before === undefined) throw new NotFoundError('Record not found.', { pk });
        const context = requestWriteContext(request, 'dashboard');
        const links = await requestedLinks(request, ctx, context, request.body.links);
        const children = await requestedChildren(request, ctx, context, request.body.children);
        let undoToken: string | null = null;

        /*
         * A PATCH that names no relation leaves every link and every child row
         * alone — the same rule an absent column follows — and takes the path
         * it always took.
         */
        if (links.length === 0 && children.length === 0) {
          const outcome = await writes.update({
            target: ctx.target,
            pk,
            values,
            before,
            context,
            recheck: (final) => assertFileColumns(ctx, final),
            mapError: (error) => mapDbError(error, ctx.table),
            announce: async (result) => {
              const after = result.after ?? before;
              undoToken = issueUndo(request, ctx, 'update', [before], [after], Object.keys(result.values));
              await afterMutation(request, ctx, 'update', recordRef(ctx, pk), before, after);
            },
          });
          // Masked columns may be written but are never echoed back.
          return { data: maskRow(outcome.after ?? before, ctx.table, ctx.unmasked), undoToken };
        }

        const [prepared] = await writes.beforeEach('update', ctx.target, context, [
          { match: pk, values, record: before },
        ]);
        if (prepared === undefined) throw new AppError(500, 'INTERNAL', 'The write could not be prepared.');
        if (prepared.issues !== null) {
          throw new ValidationFailedError('Some values were refused.', { fields: prepared.issues });
        }
        await assertFileColumns(ctx, prepared.values as Row);
        // The record's own key, which the link rows point at. A PATCH may move
        // it, so the links follow the value that is being WRITTEN.
        const written: UndoLinks[] = [];
        const childWrites: UndoChildren[] = [];
        const after = await ctx.db.transaction().execute(async (trx) => {
          const tdb = trx as unknown as Kysely<SourceDatabase>;
          if (Object.keys(prepared.values).length > 0) {
            try {
              await updateRows(tdb, ctx.table, prepared.values, pk);
            } catch (error) {
              mapDbError(error, ctx.table);
            }
          }
          const row = (await fetchByPk(tdb, ctx.table, pk)) ?? before;
          for (const requested of links) {
            written.push(await applyLinks(ctx, tdb, requested, row[requested.link.ownKeyColumn], context));
          }
          for (const requested of children) {
            // The DIFF is taken inside the transaction, against the rows that
            // are really there — the same rule links follow, for the same
            // reason: what was there when the dialog opened is not evidence.
            childWrites.push(
              await applyChildren(ctx, tdb, requested, row[requested.child.parentKeyColumn], context),
            );
          }
          return row;
        });

        undoToken = issueUndo(
          request,
          ctx,
          'update',
          [before],
          [after],
          Object.keys(prepared.values),
          [],
          written,
          childWrites,
        );
        await afterMutation(request, ctx, 'update', recordRef(ctx, pk), before, after);
        await auditLinks(request, ctx, recordRef(ctx, pk), written);
        await writes.afterEach('update', ctx.target, context, [{ record: after, before }]);
        return { data: maskRow(after, ctx.table, ctx.unmasked), undoToken };
      },
    );

    app.delete(
      '/data/:connectionId/:table/:recordId',
      {
        schema: {
          params: dataRecordParams,
          querystring: recordDeleteQuery,
          response: { 200: recordDeleteReply },
        },
      },
      async (request) => {
        const ctx = await contextFor(request, 'delete');
        const pk = parseRecordId(ctx.table, request.params.recordId);
        const before = await fetchByPk(ctx.db, ctx.table, pk);
        if (before === undefined) throw new NotFoundError('Record not found.', { pk });
        const references: ReferenceCount[] = await referenceCounts(ctx.db, ctx.view, ctx.table, pk);
        const inbound = references.reduce((sum, r) => sum + r.count, 0);
        if (request.query.dryRun === true) {
          // No write happens — cascade-modal payload.
          return { references, requiresConfirm: inbound > 0 };
        }
        if (inbound > 0 && request.query.confirm !== true) {
          throw new ConflictError(
            'Record has inbound references — retry with ?confirm=true after reviewing them.',
            'CONFLICT',
            { references },
          );
        }
        let undoToken: string | null = null;
        await writes.delete({
          target: ctx.target,
          pk,
          before,
          context: requestWriteContext(request, 'dashboard'),
          mapError: (error) => mapDbError(error, ctx.table),
          announce: async () => {
            const entity = recordRef(ctx, pk);
            // The record is gone; its files go with it — sidecar
            // attachments AND anything its file columns named. Trashed, not
            // deleted, so the 60 s undo below can put them back and the
            // retention sweep owns the bytes.
            const trashedFileIds = await trashRecordFiles(ctx, entity, before);
            undoToken = issueUndo(request, ctx, 'delete', [before], [], [], trashedFileIds);
            await afterMutation(request, ctx, 'delete', entity, before, null);
          },
        });
        return { data: maskRow(before, ctx.table, ctx.unmasked), undoToken };
      },
    );
  };
}
