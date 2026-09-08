// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The plan and apply services — 35-schema-authoring.md §3.2–§3.5, D2, D3, D10,
 * 35-T10, 35-T35, 35-T36.
 *
 * ─── Plan and apply are two calls, and the seam between them is a checksum ─
 *
 * D2. `plan` is pure with respect to the customer's database: it reads the
 * snapshot, asks preflight some questions, and compiles SQL it does not run.
 * `apply` takes the checksum back and refuses when it no longer matches.
 *
 * That refusal has TWO halves, and only doing the first is the mistake this
 * file exists to avoid:
 *
 *   1. the SNAPSHOT moved — somebody re-introspected, or another admin applied
 *      a plan. Cheap to detect: re-plan and compare checksums.
 *   2. the DATABASE moved — somebody ran DDL in psql. The snapshot is
 *      unchanged, so the checksum matches, and the plan is built on a shape
 *      that no longer exists. Detecting this needs a targeted re-introspection
 *      of the touched tables at apply time (35-T35), which is what
 *      `introspect({tableFilter})` is for.
 *
 * ─── The ledger is written before the first statement ──────────────────────
 *
 * D3/35-T36. MySQL commits every DDL statement implicitly, so an apply cannot
 * be transactional there and a crash halfway leaves no in-process record. The
 * `running` row is what makes a killed worker legible afterwards.
 */
import {
  applyRenames,
  ddlTypeForDesired,
  desiredTableToModel,
  isReservedWord,
  planDdl,
  tableWithAddedColumns,
  validateSchemaEdit,
  type DatabaseModel,
  type DdlPlan,
  type DdlStep,
  type Dialect,
  type Relation,
  type SchemaEdit,
  type TableModel,
} from '@adminium/engine';
import { sha256Hex } from '@adminium/engine';
import type { MetaDb, StepOutcome } from '@adminium/meta';
import { schemaChangesRepo } from '@adminium/meta';

import { ConflictError, ForbiddenError, ValidationFailedError } from '../errors.js';
import { compileStep, resetRails, sessionRails, type CompileContext } from './compile.js';
import { preflight, type CeilingGate, type PreflightInput } from './preflight.js';
import { repairAfterRename, type RenameRepairResult } from './rename-repair.js';
import { rebuildColumnMapping, runSqliteRebuild } from './sqlite-rebuild.js';

export interface PlanServiceInput {
  meta: MetaDb;
  connectionId: string;
  edit: SchemaEdit;
  /** The active snapshot's model, override-applied. */
  actual: DatabaseModel;
  dialect: Dialect;
  serverVersion: string | null;
  maxIdentifierLength: number;
  /** True when Adminium's own tables live in this database. */
  metaSharesDatabase: boolean;
  /** Kysely for the compile step; no statement is executed by `plan`. */
  db: CompileContext['db'];
  countRows?: PreflightInput['countRows'];
  /**
   * D18's ceiling door. On the PLAN path too, not only on apply: the plan the
   * operator authorises has to be the plan that runs (D2), and a refused step
   * compiles to no SQL — so a door opened only at apply produced a different
   * checksum and `SCHEMA_DRIFT` fired before the door was consulted.
   */
  ceilingDoor?: PreflightInput['ceilingDoor'];
  privileges?: PreflightInput['privileges'];
}

export interface PlannedStep extends DdlStep {
  /** The exact statements this step will run — the D2 preview. */
  sql: string[];
}

export interface SchemaPlan extends Omit<DdlPlan, 'steps'> {
  steps: PlannedStep[];
  /**
   * Tables the row ceiling gates, and whether this principal can open the gate
   * (D18). Plan-LEVEL because a ceiling is a fact about a table, and because
   * `planReply`'s refusal object is a closed shape whose serializer silently
   * drops anything not declared in it.
   */
  ceilings: CeilingGate[];
  /** A previous apply that never reported an outcome (35-T36). */
  unfinished: { id: string; startedAt: number } | null;
}

/**
 * Build a plan. Never touches the customer's database except to read row
 * counts and privileges, both of which are reads.
 */
export async function planSchemaEdit(input: PlanServiceInput): Promise<SchemaPlan> {
  // --- 1. validate the document against the snapshot and the dialect -------
  const issues = validateSchemaEdit(input.edit, {
    dialect: input.dialect,
    maxIdentifierLength: input.maxIdentifierLength,
    actual: input.actual.tables,
    metaSharesDatabase: input.metaSharesDatabase,
    isReserved: isReservedWord,
  });
  if (issues.length > 0) {
    throw new ValidationFailedError('This schema edit cannot be applied.', { issues });
  }

  // --- 2. rename first, so the diff sees renames (35-T03) ------------------
  const { model: renamed, applied } = applyRenames(input.actual, input.edit.renames);

  /*
   * A renamed table's id MOVES, and the desired document is written against the
   * old one.
   *
   * `applyRenames` rewrites `public.reservations` to `public.table_bookings`
   * throughout the actual model — that is what makes the diff see a rename
   * instead of a drop plus an add (35-T03). But the client loaded the table as
   * `public.reservations` and sends it back under that id with a new `name`, so
   * without this map the planner finds no actual table with the desired id and
   * plans a CREATE of a table that already exists.
   *
   * Mapping here rather than asking the client to compute `schema.newName`: the
   * schema-qualification rule is the server's, `applied` already holds the
   * answer, and a caller should be able to send back the table under the id it
   * was given plus its rename intent, which is all a UI naturally has.
   */
  const renamedIds = new Map(
    applied.filter((r) => r.kind === 'table').map((r) => [r.tableId, r.newTableId]),
  );
  const idOf = (table: (typeof input.edit.upsertTables)[number]): string | null =>
    table.id === null ? null : (renamedIds.get(table.id) ?? table.id);

  // --- 3. convert the authored tables into IR ------------------------------
  const dbTypeFor = ddlTypeForDesired(input.dialect);
  const desired: TableModel[] = input.edit.upsertTables.map((table) =>
    desiredTableToModel(
      { ...table, id: idOf(table) },
      { dbTypeFor, defaultSchema: renamed.defaultSchema ?? 'public' },
    ),
  );
  /*
   * `addColumns` → a desired table that is the ACTUAL table plus the new
   * columns (38 D6). Grouped first, so two additions to one table are one
   * desired model and therefore one diff rather than two that overwrite each
   * other in `planDdl`'s map.
   *
   * Resolved through `renamedIds` for the same reason `idOf` is: an edit may
   * rename a table and add a column to it in one go, and the client names it
   * by the id it was given.
   */
  const addedByTable = new Map<string, typeof input.edit.addColumns[number]['column'][]>();
  for (const entry of input.edit.addColumns ?? []) {
    const id = renamedIds.get(entry.table) ?? entry.table;
    const table = renamed.tables.find((t) => t.id === id || t.name === id);
    // `validateSchemaEdit` has already refused an unknown table; this only
    // guards the lookup.
    if (table === undefined) continue;
    const list = addedByTable.get(table.id);
    if (list === undefined) addedByTable.set(table.id, [entry.column]);
    else list.push(entry.column);
  }
  for (const [tableId, columns] of addedByTable) {
    const table = renamed.tables.find((t) => t.id === tableId);
    if (table === undefined) continue;
    desired.push(tableWithAddedColumns(table, columns, { dbTypeFor }));
  }

  const desiredRelations: Relation[] = input.edit.upsertTables.flatMap((table) =>
    table.foreignKeys.map((fk) => {
      const fromId = idOf(table) ?? `${table.schema ?? renamed.defaultSchema ?? 'public'}.${table.name}`;
      return {
        id: `fk:${fromId}(${fk.columns.join(',')})->${fk.toTable}(${fk.toColumns.join(',')})`,
        kind: 'declared-fk' as const,
        cardinality: 'one-to-many' as const,
        from: { tableId: fromId, columns: [...fk.columns] },
        to: { tableId: fk.toTable, columns: [...fk.toColumns] },
        through: null,
        onDelete: fk.onDelete,
        onUpdate: fk.onUpdate,
        selfReferential: fromId === fk.toTable,
        confidence: 1,
        constraintName: fk.name,
      };
    }),
  );

  // --- 4. plan --------------------------------------------------------------
  const planned = planDdl({
    actual: renamed,
    desired,
    desiredRelations,
    dropTables: input.edit.dropTables,
    renames: applied,
    dialect: input.dialect,
    serverVersion: input.serverVersion,
  });

  // --- 5. preflight: facts, not adjectives ---------------------------------
  const pre = await preflight({
    meta: input.meta,
    connectionId: input.connectionId,
    steps: planned.steps,
    ...(input.countRows === undefined ? {} : { countRows: input.countRows }),
    ...(input.privileges === undefined ? {} : { privileges: input.privileges }),
    ...(input.ceilingDoor === undefined ? {} : { ceilingDoor: input.ceilingDoor }),
  });

  const enumValuesByTable = new Map(
    input.edit.upsertTables.map((t) => [
      t.id ?? `${t.schema ?? renamed.defaultSchema ?? 'public'}.${t.name}`,
      t.enumValues,
    ]),
  );
  /*
   * Indexed under BOTH ids when a table is renamed.
   *
   * `rename-table` is the one step whose `step.table` is the table's OLD id —
   * deliberately, because it is the statement that changes the name and every
   * later step on that table names it by the new one. So a map keyed only by
   * the new id misses exactly the step that needs the desired name, and
   * `compileStep` threw "rename-table needs the desired name", which the
   * compile guard turned into a `-- could not render` comment and the apply
   * then reported as a failed step. The rename was planned correctly and could
   * not be executed.
   */
  const desiredById = indexDesired(desired, input.edit);

  const steps: PlannedStep[] = planned.steps.map((step) => {
    const refusal = pre.refusals.get(step.id);
    const withConsequences: DdlStep = {
      ...step,
      consequences: [...step.consequences, ...(pre.consequences.get(step.id) ?? [])],
      ...(refusal === undefined
        ? {}
        : { hazard: 'refused' as const, refusal: refusal.code as DdlStep['refusal'], rationale: refusal.message }),
    };
    return { ...withConsequences, sql: compileFor(withConsequences, input, desiredById, enumValuesByTable, desiredRelations) };
  });

  const refusals = [
    ...planned.refusals,
    ...[...pre.refusals.entries()].map(([stepId, r]) => ({
      code: r.code as (typeof planned.refusals)[number]['code'],
      message: r.message,
      table: planned.steps.find((s) => s.id === stepId)?.table ?? null,
      column: null,
    })),
  ];

  const unfinishedRow = await schemaChangesRepo(input.meta).unfinishedFor(input.connectionId);

  return {
    steps,
    refusals,
    warnings: planned.warnings,
    hazard: refusals.length > 0 ? 'refused' : planned.hazard,
    requiresSuperAdmin: planned.requiresSuperAdmin,
    checksum: checksumOf(steps, input.edit, [...(input.ceilingDoor?.acknowledged ?? [])]),
    /** D18: the tables the row ceiling gates, for the second confirm field. */
    ceilings: pre.ceilings,
    unfinished:
      unfinishedRow === null ? null : { id: unfinishedRow.id, startedAt: unfinishedRow.startedAt },
  };
}

/**
 * Compile a step's statements, tolerating the kinds whose compiler is not
 * reachable from a plan (the SQLite rebuild, which the apply path drives). A
 * preview that threw would make one un-compilable step hide the whole plan.
 */
/**
 * Desired tables by id, with an alias under the pre-rename id.
 *
 * Both callers need the same thing and got it two different ways once; one of
 * them silently produced a plan whose rename step could not compile.
 */
function indexDesired(desired: readonly TableModel[], edit: SchemaEdit): Map<string, TableModel> {
  const byId = new Map(desired.map((t) => [t.id, t]));
  for (const rename of edit.renames.tables) {
    // `from` may be an id or a bare name; the desired table is the one whose
    // name is now `to`, whatever schema it ended up qualified with.
    const table = desired.find((t) => t.name === rename.to);
    if (table !== undefined && !byId.has(rename.from)) byId.set(rename.from, table);
  }
  return byId;
}


/**
 * Native type per FK SOURCE column, taken from the column it references.
 *
 * A foreign-key column has to MATCH its target, and on MySQL matching includes
 * signedness. Adminium's vocabulary has one `integer`, which compiles to a
 * signed one, so linking to the near-universal `int unsigned` auto-increment
 * key failed at apply with "Referencing column … and referenced column … are
 * incompatible" — after the review pane had shown the statement as safe.
 *
 * Resolved against the LIVE model, so the answer is the target's real storage
 * type rather than what Adminium would have chosen for it. A target inside the
 * same edit is skipped: Adminium is emitting both sides, so both already agree.
 */
function fkColumnTypesFor(
  tableId: string,
  relations: readonly Relation[],
  actual: DatabaseModel,
): Record<string, string> {
  const types: Record<string, string> = {};
  for (const relation of relations) {
    if (relation.from.tableId !== tableId) continue;
    const target = actual.tables.find(
      (t) => t.id === relation.to.tableId || t.name === relation.to.tableId,
    );
    if (target === undefined) continue;
    relation.from.columns.forEach((column, index) => {
      const referenced = relation.to.columns[index];
      const targetColumn = target.columns.find((c) => c.name === referenced);
      if (targetColumn === undefined) return;
      /*
       * A generated key's `dbType` carries its generation clause on some
       * engines (`int unsigned auto_increment`); the FK column must copy the
       * TYPE and never the clause, or the child table grows a second
       * auto-increment column and MySQL refuses the CREATE outright.
       */
      const bare = targetColumn.dbType.replace(/\s*auto_increment\b/i, '').trim();
      if (bare !== '') types[column] = bare;
    });
  }
  return types;
}

function compileFor(
  step: DdlStep,
  input: PlanServiceInput,
  desiredById: Map<string, TableModel>,
  enumValues: Map<string, Readonly<Record<string, readonly string[]>>>,
  relations: readonly Relation[],
): string[] {
  if (step.refusal !== null) return [];
  try {
    return compileStep(step, {
      db: input.db,
      dialect: input.dialect,
      serverVersion: input.serverVersion,
      desired: desiredById.get(step.table),
      enumValues: enumValues.get(step.table),
      // Match on the STEP'S OWN column, not just the table: a table with two
      // foreign keys would otherwise compile both steps from whichever
      // relation happened to be first, and emit the same constraint twice.
      relation: relations.find(
        (r) =>
          r.from.tableId === step.table &&
          (step.column === null || r.from.columns.includes(step.column)),
      ),
      // `create-table` inlines all of them; every other kind ignores this.
      relations: relations.filter((r) => r.from.tableId === step.table),
      fkColumnTypes: fkColumnTypesFor(step.table, relations, input.actual),
    }).map((q) => q.sql);
  } catch (error) {
    // `rebuild-table` is compiled by the SQLite rebuild module, not here, so it
    // legitimately has no preview line — every other kind failing to compile is
    // a BUG, and returning `[]` for it silently would put a step in the review
    // with no statement under it. That is the same silent-drop failure a
    // foreign key on a new table already had once; it does not get a second
    // form. The reason goes on screen.
    if (step.kind === 'rebuild-table') return [];
    return [`-- could not render this statement: ${error instanceof Error ? error.message : String(error)}`];
  }
}

/**
 * The plan's identity. Covers the STEPS and the EDIT, so a re-plan producing
 * different work produces a different checksum — which is exactly what `apply`
 * compares against.
 */
export function checksumOf(
  steps: readonly PlannedStep[],
  edit: SchemaEdit,
  acknowledged: readonly string[] = [],
): string {
  return sha256Hex(
    JSON.stringify({
      base: edit.baseSnapshotId,
      steps: steps.map((s) => ({ k: s.kind, t: s.table, c: s.column, sql: s.sql })),
      /*
       * The REFUSALS and the ACKNOWLEDGEMENT are part of a plan's identity.
       *
       * Neither was hashed, and both had to be. A refused step compiles to no
       * SQL, so on SQLite — where `rebuild-table` compiles to no SQL whether it
       * is refused or not — a door-closed plan and a door-open plan hashed
       * IDENTICALLY. A checksum obtained from a plan that showed the ceiling
       * refusal would have replayed unchanged into an apply that opened the
       * door, which is precisely the replay the checksum exists to stop.
       *
       * Sorted, because the acknowledgement is a set and the order the client
       * happens to send it in is not part of what was authorised.
       */
      refused: steps.filter((s) => s.refusal !== null).map((s) => [s.kind, s.table, s.column, s.refusal]),
      ack: [...acknowledged].sort(),
    }),
  );
}

// ---------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------

export interface ApplyServiceInput extends PlanServiceInput {
  /** The checksum the client is authorising. */
  checksum: string;
  createdBy: string | null;
  /** Whether the caller holds Super Admin — gates `lossy`/`irreversible` (D7). */
  superAdmin: boolean;
  /** DSN crypto, for the rename repair's connection-settings rewrite (D33). */
  crypto?: Parameters<typeof repairAfterRename>[0]['crypto'];
  /** Re-introspect the touched tables, for the live-drift check (35-T35). */
  reintrospect?: (tableIds: readonly string[]) => Promise<DatabaseModel | null>;
  /**
   * Re-introspect ONE table, for the SQLite rebuild's step 12 — the compare
   * that turns "it ran" into "it is what the plan promised" (§7).
   */
  reintrospectTable?: (tableId: string) => Promise<TableModel | null>;
  /** Progress callback for the job runner. */
  onProgress?: (pct: number, step: string) => void;
  signal?: AbortSignal;
}

export interface ApplyResult {
  changeId: string;
  status: 'applied' | 'partial' | 'failed';
  steps: StepOutcome[];
  error: string | null;
  /** What D33's repair rewrote in Adminium's own store; null when nothing was renamed. */
  repaired: RenameRepairResult | null;
}

/** Run a previously planned edit. */
export async function applySchemaEdit(input: ApplyServiceInput): Promise<ApplyResult> {
  const plan = await planSchemaEdit(input);

  // --- checksum: did the SNAPSHOT move? (D2) -------------------------------
  if (plan.checksum !== input.checksum) {
    throw new ConflictError(
      'The schema changed since this plan was made. Review the new plan before applying.',
      'SCHEMA_DRIFT',
      { expected: input.checksum, actual: plan.checksum },
    );
  }
  if (plan.refusals.length > 0) {
    throw new ValidationFailedError('This plan was refused and must not be applied.', {
      refusals: plan.refusals,
    });
  }
  // --- D7: destructive steps need Super Admin ------------------------------
  if (plan.requiresSuperAdmin && !input.superAdmin) {
    throw new ForbiddenError(
      'Dropping a table or column, or any change that discards data, requires Super Admin.',
      'FORBIDDEN',
      { steps: plan.steps.filter((s) => s.requiresSuperAdmin).map((s) => s.summary) },
    );
  }

  // --- live drift: did the DATABASE move? (35-T35) -------------------------
  if (input.reintrospect !== undefined) {
    const touched = [...new Set(plan.steps.map((s) => s.table))];
    const live = await input.reintrospect(touched);
    if (live !== null) {
      const drifted = findDrift(input.actual, live, touched);
      if (drifted !== null) {
        throw new ConflictError(
          `"${drifted.table}" changed in the database since this plan was made` +
            (drifted.field === null ? '.' : ` (${drifted.field}).`),
          'SCHEMA_DRIFT',
          drifted,
        );
      }
    }
  }

  // --- the ledger row, BEFORE the first statement (D3, 35-T36) -------------
  const ledger = schemaChangesRepo(input.meta);
  const outcomes: StepOutcome[] = plan.steps.map((step) => ({
    id: step.id,
    kind: step.kind,
    table: step.table,
    column: step.column,
    hazard: step.hazard,
    outcome: 'pending',
    sql: step.sql,
    error: null,
    durationMs: null,
  }));
  /*
   * D18: "the door is per apply, audited, and named in the ledger."
   *
   * The rows the operator was shown for the tables they actually authorised
   * past the ceiling — read from the plan's own gates rather than regexed back
   * out of a consequence's English, which is what this did and which would have
   * silently become null the first time that sentence was reworded.
   *
   * Null when no ceiling was opened, which is almost every apply. Zero would
   * claim someone acknowledged a rewrite of nothing.
   */
  const acknowledgedRows = plan.ceilings
    .filter((gate) => gate.acknowledged)
    .reduce<number | null>((max, gate) => (max === null || gate.rows > max ? gate.rows : max), null);

  const change = await ledger.start({
    connectionId: input.connectionId,
    planChecksum: plan.checksum,
    hazard: plan.hazard,
    steps: outcomes,
    baseSnapshotId: input.edit.baseSnapshotId,
    createdBy: input.createdBy,
    ...(acknowledgedRows === null ? {} : { acknowledgedRows }),
  });

  // --- what the rebuild branch needs, recomputed on this side --------------
  // `planSchemaEdit` builds these in its own scope; the apply path needs the
  // same three facts and derives them from the same `edit`, so the two cannot
  // disagree about which table is being rebuilt into what.
  const dbTypeForApply = ddlTypeForDesired(input.dialect);
  const defaultSchema = input.actual.defaultSchema ?? 'public';
  // The same old-id → new-id map the plan path built, derived from the same
  // edit so the two sides cannot disagree about which table became what.
  const renamedApplyIds = new Map(
    applyRenames(input.actual, input.edit.renames)
      .applied.filter((r) => r.kind === 'table')
      .map((r) => [r.tableId, r.newTableId]),
  );
  const desiredById = indexDesired(
    input.edit.upsertTables.map((t) =>
      desiredTableToModel(
        { ...t, id: t.id === null ? null : (renamedApplyIds.get(t.id) ?? t.id) },
        { dbTypeFor: dbTypeForApply, defaultSchema },
      ),
    ),
    input.edit,
  );
  const renameMap: Record<string, string> = Object.fromEntries(
    input.edit.renames.columns.map((r) => [r.from, r.to]),
  );
  const enumValuesFor = (tableId: string): Readonly<Record<string, readonly string[]>> =>
    input.edit.upsertTables.find(
      (t) => (t.id ?? `${t.schema ?? defaultSchema}.${t.name}`) === tableId,
    )?.enumValues ?? {};

  // --- run ------------------------------------------------------------------
  const { db, dialect } = input;
  let failed: string | null = null;
  try {
    for (const query of sessionRails(dialect, db)) await db.executeQuery(query);

    for (let i = 0; i < plan.steps.length; i += 1) {
      const step = plan.steps[i]!;
      // Cancellation is honoured BETWEEN statements, never mid-flight (D10):
      // abandoning a running DDL statement does not stop the database from
      // finishing it, so the only honest place to stop is here.
      if (input.signal?.aborted === true) break;
      const startedAt = Date.now();
      try {
        if (step.kind === 'rebuild-table') {
          /*
           * The SQLite rebuild is twelve steps, two of them reads whose results
           * the procedure needs, so it cannot be a flat statement list like
           * every other kind — which is exactly how it came to be skipped: the
           * plan compiled it to NO statements and this loop then iterated an
           * empty list and recorded success. A rebuild that does nothing and
           * says it worked is worse than one that fails.
           */
          const actualTable = input.actual.tables.find((t) => t.id === step.table);
          const desiredTable = desiredById.get(step.table);
          if (actualTable === undefined || desiredTable === undefined) {
            throw new Error(`rebuild-table has no table to rebuild: ${step.table}`);
          }
          await runSqliteRebuild({
            db,
            actual: actualTable,
            desired: desiredTable,
            columnMapping: rebuildColumnMapping(actualTable, desiredTable, renameMap),
            enumValues: enumValuesFor(step.table),
            ...(input.reintrospectTable === undefined
              ? {}
              : { reintrospect: input.reintrospectTable }),
          });
        } else {
          if (step.sql.length === 0) {
            // Every other kind compiles to at least one statement. Zero means
            // the compiler refused and the plan swallowed it — never a success.
            throw new Error(`${step.kind} produced no statement to run`);
          }
          for (const sqlText of step.sql) {
            await db.executeQuery({ sql: sqlText, parameters: [], query: { kind: 'RawNode' } } as never);
          }
        }
        outcomes[i] = { ...outcomes[i]!, outcome: 'succeeded', durationMs: Date.now() - startedAt };
      } catch (error) {
        failed = error instanceof Error ? error.message : String(error);
        outcomes[i] = {
          ...outcomes[i]!,
          outcome: 'failed',
          error: failed,
          durationMs: Date.now() - startedAt,
        };
        break;
      }
      await ledger.recordSteps(change.id, outcomes);
      input.onProgress?.(Math.round(((i + 1) / plan.steps.length) * 100), step.summary);
    }
  } finally {
    // D10: MySQL's lock_wait_timeout outlives the request on a pooled
    // connection, so it is reset whatever happened.
    for (const query of resetRails(dialect, db)) {
      await db.executeQuery(query).catch(() => undefined);
    }
  }

  const ran = outcomes.filter((o) => o.outcome === 'succeeded').length;
  const status: ApplyResult['status'] =
    failed === null ? 'applied' : ran > 0 ? 'partial' : 'failed';
  await ledger.finish(change.id, { status, steps: outcomes, error: failed });

  /*
   * D33: a rename in the customer's database leaves every reference Adminium
   * stores pointing at the old name — page bindings, override rows, grant
   * strings, `includedTables`, the diagram layout. None of them errors; the
   * page just stops resolving and the table quietly vanishes from the app the
   * rename was meant to improve.
   *
   * This ran nowhere until now: `repairAfterRename` was written, tested and
   * never called. It runs only for renames that actually SUCCEEDED — repairing
   * a reference to a rename that failed would point Adminium at a table that
   * does not exist.
   */
  const renamedOk = outcomes
    .filter((o) => o.kind === 'rename-table' && o.outcome === 'succeeded')
    .map((o) => o.table);
  const succeededRenames = input.edit.renames.tables.filter((r) => renamedOk.includes(r.from));
  let repaired: RenameRepairResult | null = null;
  if (succeededRenames.length > 0 && input.crypto !== undefined) {
    repaired = await repairAfterRename({
      meta: input.meta,
      connectionId: input.connectionId,
      renames: succeededRenames.map((r) => ({
        from: r.from,
        to: r.from.includes('.') ? `${r.from.slice(0, r.from.lastIndexOf('.'))}.${r.to}` : r.to,
      })),
      crypto: input.crypto,
    });
  }

  return { changeId: change.id, status, steps: outcomes, error: failed, repaired };
}

/**
 * Compare the base snapshot with a live re-introspection at DEFINITION
 * resolution. Returns the first difference, which is what the operator needs
 * named — not a diff of everything that has ever changed.
 */
export function findDrift(
  base: DatabaseModel,
  live: DatabaseModel,
  tableIds: readonly string[],
): { table: string; field: string | null } | null {
  const liveById = new Map(live.tables.map((t) => [t.id, t]));
  for (const id of tableIds) {
    const before = base.tables.find((t) => t.id === id);
    const after = liveById.get(id);
    if (before === undefined) continue; // a create; nothing to drift from
    if (after === undefined) return { table: id, field: 'the table no longer exists' };
    for (const column of before.columns) {
      const now = after.columns.find((c) => c.name === column.name);
      if (now === undefined) return { table: id, field: `${column.name} was removed` };
      if (now.logicalType !== column.logicalType) {
        return { table: id, field: `${column.name} is now ${now.logicalType}` };
      }
      if (now.nullable !== column.nullable) {
        return { table: id, field: `${column.name}'s nullability changed` };
      }
    }
    for (const column of after.columns) {
      if (!before.columns.some((c) => c.name === column.name)) {
        return { table: id, field: `${column.name} was added` };
      }
    }
  }
  return null;
}
