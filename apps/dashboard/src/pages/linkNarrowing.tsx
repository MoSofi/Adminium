// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A LINK'S NARROWING, FOR EVERY TEMPLATE THAT LISTS ROWS.
 *
 * The records list reads `?f.<column>=<op>:<value>` through `linkFilters.ts`:
 * the server works the pieces out, the list reads through them, each is a
 * chip. The other templates that list a table's rows — the inbox, the
 * master-detail list, the directory, the board, the calendar, the scheduler,
 * the log viewer and the files page — read their rows through their layout's
 * widget queries instead of a data adapter. They get the same narrowing here,
 * with the same three promises:
 *
 *   - the rows are never drawn before the server has answered (a moment of
 *     the whole table under a link that promised part of it);
 *   - when the answer fails, the page says so and shows the whole list only
 *     when the person asks for it;
 *   - every piece is a chip that can be taken away, and a piece the server
 *     could not use says why.
 *
 * The narrowing is added to every layout query over the page's OWN table —
 * the list and the counts beside it alike, so a count never disagrees with
 * the list it sits over. A query over another table (a calendar's related
 * rows) is left as it is.
 */
import { useCallback, useMemo, type ReactNode } from 'react';
import { Button, EmptyState, Spinner } from '@adminium/ui';
import { LinkFilterChips, type CrudFilter } from '@adminium/widgets';
import type { PageEnvelope } from '@adminium/engine/config';

import { t } from '../i18n/t.js';
import type { FormColumnFactReply } from '../api/pages.js';
import type { ColumnFacts } from '@adminium/widgets';
import { linkPiecesOf, searchWithout, useLinkFilters, usePageSearch, type LinkPiece } from './linkFilters.js';

/** A layout query's own list of conditions holds at most this many. */
const QUERY_FILTERS_MAX = 16;

export interface LinkNarrowing {
  /** The link's pieces, as its address gave them; empty for a page opened plainly. */
  pieces: readonly LinkPiece[];
  link: ReturnType<typeof useLinkFilters>;
  /** The server's tree, once it has answered; null while there is none. */
  where: CrudFilter | null;
  /** Take one piece (by position) or all of them out of the address. */
  drop: (index: number | 'all') => void;
}

export function useLinkNarrowing(page: PageEnvelope, fallbackTable?: string | null): LinkNarrowing {
  const { search, replaceSearch } = usePageSearch();
  const pieces = useMemo(() => linkPiecesOf(search), [search]);
  const link = useLinkFilters(page.source.connectionId, page.source.table ?? fallbackTable ?? null, pieces);
  const where = pieces.length === 0 ? null : (link.data?.where ?? null);
  const drop = useCallback((index: number | 'all') => replaceSearch(searchWithout(search, index)), [replaceSearch, search]);
  return { pieces, link, where, drop };
}

/** Whether a layout query reads the page's own table (`public.x`, or `x` where there is no schema). */
function readsTable(source: unknown, table: string): boolean {
  if (typeof source !== 'object' || source === null) return false;
  const { schema, name } = source as { schema?: unknown; name?: unknown };
  if (typeof name !== 'string') return false;
  return (typeof schema === 'string' ? `${schema}.${name}` : name) === table || name === table;
}

/**
 * The page with the narrowing added to every layout query over its own
 * table; `null` when the narrowing cannot be carried (a nested group, or more
 * conditions than a query takes) — the caller then shows the failure, never
 * the wider list.
 */
export function narrowLayout(page: PageEnvelope, where: CrudFilter | null): PageEnvelope | null {
  if (where === null) return page;
  const table = page.source.table;
  const layout = page.config['layout'] as { items?: { config?: Record<string, unknown> }[] } | undefined;
  if (table === null || table === undefined || layout === undefined || !Array.isArray(layout.items)) return page;
  const conditions = 'and' in where ? where.and : [where];
  if (conditions.some((condition) => 'and' in condition || 'or' in condition)) return null;
  let fits = true;
  const items = layout.items.map((item) => {
    const binding = item.config?.['binding'] as { source?: unknown; filters?: unknown[] } | undefined;
    if (binding === undefined || !readsTable(binding.source, table)) return item;
    const filters = [...(binding.filters ?? []), ...conditions];
    if (filters.length > QUERY_FILTERS_MAX) fits = false;
    return { ...item, config: { ...item.config, binding: { ...binding, filters } } };
  });
  if (!fits) return null;
  return { ...page, config: { ...page.config, layout: { ...layout, items } } };
}

/** A stable name for a narrowing, for the page's data key: a different narrowing is a different read. */
export function narrowingKey(where: CrudFilter | null): string | undefined {
  return where === null ? undefined : JSON.stringify(where);
}

export interface NarrowedPage {
  /** The page to read the rows through: narrowed, or with nothing to read while it cannot be. */
  page: PageEnvelope;
  /** For the page's data key. */
  key: string | undefined;
  /** The rows may not be drawn yet (the answer is pending or failed, or cannot be carried). */
  blocked: boolean;
  /** The server answered, and its narrowing does not fit the page's queries. */
  cannotCarry: boolean;
}

/** The page with no layout queries: nothing is read while the narrowing is not known. */
function readingNothing(page: PageEnvelope): PageEnvelope {
  const layout = page.config['layout'] as Record<string, unknown> | undefined;
  return layout === undefined ? page : { ...page, config: { ...page.config, layout: { ...layout, items: [] } } };
}

/**
 * What a layout template reads its rows through. While the link is being
 * worked out (or failed) it reads NOTHING — not the whole table it would then
 * have to hide — and once the answer is in, every query over the page's own
 * table carries it.
 */
export function useNarrowedPage(page: PageEnvelope, narrowing: LinkNarrowing): NarrowedPage {
  const { pieces, link, where } = narrowing;
  const waiting = pieces.length > 0 && (link.isPending || link.isError);
  return useMemo(() => {
    if (pieces.length === 0) return { page, key: undefined, blocked: false, cannotCarry: false };
    if (waiting) return { page: readingNothing(page), key: 'waiting', blocked: true, cannotCarry: false };
    const narrowed = narrowLayout(page, where);
    if (narrowed === null) return { page: readingNothing(page), key: 'waiting', blocked: true, cannotCarry: true };
    return { page: narrowed, key: narrowingKey(where), blocked: false, cannotCarry: false };
  }, [page, pieces.length, waiting, where]);
}

/**
 * What stands in for the rows while the link is being worked out, or after
 * it failed; `null` once the rows may be drawn.
 */
export function LinkNarrowingGate({ narrowing, cannotCarry = false }: { narrowing: LinkNarrowing; cannotCarry?: boolean }): ReactNode {
  const { pieces, link, drop } = narrowing;
  if (pieces.length === 0) return null;
  if (link.isPending) {
    return (
      <div className="flex flex-1 items-center justify-center py-16" data-testid="link-filters-pending">
        <Spinner label={t('page.linkFilters.pending', 'Applying the link’s filters')} />
      </div>
    );
  }
  if (link.isError || cannotCarry) {
    // Never the whole list in its place: the person chooses to see it.
    return (
      <EmptyState
        tone="warn"
        title={t('page.linkFilters.failedTitle', 'This link’s filters could not be applied')}
        body={t('page.linkFilters.failedBody', 'The list is not shown, so it is not mistaken for the filtered one.')}
        actions={
          <>
            {cannotCarry ? null : (
              <Button size="sm" variant="secondary" onClick={() => void link.refetch()}>
                {t('common.retry', 'Retry')}
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => drop('all')} data-testid="link-filters-show-all">
              {t('page.linkFilters.showAll', 'Show the whole list')}
            </Button>
          </>
        }
      />
    );
  }
  return null;
}

/**
 * The link's chips above a template that has no toolbar of its own to put
 * them in: each piece in words, removable, and the way back to the whole list.
 */
export function LinkFilterBar({
  narrowing,
  columns,
  facts,
}: {
  narrowing: LinkNarrowing;
  /** The table's columns, for their names in the reader's language. */
  columns?: readonly FormColumnFactReply[] | undefined;
  /** What the server says of each column, for a choice column's words. */
  facts?: ColumnFacts | undefined;
}): ReactNode {
  const { link, drop } = narrowing;
  const describeColumn = useCallback(
    (name: string) => {
      const spec = columns?.find((column) => column.spec.name === name)?.spec as { label?: unknown } | undefined;
      const labels = (facts?.[name] as { enumLabels?: Record<string, string> } | undefined)?.enumLabels;
      return {
        label: typeof spec?.label === 'string' ? spec.label : name,
        valueLabel: (value: string) => labels?.[value] ?? value,
      };
    },
    [columns, facts],
  );
  if (narrowing.pieces.length === 0 || link.data === undefined) return null;
  return (
    <div
      role="group"
      aria-label={t('page.linkFilters.group', 'Filters from the link')}
      className="mb-3 flex flex-wrap items-center gap-1.5"
      data-testid="link-filter-bar"
    >
      <LinkFilterChips filters={link.data.filters} describeColumn={describeColumn} onRemove={drop} />
      <Button size="sm" variant="ghost" onClick={() => drop('all')}>
        {t('page.linkFilters.showAll', 'Show the whole list')}
      </Button>
    </div>
  );
}
