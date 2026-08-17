// SPDX-License-Identifier: AGPL-3.0-only
/**
 * JobWorker over the sqlite meta queue (M2-T07): claim → run → complete,
 * progress fan-out on `jobs:<id>`, exponential backoff → dead-letter, the
 * portable UPDATE-guard claim race, cooperative cancel, and graceful drain.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createJobRegistry, NOOP_PROGRESS_KIND } from '../src/jobs/registry.js';
import { JobWorker, JOB_BACKOFF_MAX_MS, jobChannel } from '../src/jobs/worker.js';
import { collectChannel, makeJobsContext, sleep, until } from './jobs-helpers.js';

describe('JobWorker — happy path', () => {
  it('runs noop-progress to completion with progress events on jobs:<id>', async () => {
    const ctx = await makeJobsContext();
    const job = await ctx.jobs.enqueue(
      { kind: NOOP_PROGRESS_KIND, payload: { steps: 4, userId: 'user_owner' } },
      ctx.clock.now(),
    );
    const { events } = collectChannel(ctx.hub, jobChannel(job.id));

    const ran = await ctx.worker.runOnce();
    expect(ran).toBe(1);

    const row = await ctx.jobs.findById(job.id);
    expect(row?.status).toBe('succeeded');
    expect(row?.attempts).toBe(1);
    expect(row?.finishedAt).toBe(ctx.clock.now());
    expect(row?.lockedBy).toBeNull();

    const progressPcts = events
      .filter((e) => e.type === 'progress')
      .map((e) => (e.data as { pct: number }).pct);
    expect(progressPcts).toEqual([0, 25, 50, 75, 100]);
    expect(events.at(-1)?.type).toBe('completed');
    expect(events.every((e) => e.channel === jobChannel(job.id))).toBe(true);
    // ts is ISO-8601 from the injected clock.
    expect(events[0]?.ts).toBe(new Date(ctx.clock.now()).toISOString());

    // The route reads progress from the worker (01 §5 in-process model).
    expect(ctx.worker.getProgress(job.id)).toEqual({ pct: 100 });
  });

  it('never executes more than `concurrency` jobs at once', async () => {
    const registry = createJobRegistry();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    registry.registerJobHandler('gated', z.object({}).loose(), async () => {
      await gate;
    });
    const ctx = await makeJobsContext({ registry, concurrency: 2 });
    for (let i = 0; i < 3; i += 1) {
      await ctx.jobs.enqueue({ kind: 'gated', payload: {} }, ctx.clock.now());
    }

    const pass = ctx.worker.runOnce();
    await until(() => ctx.worker.activeCount === 2);
    // Both slots busy — the third job stays pending and unclaimed.
    await sleep(20);
    expect(ctx.worker.activeCount).toBe(2);
    const pending = await ctx.meta.db
      .selectFrom('adminium_jobs')
      .selectAll()
      .where('status', '=', 'pending')
      .execute();
    expect(pending).toHaveLength(1);

    release();
    expect(await pass).toBe(2);
    expect(await ctx.worker.runOnce()).toBe(1);
    expect(await ctx.worker.runOnce()).toBe(0);
  });
});

describe('JobWorker — failure, backoff, dead-letter', () => {
  function failingRegistry() {
    const registry = createJobRegistry();
    registry.registerJobHandler('always-fail', z.object({}).loose(), () => {
      throw new Error('boom');
    });
    return registry;
  }

  it('retries with 30s-base exponential backoff, then dead-letters at maxAttempts', async () => {
    const ctx = await makeJobsContext({ registry: failingRegistry() });
    const job = await ctx.jobs.enqueue(
      { kind: 'always-fail', payload: {}, maxAttempts: 3 },
      ctx.clock.now(),
    );
    const { events } = collectChannel(ctx.hub, jobChannel(job.id));

    // Attempt 1 → pending again, due in 30 s.
    await ctx.worker.runOnce();
    let row = await ctx.jobs.findById(job.id);
    expect(row?.status).toBe('pending');
    expect(row?.attempts).toBe(1);
    expect(row?.runAt).toBe(ctx.clock.now() + 30_000);
    expect(row?.lastError).toContain('boom');

    // Not due yet — nothing claimable.
    expect(await ctx.worker.runOnce()).toBe(0);

    // Attempt 2 → 60 s backoff (doubling).
    ctx.clock.advance(30_000);
    await ctx.worker.runOnce();
    row = await ctx.jobs.findById(job.id);
    expect(row?.status).toBe('pending');
    expect(row?.attempts).toBe(2);
    expect(row?.runAt).toBe(ctx.clock.now() + 60_000);

    // Attempt 3 = maxAttempts → terminal failed (dead-letter).
    ctx.clock.advance(60_000);
    await ctx.worker.runOnce();
    row = await ctx.jobs.findById(job.id);
    expect(row?.status).toBe('failed');
    expect(row?.attempts).toBe(3);
    expect(row?.finishedAt).toBe(ctx.clock.now());
    expect(row?.lockedBy).toBeNull();

    const failedFrames = events.filter((e) => e.type === 'failed');
    expect(failedFrames).toHaveLength(3);
    expect(failedFrames.map((e) => (e.data as { final: boolean }).final)).toEqual([
      false,
      false,
      true,
    ]);
    expect((failedFrames[0]?.data as { error: string }).error).toContain('boom');
    // Dead job stays dead: nothing further is claimable.
    ctx.clock.advance(JOB_BACKOFF_MAX_MS);
    expect(await ctx.worker.runOnce()).toBe(0);
  });

  it('caps the retry delay at backoffMaxMs', async () => {
    const ctx = await makeJobsContext({
      registry: failingRegistry(),
      backoffMaxMs: 100_000,
    });
    const job = await ctx.jobs.enqueue(
      { kind: 'always-fail', payload: {}, maxAttempts: 4 },
      ctx.clock.now(),
    );

    await ctx.worker.runOnce(); // attempt 1 → +30s
    ctx.clock.advance(30_000);
    await ctx.worker.runOnce(); // attempt 2 → +60s
    ctx.clock.advance(60_000);
    await ctx.worker.runOnce(); // attempt 3 → min(120s, 100s) = 100s

    const row = await ctx.jobs.findById(job.id);
    expect(row?.status).toBe('pending');
    expect(row?.attempts).toBe(3);
    expect(row?.runAt).toBe(ctx.clock.now() + 100_000);
  });

  it('dead-letters a job whose payload no longer parses', async () => {
    const ctx = await makeJobsContext();
    // steps: 0 violates the noop-progress schema (min 1).
    const job = await ctx.jobs.enqueue(
      { kind: NOOP_PROGRESS_KIND, payload: { steps: 0 }, maxAttempts: 1 },
      ctx.clock.now(),
    );
    await ctx.worker.runOnce();
    const row = await ctx.jobs.findById(job.id);
    expect(row?.status).toBe('failed');
    expect(row?.lastError).not.toBeNull();
  });

  it('dead-letters a job with no registered handler', async () => {
    const ctx = await makeJobsContext();
    const job = await ctx.jobs.enqueue(
      { kind: 'ghost-kind', payload: {}, maxAttempts: 1 },
      ctx.clock.now(),
    );
    await ctx.worker.runOnce();
    const row = await ctx.jobs.findById(job.id);
    expect(row?.status).toBe('failed');
    expect(row?.lastError).toContain('no handler registered');
  });
});

describe('JobWorker — claim race (portable UPDATE guard)', () => {
  it('two workers race for one job; exactly one executes it', async () => {
    const registry = createJobRegistry();
    let runs = 0;
    registry.registerJobHandler('slow', z.object({}).loose(), async () => {
      runs += 1;
      await sleep(20);
    });
    const ctx = await makeJobsContext({ registry, workerId: 'host-a:1' });
    const workerB = new JobWorker({
      meta: ctx.meta,
      registry,
      hub: ctx.hub,
      now: ctx.clock.now,
      workerId: 'host-b:2',
    });

    const job = await ctx.jobs.enqueue({ kind: 'slow', payload: {} }, ctx.clock.now());
    const [ranA, ranB] = await Promise.all([ctx.worker.runOnce(), workerB.runOnce()]);

    expect(ranA + ranB).toBe(1); // the UPDATE guard let exactly one claim win
    expect(runs).toBe(1);
    const row = await ctx.jobs.findById(job.id);
    expect(row?.status).toBe('succeeded');
    expect(row?.attempts).toBe(1);
  });
});

describe('JobWorker — cancellation and drain', () => {
  it('cooperative cancel aborts a running job into terminal cancelled', async () => {
    const ctx = await makeJobsContext();
    const job = await ctx.jobs.enqueue(
      {
        kind: NOOP_PROGRESS_KIND,
        payload: { steps: 50, stepDelayMs: 10, userId: 'user_owner' },
      },
      ctx.clock.now(),
    );
    const { events } = collectChannel(ctx.hub, jobChannel(job.id));

    const pass = ctx.worker.runOnce();
    await until(() => events.some((e) => e.type === 'progress'));
    expect(ctx.worker.requestCancel(job.id)).toBe(true);
    await pass;

    const row = await ctx.jobs.findById(job.id);
    expect(row?.status).toBe('cancelled');
    expect(row?.finishedAt).toBe(ctx.clock.now());
    expect(events.at(-1)?.type).toBe('cancelled');
    // Cancelling a job we are not running reports false.
    expect(ctx.worker.requestCancel(job.id)).toBe(false);
  });

  it('stop() drains an in-flight job to completion', async () => {
    const ctx = await makeJobsContext();
    const job = await ctx.jobs.enqueue(
      { kind: NOOP_PROGRESS_KIND, payload: { steps: 3, stepDelayMs: 10 } },
      ctx.clock.now(),
    );

    void ctx.worker.runOnce();
    await until(() => ctx.worker.activeCount === 1);
    await ctx.worker.stop();

    expect(ctx.worker.activeCount).toBe(0);
    const row = await ctx.jobs.findById(job.id);
    expect(row?.status).toBe('succeeded');
  });

  it('stop() aborts stragglers after the drain timeout', async () => {
    const registry = createJobRegistry();
    registry.registerJobHandler('stubborn', z.object({}).loose(), async (_payload, jobCtx) => {
      // Only exits via the abort signal.
      while (!jobCtx.signal.aborted) await sleep(5);
      throw new Error('aborted');
    });
    const ctx = await makeJobsContext({ registry });
    const job = await ctx.jobs.enqueue({ kind: 'stubborn', payload: {} }, ctx.clock.now());

    void ctx.worker.runOnce();
    await until(() => ctx.worker.activeCount === 1);
    await ctx.worker.stop({ drainTimeoutMs: 20 });

    expect(ctx.worker.activeCount).toBe(0);
    const row = await ctx.jobs.findById(job.id);
    expect(row?.status).toBe('cancelled');
  });
});
