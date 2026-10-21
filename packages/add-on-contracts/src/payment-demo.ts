// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The demo payment provider: a pretend payment service, test mode only.
 *
 * ─── WHY IT IS A TRANSPORT AND A BACKEND ──────────────────────────────────
 *
 * The contract's factory is called fresh for every operation with only
 * `{ http, credentials, mode }`, so a provider half has nowhere to keep a
 * checkout between calls — exactly like a real one, whose state lives at the
 * provider. The demo is built the same way: `createDemoPaymentProvider` is a
 * real transport that speaks HTTP to `DEMO_PAYMENT_ORIGIN`, and
 * `createDemoPaymentBackend` is the pretend provider behind it. The engine
 * hands the transport a client that routes to the backend in process, and its
 * `/pay/demo/<attempt>` page drives the backend as a customer would. Tests,
 * an app's demo mode and the staff preview all run with no account.
 *
 * Its cards succeed, fail, need a step, and settle late. Every change is an
 * event, signed like a real webhook (HMAC-SHA256 over `<t>.<body>`, Web Crypto,
 * so this file keeps the package's no-`node:` rule).
 *
 * Nothing here is ever live: the backend refuses a live key, and a live-mode
 * transport refuses every call before it is made.
 */

import { decimalToMinor, isoExponent, minorToDecimal, subtractAmounts, compareAmounts } from './payment-money.js';
import {
  providerError,
  type CheckoutCreated,
  type CheckoutInput,
  type CheckoutState,
  type CheckoutStatus,
  type CredentialCheck,
  type ExpireResult,
  type MethodList,
  type MinorAmount,
  type MissedEvents,
  type PaidWith,
  type PaymentEvent,
  type PaymentEventKind,
  type PaymentHttpClient,
  type PaymentHttpResponse,
  type PaymentProvider,
  type PaymentProviderContext,
  type ProviderError,
  type RefundInput,
  type RefundState,
  type RefundStatus,
  type WebhookDelivery,
} from './payment-provider.js';

/** The demo's pretend API host. `.invalid` is reserved: nothing real can answer it. */
export const DEMO_PAYMENT_ORIGIN = 'https://demo-payments.invalid';

/** The demo's add-on key, as the engine registers it. */
export const DEMO_PAYMENT_KEY = 'demo';

/** The signature header the demo's webhooks carry. */
export const DEMO_SIGNATURE_HEADER = 'demo-signature';

/** A signature older than this is refused, as Stripe's is. */
export const DEMO_SIGNATURE_TOLERANCE_MS = 5 * 60 * 1000;

/** What a customer can do on the demo's hosted page. */
export const DEMO_CARDS = ['succeeds', 'fails', 'needs-a-step', 'settles-late'] as const;
export type DemoCard = (typeof DEMO_CARDS)[number];

/** A test key the demo accepts: `demo_test_` and at least eight more characters. */
export const DEMO_KEY_PATTERN = /^demo_test_[A-Za-z0-9]{8,}$/;

const METHODS = [
  { id: 'card', label: 'Demo card', delayed: false },
  { id: 'bank_debit', label: 'Demo bank debit', delayed: true },
] as const;

interface DemoCheckout {
  id: string;
  attemptId: string;
  amount: string;
  currency: string;
  methods: readonly string[];
  status: CheckoutStatus;
  takenAmount: string | null;
  takenCurrency: string | null;
  paymentRef: string | null;
  paidWith: PaidWith | null;
  settledAt: number | null;
  settleAt: number | null;
  failureMessage: string | null;
  expiresAt: number;
  idempotencyKey: string;
  /** Where the customer goes back to: the demo's page opens on the same host. */
  successUrl: string | null;
}

interface DemoRefund {
  id: string;
  paymentRef: string;
  amount: string;
  currency: string;
  status: RefundStatus;
  failureMessage: string | null;
  settleAt: number;
  idempotencyKey: string;
}

interface DemoEvent {
  id: string;
  type: string;
  kind: PaymentEventKind;
  checkoutRef: string | null;
  paymentRef: string | null;
  refundRef: string | null;
  occurredAt: number;
  delivered: boolean;
}

export interface DemoPaymentBackendOptions {
  /** The clock, for "settles late" and signature times. Defaults to `Date.now`. */
  now?: () => number;
  /** Where the hosted page for a checkout lives. Defaults to the demo origin. */
  pageUrl?: (checkout: { id: string; attemptId: string; successUrl: string | null }) => string;
  /** How long a late payment or a refund takes to settle. Default 60 s. */
  settleAfterMs?: number;
  /** How long an open checkout lives. Default one hour, as the Stripe sessions Adminium makes. */
  checkoutLifetimeMs?: number;
  /** The demo account's id. */
  accountId?: string;
}

/** What the hosted page and the tests can do to the pretend provider. */
export interface DemoPaymentBackend {
  /** The in-process client the transport is given. */
  readonly http: PaymentHttpClient;
  /** The customer pays with one of the demo cards. Optional overrides make a mismatch on purpose. */
  pay(checkoutId: string, card: DemoCard, overrides?: { amount?: string; currency?: string }): Promise<void>;
  /** The customer finishes the extra step a `needs-a-step` card asked for. */
  finishStep(checkoutId: string): Promise<void>;
  /** The customer leaves the page without paying. */
  cancel(checkoutId: string): Promise<void>;
  /** A late payment (or refund) settles now instead of waiting. */
  settleNow(id: string): Promise<void>;
  /** A refund that had succeeded fails afterwards (a closed card). */
  failRefund(refundId: string): Promise<void>;
  /** The signed webhook the demo would have sent for an event. */
  deliveryFor(eventId: string, webhookSecret: string, at?: number): Promise<WebhookDelivery>;
  /** The events made so far, oldest first. */
  events(): readonly { id: string; type: string; checkoutRef: string | null; refundRef: string | null }[];
  /** Marks an event's webhook as delivered, so `listMissedEvents` stops returning it. */
  markDelivered(eventId: string): void;
  /** The checkout made for an attempt, for the hosted page. */
  checkoutForAttempt(attemptId: string): { id: string; amount: string; currency: string; status: CheckoutStatus } | null;
}

function json(status: number, body: unknown): PaymentHttpResponse {
  const text = JSON.stringify(body);
  return {
    status,
    headers: { get: (name: string) => (name.toLowerCase() === 'content-type' ? 'application/json' : null) },
    text: () => Promise.resolve(text),
  };
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Compares two hex strings in time that does not depend on where they differ. */
function sameHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** The signed header value for a body at a time. */
export async function signDemoWebhook(rawBody: string, webhookSecret: string, at: number): Promise<string> {
  const t = Math.floor(at / 1000);
  return `t=${t},v1=${await hmacHex(webhookSecret, `${t}.${rawBody}`)}`;
}

/** The pretend provider. State lives in this object; one per engine process (or test). */
export function createDemoPaymentBackend(options: DemoPaymentBackendOptions = {}): DemoPaymentBackend {
  const now = options.now ?? (() => Date.now());
  const settleAfter = options.settleAfterMs ?? 60_000;
  const lifetime = options.checkoutLifetimeMs ?? 60 * 60 * 1000;
  const accountId = options.accountId ?? 'demo_account';
  const pageUrl = options.pageUrl ?? ((checkout) => `${DEMO_PAYMENT_ORIGIN}/pay/${encodeURIComponent(checkout.id)}`);

  const checkouts = new Map<string, DemoCheckout>();
  const checkoutByKey = new Map<string, string>();
  const refunds = new Map<string, DemoRefund>();
  const refundByKey = new Map<string, string>();
  const events: DemoEvent[] = [];
  let counter = 0;
  const nextId = (prefix: string): string => {
    counter += 1;
    return `${prefix}_${counter.toString(36).padStart(6, '0')}`;
  };

  function emit(type: string, kind: PaymentEventKind, refs: { checkout?: DemoCheckout; refund?: DemoRefund }): void {
    events.push({
      id: nextId('evt'),
      type,
      kind,
      checkoutRef: refs.checkout?.id ?? null,
      paymentRef: refs.checkout?.paymentRef ?? refs.refund?.paymentRef ?? null,
      refundRef: refs.refund?.id ?? null,
      occurredAt: now(),
      delivered: false,
    });
  }

  /** Moves time-driven states forward before anyone reads them. */
  function age(checkout: DemoCheckout): DemoCheckout {
    const at = now();
    if (checkout.status === 'processing' && checkout.settleAt !== null && at >= checkout.settleAt) {
      checkout.status = 'succeeded';
      checkout.settledAt = checkout.settleAt;
      emit('checkout.succeeded', 'checkout', { checkout });
    }
    if ((checkout.status === 'pending' || checkout.status === 'requires_action') && at >= checkout.expiresAt) {
      checkout.status = 'expired';
      emit('checkout.expired', 'checkout', { checkout });
    }
    return checkout;
  }

  function ageRefund(refund: DemoRefund): DemoRefund {
    if (refund.status === 'pending' && now() >= refund.settleAt) {
      refund.status = 'succeeded';
      emit('refund.succeeded', 'refund', { refund });
    }
    return refund;
  }

  function checkoutBody(checkout: DemoCheckout): unknown {
    return {
      id: checkout.id,
      attemptId: checkout.attemptId,
      status: checkout.status,
      amount: checkout.takenAmount,
      currency: checkout.takenCurrency,
      paymentRef: checkout.paymentRef,
      paidWith: checkout.paidWith,
      settledAt: checkout.settledAt,
      failureMessage: checkout.failureMessage,
      expiresAt: checkout.expiresAt,
      url: pageUrl({ id: checkout.id, attemptId: checkout.attemptId, successUrl: checkout.successUrl }),
    };
  }

  function refundBody(refund: DemoRefund): unknown {
    return {
      id: refund.id,
      paymentRef: refund.paymentRef,
      status: refund.status,
      amount: refund.amount,
      currency: refund.currency,
      failureMessage: refund.failureMessage,
    };
  }

  function refundedSoFar(paymentRef: string, currency: string): string {
    const exponent = isoExponent(currency) ?? 2;
    let total = 0n;
    for (const refund of refunds.values()) {
      if (refund.paymentRef !== paymentRef || refund.status === 'failed' || refund.status === 'cancelled') continue;
      total += BigInt(decimalToMinor(refund.amount, exponent) ?? '0');
    }
    return minorToDecimal(total.toString(), exponent) ?? '0';
  }

  const http: PaymentHttpClient = async (url, init) => {
    const parsed = new URL(url);
    if (parsed.origin !== DEMO_PAYMENT_ORIGIN) return json(404, { error: 'NOT_FOUND', message: 'No such host.' });
    const auth = (init?.headers?.['authorization'] ?? init?.headers?.['Authorization'] ?? '').replace(/^Bearer /, '');
    if (!DEMO_KEY_PATTERN.test(auth)) {
      return json(401, { error: 'CREDENTIALS_REFUSED', message: 'That is not a demo test key.' });
    }
    const method = (init?.method ?? 'GET').toUpperCase();
    const path = parsed.pathname.split('/').filter(Boolean);
    const body = init?.body !== undefined && init.body !== '' ? (JSON.parse(init.body) as Record<string, unknown>) : {};
    const idempotencyKey = init?.headers?.['idempotency-key'] ?? init?.headers?.['Idempotency-Key'] ?? null;

    if (method === 'GET' && path[0] === 'account') {
      return json(200, { accountId, livemode: false, missing: [] });
    }
    if (method === 'GET' && path[0] === 'methods') {
      return json(200, { methods: METHODS });
    }
    if (path[0] === 'checkouts' && path.length === 1 && method === 'POST') {
      if (idempotencyKey === null) return json(400, { error: 'INVALID_REQUEST', message: 'An idempotency key is required.' });
      const known = checkoutByKey.get(idempotencyKey);
      if (known !== undefined) return json(200, checkoutBody(age(checkouts.get(known)!)));
      const checkout: DemoCheckout = {
        id: nextId('cs'),
        attemptId: String(body['attemptId']),
        amount: String(body['amount']),
        currency: String(body['currency']),
        methods: Array.isArray(body['methods']) ? (body['methods'] as string[]) : [],
        status: 'pending',
        takenAmount: null,
        takenCurrency: null,
        paymentRef: null,
        paidWith: null,
        settledAt: null,
        settleAt: null,
        failureMessage: null,
        expiresAt: now() + lifetime,
        idempotencyKey,
        successUrl: typeof body['successUrl'] === 'string' ? body['successUrl'] : null,
      };
      checkouts.set(checkout.id, checkout);
      checkoutByKey.set(idempotencyKey, checkout.id);
      emit('checkout.created', 'checkout', { checkout });
      return json(200, checkoutBody(checkout));
    }
    if (path[0] === 'checkouts' && path[1] !== undefined) {
      const checkout = checkouts.get(path[1]);
      if (checkout === undefined) return json(404, { error: 'NOT_FOUND', message: 'No such checkout.' });
      age(checkout);
      if (method === 'GET' && path.length === 2) return json(200, checkoutBody(checkout));
      if (method === 'POST' && path[2] === 'expire') {
        if (checkout.status === 'succeeded' || checkout.status === 'processing') {
          return json(409, { error: 'ALREADY_COMPLETED', message: 'The checkout has already completed.' });
        }
        if (checkout.status === 'pending' || checkout.status === 'requires_action') {
          checkout.status = 'expired';
          emit('checkout.expired', 'checkout', { checkout });
        }
        return json(200, checkoutBody(checkout));
      }
      if (method === 'POST' && path[2] === 'complete') return json(200, checkoutBody(checkout));
    }
    if (path[0] === 'refunds' && path.length === 1 && method === 'POST') {
      if (idempotencyKey === null) return json(400, { error: 'INVALID_REQUEST', message: 'An idempotency key is required.' });
      const known = refundByKey.get(idempotencyKey);
      if (known !== undefined) return json(200, refundBody(ageRefund(refunds.get(known)!)));
      const paymentRef = String(body['paymentRef']);
      const paid = [...checkouts.values()].find((one) => one.paymentRef === paymentRef);
      if (paid === undefined) return json(404, { error: 'NOT_FOUND', message: 'No such payment.' });
      age(paid);
      if (paid.status !== 'succeeded' || paid.takenAmount === null || paid.takenCurrency === null) {
        return json(409, { error: 'REFUND_REFUSED', message: 'This payment has not succeeded.' });
      }
      const amount = String(body['amount']);
      const currency = String(body['currency']);
      if (currency !== paid.takenCurrency) {
        return json(409, { error: 'REFUND_REFUSED', message: 'A refund is made in the currency that was taken.' });
      }
      const exponent = isoExponent(currency) ?? 2;
      const left = subtractAmounts(paid.takenAmount, refundedSoFar(paymentRef, currency), exponent);
      const fits = left !== null && compareAmounts(amount, left) !== 1 && compareAmounts(amount, '0') === 1;
      if (!fits) return json(409, { error: 'REFUND_REFUSED', message: 'That is more than can still be refunded.' });
      const refund: DemoRefund = {
        id: nextId('re'),
        paymentRef,
        amount,
        currency,
        status: 'pending',
        failureMessage: null,
        settleAt: now() + settleAfter,
        idempotencyKey,
      };
      refunds.set(refund.id, refund);
      refundByKey.set(idempotencyKey, refund.id);
      emit('refund.created', 'refund', { refund });
      return json(200, refundBody(refund));
    }
    if (path[0] === 'refunds' && path[1] !== undefined && method === 'GET') {
      const refund = refunds.get(path[1]);
      if (refund === undefined) return json(404, { error: 'NOT_FOUND', message: 'No such refund.' });
      return json(200, refundBody(ageRefund(refund)));
    }
    if (path[0] === 'events' && method === 'GET') {
      for (const one of checkouts.values()) age(one);
      for (const one of refunds.values()) ageRefund(one);
      const after = parsed.searchParams.get('after');
      const start = after === null ? 0 : events.findIndex((one) => one.id === after) + 1;
      const page = events.slice(start).filter((one) => !one.delivered).slice(0, 100);
      const last = page.at(-1)?.id ?? after;
      return json(200, {
        events: page.map(({ delivered: _delivered, ...rest }) => rest),
        cursor: last,
        more: events.slice(start).filter((one) => !one.delivered).length > page.length,
      });
    }
    return json(404, { error: 'NOT_FOUND', message: 'No such route.' });
  };

  function mustCheckout(id: string): DemoCheckout {
    const checkout = checkouts.get(id);
    if (checkout === undefined) throw new Error(`No demo checkout ${id}.`);
    return age(checkout);
  }

  return {
    http,
    async pay(checkoutId, card, overrides = {}) {
      const checkout = mustCheckout(checkoutId);
      if (checkout.status !== 'pending' && checkout.status !== 'requires_action') {
        throw new Error(`Demo checkout ${checkoutId} is ${checkout.status}.`);
      }
      const delayed = card === 'settles-late';
      const method = delayed ? METHODS[1] : METHODS[0];
      if (card === 'fails') {
        checkout.status = 'failed';
        checkout.failureMessage = 'The demo card was declined.';
        emit('checkout.failed', 'checkout', { checkout });
        return;
      }
      checkout.paymentRef = nextId('pay');
      checkout.paidWith = { method: method.id, label: delayed ? method.label : 'Demo card ••4242', delayed };
      checkout.takenAmount = overrides.amount ?? checkout.amount;
      checkout.takenCurrency = overrides.currency ?? checkout.currency;
      if (card === 'needs-a-step') {
        checkout.status = 'requires_action';
        emit('checkout.requires_action', 'checkout', { checkout });
        return;
      }
      if (delayed) {
        checkout.status = 'processing';
        checkout.settleAt = now() + settleAfter;
        emit('checkout.processing', 'checkout', { checkout });
        return;
      }
      checkout.status = 'succeeded';
      checkout.settledAt = now();
      emit('checkout.succeeded', 'checkout', { checkout });
    },
    async finishStep(checkoutId) {
      const checkout = mustCheckout(checkoutId);
      if (checkout.status !== 'requires_action') throw new Error(`Demo checkout ${checkoutId} needs no step.`);
      checkout.status = 'succeeded';
      checkout.settledAt = now();
      emit('checkout.succeeded', 'checkout', { checkout });
    },
    async cancel(checkoutId) {
      const checkout = mustCheckout(checkoutId);
      if (checkout.status !== 'pending' && checkout.status !== 'requires_action') return;
      checkout.status = 'cancelled';
      emit('checkout.cancelled', 'checkout', { checkout });
    },
    async settleNow(id) {
      const checkout = checkouts.get(id);
      if (checkout !== undefined && checkout.status === 'processing') {
        checkout.settleAt = now();
        age(checkout);
        return;
      }
      const refund = refunds.get(id);
      if (refund !== undefined && refund.status === 'pending') {
        refund.settleAt = now();
        ageRefund(refund);
        return;
      }
      throw new Error(`Nothing of id ${id} is waiting to settle.`);
    },
    async failRefund(refundId) {
      const refund = refunds.get(refundId);
      if (refund === undefined) throw new Error(`No demo refund ${refundId}.`);
      ageRefund(refund);
      refund.status = 'failed';
      refund.failureMessage = 'The card was closed.';
      emit('refund.failed', 'refund', { refund });
    },
    async deliveryFor(eventId, webhookSecret, at = now()) {
      const event = events.find((one) => one.id === eventId);
      if (event === undefined) throw new Error(`No demo event ${eventId}.`);
      const { delivered: _delivered, ...rest } = event;
      const rawBody = JSON.stringify({ ...rest, livemode: false });
      return { rawBody, headers: { [DEMO_SIGNATURE_HEADER]: await signDemoWebhook(rawBody, webhookSecret, at) } };
    },
    events() {
      return events.map((one) => ({ id: one.id, type: one.type, checkoutRef: one.checkoutRef, refundRef: one.refundRef }));
    },
    markDelivered(eventId) {
      const event = events.find((one) => one.id === eventId);
      if (event !== undefined) event.delivered = true;
    },
    checkoutForAttempt(attemptId) {
      const checkout = [...checkouts.values()].find((one) => one.attemptId === attemptId);
      if (checkout === undefined) return null;
      age(checkout);
      return { id: checkout.id, amount: checkout.amount, currency: checkout.currency, status: checkout.status };
    },
  };
}

// ─── The transport ──────────────────────────────────────────────────────────

const ERROR_CODES = new Set([
  'CREDENTIALS_REFUSED',
  'NOT_FOUND',
  'REFUND_REFUSED',
  'ALREADY_COMPLETED',
  'INVALID_REQUEST',
]);

async function call(
  context: PaymentProviderContext,
  method: 'GET' | 'POST',
  path: string,
  body?: Record<string, unknown>,
  idempotencyKey?: string,
): Promise<Record<string, unknown> | ProviderError> {
  if (context.mode !== 'test') return providerError('MODE_MISMATCH', 'The demo provider works in test mode only.');
  const key = context.credentials['secretKey'] ?? '';
  const headers: Record<string, string> = { authorization: `Bearer ${key}`, 'content-type': 'application/json' };
  if (idempotencyKey !== undefined) headers['idempotency-key'] = idempotencyKey;
  let response: PaymentHttpResponse;
  try {
    response = await context.http(`${DEMO_PAYMENT_ORIGIN}${path}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    return providerError('UNAVAILABLE', 'The demo provider could not be reached.', true);
  }
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(await response.text()) as Record<string, unknown>;
  } catch {
    return providerError('UNAVAILABLE', 'The demo provider answered with something that is not JSON.', true);
  }
  if (response.status >= 200 && response.status < 300) return parsed;
  const code = String(parsed['error'] ?? '');
  const message = String(parsed['message'] ?? 'The demo provider refused the request.');
  if (ERROR_CODES.has(code)) return providerError(code as ProviderError['code'], message);
  return providerError('UNAVAILABLE', message, response.status >= 500);
}

function stateOf(body: Record<string, unknown>): CheckoutState {
  return {
    ok: true,
    ref: String(body['id']),
    status: body['status'] as CheckoutStatus,
    attemptId: typeof body['attemptId'] === 'string' ? body['attemptId'] : null,
    amount: (body['amount'] as string | null) ?? null,
    currency: (body['currency'] as string | null) ?? null,
    livemode: false,
    paymentRef: (body['paymentRef'] as string | null) ?? null,
    paidWith: (body['paidWith'] as PaidWith | null) ?? null,
    settledAt: (body['settledAt'] as number | null) ?? null,
    failureMessage: (body['failureMessage'] as string | null) ?? null,
  };
}

function refundOf(body: Record<string, unknown>): RefundState {
  return {
    ok: true,
    ref: String(body['id']),
    paymentRef: String(body['paymentRef']),
    status: body['status'] as RefundStatus,
    amount: String(body['amount']),
    currency: String(body['currency']),
    failureMessage: (body['failureMessage'] as string | null) ?? null,
  };
}

function isError(value: unknown): value is ProviderError {
  return (value as { ok?: unknown }).ok === false;
}

/** The demo's server half: the same factory shape a real provider exports. */
export function createDemoPaymentProvider(context: PaymentProviderContext): PaymentProvider {
  return {
    key: DEMO_PAYMENT_KEY,
    mode: context.mode,
    async checkCredentials(): Promise<CredentialCheck | ProviderError> {
      const body = await call(context, 'GET', '/account');
      if (isError(body)) return body;
      return { ok: true, accountId: String(body['accountId']), livemode: false, missing: [] };
    },
    async createCheckout(input: CheckoutInput): Promise<CheckoutCreated | ProviderError> {
      const minor = this.toMinor(input.payable.amount, input.payable.currency);
      if (isError(minor)) return minor;
      const body = await call(
        context,
        'POST',
        '/checkouts',
        {
          attemptId: input.attemptId,
          amount: input.payable.amount,
          currency: input.payable.currency,
          methods: input.methods,
          successUrl: input.successUrl,
        },
        input.idempotencyKey,
      );
      if (isError(body)) return body;
      return { ok: true, ref: String(body['id']), url: String(body['url']), expiresAt: Number(body['expiresAt']) };
    },
    async status(ref: string): Promise<CheckoutState | ProviderError> {
      const body = await call(context, 'GET', `/checkouts/${encodeURIComponent(ref)}`);
      return isError(body) ? body : stateOf(body);
    },
    async complete(ref: string, idempotencyKey: string): Promise<CheckoutState | ProviderError> {
      const body = await call(context, 'POST', `/checkouts/${encodeURIComponent(ref)}/complete`, {}, idempotencyKey);
      return isError(body) ? body : stateOf(body);
    },
    async expire(ref: string): Promise<ExpireResult | ProviderError> {
      const body = await call(context, 'POST', `/checkouts/${encodeURIComponent(ref)}/expire`, {});
      if (isError(body)) return body;
      return { ok: true, ref: String(body['id']), status: body['status'] as CheckoutStatus };
    },
    async refund(input: RefundInput): Promise<RefundState | ProviderError> {
      const body = await call(
        context,
        'POST',
        '/refunds',
        { paymentRef: input.paymentRef, amount: input.amount, currency: input.currency, reason: input.reason },
        input.idempotencyKey,
      );
      return isError(body) ? body : refundOf(body);
    },
    async refundStatus(ref: string): Promise<RefundState | ProviderError> {
      const body = await call(context, 'GET', `/refunds/${encodeURIComponent(ref)}`);
      return isError(body) ? body : refundOf(body);
    },
    async verifyWebhook(delivery: WebhookDelivery): Promise<PaymentEvent | ProviderError> {
      if (context.mode !== 'test') return providerError('MODE_MISMATCH', 'The demo provider works in test mode only.');
      const secret = context.credentials['webhookSecret'];
      if (secret === undefined || secret === '') return providerError('SIGNATURE_INVALID', 'No webhook secret is set.');
      const header = delivery.headers[DEMO_SIGNATURE_HEADER] ?? '';
      const match = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(header);
      if (match === null) return providerError('SIGNATURE_INVALID', 'The signature header is missing or malformed.');
      const t = Number(match[1]);
      if (Math.abs(Date.now() - t * 1000) > DEMO_SIGNATURE_TOLERANCE_MS) {
        return providerError('SIGNATURE_INVALID', 'The signature is too old.');
      }
      const expected = await hmacHex(secret, `${t}.${delivery.rawBody}`);
      if (!sameHex(expected, match[2] ?? '')) return providerError('SIGNATURE_INVALID', 'The signature does not match.');
      let body: Record<string, unknown>;
      try {
        body = JSON.parse(delivery.rawBody) as Record<string, unknown>;
      } catch {
        return providerError('INVALID_REQUEST', 'The event is not JSON.');
      }
      return eventOf(body);
    },
    async listMissedEvents(cursor: string | null): Promise<MissedEvents | ProviderError> {
      const query = cursor === null ? '' : `?after=${encodeURIComponent(cursor)}`;
      const body = await call(context, 'GET', `/events${query}`);
      if (isError(body)) return body;
      const events = (body['events'] as Record<string, unknown>[]).map(eventOf);
      return { ok: true, events, cursor: (body['cursor'] as string | null) ?? null, more: body['more'] === true };
    },
    async methodsFor(): Promise<MethodList | ProviderError> {
      const body = await call(context, 'GET', '/methods');
      if (isError(body)) return body;
      return { ok: true, methods: body['methods'] as MethodList['methods'] };
    },
    toMinor(amount: string, currency: string): MinorAmount | ProviderError {
      const exponent = isoExponent(currency);
      if (exponent === null) return providerError('CURRENCY_UNSUPPORTED', `The demo provider does not take ${currency}.`);
      const minor = decimalToMinor(amount, exponent);
      if (minor === null) {
        return providerError('AMOUNT_UNREPRESENTABLE', `${amount} ${currency} cannot be held exactly in ${currency}'s units.`);
      }
      return { minor, currency };
    },
    fromMinor(minor: string, currency: string): string | ProviderError {
      const exponent = isoExponent(currency);
      if (exponent === null) return providerError('CURRENCY_UNSUPPORTED', `The demo provider does not take ${currency}.`);
      const amount = minorToDecimal(minor, exponent);
      return amount ?? providerError('INVALID_REQUEST', `${minor} is not an amount in the smallest unit.`);
    },
  };
}

function eventOf(body: Record<string, unknown>): PaymentEvent {
  return {
    ok: true,
    eventId: String(body['id']),
    type: String(body['type']),
    kind: body['kind'] as PaymentEventKind,
    checkoutRef: (body['checkoutRef'] as string | null) ?? null,
    paymentRef: (body['paymentRef'] as string | null) ?? null,
    refundRef: (body['refundRef'] as string | null) ?? null,
    livemode: body['livemode'] === true,
    occurredAt: Number(body['occurredAt']),
  };
}
