import { Eye, EyeOff, Lock, Mail } from 'lucide-react';
import { useId, useState } from 'react';
import type { ComponentPropsWithRef, FormEvent, ReactNode } from 'react';

import { cn } from '../../lib/cn.js';
import { Alert } from '../alert/index.js';
import { Button } from '../button/index.js';
import { Checkbox } from '../checkbox/index.js';
import { Divider } from '../divider/index.js';
import { FormField } from '../form-field/index.js';
import { IconButton } from '../icon-button/index.js';
import { InputGroup } from '../input-group/index.js';

/** Payload emitted by `SignInForm.onSubmit`. */
export interface SignInFormValues {
  email: string;
  password: string;
  /** "Keep me signed in" checkbox state (session length is a server concern). */
  remember: boolean;
}

/** All user-visible strings (required — i18n). */
export interface SignInFormLabels {
  /** Heading, e.g. "Welcome back". */
  title: ReactNode;
  /** Muted copy under the heading. */
  subtitle?: ReactNode | undefined;
  email: string;
  password: string;
  /** "Forgot?" link next to the password label. */
  forgot: string;
  /** "Keep me signed in". */
  remember: string;
  submit: string;
  /** Field error for a missing/malformed email. */
  emailInvalid: string;
  /** Field error for an empty password. */
  passwordRequired: string;
  /** Reveal-eye accessible names. */
  showPassword: string;
  hidePassword: string;
  /** Divider text between the SSO slot and the fields ("or"). */
  dividerLabel?: string | undefined;
}

export interface SignInFormProps
  extends Omit<ComponentPropsWithRef<'form'>, 'style' | 'onSubmit' | 'onError' | 'title'> {
  labels: SignInFormLabels;
  /** Fires with the validated credentials — the host app calls the API. */
  onSubmit: (values: SignInFormValues) => void;
  /** "Forgot?" link handler (navigates to the forgot-password screen). */
  onForgotPassword?: (() => void) | undefined;
  /**
   * Server-side failure banner slot (e.g. "Invalid email or password").
   * Rendered as a danger `Alert` with `role="alert"`.
   */
  error?: ReactNode;
  /** Request in flight: submit shows a spinner, all fields disable. */
  loading?: boolean | undefined;
  /** SSO buttons slot rendered above the fields with an `or` divider. */
  sso?: ReactNode;
  /** Slot under the submit button ("New to Adminium? Create an account"). */
  footer?: ReactNode;
  defaultEmail?: string | undefined;
  /** Initial "Keep me signed in" state. Default false (unchecked). */
  defaultRemember?: boolean | undefined;
}

const looksLikeEmail = (value: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

/**
 * SignInForm — email + password screen per designs/Login.dc.html. Controlled
 * composition: zero fetching; the host app owns the request and feeds back
 * `error`/`loading`.
 *
 * Endpoint contract (apps/server/src/routes/auth):
 * `POST /api/v1/auth/login` with `{ email, password }` →
 * - `200 { data: { user } }` — session cookie set, navigate into the app;
 * - `202 { data: { twoFactorRequired: true, challengeToken } }` — render
 *   `TwoFactorForm` and present the token at `/api/v1/auth/2fa/verify`;
 * - `401 INVALID_CREDENTIALS` / `429` (5/min bucket) — pass a message via
 *   `error`.
 */
export function SignInForm({
  labels,
  onSubmit,
  onForgotPassword,
  error,
  loading = false,
  sso,
  footer,
  defaultEmail,
  defaultRemember = false,
  className,
  ...props
}: SignInFormProps) {
  const [email, setEmail] = useState(defaultEmail ?? '');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(defaultRemember);
  const [reveal, setReveal] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});
  const rememberId = useId();

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextErrors: { email?: string; password?: string } = {};
    if (!looksLikeEmail(email.trim())) nextErrors.email = labels.emailInvalid;
    if (password.length === 0) nextErrors.password = labels.passwordRequired;
    setFieldErrors(nextErrors);
    if (nextErrors.email !== undefined || nextErrors.password !== undefined) return;
    onSubmit({ email: email.trim(), password, remember });
  };

  return (
    <form
      noValidate
      data-part="sign-in-form"
      className={cn('flex w-full flex-col', className)}
      onSubmit={handleSubmit}
      {...props}
    >
      <h1 className="text-[23px] font-extrabold tracking-[-0.02em] text-fg">{labels.title}</h1>
      {labels.subtitle === undefined ? null : (
        <p className="mt-1.5 text-[13.5px] text-fg-muted">{labels.subtitle}</p>
      )}

      {sso === undefined ? null : (
        <>
          <div className="mt-6 flex flex-col gap-2.5">{sso}</div>
          <Divider label={labels.dividerLabel} className="my-5" />
        </>
      )}

      {error === undefined || error === null ? null : (
        <Alert tone="danger" role="alert" title={error} className={sso === undefined ? 'mt-6' : ''} />
      )}

      <div className={cn('flex flex-col gap-4', sso === undefined && (error === undefined || error === null) ? 'mt-6' : 'mt-4')}>
        <FormField label={labels.email} error={fieldErrors.email}>
          <InputGroup
            type="email"
            name="email"
            autoComplete="email"
            iconLeading={<Mail />}
            value={email}
            disabled={loading}
            onChange={(event) => setEmail(event.target.value)}
          />
        </FormField>

        <FormField
          label={labels.password}
          error={fieldErrors.password}
          tag={
            onForgotPassword === undefined ? undefined : (
              <Button variant="link" className="text-[12px] font-bold" onClick={onForgotPassword}>
                {labels.forgot}
              </Button>
            )
          }
        >
          <InputGroup
            type={reveal ? 'text' : 'password'}
            name="password"
            autoComplete="current-password"
            iconLeading={<Lock />}
            value={password}
            disabled={loading}
            onChange={(event) => setPassword(event.target.value)}
            trailing={
              <IconButton
                size="sm"
                label={reveal ? labels.hidePassword : labels.showPassword}
                aria-pressed={reveal}
                onClick={() => setReveal((current) => !current)}
                className="text-fg-subtle [&_svg]:size-4"
              >
                {reveal ? <EyeOff /> : <Eye />}
              </IconButton>
            }
          />
        </FormField>

        <div className="flex items-center gap-2">
          <Checkbox
            id={rememberId}
            checked={remember}
            disabled={loading}
            onCheckedChange={(state) => setRemember(state === true)}
          />
          <label htmlFor={rememberId} className="cursor-pointer text-body-sm text-fg-muted">
            {labels.remember}
          </label>
        </div>

        <Button type="submit" loading={loading} className="w-full">
          {labels.submit}
        </Button>
      </div>

      {footer === undefined ? null : (
        <div data-part="sign-in-footer" className="mt-5 text-center text-body-sm text-fg-muted">
          {footer}
        </div>
      )}
    </form>
  );
}
