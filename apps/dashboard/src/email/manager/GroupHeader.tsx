// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A group's heading row (comp 359-365): icon tile, label, the sub pill and a
 * rule that takes the rest of the width. Topic groups carry the category's
 * icon; language groups the `languages` glyph (39 Appendix A §M6).
 */
import { Languages, Megaphone, Receipt, Sprout } from 'lucide-react';
import { cn } from '@adminium/ui';

import type { EmailCategory } from '../api.js';

export interface GroupHeaderProps {
  icon: 'languages' | EmailCategory;
  label: string;
  sub: string;
  /** The list layout's tighter bottom margin (comp 415 vs 360). */
  dense?: boolean | undefined;
}

/** The comp's category icons (`catIcon`, 1074), as components — no name lookup on a hot path. */
export function CategoryIcon({ category, className }: { category: EmailCategory; className?: string | undefined }) {
  switch (category) {
    case 'transactional':
      return <Receipt className={className} aria-hidden="true" />;
    case 'lifecycle':
      return <Sprout className={className} aria-hidden="true" />;
    case 'marketing':
      return <Megaphone className={className} aria-hidden="true" />;
  }
}

export function GroupHeader({ icon, label, sub, dense = false }: GroupHeaderProps) {
  return (
    <div data-testid="email-group-header" className={cn('flex items-center gap-2.5', dense ? 'mb-[11px]' : 'mb-[13px]')}>
      <div className="flex size-7 shrink-0 items-center justify-center rounded-[9px] bg-surface-3 text-fg-muted">
        {icon === 'languages' ? (
          <Languages className="size-[15px]" aria-hidden="true" />
        ) : (
          <CategoryIcon category={icon} className="size-[15px]" />
        )}
      </div>
      <h2 className="min-w-0 truncate text-[13.5px] font-extrabold tracking-[-.01em] text-fg">{label}</h2>
      {sub === '' ? null : (
        <span
          data-testid="email-group-sub"
          className="shrink-0 whitespace-nowrap rounded-[20px] bg-surface-3 px-[9px] py-0.5 text-[10.5px] font-bold text-fg-muted"
        >
          {sub}
        </span>
      )}
      <div className="h-px flex-1 bg-border" aria-hidden="true" />
    </div>
  );
}
