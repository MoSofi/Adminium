// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE LIMIT GUARD'S VOCABULARY — what a write hands the guard, and what the
 * guard answers.
 *
 * One guard judges every write that can take from a limit, a single row or a
 * create with its child rows alike: it is handed the rows this write has
 * already put in the table (or is about to), each with its key when it has
 * one. The counting leaves every listed key out of what it reads back and
 * adds each listed row's own amount once, so a row is never counted twice —
 * whether it was judged before its INSERT or after it, inside the same
 * transaction.
 */
import type { CapacityKind } from '@adminium/manifest';

import type { Row } from '../mask.js';
import type { WriteClock } from '../write-clock.js';
import type { WriteOrigin, WriteTarget } from '../write-context.js';

/** A row as the guard judges it. */
export interface JudgedRow {
  /**
   * The table the row is in. Its `timezone` is the venue's, already looked up
   * (the guard never looks it up); its `db` is not read — the guard reads
   * through the handle it is given.
   */
  target: WriteTarget;
  /**
   * The row's key when the row is in the table in this transaction —
   * inserted by this write, or the row being changed — so the counting leaves
   * it out; null for a create judged before its INSERT.
   */
  pk: Row | null;
  /** The row as it will stand: a create's values; a change's stored row with the new values over it. */
  row: Row;
  /** The row as stored, read holding it; null for a create. */
  before: Row | null;
  /** Where the row sits in a create with child rows (`['order_items', 3]`); absent for a single row. */
  path?: readonly (string | number)[] | undefined;
}

export interface CapacityJudgeOptions {
  /** The write's clock: holds end, and windows open, at its locked instant. */
  clock: WriteClock;
  /** Who writes: a guest is held to notice, pauses, the past and cancellation windows; staff are not. */
  origin: WriteOrigin;
  /**
   * `save` requires every lock the rows need to be held on the handle
   * (`heldNames`) and throws `LockMoved` for one that is not; `dry` (a quote)
   * holds none and requires none. Both refuse exactly alike.
   */
  mode: 'save' | 'dry';
}

/** What a row asks of one rule: nothing, a count (a place taken back), or a count and its placement (a new or moved place). */
export type CapacityNeed = 'none' | 'count' | 'full';

/** One pool one rule counts, as the guard found it under its locks (or, for a quote, without them). */
export interface PoolState {
  /** The table the rule is on, and which of its rules (its place in the list; 0 for a single rule). */
  table: string;
  rule: number;
  kind: CapacityKind;
  /** The pool: a slot's instant (ISO), the key of the row a parent rule points at, a night pool's key — as text. */
  key: string;
  /** The venue day (a slot, a parent rule's `day`) or night (`YYYY-MM-DD`) the pool is counted on. */
  at?: string | undefined;
  /** The limit; null for none. */
  size: number | null;
  /** Places counted, with this write's rows. */
  taken: number;
  /** Of those, places a hold keeps that has not ended. */
  held: number;
  /** `size − taken`; null with no limit. Staff only: the public hears it only where the entry shows what is left. */
  left: number | null;
  /** Whether this write's rows fit. */
  fits: boolean;
}

/** Why a row's place is refused before anything is counted (the field code of a 422). */
export type CapacityReason = 'out-of-range' | 'out-of-hours' | 'closed' | 'paused' | 'not-on-sale' | 'too-many';

/** `details.reason` of a 422 per field code. A released slot rule's refusal carries none (it answers as it always did). */
export const CAPACITY_REASONS: Readonly<Record<CapacityReason, string>> = {
  'out-of-range': 'CAPACITY_OUT_OF_RANGE',
  'out-of-hours': 'CAPACITY_OUT_OF_HOURS',
  closed: 'CAPACITY_CLOSED',
  paused: 'CAPACITY_PAUSED',
  'not-on-sale': 'CAPACITY_NOT_ON_SALE',
  'too-many': 'CAPACITY_TOO_MANY',
};

/** `details` of 409 `CAPACITY_FULL`: staff read all of it; a public door passes on only `row` (as its child and index) and `column`. */
export interface CapacityFullDetails {
  column: string;
  rule: number;
  kind: CapacityKind;
  /** The refused row: its place in the list the guard was handed. */
  row?: number | undefined;
  pool?: { key?: string | undefined; at?: string | undefined } | undefined;
  left?: number | undefined;
}

/** A row the guard names locks for, before any transaction opens. */
export interface LockNameRow {
  target: WriteTarget;
  /**
   * The values the names are read from: a prepared row (a single row, a
   * tree's root — its copies resolved), or a child's values as sent (its
   * copies not resolved yet: a `lockBy` that is a copy is read by one peek
   * through the link it copies from).
   */
  row: Row;
  /** The stored row, on a change (read without a lock); null for a create. */
  before: Row | null;
  prepared: boolean;
}

/** What a lock-free read of a table's pools is asked (availability, staff counts). */
export interface CapacityAsk {
  /** Which of the table's rules. */
  rule: number;
  /** The pools asked for: parent rows' keys, night pools' keys; absent = what the rule's own ask reads. */
  keys?: readonly string[] | undefined;
  /** A venue day, or a range of them (`from` inclusive, `to` exclusive). */
  day?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
  /** The asker's own rows, left out of the count (a guest changing their own booking). */
  exclude?: readonly Row[] | undefined;
}
