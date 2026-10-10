// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What the modal says before anybody has asked anything: what it can see on
 * this page, what it will do with that, and three things worth trying.
 *
 * The greeting is a CLAIM about this instance, so it is written from the facts
 * the server measured rather than from a sentence somebody wrote once: a page
 * with no templates says so. The three suggestions are this page's own copy —
 * clicking one submits it verbatim, so what they say is what gets asked.
 */
import { t } from '../../i18n/t.js';
import type { AssistantStarter } from '../api.js';
import type { AssistantSuggestion } from '../contexts.js';
import { AssistantBubble } from './AssistantBubble.js';
import { ChipList } from './ChipList.js';

export interface IdleProps {
  greeting: string;
  greetingSub: string;
  suggestions: readonly AssistantSuggestion[];
  /** Questions an installed add-on offers on this page of its own: after the page's, under the add-on's name. */
  starters?: readonly AssistantStarter[] | undefined;
  onPick: (label: string) => void;
  disabled?: boolean;
}

export function Idle({ greeting, greetingSub, suggestions, starters, onPick, disabled }: IdleProps) {
  // One group an add-on: the words are that add-on's, and are said to be.
  const byAddOn = new Map<string, AssistantStarter[]>();
  for (const starter of starters ?? []) byAddOn.set(starter.addOn, [...(byAddOn.get(starter.addOn) ?? []), starter]);
  return (
    <div className="flex max-w-[660px] flex-col gap-3.5">
      <AssistantBubble>
        <p className="text-[13.5px] leading-[1.65] text-pretty text-fg">{greeting}</p>
        <p className="mt-[9px] text-body-sm leading-[1.6] text-pretty text-fg-muted">{greetingSub}</p>
      </AssistantBubble>
      <div className="flex flex-col gap-[7px] ps-[39px]">
        <span className="text-micro uppercase text-fg-muted">{t('assistant:try', 'Try')}</span>
        <ChipList
          items={suggestions}
          onPick={onPick}
          {...(disabled === undefined ? {} : { disabled })}
        />
        {[...byAddOn].map(([addOn, list]) => (
          <div key={addOn} data-testid="assistant-add-on-starters" className="mt-2 flex flex-col gap-[7px]">
            <span className="text-micro uppercase text-fg-muted">{t('assistant:tryFrom', 'From {addOn}', { addOn })}</span>
            <ChipList items={list.map((starter) => ({ icon: 'puzzle', label: starter.text }))} onPick={onPick} {...(disabled === undefined ? {} : { disabled })} />
          </div>
        ))}
      </div>
    </div>
  );
}
