import { getFormatters } from '@adminium/i18n';
import { useMaybeT } from '@adminium/i18n/react';
import { IconButton, MonoText, Select } from '@adminium/ui';
import { ChevronLeft, ChevronRight } from 'lucide-react';

/**
 * `pagination-footer` (annex §3) — keyset flavor (09 §7.1): mono range text
 * ("1–25 of 8,402" — total optional in cursor mode), prev/next, page-size
 * select. Attached to `data-grid`; the host owns the cursor stack (the CRUD
 * API only hands out `cursor.next`, so "prev" replays the host's history).
 */

export const PAGE_SIZE_OPTIONS = [25, 50, 100, 200] as const;

export interface PaginationFooterProps {
  /** 1-based inclusive range of the visible rows (0/0 when empty). */
  rangeStart: number;
  rangeEnd: number;
  /** Total row count when known (offset mode / count probe); null hides it. */
  total?: number | null | undefined;
  hasPrev: boolean;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  pageSize: number;
  pageSizeOptions?: readonly number[] | undefined;
  onPageSizeChange: (size: number) => void;
  disabled?: boolean | undefined;
  /** BCP-47 tag for the mono range counts (data context → latn digits). */
  locale?: string | undefined;
  labels?:
    | {
        prev?: string | undefined;
        next?: string | undefined;
        pageSize?: string | undefined;
        /** Range connective ("of") — i18n. */
        of?: string | undefined;
        /** Range shown when no rows match. */
        empty?: string | undefined;
      }
    | undefined;
  testId?: string | undefined;
}

export function PaginationFooter({
  rangeStart,
  rangeEnd,
  total,
  hasPrev,
  hasNext,
  onPrev,
  onNext,
  pageSize,
  pageSizeOptions = PAGE_SIZE_OPTIONS,
  onPageSizeChange,
  disabled = false,
  locale,
  labels,
  testId,
}: PaginationFooterProps) {
  const t = useMaybeT();
  // Mono range counts render in data context (latn digits, aligned in ar_EG).
  const fmt = getFormatters(locale ?? 'en-US');
  const empty = rangeEnd === 0;
  const rangeText = empty
    ? (labels?.empty ?? t('ui:widgets.tables.paginationFooter.emptyLabel', '0 rows'))
    : `${fmt.number(rangeStart)}–${fmt.number(rangeEnd)}${
        total === null || total === undefined
          ? ''
          : ` ${labels?.of ?? t('ui:widgets.tables.paginationFooter.ofLabel', 'of')} ${fmt.number(total)}`
      }`;

  return (
    <div
      data-part="pagination-footer"
      data-testid={testId}
      /* 13px/16px is the comp's footer inset (Data Table.dc.html); px-3/py-2 sat
         a full step tighter than the toolbar it mirrors at the other end of the
         card, so the two rails read as different components. */
      className="flex items-center justify-between gap-3 border-t border-border bg-surface px-4 py-[13px]"
    >
      <MonoText data-part="pagination-range" className="text-caption text-fg-muted">
        {rangeText}
      </MonoText>
      <div className="flex items-center gap-2">
        <label className="flex items-center gap-1.5 text-caption text-fg-muted">
          {labels?.pageSize ?? t('ui:widgets.tables.paginationFooter.pageSizeLabel', 'Rows')}
          <Select
            aria-label={labels?.pageSize ?? t('ui:widgets.tables.paginationFooter.a11y.pageSize', 'Rows per page')}
            value={String(pageSize)}
            disabled={disabled}
            onChange={(event) => onPageSizeChange(Number(event.target.value))}
            className="h-7 text-caption"
          >
            {pageSizeOptions.map((size) => (
              <option key={size} value={String(size)}>
                {size}
              </option>
            ))}
          </Select>
        </label>
        <div className="flex items-center gap-1">
          <IconButton
            size="sm"
            label={labels?.prev ?? t('ui:widgets.tables.paginationFooter.prevLabel', 'Previous page')}
            disabled={disabled || !hasPrev}
            onClick={onPrev}
          >
            <ChevronLeft className="size-3.5 rtl:-scale-x-100" />
          </IconButton>
          <IconButton
            size="sm"
            label={labels?.next ?? t('ui:widgets.tables.paginationFooter.nextLabel', 'Next page')}
            disabled={disabled || !hasNext}
            onClick={onNext}
          >
            <ChevronRight className="size-3.5 rtl:-scale-x-100" />
          </IconButton>
        </div>
      </div>
    </div>
  );
}
