/**
 * `/forgot` — ForgotPasswordForm → POST /api/v1/auth/password/forgot. Always
 * shows the sent state on 200 (no user enumeration); resend reuses the same
 * endpoint (3/hour bucket).
 */
import { useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import { ForgotPasswordForm, ForgotSentState } from '@adminium/ui';

import { ApiError } from '../app/api.js';
import { t } from '../i18n/t.js';
import { AuthScreenLayout } from './AuthScreenLayout.js';
import { forgotPassword } from './authApi.js';

export function ForgotPage() {
  const router = useRouter();
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const toLogin = () => void router.navigate({ to: '/login' });

  const send = (email: string) => {
    setLoading(true);
    setError(null);
    forgotPassword(email)
      .then(() => {
        setLoading(false);
        setSentTo(email);
      })
      .catch((cause: unknown) => {
        setLoading(false);
        if (cause instanceof ApiError && cause.status === 429) {
          setError(t('auth.forgot.rateLimited', 'Too many requests — try again later.'));
        } else {
          setError(t('auth.forgot.failed', 'Something went wrong. Try again.'));
        }
      });
  };

  return (
    <AuthScreenLayout>
      {sentTo === null ? (
        <ForgotPasswordForm
          labels={{
            title: t('auth.forgot.title', 'Reset your password'),
            subtitle: t('auth.forgot.subtitle', "Enter your email and we'll send you a reset link."),
            email: t('auth.forgot.email', 'Email'),
            submit: t('auth.forgot.submit', 'Send reset link'),
            back: t('auth.forgot.back', 'Back to sign in'),
            emailInvalid: t('auth.forgot.emailInvalid', 'Enter a valid email address.'),
          }}
          loading={loading}
          error={error}
          onBack={toLogin}
          onSubmit={(values) => send(values.email)}
        />
      ) : (
        <ForgotSentState
          title={t('auth.forgot.sentTitle', 'Check your email')}
          body={t('auth.forgot.sentBody', `We sent a reset link to ${sentTo}. It expires in 15 minutes.`)}
          doneLabel={t('auth.forgot.done', 'Back to sign in')}
          onDone={toLogin}
          resendHint={t('auth.forgot.resendHint', "Didn't get it?")}
          resendLabel={t('auth.forgot.resend', 'Send it again')}
          onResend={() => send(sentTo)}
        />
      )}
    </AuthScreenLayout>
  );
}
