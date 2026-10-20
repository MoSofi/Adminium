// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `payment-provider@1` — one payment service, online payments only.
 *
 * ─── WHAT IT IS FOR ────────────────────────────────────────────────────────
 *
 * A shop's customer pays on the provider's own hosted page; Adminium never
 * sees a card. The provider half answers a small set of questions about money
 * that moves at the provider: start a checkout, say how one ended, end one,
 * refund, prove a webhook came from the provider, list the events whose webhook
 * went missing, and say which ways to pay the account has switched on.
 * In-person terminals will be a contract of their own when they are built.
 *
 * ─── THE SHAPE ─────────────────────────────────────────────────────────────
 *
 * The server half exports a FACTORY, `createPaymentProvider({ http, credentials,
 * mode })`. The engine calls it for every operation with an egress-bound HTTP
 * client (the add-on's `network.allow` only, redirects refused) and the
 * credential decrypted at that moment, so no key is held longer than one call
 * and a replaced key is used at once.
 *
 * Every answer is DATA. A refusal is `{ ok: false, code, providerMessage,
 * retryable }`, never a thrown class: a class does not cross the add-on seam
 * (each bundle carries its own copy, so `instanceof` is false engine-side).
 * The engine parses every answer with the schemas below before it believes it.
 *
 * ─── RULES EVERY PROVIDER FOLLOWS (the conformance suite checks them) ──────
 *
 * - Amounts cross as decimal strings. `toMinor` converts with the provider's
 *   OWN exponent table; an amount the provider cannot represent exactly is
 *   refused (`AMOUNT_UNREPRESENTABLE`), never rounded.
 * - Every call that moves money carries an idempotency key Adminium mints and
 *   stores. The key is the second line of defence: Adminium's own state
 *   decides whether money may move.
 * - A webhook proves only that the provider sent it. `verifyWebhook` returns
 *   the event's identity, never a status to trust: the engine re-reads the
 *   status with `status()`.
 * - No secret appears in an answer, a `providerMessage` or a log line.
 * - The provider half never reads or writes a database. In-process this is a
 *   review rule, not something the runtime can enforce.
 */

import { z } from 'zod';

export const PAYMENT_PROVIDER_CONTRACT = 'payment-provider';
export const PAYMENT_PROVIDER_VERSION = 1;

/** The name of the factory a server half must export. */
export const PAYMENT_PROVIDER_FACTORY = 'createPaymentProvider';

/** A key belongs to one mode; so does every checkout, event and refund made with it. */
export const PAYMENT_MODES = ['test', 'live'] as const;
export type PaymentMode = (typeof PAYMENT_MODES)[number];

/**
 * How a checkout stands at the provider.
 *
 * `processing`: the money is on its way but not there (SEPA, a voucher, a
 * pending capture). `requires_action`: the customer still has a step to take.
 */
export const CHECKOUT_STATUSES = [
  'pending',
  'processing',
  'succeeded',
  'failed',
  'cancelled',
  'expired',
  'requires_action',
] as const;
export type CheckoutStatus = (typeof CHECKOUT_STATUSES)[number];

/** How a refund stands. `requires_action`: the customer must give bank details. */
export const REFUND_STATUSES = ['pending', 'succeeded', 'failed', 'cancelled', 'requires_action'] as const;
export type RefundStatus = (typeof REFUND_STATUSES)[number];

/** What a verified event is about, so the engine knows which record to look up. */
export const PAYMENT_EVENT_KINDS = ['checkout', 'refund', 'dispute', 'other'] as const;
export type PaymentEventKind = (typeof PAYMENT_EVENT_KINDS)[number];

/** Why a refund is made, in the words the provider's own list uses. */
export const REFUND_REASONS = ['requested_by_customer', 'duplicate', 'fraudulent', 'other'] as const;
export type RefundReason = (typeof REFUND_REASONS)[number];

/**
 * Every refusal code. Closed: an engine branch on a code the contract never
 * named would be a guess.
 */
export const PROVIDER_ERROR_CODES = [
  /** The key or credentials were refused (revoked, wrong, app uninstalled). */
  'CREDENTIALS_REFUSED',
  /** The key works but lacks a permission the call needs. */
  'PERMISSION_MISSING',
  /** The key belongs to the other mode. */
  'MODE_MISMATCH',
  /** No such checkout, payment, refund or event at the provider. */
  'NOT_FOUND',
  /** The amount cannot be represented exactly in the provider's units. */
  'AMOUNT_UNREPRESENTABLE',
  /** The provider takes no payments in this currency. */
  'CURRENCY_UNSUPPORTED',
  /** A webhook's signature did not verify, or it was too old. */
  'SIGNATURE_INVALID',
  /** The provider refused the refund (window passed, more than was taken, disputed). */
  'REFUND_REFUSED',
  /** A checkout could not be ended because it already completed. */
  'ALREADY_COMPLETED',
  /** The provider refused the request as malformed. */
  'INVALID_REQUEST',
  /** Too many requests; try later. */
  'RATE_LIMITED',
  /** The provider could not be reached or failed; try later. */
  'UNAVAILABLE',
] as const;
export type ProviderErrorCode = (typeof PROVIDER_ERROR_CODES)[number];

/** A refusal, returned as data. */
export interface ProviderError {
  readonly ok: false;
  readonly code: ProviderErrorCode;
  /** The provider's own words, shown quoted to staff. Never a secret. */
  readonly providerMessage: string;
  readonly retryable: boolean;
}

export const providerErrorSchema = z
  .object({
    ok: z.literal(false),
    code: z.enum(PROVIDER_ERROR_CODES),
    providerMessage: z.string().max(2000),
    retryable: z.boolean(),
  })
  .strict();

/** True for a refusal. Checks the shape, never a class. */
export function isProviderError(value: unknown): value is ProviderError {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { ok?: unknown }).ok === false &&
    typeof (value as { code?: unknown }).code === 'string'
  );
}

/** Builds a refusal. */
export function providerError(code: ProviderErrorCode, providerMessage: string, retryable = false): ProviderError {
  return { ok: false, code, providerMessage, retryable };
}

// ─── Money ──────────────────────────────────────────────────────────────────

/** A non-negative decimal amount as text: "120.00", "12000", "45.250". */
export const decimalAmountSchema = z.string().regex(/^(0|[1-9]\d{0,17})(\.\d{1,6})?$/, 'a decimal amount such as 120.00');

/** An ISO 4217 code in capitals. */
export const currencyCodeSchema = z.string().regex(/^[A-Z]{3}$/, 'an ISO 4217 code such as EUR');

/** An amount in the provider's smallest unit, as integer text (no float ever holds money). */
export const minorAmountSchema = z.string().regex(/^(0|[1-9]\d{0,20})$/, 'an integer amount in the smallest unit');

export interface MinorAmount {
  readonly minor: string;
  readonly currency: string;
}

export const minorAmountAnswerSchema = z.object({ minor: minorAmountSchema, currency: currencyCodeSchema }).strict();

// ─── What the engine hands a provider ───────────────────────────────────────

/** The fields of an HTTP response a transport reads. A real `Response` has them all. */
export interface PaymentHttpResponse {
  readonly status: number;
  readonly headers: { get(name: string): string | null };
  text(): Promise<string>;
}

/**
 * The egress-bound client. Only hosts in the add-on's `network.allow` are
 * reachable, and a redirect is refused rather than followed.
 */
export type PaymentHttpClient = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<PaymentHttpResponse>;

/**
 * One mode's credential fields, decrypted for one call. The field names are
 * the provider's own (a Stripe key; a PayPal client id, secret and webhook id),
 * plus `webhookSecret` where the provider signs webhooks with a shared secret.
 */
export type PaymentCredentials = Readonly<Record<string, string>>;

export interface PaymentProviderContext {
  readonly http: PaymentHttpClient;
  readonly credentials: PaymentCredentials;
  readonly mode: PaymentMode;
}

// ─── The calls ──────────────────────────────────────────────────────────────

/** What `checkCredentials` learns: whose account, which mode, what is missing. */
export interface CredentialCheck {
  readonly ok: true;
  /** The provider's account id (`acct_…`, a PayPal merchant id). Shown everywhere. */
  readonly accountId: string;
  readonly livemode: boolean;
  /** Each missing permission, named in the provider's own dashboard words. Empty when the key is complete. */
  readonly missing: readonly string[];
}

export const credentialCheckSchema = z
  .object({
    ok: z.literal(true),
    accountId: z.string().min(1).max(255),
    livemode: z.boolean(),
    missing: z.array(z.string().min(1).max(200)).max(50),
  })
  .strict();

/** The thing being paid, as the provider needs to show it. Never carries a secret. */
export interface CheckoutPayable {
  /** The invoice or record number the customer recognises ("INV-0042"). */
  readonly reference: string;
  /** One line describing it, shown on the provider's page. */
  readonly description: string;
  readonly amount: string;
  readonly currency: string;
  /** Prefills the provider's email field; never required. */
  readonly customerEmail: string | null;
  /** One of Adminium's locales (`en-US`, `ar-EG`, …); the provider maps it to its own. */
  readonly locale: string | null;
}

export interface CheckoutInput {
  readonly payable: CheckoutPayable;
  /** The ways to pay the shop's rules allow for this customer, by the ids `methodsFor` returned. */
  readonly methods: readonly string[];
  /** Where the provider sends the customer back. Adminium's own URLs, never the customer's. */
  readonly successUrl: string;
  readonly cancelUrl: string;
  /** Adminium's attempt id: the provider's client reference and metadata. */
  readonly attemptId: string;
  readonly idempotencyKey: string;
}

export interface CheckoutCreated {
  readonly ok: true;
  /** The provider's id for the checkout (a session id, an order id). */
  readonly ref: string;
  /** The hosted page. The engine checks its host before sending anyone there. */
  readonly url: string;
  /** When the provider will end it (epoch ms), if it says. */
  readonly expiresAt: number | null;
}

export const checkoutCreatedSchema = z
  .object({
    ok: z.literal(true),
    ref: z.string().min(1).max(255),
    url: z.string().url().max(2048),
    expiresAt: z.number().int().nonnegative().nullable(),
  })
  .strict();

/** How the customer paid, as staff will read it. */
export interface PaidWith {
  /** The provider's method id (`card`, `sepa_debit`, `paypal`). */
  readonly method: string;
  /** "Visa ••4242" or the method's name. Never a full number. */
  readonly label: string;
  /** True for a method whose money arrives later (SEPA, vouchers). */
  readonly delayed: boolean;
}

export const paidWithSchema = z
  .object({
    method: z.string().min(1).max(64),
    label: z
      .string()
      .min(1)
      .max(120)
      .refine((text) => !/\d{9,}/.test(text.replace(/[\s-]/g, '')), 'never a card or account number'),
    delayed: z.boolean(),
  })
  .strict();

/** How a checkout stands, re-read from the provider (never from a webhook body). */
export interface CheckoutState {
  readonly ok: true;
  readonly ref: string;
  readonly status: CheckoutStatus;
  /** The client reference the checkout was made with: Adminium's attempt id. */
  readonly attemptId: string | null;
  /** What the provider TOOK. Null until money moved. May differ from what was asked. */
  readonly amount: string | null;
  readonly currency: string | null;
  readonly livemode: boolean;
  /** The provider's id for the money itself (a PaymentIntent, a capture), once there is one. */
  readonly paymentRef: string | null;
  readonly paidWith: PaidWith | null;
  /** When the provider says it succeeded (epoch ms). */
  readonly settledAt: number | null;
  /** The provider's words for a failure, if any. */
  readonly failureMessage: string | null;
}

export const checkoutStateSchema = z
  .object({
    ok: z.literal(true),
    ref: z.string().min(1).max(255),
    status: z.enum(CHECKOUT_STATUSES),
    attemptId: z.string().min(1).max(255).nullable(),
    amount: decimalAmountSchema.nullable(),
    currency: currencyCodeSchema.nullable(),
    livemode: z.boolean(),
    paymentRef: z.string().min(1).max(255).nullable(),
    paidWith: paidWithSchema.nullable(),
    settledAt: z.number().int().nonnegative().nullable(),
    failureMessage: z.string().max(2000).nullable(),
  })
  .strict()
  .refine((state) => (state.amount === null) === (state.currency === null), 'amount and currency come together')
  .refine((state) => state.status !== 'succeeded' || state.amount !== null, 'a success says what was taken');

export interface ExpireResult {
  readonly ok: true;
  readonly ref: string;
  /** The checkout's state after the call: `expired`, or what it already was. */
  readonly status: CheckoutStatus;
}

export const expireResultSchema = z
  .object({ ok: z.literal(true), ref: z.string().min(1).max(255), status: z.enum(CHECKOUT_STATUSES) })
  .strict();

export interface RefundInput {
  /** The provider's id for the money (`CheckoutState.paymentRef`). */
  readonly paymentRef: string;
  readonly amount: string;
  readonly currency: string;
  readonly reason: RefundReason;
  /** Minted at the confirm step, bound to (payment, amount), reused on every retry. */
  readonly idempotencyKey: string;
}

export interface RefundState {
  readonly ok: true;
  /** The provider's id for the refund. */
  readonly ref: string;
  readonly paymentRef: string;
  readonly status: RefundStatus;
  readonly amount: string;
  readonly currency: string;
  readonly failureMessage: string | null;
}

export const refundStateSchema = z
  .object({
    ok: z.literal(true),
    ref: z.string().min(1).max(255),
    paymentRef: z.string().min(1).max(255),
    status: z.enum(REFUND_STATUSES),
    amount: decimalAmountSchema,
    currency: currencyCodeSchema,
    failureMessage: z.string().max(2000).nullable(),
  })
  .strict();

/** A webhook's identity, after its signature verified. Never a status to trust. */
export interface PaymentEvent {
  readonly ok: true;
  /** The provider's event id: unique per provider and mode. */
  readonly eventId: string;
  /** The provider's own type (`checkout.session.completed`). */
  readonly type: string;
  readonly kind: PaymentEventKind;
  /** The checkout the event is about (a session or order id), when it says. */
  readonly checkoutRef: string | null;
  /** The money it is about (a PaymentIntent or capture), when it says. */
  readonly paymentRef: string | null;
  /** The refund it is about, when it says. */
  readonly refundRef: string | null;
  readonly livemode: boolean;
  /** When the provider made the event (epoch ms). */
  readonly occurredAt: number;
}

export const paymentEventSchema = z
  .object({
    ok: z.literal(true),
    eventId: z.string().min(1).max(255),
    type: z.string().min(1).max(120),
    kind: z.enum(PAYMENT_EVENT_KINDS),
    checkoutRef: z.string().min(1).max(255).nullable(),
    paymentRef: z.string().min(1).max(255).nullable(),
    refundRef: z.string().min(1).max(255).nullable(),
    livemode: z.boolean(),
    occurredAt: z.number().int().nonnegative(),
  })
  .strict();

export interface MissedEvents {
  readonly ok: true;
  readonly events: readonly PaymentEvent[];
  /** Pass back next time. Null when the provider keeps no cursor. */
  readonly cursor: string | null;
  /** More events wait past this page. */
  readonly more: boolean;
}

export const missedEventsSchema = z
  .object({
    ok: z.literal(true),
    events: z.array(paymentEventSchema).max(500),
    cursor: z.string().max(1024).nullable(),
    more: z.boolean(),
  })
  .strict();

/** A way to pay the account has switched on. */
export interface PaymentMethodInfo {
  /** The provider's id, passed back in `CheckoutInput.methods`. */
  readonly id: string;
  /** Its name, as staff see it ("Cards", "Link (Stripe)", "SEPA Direct Debit"). */
  readonly label: string;
  readonly delayed: boolean;
}

export interface MethodList {
  readonly ok: true;
  readonly methods: readonly PaymentMethodInfo[];
}

export const methodListSchema = z
  .object({
    ok: z.literal(true),
    methods: z
      .array(
        z
          .object({ id: z.string().min(1).max(64), label: z.string().min(1).max(120), delayed: z.boolean() })
          .strict(),
      )
      .max(100),
  })
  .strict();

export interface MethodQuery {
  /** ISO 3166-1 alpha-2, the customer's country, or null when unknown. */
  readonly country: string | null;
  readonly currency: string;
  readonly amount: string;
}

/** A webhook as received: the exact bytes (as UTF-8 text) and the headers, names in lower case. */
export interface WebhookDelivery {
  readonly rawBody: string;
  readonly headers: Readonly<Record<string, string | undefined>>;
}

/**
 * One payment service. Every method may return a `ProviderError` instead of
 * its answer; none throws for an ordinary refusal.
 */
export interface PaymentProvider {
  /** The add-on's key. */
  readonly key: string;
  readonly mode: PaymentMode;
  checkCredentials(): Promise<CredentialCheck | ProviderError>;
  createCheckout(input: CheckoutInput): Promise<CheckoutCreated | ProviderError>;
  /** An unknown ref is `NOT_FOUND`, never a throw. */
  status(ref: string): Promise<CheckoutState | ProviderError>;
  /** Finishes a two-step payment (a PayPal capture). A one-step provider returns `status(ref)`. */
  complete(ref: string, idempotencyKey: string): Promise<CheckoutState | ProviderError>;
  /** Ends an open checkout. One that already completed is `ALREADY_COMPLETED`. */
  expire(ref: string): Promise<ExpireResult | ProviderError>;
  refund(input: RefundInput): Promise<RefundState | ProviderError>;
  refundStatus(ref: string): Promise<RefundState | ProviderError>;
  verifyWebhook(delivery: WebhookDelivery): Promise<PaymentEvent | ProviderError>;
  listMissedEvents(cursor: string | null): Promise<MissedEvents | ProviderError>;
  methodsFor(query: MethodQuery): Promise<MethodList | ProviderError>;
  /** The provider's own exponent table. Refuses an amount it cannot hold exactly. */
  toMinor(amount: string, currency: string): MinorAmount | ProviderError;
  fromMinor(minor: string, currency: string): string | ProviderError;
}

/** The server half's export. Called once per operation. */
export type CreatePaymentProvider = (context: PaymentProviderContext) => PaymentProvider;

/**
 * The schema each answer must pass, by call. The engine parses every answer
 * with these; a provider whose answer fails is treated as unavailable.
 */
export const PAYMENT_ANSWER_SCHEMAS = {
  checkCredentials: credentialCheckSchema,
  createCheckout: checkoutCreatedSchema,
  status: checkoutStateSchema,
  complete: checkoutStateSchema,
  expire: expireResultSchema,
  refund: refundStateSchema,
  refundStatus: refundStateSchema,
  verifyWebhook: paymentEventSchema,
  listMissedEvents: missedEventsSchema,
  methodsFor: methodListSchema,
} as const;

export type PaymentCall = keyof typeof PAYMENT_ANSWER_SCHEMAS;
