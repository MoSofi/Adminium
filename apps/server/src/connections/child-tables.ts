// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Which tables point AT this one, and by which column
 * (the collection picker's seed).
 *
 * ─── THIS IS THE PIPELINE'S JOIN RULE, NOT A TASTE FILTER ──────────────────
 *
 * `documents/compose.ts`'s `readSource` reads a collection with
 *
 *     where <fkColumn> = row[<parent primaryKey[0]>]
 *
 * and a stored mapping records exactly one `fkColumn`. So an edge with more
 * than one column on either side, or one referencing a column that is not the
 * parent's first primary-key column, is a join the mapping cannot express.
 *
 * Offering such an edge in a picker would not fail — it would fill a document's
 * line-items table with whatever rows happened to match half a key, which reads
 * as success. That is why the rule lives here, next to a name that says what it
 * is, rather than inside a select in the editor.
 *
 * ─── AND THE ENGINE'S GUESS IS ONLY EVER AN ORDERING ───────────────────────
 *
 * `lineItems` reports the classifier's `line-items` role, which needs two
 * foreign keys plus qty × rate numerics. A one-FK child like `invoice_items`
 * is therefore NOT tagged and must still be pickable — the tag sorts the list
 * and never shortens it ("suggestion, never selection").
 */

import type { EffectiveModel } from './effective-schema.js';

export interface ChildTableEdge {
  /** The child table's qualified id. */
  table: string;
  /** The column on the child that points at the parent. */
  column: string;
  /** The engine classified the child as line items — an ordering hint only. */
  lineItems: boolean;
}

/**
 * The child edges of `tableId` that a document mapping could actually store.
 *
 * `offered` is the set of table ids a caller may address at all: a relation may
 * point from a system table or one the operator excluded, and naming either in
 * a picker offers a mapping every subsequent read refuses.
 */
export function childTablesFor(
  model: EffectiveModel,
  tableId: string,
  offered: ReadonlySet<string>,
): ChildTableEdge[] {
  const parent = model.tables.find((table) => table.id === tableId);
  const parentKey = parent?.primaryKey[0];
  if (parentKey === undefined) return [];

  const roleOf = new Map(model.tables.map((table) => [table.id, table.semantics?.role ?? null]));

  return model.relations
    .filter(
      (relation) =>
        relation.to.tableId === tableId &&
        relation.from.columns.length === 1 &&
        relation.to.columns.length === 1 &&
        relation.to.columns[0] === parentKey &&
        offered.has(relation.from.tableId),
    )
    .map((relation) => ({
      table: relation.from.tableId,
      column: relation.from.columns[0]!,
      lineItems: roleOf.get(relation.from.tableId) === 'line-items',
    }));
}

/** The tables a caller may address — the `offered` argument above. */
export function addressableTables(model: EffectiveModel): Set<string> {
  return new Set(
    model.tables
      .filter((table) => table.system !== true && table.excluded !== true)
      .map((table) => table.id),
  );
}
