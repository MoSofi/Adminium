// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What someone who does not manage shipping may spend, the grammar of the
 * rights on an app's labels, the words a carrier may put on a screen, and the
 * key names log redaction must catch.
 */
import type { ShippingLimits } from '@adminium/meta';
import { describe, expect, it } from 'vitest';

import { scrubSecretFields } from '../src/log-redaction.js';
import { appShippingPermission, grantMatches, grantsFromMatrixRows, isGranted, matrixRowsFromGrants, parseGrant } from '../src/rbac/permissions.js';
import { grantsAdded, shippingGrantsOf } from '../src/apps/manifest-roles.js';
import { cleanCarrierMessage } from '../src/shipping/carriers.js';
import { accountFingerprintOf, credentialHash } from '../src/shipping/fingerprint.js';
import { declaresShippingCarrier } from '../src/shipping/shop.js';
import { bookingState, createQuoteGate, decimalAtMost, limitsSet, mayShipAbroad, rateWithinLimit } from '../src/shipping/limits.js';

const LIMITS: ShippingLimits = { installId: 'mft_shop', labelLimit: '25.00', labelCurrency: 'GBP', dailyLabels: 20, packersAbroad: false, updatedBy: null, updatedAt: 1 };

describe('money against a limit', () => {
  it('compares exact decimals, whatever their scale', () => {
    expect(decimalAtMost('25', '25.00')).toBe(true);
    expect(decimalAtMost('25.00', '25')).toBe(true);
    expect(decimalAtMost('25.001', '25.00')).toBe(false);
    expect(decimalAtMost('24.9999', '25')).toBe(true);
    // Past what a float can hold.
    expect(decimalAtMost('90071992547409930.01', '90071992547409930.02')).toBe(true);
    expect(decimalAtMost('90071992547409930.03', '90071992547409930.02')).toBe(false);
  });

  it('reads anything that is not a plain decimal as above the limit', () => {
    for (const bad of ['', 'abc', '-1', '1e3', '1.', '.5', 'NaN']) expect(decimalAtMost(bad, '25'), bad).toBe(false);
  });

  it('treats another currency as above the limit, and no limit as nothing allowed', () => {
    expect(rateWithinLimit(false, LIMITS, { amountDecimal: '1.00', currency: 'GBP' })).toBe(true);
    expect(rateWithinLimit(false, LIMITS, { amountDecimal: '1.00', currency: 'gbp' })).toBe(true);
    expect(rateWithinLimit(false, LIMITS, { amountDecimal: '1.00', currency: 'USD' })).toBe(false);
    expect(rateWithinLimit(false, null, { amountDecimal: '1.00', currency: 'GBP' })).toBe(false);
    expect(rateWithinLimit(true, null, { amountDecimal: '9999', currency: 'USD' })).toBe(true);
  });
});

describe('whether someone may book today', () => {
  it('leaves it to the owner until both figures are set', () => {
    expect(bookingState(false, null, 0)).toBe('no-limit');
    expect(bookingState(false, { ...LIMITS, labelLimit: null }, 0)).toBe('no-limit');
    expect(bookingState(false, { ...LIMITS, dailyLabels: null }, 0)).toBe('no-limit');
    expect(limitsSet({ ...LIMITS, labelCurrency: null })).toBe(false);
  });

  it('stops at the daily count, and never binds a manager', () => {
    expect(bookingState(false, LIMITS, 19)).toBe('open');
    expect(bookingState(false, LIMITS, 20)).toBe('daily-limit');
    expect(bookingState(true, null, 999)).toBe('open');
  });

  it('keeps parcels abroad for the owner, unless turned on for someone with the customs right', () => {
    const on = { ...LIMITS, packersAbroad: true };
    expect(mayShipAbroad({ manages: true, mayCustoms: false }, null)).toBe(true);
    expect(mayShipAbroad({ manages: false, mayCustoms: true }, LIMITS)).toBe(false);
    expect(mayShipAbroad({ manages: false, mayCustoms: false }, on)).toBe(false);
    expect(mayShipAbroad({ manages: false, mayCustoms: true }, on)).toBe(true);
    // Turned on with no limit set is still the owner's.
    expect(mayShipAbroad({ manages: false, mayCustoms: true }, { ...on, labelLimit: null })).toBe(false);
  });
});

describe('the pace of quotes', () => {
  it('counts per person, in a sliding minute', () => {
    const gate = createQuoteGate(2);
    expect(gate.take('a', 0).ok).toBe(true);
    expect(gate.take('a', 10_000).ok).toBe(true);
    expect(gate.take('a', 20_000)).toEqual({ ok: false, retryAfterSeconds: 40 });
    expect(gate.take('b', 20_000).ok).toBe(true);
    expect(gate.take('a', 60_001).ok).toBe(true);
  });
});

describe('the rights on an app install\'s labels', () => {
  it('parses each right, concrete, for one install', () => {
    for (const action of ['book', 'cancel', 'customs'] as const) {
      const grant = appShippingPermission('shop~kiln', action);
      expect(parseGrant(grant)).toEqual({ kind: 'shipping', appKey: 'shop~kiln', action });
      expect(isGranted(new Set([grant]), grant)).toBe(true);
    }
    for (const bad of ['shipping:*:book', 'shipping:shop:refund', 'shipping:shop', 'shipping::book', 'shipping:a/b:book']) expect(parseGrant(bad), bad).toBeNull();
  });

  it('never lets one right, or one install, answer for another', () => {
    expect(grantMatches('shipping:shop:book', 'shipping:shop:cancel')).toBe(false);
    expect(grantMatches('shipping:shop:book', 'shipping:shop~kiln:book')).toBe(false);
    expect(isGranted(new Set(['app:*:staff', 'payments:shop:refund']), 'shipping:shop:book')).toBe(false);
  });

  it('survives being stored as a matrix row, and is no app-screen grant there', () => {
    const grants = ['shipping:shop:book', 'shipping:shop~kiln:cancel', 'shipping:shop:customs'];
    const { rows } = matrixRowsFromGrants(grants);
    expect(rows.every((row) => row.resourceKind === 'app' && row.resourceRef.includes('/'))).toBe(true);
    const back = grantsFromMatrixRows(rows.map((row) => ({ ...row, roleId: 'r', id: 'x' })) as never);
    expect([...back].sort()).toEqual([...grants].sort());
    expect([...back].some((grant) => grant.startsWith('app:'))).toBe(false);
  });

  it('says what a new version of an app adds, per role and right', () => {
    const app = (permissions: string[]) => ({ kind: 'app', key: 'shop', shipping: { orders: [] }, roles: [{ key: 'packer', name: 'Packer', permissions }] }) as never;
    expect(shippingGrantsOf(app(['shipping:@:book', 'table:@orders:read']))).toEqual([{ role: 'shop-packer', roleName: 'Packer', action: 'book' }]);
    expect(grantsAdded(app(['shipping:@:book']), app(['shipping:@:book'])).shippingGrants).toEqual([]);
    expect(grantsAdded(app(['shipping:@:book']), app(['shipping:@:book', 'shipping:@:cancel'])).shippingGrants).toEqual([{ role: 'shop-packer', roleName: 'Packer', action: 'cancel' }]);
  });
});

describe('what may reach a screen, a hash or a log', () => {
  it('takes a key, addresses and query strings out of a carrier\'s words', () => {
    const said = cleanCarrierMessage('Bad key sekret-value at https://api.carrier.example/v1?token=abc and www.carrier.example/x ?auth=zzz end', (text) => text.split('sekret-value').join('[hidden]'));
    expect(said).toContain('[hidden]');
    for (const gone of ['sekret-value', 'api.carrier.example', 'token=abc', 'www.carrier', 'auth=zzz']) expect(said).not.toContain(gone);
    expect(said.endsWith('end')).toBe(true);
  });

  it('hashes a key under the server secret, per carrier, so the hash neither shows it nor travels', () => {
    const fields = { api_key: 'value-one' };
    const hash = credentialHash('secret-a', 'carrier', fields);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain('value-one');
    expect(credentialHash('secret-b', 'carrier', fields)).not.toBe(hash);
    expect(credentialHash('secret-a', 'other', fields)).not.toBe(hash);
    expect(credentialHash('secret-a', 'carrier', { api_key: 'value-two' })).not.toBe(hash);
  });

  it('names one account the same across its keys only when the carrier gives its id', () => {
    const one = { api_key: 'value-one' };
    const two = { api_key: 'value-two' };
    expect(accountFingerprintOf('s', 'c', 'live', 'acct', one)).toBe(accountFingerprintOf('s', 'c', 'live', 'acct', two));
    expect(accountFingerprintOf('s', 'c', 'live', undefined, one)).not.toBe(accountFingerprintOf('s', 'c', 'live', undefined, two));
    expect(accountFingerprintOf('s', 'c', 'live', 'acct', one)).not.toBe(accountFingerprintOf('s', 'c', 'live', 'other', one));
    // One account's test and live sides never pass for each other.
    expect(accountFingerprintOf('s', 'c', 'test', 'acct', one)).not.toBe(accountFingerprintOf('s', 'c', 'live', 'acct', one));
  });

  it('knows a carrier by its stored document, even one that no longer validates', () => {
    expect(declaresShippingCarrier({ addOn: { provides: [{ contract: 'shipping-carrier' }] }, broken: true })).toBe(true);
    for (const other of [null, {}, { addOn: {} }, { addOn: { provides: 'x' } }, { addOn: { provides: [{ contract: 'payment-provider' }] } }]) expect(declaresShippingCarrier(other)).toBe(false);
  });

  it('redacts a carrier\'s key fields in a log line, under the names its manifest gives them', () => {
    const line = JSON.stringify(scrubSecretFields({ carrier: 'shipping-shippo', api_key: 'fake-value-1', api_secret: 'fake-value-2', account_number: 'fake-value-3', credentials: { nested: 'fake-value-4' } }));
    for (const value of ['fake-value-1', 'fake-value-2', 'fake-value-3', 'fake-value-4']) expect(line).not.toContain(value);
    expect(line).toContain('shipping-shippo');
  });
});
