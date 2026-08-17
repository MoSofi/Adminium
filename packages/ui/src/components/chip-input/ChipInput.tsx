// SPDX-License-Identifier: AGPL-3.0-only
import { useRef, useState } from 'react';
import type * as React from 'react';

import { cn } from '../../lib/cn.js';
import { Tag } from '../tag/index.js';

/** Paste/typing separators: commas and any whitespace. */
const SPLIT_RE = /[,\s]+/;

export interface ChipInputProps
  extends Omit<
    React.ComponentPropsWithRef<'input'>,
    'style' | 'size' | 'type' | 'value' | 'defaultValue' | 'onChange'
  > {
  /** Controlled chip list. */
  value?: readonly string[] | undefined;
  /** Uncontrolled initial chip list. */
  defaultValue?: readonly string[] | undefined;
  /** Fires with the next chip list after add/remove. */
  onValueChange?: ((value: string[]) => void) | undefined;
  /**
   * Per-chip validation (emails, domains, …). Invalid tokens are NOT added:
   * they stay in the text input and the field flags `data-invalid` +
   * `aria-invalid` until the text changes.
   */
  validate?: ((chip: string) => boolean) | undefined;
  /** Accessible name for each chip's ✕ button, built per chip (i18n-friendly). */
  removeLabel: (chip: string) => string;
  /** Force the danger state from outside (form-level validation). */
  error?: boolean | undefined;
  /** Extra classes for the inline `<input>` (className styles the wrapper). */
  inputClassName?: string | undefined;
}

/**
 * ChipInput (MultiSelect/TagInput) — removable chips + inline text input
 * (research/design-system.md §3 Tier 2). Enter or `,` commits the pending
 * text, paste splits on commas/whitespace, Backspace on an empty input
 * removes the last chip, duplicates are ignored.
 */
export function ChipInput({
  className,
  inputClassName,
  value,
  defaultValue,
  onValueChange,
  validate,
  removeLabel,
  error = false,
  disabled,
  ref,
  onKeyDown,
  onPaste,
  onBlur,
  ...inputProps
}: ChipInputProps) {
  const innerRef = useRef<HTMLInputElement | null>(null);
  const [internal, setInternal] = useState<readonly string[]>(defaultValue ?? []);
  const [text, setText] = useState('');
  const [rejected, setRejected] = useState(false);
  const chips = value !== undefined ? value : internal;
  const invalid = error || rejected;

  const setRef = (node: HTMLInputElement | null) => {
    innerRef.current = node;
    if (typeof ref === 'function') ref(node);
    else if (ref) ref.current = node;
  };

  const commitChips = (next: string[]) => {
    if (value === undefined) setInternal(next);
    onValueChange?.(next);
  };

  /** Add tokens; returns the ones that failed validation. */
  const addTokens = (raw: string): string[] => {
    const tokens = raw.split(SPLIT_RE).map((token) => token.trim()).filter((token) => token.length > 0);
    if (tokens.length === 0) return [];
    const next = [...chips];
    const failed: string[] = [];
    for (const token of tokens) {
      if (validate && !validate(token)) {
        failed.push(token);
      } else if (!next.includes(token)) {
        next.push(token);
      }
    }
    if (next.length !== chips.length) commitChips(next);
    return failed;
  };

  const commitPending = () => {
    const failed = addTokens(text);
    setText(failed.join(', '));
    setRejected(failed.length > 0);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    onKeyDown?.(event);
    if (event.defaultPrevented) return;
    if (event.key === 'Enter' || event.key === ',') {
      if (text.trim().length > 0) {
        event.preventDefault();
        commitPending();
      } else if (event.key === ',') {
        event.preventDefault();
      }
    } else if (event.key === 'Backspace' && text.length === 0 && chips.length > 0) {
      commitChips(chips.slice(0, -1));
    }
  };

  const handlePaste = (event: React.ClipboardEvent<HTMLInputElement>) => {
    onPaste?.(event);
    if (event.defaultPrevented) return;
    const pasted = event.clipboardData.getData('text');
    if (!SPLIT_RE.test(pasted)) return; // single token: let it type normally
    event.preventDefault();
    const failed = addTokens(`${text} ${pasted}`);
    setText(failed.join(', '));
    setRejected(failed.length > 0);
  };

  return (
    // The wrapper focuses the inline input on click; it is not itself interactive.
    <div
      data-invalid={invalid ? '' : undefined}
      onClick={() => innerRef.current?.focus()}
      className={cn(
        'flex min-h-[34px] w-full min-w-0 cursor-text flex-wrap items-center gap-1.5 rounded-md border border-border-strong bg-surface-2 px-2 py-1.5',
        'transition-[border-color,box-shadow] duration-150',
        'focus-within:border-accent focus-within:ring-[3px] focus-within:ring-accent-soft',
        'has-[input:disabled]:pointer-events-none has-[input:disabled]:opacity-40',
        'data-[invalid]:border-danger data-[invalid]:focus-within:ring-danger-soft',
        className,
      )}
    >
      {chips.map((chip) => (
        <Tag
          key={chip}
          mono
          onRemove={() => commitChips(chips.filter((existing) => existing !== chip))}
          removeLabel={removeLabel(chip)}
        >
          {chip}
        </Tag>
      ))}
      <input
        ref={setRef}
        type="text"
        value={text}
        disabled={disabled}
        {...(invalid ? { 'aria-invalid': true as const } : {})}
        onChange={(event) => {
          setText(event.target.value);
          setRejected(false);
        }}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        onBlur={(event) => {
          if (text.trim().length > 0) commitPending();
          onBlur?.(event);
        }}
        className={cn(
          'h-[21px] min-w-[80px] flex-1 bg-transparent text-[13px] text-fg placeholder:text-fg-subtle focus:outline-none',
          inputClassName,
        )}
        {...inputProps}
      />
    </div>
  );
}
