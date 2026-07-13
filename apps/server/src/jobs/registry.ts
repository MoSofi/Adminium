/**
 * Typed job-handler registry (08-server-api.md §2.17 job kinds, M2-T07).
 * Each kind pairs a Zod payload schema with an async handler; the worker
 * parses the stored payload against the schema before every run (the queue
 * row is `json` — 07-meta-store.md §3.12 "Zod-validated by the worker").
 */

import { setTimeout as sleep } from 'node:timers/promises';

import { z, type ZodType } from 'zod';

/** Last reported progress of a job (08 §3 `progress` event data). */
export interface JobProgress {
  /** Integer 0–100. */
  pct: number;
  step?: string | undefined;
  message?: string | undefined;
}

/** Per-run context handed to a handler alongside its parsed payload. */
export interface JobHandlerContext {
  jobId: string;
  kind: string;
  /** 1-based attempt number (equals the row's `attempts` after claim). */
  attempt: number;
  maxAttempts: number;
  /**
   * Cooperative cancellation (08 §2.17): aborted by `POST /jobs/:id/cancel`
   * and by worker drain timeouts. Handlers check it between batches.
   */
  signal: AbortSignal;
  /** Report progress: persisted by the worker and published on `jobs:<id>`. */
  progress(pct: number, info?: { step?: string; message?: string }): void;
  /** Structured log line under the worker's logger, tagged with the job id. */
  log(message: string, data?: Record<string, unknown>): void;
}

/** A job handler: parsed payload in, optional result out (result unused in M2). */
export type JobHandler<T> = (payload: T, ctx: JobHandlerContext) => Promise<unknown> | unknown;

export interface RegisteredJobHandler {
  kind: string;
  schema: ZodType<unknown>;
  handler: JobHandler<never>;
  /** Run the handler with an already-`schema`-parsed payload. */
  run(parsedPayload: unknown, ctx: JobHandlerContext): Promise<unknown>;
}

/** Creates an isolated registry (one per server; fresh per test). */
export function createJobRegistry() {
  const handlers = new Map<string, RegisteredJobHandler>();

  return {
    /** Register `handler` for `kind`; duplicate kinds are a programmer error. */
    registerJobHandler<T>(kind: string, schema: ZodType<T>, handler: JobHandler<T>): void {
      if (kind.length === 0 || kind.length > 60) {
        throw new Error(`job kind must be 1–60 chars, got "${kind}"`);
      }
      if (handlers.has(kind)) {
        throw new Error(`job handler for kind "${kind}" is already registered`);
      }
      handlers.set(kind, {
        kind,
        schema,
        handler: handler as JobHandler<never>,
        run: async (parsedPayload, ctx) => await handler(parsedPayload as T, ctx),
      });
    },

    has(kind: string): boolean {
      return handlers.has(kind);
    },

    get(kind: string): RegisteredJobHandler | undefined {
      return handlers.get(kind);
    },

    kinds(): string[] {
      return [...handlers.keys()];
    },
  };
}

export type JobRegistry = ReturnType<typeof createJobRegistry>;

// --- demo handler ----------------------------------------------------------------

/** Kind of the built-in demo/progress-exercise handler. */
export const NOOP_PROGRESS_KIND = 'noop-progress';

/**
 * Payload of `noop-progress`: walks progress 0→100 in `steps` increments.
 * `failAttempts` makes the first N attempts throw (retry/backoff demos);
 * `stepDelayMs` spaces the steps out (cancellation demos).
 */
export const noopProgressPayloadSchema = z.object({
  steps: z.number().int().min(1).max(100).default(4),
  stepDelayMs: z.number().int().min(0).max(60_000).default(0),
  failAttempts: z.number().int().min(0).max(100).default(0),
  /** Owner convention: `payload.userId` marks the enqueuing user. */
  userId: z.string().optional(),
});
export type NoopProgressPayload = z.infer<typeof noopProgressPayloadSchema>;

/** Thrown by handlers that notice `ctx.signal` mid-run. */
export class JobCancelledError extends Error {
  override readonly name = 'JobCancelledError';

  constructor(jobId: string) {
    super(`job ${jobId} cancelled`);
  }
}

/** Registers the demo `noop-progress` handler (tests, dev demos). */
export function registerNoopProgressHandler(registry: JobRegistry): void {
  registry.registerJobHandler(NOOP_PROGRESS_KIND, noopProgressPayloadSchema, async (payload, ctx) => {
    if (ctx.attempt <= payload.failAttempts) {
      throw new Error(`noop-progress simulated failure (attempt ${ctx.attempt})`);
    }
    for (let step = 0; step <= payload.steps; step += 1) {
      if (ctx.signal.aborted) throw new JobCancelledError(ctx.jobId);
      const pct = Math.round((step / payload.steps) * 100);
      ctx.progress(pct, { step: `step-${step}`, message: `${step} of ${payload.steps} steps done` });
      if (payload.stepDelayMs > 0 && step < payload.steps) await sleep(payload.stepDelayMs);
    }
    return { steps: payload.steps };
  });
}
