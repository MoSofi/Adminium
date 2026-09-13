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
 *
 * Both password fields can be unmasked, independently. A person choosing a
 * password they will have to type again in the next field is exactly who needs
 * to see it, and checking a mismatch by eye beats discovering it from an error
 * message. The toggle is an `IconButton`, so it carries an accessible name that
 * says which way it goes, `aria-pressed`, and `type="button"` — this is a form,
 * and a reveal that submitted it would be worse than no reveal at all.
 */
import { Eye, EyeOff } from 'lucide-react';
import { FormField, IconButton, Input, InputGroup, PasswordStrength } from '@adminium/ui';
import { useState, type KeyboardEvent, type ReactNode } from 'react';

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
  const [shown, setShown] = useState<{ password: boolean; confirm: boolean }>({
    password: false,
    confirm: false,
  });

  function revealToggle(field: 'password' | 'confirm'): ReactNode {
    const revealed = shown[field];
    return (
      <IconButton
        size="sm"
        aria-pressed={revealed}
        label={
          revealed
            ? t('onboarding:account.hidePassword', 'Hide password')
            : t('onboarding:account.showPassword', 'Show password')
        }
        onClick={() => setShown((current) => ({ ...current, [field]: !current[field] }))}
      >
        {revealed ? (
          <EyeOff aria-hidden="true" className="size-3.5" />
        ) : (
          <Eye aria-hidden="true" className="size-3.5" />
        )}
      </IconButton>
    );
  }

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
        <InputGroup
          type={shown.password ? 'text' : 'password'}
          autoComplete="new-password"
          trailing={revealToggle('password')}
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
        <InputGroup
          type={shown.confirm ? 'text' : 'password'}
          autoComplete="new-password"
          trailing={revealToggle('confirm')}
          value={values.confirm}
          onChange={(event) => onChange({ ...values, confirm: event.target.value })}
        />
      </FormField>
    </form>
  );
}
