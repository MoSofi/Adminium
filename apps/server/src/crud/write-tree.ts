// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A CREATE WITH ITS CHILD ROWS — an order with its lines and each line's
 * options, a stay with its extras — as one write: every row or none.
 *
 * This module holds the words; the write itself is the write service's
 * `createTree` (the statements live there and nowhere else). One path for the
 * public API and for staff, and for a quote (`dry`), which runs the same
 * steps in a transaction it always rolls back.
 *
 * The order of a tree write:
 *
 *   outside any transaction
 *    1. what the connection's role may write, per table; the rows counted
 *       against each child's least and most;
 *    2. the root prepared as a single create prepares its row (FILL,
 *       RESOLVE, DECIDE, before hooks — a save only — FORMULA, CHECK);
 *    3. a save names its locks: every limit the root's prepared values and
 *       the children's values as sent can take from, with the root's number
 *       series — one sorted list. A quote names none.
 *   inside one transaction
 *    4. the locks, all at once; then the write's clock;
 *    5. a retry key looked up again (a hit answers the stored tree);
 *    6. the person found or created by address (a save only);
 *    7. every row outside the tree that the tree's totals climb into, and
 *       every parent it is tied to, held top-down in one sorted order; then
 *       the rows it links to, for share;
 *    8. the root: its checks, its number, its INSERT; then each level, each
 *       row in request order: its link to its parent, its position, the same
 *       prepare steps (no before hooks inside a transaction), its checks,
 *       its number, its INSERT;
 *    9. the limits, judged once over every row written;
 *   10. the totals settled bottom-up, climbing; the root sealed;
 *   11. the root read again; the price it was expected at compared;
 *   12. commit — or, for a quote, roll back.
 *   after the commit, root first then each level in request order: each row
 *   announced, then the after hooks.
 */
import type { Kysely } from 'kysely';

import type { SourceDatabase } from '../connections/manager.js';
import type { PoolState } from './capacity/types.js';
import type { Row } from './mask.js';
import type { WriteContext, WriteTarget } from './write-context.js';

type Db = Kysely<SourceDatabase>;

/** Where a row sits in the request: `['order_items', 3, 'order_item_modifiers', 1]`; `[]` for the root. */
export type TreePath = readonly (string | number)[];

/** One row of the tree, as the door hands it over. */
export interface TreeNode {
  /** The name the wire uses for the rows: the child table's manifest ref (the root's entry ref for the root). */
  name: string;
  target: WriteTarget;
  /** The values as the door prepared them (allow-listed, defaults, allowed values) — not yet filled. */
  values: Row;
  /** A child's link: its own foreign key column, and the parent's key column that fills it. */
  via?: { column: string; parentKey: string } | undefined;
  /** An int column filled 1..n in request order. */
  position?: string | undefined;
  at: TreePath;
  children: TreeNode[];
}

/** One row the tree wrote. */
export interface TreeWritten {
  node: TreeNode;
  /** The row as written (the root as its totals left it). */
  record: Row;
}

/** A create already made under the same retry key: the rows it stored. */
export interface TreeReplay {
  root: Row;
  rows: TreeWritten[];
}

export interface CreateTreeInput {
  root: TreeNode;
  context: WriteContext;
  /** `dry`: a quote — no named locks, no numbers, no person, nothing announced, always rolled back. */
  mode: 'save' | 'dry';
  /** A node's readable references, `agrees`, `counts` and row totals, on the transaction's handle. */
  checks?: ((db: Db, node: TreeNode, values: Row) => Promise<void>) | undefined;
  /** The root as settled against the price the caller expected; throws when they differ (a save only). */
  expect?: ((db: Db, root: Row) => Promise<void>) | undefined;
  /** Links a staff form writes with the root, inside the transaction. */
  inside?: ((db: Db, root: Row) => Promise<void>) | undefined;
  /** The retry key, looked up again inside the transaction after the locks (a save only). */
  replay?: ((db: Db) => Promise<TreeReplay | null>) | undefined;
  /** The person found or created by address, as the root's link values (a save only; never in a quote). */
  identity?: ((db: Db) => Promise<Row>) | undefined;
  /** One written row, announced after the commit — as a single create's `announce`. Never called for a quote. */
  announce: (row: TreeWritten) => Promise<void>;
  /** A refusal, with the row it is about. */
  mapError: (error: unknown, at: TreePath) => never;
}

export interface TreeOutcome {
  mode: 'save' | 'dry';
  /** The root as its totals left it. */
  root: Row;
  /** Every row: the root, then each level in request order. */
  rows: TreeWritten[];
  /** Every pool the limits counted (what a quote shows). */
  capacity: PoolState[];
  /** A retry of a create already made: nothing was written; the stored rows are answered. */
  replayed: boolean;
}

export type CreateTree = (input: CreateTreeInput) => Promise<TreeOutcome>;
