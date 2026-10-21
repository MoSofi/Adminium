// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The ways a customer is offered: switched on, every rule passed, a provider's
 * ways only while it can take a checkout, and one PayPal button at most.
 */
import { NO_RULES, type PaymentMethodRow, type PaymentRules } from '@adminium/meta';
import { describe, expect, it } from 'vitest';

import { waysFor, type WaysInput } from '../src/payments/ways.js';

function way(source: string, method: string, rules: Partial<PaymentRules> = {}, extra: Partial<PaymentMethodRow> = {}): PaymentMethodRow {
  return { id: `${source}:${method}`, source, method, label: null, enabled: true, rules: { ...NO_RULES, ...rules }, details: null, position: 0, createdAt: 0, updatedAt: 0, ...extra };
}

const base: Omit<WaysInput, 'methods'> = {
  payable: { kind: 'shape', profileId: null, currency: 'EUR', due: '120.00', customerCountry: 'DE' },
  shopCountry: 'DE',
  providers: ['payments-stripe'],
};

const offered = (methods: PaymentMethodRow[], extra: Partial<WaysInput> = {}) =>
  waysFor({ ...base, methods, ...extra }).map((one) => `${one.source}:${one.method}`);

describe('ways to pay', () => {
  it('offers what is switched on, in the shop order', () => {
    expect(
      offered([
        way('manual', 'bank-transfer', {}, { position: 2 }),
        way('payments-stripe', 'card', {}, { position: 1 }),
        way('manual', 'cash-on-delivery', {}, { enabled: false }),
      ]),
    ).toEqual(['payments-stripe:card', 'manual:bank-transfer']);
  });

  it("offers a provider's ways only while it can take a checkout", () => {
    expect(offered([way('payments-stripe', 'card')], { providers: [] })).toEqual([]);
  });

  it("never shows PayPal twice: the shop's own PayPal wins", () => {
    const methods = [way('payments-stripe', 'card'), way('payments-stripe', 'paypal'), way('payments-paypal', 'paypal')];
    expect(offered(methods, { providers: ['payments-stripe', 'payments-paypal'] })).toEqual(['payments-stripe:card', 'payments-paypal:paypal']);
    expect(offered(methods, { providers: ['payments-stripe'] })).toEqual(['payments-stripe:card', 'payments-stripe:paypal']);
  });

  it('follows the countries rule, using the shop country when the customer is unknown', () => {
    const methods = [way('manual', 'bank-transfer', { countries: ['DE', 'AT'] })];
    expect(offered(methods)).toEqual(['manual:bank-transfer']);
    expect(offered(methods, { payable: { ...base.payable, customerCountry: 'FR' } })).toEqual([]);
    expect(offered(methods, { payable: { ...base.payable, customerCountry: null }, shopCountry: 'AT' })).toEqual(['manual:bank-transfer']);
    expect(offered(methods, { payable: { ...base.payable, customerCountry: null }, shopCountry: null })).toEqual([]);
  });

  it('follows the currencies and amount rules, inclusive', () => {
    expect(offered([way('manual', 'bank-transfer', { currencies: ['GBP'] })])).toEqual([]);
    expect(offered([way('manual', 'bank-transfer', { min: '120', max: '500' })])).toEqual(['manual:bank-transfer']);
    expect(offered([way('manual', 'bank-transfer', { min: '120.01' })])).toEqual([]);
    expect(offered([way('manual', 'bank-transfer', { max: '119.99' })])).toEqual([]);
  });

  it('follows the only-for rule by payable kind or profile', () => {
    expect(offered([way('manual', 'cash-on-delivery', { onlyFor: ['ppf_orders'] })])).toEqual([]);
    expect(offered([way('manual', 'cash-on-delivery', { onlyFor: ['ppf_orders'] })], { payable: { ...base.payable, kind: 'profile', profileId: 'ppf_orders' } })).toEqual(['manual:cash-on-delivery']);
    expect(offered([way('manual', 'cash-on-delivery', { onlyFor: ['shape'] })])).toEqual(['manual:cash-on-delivery']);
  });

  it('shows the bank account for the payable currency only', () => {
    const bank = way('manual', 'bank-transfer', {}, { details: { accounts: [{ currency: 'EUR', iban: 'DE89…' }, { currency: 'GBP', iban: 'GB29…' }] } });
    expect(waysFor({ ...base, methods: [bank] })[0]?.details).toEqual({ accounts: [{ currency: 'EUR', iban: 'DE89…' }] });
  });
});
