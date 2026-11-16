// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A payment service's name is its own mark, spelled as the service spells it,
 * the same on a record's "recorded by", a receipt and a notice.
 */
import { describe, expect, it } from 'vitest';
import { providerName } from '../src/payments/notices.js';
import { recordedByOf } from '../src/payments/record.js';
import { serviceMark } from '../src/payments/service-name.js';

describe('a payment service names itself as its mark', () => {
  it('spells each known service as it spells itself', () => {
    expect(serviceMark('payments-paypal')).toBe('PayPal');
    expect(serviceMark('payments-stripe')).toBe('Stripe');
    expect(serviceMark('payments-square')).toBe('Square');
    expect(serviceMark('demo')).toBe('Demo');
  });

  it('never builds a mark by changing letter case', () => {
    expect(recordedByOf('payments-paypal')).toBe('Online payment (PayPal)');
    expect(recordedByOf('payments-paypal')).not.toContain('Paypal');
    expect(serviceMark('payments-acme-pay')).toBe('acme-pay');
  });

  it('says the same name on a record and in a notice', () => {
    for (const key of ['payments-stripe', 'payments-paypal', 'payments-square', 'demo', 'payments-other']) {
      expect(recordedByOf(key)).toBe(`Online payment (${providerName(key)})`);
    }
  });
});
