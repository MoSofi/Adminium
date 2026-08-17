// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `/login` — SignInForm wired to POST /api/v1/auth/login (09 §2.3 route map):
 * 200 → into the app (honoring `?returnTo`), 202 → stash the challenge token
 * and hand off to `/otp` (TwoFactorForm), 401/429 → inline error banner.
 */
import { useRouter, useSearch } from '@tanstack/react-router';
import { useState } from 'react';
import { SignInForm } from '@adminium/ui';

import { ApiError } from '../app/api.js';
import { t } from '../i18n/t.js';
import { AuthScreenLayout } from './AuthScreenLayout.js';
import { login, storeChallenge } from './authApi.js';

export function LoginPage() {
  const router = useRouter();
  const { returnTo } = useSearch({ from: '/login' });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const finish = (to: string | undefined) => {
    // A new session means every cached query is another principal's data.
    router.options.context.queryClient.clear();
    // `returnTo` is a runtime string — go through history, not typed links.
    router.history.push(to ?? '/');
  };

  return (
    <AuthScreenLayout>
      <SignInForm
        labels={{
          title: t('auth.signIn.title', 'Welcome back'),
          subtitle: t('auth.signIn.subtitle', 'Sign in to your Adminium workspace.'),
          email: t('auth.signIn.email', 'Email'),
          password: t('auth.signIn.password', 'Password'),
          forgot: t('auth.signIn.forgot', 'Forgot?'),
          remember: t('auth.signIn.remember', 'Keep me signed in'),
          submit: t('auth.signIn.submit', 'Sign in'),
          emailInvalid: t('auth.signIn.emailInvalid', 'Enter a valid email address.'),
          passwordRequired: t('auth.signIn.passwordRequired', 'Enter your password.'),
          showPassword: t('auth.signIn.showPassword', 'Show password'),
          hidePassword: t('auth.signIn.hidePassword', 'Hide password'),
        }}
        loading={loading}
        error={error}
        onForgotPassword={() => void router.navigate({ to: '/forgot' })}
        onSubmit={(values) => {
          setLoading(true);
          setError(null);
          login(values.email, values.password)
            .then((result) => {
              if (result.kind === 'challenge') {
                storeChallenge(result.challengeToken, returnTo);
                void router.navigate({ to: '/otp' });
                return;
              }
              finish(returnTo);
            })
            .catch((cause: unknown) => {
              setLoading(false);
              if (cause instanceof ApiError && cause.status === 401) {
                setError(t('auth.signIn.invalid', 'Invalid email or password.'));
              } else if (cause instanceof ApiError && cause.status === 429) {
                setError(t('auth.signIn.rateLimited', 'Too many attempts — try again in a minute.'));
              } else {
                setError(t('auth.signIn.failed', 'Sign-in failed. Check your connection and try again.'));
              }
            });
        }}
      />
    </AuthScreenLayout>
  );
}
