import type { Meta, StoryObj } from '@storybook/react-vite';
import { Github, Hexagon, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import type { ReactNode } from 'react';

import { AuthLayout, AuthTestimonial } from '../auth-layout/index.js';
import { Avatar } from '../avatar/index.js';
import { Button } from '../button/index.js';
import { ForgotPasswordForm, ForgotSentState } from './ForgotPasswordForm.js';
import type { ForgotPasswordFormLabels } from './ForgotPasswordForm.js';
import { ResetPasswordForm } from './ResetPasswordForm.js';
import type { ResetPasswordFormLabels } from './ResetPasswordForm.js';
import { SignInForm } from './SignInForm.js';
import type { SignInFormLabels } from './SignInForm.js';
import { TwoFactorForm } from './TwoFactorForm.js';
import type { TwoFactorFormLabels } from './TwoFactorForm.js';

const meta = {
  title: 'Tier5/AuthScreens',
  parameters: { layout: 'fullscreen' },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// --- fixtures ---------------------------------------------------------------

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
  dividerLabel: 'or',
};

const twoFactorLabels: TwoFactorFormLabels = {
  title: 'Two-factor authentication',
  subtitle: 'Enter the 6-digit code from your authenticator app.',
  code: 'One-time code',
  recoveryCode: 'Recovery code',
  recoveryPlaceholder: 'xxxxx-xxxxx',
  submit: 'Verify & continue',
  useRecoveryCode: 'Lost your device? Use a recovery code',
  useAuthenticator: 'Use your authenticator app instead',
};

const forgotLabels: ForgotPasswordFormLabels = {
  title: 'Reset your password',
  subtitle: "Enter your email and we'll send you a link to reset it.",
  email: 'Email',
  emailPlaceholder: 'you@company.com',
  submit: 'Send reset link',
  back: 'Back to sign in',
  emailInvalid: 'Enter a valid email address.',
};

const resetLabels: ResetPasswordFormLabels = {
  title: 'Set a new password',
  subtitle: 'Must be at least 8 characters.',
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

function Shell({ children }: { children: ReactNode }) {
  return (
    <AuthLayout
      logo={
        <span className="flex items-center gap-2.5">
          <span className="flex size-[34px] items-center justify-center rounded-md bg-white/15">
            <Hexagon className="size-[19px]" />
          </span>
          <span className="text-[18px] font-extrabold tracking-[-0.02em]">Adminium</span>
        </span>
      }
      headline={<span className="block max-w-[15ch]">Turn any database into a dashboard.</span>}
      description="Connect Postgres, auto-generate admin panels, and ship internal tools in minutes."
      testimonial={
        <AuthTestimonial
          quote={'"We replaced three internal tools with Adminium in a weekend."'}
          name="Dana K"
          role="Head of Eng, Northwind"
          avatar={<Avatar name="Dana K" size="lg" />}
        />
      }
      trustBadges={
        <>
          <span>SOC 2 Type II</span>
          <span aria-hidden="true">·</span>
          <span>GDPR</span>
          <span aria-hidden="true">·</span>
          <span>99.99% uptime</span>
        </>
      }
      footer={
        <>
          <ShieldCheck aria-hidden="true" />
          Protected by enterprise-grade encryption
        </>
      }
    >
      {children}
    </AuthLayout>
  );
}

const ssoButtons = (
  <>
    <Button variant="secondary" className="w-full font-bold">
      <span
        aria-hidden="true"
        className="size-[18px] shrink-0 rounded-full bg-[conic-gradient(from_-45deg,#ea4335,#fbbc05,#34a853,#4285f4,#ea4335)]"
      />
      Continue with Google
    </Button>
    <Button variant="secondary" className="w-full font-bold" iconLeft={<Github className="size-4" />}>
      Continue with GitHub
    </Button>
  </>
);

const signUpFooter = (
  <>
    Don&apos;t have an account?{' '}
    <Button variant="link" className="text-body-sm font-bold">
      Sign up
    </Button>
  </>
);

// --- stories ----------------------------------------------------------------

export const SignIn: Story = {
  tags: ['vrt'],
  render: () => (
    <Shell>
      <SignInForm
        labels={signInLabels}
        sso={ssoButtons}
        footer={signUpFooter}
        onSubmit={() => {}}
        onForgotPassword={() => {}}
      />
    </Shell>
  ),
};

export const SignInError: Story = {
  tags: ['vrt'],
  render: () => (
    <Shell>
      <SignInForm
        labels={signInLabels}
        sso={ssoButtons}
        footer={signUpFooter}
        error="Invalid email or password. Try again or reset your password."
        defaultEmail="ava@adminium.io"
        onSubmit={() => {}}
        onForgotPassword={() => {}}
      />
    </Shell>
  ),
};

export const SignInLoading: Story = {
  tags: ['vrt'],
  render: () => (
    <Shell>
      <SignInForm
        labels={signInLabels}
        sso={ssoButtons}
        loading
        defaultEmail="ava@adminium.io"
        onSubmit={() => {}}
        onForgotPassword={() => {}}
      />
    </Shell>
  ),
};

export const TwoFactorChallenge: Story = {
  tags: ['vrt'],
  render: () => (
    <Shell>
      <TwoFactorForm
        labels={twoFactorLabels}
        resendHint="Codes rotate every 30 seconds — wait for a fresh one if it was rejected."
        onSubmit={() => {}}
      />
    </Shell>
  ),
};

export const TwoFactorError: Story = {
  render: () => (
    <Shell>
      <TwoFactorForm
        labels={twoFactorLabels}
        error="That code didn't match. Enter the current code from your app."
        onSubmit={() => {}}
      />
    </Shell>
  ),
};

export const ForgotPassword: Story = {
  tags: ['vrt'],
  render: () => (
    <Shell>
      <ForgotPasswordForm
        labels={forgotLabels}
        onSubmit={() => {}}
        onBack={() => {}}
      />
    </Shell>
  ),
};

export const ForgotSent: Story = {
  tags: ['vrt'],
  render: () => (
    <Shell>
      <ForgotSentState
        title="Check your email"
        body={
          <>
            We sent a password reset link to{' '}
            <span className="font-bold text-fg">ava@adminium.io</span>. It expires in 15 minutes.
          </>
        }
        doneLabel="Back to sign in"
        onDone={() => {}}
        resendHint="Didn't get it?"
        resendLabel="Resend"
        onResend={() => {}}
      />
    </Shell>
  ),
};

export const ResetPassword: Story = {
  tags: ['vrt'],
  render: () => (
    <Shell>
      <ResetPasswordForm
        labels={resetLabels}
        onSubmit={() => {}}
      />
    </Shell>
  ),
};

/** All screens wired together — walk the full flow. */
function FlowDemo() {
  const [screen, setScreen] = useState<'signin' | '2fa' | 'forgot' | 'sent' | 'reset'>('signin');
  const [email, setEmail] = useState('ava@adminium.io');
  return (
    <Shell>
      {screen === 'signin' ? (
        <SignInForm
          labels={signInLabels}
          sso={ssoButtons}
          footer={signUpFooter}
          defaultEmail={email}
          onSubmit={() => setScreen('2fa')}
          onForgotPassword={() => setScreen('forgot')}
        />
      ) : screen === '2fa' ? (
        <TwoFactorForm labels={twoFactorLabels} onSubmit={() => setScreen('signin')} />
      ) : screen === 'forgot' ? (
        <ForgotPasswordForm
          labels={forgotLabels}
          defaultEmail={email}
          onSubmit={(values) => {
            setEmail(values.email);
            setScreen('sent');
          }}
          onBack={() => setScreen('signin')}
        />
      ) : screen === 'sent' ? (
        <ForgotSentState
          title="Check your email"
          body={
            <>
              We sent a password reset link to <span className="font-bold text-fg">{email}</span>.
              It expires in 15 minutes.
            </>
          }
          doneLabel="Open reset link"
          onDone={() => setScreen('reset')}
          resendHint="Didn't get it?"
          resendLabel="Resend"
          onResend={() => {}}
        />
      ) : (
        <ResetPasswordForm labels={resetLabels} onSubmit={() => setScreen('signin')} />
      )}
    </Shell>
  );
}

export const FullFlow: Story = { render: () => <FlowDemo /> };
