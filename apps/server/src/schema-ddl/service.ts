// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The plan and apply services.
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
 * of the touched tables at apply time, which is what
 *      `introspect({tableFilter})` is for.
 *
 * ─── The ledger is written before the first statement ──────────────────────
 *
 * D3/. MySQL commits every DDL statement implicitly, so an apply cannot be
 * transactional there and a crash halfway leaves no in-process record. The
 * `running` row is what makes a killed worker legible afterwards.
 */
import {
  applyRenames,
  ddlTypeForDesired,
  dropCycleLinks,
  desiredTableToModel,
  isReservedWord,
  planDdl,
  isWideningChange,
  parseEnumCheck,
  tableWithAddedColumns,
  tableWithAlteredColumns,
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
import { overridesRepo, schemaChangesRepo } from '@adminium/meta';

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
  /** A previous apply that never reported an outcome. */
  unfinished: { id: string; startedAt: number } | null;
}

/**
 * Build a plan. Never touches the customer's database except to read row
 * counts and privileges, both of which are reads.
 */
export async function planSchemaEdit(input: PlanServiceInput): Promise<SchemaPlan> {
  return (await planWithRelations(input)).plan;
}

/**
 * The plan plus the desired foreign keys it was built from.
 *
 * The apply path needs those links for the SQLite rebuild, which recreates the
 * table and has to put its links back. Handed over rather than re-derived: the
 * relations the plan diffed against ARE the ones the rebuild must emit, and a
 * second derivation on the apply side is how the two would come to disagree.
 */
async function planWithRelations(
  input: PlanServiceInput,
): Promise<{ plan: SchemaPlan; desiredRelations: readonly Relation[] }> {
  // --- 1. validate the document against the snapshot and the dialect -------
  const issues = validateSchemaEdit(input.edit, {
    dialect: input.dialect,
    maxIdentifierLength: input.maxIdentifierLength,
    actual: input.actual.tables,
    metaSharesDatabase: input.metaSharesDatabase,
    isReserved: isReservedWord,
    isWidening: (from, to) => isWideningChange(from, to),
  });
  if (issues.length > 0) {
    throw new ValidationFailedError('This schema edit cannot be applied.', { issues });
  }

  // --- 2. rename first, so the diff sees renames ------------------
  const { model: renamed, applied } = applyRenames(input.actual, input.edit.renames);

  /*
   * A renamed table's id MOVES, and the desired document is written against the
   * old one.
   *
   * `applyRenames` rewrites `public.reservations` to `public.table_bookings`
   * throughout the actual model — that is what makes the diff see a rename
   * instead of a drop plus an add. But the client loaded the table as
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
   * columns. Grouped first, so two additions to one table are one desired
   * model and therefore one diff rather than two that overwrite each other
   * in `planDdl`'s map.
   *
   * Resolved through `renamedIds` for the same reason `idOf` is: an edit may
   * rename a table and add a column to it in one go, and the client names it
   * by the id it was given.
   */
  const extended = extendedTables(renamed, renamedIds, input.edit, dbTypeFor, input.dialect);
  for (const table of extended.values()) desired.push(table);

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
  /*
   * An extended table keeps its foreign keys. `planDdl` diffs FKs from the
   * relations, not from the `TableModel`, so passing the columns through is
   * only half of "compare the table against itself": leaving its FKs out of
   * `desiredRelations` made every one read as removed — a `DROP CONSTRAINT` on
   * postgres and MySQL, and on SQLite a `drop-fk` that only the rebuild can
   * express, so one nullable column copied every row and tripped the
   * row-count gate.
   */
  for (const tableId of extended.keys()) {
    desiredRelations.push(
      ...renamed.relations.filter((r) => r.kind === 'declared-fk' && r.from.tableId === tableId),
    );
  }
  /*
   * A column added WITH a link (an app update's `tickets.customer_id`): its
   * foreign key joins the desired relations, so the diff plans it — an
   * `add-fk` on postgres and MySQL, and part of the ADD COLUMN on SQLite — and
   * `fkColumnTypesFor` gives the column its target key's native type.
   */
  const tableIdOf = (ref: string): string | undefined => {
    const id = renamedIds.get(ref) ?? ref;
    return renamed.tables.find((t) => t.id === id || t.name === id)?.id;
  };
  for (const entry of input.edit.addColumns ?? []) {
    if (entry.foreignKey === undefined) continue;
    const fromId = tableIdOf(entry.table);
    const toId = tableIdOf(entry.foreignKey.toTable);
    // `validateSchemaEdit` has already refused a table that is not there.
    if (fromId === undefined || toId === undefined) continue;
    const columns = [entry.column.name];
    desiredRelations.push({
      id: `fk:${fromId}(${columns.join(',')})->${toId}(${entry.foreignKey.toColumns.join(',')})`,
      kind: 'declared-fk' as const,
      cardinality: 'one-to-many' as const,
      from: { tableId: fromId, columns },
      to: { tableId: toId, columns: [...entry.foreignKey.toColumns] },
      through: null,
      onDelete: entry.foreignKey.onDelete,
      onUpdate: null,
      selfReferential: fromId === toId,
      confidence: 1,
      constraintName: null,
    });
  }

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

  const enumValuesByTable = new Map<string, Readonly<Record<string, readonly string[]>>>(
    input.edit.upsertTables.map((t) => [
      t.id ?? `${t.schema ?? renamed.defaultSchema ?? 'public'}.${t.name}`,
      t.enumValues,
    ]),
  );
  /*
   * An EXTENDED table's value lists are its own CHECKs, as altered — the same
   * answer the apply path's `enumValuesFor` gives. Without them an
   * `enumValues` edit (an app update adding `gift_card` to a payment method)
   * compiled its re-added CHECK to a "could not render" comment: the plan
   * dropped the constraint and put nothing back.
   */
  for (const [tableId, table] of extended) {
    const names = table.columns.map((c) => c.name);
    const lists: Record<string, readonly string[]> = {};
    for (const check of table.checks) {
      const parsed = parseEnumCheck(check.expression, names);
      if (parsed !== null) lists[parsed.column] = parsed.values;
    }
    if (Object.keys(lists).length > 0) enumValuesByTable.set(tableId, lists);
  }
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
  const desiredById = indexDesired(desired, input.edit, renamed);

  const links = linksFor(planned.steps, desiredRelations, renamed.relations, input.dialect);
  const steps: PlannedStep[] = planned.steps.map((step) => {
    const refusal = pre.refusals.get(step.id);
    const withConsequences: DdlStep = {
      ...step,
      consequences: [...step.consequences, ...(pre.consequences.get(step.id) ?? [])],
      ...(refusal === undefined
        ? {}
        : { hazard: 'refused' as const, refusal: refusal.code as DdlStep['refusal'], rationale: refusal.message }),
    };
    return { ...withConsequences, sql: compileFor(withConsequences, input, desiredById, enumValuesByTable, links) };
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

  const plan: SchemaPlan = {
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
  return { plan, desiredRelations };
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
/**
 * The desired model of every table an edit EXTENDS rather than restates:
 * `addColumns` and `alterColumns`, grouped per table so two changes to one
 * table are one desired model (and one diff), built from the snapshot's own
 * table so nothing untouched can read as changed. Alterations first, then the
 * added columns on top.
 *
 * Shared by the plan and the apply paths so the two cannot disagree about
 * which table is being rebuilt into what.
 */
export function extendedTables(
  actual: DatabaseModel,
  renamedIds: ReadonlyMap<string, string>,
  edit: SchemaEdit,
  dbTypeFor: ReturnType<typeof ddlTypeForDesired>,
  /** On SQLite an added column's uniqueness is a unique index, made in place: never a table rebuild. */
  dialect?: Dialect,
): Map<string, TableModel> {
  const find = (ref: string) => {
    const id = renamedIds.get(ref) ?? ref;
    return actual.tables.find((t) => t.id === id || t.name === id);
  };
  const adds = new Map<string, SchemaEdit['addColumns'][number]['column'][]>();
  const unique = new Map<string, Set<string>>();
  const uniqueWith = new Map<string, Map<string, readonly string[]>>();
  for (const entry of edit.addColumns ?? []) {
    const table = find(entry.table);
    // `validateSchemaEdit` has already refused an unknown table.
    if (table === undefined) continue;
    adds.set(table.id, [...(adds.get(table.id) ?? []), entry.column]);
    if (entry.unique === true) unique.set(table.id, (unique.get(table.id) ?? new Set()).add(entry.column.name));
    if (entry.unique === true && entry.uniqueWith !== undefined) {
      uniqueWith.set(table.id, (uniqueWith.get(table.id) ?? new Map<string, readonly string[]>()).set(entry.column.name, entry.uniqueWith));
    }
  }
  const alters = new Map<string, SchemaEdit['alterColumns'][number][]>();
  for (const entry of edit.alterColumns ?? []) {
    const table = find(entry.table);
    if (table === undefined) continue;
    alters.set(table.id, [...(alters.get(table.id) ?? []), entry]);
  }
  const out = new Map<string, TableModel>();
  for (const tableId of new Set([...alters.keys(), ...adds.keys()])) {
    const table = actual.tables.find((t) => t.id === tableId);
    if (table === undefined) continue;
    const uniqueAs = dialect === 'sqlite' ? 'index' : 'constraint';
    const altered = tableWithAlteredColumns(table, alters.get(tableId) ?? [], { dbTypeFor, uniqueAs });
    out.set(
      tableId,
      tableWithAddedColumns(altered, adds.get(tableId) ?? [], {
        dbTypeFor,
        unique: unique.get(tableId) ?? new Set(),
        uniqueAs,
        uniqueWith: uniqueWith.get(tableId) ?? new Map(),
      }),
    );
  }
  return out;
}

function indexDesired(
  desired: readonly TableModel[],
  edit: SchemaEdit,
  /**
   * The model after the edit's renames. A table that is ONLY renamed — no
   * restatement, no added or altered column — has no desired model of its
   * own, and the compiler needs one to know the new name; the renamed table
   * is exactly that. (A server-made edit renames a stranger's table out of an
   * app's way this way.)
   */
  renamed?: DatabaseModel,
): Map<string, TableModel> {
  const byId = new Map(desired.map((t) => [t.id, t]));
  for (const rename of edit.renames.tables) {
    // `from` may be an id or a bare name; the desired table is the one whose
    // name is now `to`, whatever schema it ended up qualified with.
    const table = desired.find((t) => t.name === rename.to) ?? renamed?.tables.find((t) => t.name === rename.to);
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

/**
 * The foreign-key facts each step compiles from, beyond the desired links.
 *
 * Both halves of a foreign-key cycle are decided by the planner and only READ
 * here, from the steps it made:
 *
 *  - an `add-fk` on a table the same plan CREATES is the link that closes a
 *    cycle (`planDdl`'s creates); its `create-table` must leave that link out,
 *    or it names a table that does not exist yet and the step exists for
 *    nothing;
 *  - a `drop-fk` on a dropped table names a constraint that exists only in the
 *    ACTUAL schema — the table is in no desired document — so it is resolved
 *    there, by the constraint's own name;
 *  - on SQLite, which gets no `drop-fk`, a table the drop order cannot honour
 *    (`dropCycleLinks`) is dropped with enforcement off.
 */
interface StepLinks {
  desired: readonly Relation[];
  actual: readonly Relation[];
  /** `table:column` of every link a separate `add-fk` makes on a new table. */
  separate: ReadonlySet<string>;
  /** SQLite: tables whose DROP must run with foreign keys off. */
  unenforcedDrops: ReadonlySet<string>;
}

/** How the preview says a step's statement could not be compiled — which the apply refuses to run. */
const UNRENDERED = '-- could not render this statement: ';

function linksFor(
  steps: readonly DdlStep[],
  desired: readonly Relation[],
  actual: readonly Relation[],
  dialect: Dialect,
): StepLinks {
  const created = new Set(steps.filter((s) => s.kind === 'create-table').map((s) => s.table));
  const separate = new Set(
    steps
      .filter((s) => s.kind === 'add-fk' && created.has(s.table) && s.column !== null)
      .map((s) => `${s.table}:${s.column!}`),
  );
  const dropped = steps.filter((s) => s.kind === 'drop-table').map((s) => s.table);
  const unenforcedDrops = new Set(
    dialect === 'sqlite' ? dropCycleLinks(dropped, actual).map((r) => r.to.tableId) : [],
  );
  return { desired, actual, separate, unenforcedDrops };
}

function compileFor(
  step: DdlStep,
  input: PlanServiceInput,
  desiredById: Map<string, TableModel>,
  enumValues: Map<string, Readonly<Record<string, readonly string[]>>>,
  links: StepLinks,
): string[] {
  if (step.refusal !== null) return [];
  const relations = links.desired;
  // Match on the STEP'S OWN column, not just the table: a table with two
  // foreign keys would otherwise compile both steps from whichever relation
  // happened to be first, and emit the same constraint twice.
  const onStep = (r: Relation): boolean =>
    r.from.tableId === step.table && (step.column === null || r.from.columns.includes(step.column));
  const relation =
    step.kind === 'drop-fk' && (step.constraint !== null || step.column !== null)
      ? (links.actual.find(
          (r) => onStep(r) && (step.constraint === null || r.constraintName === step.constraint),
        ) ?? relations.find(onStep))
      : relations.find(onStep);
  try {
    return compileStep(step, {
      db: input.db,
      dialect: input.dialect,
      serverVersion: input.serverVersion,
      desired: desiredById.get(step.table),
      enumValues: enumValues.get(step.table),
      relation,
      // `create-table` inlines all of them but a cycle's closing link, which
      // is its own step; every other kind ignores this.
      relations: relations.filter(
        (r) =>
          r.from.tableId === step.table &&
          !r.from.columns.some((c) => links.separate.has(`${step.table}:${c}`)),
      ),
      fkColumnTypes: fkColumnTypesFor(step.table, relations, input.actual),
      withoutForeignKeys: links.unenforcedDrops.has(step.table),
    }).map((q) => q.sql);
  } catch (error) {
    // `rebuild-table` is compiled by the SQLite rebuild module, not here, so it
    // legitimately has no preview line — every other kind failing to compile is
    // a BUG, and returning `[]` for it silently would put a step in the review
    // with no statement under it. That is the same silent-drop failure a
    // foreign key on a new table already had once; it does not get a second
    // form. The reason goes on screen.
    if (step.kind === 'rebuild-table') return [];
    return [`${UNRENDERED}${error instanceof Error ? error.message : String(error)}`];
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
  /** Re-introspect the touched tables, for the live-drift check. */
  reintrospect?: (tableIds: readonly string[]) => Promise<DatabaseModel | null>;
  /**
   * Re-introspect ONE table, for the SQLite rebuild's step 12 — the compare
   * that turns "it ran" into "it is what the plan promised".
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
  const { plan, desiredRelations } = await planWithRelations(input);

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

  // --- live drift: did the DATABASE move? -------------------------
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

  // --- the ledger row, BEFORE the first statement (D3) -------------
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
  const renamedApply = applyRenames(input.actual, input.edit.renames).model;
  const extendedApply = extendedTables(
    renamedApply,
    renamedApplyIds,
    input.edit,
    dbTypeForApply,
    input.dialect,
  );
  const desiredById = indexDesired(
    [
      ...input.edit.upsertTables.map((t) =>
        desiredTableToModel(
          { ...t, id: t.id === null ? null : (renamedApplyIds.get(t.id) ?? t.id) },
          { dbTypeFor: dbTypeForApply, defaultSchema },
        ),
      ),
      ...extendedApply.values(),
    ],
    input.edit,
    renamedApply,
  );
  const renameMap: Record<string, string> = Object.fromEntries(
    input.edit.renames.columns.map((r) => [r.from, r.to]),
  );
  const enumValuesFor = (tableId: string): Readonly<Record<string, readonly string[]>> => {
    const upserted = input.edit.upsertTables.find(
      (t) => (t.id ?? `${t.schema ?? defaultSchema}.${t.name}`) === tableId,
    );
    if (upserted !== undefined) return upserted.enumValues;
    // An extended table's value lists are its own CHECKs, as altered.
    const table = extendedApply.get(tableId);
    if (table === undefined) return {};
    const names = table.columns.map((c) => c.name);
    const out: Record<string, readonly string[]> = {};
    for (const check of table.checks) {
      const parsed = parseEnumCheck(check.expression, names);
      if (parsed !== null) out[parsed.column] = parsed.values;
    }
    return out;
  };

  // --- run ------------------------------------------------------------------
  const { db, dialect } = input;
  let failed: string | null = null;
  /**
   * Column renames that have ALREADY RUN in this apply, per table.
   *
   * A SQLite plan can hold both a `rename-column` step and a `rebuild-table`
   * step for the same table (rename a column and change a type in one edit).
   * The rename runs first — renames always do — so by the time the rebuild
   * copies rows, the column is under its NEW name. The rebuild used to be
   * handed the snapshot's table and told to copy the column FROM its old name,
   * and failed with "no such column". It now sees the table as it is.
   */
  const renamedInRun = new Map<string, Map<string, string>>();
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
          const snapshotTable = input.actual.tables.find((t) => t.id === step.table);
          const desiredTable = desiredById.get(step.table);
          if (snapshotTable === undefined || desiredTable === undefined) {
            throw new Error(`rebuild-table has no table to rebuild: ${step.table}`);
          }
          const done = renamedInRun.get(step.table) ?? new Map<string, string>();
          const actualTable =
            done.size === 0
              ? snapshotTable
              : {
                  ...snapshotTable,
                  columns: snapshotTable.columns.map((c) =>
                    done.has(c.name) ? { ...c, name: done.get(c.name) as string } : c,
                  ),
                };
          const pendingRenames = Object.fromEntries(
            Object.entries(renameMap).filter(([from]) => !done.has(from)),
          );
          await runSqliteRebuild({
            db,
            actual: actualTable,
            desired: desiredTable,
            columnMapping: rebuildColumnMapping(actualTable, desiredTable, pendingRenames),
            enumValues: enumValuesFor(step.table),
            foreignKeys: desiredRelations.filter(
              (r) => r.kind === 'declared-fk' && r.from.tableId === desiredTable.id,
            ),
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
          /*
           * Nor is a statement the compiler could not render. The preview shows
           * the reason as a SQL comment, and a comment RUNS — as nothing — so a
           * dropped CHECK whose re-add could not render was recorded as applied
           * with the constraint gone.
           */
          const unrendered = step.sql.find((text) => text.startsWith(UNRENDERED));
          if (unrendered !== undefined) throw new Error(unrendered.slice(3));
          for (const sqlText of step.sql) {
            await db.executeQuery({ sql: sqlText, parameters: [], query: { kind: 'RawNode' } } as never);
          }
        }
        outcomes[i] = { ...outcomes[i]!, outcome: 'succeeded', durationMs: Date.now() - startedAt };
        if (step.kind === 'rename-column' && step.column !== null && step.renameTo != null) {
          const forTable = renamedInRun.get(step.table) ?? new Map<string, string>();
          forTable.set(step.column, step.renameTo);
          renamedInRun.set(step.table, forTable);
        }
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
  const qualify = (from: string, to: string): string =>
    from.includes('.') ? `${from.slice(0, from.lastIndexOf('.'))}.${to}` : to;
  const tableRenames = succeededRenames.map((r) => ({ from: r.from, to: qualify(r.from, r.to) }));
  const newIdOf = (id: string): string => tableRenames.find((r) => r.from === id)?.to ?? id;
  // A `rename-column` step names the table by its NEW id and the column by
  // its OLD name; the edit's entry may name the table either way.
  const succeededColumnRenames = outcomes
    .filter((o) => o.kind === 'rename-column' && o.outcome === 'succeeded' && o.column !== null)
    .flatMap((o) => {
      const entry = input.edit.renames.columns.find(
        (r) => r.from === o.column && (r.table === o.table || newIdOf(r.table) === o.table),
      );
      return entry === undefined ? [] : [{ table: o.table, from: entry.from, to: entry.to }];
    });
  let repaired: RenameRepairResult | null = null;
  if (
    (tableRenames.length > 0 || succeededColumnRenames.length > 0) &&
    input.crypto !== undefined
  ) {
    repaired = await repairAfterRename({
      meta: input.meta,
      connectionId: input.connectionId,
      renames: tableRenames,
      columnRenames: succeededColumnRenames,
      crypto: input.crypto,
    });
  }

  /*
   * A table or column that is gone takes the override rows that described it
   * along: a rule, a label or a personal-data mark on something that no longer
   * exists is meaningless, and a later save of the whole override set refuses
   * any row naming an unknown table. Only for drops that SUCCEEDED.
   */
  const droppedTables = outcomes.filter((o) => o.kind === 'drop-table' && o.outcome === 'succeeded').map((o) => o.table);
  const droppedColumns = outcomes
    .filter((o) => o.kind === 'drop-column' && o.outcome === 'succeeded' && o.column !== null)
    .map((o) => ({ table: o.table, column: o.column as string }));
  if (droppedTables.length > 0 || droppedColumns.length > 0) {
    const overrides = overridesRepo(input.meta);
    for (const row of await overrides.listForConnection(input.connectionId)) {
      const gone =
        droppedTables.includes(row.tableName) ||
        (row.columnName !== null && droppedColumns.some((d) => d.table === row.tableName && d.column === row.columnName));
      if (gone) await overrides.delete(row.id);
    }
  }

  if (input.actual.dialect === 'mysql') await fillNowOnMysql(input, outcomes);

  return { changeId: change.id, status, steps: outcomes, error: failed, repaired };
}

/**
 * A time column given `now` on MySQL is made with no default (`renderDefault`:
 * it is a `DATETIME`, which Adminium reads on this server's clock, and the
 * database could only fill UTC's). So Adminium fills it on every create
 * instead — a `column.default` of its own beside each such column the change
 * made, or set to `now`. Only for steps that SUCCEEDED; a rule already there
 * is kept.
 */
export async function fillNowOnMysql(input: Pick<ApplyServiceInput, 'meta' | 'connectionId' | 'edit'>, outcomes: readonly StepOutcome[]): Promise<void> {
  const bare = (id: string): string => id.slice(id.lastIndexOf('.') + 1);
  const wanted = new Map<string, Set<string>>();
  const want = (table: string, column: { name: string; logicalType: string; default: { kind: string } | null }) => {
    if (column.default?.kind !== 'now' || (column.logicalType !== 'timestamp' && column.logicalType !== 'timestamptz')) return;
    const set = wanted.get(bare(table)) ?? new Set<string>();
    set.add(column.name);
    wanted.set(bare(table), set);
  };
  for (const table of input.edit.upsertTables) for (const column of table.columns) want(table.name, column);
  for (const added of input.edit.addColumns) want(added.table, added.column);
  if (wanted.size === 0) return;
  const overrides = overridesRepo(input.meta);
  const existing = await overrides.listForConnection(input.connectionId);
  for (const outcome of outcomes) {
    if (outcome.outcome !== 'succeeded') continue;
    const columns = wanted.get(bare(outcome.table));
    if (columns === undefined) continue;
    for (const column of outcome.column === null ? [...columns] : columns.has(outcome.column) ? [outcome.column] : []) {
      if (existing.some((row) => row.op === 'column.default' && row.tableName === outcome.table && row.columnName === column)) continue;
      const made = await overrides.create({ connectionId: input.connectionId, op: 'column.default', tableName: outcome.table, columnName: column, value: { kind: 'now' }, origin: 'auto' });
      existing.push(made);
    }
  }
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
