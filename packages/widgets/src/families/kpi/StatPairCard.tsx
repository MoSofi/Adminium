/**
 * `stat-pair-card` (annex §1) — two large mono metrics side by side with a
 * vertical divider (MRR / LTV, where LTV may be a derived formula over MRR).
 * Renders only the loaded state — skeleton/empty/error are WidgetFrame's job.
 *
 * RTL: the divider is a logical `border-s` on the second column, so the pair
 * genuinely swaps sides under `dir="rtl"` and the rule lands between them either
 * way. `flex` handles the ordering; nothing here is physically positioned.
 */

import { MonoText } from '@adminium/ui';

import { formatMetricValue, formatOptionsOf } from '../../lib/format.js';
import { applyDerived } from './kpi-lib.js';
import type { StatPairCardConfig } from './kpi-config.js';
import type { WidgetProps } from '../../registry/types.js';

// Config schema + deterministic demo payload live in the pure `kpi-config`
// module so the registry metadata graph never reaches this component file
// (04 §2.3). Re-exported here to keep existing import points stable.
export { statPairCardConfigSchema, statPairCardDemoData } from './kpi-config.js';
export type { StatPairCardConfig } from './kpi-config.js';

/** Read a numeric scalar off the payload by configured field name (04 §5). */
export function scalarAt(data: unknown, field: string): number | null {
  if (typeof data !== 'object' || data === null) return null;
  const raw = (data as Record<string, unknown>)[field];
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string' && raw.trim() !== '' && Number.isFinite(Number(raw))) return Number(raw);
  return null;
}

/**
 * The two sides of the pair. Side B is the derived formula's result when one is
 * configured, else the payload's `valueBField`. Either side may be null — an
 * unbound column renders an em-dash rather than "NaN".
 */
export function statPairValues(
  data: unknown,
  config: Pick<StatPairCardConfig, 'valueAField' | 'valueBField' | 'derivedFormula' | 'derivedOperand'>,
): { a: number | null; b: number | null } {
  const a = scalarAt(data, config.valueAField);
  if (config.derivedFormula !== 'none') {
    return { a, b: a === null ? null : applyDerived(a, config.derivedFormula, config.derivedOperand) };
  }
  return { a, b: scalarAt(data, config.valueBField) };
}

function Side({ label, value }: { label: string | undefined; value: string }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      {label === undefined ? null : <p className="truncate text-body-sm text-fg-muted">{label}</p>}
      <MonoText className="block truncate text-[24px] font-bold leading-tight text-fg compact:text-[20px]">
        {value}
      </MonoText>
    </div>
  );
}

export function StatPairCard({ config, data }: WidgetProps<StatPairCardConfig>) {
  const { a, b } = statPairValues(data, config);
  if (a === null && b === null) {
    return <p className="px-[var(--widget-pad)] pb-[var(--widget-pad)] text-body-sm text-fg-muted">Unexpected data shape.</p>;
  }

  const opts = formatOptionsOf(config);
  const textA = a === null ? '—' : formatMetricValue(a, config.metricAFormat, opts);
  const textB = b === null ? '—' : formatMetricValue(b, config.metricBFormat, opts);

  return (
    <div
      className="flex h-full items-center gap-4 px-[var(--widget-pad)] pb-[var(--widget-pad)] compact:gap-3"
      data-widget="stat-pair-card"
      data-derived={config.derivedFormula}
    >
      <Side label={config.metricALabel} value={textA} />
      {/* Logical border → the rule sits between the pair in LTR and RTL alike. */}
      <div className="flex min-w-0 flex-1 border-s border-border ps-4 compact:ps-3">
        <Side label={config.metricBLabel} value={textB} />
      </div>
    </div>
  );
}
