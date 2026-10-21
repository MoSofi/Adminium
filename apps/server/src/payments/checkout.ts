// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Starting a checkout, and settling one.
 *
 * ─── STARTING (a customer pressed Pay) ─────────────────────────────────────
 *
 * The payable has at most one attempt that holds it (`open_key`): from the
 * moment it is made until its payment is written down. So:
 *
 *   1. An attempt already holding the payable:
 *      - open, for the same service, the same amount and still due → reused:
 *        the customer goes back to the same provider page;
 *      - open for another amount or service → ended at the provider first; if
 *        it had already completed there, nothing new is made and the customer
 *        is told a payment is on its way;
 *      - processing, succeeded or being recorded → nothing new: "a payment is
 *        on its way";
 *      - being created by another request this moment → "try again".
 *   2. The last attempt that let go of the payable while its provider page
 *      may still be open (a declined card reads `failed` while Stripe keeps
 *      the page open for another card) is ended at the provider too, so two
 *      pages can never both take the money.
 *   3. A new attempt is made (`creating`), the provider is asked for a
 *      checkout with the attempt id as its reference, the page it answers
 *      with is checked against the provider's own hosts, and only then is
 *      the attempt `open` and the customer sent there.
 *
 * ─── SETTLING (the return page, a webhook, the sweep) ──────────────────────
 *
 * The provider's own status is the only truth: never a redirect, never a
 * webhook body. A checkout that the customer approved but that still needs
 * a second step (a PayPal capture) is completed here, after the payable is
 * read again: if it no longer owes what was asked, it is not captured. A
 * success whose mode is not the attempt's is not believed. A success moves
 * the attempt to `succeeded` and queues the record job, which checks the
 * amounts once more and writes the payment exactly once.
 *
 * Settling one attempt runs one at a time in this process (the three callers
 * can arrive together), and a provider's capture key is per attempt, so a
 * second process at worst retries.
 */
import { isProviderError, sameAmount, type CheckoutState, type PaymentMode, type PaymentProvider } from '@adminium/add-on-contracts';
import { paymentAttemptsRepo, type MetaDb, type PaymentAttempt, type PaymentLink } from '@adminium/meta';
import { randomBytes } from 'node:crypto';

import { resolvePayable, type PayableSources, type ResolvedPayable } from './payables.js';
import { checkoutUrlAllowed, type ProviderLookup } from './providers.js';
import { enqueueRecord } from './record.js';

export interface CheckoutDeps {
  meta: MetaDb;
  sources: PayableSources;
  /** The provider for a key and mode, built for one operation (`paymentProviderFor`). */
  providerFor: (key: string, mode: PaymentMode) => Promise<ProviderLookup>;
  enqueue: (input: { kind: string; payload: Record<string, unknown>; dedupeKey: string; maxAttempts: number }) => Promise<unknown>;
  now?: () => number;
}

export interface StartInput {
  link: PaymentLink;
  payable: ResolvedPayable;
  provider: string;
  /** The ways the shop's rules allow this customer (`waysFor`), by the provider's method ids. */
  methods: readonly string[];
  /** The pay address: `https://pay.example.com`. */
  payAddress: string;
  /** The customer's language, one of Adminium's eight, or null. */
  locale: string | null;
}

export type StartOutcome =
  | { kind: 'redirect'; url: string; attemptId: string; reused: boolean }
  /** A payment for this payable is already on its way (or arrived): nothing new is made. */
  | { kind: 'in-progress'; attemptId: string }
  /** Another request is making a checkout for it this moment. */
  | { kind: 'busy' }
  /** The provider could not make the checkout; the words are the provider's. */
  | { kind: 'refused'; code: string; message: string; retryable: boolean };

const HELD_ELSEWHERE: readonly string[] = ['processing', 'succeeded', 'recording'];

/** The nonce the return address carries instead of the link's token. */
export function newAttemptNonce(): string {
  return randomBytes(16).toString('base64url');
}

const settling = new Map<string, Promise<PaymentAttempt | null>>();

export function createCheckoutService(deps: CheckoutDeps) {
  const now = deps.now ?? (() => Date.now());
  const attempts = paymentAttemptsRepo(deps.meta);

  async function provider(attempt: Pick<PaymentAttempt, 'provider' | 'mode'>): Promise<PaymentProvider | null> {
    const lookup = await deps.providerFor(attempt.provider, attempt.mode);
    return lookup.ok ? lookup.provider : null;
  }

  /** Ends an attempt's checkout at the provider. True when ended (or already ended); false when it completed there. */
  async function endAtProvider(attempt: PaymentAttempt): Promise<boolean> {
    if (attempt.providerRef === null) return true;
    const service = await provider(attempt);
    if (service === null) return true;
    const answer = await service.expire(attempt.providerRef);
    if (isProviderError(answer)) return answer.code !== 'ALREADY_COMPLETED';
    return answer.status !== 'succeeded' && answer.status !== 'processing';
  }

  async function start(input: StartInput): Promise<StartOutcome> {
    const { payable } = input;
    const held = await attempts.openFor(payable.ref);
    if (held !== null) {
      if (HELD_ELSEWHERE.includes(held.state)) return { kind: 'in-progress', attemptId: held.id };
      if (held.state === 'creating') return { kind: 'busy' };
      // `open`.
      const same = held.provider === input.provider && held.mode === input.link.mode && held.currency === payable.currency && sameAmount(held.amount, payable.due);
      if (same && held.checkoutUrl !== null) return { kind: 'redirect', url: held.checkoutUrl, attemptId: held.id, reused: true };
      if (!(await endAtProvider(held))) {
        void settle(held.id);
        return { kind: 'in-progress', attemptId: held.id };
      }
      await attempts.move(held.id, 'expired', {}, now());
    }

    // A page that may still be open behind an attempt that let the payable go.
    const [last] = await attempts.forPayable(payable.ref, 1);
    if (last !== undefined && last.state === 'failed' && last.providerRef !== null && !(await endAtProvider(last))) {
      void settle(last.id);
      return { kind: 'in-progress', attemptId: last.id };
    }

    const lookup = await deps.providerFor(input.provider, input.link.mode);
    if (!lookup.ok) return { kind: 'refused', code: lookup.code, message: lookup.message, retryable: false };
    const nonce = newAttemptNonce();
    const attempt = await attempts.create(
      {
        provider: input.provider,
        mode: input.link.mode,
        accountId: null,
        payable: payable.ref,
        payableLabel: payable.label,
        amount: payable.due,
        currency: payable.currency,
        linkId: input.link.id,
        nonce,
        createdBy: null,
      },
      now(),
    );
    // Another request made one between our read and our write: theirs stands.
    if (attempt === null) return { kind: 'busy' };

    const address = input.payAddress.replace(/\/$/, '');
    const made = await lookup.provider.createCheckout({
      payable: { reference: payable.label, description: payable.label, amount: payable.due, currency: payable.currency, customerEmail: payable.customerEmail, locale: input.locale },
      methods: input.methods,
      successUrl: `${address}/pay/back/${nonce}`,
      cancelUrl: `${address}/pay/back/${nonce}?left=1`,
      attemptId: attempt.id,
      idempotencyKey: `${attempt.id}:create`,
    });
    if (isProviderError(made)) {
      await attempts.move(attempt.id, 'failed', { problem: { code: made.code, message: made.providerMessage } }, now());
      return { kind: 'refused', code: made.code, message: made.providerMessage, retryable: made.retryable };
    }
    // The demo's page is this server's own; every other provider's must be on its declared hosts.
    const allowed = input.provider === 'demo' ? new URL(made.url).origin === new URL(address).origin : checkoutUrlAllowed(made.url, lookup.redirectHosts);
    if (!allowed) {
      await attempts.move(attempt.id, 'failed', { providerRef: made.ref, problem: { code: 'REDIRECT_REFUSED', message: 'The payment service answered with a page on a host it never declared.' } }, now());
      return { kind: 'refused', code: 'REDIRECT_REFUSED', message: 'The payment service answered with a page Adminium will not send you to.', retryable: false };
    }
    await attempts.move(attempt.id, 'open', { providerRef: made.ref, checkoutUrl: made.url }, now());
    return { kind: 'redirect', url: made.url, attemptId: attempt.id, reused: false };
  }

  /** Moves an attempt as the provider's own status says. */
  async function apply(attempt: PaymentAttempt, state: CheckoutState): Promise<void> {
    const at = now();
    const moved = (to: Parameters<typeof attempts.move>[1], patch: Parameters<typeof attempts.move>[2] = {}) => attempts.move(attempt.id, to, patch, at);
    if (state.status === 'succeeded') {
      if (state.livemode !== (attempt.mode === 'live')) {
        await attempts.note(attempt.id, attempt.state, { problem: { code: 'MODE_MISMATCH', message: `The payment service reported a ${state.livemode ? 'live' : 'test'} payment for a ${attempt.mode} attempt.` } }, at);
        await attempts.flag(attempt.id, at);
        return;
      }
      if (attempt.state === 'succeeded' || attempt.state === 'recording' || attempt.state === 'recorded' || attempt.state === 'record_refused') return;
      const ok = await moved('succeeded', {
        paymentRef: state.paymentRef,
        takenAmount: state.amount,
        takenCurrency: state.currency,
        paidWith: state.paidWith,
        settledAt: state.settledAt ?? at,
      });
      if (ok) await enqueueRecord(deps.enqueue, attempt.id);
      return;
    }
    if (state.status === 'processing' && attempt.state === 'open') {
      await moved('processing', { paymentRef: state.paymentRef, takenAmount: state.amount, takenCurrency: state.currency, paidWith: state.paidWith });
      return;
    }
    const closing = { failed: 'failed', expired: 'expired', cancelled: 'cancelled' } as const;
    if (state.status in closing && (attempt.state === 'open' || attempt.state === 'processing')) {
      await moved(closing[state.status as keyof typeof closing], state.failureMessage === null ? {} : { problem: { code: state.status.toUpperCase(), message: state.failureMessage } });
    }
  }

  async function settleOnce(attemptId: string): Promise<PaymentAttempt | null> {
    const attempt = await attempts.byId(attemptId);
    if (attempt === null || attempt.providerRef === null) return attempt;
    if (attempt.state === 'recorded' || attempt.state === 'recording' || attempt.state === 'record_refused' || attempt.state === 'abandoned') return attempt;
    const service = await provider(attempt);
    if (service === null) return attempt;
    let state = await service.status(attempt.providerRef);
    if (isProviderError(state)) return attempt;
    // Approved but not taken yet (a two-step provider): take it only if the payable still owes exactly this.
    if (state.status === 'pending' && (attempt.state === 'open' || attempt.state === 'failed')) {
      const payable = await resolvePayable(deps.sources, attempt.payable);
      const owes = payable !== null && payable.refusal === null && payable.currency === attempt.currency && sameAmount(payable.due, attempt.amount);
      if (owes) {
        const completed = await service.complete(attempt.providerRef, `${attempt.id}:capture`);
        if (!isProviderError(completed)) state = completed;
      }
    }
    await apply(attempt, state);
    return attempts.byId(attempt.id);
  }

  /** Settles one attempt, one call at a time per attempt in this process. */
  function settle(attemptId: string): Promise<PaymentAttempt | null> {
    const running = settling.get(attemptId);
    if (running !== undefined) return running;
    const run = settleOnce(attemptId).finally(() => settling.delete(attemptId));
    settling.set(attemptId, run);
    return run;
  }

  return { start, settle };
}

export type CheckoutService = ReturnType<typeof createCheckoutService>;
