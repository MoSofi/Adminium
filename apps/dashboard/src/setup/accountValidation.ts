// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Account-field validation, shared by the wizard that asks for them.
 *
 * Lifted out of the two-step `FirstRunWizard.tsx` by unchanged, because three
 * screens collect the same four fields — first-run onboarding, the desktop
 * setup host, and the wizard that used to own it — and a second copy of "what
 * is a valid password" would drift the moment one of them changed. The wizard
 * retired that file; this is the only home.
 *
 * Client-side purely for fast feedback: the server re-validates everything
 * (`auth.passwordMinLength`) and is the authority, so drift here is a UX bug
 * and never a security hole.
 */
import { t } from '../i18n/t.js';

export interface AccountValues {
  name: string;
  email: string;
  password: string;
  confirm: string;
}

export const EMPTY_ACCOUNT: AccountValues = { name: '', email: '', password: '', confirm: '' };

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface AccountErrors {
  email?: string;
  password?: string;
  confirm?: string;
}

/**
 * Pure + exported for unit tests. Mirrors the server's policy floor; the
 * server re-checks it, so drift is a UX bug, never a security hole.
 */
export function validateAccount(values: AccountValues, passwordMinLength: number): AccountErrors {
  const errors: AccountErrors = {};
  if (!EMAIL_PATTERN.test(values.email.trim())) {
    errors.email = t('setup.account.emailInvalid', 'Enter a valid email address.');
  }
  if (values.password.length < passwordMinLength) {
    // No plural branch: `auth.passwordMinLength` has a registry floor of 8, so
    // "1 character" is unreachable and a plural would only multiply category
    // rules across 8 locales for a string nobody can see.
    errors.password = t('setup.account.passwordTooShort', 'Use at least {min} characters.', {
      min: passwordMinLength,
    });
  }
  if (values.confirm !== values.password) {
    errors.confirm = t('setup.account.passwordMismatch', 'Passwords do not match.');
  }
  return errors;
}
