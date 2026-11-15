// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The job that asks the money back for one of an app's refund rows, and
 * stamps the row (`app-refunds.ts`). Apart from it, so the refund's own moves
 * (`refunds.ts`) can queue a new stamp without reaching back into it.
 */
import { appRefundKeyOf, payableProfilesRepo, type AppRefundRow, type MetaDb, type PayableRef } from '@adminium/meta';

/**
 * Whether a payment's refunds are the app's own rows to write (the rows
 * model): then a refund is made in the app, where its refund row is written,
 * never asked from Adminium beside it (CR4). Its app, and the staff screen it
 * is made on.
 */
export async function refundsKeptInApp(meta: MetaDb, payable: PayableRef): Promise<{ app: string | null; openIn: string | null } | null> {
  if (payable.kind !== 'profile' || payable.connectionId === null || payable.tableName === null) return null;
  const profile = await payableProfilesRepo(meta).byTable(payable.connectionId, payable.tableName);
  const refunds = profile?.mapping?.refunds;
  return refunds?.model === 'rows' ? { app: profile!.ownerApp, openIn: refunds.openIn ?? null } : null;
}

export const PAYMENTS_APP_REFUND_JOB = 'payments.app-refund';
export const PAYMENTS_APP_REFUND_MAX_ATTEMPTS = 20;

type Enqueue = (input: { kind: string; payload: Record<string, unknown>; dedupeKey: string; maxAttempts: number }) => Promise<unknown>;

/** Queues the job for one refund row; once per row while it is queued. */
export async function enqueueAppRefund(deps: { enqueue?: Enqueue | undefined }, row: AppRefundRow): Promise<void> {
  await deps.enqueue?.({
    kind: PAYMENTS_APP_REFUND_JOB,
    payload: { connectionId: row.connectionId, table: row.table, rowKey: row.rowKey },
    dedupeKey: `${PAYMENTS_APP_REFUND_JOB}:${appRefundKeyOf(row)}`,
    maxAttempts: PAYMENTS_APP_REFUND_MAX_ATTEMPTS,
  });
}

/**
 * Whether this person may refund this payment: the install's refund right, or
 * the app's own (`payments:<app>:refund`, D20) for a payment of one of that
 * app's payables. Never with an API key.
 */
export async function mayRefundPayment(
  meta: MetaDb,
  request: { apiKeyPrincipal?: unknown; can: (permission: string) => Promise<boolean> },
  payable: PayableRef,
): Promise<boolean> {
  if (request.apiKeyPrincipal != null) return false;
  if (await request.can('system:payments:refund')) return true;
  if (payable.kind !== 'profile' || payable.connectionId === null || payable.tableName === null) return false;
  const owner = (await payableProfilesRepo(meta).byTable(payable.connectionId, payable.tableName))?.ownerApp ?? null;
  return owner !== null && (await request.can(`payments:${owner}:refund`));
}
