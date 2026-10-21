// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What Studio keeps about a payment service: hints, never keys; a Check's
 * findings; the account the key belongs to (and the alarm when it changes);
 * the checklist's progress.
 */
import { providerError } from '@adminium/add-on-contracts';
import { describe, expect, it } from 'vitest';

import { checklist, emptyServiceState, hintOf, recordCheck, serviceStateSchema, withSavedField } from '../src/payments/services.js';

const STRIPE = { keyFields: ['secret_key'], webhookFields: ['webhook_secret'], hasPaths: true };

describe('hints', () => {
  it.each([
    ['rk_test_51Habcdefghijklmnopa1B2', 'rk_test_…a1B2'],
    ['rk_live_51Habcdefghijklmnop9xQ4', 'rk_live_…9xQ4'],
    ['whsec_abcdefghijklmnopqrstuvwx', 'whsec_…uvwx'],
    ['AYSq3RDGsmBLJE-otTkBtM-jBRd1TCQ', '…1TCQ'],
    ['rk_test_short', 'rk_test_…'],
  ])('%s → %s', (value, hint) => {
    expect(hintOf(value)).toBe(hint);
  });

  it('never keeps more than a prefix and four characters', () => {
    const value = 'rk_test_51Habcdefghijklmnopa1B2';
    const state = withSavedField(emptyServiceState(), 'test', 'secret_key', value, 1);
    expect(JSON.stringify(state)).not.toContain(value.slice(8, -4));
    expect(serviceStateSchema.parse(state)).toEqual(state);
  });
});

describe('a Check', () => {
  it('records the account and what is missing', () => {
    const { state } = recordCheck(emptyServiceState(), 'test', { ok: true, accountId: 'acct_1Q2w3E4r', livemode: false, missing: ['Events: read'] }, 5);
    expect(state.test.accountId).toBe('acct_1Q2w3E4r');
    expect(state.test.check).toEqual({ at: 5, ok: true, code: null, message: null, missing: ['Events: read'] });
  });

  it('raises the alarm when the key now belongs to another account', () => {
    const first = recordCheck(emptyServiceState(), 'live', { ok: true, accountId: 'acct_1Q2w3E4r', livemode: true, missing: [] }, 1);
    expect(first.accountChanged).toBeNull();
    const second = recordCheck(first.state, 'live', { ok: true, accountId: 'acct_9Z8y7X6w', livemode: true, missing: [] }, 2);
    expect(second.accountChanged).toEqual({ from: 'acct_1Q2w3E4r', to: 'acct_9Z8y7X6w' });
  });

  it('keeps the known account through a refusal, and records the refusal', () => {
    const first = recordCheck(emptyServiceState(), 'test', { ok: true, accountId: 'acct_1', livemode: false, missing: [] }, 1);
    const refused = recordCheck(first.state, 'test', providerError('CREDENTIALS_REFUSED', 'Stripe refused the key.'), 2);
    expect(refused.state.test.accountId).toBe('acct_1');
    expect(refused.state.test.check).toMatchObject({ ok: false, code: 'CREDENTIALS_REFUSED' });
    expect(refused.accountChanged).toBeNull();
  });

  it('goes stale when the field it checked is replaced', () => {
    const checked = recordCheck(withSavedField(emptyServiceState(), 'test', 'secret_key', 'rk_test_51Habcdefghijklmnopa1B2', 1), 'test', { ok: true, accountId: 'acct_1', livemode: false, missing: [] }, 2);
    const replaced = withSavedField(checked.state, 'test', 'secret_key', 'rk_test_51Habcdefghijklmnopz9Y8', 3);
    expect(replaced.test.check).toBeNull();
    expect(replaced.test.accountId).toBe('acct_1');
  });
});

describe('the checklist', () => {
  it('starts with nothing done, the path step first for a provider with two ways', () => {
    expect(checklist({ state: emptyServiceState(), ...STRIPE })).toEqual([
      { step: 'path', done: false },
      { step: 'test-key', done: false },
      { step: 'test-webhook', done: false },
      { step: 'test-payment', done: false },
      { step: 'live-key', done: false },
      { step: 'live-webhook', done: false },
      { step: 'live-payment', done: false },
    ]);
  });

  it('ticks the key only when it is saved, checked and complete', () => {
    let state = withSavedField(emptyServiceState(), 'test', 'secret_key', 'rk_test_51Habcdefghijklmnopa1B2', 1);
    state = recordCheck(state, 'test', { ok: true, accountId: 'acct_1', livemode: false, missing: ['Events: read'] }, 2).state;
    expect(checklist({ state, ...STRIPE }).find((one) => one.step === 'test-key')?.done).toBe(false);
    state = recordCheck(state, 'test', { ok: true, accountId: 'acct_1', livemode: false, missing: [] }, 3).state;
    expect(checklist({ state, ...STRIPE }).find((one) => one.step === 'test-key')?.done).toBe(true);
  });

  it('ticks the webhook only once a verified event arrived', () => {
    let state = withSavedField(emptyServiceState(), 'test', 'webhook_secret', 'whsec_abcdefghijklmnopqrstuvwx', 1);
    expect(checklist({ state, ...STRIPE }).find((one) => one.step === 'test-webhook')?.done).toBe(false);
    state = { ...state, test: { ...state.test, firstEventAt: 9 } };
    expect(checklist({ state, ...STRIPE }).find((one) => one.step === 'test-webhook')?.done).toBe(true);
  });

  it('has no path step for a provider with one way to make a key', () => {
    const steps = checklist({ state: emptyServiceState(), keyFields: ['client_id', 'client_secret'], webhookFields: ['webhook_id'], hasPaths: false });
    expect(steps.map((one) => one.step)).toEqual(['test-key', 'test-webhook', 'test-payment', 'live-key', 'live-webhook', 'live-payment']);
  });
});
