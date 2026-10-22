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

import { rulePartOff } from '../rbac/app-parts.js';
import type { Dialect } from '@adminium/engine';
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
import { laterChangeKey, recordOccurrenceKey } from './events.js';
import { AUTOMATION_RUN_KIND } from './kinds.js';
import { resolveRuleTemplate } from './templates.js';
import { flattenNodes } from './validate.js';
import { changeStampColumn } from './watch-columns.js';
import { auditOnlyColumnsOf } from '../crud/removals.js';

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
  /** Each connection's engine, which a connection keeps for life. */
  #dialects = new Map<string, Promise<Dialect | undefined>>();

  constructor(deps: MatcherDeps) {
    this.#deps = deps;
  }

  get #now(): number {
    return (this.#deps.now ?? Date.now)();
  }

  /** The engine an event's connection runs on: it spells a `date` change stamp (`events.ts`). */
  #dialectOf(connectionId: string): Promise<Dialect | undefined> {
    let known = this.#dialects.get(connectionId);
    if (known === undefined) {
      known = this.#deps.meta.db
        .selectFrom('adminium_connections')
        .select('engine')
        .where('id', '=', connectionId)
        .executeTakeFirst()
        .then((row) => row?.engine as Dialect | undefined);
      this.#dialects.set(connectionId, known);
      known.catch(() => this.#dialects.delete(connectionId));
    }
    return known;
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
    if (event.action === 'delete') {
      await this.#releaseCreated(event);
      await this.#dropWaiting(event);
    }
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

  /**
   * A deleted row's key may be given to the next row: SQLite hands a deleted
   * top rowid to the next insert, and MySQL before 8.0 restarts its counter.
   * A `created` claim is `<rule>:<pk>` for good, so that next row would read
   * as an occurrence already handled and its rules would never run. The
   * delete lets go of the table's `created` claims for this key; the runs
   * themselves stay, with their history.
   */
  async #releaseCreated(event: RecordWriteEvent): Promise<void> {
    if (!this.#loaded) await this.refresh();
    const created = this.#index.get(indexKey(event.connectionId, event.table.id, 'created')) ?? [];
    if (created.length === 0) return;
    const pk = event.entity.pk as Row;
    try {
      await automationRunsRepo(this.#deps.meta).releaseClaims(created.map((rule) => recordOccurrenceKey({ ruleId: rule.id, table: event.table, pk })));
    } catch (error) {
      // The delete already happened; a claim left held costs one later row its rules, never the write.
      this.#deps.log?.warn({ err: error, table: event.table.id }, 'automation matcher could not release a deleted row\'s claims');
    }
  }

  /**
   * A row removed while a run for it still waits out its undo window: the run
   * is skipped, as an undo skips it. It would read the row when it starts, and
   * the row is gone; on SQLite the next row made is given the same key, so the
   * run would act on THAT row instead (a deal won and removed at once made a
   * job for the deal made after it). A rule that runs on the removal itself is
   * claimed after this, and runs.
   */
  async #dropWaiting(event: RecordWriteEvent): Promise<void> {
    try {
      const runs = automationRunsRepo(this.#deps.meta);
      const pending = await runs.listPending('dashboard');
      if (pending.length === 0) return;
      const gone = refKey(event.entity);
      for (const run of pending) {
        const record = run.triggerEvent.record;
        if (record === null || run.triggerEvent.event === 'record.deleted' || refKey(record) !== gone) continue;
        await runs.skipPending(run.id, { trace: { version: 1, steps: [], resume: null }, error: 'record-removed' });
      }
    } catch (error) {
      this.#deps.log?.warn({ err: error, table: event.table.id }, 'automation matcher could not drop the runs of a removed row');
    }
  }

  async #offer(rule: Automation, event: RecordWriteEvent, hops: number): Promise<void> {
    if (rule.trigger.kind !== 'record') return;
    // A private table's row sets off no rule, and no run keeps a copy of it (a rule older than the mark).
    if ((event.table.table as { private?: true } | undefined)?.private === true) return;
    // A rule never re-enters on its own write.
    if (event.origin === 'automation' && event.ruleId === rule.id) return;

    const image = event.action === 'delete' ? event.before : event.after;
    if (image === null) return;

    if (event.action === 'update') {
      const changed = rule.trigger.changedColumn;
      if (changed !== null && changed !== undefined && changed !== '') {
        // No row as it was: nothing shows the column changed, so the rule does
        // not fire — a rule that waits for "status became paid" must not go
        // again on every later edit of a paid row. (The write service reads
        // the row first for a table such a rule watches: `watchesChange`.)
        if (event.before === null || event.before === undefined) return;
        if (sameValue(event.before[changed], event.after?.[changed])) return;
      }
    }

    const at = this.#now;

    const when = rule.trigger.when ?? [];
    if (when.length > 0) {
      const count = this.#deps.countRelated;
      const ctx: ConditionContext = {
        row: image,
        table: event.table,
        now: at,
        countRelated:
          count === undefined ? undefined : (spec) => count(event.connectionId, spec, at),
      };
      if (!(await evaluateAll(when as AutomationCondition[], ctx))) return;
    }

    // A rule of a part that is off claims no run.
    if (await rulePartOff(this.#deps.meta, rule)) return;

    const delayed = event.origin === 'dashboard';
    const wakeAt = delayed ? at + (this.#deps.undoTtlMs ?? UNDO_TTL_MS) : at;
    const runs = automationRunsRepo(this.#deps.meta);

    const dedupeKey = occurrenceKeyFor(
      rule.id,
      event,
      event.action === 'update' ? await this.#dialectOf(event.connectionId) : undefined,
    );
    const claim = {
      automationId: rule.id,
      dedupeKey,
      origin: event.origin,
      triggerEvent: triggerEventFor(event, hops, image, event.action === 'update' && readsWas(rule) ? await wasColumnsOf(this.#deps.meta, rule) : false),
      wakeAt: delayed ? wakeAt : null,
    };
    let run = await runs.begin(claim, at);
    // null = another producer already claimed this occurrence (D6)…
    if (run === null && event.action === 'update' && dedupeKey !== null) {
      // …unless it was an earlier write of this server that left the row with
      // the same moment (MySQL keeps whole seconds): this write is a change
      // of its own, and takes the next number. Only the poller's claim is of
      // the SAME change — it reads a row, never a write.
      const holder = await runs.claimedBy(dedupeKey);
      if (holder !== null && holder !== 'watch') {
        for (let n = 2; run === null && n <= MAX_CHANGES_A_MOMENT; n++) run = await runs.begin({ ...claim, dedupeKey: laterChangeKey(dedupeKey, n) }, at);
      }
    }
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

  /**
   * Whether an enabled rule on this table waits for ONE column to change: an
   * update of it is then announced with the row as it was, read first.
   */
  async watchesChange(connectionId: string, tableId: string): Promise<boolean> {
    if (!this.#loaded) await this.refresh();
    return (this.#index.get(indexKey(connectionId, tableId, 'updated')) ?? []).some(
      (rule) => rule.trigger.kind === 'record' && ((typeof rule.trigger.changedColumn === 'string' && rule.trigger.changedColumn !== '') || readsWas(rule)),
    );
  }

  async onRulesChanged(): Promise<void> {
    await this.refresh();
  }
}

/**
 * How many changes of one row a rule hears within one moment of it (a whole
 * second on MySQL). Past it a write claims no run, as every write of that
 * moment did before: far more than a person or a rule's own steps make.
 */
const MAX_CHANGES_A_MOMENT = 50;

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
export function occurrenceKeyFor(
  ruleId: string,
  event: RecordWriteEvent,
  /** The source's engine, which spells a `date` change stamp. */
  dialect?: Dialect,
): string | null {
  const pk = event.entity.pk as Row;
  if (event.action === 'create') {
    return recordOccurrenceKey({ ruleId, table: event.table, pk });
  }
  if (event.action === 'update') {
    // A figure moved by rows written under the row: no stamp of the row moved with it, so nothing tells this change from the last. Each is one occurrence.
    if (event.cause === 'settled') return null;
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
      dialect,
    });
  }
  // A delete has no watcher and cannot recur for the same row.
  return null;
}

/**
 * Whether a rule may read the changed row as it was (`{{was.<column>}}`): its
 * steps say so, or it sends an e-mail, whose template may. Such a rule's
 * update is announced with the row as it was, read first, and its run keeps
 * the columns of it the rule reads (`wasColumnsOf`).
 */
export function readsWas(rule: Pick<Automation, 'graph'>): boolean {
  const text = JSON.stringify(rule.graph);
  return /\{\{\s*was\./.test(text) || /"kind":"email"/.test(text);
}

/** A `{{was.<column>}}` placeholder, with or without its backup. */
const WAS_PLACEHOLDER = /\{\{\s*was\.([A-Za-z0-9_-]+)/g;

/**
 * The columns of the record as it was that a rule reads: named in its steps,
 * or in a template one of its e-mail steps sends, in any language. A run
 * keeps those and no others (`triggerEventFor`); a template changed while a
 * run waits reads any other column as it was as nothing.
 */
export async function wasColumnsOf(meta: MetaDb, rule: Pick<Automation, 'graph'>): Promise<Set<string>> {
  const out = new Set<string>();
  const take = (text: string): void => {
    for (const match of text.matchAll(WAS_PLACEHOLDER)) out.add(match[1]!);
  };
  take(JSON.stringify(rule.graph));
  const keys = new Set<string>();
  for (const node of flattenNodes(rule.graph)) {
    if (node.kind === 'action' && node.action.kind === 'email' && node.action.templateKey !== null && node.action.templateKey !== '') keys.add(node.action.templateKey);
  }
  for (const key of keys) {
    for (const row of await meta.db.selectFrom('adminium_email_templates').selectAll().where('key', '=', key).execute()) take(JSON.stringify(row));
    // A template the product ships is no row of the store.
    const shipped = await resolveRuleTemplate(meta, key, 'en_US');
    if (shipped !== null) take(JSON.stringify(shipped));
  }
  return out;
}

export function triggerEventFor(
  event: RecordWriteEvent,
  hops: number,
  image: Row,
  /**
   * The rule reads the changed row as it was: keep for the run (`before`) the
   * columns it reads, never a secret one, nor a code no desk hands out.
   */
  keepBefore: ReadonlySet<string> | false = false,
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
    ...(event.via === undefined ? {} : { via: event.via }),
    snapshot: keptRow(image, event.table),
    // A deleted row cannot be read again, so its actions get it as it was;
    // never served, and dropped when the run ends (`values`).
    ...(event.action === 'delete' ? { values: image } : {}),
    // A changed row as it was, for `{{was.<column>}}`: never served either, and dropped when the run ends.
    ...(keepBefore !== false && event.action === 'update' && event.before !== null && event.before !== undefined ? keptBefore(event, event.before, keepBefore) : {}),
    occurredAt: event.occurredAt ?? Date.now(),
  };
}

/** Of the row as it was, the columns a rule reads and may: nothing at all when that is none. */
function keptBefore(event: RecordWriteEvent, before: Row, read: ReadonlySet<string>): { before?: Row } {
  const out: Row = {};
  const auditOnly = auditOnlyColumnsOf(event.table);
  for (const name of read) {
    const column = event.table.columns.get(name);
    if (column === undefined || column.secret || !(name in before)) continue;
    // Its earlier values are the audit log's alone (`column.history`): a rule reads them as nothing.
    if (auditOnly.has(name)) continue;
    if ((event.table.table as { columns?: readonly { name: string; code?: { hiddenFromStaff?: boolean } }[] } | undefined)?.columns?.find((one) => one.name === name)?.code?.hiddenFromStaff === true) continue;
    out[name] = before[name];
  }
  return Object.keys(out).length === 0 ? {} : { before: out };
}
