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

const ours = new WeakSet<WriteContext>();

/** A fresh context for one of the outbox's own writes. */
export function outboxContext(appKey: string): WriteContext {
  const context: WriteContext = { origin: 'automation', hops: 1, actor: { kind: 'system', id: null, label: `${appKey} outbox` }, request: null };
  ours.add(context);
  return context;
}

/** Whether a write is the outbox's own. */
export function isOutboxWrite(context: WriteContext): boolean {
  return ours.has(context);
}
