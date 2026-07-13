/**
 * `chart-sparkline` primitive (research/widget-registry.md §2): inline 6–12
 * point micro-chart, bar|line variant, last point emphasized. No axes, no
 * tooltip — embeds in KPI cards, table cells and list rows. Decorative by
 * default (aria-hidden) unless a label is provided.
 */
import { sparkBars, sparkLine } from '../geometry/sparkline.js';
import { useMountAnimation } from '../hooks/useMountAnimation.js';

export type SparklineTone = 'accent' | 'positive' | 'danger' | 'muted';

const TONE_VAR: Record<SparklineTone, string> = {
  accent: 'var(--accent)',
  positive: 'var(--pos)',
  danger: 'var(--danger)',
  muted: 'var(--fg-subtle)',
};

export interface SparklineProps {
  data: readonly number[];
  variant?: 'bar' | 'line';
  width?: number;
  height?: number;
  /** Full-tone last bar/point (default true). */
  emphasisLast?: boolean;
  tone?: SparklineTone;
  /** Accessible name. Omitted → the sparkline is decorative (aria-hidden). */
  label?: string;
  className?: string;
}

export function Sparkline({
  data,
  variant = 'bar',
  width = 96,
  height = 28,
  emphasisLast = true,
  tone = 'accent',
  label,
  className,
}: SparklineProps) {
  const mounted = useMountAnimation();
  const color = TONE_VAR[tone];
  const a11y =
    label !== undefined
      ? ({ role: 'img', 'aria-label': label } as const)
      : ({ 'aria-hidden': true } as const);

  return (
    <svg
      className={className === undefined ? 'adm-spark' : `adm-spark ${className}`}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      data-export-node=""
      {...a11y}
    >
      {variant === 'bar' ? (
        sparkBars(data, width, height).map((bar, i) => (
          <rect
            key={i}
            className="adm-chart-grow"
            style={{ '--adm-grow': mounted ? '1' : '0', '--adm-stagger': `${i * 40}ms` }}
            x={bar.x}
            y={bar.y}
            width={bar.width}
            height={bar.height}
            rx={1.5}
            fill={color}
            opacity={emphasisLast && !bar.isLast ? 0.45 : 1}
            data-last={bar.isLast ? '' : undefined}
          />
        ))
      ) : (
        (() => {
          const layout = sparkLine(data, width, height);
          return (
            <g className="adm-chart-fade" style={{ '--adm-fade': mounted ? '1' : '0' }}>
              {layout.points !== '' && (
                <polyline points={layout.points} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" />
              )}
              {emphasisLast && layout.last !== null && (
                <circle cx={layout.last.x} cy={layout.last.y} r={2.5} fill={color} data-last="" />
              )}
            </g>
          );
        })()
      )}
    </svg>
  );
}
