// SPDX-License-Identifier: AGPL-3.0-only
/**
 * documentSequencesRepo — adminium_document_sequences (34-invoices-add-on.md
 * §3.3, D11; wave 0031).
 *
 * ─── WHY COMPARE-AND-SET AND NOT A TRANSACTION ─────────────────────────────
 *
 * Two renders of two different orders can finish in the same millisecond, on
 * two workers, and each needs the next number in one sequence. The obvious
 * answers are both worse than this one:
 *
 *   `SELECT … FOR UPDATE` holds a row lock for the length of the surrounding
 *   transaction, which here would be a transaction that has just written a
 *   file and an audit row. It also does not exist on SQLite, so the shape
 *   would differ per dialect — and a concurrency mechanism that is only
 *   exercised on one dialect is a concurrency mechanism nobody has tested.
 *
 *   `UPDATE … SET next = next + 1 RETURNING next` is one statement and is
 *   correct, and `RETURNING` is not portable to MySQL. Kysely will emit it,
 *   the driver will not answer it.
 *
 * So: read `next`, then `UPDATE … WHERE key = ? AND next = ?`. The WHERE is
 * the compare; a zero-row result means somebody else claimed that number
 * first, and the loop reads again. It is portable to all three dialects
 * because it is only ever an UPDATE with a WHERE, and it is testable because
 * "somebody else got there first" is a branch a test can drive by running two
 * claims at once.
 *
 * ─── A NUMBER IS CLAIMED AFTER A SUCCESSFUL RENDER, NEVER BEFORE ───────────
 *
 * That is the caller's rule, not this file's, but it is the reason this file
 * exists in the shape it does: a failed render must burn no number, so
 * claiming cannot be part of creating the register row. `adminium_documents`
 * accordingly has `number` nullable and no unique index over it (D11).
 *
 * ─── GAPS ARE POSSIBLE AND ARE SAID SO ON THE SCREEN ───────────────────────
 *
 * A claim that succeeds and is then followed by a crash leaves a number
 * nobody used. The settings panel's help text says numbers are never reused
 * and gaps can happen, in all eight locales, because the alternative — making
 * a sequence gapless — means holding a lock across the render, and a render
 * can take seconds. A tax authority that requires gapless numbering needs a
 * different mechanism, and pretending otherwise on the screen would be worse
 * than the gap.
 */

import type { MetaDb } from '../connect.js';
import type { MetaDB } from '../schema/tables.js';
import { affected } from './util.js';

/**
 * How many rounds a claim will run before giving up on a key.
 *
 * THE NUMBER IS NOT A GUESS AND THE FIRST ONE WAS WRONG. A CAS loop under N
 * simultaneous claimants needs up to N rounds: each round has exactly one
 * winner, so the last claimant re-reads N−1 times. The first version of this
 * file used 8 and a comment asserting that eight rounds was "far past the
 * point where genuine contention has been ruled out" — which is false, and
 * `repos.document-sequences.test.ts`'s twenty-concurrent-claims case failed on
 * it immediately.
 *
 * So the bound is set well above any real claimant count. Renders are
 * processed by the job worker pool, so simultaneous claims on ONE key are
 * bounded by worker concurrency rather than by how many rows somebody
 * imported; 64 leaves an order of magnitude of headroom. What the bound is
 * actually for is the case that is NOT contention — a row that cannot be
 * updated at all — where looping forever would hang a worker instead of
 * failing a job that can be retried.
 */
const MAX_ATTEMPTS = 64;

export interface DocumentSequence {
  key: string;
  next: number;
  updatedAt: number;
}

export function documentSequencesRepo(meta: MetaDb) {
  const db = meta.db as unknown as import('kysely').Kysely<MetaDB>;

  async function read(key: string): Promise<DocumentSequence | null> {
    const row = await db
      .selectFrom('adminium_document_sequences')
      .selectAll()
      .where('key', '=', key)
      .executeTakeFirst();
    return row === undefined ? null : { key: row.key, next: row.next, updatedAt: row.updatedAt };
  }

  /**
   * What the NEXT claim would return, without claiming it.
   *
   * The settings panel shows this beside the prefix. It is deliberately not a
   * promise: between reading it and rendering, somebody else may claim it,
   * which is why the copy beside it says gaps can happen rather than "your
   * next invoice will be N".
   */
  async function peek(key: string): Promise<number> {
    return (await read(key))?.next ?? 1;
  }

  /**
   * Claim the next number for `key`, or throw after `MAX_ATTEMPTS` contended
   * rounds.
   *
   * THROWING RATHER THAN RETURNING NULL, because there is no useful thing a
   * caller can do with "the sequence was busy": the render already succeeded,
   * the bytes exist, and the document needs a number. The job's own retry is
   * the right place for that, and it can only see a failure if this throws.
   * Eight rounds of a single-row UPDATE is far past the point where genuine
   * contention has been ruled out and something else is wrong.
   */
  async function claim(key: string, at: number = Date.now()): Promise<number> {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      const current = await read(key);

      if (current === null) {
        /*
         * First claim on this key. The INSERT is the compare: a second worker
         * racing to create the same row loses on the primary key, and its
         * error is swallowed so the loop reads the row the winner wrote. This
         * is the one branch where a duplicate-key error is an ORDINARY
         * outcome rather than a fault.
         */
        try {
          await db
            .insertInto('adminium_document_sequences')
            .values({ key, next: 2, updatedAt: at })
            .execute();
          return 1;
        } catch {
          continue;
        }
      }

      const claimed = current.next;
      const rows = await db
        .updateTable('adminium_document_sequences')
        .set({ next: claimed + 1, updatedAt: at })
        .where('key', '=', key)
        // THE COMPARE. Zero rows means another claim moved `next` between the
        // read above and this statement, and the loop reads again.
        .where('next', '=', claimed)
        .executeTakeFirst();

      if (affected(rows.numUpdatedRows) === 1) return claimed;
      /*
       * Yield between rounds. Without it a losing claimant re-reads inside the
       * same microtask run and can crowd out the very claim it is waiting on —
       * on SQLite, where the driver is synchronous, that turns a busy key into
       * a burst of wasted statements rather than a queue.
       */
      await Promise.resolve();
    }

    throw new Error(
      `document sequence '${key}' did not settle in ${String(MAX_ATTEMPTS)} rounds — ` +
        'that is far past real contention, so the row is probably not updatable',
    );
  }

  /**
   * Move a sequence forward so the next claim is at least `floor`.
   *
   * For an operator who has been numbering by hand and wants the register to
   * continue from where they left off. It never moves a sequence BACKWARDS —
   * reusing a number that has been issued is the one thing a register may not
   * do — so a floor below the current position is a no-op rather than an
   * error, and the caller reads the result to see where it actually landed.
   */
  async function raiseTo(key: string, floor: number, at: number = Date.now()): Promise<number> {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      const current = await read(key);
      if (current === null) {
        try {
          await db
            .insertInto('adminium_document_sequences')
            .values({ key, next: Math.max(floor, 1), updatedAt: at })
            .execute();
          return Math.max(floor, 1);
        } catch {
          continue;
        }
      }
      if (current.next >= floor) return current.next;
      const rows = await db
        .updateTable('adminium_document_sequences')
        .set({ next: floor, updatedAt: at })
        .where('key', '=', key)
        .where('next', '=', current.next)
        .executeTakeFirst();
      if (affected(rows.numUpdatedRows) === 1) return floor;
    }
    throw new Error(
      `document sequence '${key}' did not settle in ${String(MAX_ATTEMPTS)} rounds — ` +
        'that is far past real contention, so the row is probably not updatable',
    );
  }

  return { read, peek, claim, raiseTo };
}

export type DocumentSequencesRepo = ReturnType<typeof documentSequencesRepo>;
