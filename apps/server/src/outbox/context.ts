// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHO THE OUTBOX IS, as the write path sees it.
 *
 * The producers and the sender write an app's outbox rows themselves — a
 * message queued, sent, skipped — and those are the only writers allowed the
 * moves a person is not (queued → sent, anything → skipped as overtaken).
 * They are told apart by the context OBJECT they write with, kept in a set no
 * request can reach: a label or an origin could be spelled by anyone.
 */
import type { WriteContext } from '../crud/write-service.js';

/** Each outbox context, and the one table — the outbox's own — its writes are to. */
const ours = new WeakMap<WriteContext, string>();

/**
 * A fresh context for one of the outbox's own writes to its own table (a
 * message queued, sent, skipped). It is the outbox's only there: a write it
 * makes to any other table — a project paused when a reminder went — is
 * judged like anyone's.
 */
export function outboxContext(appKey: string, table: string): WriteContext {
  const context: WriteContext = { origin: 'automation', hops: 1, actor: { kind: 'system', id: null, label: `${appKey} outbox` }, request: null };
  ours.set(context, table);
  return context;
}

/**
 * A context for what the outbox does to another table once a message went
 * (`onSent`): the system's, and judged — its change must be a move the table
 * allows.
 */
export function outboxEffectContext(appKey: string): WriteContext {
  return { origin: 'automation', hops: 1, actor: { kind: 'system', id: null, label: `${appKey} outbox` }, request: null };
}

/** Whether a write is the outbox's own: its context, and — when named — its own table. */
export function isOutboxWrite(context: WriteContext, table?: string): boolean {
  const own = ours.get(context);
  return own !== undefined && (table === undefined || own === table);
}
