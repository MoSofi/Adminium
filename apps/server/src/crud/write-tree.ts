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
import type { NamedLock } from './capacity/locks.js';
import type { JudgedRow, PoolState } from './capacity/types.js';
import type { PostedOutcome } from './ledger-write.js';
import type { Row } from './mask.js';
import type { WriteContext, WriteTarget } from './write-context.js';

type Db = Kysely<SourceDatabase>;

/** The most rows one create may carry below it, in all, through any door but the desk's. */
export const TREE_MAX_ROWS = 200;

/** …and through the desk's own (a message to a show's 382 buyers, with its emails): what a bulk write takes. */
export const STAFF_TREE_MAX_ROWS = 1000;

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
  /**
   * The child lists this row's entry declares (by wire name): each is judged
   * as a whole once written — an empty one too (a required choice left out).
   */
  lists?: readonly string[] | undefined;
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
  /** The most rows it may carry below the root (the public door's {@link TREE_MAX_ROWS} when absent). */
  maxRows?: number | undefined;
  /** `dry`: a quote — no named locks, no numbers, no person, nothing announced, always rolled back. */
  mode: 'save' | 'dry';
  /**
   * A row's own checks — the rows it names may be read, it agrees with its
   * parent — on the transaction's handle, before its INSERT. `parent` is the
   * row it hangs from as written (null for the root).
   */
  checks?: ((db: Db, node: TreeNode, values: Row, parent: Row | null) => Promise<void>) | undefined;
  /**
   * The rows of one child list, once all of them are written: what they add
   * up to together (how many of each group, a sum's most) — refused on the
   * parent row they hang from.
   */
  siblings?: ((db: Db, parent: TreeWritten, name: string, rows: readonly TreeWritten[]) => Promise<void>) | undefined;
  /**
   * The root as settled against the price the caller expected, with every row
   * as its totals left it; throws when they differ (a save only).
   */
  expect?: ((db: Db, root: Row, rows: readonly TreeWritten[]) => Promise<void>) | undefined;
  /** Links a staff form writes with the root, inside the transaction. */
  inside?: ((db: Db, root: Row) => Promise<void>) | undefined;
  /** The retry key, looked up again inside the transaction after the locks (a save only). */
  replay?: ((db: Db) => Promise<TreeReplay | null>) | undefined;
  /** The person found or created by address, as the root's link values (a save only; never in a quote). */
  identity?: ((db: Db) => Promise<Row>) | undefined;
  /** Named locks of the door's own taken with the write's (a person's address on MySQL), a save only. */
  locks?: readonly NamedLock[] | undefined;
  /**
   * Rows of the write's own tables it changes besides its tree (a buyer's
   * old hold let go), held once every row outside the tree is — the own rows'
   * place in the one lock order — and before the tree's rows go in. A quote
   * changes and holds nothing: it answers the rows as the save would leave
   * them, and the limits judge them so (listed beside the tree's rows).
   */
  ownRows?: ((db: Db, mode: 'save' | 'dry') => Promise<readonly JudgedRow[]>) | undefined;
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
  /** What each posting of the tree did, when its rows hand anything to an add-on's ledger. */
  postings?: PostedOutcome[] | undefined;
}

export type CreateTree = (input: CreateTreeInput) => Promise<TreeOutcome>;
