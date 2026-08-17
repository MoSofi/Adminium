// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `chart-funnel` primitive (research/widget-registry.md §2): ordered shrinking
 * stages in two layouts — `horizontal` (start-aligned bars) and `stepped`
 * (centered bars with "N% continue" step rows) — plus an overall-conversion
 * footer. Bars mirror in RTL (categorical part-to-whole, §7.4). Label and value
 * ride a line above the bar, never on it: on the accent ramp no foreground
 * token clears AA at every stage. Tokens only.
 */
import type { ReactNode } from 'react';
import { useMaybeT } from '@adminium/i18n/react';

import { funnelLayout } from '../geometry/funnel.js';
import type { FunnelStageInput } from '../geometry/funnel.js';
import type { ChartDir } from '../hooks/useRtl.js';
import { formatCompact } from '../utils/format.js';
import { ChartSurface } from './ChartSurface.js';
import type { ChartLabels } from './ChartSurface.js';

/** Caption line above each bar: 12.5px label + 3px to the track (design 164). */
const LABEL_BLOCK = 16;

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
      padding={{ top: 8, right: 2, bottom: overallFooter ? 24 : 2, left: 2 }}
    >
      {({ innerWidth, innerHeight, rtl, mounted }) => {
        if (innerWidth <= 0 || innerHeight <= 0) return null;
        const { stages, overallConversion } = funnelLayout(data);
        if (stages.length === 0) return null;

        const rowHeight = innerHeight / stages.length;
        // Each row is a caption line over a bar (design line 164). The bar takes
        // what the caption leaves, so a short chart loses bar thickness rather
        // than pushing the caption onto the bar below it.
        const barHeight = Math.max(6, Math.min(rowHeight - LABEL_BLOCK, rowHeight * (showStepConversion ? 0.54 : 0.72)));
        const labelEdge = rtl ? innerWidth : 0;
        const valueEdge = rtl ? 0 : innerWidth;

        return (
          <g data-funnel="">
            {stages.map((stage, i) => {
              const barWidth = stage.widthFrac * innerWidth;
              const startX = variant === 'stepped' ? stage.offsetFrac * innerWidth : 0;
              const x = rtl ? innerWidth - startX - barWidth : startX;
              const y = i * rowHeight + LABEL_BLOCK + Math.max(0, rowHeight - LABEL_BLOCK - barHeight) / 2;
              const captionY = y - 5;
              return (
                <g
                  key={stage.label}
                  className="adm-chart-fade"
                  style={{ '--adm-fade': mounted ? '1' : '0', '--adm-stagger': `${i * 70}ms` }}
                  data-stage={stage.label}
                >
                  <rect x={x} y={y} width={Math.max(0, barWidth)} height={barHeight} rx={4} fill={stage.colorVar} />
                  <text
                    className="adm-chart-entity-label"
                    x={labelEdge}
                    y={captionY}
                    textAnchor={rtl ? 'end' : 'start'}
                  >
                    {stage.label}
                  </text>
                  <text
                    className="adm-chart-num adm-chart-value"
                    x={valueEdge}
                    y={captionY}
                    textAnchor={rtl ? 'start' : 'end'}
                  >
                    {`${format(stage.value)} · ${Math.round(stage.overallPct)}%`}
                  </text>
                  {/* Retention rides the free middle of the caption line rather
                      than the row boundary, which the caption now occupies. */}
                  {showStepConversion && i > 0 && (
                    <text
                      className="adm-chart-legend-caption"
                      x={innerWidth / 2}
                      y={captionY}
                      textAnchor="middle"
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
                className="adm-chart-num adm-chart-value"
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
