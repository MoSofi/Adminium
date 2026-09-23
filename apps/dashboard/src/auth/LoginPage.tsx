// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `/login` — SignInForm wired to POST /api/v1/auth/login (route map): 200 →
 * into the app (honoring `?returnTo`), 202 → stash the challenge token and
 * hand off to `/otp` (TwoFactorForm), 401/429 → inline error banner.
 */
import { useRouter, useSearch } from '@tanstack/react-router';
import { useState } from 'react';
import { SignInForm } from '@adminium/ui';

import { ApiError } from '../app/api.js';
import { t } from '../i18n/t.js';
import { useBranding } from '../shell/BrandMark.js';
import { AuthScreenLayout } from './AuthScreenLayout.js';
import { login, storeChallenge } from './authApi.js';
import { StaffHandover } from './StaffHandover.js';

export function LoginPage() {
  const router = useRouter();
  const { returnTo, next } = useSearch({ from: '/login' });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // On an app's staff address the words are the venue's (`App Address Pages.dc.html`).
  const { surface } = useBranding();
  const [opening, setOpening] = useState<string | null>(null);

  const finish = (to: string | undefined, userName: string) => {
    // A new session means every cached query is another principal's data.
    router.options.context.queryClient.clear();
    /*
     * `next` is the SURFACE gate's target: on a mapped staff domain every
     * non-reserved path is served by the SERVER as the app surface, so
     * re-entering it must be a document navigation — a client-side push would
     * paint this SPA's shell over a URL it does not own. The router's
     * validateSearch already pinned it to a path (never `//host`).
     */
    if (next !== undefined) {
      setOpening(userName);
      window.location.assign(next);
      return;
    }
    // `returnTo` is a runtime string — go through history, not typed links.
    router.history.push(to ?? '/');
  };

  if (opening !== null) {
    return (
      <AuthScreenLayout documentTitle={t('auth.signIn.submit', 'Sign in')}>
        <StaffHandover appName={surface?.appName ?? null} userName={opening} />
      </AuthScreenLayout>
    );
  }

  return (
    // The tab is named after the ACTION, not the heading: "Welcome back" is a
    // greeting, and a tab strip needs to say which screen this is.
    <AuthScreenLayout documentTitle={t('auth.signIn.submit', 'Sign in')}>
      <SignInForm
        labels={{
          title:
            surface === undefined
              ? t('auth.signIn.title', 'Welcome back')
              : t('auth.signIn.submit', 'Sign in'),
          ...(surface === undefined
            ? { subtitle: t('auth.signIn.subtitle', 'Sign in to your Adminium workspace.') }
            : {}),
          email: t('auth.signIn.email', 'Email'),
          password: t('auth.signIn.password', 'Password'),
          forgot: t('auth.signIn.forgot', 'Forgot?'),
          remember:
            surface === undefined
              ? t('auth.signIn.remember', 'Keep me signed in')
              : t('auth.staff.remember', 'Keep me signed in on this tablet'),
          submit: t('auth.signIn.submit', 'Sign in'),
          emailInvalid: t('auth.signIn.emailInvalid', 'Enter a valid email address.'),
          passwordRequired: t('auth.signIn.passwordRequired', 'Enter your password.'),
          showPassword: t('auth.signIn.showPassword', 'Show password'),
          hidePassword: t('auth.signIn.hidePassword', 'Hide password'),
        }}
        // Ticked, as both sign-in comps draw it — and the cookie every sign-in
        // got before the box did anything.
        defaultRemember
        loading={loading}
        error={error}
        onForgotPassword={() => void router.navigate({ to: '/forgot' })}
        onSubmit={(values) => {
          setLoading(true);
          setError(null);
          login(values.email, values.password, values.remember)
            .then((result) => {
              if (result.kind === 'challenge') {
                storeChallenge(result.challengeToken, returnTo, next);
                void router.navigate({ to: '/otp' });
                return;
              }
              finish(returnTo, result.user.name);
            })
            .catch((cause: unknown) => {
              setLoading(false);
              const staff = surface !== undefined;
              if (cause instanceof ApiError && cause.status === 401) {
                setError(
                  staff
                    ? t('auth.staff.invalid', 'We couldn’t sign you in. Check your email and password, then try again.')
                    : t('auth.signIn.invalid', 'Invalid email or password.'),
                );
              } else if (cause instanceof ApiError && cause.status === 429) {
                // The real window: five tries a minute.
                setError(
                  staff
                    ? t('auth.staff.rateLimited', 'Too many tries. Try again in a minute.')
                    : t('auth.signIn.rateLimited', 'Too many attempts — try again in a minute.'),
                );
              } else {
                setError(
                  staff
                    ? t('auth.staff.offline', 'Can’t reach {app}. Check the network.', { app: surface.appName })
                    : t('auth.signIn.failed', 'Sign-in failed. Check your connection and try again.'),
                );
              }
            });
        }}
      />
    </AuthScreenLayout>
  );
}
