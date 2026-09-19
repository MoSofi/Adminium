// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The assistant asking something back, and the tiles that answer it.
 *
 * A question is a real stop: the work does not continue until every group has
 * a pick, and the go button says so plainly rather than being merely disabled.
 * That is the difference between "you must choose" and "this is broken".
 *
 * NO GROUPS IS A VALID SHAPE. A plain answer — "a campaign goes to a list; a
 * template is reused" — renders as the same card with no tiles and no go row.
 * It is the same speaker saying something that needed no work, so it should
 * not look like a different kind of thing.
 *
 * The tiles are buttons with `aria-pressed`, not radios: they are not a form
 * field, nothing submits them, and a pick can be changed until the go button
 * is pressed.
 */
import { Button, cn } from '@adminium/ui';
import { ArrowRight, Check } from 'lucide-react';

import { t } from '../../i18n/t.js';
import type { AssistantAsk } from '../api.js';
import { AssistantBubble } from './AssistantBubble.js';

export interface AskCardProps {
  /** What the assistant said — the ask-back text, or a plain answer. */
  say: string;
  ask: AssistantAsk | null;
  picks: Record<string, string>;
  onPick: (groupKey: string, optionKey: string) => void;
  onGo: () => void;
  /** A question already answered by a later turn is read-only. */
  answered?: boolean;
}

export function AskCard({ say, ask, picks, onPick, onGo, answered }: AskCardProps) {
  const groups = ask?.groups ?? [];
  const ready = groups.length > 0 && groups.every((group) => picks[group.key] !== undefined);
  const locked = answered === true;
  return (
    <AssistantBubble testId="assistant-ask">
      {say === '' ? null : <p className="mb-3.5 text-[13.5px] leading-[1.6] text-pretty text-fg">{say}</p>}
      {groups.map((group) => (
        <div key={group.key} className="mb-[15px]">
          <div className="mb-2 text-micro uppercase text-fg-muted">{group.title}</div>
          <div className="grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(190px,1fr))]">
            {group.options.map((option) => {
              const picked = picks[group.key] === option.key;
              return (
                <button
                  data-testid="assistant-pick"
                  key={option.key}
                  type="button"
                  aria-pressed={picked}
                  disabled={locked}
                  onClick={() => {
                    onPick(group.key, option.key);
                  }}
                  className={cn(
                    'nb-press flex items-start gap-[9px] rounded-[11px] border p-[10px_12px] text-start transition-colors',
                    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
                    'disabled:pointer-events-none',
                    picked
                      ? 'border-accent bg-accent-soft ring-[3px] ring-accent/12'
                      : 'border-border bg-surface hover:border-accent',
                  )}
                >
                  <span
                    className={cn(
                      'mt-px flex size-4 shrink-0 items-center justify-center rounded-full border',
                      picked ? 'border-accent bg-accent text-accent-fg' : 'border-border-strong',
                    )}
                  >
                    {picked ? <Check className="size-2.5" aria-hidden="true" /> : null}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-body-sm font-bold leading-[1.3] text-fg">{option.label}</span>
                    {option.detail === '' ? null : (
                      <span className="mt-0.5 block text-[11px] leading-[1.4] text-fg-muted">{option.detail}</span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
      {groups.length === 0 || locked ? null : (
        <div className="flex items-center gap-[11px] border-t border-border pt-[13px]">
          <span className="text-caption text-fg-muted">
            {ready
              ? (ask?.readyLabel ?? t('assistant:ask.ready', 'Ready'))
              : t('assistant:ask.pick', 'Pick one option in each group')}
          </span>
          <Button
            data-testid="assistant-ask-go"
            type="button"
            size="sm"
            variant={ready ? 'primary' : 'ghost'}
            disabled={!ready}
            onClick={onGo}
            className="ms-auto"
            iconLeft={<ArrowRight aria-hidden="true" />}
          >
            {ready
              ? (ask?.goLabel ?? t('assistant:ask.continue', 'Continue'))
              : t('assistant:ask.waiting', 'Waiting on you')}
          </Button>
        </div>
      )}
    </AssistantBubble>
  );
}
