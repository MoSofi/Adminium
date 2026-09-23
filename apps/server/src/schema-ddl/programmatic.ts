// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A schema edit that a SERVER process makes on the operator's behalf — an app
 * install renaming a table out of the way, or adapting one it reuses.
 *
 * It runs through exactly the pipeline the Studio's schema editor does: the
 * same validation, the same per-dialect plan with its hazards and refusals, the
 * same apply with its SQLite rebuild, rename repair and ledger. Nothing here
 * compiles SQL of its own. The one difference is who reviewed the plan: the
 * operator did, on the install's check step, so the row-count acknowledgement
 * is taken as given; a REFUSED step is never applied.
 */
import type { DatabaseModel, SchemaEdit } from '@adminium/engine';
import { capabilitiesForSource, schemaEditSchema } from '@adminium/engine';
import { overridesRepo, snapshotsRepo, type DsnCrypto, type MetaDb } from '@adminium/meta';

import { applyOverrides } from '../connections/effective-schema.js';
import type { ConnectionManager } from '../connections/manager.js';
import { AppError, ConflictError, NotFoundError } from '../errors.js';
import { countTableRows } from './count-rows.js';
import { applySchemaEdit, planSchemaEdit, type ApplyResult, type PlanServiceInput, type SchemaPlan } from './service.js';

export interface ServerEditDeps {
  meta: MetaDb;
  manager: ConnectionManager;
  crypto: DsnCrypto;
}

/** The edit without its base snapshot, which is filled in from the latest one. */
export type EditBody = Partial<Omit<SchemaEdit, 'baseSnapshotId'>>;

async function inputFor(
  deps: ServerEditDeps,
  connectionId: string,
  build: (model: DatabaseModel) => EditBody,
  superAdmin: boolean,
): Promise<PlanServiceInput> {
  const connection = await deps.manager.mustFind(connectionId);
  const snapshot = await snapshotsRepo(deps.meta).latest(connectionId);
  if (snapshot === null) {
    throw new NotFoundError('No schema snapshot yet — run introspection first.', { connectionId });
  }
  const active = await overridesRepo(deps.meta).listForConnection(connectionId, { status: 'active' });
  const model = applyOverrides(snapshot.schema as DatabaseModel, active);
  const edit = schemaEditSchema.parse({ baseSnapshotId: snapshot.id, ...build(model) });
  const handle = await deps.manager.data(connection);
  const dsns = await deps.manager.connections.getDsns(connectionId);
  const caps = capabilitiesForSource({
    kind: 'live',
    engine: connection.engine as 'postgres' | 'mysql' | 'sqlite',
  });
  // Every table the edit touches was on the check step the operator approved.
  const named = new Set<string>([
    ...edit.renames.tables.map((r) => r.from),
    ...edit.addColumns.map((a) => a.table),
    ...edit.alterColumns.map((a) => a.table),
    ...edit.dropTables,
  ]);
  return {
    meta: deps.meta,
    connectionId,
    edit,
    actual: model,
    dialect: handle.dialect,
    serverVersion: snapshot.engineVersion,
    maxIdentifierLength: caps.maxIdentifierLength,
    metaSharesDatabase: deps.manager.metaSharesDatabaseWith(dsns?.dataDsn ?? null),
    db: handle.db,
    privileges: { db: handle.db, dialect: handle.dialect },
    countRows: (tableId: string) => countTableRows(handle, tableId),
    ceilingDoor: { superAdmin, acknowledged: named },
  };
}

/** The plan an edit would run, for the check step. Writes nothing. */
export async function planServerEdit(
  deps: ServerEditDeps,
  connectionId: string,
  build: (model: DatabaseModel) => EditBody,
  opts: { superAdmin: boolean },
): Promise<SchemaPlan> {
  return planSchemaEdit(await inputFor(deps, connectionId, build, opts.superAdmin));
}

/**
 * Plan, refuse a plan with any refused step, then apply it — the plan the
 * apply re-makes must match, or it answers SCHEMA_DRIFT like any other.
 */
export async function applyServerEdit(
  deps: ServerEditDeps,
  connectionId: string,
  build: (model: DatabaseModel) => EditBody,
  opts: {
    superAdmin: boolean;
    createdBy: string | null;
    /** The checksum of the plan an operator reviewed, when one did; a different plan now is SCHEMA_DRIFT. */
    expectedChecksum?: string | undefined;
  },
): Promise<ApplyResult> {
  const input = await inputFor(deps, connectionId, build, opts.superAdmin);
  const plan = await planSchemaEdit(input);
  if (opts.expectedChecksum !== undefined && opts.expectedChecksum !== plan.checksum) {
    throw new ConflictError(
      'The database changed since this change was reviewed. Review it again.',
      'SCHEMA_DRIFT',
      { expected: opts.expectedChecksum, actual: plan.checksum },
    );
  }
  if (plan.refusals.length > 0) {
    throw new AppError(422, 'SCHEMA_EDIT_REFUSED', 'This change cannot be made on this database.', {
      refusals: plan.refusals,
    });
  }
  const result = await applySchemaEdit({
    ...input,
    checksum: plan.checksum,
    createdBy: opts.createdBy,
    superAdmin: opts.superAdmin,
    crypto: deps.crypto,
    reintrospectTable: async (tableId) => {
      const bare = tableId.slice(tableId.lastIndexOf('.') + 1);
      const adapter = await deps.manager.introspectAdapter(connectionId);
      try {
        const fresh = await adapter.introspect({
          tableFilter: (t) => t.name === bare,
          collectRowEstimates: false,
          collectActivityStats: false,
        });
        return fresh.tables.find((t) => t.name === bare) ?? null;
      } finally {
        await adapter.close().catch(() => undefined);
      }
    },
  });
  /*
   * The apply REPORTS a failed step rather than throwing — right for the
   * schema editor, which shows the operator the outcome of each statement. A
   * server-made edit has nobody watching, so a failure must stop the caller:
   * an install that went on after its rename failed would create its tables on
   * top of the very table it meant to move.
   */
  if (result.status !== 'applied') {
    throw new AppError(422, 'SCHEMA_EDIT_FAILED', result.error ?? 'The schema change did not complete.', {
      changeId: result.changeId,
      status: result.status,
    });
  }
  return result;
}
