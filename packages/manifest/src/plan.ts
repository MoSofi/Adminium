// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `planInstall` — what installing an add-on would DO to a connected database,
 * decided before anything is done.
 *
 * ─── The plan is a user-facing document, not an internal step ───────────────
 *
 * The consent dialog is "the security surface, not decoration: it is where a
 * user sees what an add-on may reach before it can reach it". The thing it
 * shows is this plan. So the output is shaped to be READ — every table says
 * whether it will be created or reused, every reused table says which of its
 * columns matched and which are missing, and every problem carries a sentence
 * an operator can act on rather than a code.
 *
 * That is also why nothing here writes: a plan that could not be computed
 * without side effects could not be shown before consent.
 *
 * ─── One field, both kinds ─────────────────────────────────────────────────
 *
 * This planner reads exactly ONE field of a manifest — `requiredSchema` — and
 * that field is on the shared envelope, so an app's tables diff the same way an
 * add-on's do. Installing an APP now runs through here too; what stays outside
 * it is the rest of the app envelope (`pages`, `roles`, `settings`, `seeds`),
 * which still own and which no install path creates yet.
 *
 * Three of the six shipped add-ons declare `requiredSchema`; `import-canva`,
 * `barcode-labels` and `holiday-calendars` declare none and plan to nothing,
 * which is a real and common case rather than an edge one. An app manifest
 * always declares one — the schema makes it required on that branch.
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

import type { Manifest, RequiredColumn, RequiredTable } from './schema.js';

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
  /**
   * The manifest key this plan is for.
   *
   * Named `addOnKey` because add-ons were the only caller when it was written,
   * and left named that because the wire DTOs each route builds are where a
   * reader meets it — `routes/apps` spells it `key` on its own reply. Renaming
   * it here would churn three call sites and a shipped dialog for a field only
   * the server reads.
   */
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
 * Diffs a manifest's `requiredSchema` against the database it would install
 * into. Pure: no I/O, no side effects, safe to run for a preview.
 *
 * The NOUN in every problem message comes from `manifest.kind`, because these
 * messages are read by an operator deciding whether to go ahead — being told
 * an "add-on" cannot be installed while looking at an app's install dialog is
 * the kind of small wrongness that makes someone distrust the whole screen.
 */
export function planInstall(manifest: Manifest, model: SchemaModelView): InstallPlan {
  const required = manifest.requiredSchema?.tables ?? [];
  const noun = manifest.kind === 'app' ? 'app' : 'add-on';
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
          `"${table.ref}" is in Adminium's own namespace. An ${noun} cannot declare a table ` +
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
          /*
           * The two kinds fail this check for different reasons, and the fix
           * differs with them. An add-on's dangling FK points at a table its
           * HOST app was supposed to bring; an app has no host, so its dangling
           * FK points at something the operator has to have in the database
           * already. One sentence covering both would tell at least one of them
           * to do something that cannot be done.
           */
          message:
            manifest.kind === 'app'
              ? `"${table.ref}.${column.ref}" points at a table called "${target}", which this ` +
                `app does not create and this database does not have. Connect a database that ` +
                `already has it, or create it first.`
              : `"${table.ref}.${column.ref}" points at a table called "${target}", which this ` +
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
