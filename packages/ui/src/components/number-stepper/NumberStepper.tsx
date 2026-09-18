// SPDX-License-Identifier: AGPL-3.0-only
import { ChevronDown, ChevronUp, Minus, Plus } from 'lucide-react';
import { useRef, useState } from 'react';
import type * as React from 'react';

import { cn } from '../../lib/cn.js';

export interface NumberStepperProps
  extends Omit<
    React.ComponentPropsWithRef<'input'>,
    'style' | 'size' | 'type' | 'value' | 'defaultValue' | 'onChange' | 'min' | 'max' | 'step'
  > {
  /** Controlled numeric value (`null` = empty). */
  value?: number | null | undefined;
  /** Uncontrolled initial value. */
  defaultValue?: number | undefined;
  /** Fires with the parsed number, or `null` when the field is empty/invalid. */
  onValueChange?: ((value: number | null) => void) | undefined;
  min?: number | undefined;
  max?: number | undefined;
  /** @default 1 */
  step?: number | undefined;
  /** Accessible name for the chevron-up button. */
  incrementLabel: string;
  /** Accessible name for the chevron-down button. */
  decrementLabel: string;
  /** Danger border + focus ring + `aria-invalid`. */
  error?: boolean | undefined;
  /**
   * `field` (default) is the chevron column inside the input's chrome — the
   * shape every existing caller renders. `buttons` is the design comp's own:
   * a −, a big mono value and a ＋,
   * each a 34px bordered square, with the unit beside them.
   *
   * Two layouts rather than two components because it is one control with one
   * contract: the same value, the same bounds, the same step, the same
   * `spinbutton` semantics. What differs is how much room the number is given,
   * and that is a caller's decision.
   */
  layout?: 'field' | 'buttons' | undefined;
  /** The word after the number in the `buttons` layout: "guests", "seats". */
  unit?: string | undefined;
  /** Extra classes for the inner `<input>` (className styles the wrapper). */
  inputClassName?: string | undefined;
}

function clamp(next: number, min: number | undefined, max: number | undefined): number {
  let result = next;
  if (min !== undefined) result = Math.max(min, result);
  if (max !== undefined) result = Math.min(max, result);
  return result;
}

/**
 * NumberStepper — mono `input[type=number]` (native `spinbutton`: typed
 * input, ↑↓ arrow keys) plus a chevron up/down column honoring
 * min/max/step (research/design-system.md Tier 2). The chevron buttons
 * are `tabIndex={-1}` — keyboard users step with the arrow keys.
 */
export function NumberStepper({
  className,
  inputClassName,
  value,
  defaultValue,
  onValueChange,
  min,
  max,
  step = 1,
  incrementLabel,
  decrementLabel,
  error = false,
  layout = 'field',
  unit,
  disabled,
  ref,
  ...inputProps
}: NumberStepperProps) {
  const innerRef = useRef<HTMLInputElement | null>(null);
  const [internal, setInternal] = useState<number | null>(defaultValue ?? null);
  const isControlled = value !== undefined;
  const current = isControlled ? value : internal;

  const setRef = (node: HTMLInputElement | null) => {
    innerRef.current = node;
    if (typeof ref === 'function') ref(node);
    else if (ref) ref.current = node;
  };

  const commit = (next: number | null) => {
    if (!isControlled) setInternal(next);
    onValueChange?.(next);
  };

  const stepBy = (direction: 1 | -1) => {
    const base = current ?? (direction === 1 ? (min ?? 0) - step : (max ?? 0) + step);
    commit(clamp(base + direction * step, min, max));
    innerRef.current?.focus();
  };

  const atMin = current !== null && min !== undefined && current <= min;
  const atMax = current !== null && max !== undefined && current >= max;

  const bigButtonClasses =
    'flex size-[34px] shrink-0 items-center justify-center rounded-md border border-border-strong bg-surface text-fg-muted ' +
    'transition-colors hover:bg-surface-2 disabled:pointer-events-none disabled:opacity-40 ' +
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

  const stepperButtonClasses =
    'flex h-1/2 w-6 items-center justify-center text-fg-subtle transition-colors hover:bg-surface-3 hover:text-fg ' +
    'disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent';

  if (layout === 'buttons') {
    /*
     * The value is a `spinbutton` in its own right — NOT a number input made to
     * look like text. Arrow keys, Home/End and a typed value all have to keep
     * working: the comp draws two buttons and a number, and a person who
     * reaches it by keyboard still expects to type into it.
     */
    return (
      <div className={cn('flex items-center gap-2.5', disabled === true && 'opacity-40', className)}>
        <button
          type="button"
          aria-label={decrementLabel}
          disabled={disabled === true || atMin}
          onClick={() => stepBy(-1)}
          className={bigButtonClasses}
        >
          <Minus aria-hidden="true" className="size-[15px]" />
        </button>
        <input
          ref={setRef}
          type="number"
          inputMode="numeric"
          value={current ?? ''}
          onChange={(event) => {
            const parsed = event.target.value === '' ? null : event.target.valueAsNumber;
            commit(parsed === null || Number.isNaN(parsed) ? null : parsed);
          }}
          {...(min !== undefined ? { min } : {})}
          {...(max !== undefined ? { max } : {})}
          step={step}
          disabled={disabled}
          {...(error ? { 'aria-invalid': true as const } : {})}
          className={cn(
            'min-w-[3ch] bg-transparent text-center font-mono text-[15px] font-extrabold tabular-nums text-fg',
            'focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
            '[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none',
            'w-[var(--adm-stepper-width)]',
            inputClassName,
          )}
          // The field grows with the number it holds, so the width is a value
          // rather than a class — through a custom property, the one shape the
          // tokens-only rule allows.
          style={{ '--adm-stepper-width': `${String(Math.max(String(current ?? '').length, 2))}ch` }}
          {...inputProps}
        />
        <button
          type="button"
          aria-label={incrementLabel}
          disabled={disabled === true || atMax}
          onClick={() => stepBy(1)}
          className={bigButtonClasses}
        >
          <Plus aria-hidden="true" className="size-[15px]" />
        </button>
        {unit === undefined ? null : (
          <span className="ms-0.5 text-caption text-fg-subtle">{unit}</span>
        )}
      </div>
    );
  }

  return (
    <div
      data-invalid={error ? '' : undefined}
      className={cn(
        'flex h-[34px] w-full min-w-0 items-stretch overflow-hidden rounded-md border border-border-strong bg-surface-2',
        'transition-[border-color,box-shadow] duration-150',
        'focus-within:border-accent focus-within:ring-[3px] focus-within:ring-accent-soft',
        'has-[input:disabled]:pointer-events-none has-[input:disabled]:opacity-40',
        'data-[invalid]:border-danger data-[invalid]:focus-within:ring-danger-soft',
        className,
      )}
    >
      <input
        ref={setRef}
        type="number"
        inputMode="decimal"
        value={current ?? ''}
        onChange={(event) => {
          const parsed = event.target.value === '' ? null : event.target.valueAsNumber;
          commit(parsed === null || Number.isNaN(parsed) ? null : parsed);
        }}
        {...(min !== undefined ? { min } : {})}
        {...(max !== undefined ? { max } : {})}
        step={step}
        disabled={disabled}
        {...(error ? { 'aria-invalid': true as const } : {})}
        className={cn(
          'h-full w-full min-w-0 flex-1 bg-transparent ps-3 pe-2 font-mono text-[13px] tabular-nums text-fg placeholder:text-fg-subtle focus:outline-none',
          '[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none',
          inputClassName,
        )}
        {...inputProps}
      />
      <div aria-hidden={disabled ? true : undefined} className="flex shrink-0 flex-col border-s border-border-strong">
        <button
          type="button"
          tabIndex={-1}
          aria-label={incrementLabel}
          disabled={disabled || atMax}
          onClick={() => stepBy(1)}
          className={cn(stepperButtonClasses, 'border-b border-border-strong')}
        >
          <ChevronUp aria-hidden="true" className="size-3" />
        </button>
        <button
          type="button"
          tabIndex={-1}
          aria-label={decrementLabel}
          disabled={disabled || atMin}
          onClick={() => stepBy(-1)}
          className={stepperButtonClasses}
        >
          <ChevronDown aria-hidden="true" className="size-3" />
        </button>
      </div>
    </div>
  );
}
