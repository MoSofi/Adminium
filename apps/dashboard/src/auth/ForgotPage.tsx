/**
 * `/forgot` — ForgotPasswordForm → POST /api/v1/auth/password/forgot. Always
 * shows the sent state on 200 (no user enumeration); resend reuses the same
 * endpoint (3/hour bucket).
 *
 * SMTP GATE (11-electron.md §8.2, email row): this is the SPA's one real email
 * send, so it is the one surface that row governs today. Without a configured
 * relay the server has nowhere to post the token — the reset mail is not
 * delayed, it does not exist — and "Check your email" would be a lie told to
 * someone locked out of their account, who would then wait for it. `designs/Empty
 * States.dc.html`'s rule is the fix: never hide, always explain.
 *
 * The explanation is deliberately NOT §8.2's "Configure SMTP to send email" +
 * link. That copy is written for an admin looking at a Send button inside the
 * app; nobody on this screen is signed in, and a link to Settings would bounce
 * them to the login they cannot get past. "When possible" is the operative
 * clause of the rule — the possible action here is asking someone who IS signed
 * in, so that is what it says.
 */
import { useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import { ForgotPasswordForm, ForgotSentState } from '@adminium/ui';

import { ApiError } from '../app/api.js';
import { emailSendGate, useCapabilities, type FeatureGate } from '../app/capabilities.js';
import { t } from '../i18n/t.js';
import { AuthScreenLayout } from './AuthScreenLayout.js';
import { forgotPassword } from './authApi.js';

/** No answer from `/system/info` ⇒ no claim about SMTP; behave as we always did. */
const ENABLED_UNTIL_WE_KNOW: FeatureGate = { enabled: true, reason: null };

export function ForgotPage() {
  const router = useRouter();
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // `/system/info` is unauthenticated precisely so pre-auth screens like this
  // one can ask.
  //
  // `resolved` IS LOAD-BEARING, and leaving it out is a bug this page had. The
  // unresolved flags say `smtpConfigured: false`, which is the right assumption
  // while the probe is in flight — but the probe can also FAIL (a 5xx from a
  // meta-store blip; the client retries twice and gives up), and then the
  // default sits there forever. Gating on the flag alone would disable password
  // reset on a perfectly healthy instance with a working relay, and tell the one
  // person who cannot get in that their admin never configured email. When we
  // could not ask, we do not answer: the form stays live, `POST
  // /auth/password/forgot` 200s the same as ever, and the user is no worse off
  // than before this gate existed.
  const { flags, resolved } = useCapabilities();
  const gate = resolved ? emailSendGate(flags) : ENABLED_UNTIL_WE_KNOW;

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
          disabled={!gate.enabled}
          {...(gate.enabled
            ? {}
            : {
                notice: t(
                  'auth.forgot.smtpUnconfigured',
                  'This Adminium has no email server configured, so it cannot send a reset link. Ask an administrator to reset your password for you.',
                ),
              })}
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
