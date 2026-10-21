// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A reminder waits while the customer's payment is on its way.
 *
 * A payment by direct debit (SEPA and its kind) is started at once and
 * confirmed by the bank days later. A "please pay" email about the same
 * record in those days would ask the customer to pay twice, so an app's
 * outbox asks here, just before it sends a message about a row: is a payment
 * for that row waiting for the bank? While one is, the message waits (an hour
 * at a time) and says why; once the payment settles either way, it goes, or
 * the outbox's own rules drop it (paid).
 */
import { paymentAttemptsRepo, type MetaDb } from '@adminium/meta';

import type { ResolvedTable } from '../crud/identifiers.js';
import type { Row } from '../crud/mask.js';
import { rowKeyOf } from './payables.js';

/** How long a held message waits before it is judged again. */
export const PAYMENT_HOLD_RETRY_MS = 60 * 60_000;

/** Since when a payment for this row has been waiting for the bank, live or test; null when none is. */
export async function paymentWaitingSince(meta: MetaDb, connectionId: string, table: ResolvedTable, row: Row): Promise<number | null> {
  if (table.primaryKey.length === 0) return null;
  const rowKey = rowKeyOf(table, row);
  const attempts = paymentAttemptsRepo(meta);
  for (const kind of ['shape', 'profile'] as const) {
    for (const mode of ['live', 'test'] as const) {
      const open = await attempts.openFor({ kind, connectionId, tableName: table.id, rowKey }, mode);
      if (open !== null && open.state === 'processing') return open.createdAt;
    }
  }
  return null;
}

/** What the desk reads on a held message. */
export function paymentHoldSentence(since: number): string {
  return `Waiting: a payment for this record has been on its way since ${new Date(since).toISOString().slice(0, 10)}. It goes once the bank settles it.`;
}
