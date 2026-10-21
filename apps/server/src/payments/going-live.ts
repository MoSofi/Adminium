// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Switching live payments on, and taking a service's keys away.
 *
 * ─── LIVE ON ENDS THE TESTS ────────────────────────────────────────────────
 *
 * Once live payments are on, a customer is never sent a test page: every
 * current test link is revoked (its holder reads "This was a test link"),
 * and every test checkout still open is ended at its service where it has
 * one, then marked expired. A test payment already waiting for the bank is
 * left to finish: it is pretend money, already in motion.
 *
 * ─── REMOVING THE KEYS ─────────────────────────────────────────────────────
 *
 * Deletes the service's saved keys for both modes, and the setup document's
 * hints and Checks with them; the account ids, the history of payments and
 * the checklist's dates stay. With payments still on their way, the person
 * must say they will settle them by hand at the service: Adminium can no
 * longer read them. It never cancels the key at the service; the page says
 * to roll it there.
 */
import { DEMO_PAYMENT_KEY, isProviderError, PAYMENT_MODES, sameAmount, type PaymentMode } from '@adminium/add-on-contracts';
import { paymentAttemptsRepo, paymentLinksRepo, refundsRepo, type ManifestsRepo, type MetaDb } from '@adminium/meta';

import type { ProviderLookup } from './providers.js';
import { mutateServiceState, type ServiceState } from './services.js';

/** States in which a payment is still on its way. */
export const ON_ITS_WAY = ['creating', 'open', 'processing', 'succeeded', 'recording'] as const;

/** How long after a payment a refund is still counted possible. */
export const REFUNDABLE_DAYS = 180;

export interface GoingLiveDeps {
  meta: MetaDb;
  providerFor: (key: string, mode: PaymentMode) => Promise<ProviderLookup>;
  now?: () => number;
}

/** Ends every current test link and every open test checkout. Best effort per checkout; a link is always revoked. */
export async function endTestWork(deps: GoingLiveDeps): Promise<{ links: number; checkouts: number }> {
  const at = (deps.now ?? Date.now)();
  const links = await paymentLinksRepo(deps.meta).revokeTestLinks(at);
  const attempts = paymentAttemptsRepo(deps.meta);
  let checkouts = 0;
  for (const attempt of await attempts.list({ mode: 'test', states: ['open'], limit: 500 })) {
    if (attempt.providerRef !== null && attempt.provider !== DEMO_PAYMENT_KEY) {
      const lookup = await deps.providerFor(attempt.provider, 'test').catch(() => null);
      if (lookup?.ok === true) {
        const answer = await lookup.provider.expire(attempt.providerRef).catch(() => null);
        // Already taken at the service: that is a test payment that went through, and it is read as such.
        if (answer !== null && !isProviderError(answer) && (answer.status === 'succeeded' || answer.status === 'processing')) continue;
      }
    }
    if (await attempts.move(attempt.id, 'expired', {}, at)) checkouts += 1;
  }
  return { links, checkouts };
}

/** Switches live payments on or off for a service. On ends the tests (above). */
export async function setLive(deps: GoingLiveDeps, key: string, on: boolean): Promise<{ state: ServiceState; ended: { links: number; checkouts: number } | null }> {
  const at = (deps.now ?? Date.now)();
  const { state, result: changed } = await mutateServiceState(deps.meta, key, (current) => ({ state: { ...current, liveOn: on }, result: current.liveOn !== on }), at);
  const ended = on && changed === true ? await endTestWork(deps) : null;
  return { state, ended };
}

/** How many of a service's payments are still on its way, in both modes. */
export async function waitingCount(meta: MetaDb, key: string): Promise<number> {
  let count = 0;
  for (const mode of PAYMENT_MODES) count += await paymentAttemptsRepo(meta).countIn(key, mode, ON_ITS_WAY);
  return count;
}

/** How many live payments of the last 180 days could still be refunded (not refunded in full). */
export async function refundableCount(meta: MetaDb, key: string, at: number): Promise<number> {
  const recorded = await paymentAttemptsRepo(meta).list({ provider: key, mode: 'live', states: ['recorded'], limit: 500 });
  let count = 0;
  for (const attempt of recorded) {
    if (attempt.createdAt < at - REFUNDABLE_DAYS * 86_400_000 || attempt.paymentRef === null) continue;
    const refunded = await refundsRepo(meta).committed(attempt.paymentRef);
    if (!sameAmount(refunded, attempt.takenAmount ?? attempt.amount)) count += 1;
  }
  return count;
}

/** Removes a service's saved keys (both modes) and their hints and Checks. */
export async function removeKeys(meta: MetaDb, manifests: Pick<ManifestsRepo, 'deleteCredential'>, manifestId: string, key: string, at: number): Promise<ServiceState> {
  await manifests.deleteCredential(manifestId);
  const { state } = await mutateServiceState(
    meta,
    key,
    (current) => ({
      state: {
        ...current,
        // Without keys nothing can be live; the account ids and dates stay for the history.
        liveOn: false,
        test: { ...current.test, fields: {}, check: null },
        live: { ...current.live, fields: {}, check: null },
      },
    }),
    at,
  );
  return state;
}

/**
 * Rows that went with sample data: their pay links end and their open
 * checkouts close (a page still open at the service is ended there when it
 * can be). A payment already waiting for the bank is left to finish.
 */
export async function endPaymentsForRows(deps: GoingLiveDeps, connectionId: string, rows: readonly { table: { id: string; primaryKey: readonly string[] }; pk: Record<string, unknown> }[]): Promise<{ links: number; checkouts: number }> {
  const at = (deps.now ?? Date.now)();
  const links = paymentLinksRepo(deps.meta);
  const attempts = paymentAttemptsRepo(deps.meta);
  let ended = { links: 0, checkouts: 0 };
  for (const { table, pk } of rows) {
    const rowKey = table.primaryKey.length === 1 ? String(pk[table.primaryKey[0]!]) : JSON.stringify(table.primaryKey.map((column) => pk[column] ?? null));
    for (const kind of ['shape', 'profile'] as const) {
      const ref = { kind, connectionId, tableName: table.id, rowKey };
      ended = { ...ended, links: ended.links + (await links.retire(ref)) };
      for (const mode of PAYMENT_MODES) {
        const open = await attempts.openFor(ref, mode);
        if (open === null || (open.state !== 'open' && open.state !== 'creating')) continue;
        if (open.state === 'open' && open.providerRef !== null && open.provider !== DEMO_PAYMENT_KEY) {
          const lookup = await deps.providerFor(open.provider, open.mode).catch(() => null);
          if (lookup?.ok === true) await lookup.provider.expire(open.providerRef).catch(() => null);
        }
        if (await attempts.move(open.id, open.state === 'open' ? 'expired' : 'abandoned', {}, at)) ended = { ...ended, checkouts: ended.checkouts + 1 };
      }
    }
  }
  return ended;
}
