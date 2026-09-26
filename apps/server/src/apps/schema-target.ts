// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Where an installed app's tables are planned and created.
 *
 * ─── The one thing that differs from the add-on target ──────────────────────
 *
 * An add-on infers its connection: from the host app it attaches to, or from
 * the sole connection when there is exactly one (`add-ons/schema-target.ts`).
 * That inference exists because an add-on has a host whose database is by
 * definition the right one.
 *
 * An app has no host. Its connection is the operator's choice, made in the
 * install dialog and then REMEMBERED on the manifest row, because it is also
 * the connection the app's staff surface reads at runtime. So this target
 * takes a connection id rather than deriving one, and everything after that
 * point — the snapshot read, the read-only and DDL guards, the creates, the
 * re-introspection — is the shared core in `add-ons/schema-target.ts`. There
 * is deliberately no second DDL path.
 *
 * ─── What this target creates ───────────────────────────────────────────────
 *
 * Tables, and only tables: `requiredSchema` → create-or-map. The rest of an
 * app's manifest (pages, roles, column rules, public access, settings) is
 * made by the apps route around it; `seeds` are read by nothing yet.
 */

import type { InstallPlan, Manifest } from '@adminium/manifest';

import {
  applyPlanTo,
  readLiveTables,
  type LiveTables,
  type SchemaTargetCoreDeps,
} from '../add-ons/schema-target.js';
import type { ApplyInstallResult, ExistingTable } from '../add-ons/install-ddl.js';
import { runIntrospection } from '../connections/introspect.js';
import { applyServerEdit, planServerEdit, type EditBody, type ServerEditDeps } from '../schema-ddl/programmatic.js';
import type { ApplyResult, SchemaPlan } from '../schema-ddl/service.js';
import type { DatabaseModel } from '@adminium/engine';
import { sql } from 'kysely';

export interface AppSchemaTarget {
  /**
   * The tables the planner diffs against, for the chosen connection, read LIVE
   * and narrowed to `names`.
   */
  read(connectionId: string, names: ReadonlySet<string>): Promise<LiveTables>;
  /**
   * Creates what the plan says to create, then refreshes the snapshot.
   * `existing` is the live read the plan was made from, so a foreign key takes
   * the type the database has now, not the one the snapshot remembers.
   */
  apply(
    plan: InstallPlan,
    manifest: Manifest,
    connectionId: string,
    existing: readonly ExistingTable[],
    onCreated?: (ref: string) => Promise<void>,
  ): Promise<ApplyInstallResult>;
  /**
   * Change existing tables through the schema editor's own pipeline (a rename
   * out of the way, or the safe edits a reused table needs). The snapshot is
   * refreshed first, so the edit is planned against the database as it is.
   */
  edit(
    connectionId: string,
    build: (model: DatabaseModel) => EditBody,
    opts: { superAdmin: boolean; createdBy: string | null; expectedChecksum?: string | undefined },
  ): Promise<ApplyResult>;
  /**
   * Whether two rows of `table` already hold the same values in `columns`
   * (empty ones aside): a unique rule asked for there would be refused.
   * Reads, never writes.
   */
  repeats?(connectionId: string, table: string, columns: readonly string[]): Promise<boolean>;
  /** The plan `edit` would run, against a fresh snapshot, for an operator to review. Changes no table. */
  planEdit(
    connectionId: string,
    build: (model: DatabaseModel) => EditBody,
    opts: { superAdmin: boolean },
  ): Promise<SchemaPlan>;
}

export function createAppSchemaTarget(deps: SchemaTargetCoreDeps & Pick<ServerEditDeps, 'crypto'>): AppSchemaTarget {
  return {
    edit: async (connectionId, build, opts) => {
      await runIntrospection({ manager: deps.manager, meta: deps.meta, connectionId });
      const result = await applyServerEdit(deps, connectionId, build, opts);
      // …and after: pages, endpoints and the next plan read the snapshot.
      await runIntrospection({ manager: deps.manager, meta: deps.meta, connectionId });
      return result;
    },
    planEdit: async (connectionId, build, opts) => {
      await runIntrospection({ manager: deps.manager, meta: deps.meta, connectionId });
      return planServerEdit(deps, connectionId, build, opts);
    },
    read: (connectionId, names) => readLiveTables(deps, connectionId, names),
    repeats: async (connectionId, table, columns) => {
      const { db } = await deps.manager.data(connectionId);
      const refs = columns.map((column) => sql.ref(column));
      const found = await sql<{ found: number }>`select 1 as found from ${sql.table(table)} where ${sql.join(
        refs.map((ref) => sql`${ref} is not null`),
        sql` and `,
      )} group by ${sql.join(refs)} having count(*) > 1 limit 1`.execute(db);
      return found.rows.length > 0;
    },
    apply: (plan, manifest, connectionId, existing, onCreated) =>
      applyPlanTo(deps, connectionId, plan, manifest, existing, onCreated),
  };
}
