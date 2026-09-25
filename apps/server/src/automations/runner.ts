// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE RUNNER — one walk of one rule's graph (42-automations-and-workflow-
 * logs.md).
 *
 * --- The record is re-read at every step ----------------------------------
 *
 * A run that waited two days must not act on a two-day-old snapshot. So the
 * row is fetched by primary key when the run starts and again after every
 * wait, and a row that has since been deleted ends the run `skipped` with the
 * reason in the trace rather than failing. That is not politeness: "the
 * customer was deleted while the reminder was pending" is a normal thing to
 * happen and a red run would train people to ignore red runs.
 *
 * --- A wait SUSPENDS; it does not sleep -----------------------------------
 *
 * `Wait 2 days` persists the trace so far, the wake instant and the resume
 * position, and re-enqueues the job with `runAt`. Nothing holds a timer, so
 * a restart mid-wait costs nothing — the queue row IS the timer. A rule
 * switched off during a wait ends the run `cancelled` on resume: the operator
 * turned it off, and finishing anyway would be the opposite of what they
 * asked.
 *
 * --- `resume` is an index PATH, not a node id -----------------------------
 *
 * The graph is the comp's nested list, so a position inside it is
 * `[3]` (the fourth top-level step) or `[5, 1, 2]` (the third step of the
 * second branch of the sixth). Ids would have been ambiguous the moment a
 * node was duplicated; indices are what the comp's own `locate` walks.
 *
 * --- Dry run -------------------------------------------------------------
 *
 * The same walk, with `dryRun` set: every action resolves everything and
 * performs nothing (D14), a wait logs "Would wait 2 days" and continues, and
 * conditions are evaluated for real — which is how the Test animation follows
 * the path the rule would actually take rather than the comp's "first branch
 * of every fork".
 */

import type { Kysely } from 'kysely';
import type { FastifyInstance } from 'fastify';
import {
  automationDurationMs,
  type Automation,
  type AutomationGraph,
  type AutomationNode,
  type AutomationTrace,
  type AutomationTriggerEvent,
  type MetaDb,
} from '@adminium/meta';

import type { ConnectionManager, SourceDatabase } from '../connections/manager.js';
import type { SnapshotView } from '../crud/identifiers.js';
import type { Row } from '../crud/mask.js';
import { fetchByPk } from '../crud/records.js';
import { loadSnapshotView } from '../data-io/snapshot-view.js';
import {
  dryRunCreateAction,
  dryRunUpdateAction,
  runCreateAction,
  runUpdateAction,
} from './actions/record-write.js';
import { dryRunEmailAction, runEmailAction } from './actions/email.js';
import { dryRunNotificationAction, runNotificationAction } from './actions/notification.js';
import { dryRunWebhookAction, runWebhookAction } from './actions/webhook.js';
import {
  dryRunDocumentRenderAction,
  runDocumentRenderAction,
} from './actions/document-render.js';
import type { RenderDeps } from '../documents/render.js';
import { ActionFailure, type ActionContext, type ActionSource } from './actions/types.js';
import { evaluateCondition, type ConditionContext } from './conditions.js';
import { countRelatedRows } from './related-count.js';
import { tokensFor } from './templating.js';
import { TRACE_EN, TraceBuilder, triggerSummary, type TraceText } from './trace.js';

export interface RunnerDeps {
  meta: MetaDb;
  manager: ConnectionManager;
  app?: FastifyInstance | undefined;
  /** Where a step's writes go, with the project's hooks. */
  writes?: ActionContext['writes'];
  secret: string;
  now?: (() => number) | undefined;
  text?: TraceText | undefined;
  /** Passed straight to the actions; see `actions/types.ts`. */
  storage?: ActionContext['storage'];
  hub?: ActionContext['hub'];
  createTransport?: ActionContext['createTransport'];
  fetch?: ActionContext['fetch'];
  /**
   * The document pipeline, for a `document.render` step. Absent in a
   * topology composed without file storage — the step then refuses with
   * a sentence rather than throwing from inside the renderer.
   */
  documents?: RenderDeps | undefined;
  progress?: ((pct: number, message: string) => void) | undefined;
}

export type RunOutcome =
  | { kind: 'finished'; status: 'succeeded' | 'failed' | 'skipped' | 'cancelled'; trace: AutomationTrace; workMs: number; error: string | null }
  | { kind: 'waiting'; wakeAt: number; trace: AutomationTrace };

export interface WalkInput {
  rule: Automation;
  runId: string;
  event: AutomationTriggerEvent;
  /** Where to pick up; `null` starts at the trigger. */
  resume?: number[] | null | undefined;
  /** Steps already traced before the suspend. */
  trace?: AutomationTrace | null | undefined;
  dryRun?: boolean | undefined;
}

/** A node and where it sits — `[3]`, `[5, 1, 2]` (see the header). */
interface Located {
  node: AutomationNode;
  path: number[];
}

/**
 * Flatten the graph into the order a run walks it, with a branch's chosen
 * side spliced in where the branch node sits. Conditions are evaluated as the
 * walk reaches them, so this is a generator rather than a precomputed list.
 */
async function* walkOrder(
  graph: AutomationGraph,
  decide: (node: AutomationNode) => Promise<number | null>,
  from: number[] | null,
): AsyncGenerator<Located> {
  const start = from === null || from.length === 0 ? 0 : (from[0] as number);
  for (let i = start; i < graph.nodes.length; i += 1) {
    const node = graph.nodes[i] as AutomationNode;
    if (node.kind !== 'branch') {
      yield { node, path: [i] };
      continue;
    }

    // Resuming INSIDE this branch: the fork was already decided and traced
    // before the wait, and re-deciding could send the rest of the run down
    // the OTHER side — the condition may read differently two days later.
    const resumingInside = from !== null && from.length >= 3 && from[0] === i;
    let chosen: number | null;
    if (resumingInside) {
      chosen = from[1] as number;
    } else {
      chosen = await decide(node);
      yield { node, path: [i] };
    }
    if (chosen === null) continue;

    const branch = node.branches[chosen];
    if (branch === undefined) continue;
    const inner = resumingInside ? (from[2] as number) : 0;
    for (let j = inner; j < branch.nodes.length; j += 1) {
      yield { node: branch.nodes[j] as AutomationNode, path: [i, chosen, j] };
    }
  }
}

export async function walkRule(deps: RunnerDeps, input: WalkInput): Promise<RunOutcome> {
  const now = (deps.now ?? Date.now)();
  const text = deps.text ?? TRACE_EN;
  const dryRun = input.dryRun ?? false;
  const trace = new TraceBuilder();
  for (const step of input.trace?.steps ?? []) trace.append(step);

  const source = await openSource(deps, input.event);
  if (source === 'gone') {
    trace.add({
      nodeId: 'record',
      name: input.rule.name,
      kind: 'trigger',
      status: 'skip',
      startedAt: now,
      log: text.gone(),
    });
    trace.setResume(null);
    return { kind: 'finished', status: 'skipped', trace: trace.snapshot(), workMs: 0, error: null };
  }

  const ctx: ActionContext = {
    meta: deps.meta,
    manager: deps.manager,
    ...(deps.app === undefined ? {} : { app: deps.app }),
    ...(deps.writes === undefined ? {} : { writes: deps.writes }),
    rule: input.rule,
    runId: input.runId,
    hops: input.event.hops,
    now,
    source,
    tokens: {},
    text,
    secret: deps.secret,
    documents: deps.documents,
    ...(deps.storage === undefined ? {} : { storage: deps.storage }),
    ...(deps.hub === undefined ? {} : { hub: deps.hub }),
    ...(deps.createTransport === undefined ? {} : { createTransport: deps.createTransport }),
    ...(deps.fetch === undefined ? {} : { fetch: deps.fetch }),
  };
  const refreshTokens = (): void => {
    ctx.tokens = tokensFor({
      row: source?.row ?? null,
      table: source?.table ?? null,
      ruleName: input.rule.name,
      recordLabel: source?.record.label ?? '',
      now,
    });
  };
  refreshTokens();

  const conditionCtx = (): ConditionContext => ({
    row: source?.row ?? null,
    now,
    countRelated:
      source === null
        ? undefined
        : (spec) =>
            countRelatedRows({
              db: source.db,
              view: source.view,
              dialect: source.dialect,
              table: spec.table,
              matchColumn: spec.matchColumn,
              matchValue: spec.matchValue,
              where: spec.where,
              now,
            }),
  });

  let error: string | null = null;
  let failed = trace.failed;
  /** A stop node, a filter that did not match, or a fatal step failure. */
  let halted = false;

  // Which side of a fork the run took, so the trace can say "took “Claimed”".
  const branchLogs = new Map<string, string>();
  const decide = async (node: AutomationNode): Promise<number | null> => {
    if (node.kind !== 'branch' || halted) return null;
    const ok = await evaluateCondition(node.condition, conditionCtx());
    const chosen = ok ? 0 : 1;
    branchLogs.set(node.id, node.branches[chosen].label);
    return chosen;
  };

  const totalSteps = Math.max(1, input.rule.graph.nodes.length);
  const report = (): void => {
    const pct = Math.min(99, Math.round((trace.steps.length / totalSteps) * 100));
    deps.progress?.(pct, trace.steps.at(-1)?.log ?? '');
  };

  for await (const located of walkOrder(input.rule.graph, decide, input.resume ?? null)) {
    const { node, path } = located;
    const startedAt = (deps.now ?? Date.now)();

    if (node.kind === 'trigger') {
      trace.add({
        nodeId: node.id,
        name: node.title,
        kind: 'trigger',
        status: 'ok',
        startedAt,
        durationMs: 0,
        log:
          source === null
            ? text.scheduleTick(new Date(input.event.occurredAt).toISOString())
            : text.trigger(source.record.label, triggerSummary(source.table, source.row)),
      });
      continue;
    }

    if (halted) {
      trace.add({ nodeId: node.id, name: node.title, kind: kindOf(node), status: 'skip', startedAt, log: null });
      continue;
    }

    if (node.kind === 'stop') {
      trace.add({ nodeId: node.id, name: node.title, kind: 'stop', status: 'ok', startedAt, durationMs: 0, log: text.stop() });
      halted = true;
      continue;
    }

    if (node.kind === 'branch') {
      const label = branchLogs.get(node.id);
      trace.add({
        nodeId: node.id,
        name: node.title,
        kind: 'branch',
        status: 'ok',
        startedAt,
        durationMs: 0,
        log: label === undefined ? null : text.branch(label),
      });
      continue;
    }

    if (node.kind === 'condition') {
      const ok = await evaluateCondition(node.condition, conditionCtx());
      trace.add({
        nodeId: node.id,
        name: node.title,
        kind: 'condition',
        status: 'ok',
        startedAt,
        durationMs: (deps.now ?? Date.now)() - startedAt,
        log: ok ? text.evaluated(true) : text.stopped(),
      });
      // A filter that does not match ends the run SUCCESSFULLY — the rule did
      // exactly what it was told (D18); every later step is `skip`.
      if (!ok) halted = true;
      continue;
    }

    if (node.kind === 'wait') {
      if (dryRun) {
        trace.add({
          nodeId: node.id,
          name: node.title,
          kind: 'wait',
          status: 'ok',
          startedAt,
          durationMs: 0,
          log: text.wouldWait(node.amount, node.unit),
        });
        continue;
      }
      const wakeAt = now + automationDurationMs(node.amount, node.unit);
      trace.add({
        nodeId: node.id,
        name: node.title,
        kind: 'wait',
        status: 'wait',
        startedAt,
        durationMs: null,
        log: text.wait(new Date(wakeAt).toISOString()),
      });
      trace.setResume(nextPath(input.rule.graph, path));
      return { kind: 'waiting', wakeAt, trace: trace.snapshot() };
    }

    // An action.
    try {
      const result = dryRun ? await dryRunAction(node, ctx) : await runAction(node, ctx);
      // A write moves the record under the run's feet, on purpose (C.3).
      refreshTokens();
      trace.add({
        nodeId: node.id,
        name: node.title,
        kind: 'action',
        status: 'ok',
        startedAt,
        durationMs: (deps.now ?? Date.now)() - startedAt,
        log: result.log,
      });
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      trace.add({
        nodeId: node.id,
        name: node.title,
        kind: 'action',
        status: 'fail',
        startedAt,
        durationMs: (deps.now ?? Date.now)() - startedAt,
        log: message,
      });
      // A run with a failed step is FAILED even when "Continue on error" let
      // later steps run — the trace shows which one (D9).
      failed = true;
      if (error === null) error = message;
      // "Continue on error" is the only thing that keeps the walk going; the
      // RUN is red either way (D9).
      if (!node.onError) halted = true;
    }
    report();
  }

  trace.setResume(null);
  return {
    kind: 'finished',
    status: failed ? 'failed' : 'succeeded',
    trace: trace.snapshot(),
    workMs: trace.workMs,
    error,
  };
}

function kindOf(node: AutomationNode): 'trigger' | 'action' | 'condition' | 'branch' | 'wait' | 'stop' {
  return node.kind;
}

/** The step AFTER `path`, as a resume position (see the header). */
function nextPath(graph: AutomationGraph, path: number[]): number[] {
  if (path.length === 1) return [(path[0] as number) + 1];
  return [path[0] as number, path[1] as number, (path[2] as number) + 1];
}

async function runAction(node: AutomationNode, ctx: ActionContext) {
  if (node.kind !== 'action') throw new ActionFailure('not an action');
  switch (node.action.kind) {
    case 'email':
      return runEmailAction(node.action, ctx);
    case 'notification':
      return runNotificationAction(node.action, ctx);
    case 'record.create':
      return runCreateAction(node.action, ctx);
    case 'record.update':
      return runUpdateAction(node.action, ctx);
    case 'webhook':
      return runWebhookAction(node.action, ctx);
    case 'document.render':
      return runDocumentRenderAction(node.action, ctx);
  }
}

async function dryRunAction(node: AutomationNode, ctx: ActionContext) {
  if (node.kind !== 'action') throw new ActionFailure('not an action');
  switch (node.action.kind) {
    case 'email':
      return dryRunEmailAction(node.action, ctx);
    case 'notification':
      return dryRunNotificationAction(node.action, ctx);
    case 'record.create':
      return dryRunCreateAction(node.action, ctx);
    case 'record.update':
      return dryRunUpdateAction(node.action, ctx);
    case 'webhook':
      return dryRunWebhookAction(node.action, ctx);
    case 'document.render':
      return dryRunDocumentRenderAction(node.action, ctx);
  }
}

/**
 * Open the connection and RE-READ the record. `'gone'` means the row this run
 * is about no longer exists, which is a skip and not a failure.
 */
async function openSource(
  deps: RunnerDeps,
  event: AutomationTriggerEvent,
): Promise<ActionSource | null | 'gone'> {
  const record = event.record;
  if (record === null) return null;
  const view: SnapshotView = await loadSnapshotView(deps.meta, record.connectionId);
  const { db, dialect } = await deps.manager.data(record.connectionId);
  const table = view.table(record.table);
  // A `deleted` trigger is about a row that is SUPPOSED to be gone, so the row
  // as it was is the run's record — there is nothing to re-read. Its values,
  // not the trace's masked `snapshot` (a code there reads `[code]`); a run
  // begun before the values were carried has only the snapshot.
  if (event.event === 'record.deleted') {
    return {
      connectionId: record.connectionId,
      view,
      db: db as Kysely<SourceDatabase>,
      dialect,
      table,
      record,
      row: (event.values ?? event.snapshot ?? {}) as Row,
    };
  }
  const row = await fetchByPk(db, table, record.pk as Row);
  if (row === undefined) return 'gone';
  return { connectionId: record.connectionId, view, db, dialect, table, record, row };
}
