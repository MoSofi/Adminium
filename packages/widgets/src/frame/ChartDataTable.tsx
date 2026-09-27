// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect } from 'react';

import { chartTableOf, type ChartTable, type ChartTableOptions } from '../lib/chart-table.js';
import { useScrollRegion } from '../lib/useScrollRegion.js';
import { useWidgetHeadingId } from './WidgetHeadingContext.js';

/** What a chart card's table is made from: the answer it draws, what it is (the caption), and the reader's words. */
export interface ChartTableSource {
  data: unknown;
  caption: string;
  options: ChartTableOptions;
}

/**
 * A chart's figures as a table, made from the answer it draws (a lazy chunk:
 * the dashboard's first paint never carries it). `onAvailable` is told
 * whether there is one, so the frame offers "Show data" only then.
 */
export default function ChartFigures({ source, hidden, onAvailable }: { source: ChartTableSource; hidden: boolean; onAvailable: (available: boolean) => void }) {
  const table = chartTableOf(source.data, source.options);
  const available = table !== null;
  useEffect(() => onAvailable(available), [available, onAvailable]);
  return table === null ? null : <ChartDataTable table={table} caption={source.caption} hidden={hidden} />;
}

/**
 * A chart's figures as a table (`lib/chart-table.ts`), under a caption that
 * says what they are. Shown in the card by its "Show data" toggle; otherwise
 * kept for screen readers only, as the chart's text alternative — the values
 * a picture cannot say.
 */
export function ChartDataTable({ table, caption, hidden = false }: { table: ChartTable; caption: string; hidden?: boolean }) {
  const headingId = useWidgetHeadingId();
  const scroll = useScrollRegion({ role: 'group', label: caption, ...(headingId === null ? {} : { labelledBy: headingId }) });
  const body = (
    <table data-part="chart-data-table" className="w-full border-collapse text-body-sm">
      <caption className={hidden ? undefined : 'pb-2 text-start text-caption text-fg-subtle'}>{caption}</caption>
      <thead>
        <tr>
          {table.headers.map((header, i) => (
            <th
              key={`${String(i)}-${header}`}
              scope="col"
              className={`border-b border-border px-2 py-1 text-caption font-semibold text-fg-muted ${table.numeric[i] === true ? 'text-end' : 'text-start'}`}
            >
              {header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {table.rows.map((row, r) => (
          <tr key={r} className="border-b border-border/60 last:border-b-0">
            {row.map((cell, i) =>
              i === 0 ? (
                <th key={i} scope="row" className="px-2 py-1 text-start font-normal text-fg">
                  {cell}
                </th>
              ) : (
                <td key={i} className={`px-2 py-1 text-fg ${table.numeric[i] === true ? 'text-end font-mono tabular-nums' : 'text-start'}`}>
                  {cell}
                </td>
              ),
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
  if (hidden) {
    return (
      <div data-part="chart-text-alternative" className="sr-only">
        {body}
      </div>
    );
  }
  return (
    <div
      ref={scroll.ref}
      {...(scroll.tabIndex === undefined ? {} : { tabIndex: scroll.tabIndex })}
      {...(scroll.role === undefined ? {} : { role: scroll.role })}
      {...(scroll['aria-labelledby'] === undefined ? {} : { 'aria-labelledby': scroll['aria-labelledby'] })}
      {...(scroll['aria-label'] === undefined ? {} : { 'aria-label': scroll['aria-label'] })}
      className={`max-h-full overflow-auto px-[var(--widget-pad)] pb-[var(--widget-pad)] ${scroll.className}`}
    >
      {body}
    </div>
  );
}
