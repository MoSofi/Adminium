// SPDX-License-Identifier: AGPL-3.0-only
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ForgotPasswordForm, ForgotSentState } from './ForgotPasswordForm.js';
import type { ForgotPasswordFormLabels } from './ForgotPasswordForm.js';
import { ResetPasswordForm } from './ResetPasswordForm.js';
import type { ResetPasswordFormLabels } from './ResetPasswordForm.js';
import { SignInForm } from './SignInForm.js';
import type { SignInFormLabels } from './SignInForm.js';
import { TwoFactorForm } from './TwoFactorForm.js';
import type { TwoFactorFormLabels } from './TwoFactorForm.js';

afterEach(cleanup);

const signInLabels: SignInFormLabels = {
  title: 'Welcome back',
  subtitle: 'Sign in to your Adminium workspace.',
  email: 'Email',
  password: 'Password',
  forgot: 'Forgot?',
  remember: 'Keep me signed in',
  submit: 'Sign in',
  emailInvalid: 'Enter a valid email address.',
  passwordRequired: 'Enter your password.',
  showPassword: 'Show password',
  hidePassword: 'Hide password',
};

describe('SignInForm', () => {
  it('renders accessible fields and heading', () => {
    render(<SignInForm labels={signInLabels} onSubmit={() => {}} />);
    expect(screen.getByRole('heading', { name: 'Welcome back' })).toBeDefined();
    expect(screen.getByLabelText('Email')).toBeDefined();
    expect(screen.getByLabelText('Password')).toBeDefined();
    expect(screen.getByLabelText('Keep me signed in')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeDefined();
  });

  it('validates instead of submitting on bad input', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<SignInForm labels={signInLabels} onSubmit={onSubmit} />);
    await user.type(screen.getByLabelText('Email'), 'not-an-email');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText('Enter a valid email address.')).toBeDefined();
    expect(screen.getByText('Enter your password.')).toBeDefined();
    expect(screen.getByLabelText('Email').getAttribute('aria-invalid')).toBe('true');
  });

  it('submits the trimmed credentials payload', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<SignInForm labels={signInLabels} onSubmit={onSubmit} />);
    await user.type(screen.getByLabelText('Email'), '  ava@adminium.io  ');
    await user.type(screen.getByLabelText('Password'), 'supersecret');
    await user.click(screen.getByLabelText('Keep me signed in'));
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith({
      email: 'ava@adminium.io',
      password: 'supersecret',
      remember: true,
    });
  });

  it('shows the error banner as an alert and disables while loading', () => {
    const { rerender } = render(
      <SignInForm labels={signInLabels} onSubmit={() => {}} error="Invalid email or password." />,
    );
    expect(screen.getByRole('alert').textContent).toContain('Invalid email or password.');
    rerender(<SignInForm labels={signInLabels} onSubmit={() => {}} loading />);
    const submit = screen.getByRole('button', { name: 'Sign in' });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    expect(submit.getAttribute('aria-busy')).toBe('true');
    expect((screen.getByLabelText('Email') as HTMLInputElement).disabled).toBe(true);
  });

  it('reveal toggle flips the password input type', async () => {
    const user = userEvent.setup();
    render(<SignInForm labels={signInLabels} onSubmit={() => {}} />);
    const password = screen.getByLabelText('Password');
    expect(password.getAttribute('type')).toBe('password');
    await user.click(screen.getByRole('button', { name: 'Show password' }));
    expect(password.getAttribute('type')).toBe('text');
    expect(screen.getByRole('button', { name: 'Hide password' })).toBeDefined();
  });

  it('fires onForgotPassword from the label link', async () => {
    const user = userEvent.setup();
    const onForgotPassword = vi.fn();
    render(
      <SignInForm labels={signInLabels} onSubmit={() => {}} onForgotPassword={onForgotPassword} />,
    );
    await user.click(screen.getByRole('button', { name: 'Forgot?' }));
    expect(onForgotPassword).toHaveBeenCalledOnce();
  });
});

const twoFactorLabels: TwoFactorFormLabels = {
  title: 'Two-factor authentication',
  subtitle: 'Enter the 6-digit code from your authenticator app.',
  code: 'One-time code',
  recoveryCode: 'Recovery code',
  submit: 'Verify & continue',
  useRecoveryCode: 'Use a recovery code',
  useAuthenticator: 'Use your authenticator app',
};

describe('TwoFactorForm', () => {
  it('auto-submits the TOTP payload when all 6 cells fill', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<TwoFactorForm labels={twoFactorLabels} onSubmit={onSubmit} />);
    await user.click(screen.getByLabelText('One-time code'));
    await user.keyboard('123456');
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith({ code: '123456', method: 'totp' });
  });

  it('keeps the submit button gated until the code is complete', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<TwoFactorForm labels={twoFactorLabels} onSubmit={onSubmit} autoSubmit={false} />);
    const submit = screen.getByRole('button', { name: 'Verify & continue' });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByLabelText('One-time code'));
    await user.keyboard('987654');
    expect(onSubmit).not.toHaveBeenCalled(); // autoSubmit off
    await user.click(submit);
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith({ code: '987654', method: 'totp' });
  });

  it('recovery-code toggle switches methods and payloads', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<TwoFactorForm labels={twoFactorLabels} onSubmit={onSubmit} />);
    await user.click(screen.getByRole('button', { name: 'Use a recovery code' }));
    expect(screen.queryByLabelText('One-time code')).toBeNull();
    await user.type(screen.getByLabelText('Recovery code'), 'abcde-12345');
    await user.click(screen.getByRole('button', { name: 'Verify & continue' }));
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith({ code: 'abcde-12345', method: 'recovery' });
    // and back
    await user.click(screen.getByRole('button', { name: 'Use your authenticator app' }));
    expect(screen.getByLabelText('One-time code')).toBeDefined();
  });

  it('marks the code invalid and announces the error banner', () => {
    render(<TwoFactorForm labels={twoFactorLabels} onSubmit={() => {}} error="Wrong code." />);
    expect(screen.getByRole('alert').textContent).toContain('Wrong code.');
    expect(screen.getByLabelText('One-time code').getAttribute('aria-invalid')).toBe('true');
  });

  it('renders the resend hint slot', () => {
    const { container } = render(
      <TwoFactorForm labels={twoFactorLabels} onSubmit={() => {}} resendHint="Codes rotate." />,
    );
    expect(
      container.querySelector('[data-part="two-factor-resend-hint"]')?.textContent,
    ).toContain('Codes rotate.');
  });
});

const forgotLabels: ForgotPasswordFormLabels = {
  title: 'Reset your password',
  email: 'Email',
  submit: 'Send reset link',
  back: 'Back to sign in',
  emailInvalid: 'Enter a valid email address.',
};

describe('ForgotPasswordForm', () => {
  it('validates the email before submitting', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<ForgotPasswordForm labels={forgotLabels} onSubmit={onSubmit} />);
    await user.click(screen.getByRole('button', { name: 'Send reset link' }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText('Enter a valid email address.')).toBeDefined();
    await user.type(screen.getByLabelText('Email'), 'ava@adminium.io');
    await user.click(screen.getByRole('button', { name: 'Send reset link' }));
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith({ email: 'ava@adminium.io' });
  });

  it('renders the back link when onBack is provided', async () => {
    const user = userEvent.setup();
    const onBack = vi.fn();
    render(<ForgotPasswordForm labels={forgotLabels} onSubmit={() => {}} onBack={onBack} />);
    await user.click(screen.getByRole('button', { name: 'Back to sign in' }));
    expect(onBack).toHaveBeenCalledOnce();
  });

  /**
   * `disabled` is 11-electron.md §8.2's email row: the instance has no relay, so
   * there is no mail to wait for. It must not merely stop the click — a form
   * still submits on Enter, and a "reset link sent" that was never sent is the
   * whole failure the flag exists to prevent.
   */
  describe('disabled (no SMTP relay, §8.2)', () => {
    it('never calls onSubmit, by button or by Enter', async () => {
      const user = userEvent.setup();
      const onSubmit = vi.fn();
      render(
        <ForgotPasswordForm labels={forgotLabels} onSubmit={onSubmit} disabled defaultEmail="ava@adminium.io" />,
      );

      const submit = screen.getByRole('button', { name: 'Send reset link' });
      expect(submit.hasAttribute('disabled')).toBe(true);
      await user.click(submit);
      expect(onSubmit).not.toHaveBeenCalled();

      screen.getByLabelText('Email').focus();
      await user.keyboard('{Enter}');
      expect(onSubmit).not.toHaveBeenCalled();
    });

    it('renders the notice as guidance, not as the visitor’s error', () => {
      render(
        <ForgotPasswordForm
          labels={forgotLabels}
          onSubmit={() => {}}
          disabled
          notice="No email server is configured. Ask an administrator."
        />,
      );
      const notice = screen.getByText('No email server is configured. Ask an administrator.');
      expect(notice).toBeDefined();
      // Not `role="alert"` — an unconfigured relay is the operator's state of
      // the world, not something to interrupt a screen reader about.
      expect(notice.closest('[role="alert"]')).toBeNull();
    });

    it('leaves the form enabled and alert-free by default', () => {
      render(<ForgotPasswordForm labels={forgotLabels} onSubmit={() => {}} />);
      expect(screen.getByRole('button', { name: 'Send reset link' }).hasAttribute('disabled')).toBe(false);
    });
  });
});

/**
 * CodeQL js/polynomial-redos #19/#20. Both pre-auth screens validated the email
 * with their own copy of `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`, which ran quadratically
 * on "strings starting with '!@!.' and with many repetitions of '!.'". Nothing
 * authenticates before these screens, so that input is anonymous and unbounded.
 *
 * Both now route through the single `lib/email.ts` validator — that shared
 * module carries the acceptance table and the big-input timing proof; these two
 * assert the wiring, so a copy that drifts back into one form is caught here.
 */
describe('pre-auth email validation is not quadratic', () => {
  // 20k repetitions took the old pattern 1.3s; it is kept modest here because
  // the render around it costs more than the check does. The trailing `@` is
  // what makes the match fail (and so backtrack) — and unlike a trailing space
  // it survives the forms' own `.trim()`. `fireEvent`, not `user.type`: typing
  // 40k characters one keystroke at a time is the slow part, not the bug.
  const attack = `!@!.${'!.'.repeat(20_000)}@`;

  it('SignInForm rejects it promptly', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<SignInForm labels={signInLabels} onSubmit={onSubmit} />);

    const started = performance.now();
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: attack } });
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    const elapsed = performance.now() - started;

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText('Enter a valid email address.')).toBeDefined();
    expect(elapsed).toBeLessThan(2_000);
  });

  it('ForgotPasswordForm rejects it promptly', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<ForgotPasswordForm labels={forgotLabels} onSubmit={onSubmit} />);

    const started = performance.now();
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: attack } });
    await user.click(screen.getByRole('button', { name: 'Send reset link' }));
    const elapsed = performance.now() - started;

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText('Enter a valid email address.')).toBeDefined();
    expect(elapsed).toBeLessThan(2_000);
  });
});

describe('ForgotSentState', () => {
  it('renders the confirmation with done and resend actions', async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();
    const onResend = vi.fn();
    render(
      <ForgotSentState
        title="Check your email"
        body="We sent a link to ava@adminium.io."
        doneLabel="Back to sign in"
        onDone={onDone}
        resendHint="Didn't get it?"
        resendLabel="Resend"
        onResend={onResend}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Check your email' })).toBeDefined();
    expect(screen.getByText('We sent a link to ava@adminium.io.')).toBeDefined();
    await user.click(screen.getByRole('button', { name: 'Resend' }));
    expect(onResend).toHaveBeenCalledOnce();
    await user.click(screen.getByRole('button', { name: 'Back to sign in' }));
    expect(onDone).toHaveBeenCalledOnce();
  });
});

const resetLabels: ResetPasswordFormLabels = {
  title: 'Set a new password',
  password: 'New password',
  confirmPassword: 'Confirm password',
  submit: 'Update password',
  tooShort: 'Password must be at least 8 characters.',
  mismatch: "Passwords don't match.",
  strength: 'Password strength',
  strengthLabels: ['Weak', 'Fair', 'Good', 'Strong'],
  showPassword: 'Show password',
  hidePassword: 'Hide password',
};

describe('ResetPasswordForm', () => {
  it('rejects a password under the minimum length', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<ResetPasswordForm labels={resetLabels} onSubmit={onSubmit} />);
    await user.type(screen.getByLabelText('New password'), 'short');
    await user.type(screen.getByLabelText('Confirm password'), 'short');
    await user.click(screen.getByRole('button', { name: 'Update password' }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText('Password must be at least 8 characters.')).toBeDefined();
  });

  it('rejects a mismatched confirmation', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<ResetPasswordForm labels={resetLabels} onSubmit={onSubmit} />);
    await user.type(screen.getByLabelText('New password'), 'newpassword1');
    await user.type(screen.getByLabelText('Confirm password'), 'newpassword2');
    await user.click(screen.getByRole('button', { name: 'Update password' }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText("Passwords don't match.")).toBeDefined();
  });

  it('submits the password payload and wires the strength meter', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<ResetPasswordForm labels={resetLabels} onSubmit={onSubmit} />);
    const meter = screen.getByRole('meter', { name: 'Password strength' });
    expect(meter.getAttribute('aria-valuenow')).toBe('0');
    await user.type(screen.getByLabelText('New password'), 'newpassword1');
    expect(Number(meter.getAttribute('aria-valuenow'))).toBeGreaterThan(0);
    await user.type(screen.getByLabelText('Confirm password'), 'newpassword1');
    await user.click(screen.getByRole('button', { name: 'Update password' }));
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith({ password: 'newpassword1' });
  });

  it('reveal toggle flips both password inputs', async () => {
    const user = userEvent.setup();
    render(<ResetPasswordForm labels={resetLabels} onSubmit={() => {}} />);
    await user.click(screen.getByRole('button', { name: 'Show password' }));
    expect(screen.getByLabelText('New password').getAttribute('type')).toBe('text');
    expect(screen.getByLabelText('Confirm password').getAttribute('type')).toBe('text');
  });
});
