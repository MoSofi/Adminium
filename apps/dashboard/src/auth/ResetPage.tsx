// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `/reset/$token` — ResetPasswordForm → POST /api/v1/auth/password/reset.
 * Expired/consumed tokens route to the `expired-link` system state.
 */
import { useQuery } from '@tanstack/react-query';
import { useParams, useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import { ResetPasswordForm } from '@adminium/ui';

import { ApiError } from '../app/api.js';
import { t } from '../i18n/t.js';
import { AuthScreenLayout } from './AuthScreenLayout.js';
import { setupStateQuery } from '../setup/setupApi.js';
import { resetPassword } from './authApi.js';

/** `auth.passwordMinLength`'s registry floor: what a page that has not heard the policy yet asks for. */
const POLICY_FLOOR = 8;

export function ResetPage() {
  const router = useRouter();
  const { token } = useParams({ from: '/reset/$token' });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // The workspace's own rule (V28): this page said 8 while the default policy
  // is 10, so a 9-letter password passed here and was refused on save.
  const min = useQuery(setupStateQuery()).data?.passwordMinLength ?? POLICY_FLOOR;

  return (
    <AuthScreenLayout documentTitle={t('auth.reset.title', 'Choose a password')}>
      <ResetPasswordForm
        labels={{
          title: t('auth.reset.title', 'Choose a password'),
          subtitle: t('auth.reset.subtitle', 'Must be at least {min} characters.', { min }),
          password: t('auth.reset.password', 'Password'),
          confirmPassword: t('auth.reset.confirm', 'Confirm password'),
          submit: t('auth.reset.submit', 'Save password'),
          tooShort: t('auth.reset.tooShort', 'Use at least {min} characters.', { min }),
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
        minLength={min}
        loading={loading}
        error={error}
        onSubmit={(values) => {
          setLoading(true);
          setError(null);
          resetPassword(token, values.password)
            .then(() => void router.navigate({ to: '/login', search: { passwordSet: '1' } }))
            .catch((cause: unknown) => {
              setLoading(false);
              if (cause instanceof ApiError && (cause.status === 400 || cause.status === 401 || cause.status === 404)) {
                // Consumed/expired token → the dedicated system state.
                void router.navigate({ to: '/state/$stateId', params: { stateId: 'expired-link' } });
              } else {
                setError(t('auth.reset.failed', 'That did not save. Try again.'));
              }
            });
        }}
      />
    </AuthScreenLayout>
  );
}
