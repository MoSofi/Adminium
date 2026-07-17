/**
 * Step 3 — "Your account" (11-electron.md §6): the super-admin, the
 * "Skip login on this computer" checkbox (§5), and the locale/theme pickers
 * pre-filled from the OS.
 *
 * REUSED, NOT RE-DERIVED: `validateAccount` and the segmented `PasswordStrength`
 * meter come from the M10 self-host wizard (`setup/FirstRunWizard.tsx`). The
 * password policy is the SERVER's (`auth.passwordMinLength`) and it re-checks
 * everything, so a second client-side copy of the rule would be a second thing
 * to drift — the desktop wizard would start disagreeing with the self-host one
 * about the same server's answer.
 *
 * The form values live in the PARENT's memory and never touch sessionStorage —
 * see `desktopSetupState.ts`'s header.
 */
import type { FormEvent, ReactNode } from 'react';
import type { LocaleId } from '@adminium/i18n/registry';
import type { ThemePref } from '@adminium/tokens';
import { Checkbox, FormField, Input, Label, PasswordStrength } from '@adminium/ui';

import { LocaleControl, ThemeControl } from '../../../account/prefControls.js';
import { t } from '../../../i18n/t.js';
import type { AccountErrors } from '../../../setup/FirstRunWizard.js';

export interface AccountValues {
  name: string;
  email: string;
  password: string;
  confirm: string;
}

export const EMPTY_ACCOUNT: AccountValues = { name: '', email: '', password: '', confirm: '' };

export interface AccountStepProps {
  values: AccountValues;
  errors: AccountErrors;
  passwordMinLength: number;
  singleUser: boolean;
  /** Resolved by the parent — the OS answer, or the workspace default. */
  locale: LocaleId;
  theme: ThemePref;
  busy: boolean;
  onChange: (values: AccountValues) => void;
  onSingleUserChange: (value: boolean) => void;
  onLocaleChange: (value: LocaleId) => void;
  onThemeChange: (value: ThemePref) => void;
  onSubmit: (event: FormEvent) => void;
}

export function AccountStep(props: AccountStepProps): ReactNode {
  const { values, errors } = props;
  const set = (patch: Partial<AccountValues>): void => props.onChange({ ...values, ...patch });

  return (
    <form className="flex flex-col gap-5" onSubmit={props.onSubmit} noValidate>
      <div className="flex flex-col gap-1.5">
        <h2 className="text-section text-fg">{t('desktop.setup.account.heading', 'Create your account')}</h2>
        <p className="text-body-sm text-fg-muted">
          {t(
            'desktop.setup.account.description',
            'This is the administrator account for this copy of Adminium. The password protects your backups and anyone you share with on your network — you will not be asked for it at every launch.',
          )}
        </p>
      </div>

      <FormField label={t('desktop.setup.account.name', 'Your name')}>
        <Input
          autoComplete="name"
          value={values.name}
          disabled={props.busy}
          onChange={(event) => set({ name: event.target.value })}
        />
      </FormField>

      <FormField
        label={t('desktop.setup.account.email', 'Email')}
        required
        {...(errors.email === undefined ? {} : { error: errors.email })}
      >
        <Input
          type="email"
          autoComplete="username"
          autoFocus
          value={values.email}
          disabled={props.busy}
          onChange={(event) => set({ email: event.target.value })}
        />
      </FormField>

      <FormField
        label={t('desktop.setup.account.password', 'Password')}
        required
        {...(errors.password === undefined
          ? {
              helper: t('desktop.setup.account.passwordHelper', 'At least {min} characters.', {
                min: props.passwordMinLength,
              }),
            }
          : { error: errors.password })}
      >
        <Input
          type="password"
          autoComplete="new-password"
          value={values.password}
          disabled={props.busy}
          onChange={(event) => set({ password: event.target.value })}
        />
      </FormField>

      {values.password.length === 0 ? null : (
        <PasswordStrength
          value={values.password}
          label={t('desktop.setup.account.strength', 'Password strength')}
          labels={[
            t('desktop.setup.account.strengthLevels.weak', 'Weak'),
            t('desktop.setup.account.strengthLevels.fair', 'Fair'),
            t('desktop.setup.account.strengthLevels.good', 'Good'),
            t('desktop.setup.account.strengthLevels.strong', 'Strong'),
          ]}
        />
      )}

      <FormField
        label={t('desktop.setup.account.confirm', 'Confirm password')}
        required
        {...(errors.confirm === undefined ? {} : { error: errors.confirm })}
      >
        <Input
          type="password"
          autoComplete="new-password"
          value={values.confirm}
          disabled={props.busy}
          onChange={(event) => set({ confirm: event.target.value })}
        />
      </FormField>

      {/* §5 / §6 step 3 — checked by default. The label is the SPEC's wording
          ("Skip login on this computer"); Settings → Desktop states the same
          answer inverted ("Require login on this device"), because there the
          user is turning protection ON and here they are turning it off. */}
      <div className="flex items-start gap-3 rounded-lg border border-border bg-surface-2 p-3">
        <Checkbox
          id="desktop-setup-single-user"
          checked={props.singleUser}
          disabled={props.busy}
          aria-describedby="desktop-setup-single-user-description"
          onCheckedChange={(next) => props.onSingleUserChange(next === true)}
          className="mt-0.5"
        />
        <div className="flex min-w-0 flex-col gap-1">
          <Label htmlFor="desktop-setup-single-user" className="text-body font-semibold text-fg">
            {t('desktop.setup.account.singleUser', 'Skip login on this computer')}
          </Label>
          <p id="desktop-setup-single-user-description" className="text-body-sm text-fg-muted">
            {t(
              'desktop.setup.account.singleUserHelper',
              'Adminium signs you in automatically when you open it here. Turn this off if other people use this machine. You can change it later in Settings → Desktop.',
            )}
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface-2 p-4">
        <div className="flex flex-col gap-2">
          <Label>{t('desktop.setup.account.locale', 'Language')}</Label>
          {/* Pre-filled from the OS locale and the system theme (§6 step 3): the
              parent seeds them from `navigator.language` / the theme provider
              before this renders, so these are pickers with an answer already in
              them, not empty questions. */}
          <LocaleControl
            value={props.locale}
            onChange={props.onLocaleChange}
            label={t('desktop.setup.account.locale', 'Language')}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label>{t('desktop.setup.account.theme', 'Appearance')}</Label>
          <ThemeControl
            value={props.theme}
            onChange={props.onThemeChange}
            label={t('desktop.setup.account.theme', 'Appearance')}
          />
        </div>
      </div>
    </form>
  );
}
