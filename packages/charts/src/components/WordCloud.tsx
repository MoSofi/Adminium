/**
 * `chart-wordcloud` primitive (research/widget-registry.md §2): terms sized by
 * frequency, flowed into wrapped rows and rendered as SVG <text> (font size is
 * an SVG presentation attribute, so no `style` prop and no DOM text metrics).
 * Widths are estimated deterministically in geometry → identical layout in a
 * report worker (04 §7.1). Rows mirror in RTL (§7.4); colors are tokens only.
 */
import type { ReactNode } from 'react';

import { wordCloudLayout } from '../geometry/wordcloud.js';
import type { WordInput } from '../geometry/wordcloud.js';
import type { ChartDir } from '../hooks/useRtl.js';
import { ChartSurface } from './ChartSurface.js';
import type { ChartLabels } from './ChartSurface.js';

export interface WordCloudChartProps {
  data: readonly WordInput[];
  labels: ChartLabels;
  height?: number;
  maxTerms?: number;
  minFontSize?: number;
  maxFontSize?: number;
  dir?: ChartDir;
  a11yFallback?: ReactNode;
  className?: string;
}

export function WordCloud({
  data,
  labels,
  height = 200,
  maxTerms,
  minFontSize,
  maxFontSize,
  dir,
  a11yFallback,
  className,
}: WordCloudChartProps) {
  return (
    <ChartSurface
      labels={labels}
      height={height}
      {...(dir !== undefined ? { dir } : {})}
      {...(a11yFallback !== undefined ? { a11yFallback } : {})}
      {...(className !== undefined ? { className } : {})}
      padding={{ top: 6, right: 6, bottom: 6, left: 6 }}
    >
      {({ innerWidth, innerHeight, rtl, mounted }) => {
        if (innerWidth <= 0) return null;
        // Geometry mirrors each row's start edge in RTL, so the text anchor
        // stays "start" and the term boxes read end→start.
        const { tokens, height: contentHeight } = wordCloudLayout(data, {
          width: innerWidth,
          rtl,
          ...(maxTerms !== undefined ? { maxTerms } : {}),
          ...(minFontSize !== undefined ? { minFontSize } : {}),
          ...(maxFontSize !== undefined ? { maxFontSize } : {}),
        });
        // Vertically center the cloud within the plot area.
        const offsetY = Math.max(0, (innerHeight - contentHeight) / 2);

        return (
          <g data-wordcloud="" transform={`translate(0, ${offsetY})`}>
            {tokens.map((token, i) => (
              <text
                key={`${token.term}-${i}`}
                x={token.x}
                y={token.y}
                fontSize={token.fontSize}
                fontWeight={700}
                fill={token.colorVar}
                textAnchor="start"
                dominantBaseline="middle"
                className="adm-chart-fade"
                style={{ '--adm-fade': mounted ? '1' : '0', '--adm-stagger': `${i * 40}ms` }}
                data-term={token.term}
              >
                {token.term}
              </text>
            ))}
          </g>
        );
      }}
    </ChartSurface>
  );
}
