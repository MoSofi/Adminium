// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The `payment-provider@1` conformance suite.
 *
 * Every provider runs it against itself: the demo provider in this package,
 * and each real one in its own add-on (against the provider's mock server).
 * A DRIVER plays the customer and the provider's back office, because only the
 * provider's own test tools can pay a checkout or fail a refund. A driver that
 * cannot do something leaves that ability out, and the cases that need it are
 * skipped — by name, so a skipped case is visible rather than passed.
 *
 * What it holds a provider to, whatever the driver can do:
 *   - every answer parses with the contract's schema, and a refusal is data;
 *   - an unknown reference is `NOT_FOUND`, never a throw;
 *   - the same idempotency key gives the same checkout and the same refund;
 *   - a success says what was taken and carries the provider's payment id;
 *   - an amount is converted exactly or refused, never rounded;
 *   - a forged or altered webhook is refused;
 *   - no credential value appears in any answer.
 */
import { describe, expect, it } from 'vitest';

import { sameAmount } from '../payment-money.js';
import {
  PAYMENT_ANSWER_SCHEMAS,
  isProviderError,
  providerErrorSchema,
  type CheckoutInput,
  type PaymentCall,
  type PaymentCredentials,
  type PaymentMode,
  type PaymentProvider,
  type ProviderError,
  type WebhookDelivery,
} from '../payment-provider.js';

/** One amount the suite converts: exactly, or refused. */
export interface PaymentAmountCase {
  amount: string;
  currency: string;
  /** What the provider must do with it. */
  expect: 'exact' | 'refused';
}

/** The customer and the provider's back office, as far as this provider's test tools reach. */
export interface PaymentConformanceDriver {
  /** Pays a checkout. Required for every case past "a checkout can be made". */
  pay?(checkoutRef: string, outcome: 'succeeds' | 'fails'): Promise<void>;
  /** Pays with a method whose money arrives later. */
  payLate?(checkoutRef: string): Promise<void>;
  /** Makes a late payment arrive now. */
  settle?(checkoutRef: string): Promise<void>;
  /** Makes a refund that succeeded fail afterwards. */
  failRefund?(refundRef: string): Promise<void>;
  /** A genuine signed delivery of the newest event about this checkout, or null when none can be had. */
  latestDelivery?(checkoutRef: string): Promise<WebhookDelivery | null>;
}

export interface PaymentConformanceOptions {
  /** A label for the suite's describe block. */
  name: string;
  /** Builds a provider for one operation, as the engine does. */
  make: () => PaymentProvider;
  /** The credential values handed to `make`, so the suite can check none leaks. */
  credentials: PaymentCredentials;
  mode: PaymentMode;
  driver: PaymentConformanceDriver;
  /** A payable the provider takes (its currency must be one it supports). */
  payable: CheckoutInput['payable'];
  methods: readonly string[];
  amounts: readonly PaymentAmountCase[];
  /** Must be https URLs the provider accepts as return addresses. */
  successUrl: string;
  cancelUrl: string;
}

/** The standard amount table: the currencies the plan names, both ways. */
export const PAYMENT_AMOUNT_CASES: readonly PaymentAmountCase[] = [
  { amount: '120.00', currency: 'EUR', expect: 'exact' },
  { amount: '120.005', currency: 'EUR', expect: 'refused' },
  { amount: '12000', currency: 'JPY', expect: 'exact' },
  { amount: '12000.5', currency: 'JPY', expect: 'refused' },
  { amount: '45.250', currency: 'KWD', expect: 'exact' },
  { amount: '45.2505', currency: 'KWD', expect: 'refused' },
  { amount: '0.30', currency: 'EUR', expect: 'exact' },
];

let sequence = 0;
/** A fresh idempotency key per call site; never reused across cases by accident. */
function freshKey(label: string): string {
  sequence += 1;
  return `conformance-${label}-${Date.now().toString(36)}-${sequence}`;
}

function parsesAs(call: PaymentCall, answer: unknown): string[] {
  if (isProviderError(answer)) {
    const parsed = providerErrorSchema.safeParse(answer);
    return parsed.success ? [] : parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
  }
  const parsed = PAYMENT_ANSWER_SCHEMAS[call].safeParse(answer);
  return parsed.success ? [] : parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
}

function ok<T>(answer: T | ProviderError, what: string): T {
  if (isProviderError(answer)) throw new Error(`${what} was refused: ${answer.code} ${answer.providerMessage}`);
  return answer;
}

/** Registers the suite's tests for one provider. Call it inside a test file. */
export function paymentProviderConformance(options: PaymentConformanceOptions): void {
  const { driver } = options;
  const secrets = Object.values(options.credentials).filter((value) => value.length >= 6);

  function leaks(answer: unknown): string[] {
    const text = JSON.stringify(answer);
    return secrets.filter((secret) => text.includes(secret)).map(() => 'a credential value appears in an answer');
  }

  async function checkout(label: string): Promise<{ ref: string; attemptId: string }> {
    const attemptId = freshKey(`attempt-${label}`);
    const made = ok(
      await options.make().createCheckout({
        payable: options.payable,
        methods: options.methods,
        successUrl: options.successUrl,
        cancelUrl: options.cancelUrl,
        attemptId,
        idempotencyKey: freshKey(label),
      }),
      'createCheckout',
    );
    return { ref: made.ref, attemptId };
  }

  async function paid(label: string): Promise<{ ref: string; paymentRef: string; amount: string; currency: string }> {
    const made = await checkout(label);
    await driver.pay!(made.ref, 'succeeds');
    const state = ok(await options.make().status(made.ref), 'status');
    if (state.paymentRef === null || state.amount === null || state.currency === null) {
      throw new Error('a succeeded checkout gave no payment id or amount');
    }
    return { ref: made.ref, paymentRef: state.paymentRef, amount: state.amount, currency: state.currency };
  }

  describe(`payment-provider@1 conformance — ${options.name} (${options.mode})`, () => {
    it('is a factory product with every call', () => {
      const provider = options.make();
      expect(typeof provider.key).toBe('string');
      expect(provider.mode).toBe(options.mode);
      for (const call of [
        'checkCredentials',
        'createCheckout',
        'status',
        'complete',
        'expire',
        'refund',
        'refundStatus',
        'verifyWebhook',
        'listMissedEvents',
        'methodsFor',
        'toMinor',
        'fromMinor',
      ] as const) {
        expect(typeof provider[call], call).toBe('function');
      }
    });

    it('checks its credentials and names the account', async () => {
      const answer = await options.make().checkCredentials();
      expect(parsesAs('checkCredentials', answer)).toEqual([]);
      const check = ok(answer, 'checkCredentials');
      expect(check.livemode).toBe(options.mode === 'live');
      expect(leaks(answer)).toEqual([]);
    });

    it('lists the ways to pay in the declared shape', async () => {
      const answer = await options.make().methodsFor({
        country: 'DE',
        currency: options.payable.currency,
        amount: options.payable.amount,
      });
      expect(parsesAs('methodsFor', answer)).toEqual([]);
    });

    it('makes a checkout with an https hosted page', async () => {
      const answer = await options.make().createCheckout({
        payable: options.payable,
        methods: options.methods,
        successUrl: options.successUrl,
        cancelUrl: options.cancelUrl,
        attemptId: freshKey('attempt'),
        idempotencyKey: freshKey('create'),
      });
      expect(parsesAs('createCheckout', answer)).toEqual([]);
      expect(ok(answer, 'createCheckout').url.startsWith('https://')).toBe(true);
      expect(leaks(answer)).toEqual([]);
    });

    it('gives the same checkout for the same idempotency key', async () => {
      const key = freshKey('same');
      const input = {
        payable: options.payable,
        methods: options.methods,
        successUrl: options.successUrl,
        cancelUrl: options.cancelUrl,
        attemptId: freshKey('attempt'),
        idempotencyKey: key,
      };
      const first = ok(await options.make().createCheckout(input), 'createCheckout');
      const second = ok(await options.make().createCheckout(input), 'createCheckout again');
      expect(second.ref).toBe(first.ref);
    });

    it('reads a new checkout as not paid, carrying the attempt id', async () => {
      const made = await checkout('fresh');
      const answer = await options.make().status(made.ref);
      expect(parsesAs('status', answer)).toEqual([]);
      const state = ok(answer, 'status');
      expect(['pending', 'requires_action']).toContain(state.status);
      expect(state.attemptId).toBe(made.attemptId);
      expect(state.amount).toBeNull();
    });

    it('answers an unknown reference with NOT_FOUND, as data', async () => {
      const answer = await options.make().status('no-such-checkout-0000');
      expect(isProviderError(answer)).toBe(true);
      expect((answer as ProviderError).code).toBe('NOT_FOUND');
      expect(parsesAs('status', answer)).toEqual([]);
      const refund = await options.make().refundStatus('no-such-refund-0000');
      expect((refund as ProviderError).code).toBe('NOT_FOUND');
    });

    it('ends an open checkout', async () => {
      const made = await checkout('expire');
      const answer = await options.make().expire(made.ref);
      expect(parsesAs('expire', answer)).toEqual([]);
      expect(ok(answer, 'expire').status).toBe('expired');
      expect(ok(await options.make().status(made.ref), 'status').status).toBe('expired');
    });

    it.skipIf(driver.pay === undefined)('reads a success with what was taken and the payment id', async () => {
      const made = await checkout('pay');
      await driver.pay!(made.ref, 'succeeds');
      const answer = await options.make().status(made.ref);
      expect(parsesAs('status', answer)).toEqual([]);
      const state = ok(answer, 'status');
      expect(state.status).toBe('succeeded');
      expect(state.livemode).toBe(options.mode === 'live');
      expect(state.paymentRef).not.toBeNull();
      expect(sameAmount(state.amount ?? '', options.payable.amount)).toBe(true);
      expect(state.currency).toBe(options.payable.currency);
      expect(leaks(answer)).toEqual([]);
    });

    it.skipIf(driver.pay === undefined)('completes a paid checkout as read (a no-op or a capture)', async () => {
      const made = await checkout('complete');
      await driver.pay!(made.ref, 'succeeds');
      const answer = await options.make().complete(made.ref, freshKey('complete'));
      expect(parsesAs('complete', answer)).toEqual([]);
      expect(ok(answer, 'complete').status).toBe('succeeded');
    });

    it.skipIf(driver.pay === undefined)('refuses to end a checkout that already completed', async () => {
      const made = await checkout('expire-paid');
      await driver.pay!(made.ref, 'succeeds');
      const answer = await options.make().expire(made.ref);
      expect(isProviderError(answer) ? answer.code : 'no refusal').toBe('ALREADY_COMPLETED');
    });

    it.skipIf(driver.pay === undefined)('reads a declined payment as failed, with nothing taken', async () => {
      const made = await checkout('decline');
      await driver.pay!(made.ref, 'fails');
      const state = ok(await options.make().status(made.ref), 'status');
      expect(state.status).toBe('failed');
      expect(state.amount).toBeNull();
    });

    it.skipIf(driver.payLate === undefined || driver.settle === undefined)(
      'reads a late payment as processing, then succeeded',
      async () => {
        const made = await checkout('late');
        await driver.payLate!(made.ref);
        const waiting = ok(await options.make().status(made.ref), 'status');
        expect(waiting.status).toBe('processing');
        expect(waiting.paidWith?.delayed).toBe(true);
        await driver.settle!(made.ref);
        expect(ok(await options.make().status(made.ref), 'status').status).toBe('succeeded');
      },
    );

    it.skipIf(driver.pay === undefined)('refunds in parts, never past what was taken', async () => {
      const payment = await paid('refund');
      const half = options.payable.currency === 'JPY' ? '1' : '0.01';
      const first = await options.make().refund({
        paymentRef: payment.paymentRef,
        amount: half,
        currency: payment.currency,
        reason: 'requested_by_customer',
        idempotencyKey: freshKey('refund'),
      });
      expect(parsesAs('refund', first)).toEqual([]);
      expect(ok(first, 'refund').paymentRef).toBe(payment.paymentRef);
      const over = await options.make().refund({
        paymentRef: payment.paymentRef,
        amount: payment.amount,
        currency: payment.currency,
        reason: 'requested_by_customer',
        idempotencyKey: freshKey('refund-over'),
      });
      expect(isProviderError(over) ? over.code : 'no refusal').toBe('REFUND_REFUSED');
    });

    it.skipIf(driver.pay === undefined)('gives the same refund for the same idempotency key', async () => {
      const payment = await paid('refund-twice');
      const input = {
        paymentRef: payment.paymentRef,
        amount: payment.amount,
        currency: payment.currency,
        reason: 'duplicate' as const,
        idempotencyKey: freshKey('refund-same'),
      };
      const first = ok(await options.make().refund(input), 'refund');
      const second = ok(await options.make().refund(input), 'refund again');
      expect(second.ref).toBe(first.ref);
      const read = await options.make().refundStatus(first.ref);
      expect(parsesAs('refundStatus', read)).toEqual([]);
    });

    it.skipIf(driver.pay === undefined || driver.failRefund === undefined)(
      'reads a refund that fails after it succeeded',
      async () => {
        const payment = await paid('refund-fail');
        const refund = ok(
          await options.make().refund({
            paymentRef: payment.paymentRef,
            amount: payment.amount,
            currency: payment.currency,
            reason: 'requested_by_customer',
            idempotencyKey: freshKey('refund-fail'),
          }),
          'refund',
        );
        await driver.failRefund!(refund.ref);
        const read = ok(await options.make().refundStatus(refund.ref), 'refundStatus');
        expect(read.status).toBe('failed');
        expect(read.failureMessage).not.toBeNull();
      },
    );

    it.skipIf(driver.pay === undefined || driver.latestDelivery === undefined)(
      'verifies a genuine webhook and refuses a forged or altered one',
      async () => {
        const made = await checkout('webhook');
        await driver.pay!(made.ref, 'succeeds');
        const delivery = await driver.latestDelivery!(made.ref);
        expect(delivery, 'the driver gave no delivery').not.toBeNull();
        const genuine = await options.make().verifyWebhook(delivery!);
        expect(parsesAs('verifyWebhook', genuine)).toEqual([]);
        const event = ok(genuine, 'verifyWebhook');
        expect(event.checkoutRef).toBe(made.ref);
        expect(event.livemode).toBe(options.mode === 'live');

        const altered = await options.make().verifyWebhook({
          ...delivery!,
          rawBody: delivery!.rawBody.replace(made.ref, `${made.ref}x`),
        });
        expect(isProviderError(altered) ? altered.code : 'accepted').toBe('SIGNATURE_INVALID');

        const unsigned = await options.make().verifyWebhook({ rawBody: delivery!.rawBody, headers: {} });
        expect(isProviderError(unsigned) ? unsigned.code : 'accepted').toBe('SIGNATURE_INVALID');
      },
    );

    it('lists missed events in the declared shape, moving its cursor forward', async () => {
      const first = await options.make().listMissedEvents(null);
      expect(parsesAs('listMissedEvents', first)).toEqual([]);
      const page = ok(first, 'listMissedEvents');
      const next = await options.make().listMissedEvents(page.cursor);
      expect(parsesAs('listMissedEvents', next)).toEqual([]);
      const seen = new Set(page.events.map((one) => one.eventId));
      const repeated = ok(next, 'listMissedEvents again').events.filter((one) => seen.has(one.eventId));
      expect(repeated.map((one) => one.eventId)).toEqual([]);
    });

    describe('converts amounts exactly or refuses them', () => {
      for (const one of options.amounts) {
        it(`${one.amount} ${one.currency} is ${one.expect}`, () => {
          const provider = options.make();
          const minor = provider.toMinor(one.amount, one.currency);
          if (one.expect === 'refused') {
            expect(isProviderError(minor) ? minor.code : 'converted').toMatch(/^(AMOUNT_UNREPRESENTABLE|CURRENCY_UNSUPPORTED)$/);
            return;
          }
          const converted = ok(minor, 'toMinor');
          expect(converted.minor).toMatch(/^(0|[1-9]\d*)$/);
          const back = ok(provider.fromMinor(converted.minor, one.currency), 'fromMinor');
          expect(sameAmount(back, one.amount), `${one.amount} came back as ${back}`).toBe(true);
        });
      }
    });
  });
}
