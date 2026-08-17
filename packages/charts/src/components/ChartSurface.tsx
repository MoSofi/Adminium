/**
 * Responsive SVG viewport shared by every chart (04-widget-registry.md
 * §7.2): ResizeObserver-driven width, fixed pixel height, padding model,
 * direction context, mount-animation flag, a11y contract (role="img" +
 * aria-label from `labels`, optional visually-hidden table fallback), and the
 * `data-export-node` marker for the deferred raster-export hooks (§7.6).
 */
import type { ReactNode } from 'react';

import { useMeasuredWidth } from '../hooks/useChartSize.js';
import { useMountAnimation } from '../hooks/useMountAnimation.js';
import { ChartDirectionContext, useChartDir } from '../hooks/useRtl.js';
import type { ChartDir } from '../hooks/useRtl.js';

export interface ChartLabels {
  /** Required accessible name — becomes the SVG aria-label. */
  label: string;
  /** Optional longer description — rendered as the SVG <desc>. */
  description?: string;
}

export interface ChartPadding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface ChartRenderContext {
  /** Full viewBox width (measured). */
  width: number;
  /** Full viewBox height. */
  height: number;
  /** Plot-area width (width minus horizontal padding). */
  innerWidth: number;
  /** Plot-area height. */
  innerHeight: number;
  rtl: boolean;
  /** Mount-animation gate — false on the first committed frame, then true. */
  mounted: boolean;
}

export interface ChartSurfaceProps {
  labels: ChartLabels;
  height: number;
  children: (context: ChartRenderContext) => ReactNode;
  /**
   * Explicit direction. Defaults to the nearest ChartDirectionContext
   * ('ltr'). Wave B widget wrappers bridge the i18n dir here.
   */
  dir?: ChartDir;
  padding?: Partial<ChartPadding>;
  /** Width used before the first ResizeObserver measurement (and in SSR/tests). */
  initialWidth?: number;
  /** Accessible data-table fallback, rendered visually hidden next to the SVG. */
  a11yFallback?: ReactNode;
  className?: string;
}

/**
 * Padding a chart gets when it declares none. Not zero: an undeclared gutter
 * used to mean marks and labels drew flush to the viewBox edge and clipped.
 * Every chart in the package currently declares all four sides, so this is a
 * floor for new ones rather than a change to any existing layout.
 */
const DEFAULT_PADDING: ChartPadding = { top: 6, right: 6, bottom: 6, left: 6 };

export function ChartSurface({
  labels,
  height,
  children,
  dir,
  padding,
  initialWidth = 600,
  a11yFallback,
  className,
}: ChartSurfaceProps) {
  const { ref, width } = useMeasuredWidth<HTMLDivElement>(initialWidth);
  const resolvedDir = useChartDir(dir);
  const mounted = useMountAnimation();

  const pad: ChartPadding = { ...DEFAULT_PADDING, ...padding };
  const innerWidth = Math.max(0, width - pad.left - pad.right);
  const innerHeight = Math.max(0, height - pad.top - pad.bottom);

  return (
    <div ref={ref} className={className === undefined ? 'adm-chart' : `adm-chart ${className}`}>
      <ChartDirectionContext.Provider value={resolvedDir}>
        <svg
          className="adm-chart-svg"
          role="img"
          aria-label={labels.label}
          width="100%"
          height={height}
          viewBox={`0 0 ${Math.max(1, width)} ${height}`}
          data-export-node=""
        >
          {labels.description !== undefined && <desc>{labels.description}</desc>}
          <g transform={`translate(${pad.left}, ${pad.top})`}>
            {children({ width, height, innerWidth, innerHeight, rtl: resolvedDir === 'rtl', mounted })}
          </g>
        </svg>
      </ChartDirectionContext.Provider>
      {a11yFallback !== undefined && <div className="adm-chart-sr">{a11yFallback}</div>}
    </div>
  );
}
