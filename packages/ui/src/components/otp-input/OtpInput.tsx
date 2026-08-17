// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react';
import type { ComponentPropsWithRef } from 'react';

import { cn } from '../../lib/cn.js';
import { MonoText } from '../mono-text/MonoText.js';

export interface OtpInputProps
  extends Omit<
    ComponentPropsWithRef<'div'>,
    'onChange' | 'defaultValue' | 'children' | 'aria-label'
  > {
  /** Number of code cells. Default 6. */
  length?: number | undefined;
  /** Controlled value (digits only, up to `length`). */
  value?: string | undefined;
  /** Uncontrolled initial value. */
  defaultValue?: string | undefined;
  onChange?: ((value: string) => void) | undefined;
  /** Fires once when all cells are filled. */
  onComplete?: ((code: string) => void) | undefined;
  /** Accessible name for the code input (required — i18n, e.g. "One-time code"). */
  label: string;
  /** Id of the element describing the input (help/error copy). */
  describedBy?: string | undefined;
  disabled?: boolean | undefined;
  /** Danger styling for a rejected code. */
  invalid?: boolean | undefined;
  /** Autofocus the input on mount (2FA screens). */
  autoFocus?: boolean | undefined;
}

const sanitize = (raw: string, length: number): string => raw.replace(/\D/g, '').slice(0, length);

/**
 * OtpInput — 6-cell one-time-code input rendered over a single invisible
 * `<input autocomplete="one-time-code">` (Auth & Onboarding pattern):
 * typing auto-advances, paste fills all cells, Backspace clears backwards —
 * all native single-input behaviors; the cells are a purely visual projection
 * with the caret cell highlighted.
 */
export function OtpInput({
  length = 6,
  value: controlledValue,
  defaultValue,
  onChange,
  onComplete,
  label,
  describedBy,
  disabled = false,
  invalid = false,
  autoFocus = false,
  className,
  ...props
}: OtpInputProps) {
  const [internalValue, setInternalValue] = useState(sanitize(defaultValue ?? '', length));
  const [focused, setFocused] = useState(false);
  const value = controlledValue === undefined ? internalValue : sanitize(controlledValue, length);
  const activeIndex = Math.min(value.length, length - 1);

  const handleChange = (raw: string) => {
    const next = sanitize(raw, length);
    if (next === value) return;
    setInternalValue(next);
    onChange?.(next);
    if (next.length === length) onComplete?.(next);
  };

  return (
    <div dir="ltr" className={cn('relative inline-flex gap-2', className)} {...props}>
      <input
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]*"
        maxLength={length}
        aria-label={label}
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
        autoFocus={autoFocus}
        disabled={disabled}
        value={value}
        onChange={(event) => handleChange(event.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        data-part="otp-native-input"
        // Invisible but interactive layer over the cells; caret hidden.
        className="absolute inset-0 z-10 h-full w-full cursor-text opacity-0 [caret-color:transparent] disabled:cursor-default"
      />
      {Array.from({ length }, (_, index) => {
        const char = value[index] ?? '';
        const isActive = focused && !disabled && index === activeIndex && value.length < length;
        return (
          <MonoText
            key={index}
            aria-hidden="true"
            data-part="otp-cell"
            data-active={isActive || undefined}
            className={cn(
              'flex h-12 w-10 select-none items-center justify-center rounded-md border bg-surface text-[18px] font-bold text-fg',
              'transition-[border-color,box-shadow] duration-100',
              invalid ? 'border-danger' : 'border-border-strong',
              isActive ? 'border-accent shadow-[0_0_0_3px_var(--accent-soft)]' : undefined,
              disabled ? 'opacity-40' : undefined,
            )}
          >
            {char}
          </MonoText>
        );
      })}
    </div>
  );
}
