/**
 * The generated CRUD API (`routes/data/`, 08-server-api.md §2.7, M3-T05):
 * list (filter DSL + `q` + keyset/offset), get (+ inbound counts), the
 * cascade preflight, create/update/delete, bulk, and undo.
 *
 * Invariants (§7 item 1, §5.2/§5.3): every table/column string that reaches
 * SQL is the schema snapshot's own; RBAC (`table:<conn>:<schema.table>:<action>`)
 * runs after identifier resolution; PII columns mask for callers without the
 * unmask grant; every mutation is audited with a RecordRef and fans out on
 * `table:<connectionId>:<schema.table>` when the realtime hub is wired.
 */

import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { overridesRepo, snapshotsRepo, type MetaDb, type RecordRef } from '@adminium/meta';
import type { DatabaseModel, Dialect } from '@adminium/engine';
import type { Kysely, Transaction } from 'kysely';

import { AppError, ConflictError, ForbiddenError, NotFoundError, ValidationFailedError } from '../../errors.js';
import { applyOverrides } from '../../connections/effective-schema.js';
import type { ConnectionManager, SourceDatabase } from '../../connections/manager.js';
import { SnapshotView, type ResolvedTable } from '../../crud/identifiers.js';
import { runList } from '../../crud/list.js';
import { canReadPii, maskRow, type Row } from '../../crud/mask.js';
import {
  fetchByPk,
  parseRecordId,
  pkLabel,
  referenceCounts,
  type ReferenceCount,
} from '../../crud/records.js';
import { rowsEqual, UndoStore, type UndoAction, type UndoEntry } from '../../crud/undo.js';
import { publishWidgetDataStream } from '../../widget-data/stream-publisher.js';
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

export interface DataRoutesDeps {
  manager: ConnectionManager;
  meta: MetaDb;
  /** Injectable for TTL tests; a fresh store otherwise. */
  undoStore?: UndoStore | undefined;
}

interface DataContext {
  connectionId: string;
  view: SnapshotView;
  table: ResolvedTable;
  db: Kysely<SourceDatabase>;
  dialect: Dialect;
  unmasked: boolean;
}

/** PG SQLSTATE / SQLite message → §1.4 envelope codes for inline form errors (§2.7.2). */
function mapDbError(error: unknown): never {
  const dbError = error as { code?: string; detail?: string; constraint?: string; message?: string };
  const message = typeof dbError.message === 'string' ? dbError.message : '';
  if (dbError.code === '23505' || message.includes('UNIQUE constraint failed')) {
    throw new ConflictError('A record with this value already exists.', 'UNIQUE_VIOLATION', {
      constraint: dbError.constraint ?? null,
      detail: dbError.detail ?? null,
    });
  }
  if (dbError.code === '23503' || message.includes('FOREIGN KEY constraint failed')) {
    throw new ConflictError('The change violates a foreign-key constraint.', 'FK_VIOLATION', {
      constraint: dbError.constraint ?? null,
      detail: dbError.detail ?? null,
    });
  }
  throw error as Error;
}

export function dataRoutes(deps: DataRoutesDeps): FastifyPluginAsyncZod {
  const { manager, meta } = deps;
  const undoStore = deps.undoStore ?? new UndoStore();
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
      // Identifier resolution FIRST, then RBAC on the resolved name (§5.2).
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
      const { db, dialect } = await manager.data(connectionId);
      return { connectionId, view, table, db, dialect, unmasked: await canReadPii(request) };
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
        out[column.name] = value;
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

    async function afterMutation(
      request: FastifyRequest,
      ctx: DataContext,
      action: string,
      entity: RecordRef,
      before: Row | null,
      after: Row | null,
    ): Promise<void> {
      await app.rbac.audit(request, {
        category: 'data',
        action: `record.${action}`,
        connectionId: ctx.connectionId,
        entity,
        changes: {
          // Before/after images are PII-redacted in the audit trail (§5.3).
          before: before === null ? null : maskRow(before, ctx.table, false),
          after: after === null ? null : maskRow(after, ctx.table, false),
        },
      });
      if (app.hasDecorator('realtime')) {
        // Cache-invalidation fan-out (09 §4.1) — carries only the pk.
        app.realtime.publish(`table:${ctx.connectionId}:${ctx.table.id}`, `record.${action}`, {
          pk: entity.pk,
        });
        // Live-stream fan-out (04 §5.3) — carries the PII-masked row so the
        // realtime-feed / live log-table tail can prepend it without a refetch.
        publishWidgetDataStream(app.realtime, {
          connectionId: ctx.connectionId,
          table: ctx.table,
          type: `record.${action}`,
          pk: entity.pk,
          row: action === 'delete' ? before : after,
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
      });
      return token;
    }

    // --- list -----------------------------------------------------------------

    app.get(
      '/data/:connectionId/:table',
      { schema: { params: dataTableParams, querystring: recordListQuery, response: { 200: recordListReply } } },
      async (request) => {
        const ctx = await contextFor(request, 'read');
        return runList({
          db: ctx.db,
          view: ctx.view,
          table: ctx.table,
          params: request.query,
          canReadPii: ctx.unmasked,
          dialect: ctx.dialect,
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
        const { db } = await manager.data(entry.connectionId);
        const restoredIds = await executeUndo(db, table, entry);
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
        return { restoredIds };
      },
    );

    async function executeUndo(
      db: Kysely<SourceDatabase>,
      table: ResolvedTable,
      entry: UndoEntry,
    ): Promise<unknown[]> {
      const pkOf = (row: Row): Row => Object.fromEntries(entry.pkColumns.map((c) => [c, row[c]]));
      const conflict = (): never => {
        throw new ConflictError('Rows changed since the mutation — undo aborted.', 'CONFLICT', {
          code: 'UNDO_CONFLICT',
        });
      };
      return db.transaction().execute(async (trx: Transaction<SourceDatabase>) => {
        const restored: unknown[] = [];
        if (entry.action === 'delete') {
          // Restore rows with their ORIGINAL PKs (§2.7.3 step 4).
          for (const before of entry.before) {
            const existing = await fetchByPk(trx as unknown as Kysely<SourceDatabase>, table, pkOf(before));
            if (existing !== undefined) conflict();
            await trx
              .insertInto(table.id)
              .values(before as never)
              .execute();
            restored.push(pkLabel(table, pkOf(before)));
          }
          return restored;
        }
        if (entry.action === 'update') {
          const compareColumns =
            entry.changedColumns.length > 0 ? entry.changedColumns : Object.keys(entry.after[0] ?? {});
          for (let i = 0; i < entry.before.length; i += 1) {
            const before = entry.before[i] as Row;
            const after = entry.after[i] as Row;
            const pk = pkOf(before);
            const current = await fetchByPk(trx as unknown as Kysely<SourceDatabase>, table, pk);
            if (current === undefined || !rowsEqual(current, after, compareColumns)) conflict();
            const restoreValues = Object.fromEntries(compareColumns.map((c) => [c, before[c]]));
            let qb = trx.updateTable(table.id).set(restoreValues as never);
            for (const [column, value] of Object.entries(pk)) {
              qb = qb.where((eb) => eb(trx.dynamic.ref(column), '=', value));
            }
            await qb.execute();
            restored.push(pkLabel(table, pk));
          }
          return restored;
        }
        // create undo: delete the inserted rows if untouched.
        for (const after of entry.after) {
          const pk = pkOf(after);
          const current = await fetchByPk(trx as unknown as Kysely<SourceDatabase>, table, pk);
          if (current === undefined) continue; // already gone
          if (!rowsEqual(current, after, Object.keys(after))) conflict();
          let qb = trx.deleteFrom(table.id);
          for (const [column, value] of Object.entries(pk)) {
            qb = qb.where((eb) => eb(trx.dynamic.ref(column), '=', value));
          }
          await qb.execute();
          restored.push(pkLabel(table, pk));
        }
        return restored;
      });
    }

    // --- bulk (static segment) --------------------------------------------------

    app.post(
      '/data/:connectionId/:table/bulk',
      { schema: { params: dataTableParams, body: recordBulkBody, response: { 200: recordBulkReply } } },
      async (request) => {
        const action = request.body.action;
        const ctx = await contextFor(request, action);
        const values = action === 'update' ? allowlistValues(ctx, request.body.values ?? {}) : null;
        const results: { id: unknown; ok: boolean; error?: string }[] = [];
        const beforeImages: Row[] = [];
        const afterImages: Row[] = [];

        await ctx.db.transaction().execute(async (trx) => {
          const tdb = trx as unknown as Kysely<SourceDatabase>;
          for (const id of request.body.ids) {
            const pk = pkFromLoose(ctx.table, id);
            const before = await fetchByPk(tdb, ctx.table, pk);
            if (before === undefined) {
              results.push({ id, ok: false, error: 'NOT_FOUND' });
              continue;
            }
            try {
              if (action === 'delete') {
                let qb = trx.deleteFrom(ctx.table.id);
                for (const [column, value] of Object.entries(pk)) {
                  qb = qb.where((eb) => eb(trx.dynamic.ref(column), '=', value));
                }
                await qb.execute();
                beforeImages.push(before);
              } else {
                let qb = trx.updateTable(ctx.table.id).set(values as never);
                for (const [column, value] of Object.entries(pk)) {
                  qb = qb.where((eb) => eb(trx.dynamic.ref(column), '=', value));
                }
                await qb.execute();
                const after = await fetchByPk(tdb, ctx.table, pk);
                beforeImages.push(before);
                if (after !== undefined) afterImages.push(after);
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
                action === 'update' && values !== null ? Object.keys(values) : [],
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
        const data = maskRow(row, ctx.table, ctx.unmasked);
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
        let inserted: Row;
        try {
          inserted = (await ctx.db
            .insertInto(ctx.table.id)
            .values(values as never)
            .returningAll()
            .executeTakeFirstOrThrow()) as Row;
        } catch (error) {
          mapDbError(error);
        }
        const pk = Object.fromEntries(ctx.table.primaryKey.map((c) => [c, inserted[c]]));
        const undoToken = issueUndo(request, ctx, 'create', [], [inserted]);
        await afterMutation(request, ctx, 'create', recordRef(ctx, pk), null, inserted);
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
        const before = await fetchByPk(ctx.db, ctx.table, pk);
        if (before === undefined) throw new NotFoundError('Record not found.', { pk });
        try {
          let qb = ctx.db.updateTable(ctx.table.id).set(values as never);
          for (const [column, value] of Object.entries(pk)) {
            qb = qb.where((eb) => eb(ctx.db.dynamic.ref(column), '=', value));
          }
          await qb.execute();
        } catch (error) {
          mapDbError(error);
        }
        const after = (await fetchByPk(ctx.db, ctx.table, pk)) ?? before;
        const undoToken = issueUndo(request, ctx, 'update', [before], [after], Object.keys(values));
        await afterMutation(request, ctx, 'update', recordRef(ctx, pk), before, after);
        // Masked columns may be written but are never echoed back (§2.7.2).
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
          // No write happens — cascade-modal payload (§2.7.2).
          return { references, requiresConfirm: inbound > 0 };
        }
        if (inbound > 0 && request.query.confirm !== true) {
          throw new ConflictError(
            'Record has inbound references — retry with ?confirm=true after reviewing them.',
            'CONFLICT',
            { references },
          );
        }
        try {
          let qb = ctx.db.deleteFrom(ctx.table.id);
          for (const [column, value] of Object.entries(pk)) {
            qb = qb.where((eb) => eb(ctx.db.dynamic.ref(column), '=', value));
          }
          await qb.execute();
        } catch (error) {
          mapDbError(error);
        }
        const undoToken = issueUndo(request, ctx, 'delete', [before], []);
        await afterMutation(request, ctx, 'delete', recordRef(ctx, pk), before, null);
        return { data: maskRow(before, ctx.table, ctx.unmasked), undoToken };
      },
    );
  };
}
