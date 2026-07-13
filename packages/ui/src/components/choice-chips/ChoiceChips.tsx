import { useDirection } from '@radix-ui/react-direction';
import { useRef, useState } from 'react';
import type * as React from 'react';

import { cn } from '../../lib/cn.js';

export interface ChoiceChipOption {
  value: string;
  label: React.ReactNode;
  /** Optional leading icon (decorative). */
  icon?: React.ReactNode | undefined;
  disabled?: boolean | undefined;
}

interface ChoiceChipsCommonProps extends Omit<React.ComponentPropsWithRef<'div'>, 'style' | 'defaultValue' | 'onChange'> {
  options: readonly ChoiceChipOption[];
  /** Disables the whole group. */
  disabled?: boolean | undefined;
}

export interface ChoiceChipsSingleProps extends ChoiceChipsCommonProps {
  /**
   * Single-select (default): radiogroup semantics — one tab stop, ←→/↑↓ move
   * AND select (mirrored in RTL), Space/Enter select.
   */
  multiple?: false | undefined;
  value?: string | null | undefined;
  defaultValue?: string | null | undefined;
  onValueChange?: ((value: string | null) => void) | undefined;
}

export interface ChoiceChipsMultipleProps extends ChoiceChipsCommonProps {
  /** Multi-select: independent `aria-pressed` toggle chips in natural tab order. */
  multiple: true;
  value?: readonly string[] | undefined;
  defaultValue?: readonly string[] | undefined;
  onValueChange?: ((value: string[]) => void) | undefined;
}

export type ChoiceChipsProps = ChoiceChipsSingleProps | ChoiceChipsMultipleProps;

const chipClasses =
  'inline-flex h-7 select-none items-center gap-1.5 whitespace-nowrap rounded-full border border-border-strong bg-surface px-3 text-[12px] font-semibold text-fg-muted ' +
  'transition-colors duration-150 hover:text-fg ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ' +
  'disabled:pointer-events-none disabled:opacity-40 ' +
  'data-[selected]:border-accent data-[selected]:bg-accent-soft data-[selected]:text-accent [&_svg]:size-3.5 [&_svg]:shrink-0';

/**
 * ChoiceChips / PillOptions — pill option chips, selected = accent border +
 * accent-soft bg + accent text (research/design-system.md §3 Tier 2).
 * Single mode is a radiogroup with roving tabindex; multiple mode renders
 * `aria-pressed` toggle chips.
 */
export function ChoiceChips(props: ChoiceChipsProps) {
  const {
    options,
    disabled = false,
    multiple,
    value,
    defaultValue,
    onValueChange,
    className,
    ...rest
  } = props as ChoiceChipsCommonProps & {
    multiple?: boolean | undefined;
    value?: string | null | readonly string[] | undefined;
    defaultValue?: string | null | readonly string[] | undefined;
    onValueChange?: ((value: never) => void) | undefined;
  };
  const direction = useDirection();
  const groupRef = useRef<HTMLDivElement | null>(null);
  const [internal, setInternal] = useState<string | null | readonly string[]>(
    defaultValue ?? (multiple ? [] : null),
  );
  const current = value !== undefined ? value : internal;

  const isSelected = (optionValue: string): boolean =>
    multiple ? (current as readonly string[]).includes(optionValue) : current === optionValue;

  const emit = (next: string | null | string[]) => {
    if (value === undefined) setInternal(next);
    (onValueChange as ((value: string | null | string[]) => void) | undefined)?.(next);
  };

  const toggle = (optionValue: string) => {
    if (multiple) {
      const selected = current as readonly string[];
      emit(
        selected.includes(optionValue)
          ? selected.filter((existing) => existing !== optionValue)
          : [...selected, optionValue],
      );
    } else {
      emit(optionValue);
    }
  };

  /** Roving arrows (single mode): move focus and select, RTL-mirrored. */
  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (multiple) return;
    const forwardKeys = direction === 'rtl' ? ['ArrowLeft', 'ArrowDown'] : ['ArrowRight', 'ArrowDown'];
    const backwardKeys = direction === 'rtl' ? ['ArrowRight', 'ArrowUp'] : ['ArrowLeft', 'ArrowUp'];
    let delta = 0;
    if (forwardKeys.includes(event.key)) delta = 1;
    else if (backwardKeys.includes(event.key)) delta = -1;
    else return;
    event.preventDefault();
    const enabled = options.filter((option) => !option.disabled);
    if (enabled.length === 0) return;
    const focusedValue = (document.activeElement as HTMLElement | null)?.getAttribute('data-value');
    const fromIndex = enabled.findIndex((option) => option.value === (focusedValue ?? current));
    const nextIndex = (fromIndex + delta + enabled.length) % enabled.length;
    const nextOption = enabled[nextIndex];
    if (!nextOption) return;
    emit(nextOption.value);
    groupRef.current
      ?.querySelector<HTMLButtonElement>(`[data-value="${CSS.escape(nextOption.value)}"]`)
      ?.focus();
  };

  const firstEnabled = options.find((option) => !option.disabled)?.value;

  return (
    <div
      ref={groupRef}
      role={multiple ? 'group' : 'radiogroup'}
      onKeyDown={handleKeyDown}
      className={cn('flex flex-wrap items-center gap-1.5', className)}
      {...rest}
    >
      {options.map((option) => {
        const selected = isSelected(option.value);
        const singleTabbable = current === option.value || (current === null && option.value === firstEnabled);
        return (
          <button
            key={option.value}
            type="button"
            data-value={option.value}
            data-selected={selected ? '' : undefined}
            disabled={disabled || option.disabled}
            className={chipClasses}
            {...(multiple
              ? { 'aria-pressed': selected }
              : { role: 'radio', 'aria-checked': selected, tabIndex: singleTabbable ? 0 : -1 })}
            onClick={() => toggle(option.value)}
          >
            {option.icon ? (
              <span aria-hidden="true" className="flex items-center">
                {option.icon}
              </span>
            ) : null}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
