// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { JOB_BACKOFF_BASE_MS, JOB_STALE_LOCK_MS, applyMigrations, jobsRepo } from '../src/index.js';
import { TEST_DIALECTS, type TestDb } from './helpers/db.js';

const T0 = 1_750_000_000_000;

for (const dialect of TEST_DIALECTS) {
  describe.skipIf(!dialect.available)(`jobsRepo [${dialect.name}]`, () => {
    let t: TestDb;

    beforeEach(async () => {
      t = await dialect.make();
      await applyMigrations(t.meta.db, { dialect: t.meta.dialect });
    });
    afterEach(async () => {
      await t.destroy();
    });

    it('enqueues with defaults and round-trips the payload', async () => {
      const jobs = jobsRepo(t.meta);
      const job = await jobs.enqueue({ kind: 'export.run', payload: { exportId: 'exp_1' } }, T0);
      expect(job).toMatchObject({
        kind: 'export.run',
        status: 'pending',
        priority: 0,
        attempts: 0,
        maxAttempts: 3,
        runAt: T0,
        payload: { exportId: 'exp_1' },
      });
      expect(await jobs.findById(job.id)).toMatchObject({ payload: { exportId: 'exp_1' } });
    });

    it('dedupes by dedupe_key while pending', async () => {
      const jobs = jobsRepo(t.meta);
      const a = await jobs.enqueue({ kind: 'retention.gc', payload: {}, dedupeKey: 'gc:sessions' }, T0);
      const b = await jobs.enqueue({ kind: 'retention.gc', payload: {}, dedupeKey: 'gc:sessions' }, T0 + 1);
      expect(b.id).toBe(a.id);

      // Completion clears the key so it can be reused (§3.12).
      await jobs.claim('w1', T0 + 2);
      await jobs.complete(a.id, T0 + 3);
      const c = await jobs.enqueue({ kind: 'retention.gc', payload: {}, dedupeKey: 'gc:sessions' }, T0 + 4);
      expect(c.id).not.toBe(a.id);
    });

    it('claims by priority desc, then run_at asc, then id asc', async () => {
      const jobs = jobsRepo(t.meta);
      await jobs.enqueue({ kind: 'low', payload: {}, priority: 0, runAt: T0 - 10 }, T0 - 10);
      const high = await jobs.enqueue({ kind: 'high', payload: {}, priority: 5, runAt: T0 - 5 }, T0 - 5);
      await jobs.enqueue({ kind: 'future', payload: {}, runAt: T0 + 60_000 }, T0);

      const claimed = await jobs.claim('worker-a', T0);
      expect(claimed?.id).toBe(high.id);
      expect(claimed?.status).toBe('running');
      expect(claimed?.attempts).toBe(1);
      expect(claimed?.lockedBy).toBe('worker-a');

      const second = await jobs.claim('worker-a', T0);
      expect(second?.kind).toBe('low');
      // The future job is not due.
      expect(await jobs.claim('worker-a', T0)).toBeNull();
    });

    it('claim is race-safe: two claimers, exactly one wins the single job', async () => {
      const jobs = jobsRepo(t.meta);
      await jobs.enqueue({ kind: 'once', payload: {} }, T0);

      // Both claimers run the full candidate-SELECT + UPDATE-guard flow
      // concurrently; the guard (`WHERE status='pending'`) lets exactly one in.
      const [a, b] = await Promise.all([jobs.claim('worker-a', T0 + 1), jobs.claim('worker-b', T0 + 1)]);
      const winners = [a, b].filter((j) => j !== null);
      expect(winners).toHaveLength(1);

      const row = await jobs.findById(winners[0]!.id);
      expect(row?.status).toBe('running');
      expect(['worker-a', 'worker-b']).toContain(row?.lockedBy);
      expect(row?.attempts).toBe(1);
    });

    it('reclaims stale running jobs (crashed worker) but not fresh locks', async () => {
      const jobs = jobsRepo(t.meta);
      const job = await jobs.enqueue({ kind: 'x', payload: {} }, T0);
      await jobs.claim('worker-a', T0);

      // Fresh lock: nothing to claim.
      expect(await jobs.claim('worker-b', T0 + 1_000)).toBeNull();

      // Past the stale threshold the lock is reclaimable.
      const reclaimed = await jobs.claim('worker-b', T0 + JOB_STALE_LOCK_MS + 1);
      expect(reclaimed?.id).toBe(job.id);
      expect(reclaimed?.lockedBy).toBe('worker-b');
      expect(reclaimed?.attempts).toBe(2);
    });

    it('fail retries with exponential backoff, then lands in failed', async () => {
      const jobs = jobsRepo(t.meta);
      const job = await jobs.enqueue({ kind: 'x', payload: {}, maxAttempts: 2 }, T0);

      await jobs.claim('w', T0); // attempt 1
      let after = await jobs.fail(job.id, 'boom', T0 + 10);
      expect(after?.status).toBe('pending');
      expect(after?.runAt).toBe(T0 + 10 + JOB_BACKOFF_BASE_MS);
      expect(after?.lastError).toBe('boom');
      expect(after?.lockedBy).toBeNull();

      await jobs.claim('w', after!.runAt); // attempt 2 = max
      after = await jobs.fail(job.id, 'boom again', after!.runAt + 5);
      expect(after?.status).toBe('failed');
      expect(after?.finishedAt).toBe(after!.runAt + 5);
      expect(after?.dedupeKey).toBeNull();
    });

    it('complete marks succeeded and only from running', async () => {
      const jobs = jobsRepo(t.meta);
      const job = await jobs.enqueue({ kind: 'x', payload: {} }, T0);
      expect(await jobs.complete(job.id, T0)).toBe(false); // not running yet
      await jobs.claim('w', T0);
      expect(await jobs.complete(job.id, T0 + 1)).toBe(true);
      expect((await jobs.findById(job.id))?.status).toBe('succeeded');
    });

    it('cancel works on pending jobs only', async () => {
      const jobs = jobsRepo(t.meta);
      const job = await jobs.enqueue({ kind: 'x', payload: {} }, T0);
      expect(await jobs.cancel(job.id, T0)).toBe(true);
      expect(await jobs.cancel(job.id, T0)).toBe(false);
      expect((await jobs.findById(job.id))?.status).toBe('cancelled');
    });

    it('gc keeps failed jobs twice as long as succeeded ones', async () => {
      const jobs = jobsRepo(t.meta);
      const ok = await jobs.enqueue({ kind: 'ok', payload: {} }, T0);
      await jobs.claim('w', T0);
      await jobs.complete(ok.id, T0);

      const bad = await jobs.enqueue({ kind: 'bad', payload: {}, maxAttempts: 1 }, T0);
      await jobs.claim('w', T0);
      await jobs.fail(bad.id, 'x', T0);

      const days = 86_400_000;
      // 31 days later: succeeded goes, failed (2× window) stays.
      expect(await jobs.gc(T0 + 31 * days, 30)).toBe(1);
      expect((await jobs.findById(ok.id))).toBeNull();
      expect((await jobs.findById(bad.id))?.status).toBe('failed');
      // 61 days later: failed goes too.
      expect(await jobs.gc(T0 + 61 * days, 30)).toBe(1);
      expect(await jobs.findById(bad.id)).toBeNull();
    });
  });
}
