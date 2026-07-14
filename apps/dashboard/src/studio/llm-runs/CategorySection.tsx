/**
 * One collapsible category section of the review screen (§10.3 body): a header
 * with the group icon, localized name, a total-count badge and an accepted
 * count, plus a per-category select-all (tri-state) that never selects
 * `rejects-heuristic` or `user-locked` rows (acceptance criterion 12). The body
 * is the group's `SuggestionRow` list.
 */
import { useId, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { Badge, Checkbox, CountBadge, cn } from '@adminium/ui';

import { t } from '../../i18n/t.js';
import { lucideByName } from '../../lib/lucide.js';
import type { SuggestionDiff } from '../ai/api.js';
import { SuggestionRow } from './SuggestionRow.js';
import { acceptedCount, selectAllState, type ReviewGroup } from './model.js';

export interface CategorySectionProps {
  group: ReviewGroup;
  selected: ReadonlySet<string>;
  readOnly: boolean;
  /** Collapsed by default when the whole group agrees (§8.2). */
  defaultCollapsed: boolean;
  onToggleRow: (id: string, next: boolean) => void;
  onSelectAll: (ids: readonly SuggestionDiff[], next: boolean) => void;
}

export function CategorySection({
  group,
  selected,
  readOnly,
  defaultCollapsed,
  onToggleRow,
  onSelectAll,
}: CategorySectionProps) {
  const [open, setOpen] = useState(!defaultCollapsed);
  const bodyId = useId();
  const GroupIcon = lucideByName(group.def.icon);
  const label = t(group.def.labelKey, group.def.labelDefault);
  const accepted = acceptedCount(group.rows, selected);
  const state = selectAllState(group.rows, selected);

  return (
    <section
      data-testid="category-section"
      data-group={group.def.id}
      className="overflow-hidden rounded-xl border border-border bg-surface"
    >
      <div className="flex items-center gap-2 bg-surface-2 px-3 py-2">
        {readOnly ? null : (
          <Checkbox
            checked={state === 'all' ? true : state === 'some' ? 'indeterminate' : false}
            aria-label={t('studio.llmRuns.review.section.selectAllAria', 'Select all in {group}', { group: label })}
            onCheckedChange={(next) => onSelectAll(group.rows, next === true)}
          />
        )}
        <button
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-sm text-start focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          onClick={() => setOpen((value) => !value)}
        >
          <ChevronRight
            aria-hidden
            className={cn('size-4 shrink-0 text-fg-subtle transition-transform rtl:-scale-x-100', open && 'rotate-90')}
          />
          <GroupIcon aria-hidden className="size-4 shrink-0 text-fg-muted" />
          <span className="truncate text-body-sm font-semibold text-fg">{label}</span>
          <CountBadge>{group.rows.length}</CountBadge>
          {accepted > 0 ? (
            <Badge tone="pos">
              {t('studio.llmRuns.review.section.acceptedCount', '{n} accepted', { n: accepted })}
            </Badge>
          ) : null}
        </button>
      </div>

      {open ? (
        <ul id={bodyId} className="flex flex-col gap-2 p-3">
          {group.rows.map((diff) => (
            <SuggestionRow
              key={diff.id}
              diff={diff}
              checked={selected.has(diff.id)}
              readOnly={readOnly}
              onToggle={onToggleRow}
            />
          ))}
        </ul>
      ) : null}
    </section>
  );
}
