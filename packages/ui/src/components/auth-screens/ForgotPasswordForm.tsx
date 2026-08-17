// SPDX-License-Identifier: AGPL-3.0-only
import { ArrowLeft, KeyRound, Mail, MailCheck } from 'lucide-react';
import { useState } from 'react';
import type { ComponentPropsWithRef, FormEvent, ReactNode } from 'react';

import { cn } from '../../lib/cn.js';
import { looksLikeEmail } from '../../lib/email.js';
import { Alert } from '../alert/index.js';
import { Button } from '../button/index.js';
import { FormField } from '../form-field/index.js';
import { IconTile } from '../icon-tile/index.js';
import { InputGroup } from '../input-group/index.js';
import { SuccessState } from '../success-state/index.js';

/** Payload emitted by `ForgotPasswordForm.onSubmit`. */
export interface ForgotPasswordFormValues {
  email: string;
}

/** All user-visible strings (required — i18n). */
export interface ForgotPasswordFormLabels {
  /** Heading, e.g. "Reset your password". */
  title: ReactNode;
  /** Muted copy, e.g. "Enter your email and we'll send you a link…". */
  subtitle?: ReactNode | undefined;
  email: string;
  emailPlaceholder?: string | undefined;
  submit: string;
  /** "Back to sign in" link. */
  back?: string | undefined;
  /** Field error for a missing/malformed email. */
  emailInvalid: string;
}

export interface ForgotPasswordFormProps
  extends Omit<ComponentPropsWithRef<'form'>, 'style' | 'onSubmit' | 'onError' | 'title'> {
  labels: ForgotPasswordFormLabels;
  /** Fires with the validated email — the host app calls the API. */
  onSubmit: (values: ForgotPasswordFormValues) => void;
  /** "Back to sign in" handler; renders the back link when provided. */
  onBack?: (() => void) | undefined;
  /** Server-side failure banner (danger `Alert`, `role="alert"`). */
  error?: ReactNode;
  /** Request in flight. */
  loading?: boolean | undefined;
  /**
   * The instance cannot send this mail at all — 11-electron.md §8.2's email row
   * ("Enabled only when SMTP is configured in settings; otherwise buttons
   * disabled"). Distinct from `loading`, which means "wait"; this means "not
   * from here". Pair it with {@link ForgotPasswordFormProps.notice} — a disabled
   * button with no explanation is the exact thing `Empty States.dc.html`
   * forbids.
   */
  disabled?: boolean | undefined;
  /**
   * Info `Alert` above the field: why the form is disabled, and what to do
   * instead. Not `error` — an unconfigured relay is the operator's state of the
   * world, not this visitor's mistake, and `role="alert"` would interrupt a
   * screen reader to say so.
   */
  notice?: ReactNode;
  defaultEmail?: string | undefined;
}

/**
 * ForgotPasswordForm — request-a-reset-link screen per
 * Login.dc.html (FORGOT state). Controlled composition: zero
 * fetching. On success the host swaps in `ForgotSentState`.
 *
 * Endpoint contract (apps/server/src/routes/auth):
 * `POST /api/v1/auth/password/forgot` with `{ email }` → always
 * `200 { data: { ok: true } }` (no user enumeration — show the sent state
 * regardless); `429` (3/hour bucket) — pass a message via `error`.
 */
export function ForgotPasswordForm({
  labels,
  onSubmit,
  onBack,
  error,
  loading = false,
  disabled = false,
  notice,
  defaultEmail,
  className,
  ...props
}: ForgotPasswordFormProps) {
  const [email, setEmail] = useState(defaultEmail ?? '');
  const [fieldError, setFieldError] = useState<string | undefined>(undefined);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    // Belt and braces: the button is disabled, but a form still submits on
    // Enter in some browsers, and this must not raise a "check your email" for
    // mail that has nowhere to go.
    if (disabled) return;
    if (!looksLikeEmail(email.trim())) {
      setFieldError(labels.emailInvalid);
      return;
    }
    setFieldError(undefined);
    onSubmit({ email: email.trim() });
  };

  return (
    <form
      noValidate
      data-part="forgot-password-form"
      className={cn('flex w-full flex-col', className)}
      onSubmit={handleSubmit}
      {...props}
    >
      {onBack === undefined || labels.back === undefined ? null : (
        <Button
          variant="link"
          onClick={onBack}
          iconLeft={<ArrowLeft className="size-3.5 rtl:rotate-180" />}
          className="mb-5 self-start text-body-sm font-bold text-fg-muted hover:text-accent"
        >
          {labels.back}
        </Button>
      )}

      <IconTile tone="accent" size="lg" icon={<KeyRound />} />
      <h1 className="mt-4 text-[23px] font-extrabold tracking-[-0.02em] text-fg">{labels.title}</h1>
      {labels.subtitle === undefined ? null : (
        <p className="mt-1.5 text-[13.5px] leading-relaxed text-fg-muted">{labels.subtitle}</p>
      )}

      {error === undefined || error === null ? null : (
        <Alert tone="danger" role="alert" title={error} className="mt-4" />
      )}

      {notice === undefined || notice === null ? null : (
        <Alert tone="info" title={notice} className="mt-4" />
      )}

      <div className="mt-6 flex flex-col gap-4">
        <FormField label={labels.email} error={fieldError}>
          <InputGroup
            type="email"
            name="email"
            autoComplete="email"
            iconLeading={<Mail />}
            placeholder={labels.emailPlaceholder}
            value={email}
            disabled={loading || disabled}
            onChange={(event) => setEmail(event.target.value)}
          />
        </FormField>
        <Button type="submit" loading={loading} disabled={disabled} className="w-full">
          {labels.submit}
        </Button>
      </div>
    </form>
  );
}

export interface ForgotSentStateProps
  extends Omit<ComponentPropsWithRef<'div'>, 'style' | 'title'> {
  /** Heading, e.g. "Check your email". */
  title: ReactNode;
  /** Copy echoing the address ("We sent a reset link to ava@… It expires in 15 minutes."). */
  body?: ReactNode;
  /** Primary button label ("Back to sign in"). */
  doneLabel: string;
  onDone?: (() => void) | undefined;
  /** Resend link line ("Didn't get it?" + link). */
  resendLabel?: string | undefined;
  onResend?: (() => void) | undefined;
  /** Muted prefix before the resend link ("Didn't get it?"). */
  resendHint?: ReactNode;
}

/**
 * ForgotSentState — the SENT confirmation from Login.dc.html,
 * reusing `SuccessState` (pos mail-check tile + heading + copy + Done) with a
 * resend link line. Re-submitting hits the same
 * `POST /api/v1/auth/password/forgot` endpoint (3/hour rate bucket).
 */
export function ForgotSentState({
  title,
  body,
  doneLabel,
  onDone,
  resendLabel,
  onResend,
  resendHint,
  className,
  ...props
}: ForgotSentStateProps) {
  return (
    <div data-part="forgot-sent-state" className={cn('flex w-full flex-col', className)} {...props}>
      <SuccessState
        title={title}
        body={body}
        doneLabel={doneLabel}
        onDone={onDone}
        icon={<MailCheck />}
        className="px-0 py-0"
      />
      {resendLabel === undefined || onResend === undefined ? null : (
        <p className="mt-4 text-center text-body-sm text-fg-muted">
          {resendHint === undefined ? null : <>{resendHint} </>}
          <Button variant="link" className="text-body-sm font-bold" onClick={onResend}>
            {resendLabel}
          </Button>
        </p>
      )}
    </div>
  );
}
