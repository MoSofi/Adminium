// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The wrong pastes a shop owner makes most, each refused with its own reason
 * before anything is saved.
 */
import { describe, expect, it } from 'vitest';

import { checkPaste } from '../src/payments/paste-checks.js';

const stripe = (field: string, mode: 'test' | 'live', value: string) => checkPaste('payments-stripe', field, mode, value);

describe('the Stripe key field', () => {
  it.each([
    ['sk_test_51abcdefghijklmnop', 'test', 'SECRET_KEY'],
    ['sk_live_51abcdefghijklmnop', 'live', 'SECRET_KEY'],
    ['pk_test_51abcdefghijklmnop', 'test', 'PUBLISHABLE_KEY'],
    ['whsec_abcdefghijklmnop', 'test', 'WEBHOOK_SECRET_IN_KEY_FIELD'],
    ['rk_live_51abcdefghijklmnop', 'test', 'LIVE_KEY_IN_TEST_FIELD'],
    ['rk_test_51abcdefghijklmnop', 'live', 'TEST_KEY_IN_LIVE_FIELD'],
    ['hello', 'test', 'NOT_A_RESTRICTED_KEY'],
    ['rk_test_short', 'test', 'NOT_A_RESTRICTED_KEY'],
  ] as const)('refuses %s in the %s field as %s', (value, mode, code) => {
    expect(stripe('secret_key', mode, value)).toEqual({ ok: false, code });
  });

  it('takes a restricted key of the right mode, trimming the spaces around it', () => {
    expect(stripe('secret_key', 'test', '  rk_test_51abcdefghijklmnop\n')).toEqual({ ok: true, value: 'rk_test_51abcdefghijklmnop' });
    expect(stripe('secret_key', 'live', 'rk_live_51abcdefghijklmnop')).toEqual({ ok: true, value: 'rk_live_51abcdefghijklmnop' });
  });

  it('refuses two keys pasted at once', () => {
    expect(stripe('secret_key', 'test', 'rk_test_51abcdefghijklmnop rk_test_51abcdefghijklmnoq')).toEqual({ ok: false, code: 'HAS_SPACES' });
  });
});

describe('the Stripe signing secret field', () => {
  it('refuses a key pasted where the secret goes', () => {
    expect(stripe('webhook_secret', 'test', 'rk_test_51abcdefghijklmnop')).toEqual({ ok: false, code: 'KEY_IN_SECRET_FIELD' });
  });

  it('refuses something that is not a signing secret', () => {
    expect(stripe('webhook_secret', 'test', 'abcdefghijklmnop')).toEqual({ ok: false, code: 'NOT_A_SIGNING_SECRET' });
  });

  it('takes a signing secret', () => {
    expect(stripe('webhook_secret', 'live', 'whsec_abcdefghijklmnop')).toEqual({ ok: true, value: 'whsec_abcdefghijklmnop' });
  });
});

describe('any other field', () => {
  it('is only trimmed, and refused when empty', () => {
    expect(checkPaste('payments-paypal', 'client_id', 'test', ' AbC123 ')).toEqual({ ok: true, value: 'AbC123' });
    expect(checkPaste('payments-paypal', 'client_id', 'test', '   ')).toEqual({ ok: false, code: 'EMPTY' });
  });
});
