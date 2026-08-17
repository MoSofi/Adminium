// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Metric formatting shared by the KPI + charts families (annex §1 config:
 * `format` currency/percent/duration/compact; research/widget-registry.md
 * Conventions — numbers/dates via `Intl`). Pure module: no React, no DOM.
 */

import { getFormatters } from '@adminium/i18n';

import type { WidgetSharedConfig } from '../registry/shared-config.js';

export type MetricFormat = 'plain' | 'compact' | 'currency' | 'percent' | 'duration';

export interface MetricFormatOptions {
  /** BCP-47 locale; defaults to the runtime locale. */
  locale?: string | undefined;
  /** ISO 4217 code for `currency` (default USD). */
  currency?: string | undefined;
}

/**
 * Pull format options from the shared per-widget config overrides. Empty /
 * whitespace-only `locale` and `currency` are normalized to `undefined` so the
 * runtime defaults apply — an empty BCP-47 locale or ISO-4217 code is accepted
 * by the (free-string) config schema but makes `Intl` throw "Incorrect locale
 * information provided", which would crash the widget on an otherwise-valid
 * stored config (surfaced by the 04-T17 config-schema fuzz).
 */
export function formatOptionsOf(config: Pick<WidgetSharedConfig, 'format'>): MetricFormatOptions {
  const locale = config.format?.locale?.trim();
  const currency = config.format?.currency?.trim();
  return {
    locale: locale ? locale : undefined,
    currency: currency ? currency : undefined,
  };
}

/** Seconds → compact human duration ("45s", "3m 20s", "2h 14m", "3d 4h"). */
function formatDuration(seconds: number): string {
  const sign = seconds < 0 ? '-' : '';
  const s = Math.round(Math.abs(seconds));
  if (s < 60) return `${sign}${s}s`;
  const minutes = Math.floor(s / 60);
  if (minutes < 60) return `${sign}${minutes}m${s % 60 === 0 ? '' : ` ${s % 60}s`}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${sign}${hours}h${minutes % 60 === 0 ? '' : ` ${minutes % 60}m`}`;
  const days = Math.floor(hours / 24);
  return `${sign}${days}d${hours % 24 === 0 ? '' : ` ${hours % 24}h`}`;
}

/**
 * Format one metric value. `percent` treats the value as a fraction
 * (0.74 → "74%"); `duration` treats it as seconds.
 */
export function formatMetricValue(
  value: number,
  format: MetricFormat = 'plain',
  opts: MetricFormatOptions = {},
): string {
  // Metric values are mono/KPI cells → data context (latn digits, aligned in
  // every locale incl. ar_EG) via the @adminium/i18n format layer (§4.2).
  const fmt = getFormatters(opts.locale ?? 'en-US');
  switch (format) {
    case 'compact':
      return fmt.number(value, { notation: 'compact', maximumFractionDigits: 1 });
    case 'currency': {
      const compact = Math.abs(value) >= 100_000;
      return fmt.number(value, {
        style: 'currency',
        currency: opts.currency ?? 'USD',
        notation: compact ? 'compact' : 'standard',
        maximumFractionDigits: compact ? 1 : Math.abs(value) >= 1000 ? 0 : 2,
      });
    }
    case 'percent':
      return fmt.number(value, { style: 'percent', maximumFractionDigits: 1 });
    case 'duration':
      return formatDuration(value);
    case 'plain':
      return fmt.number(value, { maximumFractionDigits: 2 });
  }
}

export type DeltaMode = 'none' | 'pct' | 'abs';

export interface DeltaInfo {
  trend: 'up' | 'down' | 'flat';
  /** Signed formatted text, e.g. "+12.4%" or "-$1,204". */
  text: string;
  /** Signed fraction, e.g. 0.124. */
  pct: number;
}

const FLAT_EPSILON = 0.0005;

/**
 * Compute the delta-pill payload from a `metric+delta` envelope. Returns
 * null when there is nothing to compare (`deltaMode: 'none'`, no prior).
 * Tone/inversion (`invertDeltaGood`) is DeltaPill's job — this only decides
 * direction and text.
 */
export function computeDelta(
  data: { value: number; prior?: number | undefined; deltaPct?: number | undefined },
  mode: DeltaMode,
  format: MetricFormat = 'plain',
  opts: MetricFormatOptions = {},
): DeltaInfo | null {
  if (mode === 'none') return null;
  const pct =
    data.deltaPct ??
    (data.prior === undefined || data.prior === 0
      ? undefined
      : (data.value - data.prior) / Math.abs(data.prior));
  if (pct === undefined) return null;
  const trend: DeltaInfo['trend'] = Math.abs(pct) < FLAT_EPSILON ? 'flat' : pct > 0 ? 'up' : 'down';
  if (mode === 'pct') {
    const text = getFormatters(opts.locale ?? 'en-US').number(pct, {
      style: 'percent',
      maximumFractionDigits: 1,
      signDisplay: 'exceptZero',
    });
    return { trend, text, pct };
  }
  const diff = data.prior === undefined ? data.value * pct : data.value - data.prior;
  const sign = diff > 0 ? '+' : '';
  return { trend, text: `${sign}${formatMetricValue(diff, format, opts)}`, pct };
}
