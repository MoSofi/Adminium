// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `payment-provider@1`: the demo provider against the conformance suite, and
 * the money helpers every provider converts with.
 */
import { describe, expect, it } from 'vitest';

import {
  CONTRACT_REGISTRY,
  PAYMENT_ANSWER_SCHEMAS,
  addAmounts,
  compareAmounts,
  createDemoPaymentBackend,
  createDemoPaymentProvider,
  decimalToMinor,
  hasContractVersion,
  isProviderError,
  isoExponent,
  minorToDecimal,
  providerError,
  sameAmount,
  signDemoWebhook,
  subtractAmounts,
  DEMO_SIGNATURE_HEADER,
  type PaymentMode,
  type ProviderError,
} from '../src/index.js';
import { PAYMENT_AMOUNT_CASES, paymentProviderConformance } from '../src/testing/index.js';

const credentials = { secretKey: 'demo_test_conformance1', webhookSecret: 'demo_whsec_conformance1' };
const backend = createDemoPaymentBackend();
const make = (mode: PaymentMode = 'test') =>
  createDemoPaymentProvider({ http: backend.http, credentials, mode });

paymentProviderConformance({
  name: 'demo',
  make: () => make(),
  credentials,
  mode: 'test',
  payable: {
    reference: 'INV-0042',
    description: 'Invoice INV-0042',
    amount: '120.00',
    currency: 'EUR',
    customerEmail: null,
    locale: 'en-US',
  },
  methods: ['card', 'bank_debit'],
  amounts: PAYMENT_AMOUNT_CASES,
  successUrl: 'https://pay.example.test/pay/return',
  cancelUrl: 'https://pay.example.test/pay/cancel',
  driver: {
    pay: (ref, outcome) => backend.pay(ref, outcome),
    payLate: (ref) => backend.pay(ref, 'settles-late'),
    settle: (ref) => backend.settleNow(ref),
    failRefund: (ref) => backend.failRefund(ref),
    latestDelivery: async (ref) => {
      const event = [...backend.events()].reverse().find((one) => one.checkoutRef === ref);
      return event === undefined ? null : backend.deliveryFor(event.id, credentials.webhookSecret);
    },
  },
});

describe('the registry admits payment-provider@1', () => {
  it('is the seventh contract, at version 1', () => {
    expect(CONTRACT_REGISTRY.map((c) => c.id)).toContain('payment-provider');
    expect(hasContractVersion('payment-provider', 1)).toBe(true);
    expect(hasContractVersion('payment-provider', 2)).toBe(false);
  });

  it('has a schema for every call that answers with data', () => {
    expect(Object.keys(PAYMENT_ANSWER_SCHEMAS).sort()).toEqual([
      'checkCredentials',
      'complete',
      'createCheckout',
      'expire',
      'listMissedEvents',
      'methodsFor',
      'refund',
      'refundStatus',
      'status',
      'verifyWebhook',
    ]);
  });
});

describe('refusals are data', () => {
  it('builds and recognises a refusal by its shape, not a class', () => {
    const refusal = providerError('NOT_FOUND', 'No such checkout.');
    expect(isProviderError(refusal)).toBe(true);
    expect(isProviderError({ ...refusal })).toBe(true);
    expect(isProviderError({ ok: true })).toBe(false);
    expect(isProviderError(null)).toBe(false);
    expect(refusal.retryable).toBe(false);
  });
});

describe('decimal text and the smallest unit', () => {
  it.each([
    ['120.00', 2, '12000'],
    ['120.5', 2, '12050'],
    ['0.30', 2, '30'],
    ['12000', 0, '12000'],
    ['12000.00', 0, '12000'],
    ['45.250', 3, '45250'],
    ['0', 2, '0'],
    ['007.10', 2, '710'],
  ])('%s at %i places is %s', (amount, exponent, minor) => {
    expect(decimalToMinor(amount, exponent)).toBe(minor);
    expect(sameAmount(minorToDecimal(minor, exponent) ?? '', amount)).toBe(true);
  });

  it.each([
    ['120.005', 2],
    ['12000.5', 0],
    ['45.2505', 3],
    ['-1.00', 2],
    ['1e3', 2],
    ['', 2],
    ['1.00', 7],
  ])('refuses %s at %i places rather than rounding', (amount, exponent) => {
    expect(decimalToMinor(amount, exponent)).toBeNull();
  });

  it('adds what floats get wrong', () => {
    // 0.1 + 0.2 is 0.30000000000000004 as a float; money must read 0.30.
    expect(addAmounts('0.1', '0.2', 2)).toBe('0.30');
    expect(subtractAmounts('120.00', '50.00', 2)).toBe('70.00');
    expect(subtractAmounts('50.00', '120.00', 2)).toBeNull();
    expect(compareAmounts('120', '120.00')).toBe(0);
    expect(compareAmounts('0.1', '0.09')).toBe(1);
  });

  it('knows the ISO exponents the plan names', () => {
    expect(isoExponent('EUR')).toBe(2);
    expect(isoExponent('JPY')).toBe(0);
    expect(isoExponent('KWD')).toBe(3);
    expect(isoExponent('ISK')).toBe(0);
    expect(isoExponent('HUF')).toBe(2);
    expect(isoExponent('eur')).toBeNull();
  });
});

describe('the demo provider is test mode only', () => {
  it('refuses every call in live mode, before anything is sent', async () => {
    let sent = 0;
    const live = createDemoPaymentProvider({
      http: async (url, init) => {
        sent += 1;
        return backend.http(url, init);
      },
      credentials,
      mode: 'live',
    });
    const answer = await live.checkCredentials();
    expect((answer as ProviderError).code).toBe('MODE_MISMATCH');
    expect(sent).toBe(0);
  });

  it('refuses a key that is not a demo test key', async () => {
    const wrong = createDemoPaymentProvider({ http: backend.http, credentials: { secretKey: 'sk_live_x' }, mode: 'test' });
    expect(((await wrong.checkCredentials()) as ProviderError).code).toBe('CREDENTIALS_REFUSED');
  });

  it('refuses a signature older than five minutes', async () => {
    const rawBody = JSON.stringify({ id: 'evt_x', type: 'checkout.succeeded', kind: 'checkout', occurredAt: 1 });
    const stale = await signDemoWebhook(rawBody, credentials.webhookSecret, Date.now() - 6 * 60 * 1000);
    const answer = await make().verifyWebhook({ rawBody, headers: { [DEMO_SIGNATURE_HEADER]: stale } });
    expect((answer as ProviderError).code).toBe('SIGNATURE_INVALID');
  });

  it('refuses a webhook signed with another secret', async () => {
    const rawBody = JSON.stringify({ id: 'evt_y', type: 'checkout.succeeded', kind: 'checkout', occurredAt: 1 });
    const other = await signDemoWebhook(rawBody, 'someone-else', Date.now());
    const answer = await make().verifyWebhook({ rawBody, headers: { [DEMO_SIGNATURE_HEADER]: other } });
    expect((answer as ProviderError).code).toBe('SIGNATURE_INVALID');
  });
});

describe('the demo reports what was really taken', () => {
  it('says so when it took another amount or currency', async () => {
    const provider = make();
    const made = await provider.createCheckout({
      payable: { reference: 'INV-1', description: 'x', amount: '120.00', currency: 'EUR', customerEmail: null, locale: null },
      methods: ['card'],
      successUrl: 'https://pay.example.test/r',
      cancelUrl: 'https://pay.example.test/c',
      attemptId: 'att-mismatch',
      idempotencyKey: 'key-mismatch',
    });
    if (isProviderError(made)) throw new Error(made.providerMessage);
    await backend.pay(made.ref, 'succeeds', { amount: '100.00', currency: 'USD' });
    const state = await provider.status(made.ref);
    if (isProviderError(state)) throw new Error(state.providerMessage);
    expect(state.amount).toBe('100.00');
    expect(state.currency).toBe('USD');
  });

  it('settles a late payment when its time comes', async () => {
    let clock = 1_000_000;
    const timed = createDemoPaymentBackend({ now: () => clock, settleAfterMs: 1000 });
    const provider = createDemoPaymentProvider({ http: timed.http, credentials, mode: 'test' });
    const made = await provider.createCheckout({
      payable: { reference: 'INV-2', description: 'x', amount: '5.00', currency: 'EUR', customerEmail: null, locale: null },
      methods: ['bank_debit'],
      successUrl: 'https://pay.example.test/r',
      cancelUrl: 'https://pay.example.test/c',
      attemptId: 'att-late',
      idempotencyKey: 'key-late',
    });
    if (isProviderError(made)) throw new Error(made.providerMessage);
    await timed.pay(made.ref, 'settles-late');
    expect(((await provider.status(made.ref)) as { status: string }).status).toBe('processing');
    clock += 1001;
    expect(((await provider.status(made.ref)) as { status: string }).status).toBe('succeeded');
  });

  it('expires an open checkout after its lifetime', async () => {
    let clock = 5_000_000;
    const timed = createDemoPaymentBackend({ now: () => clock, checkoutLifetimeMs: 60_000 });
    const provider = createDemoPaymentProvider({ http: timed.http, credentials, mode: 'test' });
    const made = await provider.createCheckout({
      payable: { reference: 'INV-3', description: 'x', amount: '5.00', currency: 'EUR', customerEmail: null, locale: null },
      methods: ['card'],
      successUrl: 'https://pay.example.test/r',
      cancelUrl: 'https://pay.example.test/c',
      attemptId: 'att-exp',
      idempotencyKey: 'key-exp',
    });
    if (isProviderError(made)) throw new Error(made.providerMessage);
    clock += 60_001;
    expect(((await provider.status(made.ref)) as { status: string }).status).toBe('expired');
  });
});
