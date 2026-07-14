/**
 * `usage-meter` — quota-consumption card (annex §1): label, "used of
 * limit" mono text, horizontal progress bar; bar and caption flip to
 * warn/danger tones past the thresholds. Powers billing quotas, storage
 * and AI-credit sidebars.
 */

import { MonoText, ProgressBar } from '@adminium/ui';
import { z } from 'zod';

import { formatMetricValue, formatOptionsOf } from '../../lib/format.js';
import { asSingleMetric } from '../../lib/shapes.js';
import { widgetSharedConfigSchema } from '../../registry/shared-config.js';
import type { WidgetProps } from '../../registry/types.js';

export const usageMeterConfigSchema = widgetSharedConfigSchema.extend({
  /** The quota cap; the data payload carries only the used scalar. */
  limit: z.number().positive().default(100),
  /** Percent thresholds (annex §1 defaults). */
  warnThreshold: z.number().min(0).max(100).default(80),
  dangerThreshold: z.number().min(0).max(100).default(95),
  unit: z.string().optional(),
  ctaLabel: z.string().optional(),
  ctaHref: z.string().optional(),
  /** Sidebar mode: single line + slim bar. */
  compact: z.boolean().default(false),
});

export type UsageMeterConfig = z.infer<typeof usageMeterConfigSchema>;

export function UsageMeter({ config, data, onEvent }: WidgetProps<UsageMeterConfig>) {
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
  const label = config.title ?? 'Usage';

  return (
    <div
      className={`flex h-full flex-col justify-center gap-2 px-4 pb-4 ${config.compact ? 'gap-1.5 px-3 pb-3' : ''}`}
      data-widget="usage-meter"
      data-tone={tone}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-body-sm text-fg-muted">{label}</span>
        <MonoText className="shrink-0 text-body-sm font-semibold text-fg">
          {usedText} <span className="font-normal text-fg-muted">of</span> {limitText}
          {unit === undefined ? '' : ` ${unit}`}
        </MonoText>
      </div>
      <ProgressBar
        value={Math.min(used, limit)}
        max={limit}
        tone={tone}
        size={config.compact ? 'sm' : 'md'}
        label={`${label}: ${usedText} of ${limitText}${unit === undefined ? '' : ` ${unit}`}`}
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
