// SPDX-License-Identifier: AGPL-3.0-only
/**
 * ONE PLACE A RECORD WRITE IS ANNOUNCED (42-automations-and-workflow-logs.md
 * §3.3, 42-T04; the shared helper 34-invoices-add-on.md §7.1 designed and did
 * not build).
 *
 * ─── The problem this exists to fix ────────────────────────────────────────
 *
 * `routes/data` already had one function every single-row write ended in —
 * audit, file reconcile, cache fan-out, live stream. But it was a closure
 * inside that plugin, so the OTHER two write paths could not reach it: the
 * bulk route audits once with a count, and the public surface writes rows
 * that nothing downstream ever hears about. That was survivable while the
 * only consumers were an audit row and a websocket frame. It stops being
 * survivable the moment a rule can say "when a user signs up, send them a
 * welcome email", because the sign-ups that matter most — the ones the
 * customer's own app and the public API create — are exactly the ones that
 * never reached the closure.
 *
 * So the body moves here, and the three paths call it or, where the write is
 * already audited its own way, call {@link emitRecordEvent} alone.
 *
 * ─── Why bulk emits events but keeps ONE audit row ─────────────────────────
 *
 * The bulk route caps at 1,000 ids. Firing the whole helper per row would
 * turn one operator action into a thousand audit entries and a thousand
 * websocket frames — an audit log nobody can read is not a better audit log.
 * What a rule needs from a bulk write is the EVENTS (O7: bulk route writes
 * fire record triggers, per row), so bulk calls `emitRecordEvent` per
 * succeeded row and keeps its single `record.bulk-<action>` entry and its
 * one counted publish.
 *
 * ─── `origin` and `hops` travel with the event ─────────────────────────────
 *
 * A rule's Update-field step writes a record, which is a `record.updated`
 * event, which can match the same rule. Every event therefore carries where
 * it came from and how many automation hops deep it already is; the matcher
 * skips an event a rule itself caused and refuses one past the ceiling
 * (§3.3). That is a property of the EVENT, not of the matcher, which is why
 * it is stamped here at the source.
 */

import type { FastifyRequest } from 'fastify';
import type { FastifyInstance } from 'fastify';
import {
  auditRepo,
  type AuditCategory,
  type AutomationOrigin,
  type MetaDb,
  type RecordRef,
} from '@adminium/meta';

import type { ResolvedTable } from './identifiers.js';
import { maskRow, type Row } from './mask.js';
import type { FileReconciler } from '../files/reconcile.js';
import { publishWidgetDataStream } from '../widget-data/stream-publisher.js';

export type RecordWriteAction = 'create' | 'update' | 'delete';

/**
 * What happened to one row, as every consumer downstream sees it. `before`
 * and `after` are UNMASKED — the automation runner has to be able to address
 * the email and read the value it is about to compare — and masking happens
 * at each consumer's own boundary (the audit images here, the trace in
 * `automations/trace.ts`).
 */
export interface RecordWriteEvent {
  connectionId: string;
  table: ResolvedTable;
  action: RecordWriteAction;
  entity: RecordRef;
  before: Row | null;
  after: Row | null;
  origin: AutomationOrigin;
  /** The rule whose own write caused this — the loop guard's first test. */
  ruleId?: string | null | undefined;
  /** Automation hops so far; the matcher refuses past 3. */
  hops?: number | undefined;
  occurredAt?: number | undefined;
}

/** What a rule dispatcher must offer; decorated by `automations/plugin.ts`. */
export interface AutomationDispatcher {
  onRecordEvent(event: RecordWriteEvent): Promise<void>;
  /** A dashboard write was undone inside its window — drop the runs it queued (D7). */
  onUndo(refs: readonly RecordRef[]): Promise<void>;
  /** A rule was written; rebuild the in-memory index. */
  onRulesChanged(): Promise<void>;
}

declare module 'fastify' {
  interface FastifyInstance {
    automations: AutomationDispatcher;
  }
}

export interface AfterRecordWriteInput extends RecordWriteEvent {
  /**
   * The request that made the write, for the audit row's actor and transport
   * fields. NULL when the automation runner is the writer — there is no
   * request, and {@link AfterRecordWriteInput.actor} names who it was instead.
   */
  request?: FastifyRequest | null | undefined;
  /** Required when `request` is null. */
  actor?: { id: string | null; label: string } | undefined;
  /** Audit category for the `record.<action>` entry. Default `data`. */
  auditCategory?: AuditCategory | undefined;
  /** Column-bound file reconciliation (37 §3.7). Absent ⇒ no file behaviour. */
  files?: FileReconciler | undefined;
  /** The store the audit row goes to when there is no request. */
  meta?: MetaDb | undefined;
}

/**
 * Hand one record event to the rule engine, and nothing else. Used by write
 * paths that already audit and publish their own way (bulk, public).
 *
 * Awaited before the route replies, deliberately (34 D7): a run row that
 * exists before the response is what makes "the rule fired for that sign-up"
 * true from the caller's point of view, and the work itself is a job the
 * queue picks up afterwards.
 */
export async function emitRecordEvent(app: FastifyInstance, event: RecordWriteEvent): Promise<void> {
  if (!app.hasDecorator('automations')) return;
  await app.automations.onRecordEvent(event);
}

/**
 * The full downstream of a single-row write: audit, file reconcile, cache
 * fan-out, live stream, rule engine — in that order, and the order matters.
 * The audit row is the record of what the customer asked for and must not
 * depend on anything after it succeeding.
 */
export async function afterRecordWrite(
  app: FastifyInstance,
  input: AfterRecordWriteInput,
): Promise<void> {
  const { connectionId, table, action, entity, before, after } = input;

  const changes = {
    // Before/after images are PII-redacted in the audit trail (§5.3).
    before: before === null ? null : maskRow(before, table, false),
    after: after === null ? null : maskRow(after, table, false),
  };
  const entry = {
    category: input.auditCategory ?? ('data' as AuditCategory),
    action: `record.${action}`,
    connectionId,
    entity,
    changes,
  };
  if (input.request) {
    await app.rbac.audit(input.request, entry);
  } else {
    // The runner's own writes. `actorKind: 'automation'` is the fourth kind
    // the audit vocabulary has always carried (§3.11) and the reason a rule's
    // writes are not undoable by spec (08 §2.7.3 item 6): nobody holds a token
    // for them.
    const meta = input.meta ?? app.rbac.meta;
    await auditRepo(meta).append({
      ...entry,
      actorKind: 'automation',
      actorId: input.actor?.id ?? null,
      actorLabel: input.actor?.label ?? 'Automation',
    });
  }

  // Column-bound files: attach what appeared, trash what was replaced
  // (37 §3.7). AFTER the audit row, for the reason above.
  const reconciled =
    input.files === undefined
      ? null
      : await input.files.reconcile({ connectionId, table: table.id, entity, before, after });

  if (app.hasDecorator('realtime')) {
    // Cache-invalidation fan-out (09 §4.1) — carries only the pk.
    app.realtime.publish(`table:${connectionId}:${table.id}`, `record.${action}`, { pk: entity.pk });
    // 37 D27: an open record page refetches its Attachments panel. No new
    // channel — it rides the same table's WIDGET-DATA channel, not the
    // `table:` one above, because `table:*` is publish-only: `parseChannel`
    // (realtime/hub.ts) has no case for it, so `authorizeChannel` denies
    // every subscription to it (realtime-hub.test.ts pins that as the
    // deny-by-default example) and an event published there reaches no
    // browser on either transport. `widget-data:<conn>:<table>` is the same
    // table gated by exactly `table:<conn>:<table>:read` — the grant that
    // lets a caller see this record and its files — and going through the
    // shared publisher masks the pk the way every other frame on that
    // channel is masked, since a natural key can itself be a PII column.
    if (reconciled !== null && (reconciled.attached.length > 0 || reconciled.trashed.length > 0)) {
      publishWidgetDataStream(app.realtime, {
        connectionId,
        table,
        type: 'record.attachments',
        pk: entity.pk,
        row: null,
      });
    }
    // Live-stream fan-out (04 §5.3) — carries the PII-masked row so the
    // realtime-feed / live log-table tail can prepend it without a refetch.
    publishWidgetDataStream(app.realtime, {
      connectionId,
      table,
      type: `record.${action}`,
      pk: entity.pk,
      row: action === 'delete' ? before : after,
    });
  }

  await emitRecordEvent(app, input);
}
