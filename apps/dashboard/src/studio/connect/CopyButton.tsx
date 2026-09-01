// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Copy-to-clipboard button used across the BYO enrichment screens
 * (06-llm-assist.md §10.2 step 4): "Copy prompt" and "Copy errors for your AI
 * tool". Flips to a check + announces the copied state via `aria-live`, mirror-
 * ing the @adminium/ui SecretInput copy affordance.
 */
import { Check, Copy } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button, type ButtonProps } from '@adminium/ui';

import { t } from '../../i18n/t.js';
import { copyText } from './enrichIo.js';

export interface CopyButtonProps {
  /** Text (or a lazy producer) copied to the clipboard on click. */
  value: string | (() => string);
  label: string;
  /** Announced (and shown) after a successful copy. */
  copiedLabel?: string | undefined;
  variant?: ButtonProps['variant'] | undefined;
  size?: ButtonProps['size'] | undefined;
  disabled?: boolean | undefined;
}

export function CopyButton({ value, label, copiedLabel, variant = 'secondary', size = 'sm', disabled }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current !== null) clearTimeout(timer.current);
  }, []);

  const done = copiedLabel ?? t('studio:enrich.copied', 'Copied');

  const onClick = () => {
    const text = typeof value === 'function' ? value() : value;
    void copyText(text).then((ok) => {
      if (!ok) return;
      setCopied(true);
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      onClick={onClick}
      disabled={disabled}
      data-copied={copied ? '' : undefined}
    >
      <span aria-hidden="true" className="flex items-center gap-1.5">
        {copied ? <Check className="size-3.5 text-pos" /> : <Copy className="size-3.5" />}
        {copied ? done : label}
      </span>
      <span className="sr-only" aria-live="polite">
        {copied ? done : label}
      </span>
    </Button>
  );
}
