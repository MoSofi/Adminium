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
import {
  connectionTenantConfig,
  optionListsRepo,
  overridesRepo,
  publicChallengesRepo,
  publicEndpointsRepo,
  snapshotsRepo,
  type MetaDb,
  type RecordRef,
} from '@adminium/meta';
import type { DatabaseModel, Dialect } from '@adminium/engine';
import type { TablePrivileges } from '@adminium/engine/adapter';
import { builtinOptionValues } from '@adminium/engine/config';
import type { Kysely } from 'kysely';

import { AppError, ConflictError, ForbiddenError, NotFoundError, ValidationFailedError } from '../../errors.js';
import { applyOverrides } from '../../connections/effective-schema.js';
import { DAY_MS, PERSON_FAILURES_DAY, addressKey, hashAddress, plausibleAddress, subjectOf } from '../../public-api/claim-code.js';
import { linkSubject } from '../../public-api/sign-in-link.js';
import { PersonRaced, PersonRefused, PersonTableUnusable, resolvePerson } from '../../crud/person.js';
import { generateCode, isUniqueViolation } from '../../crud/decided-columns.js';
import { auditExempt, audited } from '../../audit/coverage.js';
import { parseDefinition } from '../../public-api/endpoint.js';
import type { ConnectionManager, SourceDatabase } from '../../connections/manager.js';
import { isPrivilegeRefusal, privilegeRefusal, privilegesOf, writeRefused } from '../../connections/privileges.js';
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
import { canReadPii, codeColumnsOf, maskRow, piiCheckFor, type Row } from '../../crud/mask.js';
import { renewedBy, renewForUndo, withRenewRetry } from '../../crud/code-renew.js';
import { assertWithinLimit, updateLimitOf, type UpdateLimit } from '../../rbac/update-limits.js';
import {
  fetchByPk,
  parseRecordId,
  pkLabel,
  referenceCounts,
  type ReferenceCount,
} from '../../crud/records.js';
import { isWriteConflict, readDbRefusal, writeConflict } from '../../crud/db-errors.js';
import { labelColumnFor } from '../../crud/labels.js';
import { numbersWithoutGaps, tableRulesFor } from '../../crud/column-rules.js';
import { sealRows, sealsOf } from '../../crud/seal.js';
import { batchNeedsGuard } from '../../crud/capacity/door.js';
import type { JudgedRow, LockNameRow } from '../../crud/capacity/types.js';
import { guardOf, tiedToStates, withoutRepeatedState, type EffectWritten } from '../../crud/states.js';
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
  invalidateWidgetData,
  publishChildWrite,
  type RecordWriteAction,
} from '../../crud/after-record-write.js';
import type { FileReconciler } from '../../files/reconcile.js';
import { normalizeWriteValue } from '../../crud/write-values.js';
import { bookingDays, bookingSlots, kindMinutes } from '../../crud/booking-guard.js';
import { capacityCounts } from '../../crud/capacity/counts.js';
import { quoteNights, storedNights } from '../../crud/per-night.js';
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
import type { TreeNode, TreeOutcome, TreePath } from '../../crud/write-tree.js';
import { TreeCheckRefused } from '../../public-api/tree-checks.js';
import { staffTreeRules } from './tree.js';

/**
 * How many links one record's field reads and replaces.
 *
 * A record with more links than this has an association LIST, not a field:
 * the picker cannot draw two thousand chips and nobody can review them in a
 * dialog. The read says `hasMore`, and the related tab is where that record's
 * links are actually managed.
 */
const LINK_READ_CAP = 200;
import { withOccurredAt } from '../../crud/occurred-at.js';
import { withSeenState } from '../../crud/seen-state.js';
import { moveBackOf } from '../../crud/undo-moves.js';
import { announceEffects, effectsOf } from '../../states/effects.js';
import { isStateRefusal } from '../../crud/state-conditions.js';
import {
  createWriteService,
  deleteRows,
  insertRow,
  insertRows,
  requestWriteContext,
  uncheckedForUndo,
  updateRows,
  writeSeals,
  type CheckedRow,
  type PlannedRow,
  type PreparedRow,
  type RecordWriteService,
  type WriteAction,
  type WriteContext,
  type WriteTarget,
  type WrittenRow,
} from '../../crud/write-service.js';
import { writeStores } from '../../crud/write-stores.js';
import {
  dataRecordParams,
  dataTableParams,
  recordBulkBody,
  recordBulkReply,
  recordCreateBody,
  recordDryRunReply,
  recordDeleteQuery,
  recordDeleteReply,
  recordGetQuery,
  recordListQuery,
  availabilityQuery,
  availabilityReply,
  bookingSlotsQuery,
  capacityCountsQuery,
  capacityCountsReply,
  nightlyQuery,
  nightlyReply,
  bookingSlotsReply,
  recordLinksParams,
  recordLinksQuery,
  recordLinksReply,
  recordListReply,
  recordMutationReply,
  recordReply,
  recordUpdateBody,
  referencesReply,
  claimLockClearedReply,
  claimLockReply,
  regenerateCodeBody,
  undoParams,
  undoReply,
  findPersonBody,
  findPersonReply,
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
  /**
   * The server's secret, to name a sign-in-link person's code lock by their
   * address as the public side keys it. Absent: only locks kept by the row.
   */
  secret?: string | undefined;
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
 *
 * A lock conflict (deadlock, serialization failure, busy SQLite file) is none
 * of these: it is 409 `WRITE_CONFLICT` with `{ retry: true }`, table or not.
 */
/**
 * The columns of the unique rule a refused write broke, read from what each
 * engine says — Postgres names the constraint, MySQL the key, SQLite the
 * columns themselves — and kept only when they are the table's own.
 */
export function uniqueColumnsOf(dbError: { constraint?: string; message?: string }, table: ResolvedTable): string[] | null {
  const own = (columns: readonly string[]) => (columns.length > 0 && columns.every((c) => table.columns.has(c)) ? [...columns] : null);
  const byName = (name: string): string[] | null => {
    const model = table.table;
    const found = [...(model?.uniques ?? []), ...(model?.indexes ?? []).filter((index) => index.unique)].find((rule) => rule.name === name);
    return found === undefined ? null : own(found.columns);
  };
  if (typeof dbError.constraint === 'string') return byName(dbError.constraint);
  const message = dbError.message ?? '';
  const mysql = /for key '(?:[^'.]*\.)?([^']+)'/.exec(message);
  if (mysql !== null) return byName(mysql[1]!);
  const sqlite = /UNIQUE constraint failed: (.+)$/.exec(message);
  if (sqlite !== null) return own(sqlite[1]!.split(',').map((part) => part.trim().split('.').at(-1)!));
  return null;
}

export function mapDbError(error: unknown, table?: ResolvedTable): never {
  if (isWriteConflict(error)) throw writeConflict();
  const dbError = error as { code?: string; detail?: string; constraint?: string; message?: string };
  const message = typeof dbError.message === 'string' ? dbError.message : '';
  if (
    dbError.code === '23505' ||
    dbError.code === 'ER_DUP_ENTRY' ||
    message.includes('UNIQUE constraint failed')
  ) {
    const columns = table === undefined ? null : uniqueColumnsOf(dbError, table);
    throw new ConflictError('A record with this value already exists.', 'UNIQUE_VIOLATION', {
      constraint: dbError.constraint ?? null,
      detail: dbError.detail ?? null,
      // The columns the rule keeps unique (together), so a form marks each: only the table's own.
      ...(columns === null ? {} : { columns }),
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
  // Checked up front where the rights are known; this is the database saying it
  // itself (rights unknown, or revoked within the last minute).
  if (isPrivilegeRefusal(error)) throw privilegeRefusal(table);
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
  const writes = deps.writes ?? createWriteService(writeStores(meta));
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
      /*
       * 401 without a principal, BEFORE any lookup. The resolution below
       * answers differently for a missing connection, an un-introspected one,
       * an unknown table and a real one, so a signed-out caller holding a
       * connection id could list its table names; and `request.can` is merely
       * false for them, so a real table answered 403 and wrote a
       * `permission.denied` audit row with no actor. `widget-data` and the
       * undo route below have always opened this way.
       */
      await app.rbac.resolve(request);
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
      let rights: TablePrivileges | null = null;
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
        const map = await manager.tablePrivileges(connection);
        if (writeRefused(map, table.id, action)) throw privilegeRefusal(table);
        rights = privilegesOf(map, table.id);
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
        // This table's personal columns; a lookup asks of the table it reaches.
        unmasked: await canReadPii(request, connectionId, table.id),
        target: { connectionId, view, table, db, dialect, rights },
      };
    }

    /**
     * What this caller's update on one table may write, or null for anything
     * (rbac/update-limits.ts). Asked with what the caller SENT, before a rule
     * or a hook adds to it: a stamp a status change sets is not theirs.
     */
    async function updateLimitFor(request: FastifyRequest, connectionId: string, tableId: string): Promise<UpdateLimit | null> {
      return updateLimitOf(await app.rbac.resolve(request), connectionId, tableId);
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

    /** Whether a column carries `column.venueLocal`: its times are judged by the write service. */
    function isVenueLocal(table: ResolvedTable, column: string): boolean {
      return table.table?.columns.some((c) => c.name === column && c.venueLocal === true) === true;
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
        // A venue-local column is left to the write service, which reads a
        // zone-less wall time on the venue's clock FIRST: re-encoding a zoned
        // instant here would hand it a server wall time to misread as the
        // venue's, moving the booking by the difference between the zones.
        out[column.name] = isVenueLocal(ctx.table, column.name) ? value : normalizeWriteValue(column, value);
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

    /** A child row a parent's write changed, announced once the transaction commits. */
    interface ChildEvent {
      table: ResolvedTable;
      action: 'create' | 'update' | 'delete';
      pk: Row;
      row: Row | null;
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
      /** What the caller's update on the CHILD table may write (rbac/update-limits.ts). */
      updateLimit: UpdateLimit | null;
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
          updateLimit: await updateLimitFor(request, ctx.connectionId, id),
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
        out[column.name] = isVenueLocal(child.child, column.name) ? value : normalizeWriteValue(column, value);
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
      options: {
        existing?: Row[] | undefined;
        /** Each child row this write changed, to announce once it commits. */
        events?: ChildEvent[] | undefined;
        /** Written under their pools' locks by a caller that judges them there. */
        judged?: boolean | undefined;
        /** The rows the child rows' moves moved too, to announce once it commits. */
        effects?: EffectWritten[] | undefined;
      } = {},
    ): Promise<UndoChildren> {
      const limits = options.judged === true ? ({ capacity: 'judged' } as const) : undefined;
      const { child } = requested;
      const target = childTargetOf(ctx, child, db);
      const keyOf = (row: Row) => Object.fromEntries(child.child.primaryKey.map((name) => [name, row[name]]));
      // What the children moved: a parent's total over them is settled inside
      // the same transaction, as a child written on its own would be.
      const settled: { action: 'create' | 'update' | 'delete'; record: Row; before: Row | null }[] = [];
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
        const [prepared] = await writes.beforeEach('create', target, context, [{ values: row }], limits);
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
        undo.added.push(keyOf(written));
        (undo.addedRows ??= []).push(written);
        settled.push({ action: 'create', record: written, before: null });
        options.events?.push({ table: child.child, action: 'create', pk: keyOf(written), row: written });
      }

      for (const change of diff.changed) {
        const before = existing.find((row) =>
          child.child.primaryKey.every((name) => String(row[name]) === String(change.key[name])),
        );
        // Every existing row a form sends is "changed"; only what moved is judged.
        assertWithinLimit(requested.updateLimit, child.child.id, change.values, before ?? null);
        const [prepared] = await writes.beforeEach('update', target, context, [
          // The state a row sent back whole already holds is no move.
          { match: change.key, values: withoutRepeatedState(child.child, change.values, before) },
        ], limits);
        if (prepared === undefined) throw new AppError(500, 'INTERNAL', 'The write could not be prepared.');
        if (prepared.issues !== null) {
          throw new ValidationFailedError('Some values were refused.', {
            fields: prepared.issues,
            relation: child.relationId,
          });
        }
        try {
          // A code the change renewed is made again if the new one is taken.
          await withRenewRetry(db, ctx.dialect, prepared.values, (values) => updateRows(db, ctx.dialect, child.child, values, change.key));
        } catch (error) {
          mapDbError(error, child.child);
        }
        options.effects?.push(...effectsOf(prepared.values));
        const after = (await fetchByPk(db, child.child, change.key)) ?? null;
        if (before !== undefined) undo.changed.push({ key: change.key, before, ...(after === null ? {} : { after }) });
        if (after !== null) settled.push({ action: 'update', record: after, before: before ?? null });
        options.events?.push({ table: child.child, action: 'update', pk: change.key, row: after });
      }

      for (const key of diff.removed) {
        const before = existing.find((row) =>
          child.child.primaryKey.every((name) => String(row[name]) === String(key[name])),
        );
        // A child row removed is a delete like any other: its before hooks,
        // and the states of the document it belongs to (a sent invoice's
        // lines stay), judged where it is deleted.
        const [prepared] = await writes.beforeEach('delete', target, context, [{ match: key, values: {}, record: before ?? null }], limits);
        if (prepared !== undefined && prepared.issues !== null) {
          throw new ValidationFailedError('Some values were refused.', { fields: prepared.issues, relation: child.relationId });
        }
        try {
          await deleteRows(db, child.child, key, undefined, prepared === undefined ? undefined : { dialect: ctx.dialect, prepared: prepared.values });
        } catch (error) {
          mapDbError(error, child.child);
        }
        if (before !== undefined) {
          undo.removed.push(before);
          settled.push({ action: 'delete', record: before, before: null });
        }
        options.events?.push({ table: child.child, action: 'delete', pk: key, row: before ?? null });
      }
      // Inside the form's transaction: a payment row the balance has no room
      // for refuses the whole save.
      for (const action of ['create', 'update', 'delete'] as const) {
        const rows = settled.filter((row) => row.action === action);
        if (rows.length > 0) await writes.settle(action, target, rows, { cap: true });
      }
      return undo;
    }


    /**
     * A RECORD WITH ITS CHILD ROWS, AND THEIR ROWS (an order, its lines, each
     * line's options): one write through the write service's tree — every
     * row's rules, every limit, the totals settled bottom-up, every row or
     * none — held to what the app declares for its guests' creates of the
     * same rows (`routes/data/tree.ts`). A quote (`dry`) runs the same and
     * keeps nothing. Refusals name the relation and the row.
     */
    async function staffTree(
      request: FastifyRequest,
      ctx: DataContext,
      context: WriteContext,
      values: Row,
      links: RequestedLink[],
      children: RequestedChildren[],
      raw: Record<string, { key?: Row | undefined; values: Row; children?: Record<string, { values: Row }[]> | undefined }[]>,
      mode: 'save' | 'dry',
    ): Promise<{ outcome: TreeOutcome; links: { relationId: string; before: string[]; after: string[] }[]; children: UndoChildren[]; events: ChildEvent[] }> {
      const relations = new Map<string, ResolvedChild>();
      // What the app declares for its guests' creates of these rows: the lists below each row, and what they are held to.
      const rules = await staffTreeRules(deps.meta, ctx.connectionId, ctx.view, ctx.table, (name, parentTable) => {
        let relation = relations.get(name);
        if (relation === undefined) {
          const resolution = resolveChild(ctx.view, parentTable, name);
          if (!resolution.ok) return null;
          relation = resolution.child;
          relations.set(name, relation);
        }
        return { table: relation.child, via: relation.foreignColumn };
      });
      const forbidden = (child: ResolvedChild): never => {
        throw new ForbiddenError(`You do not have permission to create rows of ${child.child.name}.`, 'TABLE_FORBIDDEN', {
          permission: `table:${ctx.connectionId}:${child.child.id}:create`,
        });
      };
      const level1: TreeNode[] = [];
      for (const requested of children) {
        const { child } = requested;
        if (requested.rows.length > 0 && !requested.canCreate) forbidden(child);
        relations.set(child.relationId, child);
        for (const [index, row] of requested.rows.entries()) {
          const at = [child.relationId, index];
          const below: TreeNode[] = [];
          for (const [relationId, rows] of Object.entries(raw[child.relationId]?.[index]?.children ?? {})) {
            const resolution = resolveChild(ctx.view, child.child, relationId);
            if (!resolution.ok) {
              throw new ValidationFailedError(resolution.refusal.reason, { fields: { [relationId]: { code: 'not-allowed' } }, relation: relationId });
            }
            const grandchild = resolution.child;
            if (rows.length > 0 && !(await request.can(`table:${ctx.connectionId}:${grandchild.child.id}:create`))) forbidden(grandchild);
            relations.set(relationId, grandchild);
            for (const [j, grandRow] of rows.entries()) {
              below.push({
                name: relationId,
                target: childTargetOf(ctx, grandchild, ctx.db),
                values: allowlistChild(ctx, grandchild, grandRow.values),
                via: { column: grandchild.foreignColumn, parentKey: grandchild.parentKeyColumn },
                at: [...at, relationId, j],
                children: [],
              });
            }
          }
          level1.push({
            name: child.relationId,
            target: childTargetOf(ctx, child, ctx.db),
            values: row.values,
            via: { column: child.foreignColumn, parentKey: child.parentKeyColumn },
            at,
            children: below,
            lists: [...new Set([...Object.keys(raw[child.relationId]?.[index]?.children ?? {}), ...rules.listsOf(child.child, 1)])],
          });
        }
      }
      const root: TreeNode = {
        name: ctx.table.name,
        target: ctx.target,
        values,
        at: [],
        children: level1,
        lists: [...new Set([...children.map((requested) => requested.child.relationId), ...rules.listsOf(ctx.table, 0)])],
      };
      const tableAt = (at: TreePath): ResolvedTable => (at.length === 0 ? ctx.table : (relations.get(String(at[at.length - 2]))?.child ?? ctx.table));
      const written: { relationId: string; before: string[]; after: string[] }[] = [];
      const events: ChildEvent[] = [];
      const outcome = await writes.createTree({
        root,
        context,
        mode,
        checks: rules.checks,
        siblings: rules.siblings,
        // The record's link rows, in the same transaction (a quote links nothing).
        ...(mode === 'dry' || links.length === 0
          ? {}
          : {
              inside: async (db, made) => {
                for (const requested of links) written.push(await applyLinks(ctx, db, requested, made[requested.link.ownKeyColumn], context, { existing: [] }));
              },
            }),
        announce: async (row) => {
          const of = row.node.target.table;
          const pk = Object.fromEntries(of.primaryKey.map((c) => [c, row.record[c]]));
          if (row.node.at.length === 0) await afterMutation(request, ctx, 'create', recordRef(ctx, pk), null, row.record);
          else events.push({ table: of, action: 'create', pk, row: row.record });
        },
        mapError: (error, at) => {
          // The row a refusal is about: its relation and its place, and the row it hangs from.
          const where =
            at.length >= 2
              ? { relation: String(at[at.length - 2]), row: Number(at[at.length - 1]), ...(at.length === 4 ? { under: { relation: String(at[0]), row: Number(at[1]) } } : {}) }
              : {};
          if (error instanceof ValidationFailedError) throw new ValidationFailedError(error.message, { ...((error.details as Record<string, unknown> | undefined) ?? {}), ...where });
          if (error instanceof AppError) throw error;
          return mapDbError(error, tableAt(at));
        },
      });
      // What the undo takes away: the rows added, by relation, and below each the rows added under them.
      const undo = new Map<string, UndoChildren>();
      for (const row of outcome.rows) {
        const at = row.node.at;
        if (at.length === 0) continue;
        const top = undo.get(String(at[0])) ?? { relationId: String(at[0]), added: [], addedRows: [], removed: [], changed: [], nested: [] };
        undo.set(String(at[0]), top);
        let list = top;
        if (at.length === 4) {
          const nested = top.nested!.find((entry) => entry.relationId === String(at[2]));
          list = nested ?? { relationId: String(at[2]), added: [], addedRows: [], removed: [], changed: [] };
          if (nested === undefined) top.nested!.push(list);
        }
        const of = row.node.target.table;
        list.added.push(Object.fromEntries(of.primaryKey.map((c) => [c, row.record[c]])));
        list.addedRows!.push(row.record);
      }
      return { outcome, links: written, children: [...undo.values()], events };
    }

    /**
     * What a record of this table agrees to be (a stay's guests within what its
     * room sleeps), as the app declares it for its guests' creates: judged on
     * the row as written, inside the write, on every door that writes one — or
     * null when nothing is declared.
     */
    async function recordAgrees(ctx: DataContext): Promise<((db: Kysely<SourceDatabase>, row: Row) => Promise<void>) | null> {
      const rules = await staffTreeRules(deps.meta, ctx.connectionId, ctx.view, ctx.table, () => null);
      return rules.rootAgrees ? (db, row) => rules.judgeRecord(db, row) : null;
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
      if (remove.length > 0) {
        // A link row taken away is a delete like any other: its before hooks,
        // and the states of the document it belongs to (a sent invoice keeps its tags).
        const target = linkTargetOf(ctx, link, db);
        for (const key of remove) {
          const match = linkRowValues(link, ownKey, key);
          const [prepared] = await writes.beforeEach('delete', target, context, [{ match, values: {} }]);
          if (prepared !== undefined && prepared.issues !== null) {
            throw new ValidationFailedError('Some values were refused.', { fields: { [link.relationId]: { code: 'not-allowed' } }, relation: link.relationId });
          }
          await deleteRows(db, link.linkTable, match, undefined, prepared === undefined ? undefined : { dialect: ctx.dialect, prepared: prepared.values });
        }
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

    /** A write's child rows at every level: each list, then the lists below its rows. */
    function everyLevel(children: readonly UndoChildren[]): UndoChildren[] {
      return children.flatMap((child) => [child, ...everyLevel(child.nested ?? [])]);
    }

    /**
     * Whether undoing this write would delete a row numbered without gaps: a
     * create of one, or child rows added to a table that numbers them. An undo
     * deletes with no rules (it restores history), so INV-0042 would be gone
     * and — the newest — handed out again to the next invoice. Such a write is
     * given no undo; a mistake is voided, never unwritten.
     */
    function takesNumberBack(ctx: DataContext, action: UndoAction, children: readonly UndoChildren[]): boolean {
      if (action === 'create' && numbersWithoutGaps(tableRulesFor(ctx.target))) return true;
      return everyLevel(children).some((child) => {
        if (child.added.length === 0) return false;
        const relation = ctx.view.model.relations.find((candidate) => candidate.id === child.relationId);
        if (relation === undefined) return false;
        return numbersWithoutGaps(tableRulesFor({ view: ctx.view, table: ctx.view.table(relation.from.tableId) }));
      });
    }

    /**
     * Whether undoing this write would take a document's life back: a write
     * to a table that keeps states, or to rows tied to one (a sent invoice's
     * lines, its payments). An undo writes with no rules — it restores
     * history — so it would put a sent invoice back to draft after its email
     * went, or a line back onto a locked invoice. Such a write is given no
     * undo; a mistake is moved on (voided, sent back), never unwritten.
     */
    function takesStateBack(ctx: DataContext, children: readonly UndoChildren[], links: readonly UndoLinks[] = []): boolean {
      if (tiedToStates(ctx.table)) return true;
      const childTied = everyLevel(children).some((child) => {
        const relation = ctx.view.model.relations.find((candidate) => candidate.id === child.relationId);
        return relation !== undefined && tiedToStates(ctx.view.table(relation.from.tableId));
      });
      // An undo puts link rows back with no rules too: a link table tied to a document's states is the document's.
      const linkTied = links.some((entry) => {
        if (sameKeys(entry.before, entry.after)) return false;
        const resolution = resolveLink(ctx.view, ctx.table, entry.relationId);
        return resolution.ok && tiedToStates(resolution.link.linkTable);
      });
      return childTied || linkTied;
    }

    /**
     * A change's reply without the codes it made (a ticket handed on), for a
     * caller who may change the table but not read it — as "make a new link"
     * answers: one who may only change a row is not handed its new secret.
     */
    async function unreadCodesOut(request: FastifyRequest, ctx: DataContext, data: Row, before: Row, after: Row | null): Promise<Row> {
      if (renewedBy({ values: {}, before, after }, ctx.table.table.columns).size === 0) return data;
      if (await request.can(`table:${ctx.connectionId}:${ctx.table.id}:read`)) return data;
      for (const name of codeColumnsOf(ctx.table)) delete data[name];
      return data;
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
      /** Rows of other tables the write's move moved too (a room set to cleaning): no move back would take them back. */
      effected: readonly unknown[] = [],
    ): string | null {
      const userId = principalId(request);
      if (userId === null || ctx.table.primaryKey.length === 0) return null;
      // A code a change made (a ticket handed on) is never taken back: the old secret stays dead, the rest is undone.
      if (action === 'update' && changedColumns.some((column) => codeColumnsOf(ctx.table).has(column))) {
        changedColumns = changedColumns.filter((column) => !codeColumnsOf(ctx.table).has(column));
        if (changedColumns.length === 0) return null;
      }
      // No undo that would delete a row numbered without gaps, or take a document's state back — but a status move the app lists an undo for.
      const moveBack = action === 'update' && children.length === 0 && links.length === 0 && effected.length === 0 ? moveBackOf(ctx.table.table, before, after, changedColumns) : null;
      if (takesNumberBack(ctx, action, children) || (takesStateBack(ctx, children, links) && moveBack === null)) return null;
      const { token } = undoStore.issue({
        ...(moveBack === null ? {} : { moveBack }),
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
        canReadPii: piiCheckFor(request, ctx.connectionId),
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
        // A token issued before the table numbered its rows without gaps: the rule decides now.
        const undone: DataContext = { connectionId: entry.connectionId, view, table, db, dialect, unmasked: false, target };
        if (takesNumberBack(undone, entry.action, entry.children)) {
          throw new ConflictError(
            'This record has a number from an unbroken series, so creating it cannot be undone. Void it instead.',
            'CONFLICT',
            { reason: 'UNDO_NUMBERED' },
          );
        }
        // A status move the app lists an undo for is taken back by that move: judged, stamped and told like any.
        if (entry.moveBack !== undefined) return undoByMove(request, undone, entry, entry.moveBack);
        // A token issued before the table kept states: the rule decides now.
        if (takesStateBack(undone, entry.children, entry.links)) {
          throw new ConflictError('This record moves through states, so a change to it cannot be undone.', 'CONFLICT', { reason: 'UNDO_STATES' });
        }
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
        invalidateWidgetData(app, entry.connectionId, entry.tableId);
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
     * An undo of a status move: the table's move marked `undo` the other way,
     * made as the writer's own change naming the state it left the row in —
     * so a row moved on since is refused, what the move waits for is judged,
     * the stamps it wrote are emptied and a waiting message is dropped.
     */
    async function undoByMove(request: FastifyRequest, ctx: DataContext, entry: UndoEntry, back: NonNullable<UndoEntry['moveBack']>) {
      const pk = Object.fromEntries(entry.pkColumns.map((column) => [column, entry.after[0]?.[column]]));
      const outcome = await writes.update({
        target: ctx.target,
        pk,
        values: withSeenState(ctx.table, { [back.column]: back.to }, back.from),
        context: requestWriteContext(request, 'dashboard'),
        mapError: (error) => mapDbError(error, ctx.table),
        announce: async (result) => {
          await afterMutation(request, ctx, 'update', recordRef(ctx, pk), result.before ?? entry.after[0]!, result.after ?? entry.before[0]!);
          await announceEffects(app, { connectionId: ctx.connectionId, view: ctx.view, effects: result.effects, origin: 'dashboard', request });
        },
      });
      invalidateWidgetData(app, entry.connectionId, entry.tableId);
      await app.rbac.audit(request, {
        category: 'data',
        action: 'record.undo',
        connectionId: entry.connectionId,
        changes: { after: { table: entry.tableId, action: entry.action, restored: outcome.count, moveBack: back } },
      });
      if (app.hasDecorator('realtime')) app.realtime.publish(`table:${entry.connectionId}:${entry.tableId}`, 'record.undo', { action: entry.action });
      return { restoredIds: outcome.count > 0 ? [pkLabel(ctx.table, pk)] : [] };
    }

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
          await insertRows(db, target.dialect, link.linkTable, uncheckedForUndo([linkRowValues(link, ownKey, key)]));
        }
        for (const key of remove) {
          await deleteRows(db, link.linkTable, linkRowValues(link, ownKey, key));
        }
      }
    }

    /** Rows of one table an undo took away, put back or changed back. */
    interface UndoneRows {
      target: WriteTarget;
      action: 'create' | 'update' | 'delete';
      rows: WrittenRow[];
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
      entry: Pick<UndoEntry, 'children'>,
      context: WriteContext,
      conflict: () => never,
      /** What each table's rows fed, to settle once every row is back (see {@link settleUndone}). */
      moved: UndoneRows[],
    ): Promise<void> {
      for (const children of entry.children) {
        // The rows added below the rows added here go first: they point at them.
        if ((children.nested?.length ?? 0) > 0) {
          const above = resolveChild(target.view, target.table, children.relationId);
          if (above.ok) await undoChildren(db, { ...target, table: above.child.child }, { children: children.nested! }, context, conflict, moved);
        }
        const resolution = resolveChild(target.view, target.table, children.relationId);
        if (!resolution.ok) continue;
        const child = resolution.child.child;
        const childTarget: WriteTarget = { ...target, db, table: child };
        /*
         * Each child row goes back only while it is still as this write left
         * it — the conflict rule the parent follows — and through the child
         * table's before hooks, as any write to it: a message the outbox has
         * sent since is not put back to held, to be sent a second time.
         */
        const still = async (key: Row, image: Row | undefined): Promise<void> => {
          if (image === undefined) return;
          const now = await fetchByPk(db, child, key);
          if (now === undefined || !rowsEqual(now, image, Object.keys(image))) conflict();
        };
        const judge = async (action: WriteAction, planned: PlannedRow): Promise<CheckedRow> => {
          const [prepared] = await writes.beforeEach(action, childTarget, context, [planned], { rules: false });
          return prepared?.values ?? uncheckedForUndo([planned.values])[0]!;
        };
        // What each row fed as it goes, comes back or changes back: settled once every row is as it was.
        const gone: WrittenRow[] = [];
        const back: WrittenRow[] = [];
        const changedBack: WrittenRow[] = [];
        for (const [i, key] of children.added.entries()) {
          await still(key, children.addedRows?.[i]);
          const record = children.addedRows?.[i] ?? (await fetchByPk(db, child, key));
          await judge('delete', { match: key, values: {}, record: children.addedRows?.[i] });
          await deleteRows(db, child, key);
          if (record !== undefined) gone.push({ record, before: null });
        }
        for (const row of children.removed) {
          await insertRows(db, target.dialect, child, [await judge('create', { values: row })]);
          back.push({ record: row, before: null });
        }
        for (const change of children.changed) {
          await still(change.key, change.after);
          const current = (await fetchByPk(db, child, change.key)) ?? null;
          // A code a change made is never taken back: the rest of the row is.
          const codes = codeColumnsOf(child);
          const judged = await judge('update', { match: change.key, values: Object.fromEntries(Object.entries(change.before).filter(([column]) => !codes.has(column))), record: current });
          const renewed = current === null ? judged : renewForUndo(tableRulesFor(childTarget)?.codes, judged, current, { table: child, rights: childTarget.rights });
          await withRenewRetry(db, target.dialect, renewed, (values) => updateRows(db, target.dialect, child, values as typeof judged, change.key));
          const record = await fetchByPk(db, child, change.key);
          if (record !== undefined) changedBack.push({ record, before: current });
        }
        moved.push({ target: childTarget, action: 'delete', rows: gone }, { target: childTarget, action: 'create', rows: back }, { target: childTarget, action: 'update', rows: changedBack });
      }
    }

    /**
     * The totals the rows an undo took away, put back or changed back fed —
     * a total outside the write too (a ticket type's sales) — settled inside
     * the undo's transaction, once every row is as it was: settled earlier,
     * a row the undo still compares against would no longer match its image.
     */
    async function settleUndone(moved: readonly UndoneRows[]): Promise<void> {
      for (const { target, action, rows } of moved) if (rows.length > 0) await writes.settle(action, target, rows);
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
        const moved: UndoneRows[] = [];
        if (entry.action === 'delete') {
          // Restore rows with their ORIGINAL PKs.
          for (const [i, before] of entry.before.entries()) {
            const existing = await fetchByPk(tdb, table, pkOf(before));
            if (existing !== undefined) conflict();
            await insertRows(tdb, target.dialect, table, [prepared[i]?.values ?? uncheckedForUndo([before])[0]!]);
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
            // A change of hands taken back makes its code again: the one handed on stops working with it.
            const renewed = renewForUndo(tableRulesFor(target)?.codes, restoreValues, current!, { table, rights: target.rights });
            await withRenewRetry(tdb, target.dialect, renewed, (values) => updateRows(tdb, target.dialect, table, values as typeof restoreValues, pk));
            await undoLinks(tdb, target, entry, before, conflict);
            await undoChildren(tdb, target, entry, context, conflict, moved);
            restored.push(pkLabel(table, pk));
            written.push({ pk, before: current ?? null, record: null });
          }
          await settleUndone(moved);
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
          await undoChildren(tdb, target, entry, context, conflict, moved);
          await deleteRows(tdb, table, pk);
          restored.push(pkLabel(table, pk));
          written.push({ pk, before: null, record: current });
        }
        await settleUndone(moved);
        return { restored, written };
      });
      // The rows as they stand now, for the totals they feed and for after
      // hooks — read only when either needs them.
      const rules = tableRulesFor(target);
      const settles = (rules?.rollupsInto?.length ?? 0) + (rules?.ownRollups?.length ?? 0) > 0;
      const written: WrittenRow[] = [];
      if (outcome.written.length > 0 && (settles || (await writes.wants('after', UNDO_WRITE[entry.action], target, context)))) {
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
        // One `values` for every row, so every column sent counts as a change.
        if (values !== null) assertWithinLimit(await updateLimitFor(request, ctx.connectionId, ctx.table.id), ctx.table.id, values);
        const context = requestWriteContext(request, 'bulk');
        const pks = request.body.ids.map((id) => pkFromLoose(ctx.table, id));
        /*
         * A delete the table's states refuse (a numbered invoice, a sent one's
         * lines) is refused straight away, naming the row, before any hook
         * runs or any row goes. The transaction below judges again.
         */
        if (action === 'delete' && tiedToStates(ctx.table)) {
          for (const [i, pk] of pks.entries()) {
            const row = await fetchByPk(ctx.db, ctx.table, pk);
            if (row === undefined) continue;
            const refused = await writes.deleteRefusal(ctx.target, context, [row]);
            if (refused !== null) throw new AppError(refused.statusCode, refused.code, refused.message, { ...(refused.details as object), id: request.body.ids[i] });
          }
        }
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
        // The rows the moves moved too (`states.effects`), announced once the batch commits.
        const effected: EffectWritten[] = [];
        // What each changed record agrees to be, judged on the row as changed.
        const agrees = action === 'update' ? await recordAgrees(ctx) : null;

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
                await deleteRows(tdb, ctx.table, pk, undefined, { dialect: ctx.dialect, prepared: prepared[i]!.values });
                beforeImages.push(before);
                events.push({ pk, before, after: null });
              } else {
                await updateRows(tdb, ctx.dialect, ctx.table, prepared[i]!.values, pk);
                const after = await fetchByPk(tdb, ctx.table, pk);
                if (agrees !== null && after !== undefined) await agrees(tdb, after);
                beforeImages.push(before);
                if (after !== undefined) afterImages.push(after);
                events.push({ pk, before, after: after ?? before });
                effected.push(...(guardOf(prepared[i]!.values)?.effected ?? []));
              }
              results.push({ id, ok: true });
            } catch (error) {
              // A row the states refuse is named, like a refused value: one values object, one row that cannot take it.
              if (isStateRefusal(error)) throw new AppError((error as AppError).statusCode, (error as AppError).code, (error as AppError).message, { ...((error as AppError).details as object), id });
              // A record its agreement refuses: named, as a refused value is.
              if (error instanceof TreeCheckRefused) throw new ValidationFailedError(error.message, { ...((error.details as object | undefined) ?? {}), row: i, id });
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
                [],
                [],
                [],
                effected,
              );
        await app.rbac.audit(request, {
          category: 'data',
          action: `record.bulk-${action}`,
          connectionId: ctx.connectionId,
          changes: {
            after: { table: ctx.table.id, requested: request.body.ids.length, succeeded: okCount },
          },
        });
        invalidateWidgetData(app, ctx.connectionId, ctx.table.id);
        if (app.hasDecorator('realtime')) {
          app.realtime.publish(`table:${ctx.connectionId}:${ctx.table.id}`, `record.bulk-${action}`, {
            count: okCount,
          });
        }
        await announceEffects(app, { connectionId: ctx.connectionId, view: ctx.view, effects: effected, origin: 'bulk', request });
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

    // --- a person the desk links by address ------------------------------------

    /*
     * THE DESK LINKS A BOOKING TO A PERSON ONLY WHEN IT PICKS ONE. A staff
     * write never finds a guest by the address typed into it: a typo would
     * hand a real guest's stay to a stranger's account. The desk looks the
     * address up (an ordinary read of the people table), sees the match, and
     * — when it confirms it, or asks for a new person — calls this: the one
     * find-or-make every public create uses (trimmed, lower case, one person
     * per address, the same checks and grants), holding the right to add
     * people to the table. The answer says whether the person was already
     * there: the desk is not a stranger.
     */
    app.post(
      '/data/:connectionId/:table/person',
      {
        config: { audit: audited('rbac') },
        schema: {
          params: dataTableParams,
          body: findPersonBody,
          response: { 200: findPersonReply },
        },
      },
      async (request) => {
        const ctx = await contextFor(request, 'create');
        // The table's own sign-in by address names the column a person is found by.
        let email: string | undefined;
        for (const stored of await publicEndpointsRepo(meta).listByConnection(ctx.connectionId)) {
          const parsed = parseDefinition(stored.definition);
          if (parsed.ok && parsed.definition.source === ctx.table.id && parsed.definition.identity?.strategy === 'email-link') email = parsed.definition.identity.email;
        }
        if (email === undefined) throw new NotFoundError('Nobody is found by address in this table.', { table: ctx.table.id });
        if (!plausibleAddress(request.body.email)) throw new ValidationFailedError('That is not an address.', { fields: { [email]: { code: 'format' } } });
        const context = requestWriteContext(request, 'dashboard');
        const rights = privilegesOf(await manager.tablePrivilegesById(ctx.connectionId), ctx.table.id);
        const once = () =>
          writes.transaction(ctx.target, [], (tdb) =>
            resolvePerson({ writes, identity: { ...ctx.target, db: tdb, rights }, email: email!, address: request.body.email, fill: request.body.fill ?? {}, context }),
          );
        let person;
        try {
          try {
            person = await once();
          } catch (error) {
            // Made by another writer a moment ago: found this time.
            if (!(error instanceof PersonRaced)) throw error;
            person = await once();
          }
        } catch (error) {
          if (error instanceof PersonRefused) throw new ValidationFailedError('Some values were refused.', { fields: { [error.column]: { code: error.reason } } });
          if (error instanceof PersonTableUnusable) throw new ValidationFailedError(error.message, { table: ctx.table.id });
          if (error instanceof PersonRaced) throw writeConflict();
          throw mapDbError(error, ctx.table);
        }
        if (person.made !== null) {
          const pk = Object.fromEntries(ctx.table.primaryKey.map((c) => [c, person.made![c]]));
          await afterMutation(request, ctx, 'create', recordRef(ctx, pk), null, person.made);
        }
        if (person.link === null) throw new ValidationFailedError('That address only looks like one on file: pick the person instead.', { fields: { [email]: { code: 'look-alike' } } });
        return { data: { key: person.link, found: person.made === null } };
      },
    );

    // --- a person's code lock -----------------------------------------------------

    /**
     * The subjects a row is counted under when people find themselves by it:
     * one per public identity on this table, by that identity's own column —
     * the same as the claim route writes (`subjectOf`), whichever key or
     * endpoint the person came through.
     */
    async function claimSubjectsOf(ctx: DataContext, row: Row): Promise<{ rows: string[]; addresses: string[] }> {
      const subjects = new Set<string>();
      const addresses = new Set<string>();
      for (const stored of await publicEndpointsRepo(meta).listByConnection(ctx.connectionId)) {
        const parsed = parseDefinition(stored.definition);
        if (!parsed.ok || parsed.definition.source !== ctx.table.id || parsed.definition.identity === undefined) continue;
        const identity = parsed.definition.identity;
        const column = identity.column;
        if (row[column] !== undefined && row[column] !== null) subjects.add(subjectOf(ctx.connectionId, ctx.table.id, column, row[column]));
        // Signed in by an emailed link: the code path's lock is kept by the address, as the public side counts it.
        const email = identity.email === undefined ? undefined : row[identity.email];
        if (identity.verify === 'email-link' && typeof email === 'string' && deps.secret !== undefined) {
          addresses.add(linkSubject(hashAddress(addressKey(deps.secret), email)));
        }
      }
      return { rows: [...subjects], addresses: [...addresses] };
    }

    /*
     * The desk sees whether a person is locked out of the emailed code (too
     * many wrong codes today — perhaps someone else guessing), and lifts it
     * once they have checked who is asking. Reading needs the table's read;
     * lifting needs its update, like any change to the person's record.
     */
    app.get(
      '/data/:connectionId/:table/:recordId/claim-lock',
      { schema: { params: dataRecordParams, response: { 200: claimLockReply } } },
      async (request) => {
        const ctx = await contextFor(request, 'read');
        const pk = parseRecordId(ctx.table, request.params.recordId);
        const row = await fetchByPk(ctx.db, ctx.table, pk);
        if (row === undefined) throw new NotFoundError('Record not found.', { pk });
        const since = Date.now() - DAY_MS;
        let failures = 0;
        const { rows, addresses } = await claimSubjectsOf(ctx, row);
        for (const subject of rows) failures = Math.max(failures, await publicChallengesRepo(meta).failuresSince(subject, since));
        for (const subject of addresses) failures = Math.max(failures, await publicChallengesRepo(meta).dailyTries(subject));
        return { locked: failures >= PERSON_FAILURES_DAY, failures };
      },
    );

    app.delete(
      '/data/:connectionId/:table/:recordId/claim-lock',
      { config: { audit: audited('rbac') }, schema: { params: dataRecordParams, response: { 200: claimLockClearedReply } } },
      async (request) => {
        const ctx = await contextFor(request, 'update');
        const pk = parseRecordId(ctx.table, request.params.recordId);
        const row = await fetchByPk(ctx.db, ctx.table, pk);
        if (row === undefined) throw new NotFoundError('Record not found.', { pk });
        let cleared = 0;
        const { rows, addresses } = await claimSubjectsOf(ctx, row);
        for (const subject of [...rows, ...addresses]) cleared += await publicChallengesRepo(meta).clearSubject(subject);
        await app.rbac.audit(request, {
          category: 'data',
          action: 'public.claim.lock.clear',
          connectionId: ctx.connectionId,
          entity: recordRef(ctx, pk),
          changes: { after: { cleared } },
        });
        return { cleared };
      },
    );

    // --- a shared link's code, made again ------------------------------------------

    /*
     * "Make a new link": a fresh code in a column Adminium fills with one (a
     * handover page's share token). Nobody types a code — not the desk, not
     * an import — so this is the one way to change it, and the old link
     * stops opening anything at the next request made with it. No undo: the
     * old secret never comes back.
     */
    app.post(
      '/data/:connectionId/:table/:recordId/regenerate-code',
      {
        config: { audit: audited('rbac') },
        schema: { params: dataRecordParams, body: regenerateCodeBody, response: { 200: recordMutationReply } },
      },
      async (request) => {
        const ctx = await contextFor(request, 'update');
        const pk = parseRecordId(ctx.table, request.params.recordId);
        const column = request.body.column;
        const rule = ctx.table.table.columns.find((candidate) => candidate.name === column)?.code;
        if (rule === undefined) throw new ValidationFailedError('This column holds no code Adminium makes.', { column });
        assertWithinLimit(await updateLimitFor(request, ctx.connectionId, ctx.table.id), ctx.table.id, { [column]: '' }, {});
        const before = await fetchByPk(ctx.db, ctx.table, pk);
        if (before === undefined) throw new NotFoundError('Record not found.', { pk });
        // A server action: the one writer whose value for a code column is taken.
        const context: WriteContext = { ...requestWriteContext(request, 'dashboard'), origin: 'action' };
        for (let attempt = 0; ; attempt += 1) {
          try {
            const outcome = await writes.update({
              target: ctx.target,
              pk,
              values: { [column]: generateCode(rule.prefix ?? '', rule.length) },
              before,
              context,
              announce: async (result) => {
                await afterMutation(request, ctx, 'update', recordRef(ctx, pk), before, result.after ?? before);
              },
            });
            const data = maskRow(outcome.after ?? before, ctx.table, ctx.unmasked);
            // The new code goes back only to a caller who may read the table: one who may only
            // change it made a new link, and is not handed it (nor any other code of the row).
            if (!(await request.can(`table:${ctx.connectionId}:${ctx.table.id}:read`))) {
              for (const name of codeColumnsOf(ctx.table)) delete data[name];
            }
            return { data, undoToken: null };
          } catch (error) {
            // Another row holds the same code: made again, a few times at most.
            if (!isUniqueViolation(error) || attempt >= 2) mapDbError(error, ctx.table);
          }
        }
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
        const columns = availabilityColumns(ctx.view, ctx.table, rest, ctx.unmasked);
        const exclude = excludeId === undefined ? undefined : parseRecordId(ctx.table, excludeId);
        return await readAvailability(ctx.db, ctx.dialect, ctx.table, columns, {
          ...rest,
          ...(exclude === undefined ? {} : { exclude }),
        });
      },
    );

    /*
     * FREE TIMES FOR THE DESK — the booking rule's own answer, from the same
     * day-read the write path's guard runs, so the day sheet's open slots,
     * "next free times" and a waiting list's fits are the times a booking
     * would take. Behind the table's read grant like the read above.
     */
    app.get(
      '/data/:connectionId/:table/booking-slots',
      {
        schema: {
          params: dataTableParams,
          querystring: bookingSlotsQuery,
          response: { 200: bookingSlotsReply },
        },
      },
      async (request) => {
        const ctx = await contextFor(request, 'read');
        const booking = ctx.table.table?.booking;
        if (booking === undefined) throw new NotFoundError('This table books no one.', { table: ctx.table.id });
        const query = request.query;
        const oneDay = query.date !== undefined;
        if (oneDay === (query.from !== undefined) || (query.from !== undefined) !== (query.days !== undefined)) {
          throw new ValidationFailedError('Ask for one date, or a from date with a number of days.', {});
        }
        const timezone = (await connectionTenantConfig(meta, ctx.connectionId))?.timezone ?? 'UTC';
        const target = { connectionId: ctx.connectionId, table: ctx.table, db: ctx.db, dialect: ctx.dialect, timezone, origin: 'dashboard' as const };
        const excluded = query.exclude === undefined ? null : parseRecordId(ctx.table, query.exclude);
        const input = {
          kind: query.kind,
          resource: query.resource ?? 'any',
          isPublic: false,
          excludePk: excluded === null ? null : ctx.table.primaryKey.map((key) => String(excluded[key] ?? '')).join('|'),
          now: new Date(),
        };
        const minutes = await kindMinutes(booking, target, query.kind);
        if (minutes === null) throw new ValidationFailedError('That kind has no length to book.', { kind: query.kind });
        return {
          data: oneDay
            ? (await bookingSlots(booking, target, query.date!, minutes, input)).slots
            : await bookingDays(booking, target, query.from!, query.days!, minutes, input),
        };
      },
    );

    /*
     * A LIMIT'S COUNTS FOR THE DESK — size, taken, held and left per pool
     * (`crud/capacity/counts.ts`). Behind the table's read grant like the
     * reads above.
     */
    app.get(
      '/data/:connectionId/:table/capacity-counts',
      { schema: { params: dataTableParams, querystring: capacityCountsQuery, response: { 200: capacityCountsReply } } },
      async (request) => {
        const ctx = await contextFor(request, 'read');
        if ((ctx.table.table?.capacityRules?.length ?? 0) === 0) throw new NotFoundError('This table keeps no limit.', { table: ctx.table.id });
        const timezone = (await connectionTenantConfig(meta, ctx.connectionId))?.timezone ?? 'UTC';
        const { ids, ...rest } = request.query;
        // The tables the counts read beyond this one (the pools' rows), and a column asked under, as the asker may read them.
        const access = {
          table: async (tableId: string) => {
            const permission = `table:${ctx.connectionId}:${tableId}:read`;
            if (!(await request.can(permission))) throw new ForbiddenError('You do not have access to this table.', 'TABLE_FORBIDDEN', { permission });
          },
          column: async (table: ResolvedTable, name: string) => {
            ctx.view.readableColumn(table, name, await canReadPii(request, ctx.connectionId, table.id));
          },
        };
        const answer = await capacityCounts(
          { connectionId: ctx.connectionId, view: ctx.view, table: ctx.table, db: ctx.db, dialect: ctx.dialect, timezone },
          { ...rest, ...(ids === undefined ? {} : { ids: ids.split(',').map((id) => id.trim()).filter((id) => id !== '') }) },
          new Date(),
          access,
        );
        if (!answer.ok) throw new ValidationFailedError(answer.message, {});
        return { data: answer.data };
      },
    );

    /*
     * A ROW'S NIGHTS FOR THE DESK — each night of a price by the night (a
     * stay's room total) with its rate and tags, priced from the rates as
     * they are now; one line for them all when those no longer add up to the
     * stored figure. A night's price is a decided value of the row, so the
     * row's read grant (and the priced column's) is what it takes.
     */
    app.get(
      '/data/:connectionId/:table/:recordId/nightly',
      { schema: { params: dataRecordParams, querystring: nightlyQuery, response: { 200: nightlyReply } } },
      async (request) => {
        const ctx = await contextFor(request, 'read');
        const rules = tableRulesFor({ view: ctx.view, table: ctx.table });
        const priced = rules?.perNight;
        if (rules === null || priced === undefined || (request.query.column !== undefined && request.query.column !== priced.column)) {
          throw new NotFoundError('This table has no price by the night.', { table: ctx.table.id });
        }
        ctx.view.readableColumn(ctx.table, priced.column, await canReadPii(request, ctx.connectionId, ctx.table.id));
        const pk = parseRecordId(ctx.table, request.params.recordId);
        const row = await fetchByPk(ctx.db, ctx.table, pk);
        if (row === undefined) throw new NotFoundError('Record not found.', { pk });
        const currency = (await connectionTenantConfig(meta, ctx.connectionId))?.currency ?? null;
        const nights = await storedNights(ctx.db, rules, row, currency);
        return {
          data: {
            column: priced.column,
            nights: nights.lines.map(({ date, rate, base, tags, qty, amount }) => ({ date, rate, base, tags, qty, amount })),
            total: nights.total,
            stale: nights.stale,
          },
        };
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

        // The picker names rows of the TARGET table, so its grant decides.
        const pii = await canReadPii(request, ctx.connectionId, link.target.id);
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
        const context = withOccurredAt(requestWriteContext(request, 'dashboard'), request.body.occurredAt);
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
          // What each record agrees to be, judged on the row as written.
          const agrees = await recordAgrees(ctx);
          // Holding the series a number without gaps comes from, when the table has one.
          const rows = await writes.transaction(ctx.target, prepared.map((row) => row.values), async (trx) => {
            const tdb = trx as unknown as Kysely<SourceDatabase>;
            const written: Row[] = [];
            for (const [index, row] of prepared.entries()) {
              let made: Row;
              try {
                made = await insertRow(tdb, ctx.dialect, ctx.table, row.values);
              } catch (error) {
                return mapDbError(error, ctx.table);
              }
              try {
                if (agrees !== null) await agrees(tdb, made);
              } catch (error) {
                // Named by the value that made the row, as a refused value is.
                if (error instanceof TreeCheckRefused) throw new ValidationFailedError(error.message, { ...((error.details as object | undefined) ?? {}), row: index, value: repeat.values[index] });
                throw error;
              }
              written.push(made);
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
          // The reply is the row as stored, its own totals settled after the commit.
          const [first] = (await writes.stored(ctx.target, rows.slice(0, 1))) as [Row];
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
        // A record the app holds to an agreement of its own (a room's guests) is written the tree's way, rows below or none.
        const agreed = links.length === 0 && children.length === 0 && (await staffTreeRules(deps.meta, ctx.connectionId, ctx.view, ctx.table, () => null)).rootAgrees;
        if (agreed) {
          const tree = await staffTree(request, ctx, context, values, [], [], {}, 'save');
          const created = tree.outcome.root;
          undoToken = issueUndo(request, ctx, 'create', [], [created], [], [], [], []);
          return reply.status(201).send({ data: maskRow(created, ctx.table, ctx.unmasked), undoToken });
        }
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
         * WITH CHILD ROWS — and their own rows, two levels — one write through
         * the write service's tree (`staffTree`): every rule and limit of
         * every row, the totals settled bottom-up, every row or none. A child
         * table a before hook runs for keeps the one-level path below.
         */
        const rowsBelow = Object.values(request.body.children ?? {}).some((rows) => rows.some((row) => Object.keys(row.children ?? {}).length > 0));
        if (children.length > 0 && !children.some((requested) => requested.hooked)) {
          const hookedLink = links.find((requested) => requested.hooked);
          if (hookedLink === undefined) {
            const tree = await staffTree(request, ctx, context, values, links, children, request.body.children ?? {}, 'save');
            const created = tree.outcome.root;
            const pk = Object.fromEntries(ctx.table.primaryKey.map((c) => [c, created[c]]));
            undoToken = issueUndo(request, ctx, 'create', [], [created], [], [], tree.links, tree.children);
            for (const event of tree.events) publishChildWrite(app, { connectionId: ctx.connectionId, ...event });
            await auditLinks(request, ctx, recordRef(ctx, pk), tree.links);
            return reply.status(201).send({ data: maskRow(created, ctx.table, ctx.unmasked), undoToken });
          }
        }
        if (rowsBelow) {
          throw new ValidationFailedError('Rows below a child row are written only when no table of the write runs a hook.', { code: 'not-allowed' });
        }

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
        const childEvents: ChildEvent[] = [];
        const numbered = children.map((requested) => ({ target: childTargetOf(ctx, requested.child, ctx.db), row: {} }));
        const agrees = await recordAgrees(ctx);
        let inserted = await writes.transaction(ctx.target, [prepared.values], async (trx) => {
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
                events: childEvents,
              }),
            );
          }
          // The record as its children left it: a total over them has moved,
          // and the undo compares against this row, not the one inserted.
          let made = row;
          if (children.length > 0) {
            const key = Object.fromEntries(ctx.table.primaryKey.map((c) => [c, row[c]]));
            // A fingerprint covers the child rows this same save wrote: sealed again, last.
            await sealRows(tdb, ctx.table, key, sealsOf(prepared.values), writeSeals);
            made = (await fetchByPk(tdb, ctx.table, key)) ?? row;
          }
          // What the record agrees to be, on the row as written.
          if (agrees !== null) await agrees(tdb, made);
          return made;
        }, numbered);

        const pk = Object.fromEntries(ctx.table.primaryKey.map((c) => [c, inserted[c]]));
        undoToken = issueUndo(request, ctx, 'create', [], [inserted], [], [], written, childWrites);
        await afterMutation(request, ctx, 'create', recordRef(ctx, pk), null, inserted);
        for (const event of childEvents) publishChildWrite(app, { connectionId: ctx.connectionId, ...event });
        await auditLinks(request, ctx, recordRef(ctx, pk), written);
        await writes.afterEach('create', ctx.target, context, [{ record: inserted, before: null }]);
        // The reply is the row as stored, its own totals settled after the commit.
        inserted = (await writes.stored(ctx.target, [inserted]))[0] ?? inserted;
        return reply.status(201).send({ data: maskRow(inserted, ctx.table, ctx.unmasked), undoToken });
      },
    );

    /**
     * A STAFF FORM'S RECORD TRIED FIRST — the desk's "Take a booking" summary:
     * the record with its child rows written and rolled back, every figure the
     * save would work out, refused as the save would be; nothing kept, nothing
     * announced, no number taken.
     */
    app.post(
      '/data/:connectionId/:table/dry-run',
      {
        config: { audit: auditExempt('a quote writes nothing: its transaction is always rolled back') },
        schema: { params: dataTableParams, body: recordCreateBody, response: { 200: recordDryRunReply } },
      },
      async (request) => {
        const ctx = await contextFor(request, 'create');
        const values = allowlistValues(ctx, request.body.values);
        await assertFileColumns(ctx, values);
        const context = requestWriteContext(request, 'dashboard');
        const children = await requestedChildren(request, ctx, context, request.body.children);
        const tree = await staffTree(request, ctx, context, values, [], children, request.body.children ?? {}, 'dry');
        const shown: Record<string, { data: Row; children?: Record<string, { data: Row }[]> }[]> = {};
        const byPlace = new Map<string, { data: Row; children?: Record<string, { data: Row }[]> }>();
        for (const row of [...tree.outcome.rows].sort((a, b) => a.node.at.length - b.node.at.length)) {
          const at = row.node.at;
          if (at.length === 0) continue;
          // A child table's own columns are shown as a read of it would show them.
          const data = maskRow(row.record, row.node.target.table, false);
          if (at.length === 2) {
            const entry = { data };
            (shown[String(at[0])] ??= [])[Number(at[1])] = entry;
            byPlace.set(`${String(at[0])}\u0000${String(at[1])}`, entry);
            continue;
          }
          const parent = byPlace.get(`${String(at[0])}\u0000${String(at[1])}`);
          if (parent !== undefined) ((parent.children ??= {})[String(at[2])] ??= [])[Number(at[3])] = { data };
        }
        // The desk's booking summary: the nights a price by the night is made of.
        const nights = await quoteNights(ctx.db, tableRulesFor({ view: ctx.view, table: ctx.table }), tree.outcome.root, async () => (await connectionTenantConfig(meta, ctx.connectionId))?.currency ?? null, (column) => ctx.table.columns.get(column)?.secret === false && (ctx.table.columns.get(column)?.masked !== true || ctx.unmasked));
        return { data: maskRow(tree.outcome.root, ctx.table, ctx.unmasked), children: shown, ...(nights === undefined ? {} : { nights }) };
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
        // An edit form sends only what changed, so an edit of links or line
        // items alone — or of nothing — arrives with no values at all.
        // The state the writer saw the row in, when it names one, travels as a condition of the change.
        const values = withSeenState(ctx.table, Object.keys(request.body.values).length === 0 ? {} : allowlistValues(ctx, request.body.values), request.body.from);
        await assertFileColumns(ctx, values);
        const before = await fetchByPk(ctx.db, ctx.table, pk);
        if (before === undefined) throw new NotFoundError('Record not found.', { pk });
        assertWithinLimit(await updateLimitFor(request, ctx.connectionId, ctx.table.id), ctx.table.id, values, before);
        const context = withOccurredAt(requestWriteContext(request, 'dashboard'), request.body.occurredAt);
        const links = await requestedLinks(request, ctx, context, request.body.links);
        const children = await requestedChildren(request, ctx, context, request.body.children);
        // What the record agrees to be (a stay's guests within what its room sleeps), judged on the row as changed, inside the change.
        const agrees = await recordAgrees(ctx);
        const inside = agrees === null ? {} : { inside: agrees };
        // Rows below a child row come with a new record only.
        if (Object.values(request.body.children ?? {}).some((rows) => rows.some((row) => Object.keys(row.children ?? {}).length > 0))) {
          throw new ValidationFailedError('Rows below a child row are written with a new record only.', { code: 'not-allowed' });
        }
        let undoToken: string | null = null;

        /*
         * A PATCH that names no relation leaves every link and every child row
         * alone — the same rule an absent column follows — and takes the path
         * it always took.
         */
        if (links.length === 0 && children.length === 0) {
          /*
           * Nothing to change: an edit form saved with nothing touched (it sends
           * only what changed). Writing anyway would stamp an `updated_at`, run
           * the hooks and automations, and offer an Undo of nothing.
           */
          if (Object.keys(values).length === 0) {
            return { data: maskRow(before, ctx.table, ctx.unmasked), undoToken: null };
          }
          const outcome = await writes.update({
            target: ctx.target,
            pk,
            values,
            before,
            context,
            recheck: (final) => assertFileColumns(ctx, final),
            mapError: (error) => mapDbError(error, ctx.table),
            ...inside,
            announce: async (result) => {
              const after = result.after ?? before;
              undoToken = issueUndo(request, ctx, 'update', [before], [after], Object.keys(result.values), [], [], [], result.effects ?? []);
              await afterMutation(request, ctx, 'update', recordRef(ctx, pk), before, after);
              // The rows this move moved too (a room turned to cleaning), as changes of their own.
              await announceEffects(app, { connectionId: ctx.connectionId, view: ctx.view, effects: result.effects, origin: 'dashboard', request });
            },
          });
          // Masked columns may be written but are never echoed back.
          return { data: await unreadCodesOut(request, ctx, maskRow(outcome.after ?? before, ctx.table, ctx.unmasked), before, outcome.after), undoToken };
        }

        /*
         * A RECORD OR ROWS THAT TAKE FROM A LIMIT (a booking's dates, a ticket
         * added to an order): one lock-first write — the pools' locks named for
         * the record and every row before the transaction, the record changed
         * through the write service, its rows written under the same locks and
         * judged there. A child table a before hook runs for keeps the path
         * below, which refuses a limited row.
         */
        if (links.length === 0 && !children.some((requested) => requested.hooked)) {
          const timezone = (await connectionTenantConfig(meta, ctx.connectionId))?.timezone ?? 'UTC';
          const limitedRows = children.some((requested) =>
            requested.rows.some((row) => batchNeedsGuard(childTargetOf(ctx, requested.child, ctx.db), row.key === undefined ? 'create' : 'update', row.values)),
          );
          if (limitedRows || batchNeedsGuard(ctx.target, 'update', values)) {
            let childWrites: UndoChildren[] = [];
            let childEvents: ChildEvent[] = [];
            let childEffects: EffectWritten[] = [];
            const outcome = await writes.update({
              target: { ...ctx.target, timezone },
              pk,
              values,
              before,
              context,
              recheck: (final) => assertFileColumns(ctx, final),
              mapError: (error) => mapDbError(error, ctx.table),
              ...inside,
              children: {
                // Each row as it will stand: a new one under this record, a changed one over what it holds now (read without a lock; the judge checks it again).
                names: async () => {
                  const rows: LockNameRow[] = [];
                  for (const requested of children) {
                    const target = { ...childTargetOf(ctx, requested.child, ctx.db), timezone };
                    const existing = await currentChildren(ctx.db, requested.child, before[requested.child.parentKeyColumn]);
                    for (const row of requested.rows) {
                      const stored = row.key === undefined ? undefined : existing.find((one) => requested.child.child.primaryKey.every((name) => String(one[name]) === String(row.key![name])));
                      rows.push({ target, row: { ...(stored ?? {}), ...row.values, [requested.child.foreignColumn]: before[requested.child.parentKeyColumn] }, before: stored ?? null, prepared: false });
                    }
                  }
                  return rows;
                },
                write: async (db, after, checked) => {
                  // An attempt made again starts with nothing written.
                  childWrites = [];
                  childEvents = [];
                  childEffects = [];
                  const judged: JudgedRow[] = [];
                  for (const requested of children) {
                    const undo = await applyChildren(ctx, db, requested, after[requested.child.parentKeyColumn], context, { events: childEvents, effects: childEffects, judged: true });
                    childWrites.push(undo);
                    const target = { ...childTargetOf(ctx, requested.child, db), timezone };
                    for (const [i, key] of undo.added.entries()) judged.push({ target, pk: key, row: undo.addedRows![i]!, before: null });
                    for (const change of undo.changed) if (change.after !== undefined) judged.push({ target, pk: change.key, row: change.after, before: change.before });
                  }
                  // A fingerprint covers the child rows this same save wrote: sealed again, last.
                  await sealRows(db, ctx.table, pk, sealsOf(checked), writeSeals);
                  return judged;
                },
              },
              announce: async (result) => {
                const after = result.after ?? before;
                undoToken = issueUndo(request, ctx, 'update', [before], [after], Object.keys(result.values), [], [], childWrites, [...(result.effects ?? []), ...childEffects]);
                await afterMutation(request, ctx, 'update', recordRef(ctx, pk), before, after);
                for (const event of childEvents) publishChildWrite(app, { connectionId: ctx.connectionId, ...event });
                // The rows the record's and its child rows' moves moved too, as changes of their own.
                await announceEffects(app, { connectionId: ctx.connectionId, view: ctx.view, effects: [...(result.effects ?? []), ...childEffects], origin: 'dashboard', request });
              },
            });
            const stored = (await writes.stored(ctx.target, [outcome.after ?? before]))[0] ?? before;
            return { data: await unreadCodesOut(request, ctx, maskRow(stored, ctx.table, ctx.unmasked), before, stored), undoToken };
          }
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
        const childEvents: ChildEvent[] = [];
        const effected: EffectWritten[] = [];
        // The series a child row added here takes a number in, held until the save commits.
        const numbered = children.map((requested) => ({
          target: childTargetOf(ctx, requested.child, ctx.db),
          row: { [requested.child.foreignColumn]: before[requested.child.parentKeyColumn] },
        }));
        let after = await writes.transaction(ctx.target, [], async (trx) => {
          const tdb = trx as unknown as Kysely<SourceDatabase>;
          if (Object.keys(prepared.values).length > 0) {
            try {
              await updateRows(tdb, ctx.dialect, ctx.table, prepared.values, pk);
            } catch (error) {
              mapDbError(error, ctx.table);
            }
            effected.push(...effectsOf(prepared.values));
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
              await applyChildren(ctx, tdb, requested, row[requested.child.parentKeyColumn], context, {
                events: childEvents,
                effects: effected,
              }),
            );
          }
          // A fingerprint covers the child rows this same save wrote: sealed again, last.
          if (children.length > 0) await sealRows(tdb, ctx.table, pk, sealsOf(prepared.values), writeSeals);
          // As its children left it (a total over them has moved).
          const changed = children.length === 0 ? row : ((await fetchByPk(tdb, ctx.table, pk)) ?? row);
          if (agrees !== null) await agrees(tdb, changed);
          return changed;
        }, numbered);

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
          effected,
        );
        await afterMutation(request, ctx, 'update', recordRef(ctx, pk), before, after);
        for (const event of childEvents) publishChildWrite(app, { connectionId: ctx.connectionId, ...event });
        // The rows the record's and its child rows' moves moved too, as changes of their own.
        await announceEffects(app, { connectionId: ctx.connectionId, view: ctx.view, effects: effected, origin: 'dashboard', request });
        await auditLinks(request, ctx, recordRef(ctx, pk), written);
        await writes.afterEach('update', ctx.target, context, [{ record: after, before }]);
        after = (await writes.stored(ctx.target, [after]))[0] ?? after;
        return { data: await unreadCodesOut(request, ctx, maskRow(after, ctx.table, ctx.unmasked), before, after), undoToken };
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
        const context = requestWriteContext(request, 'dashboard');
        /*
         * A delete the table's states refuse — a numbered invoice, an accepted
         * proposal, a sent invoice's line — is refused straight away, dry run
         * included: nobody is asked to confirm what goes with a row that will
         * not go. The delete below judges again, holding the row.
         */
        const refused = await writes.deleteRefusal(ctx.target, context, [before]);
        if (refused !== null) throw refused;
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
          context,
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
