// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The planner.
 *
 * Desired state in, an ordered and hazard-classified `DdlPlan` out. Pure: no
 * connection, no Kysely, no SQL string. That is what lets all three dialects'
 * plans be golden-tested from one fixture set with no database in sight, and
 * it is why the executor (which needs a live `Kysely`) lives in the server.
 *
 * ─── Ordering is the part that is easy to get wrong ────────────────────────
 *
 * Creation order is a topological sort over foreign keys — `install-ddl.ts`
 * already implements exactly this at `:229-249`, and this is the same walk.
 * The DROP direction is its mirror and is the half that has never existed:
 * constraints before the columns they name, columns before the tables they
 * sit in, and referencing tables before referenced ones. Getting it backwards
 * does not produce a subtly wrong schema — it produces a statement the
 * database rejects, half way through a partial apply.
 *
 * ─── One subcommand per statement ──────────────────────────────────────────
 *
 * Postgres takes the STRICTEST lock any subcommand in an `ALTER TABLE` needs,
 * for the whole statement. So batching a rename (metadata) with a type change
 * (rewrite) makes the rename as expensive as the rewrite. Every step here is
 * one subcommand, and the executor emits one statement per step.
 */
import { z } from 'zod';

import type { DatabaseModel, Relation, TableModel } from '../schema-model.js';
import {
  diffTableDefinitions,
  isEmptyDefinitionDiff,
  type TableDefinitionDiff,
} from './diff-definitions.js';
import { enumCheckColumn } from './edit.js';
import type { AppliedRename } from './rename.js';
import {
  classifyStep,
  ddlStepSchema,
  refusalCodeSchema,
  requiresSuperAdmin,
  worseHazard,
  type DdlStep,
  type DdlStepKind,
  type Hazard,
  type HazardContext,
} from './steps.js';

export const refusalSchema = z.strictObject({
  code: refusalCodeSchema,
  message: z.string().min(1),
  table: z.string().nullable().default(null),
  column: z.string().nullable().default(null),
});
export type Refusal = z.infer<typeof refusalSchema>;

export const ddlPlanSchema = z.strictObject({
  steps: z.array(ddlStepSchema),
  refusals: z.array(refusalSchema),
  warnings: z.array(z.strictObject({ message: z.string().min(1), table: z.string().nullable().default(null) })),
  /** Worst hazard across every step — what the confirm dialog gates on. */
  hazard: z.enum(['safe', 'locking', 'rewrite', 'lossy', 'irreversible', 'refused']),
  requiresSuperAdmin: z.boolean(),
  /**
   * Stable digest of the plan's inputs and steps. `apply` sends it back and
   * the server refuses when it no longer matches (D2, `SCHEMA_DRIFT`).
   * Computed by the caller, which owns the hash function.
   */
  checksum: z.string().min(1),
});
export type DdlPlan = z.infer<typeof ddlPlanSchema>;

export interface PlanInput {
  /** The snapshot's model, with renames already pre-applied. */
  actual: DatabaseModel;
  /** The tables the edit wants, converted to IR (`desiredTableToModel`). */
  desired: readonly TableModel[];
  /** FKs the edit wants, per table id. */
  desiredRelations?: readonly Relation[];
  /** Table ids to drop. */
  dropTables?: readonly string[];
  /** Renames that resolved, from `applyRenames`. */
  renames?: readonly AppliedRename[];
  dialect: HazardContext['dialect'];
  serverVersion: string | null;
  isMariaDb?: boolean;
  /**
   * `(tableId) => true` when the table is known to hold rows. Preflight fills
   * this from capped exact counts; unknown (`null`) is treated as "yes".
   */
  tableHasRows?: (tableId: string) => boolean | null;
}

let stepCounter = 0;
/** Deterministic within a plan: ordinal, not random (plans are hashed). */
function nextId(kind: DdlStepKind): string {
  stepCounter += 1;
  return `${kind}-${stepCounter}`;
}

function make(
  kind: DdlStepKind,
  table: string,
  ctx: HazardContext,
  opts: {
    column?: string | null;
    /** The constraint's name as the database spells it, when there is one. */
    constraint?: string | null;
    summary: string;
    detail?: Parameters<typeof classifyStep>[2];
    dependsOn?: string[];
    outsideTransaction?: boolean;
    /** `rename-column`: the new name. */
    renameTo?: string | null;
  },
): { step: DdlStep; needsRebuild: boolean } {
  const verdict = classifyStep(kind, ctx, opts.detail);
  const step: DdlStep = {
    id: nextId(kind),
    kind,
    table,
    column: opts.column ?? null,
    constraint: opts.constraint ?? null,
    hazard: verdict.hazard,
    requiresSuperAdmin: requiresSuperAdmin(verdict.hazard),
    summary: opts.summary,
    rationale: verdict.rationale,
    consequences: [],
    dependsOn: opts.dependsOn ?? [],
    outsideTransaction: opts.outsideTransaction ?? false,
    refusal: verdict.refusal ?? null,
    renameTo: opts.renameTo ?? null,
  };
  return { step, needsRebuild: verdict.needsRebuild === true };
}

/**
 * Topological order over the FKs an edit creates — `install-ddl.ts:229-249`'s
 * walk, kept identical including its ruling on cycles: two tables referencing
 * each other is legal in every dialect that supports post-hoc constraints, and
 * refusing it here would refuse a schema the operator could write by hand.
 */
function creationOrder(tables: readonly TableModel[], relations: readonly Relation[]): TableModel[] {
  const byId = new Map(tables.map((t) => [t.id, t]));
  const fksOf = new Map<string, string[]>();
  for (const r of relations) {
    if (r.kind !== 'declared-fk') continue;
    const list = fksOf.get(r.from.tableId) ?? [];
    list.push(r.to.tableId);
    fksOf.set(r.from.tableId, list);
  }
  const emitted = new Set<string>();
  const order: TableModel[] = [];
  const visit = (table: TableModel, seen: Set<string>): void => {
    if (emitted.has(table.id) || seen.has(table.id)) return;
    seen.add(table.id);
    for (const targetId of fksOf.get(table.id) ?? []) {
      const target = byId.get(targetId);
      if (target !== undefined) visit(target, seen);
    }
    if (emitted.has(table.id)) return;
    emitted.add(table.id);
    order.push(table);
  };
  for (const t of tables) visit(t, new Set());
  return order;
}

/** The drop direction: referencing tables before the tables they reference. */
function dropOrder(ids: readonly string[], relations: readonly Relation[]): string[] {
  const set = new Set(ids);
  const referencedBy = new Map<string, string[]>();
  for (const r of relations) {
    if (r.kind !== 'declared-fk') continue;
    if (!set.has(r.to.tableId)) continue;
    const list = referencedBy.get(r.to.tableId) ?? [];
    if (set.has(r.from.tableId)) list.push(r.from.tableId);
    referencedBy.set(r.to.tableId, list);
  }
  const emitted = new Set<string>();
  const order: string[] = [];
  const visit = (id: string, seen: Set<string>): void => {
    if (emitted.has(id) || seen.has(id)) return;
    seen.add(id);
    for (const dependent of referencedBy.get(id) ?? []) visit(dependent, seen);
    if (emitted.has(id)) return;
    emitted.add(id);
    order.push(id);
  };
  for (const id of ids) visit(id, new Set());
  return order;
}

/**
 * Build the plan.
 *
 * `checksum` is left as the empty string here and filled by the caller — the
 * engine has no hash primitive it wants to own, and `snapshot/hash.ts`'s
 * `sha256Hex` is the server's to apply over the canonical JSON.
 */
export function planDdl(input: PlanInput): Omit<DdlPlan, 'checksum'> {
  stepCounter = 0;
  const steps: DdlStep[] = [];
  const refusals: Refusal[] = [];
  const warnings: { message: string; table: string | null }[] = [];
  const desiredRelations = input.desiredRelations ?? [];
  const actualByIdRaw = new Map(input.actual.tables.map((t) => [t.id, t]));
  const hasRows = input.tableHasRows ?? (() => null);

  const ctxFor = (tableId: string): HazardContext => ({
    dialect: input.dialect,
    serverVersion: input.serverVersion,
    tableHasRows: hasRows(tableId),
    ...(input.isMariaDb === undefined ? {} : { isMariaDb: input.isMariaDb }),
  });

  const push = (made: { step: DdlStep; needsRebuild: boolean }): DdlStep => {
    if (made.step.refusal !== null) {
      refusals.push({
        code: made.step.refusal,
        message: made.step.rationale,
        table: made.step.table,
        column: made.step.column,
      });
    }
    steps.push(made.step);
    return made.step;
  };

  // --- 1. renames first ----------------------------------------------------
  // A rename must precede every other step on that table, because every later
  // step names the table by its NEW name (the diff ran on the renamed model).
  for (const rename of input.renames ?? []) {
    const ctx = ctxFor(rename.newTableId);
    if (rename.kind === 'table') {
      push(
        make('rename-table', rename.tableId, ctx, {
          summary: `Rename ${rename.from} to ${rename.to}`,
        }),
      );
    } else {
      push(
        make('rename-column', rename.newTableId, ctx, {
          column: rename.from,
          renameTo: rename.to,
          summary: `Rename ${rename.from} to ${rename.to} on ${rename.newTableId}`,
        }),
      );
    }
  }

  /** `public.clients` → `clients` — what a summary should say out loud. */
  const bareTableName = (id: string): string => id.slice(id.lastIndexOf('.') + 1);

  // --- 2. creates, in dependency order -------------------------------------
  //
  // A new table's foreign keys are part of its CREATE, not steps of their own.
  //
  // They were separate `add-fk` steps once, and the review argument for that was
  // good — "Link client_id to clients(id)" is the thing the operator clicked and
  // it deserves its own line. It was also wrong on the engine Adminium ships on
  // the desktop: SQLite has no `ALTER TABLE … ADD CONSTRAINT` at all, so every
  // new table with a link applied HALF — the table created, the constraint a
  // syntax error, the change reported `partial`. Its only other route is the
  // 12-step rebuild, and rebuilding a table created two statements ago to
  // add a constraint that could have been in the CREATE is not a design.
  //
  // Nothing is lost by inlining. A table being created is empty, so its FK is
  // `safe` on all three dialects — none of `add-fk`'s interesting hazards (the
  // full scan, postgres's `NOT VALID` + validate) can apply to zero rows. The
  // review still shows the constraint, because D2 makes the SQL the preview and
  // the `FOREIGN KEY` clause is in it; the summary names the links as well.
  //
  // The earlier bug this replaces was worse and must not come back: a
  // `foreignKeys` entry on a new table was accepted by the route, validated by
  // the coherence checks, and then never planned at all — the table created
  // without the constraint and nothing said so.
  const creates = input.desired.filter((t) => !actualByIdRaw.has(t.id));
  for (const table of creationOrder(creates, desiredRelations)) {
    const links = desiredRelations.filter((r) => r.from.tableId === table.id);
    const columns = `${table.columns.length} column${table.columns.length === 1 ? '' : 's'}`;
    const linkText =
      links.length === 0
        ? ''
        : `, linked to ${links.map((r) => bareTableName(r.to.tableId)).join(', ')}`;
    push(
      make('create-table', table.id, ctxFor(table.id), {
        summary: `Create table ${table.name} with ${columns}${linkText}`,
      }),
    );
  }

  // --- 3. alters -----------------------------------------------------------
  for (const desired of input.desired) {
    const actual = actualByIdRaw.get(desired.id);
    if (actual === undefined) continue; // handled as a create
    const diff = diffTableDefinitions(actual, desired, {
      actualFks: input.actual.relations.filter(
        (r) => r.kind === 'declared-fk' && r.from.tableId === desired.id,
      ),
      desiredFks: desiredRelations.filter((r) => r.from.tableId === desired.id),
    });
    if (isEmptyDefinitionDiff(diff)) continue;
    planAlters(diff, actual, desired, ctxFor(desired.id), push, warnings);
  }

  // --- 4. drops, in the mirror order ---------------------------------------
  for (const id of dropOrder(input.dropTables ?? [], input.actual.relations)) {
    const table = actualByIdRaw.get(id);
    push(
      make('drop-table', id, ctxFor(id), {
        summary: `Drop table ${table?.name ?? id} and all of its data`,
      }),
    );
  }

  const hazard = steps.reduce<Hazard>((worst, s) => worseHazard(worst, s.hazard), 'safe');
  return {
    steps,
    refusals,
    warnings,
    hazard,
    requiresSuperAdmin: steps.some((s) => s.requiresSuperAdmin),
  };
}

/**
 * Emit the steps for one table's definition diff, in an order the database
 * will accept: drop constraints, then columns, then change what remains, then
 * add columns, then add constraints. Adding a constraint before the column it
 * names is the classic partial-apply failure.
 */
function planAlters(
  diff: TableDefinitionDiff,
  actual: TableModel,
  desired: TableModel,
  ctx: HazardContext,
  push: (made: { step: DdlStep; needsRebuild: boolean }) => DdlStep,
  warnings: { message: string; table: string | null }[],
): void {
  const id = diff.tableId;
  const lite = ctx.dialect === 'sqlite';

  /**
   * On SQLite, any step the classifier marks `needsRebuild` collapses into ONE
   * `rebuild-table` step for the whole table — running four rebuilds for four
   * changed columns would copy the table four times.
   */
  let rebuildNeeded = false;
  const emit = (made: { step: DdlStep; needsRebuild: boolean }): void => {
    if (lite && made.needsRebuild) {
      rebuildNeeded = true;
      return;
    }
    push(made);
  };

  // --- drops (constraints, then columns) -----------------------------------
  for (const fk of diff.fksRemoved) {
    emit(
      make('drop-fk', id, ctx, {
        summary: `Drop foreign key ${fk.constraintName ?? fk.columns.join(', ')} → ${fk.toTable}`,
      }),
    );
  }
  for (const u of diff.uniquesRemoved) {
    emit(make('drop-unique', id, ctx, { summary: `Drop unique constraint on ${u.columns.join(', ')}` }));
  }
  for (const c of diff.checksRemoved) {
    emit(
      make('drop-check', id, ctx, {
        column: enumCheckColumn(c.expression, actual.columns.map((col) => col.name)),
        constraint: c.name,
        summary: `Drop check constraint ${c.name ?? c.expression}`,
      }),
    );
  }
  for (const i of diff.indexesRemoved) {
    emit(make('drop-index', id, ctx, { summary: `Drop index ${i.name ?? i.columns.join(', ')}` }));
  }
  if (diff.pkChanged !== null && diff.pkChanged.from.length > 0) {
    emit(make('drop-pk', id, ctx, { summary: `Drop primary key (${diff.pkChanged.from.join(', ')})` }));
  }
  for (const name of diff.removedColumns) {
    emit(make('drop-column', id, ctx, { column: name, summary: `Drop column ${name} and its data` }));
  }

  // --- column changes ------------------------------------------------------
  for (const change of diff.changedColumns) {
    if (change.typeChanged !== null) {
      emit(
        make('alter-column-type', id, ctx, {
          column: change.column,
          summary: `Change ${change.column} from ${change.typeChanged.from.logicalType} to ${change.typeChanged.to.logicalType}`,
          detail: { typeFrom: change.typeChanged.from, typeTo: change.typeChanged.to },
        }),
      );
    }
    if (change.nullabilityChanged !== null) {
      emit(
        make(change.nullabilityChanged.nowNullable ? 'drop-not-null' : 'set-not-null', id, ctx, {
          column: change.column,
          summary: change.nullabilityChanged.nowNullable
            ? `Allow NULL in ${change.column}`
            : `Require a value in ${change.column}`,
        }),
      );
    }
    if (change.defaultChanged !== null) {
      /*
       * Auto-increment is NOT a default (D23). It is an identity sequence on
       * postgres, a column attribute on MySQL and the rowid alias on SQLite, so
       * it gets its own two step kinds — and a change FROM auto-increment TO a
       * real default is both of them, in that order, because the identity has
       * to be detached before the column will accept one (postgres refuses
       * `DROP DEFAULT` on an identity column by name).
       */
      // `defaultChanged` carries RENDERED defaults (`diff-definitions.ts:149`),
      // so the kind is the string itself — `'autoincrement'`, `'now'`,
      // `'literal:0'`. Reading `.kind` off it compiled, matched nothing, and
      // left every identity change planned as the `set-default` that throws.
      const wasIdentity = change.defaultChanged.from === 'autoincrement';
      const wantsIdentity = change.defaultChanged.to === 'autoincrement';
      if (wasIdentity && !wantsIdentity) {
        emit(
          make('drop-identity', id, ctx, {
            column: change.column,
            summary: `Stop generating ${change.column} automatically`,
          }),
        );
      }
      if (wantsIdentity && !wasIdentity) {
        emit(
          make('set-identity', id, ctx, {
            column: change.column,
            summary: `Generate ${change.column} automatically`,
          }),
        );
      } else if (change.defaultChanged.to !== null && !wantsIdentity) {
        emit(
          make('set-default', id, ctx, {
            column: change.column,
            summary: `Set the default on ${change.column}`,
          }),
        );
      } else if (change.defaultChanged.to === null && !wasIdentity) {
        // `drop-identity` already removed it; a second `drop-default` would be
        // a no-op on postgres and another whole-table copy on MySQL.
        emit(
          make('drop-default', id, ctx, {
            column: change.column,
            summary: `Remove the default on ${change.column}`,
          }),
        );
      }
    }
    if (change.commentChanged !== null) {
      emit(make('set-comment', id, ctx, { column: change.column, summary: `Update the comment on ${change.column}` }));
    }
  }

  // --- adds (columns, then constraints) ------------------------------------
  const lastColumnName = desired.columns[desired.columns.length - 1]?.name;
  for (const name of diff.addedColumns) {
    const column = desired.columns.find((c) => c.name === name);
    emit(
      make('add-column', id, ctx, {
        column: name,
        summary: `Add column ${name}${column === undefined ? '' : ` (${column.dbType})`}`,
        detail: {
          columnNullable: column?.nullable ?? true,
          hasDefault: (column?.default ?? null) !== null,
          isLastPosition: name === lastColumnName,
        },
      }),
    );
  }
  if (diff.pkChanged !== null && diff.pkChanged.to.length > 0) {
    emit(make('set-pk', id, ctx, { summary: `Set the primary key to (${diff.pkChanged.to.join(', ')})` }));
  }
  for (const u of diff.uniquesAdded) {
    emit(make('add-unique', id, ctx, { summary: `Require ${u.columns.join(', ')} to be unique` }));
  }
  for (const c of diff.checksAdded) {
    const column = enumCheckColumn(c.expression, desired.columns.map((col) => col.name));
    emit(
      make('add-check', id, ctx, {
        column,
        constraint: c.name,
        summary:
          column === null
            ? `Restrict values with ${c.name ?? 'a check constraint'}`
            : `Restrict ${column} to its allowed values`,
      }),
    );
  }
  for (const i of diff.indexesAdded) {
    emit(make('add-index', id, ctx, { summary: `Index ${i.columns.join(', ')}` }));
  }
  for (const fk of diff.fksAdded) {
    emit(
      make('add-fk', id, ctx, {
        column: fk.columns[0] ?? null,
        summary: `Link ${fk.columns.join(', ')} to ${fk.toTable}(${fk.toColumns.join(', ')})`,
      }),
    );
  }
  for (const change of diff.fksActionsChanged) {
    // A referential-action change has no ALTER form anywhere: the constraint is
    // dropped and re-added. Two steps, so the review shows what really happens.
    emit(
      make('drop-fk', id, ctx, {
        summary: `Drop foreign key ${change.from.constraintName ?? change.from.columns.join(', ')} to change its rules`,
      }),
    );
    emit(
      make('add-fk', id, ctx, {
        summary: `Re-add the foreign key to ${change.to.toTable} with ON DELETE ${change.to.onDelete ?? 'NO ACTION'}`,
      }),
    );
  }
  if (diff.commentChanged !== null) {
    emit(make('set-table-comment', id, ctx, { summary: `Update the comment on ${actual.name}` }));
  }

  if (rebuildNeeded) {
    push(
      make('rebuild-table', id, ctx, {
        summary: `Rebuild ${actual.name}: SQLite cannot express these changes as ALTER statements`,
      }),
    );
    warnings.push({
      message:
        `${actual.name} is rebuilt rather than altered. Every row is copied, and indexes and triggers ` +
        'are recreated afterwards.',
      table: id,
    });
  }
}
