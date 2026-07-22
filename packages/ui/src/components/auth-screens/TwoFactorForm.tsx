import { ShieldCheck } from 'lucide-react';
import { useId, useState } from 'react';
import type { ComponentPropsWithRef, FormEvent, ReactNode } from 'react';

import { cn } from '../../lib/cn.js';
import { Alert } from '../alert/index.js';
import { Button } from '../button/index.js';
import { FormField } from '../form-field/index.js';
import { IconTile } from '../icon-tile/index.js';
import { Input } from '../input/index.js';
import { OtpInput } from '../otp-input/index.js';

/** Payload emitted by `TwoFactorForm.onSubmit`. */
export interface TwoFactorFormValues {
  /** 6-digit TOTP or a recovery code (`xxxxx-xxxxx`), per the active method. */
  code: string;
  method: 'totp' | 'recovery';
}

/** All user-visible strings (required — i18n). */
export interface TwoFactorFormLabels {
  /** Heading, e.g. "Two-factor authentication". */
  title: ReactNode;
  /** Muted copy, e.g. "Enter the 6-digit code from your authenticator app." */
  subtitle?: ReactNode | undefined;
  /** Accessible name for the OTP input ("One-time code"). */
  code: string;
  /** Recovery-code field label. */
  recoveryCode: string;
  /** Recovery-code placeholder, e.g. "xxxxx-xxxxx". */
  recoveryPlaceholder?: string | undefined;
  submit: string;
  /** Toggle link: "Lost your device? Use a recovery code". */
  useRecoveryCode: string;
  /** Toggle link back to the authenticator code. */
  useAuthenticator: string;
}

export interface TwoFactorFormProps
  extends Omit<ComponentPropsWithRef<'form'>, 'style' | 'onSubmit' | 'onError' | 'title'> {
  labels: TwoFactorFormLabels;
  /** Fires with the entered code — the host app calls the API. */
  onSubmit: (values: TwoFactorFormValues) => void;
  /** Rejected-code banner (danger `Alert`, `role="alert"`) + invalid OTP cells. */
  error?: ReactNode;
  /** Request in flight. */
  loading?: boolean | undefined;
  /** Hint slot under the form ("Didn't get a push? …" / resend copy). */
  resendHint?: ReactNode;
  /** OTP length. Default 6. */
  length?: number | undefined;
  /** Submit automatically when all OTP cells are filled. Default true. */
  autoSubmit?: boolean | undefined;
}

/**
 * TwoFactorForm — the 2FA step-up challenge per Auth &
 * Onboarding.dc.html: invisible-input OTP over 6 cells, with a toggle to a
 * recovery-code input. Controlled composition: zero fetching.
 *
 * Endpoint contract (apps/server/src/routes/auth):
 * `POST /api/v1/auth/2fa/verify` with `{ challengeToken, code }` — the
 * `challengeToken` comes from the preceding login 202 response and is held by
 * the host app; this component only emits `code` (TOTP or recovery code) →
 * - `200 { data: { user } }` — session established;
 * - `401` (wrong/expired code, 5/min bucket) — pass a message via `error`.
 */
export function TwoFactorForm({
  labels,
  onSubmit,
  error,
  loading = false,
  resendHint,
  length = 6,
  autoSubmit = true,
  className,
  ...props
}: TwoFactorFormProps) {
  const [method, setMethod] = useState<'totp' | 'recovery'>('totp');
  const [code, setCode] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const subtitleId = useId();

  const value = method === 'totp' ? code : recoveryCode.trim();
  const ready = method === 'totp' ? code.length === length : recoveryCode.trim().length > 0;
  const hasError = error !== undefined && error !== null;

  const submit = (submittedCode: string) => {
    if (loading) return;
    onSubmit({ code: submittedCode, method });
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!ready) return;
    submit(value);
  };

  const toggleMethod = () => {
    setMethod((current) => (current === 'totp' ? 'recovery' : 'totp'));
  };

  return (
    <form
      noValidate
      data-part="two-factor-form"
      data-method={method}
      className={cn('flex w-full flex-col', className)}
      onSubmit={handleSubmit}
      {...props}
    >
      <IconTile tone="accent" size="lg" icon={<ShieldCheck />} />
      <h1 className="mt-4 text-[22px] font-extrabold tracking-[-0.02em] text-fg">{labels.title}</h1>
      {labels.subtitle === undefined ? null : (
        <p id={subtitleId} className="mt-1.5 text-[13.5px] text-fg-muted">
          {labels.subtitle}
        </p>
      )}

      {hasError ? <Alert tone="danger" role="alert" title={error} className="mt-4" /> : null}

      <div className="mt-6 flex flex-col gap-4">
        {method === 'totp' ? (
          <OtpInput
            length={length}
            label={labels.code}
            describedBy={labels.subtitle === undefined ? undefined : subtitleId}
            value={code}
            onChange={setCode}
            invalid={hasError}
            disabled={loading}
            autoFocus
            className="justify-between"
            {...(autoSubmit ? { onComplete: submit } : {})}
          />
        ) : (
          <FormField label={labels.recoveryCode}>
            <Input
              mono
              autoFocus
              autoComplete="off"
              spellCheck={false}
              placeholder={labels.recoveryPlaceholder}
              value={recoveryCode}
              disabled={loading}
              error={hasError}
              onChange={(event) => setRecoveryCode(event.target.value)}
            />
          </FormField>
        )}

        <Button type="submit" loading={loading} disabled={!ready} className="w-full">
          {labels.submit}
        </Button>
      </div>

      <div className="mt-5 text-center text-body-sm text-fg-muted">
        <Button variant="link" className="text-body-sm font-bold" onClick={toggleMethod}>
          {method === 'totp' ? labels.useRecoveryCode : labels.useAuthenticator}
        </Button>
      </div>

      {resendHint === undefined ? null : (
        <div data-part="two-factor-resend-hint" className="mt-3 text-center text-caption text-fg-subtle">
          {resendHint}
        </div>
      )}
    </form>
  );
}
