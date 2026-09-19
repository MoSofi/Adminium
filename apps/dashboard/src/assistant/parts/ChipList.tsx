// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The two chip rows: the three suggestions under the greeting, and the
 * follow-ups above the composer.
 *
 * Both do the same thing — click submits the label as the next question — so
 * they are one component with two sizes rather than two that drift apart.
 * The follow-ups are the model's own words; the suggestions are this page's
 * copy. Neither is ever a link: nothing here navigates.
 */
import { cn } from '@adminium/ui';

import { assistantIcon } from '../icons.js';

export interface ChipListItem {
  label: string;
  icon?: string;
}

export interface ChipListProps {
  items: readonly ChipListItem[];
  onPick: (label: string) => void;
  /** `compact` is the follow-up pill; the default is the tall suggestion row. */
  variant?: 'suggestion' | 'compact';
  disabled?: boolean;
  className?: string;
}

export function ChipList({ items, onPick, variant = 'suggestion', disabled, className }: ChipListProps) {
  if (items.length === 0) return null;
  const compact = variant === 'compact';
  return (
    <div className={cn(compact ? 'flex flex-wrap gap-1.5' : 'flex flex-col gap-[7px]', className)}>
      {items.map((item) => {
        const Icon = assistantIcon(item.icon);
        return (
          <button
            data-testid="assistant-chip"
            key={item.label}
            type="button"
            disabled={disabled === true}
            onClick={() => {
              onPick(item.label);
            }}
            className={cn(
              'nb-press inline-flex items-center border border-border text-start transition-colors',
              'hover:border-accent hover:text-accent disabled:pointer-events-none disabled:opacity-40',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
              compact
                ? 'gap-1.5 rounded-[20px] bg-surface-2 px-[11px] py-[5px] text-caption font-semibold text-fg-muted'
                : 'gap-[9px] rounded-[12px] bg-surface px-3.5 py-[11px] text-body-sm font-semibold leading-[1.4] text-fg',
            )}
          >
            {Icon === null ? null : <Icon className="size-3.5 shrink-0 text-fg-muted" aria-hidden="true" />}
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
