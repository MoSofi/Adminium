// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The demo payment service beyond what the conformance suite asks: the card
 * that needs a step, leaving the page, refunds settling with time, missed
 * events once delivered, the refusals it gives, and a transport that keeps
 * every failure as data — an unreachable service, an answer that is not JSON,
 * a server error.
 */
import { describe, expect, it } from 'vitest';

import {
  addAmounts,
  compareAmounts,
  createDemoPaymentBackend,
  createDemoPaymentProvider,
  decimalToMinor,
  minorToDecimal,
  sameAmount,
  signDemoWebhook,
  subtractAmounts,
  DEMO_PAYMENT_ORIGIN,
  DEMO_SIGNATURE_HEADER,
  type CheckoutState,
  type PaymentHttpClient,
  type ProviderError,
  type RefundState,
} from '../src/index.js';

const credentials = { secretKey: 'demo_test_demofile01', webhookSecret: 'demo_whsec_demofile01' };
const payable = { reference: 'INV-1', description: 'x', amount: '20.00', currency: 'EUR', customerEmail: null, locale: null };
let made = 0;

function setup(options: Parameters<typeof createDemoPaymentBackend>[0] = {}) {
  const backend = createDemoPaymentBackend(options);
  const provider = createDemoPaymentProvider({ http: backend.http, credentials, mode: 'test' });
  const checkout = async () => {
    made += 1;
    const answer = await provider.createCheckout({
      payable,
      methods: ['card'],
      successUrl: 'https://pay.example.test/r',
      cancelUrl: 'https://pay.example.test/c',
      attemptId: `att-${made}`,
      idempotencyKey: `key-${made}`,
    });
    if ('ok' in answer && answer.ok === false) throw new Error(answer.providerMessage);
    return { ref: (answer as { ref: string }).ref, attemptId: `att-${made}` };
  };
  const status = async (ref: string) => (await provider.status(ref)) as CheckoutState;
  return { backend, provider, checkout, status };
}

const code = (answer: unknown) => (answer as ProviderError).code;

describe('the demo hosted page', () => {
  it('takes a card that needs a step, then finishes it', async () => {
    const { backend, checkout, status } = setup();
    const { ref } = await checkout();
    await backend.pay(ref, 'needs-a-step');
    expect((await status(ref)).status).toBe('requires_action');
    await backend.finishStep(ref);
    expect((await status(ref)).status).toBe('succeeded');
    await expect(backend.finishStep(ref)).rejects.toThrow(/needs no step/);
    await expect(backend.pay(ref, 'succeeds')).rejects.toThrow(/is succeeded/);
  });

  it('lets the customer leave, and leaving a paid checkout changes nothing', async () => {
    const { backend, checkout, status } = setup();
    const left = await checkout();
    await backend.cancel(left.ref);
    expect((await status(left.ref)).status).toBe('cancelled');
    const paid = await checkout();
    await backend.pay(paid.ref, 'succeeds');
    await backend.cancel(paid.ref);
    expect((await status(paid.ref)).status).toBe('succeeded');
  });

  it('finds the checkout an attempt made, and nothing for another', async () => {
    const { backend, checkout } = setup();
    const { ref, attemptId } = await checkout();
    expect(backend.checkoutForAttempt(attemptId)).toMatchObject({ id: ref, amount: '20.00', currency: 'EUR', status: 'pending' });
    expect(backend.checkoutForAttempt('nobody')).toBeNull();
    await expect(backend.pay('cs_none', 'succeeds')).rejects.toThrow(/No demo checkout/);
    await expect(backend.settleNow('nothing')).rejects.toThrow(/waiting to settle/);
    await expect(backend.failRefund('re_none')).rejects.toThrow(/No demo refund/);
    await expect(backend.deliveryFor('evt_none', 'x')).rejects.toThrow(/No demo event/);
  });
});

describe('demo refunds', () => {
  it('settle with time, or at once when told', async () => {
    let clock = 10_000_000;
    const { backend, provider, checkout, status } = setup({ now: () => clock, settleAfterMs: 1000 });
    const { ref } = await checkout();
    await backend.pay(ref, 'succeeds');
    const paymentRef = (await status(ref)).paymentRef!;
    const first = (await provider.refund({ paymentRef, amount: '5.00', currency: 'EUR', reason: 'other', idempotencyKey: 'r1' })) as RefundState;
    expect(first.status).toBe('pending');
    clock += 1001;
    expect(((await provider.refundStatus(first.ref)) as RefundState).status).toBe('succeeded');
    const second = (await provider.refund({ paymentRef, amount: '5.00', currency: 'EUR', reason: 'other', idempotencyKey: 'r2' })) as RefundState;
    await backend.settleNow(second.ref);
    expect(((await provider.refundStatus(second.ref)) as RefundState).status).toBe('succeeded');
  });

  it('are refused for an unknown payment, an unpaid one, another currency or nothing at all', async () => {
    const { backend, provider, checkout, status } = setup();
    expect(code(await provider.refund({ paymentRef: 'pay_none', amount: '1.00', currency: 'EUR', reason: 'other', idempotencyKey: 'x1' }))).toBe('NOT_FOUND');
    const late = await checkout();
    await backend.pay(late.ref, 'settles-late');
    const latePayment = (await status(late.ref)).paymentRef!;
    expect(code(await provider.refund({ paymentRef: latePayment, amount: '1.00', currency: 'EUR', reason: 'other', idempotencyKey: 'x2' }))).toBe('REFUND_REFUSED');
    const paid = await checkout();
    await backend.pay(paid.ref, 'succeeds');
    const paymentRef = (await status(paid.ref)).paymentRef!;
    expect(code(await provider.refund({ paymentRef, amount: '1.00', currency: 'USD', reason: 'other', idempotencyKey: 'x3' }))).toBe('REFUND_REFUSED');
    expect(code(await provider.refund({ paymentRef, amount: '0', currency: 'EUR', reason: 'other', idempotencyKey: 'x4' }))).toBe('REFUND_REFUSED');
  });

  it('can be made in the dashboard, and a payment can be disputed and the dispute closed', async () => {
    const { backend, provider, checkout, status } = setup();
    const { ref } = await checkout();
    await backend.pay(ref, 'succeeds');
    const paymentRef = (await status(ref)).paymentRef!;
    const made = await backend.refundAtProvider(paymentRef, '15.00');
    expect(await provider.refundStatus(made)).toMatchObject({ status: 'succeeded', amount: '15.00', currency: 'EUR', paymentRef });
    expect(backend.events().at(-1)).toMatchObject({ type: 'refund.succeeded', refundRef: made });
    // What the dashboard refunded counts: only the rest may still be refunded.
    expect(code(await provider.refund({ paymentRef, amount: '5.01', currency: 'EUR', reason: 'other', idempotencyKey: 'd1' }))).toBe('REFUND_REFUSED');
    await backend.dispute(paymentRef);
    expect(backend.events().at(-1)).toMatchObject({ type: 'charge.dispute.created', checkoutRef: ref });
    await backend.dispute(paymentRef, true);
    expect(backend.events().at(-1)).toMatchObject({ type: 'charge.dispute.closed' });
    await expect(backend.dispute('pay_none')).rejects.toThrow('No demo payment');
    await expect(backend.refundAtProvider('pay_none', '1.00')).rejects.toThrow('No demo payment');
  });
});

describe('demo events', () => {
  it('stop being missed once delivered, and page past a hundred', async () => {
    const { backend, provider, checkout } = setup();
    for (let i = 0; i < 101; i += 1) await checkout();
    const page = await provider.listMissedEvents(null);
    expect(page).toMatchObject({ ok: true, more: true });
    for (const event of backend.events()) backend.markDelivered(event.id);
    backend.markDelivered('evt_none');
    const none = await provider.listMissedEvents(null);
    expect(none).toMatchObject({ ok: true, events: [], more: false });
  });

  it('refuse a webhook that is not JSON, unsigned, in live mode, or with no secret set', async () => {
    const { provider } = setup();
    const rawBody = 'not json';
    const signed = await signDemoWebhook(rawBody, credentials.webhookSecret, Date.now());
    expect(code(await provider.verifyWebhook({ rawBody, headers: { [DEMO_SIGNATURE_HEADER]: signed } }))).toBe('INVALID_REQUEST');
    expect(code(await provider.verifyWebhook({ rawBody, headers: { [DEMO_SIGNATURE_HEADER]: 't=1,v1=zz' } }))).toBe('SIGNATURE_INVALID');
    const live = createDemoPaymentProvider({ http: setup().backend.http, credentials, mode: 'live' });
    expect(code(await live.verifyWebhook({ rawBody, headers: {} }))).toBe('MODE_MISMATCH');
    const bare = createDemoPaymentProvider({ http: setup().backend.http, credentials: { secretKey: credentials.secretKey }, mode: 'test' });
    expect(code(await bare.verifyWebhook({ rawBody, headers: { [DEMO_SIGNATURE_HEADER]: signed } }))).toBe('SIGNATURE_INVALID');
  });
});

describe('the demo transport keeps every failure as data', () => {
  const via = (http: PaymentHttpClient) => createDemoPaymentProvider({ http, credentials, mode: 'test' });
  const reply = (status: number, text: string): PaymentHttpClient => async () => ({ status, headers: { get: () => null }, text: async () => text });

  it('an unreachable service is retryable', async () => {
    const answer = await via(async () => Promise.reject(new Error('down'))).checkCredentials();
    expect(answer).toMatchObject({ code: 'UNAVAILABLE', retryable: true });
  });

  it('an answer that is not JSON, and a server error, are unavailable', async () => {
    expect(await via(reply(200, '<html>')).checkCredentials()).toMatchObject({ code: 'UNAVAILABLE', retryable: true });
    expect(await via(reply(502, '{"message":"bad gateway"}')).checkCredentials()).toMatchObject({ code: 'UNAVAILABLE', retryable: true, providerMessage: 'bad gateway' });
    expect(await via(reply(418, '{}')).checkCredentials()).toMatchObject({ code: 'UNAVAILABLE', retryable: false });
  });

  it('the pretend service answers a stranger host, a route it lacks and a missing key', async () => {
    const { backend } = setup();
    const auth = { authorization: `Bearer ${credentials.secretKey}` };
    expect((await backend.http('https://elsewhere.example/account', { headers: auth })).status).toBe(404);
    expect((await backend.http(`${DEMO_PAYMENT_ORIGIN}/nothing`, { headers: auth })).status).toBe(404);
    expect((await backend.http(`${DEMO_PAYMENT_ORIGIN}/checkouts`, { method: 'POST', headers: auth, body: '{}' })).status).toBe(400);
    expect((await backend.http(`${DEMO_PAYMENT_ORIGIN}/refunds`, { method: 'POST', headers: auth, body: '{}' })).status).toBe(400);
    expect((await backend.http(`${DEMO_PAYMENT_ORIGIN}/refunds/none`, { headers: auth })).status).toBe(404);
  });

  it('refuses a currency it does not know, and an amount that is not one', () => {
    const provider = setup().provider;
    expect(code(provider.toMinor('1.00', 'eur'))).toBe('CURRENCY_UNSUPPORTED');
    expect(code(provider.fromMinor('100', 'eur'))).toBe('CURRENCY_UNSUPPORTED');
    expect(code(provider.fromMinor('1.5', 'EUR'))).toBe('INVALID_REQUEST');
  });
});

describe('the money helpers refuse what is not money', () => {
  it('in every helper', () => {
    expect(decimalToMinor('1.00', -1)).toBeNull();
    expect(decimalToMinor('1.00', 2.5)).toBeNull();
    expect(decimalToMinor('0.00', 2)).toBe('0');
    expect(minorToDecimal('100', 7)).toBeNull();
    expect(minorToDecimal('1.5', 2)).toBeNull();
    expect(minorToDecimal('5', 2)).toBe('0.05');
    expect(sameAmount('x', 'x')).toBe(false);
    expect(compareAmounts('x', '1')).toBeNull();
    expect(compareAmounts('1', '2')).toBe(-1);
    expect(addAmounts('x', '1', 2)).toBeNull();
    expect(subtractAmounts('1', 'x', 2)).toBeNull();
  });
});
