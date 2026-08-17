// SPDX-License-Identifier: AGPL-3.0-only
import { Search, X } from 'lucide-react';
import { useRef, useState } from 'react';
import type * as React from 'react';

import { cn } from '../../lib/cn.js';
import { Kbd } from '../kbd/index.js';

interface SearchInputBaseProps extends Omit<React.ComponentPropsWithRef<'input'>, 'style' | 'size' | 'type'> {
  /** Keycap chip rendered at the end, e.g. `"⌘K"`. */
  kbd?: string | undefined;
  /** Extra classes for the inner `<input>` (className styles the pill). */
  inputClassName?: string | undefined;
}

export type SearchInputProps = SearchInputBaseProps &
  (
    | {
        /**
         * Shows a ✕ clear button while the input has a value; clicking it
         * empties the input (uncontrolled), refocuses it, and calls this.
         */
        onClear: () => void;
        /** Accessible name for the ✕ button (required with `onClear`). */
        clearLabel: string;
      }
    | { onClear?: never; clearLabel?: never }
  );

/**
 * SearchInput — Search icon + borderless input inside a bordered `--surface-2`
 * pill, optional `Kbd` "⌘K" chip and clear button
 * (research/design-system.md §3 Tier 2).
 */
export function SearchInput({
  className,
  inputClassName,
  kbd,
  onClear,
  clearLabel,
  ref,
  onChange,
  ...inputProps
}: SearchInputProps) {
  const innerRef = useRef<HTMLInputElement | null>(null);
  const [uncontrolledValue, setUncontrolledValue] = useState(String(inputProps.defaultValue ?? ''));
  const currentValue = inputProps.value !== undefined ? String(inputProps.value) : uncontrolledValue;

  const setRef = (node: HTMLInputElement | null) => {
    innerRef.current = node;
    if (typeof ref === 'function') ref(node);
    else if (ref) ref.current = node;
  };

  const handleClear = () => {
    if (inputProps.value === undefined && innerRef.current) {
      // Uncontrolled: reflect the cleared value in the DOM ourselves.
      innerRef.current.value = '';
      setUncontrolledValue('');
    }
    onClear?.();
    innerRef.current?.focus();
  };

  return (
    <div
      className={cn(
        'flex h-[34px] items-center gap-2 rounded-full border border-border-strong bg-surface-2 ps-3 pe-2.5',
        'transition-[border-color,box-shadow] duration-150',
        'focus-within:border-accent focus-within:ring-[3px] focus-within:ring-accent-soft',
        'has-[input:disabled]:pointer-events-none has-[input:disabled]:opacity-40',
        className,
      )}
    >
      <Search aria-hidden="true" className="size-3.5 shrink-0 text-fg-subtle" />
      <input
        ref={setRef}
        type="search"
        onChange={(event) => {
          setUncontrolledValue(event.target.value);
          onChange?.(event);
        }}
        className={cn(
          'h-full w-full min-w-0 flex-1 bg-transparent text-[13px] text-fg placeholder:text-fg-subtle focus:outline-none',
          '[&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-decoration]:appearance-none',
          inputClassName,
        )}
        {...inputProps}
      />
      {onClear && currentValue.length > 0 ? (
        <button
          type="button"
          aria-label={clearLabel}
          onClick={handleClear}
          className="nb-ib inline-flex size-5 shrink-0 items-center justify-center rounded-full text-fg-subtle hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
        >
          <X aria-hidden="true" className="size-3" />
        </button>
      ) : null}
      {kbd ? <Kbd className="shrink-0">{kbd}</Kbd> : null}
    </div>
  );
}
