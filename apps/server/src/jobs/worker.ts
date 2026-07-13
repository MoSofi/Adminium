/**
 * In-process polling worker over `adminium_jobs` (01-architecture.md §5
 * background path, 07-meta-store.md §3.12, M2-T07).
 *
 * Loop: claim via the portable UPDATE guard (`jobsRepo.claim`) → parse the
 * payload against the registered handler's schema → run the handler with a
 * progress/log/cancel context → `complete` or `fail` with exponential backoff
 * (base 30 s, doubling, capped at 1 h) until `maxAttempts`, after which the
 * row lands in terminal `failed` (the dead-letter state). One failing job
 * never kills the process (08-server-api.md §6.10); `stop()` drains in-flight
 * jobs before resolving (graceful shutdown).
 *
 * Progress is kept in-memory (`getProgress`) and published on `jobs:<jobId>`
 * — the meta schema has no progress column in wave 0001, and the worker runs
 * in-process with the API (01 §5), so route reads stay consistent.
 */

import { hostname } from 'node:os';

import { jobsRepo, JOB_BACKOFF_BASE_MS, type Job, type JobsRepo, type MetaDb } from '@adminium/meta';

import type { RealtimeHub } from '../realtime/hub.js';
import type { JobHandlerContext, JobProgress, JobRegistry } from './registry.js';

/** Backoff ceiling: no retry waits longer than an hour. */
export const JOB_BACKOFF_MAX_MS = 3_600_000;

/** Default number of jobs executing concurrently in one worker. */
export const JOB_WORKER_CONCURRENCY = 2;

/** Default idle delay between claim polls. */
export const JOB_POLL_INTERVAL_MS = 1_000;

/** How many finished-job progress snapshots to retain for route reads. */
const PROGRESS_RETENTION = 500;

/** Minimal structured logger (satisfied by `app.log` / pino). */
export interface WorkerLogger {
  info(obj: Record<string, unknown>, msg?: string): void;
  warn(obj: Record<string, unknown>, msg?: string): void;
  error(obj: Record<string, unknown>, msg?: string): void;
}

export interface JobWorkerOptions {
  meta: MetaDb;
  registry: JobRegistry;
  hub: RealtimeHub;
  /** Parallel job slots; default {@link JOB_WORKER_CONCURRENCY}. */
  concurrency?: number | undefined;
  /** Idle poll delay; default {@link JOB_POLL_INTERVAL_MS}. */
  pollIntervalMs?: number | undefined;
  /** `<hostname>:<pid>` per §3.12 unless overridden (tests). */
  workerId?: string | undefined;
  /** First-retry delay; default 30 s (§3.12 / repo constant). */
  backoffBaseMs?: number | undefined;
  /** Retry-delay ceiling; default 1 h. */
  backoffMaxMs?: number | undefined;
  /** Clock, injectable for deterministic backoff tests. */
  now?: (() => number) | undefined;
  logger?: WorkerLogger | undefined;
}

interface RunningJob {
  controller: AbortController;
  promise: Promise<void>;
}

const noopLogger: WorkerLogger = { info() {}, warn() {}, error() {} };

/** Channel name for a job's realtime events. */
export function jobChannel(jobId: string): string {
  return `jobs:${jobId}`;
}

export class JobWorker {
  private readonly meta: MetaDb;
  private readonly jobs: JobsRepo;
  private readonly registry: JobRegistry;
  private readonly hub: RealtimeHub;
  private readonly concurrency: number;
  private readonly pollIntervalMs: number;
  private readonly backoffBaseMs: number;
  private readonly backoffMaxMs: number;
  private readonly now: () => number;
  private readonly logger: WorkerLogger;
  readonly workerId: string;

  private readonly running = new Map<string, RunningJob>();
  private readonly progressByJob = new Map<string, JobProgress>();
  private stopped = true;
  private pollTimer: NodeJS.Timeout | null = null;

  constructor(opts: JobWorkerOptions) {
    this.meta = opts.meta;
    this.jobs = jobsRepo(opts.meta);
    this.registry = opts.registry;
    this.hub = opts.hub;
    this.concurrency = opts.concurrency ?? JOB_WORKER_CONCURRENCY;
    this.pollIntervalMs = opts.pollIntervalMs ?? JOB_POLL_INTERVAL_MS;
    this.backoffBaseMs = opts.backoffBaseMs ?? JOB_BACKOFF_BASE_MS;
    this.backoffMaxMs = opts.backoffMaxMs ?? JOB_BACKOFF_MAX_MS;
    this.now = opts.now ?? Date.now;
    this.logger = opts.logger ?? noopLogger;
    this.workerId = opts.workerId ?? `${hostname()}:${process.pid}`;
  }

  /** Jobs currently executing in this worker. */
  get activeCount(): number {
    return this.running.size;
  }

  /** Last reported progress for a job known to this process, else `null`. */
  getProgress(jobId: string): JobProgress | null {
    return this.progressByJob.get(jobId) ?? null;
  }

  /**
   * Cooperative cancel (08 §2.17): aborts the run's signal if this worker is
   * executing the job. Returns whether a running job was signalled.
   */
  requestCancel(jobId: string): boolean {
    const entry = this.running.get(jobId);
    if (entry === undefined) return false;
    entry.controller.abort();
    return true;
  }

  /** Start the poll loop; idempotent. */
  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.schedulePoll(0);
  }

  /**
   * Graceful drain: stop claiming, wait up to `drainTimeoutMs` for in-flight
   * jobs, then abort stragglers and wait for them to settle.
   */
  async stop(opts: { drainTimeoutMs?: number } = {}): Promise<void> {
    this.stopped = true;
    if (this.pollTimer !== null) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    const drainTimeoutMs = opts.drainTimeoutMs ?? 10_000;
    const inFlight = () => [...this.running.values()].map((r) => r.promise);
    if (this.running.size === 0) return;
    const drained = await withTimeout(Promise.all(inFlight()), drainTimeoutMs);
    if (!drained) {
      this.logger.warn(
        { workerId: this.workerId, jobs: [...this.running.keys()] },
        'drain timeout — aborting in-flight jobs',
      );
      for (const entry of this.running.values()) entry.controller.abort();
      await Promise.all(inFlight());
    }
  }

  /**
   * Deterministic single pass (tests/manual ticks): claims due jobs up to the
   * concurrency limit and resolves when all of them finished. Returns how
   * many jobs this call executed.
   */
  async runOnce(): Promise<number> {
    const batch: Promise<void>[] = [];
    while (this.running.size < this.concurrency) {
      const job = await this.jobs.claim(this.workerId, this.now());
      if (job === null) break;
      batch.push(this.launch(job));
    }
    await Promise.all(batch);
    return batch.length;
  }

  // --- internals -----------------------------------------------------------------

  private schedulePoll(delayMs: number): void {
    if (this.stopped) return;
    this.pollTimer = setTimeout(() => {
      void this.poll();
    }, delayMs);
    this.pollTimer.unref?.();
  }

  private async poll(): Promise<void> {
    if (this.stopped) return;
    try {
      while (!this.stopped && this.running.size < this.concurrency) {
        const job = await this.jobs.claim(this.workerId, this.now());
        if (job === null) break;
        void this.launch(job);
      }
    } catch (err) {
      // e.g. meta DB briefly unreachable — log and keep polling (§6.10).
      this.logger.error({ workerId: this.workerId, err }, 'job poll failed');
    }
    this.schedulePoll(this.pollIntervalMs);
  }

  /** Registers the job as running and executes it; never rejects. */
  private launch(job: Job): Promise<void> {
    const controller = new AbortController();
    const promise = this.execute(job, controller)
      .catch((err: unknown) => {
        // `execute` handles handler errors itself; this only catches bugs in
        // the completion/failure bookkeeping.
        this.logger.error({ jobId: job.id, kind: job.kind, err }, 'job bookkeeping failed');
      })
      .finally(() => {
        this.running.delete(job.id);
      });
    this.running.set(job.id, { controller, promise });
    return promise;
  }

  private async execute(job: Job, controller: AbortController): Promise<void> {
    const channel = jobChannel(job.id);
    try {
      const entry = this.registry.get(job.kind);
      if (entry === undefined) {
        throw new Error(`no handler registered for job kind "${job.kind}"`);
      }
      const payload = entry.schema.parse(job.payload);
      const ctx: JobHandlerContext = {
        jobId: job.id,
        kind: job.kind,
        attempt: job.attempts,
        maxAttempts: job.maxAttempts,
        signal: controller.signal,
        progress: (pct, info) => {
          this.reportProgress(job, pct, info);
        },
        log: (message, data = {}) => {
          this.logger.info({ jobId: job.id, kind: job.kind, ...data }, message);
        },
      };
      await entry.run(payload, ctx);
      if (controller.signal.aborted) {
        await this.markCancelled(job);
        return;
      }
      await this.jobs.complete(job.id, this.now());
      this.setProgress(job.id, { pct: 100 });
      this.hub.publish(channel, 'completed', { jobId: job.id, kind: job.kind }, this.now());
      this.logger.info({ jobId: job.id, kind: job.kind, attempt: job.attempts }, 'job succeeded');
    } catch (err) {
      if (controller.signal.aborted) {
        await this.markCancelled(job);
        return;
      }
      await this.handleFailure(job, err);
    }
  }

  /** Retry with capped exponential backoff, or dead-letter at maxAttempts. */
  private async handleFailure(job: Job, err: unknown): Promise<void> {
    const message = err instanceof Error ? err.message : String(err);
    const at = this.now();
    // Delay for retry n (attempts = n after claim): base * 2^(n-1), capped.
    // `jobsRepo.fail` recomputes `base' * 2^(n-1)`, so pass base' = delay / 2^(n-1).
    const exponent = 2 ** Math.max(0, job.attempts - 1);
    const delay = Math.min(this.backoffBaseMs * exponent, this.backoffMaxMs);
    const updated = await this.jobs.fail(job.id, message, at, delay / exponent);
    const dead = updated?.status === 'failed';
    this.hub.publish(
      jobChannel(job.id),
      'failed',
      {
        jobId: job.id,
        kind: job.kind,
        error: message,
        attempt: job.attempts,
        maxAttempts: job.maxAttempts,
        final: dead,
        nextRunAt: dead ? null : (updated?.runAt ?? null),
      },
      at,
    );
    const logData = { jobId: job.id, kind: job.kind, attempt: job.attempts, err: message };
    if (dead) this.logger.error(logData, 'job dead-lettered');
    else this.logger.warn(logData, 'job failed — will retry');
  }

  /**
   * Terminal `cancelled` for a job this worker was running (repo `cancel`
   * only covers pending rows). Guarded on our own lock so a reclaimed stale
   * job is never clobbered.
   */
  private async markCancelled(job: Job): Promise<void> {
    const at = this.now();
    await this.meta.db
      .updateTable('adminium_jobs')
      .set({ status: 'cancelled', finishedAt: at, dedupeKey: null, lockedBy: null, lockedAt: null })
      .where('id', '=', job.id)
      .where('status', '=', 'running')
      .where('lockedBy', '=', this.workerId)
      .execute();
    this.hub.publish(jobChannel(job.id), 'cancelled', { jobId: job.id, kind: job.kind }, at);
    this.logger.info({ jobId: job.id, kind: job.kind }, 'job cancelled');
  }

  private reportProgress(job: Job, pct: number, info?: { step?: string; message?: string }): void {
    const clamped = Math.max(0, Math.min(100, Math.round(pct)));
    const progress: JobProgress = { pct: clamped, step: info?.step, message: info?.message };
    this.setProgress(job.id, progress);
    this.hub.publish(
      jobChannel(job.id),
      'progress',
      { pct: clamped, step: info?.step ?? null, message: info?.message ?? null },
      this.now(),
    );
  }

  /** Insertion-ordered map as a tiny LRU: oldest snapshots fall off first. */
  private setProgress(jobId: string, progress: JobProgress): void {
    this.progressByJob.delete(jobId);
    this.progressByJob.set(jobId, progress);
    while (this.progressByJob.size > PROGRESS_RETENTION) {
      const oldest = this.progressByJob.keys().next().value;
      if (oldest === undefined) break;
      this.progressByJob.delete(oldest);
    }
  }
}

/** Resolves `true` when `promise` settles before `ms`, else `false`. */
async function withTimeout(promise: Promise<unknown>, ms: number): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise.then(() => true),
      new Promise<false>((resolve) => {
        timer = setTimeout(() => resolve(false), ms);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
