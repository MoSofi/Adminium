import { Check, Copy, Eye, EyeOff } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type * as React from 'react';

import { cn } from '../../lib/cn.js';
import { IconButton } from '../icon-button/index.js';
import { inputGroupContainerClasses } from '../input-group/index.js';

/** How long the "copied" confirmation shows (design: 1.4s). */
export const SECRET_COPIED_MS = 1400;

export interface SecretInputProps
  extends Omit<React.ComponentPropsWithRef<'input'>, 'style' | 'size' | 'type'> {
  /** Accessible name for the reveal toggle while the value is masked. */
  revealLabel: string;
  /** Accessible name for the reveal toggle while the value is shown. */
  hideLabel: string;
  /** Accessible name for the copy button. */
  copyLabel: string;
  /** Announced via `aria-live` (and shown as the check state) after copying. */
  copiedLabel: string;
  /** Danger border + ring + `aria-invalid`. */
  error?: boolean | undefined;
  /** Extra classes for the inner `<input>` (className styles the wrapper). */
  inputClassName?: string | undefined;
  /** Called after the value is written to the clipboard. */
  onCopy?: (() => void) | undefined;
}

/**
 * SecretInput — masked mono value (API keys, tokens) with an eye reveal
 * toggle and a copy button that flips to a check + announces `copiedLabel`
 * through a polite `aria-live` region for 1.4s
 * (research/design-system.md §3 Tier 2).
 */
export function SecretInput({
  className,
  inputClassName,
  revealLabel,
  hideLabel,
  copyLabel,
  copiedLabel,
  error = false,
  onCopy,
  ref,
  ...inputProps
}: SecretInputProps) {
  const innerRef = useRef<HTMLInputElement | null>(null);
  const timerRef = useRef<number | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);

  const setRef = (node: HTMLInputElement | null) => {
    innerRef.current = node;
    if (typeof ref === 'function') ref(node);
    else if (ref) ref.current = node;
  };

  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    },
    [],
  );

  const handleCopy = async () => {
    const text = innerRef.current?.value ?? '';
    try {
      await navigator.clipboard?.writeText(text);
    } catch {
      // Clipboard unavailable (permissions/insecure context): still show the
      // feedback so the interaction is not a dead click; consumers can hook
      // `onCopy` for a fallback.
    }
    onCopy?.();
    setCopied(true);
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setCopied(false), SECRET_COPIED_MS);
  };

  return (
    <div data-invalid={error ? '' : undefined} className={cn(inputGroupContainerClasses, 'pe-1.5', className)}>
      <input
        ref={setRef}
        type={revealed ? 'text' : 'password'}
        {...(error ? { 'aria-invalid': true as const } : {})}
        className={cn(
          'h-full w-full min-w-0 flex-1 bg-transparent font-mono text-[13px] tabular-nums text-fg placeholder:text-fg-subtle focus:outline-none',
          inputClassName,
        )}
        {...inputProps}
      />
      <IconButton
        label={revealed ? hideLabel : revealLabel}
        size="sm"
        aria-pressed={revealed}
        onClick={() => setRevealed((current) => !current)}
      >
        {revealed ? <EyeOff aria-hidden="true" className="size-3.5" /> : <Eye aria-hidden="true" className="size-3.5" />}
      </IconButton>
      <IconButton label={copyLabel} size="sm" data-copied={copied ? '' : undefined} onClick={() => void handleCopy()}>
        {copied ? <Check aria-hidden="true" className="size-3.5 text-pos" /> : <Copy aria-hidden="true" className="size-3.5" />}
      </IconButton>
      <span role="status" aria-live="polite" className="sr-only">
        {copied ? copiedLabel : ''}
      </span>
    </div>
  );
}
