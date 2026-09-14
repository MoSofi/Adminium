// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHICH DATABASE an add-on's tables go into, and getting them there (26-T02).
 *
 * `applyInstall` in `install-ddl.ts` is deliberately ignorant of connections: it
 * takes a `Kysely` and a dialect and creates tables. This file answers the
 * question that comes before it — *whose* database — and then does the two
 * things around the DDL that the DDL itself must not know about: reading the
 * current tables for the planner, and re-introspecting afterwards.
 *
 * ─── Picking the connection, and refusing rather than guessing ─────────────
 *
 * An instance may have several connections, and an add-on's `requiredSchema`
 * has no field naming one. Two rules, in order:
 *
 *  1. **The host app's connection.** `attachTo` names the app the add-on hangs
 *     off, that app is itself an installed manifest, and `adminium_manifests`
 *     has carried `connection_id` since 0006. An add-on that attaches to
 *     `printing` puts its tables where `printing` reads — which is the only
 *     answer that makes an FK into the host's data possible at all.
 *  2. **The sole connection**, when rule 1 finds nothing — an add-on attaching
 *     to `*`, or to an app that is not itself installed here.
 *
 * When neither resolves, this REFUSES and names the reason. It does not pick
 * the first connection, or the newest: creating tables in the wrong database is
 * silent, permanent, and looks exactly like success.
 *
 * ─── Why the snapshot has to be refreshed, and why not in one adapter ──────
 *
 * New tables are invisible to the rest of the server until a snapshot exists —
 * every data route resolves identifiers through `SnapshotView`, so an add-on's
 * table would be a 422 until the next introspection. `runIntrospection` opens
 * its own INTROSPECT-role adapter (a different DSN, often a different user),
 * so the DDL and the refresh genuinely cannot share a connection. They run in
 * sequence instead, and a refresh that fails leaves real tables with a stale
 * snapshot — which is a re-introspect away, and is why the failure is reported
 * rather than swallowed.
 */

import { manifestsRepo, type MetaDb } from '@adminium/meta';
import type { AddOnManifest, InstallPlan, Manifest, RequiredTable } from '@adminium/manifest';

import { ForbiddenError, ValidationFailedError } from '../errors.js';
import type { ConnectionManager } from '../connections/manager.js';
import { runIntrospection } from '../connections/introspect.js';
import { loadSnapshotView } from '../data-io/snapshot-view.js';
import { applyInstall, type ApplyInstallResult, type ExistingTable } from './install-ddl.js';

export interface AddOnSchemaTarget {
  /** The tables the planner diffs against; empty when nothing is connected. */
  read(attachTo: readonly string[]): Promise<ExistingTable[]>;
  /** Creates what the plan says to create, then refreshes the snapshot. */
  apply(
    plan: InstallPlan,
    manifest: AddOnManifest,
    attachTo: readonly string[],
  ): Promise<ApplyInstallResult>;
}

export interface AddOnSchemaTargetDeps {
  meta: MetaDb;
  manager: ConnectionManager;
  /** The same crypto the routes hold; `manifestsRepo` demands one. */
  credentialCrypto: { encrypt(v: string): string; decrypt(v: string): string };
}

/**
 * Resolves the connection an add-on's tables belong in, by the two rules above.
 * Returns `null` when there is no connection at all — which is a legitimate
 * instance shape, not an error, and the planner handles it by seeing no tables.
 */
async function resolveConnectionId(
  deps: AddOnSchemaTargetDeps,
  attachTo: readonly string[],
): Promise<string | null> {
  const manifests = manifestsRepo(deps.meta, deps.credentialCrypto);

  // Rule 1: the host app's own connection.
  const hosts = await Promise.all(attachTo.map(async (key) => manifests.findByKey(key)));
  const fromHosts = new Set(
    hosts
      .map((host) => host?.row.connectionId ?? null)
      .filter((id): id is string => id !== null && id !== ''),
  );
  if (fromHosts.size === 1) return [...fromHosts][0]!;
  if (fromHosts.size > 1) {
    throw new ValidationFailedError(
      'The apps this add-on attaches to read different databases, so there is no single place ' +
        'to create its tables. Install it against one app at a time.',
      { code: 'ADD_ON_AMBIGUOUS_CONNECTION', connections: [...fromHosts] },
    );
  }

  // Rule 2: the sole connection.
  const all = await deps.manager.connections.list();
  const usable = all.filter((connection) => !connection.disabled);
  if (usable.length === 0) return null;
  if (usable.length > 1) {
    throw new ValidationFailedError(
      'This instance has more than one connection and the add-on does not attach to an app that ' +
        'names one, so there is no single place to create its tables.',
      { code: 'ADD_ON_AMBIGUOUS_CONNECTION', connections: usable.map((c) => c.id) },
    );
  }
  return usable[0]!.id;
}

/** What the connection-explicit core needs; the crypto is the wrapper's own. */
export type SchemaTargetCoreDeps = Pick<AddOnSchemaTargetDeps, 'meta' | 'manager'>;

/**
 * The tables a planner diffs against, for ONE named connection.
 *
 * Split out of the add-on wrapper below so the app install path
 * (47-app-installation.md step 2) reads the same snapshot through the same
 * function. The two paths differ only in how they arrive at a connection id —
 * an add-on infers it from its host, an app is told it by the operator — and
 * everything after that point must not be able to diverge.
 */
export async function readExistingTables(
  deps: SchemaTargetCoreDeps,
  connectionId: string,
): Promise<ExistingTable[]> {
  let view;
  try {
    view = await loadSnapshotView(deps.meta, connectionId);
  } catch {
    // No snapshot yet — a connection that has never been introspected. The
    // planner treats that as "no tables", which is honest: nothing is known
    // to exist, so nothing can be reused.
    return [];
  }
  return view.model.tables.map((table) => ({
    ref: table.name,
    columns: table.columns.map((column) => ({
      ref: column.name,
      isPrimaryKey: column.isPrimaryKey,
      // An FK to this column must be created with this exact type.
      dbType: column.dbType,
    })),
  }));
}

/**
 * Creates what a plan says to create, in ONE named connection, then refreshes
 * the snapshot so the new tables are addressable.
 *
 * The two write guards live here rather than in `install-ddl.ts`, which stays a
 * pure DDL emitter that knows nothing about connections
 * (35-schema-authoring.md 35-T18).
 */
export async function applyPlanTo(
  deps: SchemaTargetCoreDeps,
  connectionId: string,
  plan: InstallPlan,
  manifest: Manifest,
): Promise<ApplyInstallResult> {
  // 13 §2.5 specified this guard when it specified the install path — a
  // `create` outcome is "refused when the `data` role is read-only" — and
  // `install-ddl.ts` never implemented it, so until it was retrofitted an
  // install ran CREATE TABLE against a connection Adminium had already
  // recorded as read-only, and failed with whatever the engine said.
  const connection = await deps.manager.mustFind(connectionId);
  if (connection.readOnly) {
    throw new ForbiddenError(
      `"${manifest.key}" needs to create tables, but this connection uses a read-only role.`,
      'READ_ONLY_MODE',
      { code: 'ADD_ON_READ_ONLY', create: plan.create.map((table) => table.ref) },
    );
  }
  if (connection.canDdl === false) {
    throw new ForbiddenError(
      `"${manifest.key}" needs to create tables, but this connection's role cannot run DDL.`,
      'READ_ONLY_MODE',
      { code: 'ADD_ON_NO_DDL', create: plan.create.map((table) => table.ref) },
    );
  }

  const tables: readonly RequiredTable[] = manifest.requiredSchema?.tables ?? [];
  const existing = await readExistingTables(deps, connectionId);
  const handle = await deps.manager.data(connectionId);
  const result = await applyInstall({
    plan,
    tables,
    db: handle.db,
    dialect: handle.dialect,
    existing,
  });

  // The snapshot, so the new tables are addressable. AFTER the DDL and in
  // its own adapter — see the header.
  if (result.created.length > 0) {
    await runIntrospection({ manager: deps.manager, meta: deps.meta, connectionId });
  }
  return result;
}

export function createAddOnSchemaTarget(deps: AddOnSchemaTargetDeps): AddOnSchemaTarget {
  return {
    async read(attachTo) {
      const connectionId = await resolveConnectionId(deps, attachTo);
      if (connectionId === null) return [];
      return readExistingTables(deps, connectionId);
    },

    async apply(plan, manifest, attachTo) {
      const connectionId = await resolveConnectionId(deps, attachTo);
      if (connectionId === null) {
        throw new ValidationFailedError(
          `"${manifest.key}" needs tables, and this instance has no database connection to ` +
            'create them in. Connect a data source first.',
          { code: 'ADD_ON_NO_CONNECTION', create: plan.create.map((table) => table.ref) },
        );
      }
      return applyPlanTo(deps, connectionId, plan, manifest);
    },
  };
}
