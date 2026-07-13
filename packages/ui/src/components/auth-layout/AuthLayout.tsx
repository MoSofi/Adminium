import type { ComponentPropsWithRef, ReactNode } from 'react';

import { cn } from '../../lib/cn.js';

/**
 * The brand-panel accent gradient from designs/Login.dc.html /
 * designs/Auth & Onboarding.dc.html: `linear-gradient(155deg, accent,
 * color-mix(accent 62%, black))`. A static class over token vars, so it
 * follows every accent palette at runtime.
 */
const brandGradientClass =
  'bg-accent bg-[linear-gradient(155deg,var(--accent),color-mix(in_srgb,var(--accent)_62%,#000))]';

export interface AuthLayoutProps extends Omit<ComponentPropsWithRef<'div'>, 'style'> {
  /**
   * `split` (default) renders the 44% brand panel + form side per
   * designs/Login.dc.html; `single` renders only the centered 380px form
   * column (narrow contexts: modals, Electron sign-in, mobile web).
   */
  variant?: 'split' | 'single' | undefined;
  /** Logo block pinned to the top of the brand panel (brand tile + wordmark). */
  logo?: ReactNode;
  /** Brand headline ("Turn any database into a dashboard."). */
  headline?: ReactNode;
  /** Supporting copy under the headline. */
  description?: ReactNode;
  /** Extra brand content under the description (feature checklist, …). */
  brandContent?: ReactNode;
  /** Testimonial card slot (see `AuthTestimonial`). */
  testimonial?: ReactNode;
  /** Trust badges slot pinned to the bottom ("SOC 2 Type II · GDPR · …"). */
  trustBadges?: ReactNode;
  /** Corner slot on the form side (theme toggle IconButton). */
  corner?: ReactNode;
  /** Centered caption under the form card ("Protected by …"). */
  footer?: ReactNode;
  /** The auth screen (SignInForm, TwoFactorForm, …) — capped at 380px. */
  children: ReactNode;
}

/**
 * AuthLayout — Tier-5 auth shell (research/design-system.md §3 Tier 5,
 * designs/Login.dc.html + designs/Auth & Onboarding.dc.html): split
 * brand panel with the accent gradient, logo block, testimonial + trust-badge
 * slots, and a 380px form column. The brand panel is purely decorative
 * marketing surface: it is `aria-hidden`, collapses away below `lg`, and the
 * layout uses logical flow only, so RTL mirrors for free.
 */
export function AuthLayout({
  variant = 'split',
  logo,
  headline,
  description,
  brandContent,
  testimonial,
  trustBadges,
  corner,
  footer,
  className,
  children,
  ...props
}: AuthLayoutProps) {
  return (
    <div
      data-part="auth-layout"
      data-variant={variant}
      className={cn('flex min-h-dvh w-full bg-bg text-fg', className)}
      {...props}
    >
      {variant === 'split' ? (
        <div
          data-part="auth-brand-panel"
          aria-hidden="true"
          className={cn(
            'hidden w-[44%] shrink-0 select-none flex-col justify-between gap-10 overflow-hidden p-11 text-white lg:flex',
            brandGradientClass,
          )}
        >
          <div data-part="auth-brand-logo">{logo}</div>
          <div className="flex max-w-[440px] flex-col items-start">
            {headline === undefined ? null : (
              <div className="text-[32px] font-extrabold leading-[1.15] tracking-[-0.03em]">
                {headline}
              </div>
            )}
            {description === undefined ? null : (
              <div className="mt-4 max-w-[40ch] text-[15px] leading-relaxed text-white/80">
                {description}
              </div>
            )}
            {brandContent === undefined ? null : <div className="mt-7 w-full">{brandContent}</div>}
            {testimonial === undefined ? null : (
              <div data-part="auth-testimonial-slot" className="mt-7 w-full">
                {testimonial}
              </div>
            )}
          </div>
          {trustBadges === undefined ? (
            <div />
          ) : (
            <div
              data-part="auth-trust-badges"
              className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-white/60"
            >
              {trustBadges}
            </div>
          )}
        </div>
      ) : null}

      <div className="relative flex min-w-0 flex-1 flex-col items-center justify-center p-6 sm:p-10">
        {corner === undefined ? null : (
          <div data-part="auth-corner" className="absolute end-6 top-6">
            {corner}
          </div>
        )}
        <main data-part="auth-form-column" className="w-full max-w-[380px]">
          {children}
          {footer === undefined ? null : (
            <div
              data-part="auth-footer"
              className="mt-7 flex items-center justify-center gap-1.5 text-center text-caption text-fg-subtle [&_svg]:size-3.5"
            >
              {footer}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

export interface AuthTestimonialProps
  extends Omit<ComponentPropsWithRef<'figure'>, 'style' | 'role'> {
  /** Quote body (already-quoted copy per the comp). */
  quote: ReactNode;
  /** Attribution name ("Dana K"). */
  name: ReactNode;
  /** Attribution role/company ("Head of Eng, Northwind"). */
  role?: ReactNode;
  /** Leading avatar element (e.g. an `Avatar`). */
  avatar?: ReactNode;
}

/**
 * AuthTestimonial — the translucent testimonial card that lives on the
 * AuthLayout brand panel (designs/Login.dc.html): white/10 card, quote,
 * attribution line. Colors are fixed white alphas because the card always
 * sits on the accent gradient.
 */
export function AuthTestimonial({
  quote,
  name,
  role,
  avatar,
  className,
  ...props
}: AuthTestimonialProps) {
  return (
    <figure
      data-part="auth-testimonial"
      className={cn(
        'flex max-w-[40ch] items-center gap-3 rounded-lg border border-white/15 bg-white/10 p-4',
        className,
      )}
      {...props}
    >
      {avatar === undefined ? null : <div className="shrink-0">{avatar}</div>}
      <div className="min-w-0">
        <blockquote className="text-[12.5px] leading-normal text-white/90">{quote}</blockquote>
        <figcaption className="mt-1 text-caption text-white/60">
          {name}
          {role === undefined ? null : <> · {role}</>}
        </figcaption>
      </div>
    </figure>
  );
}
