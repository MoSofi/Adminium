// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A request to pay waits while the customer's payment is on its way.
 *
 * A payment by direct debit (SEPA and its kind) is started at once and
 * confirmed by the bank days later. A "please pay" email about the same
 * record in those days would ask the customer to pay twice, so an app's
 * outbox asks here, just before it sends a message about a row: is a live
 * payment for that row waiting for the bank? While one is, the message waits
 * (an hour at a time); once the payment settles either way, it goes, or the
 * outbox's own rules drop it (paid).
 *
 * Only what asks for payment waits: a message whose producer says it is no
 * longer needed once the record is paid (a `dropWhen` with the reason
 * `paid`). A booking confirmation or a receipt never does. Only live
 * payments, of a service that still has its keys, and for at most 14 days:
 * a payment the provider never answers about must not silence a record's
 * mail for good.
 *
 * What the desk reads on a held message says nothing of a payment (the
 * outbox log is read by people who may not see payments): "Held for now."
 */
import { appTablesRepo, payableProfilesRepo, paymentAttemptsRepo, paymentSettingsRepo, type MetaDb } from '@adminium/meta';

import type { ResolvedTable } from '../crud/identifiers.js';
import type { Row } from '../crud/mask.js';
import { rowKeyOf } from './payables.js';
import { emptyServiceState, serviceDocName, serviceStateSchema } from './services.js';

/** How long a held message waits before it is judged again. */
export const PAYMENT_HOLD_RETRY_MS = 60 * 60_000;
/** The longest a payment on its way holds a record's requests to pay (the same horizon Activity calls "waiting long"). */
export const PAYMENT_HOLD_MAX_MS = 14 * 86_400_000;

/** Whether a producer asks for payment: its messages are no longer needed once the record is paid. */
export function asksForPayment(producer: { dropWhen?: readonly { reason?: string }[] | undefined }): boolean {
  return (producer.dropWhen ?? []).some((condition) => condition.reason === 'paid');
}

/**
 * Since when a live payment for a row has been waiting for the bank, or null.
 * One per batch of messages: which tables take payments is read once per table.
 */
export function createPaymentHolds(meta: MetaDb, connectionId: string, now: number): (table: ResolvedTable, row: Row) => Promise<number | null> {
  const payable = new Map<string, Promise<readonly ('shape' | 'profile')[]>>();
  const kindsOf = (table: ResolvedTable): Promise<readonly ('shape' | 'profile')[]> => {
    let known = payable.get(table.id);
    if (known === undefined) {
      known = (async () => {
        const out: ('shape' | 'profile')[] = [];
        const short = table.id.includes('.') ? table.id.slice(table.id.indexOf('.') + 1) : table.id;
        if ((await appTablesRepo(meta).byTable(connectionId, short)).some((record) => /^invoices\/invoice@\d+#document$/.test(record.builtOn ?? ''))) out.push('shape');
        const profile = await payableProfilesRepo(meta).byTable(connectionId, table.id);
        if (profile !== null && profile.enabled) out.push('profile');
        return out;
      })();
      payable.set(table.id, known);
    }
    return known;
  };
  return async (table, row) => {
    if (table.primaryKey.length === 0) return null;
    const kinds = await kindsOf(table);
    if (kinds.length === 0) return null;
    const rowKey = rowKeyOf(table, row);
    for (const kind of kinds) {
      const open = await paymentAttemptsRepo(meta).openFor({ kind, connectionId, tableName: table.id, rowKey }, 'live');
      if (open === null || open.state !== 'processing' || open.createdAt < now - PAYMENT_HOLD_MAX_MS) continue;
      const state = (await paymentSettingsRepo(meta).get(serviceDocName(open.provider), serviceStateSchema)) ?? emptyServiceState();
      // A service whose keys were removed can no longer learn how it ends: nothing waits on it.
      if (Object.keys(state.live.fields).length === 0) continue;
      return open.createdAt;
    }
    return null;
  };
}

/** What the desk reads on a held message: nothing of a payment. */
export function paymentHoldSentence(): string {
  return 'Held for now. It is looked at again in an hour.';
}
