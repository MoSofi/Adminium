// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What a way to pay is called: every Stripe Checkout type by its owner's mark
 * (never the raw id the sandbox walk saw: "amazon pay", "mb way"), the generic
 * ones in our words, and an id no table knows made readable.
 */
import { describe, expect, it } from 'vitest';

import { titleCaseId, wayName } from './paymentsWords.js';

const name = (method: string): string => wayName({ source: 'payments-stripe', method, label: null });

describe('wayName', () => {
  it('names the ways the walk saw as raw ids by their marks', () => {
    expect(['amazon_pay', 'blik', 'eps', 'kakao_pay', 'mb_way', 'naver_pay', 'payco', 'pix', 'samsung_pay', 'satispay'].map(name)).toEqual([
      'Amazon Pay',
      'BLIK',
      'EPS',
      'Kakao Pay',
      'MB WAY',
      'Naver Pay',
      'PAYCO',
      'Pix',
      'Samsung Pay',
      'Satispay',
    ]);
  });

  it('names every type a Checkout Session takes, never as its raw id', () => {
    // `excluded_payment_method_types` (OpenAPI 2026-09-30), the list the Stripe add-on keeps.
    const types = [
      'acss_debit', 'affirm', 'afterpay_clearpay', 'alipay', 'alma', 'amazon_pay', 'au_becs_debit', 'bacs_debit', 'bancontact', 'billie', 'bizum', 'blik', 'boleto', 'card', 'cashapp', 'crypto',
      'customer_balance', 'eps', 'fpx', 'giropay', 'grabpay', 'ideal', 'kakao_pay', 'klarna', 'konbini', 'kr_card', 'mb_way', 'mobilepay', 'multibanco', 'naver_pay', 'nz_bank_account', 'oxxo', 'p24',
      'pay_by_bank', 'payco', 'paynow', 'paypal', 'paypay', 'payto', 'pix', 'promptpay', 'revolut_pay', 'samsung_pay', 'satispay', 'scalapay', 'sepa_debit', 'sequra', 'sofort', 'sunbit', 'swish',
      'twint', 'upi', 'us_bank_account', 'wechat_pay', 'zip', 'apple_pay', 'google_pay', 'link',
    ];
    // A lower-case id, with its underscores kept or spaced out, is what the walk saw leak through.
    for (const type of types.filter((one) => one !== 'giropay')) {
      const shown = name(type);
      expect(shown, type).not.toBe(type);
      expect(shown, type).not.toBe(type.replace(/_/g, ' '));
    }
    // giropay writes its own mark in lower case.
    expect(name('giropay')).toBe('giropay');
    expect(name('afterpay_clearpay')).toBe('Afterpay / Clearpay');
    expect(name('us_bank_account')).toBe('ACH Direct Debit');
    expect(name('customer_balance')).toBe('Bank transfer (Stripe)');
    expect(name('card')).toBe('Cards');
  });

  it('title-cases an id it does not know', () => {
    expect(name('future_wallet_pay')).toBe('Future Wallet Pay');
    expect(titleCaseId('cash-on-arrival')).toBe('Cash On Arrival');
  });

  it('keeps the shop’s own name for a way first', () => {
    expect(wayName({ source: 'manual', method: 'other', label: { 'en-US': 'Pay at the counter' } })).toBe('Pay at the counter');
  });
});
