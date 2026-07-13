import { useDirection } from '@radix-ui/react-direction';
import { useRef, useState } from 'react';
import type * as React from 'react';

import { cn } from '../../lib/cn.js';
import type { Tone } from '../../lib/tones.js';

export interface SegmentedControlOption {
  value: string;
  /** Segment text. Omit for icon-only segments (then set `ariaLabel`). */
  label?: React.ReactNode | undefined;
  /** Required accessible name when `label` is omitted (icon-only). */
  ariaLabel?: string | undefined;
  /** Leading Lucide icon (decorative). */
  icon?: React.ReactNode | undefined;
  /** Mono count pill (surface-3; accent fill on the active segment). */
  count?: number | undefined;
  /** Leading status dot in the given tone. */
  dot?: Tone | undefined;
  disabled?: boolean | undefined;
}

const dotToneClasses: Record<Tone, string> = {
  neutral: 'bg-fg-subtle',
  accent: 'bg-accent',
  pos: 'bg-pos',
  warn: 'bg-warn',
  danger: 'bg-danger',
  info: 'bg-info',
};

export interface SegmentedControlProps
  extends Omit<React.ComponentPropsWithRef<'div'>, 'style' | 'defaultValue' | 'onChange'> {
  options: readonly SegmentedControlOption[];
  /** Controlled selected value. */
  value?: string | undefined;
  /** Uncontrolled initial value (defaults to the first enabled option). */
  defaultValue?: string | undefined;
  onValueChange?: ((value: string) => void) | undefined;
  /** Disables the whole tray. */
  disabled?: boolean | undefined;
}

/**
 * SegmentedControl — 3px-padded `--surface-2` tray; active segment =
 * `--surface` bg + card shadow (research/design-system.md §3 Tier 2).
 * Variants come from the option shape: text, icon-only, with count pill,
 * with status dot. Radiogroup semantics with a single tab stop; arrow keys
 * move AND select (RTL-mirrored); Home/End jump.
 */
export function SegmentedControl({
  options,
  value,
  defaultValue,
  onValueChange,
  disabled = false,
  className,
  ...props
}: SegmentedControlProps) {
  const direction = useDirection();
  const trayRef = useRef<HTMLDivElement | null>(null);
  const firstEnabled = options.find((option) => !option.disabled)?.value;
  const [internal, setInternal] = useState<string | undefined>(defaultValue ?? firstEnabled);
  const current = value !== undefined ? value : internal;

  const select = (nextValue: string, focus = false) => {
    if (value === undefined) setInternal(nextValue);
    onValueChange?.(nextValue);
    if (focus) {
      trayRef.current
        ?.querySelector<HTMLButtonElement>(`[data-value="${CSS.escape(nextValue)}"]`)
        ?.focus();
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const enabled = options.filter((option) => !option.disabled);
    if (enabled.length === 0) return;
    const forwardKeys = direction === 'rtl' ? ['ArrowLeft', 'ArrowDown'] : ['ArrowRight', 'ArrowDown'];
    const backwardKeys = direction === 'rtl' ? ['ArrowRight', 'ArrowUp'] : ['ArrowLeft', 'ArrowUp'];
    let next: SegmentedControlOption | undefined;
    if (event.key === 'Home') {
      next = enabled[0];
    } else if (event.key === 'End') {
      next = enabled[enabled.length - 1];
    } else {
      const delta = forwardKeys.includes(event.key) ? 1 : backwardKeys.includes(event.key) ? -1 : 0;
      if (delta === 0) return;
      const fromIndex = enabled.findIndex((option) => option.value === current);
      next = enabled[(fromIndex + delta + enabled.length) % enabled.length];
    }
    if (!next) return;
    event.preventDefault();
    select(next.value, true);
  };

  return (
    <div
      ref={trayRef}
      role="radiogroup"
      onKeyDown={handleKeyDown}
      className={cn('inline-flex items-center gap-0.5 rounded-md bg-surface-2 p-[3px]', className)}
      {...props}
    >
      {options.map((option) => {
        const selected = option.value === current;
        const tabbable = selected || (current === undefined && option.value === firstEnabled);
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            {...(option.ariaLabel === undefined ? {} : { 'aria-label': option.ariaLabel })}
            tabIndex={tabbable ? 0 : -1}
            data-value={option.value}
            data-selected={selected ? '' : undefined}
            disabled={disabled || option.disabled}
            onClick={() => select(option.value)}
            className={cn(
              'group inline-flex h-7 select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-[8px] px-3 ',
              'text-[12.5px] font-semibold text-fg-muted transition-colors duration-150 hover:text-fg ',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ',
              'disabled:pointer-events-none disabled:opacity-40 ',
              'data-[selected]:bg-surface data-[selected]:text-fg data-[selected]:shadow-card ',
              '[&_svg]:size-3.5 [&_svg]:shrink-0',
              option.label === undefined || option.label === null ? 'px-2' : '',
            )}
          >
            {option.dot === undefined ? null : (
              <span aria-hidden="true" className={cn('size-1.5 shrink-0 rounded-full', dotToneClasses[option.dot])} />
            )}
            {option.icon === undefined || option.icon === null ? null : (
              <span aria-hidden="true" className="flex items-center">
                {option.icon}
              </span>
            )}
            {option.label}
            {option.count === undefined ? null : (
              <span
                className={cn(
                  'inline-flex min-w-[18px] items-center justify-center rounded-full bg-surface-3 px-1.5 py-px ',
                  'font-mono text-[10px] font-bold tabular-nums text-fg-muted ',
                  'group-data-[selected]:bg-accent group-data-[selected]:text-accent-fg',
                )}
              >
                {option.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
