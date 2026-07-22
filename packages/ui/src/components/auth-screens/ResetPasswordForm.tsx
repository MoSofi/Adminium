import { Eye, EyeOff, Lock, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import type { ComponentPropsWithRef, FormEvent, ReactNode } from 'react';

import { cn } from '../../lib/cn.js';
import { Alert } from '../alert/index.js';
import { Button } from '../button/index.js';
import { FormField } from '../form-field/index.js';
import { IconButton } from '../icon-button/index.js';
import { IconTile } from '../icon-tile/index.js';
import { InputGroup } from '../input-group/index.js';
import { PasswordStrength } from '../password-strength/index.js';
import type { PasswordScore } from '../password-strength/index.js';

/** Payload emitted by `ResetPasswordForm.onSubmit`. */
export interface ResetPasswordFormValues {
  password: string;
}

/** All user-visible strings (required — i18n). */
export interface ResetPasswordFormLabels {
  /** Heading, e.g. "Set a new password". */
  title: ReactNode;
  /** Muted copy, e.g. "Must be at least 8 characters." */
  subtitle?: ReactNode | undefined;
  password: string;
  confirmPassword: string;
  submit: string;
  /** Field error when the password is under `minLength`. */
  tooShort: string;
  /** Field error when the confirmation does not match. */
  mismatch: string;
  /** Accessible name for the strength meter ("Password strength"). */
  strength: string;
  /** Strength labels for scores 1–4, e.g. ['Weak','Fair','Good','Strong']. */
  strengthLabels: readonly [string, string, string, string];
  /** Reveal-eye accessible names. */
  showPassword: string;
  hidePassword: string;
}

export interface ResetPasswordFormProps
  extends Omit<ComponentPropsWithRef<'form'>, 'style' | 'onSubmit' | 'onError' | 'title'> {
  labels: ResetPasswordFormLabels;
  /** Fires with the validated new password — the host app calls the API. */
  onSubmit: (values: ResetPasswordFormValues) => void;
  /** Server-side failure banner (expired/used token …). */
  error?: ReactNode;
  /** Request in flight. */
  loading?: boolean | undefined;
  /** Minimum password length. Default 8 (server policy). */
  minLength?: number | undefined;
  /** Injectable strength scorer, forwarded to `PasswordStrength`. */
  score?: ((password: string) => PasswordScore) | undefined;
}

/**
 * ResetPasswordForm — set-a-new-password screen per Login.dc.html
 * (RESET state): password + segmented strength meter + confirm field with
 * mismatch validation. Controlled composition: zero fetching.
 *
 * Endpoint contract (apps/server/src/routes/auth):
 * `POST /api/v1/auth/password/reset` with `{ token, newPassword }` — the
 * single-use `token` comes from the emailed link (URL param) and is held by
 * the host app; this component only emits the validated password →
 * - `200 { data: { ok: true } }` — navigate to sign-in;
 * - `400/401` (expired or already-used token, password under 8 chars) —
 *   pass a message via `error`.
 */
export function ResetPasswordForm({
  labels,
  onSubmit,
  error,
  loading = false,
  minLength = 8,
  score,
  className,
  ...props
}: ResetPasswordFormProps) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [reveal, setReveal] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<{ password?: string; confirm?: string }>({});

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextErrors: { password?: string; confirm?: string } = {};
    if (password.length < minLength) nextErrors.password = labels.tooShort;
    if (confirm !== password) nextErrors.confirm = labels.mismatch;
    setFieldErrors(nextErrors);
    if (nextErrors.password !== undefined || nextErrors.confirm !== undefined) return;
    onSubmit({ password });
  };

  const revealToggle = (
    <IconButton
      size="sm"
      label={reveal ? labels.hidePassword : labels.showPassword}
      aria-pressed={reveal}
      onClick={() => setReveal((current) => !current)}
      className="text-fg-subtle [&_svg]:size-4"
    >
      {reveal ? <EyeOff /> : <Eye />}
    </IconButton>
  );

  return (
    <form
      noValidate
      data-part="reset-password-form"
      className={cn('flex w-full flex-col', className)}
      onSubmit={handleSubmit}
      {...props}
    >
      <IconTile tone="accent" size="lg" icon={<ShieldCheck />} />
      <h1 className="mt-4 text-[23px] font-extrabold tracking-[-0.02em] text-fg">{labels.title}</h1>
      {labels.subtitle === undefined ? null : (
        <p className="mt-1.5 text-[13.5px] text-fg-muted">{labels.subtitle}</p>
      )}

      {error === undefined || error === null ? null : (
        <Alert tone="danger" role="alert" title={error} className="mt-4" />
      )}

      <div className="mt-6 flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <FormField label={labels.password} error={fieldErrors.password}>
            <InputGroup
              type={reveal ? 'text' : 'password'}
              name="new-password"
              autoComplete="new-password"
              iconLeading={<Lock />}
              value={password}
              disabled={loading}
              onChange={(event) => setPassword(event.target.value)}
              trailing={revealToggle}
            />
          </FormField>
          <PasswordStrength
            value={password}
            label={labels.strength}
            labels={labels.strengthLabels}
            {...(score === undefined ? {} : { score })}
          />
        </div>

        <FormField label={labels.confirmPassword} error={fieldErrors.confirm}>
          <InputGroup
            type={reveal ? 'text' : 'password'}
            name="confirm-password"
            autoComplete="new-password"
            iconLeading={<Lock />}
            value={confirm}
            disabled={loading}
            onChange={(event) => setConfirm(event.target.value)}
          />
        </FormField>

        <Button type="submit" loading={loading} className="w-full">
          {labels.submit}
        </Button>
      </div>
    </form>
  );
}
