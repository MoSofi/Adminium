import type * as React from 'react';

import { cn } from '../../lib/cn.js';
import { Kbd } from '../kbd/index.js';

/**
 * Container that carries the Input chrome; the inner `<input>` is borderless
 * and the focus ring moves to the wrapper via `:focus-within`
 * (research/design-system.md §3 Tier 2).
 */
export const inputGroupContainerClasses =
  'flex h-[34px] w-full min-w-0 items-center gap-1 rounded-md border border-border-strong bg-surface-2 ps-3 pe-2 ' +
  'transition-[border-color,box-shadow] duration-150 ' +
  'focus-within:border-accent focus-within:ring-[3px] focus-within:ring-accent-soft ' +
  'has-[input:disabled]:pointer-events-none has-[input:disabled]:opacity-40 ' +
  'data-[invalid]:border-danger data-[invalid]:focus-within:ring-danger-soft';

export interface InputGroupProps
  extends Omit<React.ComponentPropsWithRef<'input'>, 'style' | 'size' | 'prefix'> {
  /** Leading Lucide icon (rendered muted, decorative). */
  iconLeading?: React.ReactNode | undefined;
  /**
   * Trailing action slot — typically an `IconButton` (reveal eye, copy) or
   * any small control. Rendered inside the chrome after the input.
   */
  trailing?: React.ReactNode | undefined;
  /** Static mono text prefix, e.g. `adminium.io/`. */
  prefix?: React.ReactNode | undefined;
  /** Keycap suffix rendered as `Kbd`, e.g. `"⌘K"`. */
  kbd?: string | undefined;
  /** Danger border + ring on the wrapper and `aria-invalid` on the input. */
  error?: boolean | undefined;
  /** JetBrains Mono input text. */
  mono?: boolean | undefined;
  /** Extra classes for the inner `<input>` (className styles the wrapper). */
  inputClassName?: string | undefined;
}

/**
 * Input with chrome-level slots: leading icon, mono text prefix, trailing
 * icon-button and `Kbd` suffix (research/design-system.md §3 Tier 2).
 * `className` styles the wrapper; all other props (and `ref`) reach the
 * `<input>`.
 */
export function InputGroup({
  className,
  inputClassName,
  iconLeading,
  trailing,
  prefix,
  kbd,
  error = false,
  mono = false,
  ...inputProps
}: InputGroupProps) {
  return (
    <div data-invalid={error ? '' : undefined} className={cn(inputGroupContainerClasses, className)}>
      {iconLeading ? (
        <span aria-hidden="true" className="flex shrink-0 items-center text-fg-subtle [&_svg]:size-3.5">
          {iconLeading}
        </span>
      ) : null}
      {prefix ? (
        <span className="shrink-0 whitespace-nowrap font-mono text-[12.5px] tabular-nums text-fg-subtle">
          {prefix}
        </span>
      ) : null}
      <input
        {...(error ? { 'aria-invalid': true as const } : {})}
        className={cn(
          'h-full w-full min-w-0 flex-1 bg-transparent text-[13px] text-fg placeholder:text-fg-subtle focus:outline-none disabled:opacity-100',
          mono && 'font-mono tabular-nums',
          inputClassName,
        )}
        {...inputProps}
      />
      {kbd ? <Kbd className="shrink-0">{kbd}</Kbd> : null}
      {trailing ? <span className="flex shrink-0 items-center gap-0.5">{trailing}</span> : null}
    </div>
  );
}
