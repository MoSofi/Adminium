// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHAT A PERSON MAY DO TO A MESSAGE — the moves of an outbox row's status.
 *
 * A person (or an API key, an import's update, a rule, an undo) may:
 *  - approve a held message: held → queued, with the wording edited
 *    (`subject_override`, `body_override`). Who approved it is written in
 *    `approved_by`; the address is looked up again, as the person is now; a
 *    message approved before its day goes at once (its due moves to now);
 *  - skip a held or queued one: → skipped, the reason `by-hand`;
 *  - queue a failed one again: failed → queued.
 * Only Adminium marks a message sent or failed — when it sends it — and a
 * sent message stays as it was sent: never queued again, never re-addressed
 * or re-worded. So no writer can send a reminder twice, or mark one sent
 * that never went. A new row a person makes starts queued or held; an import
 * (history, an app's sample data) may bring any.
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
  // What only Adminium writes: when it sent, who approved, what the effect did.
  const adminiums = [cols.sentAt, cols.approvedBy, cols.effectAt, cols.effectError].filter((column): column is string => column !== undefined);
  const has = (column: string) => Object.prototype.hasOwnProperty.call(values, column);
  if (action === 'delete') return;

  if (action === 'create') {
    // History — an import, an app's sample data — may bring a message in any state.
    if (context.origin === 'import') return;
    const status = values[cols.status];
    if (!empty(status) && status !== 'queued' && status !== 'held') {
      throw new OutboxMoveRefused('A new message starts queued or held: only Adminium marks one sent, failed or skipped.', { column: cols.status, to: status });
    }
    for (const column of [...adminiums, ...(cols.skipReason === undefined ? [] : [cols.skipReason])]) {
      if (has(column) && !empty(values[column])) throw new OutboxMoveRefused(`"${column}" is written by Adminium, not by hand.`, { column });
    }
    return;
  }

  // An update. The hooks see only a row the caller could read.
  if (record === null) return;
  const from = String(record[cols.status] ?? '');
  const to = has(cols.status) && !empty(values[cols.status]) ? String(values[cols.status]) : from;
  const moment = (column: string) => ['timestamp', 'timestamptz'].includes(target.table.columns.get(column)?.logicalType ?? '');
  const changed = (column: string | undefined) => column !== undefined && has(column) && !same(values[column], record[column], moment(column));

  for (const column of adminiums) {
    if (changed(column)) throw new OutboxMoveRefused(`"${column}" is written by Adminium, not by hand.`, { column });
  }
  if (from === 'sent') {
    const owned = [cols.kind, cols.status, cols.to, cols.language, cols.due, cols.error, cols.skipReason, cols.subjectOverride, cols.bodyOverride];
    const touched = owned.find((column) => changed(column));
    if (touched !== undefined) {
      throw new OutboxMoveRefused('This message was sent, so it stays as it was sent: it is never queued, re-addressed or re-worded again.', { column: touched, from, to });
    }
    return;
  }
  if (to === from) {
    // No move: a reason is Adminium's or a skip's, never written on its own.
    if (changed(cols.skipReason)) throw new OutboxMoveRefused(`"${cols.skipReason!}" is written when a message is skipped.`, { column: cols.skipReason! });
    return;
  }
  if (!(PERSON_MOVES[from] ?? []).includes(to)) {
    const message =
      to === 'sent' || to === 'failed'
        ? 'Only Adminium marks a message sent or failed, when it sends it.'
        : `A message that is ${from || 'without a status'} can't be made ${to} by hand.`;
    throw new OutboxMoveRefused(message, { column: cols.status, from, to });
  }

  if (to === 'skipped') {
    if (cols.skipReason !== undefined) values[cols.skipReason] = 'by-hand';
    return;
  }
  // → queued: an approval (from held) or a second try (from failed).
  if (cols.skipReason !== undefined && !empty(record[cols.skipReason])) values[cols.skipReason] = null;
  // A second try starts afresh: it has not been sent.
  if (from === 'failed' && cols.sentAt !== undefined && !empty(record[cols.sentAt])) values[cols.sentAt] = null;
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
  const merged: Row = { ...record, ...values };
  const producer = producerOf(box.definition, merged[cols.kind]);
  if (producer === undefined) return;
  const addressed = await addressFor(
    { db: target.db, view: target.view, outboxId: target.table.id, read: settingReader(deps.meta, target.db) },
    box.definition,
    producer,
    merged,
  );
  values[cols.to] = addressed.address;
  if (cols.language !== undefined && addressed.language !== null) values[cols.language] = addressed.language;
}
