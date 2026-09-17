// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The four data blocks (comp 317-320): the KPI row, the bar chart, the line
 * chart and the two-column table. All four hold LITERALS — a report is typed,
 * never computed; binding a block to a page's data or a 36 measure is a
 * candidate for a later wave.
 *
 * THE GEOMETRY IS THE COMP'S, NOT A CHART LIBRARY'S (D7). `@adminium/charts`'
 * `sparkLine`/`sparkBars` pad differently from these four lines, and the
 * picture has to match the comp: `height = max(4, v/max·100)%` with a 5 px
 * floor for a bar (623), `y = 38 − v/max·34` in a `0 0 100 40` viewBox with
 * `preserveAspectRatio: none` for the line (624).
 *
 * The heights and the polygon points are DATA, so they ride inline `style`
 * and `points` rather than classes (`adminium/no-style-prop`'s escape hatch).
 */
import { cn } from '@adminium/ui';

import { t } from '../../../../i18n/t.js';
import type { SeriesPoint } from '../../../model/envelope.js';
import { DANGER_TEXT, POS_TEXT, SHEET_MUTED, SHEET_SUBTLE } from '../inline.js';
import type { BlockBodyProps } from './types.js';

/** 622: a delta that starts with a minus — typographic or ASCII — is red, everything else green. */
export function isNegativeDelta(delta: string): boolean {
  return delta.startsWith('−') || delta.startsWith('-');
}

/** 317: `auto-fit minmax(90px, 1fr)` tiles, mono value over a muted label, the delta beneath. */
export function KpiBlock({ block }: BlockBodyProps<'kpi'>) {
  return (
    <div data-testid="report-block-kpis" className="grid grid-cols-[repeat(auto-fit,minmax(90px,1fr))] gap-3">
      {block.kpis.map((kpi, index) => (
        <div key={index} className="rounded-[11px] border border-[#ececef] bg-[#fafafa] p-[13px]">
          <div className="font-mono text-[20px] font-extrabold">{kpi.value}</div>
          <div className={cn('mt-[3px] text-[11px]', SHEET_MUTED)}>{kpi.label}</div>
          {kpi.delta === '' ? null : (
            <div data-testid="report-kpi-delta" className={cn('mt-1 text-[10.5px] font-bold', isNegativeDelta(kpi.delta) ? DANGER_TEXT : POS_TEXT)}>
              {kpi.delta}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/** The comp's `Math.max.apply(null, values) || 100` (623-624). */
function maxOf(series: readonly SeriesPoint[]): number {
  const max = series.length === 0 ? 0 : Math.max(...series.map((point) => point.value));
  return max === 0 ? 100 : max;
}

/**
 * 318: a 130 px flex row of bars at `max(4, v/max·100)%` with a 5 px floor,
 * 6/6/0/0 radius, the LAST bar in full accent and the rest at 22 %. (The comp
 * uses 34 % in dark mode; the sheet is always light — D10.)
 */
export function BarBlock({ block }: BlockBodyProps<'bar'>) {
  const max = maxOf(block.series);
  const last = block.series.length - 1;
  return (
    <div data-testid="report-block-bars" className="flex h-[130px] items-end gap-2.5 pt-1.5">
      {block.series.map((point, index) => (
        <div key={index} className="flex h-full flex-1 flex-col items-center justify-end gap-1.5">
          <div
            style={{ '--h': `${String(Math.max(4, (point.value / max) * 100))}%` }}
            className={cn(
              'h-[var(--h)] min-h-[5px] w-full rounded-t-md',
              index === last ? 'bg-[var(--adm-report-accent)]' : 'bg-[color-mix(in_srgb,var(--adm-report-accent)_22%,transparent)]',
            )}
          />
          <span className={cn('text-[9.5px]', SHEET_SUBTLE)}>{point.label}</span>
        </div>
      ))}
    </div>
  );
}

/** The comp's `y = 38 − v/max·34`, `x = j/(n−1)·100` (624). */
export function linePoints(series: readonly SeriesPoint[]): string {
  const max = maxOf(series);
  const n = series.length;
  return series
    .map((point, index) => {
      const x = n <= 1 ? 0 : (index / (n - 1)) * 100;
      const y = 38 - (point.value / max) * 34;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');
}

/** 319: a 110 px SVG at `viewBox 0 0 100 40`, a 14 % area polygon under a 1.6 non-scaling polyline. */
export function LineBlock({ block }: BlockBodyProps<'line'>) {
  const points = linePoints(block.series);
  return (
    <div data-testid="report-block-line">
      <div className="block text-[var(--adm-report-accent)]">
        <svg viewBox="0 0 100 40" preserveAspectRatio="none" role="presentation" className="block h-[110px] w-full">
          <polygon points={`0,40 ${points} 100,40`} fill="currentColor" fillOpacity="0.14" />
          <polyline
            points={points}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      </div>
      <div className="mt-1.5 flex justify-between">
        {block.series.map((point, index) => (
          <span key={index} className={cn('text-[9.5px]', SHEET_SUBTLE)}>
            {point.label}
          </span>
        ))}
      </div>
    </div>
  );
}

/** 320: a bordered list; row 0 is the header (surface-2, 700), column A flexes, column B is mono. */
export function TableBlock({ block }: BlockBodyProps<'table'>) {
  const last = block.rows.length - 1;
  return (
    <div data-testid="report-block-table" role="table" aria-label={t('reportBuilder:inspector.rows', 'Rows')} className="overflow-hidden rounded-[10px] border border-[#ececef]">
      {block.rows.map((row, index) => (
        <div
          key={index}
          role="row"
          className={cn('flex px-[13px] py-[9px]', index < last && 'border-b border-[#ececef]', index === 0 && 'bg-[#fafafa]')}
        >
          <span role={index === 0 ? 'columnheader' : 'cell'} className={cn('flex-1 text-[12.5px]', index === 0 ? 'font-bold' : 'font-medium')}>
            {row[0]}
          </span>
          <span role={index === 0 ? 'columnheader' : 'cell'} className={cn('font-mono text-[12.5px]', index === 0 ? 'font-bold' : 'font-medium')}>
            {row[1]}
          </span>
        </div>
      ))}
    </div>
  );
}
