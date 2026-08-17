import { Sparkline } from '@adminium/charts';
import type { SparklineTone } from '@adminium/charts';
import { useMaybeT } from '@adminium/i18n/react';
import { DeltaPill, EmptyState, MonoText } from '@adminium/ui';

import { sparklineTableConfigSchema, sparklineTableDemoData } from './tables-tail-config.js';
import type { SparklineTableConfig } from './tables-tail-config.js';
import {
  formatDelta,
  formatMetricValue,
  goodDirectionFor,
  isBadMove,
  numberField,
  resolveLocale,
  seriesField,
  stringField,
  tailRowsOf,
  trendOf,
} from './tables-tail-lib.js';
import type { SparkMetricRow } from './tables-tail-types.js';
import type { WidgetProps } from '../../registry/types.js';

export { sparklineTableConfigSchema, sparklineTableDemoData };
export type { SparklineTableConfig, SparkMetricRow };

/**
 * `sparkline-table` (annex §3) — metric rows: name + an 8-bar sparkline + a mono
 * value + a good/bad-aware delta pill. The Analytics / Metrics Dashboard
 * "metrics at a glance" panel, and the auto-instantiation target for a metrics
 * table with a name column, a value column, and a period-over-period delta.
 *
 * "Good/bad aware" is the whole point of the row: a rising error rate is a
 * DANGER pill even though the arrow points up, so the polarity comes from the
 * metric's `goodDirection` (or the config's per-metric override) rather than
 * from the sign — `DeltaPill`'s `invertGood` does the tone mapping.
 *
 * Read-only: the widget renders, it never writes and never fetches.
 */

export interface SparklineTableProps {
  rows: readonly SparkMetricRow[];
  limit?: number | undefined;
  sparkWidth?: number | undefined;
  sparkVariant?: 'bar' | 'line' | undefined;
  goodDirectionByMetric?: Record<string, string> | undefined;
  locale?: string | undefined;
  emptyTitle?: string | undefined;
  emptyBody?: string | undefined;
  testId?: string | undefined;
}

/** Bad moves draw a danger spark, good moves a positive one (annex "good/bad aware"). */
function sparkToneFor(delta: number | undefined, good: 'up' | 'down'): SparklineTone {
  if (delta === undefined || delta === 0) return 'muted';
  return isBadMove(delta, good) ? 'danger' : 'positive';
}

export function SparklineTable({
  rows,
  limit = 6,
  sparkWidth = 72,
  sparkVariant = 'bar',
  goodDirectionByMetric,
  locale,
  emptyTitle,
  emptyBody,
  testId,
}: SparklineTableProps) {
  const t = useMaybeT();
  const tag = resolveLocale(locale);
  const slice = rows.slice(0, limit);

  if (slice.length === 0) {
    return (
      <EmptyState
        compact
        preset="no-data"
        title={emptyTitle ?? t('ui:widgets.tables.sparklineTable.emptyTitle', 'No metrics to show')}
        body={emptyBody ?? t('ui:widgets.tables.sparklineTable.emptyBody', 'Metrics will appear here once there is data to summarize.')}
      />
    );
  }

  return (
    /* `tabIndex` makes the overflow container reachable, so a keyboard-only user
       can scroll to the rows past the fold (WCAG 2.1.1; axe
       scrollable-region-focusable). Long latent: the a11y sweep only started
       seeing it once Storybook began compiling widget utilities at all, so
       `overflow-auto` had never actually applied in the swept build. */
    <ul data-widget="sparkline-table" data-testid={testId} tabIndex={0} className="h-full overflow-auto px-2 py-1">
      {slice.map((row) => {
        const good = goodDirectionFor(row.name, row.goodDirection, goodDirectionByMetric);
        const trend = trendOf(row.delta);
        const value = formatMetricValue(row.value, tag, {
          ...(row.currency === undefined ? {} : { currency: row.currency }),
          ...(row.unit === undefined ? {} : { unit: row.unit }),
          compact: true,
        });
        return (
          <li
            key={row.id}
            data-part="spark-row"
            data-metric={row.name}
            className="flex items-center gap-3 border-b border-border/60 px-1.5 py-2.5 last:border-b-0"
          >
            <span className="min-w-0 flex-1 truncate text-body-sm text-fg">{row.name}</span>
            {row.spark !== undefined && row.spark.length > 0 && (
              // Decorative: the row's value + delta already carry the meaning in
              // text, so an aria-label here would just double every row for a
              // screen reader (Sparkline is aria-hidden without `label`).
              <Sparkline
                data={row.spark}
                variant={sparkVariant}
                width={sparkWidth}
                height={24}
                tone={sparkToneFor(row.delta, good)}
                className="shrink-0"
              />
            )}
            <MonoText className="shrink-0 text-body-sm font-bold text-fg">{value}</MonoText>
            <span className="flex w-16 shrink-0 justify-end">
              {row.delta !== undefined && (
                <DeltaPill data-part="spark-delta" trend={trend} invertGood={good === 'down'}>
                  {formatDelta(row.delta, tag)}
                </DeltaPill>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** Project an untrusted `record-list` onto `SparkMetricRow`s (04 §3). */
export function sparkRowsOf(data: unknown): SparkMetricRow[] {
  return tailRowsOf(data).map((row, index): SparkMetricRow => {
    const id = row.id;
    const rawValue = row.value;
    return {
      id: typeof id === 'string' || typeof id === 'number' ? id : index,
      name: stringField(row, 'name') ?? stringField(row, 'metric') ?? `#${index + 1}`,
      value: typeof rawValue === 'string' ? rawValue : (numberField(row, 'value') ?? 0),
      delta: numberField(row, 'delta'),
      goodDirection: stringField(row, 'goodDirection') === 'down' ? 'down' : 'up',
      spark: seriesField(row, 'spark'),
      currency: stringField(row, 'currency'),
      unit: stringField(row, 'unit'),
    };
  });
}

export function SparklineTableWidget({ config, data }: WidgetProps<SparklineTableConfig>) {
  return (
    <SparklineTable
      rows={sparkRowsOf(data)}
      limit={config.rows}
      sparkWidth={config.sparkWidth}
      sparkVariant={config.sparkVariant}
      {...(config.goodDirectionByMetric === undefined ? {} : { goodDirectionByMetric: config.goodDirectionByMetric })}
      {...(config.format?.locale === undefined ? {} : { locale: config.format.locale })}
      {...(config.emptyTitle === undefined ? {} : { emptyTitle: config.emptyTitle })}
      {...(config.emptyBody === undefined ? {} : { emptyBody: config.emptyBody })}
      {...(config.testId === undefined ? {} : { testId: config.testId })}
    />
  );
}
