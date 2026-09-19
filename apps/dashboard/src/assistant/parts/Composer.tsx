// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The box you type into, and what a turn will cost before you press it.
 *
 * THE HINT IS A PROMISE KEPT BEFORE THE FACT. The header chip says what this
 * session has spent; this says what the next request will add. Both are
 * estimates the server made, and both are shown because an assistant that
 * only tells you afterwards is one you cannot budget for.
 *
 * Enter submits, because this is a conversation and not a form. The button is
 * the same action with a name, for anyone who cannot press Enter.
 */
import { cn } from '@adminium/ui';
import { ArrowUp, Loader2 } from 'lucide-react';
import { useId, type KeyboardEvent } from 'react';

import { t } from '../../i18n/t.js';

export interface ComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  placeholder: string;
  /** The server's estimate of the next request, in tokens. */
  nextTurnTokens: number;
  /** A turn is running: the send button spins and the box is closed. */
  working: boolean;
  disabled: boolean;
}

export function Composer({
  value,
  onChange,
  onSubmit,
  placeholder,
  nextTurnTokens,
  working,
  disabled,
}: ComposerProps) {
  const inputId = useId();
  const blocked = disabled || working;
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    if (!blocked) onSubmit();
  };
  return (
    <div className="flex items-center gap-2.5 rounded-[13px] border border-border bg-surface-2 ps-[13px] pe-1.5">
      <label className="sr-only" htmlFor={inputId}>
        {placeholder}
      </label>
      <input
        data-testid="assistant-input"
        id={inputId}
        type="text"
        value={value}
        disabled={blocked}
        placeholder={placeholder}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        onKeyDown={onKeyDown}
        className={cn(
          'min-w-0 flex-1 border-none bg-transparent py-[13px] text-[13px] font-medium text-fg outline-none',
          'placeholder:text-fg-muted disabled:opacity-60',
        )}
      />
      <span className="shrink-0 font-mono text-[10.5px] text-fg-muted">
        {t('assistant:tokens.hint', '~{n} tokens', { n: nextTurnTokens })}
      </span>
      <button
        data-testid="assistant-send"
        type="button"
        disabled={blocked}
        onClick={onSubmit}
        aria-label={working ? t('assistant:composer.working', 'Working…') : t('assistant:composer.send', 'Send')}
        className={cn(
          'nb-press flex size-[34px] shrink-0 items-center justify-center rounded-md bg-accent text-accent-fg',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
          'disabled:pointer-events-none disabled:opacity-40',
        )}
      >
        {working ? (
          <Loader2 className="size-[15px] animate-spin" aria-hidden="true" />
        ) : (
          <ArrowUp className="size-[15px]" aria-hidden="true" />
        )}
      </button>
    </div>
  );
}
