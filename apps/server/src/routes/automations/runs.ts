// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Workflow logs (`/api/v1/automation-runs`, 42-automations-and-workflow-
 * logs.md §3.1, D9, D22, 42-T15). Read-only, behind the same key the rules
 * pages use (D1) — a read-only `automations.read` is a residual (§10).
 *
 * --- The window is seven days, and that is a decision ---------------------
 *
 * The comp draws no date picker and calls its list "today" (Workflow Logs
 * 142-153). Seven days is the smallest window that still answers "did it run
 * over the weekend?", it is what the three filter counts are computed over,
 * and it means the list query is always bounded — which is the property that
 * keeps this page fast on an instance with a busy rule. A date range is a
 * residual, not an omission.
 *
 * --- Three filters over seven statuses (D9) ------------------------------
 *
 * The comp knows success / failed / running. The product also has `pending`
 * (waiting out the undo window), `waiting` (suspended mid-flow), `skipped`
 * and `cancelled`. "Running" counts the first three of those as one, because
 * from an operator's point of view they are the same thing: work that has not
 * finished. `skipped` and `cancelled` appear under All with their own glyph.
 */

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  automationRunsRepo,
  automationsRepo,
  type AutomationRun,
  type MetaDb,
} from '@adminium/meta';

import { auditExempt } from '../../audit/coverage.js';
import { NotFoundError } from '../../errors.js';
import { PERMISSIONS } from '../../rbac/permissions.js';
import {
  automationRunIdParams,
  automationRunReply,
  automationRunStatsReply,
  automationRunsListQuery,
  automationRunsListReply,
} from './schema.js';
import { dayBoundsFor, DAY_MS } from './time.js';

export interface AutomationRunsRoutesDeps {
  meta: MetaDb;
  now?: (() => number) | undefined;
}

/** The comp's list window (D22). */
export const RUNS_WINDOW_MS = 7 * DAY_MS;
export const RUNS_PAGE_SIZE = 50;

/** `record.created` → the one word the row's mono line shows. */
function triggerLabel(run: AutomationRun): string {
  const event = run.triggerEvent.event;
  if (event === 'schedule.tick') return 'schedule';
  if (event === 'test') return 'test';
  return event.replace('record.', 'record ');
}

export function automationRunsRoutes(deps: AutomationRunsRoutesDeps): FastifyPluginAsyncZod {
  const { meta } = deps;
  const now = deps.now ?? Date.now;
  const runs = automationRunsRepo(meta);
  const rules = automationsRepo(meta);

  async function names(): Promise<Map<string, string>> {
    return new Map((await rules.list()).map((rule) => [rule.id, rule.name]));
  }

  function row(run: AutomationRun, ruleNames: Map<string, string>) {
    return {
      id: run.id,
      automationId: run.automationId,
      ruleName: ruleNames.get(run.automationId) ?? 'Deleted rule',
      status: run.status,
      origin: run.origin,
      trigger: triggerLabel(run),
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      durationMs: run.durationMs,
      wakeAt: run.wakeAt,
    };
  }

  return async (app) => {
    const guard = app.rbac.require(PERMISSIONS.automationsManage);

    app.get(
      '/automation-runs/stats',
      {
        preHandler: guard,
        config: { audit: auditExempt('read-only KPI strip') },
        schema: { querystring: automationRunsListQuery, response: { 200: automationRunStatsReply } },
      },
      async (request) => {
        const at = now();
        const { todayStart } = dayBoundsFor(at, request.query.tz);
        const stats = await runs.stats(todayStart, at);
        const finished = stats.succeeded + stats.failed;
        return {
          runsToday: stats.runs,
          successRateToday: finished === 0 ? null : stats.succeeded / finished,
          failedToday: stats.failed,
          avgDurationMsToday: stats.avgDurationMs,
        };
      },
    );

    app.get(
      '/automation-runs',
      {
        preHandler: guard,
        config: { audit: auditExempt('read-only run list') },
        schema: { querystring: automationRunsListQuery, response: { 200: automationRunsListReply } },
      },
      async (request) => {
        const since = now() - RUNS_WINDOW_MS;
        const cursor = parseCursor(request.query.cursor);
        const rows = await runs.list({
          since,
          ...(request.query.status === undefined ? {} : { filter: request.query.status }),
          ...(request.query.automationId === undefined
            ? {}
            : { automationId: request.query.automationId }),
          ...(cursor === null ? {} : { before: cursor }),
          // One more than the page, so "is there another page" is a fact
          // rather than a guess (the feeds family's Load-older row).
          limit: RUNS_PAGE_SIZE + 1,
        });
        const page = rows.slice(0, RUNS_PAGE_SIZE);
        const last = page.at(-1);
        const ruleNames = await names();
        return {
          runs: page.map((run) => row(run, ruleNames)),
          cursor: {
            next:
              rows.length > RUNS_PAGE_SIZE && last !== undefined
                ? `${String(last.startedAt)}:${last.id}`
                : null,
          },
          counts: await runs.counts({
            since,
            ...(request.query.automationId === undefined
              ? {}
              : { automationId: request.query.automationId }),
          }),
        };
      },
    );

    app.get(
      '/automation-runs/:id',
      {
        preHandler: guard,
        config: { audit: auditExempt('read-only run detail') },
        schema: { params: automationRunIdParams, response: { 200: automationRunReply } },
      },
      async (request) => {
        const run = await runs.findById(request.params.id);
        if (run === null) throw new NotFoundError('No such run.', { id: request.params.id });
        const ruleNames = await names();
        return {
          run: {
            ...row(run, ruleNames),
            trace: run.trace,
            triggerEvent: run.triggerEvent,
            error: run.error,
          },
        };
      },
    );
  };
}

function parseCursor(raw: string | undefined): { startedAt: number; id: string } | null {
  if (raw === undefined || raw === '') return null;
  const split = raw.indexOf(':');
  if (split <= 0) return null;
  const startedAt = Number(raw.slice(0, split));
  const id = raw.slice(split + 1);
  if (!Number.isFinite(startedAt) || id === '') return null;
  return { startedAt, id };
}
