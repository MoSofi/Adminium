/**
 * `chart-funnel` primitive (research/widget-registry.md §2): ordered shrinking
 * stages in two layouts — `horizontal` (start-aligned bars) and `stepped`
 * (centered bars with "N% continue" step rows) — plus an overall-conversion
 * footer. Bars mirror in RTL (categorical part-to-whole, §7.4); the fading
 * accent-alpha ramp keeps in-bar labels readable in both themes. Tokens only.
 */
import type { ReactNode } from 'react';
import { useMaybeT } from '@adminium/i18n/react';

import { funnelLayout } from '../geometry/funnel.js';
import type { FunnelStageInput } from '../geometry/funnel.js';
import type { ChartDir } from '../hooks/useRtl.js';
import { formatCompact } from '../utils/format.js';
import { ChartSurface } from './ChartSurface.js';
import type { ChartLabels } from './ChartSurface.js';

export interface FunnelChartProps {
  data: readonly FunnelStageInput[];
  labels: ChartLabels;
  variant?: 'horizontal' | 'stepped';
  /** Show the per-step "N% continue" retention between stages. */
  showStepConversion?: boolean;
  /** Show the overall first→last conversion footer. */
  overallFooter?: boolean;
  /** Caption for a step row's retention; `pct` is already rounded (default "{pct}% continue"). */
  stepConversionLabel?: (pct: number) => string;
  /** Caption for the overall-conversion footer; `pct` is already rounded (default "{pct}% overall"). */
  overallConversionLabel?: (pct: number) => string;
  height?: number;
  format?: (value: number) => string;
  dir?: ChartDir;
  a11yFallback?: ReactNode;
  className?: string;
}

export function Funnel({
  data,
  labels,
  variant = 'stepped',
  showStepConversion = true,
  overallFooter = true,
  stepConversionLabel,
  overallConversionLabel,
  height = 240,
  format = formatCompact,
  dir,
  a11yFallback,
  className,
}: FunnelChartProps) {
  const t = useMaybeT();
  // Percentages arrive pre-rounded and pass through pre-stringified so ICU
  // never reformats the digits.
  const resolvedStepConversionLabel =
    stepConversionLabel ?? ((pct: number) => t('ui:charts.funnel.stepConversion', '{pct}% continue', { pct: String(pct) }));
  const resolvedOverallConversionLabel =
    overallConversionLabel ?? ((pct: number) => t('ui:charts.funnel.overallConversion', '{pct}% overall', { pct: String(pct) }));
  return (
    <ChartSurface
      labels={labels}
      height={height}
      {...(dir !== undefined ? { dir } : {})}
      {...(a11yFallback !== undefined ? { a11yFallback } : {})}
      {...(className !== undefined ? { className } : {})}
      padding={{ top: 2, right: 2, bottom: overallFooter ? 24 : 2, left: 2 }}
    >
      {({ innerWidth, innerHeight, rtl, mounted }) => {
        if (innerWidth <= 0 || innerHeight <= 0) return null;
        const { stages, overallConversion } = funnelLayout(data);
        if (stages.length === 0) return null;

        const rowHeight = innerHeight / stages.length;
        const barHeight = Math.max(6, rowHeight * (showStepConversion ? 0.54 : 0.72));

        return (
          <g data-funnel="">
            {stages.map((stage, i) => {
              const barWidth = stage.widthFrac * innerWidth;
              const startX = variant === 'stepped' ? stage.offsetFrac * innerWidth : 0;
              const x = rtl ? innerWidth - startX - barWidth : startX;
              const y = i * rowHeight + (rowHeight - barHeight) / 2;
              const textX = rtl ? innerWidth - 8 : 8;
              const anchor = rtl ? 'end' : 'start';
              return (
                <g
                  key={stage.label}
                  className="adm-chart-fade"
                  style={{ '--adm-fade': mounted ? '1' : '0', '--adm-stagger': `${i * 70}ms` }}
                  data-stage={stage.label}
                >
                  <rect x={x} y={y} width={Math.max(0, barWidth)} height={barHeight} rx={4} fill={stage.colorVar} />
                  <text
                    className="adm-chart-axis-label"
                    x={textX}
                    y={y + barHeight / 2 - 3}
                    textAnchor={anchor}
                    dominantBaseline="middle"
                  >
                    {stage.label}
                  </text>
                  <text
                    className="adm-chart-axis-label adm-chart-num"
                    x={textX}
                    y={y + barHeight / 2 + 10}
                    textAnchor={anchor}
                    dominantBaseline="middle"
                  >
                    {`${format(stage.value)} · ${Math.round(stage.overallPct)}%`}
                  </text>
                  {showStepConversion && i > 0 && (
                    <text
                      className="adm-chart-axis-label"
                      x={innerWidth / 2}
                      y={i * rowHeight}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      data-step-conversion=""
                    >
                      {resolvedStepConversionLabel(Math.round(stage.stepPct))}
                    </text>
                  )}
                </g>
              );
            })}
            {overallFooter && (
              <text
                className="adm-chart-tooltip-value"
                x={innerWidth / 2}
                y={innerHeight + 16}
                textAnchor="middle"
                data-overall-conversion=""
              >
                {resolvedOverallConversionLabel(Math.round(overallConversion))}
              </text>
            )}
          </g>
        );
      }}
    </ChartSurface>
  );
}
