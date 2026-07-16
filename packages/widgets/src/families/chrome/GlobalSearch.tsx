/**
 * `global-search` (annex §11) — header search box with an anchored dropdown
 * (quick links when empty, grouped results otherwise) plus a full-page results
 * variant with a type filter rail, mixed-entity result cards and a count summary
 * echoing the query. Evidence: Home, Search Results, Knowledge Base.
 *
 * Composed from @adminium/ui's `SearchInput`, `Popover`, `IconTile` and `Badge`.
 * Filtering runs CLIENT-SIDE over the bound index (annex §11: "search index
 * across entities") — the payload is the index, not a per-keystroke query, so
 * typing never round-trips.
 */

import { Badge, EmptyState, IconTile, Popover, PopoverContent, PopoverTrigger, SearchInput, cn } from '@adminium/ui';
import { useMemo, useState } from 'react';
import type { MouseEvent } from 'react';

import { chromeIcon } from './chrome-icons.js';
import { formatUpdated, highlightParts, isSafeHref, matches, recordRowsOf, stringField } from './chrome-lib.js';
import { globalSearchConfigSchema, globalSearchDemoData } from './chrome-config.js';
import type { GlobalSearchConfig } from './chrome-config.js';
import type { WidgetProps } from '../../registry/types.js';

export { globalSearchConfigSchema, globalSearchDemoData };
export type { GlobalSearchConfig };

const TONES = ['neutral', 'accent', 'pos', 'warn', 'danger', 'info'] as const;
type Tone = (typeof TONES)[number];

export interface SearchResult {
  id: string;
  type: string;
  label: string;
  snippet?: string | undefined;
  meta?: string | undefined;
  href?: string | undefined;
  updated?: string | undefined;
}

/** Project the §3 `record-list` index payload onto results. */
export function searchResultsOf(data: unknown, config: GlobalSearchConfig): SearchResult[] {
  const rows = recordRowsOf(data);
  const out: SearchResult[] = [];
  for (const [index, row] of rows.entries()) {
    const label = stringField(row, config.labelField);
    if (label === undefined) continue;
    const href = stringField(row, config.hrefField);
    out.push({
      id: stringField(row, config.idField) ?? `hit-${index}`,
      type: stringField(row, config.typeField) ?? 'record',
      label,
      snippet: stringField(row, config.snippetField),
      meta: stringField(row, config.metaField),
      ...(isSafeHref(href) ? { href } : {}),
      updated: stringField(row, config.updatedField),
    });
  }
  return out;
}

/**
 * The live filter (annex §11 "live substring filter"). Matches across the
 * label, the snippet and the meta so a query like "shipped" finds a row whose
 * status only appears in its snippet.
 */
export function filterResults(results: readonly SearchResult[], query: string, type: string | null): SearchResult[] {
  return results.filter((result) => {
    if (type !== null && result.type !== type) return false;
    return matches(result.label, query) || matches(result.snippet, query) || matches(result.meta, query);
  });
}

/** Per-type facet counts for the rail — computed over the QUERY-filtered set, ignoring the type facet itself. */
export function facetCounts(results: readonly SearchResult[], query: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const result of filterResults(results, query, null)) {
    counts.set(result.type, (counts.get(result.type) ?? 0) + 1);
  }
  return counts;
}

/** Render a label with its matching span emphasised (annex §11 "match highlighting"). */
function Highlighted({ text, query }: { text: string; query: string }) {
  const parts = highlightParts(text, query);
  if (parts === null) return <>{text}</>;
  return (
    <>
      {parts.before}
      <mark className="bg-accent-soft text-accent">{parts.match}</mark>
      {parts.after}
    </>
  );
}

export interface GlobalSearchViewProps {
  results: readonly SearchResult[];
  variant?: 'dropdown' | 'page';
  typeMeta?: Record<string, { label?: string | undefined; icon?: string | undefined; tone?: string | undefined }> | undefined;
  entityTypes?: readonly string[] | undefined;
  quickLinks?: readonly { label: string; href: string; icon?: string | undefined }[] | undefined;
  maxResults?: number | undefined;
  placeholder?: string | undefined;
  summaryTemplate?: string | undefined;
  allLabel?: string | undefined;
  emptyTitle?: string | undefined;
  emptyBody?: string | undefined;
  locale?: string | undefined;
  referenceTime?: number | undefined;
  onNavigate?: ((href: string) => void) | undefined;
  testId?: string | undefined;
}

function toneOf(value: string | undefined): Tone {
  return value !== undefined && (TONES as readonly string[]).includes(value) ? (value as Tone) : 'neutral';
}

export function GlobalSearchView({
  results,
  variant = 'dropdown',
  typeMeta,
  entityTypes,
  quickLinks,
  maxResults = 20,
  placeholder,
  summaryTemplate,
  allLabel,
  emptyTitle,
  emptyBody,
  locale,
  referenceTime,
  onNavigate,
  testId,
}: GlobalSearchViewProps) {
  const [query, setQuery] = useState('');
  const [type, setType] = useState<string | null>(null);

  const filtered = useMemo(() => filterResults(results, query, type).slice(0, maxResults), [results, query, type, maxResults]);
  const counts = useMemo(() => facetCounts(results, query), [results, query]);

  const click = (event: MouseEvent<HTMLAnchorElement>, href: string | undefined) => {
    if (href === undefined || onNavigate === undefined) return;
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    event.preventDefault();
    onNavigate(href);
  };

  const resultRows = (
    <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
      {filtered.map((result) => {
        const meta = typeMeta?.[result.type];
        const updated = formatUpdated(result.updated, locale, referenceTime);
        return (
          <li key={result.id}>
            <a
              href={result.href ?? '#'}
              data-part="search-result"
              data-type={result.type}
              onClick={(event) => click(event, result.href)}
              className="flex items-start gap-3 rounded-lg p-2.5 no-underline hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              <IconTile size="sm" tone={toneOf(meta?.tone)} icon={chromeIcon(meta?.icon)} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-body-sm font-bold text-fg">
                  <Highlighted text={result.label} query={query} />
                </p>
                {result.snippet !== undefined && (
                  <p className="truncate text-caption text-fg-muted">
                    <Highlighted text={result.snippet} query={query} />
                  </p>
                )}
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <Badge tone={toneOf(meta?.tone)}>{meta?.label ?? result.type}</Badge>
                {updated !== undefined && <span className="text-caption text-fg-subtle">{updated}</span>}
              </div>
            </a>
          </li>
        );
      })}
    </ul>
  );

  const empty = (
    <EmptyState
      compact
      preset="no-matches"
      title={emptyTitle ?? 'No results'}
      body={emptyBody ?? 'Try a different search term.'}
    />
  );

  // ── Full-page variant: facet rail + summary + result cards ───────────────
  if (variant === 'page') {
    const types = entityTypes ?? [...counts.keys()];
    const summary = (summaryTemplate ?? '{count} results for "{query}"')
      .replace('{count}', String(filtered.length))
      .replace('{query}', query);

    return (
      <div data-widget="global-search" data-variant="page" data-testid={testId} className="flex h-full flex-col gap-3 px-4 pb-4">
        <SearchInput
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={placeholder ?? 'Search everything…'}
          aria-label={placeholder ?? 'Search'}
        />
        <div className="flex min-h-0 flex-1 gap-4">
          <nav data-part="facet-rail" aria-label={allLabel ?? 'Filter by type'} className="w-40 shrink-0 overflow-y-auto">
            <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
              <li>
                <button
                  type="button"
                  data-part="facet"
                  data-active={type === null ? 'true' : undefined}
                  aria-pressed={type === null}
                  onClick={() => setType(null)}
                  className={cn(
                    'flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-body-sm',
                    type === null ? 'bg-accent-soft font-bold text-accent' : 'text-fg-muted hover:bg-surface-2',
                  )}
                >
                  <span>{allLabel ?? 'All'}</span>
                  <span className="text-caption">{[...counts.values()].reduce((a, b) => a + b, 0)}</span>
                </button>
              </li>
              {types.map((entityType) => (
                <li key={entityType}>
                  <button
                    type="button"
                    data-part="facet"
                    data-type={entityType}
                    data-active={type === entityType ? 'true' : undefined}
                    aria-pressed={type === entityType}
                    onClick={() => setType(entityType)}
                    className={cn(
                      'flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-body-sm',
                      type === entityType ? 'bg-accent-soft font-bold text-accent' : 'text-fg-muted hover:bg-surface-2',
                    )}
                  >
                    <span className="truncate">{typeMeta?.[entityType]?.label ?? entityType}</span>
                    <span className="text-caption">{counts.get(entityType) ?? 0}</span>
                  </button>
                </li>
              ))}
            </ul>
          </nav>
          <div className="min-w-0 flex-1 overflow-y-auto">
            <p data-part="search-summary" className="mb-2 text-caption text-fg-subtle">
              {summary}
            </p>
            {filtered.length === 0 ? empty : resultRows}
          </div>
        </div>
      </div>
    );
  }

  // ── Header dropdown variant ──────────────────────────────────────────────
  return (
    <div data-widget="global-search" data-variant="dropdown" data-testid={testId} className="px-4 pb-4">
      <Popover open={query !== ''}>
        <PopoverTrigger asChild>
          <div>
            <SearchInput
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={placeholder ?? 'Search everything…'}
              aria-label={placeholder ?? 'Search'}
            />
          </div>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[min(28rem,90vw)] p-1.5">
          {query === '' ? (
            // Empty query → quick links (annex §11), not an empty state.
            <ul data-part="quick-links" className="m-0 flex list-none flex-col gap-0.5 p-0">
              {(quickLinks ?? []).map((link) => (
                <li key={link.href}>
                  <a
                    href={link.href}
                    onClick={(event) => click(event, link.href)}
                    className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-body-sm text-fg-muted no-underline hover:bg-surface-2 hover:text-fg"
                  >
                    <IconTile size="sm" tone="neutral" icon={chromeIcon(link.icon)} />
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          ) : filtered.length === 0 ? (
            empty
          ) : (
            resultRows
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}

export function GlobalSearchWidget({ config, data, onEvent }: WidgetProps<GlobalSearchConfig>) {
  return (
    <GlobalSearchView
      results={searchResultsOf(data, config)}
      variant={config.variant}
      typeMeta={config.typeMeta}
      entityTypes={config.entityTypes}
      quickLinks={config.quickLinks}
      maxResults={config.maxResults}
      placeholder={config.placeholder}
      summaryTemplate={config.summaryTemplate}
      allLabel={config.allLabel}
      emptyTitle={config.emptyTitle}
      emptyBody={config.emptyBody}
      locale={config.format?.locale}
      referenceTime={config.format?.referenceTime}
      onNavigate={(href) => onEvent({ type: 'drill-through', href })}
      testId={config.testId}
    />
  );
}
