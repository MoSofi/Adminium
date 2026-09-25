// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHICH RULES DOES THIS WRITE FIRE?
 *
 * Every single-row write in the product now ends in one event, and this is
 * what listens. It has to be cheap — it runs inside the request, before the
 * reply — which is why the rules live in an in-memory index keyed by
 * (connection, table, event), rebuilt on boot and on every rule write, rather
 * than being read from the store per record.
 *
 * --- The three things that stop a rule firing ------------------------------
 *
 *  1. THE LOOP GUARD. A rule's own Update-field step writes a record, which
 *     is a `record.updated` event, which can match the same rule. So an event
 *     a rule caused never re-enters that rule, and an event more than three
 *     automation hops deep is refused outright with an audit row — the
 *     two-rule ping-pong (A writes B's table, B writes A's) has no other
 *     brake.
 *  2. THE DEDUPE KEY. `begin()` INSERTs the run row first; a unique violation
 *     means another producer — almost always the watch poller a minute later
 *     — already claimed this occurrence. Nothing is enqueued in that case.
 *  3. THE UNDO WINDOW. A dashboard write can be taken back for 60 s (D7), so
 *     a rule triggered by one starts 60 s late and is skipped if the undo
 *     arrives first. Public, watch and schedule origins have no undo and run
 *     immediately.
 *
 * --- Why this awaits before the route replies ------------------------------
 *
 * The run ROW is created inline; the run itself is a queued job. That split
 * is deliberate: "the rule fired for that sign-up" becomes true before the
 * caller gets its 201, so a UI that refetches immediately sees the run, while
 * the actual work — which may send mail and wait two days — never sits in a
 * request.
 */

import {
  auditRepo,
  automationRunsRepo,
  automationsRepo,
  type Automation,
  type AutomationCondition,
  type AutomationTriggerEvent,
  type EnqueueJobInput,
  type Job,
  type MetaDb,
  type RecordRef,
} from '@adminium/meta';

import type { RecordWriteEvent } from '../crud/after-record-write.js';
import { keptRow, type Row } from '../crud/mask.js';
import { UNDO_TTL_MS } from '../crud/undo.js';
import { evaluateAll, type ConditionContext, type RelatedCountSpec } from './conditions.js';
import { recordOccurrenceKey } from './events.js';
import { AUTOMATION_RUN_KIND } from './kinds.js';
import { changeStampColumn } from './watch-columns.js';

/** Past this many automation-caused hops an event is refused. */
export const MAX_AUTOMATION_HOPS = 3;

export interface MatcherDeps {
  meta: MetaDb;
  enqueue(input: EnqueueJobInput): Promise<Job>;
  /**
   * Answers a related-records count for a trigger's `when` (F5), against the
   * connection the event came from. Absent means a count condition evaluates
   * false, which is the safe direction: a rule that cannot be evaluated does
   * not fire.
   */
  countRelated?:
    | ((connectionId: string, spec: RelatedCountSpec, now: number) => Promise<number>)
    | undefined;
  now?: (() => number) | undefined;
  /** Undo delay for dashboard-origin events; injectable for tests. */
  undoTtlMs?: number | undefined;
  log?: { warn(data: unknown, message: string): void } | undefined;
}

function indexKey(connectionId: string, table: string, event: string): string {
  return `${connectionId} ${table} ${event}`;
}

/** `create` | `update` | `delete` as the trigger vocabulary spells them. */
const TRIGGER_EVENT: Record<string, 'created' | 'updated' | 'deleted'> = {
  create: 'created',
  update: 'updated',
  delete: 'deleted',
};

export class AutomationMatcher {
  readonly #deps: MatcherDeps;
  #index = new Map<string, Automation[]>();
  #loaded = false;

  constructor(deps: MatcherDeps) {
    this.#deps = deps;
  }

  get #now(): number {
    return (this.#deps.now ?? Date.now)();
  }

  /** Rebuild the index from the store. Called on boot and after every rule write. */
  async refresh(): Promise<void> {
    const rules = await automationsRepo(this.#deps.meta).listEnabled();
    const index = new Map<string, Automation[]>();
    for (const rule of rules) {
      if (rule.trigger.kind !== 'record') continue;
      const key = indexKey(rule.trigger.connectionId, rule.trigger.table, rule.trigger.event);
      const bucket = index.get(key);
      if (bucket) bucket.push(rule);
      else index.set(key, [rule]);
    }
    this.#index = index;
    this.#loaded = true;
  }

  /** The rules an event would be offered to — the index, loaded lazily. */
  async rulesFor(event: RecordWriteEvent): Promise<Automation[]> {
    if (!this.#loaded) await this.refresh();
    const name = TRIGGER_EVENT[event.action];
    if (name === undefined) return [];
    return this.#index.get(indexKey(event.connectionId, event.table.id, name)) ?? [];
  }

  async onRecordEvent(event: RecordWriteEvent): Promise<void> {
    const hops = event.hops ?? 0;
    const rules = await this.rulesFor(event);
    if (rules.length === 0) return;

    if (hops > MAX_AUTOMATION_HOPS) {
      // ONE audit row for the whole event, not one per rule: the fact worth
      // recording is "a chain of rules ran away here", and a table with six
      // matching rules would otherwise write six copies of it.
      await auditRepo(this.#deps.meta).append({
        actorKind: 'automation',
        actorId: event.ruleId ?? null,
        actorLabel: 'Automation',
        category: 'automation',
        action: 'automation.loop-refused',
        connectionId: event.connectionId,
        entity: event.entity,
        changes: { after: { hops, max: MAX_AUTOMATION_HOPS, table: event.table.id } },
      });
      return;
    }

    for (const rule of rules) {
      try {
        await this.#offer(rule, event, hops);
      } catch (error) {
        // A rule that throws must not fail the customer's write. The write
        // already happened; refusing the 201 would tell the caller a lie.
        this.#deps.log?.warn({ err: error, ruleId: rule.id }, 'automation matcher failed');
      }
    }
  }

  async #offer(rule: Automation, event: RecordWriteEvent, hops: number): Promise<void> {
    if (rule.trigger.kind !== 'record') return;
    // A rule never re-enters on its own write.
    if (event.origin === 'automation' && event.ruleId === rule.id) return;

    const image = event.action === 'delete' ? event.before : event.after;
    if (image === null) return;

    if (event.action === 'update') {
      const changed = rule.trigger.changedColumn;
      if (changed !== null && changed !== undefined && changed !== '') {
        if (sameValue(event.before?.[changed], event.after?.[changed])) return;
      }
    }

    const at = this.#now;

    const when = rule.trigger.when ?? [];
    if (when.length > 0) {
      const count = this.#deps.countRelated;
      const ctx: ConditionContext = {
        row: image,
        now: at,
        countRelated:
          count === undefined ? undefined : (spec) => count(event.connectionId, spec, at),
      };
      if (!(await evaluateAll(when as AutomationCondition[], ctx))) return;
    }

    const delayed = event.origin === 'dashboard';
    const wakeAt = delayed ? at + (this.#deps.undoTtlMs ?? UNDO_TTL_MS) : at;
    const runs = automationRunsRepo(this.#deps.meta);

    const run = await runs.begin(
      {
        automationId: rule.id,
        dedupeKey: occurrenceKeyFor(rule.id, event),
        origin: event.origin,
        triggerEvent: triggerEventFor(event, hops, image),
        wakeAt: delayed ? wakeAt : null,
      },
      at,
    );
    // null = another producer already claimed this occurrence (D6).
    if (run === null) return;

    const job = await this.#deps.enqueue({
      kind: AUTOMATION_RUN_KIND,
      payload: { runId: run.id },
      runAt: wakeAt,
      dedupeKey: `run:${run.id}`,
      // A retried run would repeat every side effect it had already performed
      // — a second welcome email, a second beneficiary row (D6).
      maxAttempts: 1,
    });
    await runs.attachJob(run.id, job.id);
  }

  /**
   * A dashboard write was undone inside its window (D7). Every run still
   * `pending` for one of these records is dropped before it starts.
   */
  async onUndo(refs: readonly RecordRef[]): Promise<void> {
    if (refs.length === 0) return;
    const runs = automationRunsRepo(this.#deps.meta);
    const pending = await runs.listPending('dashboard');
    if (pending.length === 0) return;
    const undone = new Set(refs.map((ref) => refKey(ref)));
    for (const run of pending) {
      const record = run.triggerEvent.record;
      if (record === null || !undone.has(refKey(record))) continue;
      await runs.skipPending(run.id, {
        trace: { version: 1, steps: [], resume: null },
        error: 'undone',
      });
    }
  }

  async onRulesChanged(): Promise<void> {
    await this.refresh();
  }
}

function refKey(ref: RecordRef): string {
  const values = Object.keys(ref.pk)
    .sort()
    .map((key) => `${key}=${JSON.stringify(ref.pk[key] ?? null)}`);
  return `${ref.connectionId} ${ref.table} ${values.join(',')}`;
}

/** Driver values compare loosely: a Date and its epoch are the same instant. */
function sameValue(a: unknown, b: unknown): boolean {
  if (a instanceof Date || b instanceof Date) {
    const left = a instanceof Date ? a.getTime() : a;
    const right = b instanceof Date ? b.getTime() : b;
    return left === right;
  }
  return a === b;
}

/** The occurrence identity a route event carries — see `events.ts` for the table. */
export function occurrenceKeyFor(ruleId: string, event: RecordWriteEvent): string | null {
  const pk = event.entity.pk as Row;
  if (event.action === 'create') {
    return recordOccurrenceKey({ ruleId, table: event.table, pk });
  }
  if (event.action === 'update') {
    const stampColumn = changeStampColumn(event.table);
    // No `updated_at` means nothing distinguishes this update from the next,
    // and nothing else can produce it either (the poller cannot watch such a
    // table). Two updates are two occurrences: NULL, which unique exempts.
    if (stampColumn === null) return null;
    return recordOccurrenceKey({
      ruleId,
      table: event.table,
      pk,
      changeStamp: event.after?.[stampColumn] ?? null,
    });
  }
  // A delete has no watcher and cannot recur for the same row.
  return null;
}

export function triggerEventFor(
  event: RecordWriteEvent,
  hops: number,
  image: Row,
): AutomationTriggerEvent {
  const name =
    event.action === 'create'
      ? 'record.created'
      : event.action === 'update'
        ? 'record.updated'
        : 'record.deleted';
  return {
    event: name,
    origin: event.origin,
    ruleId: event.ruleId ?? null,
    hops,
    record: event.entity,
    // The trace is read by admins in Workflow Logs, so what is STORED about
    // the row is masked here at the boundary. The run itself re-reads the
    // record unmasked — it has to address the email. No code is kept
    // either: the trace's readers may not read the table (`keptRow`).
    snapshot: keptRow(image, event.table),
    occurredAt: event.occurredAt ?? Date.now(),
  };
}
