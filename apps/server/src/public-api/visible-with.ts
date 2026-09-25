// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Rows only as visible as their parent: a resource that says `visibleWith`
 * reaches a row only where its PARENT resource, in the same scope and for the
 * same session, reaches the row it belongs to — a draft's lines stay as hidden
 * as the draft, an unshared deliverable's versions as hidden as it.
 *
 * ── WHY AN EXISTS, AND NEVER A COPIED COLUMN ────────────────────────────────
 * Child tables often carry the person's key too (`client_id` on a line), for
 * the desk's convenience. It is not an authority: a staff edit, an import or a
 * copy rule can put any value there, and the child's own row says nothing
 * about the parent's state. So a child is filtered by an EXISTS over the
 * parent's WHOLE compiled scope — its claim, its conditions (fixed and
 * calendar), and, when the parent is itself a child, ITS parent in turn. Two
 * steps at most (`scope.ts` refuses more). The link runs either way:
 * `localColumn` of the child equals `foreignColumn` of the parent, which is
 * the child's key to the parent or the parent's key to the child
 * (a proposal points at the terms version it was sent with).
 *
 * ── HOW IT REACHES THE LIST ────────────────────────────────────────────────
 * The list and the one-row read are `runList`, whose mandatory predicate is a
 * single-table filter. The EXISTS reaches it through the database handle
 * instead: a plugin that ANDs it into the WHERE of the one statement the list
 * runs — a SELECT from the child's own table — and refuses any other
 * statement outright. A read that became something else would fail closed,
 * never read unscoped.
 *
 * ── WHAT A CREATE PROVES ───────────────────────────────────────────────────
 * A child entry may create (a client's note on a deliverable). Every foreign
 * key the new row carries must name a row this key's session can READ,
 * through the resources on that table — the parent by its whole scope — and
 * when the row points at a table twice over (a note's version and its
 * deliverable), the two must agree: the version must belong to that
 * deliverable. Checked inside the write's own transaction, with the
 * referenced row held for share, so a parent withdrawn at the same moment is
 * either seen withdrawn or stays as it was until the note is in.
 */
import {
  QueryNode,
  SelectQueryNode,
  sql,
  type Expression,
  type Kysely,
  type KyselyPlugin,
  type OperationNode,
  type PluginTransformQueryArgs,
  type PluginTransformResultArgs,
  type QueryResult,
  type RootOperationNode,
  type SqlBool,
  type UnknownRow,
} from 'kysely';

import type { Dialect } from '@adminium/engine';

import type { SourceDatabase } from '../connections/manager.js';
import { compileFilter, type RecordFilter } from '../crud/filters.js';
import type { ResolvedTable, SnapshotView } from '../crud/identifiers.js';
import { claimPredicateFor, combinePredicates, type PublicSessionContext } from './claim.js';
import { mandatoryAt } from './relative-filters.js';
import { VISIBLE_WITH_MAX_STEPS, type CompiledResource, type CompiledScope, type VisibleWith } from './scope.js';

/** The parent a resource's rows are visible with, or null — absent reads as none. */
export function parentOf(resource: Pick<CompiledResource, 'visibleWith'>): VisibleWith | null {
  return resource.visibleWith ?? null;
}

/** One step up: the parent, its table, and everything it narrows its own rows by. */
export interface VisibilityStep {
  link: VisibleWith;
  parent: CompiledResource;
  table: ResolvedTable;
  /** The parent's mandatory filter and its claim, for this session, now. */
  predicate: RecordFilter | null;
}

/** Whether a resource's rows can be reached at all, and the steps an EXISTS walks when they can. */
export type Visibility = { reachable: false } | { reachable: true; steps: readonly VisibilityStep[] };

const UNREACHABLE: Visibility = { reachable: false };

/**
 * What a session reaches of `resource` through its parents. A resource with
 * no `visibleWith` answers with no steps (its own claim is the caller's
 * business). A child answers unreachable — the one 404 — when there is no
 * session, or any parent is missing, cannot be read, needs a level the
 * session lacks, or belongs to another identity.
 */
export function visibilityOf(input: {
  scope: CompiledScope;
  resource: CompiledResource;
  session: PublicSessionContext | null;
  view: SnapshotView;
  now?: Date;
}): Visibility {
  const { scope, session, view } = input;
  if (parentOf(input.resource) === null) return { reachable: true, steps: [] };
  if (session === null) return UNREACHABLE;
  const steps: VisibilityStep[] = [];
  let at = input.resource;
  const seen = new Set<string>([at.ref]);
  for (let link = parentOf(at); link !== null; link = parentOf(at)) {
    if (steps.length >= VISIBLE_WITH_MAX_STEPS) return UNREACHABLE;
    const parent = scope.byRef.get(link.ref);
    if (parent === undefined || seen.has(parent.ref) || !parent.actions.has('read') || parent.kind !== 'records') return UNREACHABLE;
    seen.add(parent.ref);
    if (parent.level === 'verified' && session.level !== 'verified') return UNREACHABLE;
    // A parent's own `claim` (a person's rows), or none when it is a child in turn.
    const claim = claimPredicateFor(parent, session);
    if (!claim.reachable) return UNREACHABLE;
    let table: ResolvedTable;
    try {
      table = view.table(parent.table);
    } catch {
      return UNREACHABLE;
    }
    steps.push({ link, parent, table, predicate: combinePredicates(mandatoryAt(parent.where, table, scope.timezone, input.now), claim.predicate) });
    at = parent;
  }
  // The chain ends on a resource a person claims — never on one open to anyone.
  if (at.claim === null || at.claim.optional === true) return UNREACHABLE;
  return { reachable: true, steps };
}

interface BuildContext {
  db: Kysely<SourceDatabase>;
  dialect: Dialect;
  view: SnapshotView;
}

/**
 * The EXISTS a row of the table known as `outer` passes when its parent chain
 * is visible: one correlated subquery per step, each parent aliased so a
 * child and a parent on the same table never read each other's columns. The
 * parent's own predicate is compiled at its own level, where an unqualified
 * column is the parent's.
 */
export function visibleCondition(ctx: BuildContext, outer: string, steps: readonly VisibilityStep[], depth = 0): Expression<SqlBool> {
  const [step, ...rest] = steps;
  if (step === undefined) return sql<SqlBool>`1 = 1`;
  const alias = `adm_vw${String(depth)}`;
  let sub = ctx.db
    .selectFrom(`${step.table.id} as ${alias}` as never)
    .select(sql.lit(1).as('one'))
    .where(sql.ref(`${alias}.${step.link.foreignColumn}`), '=', sql.ref(`${outer}.${step.link.localColumn}`));
  const predicate = step.predicate;
  if (predicate !== null) {
    // The server's own predicate: a masked column in it is still compared.
    const filterCtx = { view: ctx.view, table: step.table, canReadPii: true, dynamic: ctx.db.dynamic, dialect: ctx.dialect };
    sub = sub.where((eb) => compileFilter(eb as never, filterCtx, predicate));
  }
  if (rest.length > 0) sub = sub.where(visibleCondition(ctx, alias, rest, depth + 1));
  return sql<SqlBool>`exists ${sub}`;
}

/**
 * ANDs one condition into the single SELECT a scoped read runs on its table,
 * and refuses every other statement: a read through this handle that is not
 * that SELECT would be a read nobody scoped.
 */
class VisibleRowsOnly implements KyselyPlugin {
  readonly #from: string;
  readonly #condition: OperationNode;

  constructor(from: OperationNode, condition: OperationNode) {
    this.#from = JSON.stringify(from);
    this.#condition = condition;
  }

  transformQuery(args: PluginTransformQueryArgs): RootOperationNode {
    const node = args.node;
    const froms = SelectQueryNode.is(node) ? (node.from?.froms ?? []) : [];
    if (!SelectQueryNode.is(node) || froms.length !== 1 || JSON.stringify(froms[0]) !== this.#from) {
      throw new Error('a read of rows visible with a parent runs one SELECT on its own table');
    }
    return QueryNode.cloneWithWhere(node, this.#condition);
  }

  transformResult(args: PluginTransformResultArgs): Promise<QueryResult<UnknownRow>> {
    return Promise.resolve(args.result);
  }
}

/**
 * The handle a list or a one-row read of `table` runs on: the database as it
 * is when the resource has no parent, else one whose every SELECT on the
 * table carries the parent chain's EXISTS.
 */
export function readerFor(ctx: BuildContext, table: ResolvedTable, visibility: Visibility & { reachable: true }): Kysely<SourceDatabase> {
  if (visibility.steps.length === 0) return ctx.db;
  const from = ctx.db.selectFrom(table.id as never).toOperationNode().from?.froms[0];
  if (from === undefined) throw new Error('a table with no name cannot be read');
  const condition = visibleCondition(ctx, table.name, visibility.steps).toOperationNode();
  return ctx.db.withPlugin(new VisibleRowsOnly(from, condition));
}

/* ------------------------------------------------------------ the create */

/** A value that names nothing: no reference to check. */
const absent = (value: unknown): boolean => value === null || value === undefined;

/**
 * Whether every reference a child's new row makes is one this session may
 * make — run on the write's own transaction (`db`), before the INSERT and
 * again after any before hook changed the values.
 *
 * - The link to the parent must be there: a child with no parent would be
 *   visible to nobody, its maker included.
 * - A value the caller sent for a column pointing at the identity's own table
 *   (a denormalised `client_id`) is refused: that column is the desk's, and
 *   the parent's own copy rule fills it.
 * - Every foreign key present names a row that at least one of this key's
 *   read resources on that table shows this session, by its whole scope —
 *   and a table the key does not read at all is refused.
 * - Where the referenced row is visible with a parent it points at, and the
 *   new row names that parent too, the two agree.
 */
export async function referencesAllowed(input: {
  db: Kysely<SourceDatabase>;
  dialect: Dialect;
  view: SnapshotView;
  scope: CompiledScope;
  session: PublicSessionContext | null;
  resource: CompiledResource;
  table: ResolvedTable;
  values: Readonly<Record<string, unknown>>;
  /** The columns the caller sent, before the server's own defaults. */
  supplied: ReadonlySet<string>;
  now?: Date;
}): Promise<boolean> {
  const { db, dialect, view, scope, session, resource, table, values } = input;
  const link = parentOf(resource);
  if (link === null || session === null) return false;
  if (absent(values[link.localColumn])) return false;

  /*
   * The link to the parent first, and against the parent the child declares
   * alone — never another reader of that table (a public portfolio would
   * otherwise let a note be made under anyone's work), and whether or not
   * the database knows the column as a foreign key.
   */
  const declared = scope.byRef.get(link.ref);
  if (declared === undefined) return false;
  const parentTable = view.linkTable(tableIdOf(view, declared.table) ?? '');
  if (parentTable === null) return false;
  const parentVisibility = visibilityOf({ scope, resource: declared, session, view, ...(input.now === undefined ? {} : { now: input.now }) });
  if (!parentVisibility.reachable || (declared.level === 'verified' && session.level !== 'verified')) return false;
  const parentClaim = claimPredicateFor(declared, session);
  if (!parentClaim.reachable) return false;
  {
    const alias = 'adm_parent';
    let query = db
      .selectFrom(`${parentTable.id} as ${alias}` as never)
      .select(sql.lit(1).as('one'))
      .where(sql.ref(`${alias}.${link.foreignColumn}`), '=', values[link.localColumn] as never);
    const predicate = combinePredicates(mandatoryAt(declared.where, parentTable, scope.timezone, input.now), parentClaim.predicate);
    if (predicate !== null) {
      const filterCtx = { view, table: parentTable, canReadPii: true, dynamic: db.dynamic, dialect };
      query = query.where((eb) => compileFilter(eb as never, filterCtx, predicate));
    }
    if (parentVisibility.steps.length > 0) query = query.where(visibleCondition({ db, dialect, view }, alias, parentVisibility.steps));
    // Held for share where the database can: a parent withdrawn now waits for this row.
    const held = dialect === 'sqlite' ? query.limit(1) : query.limit(1).forShare();
    if ((await held.executeTakeFirst()) === undefined) return false;
  }

  const identity = scope.claim?.ref === undefined ? undefined : scope.byRef.get(scope.claim.ref);
  const identityTable = identity === undefined ? null : tableIdOf(view, identity.table);
  // The link itself is checked above, against its own parent only.
  const outgoing = view.model.relations.filter(
    (relation) => relation.through === null && relation.from.tableId === table.id && !(relation.from.columns.length === 1 && relation.from.columns[0] === link.localColumn),
  );
  // What the row points at directly, one column to one column: the other side of a diamond.
  const direct = view.model.relations.filter((relation) => relation.through === null && relation.from.tableId === table.id).flatMap((relation) =>
    relation.from.columns.length === 1 && relation.to.columns.length === 1 && !absent(values[relation.from.columns[0] as string])
      ? [{ column: relation.from.columns[0] as string, table: relation.to.tableId, to: relation.to.columns[0] as string, value: values[relation.from.columns[0] as string] }]
      : [],
  );

  for (const relation of outgoing) {
    const columns = relation.from.columns;
    if (columns.some((column) => absent(values[column]))) continue;
    if (identityTable !== null && relation.to.tableId === identityTable && columns.some((column) => input.supplied.has(column))) return false;
    const target = view.linkTable(relation.to.tableId);
    if (target === null) return false;
    const readers = [...scope.byRef.values()].filter(
      (candidate) => candidate.kind === 'records' && candidate.actions.has('read') && tableIdOf(view, candidate.table) === target.id,
    );
    if (readers.length === 0) return false;

    let reached = false;
    for (const reader of readers) {
      /*
       * A diamond: the referenced row is visible with a parent it points at,
       * and the new row names that parent too. They must be one row — a note
       * on deliverable 7 may not name a version of deliverable 8, even one
       * this person can see.
       */
      const agree: { column: string; value: unknown }[] = [];
      const up = parentOf(reader);
      const upTable = up === null ? null : tableIdOf(view, scope.byRef.get(up.ref)?.table ?? '');
      if (up !== null && upTable !== null) {
        const pointsUp = view.model.relations.some(
          (onward) =>
            onward.through === null &&
            onward.from.tableId === target.id &&
            onward.to.tableId === upTable &&
            onward.from.columns.length === 1 &&
            onward.from.columns[0] === up.localColumn &&
            onward.to.columns[0] === up.foreignColumn,
        );
        for (const mine of pointsUp ? direct : []) {
          if (mine.table !== upTable || mine.to !== up.foreignColumn || columns.includes(mine.column)) continue;
          agree.push({ column: up.localColumn, value: mine.value });
        }
      }
      const visibility = visibilityOf({ scope, resource: reader, session, view, ...(input.now === undefined ? {} : { now: input.now }) });
      if (!visibility.reachable) continue;
      if (reader.level === 'verified' && session.level !== 'verified') continue;
      const claim = claimPredicateFor(reader, session);
      if (!claim.reachable) continue;
      const predicate = combinePredicates(mandatoryAt(reader.where, target, scope.timezone, input.now), claim.predicate);
      const alias = 'adm_ref';
      let query = db.selectFrom(`${target.id} as ${alias}` as never).select(sql.lit(1).as('one'));
      relation.to.columns.forEach((column, i) => {
        query = query.where(sql.ref(`${alias}.${column}`), '=', values[columns[i] as string] as never);
      });
      for (const pair of agree) query = query.where(sql.ref(`${alias}.${pair.column}`), '=', pair.value as never);
      if (predicate !== null) {
        const filterCtx = { view, table: target, canReadPii: true, dynamic: db.dynamic, dialect };
        query = query.where((eb) => compileFilter(eb as never, filterCtx, predicate));
      }
      if (visibility.steps.length > 0) query = query.where(visibleCondition({ db, dialect, view }, alias, visibility.steps));
      // Held for share where the database can: a parent withdrawn now waits for this row.
      const held = dialect === 'sqlite' ? query.limit(1) : query.limit(1).forShare();
      if ((await held.executeTakeFirst()) !== undefined) {
        reached = true;
        break;
      }
    }
    if (!reached) return false;
  }
  return true;
}

/** A resource's table as the snapshot knows it, or null when it is gone. */
function tableIdOf(view: SnapshotView, table: string): string | null {
  try {
    return view.table(table).id;
  } catch {
    return view.linkTable(table)?.id ?? null;
  }
}
