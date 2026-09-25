// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHAT A PERSON MAY DO TO A MESSAGE — the moves of an outbox row's status.
 *
 * A person (or an API key, an import's update, a rule, an undo) may:
 *  - approve a held message: held → queued. Who approved it is written in
 *    `approved_by`; the address is looked up again, as the person is now; a
 *    message approved before its day goes at once (its due moves to now);
 *  - reword a held message of a producer that holds (`subject_override`,
 *    `body_override`) — before or as it is approved, and at no other time:
 *    never on a new row, a queued one, or one addressed by hand, so a
 *    person's wording only ever goes where Adminium addresses it;
 *  - skip a held or queued one: → skipped, the reason `by-hand`;
 *  - queue a failed one again: failed → queued.
 * Only Adminium marks a message sent or failed — when it sends it — and a
 * sent message stays as it was sent: never queued again, never re-addressed
 * or re-worded. What Adminium writes (when it went, who approved it, why it
 * was skipped or failed, what its effect did) is never a person's: a value
 * that would change it is refused, one that repeats it is dropped. What a
 * message is and what it is about (its kind, its links) is fixed once it is
 * made. A new row a person makes starts queued, or held when its kind is one
 * a producer holds (a reminder nobody approved is never sent); history — an
 * import, an app's sample data, the undo of a delete — may bring any row as
 * it was, and nothing a sent row of history asks for is ever done.
 *
 * It runs as a before hook of the write service, after the project's own
 * hooks, for every stored outbox's table — a switched-off app's too, whose
 * rows would otherwise go the moment it is switched back on. Every door that
 * writes rows through the write service reaches it: a form, a bulk edit, an
 * import's update, the public batch, an undo. The producers' and the
 * sender's own writes pass (`isOutboxWrite`).
 */
import type { MetaDb } from '@adminium/meta';

import type { Row } from '../crud/mask.js';
import { slotInstant } from '../crud/capacity-guard.js';
import type { BeforeWriteEvent, HookTiming, RecordHooks, WriteAction, WriteContext, WriteTarget } from '../crud/write-service.js';
import { sameValue } from '../crud/write-values.js';
import { AppError } from '../errors.js';
import { isOutboxWrite } from './context.js';
import type { LiveOutbox } from './producers.js';
import { addressFor } from './recipient.js';
import { producerOf, settingReader } from './timing.js';

/** The moves a person may make: from → to. */
const PERSON_MOVES: Readonly<Record<string, readonly string[]>> = {
  held: ['queued', 'skipped'],
  queued: ['skipped'],
  failed: ['queued'],
};

/** A refused move, in the words the desk shows. */
export class OutboxMoveRefused extends AppError {
  override readonly name = 'OutboxMoveRefused';

  constructor(message: string, details: { column: string; from?: unknown; to?: unknown }) {
    super(409, 'STATE_MOVE_REFUSED', message, details);
  }
}

const empty = (value: unknown) => value === null || value === undefined;

/**
 * Two values of one column, the same answer — a moment compared as a moment,
 * however it is spelled (a form sends ISO text, SQLite keeps a wall clock).
 */
function same(a: unknown, b: unknown, instant = false): boolean {
  if (empty(a) || empty(b)) return empty(a) && empty(b);
  if (instant || a instanceof Date || b instanceof Date) {
    const [x, y] = [slotInstant(a), slotInstant(b)];
    return x !== null && y !== null && Math.abs(x.getTime() - y.getTime()) < 1_000;
  }
  return sameValue(a, b);
}

export interface OutboxMovesDeps {
  meta: MetaDb;
  /** Every stored outbox, its app on or off. */
  outboxes: () => Promise<LiveOutbox[]>;
  now?: () => number;
}

/**
 * The write service's hooks with the outbox's moves added: the project's
 * hooks run as before, and a write to an outbox table is judged after them,
 * so no hook can put back what the judge refused.
 */
export function withOutboxMoves(inner: RecordHooks, deps: OutboxMovesDeps): RecordHooks {
  const boxOf = async (target: WriteTarget): Promise<LiveOutbox | undefined> =>
    (await deps.outboxes()).find((box) => box.connectionId === target.connectionId && box.definition.table === target.table.id);

  return {
    async wants(timing: HookTiming, action: WriteAction, target: WriteTarget, context: WriteContext): Promise<boolean> {
      if (await inner.wants(timing, action, target, context)) return true;
      return timing === 'before' && !isOutboxWrite(context) && (await boxOf(target)) !== undefined;
    },
    async before(event: BeforeWriteEvent): Promise<void> {
      if (await inner.wants('before', event.action, event.target, event.context)) await inner.before(event);
      if (isOutboxWrite(event.context)) return;
      const box = await boxOf(event.target);
      if (box !== undefined) await judgeMove(box, event, deps);
    },
    after: (event) => inner.after(event),
  };
}

/** Refuse what a person may not do to a message, and fill in what an approval or a skip writes. */
export async function judgeMove(box: LiveOutbox, event: BeforeWriteEvent, deps: Pick<OutboxMovesDeps, 'meta' | 'now'>): Promise<void> {
  const { action, values, record, context, target } = event;
  const cols = box.definition.columns;
  const definition = box.definition;
  // What only Adminium writes: when it sent, who approved, why it skipped or failed, what the effect did.
  const adminiums = [cols.sentAt, cols.approvedBy, cols.effectAt, cols.effectError, cols.skipReason, cols.error].filter((column): column is string => column !== undefined);
  const overrides = [cols.subjectOverride, cols.bodyOverride].filter((column): column is string => column !== undefined);
  // What a message is, and what it is about.
  const identity = [
    cols.kind,
    ...Object.values(definition.links ?? {}),
    definition.recipient.via,
    ...(definition.recipient.fallback === undefined ? [] : [definition.recipient.fallback.via]),
  ].filter((column) => target.table.columns.has(column));
  const has = (column: string) => Object.prototype.hasOwnProperty.call(values, column);
  const refuse = (column: string, message: string, extra: Record<string, unknown> = {}): never => {
    throw new OutboxMoveRefused(message, { column, ...extra });
  };
  const byAdminium = (column: string) => refuse(column, `"${column}" is written by Adminium, not by hand.`);
  if (action === 'delete') return;

  if (action === 'create') {
    // History — an import, an app's sample data, a deleted row put back by its undo — comes back as it was.
    if (context.origin === 'import' || context.origin === 'undo') return;
    const status = values[cols.status];
    if (!empty(status) && status !== 'queued' && status !== 'held') {
      refuse(cols.status, 'A new message starts queued or held: only Adminium marks one sent, failed or skipped.', { to: status });
    }
    for (const column of adminiums) {
      if (!has(column)) continue;
      if (!empty(values[column])) byAdminium(column);
      delete values[column];
    }
    for (const column of overrides) {
      if (!has(column)) continue;
      if (!empty(values[column])) refuse(column, 'A message is reworded only while it waits for approval, not when it is made.');
      delete values[column];
    }
    // A reminder a producer holds waits for a person, whoever makes it.
    if (producerOf(definition, values[cols.kind])?.hold === true) values[cols.status] = 'held';
    return;
  }

  // An update. The hooks see only a row the caller could read.
  if (record === null) return;
  const from = String(record[cols.status] ?? '');
  // Judged on this status: the UPDATE applies only while the row still holds it (a send meanwhile refuses it).
  event.expect = { ...(event.expect ?? {}), [cols.status]: record[cols.status] ?? null };
  const to = has(cols.status) && !empty(values[cols.status]) ? String(values[cols.status]) : from;
  const moment = (column: string) => ['timestamp', 'timestamptz'].includes(target.table.columns.get(column)?.logicalType ?? '');
  const changed = (column: string | undefined) => column !== undefined && has(column) && !same(values[column], record[column], moment(column));

  // Adminium's own columns: refused when changed, dropped when repeated — never written by a person.
  for (const column of adminiums) {
    if (changed(column)) byAdminium(column);
    delete values[column];
  }
  for (const column of identity) {
    if (changed(column)) refuse(column, `"${column}" says what the message is and what it is about, so it is fixed once the message is made.`);
  }
  if (from === 'sent') {
    const owned = [cols.status, cols.to, cols.language, cols.due, ...overrides];
    const touched = owned.find((column) => changed(column));
    if (touched !== undefined) {
      refuse(touched, 'This message was sent, so it stays as it was sent: it is never queued, re-addressed or re-worded again.', { from, to });
    }
    return;
  }
  const producer = producerOf(definition, record[cols.kind]);
  const held = producer?.hold === true;
  // Rewording: a held message of a producer that holds, which Adminium addresses.
  for (const column of overrides) {
    if (changed(column) && (!held || from !== 'held')) refuse(column, 'Only a message waiting for approval can be reworded, before or as it is approved.', { from, to });
  }
  // A held reminder goes where Adminium addresses it, never where a person types.
  if (held && changed(cols.to)) refuse(cols.to, 'This message goes to the address on file, looked up when it is sent.');
  if (to !== from && !(PERSON_MOVES[from] ?? []).includes(to)) {
    const message =
      to === 'sent' || to === 'failed'
        ? 'Only Adminium marks a message sent or failed, when it sends it.'
        : `A message that is ${from || 'without a status'} can't be made ${to} by hand.`;
    refuse(cols.status, message, { from, to });
  }
  if (to === from) return;

  if (to === 'skipped') {
    if (cols.skipReason !== undefined) values[cols.skipReason] = 'by-hand';
    return;
  }
  // → queued: an approval (from held) or a second try (from failed). A second
  // try keeps when the first went and why it failed: the sender reads a queued
  // row that says when it went and records no failure as sent already.
  if (cols.skipReason !== undefined && !empty(record[cols.skipReason])) values[cols.skipReason] = null;
  if (from !== 'held') return;
  if (cols.approvedBy !== undefined) values[cols.approvedBy] = context.actor?.label ?? null;
  const now = deps.now?.() ?? Date.now();
  // Approved before its day: it goes now.
  if (cols.due !== undefined) {
    const due = slotInstant(has(cols.due) ? values[cols.due] : record[cols.due]);
    if (due !== null && due.getTime() > now) values[cols.due] = new Date(now).toISOString();
  }
  // A producer's message is addressed as the person is now, not as they were
  // when it was made; one a person wrote and addressed by hand keeps its address.
  if (producer === undefined) return;
  const merged: Row = { ...record, ...values };
  const addressed = await addressFor(
    { db: target.db, view: target.view, outboxId: target.table.id, read: settingReader(deps.meta, target.db) },
    definition,
    producer,
    merged,
  );
  values[cols.to] = addressed.address;
  if (cols.language !== undefined && addressed.language !== null) values[cols.language] = addressed.language;
}
