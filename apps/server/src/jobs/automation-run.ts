// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The `automation.run` job — the queue side of one rule
 * execution.
 *
 * The payload is `{ runId }` and, on a resume, where to pick up. Nothing
 * else: the run ROW is the source of truth for what to do, which is what
 * makes the four producers (route matcher, watch poller, schedule scanner,
 * dry run) interchangeable — each of them creates a row and enqueues a
 * pointer to it.
 *
 * `maxAttempts: 1`, always. A retried run would repeat every side effect it
 * had already performed — a second welcome email, a second beneficiary row.
 * The queue's backoff is right for a job that is idempotent and wrong for one
 * that sends mail, so a run that throws is terminal with its reason on the
 * row, and re-running is an operator's decision.
 *
 * --- The status guard is the cancellation mechanism ------------------------
 *
 * `runs.start()` only moves `pending` or `waiting` to `running`. A run that
 * was skipped by an undo (D7) is already `skipped` when its job fires a
 * minute later, so `start()` returns false and the handler stops. That is
 * also why `onUndo` does not cancel the queue row: the status IS the
 * decision, and two ways of saying it could disagree.
 */

import { z } from 'zod';
import {
  automationRunsRepo,
  automationsRepo,
  type MetaDb,
} from '@adminium/meta';

import { walkRule, type RunnerDeps } from '../automations/runner.js';
import { AUTOMATION_RUN_KIND } from '../automations/kinds.js';
import type { JobHandlerContext, JobRegistry } from './registry.js';
import type { EnqueueJobInput, Job } from '@adminium/meta';

export { AUTOMATION_RUN_KIND };

/** See the header. */
export const AUTOMATION_RUN_MAX_ATTEMPTS = 1;

export const automationRunPayloadSchema = z.object({
  runId: z.string().min(1).max(36),
  /** Index path into the graph; absent starts at the trigger (D8). */
  resume: z.array(z.number().int().min(0)).max(8).optional(),
});
export type AutomationRunPayload = z.infer<typeof automationRunPayloadSchema>;

export interface AutomationRunDeps extends RunnerDeps {
  meta: MetaDb;
  enqueue(input: EnqueueJobInput): Promise<Job>;
}

export function registerAutomationRunHandler(registry: JobRegistry, deps: AutomationRunDeps): void {
  registry.registerJobHandler(
    AUTOMATION_RUN_KIND,
    automationRunPayloadSchema,
    async (payload, ctx: JobHandlerContext) => {
      const now = deps.now ?? Date.now;
      const runs = automationRunsRepo(deps.meta);
      const run = await runs.findById(payload.runId);
      // Swept by retention, or the rule was deleted and took its runs with it.
      if (run === null) return { runId: payload.runId, status: 'gone' };

      const rule = await automationsRepo(deps.meta).findById(run.automationId);
      if (rule === null) return { runId: run.id, status: 'gone' };

      // Undone, cancelled, or already walked — see the header.
      if (!(await runs.start(run.id))) return { runId: run.id, status: run.status };

      // A rule switched off while a run of it was waiting does not resume: the
      // operator turned it off, and finishing anyway is the opposite of what
      // they asked.
      if (!rule.enabled && payload.resume !== undefined) {
        const trace = run.trace ?? { version: 1 as const, steps: [], resume: null };
        await runs.finish(
          run.id,
          {
            status: 'cancelled',
            trace: { ...trace, resume: null },
            error: 'rule disabled',
            durationMs: 0,
          },
          now(),
        );
        return { runId: run.id, status: 'cancelled' };
      }

      const total = rule.graph.nodes.length;
      const outcome = await walkRule(
        {
          ...deps,
          // Live progress on `jobs:<id>` while a long run walks, so a future
          // channel has something to carry.
          progress: (pct, message) => {
            ctx.progress(pct, { step: 'run', message });
          },
        },
        {
          rule,
          runId: run.id,
          event: run.triggerEvent,
          ...(payload.resume === undefined ? {} : { resume: payload.resume }),
          ...(run.trace === null ? {} : { trace: run.trace }),
        },
      );
      const done = outcome.trace.steps.length;
      ctx.progress(total === 0 ? 100 : Math.min(99, Math.round((done / total) * 100)), {
        step: 'run',
        message: outcome.trace.steps.at(-1)?.log ?? '',
      });

      if (outcome.kind === 'waiting') {
        await runs.wait(run.id, { wakeAt: outcome.wakeAt, trace: outcome.trace });
        // The queue row IS the timer (D8): nothing here holds one, so a
        // restart mid-wait costs nothing.
        const resumed = await deps.enqueue({
          kind: AUTOMATION_RUN_KIND,
          payload: { runId: run.id, resume: outcome.trace.resume ?? [] },
          runAt: outcome.wakeAt,
          dedupeKey: `run:${run.id}:resume:${String(outcome.trace.steps.length)}`,
          maxAttempts: AUTOMATION_RUN_MAX_ATTEMPTS,
        });
        await runs.attachJob(run.id, resumed.id);
        return { runId: run.id, status: 'waiting', wakeAt: outcome.wakeAt };
      }

      await runs.finish(
        run.id,
        {
          status: outcome.status,
          trace: outcome.trace,
          error: outcome.error,
          durationMs: outcome.workMs,
        },
        now(),
      );
      await automationsRepo(deps.meta).advance(rule.id, { lastRunAt: now() });
      ctx.progress(100, { step: 'run', message: outcome.status });
      return { runId: run.id, status: outcome.status };
    },
    // INTERNAL: only the four producers may enqueue a run. `maxAttempts` is
    // not a registry concern — every producer passes it on the enqueue.
    { internal: true },
  );
}
