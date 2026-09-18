// SPDX-License-Identifier: AGPL-3.0-only
/**
 * LINK TABLES: the several-references field, resolved and judged.
 *
 * A many-to-many relation is an edge held up by a third table — `booking_id`
 * and `service_id` in `booking_services` — and a field over it writes ROWS of
 * that table rather than a column of this one. Everything here answers the two
 * questions that has to answer before a single row is written:
 *
 *   1. **Which table, which two columns, and which way round?** A relation's
 *      `from.columns` are the TARGET table's key columns; `through.fromColumns`
 *      are the link table's own. Read the pair backwards and the field writes
 *      correct-looking rows into the wrong column. {@link resolveLink} decides
 *      it once, from the side being edited.
 *   2. **May this relation be a field at all?** {@link linkableRefusal} answers
 *      with the REASON, because a field that silently disappears is a feature
 *      nobody can debug. The refusals are listed on the function.
 *
 * What is NOT here: the writes themselves. They live in the data route, inside
 * the transaction that writes the parent, because the announcement (undo token,
 * audit, realtime) must not fire for a write that can still roll back.
 */

import type { ColumnModel } from '@adminium/engine';

import type { EffectiveModel, EffectiveRelation } from '../connections/effective-schema.js';
import { tableRulesFor } from './column-rules.js';
import type { ResolvedTable, SnapshotView } from './identifiers.js';

/**
 * The bar every other consumer of an inferred relation uses
 * (`classify/`, `generate/`). A 0.8 join held up by a 0.75 inferred foreign key
 * lands at 0.75, and a guess nothing else trusts must not become a writable
 * field.
 */
export const LINKABLE_CONFIDENCE = 0.8;

export interface ResolvedLink {
  relationId: string;
  /** The join table. Addressable or not — a hidden one still links. */
  linkTable: ResolvedTable;
  /** The link column pointing at the record being edited. */
  ownColumn: string;
  /** The key column of the record's own table that it points at. */
  ownKeyColumn: string;
  /** The link column pointing at the target. */
  targetColumn: string;
  /** The key column of the target that it points at. */
  targetKeyColumn: string;
  /** The table whose records this field picks. */
  target: ResolvedTable;
  /** Both sides are the same table (`related_products`). */
  selfReferential: boolean;
}

/** Why this relation cannot be a field, in the operator's words. */
export interface LinkRefusal {
  reason: string;
}

export type LinkResolution = { ok: true; link: ResolvedLink } | { ok: false; refusal: LinkRefusal };

function relationOf(model: EffectiveModel, relationId: string): EffectiveRelation | undefined {
  return model.relations.find((relation) => relation.id === relationId);
}

/**
 * Whether this column is filled by something other than the person.
 *
 * The same question `columnFacts` asks for a form field, and for the same
 * reason: a link table carrying `created_at DEFAULT now()` or an identity id is
 * perfectly linkable, and refusing it would rule out most of the join tables
 * that were made by a framework.
 */
function isFilled(view: SnapshotView, table: ResolvedTable, column: ColumnModel): boolean {
  if (column.default !== null || column.isGenerated) return true;
  const rules = tableRulesFor({ view, table });
  const fill = rules?.fills.find((candidate) => candidate.column === column.name);
  return fill !== undefined && fill.kind !== 'none';
}

/**
 * The reason this relation cannot be offered as a field, or null.
 *
 * It refuses when:
 *
 * - it is not a many-to-many edge, or its confidence is below the bar every
 *   other consumer of an inferred relation uses;
 * - either side spans more than one column (a composite key through a join
 *   table is a shape the picker cannot address with one value);
 * - the join table is Adminium's own (`system`), or has been dropped;
 * - the target is not addressable — excluded or system — because the picker
 *   reads it through the ordinary list route;
 * - a column of the join table that is not one of the two keys is NOT NULL and
 *   nothing fills it: writing a link would need a value nobody has asked for.
 */
export function linkableRefusal(view: SnapshotView, table: ResolvedTable, relationId: string): LinkRefusal | null {
  const resolution = resolveLink(view, table, relationId);
  return resolution.ok ? null : resolution.refusal;
}

export function resolveLink(view: SnapshotView, table: ResolvedTable, relationId: string): LinkResolution {
  const refuse = (reason: string): LinkResolution => ({ ok: false, refusal: { reason } });
  const relation = relationOf(view.model, relationId);
  if (relation === undefined) return refuse(`This table has no relation called ${JSON.stringify(relationId)}.`);
  if (relation.through === null || relation.cardinality !== 'many-to-many') {
    return refuse('That relation is a plain foreign key, not a link table.');
  }
  if (relation.confidence < LINKABLE_CONFIDENCE) {
    return refuse('Adminium is not sure enough about that relation to write through it.');
  }
  const { through } = relation;
  if (
    through.fromColumns.length !== 1 ||
    through.toColumns.length !== 1 ||
    relation.from.columns.length !== 1 ||
    relation.to.columns.length !== 1
  ) {
    return refuse('A link field needs one column on each side of the join table.');
  }

  /*
   * WHICH WAY ROUND. `from` and `to` are the relation's own orientation, which
   * has nothing to do with the page being edited: a field on `services` uses
   * exactly the same relation as one on `bookings`, with the two column pairs
   * swapped.
   */
  const forward = relation.from.tableId === table.table.id;
  const backward = relation.to.tableId === table.table.id;
  if (!forward && !backward) return refuse('That relation does not touch this table.');
  const ownColumn = (forward ? through.fromColumns[0] : through.toColumns[0]) as string;
  const targetColumn = (forward ? through.toColumns[0] : through.fromColumns[0]) as string;
  const ownKeyColumn = (forward ? relation.from.columns[0] : relation.to.columns[0]) as string;
  const targetKeyColumn = (forward ? relation.to.columns[0] : relation.from.columns[0]) as string;
  const targetTableId = forward ? relation.to.tableId : relation.from.tableId;

  const linkTable = view.linkTable(through.tableId);
  if (linkTable === null) return refuse('The link table is not one Adminium may write to.');
  if (!linkTable.columns.has(ownColumn) || !linkTable.columns.has(targetColumn)) {
    return refuse('The link table no longer has the columns that relation names.');
  }
  // The TARGET goes through the ordinary allowlist: the picker reads it with
  // the list route, so a table nobody may address is a picker with nothing to
  // read — refused here rather than 422ing at the first search.
  let target: ResolvedTable;
  try {
    target = view.table(targetTableId);
  } catch {
    return refuse('The table this links to is hidden or excluded.');
  }
  if (!target.columns.has(targetKeyColumn)) {
    return refuse('The table this links to no longer has the key that relation names.');
  }

  const unfilled = linkTable.table.columns.find(
    (column) =>
      column.name !== ownColumn &&
      column.name !== targetColumn &&
      !column.nullable &&
      !isFilled(view, linkTable, column),
  );
  if (unfilled !== undefined) {
    return refuse(
      `${linkTable.name}.${unfilled.name} has to be filled in, so a link cannot be added from here.`,
    );
  }

  return {
    ok: true,
    link: {
      relationId,
      linkTable,
      ownColumn,
      ownKeyColumn,
      targetColumn,
      targetKeyColumn,
      target,
      selfReferential: relation.selfReferential,
    },
  };
}

/** Every relation this table can offer as a link field, in relation-id order. */
export function linkableRelations(view: SnapshotView, table: ResolvedTable): ResolvedLink[] {
  const links: ResolvedLink[] = [];
  for (const relation of view.model.relations) {
    if (relation.through === null) continue;
    if (relation.from.tableId !== table.table.id && relation.to.tableId !== table.table.id) continue;
    const resolution = resolveLink(view, table, relation.id);
    if (resolution.ok) links.push(resolution.link);
  }
  return links.sort((a, b) => (a.relationId < b.relationId ? -1 : a.relationId > b.relationId ? 1 : 0));
}

/**
 * The link rows to add and to remove so the record's set becomes `wanted`.
 *
 * Both sides are compared as STRINGS, because that is what a key travels as on
 * the wire and what the picker holds: a bigint key that arrives as "12" must
 * not read as a different link from the `12` already stored.
 */
export function diffLinks(
  current: readonly unknown[],
  wanted: readonly unknown[],
): { add: string[]; remove: string[] } {
  const has = new Set(current.map((value) => String(value)));
  // A repeated key in the request is one link, not two: the picker cannot make
  // one, but an API caller can, and a duplicate row is a link nobody can remove
  // from the form (it would come back).
  const want = new Set(wanted.map((value) => String(value)));
  return {
    add: [...want].filter((key) => !has.has(key)),
    remove: [...has].filter((key) => !want.has(key)),
  };
}

/**
 * Whether two link sets hold the same keys — order and repeats aside.
 *
 * The undo's conflict check: a set that no longer matches what the write left
 * behind belongs to somebody else's edit, and putting the old one back would
 * throw that edit away.
 */
export function sameKeys(a: readonly string[], b: readonly string[]): boolean {
  const left = new Set(a);
  const right = new Set(b);
  if (left.size !== right.size) return false;
  for (const key of left) if (!right.has(key)) return false;
  return true;
}
