// SPDX-License-Identifier: AGPL-3.0-only
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { Check, ChevronDown } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import type * as React from 'react';

import { cn } from '../../lib/cn.js';

export interface ComboboxOption {
  value: string;
  /** Plain-string label — filtered against and echoed into the input. */
  label: string;
  /** Muted second line in the option row. */
  description?: string | undefined;
  /** Leading slot — typically an `Avatar` or Lucide icon (decorative). */
  leading?: React.ReactNode | undefined;
  disabled?: boolean | undefined;
}

export interface ComboboxProps {
  options: readonly ComboboxOption[];
  /** Controlled selected value (`null` = nothing selected). */
  value?: string | null | undefined;
  /** Uncontrolled initial value. */
  defaultValue?: string | null | undefined;
  onValueChange?: ((value: string | null) => void) | undefined;
  /** Empty-state row shown when no option matches the query (i18n: no default). */
  emptyText: React.ReactNode;
  placeholder?: string | undefined;
  /** Custom match predicate; defaults to case-insensitive `label` substring. */
  filter?: ((option: ComboboxOption, query: string) => boolean) | undefined;
  disabled?: boolean | undefined;
  /** Danger border + ring, `aria-invalid` (also injected by `FormField`). */
  error?: boolean | undefined;
  /** JetBrains Mono input text (technical values). */
  mono?: boolean | undefined;
  /** Classes for the root wrapper (the panel width follows the anchor). */
  className?: string | undefined;
  /** Control id — injected by `FormField`, applied to the input. */
  id?: string | undefined;
  name?: string | undefined;
  ref?: React.Ref<HTMLInputElement> | undefined;
  'aria-label'?: string | undefined;
  'aria-labelledby'?: string | undefined;
  /** Injected by `FormField`; applied to the input. */
  'aria-describedby'?: string | undefined;
  'aria-invalid'?: React.AriaAttributes['aria-invalid'] | undefined;
  'aria-required'?: React.AriaAttributes['aria-required'] | undefined;
}

const defaultFilter = (option: ComboboxOption, query: string): boolean =>
  option.label.toLowerCase().includes(query.trim().toLowerCase());

/**
 * Combobox — searchable single-select (research/design-system.md §3 Tier 2):
 * Input chrome + chevron; typing filters the option list in an anchored
 * Radix Popover panel; rows take a `leading` slot (avatars) and an optional
 * description; empty state via `emptyText`.
 *
 * ARIA 1.2 combobox pattern, dependency-free beyond `@radix-ui/react-popover`:
 * the input keeps focus (`role="combobox"`, `aria-expanded`,
 * `aria-activedescendant`); ↑/↓ move the active option, ↵ selects, Esc
 * closes, Tab/outside-click dismisses.
 */
export function Combobox({
  options,
  value,
  defaultValue,
  onValueChange,
  emptyText,
  placeholder,
  filter = defaultFilter,
  disabled = false,
  error = false,
  mono = false,
  className,
  id,
  name,
  ref,
  ...aria
}: ComboboxProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const listboxId = `${inputId}-listbox`;
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const [internalValue, setInternalValue] = useState<string | null>(defaultValue ?? null);
  const selectedValue = value !== undefined ? value : internalValue;
  const selectedOption = options.find((option) => option.value === selectedValue);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(-1);

  const filtered = query === '' ? options : options.filter((option) => filter(option, query));
  const optionId = (index: number) => `${inputId}-option-${index}`;
  const activeOption = activeIndex >= 0 ? filtered[activeIndex] : undefined;
  const invalid = error || aria['aria-invalid'] === true || aria['aria-invalid'] === 'true';

  useEffect(() => {
    if (open && activeIndex >= 0) {
      document.getElementById(`${inputId}-option-${activeIndex}`)?.scrollIntoView({ block: 'nearest' });
    }
  }, [activeIndex, open, inputId]);

  const openList = () => {
    if (disabled || open) return;
    setOpen(true);
    setQuery('');
    const selectedIndex = options.findIndex((option) => option.value === selectedValue && !option.disabled);
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : options.findIndex((option) => !option.disabled));
  };

  const closeList = () => {
    setOpen(false);
    setQuery('');
    setActiveIndex(-1);
  };

  const commit = (option: ComboboxOption) => {
    if (option.disabled) return;
    if (value === undefined) setInternalValue(option.value);
    onValueChange?.(option.value);
    closeList();
  };

  const moveActive = (delta: 1 | -1) => {
    if (filtered.length === 0) return;
    let index = activeIndex;
    for (let step = 0; step < filtered.length; step += 1) {
      index = (index + delta + filtered.length) % filtered.length;
      if (!filtered[index]?.disabled) break;
    }
    setActiveIndex(index);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) openList();
      else moveActive(event.key === 'ArrowDown' ? 1 : -1);
    } else if (event.key === 'Enter') {
      if (open && activeOption) {
        event.preventDefault();
        commit(activeOption);
      }
    } else if (event.key === 'Escape') {
      if (open) {
        event.preventDefault();
        closeList();
      }
    } else if (event.key === 'Tab') {
      if (open) closeList();
    }
  };

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={(next: boolean) => (next ? openList() : closeList())}>
      <div ref={rootRef} className={cn('relative w-full', className)}>
        <PopoverPrimitive.Anchor asChild>
          <div
            data-invalid={invalid ? '' : undefined}
            className={cn(
              'flex h-[34px] w-full min-w-0 items-center gap-2 rounded-md border border-border-strong bg-surface-2 ps-3 pe-2 ',
              'transition-[border-color,box-shadow] duration-150 ',
              'focus-within:border-accent focus-within:ring-[3px] focus-within:ring-accent-soft ',
              'has-[input:disabled]:pointer-events-none has-[input:disabled]:opacity-40 ',
              'data-[invalid]:border-danger data-[invalid]:focus-within:ring-danger-soft',
            )}
            onPointerDown={(event) => {
              // keep focus on the input; toggle instead of blur-then-reopen
              if (event.target !== inputRef.current) event.preventDefault();
              inputRef.current?.focus();
              if (!open) openList();
            }}
          >
            <input
              ref={(node) => {
                inputRef.current = node;
                if (typeof ref === 'function') ref(node);
                else if (ref) ref.current = node;
              }}
              id={inputId}
              {...(name === undefined ? {} : { name })}
              type="text"
              role="combobox"
              autoComplete="off"
              aria-expanded={open}
              aria-autocomplete="list"
              {...(open ? { 'aria-controls': listboxId } : {})}
              {...(open && activeOption ? { 'aria-activedescendant': optionId(activeIndex) } : {})}
              {...(invalid ? { 'aria-invalid': true as const } : {})}
              {...aria}
              disabled={disabled}
              {...(placeholder === undefined ? {} : { placeholder })}
              value={open ? query : (selectedOption?.label ?? '')}
              onChange={(event) => {
                if (!open) setOpen(true);
                setQuery(event.target.value);
                setActiveIndex(0);
              }}
              onKeyDown={handleKeyDown}
              className={cn(
                'h-full w-full min-w-0 flex-1 bg-transparent text-[13px] text-fg placeholder:text-fg-subtle focus:outline-none',
                mono && 'font-mono tabular-nums',
              )}
            />
            <ChevronDown
              aria-hidden="true"
              className={cn('size-3.5 shrink-0 text-fg-subtle transition-transform duration-150', open && 'rotate-180')}
            />
          </div>
        </PopoverPrimitive.Anchor>
        <PopoverPrimitive.Portal>
          <PopoverPrimitive.Content
            sideOffset={5}
            align="start"
            onOpenAutoFocus={(event: Event) => event.preventDefault()}
            onInteractOutside={(event: Event) => {
              // clicks on the anchor input must not count as "outside"
              if (rootRef.current?.contains(event.target as Node)) event.preventDefault();
            }}
            className={cn(
              'z-50 w-[var(--radix-popper-anchor-width)] rounded-lg border border-border bg-surface p-1 shadow-menu ',
              'animate-[nb-pop_.16s_cubic-bezier(.2,.7,.3,1)]',
            )}
          >
            <div role="listbox" id={listboxId} className="nb-scroll max-h-[260px] overflow-y-auto">
              {filtered.map((option, index) => {
                const selected = option.value === selectedValue;
                const active = index === activeIndex;
                return (
                  <div
                    key={option.value}
                    id={optionId(index)}
                    role="option"
                    aria-selected={selected}
                    {...(option.disabled ? { 'aria-disabled': true as const } : {})}
                    data-active={active ? '' : undefined}
                    onPointerDown={(event) => event.preventDefault()}
                    onPointerMove={() => {
                      if (!option.disabled && !active) setActiveIndex(index);
                    }}
                    onClick={() => commit(option)}
                    className={cn(
                      'flex cursor-default select-none items-center gap-2.5 rounded-[8px] px-2.5 py-1.5 text-[13px] text-fg ',
                      'data-[active]:bg-surface-2',
                      option.disabled && 'pointer-events-none opacity-40',
                    )}
                  >
                    {option.leading ? (
                      <span aria-hidden="true" className="flex shrink-0 items-center [&_svg]:size-3.5">
                        {option.leading}
                      </span>
                    ) : null}
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate">{option.label}</span>
                      {option.description === undefined ? null : (
                        <span className="truncate text-[11.5px] leading-4 text-fg-muted">{option.description}</span>
                      )}
                    </span>
                    {selected ? (
                      <Check aria-hidden="true" strokeWidth={3} className="size-3.5 shrink-0 text-accent" />
                    ) : null}
                  </div>
                );
              })}
              {filtered.length === 0 ? (
                <div className="px-2.5 py-3 text-center text-[12.5px] text-fg-muted">{emptyText}</div>
              ) : null}
            </div>
          </PopoverPrimitive.Content>
        </PopoverPrimitive.Portal>
      </div>
    </PopoverPrimitive.Root>
  );
}
