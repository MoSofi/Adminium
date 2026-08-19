// SPDX-License-Identifier: AGPL-3.0-only
import { Sparkline } from '@adminium/charts';
import { useMaybeT } from '@adminium/i18n/react';
import { DeltaPill, EmptyState, IconTile, MonoText } from '@adminium/ui';
import { Minus, TrendingDown, TrendingUp } from 'lucide-react';

import { topMoversListConfigSchema, topMoversListDemoData } from './tables-tail-config.js';
import type { TopMoversListConfig } from './tables-tail-config.js';
import {
  formatDelta,
  formatMetricValue,
  goodDirectionFor,
  isBadMove,
  moverTone,
  numberField,
  resolveLocale,
  seriesField,
  stringField,
  tailRowsOf,
  trendOf,
} from './tables-tail-lib.js';
import type { MoverRow } from './tables-tail-types.js';
import { useWidgetHeadingId } from '../../frame/WidgetHeadingContext.js';
import { useScrollRegion } from '../../lib/useScrollRegion.js';
import type { WidgetProps } from '../../registry/types.js';

export { topMoversListConfigSchema, topMoversListDemoData };
export type { TopMoversListConfig, MoverRow };

/**
 * `top-movers-list` (annex §3) — the biggest |delta| rows: a tone-tinted icon
 * tile, the name, a micro sparkline, the value, and a FIXED-WIDTH arrow delta
 * pill so the pills form a clean column instead of ragging with each number's
 * width (annex: "fixed-width arrow delta pill").
 *
 * "Danger for bad movers" (annex) is polarity-aware, not sign-aware: the icon
 * tile and the pill both read `goodDirection`, so a −40% drop in "Checkout
 * errors" is a POSITIVE mover and a +40% rise in it is a danger one.
 *
 * The rows arrive pre-ranked by the binding (annex: "record-list ranked by
 * |delta|"); the widget re-ranks defensively so a hand-written binding that
 * forgets the ORDER BY still shows the actual movers.
 *
 * WIDTH BUDGET, and why the sparkline is the column that yields. Four of the
 * five columns are `shrink-0` — icon tile, sparkline, value, delta pill — so the
 * only flexible one is the NAME, and flexbox spends it first. Measured in the QA
 * gallery's 4-up row (252px of content) that is not a near miss: three metric
 * names rendered 18px wide and TWO rendered at literally zero, and the row still
 * overflowed by 14px, so "Refunds · $3,202.00 · −18.9%" showed as an anonymous
 * icon, a sparkline and two numbers with no way to tell which metric it was.
 *
 * The fixed columns need 204px (12 padding + 4×12 gap + 28 tile + 48 spark + 68
 * pill) before a single character of name or value; a currency value with cents
 * measures ~68px, which leaves ~48px of name only from 320px up. So below 20rem
 * the sparkline is dropped — with its gap, 60px back, enough for the name AND
 * the whole value. It is the right column to lose: its information (direction
 * and size of the move) is already carried twice over by the tone-tinted trend
 * glyph and the delta pill, while the name is the only thing in the row that
 * says WHICH metric moved.
 *
 * A CONTAINER query, not a media query: this widget's width comes from the
 * dashboard grid cell it lands in, not from the viewport. At one 1280px viewport
 * it renders at 1230px full-bleed and at 252px in a 4-up row, and only the
 * container knows which. `@max-xs` measures the container's CONTENT box
 * (verified in Chromium: the sparkline returns at exactly 320px of content, not
 * of border box), which is the same width the budget above is computed against.
 */

export interface TopMoversListProps {
  rows: readonly MoverRow[];
  n?: number | undefined;
  showSparkline?: boolean | undefined;
  sparkWidth?: number | undefined;
  goodDirectionByMetric?: Record<string, string> | undefined;
  locale?: string | undefined;
  emptyTitle?: string | undefined;
  emptyBody?: string | undefined;
  onSelect?: ((row: MoverRow) => void) | undefined;
  testId?: string | undefined;
}

export function TopMoversList({
  rows,
  n = 5,
  showSparkline = true,
  sparkWidth = 48,
  goodDirectionByMetric,
  locale,
  emptyTitle,
  emptyBody,
  onSelect,
  testId,
}: TopMoversListProps) {
  const t = useMaybeT();
  const tag = resolveLocale(locale);
  // The layout above keeps the ROW from clipping; this covers what layout
  // cannot — a list taller than its frame, where the rows below the fold are
  // unreachable without a mouse. Conditional by construction: `useScrollRegion`
  // attaches the stop only while the container really overflows, so a frame tall
  // enough for every row gets no dead tab stop. It is applied only to the
  // READ-ONLY variant below, because when `onSelect` is supplied every row is
  // already a <button> and a container stop would just be a silent extra one in
  // front of N real ones.
  const scroll = useScrollRegion({ labelledBy: useWidgetHeadingId() ?? undefined });
  const ranked = [...rows].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, Math.max(1, n));

  if (ranked.length === 0) {
    return (
      <EmptyState
        compact
        preset="no-data"
        title={emptyTitle ?? t('ui:widgets.tables.topMoversList.emptyTitle', 'No movers')}
        body={emptyBody ?? t('ui:widgets.tables.topMoversList.emptyBody', 'Metrics that changed the most will appear here.')}
      />
    );
  }

  return (
    <ul
      data-widget="top-movers-list"
      data-testid={testId}
      {...(onSelect === undefined ? scroll : {})}
      className={`@container h-full overflow-auto px-2 py-1 ${scroll.className}`}
    >
      {ranked.map((row) => {
        const good = goodDirectionFor(row.name, row.goodDirection, goodDirectionByMetric);
        const bad = isBadMove(row.delta, good);
        const trend = trendOf(row.delta);
        const Glyph = trend === 'flat' ? Minus : trend === 'up' ? TrendingUp : TrendingDown;
        const value = formatMetricValue(row.value, tag, {
          ...(row.currency === undefined ? {} : { currency: row.currency }),
          ...(row.unit === undefined ? {} : { unit: row.unit }),
          compact: true,
        });
        const content = (
          <>
            <IconTile
              size="sm"
              tone={moverTone(row.tone, row.delta, good)}
              icon={<Glyph className="rtl:-scale-x-100" />}
            />
            {/* `title` so a name the row is too narrow to spell out is still
                readable on hover — the text is in the DOM either way, so screen
                readers always had it; this is for the sighted mouse user. */}
            <span className="min-w-0 flex-1 truncate text-body-sm text-fg" title={row.name}>
              {row.name}
            </span>
            {showSparkline && row.spark !== undefined && row.spark.length > 0 && (
              <Sparkline
                data={row.spark}
                variant="line"
                width={sparkWidth}
                height={20}
                tone={bad ? 'danger' : 'positive'}
                className="shrink-0 @max-xs:hidden"
              />
            )}
            <MonoText className="shrink-0 text-body-sm font-bold text-fg">{value}</MonoText>
            {/*
              Fixed-width pill column (annex). `justify-end` is logical — under
              RTL the pills stay on the row's trailing edge with the values.
            */}
            <span className="flex w-[68px] shrink-0 justify-end">
              <DeltaPill data-part="mover-delta" trend={trend} invertGood={good === 'down'}>
                {formatDelta(row.delta, tag)}
              </DeltaPill>
            </span>
          </>
        );
        return (
          <li key={row.id} data-part="mover-row" data-bad={bad ? '' : undefined} data-metric={row.name}>
            {onSelect === undefined ? (
              <div className="flex items-center gap-3 rounded-lg px-1.5 py-2">{content}</div>
            ) : (
              <button
                type="button"
                onClick={() => onSelect(row)}
                className="flex w-full items-center gap-3 rounded-lg px-1.5 py-2 text-start hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                {content}
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Project an untrusted `record-list` onto `MoverRow`s (04 §3). */
export function moverRowsOf(data: unknown): MoverRow[] {
  return tailRowsOf(data).map((row, index): MoverRow => {
    const id = row.id;
    const rawValue = row.value;
    return {
      id: typeof id === 'string' || typeof id === 'number' ? id : index,
      name: stringField(row, 'name') ?? stringField(row, 'metric') ?? `#${index + 1}`,
      value: typeof rawValue === 'string' ? rawValue : (numberField(row, 'value') ?? 0),
      delta: numberField(row, 'delta') ?? 0,
      goodDirection: stringField(row, 'goodDirection') === 'down' ? 'down' : 'up',
      spark: seriesField(row, 'spark'),
      tone: stringField(row, 'tone'),
      currency: stringField(row, 'currency'),
      unit: stringField(row, 'unit'),
    };
  });
}

export function TopMoversListWidget({ config, data, onEvent }: WidgetProps<TopMoversListConfig>) {
  return (
    <TopMoversList
      rows={moverRowsOf(data)}
      n={config.n}
      showSparkline={config.showSparkline}
      sparkWidth={config.sparkWidth}
      {...(config.goodDirectionByMetric === undefined ? {} : { goodDirectionByMetric: config.goodDirectionByMetric })}
      {...(config.format?.locale === undefined ? {} : { locale: config.format.locale })}
      {...(config.emptyTitle === undefined ? {} : { emptyTitle: config.emptyTitle })}
      {...(config.emptyBody === undefined ? {} : { emptyBody: config.emptyBody })}
      {...(config.testId === undefined ? {} : { testId: config.testId })}
      {...(config.href === undefined
        ? {}
        : { onSelect: () => onEvent({ type: 'drill-through', href: config.href as string }) })}
    />
  );
}
