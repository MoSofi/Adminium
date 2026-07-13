/**
 * JobScheduler (croner) — registration, jitter, and the no-overlap guard
 * (M2-T07). `croner` is declared by this wave's integration (the auth agent
 * owns apps/server/package.json), so the suite self-skips until the package
 * is installed and auto-activates afterwards.
 */
import { describe, expect, it } from 'vitest';

import { NOOP_PROGRESS_KIND } from '../src/jobs/registry.js';
import { makeJobsContext } from './jobs-helpers.js';

// Dynamic import: `src/jobs/scheduler.ts` pulls in croner at module load.
const schedulerModule = await import('../src/jobs/scheduler.js').catch(() => null);

describe.skipIf(schedulerModule === null)('JobScheduler', () => {
  if (schedulerModule === null) return;
  const { JobScheduler, SCHEDULER_TIMEZONE } = schedulerModule;

  it('runs in UTC until settings-driven timezones land', () => {
    expect(SCHEDULER_TIMEZONE).toBe('UTC');
  });

  it('rejects invalid cron expressions and duplicate names at registration', async () => {
    const ctx = await makeJobsContext();
    const scheduler = new JobScheduler({ jobs: ctx.jobs });
    expect(() => scheduler.registerSchedule('bad', 'not a cron', async () => {})).toThrow();
    scheduler.registerSchedule('nightly', '0 3 * * *', async () => {});
    expect(() => scheduler.registerSchedule('nightly', '0 4 * * *', async () => {})).toThrow(
      /already registered/,
    );
    expect(scheduler.names()).toEqual(['nightly']);
    scheduler.stop();
  });

  it('exposes the next run after start()', async () => {
    const ctx = await makeJobsContext();
    const scheduler = new JobScheduler({ jobs: ctx.jobs });
    scheduler.registerSchedule('nightly', '0 3 * * *', async () => {});
    scheduler.start();
    const next = scheduler.nextRun('nightly');
    expect(next).toBeInstanceOf(Date);
    expect(next!.getUTCHours()).toBe(3);
    scheduler.stop();
  });

  it('skips the tick while the previously enqueued job is pending/running', async () => {
    const ctx = await makeJobsContext();
    const scheduler = new JobScheduler({ jobs: ctx.jobs });
    scheduler.registerSchedule('report', '*/5 * * * *', async () =>
      ctx.jobs.enqueue({ kind: NOOP_PROGRESS_KIND, payload: { steps: 1 } }, ctx.clock.now()),
    );

    // First tick enqueues.
    const first = await scheduler.trigger('report');
    expect(first.status).toBe('enqueued');
    const firstJobId = (first as { jobId: string }).jobId;
    expect(firstJobId).toBeTruthy();

    // Previous job still pending → skip (no second row).
    const second = await scheduler.trigger('report');
    expect(second).toEqual({ status: 'skipped-overlap', jobId: firstJobId });

    // While running → still skip.
    const claimed = await ctx.jobs.claim('sched-test:1', ctx.clock.now());
    expect(claimed?.id).toBe(firstJobId);
    const third = await scheduler.trigger('report');
    expect(third.status).toBe('skipped-overlap');

    // Once terminal, the next tick enqueues a fresh job.
    await ctx.jobs.complete(firstJobId, ctx.clock.now());
    const fourth = await scheduler.trigger('report');
    expect(fourth.status).toBe('enqueued');
    expect((fourth as { jobId: string }).jobId).not.toBe(firstJobId);
    scheduler.stop();
  });

  it('guards against a slow enqueue overlapping the next tick (in-flight)', async () => {
    const ctx = await makeJobsContext();
    const scheduler = new JobScheduler({ jobs: ctx.jobs });
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    scheduler.registerSchedule('slow', '* * * * *', async () => {
      await gate;
      return await ctx.jobs.enqueue(
        { kind: NOOP_PROGRESS_KIND, payload: { steps: 1 } },
        ctx.clock.now(),
      );
    });

    const first = scheduler.trigger('slow');
    // Give the first trigger a beat to enter the enqueue.
    await new Promise((resolve) => setTimeout(resolve, 10));
    const second = await scheduler.trigger('slow');
    expect(second).toEqual({ status: 'skipped-inflight' });

    release();
    expect((await first).status).toBe('enqueued');
    scheduler.stop();
  });

  it('applies jitter before enqueueing', async () => {
    const ctx = await makeJobsContext();
    const scheduler = new JobScheduler({ jobs: ctx.jobs, random: () => 1 });
    let enqueuedAt = 0;
    scheduler.registerSchedule(
      'jittered',
      '* * * * *',
      async () => {
        enqueuedAt = Date.now();
        return await ctx.jobs.enqueue(
          { kind: NOOP_PROGRESS_KIND, payload: { steps: 1 } },
          ctx.clock.now(),
        );
      },
      { jitterMs: 40 },
    );

    const before = Date.now();
    const result = await scheduler.trigger('jittered');
    expect(result.status).toBe('enqueued');
    // random() = 1 → full 40 ms jitter (allow scheduling slack).
    expect(enqueuedAt - before).toBeGreaterThanOrEqual(30);
    scheduler.stop();
  });

  it('unknown schedule names throw on trigger', async () => {
    const ctx = await makeJobsContext();
    const scheduler = new JobScheduler({ jobs: ctx.jobs });
    await expect(scheduler.trigger('ghost')).rejects.toThrow(/unknown schedule/);
  });
});
