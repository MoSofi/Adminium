// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "There is an add-on for that" (Milo Panel, section 08).
 *
 * THE WORDS ARE THE SERVER'S LIST'S, never the model's: the name and the one
 * line come from what this server has in its store or its catalogue. The
 * model only pointed at a key.
 *
 * THE WAY IN IS OFFERED TO WHO CAN TAKE IT. Someone who may install gets the
 * button to the add-ons screen; anyone else gets a line saying who can. The
 * assistant never installs anything, and neither does this card.
 */
import { cn } from '@adminium/ui';
import { ArrowRight, Puzzle, UserCog } from 'lucide-react';

import type { AssistantSuggestion } from '../api.js';
import { t } from '../../i18n/t.js';

export interface SuggestionCardProps {
  suggestion: AssistantSuggestion;
  /** Go to where add-ons are installed. Called only for a person who may install. */
  onOpen: (key: string) => void;
}

export function SuggestionCard({ suggestion, onOpen }: SuggestionCardProps) {
  return (
    <div
      data-testid="assistant-suggestion"
      className="min-w-0 flex-1 rounded-[16px] border border-border bg-surface p-3 shadow-menu"
    >
      <div className="flex flex-col gap-[9px] rounded-[12px] border border-border bg-surface-2 p-3">
        <div className="flex items-center gap-[11px]">
          <span className="flex size-[38px] shrink-0 items-center justify-center rounded-[10px] bg-accent-soft-solid text-accent">
            <Puzzle className="size-[18px]" aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1 text-[13px] font-extrabold text-fg">{suggestion.name}</span>
          {suggestion.mayInstall ? (
            <button
              type="button"
              data-testid="assistant-suggestion-open"
              onClick={() => onOpen(suggestion.key)}
              aria-label={t('assistant:suggestion.openLabel', 'Open {addOn} in Add-ons', { addOn: suggestion.name })}
              className={cn(
                'nb-press flex shrink-0 items-center gap-1.5 rounded-[9px] border border-accent bg-accent px-[11px] py-[7px] text-[12px] font-bold text-accent-fg',
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
              )}
            >
              {t('assistant:suggestion.open', 'Open')}
              <ArrowRight className="size-3.5 rtl:-scale-x-100" aria-hidden="true" />
            </button>
          ) : null}
        </div>
        {suggestion.line === '' ? null : <p className="m-0 text-pretty text-[12px] leading-[1.55] text-fg-muted">{suggestion.line}</p>}
        {suggestion.mayInstall ? null : (
          <span className="flex items-center gap-1.5 text-[11.5px] text-fg-subtle">
            <UserCog className="size-3 shrink-0" aria-hidden="true" />
            {t('assistant:suggestion.askAdmin', 'Ask an administrator to install this.')}
          </span>
        )}
      </div>
    </div>
  );
}
