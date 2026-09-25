// SPDX-License-Identifier: AGPL-3.0-only
/**
 * ONE PLACE A RECORD WRITE IS ANNOUNCED (the shared helper designed and did
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
 * skips an event a rule itself caused and refuses one past the ceiling.
 * That is a property of the EVENT, not of the matcher, which is why it is
 * stamped here at the source.
 */

import type { FastifyRequest } from 'fastify';
import type { FastifyInstance } from 'fastify';
import {
  auditRepo,
  type ActorKind,
  type AuditCategory,
  type AutomationOrigin,
  type MetaDb,
  type RecordRef,
} from '@adminium/meta';

import type { ResolvedTable } from './identifiers.js';
import { keptImages, type Row } from './mask.js';
import type { FileReconciler } from '../files/reconcile.js';
import { publishWidgetDataStream } from '../widget-data/stream-publisher.js';
import type { WidgetDataCache } from '../widget-data/cache.js';

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

/** What queues an installed app's emails from its writes; decorated by compose. */
export interface OutboxDispatcher {
  onRecordEvent(event: RecordWriteEvent): Promise<void>;
}

/**
 * What ends a signed-in person's sessions and takes back their sign-in
 * links when the desk changes the address they sign in by; decorated by
 * compose (`public-api/identity-email-watch.ts`). Never throws.
 */
export interface PublicIdentityListener {
  onRecordEvent(event: RecordWriteEvent): Promise<void>;
}

declare module 'fastify' {
  interface FastifyInstance {
    automations: AutomationDispatcher;
    outbox: OutboxDispatcher;
    publicIdentities: PublicIdentityListener;
    /** The ONE widget-data result cache `routes/widget-data` serves from (compose). */
    widgetDataCache: WidgetDataCache;
  }
}

/**
 * Drop the widget-data results over a table that was just written. Without
 * this the dashboard's refetch after a write (it invalidates `['widget-data']`
 * on the reply and on the realtime frame) is answered from the 30 s cache and
 * a new calendar event, board card or KPI count stays invisible until expiry.
 *
 * Called BEFORE the realtime fan-out and before the route replies, so no
 * refetch either one triggers can race a stale entry back in.
 *
 * Only the WRITTEN table's entries go. A descriptor with `lookups` also reads
 * a second table (a calendar titled through an FK hop), and its entry is keyed
 * to the bound table alone — so a write to the looked-up table leaves that
 * widget's resolved labels stale until the TTL runs out. Bounded, and rare
 * enough (renaming the parent row a title hops to) not to warrant a
 * dependency index yet.
 */
export function invalidateWidgetData(app: FastifyInstance, connectionId: string, tableId: string): void {
  if (!app.hasDecorator('widgetDataCache')) return;
  app.widgetDataCache.invalidateTable(connectionId, tableId);
}

export interface AfterRecordWriteInput extends RecordWriteEvent {
  /**
   * The request that made the write, for the audit row's actor and transport
   * fields. NULL when the automation runner is the writer — there is no
   * request, and {@link AfterRecordWriteInput.actor} names who it was instead.
   */
  request?: FastifyRequest | null | undefined;
  /** Required when `request` is null. `kind` defaults to `automation`. */
  actor?: { id: string | null; label: string; kind?: ActorKind | undefined } | undefined;
  /** Audit category for the `record.<action>` entry. Default `data`. */
  auditCategory?: AuditCategory | undefined;
  /** Column-bound file reconciliation. Absent ⇒ no file behaviour. */
  files?: FileReconciler | undefined;
  /** The store the audit row goes to when there is no request. */
  meta?: MetaDb | undefined;
}

/**
 * Hand one record event to the rule engine, and nothing else. Used by write
 * paths that already audit and publish their own way (bulk, public).
 *
 * Awaited before the route replies, deliberately: a run row that exists
 * before the response is what makes "the rule fired for that sign-up" true
 * from the caller's point of view, and the work itself is a job the queue
 * picks up afterwards.
 */
export async function emitRecordEvent(app: FastifyInstance, event: RecordWriteEvent): Promise<void> {
  // An app's emails are queued whether or not any rule exists; the producers never throw.
  if (app.hasDecorator('outbox')) await app.outbox.onRecordEvent(event);
  // A person's sign-in address changed by the desk: their sessions and links end. Never throws.
  if (app.hasDecorator('publicIdentities')) await app.publicIdentities.onRecordEvent(event);
  if (!app.hasDecorator('automations')) return;
  await app.automations.onRecordEvent(event);
}

/**
 * Announce a row a parent's write changed alongside it — an order's lines
 * posted with the order. The same cache drop and the same two frames a
 * row's own write sends, so a screen watching the child table (a kitchen
 * watching lines) sees it; no second audit row (the parent's covers the
 * change) and no rule run.
 */
export function publishChildWrite(
  app: FastifyInstance,
  input: { connectionId: string; table: ResolvedTable; action: RecordWriteAction; pk: Row; row: Row | null },
): void {
  invalidateWidgetData(app, input.connectionId, input.table.id);
  if (!app.hasDecorator('realtime')) return;
  app.realtime.publish(`table:${input.connectionId}:${input.table.id}`, `record.${input.action}`, { pk: input.pk });
  publishWidgetDataStream(app.realtime, {
    connectionId: input.connectionId,
    table: input.table,
    type: `record.${input.action}`,
    pk: input.pk,
    row: input.row,
  });
}

/**
 * The full downstream of a single-row write: widget-data cache drop, audit,
 * file reconcile, cache fan-out, live stream, rule engine — in that order,
 * and the order matters.
 * The audit row is the record of what the customer asked for and must not
 * depend on anything after it succeeding.
 */
export async function afterRecordWrite(
  app: FastifyInstance,
  input: AfterRecordWriteInput,
): Promise<void> {
  const { connectionId, table, action, entity, before, after } = input;

  invalidateWidgetData(app, connectionId, table.id);

  // Before/after images are PII-redacted in the audit trail, and carry no
  // code: whoever reads the audit log may not read this table (`keptImages`).
  const changes = keptImages(table, before, after);
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
    // the audit vocabulary has always carried and the reason a rule's
    // writes are not undoable by spec: nobody holds a token
    // for them.
    const meta = input.meta ?? app.rbac.meta;
    await auditRepo(meta).append({
      ...entry,
      actorKind: input.actor?.kind ?? 'automation',
      actorId: input.actor?.id ?? null,
      actorLabel: input.actor?.label ?? 'Automation',
    });
  }

  // Column-bound files: attach what appeared, trash what was replaced
  // . AFTER the audit row, for the reason above.
  const reconciled =
    input.files === undefined
      ? null
      : await input.files.reconcile({ connectionId, table: table.id, entity, before, after });

  if (app.hasDecorator('realtime')) {
    // Cache-invalidation fan-out — carries only the pk.
    app.realtime.publish(`table:${connectionId}:${table.id}`, `record.${action}`, { pk: entity.pk });
    // An open record page refetches its Attachments panel. No new channel —
    // it rides the same table's WIDGET-DATA channel, not the `table:` one
    // above, because `table:*` is publish-only: `parseChannel`
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
    // Live-stream fan-out — carries the PII-masked row so the
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
