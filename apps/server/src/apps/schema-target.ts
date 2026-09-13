// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Where an installed app's tables are planned and created
 * (47-app-installation.md step 2, O2).
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
 * the connection the app's staff surface reads at runtime (29 D9). So this
 * target takes a connection id rather than deriving one, and everything after
 * that point — the snapshot read, the read-only and DDL guards, the creates,
 * the re-introspection — is the shared core in `add-ons/schema-target.ts`.
 * There is deliberately no second DDL path.
 *
 * ─── What an app install does NOT create ────────────────────────────────────
 *
 * Tables, and only tables. An app manifest also declares `pages`, `roles`,
 * `settings` and `seeds`; none of them are created here, and the install
 * dialog must not imply otherwise. That is 13-T03/T04's scope and it is still
 * unbuilt — the O2 ruling was `requiredSchema` → create-or-map, which is this.
 */

import type { InstallPlan, Manifest } from '@adminium/manifest';

import {
  applyPlanTo,
  readExistingTables,
  type SchemaTargetCoreDeps,
} from '../add-ons/schema-target.js';
import type { ApplyInstallResult, ExistingTable } from '../add-ons/install-ddl.js';

export interface AppSchemaTarget {
  /** The tables the planner diffs against, for the chosen connection. */
  read(connectionId: string): Promise<ExistingTable[]>;
  /** Creates what the plan says to create, then refreshes the snapshot. */
  apply(plan: InstallPlan, manifest: Manifest, connectionId: string): Promise<ApplyInstallResult>;
}

export function createAppSchemaTarget(deps: SchemaTargetCoreDeps): AppSchemaTarget {
  return {
    read: (connectionId) => readExistingTables(deps, connectionId),
    apply: (plan, manifest, connectionId) => applyPlanTo(deps, connectionId, plan, manifest),
  };
}
