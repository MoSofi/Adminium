/**
 * Croner-based schedule registry (08-server-api.md §2 jobs plugin, BRIEF §3:
 * croner + no Redis; M2-T07). Each named schedule fires an enqueue function;
 * a no-overlap guard skips the tick when the previously enqueued job is
 * still pending/running, and optional jitter de-synchronizes fleets.
 *
 * Timezone is fixed to UTC for now — it becomes settings-driven
 * (`adminium_settings`) in a later wave (10-i18n-theming.md).
 */

import { Cron } from 'croner';

import type { Job } from '@adminium/meta';

import type { WorkerLogger } from './worker.js';

/** Default scheduler timezone until settings wiring lands. */
export const SCHEDULER_TIMEZONE = 'UTC';

/** Enqueue callback: returns the created job (or null/void when skipped). */
export type ScheduleEnqueue = () => Promise<{ id: string } | null | undefined | void>;

export interface RegisterScheduleOptions {
  /** Random 0..jitterMs delay before enqueueing; default scheduler-wide value. */
  jitterMs?: number | undefined;
}

export type ScheduleTriggerResult =
  | { status: 'enqueued'; jobId: string | null }
  | { status: 'skipped-overlap'; jobId: string }
  | { status: 'skipped-inflight' };

export interface JobSchedulerOptions {
  /** Status lookup for the no-overlap guard (`jobsRepo` satisfies it). */
  jobs: { findById(id: string): Promise<Job | null> };
  /** IANA zone for cron evaluation; default UTC (settings-driven later). */
  timezone?: string | undefined;
  /** Default jitter applied to every schedule; default 0. */
  defaultJitterMs?: number | undefined;
  logger?: WorkerLogger | undefined;
  /** Injectable randomness for deterministic jitter tests. */
  random?: (() => number) | undefined;
}

interface ScheduleEntry {
  name: string;
  cronExpr: string;
  enqueue: ScheduleEnqueue;
  jitterMs: number;
  cron: Cron;
  /** Guard against a slow enqueue overlapping the next tick. */
  inFlight: boolean;
  /** Last job this schedule enqueued — checked for pending/running overlap. */
  lastJobId: string | null;
}

const noopLogger: WorkerLogger = { info() {}, warn() {}, error() {} };

export class JobScheduler {
  private readonly jobs: JobSchedulerOptions['jobs'];
  private readonly timezone: string;
  private readonly defaultJitterMs: number;
  private readonly logger: WorkerLogger;
  private readonly random: () => number;
  private readonly schedules = new Map<string, ScheduleEntry>();
  private started = false;

  constructor(opts: JobSchedulerOptions) {
    this.jobs = opts.jobs;
    this.timezone = opts.timezone ?? SCHEDULER_TIMEZONE;
    this.defaultJitterMs = opts.defaultJitterMs ?? 0;
    this.logger = opts.logger ?? noopLogger;
    this.random = opts.random ?? Math.random;
  }

  /**
   * Register a named cron schedule. The Cron instance is created immediately
   * (invalid expressions throw here) but stays paused until `start()`.
   */
  registerSchedule(
    name: string,
    cronExpr: string,
    enqueue: ScheduleEnqueue,
    opts: RegisterScheduleOptions = {},
  ): void {
    if (this.schedules.has(name)) {
      throw new Error(`schedule "${name}" is already registered`);
    }
    const cron = new Cron(
      cronExpr,
      {
        name,
        paused: true,
        timezone: this.timezone,
        // croner's own overlap guard for the callback itself; the job-status
        // guard in trigger() covers the enqueued job's lifetime.
        protect: true,
        catch: (err: unknown) => {
          this.logger.error({ schedule: name, err }, 'schedule tick failed');
        },
      },
      () => {
        void this.trigger(name).catch((err: unknown) => {
          this.logger.error({ schedule: name, err }, 'schedule trigger failed');
        });
      },
    );
    this.schedules.set(name, {
      name,
      cronExpr,
      enqueue,
      jitterMs: opts.jitterMs ?? this.defaultJitterMs,
      cron,
      inFlight: false,
      lastJobId: null,
    });
    if (this.started) cron.resume();
  }

  /** Resume all schedules; schedules registered later start immediately. */
  start(): void {
    this.started = true;
    for (const entry of this.schedules.values()) entry.cron.resume();
  }

  /** Stop every cron; safe to call repeatedly. */
  stop(): void {
    this.started = false;
    for (const entry of this.schedules.values()) entry.cron.stop();
  }

  names(): string[] {
    return [...this.schedules.keys()];
  }

  /** Next run time of a schedule, or null when stopped/unknown. */
  nextRun(name: string): Date | null {
    return this.schedules.get(name)?.cron.nextRun() ?? null;
  }

  /**
   * The guarded fire path — called by cron ticks and directly by tests.
   * Skips when the previous enqueued job is still pending/running (no
   * overlap) or when a previous tick's enqueue has not returned yet.
   */
  async trigger(name: string): Promise<ScheduleTriggerResult> {
    const entry = this.schedules.get(name);
    if (entry === undefined) throw new Error(`unknown schedule "${name}"`);

    if (entry.inFlight) return { status: 'skipped-inflight' };

    if (entry.lastJobId !== null) {
      const previous = await this.jobs.findById(entry.lastJobId);
      if (previous !== null && (previous.status === 'pending' || previous.status === 'running')) {
        this.logger.info(
          { schedule: name, jobId: entry.lastJobId, status: previous.status },
          'schedule tick skipped — previous job still active',
        );
        return { status: 'skipped-overlap', jobId: entry.lastJobId };
      }
    }

    entry.inFlight = true;
    try {
      if (entry.jitterMs > 0) {
        await sleep(Math.floor(this.random() * entry.jitterMs));
      }
      const job = await entry.enqueue();
      entry.lastJobId = job?.id ?? null;
      return { status: 'enqueued', jobId: entry.lastJobId };
    } finally {
      entry.inFlight = false;
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}
