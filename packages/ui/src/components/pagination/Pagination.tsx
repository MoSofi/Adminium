import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { ComponentPropsWithRef } from 'react';

import { cn } from '../../lib/cn.js';
import { MonoText } from '../mono-text/MonoText.js';

export interface PaginationProps extends Omit<ComponentPropsWithRef<'nav'>, 'children' | 'onChange'> {
  /** Current page, 1-based. */
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
  /** Pages shown on each side of the current page. Default 1. */
  siblingCount?: number | undefined;
  /** Accessible name for the nav (required — i18n, e.g. "Pagination"). */
  label: string;
  /** Accessible label for the previous button (required — i18n). */
  previousLabel: string;
  /** Accessible label for the next button (required — i18n). */
  nextLabel: string;
  /** Accessible label for a page button; default `Page {n}` is NOT provided — i18n. */
  pageLabel: (page: number) => string;
}

/** Build the visible page list with `null` gaps (ellipses). */
export function paginationRange(page: number, pageCount: number, siblingCount = 1): (number | null)[] {
  const total = siblingCount * 2 + 5; // first + last + current + siblings + 2 ellipses
  if (pageCount <= total) return Array.from({ length: pageCount }, (_, i) => i + 1);

  const start = Math.max(2, Math.min(page - siblingCount, pageCount - siblingCount * 2 - 2));
  const end = Math.min(pageCount - 1, Math.max(page + siblingCount, siblingCount * 2 + 3));

  const range: (number | null)[] = [1];
  if (start > 2) range.push(null);
  for (let i = start; i <= end; i++) range.push(i);
  if (end < pageCount - 1) range.push(null);
  range.push(pageCount);
  return range;
}

const squareClasses =
  'inline-flex size-8 shrink-0 items-center justify-center rounded-md text-caption font-semibold ' +
  'transition-colors duration-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ' +
  'disabled:pointer-events-none disabled:opacity-40';

/**
 * Pagination — 32px square page buttons (active = accent fill), mono numbers,
 * RTL-mirrored chevrons, ellipsis windowing
 * (research/design-system.md §3 Tier 3).
 */
export function Pagination({
  page,
  pageCount,
  onPageChange,
  siblingCount = 1,
  label,
  previousLabel,
  nextLabel,
  pageLabel,
  className,
  ...props
}: PaginationProps) {
  const range = paginationRange(page, pageCount, siblingCount);
  return (
    <nav aria-label={label} className={cn('flex items-center gap-1', className)} {...props}>
      <button
        type="button"
        aria-label={previousLabel}
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
        className={cn(squareClasses, 'nb-ib text-fg-muted hover:text-fg')}
      >
        <ChevronLeft className="size-4 rtl:-scale-x-100" aria-hidden="true" />
      </button>
      {range.map((entry, index) =>
        entry === null ? (
          <span
            key={`gap-${index}`}
            aria-hidden="true"
            className="inline-flex size-8 items-end justify-center pb-2 text-caption text-fg-subtle"
          >
            …
          </span>
        ) : (
          <button
            key={entry}
            type="button"
            aria-label={pageLabel(entry)}
            aria-current={entry === page ? 'page' : undefined}
            onClick={() => onPageChange(entry)}
            className={cn(
              squareClasses,
              entry === page ? 'bg-accent text-accent-fg shadow-glow' : 'nb-ib text-fg-muted hover:text-fg',
            )}
          >
            <MonoText>{entry}</MonoText>
          </button>
        ),
      )}
      <button
        type="button"
        aria-label={nextLabel}
        disabled={page >= pageCount}
        onClick={() => onPageChange(page + 1)}
        className={cn(squareClasses, 'nb-ib text-fg-muted hover:text-fg')}
      >
        <ChevronRight className="size-4 rtl:-scale-x-100" aria-hidden="true" />
      </button>
    </nav>
  );
}
