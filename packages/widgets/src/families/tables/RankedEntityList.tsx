// SPDX-License-Identifier: AGPL-3.0-only
import { useMaybeT } from '@adminium/i18n/react';
import { EmptyState, MonoText } from '@adminium/ui';
import type { Tone } from '@adminium/ui';

import { rankedEntityListConfigSchema, rankedEntityListDemoData } from './tables-tail-config.js';
import type { RankedEntityListConfig } from './tables-tail-config.js';
import {
  formatMetricValue,
  formatRank,
  numberField,
  rankRows,
  resolveLocale,
  stringField,
  tailRowsOf,
  tailToneOf,
} from './tables-tail-lib.js';
import type { RankedEntity } from './tables-tail-types.js';
import type { WidgetProps } from '../../registry/types.js';

export { rankedEntityListConfigSchema, rankedEntityListDemoData };
export type { RankedEntityListConfig, RankedEntity };

/** Tone → the proportional bar's soft fill (the row track stays surface-2). */
const BAR_TONE: Record<Tone, string> = {
  neutral: 'bg-fg-subtle/25',
  accent: 'bg-accent/25',
  pos: 'bg-pos/25',
  warn: 'bg-warn/25',
  danger: 'bg-danger/25',
  info: 'bg-info/25',
};

/**
 * `ranked-entity-list` (annex §3) — rank number, name, value, and a proportional
 * accent bar (Adminium UI Kit's "top regions", Analytics). Clicking a row can
 * drive a SIBLING widget (the annex's "map flyTo"): the widget emits the row's
 * key as a `drill-through`, and the host owns the cross-widget wiring — a widget
 * never reaches into another widget.
 *
 * The bar is scaled against the LARGEST value in the visible slice, not the
 * grand total, so the leader always fills the track and the rest read as a share
 * of the leader — the comparison the design makes. `rankRows` still carries the
 * total-relative `share` for the `percent` value format.
 *
 * The bar is a background layer behind the row text (`-z-10` under a relative
 * row) rather than a sibling column, so long entity names stay full-width and
 * truncate normally instead of being squeezed by the widest bar.
 */

export interface RankedEntityListProps {
  rows: readonly RankedEntity[];
  n?: number | undefined;
  showBar?: boolean | undefined;
  tone?: Tone | undefined;
  valueFormat?: 'number' | 'compact' | 'percent' | 'currency' | undefined;
  currency?: string | undefined;
  locale?: string | undefined;
  emptyTitle?: string | undefined;
  emptyBody?: string | undefined;
  onSelect?: ((row: RankedEntity) => void) | undefined;
  testId?: string | undefined;
}

export function RankedEntityList({
  rows,
  n = 6,
  showBar = true,
  tone = 'accent',
  valueFormat = 'compact',
  currency,
  locale,
  emptyTitle,
  emptyBody,
  onSelect,
  testId,
}: RankedEntityListProps) {
  const t = useMaybeT();
  const tag = resolveLocale(locale);
  const ranked = rankRows(rows, n);

  if (ranked.length === 0) {
    return (
      <EmptyState
        compact
        preset="no-data"
        title={emptyTitle ?? t('ui:widgets.tables.rankedEntityList.emptyTitle', 'Nothing ranked yet')}
        body={emptyBody ?? t('ui:widgets.tables.rankedEntityList.emptyBody', 'Top entities will appear here once there is data to rank.')}
      />
    );
  }

  return (
    <ol data-widget="ranked-entity-list" data-testid={testId} className="h-full overflow-auto px-2 py-1">
      {ranked.map((row) => {
        const rowTone = tailToneOf(row.tone, tone);
        const value =
          valueFormat === 'percent'
            ? formatMetricValue(row.share * 100, tag, { unit: '%' })
            : formatMetricValue(row.value, tag, {
                compact: valueFormat === 'compact',
                ...(valueFormat === 'currency' && currency !== undefined ? { currency } : {}),
              });
        const content = (
          <>
            {showBar && (
              /*
                The proportional bar. `inset-y-0` is the BLOCK-axis utility (NOT
                `inset-block-0`, which is not a Tailwind utility and silently
                emits no CSS); `start-0` is the logical inline start, so the bar
                grows from the row's leading edge and mirrors under RTL.
              */
              <span
                aria-hidden="true"
                data-part="rank-bar"
                className={`pointer-events-none absolute inset-y-0 start-0 -z-10 rounded-md ${BAR_TONE[rowTone]} w-[var(--rank-bar)]`}
                style={{ '--rank-bar': `${row.pct}%` }}
              />
            )}
            <MonoText className="w-6 shrink-0 text-caption font-bold text-fg-subtle">
              {formatRank(row.rank, tag)}
            </MonoText>
            <span className="min-w-0 flex-1 truncate text-body-sm text-fg">{row.name}</span>
            <MonoText className="shrink-0 text-body-sm font-bold text-fg">{value}</MonoText>
          </>
        );
        return (
          <li key={row.id} data-part="rank-row" data-rank={row.rank} className="relative isolate">
            {onSelect === undefined ? (
              <div className="flex items-center gap-3 rounded-md px-2 py-2.5">{content}</div>
            ) : (
              <button
                type="button"
                onClick={() => onSelect(row)}
                className="flex w-full items-center gap-3 rounded-md px-2 py-2.5 text-start hover:bg-surface-2/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                {content}
              </button>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/** Project an untrusted `record-list` onto `RankedEntity`s (04 §3). */
export function rankedEntitiesOf(data: unknown): RankedEntity[] {
  return tailRowsOf(data).map((row, index): RankedEntity => {
    const id = row.id;
    return {
      id: typeof id === 'string' || typeof id === 'number' ? id : index,
      name: stringField(row, 'name') ?? stringField(row, 'label') ?? `#${index + 1}`,
      value: numberField(row, 'value') ?? numberField(row, 'count') ?? 0,
      key: stringField(row, 'key'),
      tone: stringField(row, 'tone'),
    };
  });
}

export function RankedEntityListWidget({ config, data, onEvent }: WidgetProps<RankedEntityListConfig>) {
  /*
   * Row click → a `drill-through` carrying the row key. `linkTarget` names the
   * SIBLING widget instance the host should drive (annex: "row click can drive
   * sibling widget (map flyTo)"), so it rides the href as a fragment the host
   * resolves; with neither `linkTarget` nor `href` the rows stay inert (and
   * render as plain divs, not dead buttons).
   */
  const target = config.linkTarget;
  const href = config.href;
  const onSelect =
    target === undefined && href === undefined
      ? undefined
      : (row: RankedEntity) => {
          const key = row.key ?? String(row.id);
          onEvent({
            type: 'drill-through',
            href: target === undefined ? (href as string) : `${href ?? ''}#${target}=${encodeURIComponent(key)}`,
          });
        };
  return (
    <RankedEntityList
      rows={rankedEntitiesOf(data)}
      n={config.n}
      showBar={config.showBar}
      valueFormat={config.valueFormat}
      {...(config.tone === undefined ? {} : { tone: tailToneOf(config.tone, 'accent') })}
      {...(config.format?.currency === undefined ? {} : { currency: config.format.currency })}
      {...(config.format?.locale === undefined ? {} : { locale: config.format.locale })}
      {...(config.emptyTitle === undefined ? {} : { emptyTitle: config.emptyTitle })}
      {...(config.emptyBody === undefined ? {} : { emptyBody: config.emptyBody })}
      {...(config.testId === undefined ? {} : { testId: config.testId })}
      {...(onSelect === undefined ? {} : { onSelect })}
    />
  );
}
