/**
 * `/reset/$token` — ResetPasswordForm → POST /api/v1/auth/password/reset.
 * Expired/consumed tokens route to the `expired-link` system state (§6.1).
 */
import { useParams, useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import { ResetPasswordForm } from '@adminium/ui';

import { ApiError } from '../app/api.js';
import { t } from '../i18n/t.js';
import { AuthScreenLayout } from './AuthScreenLayout.js';
import { resetPassword } from './authApi.js';

export function ResetPage() {
  const router = useRouter();
  const { token } = useParams({ from: '/reset/$token' });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  return (
    <AuthScreenLayout>
      <ResetPasswordForm
        labels={{
          title: t('auth.reset.title', 'Set a new password'),
          subtitle: t('auth.reset.subtitle', 'Must be at least 8 characters.'),
          password: t('auth.reset.password', 'New password'),
          confirmPassword: t('auth.reset.confirm', 'Confirm password'),
          submit: t('auth.reset.submit', 'Reset password'),
          tooShort: t('auth.reset.tooShort', 'Use at least 8 characters.'),
          mismatch: t('auth.reset.mismatch', "Passwords don't match."),
          strength: t('auth.reset.strength', 'Password strength'),
          strengthLabels: [
            t('auth.reset.weak', 'Weak'),
            t('auth.reset.fair', 'Fair'),
            t('auth.reset.good', 'Good'),
            t('auth.reset.strong', 'Strong'),
          ],
          showPassword: t('auth.reset.showPassword', 'Show password'),
          hidePassword: t('auth.reset.hidePassword', 'Hide password'),
        }}
        loading={loading}
        error={error}
        onSubmit={(values) => {
          setLoading(true);
          setError(null);
          resetPassword(token, values.password)
            .then(() => void router.navigate({ to: '/login' }))
            .catch((cause: unknown) => {
              setLoading(false);
              if (cause instanceof ApiError && (cause.status === 400 || cause.status === 401 || cause.status === 404)) {
                // Consumed/expired token → the dedicated system state.
                void router.navigate({ to: '/state/$stateId', params: { stateId: 'expired-link' } });
              } else {
                setError(t('auth.reset.failed', 'Reset failed. Try again.'));
              }
            });
        }}
      />
    </AuthScreenLayout>
  );
}
