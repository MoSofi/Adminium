// SPDX-License-Identifier: AGPL-3.0-only
/**
 * TOTALS THAT CLIMB — a line's options into the line, the line into the
 * order, the order into the customer's lifetime total: the words.
 *
 * The write service holds the parents a write's totals move, then settles
 * them (`write-service.ts`: the statements live there). With totals over
 * totals it does both for a chain, up to three rows high:
 *
 *  - HOLD top-down, before the write's own rows: the highest ancestors first,
 *    each level sorted by table then key — every writer takes a document
 *    before its lines, so two never wait on each other crosswise. Ancestors
 *    above the first level are found by reading, without a lock, the link each
 *    held row climbs by, and read again once held: a line moved to another
 *    order between the two is 409 `WRITE_CONFLICT {retry: true}`.
 *  - SETTLE bottom-up, after the write's own statements: each level adds up
 *    what the level below has just written, then works out its formulas and
 *    its balances, in that order.
 *
 * Every path that moves a total goes through both: a create, a change, a
 * delete, a create with child rows, and the multi-row doors (bulk, import,
 * undo, a parent form, sample data).
 */
import type { Kysely } from 'kysely';
import type { Dialect } from '@adminium/engine';

import type { SourceDatabase } from '../connections/manager.js';
import type { RollupInto } from './column-rules.js';
import type { Row } from './mask.js';

type Db = Kysely<SourceDatabase>;

/** The first level of a chain: one total, and the parent rows it moves. */
export interface ClimbStart {
  rollup: RollupInto;
  keys: readonly unknown[];
}

/** The balances of every held parent, by table then key: what a capped balance is judged against. */
export type HeldBalances = Map<string, Map<string, Row>>;

/** The connection's currency, read only when a `currency` scale needs it. */
export type ClimbCurrency = () => Promise<string | null>;

/**
 * Hold every row a chain of totals climbs into, top-down, through the
 * transaction's handle; answer the first level's balances. Nothing is held on
 * SQLite (one writer).
 */
export type HoldChain = (db: Db, dialect: Dialect, start: readonly ClimbStart[], currency: ClimbCurrency) => Promise<HeldBalances>;

/**
 * Settle a chain bottom-up, through the transaction's handle. `cap` judges
 * each capped balance the write moved: against what {@link HoldChain} read,
 * or — `strict` — against zero. `only` settles only the parents it answers
 * yes for (a quote settles only the rows of its own tree). `read: 'plain'`
 * adds child rows up without the locks MySQL takes on what it reads (a quote
 * holds nothing another writer waits on); the default reads as a save does.
 */
export type SettleChain = (
  db: Db,
  dialect: Dialect,
  start: readonly ClimbStart[],
  currency: ClimbCurrency,
  opts?: {
    cap?: HeldBalances | 'strict' | undefined;
    only?: ((table: string, key: unknown) => boolean) | undefined;
    read?: 'locking' | 'plain' | undefined;
    /** The working-day stamps a settled row's moved totals and formulas set off (see {@link SettleStamps}). */
    stamps?: SettleStamps | undefined;
  },
) => Promise<void>;

/**
 * What a settle sets off in a row it moves: a working-day stamp that reads or
 * watches a total or a formula over one (a print job's ready-by, a day later
 * for each change asked on its proofs). The chain reads each such row before
 * a height settles it and after, and hands both over; what the stamps decide
 * is written to it by the write service, which knows the venue's clock.
 */
export interface SettleStamps {
  /** Whether a row of this table may have a stamp to work out again after a settle. */
  watches(table: string): boolean;
  /** Work out, and write, what the row's stamps decide now the settle has moved it. */
  stamp(table: string, keyColumn: string, key: unknown, before: Row, after: Row): Promise<void>;
}
