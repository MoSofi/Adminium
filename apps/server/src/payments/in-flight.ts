// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A payment ON ITS WAY for one record: the service has said it is processing
 * (a bank confirming), or it succeeded and Adminium is writing it down. A
 * timed move that waits for payments waits while one is (`waitsForPayment`);
 * a move that says `requires.noPaymentInFlight` is refused while one is (a
 * diner who chose "pay when you pick up instead" while their card is landing).
 * An attempt older than `PAYMENT_WAIT_MS` is no longer waited for: a payment
 * slower than that goes to a person, as any late money does.
 */
import { paymentAttemptsRepo, type MetaDb } from '@adminium/meta';

/** The longest a move waits for a payment on its way (a provider's page lives six hours at most). */
export const PAYMENT_WAIT_MS = 7 * 3_600_000;

/** The attempt states in which money is on its way and not yet written down. */
export const IN_FLIGHT_STATES: readonly string[] = ['processing', 'succeeded', 'recording'];

/** Whether a payment for the record (one table, one key) is on its way now. */
export async function paymentInFlight(meta: MetaDb, connectionId: string, tableName: string, rowKey: string, now: number): Promise<boolean> {
  const attempts = paymentAttemptsRepo(meta);
  for (const kind of ['profile', 'shape'] as const) {
    const found = await attempts.forPayable({ kind, connectionId, tableName, rowKey });
    if (found.some((attempt) => IN_FLIGHT_STATES.includes(attempt.state) && now - attempt.createdAt < PAYMENT_WAIT_MS)) return true;
  }
  return false;
}
