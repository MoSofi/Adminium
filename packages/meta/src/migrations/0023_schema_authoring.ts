// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0023 — schema authoring: the applied-change ledger, and two columns on
 * the connection (35-schema-authoring.md §3.5, D3, D21, 35-T09).
 *
 * ─── Why a ledger, and why it is written BEFORE the first statement ────────
 *
 * D3: an apply is re-runnable, never transactional, because MySQL commits
 * every DDL statement implicitly and there is nothing to roll back. That
 * ruling has a consequence this table exists to serve — a failure halfway
 * leaves the database in a state no single value describes. "Succeeded" and
 * "failed" are both lies about a plan whose first two steps ran and whose
 * third did not.
 *
 * So the row is inserted as `running` before the first statement leaves the
 * process (35-T36), and each step's outcome is recorded as it lands. If the
 * worker is killed mid-apply the row stays `running` — which is exactly the
 * truth, and is what lets the next plan tell the operator "a previous apply
 * did not finish" instead of silently planning against a schema that is half
 * way between two shapes.
 *
 * ─── `steps` is one JSON column, not a child table ─────────────────────────
 *
 * A step has no life of its own: it is never queried across plans, never
 * updated after its run completes, and never referenced by anything. What is
 * wanted is "show me what this apply did", which is one row. A child table
 * would buy per-step indexing nobody needs and cost a join on every read, plus
 * a second place for a partial write to go wrong.
 *
 * It is opaque here and Zod-validated in the repo — the same discipline every
 * other `json` column in this store follows.
 *
 * ─── `can_ddl` on the connection ───────────────────────────────────────────
 *
 * `PrivilegeProbe.canDDL` has been computed since M3 and thrown away every
 * time: `testDsn()` probes it, `enforceMetaPlacement` reads it once to refuse
 * a same-database meta store, and nothing persists it. The connections table
 * has `read_only` and no companion.
 *
 * Persisting it makes the Studio's honest-absence rule (D5, 35-T15) cheap: the
 * Design mode is hidden without a round trip. It is emphatically **not** the
 * authority for whether a step may run — that is the per-target preflight at
 * plan time (D17, 35-T34), because a role can own table A and not table B, and
 * one boolean on a connection cannot say so. This column is a UI hint, and the
 * comment is here so nobody later mistakes it for a guard.
 *
 * NULL means "never probed", which every pre-0023 row is. Deliberately not
 * defaulted to false: "we have not asked" and "we asked and the answer was no"
 * lead to different UI, and a default would erase the difference.
 *
 * ─── `diagram_layout` (D21, M18) ───────────────────────────────────────────
 *
 * Manual node positions for the ER diagram, per connection rather than per
 * user, because the diagram's value is as a shared map of the workspace.
 *
 * It gets its own column rather than riding `settings`: that column is written
 * whole by `PATCH /connections/:id` under `connections.manage`, so a layout
 * saved through it would need the connection-management grant to move a box,
 * and two admins dragging nodes would overwrite each other's `includedTables`.
 * A separate column has a separate route and a separate grant (`schema.remap`).
 * Added here rather than in M18's own wave because a second ALTER on the same
 * table for one column is a migration nobody wants to review.
 */

import type { Kysely } from 'kysely';

import type { ColumnHelpers } from '../columns.js';
import { metaTable } from '../prefix.js';

export async function up(db: Kysely<unknown>, c: ColumnHelpers): Promise<void> {
  await db.schema
    .createTable(metaTable('schema_changes'))
    .ifNotExists()
    .addColumn('id', c.id, (col) => col.primaryKey())
    .addColumn('connection_id', c.id, (col) => col.notNull())
    /**
     * The plan's checksum. `apply` sends it back and the server refuses when it
     * no longer matches (D2) — storing it is what lets a re-apply prove it is
     * completing the SAME plan rather than a re-derived one.
     */
    .addColumn('plan_checksum', c.str(64), (col) => col.notNull())
    /** `running` | `applied` | `partial` | `failed` — see the header on `running`. */
    .addColumn('status', c.str(12), (col) => col.notNull())
    /** The ordered steps with their per-step outcome. Zod-validated in the repo. */
    .addColumn('steps', c.json, (col) => col.notNull())
    /** Worst hazard in the plan, denormalised so a history list needs no parse. */
    .addColumn('hazard', c.str(12), (col) => col.notNull())
    /** The snapshot the plan was built against. */
    .addColumn('base_snapshot_id', c.id)
    /** The snapshot re-introspection produced afterwards; NULL until it does. */
    .addColumn('result_snapshot_id', c.id)
    /** First failing step's message, so a history row is readable without the JSON. */
    .addColumn('error', c.str(2048))
    .addColumn('created_by', c.id)
    .addColumn('started_at', c.ts, (col) => col.notNull())
    .addColumn('finished_at', c.ts)
    // Named and table-level: MySQL parses an inline column-level `REFERENCES`
    // and silently discards it (the 2026-07-20 lesson every migration here
    // carries). No cascade: deleting a connection must not erase the record of
    // what was done to the customer's database through it.
    .addForeignKeyConstraint(
      'fk_adminium_schema_changes_connection_id',
      ['connection_id'],
      metaTable('connections'),
      ['id'],
      (cb) => cb.onDelete('cascade'),
    )
    .execute();

  // The history surface's exact access path: this connection's applies, newest
  // first. Also what the "a previous apply did not finish" check reads.
  await db.schema
    .createIndex('ix_adminium_schema_changes_connection')
    .on(metaTable('schema_changes'))
    .columns(['connection_id', 'started_at'])
    .execute();

  await db.schema
    .alterTable(metaTable('connections'))
    .addColumn('can_ddl', c.bool)
    .execute();

  await db.schema
    .alterTable(metaTable('connections'))
    .addColumn('diagram_layout', c.json)
    .execute();
}
