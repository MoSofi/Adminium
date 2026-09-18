// SPDX-License-Identifier: AGPL-3.0-only
/**
 * CHILD ROWS: the line-items field, resolved and judged.
 *
 * A one-to-many relation is a foreign key on the OTHER table — `invoice_id` on
 * `invoice_items` — and a field over it edits whole rows of that table beside
 * the parent it belongs to.
 *
 * ─── A child row is not a link row ─────────────────────────────────────────
 *
 * `crud/links.ts` writes two foreign keys into a join table; the row it makes
 * has no other meaning. A child row is a RECORD: it has its own columns, its
 * own rules, its own before/after hooks, its own masking and its own grants. So
 * the checks here are the child TABLE's — `create`, `update` and `delete` on
 * it, resolved before the transaction opens — and every row still goes through
 * the write service, exactly as a create through the front door does. A parent
 * create that wrote child rows past that service would be a hole in every rule
 * the column layer enforces.
 *
 * ─── What is NOT here ──────────────────────────────────────────────────────
 *
 * The writes. They live in the data route, inside the transaction that writes
 * the parent, because the announcement (undo token, audit, realtime) must not
 * fire for a write that can still roll back — the same rule links follow.
 */

import type { EffectiveModel } from '../connections/effective-schema.js';
import type { ResolvedTable, SnapshotView } from './identifiers.js';
import type { Row } from './mask.js';

/** The same bar link fields use: a guess nothing else trusts is not a field. */
export const CHILD_CONFIDENCE = 0.8;

/** Most child rows one parent's field may carry in a request. */
export const MAX_CHILD_ROWS = 200;

export interface ResolvedChild {
  relationId: string;
  /** The table holding the rows. */
  child: ResolvedTable;
  /** The child column pointing back at the parent. */
  foreignColumn: string;
  /** The parent column it points at — usually, but not always, the key. */
  parentKeyColumn: string;
}

export interface ChildRefusal {
  reason: string;
}

export type ChildResolution =
  | { ok: true; child: ResolvedChild }
  | { ok: false; refusal: ChildRefusal };

function relationOf(model: EffectiveModel, relationId: string) {
  return model.relations.find((relation) => relation.id === relationId);
}

/**
 * Which table holds the rows, which column points back, and whether this
 * relation may be a field at all.
 *
 * Every refusal carries its REASON: a field that silently disappears is a
 * feature nobody can debug, and the reason is what an operator acts on.
 */
export function resolveChild(
  view: SnapshotView,
  table: ResolvedTable,
  relationId: string,
): ChildResolution {
  const refuse = (reason: string): ChildResolution => ({ ok: false, refusal: { reason } });
  const relation = relationOf(view.model, relationId);
  if (relation === undefined) {
    return refuse(`This table has no relation called ${JSON.stringify(relationId)}.`);
  }
  if (relation.through !== null) {
    return refuse('That relation goes through a join table, so its field is a list of links.');
  }
  if (relation.confidence < CHILD_CONFIDENCE) {
    return refuse('Adminium is not sure enough about that relation to write through it.');
  }
  if (relation.from.columns.length !== 1 || relation.to.columns.length !== 1) {
    return refuse('A line-items field needs one column on each side of the relation.');
  }
  /*
   * ORIENTATION. `from` is the side holding the foreign key — the CHILD — and
   * `to` is the side it points at. A field on the parent therefore only exists
   * when this table is `to`; the same relation read from the child's side is an
   * ordinary reference, which is a different control entirely.
   */
  if (relation.to.tableId !== table.table.id) {
    return refuse('That relation points away from this table, so it is a reference, not a list.');
  }
  const foreignColumn = relation.from.columns[0] as string;
  const parentKeyColumn = relation.to.columns[0] as string;
  if (!table.columns.has(parentKeyColumn)) {
    return refuse('This table no longer has the column that relation points at.');
  }

  let child: ResolvedTable;
  try {
    child = view.table(relation.from.tableId);
  } catch {
    return refuse('The table holding those rows is hidden or excluded.');
  }
  if (!child.columns.has(foreignColumn)) {
    return refuse('That table no longer has the column pointing back here.');
  }
  if (child.readOnly) {
    return refuse('Adminium cannot write to that table, so its rows cannot be edited here.');
  }
  if (child.primaryKey.length === 0) {
    // Without a key a change cannot be told from an insert, and a save would
    // have to delete every row and write them again — which burns ids, fires
    // delete hooks for rows nobody touched, and loses whatever a default filled.
    return refuse('That table has no primary key, so Adminium cannot tell its rows apart.');
  }
  return { ok: true, child: { relationId, child, foreignColumn, parentKeyColumn } };
}

/**
 * Every relation this table can hold a list of lines for.
 *
 * Sorted by id so a page's fields do not reshuffle between two reads of the
 * same snapshot — the same rule `linkableRelations` follows.
 */
export function childRelations(view: SnapshotView, table: ResolvedTable): ResolvedChild[] {
  const children: ResolvedChild[] = [];
  for (const relation of view.model.relations) {
    if (relation.through !== null) continue;
    if (relation.to.tableId !== table.table.id) continue;
    const resolution = resolveChild(view, table, relation.id);
    if (resolution.ok) children.push(resolution.child);
  }
  return children.sort((a, b) =>
    a.relationId < b.relationId ? -1 : a.relationId > b.relationId ? 1 : 0,
  );
}

/** One row as a request carries it: its key when it already exists. */
export interface RequestedChildRow {
  /** The child's own primary key, or absent for a row being added. */
  key?: Row | undefined;
  values: Row;
}

export interface ChildDiff {
  added: Row[];
  /** Rows that exist and are being changed: their key and the new values. */
  changed: { key: Row; values: Row }[];
  /** Keys of rows the request left out. */
  removed: Row[];
}

/** Join a key into one comparable string; the separator never appears in one. */
const KEY_SEPARATOR = String.fromCharCode(1);

/**
 * What a save has to do, against the rows that are really there.
 *
 * A diff rather than a delete-and-reinsert, for four reasons that each cost
 * something real: reinserting burns identity values, fires a delete hook for
 * every untouched row, loses anything a column default filled on the original,
 * and turns one person's edit of one line into an audit entry per line.
 *
 * A key the request names that does not exist is treated as an ADD carrying
 * that key, not a silent drop: the database is the thing that decides whether a
 * key may be reused, and refusing on its behalf would refuse writes that work.
 */
export function diffChildRows(
  primaryKey: readonly string[],
  existing: readonly Row[],
  requested: readonly RequestedChildRow[],
): ChildDiff {
  const keyText = (row: Row): string => primaryKey.map((name) => String(row[name])).join(KEY_SEPARATOR);
  const have = new Map(existing.map((row) => [keyText(row), row] as const));
  const seen = new Set<string>();
  const diff: ChildDiff = { added: [], changed: [], removed: [] };

  for (const row of requested) {
    if (row.key === undefined) {
      diff.added.push(row.values);
      continue;
    }
    const text = keyText(row.key);
    if (!have.has(text)) {
      diff.added.push({ ...row.key, ...row.values });
      continue;
    }
    seen.add(text);
    diff.changed.push({ key: row.key, values: row.values });
  }
  for (const [text, row] of have) {
    if (!seen.has(text)) {
      diff.removed.push(Object.fromEntries(primaryKey.map((name) => [name, row[name]])));
    }
  }
  return diff;
}
