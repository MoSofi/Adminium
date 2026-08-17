// SPDX-License-Identifier: AGPL-3.0-only
import { CalendarDays } from 'lucide-react';
import { useState } from 'react';
import type * as React from 'react';

import { cn } from '../../lib/cn.js';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../dropdown-menu/index.js';
import { IconButton } from '../icon-button/index.js';
import { inputVariants } from '../input/index.js';

export type DateInputType = 'date' | 'time' | 'datetime-local';

export interface DateInputProps
  extends Omit<React.ComponentPropsWithRef<'input'>, 'style' | 'size' | 'type'> {
  /** Native picker type (defaults to `date`). */
  type?: DateInputType | undefined;
  /** Danger border + ring + `aria-invalid`. */
  error?: boolean | undefined;
}

/**
 * DateInput / TimeInput — native `date`/`time`/`datetime-local` input with
 * the shared Input chrome and JetBrains Mono value
 * (research/design-system.md §3 Tier 2). The native picker follows the theme
 * automatically: `color-scheme` is set per `data-theme` by @adminium/tokens
 * and inherits into the control. Values are ISO strings; display formatting
 * is the caller's job (`@adminium/i18n`).
 */
export function DateInput({ type = 'date', error = false, className, ...props }: DateInputProps) {
  return (
    <input
      type={type}
      {...(error ? { 'aria-invalid': true as const, 'data-invalid': '' } : {})}
      className={cn(
        inputVariants({ mono: true }),
        // native fields ignore width:100% shrink rules without a min width reset
        'appearance-none [&::-webkit-calendar-picker-indicator]:opacity-60 [&::-webkit-calendar-picker-indicator]:hover:opacity-100',
        className,
      )}
      {...props}
    />
  );
}

export interface DateRangeValue {
  /** ISO start value ('' = unset). */
  start: string;
  /** ISO end value ('' = unset). */
  end: string;
}

export interface DateRangePreset {
  /** Menu row label, e.g. "Last 7 days" (i18n: caller-supplied). */
  label: string;
  value: DateRangeValue;
}

export interface DateRangeInputProps
  extends Omit<React.ComponentPropsWithRef<'div'>, 'style' | 'defaultValue' | 'onChange'> {
  /** `date` (default) or `datetime-local` pair. */
  type?: Exclude<DateInputType, 'time'> | undefined;
  value?: DateRangeValue | undefined;
  defaultValue?: DateRangeValue | undefined;
  onValueChange?: ((value: DateRangeValue) => void) | undefined;
  /** Accessible name for the start input (i18n: no default). */
  startLabel: string;
  /** Accessible name for the end input (i18n: no default). */
  endLabel: string;
  /** Optional preset ranges shown in a trailing menu. */
  presets?: readonly DateRangePreset[] | undefined;
  /** Accessible name for the presets trigger — required when `presets` is set. */
  presetsLabel?: string | undefined;
  error?: boolean | undefined;
  disabled?: boolean | undefined;
}

const EMPTY_RANGE: DateRangeValue = { start: '', end: '' };

/**
 * DateRangeInput — paired start/end `DateInput`s + optional preset menu:
 * the DateRangePicker shell (the full calendar popover lands with the M7
 * calendar widget). Start/end are clamped against each other via native
 * `min`/`max`.
 */
export function DateRangeInput({
  type = 'date',
  value,
  defaultValue,
  onValueChange,
  startLabel,
  endLabel,
  presets,
  presetsLabel,
  error = false,
  disabled = false,
  className,
  ...props
}: DateRangeInputProps) {
  const [internal, setInternal] = useState<DateRangeValue>(defaultValue ?? EMPTY_RANGE);
  const current = value ?? internal;

  const emit = (next: DateRangeValue) => {
    if (value === undefined) setInternal(next);
    onValueChange?.(next);
  };

  return (
    <div role="group" className={cn('flex w-full items-center gap-2', className)} {...props}>
      <DateInput
        type={type}
        aria-label={startLabel}
        error={error}
        disabled={disabled}
        value={current.start}
        {...(current.end === '' ? {} : { max: current.end })}
        onChange={(event) => emit({ ...current, start: event.target.value })}
        className="flex-1"
      />
      <span aria-hidden="true" className="shrink-0 text-fg-subtle">
        &ndash;
      </span>
      <DateInput
        type={type}
        aria-label={endLabel}
        error={error}
        disabled={disabled}
        value={current.end}
        {...(current.start === '' ? {} : { min: current.start })}
        onChange={(event) => emit({ ...current, end: event.target.value })}
        className="flex-1"
      />
      {presets && presets.length > 0 ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton variant="bordered" size="lg" label={presetsLabel ?? ''} disabled={disabled}>
              <CalendarDays className="size-4" />
            </IconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {presets.map((preset) => (
              <DropdownMenuItem key={preset.label} onSelect={() => emit(preset.value)}>
                {preset.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}
