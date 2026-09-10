// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Account-field validation (45-T04 lifted this out of the two-step wizard).
 *
 * Client-side purely for fast feedback — the server re-validates and is the
 * authority — so what these pin is that the wizard's floor MIRRORS the policy
 * it is handed, rather than inventing one of its own.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { installTestI18n } from '../i18n/testing.js';
import { validateAccount } from './accountValidation.js';

let restoreI18n: () => void;
beforeAll(() => {
  restoreI18n = installTestI18n();
});
afterAll(() => {
  restoreI18n();
});

describe('validateAccount', () => {
  const base = { name: 'Ada', email: 'ada@adminium.test', password: 'a-long-password', confirm: 'a-long-password' };

  it('accepts a well-formed account', () => {
    expect(validateAccount(base, 10)).toEqual({});
  });

  it('rejects a malformed email', () => {
    expect(validateAccount({ ...base, email: 'nope' }, 10).email).toBeTypeOf('string');
  });

  it('enforces the server-supplied minimum length', () => {
    expect(validateAccount({ ...base, password: 'short', confirm: 'short' }, 10).password).toBeTypeOf('string');
    // The floor is the server's, not a hardcoded one.
    expect(validateAccount({ ...base, password: 'abcdefghij', confirm: 'abcdefghij' }, 24).password).toBeTypeOf('string');
  });

  it('rejects a mismatched confirmation', () => {
    expect(validateAccount({ ...base, confirm: 'different' }, 10).confirm).toBeTypeOf('string');
  });
});
