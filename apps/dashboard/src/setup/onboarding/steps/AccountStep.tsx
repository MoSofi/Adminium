// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Step 3 — create your account (45-onboarding.md §2).
 *
 * The same four fields `FirstRunWizard` has always asked for, moved into the
 * six-step wizard. Two differences, both structural:
 *
 *  - **No submit button.** The shell's Continue is the button, so this renders
 *    a form with none — and therefore cannot rely on implicit submission,
 *    which browsers only give a form that has a submit button or exactly one
 *    field. Enter is wired explicitly instead, because a person who types a
 *    password and presses Enter has submitted, whatever the DOM thinks.
 *  - **This step is the hinge.** Its submit mints the session everything after
 *    it needs (45 R1), which is why it can never be skipped.
 */
import { FormField, Input, PasswordStrength } from '@adminium/ui';
import type { KeyboardEvent } from 'react';

import { t } from '../../../i18n/t.js';
import type { AccountErrors, AccountValues } from '../../accountValidation.js';

export interface AccountStepProps {
  values: AccountValues;
  errors: AccountErrors;
  passwordMinLength: number;
  onChange: (values: AccountValues) => void;
  /** Enter, anywhere in the form. */
  onSubmit: () => void;
}

export function AccountStep({
  values,
  errors,
  passwordMinLength,
  onChange,
  onSubmit,
}: AccountStepProps) {
  function onKeyDown(event: KeyboardEvent<HTMLFormElement>): void {
    if (event.key !== 'Enter' || event.shiftKey) return;
    event.preventDefault();
    onSubmit();
  }

  return (
    <form
      className="flex flex-col gap-4"
      noValidate
      onKeyDown={onKeyDown}
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <FormField label={t('onboarding:account.name', 'Your name')}>
        <Input
          autoComplete="name"
          value={values.name}
          onChange={(event) => onChange({ ...values, name: event.target.value })}
        />
      </FormField>

      <FormField
        label={t('onboarding:account.email', 'Email')}
        required
        {...(errors.email === undefined ? {} : { error: errors.email })}
      >
        <Input
          type="email"
          autoComplete="username"
          autoFocus
          value={values.email}
          onChange={(event) => onChange({ ...values, email: event.target.value })}
        />
      </FormField>

      <FormField
        label={t('onboarding:account.password', 'Password')}
        required
        {...(errors.password === undefined
          ? {
              helper: t('onboarding:account.passwordHelper', 'At least {min} characters.', {
                min: passwordMinLength,
              }),
            }
          : { error: errors.password })}
      >
        <Input
          type="password"
          autoComplete="new-password"
          value={values.password}
          onChange={(event) => onChange({ ...values, password: event.target.value })}
        />
      </FormField>

      {values.password.length === 0 ? null : (
        <PasswordStrength
          value={values.password}
          label={t('onboarding:account.strength', 'Password strength')}
          labels={[
            t('onboarding:account.strengthLevels.weak', 'Weak'),
            t('onboarding:account.strengthLevels.fair', 'Fair'),
            t('onboarding:account.strengthLevels.good', 'Good'),
            t('onboarding:account.strengthLevels.strong', 'Strong'),
          ]}
        />
      )}

      <FormField
        label={t('onboarding:account.confirm', 'Confirm password')}
        required
        {...(errors.confirm === undefined ? {} : { error: errors.confirm })}
      >
        <Input
          type="password"
          autoComplete="new-password"
          value={values.confirm}
          onChange={(event) => onChange({ ...values, confirm: event.target.value })}
        />
      </FormField>
    </form>
  );
}
