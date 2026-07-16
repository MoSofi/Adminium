/**
 * `load-older-paginator` (annex §4) — the footer button that appends N older
 * records per click and relabels (or disappears) on exhaustion. Attached to a
 * feed, so `placement: 'inline'` — no WidgetFrame chrome of its own.
 *
 * The presentational component is CONTROLLED (`loaded`/`total`/`onLoadOlder`):
 * the host owns the cursor, exactly as `pagination-footer` does for the grid.
 * The widget wrapper keeps a local `loaded` count so the button is live in
 * demo/story/QA mode; the real binding layer (04 §5) replaces that by driving
 * `loaded` off the query's cursor.
 */

import { Button, MonoText, Spinner } from '@adminium/ui';
import { getFormatters } from '@adminium/i18n';
import { ChevronDown } from 'lucide-react';
import { useState } from 'react';

import type { LoadOlderPaginatorConfig } from './feeds-config.js';
import type { WidgetProps } from '../../registry/types.js';

// Config schema + deterministic demo payload live in the pure `feeds-config`
// module so the registry metadata graph never reaches this component file
// (04 §2.3). Re-exported here to keep existing import points stable.
export { loadOlderPaginatorConfigSchema, loadOlderPaginatorDemoData } from './feeds-config.js';
export type { LoadOlderPaginatorConfig } from './feeds-config.js';

export interface LoadOlderPaginatorProps {
  /** Records already on screen. */
  loaded: number;
  /** Pool size when known; null ⇒ unknown (cursor-only mode). */
  total?: number | null | undefined;
  /** False ⇒ the pool is drained: relabel or hide. */
  hasMore: boolean;
  onLoadOlder: () => void;
  loading?: boolean | undefined;
  hideWhenExhausted?: boolean | undefined;
  showRemaining?: boolean | undefined;
  /** BCP-47 tag for the mono counts (data context → latn digits). */
  locale?: string | undefined;
  labels?:
    | {
        load?: string | undefined;
        loading?: string | undefined;
        exhausted?: string | undefined;
        of?: string | undefined;
      }
    | undefined;
  testId?: string | undefined;
}

export function LoadOlderPaginator({
  loaded,
  total,
  hasMore,
  onLoadOlder,
  loading = false,
  hideWhenExhausted = false,
  showRemaining = true,
  locale,
  labels,
  testId,
}: LoadOlderPaginatorProps) {
  // Annex §4: "relabels/disappears on exhaustion".
  if (!hasMore && hideWhenExhausted) return null;

  // Mono counts render in data context (latn digits, aligned in ar_EG).
  const fmt = getFormatters(locale ?? 'en-US');
  const countText =
    total === null || total === undefined
      ? fmt.number(loaded)
      : `${fmt.number(loaded)} ${labels?.of ?? 'of'} ${fmt.number(total)}`;

  return (
    <div
      data-part="load-older-paginator"
      data-testid={testId}
      data-exhausted={!hasMore}
      className="flex flex-col items-center gap-1.5 border-t border-border px-3 py-2.5"
    >
      {showRemaining ? (
        <MonoText data-part="paginator-count" className="text-micro text-fg-subtle">
          {countText}
        </MonoText>
      ) : null}
      <Button
        size="sm"
        variant="ghost"
        disabled={!hasMore || loading}
        onClick={onLoadOlder}
        iconLeft={loading ? <Spinner size="sm" /> : <ChevronDown />}
      >
        {loading
          ? (labels?.loading ?? 'Loading…')
          : hasMore
            ? (labels?.load ?? 'Load older')
            : (labels?.exhausted ?? 'Nothing older')}
      </Button>
    </div>
  );
}

/** Read the cursor envelope's scalars (04 §3 `record-list`). */
export function cursorStateOf(data: unknown): { loaded: number; total: number | null; hasCursor: boolean } {
  if (typeof data !== 'object' || data === null) return { loaded: 0, total: null, hasCursor: false };
  const record = data as { rows?: unknown; total?: unknown; loaded?: unknown; cursor?: unknown };
  const rows = Array.isArray(record.rows) ? record.rows.length : 0;
  const loaded = typeof record.loaded === 'number' && Number.isFinite(record.loaded) ? record.loaded : rows;
  const total = typeof record.total === 'number' && Number.isFinite(record.total) ? record.total : null;
  return { loaded, total, hasCursor: record.cursor !== undefined && record.cursor !== null };
}

export function LoadOlderPaginatorWidget({ config, data }: WidgetProps<LoadOlderPaginatorConfig>) {
  const initial = cursorStateOf(data);
  const [loaded, setLoaded] = useState(initial.loaded);

  // Exhausted once the pool is drained; with an unknown total the cursor is the
  // only signal there is more.
  const hasMore = initial.total === null ? initial.hasCursor : loaded < initial.total;

  return (
    <LoadOlderPaginator
      loaded={loaded}
      total={initial.total}
      hasMore={hasMore}
      hideWhenExhausted={config.hideWhenExhausted}
      showRemaining={config.showRemaining}
      onLoadOlder={() =>
        setLoaded((current) =>
          initial.total === null ? current + config.batchSize : Math.min(initial.total, current + config.batchSize),
        )
      }
      {...(config.format?.locale === undefined ? {} : { locale: config.format.locale })}
      labels={{
        load: config.label,
        loading: config.loadingLabel,
        exhausted: config.exhaustedLabel,
        of: config.ofLabel,
      }}
      {...(config.testId === undefined ? {} : { testId: config.testId })}
    />
  );
}
