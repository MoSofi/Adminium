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
 * can arrive together), and a provider's capture key is per capture try, so a
 * second process at worst retries. When the provider cannot be asked (not
 * loaded, a timeout), the settle job fails and is tried again; the return page
 * and the sweep only read and ask again later.
 *
 * ─── DECLINES AND THE LINK'S LOCK ──────────────────────────────────────────
 *
 * Each decline the provider reports is counted against the pay link once
 * (through its own event, or the attempt's move to failed). A link with too
 * many in an hour is locked, and every provider page still open for it is
 * ended, so a card tester cannot keep trying cards on an open page.
 */
import { DEMO_PAYMENT_KEY, isProviderError, sameAmount, type CheckoutState, type PaymentMode } from '@adminium/add-on-contracts';
import { paymentAttemptsRepo, paymentCountersRepo, paymentSettingsRepo, type MetaDb, type PaymentAttempt, type PaymentLink } from '@adminium/meta';
import { randomBytes } from 'node:crypto';

import { resolvePayable, type PayableSources, type ResolvedPayable } from './payables.js';
import { checkoutUrlAllowed, type ProviderLookup } from './providers.js';
import { enqueueRecord } from './record.js';
import { mutateServiceState, serviceDocName, serviceStateSchema } from './services.js';

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

/** Declines on one pay link in an hour before it locks. */
export const LINK_FAILURES_TO_LOCK = 5;

/** The bucket a pay link's declines are counted in (per hour, in meta). */
export function linkFailBucket(linkId: string): string {
  return `link-fail:${linkId}`;
}

/**
 * No provider page lives longer than this (a Stripe page lasts a day at
 * most; Adminium captures a PayPal order within hours or never): an attempt
 * this old cannot take money any more, whatever its last answer.
 */
export const MAX_CHECKOUT_LIFE_MS = 48 * 60 * 60_000;

/** The nonce the return address carries instead of the link's token. */
export function newAttemptNonce(): string {
  return randomBytes(16).toString('base64url');
}

/** The settle job's provider could not be asked: the job is tried again, and its event is not marked handled. */
export class SettleUnanswered extends Error {
  constructor(readonly attemptId: string, readonly reason: string) {
    super(`The payment service could not be asked about ${attemptId}: ${reason}`);
    this.name = 'SettleUnanswered';
  }
}

export interface SettleOptions {
  /** Throw {@link SettleUnanswered} when the provider could not be asked (the settle job). */
  strict?: boolean;
  /** The stored event that queued this settle: a decline it reports counts once. */
  eventId?: string;
}

/** What ending a checkout at the provider came to. */
type Ended = 'ended' | 'completed' | 'unknown';

interface Settled {
  attempt: PaymentAttempt | null;
  /** False when the provider could not be asked. */
  answered: boolean;
  reason: string | null;
}

const settling = new Map<string, Promise<Settled>>();

export function createCheckoutService(deps: CheckoutDeps) {
  const now = deps.now ?? (() => Date.now());
  const attempts = paymentAttemptsRepo(deps.meta);
  const counters = paymentCountersRepo(deps.meta);

  /**
   * Ends an attempt's checkout at the provider. Only a provider that says so
   * (or says it never heard of it) counts as ended; one that cannot be asked
   * right now leaves it `unknown`, and nothing new may start over it.
   */
  async function endAtProvider(attempt: PaymentAttempt): Promise<Ended> {
    if (attempt.providerRef === null) return 'ended';
    if (attempt.createdAt < now() - MAX_CHECKOUT_LIFE_MS) return 'ended';
    const lookup = await deps.providerFor(attempt.provider, attempt.mode);
    if (!lookup.ok) return 'unknown';
    const answer = await lookup.provider.expire(attempt.providerRef);
    if (isProviderError(answer)) return answer.code === 'ALREADY_COMPLETED' ? 'completed' : answer.code === 'NOT_FOUND' ? 'ended' : 'unknown';
    if (answer.status === 'succeeded' || answer.status === 'processing') return 'completed';
    if (answer.status === 'expired' || answer.status === 'cancelled' || answer.status === 'failed') return 'ended';
    return 'unknown';
  }

  /**
   * Ends the page behind a declined attempt, once: its checkout URL is
   * cleared when the provider confirms, which is what marks it done.
   */
  async function endDeclined(attempt: PaymentAttempt): Promise<Ended> {
    if (attempt.state !== 'failed' || attempt.providerRef === null || attempt.checkoutUrl === null) return 'ended';
    const ended = await endAtProvider(attempt);
    if (ended === 'ended') await attempts.note(attempt.id, 'failed', { checkoutUrl: null }, now());
    return ended;
  }

  async function start(input: StartInput): Promise<StartOutcome> {
    const { payable } = input;
    const mode = input.link.mode;
    const held = await attempts.openFor(payable.ref, mode);
    if (held !== null) {
      if (HELD_ELSEWHERE.includes(held.state)) return { kind: 'in-progress', attemptId: held.id };
      if (held.state === 'creating') return { kind: 'busy' };
      // `open`.
      const same = held.provider === input.provider && held.currency === payable.currency && sameAmount(held.amount, payable.due);
      if (same && held.checkoutUrl !== null) return { kind: 'redirect', url: held.checkoutUrl, attemptId: held.id, reused: true };
      const ended = await endAtProvider(held);
      if (ended === 'completed') {
        settleInBackground(held.id);
        return { kind: 'in-progress', attemptId: held.id };
      }
      if (ended === 'unknown') return { kind: 'busy' };
      await attempts.move(held.id, 'expired', {}, now());
    }

    const recent = (await attempts.forPayable(payable.ref, 20)).filter((one) => one.mode === mode);
    // Money that arrived and is not written down yet, or that a person must
    // decide about: never a second payment over it.
    const taken = recent.find((one) => one.state === 'succeeded' || one.state === 'recording' || (one.state === 'record_refused' && one.check === null));
    if (taken !== undefined) return { kind: 'in-progress', attemptId: taken.id };

    // Pages that may still be open behind attempts that let the payable go (a
    // declined card keeps the provider's page open for another one).
    for (const declined of recent.filter((one) => one.state === 'failed' && one.checkoutUrl !== null && one.createdAt >= now() - MAX_CHECKOUT_LIFE_MS)) {
      const ended = await endDeclined(declined);
      if (ended === 'completed') {
        settleInBackground(declined.id);
        return { kind: 'in-progress', attemptId: declined.id };
      }
      if (ended === 'unknown') return { kind: 'busy' };
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

  /** Counts a decline against the attempt's link, once; locks the link when there are too many. */
  async function noteDecline(attempt: PaymentAttempt, viaEvent: boolean): Promise<void> {
    if (attempt.linkId === null) return;
    const add = await attempts.countFailure(attempt.id, viaEvent);
    let count = 0;
    for (let one = 0; one < add; one += 1) count = await counters.hit(linkFailBucket(attempt.linkId), now());
    if (add > 0 && count >= LINK_FAILURES_TO_LOCK) await endPagesOfLink(attempt);
  }

  /** A locked link: every provider page still open for it is ended, so no card is tried there again. */
  async function endPagesOfLink(attempt: PaymentAttempt): Promise<void> {
    for (const one of await attempts.forPayable(attempt.payable, 20)) {
      if (one.linkId !== attempt.linkId) continue;
      const fresh = (await attempts.byId(one.id)) ?? one;
      if (fresh.state === 'open') {
        if ((await endAtProvider(fresh)) === 'ended') await attempts.move(fresh.id, 'expired', {}, now());
      } else if (fresh.state === 'failed') {
        await endDeclined(fresh);
      }
    }
  }

  /** The setup checklist's payment step: the first real payment a service took in a mode, kept once. */
  async function noteFirstPayment(attempt: PaymentAttempt, at: number): Promise<void> {
    if (attempt.provider === DEMO_PAYMENT_KEY) return;
    const mode = attempt.mode;
    const saved = await paymentSettingsRepo(deps.meta).get(serviceDocName(attempt.provider), serviceStateSchema);
    if (saved !== null && saved[mode].firstPaymentAt !== null) return;
    await mutateServiceState(deps.meta, attempt.provider, (state) => ({
      state: state[mode].firstPaymentAt === null ? { ...state, [mode]: { ...state[mode], firstPaymentAt: at } } : state,
    }), at);
  }

  /** Moves an attempt as the provider's own status says. */
  async function apply(attempt: PaymentAttempt, state: CheckoutState, viaEvent: boolean): Promise<void> {
    const at = now();
    const moved = (to: Parameters<typeof attempts.move>[1], patch: Parameters<typeof attempts.move>[2] = {}) => attempts.move(attempt.id, to, patch, at);
    // Money in the other mode is never believed: a test payment for a live attempt, or the reverse.
    if ((state.status === 'succeeded' || state.status === 'processing') && state.livemode !== (attempt.mode === 'live')) {
      await attempts.note(attempt.id, attempt.state, { problem: { code: 'MODE_MISMATCH', message: `The payment service reported a ${state.livemode ? 'live' : 'test'} payment for a ${attempt.mode} attempt.` } }, at);
      await attempts.flag(attempt.id, at);
      return;
    }
    if (state.status === 'succeeded') {
      if (attempt.state === 'succeeded' || attempt.state === 'recording' || attempt.state === 'recorded' || attempt.state === 'record_refused') return;
      const ok = await moved('succeeded', {
        paymentRef: state.paymentRef,
        takenAmount: state.amount,
        takenCurrency: state.currency,
        paidWith: state.paidWith,
        settledAt: state.settledAt ?? at,
      });
      if (ok) {
        await enqueueRecord(deps.enqueue, attempt.id);
        await noteFirstPayment(attempt, at);
      }
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
    if (state.status === 'failed' && (attempt.state === 'open' || attempt.state === 'processing' || attempt.state === 'failed')) await noteDecline(attempt, viaEvent);
  }

  async function settleOnce(attemptId: string, viaEvent: boolean): Promise<Settled> {
    const attempt = await attempts.byId(attemptId);
    if (attempt === null || attempt.providerRef === null) return { attempt, answered: true, reason: null };
    if (attempt.state === 'recorded' || attempt.state === 'recording' || attempt.state === 'record_refused' || attempt.state === 'abandoned') return { attempt, answered: true, reason: null };
    const lookup = await deps.providerFor(attempt.provider, attempt.mode);
    if (!lookup.ok) return { attempt, answered: false, reason: lookup.code };
    const service = lookup.provider;
    // ONE call to the provider. An attempt still open may be approved but not
    // taken yet (a two-step provider), so it is completed — but only if the
    // payable, read again here, still owes exactly this; otherwise it is only
    // read. A one-step provider's `complete` is a read either way. Each
    // capture try has its own key: a provider that keeps a declined
    // capture's answer under its key would hand the decline back for good.
    let state;
    let captured = false;
    if (attempt.state === 'open' || attempt.state === 'failed') {
      const payable = await resolvePayable(deps.sources, attempt.payable);
      const owes = payable !== null && payable.refusal === null && payable.currency === attempt.currency && sameAmount(payable.due, attempt.amount);
      captured = owes;
      state = owes ? await service.complete(attempt.providerRef, `${attempt.id}:capture:${String(attempt.captureTry)}`) : await service.status(attempt.providerRef);
    } else {
      state = await service.status(attempt.providerRef);
    }
    await attempts.looked(attempt.id, now());
    if (isProviderError(state)) {
      // Not there at all is an answer; a timeout or a refusal of the key is not.
      return { attempt, answered: state.code === 'NOT_FOUND', reason: state.code };
    }
    if (captured && state.status === 'failed') await attempts.nextCaptureTry(attempt.id, attempt.captureTry);
    await apply(attempt, state, viaEvent);
    return { attempt: await attempts.byId(attempt.id), answered: true, reason: null };
  }

  /**
   * Settles in the background, never throwing: a payment that completed while
   * the customer pressed Pay again is read now, and a failure here is only a
   * delay (the sweep reads it again). An unhandled rejection would end the process.
   */
  function settleInBackground(attemptId: string): void {
    settle(attemptId).catch(() => undefined);
  }

  /**
   * Settles one attempt, one call at a time per attempt in this process.
   * Strict (the settle job): throws when the provider could not be asked.
   */
  async function settle(attemptId: string, options: SettleOptions = {}): Promise<PaymentAttempt | null> {
    const viaEvent = options.eventId !== undefined;
    let running = settling.get(attemptId);
    // A settle for an event must count that event's decline: it never rides on another caller's run.
    if (running !== undefined && viaEvent) {
      await running.catch(() => undefined);
      running = undefined;
    }
    if (running === undefined) {
      const run = settleOnce(attemptId, viaEvent).finally(() => settling.delete(attemptId));
      settling.set(attemptId, run);
      running = run;
    }
    const settled = await running;
    if (options.strict === true && !settled.answered) throw new SettleUnanswered(attemptId, settled.reason ?? 'no answer');
    return settled.attempt;
  }

  return { start, settle };
}

export type CheckoutService = ReturnType<typeof createCheckoutService>;
