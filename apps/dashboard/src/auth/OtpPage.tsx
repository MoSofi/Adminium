/**
 * `/otp` — the 2FA step-up (TwoFactorForm → POST /api/v1/auth/2fa/verify).
 * The challenge token comes from the login 202 via sessionStorage; arriving
 * without one bounces back to `/login`.
 */
import { useRouter } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { TwoFactorForm } from '@adminium/ui';

import { ApiError } from '../app/api.js';
import { t } from '../i18n/t.js';
import { AuthScreenLayout } from './AuthScreenLayout.js';
import { clearChallenge, readChallenge, verify2fa } from './authApi.js';

export function OtpPage() {
  const router = useRouter();
  const [challenge] = useState(readChallenge);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (challenge === null) void router.navigate({ to: '/login' });
  }, [challenge, router]);

  if (challenge === null) return null;

  return (
    <AuthScreenLayout>
      <TwoFactorForm
        labels={{
          title: t('auth.otp.title', 'Two-factor authentication'),
          subtitle: t('auth.otp.subtitle', 'Enter the 6-digit code from your authenticator app.'),
          code: t('auth.otp.code', 'One-time code'),
          recoveryCode: t('auth.otp.recoveryCode', 'Recovery code'),
          recoveryPlaceholder: 'xxxxx-xxxxx',
          submit: t('auth.otp.submit', 'Verify'),
          useRecoveryCode: t('auth.otp.useRecovery', 'Lost your device? Use a recovery code'),
          useAuthenticator: t('auth.otp.useAuthenticator', 'Use your authenticator app instead'),
        }}
        loading={loading}
        error={error}
        onSubmit={(values) => {
          setLoading(true);
          setError(null);
          verify2fa(challenge.challengeToken, values.code)
            .then(() => {
              clearChallenge();
              router.options.context.queryClient.clear();
              // Runtime string target — go through history, not typed links.
              router.history.push(challenge.returnTo ?? '/');
            })
            .catch((cause: unknown) => {
              setLoading(false);
              if (cause instanceof ApiError && cause.status === 401) {
                setError(t('auth.otp.invalid', 'That code didn’t work. Try again.'));
              } else {
                setError(t('auth.otp.failed', 'Verification failed. Check your connection and try again.'));
              }
            });
        }}
      />
    </AuthScreenLayout>
  );
}
