// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `planInstall` — what installing an add-on would DO to a connected database,
 * decided before anything is done (26-add-on-runtime.md §3, D1, 26-T01).
 *
 * ─── The plan is a user-facing document, not an internal step ───────────────
 *
 * §7's consent dialog is "the security surface, not decoration: it is where a
 * user sees what an add-on may reach before it can reach it". The thing it
 * shows is this plan. So the output is shaped to be READ — every table says
 * whether it will be created or reused, every reused table says which of its
 * columns matched and which are missing, and every problem carries a sentence
 * an operator can act on rather than a code.
 *
 * That is also why nothing here writes: a plan that could not be computed
 * without side effects could not be shown before consent.
 *
 * ─── Add-on scope only (D1) ────────────────────────────────────────────────
 *
 * 13-T03/T04 own the APP install path — `pages`, `roles`, `seeds`, `frontend`,
 * the whole envelope. An add-on manifest has none of those blocks (24 §5.2
 * leaves them off the branch entirely), so this planner reads exactly one
 * field: `requiredSchema`. Three of the six shipped add-ons declare it;
 * `import-canva`, `barcode-labels` and `holiday-calendars` declare none and
 * plan to nothing, which is a real and common case rather than an edge one.
 *
 * ─── The case that makes this non-trivial: a foreign key pointing OUT ──────
 *
 * Two of the three real manifests declare an FK whose target is NOT in their
 * own `requiredSchema`:
 *
 *   design-studio  artwork_designs.job_id        -> jobs
 *   personalizer   personalization_templates.product_id -> products
 *   personalizer   personalizations.order_line_id       -> order_lines
 *
 * Those tables belong to the HOST app, and an add-on cannot bring them. So a
 * reference resolves in one of three ways, and the difference matters to the
 * operator: to a table the add-on is creating (fine, internal), to a table that
 * already exists in the database (fine, and it is the whole point — the add-on
 * is attaching to the host's data), or to nothing at all (**not** fine, and the
 * install must not proceed). The third case is the one a naive planner would
 * emit DDL for and only discover at `CREATE TABLE`, having already created the
 * other tables — on MySQL, which has no transactional DDL, that leaves a
 * half-installed add-on with no rollback.
 */

import type { AddOnManifest, RequiredColumn, RequiredTable } from './schema.js';

/** The existing database, as much of it as planning needs. */
export interface SchemaModelView {
  /** Every table name that already exists, however it got there. */
  tables: readonly {
    ref: string;
    columns: readonly { ref: string }[];
  }[];
}

/** What will happen to one table. */
export type TableAction = 'create' | 'reuse';

export interface PlannedColumn {
  ref: string;
  type: string;
  /** Absent from an existing table, so the install would have to add it. */
  missing: boolean;
}

export interface PlannedTable {
  ref: string;
  action: TableAction;
  columns: PlannedColumn[];
  /**
   * Only on `reuse`: columns the manifest requires that the existing table does
   * not have. A non-empty list is a PARTIAL MATCH — the table is there but does
   * not carry what the add-on needs, which is a different situation from either
   * "create it" or "it fits", and the operator should be told which.
   */
  missingColumns: string[];
}

/** Where one declared foreign key ends up pointing. */
export interface PlannedReference {
  fromTable: string;
  fromColumn: string;
  to: string;
  /**
   * `internal` — the target is another table in this manifest.
   * `host` — the target already exists in the database (the add-on attaching to
   *   the host's data, which is the intended shape).
   * `unresolved` — the target exists nowhere, and the plan is not installable.
   */
  resolution: 'internal' | 'host' | 'unresolved';
}

/** A reason the plan cannot be applied, phrased for a person. */
export interface PlanProblem {
  code: 'UNRESOLVED_REFERENCE' | 'COLUMN_TYPE_CONFLICT' | 'RESERVED_TABLE';
  message: string;
  table: string;
  column?: string;
}

export interface InstallPlan {
  addOnKey: string;
  version: string;
  /** Tables to create, in declaration order (targets before dependents). */
  create: PlannedTable[];
  /** Tables that already exist and will be reused rather than created. */
  reuse: PlannedTable[];
  references: PlannedReference[];
  problems: PlanProblem[];
  /**
   * `true` when there is nothing standing in the way. A plan with problems is
   * still RETURNED — the consent dialog has to be able to show WHY an add-on
   * cannot be installed here, and an exception would leave it with nothing to
   * render.
   */
  installable: boolean;
  /** No `requiredSchema` at all: install touches no data source. */
  touchesData: boolean;
}

/**
 * Table names an add-on may never claim, whatever its manifest says.
 *
 * The meta store's own prefix. An add-on that declared `adminium_users` would
 * otherwise plan a `CREATE TABLE` against the operator's data source that
 * shadows the name every meta query uses — and on a deployment where the meta
 * store and the data source are the same database (the SQLite default), that is
 * not a shadow, it is the table.
 */
const RESERVED_TABLE_PREFIX = 'adminium_';

function planColumns(
  table: RequiredTable,
  existing: { ref: string; columns: readonly { ref: string }[] } | undefined,
): { columns: PlannedColumn[]; missingColumns: string[] } {
  const have = new Set(existing?.columns.map((c) => c.ref) ?? []);
  const columns: PlannedColumn[] = table.columns.map((c: RequiredColumn) => ({
    ref: c.ref,
    type: c.type,
    missing: existing !== undefined && !have.has(c.ref),
  }));
  return { columns, missingColumns: columns.filter((c) => c.missing).map((c) => c.ref) };
}

/**
 * Diffs an add-on's `requiredSchema` against the database it would install
 * into. Pure: no I/O, no side effects, safe to run for a preview.
 */
export function planInstall(manifest: AddOnManifest, model: SchemaModelView): InstallPlan {
  const required = manifest.requiredSchema?.tables ?? [];
  const existingByRef = new Map(model.tables.map((t) => [t.ref, t]));
  const declared = new Set(required.map((t) => t.ref));

  const create: PlannedTable[] = [];
  const reuse: PlannedTable[] = [];
  const references: PlannedReference[] = [];
  const problems: PlanProblem[] = [];

  for (const table of required) {
    if (table.ref.startsWith(RESERVED_TABLE_PREFIX)) {
      problems.push({
        code: 'RESERVED_TABLE',
        table: table.ref,
        message:
          `"${table.ref}" is in Adminium's own namespace. An add-on cannot declare a table ` +
          `whose name begins with "${RESERVED_TABLE_PREFIX}".`,
      });
      continue;
    }

    const existing = existingByRef.get(table.ref);
    const { columns, missingColumns } = planColumns(table, existing);
    const planned: PlannedTable = {
      ref: table.ref,
      action: existing === undefined ? 'create' : 'reuse',
      columns,
      missingColumns,
    };
    (existing === undefined ? create : reuse).push(planned);

    for (const column of table.columns) {
      if (column.type !== 'fk' || column.references === undefined) continue;
      const target = column.references;
      const resolution: PlannedReference['resolution'] = declared.has(target)
        ? 'internal'
        : existingByRef.has(target)
          ? 'host'
          : 'unresolved';
      references.push({
        fromTable: table.ref,
        fromColumn: column.ref,
        to: target,
        resolution,
      });
      if (resolution === 'unresolved') {
        problems.push({
          code: 'UNRESOLVED_REFERENCE',
          table: table.ref,
          column: column.ref,
          message:
            `"${table.ref}.${column.ref}" points at a table called "${target}", which this ` +
            `add-on does not create and this database does not have. It is a table the host ` +
            `app is expected to provide, so this add-on cannot be installed here.`,
        });
      }
    }
  }

  return {
    addOnKey: manifest.key,
    version: manifest.version,
    create,
    reuse,
    references,
    problems,
    installable: problems.length === 0,
    touchesData: required.length > 0,
  };
}
