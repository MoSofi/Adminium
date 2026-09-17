// SPDX-License-Identifier: AGPL-3.0-only
/**
 * ONE-CALL WIRING for the rule engine. `compose.ts` calls this once;
 * everything else reaches the engine through `app.automations` or through
 * the handle returned here.
 *
 * --- Why `app.automations` is optional -------------------------------------
 *
 * Several test topologies compose a server with no jobs, no realtime and no
 * connections at all. `crud/after-record-write.ts` therefore guards on
 * `hasDecorator('automations')`, exactly as it does for `realtime`, and a
 * server without this call behaves as it did before the feature existed.
 * That is also what keeps the ~90 existing route tests unchanged.
 *
 * --- The undo path does not cancel a job -----------------------------------
 *
 * `onUndo` flips the pending run to `skipped` and leaves its job alone. The
 * job still fires a minute later, calls `runs.start()`, and gets `false`
 * because the status guard only accepts `pending` or `waiting` — so the run
 * ends where it is. Cancelling the queue row as well would be a second way to
 * say the same thing, and the two could disagree; the status IS the decision.
 */

import type { FastifyInstance } from 'fastify';
import type { EnqueueJobInput, Job, MetaDb } from '@adminium/meta';

import type { ConnectionManager } from '../connections/manager.js';
import { loadSnapshotView } from '../data-io/snapshot-view.js';
import type { RelatedCountSpec } from './conditions.js';
import { AutomationMatcher, type MatcherDeps } from './matcher.js';
import { countRelatedRows } from './related-count.js';

export interface AutomationsRegistration {
  meta: MetaDb;
  manager: ConnectionManager;
  enqueue(input: EnqueueJobInput): Promise<Job>;
  now?: (() => number) | undefined;
  undoTtlMs?: number | undefined;
  log?: MatcherDeps['log'] | undefined;
}

export interface AutomationsHandle {
  matcher: AutomationMatcher;
  /** Count related rows for one connection — the F5 condition form's engine. */
  countRelated(connectionId: string, spec: RelatedCountSpec, now: number): Promise<number>;
}

export function createAutomations(deps: AutomationsRegistration): AutomationsHandle {
  async function countRelated(
    connectionId: string,
    spec: RelatedCountSpec,
    now: number,
  ): Promise<number> {
    const view = await loadSnapshotView(deps.meta, connectionId);
    const { db, dialect } = await deps.manager.data(connectionId);
    return countRelatedRows({
      db,
      view,
      dialect,
      table: spec.table,
      matchColumn: spec.matchColumn,
      matchValue: spec.matchValue,
      where: spec.where,
      now,
    });
  }

  const matcher = new AutomationMatcher({
    meta: deps.meta,
    enqueue: deps.enqueue,
    now: deps.now,
    undoTtlMs: deps.undoTtlMs,
    log: deps.log,
    // The trigger's `when` is evaluated against the connection the event came
    // from — the same one the trigger names.
    countRelated,
  });

  return { matcher, countRelated };
}

/** Decorate the app so `crud/after-record-write.ts` can find the engine. */
export function decorateAutomations(app: FastifyInstance, handle: AutomationsHandle): void {
  app.decorate('automations', {
    onRecordEvent: (event) => handle.matcher.onRecordEvent(event),
    onUndo: (refs) => handle.matcher.onUndo(refs),
    onRulesChanged: () => handle.matcher.onRulesChanged(),
  });
}
