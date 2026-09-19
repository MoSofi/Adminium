// SPDX-License-Identifier: AGPL-3.0-only
/**
 * documentSequencesRepo.
 *
 * The whole file is about ONE claim: that two renders finishing at the same
 * moment cannot be given the same document number. A sequence that is only
 * ever tested sequentially proves nothing about that — the compare-and-set
 * loop's contended branch never executes — so the tests below run claims
 * CONCURRENTLY and assert on the set of numbers that came back.
 *
 * Every case runs on every available dialect, because the mechanism is a
 * portability decision: `SELECT … FOR UPDATE` and `UPDATE … RETURNING` were
 * both rejected for not existing everywhere, and a test that only ran on
 * SQLite would not have noticed.
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { documentSequencesRepo } from '../src/index.js';
import { TEST_DIALECTS, migrateOnly, useMetaDb } from './helpers/db.js';

const T0 = 1_750_000_000_000;

for (const dialect of TEST_DIALECTS) {
  describe.skipIf(!dialect.available)(`documentSequencesRepo — ${dialect.name}`, () => {
    const meta = useMetaDb(dialect, migrateOnly);
    let sequences: ReturnType<typeof documentSequencesRepo>;

    beforeEach(async () => {
      sequences = documentSequencesRepo(meta());
    });


    it('starts at one and hands out consecutive numbers', async () => {
      expect(await sequences.claim('prof_1', T0)).toBe(1);
      expect(await sequences.claim('prof_1', T0)).toBe(2);
      expect(await sequences.claim('prof_1', T0)).toBe(3);
    });

    it('keeps two keys apart', async () => {
      expect(await sequences.claim('prof_1', T0)).toBe(1);
      expect(await sequences.claim('prof_2', T0)).toBe(1);
      expect(await sequences.claim('prof_1', T0)).toBe(2);
    });

    it('peeks without claiming, so the panel can show a number it does not burn', async () => {
      expect(await sequences.peek('prof_1')).toBe(1);
      expect(await sequences.peek('prof_1')).toBe(1);
      expect(await sequences.claim('prof_1', T0)).toBe(1);
      expect(await sequences.peek('prof_1')).toBe(2);
    });

    it('NEVER gives one number twice, under twenty concurrent claims', async () => {
      /*
       * THE ASSERTION THE FILE EXISTS FOR. Twenty claims launched together on
       * a fresh key: whatever order they resolve in, the twenty results must
       * be exactly 1..20 with no repeat. A duplicate here is two invoices
       * carrying the same number, which is the defect this mechanism is the
       * only defence against.
       *
       * It also exercises the branch a sequential test cannot reach: the
       * INSERT race on a key that does not exist yet, where nineteen of the
       * twenty lose on the primary key and re-read.
       */
      const claims = await Promise.all(
        Array.from({ length: 20 }, () => sequences.claim('prof_busy', T0)),
      );
      expect([...claims].sort((a, b) => a - b)).toEqual(
        Array.from({ length: 20 }, (_, at) => at + 1),
      );
      expect(new Set(claims).size).toBe(20);
      expect(await sequences.peek('prof_busy')).toBe(21);
    });

    it('keeps concurrent claims on different keys independent', async () => {
      const claims = await Promise.all([
        sequences.claim('a', T0),
        sequences.claim('b', T0),
        sequences.claim('a', T0),
        sequences.claim('b', T0),
      ]);
      expect([...claims].sort()).toEqual([1, 1, 2, 2]);
    });

    it('moves a sequence forward for an operator continuing a hand-kept series', async () => {
      expect(await sequences.raiseTo('prof_1', 1041, T0)).toBe(1041);
      expect(await sequences.claim('prof_1', T0)).toBe(1041);
      expect(await sequences.claim('prof_1', T0)).toBe(1042);
    });

    it('refuses to move a sequence BACKWARDS, silently and on purpose', async () => {
      // Reusing an issued number is the one thing a register may not do, so a
      // floor below the current position is a no-op that reports where the
      // sequence actually is — not an error the caller has to interpret.
      await sequences.claim('prof_1', T0);
      await sequences.claim('prof_1', T0);
      expect(await sequences.raiseTo('prof_1', 2, T0)).toBe(3);
      expect(await sequences.claim('prof_1', T0)).toBe(3);
    });

    it('treats a floor below one as one, so a zero cannot be issued', async () => {
      expect(await sequences.raiseTo('prof_zero', 0, T0)).toBe(1);
      expect(await sequences.claim('prof_zero', T0)).toBe(1);
    });

    it('reads back nothing for a key nobody has claimed', async () => {
      expect(await sequences.read('never')).toBeNull();
    });
  });
}
