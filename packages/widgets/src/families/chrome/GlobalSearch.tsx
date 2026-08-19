// SPDX-License-Identifier: AGPL-3.0-only
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

import { Badge, EmptyState, IconTile, Popover, PopoverAnchor, PopoverContent, SearchInput, cn } from '@adminium/ui';
import { useMaybeT } from '@adminium/i18n/react';
import { useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, MouseEvent, ReactNode } from 'react';

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
      {/*
        No background on the mark. It used `bg-accent-soft`, which composited
        over the active row's own accent tint and dropped `--accent` text below
        AA in light — a tint over a tint, the one composition the token gate
        cannot model. Weight and an underline carry the emphasis instead, so the
        highlight is legible on the panel, on the active row, and to anyone who
        does not perceive the hue at all.
      */}
      <mark className="bg-transparent font-bold text-accent underline decoration-2 underline-offset-2">
        {parts.match}
      </mark>
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
  const t = useMaybeT();
  const [query, setQuery] = useState('');
  const [type, setType] = useState<string | null>(null);
  /**
   * Dropdown-only combobox state.
   *
   * `dismissed` is what makes Escape work at all: `open` used to be derived
   * from the query alone, so Radix's dismiss path (Escape, outside click) had
   * nowhere to write and the panel was literally undismissable from the
   * keyboard. Typing re-opens it, so dismissing is never a dead end.
   * `activeRow` is the aria-activedescendant cursor — the panel is navigated
   * without focus ever leaving the field.
   */
  const [dismissed, setDismissed] = useState(false);
  const [activeRow, setActiveRow] = useState(0);
  const listboxId = useId();
  const fieldRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => filterResults(results, query, type).slice(0, maxResults), [results, query, type, maxResults]);
  const counts = useMemo(() => facetCounts(results, query), [results, query]);

  const summary =
    summaryTemplate !== undefined
      ? summaryTemplate.replace('{count}', String(filtered.length)).replace('{query}', query)
      : t('ui:widgets.chrome.globalSearch.summary', '{count} results for "{query}"', { count: filtered.length, query });

  const click = (event: MouseEvent<HTMLAnchorElement>, href: string | undefined) => {
    if (href === undefined || onNavigate === undefined) return;
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    event.preventDefault();
    onNavigate(href);
  };

  const ROW_CLASS =
    'flex items-start gap-3 rounded-lg p-2.5 no-underline hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

  const rowBody = (result: SearchResult) => {
    const meta = typeMeta?.[result.type];
    const updated = formatUpdated(result.updated, locale, referenceTime);
    return (
      <>
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
      </>
    );
  };

  const resultRows = (
    <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
      {filtered.map((result) => (
        <li key={result.id}>
          <a
            href={result.href ?? '#'}
            data-part="search-result"
            data-type={result.type}
            onClick={(event) => click(event, result.href)}
            className={ROW_CLASS}
          >
            {rowBody(result)}
          </a>
        </li>
      ))}
    </ul>
  );

  const empty = (
    <EmptyState
      compact
      preset="no-matches"
      title={emptyTitle ?? t('ui:widgets.chrome.globalSearch.emptyTitle', 'No results')}
      body={emptyBody ?? t('ui:widgets.chrome.globalSearch.emptyBody', 'Try a different search term.')}
    />
  );

  // ── Full-page variant: facet rail + summary + result cards ───────────────
  if (variant === 'page') {
    const types = entityTypes ?? [...counts.keys()];

    return (
      <div data-widget="global-search" data-variant="page" data-testid={testId} className="flex h-full flex-col gap-3 px-[var(--widget-pad)] pb-[var(--widget-pad)]">
        <SearchInput
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={placeholder ?? t('ui:widgets.chrome.globalSearch.placeholder', 'Search everything…')}
          aria-label={placeholder ?? t('ui:widgets.chrome.globalSearch.searchLabel', 'Search')}
        />
        <div className="flex min-h-0 flex-1 gap-4">
          <nav
            data-part="facet-rail"
            aria-label={allLabel ?? t('ui:widgets.chrome.globalSearch.facetRailLabel', 'Filter by type')}
            className="w-40 shrink-0 overflow-y-auto"
          >
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
                  <span>{allLabel ?? t('ui:widgets.chrome.globalSearch.all', 'All')}</span>
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
  //
  // The field is a combobox and the panel IS its listbox (annex §11). Rows are
  // options addressed by `aria-activedescendant`, so focus stays in the input
  // the whole time: Radix's FocusScope is mounted with `loop: true`, which
  // means any tabbable row inside the panel becomes a Tab trap (Tab from the
  // last row wraps back to the first, forever) — hence `tabIndex={-1}` on the
  // rows and the two prevented auto-focus events below.
  const rows: { key: string; href: string | undefined; type: string | undefined; body: ReactNode }[] =
    query === ''
      ? // Empty query → quick links (annex §11), not an empty state.
        (quickLinks ?? []).map((link) => ({
          key: link.href,
          href: link.href,
          type: undefined,
          body: (
            <>
              <IconTile size="sm" tone="neutral" icon={chromeIcon(link.icon)} />
              <span className="min-w-0 flex-1 truncate self-center text-body-sm text-fg-muted">{link.label}</span>
            </>
          ),
        }))
      : filtered.map((result) => ({ key: result.id, href: result.href, type: result.type, body: rowBody(result) }));

  const open = query !== '' && !dismissed;
  // Clamped rather than reset in an effect: the row count changes on every
  // keystroke, and an out-of-range `aria-activedescendant` names an id that no
  // longer exists.
  const activeIndex = rows.length === 0 ? -1 : Math.min(activeRow, rows.length - 1);
  const hasOptions = open && rows.length > 0;
  const optionDomId = (index: number) => `${listboxId}-o${index}`;

  const move = (delta: number) => {
    if (rows.length === 0) return;
    setActiveRow((activeIndex + delta + rows.length) % rows.length);
  };

  /**
   * Choosing the active row runs the row's own click path rather than a second
   * copy of it, so ↵ and a mouse click agree on everything — the `onNavigate`
   * hand-off, and plain browser navigation when the host wires none.
   */
  const chooseActive = () => {
    document.getElementById(optionDomId(activeIndex))?.click();
    setDismissed(true);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (query === '') return;
      event.preventDefault();
      // Re-open on the first arrow after a dismiss: Escape must not cost the
      // user their query.
      if (dismissed) setDismissed(false);
      else move(event.key === 'ArrowDown' ? 1 : -1);
    } else if (event.key === 'Home' || event.key === 'End') {
      if (!hasOptions) return;
      event.preventDefault();
      setActiveRow(event.key === 'Home' ? 0 : rows.length - 1);
    } else if (event.key === 'Enter') {
      if (!hasOptions || activeIndex === -1) return;
      event.preventDefault();
      chooseActive();
    } else if (event.key === 'Escape') {
      // APG: the first Escape dismisses the popup, a second one clears the
      // field. `preventDefault` because some browsers clear `type="search"`
      // natively on the first press, which would skip the dismiss step.
      event.preventDefault();
      if (open) setDismissed(true);
      else if (query !== '') setQuery('');
    }
  };

  return (
    <div data-widget="global-search" data-variant="dropdown" data-testid={testId} className="px-[var(--widget-pad)] pb-[var(--widget-pad)]">
      <Popover
        open={open}
        onOpenChange={(next) => {
          // Radix only ever asks to CLOSE here (Escape, outside click, focus
          // leaving): opening stays the query's job.
          if (!next) setDismissed(true);
        }}
      >
        {/* Anchor, not Trigger: a Trigger stamps `type="button"`,
            `aria-haspopup="dialog"` and `aria-expanded` onto this wrapper
            `div`, which has no button role — attributes AT reports on an
            element that cannot be activated. Anchor is positioning-only. */}
        <PopoverAnchor ref={fieldRef}>
          <SearchInput
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setDismissed(false);
              setActiveRow(0);
            }}
            onKeyDown={onKeyDown}
            placeholder={placeholder ?? t('ui:widgets.chrome.globalSearch.placeholder', 'Search everything…')}
            aria-label={placeholder ?? t('ui:widgets.chrome.globalSearch.searchLabel', 'Search')}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={hasOptions}
            {...(hasOptions
              ? {
                  'aria-controls': listboxId,
                  ...(activeIndex === -1 ? {} : { 'aria-activedescendant': optionDomId(activeIndex) }),
                }
              : {})}
          />
        </PopoverAnchor>
        <PopoverContent
          align="start"
          className="w-[min(28rem,90vw)] p-1.5"
          // Radix spreads consumer props AFTER its own `role="dialog"` +
          // `id`, so these win. With options the panel is the listbox the
          // combobox controls; with none it is a status message, because a
          // listbox may only own options and an empty-state card is not one.
          {...(hasOptions ? { id: listboxId, role: 'listbox', 'aria-label': summary } : { role: 'status' })}
          // Clicking back into the field — to fix a typo or move the caret — is
          // not "outside" to the user. Radix only thinks so because an Anchor,
          // unlike a Trigger, is not registered as the dismiss exception.
          // Focus or a pointer landing anywhere ELSE still closes the panel.
          onInteractOutside={(event) => {
            if (fieldRef.current?.contains(event.target as Node) === true) event.preventDefault();
          }}
          // Radix focuses the panel's first tabbable on open and restores
          // focus on close. Both are wrong here: the panel opens on the first
          // keystroke, so autofocus would yank the caret out of the field
          // mid-word.
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
        >
          {rows.length === 0 ? (
            empty
          ) : (
            <div className="flex flex-col gap-0.5">
              {rows.map((row, index) => (
                <a
                  key={row.key}
                  id={optionDomId(index)}
                  href={row.href ?? '#'}
                  role="option"
                  aria-selected={index === activeIndex}
                  tabIndex={-1}
                  data-part={query === '' ? 'quick-link' : 'search-result'}
                  {...(row.type === undefined ? {} : { 'data-type': row.type })}
                  // Keep the caret in the field on click, so typing can carry
                  // on after a mis-click and the combobox never loses its
                  // activedescendant.
                  onMouseDown={(event) => {
                    if (event.button === 0) event.preventDefault();
                  }}
                  onMouseMove={() => setActiveRow(index)}
                  onClick={(event) => {
                    setDismissed(true);
                    click(event, row.href);
                  }}
                  className={cn(
                    ROW_CLASS,
                    // The keyboard cursor needs a cue that does not depend on
                    // colour discrimination: a 10% tint alone measured ~1.1:1
                    // against the panel, which is invisible to a low-vision user
                    // navigating by arrow key — and this is the ONLY indication
                    // of where Enter will go. The solid tint plus an accent rail
                    // gives a non-colour boundary as well.
                    index === activeIndex &&
                      'bg-accent-soft-solid border-s-2 border-accent ps-[calc(0.75rem-2px)]',
                  )}
                >
                  {row.body}
                </a>
              ))}
            </div>
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
