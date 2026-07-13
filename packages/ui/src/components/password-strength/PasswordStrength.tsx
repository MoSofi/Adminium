import type { ComponentPropsWithRef } from 'react';

import { cn } from '../../lib/cn.js';

/** 0 = empty, 1 weak … 4 strong. */
export type PasswordScore = 0 | 1 | 2 | 3 | 4;

/**
 * Default heuristic: length ≥ 8, mixed case, digit, symbol — one point each
 * (min 1 for any non-empty password). Swap in zxcvbn or a policy-aware
 * scorer via the `score` prop.
 */
export function defaultPasswordScore(password: string): PasswordScore {
  if (password.length === 0) return 0;
  let points = 0;
  if (password.length >= 8) points++;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) points++;
  if (/\d/.test(password)) points++;
  if (/[^a-zA-Z0-9]/.test(password)) points++;
  return Math.max(1, Math.min(points, 4)) as PasswordScore;
}

const segmentTone: Record<Exclude<PasswordScore, 0>, string> = {
  1: 'bg-danger',
  2: 'bg-warn',
  3: 'bg-info',
  4: 'bg-pos',
};

const labelTone: Record<Exclude<PasswordScore, 0>, string> = {
  1: 'text-danger',
  2: 'text-warn',
  3: 'text-info',
  4: 'text-pos',
};

export interface PasswordStrengthProps extends ComponentPropsWithRef<'div'> {
  /** The password being evaluated. */
  value: string;
  /** Scoring function (injectable). Default `defaultPasswordScore`. */
  score?: ((password: string) => PasswordScore) | undefined;
  /**
   * Labels for scores 1–4 (required — i18n), e.g.
   * `['Weak', 'Fair', 'Good', 'Strong']`.
   */
  labels: readonly [string, string, string, string];
  /** Accessible name for the meter (e.g. "Password strength"). */
  label: string;
}

/**
 * PasswordStrength — segmented 4-bar meter + tone-colored label, injectable
 * scoring (research/design-system.md §3 Tier 3, Auth screens). Announces via
 * `role="meter"`; the label updates in an `aria-live` region.
 */
export function PasswordStrength({
  value,
  score = defaultPasswordScore,
  labels,
  label,
  className,
  ...props
}: PasswordStrengthProps) {
  const current = value.length === 0 ? 0 : score(value);
  return (
    <div className={cn('flex flex-col gap-1.5', className)} {...props}>
      <div
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={4}
        aria-valuenow={current}
        aria-valuetext={current === 0 ? undefined : labels[current - 1]}
        className="flex gap-1"
      >
        {([1, 2, 3, 4] as const).map((segment) => (
          <span
            key={segment}
            data-part="strength-segment"
            data-filled={segment <= current || undefined}
            className={cn(
              'h-1 flex-1 rounded-full transition-colors duration-150',
              segment <= current && current > 0 ? segmentTone[current as 1 | 2 | 3 | 4] : 'bg-surface-3',
            )}
          />
        ))}
      </div>
      <div aria-live="polite" className="min-h-4 text-caption font-semibold">
        {current === 0 ? null : (
          <span className={labelTone[current as 1 | 2 | 3 | 4]}>{labels[current - 1]}</span>
        )}
      </div>
    </div>
  );
}
