// SPDX-License-Identifier: AGPL-3.0-only
import { Search, X } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import type * as React from 'react';

import { cn } from '../../lib/cn.js';
import { Kbd } from '../kbd/index.js';

/** One thing the field offers while somebody types: what choosing it submits, and what it reads. */
export interface SearchInputOption {
  value: string;
  label: React.ReactNode;
}

interface SearchInputBaseProps extends Omit<React.ComponentPropsWithRef<'input'>, 'style' | 'size' | 'type' | 'onSubmit'> {
  /**
   * Enter submits what is typed (or the option the arrows chose). The field
   * keeps the focus and its text is selected, so the next thing typed or
   * scanned replaces it.
   */
  onSubmit?: ((value: string) => void) | undefined;
  /**
   * Things to choose from, drawn as a listbox under the field: the arrows
   * move through them, Enter or a click submits one. The caller filters;
   * an empty list draws nothing.
   */
  options?: readonly SearchInputOption[] | undefined;
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
 * (research/design-system.md Tier 2).
 */
export function SearchInput({
  className,
  inputClassName,
  kbd,
  onClear,
  clearLabel,
  ref,
  onChange,
  onSubmit,
  options,
  onKeyDown,
  onBlur,
  ...inputProps
}: SearchInputProps) {
  const listId = useId();
  // The option the arrows are on; none until one is pressed.
  const [active, setActive] = useState(-1);
  const [closed, setClosed] = useState(false);
  const listed = options !== undefined && options.length > 0 && !closed;
  const activeIndex = listed && active < options.length ? active : -1;
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

  const submit = (value: string) => {
    setActive(-1);
    setClosed(true);
    onSubmit?.(value);
    // The focus stays, and what is there is selected: the next code typed or scanned replaces it.
    innerRef.current?.focus();
    innerRef.current?.select();
  };
  const choose = (option: SearchInputOption) => {
    if (inputProps.value === undefined && innerRef.current) {
      innerRef.current.value = option.value;
      setUncontrolledValue(option.value);
    }
    submit(option.value);
  };
  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    onKeyDown?.(event);
    if (event.defaultPrevented) return;
    if (options !== undefined && options.length > 0 && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault();
      setClosed(false);
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive((at) => (closed ? (step === 1 ? 0 : options.length - 1) : (at + step + options.length + (at === -1 && step === -1 ? 1 : 0)) % options.length));
      return;
    }
    if (event.key === 'Escape' && listed) {
      event.preventDefault();
      setActive(-1);
      setClosed(true);
      return;
    }
    if (event.key === 'Enter' && (onSubmit !== undefined || activeIndex >= 0)) {
      event.preventDefault();
      const option = activeIndex >= 0 ? options?.[activeIndex] : undefined;
      if (option !== undefined) choose(option);
      else submit(event.currentTarget.value);
    }
  };

  return (
    <div
      className={cn(
        'flex h-[34px] items-center gap-2 rounded-full border border-border-strong bg-surface-2 ps-3 pe-2.5',
        'transition-[border-color,box-shadow] duration-150',
        'focus-within:border-accent focus-within:ring-[3px] focus-within:ring-accent-soft',
        'has-[input:disabled]:pointer-events-none has-[input:disabled]:opacity-40',
        options === undefined ? null : 'relative',
        className,
      )}
    >
      <Search aria-hidden="true" className="size-3.5 shrink-0 text-fg-subtle" />
      <input
        ref={setRef}
        type="search"
        onChange={(event) => {
          setUncontrolledValue(event.target.value);
          // Typing opens the list again, on nothing.
          setClosed(false);
          setActive(-1);
          onChange?.(event);
        }}
        onKeyDown={handleKeyDown}
        onBlur={(event) => {
          setClosed(true);
          onBlur?.(event);
        }}
        {...(options === undefined
          ? {}
          : {
              role: 'combobox',
              'aria-autocomplete': 'list' as const,
              'aria-expanded': listed,
              'aria-controls': listId,
              ...(activeIndex >= 0 ? { 'aria-activedescendant': `${listId}-${String(activeIndex)}` } : {}),
            })}
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
      {options === undefined ? null : (
        <ul
          id={listId}
          role="listbox"
          hidden={!listed}
          className="absolute inset-x-0 top-full z-30 mt-1.5 max-h-64 overflow-auto rounded-lg border border-border bg-surface p-1 shadow-menu"
        >
          {listed
            ? options.map((option, index) => (
                <li
                  key={option.value}
                  id={`${listId}-${String(index)}`}
                  role="option"
                  aria-selected={index === activeIndex}
                  data-active={index === activeIndex ? '' : undefined}
                  // The field keeps the focus: a press on an option must not blur it first.
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => choose(option)}
                  className="flex min-h-9 cursor-pointer items-center rounded-[8px] px-2.5 text-[13px] text-fg data-[active]:bg-surface-2"
                >
                  {option.label}
                </li>
              ))
            : null}
        </ul>
      )}
    </div>
  );
}
