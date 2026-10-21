// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Switching live payments on, and taking a service's keys away.
 *
 * ─── LIVE ON ENDS THE TESTS ────────────────────────────────────────────────
 *
 * Once live payments are on, a customer is never sent a test page: every
 * current test link is revoked (its holder reads "This was a test link"),
 * and every test checkout still open (or being made) is ended at its service
 * where it has one, then closed. A test payment already waiting for the bank
 * is left to finish: it is pretend money, already in motion. Turning live on
 * again ends whatever test work is left, so a try that failed half-way is
 * finished by the next.
 *
 * ─── REMOVING THE KEYS ─────────────────────────────────────────────────────
 *
 * In order: the service is stopped (no new checkout starts); every checkout
 * still open is ended at the service while the keys still work; then what is
 * still in motion is counted — payments waiting for the bank, and refunds not
 * yet done. With any, the person must say they will settle them by hand at the
 * service, and those payments are closed as `expired`, flagged for Activity
 * with that note (Adminium can no longer read them). Then the saved keys of
 * both modes go, and the setup document's hints and Checks with them; the
 * account ids, the history and the checklist's dates stay. A payment already
 * taken is still recorded: that needs no key. It never cancels the key at the
 * service; the page says to roll it there.
 */
import { DEMO_PAYMENT_KEY, isProviderError, PAYMENT_MODES, sameAmount, type PaymentMode } from '@adminium/add-on-contracts';
import { paymentAttemptsRepo, paymentLinksRepo, sumAmounts, type ManifestsRepo, type MetaDb } from '@adminium/meta';

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

/**
 * Ends the open checkouts of one mode (and one service, when named), at the
 * service first where it can be. A checkout the service says was already paid
 * is left alone: that payment is read and recorded as any other.
 */
async function endCheckouts(deps: GoingLiveDeps, filter: { mode: PaymentMode; provider?: string }): Promise<number> {
  const at = (deps.now ?? Date.now)();
  const attempts = paymentAttemptsRepo(deps.meta);
  let ended = 0;
  let before: { at: number; id: string } | undefined;
  // Page by page, so none is left behind a first page the service kept answering "paid" for.
  for (;;) {
    const page = await attempts.list({ mode: filter.mode, states: ['open', 'creating'], ...(filter.provider === undefined ? {} : { provider: filter.provider }), ...(before === undefined ? {} : { before }), limit: 200 });
    for (const attempt of page) {
      if (attempt.state === 'open' && attempt.providerRef !== null && attempt.provider !== DEMO_PAYMENT_KEY) {
        const lookup = await deps.providerFor(attempt.provider, attempt.mode).catch(() => null);
        if (lookup?.ok === true) {
          const answer = await lookup.provider.expire(attempt.providerRef).catch(() => null);
          if (answer !== null && !isProviderError(answer) && (answer.status === 'succeeded' || answer.status === 'processing')) continue;
        }
      }
      if (await attempts.move(attempt.id, attempt.state === 'open' ? 'expired' : 'abandoned', {}, at)) ended += 1;
    }
    const last = page.at(-1);
    if (page.length < 200 || last === undefined) break;
    before = { at: last.createdAt, id: last.id };
  }
  return ended;
}

/** Ends every current test link and every open test checkout. Safe to run again: it ends what is left. */
export async function endTestWork(deps: GoingLiveDeps): Promise<{ links: number; checkouts: number }> {
  const at = (deps.now ?? Date.now)();
  const links = await paymentLinksRepo(deps.meta).revokeTestLinks(at);
  return { links, checkouts: await endCheckouts(deps, { mode: 'test' }) };
}

/** Switches live payments on or off for a service. On ends the tests (above), every time. */
export async function setLive(deps: GoingLiveDeps, key: string, on: boolean): Promise<{ state: ServiceState; ended: { links: number; checkouts: number } | null }> {
  const at = (deps.now ?? Date.now)();
  const { state } = await mutateServiceState(deps.meta, key, (current) => ({ state: { ...current, liveOn: on } }), at);
  const ended = on ? await endTestWork(deps) : null;
  return { state, ended };
}

/** Refund states still in motion at the service. */
export const REFUND_IN_MOTION = ['requested', 'pending', 'requires_action'] as const;

/** How much of a service's money is still in motion, in both modes: payments on their way and refunds not done. */
export async function waitingCount(meta: MetaDb, key: string): Promise<number> {
  let count = 0;
  for (const mode of PAYMENT_MODES) count += await paymentAttemptsRepo(meta).countIn(key, mode, ON_ITS_WAY);
  const refunds = await meta.db
    .selectFrom('adminium_refunds')
    .select((eb) => eb.fn.countAll<number>().as('n'))
    .where('provider', '=', key)
    .where('state', 'in', [...REFUND_IN_MOTION])
    .executeTakeFirst();
  return count + Number(refunds?.n ?? 0);
}

/** How many live payments of the last 180 days could still be refunded (not refunded in full): two reads. */
export async function refundableCount(meta: MetaDb, key: string, at: number): Promise<number> {
  const since = at - REFUNDABLE_DAYS * 86_400_000;
  const recorded = await meta.db
    .selectFrom('adminium_payment_attempts')
    .select(['paymentRef', 'takenAmount', 'amount'])
    .where('provider', '=', key)
    .where('mode', '=', 'live')
    .where('state', '=', 'recorded')
    .where('createdAt', '>=', since)
    .where('paymentRef', 'is not', null)
    .limit(5000)
    .execute();
  if (recorded.length === 0) return 0;
  const refunds = await meta.db
    .selectFrom('adminium_refunds')
    .select(['paymentRef', 'amount'])
    .where('provider', '=', key)
    .where('mode', '=', 'live')
    .where('state', 'not in', ['failed', 'cancelled'])
    .where('createdAt', '>=', since)
    .execute();
  const refunded = new Map<string, string[]>();
  for (const refund of refunds) {
    if (refund.paymentRef === null) continue;
    refunded.set(refund.paymentRef, [...(refunded.get(refund.paymentRef) ?? []), refund.amount]);
  }
  let count = 0;
  for (const attempt of recorded) {
    const total = sumAmounts(refunded.get(attempt.paymentRef!) ?? []);
    if (!sameAmount(total, attempt.takenAmount ?? attempt.amount)) count += 1;
  }
  return count;
}

/** What removing the keys found: refused (money in motion, not confirmed), or done. */
export type RemoveKeysOutcome = { removed: false; waiting: number } | { removed: true; state: ServiceState; waiting: number; ended: number; leftByHand: number };

/**
 * Removes a service's keys in the safe order (the header above): stop, end the
 * open checkouts while the keys work, count what is still in motion, then —
 * with nothing in motion, or the person's word they settle it by hand — close
 * those payments for Activity and delete the keys.
 */
export async function removeKeysSafely(
  deps: GoingLiveDeps & { manifests: Pick<ManifestsRepo, 'deleteCredential'> },
  input: { manifestId: string; key: string; settleByHand: boolean },
): Promise<RemoveKeysOutcome> {
  const at = (deps.now ?? Date.now)();
  // No new checkout starts from here on.
  await mutateServiceState(deps.meta, input.key, (current) => ({ state: { ...current, stopped: true } }), at);
  let ended = 0;
  for (const mode of PAYMENT_MODES) ended += await endCheckouts(deps, { mode, provider: input.key });
  const waiting = await waitingCount(deps.meta, input.key);
  if (waiting > 0 && !input.settleByHand) return { removed: false, waiting };
  // Payments waiting for the bank can no longer be read: closed, and flagged with what the person said.
  const attempts = paymentAttemptsRepo(deps.meta);
  let leftByHand = 0;
  for (const mode of PAYMENT_MODES) {
    for (const attempt of await attempts.list({ mode, provider: input.key, states: ['processing'], limit: 5000 })) {
      const note = { code: 'SETTLE_BY_HAND', message: 'The keys were removed while this payment was on its way; it is settled by hand at the service.' };
      if (await attempts.move(attempt.id, 'expired', { problem: note }, at)) {
        await attempts.flag(attempt.id, at);
        leftByHand += 1;
      }
    }
  }
  const state = await removeKeys(deps.meta, deps.manifests, input.manifestId, input.key, at);
  return { removed: true, state, waiting, ended, leftByHand };
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
