/**
 * `period-comparison` (annex §1) — two labeled progress bars (this period vs
 * last) with a computed diff footer ("+$13.1k (37.3%) higher"). Renders only the
 * loaded state — skeleton/empty/error are WidgetFrame's job.
 *
 * SHAPE: the annex's "two `single-metric` values for adjacent windows" IS the
 * `metric+delta` envelope (`value` = this window, `prior` = last), so the shared
 * `computeDelta` produces the footer figure — no bespoke shape, and the
 * "down-is-good" inversion behaves identically to `kpi-stat-card`.
 *
 * Both bars are scaled against the LARGER of the two values, not each against
 * itself: the comparison is the whole point, so the shorter bar must actually
 * read as shorter.
 */

import { MonoText, ProgressBar } from '@adminium/ui';
import { useMaybeT } from '@adminium/i18n/react';

import { computeDelta, formatMetricValue, formatOptionsOf } from '../../lib/format.js';
import { asMetricDelta } from '../../lib/shapes.js';
import type { PeriodComparisonConfig } from './kpi-config.js';
import type { WidgetProps } from '../../registry/types.js';

// Config schema + deterministic demo payload live in the pure `kpi-config`
// module so the registry metadata graph never reaches this component file
// (04 §2.3). Re-exported here to keep existing import points stable.
export { periodComparisonConfigSchema, periodComparisonDemoData } from './kpi-config.js';
export type { PeriodComparisonConfig } from './kpi-config.js';

function Bar({
  label,
  text,
  value,
  max,
  tone,
}: {
  label: string;
  text: string;
  value: number;
  max: number;
  tone: 'accent' | 'neutral';
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-caption text-fg-muted">{label}</span>
        <MonoText className="shrink-0 text-body-sm font-semibold text-fg">{text}</MonoText>
      </div>
      <ProgressBar value={value} max={max} tone={tone} size="md" label={`${label}: ${text}`} />
    </div>
  );
}

export function PeriodComparison({ config, data }: WidgetProps<PeriodComparisonConfig>) {
  const t = useMaybeT();
  const metric = asMetricDelta(data);
  if (metric === null) {
    return <p className="px-4 pb-4 text-body-sm text-fg-muted">Unexpected data shape.</p>;
  }

  const opts = formatOptionsOf(config);
  const current = metric.value;
  const prior = metric.prior ?? 0;
  // Scale both bars against the larger value so the comparison reads visually.
  const max = Math.max(Math.abs(current), Math.abs(prior)) || 1;

  const delta = computeDelta(metric, 'abs', config.metricFormat, opts);
  const pct = computeDelta(metric, 'pct', config.metricFormat, opts);
  const direction =
    delta === null || delta.trend === 'flat'
      ? (config.flatLabel ?? t('ui:widgets.kpi.periodComparison.flatLabel', 'flat'))
      : delta.trend === 'up'
        ? (config.higherLabel ?? t('ui:widgets.kpi.periodComparison.higherLabel', 'higher'))
        : (config.lowerLabel ?? t('ui:widgets.kpi.periodComparison.lowerLabel', 'lower'));
  // Tone follows "is this good", not "is this up" — invertDeltaGood flips it
  // for costs / error rates / churn, exactly as the delta pill does.
  const good = delta === null || delta.trend === 'flat' ? null : config.invertDeltaGood ? delta.trend === 'down' : delta.trend === 'up';
  const footerTone = good === null ? 'text-fg-muted' : good ? 'text-pos' : 'text-danger';

  return (
    <div
      className="flex h-full flex-col justify-center gap-3 px-4 pb-4 compact:gap-2 compact:px-3 compact:pb-3"
      data-widget="period-comparison"
      data-trend={delta?.trend ?? 'flat'}
    >
      <Bar
        label={config.periodALabel ?? t('ui:widgets.kpi.periodComparison.periodALabel', 'This period')}
        text={formatMetricValue(current, config.metricFormat, opts)}
        value={Math.abs(current)}
        max={max}
        tone="accent"
      />
      <Bar
        label={config.periodBLabel ?? t('ui:widgets.kpi.periodComparison.periodBLabel', 'Last period')}
        text={formatMetricValue(prior, config.metricFormat, opts)}
        value={Math.abs(prior)}
        max={max}
        tone="neutral"
      />
      {delta === null ? null : (
        <p data-part="diff-footer" className={`truncate text-caption font-semibold ${footerTone}`}>
          <MonoText>{delta.text}</MonoText>
          {pct === null ? '' : <MonoText>{` (${pct.text})`}</MonoText>}
          {` ${direction}`}
        </p>
      )}
    </div>
  );
}
