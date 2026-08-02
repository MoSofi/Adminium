/**
 * `/setup` — the first-run wizard (M10-T04; v0.5 exit criterion "fresh install
 * → first-run wizard → create super admin"). Two steps on the shared auth
 * layout: the super-admin account, then the consent answers.
 *
 * Route guards (../app/router.tsx) keep this screen honest at the edges: it is
 * reachable ONLY while `setup.state.required` is true, and every other entry
 * point (`/`, `/login`) redirects here while it is. Once setup completes the
 * route redirects to `/login`, so the wizard cannot be re-opened — and the
 * server would 409 it anyway, which is the real guarantee (this is UX).
 *
 * The account step validates client-side purely for fast feedback; the server
 * re-validates everything (`auth.passwordMinLength`) and is the authority.
 */
import { useRouter } from '@tanstack/react-router';

import { hasPendingBridgeTicket } from '../studio/connect/bridgeSeed.js';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Alert, Button, FormField, Input, PasswordStrength, Stepper } from '@adminium/ui';

import { ApiError } from '../app/api.js';
import { t } from '../i18n/t.js';
import { AuthScreenLayout } from '../auth/AuthScreenLayout.js';
import { TelemetryConsent } from './TelemetryConsent.js';
import { createSuperAdmin, type SetupConsent } from './setupApi.js';

type Step = 'account' | 'consent';

interface AccountValues {
  name: string;
  email: string;
  password: string;
  confirm: string;
}

const EMPTY: AccountValues = { name: '', email: '', password: '', confirm: '' };

/** Both OFF — the wizard never pre-checks a consent. */
const NO_CONSENT: SetupConsent = { telemetry: false, updateCheck: false };

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

export interface FirstRunWizardProps {
  passwordMinLength: number;
}

export function FirstRunWizard({ passwordMinLength }: FirstRunWizardProps): ReactNode {
  const router = useRouter();
  const [step, setStep] = useState<Step>('account');
  const [values, setValues] = useState<AccountValues>(EMPTY);
  const [consent, setConsent] = useState<SetupConsent>(NO_CONSENT);
  const [errors, setErrors] = useState<AccountErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const steps = [
    { id: 'account', label: t('setup.steps.account', 'Admin account') },
    { id: 'consent', label: t('setup.steps.consent', 'Privacy') },
  ];

  function onAccountSubmit(event: FormEvent): void {
    event.preventDefault();
    const found = validateAccount(values, passwordMinLength);
    setErrors(found);
    if (Object.keys(found).length === 0) {
      setFormError(null);
      setStep('consent');
    }
  }

  function onFinish(): void {
    setSubmitting(true);
    setFormError(null);
    createSuperAdmin({
      email: values.email.trim(),
      password: values.password,
      name: values.name.trim(),
      consent,
    })
      .then(() => {
        // A fresh session: drop every cached query before entering the app.
        router.options.context.queryClient.clear();
        // A hand-off from adminium.dev is what sent this person here in the
        // first place (`studio/connect/bridgeSeed.ts`) — the account was only
        // ever in the way. Land them on the wizard that consumes it rather than
        // on an empty home screen with a connection string stranded in storage.
        router.history.push(hasPendingBridgeTicket() ? '/studio/connect' : '/');
      })
      .catch((cause: unknown) => {
        setSubmitting(false);
        if (cause instanceof ApiError && cause.status === 409) {
          // Someone (or something) completed setup first. No retry can ever
          // succeed, so send them to sign in rather than offer a dead button.
          setFormError(
            t(
              'setup.error.alreadyCompleted',
              'This instance has already been set up. Sign in with the existing admin account.',
            ),
          );
          return;
        }
        if (cause instanceof ApiError && cause.status === 422) {
          setFormError(
            t('setup.error.rejected', 'The server rejected those details. Check the email and password and try again.'),
          );
          setStep('account');
          return;
        }
        setFormError(t('setup.error.failed', 'Setup failed. Check your connection and try again.'));
      });
  }

  return (
    <AuthScreenLayout>
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-h2 font-extrabold tracking-[-0.02em] text-fg">
            {t('setup.title', 'Set up Adminium')}
          </h1>
          <p className="text-body-sm text-fg-muted">
            {t('setup.subtitle', 'Create the first administrator. This happens once.')}
          </p>
        </div>

        <Stepper
          steps={steps}
          activeIndex={step === 'account' ? 0 : 1}
          label={t('setup.progress', 'Setup progress')}
        />

        {formError === null ? null : <Alert tone="danger" role="alert" title={formError} />}

        {step === 'account' ? (
          <form className="flex flex-col gap-4" onSubmit={onAccountSubmit} noValidate>
            <FormField label={t('setup.account.name', 'Your name')}>
              <Input
                autoComplete="name"
                value={values.name}
                onChange={(e) => setValues({ ...values, name: e.target.value })}
              />
            </FormField>

            <FormField label={t('setup.account.email', 'Email')} required {...(errors.email === undefined ? {} : { error: errors.email })}>
              <Input
                type="email"
                autoComplete="username"
                autoFocus
                value={values.email}
                onChange={(e) => setValues({ ...values, email: e.target.value })}
              />
            </FormField>

            <FormField
              label={t('setup.account.password', 'Password')}
              required
              {...(errors.password === undefined
                ? { helper: t('setup.account.passwordHelper', 'At least {min} characters.', { min: passwordMinLength }) }
                : { error: errors.password })}
            >
              <Input
                type="password"
                autoComplete="new-password"
                value={values.password}
                onChange={(e) => setValues({ ...values, password: e.target.value })}
              />
            </FormField>

            {values.password.length === 0 ? null : (
              <PasswordStrength
                value={values.password}
                label={t('setup.account.strength', 'Password strength')}
                labels={[
                  t('setup.account.strengthLevels.weak', 'Weak'),
                  t('setup.account.strengthLevels.fair', 'Fair'),
                  t('setup.account.strengthLevels.good', 'Good'),
                  t('setup.account.strengthLevels.strong', 'Strong'),
                ]}
              />
            )}

            <FormField
              label={t('setup.account.confirm', 'Confirm password')}
              required
              {...(errors.confirm === undefined ? {} : { error: errors.confirm })}
            >
              <Input
                type="password"
                autoComplete="new-password"
                value={values.confirm}
                onChange={(e) => setValues({ ...values, confirm: e.target.value })}
              />
            </FormField>

            <Button type="submit" size="lg">
              {t('setup.account.continue', 'Continue')}
            </Button>
          </form>
        ) : (
          <div className="flex flex-col gap-5">
            <TelemetryConsent value={consent} onChange={setConsent} />
            <div className="flex items-center gap-3">
              <Button variant="outline" size="lg" onClick={() => setStep('account')} disabled={submitting}>
                {t('setup.consent.back', 'Back')}
              </Button>
              <Button size="lg" className="flex-1" onClick={onFinish} loading={submitting}>
                {t('setup.consent.finish', 'Create admin account')}
              </Button>
            </div>
          </div>
        )}
      </div>
    </AuthScreenLayout>
  );
}
