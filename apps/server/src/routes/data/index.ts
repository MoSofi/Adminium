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
import { overridesRepo, snapshotsRepo, type MetaDb, type RecordRef } from '@adminium/meta';
import type { DatabaseModel, Dialect } from '@adminium/engine';
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
import { rowsEqual, UndoStore, type UndoAction, type UndoEntry } from '../../crud/undo.js';
import {
  afterRecordWrite,
  emitRecordEvent,
  type RecordWriteAction,
} from '../../crud/after-record-write.js';
import type { FileReconciler } from '../../files/reconcile.js';
import { normalizeWriteValue } from '../../crud/write-values.js';
import {
  createWriteService,
  deleteRows,
  insertRows,
  requestWriteContext,
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

/** PG SQLSTATE / MySQL errno symbol / SQLite message → envelope codes for
 * inline form errors. */
export function mapDbError(error: unknown): never {
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
  const viewCache = new Map<string, { stamp: string; view: SnapshotView }>();

  async function viewFor(connectionId: string): Promise<SnapshotView> {
    const snapshot = await snapshots.latest(connectionId);
    if (snapshot === null) {
      throw new NotFoundError('No schema snapshot — introspect the connection first.', { connectionId });
    }
    const active = await overrides.listForConnection(connectionId, { status: 'active' });
    const last = active.at(-1);
    const stamp = `${snapshot.id}:${String(active.length)}:${last?.id ?? ''}:${String(last?.updatedAt ?? 0)}`;
    const cached = viewCache.get(connectionId);
    if (cached !== undefined && cached.stamp === stamp) return cached.view;
    const view = new SnapshotView(connectionId, applyOverrides(snapshot.schema as DatabaseModel, active));
    viewCache.set(connectionId, { stamp, view });
    return view;
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

    function issueUndo(
      request: FastifyRequest,
      ctx: DataContext,
      action: UndoAction,
      before: Row[],
      after: Row[],
      changedColumns: string[] = [],
      /** Files trashed alongside this write; the undo restores them. */
      fileIds: string[] = [],
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
        const prepared = await writes.beforeEach(hookAction, target, context, undoRows(entry));
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
            await insertRows(tdb, table, [prepared[i]?.values ?? before]);
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
              prepared[i]?.values ?? Object.fromEntries(compareColumns.map((c) => [c, before[c]]));
            await updateRows(tdb, table, restoreValues, pk);
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
                await updateRows(tdb, ctx.table, prepared[i]?.values ?? (values as Row), pk);
                const after = await fetchByPk(tdb, ctx.table, pk);
                beforeImages.push(before);
                if (after !== undefined) afterImages.push(after);
                events.push({ pk, before, after: after ?? before });
              }
              results.push({ id, ok: true });
            } catch (error) {
              mapDbError(error);
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

    app.post(
      '/data/:connectionId/:table',
      { schema: { params: dataTableParams, body: recordCreateBody, response: { 201: recordMutationReply } } },
      async (request, reply) => {
        const ctx = await contextFor(request, 'create');
        const values = allowlistValues(ctx, request.body.values);
        await assertFileColumns(ctx, values);
        let undoToken: string | null = null;
        const inserted = await writes.create({
          target: ctx.target,
          values,
          context: requestWriteContext(request, 'dashboard'),
          recheck: (final) => assertFileColumns(ctx, final),
          mapError: mapDbError,
          announce: async (row) => {
            const pk = Object.fromEntries(ctx.table.primaryKey.map((c) => [c, row[c]]));
            undoToken = issueUndo(request, ctx, 'create', [], [row]);
            await afterMutation(request, ctx, 'create', recordRef(ctx, pk), null, row);
          },
        });
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
        let undoToken: string | null = null;
        const outcome = await writes.update({
          target: ctx.target,
          pk,
          values,
          before,
          context: requestWriteContext(request, 'dashboard'),
          recheck: (final) => assertFileColumns(ctx, final),
          mapError: mapDbError,
          announce: async (result) => {
            const after = result.after ?? before;
            undoToken = issueUndo(request, ctx, 'update', [before], [after], Object.keys(result.values));
            await afterMutation(request, ctx, 'update', recordRef(ctx, pk), before, after);
          },
        });
        // Masked columns may be written but are never echoed back.
        return { data: maskRow(outcome.after ?? before, ctx.table, ctx.unmasked), undoToken };
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
          mapError: mapDbError,
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
