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

import { planWithContext } from './plan-context.js';
import type {
  InstallPlan,
  PlanContext,
  PlannedColumn,
  PlannedReference,
  PlannedTable,
  PlanProblem,
  SchemaModelView,
} from './plan-model.js';
import { typeConflict } from './plan-types.js';
import type { Manifest, RequiredColumn, RequiredTable } from './schema.js';

export type {
  ExistingColumnView,
  InstallPlan,
  PlannedColumn,
  PlannedReference,
  PlannedTable,
  PlanProblem,
  SchemaModelView,
  TableAction,
} from './plan-model.js';


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
export function planInstall(
  manifest: Manifest,
  model: SchemaModelView,
  /**
   * What the server knows about this connection (prefix, the table record,
   * other apps, the operator's answers). Absent — every add-on, and any older
   * caller — the plan is exactly what it always was.
   */
  context?: PlanContext,
): InstallPlan {
  if (context !== undefined) return planWithContext(manifest, model, context);
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

    /*
     * A SAME-NAMED TABLE THAT IS NOT THIS APP'S.
     *
     * An existing table can carry every column an app declares and still be
     * unusable: when it also has a column the database requires on every
     * insert and the app never writes, each row the app creates is refused.
     * The usual cause is another app's table left behind by an uninstall —
     * a client-portal `payments` (invoice_id NOT NULL) under a point-of-sale
     * `payments` (ticket_id). Offering the missing columns would not help, so
     * the plan says what the table actually is.
     *
     * Apps only: an add-on reuses its HOST's tables to read and reference
     * them, and the host's own required columns are the host's business.
     */
    if (existing !== undefined && manifest.kind === 'app') {
      const declaredColumns = new Set(table.columns.map((c) => c.ref));
      const blocking = existing.columns
        .filter(
          (c) =>
            !declaredColumns.has(c.ref) &&
            c.nullable === false &&
            c.hasDefault !== true &&
            c.isPrimaryKey !== true &&
            c.isGenerated !== true,
        )
        .map((c) => c.ref);
      const [first] = blocking;
      if (first !== undefined) {
        const list = blocking.map((ref) => `"${ref}"`).join(', ');
        problems.push({
          code: 'FOREIGN_TABLE',
          table: table.ref,
          column: first,
          message:
            `This database already has a "${table.ref}" table that is not shaped for this app: ` +
            `it requires ${list}, which the app never writes, so every row the app saves ` +
            `there would be refused. It may belong to another app. Rename or remove that ` +
            `table, or install against a different database.`,
        });
      }
    }

    /*
     * EVERY REFUSAL ON THE CHECK STEP.
     *
     * A reused table missing columns the app writes, and a column that exists
     * with a type the app's values do not fit, used to plan as "installable" —
     * the wizard showed "reuse" with Install enabled, and the install then
     * refused with a bare error naming no table (the owner's own install hit
     * exactly that). They are problems now, so the check step names the table
     * and Install stays disabled until it is resolved.
     */
    // Apps only, like FOREIGN_TABLE below: an add-on reuses its HOST's tables,
    // and keeps its own refusal for a host missing columns.
    if (existing !== undefined && manifest.kind === 'app' && missingColumns.length > 0) {
      const list = missingColumns.map((ref) => `"${ref}"`).join(', ');
      problems.push({
        code: 'COLUMNS_REQUIRED',
        table: table.ref,
        column: missingColumns[0]!,
        message:
          `This database already has a "${table.ref}" table, and it is missing ${list}, which ` +
          `this ${noun} writes. Add ${missingColumns.length === 1 ? 'it' : 'them'} to the table, ` +
          `or install against a different database.`,
      });
    }
    if (existing !== undefined && manifest.kind === 'app') {
      for (const column of table.columns) {
        const have = existing.columns.find((c) => c.ref === column.ref);
        const conflict = have === undefined ? null : typeConflict(column, have, model.dialect);
        if (conflict === null) continue;
        problems.push({
          code: 'COLUMN_TYPE_CONFLICT',
          table: table.ref,
          column: column.ref,
          message: `"${table.ref}.${column.ref}" already exists as ${conflict}, which cannot hold the ${column.type} values this ${noun} stores in it.`,
        });
      }
    }

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
