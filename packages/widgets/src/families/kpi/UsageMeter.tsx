/**
 * `usage-meter` — quota-consumption card (annex §1): label, "used of
 * limit" mono text, horizontal progress bar; bar and caption flip to
 * warn/danger tones past the thresholds. Powers billing quotas, storage
 * and AI-credit sidebars.
 */

import { MonoText, ProgressBar } from '@adminium/ui';
import { useMaybeT } from '@adminium/i18n/react';

import { formatMetricValue, formatOptionsOf } from '../../lib/format.js';
import { asSingleMetric } from '../../lib/shapes.js';
import type { UsageMeterConfig } from './kpi-config.js';
import type { WidgetProps } from '../../registry/types.js';

// Config schema + deterministic demo payload live in the pure `kpi-config`
// module so the registry metadata graph never reaches this component file
// (04 §2.3). Re-exported here to keep existing import points stable.
export { usageMeterConfigSchema, usageMeterDemoData } from './kpi-config.js';
export type { UsageMeterConfig } from './kpi-config.js';

export function UsageMeter({ config, data, onEvent }: WidgetProps<UsageMeterConfig>) {
  const t = useMaybeT();
  const metric = asSingleMetric(data);
  if (metric === null) {
    return <p className="px-4 pb-4 text-body-sm text-fg-muted">Unexpected data shape.</p>;
  }

  const opts = formatOptionsOf(config);
  const used = metric.value;
  const limit = config.limit;
  const pct = limit > 0 ? (used / limit) * 100 : 0;
  const tone = pct >= config.dangerThreshold ? 'danger' : pct >= config.warnThreshold ? 'warn' : 'accent';
  const unit = config.unit ?? metric.unit;
  const usedText = formatMetricValue(used, 'compact', opts);
  const limitText = formatMetricValue(limit, 'compact', opts);
  const label = config.title ?? t('ui:widgets.kpi.usageMeter.usageLabel', 'Usage');
  // The "used of limit" connector, shared by the visible line and the bar's
  // accessible label so the two never drift apart.
  const ofText = t('ui:widgets.kpi.usageMeter.ofLabel', 'of');

  return (
    <div
      className={`flex h-full flex-col justify-center gap-2 px-4 pb-4 ${config.compact ? 'gap-1.5 px-3 pb-3' : ''}`}
      data-widget="usage-meter"
      data-tone={tone}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-body-sm text-fg-muted">{label}</span>
        <MonoText className="shrink-0 text-body-sm font-semibold text-fg">
          {usedText} <span className="font-normal text-fg-muted">{ofText}</span> {limitText}
          {unit === undefined ? '' : ` ${unit}`}
        </MonoText>
      </div>
      <ProgressBar
        value={Math.min(used, limit)}
        max={limit}
        tone={tone}
        size={config.compact ? 'sm' : 'md'}
        label={`${label}: ${usedText} ${ofText} ${limitText}${unit === undefined ? '' : ` ${unit}`}`}
      />
      {config.ctaLabel !== undefined && config.ctaHref !== undefined && !config.compact && (
        <button
          type="button"
          className="self-start text-body-sm font-medium text-accent hover:underline"
          onClick={() => onEvent({ type: 'drill-through', href: config.ctaHref as string })}
        >
          {config.ctaLabel}
        </button>
      )}
    </div>
  );
}
