// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHICH DATABASE an add-on's tables go into, and getting them there.
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

import type { Dialect } from '@adminium/engine';
import { manifestsRepo, type MetaDb } from '@adminium/meta';
import type { AddOnManifest, InstallPlan, Manifest, RequiredTable } from '@adminium/manifest';

import { AppError, ForbiddenError, ValidationFailedError } from '../errors.js';
import type { ConnectionManager } from '../connections/manager.js';
import { runIntrospection } from '../connections/introspect.js';
import { loadSnapshotView } from '../data-io/snapshot-view.js';
import { applyInstall, type ApplyInstallResult, type ExistingTable } from './install-ddl.js';

export interface AddOnSchemaTarget {
  /**
   * The tables the planner diffs against; empty when nothing is connected.
   *
   * `connectionId`, when given, IS the answer to "whose database": an add-on
   * installed with an app goes into the app's connection, which the operator
   * chose — the app's row may not even exist yet to be inferred from, and the
   * sole-connection guess would be wrong on an instance with two.
   */
  read(attachTo: readonly string[], connectionId?: string): Promise<ExistingTable[]>;
  /** Where the add-on's tables go, or the question to ask (see {@link resolveAddOnConnection}). */
  resolve?(choice: ConnectionChoice): Promise<string | null>;
  /** Creates what the plan says to create, then refreshes the snapshot. */
  apply(
    plan: InstallPlan,
    manifest: AddOnManifest,
    attachTo: readonly string[],
    connectionId?: string,
  ): Promise<ApplyInstallResult>;
}

export interface AddOnSchemaTargetDeps {
  meta: MetaDb;
  manager: ConnectionManager;
  /** The same crypto the routes hold; `manifestsRepo` demands one. */
  credentialCrypto: { encrypt(v: string): string; decrypt(v: string): string };
}

/** What decides where an add-on's tables go. */
export interface ConnectionChoice {
  /** Whether the add-on declares tables at all; one that declares none is never asked. */
  ownsTables: boolean;
  attachTo: readonly string[];
  /** The database the person named. */
  connectionId?: string | undefined;
}

/**
 * The connection an add-on's tables belong in, the first of these that answers:
 *
 *  a. it declares no tables: none, and nothing is asked;
 *  b. the one the person named — refused when an app it attaches to reads
 *     another database (`ADD_ON_OTHER_DATABASE`);
 *  c. the database of the apps it attaches to — several is a question, 409
 *     `ADD_ON_SCHEMA_CONNECTION` with the list to choose from;
 *  d. the instance's one usable connection — several is the same question,
 *     and none answers `null` (a legitimate instance; the caller says what
 *     that means).
 */
export async function resolveAddOnConnection(deps: AddOnSchemaTargetDeps, choice: ConnectionChoice): Promise<string | null> {
  if (!choice.ownsTables) return null;
  const manifests = manifestsRepo(deps.meta, deps.credentialCrypto);
  const hosts = await Promise.all(choice.attachTo.map(async (key) => manifests.findByKey(key)));
  const fromHosts = [...new Set(hosts.map((host) => host?.row.connectionId ?? null).filter((id): id is string => id !== null && id !== ''))];
  const all = await deps.manager.connections.list();
  const named = (ids: readonly string[]) => ids.map((id) => ({ id, name: all.find((connection) => connection.id === id)?.name ?? id }));

  if (choice.connectionId !== undefined) {
    const chosen = all.find((connection) => connection.id === choice.connectionId);
    if (chosen === undefined || chosen.disabled) {
      throw new ValidationFailedError('That database is not connected to this instance.', { code: 'ADD_ON_NO_CONNECTION', connectionId: choice.connectionId });
    }
    const other = fromHosts.filter((id) => id !== choice.connectionId);
    if (other.length > 0) {
      throw new ValidationFailedError(
        'An app this add-on attaches to keeps its data in another database, so the add-on\'s tables cannot go in the one you chose.',
        { code: 'ADD_ON_OTHER_DATABASE', connectionId: choice.connectionId, connections: named(other) },
      );
    }
    return choice.connectionId;
  }
  if (fromHosts.length === 1) return fromHosts[0] as string;
  if (fromHosts.length > 1) {
    throw new AppError(409, 'ADD_ON_SCHEMA_CONNECTION', 'The apps this add-on attaches to read different databases. Choose the one its tables go in.', { connections: named(fromHosts) });
  }
  const usable = all.filter((connection) => !connection.disabled);
  if (usable.length === 0) return null;
  if (usable.length > 1) {
    throw new AppError(409, 'ADD_ON_SCHEMA_CONNECTION', 'This instance has more than one database. Choose the one this add-on\'s tables go in.', {
      connections: named(usable.map((connection) => connection.id)),
    });
  }
  return (usable[0] as (typeof usable)[number]).id;
}

/** What the connection-explicit core needs; the crypto is the wrapper's own. */
export type SchemaTargetCoreDeps = Pick<AddOnSchemaTargetDeps, 'meta' | 'manager'>;

/**
 * The tables a planner diffs against, for ONE named connection.
 *
 * Split out of the add-on wrapper below so the app install path
 * reads the same snapshot through the same function. The two paths differ
 * only in how they arrive at a connection id — an add-on infers it from its
 * host, an app is told it by the operator — and everything after that point
 * must not be able to diverge.
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
      nullable: column.nullable,
      hasDefault: column.default !== null,
      isGenerated: column.isGenerated,
      logicalType: column.logicalType,
      maxLength: column.maxLength,
    })),
  }));
}

/**
 * The tables a planner diffs against, read from the LIVE database — never
 * the saved snapshot.
 *
 * The snapshot is whatever the last introspection saw. A table created since
 * was missing from it, so the plan said "create", `IF NOT EXISTS` silently
 * skipped the create, and the install reported a table it had not made; a
 * table dropped since was planned as "reuse" and every page bound to nothing.
 * The install check is the one screen whose job is to be right about what is
 * there now.
 *
 * `names` narrows the read to the tables the manifest names (its own and the
 * ones its foreign keys point at), so a database with hundreds of tables costs
 * a handful of catalogue reads. Nothing is written: no snapshot, no proposals —
 * which is what keeps `/apps/plan` audit-exempt.
 *
 * A name found in more than one schema resolves to the connection's default
 * schema, where the installer's unqualified `CREATE TABLE` puts it.
 */
export interface LiveTables {
  tables: ExistingTable[];
  /** The engine they live on; the planner's type check needs it (SQLite reports types loosely). */
  dialect: Dialect;
  /** Every index and constraint name the snapshot knows, on any table: a new rule's name takes none. */
  indexNames?: string[];
}

/** Every index and constraint name of every table the snapshot knows; none when there is no snapshot. */
export async function snapshotIndexNames(meta: SchemaTargetCoreDeps['meta'], connectionId: string): Promise<string[]> {
  try {
    const view = await loadSnapshotView(meta, connectionId);
    return view.model.tables.flatMap((table) => [
      ...table.uniques.flatMap((unique) => (unique.name === null ? [] : [unique.name])),
      ...table.indexes.map((index) => index.name),
    ]);
  } catch {
    return [];
  }
}

export async function readLiveTables(
  deps: SchemaTargetCoreDeps,
  connectionId: string,
  names: ReadonlySet<string>,
): Promise<LiveTables> {
  const adapter = await deps.manager.introspectAdapter(connectionId);
  let model;
  try {
    if (names.size === 0) return { tables: [], dialect: adapter.dialect, indexNames: await snapshotIndexNames(deps.meta, connectionId) };
    model = await adapter.introspect({
      tableFilter: (table) => names.has(table.name),
      collectRowEstimates: false,
      collectActivityStats: false,
    });
  } finally {
    await adapter.close().catch(() => undefined);
  }
  const byName = new Map<string, (typeof model.tables)[number]>();
  for (const table of model.tables) {
    const held = byName.get(table.name);
    if (held === undefined || (held.schema !== model.defaultSchema && table.schema === model.defaultSchema)) {
      byName.set(table.name, table);
    }
  }
  const tables = [...byName.values()].map((table) => ({
    ref: table.name,
    columns: table.columns.map((column) => ({
      ref: column.name,
      isPrimaryKey: column.isPrimaryKey,
      dbType: column.dbType,
      nullable: column.nullable,
      hasDefault: column.default !== null,
      isGenerated: column.isGenerated,
      logicalType: column.logicalType,
      maxLength: column.maxLength,
      isIdentity: column.default?.kind === 'autoincrement',
      isUnique: column.isUnique,
      ...(column.enumRef === undefined || column.enumRef === null
        ? {}
        : { enumValues: model.enums.find((e) => e.id === column.enumRef)?.values ?? [] }),
    })),
    // The columns an index leads with: a plain index a limit counts by is offered where none does.
    indexed: [...new Set(table.indexes.filter((index) => index.expression === null && index.columns.length > 0).map((index) => index.columns[0]!))],
    // Each plain-column index whole, in order: (a) being indexed says nothing about (a, b).
    indexSets: table.indexes.filter((index) => index.expression === null && !index.partial && index.columns.length > 0).map((index) => [...index.columns]),
    // Their names, so a rule an install makes never takes one.
    indexNames: [...table.uniques.flatMap((unique) => (unique.name === null ? [] : [unique.name])), ...table.indexes.map((index) => index.name)],
    // Every set of columns the table keeps unique: its constraints, and its unique indexes on plain columns.
    uniques: [
      ...table.uniques.map((unique) => [...unique.columns]),
      ...table.indexes.filter((index) => index.unique && !index.primary && !index.partial && index.expression === null).map((index) => [...index.columns]),
    ],
  }));
  return { tables, dialect: model.dialect, indexNames: await snapshotIndexNames(deps.meta, connectionId) };
}

/**
 * Creates what a plan says to create, in ONE named connection, then refreshes
 * the snapshot so the new tables are addressable.
 *
 * The two write guards live here rather than in `install-ddl.ts`, which stays a
 * pure DDL emitter that knows nothing about connections.
 */
export async function applyPlanTo(
  deps: SchemaTargetCoreDeps,
  connectionId: string,
  plan: InstallPlan,
  manifest: Manifest,
  /** The tables the plan was made from. Absent, the snapshot is read (the add-on path). */
  known?: readonly ExistingTable[],
  /** Told each table as it is created. */
  onCreated?: (ref: string) => Promise<void>,
): Promise<ApplyInstallResult> {
  // This guard came with the install path — a
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
  const existing = known ?? (await readExistingTables(deps, connectionId));
  const handle = await deps.manager.data(connectionId);
  const result = await applyInstall({
    plan,
    tables,
    db: handle.db,
    dialect: handle.dialect,
    existing,
    takenNames: await snapshotIndexNames(deps.meta, connectionId),
    onCreated,
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
    resolve: (choice) => resolveAddOnConnection(deps, choice),
    async read(attachTo, explicit) {
      const connectionId = explicit ?? (await resolveAddOnConnection(deps, { ownsTables: true, attachTo }));
      if (connectionId === null) return [];
      return readExistingTables(deps, connectionId);
    },

    async apply(plan, manifest, attachTo, explicit) {
      const connectionId = explicit ?? (await resolveAddOnConnection(deps, { ownsTables: true, attachTo }));
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
