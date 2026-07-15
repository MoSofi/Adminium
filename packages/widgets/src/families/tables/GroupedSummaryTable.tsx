import { getFormatters } from '@adminium/i18n';
import { EmptyState, MonoText, ProgressBar } from '@adminium/ui';
import type { Tone } from '@adminium/ui';
import { ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { z } from 'zod';

import { formatMoney } from './column-spec.js';
import type { WidgetProps } from '../../registry/types.js';
import { widgetSharedConfigSchema } from '../../registry/shared-config.js';

/**
 * `grouped-summary-table` (annex §3) — group-header rows with aggregate
 * columns (a usage progress bar, mono figures), expandable detail rows, and a
 * Σ totals footer. Binds to a `record-list` of GROUP rows plus per-group
 * aggregates and grand totals.
 */

export type AggFormat = 'number' | 'currency' | 'percent' | 'progress' | 'text';

export const groupedSummaryTableConfigSchema = widgetSharedConfigSchema.extend({
  expandable: z.boolean().default(true),
  totalsRow: z.boolean().default(true),
  groupLabel: z.string().optional(),
  totalsLabel: z.string().optional(),
  emptyTitle: z.string().optional(),
});
export type GroupedSummaryTableConfig = z.infer<typeof groupedSummaryTableConfigSchema>;

export interface AggColumn {
  key: string;
  label: string;
  format?: AggFormat | undefined;
  tone?: string | undefined;
  /** progress-format denominator (defaults to 100). */
  max?: number | undefined;
}
export interface SummaryGroup {
  key: string;
  label: string;
  count?: number | undefined;
  aggregates: Record<string, number | string>;
  rows?: { label: string; aggregates: Record<string, number | string> }[] | undefined;
}
export interface GroupedSummaryData {
  data: SummaryGroup[];
  columns: AggColumn[];
  totals?: Record<string, number | string> | undefined;
  total?: number | undefined;
}

function formatCell(value: number | string | undefined, column: AggColumn, locale?: string): string {
  if (value === undefined) return '—';
  if (typeof value === 'string') return value;
  const fmt = getFormatters(locale ?? 'en-US');
  switch (column.format) {
    case 'currency':
      return formatMoney(value, { locale });
    case 'percent':
      return `${fmt.number(value, { maximumFractionDigits: 1 })}%`;
    case 'number':
    case 'progress':
      return fmt.number(value);
    default:
      return String(value);
  }
}

export interface GroupedSummaryTableProps {
  data: GroupedSummaryData;
  expandable?: boolean | undefined;
  totalsRow?: boolean | undefined;
  groupLabel?: string | undefined;
  totalsLabel?: string | undefined;
  emptyTitle?: string | undefined;
  locale?: string | undefined;
  testId?: string | undefined;
}

export function GroupedSummaryTable({
  data,
  expandable = true,
  totalsRow = true,
  groupLabel,
  totalsLabel,
  emptyTitle,
  locale,
  testId,
}: GroupedSummaryTableProps) {
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const { data: groups, columns, totals } = data;

  if (groups.length === 0 || columns.length === 0) {
    return <EmptyState compact preset="no-data" title={emptyTitle ?? 'No summary data'} />;
  }

  const gridCols = `minmax(8rem,1.4fr) repeat(${columns.length}, minmax(5rem,1fr))`;
  const cell = (value: number | string | undefined, column: AggColumn) => {
    if (column.format === 'progress' && typeof value === 'number') {
      const max = column.max ?? 100;
      return (
        <div className="flex items-center justify-end gap-2">
          <ProgressBar value={value} max={max} size="sm" tone={(column.tone as Tone | undefined) ?? 'accent'} className="max-w-24" label={column.label} />
          <MonoText className="text-caption tabular-nums text-fg-muted">{Math.round((value / max) * 100)}%</MonoText>
        </div>
      );
    }
    return <MonoText className="justify-self-end text-body-sm tabular-nums text-fg">{formatCell(value, column, locale)}</MonoText>;
  };

  return (
    <div data-widget="grouped-summary-table" data-testid={testId} className="flex h-full flex-col overflow-auto">
      <div role="table" className="min-w-full text-body-sm">
        <div
          role="row"
          className="sticky top-0 z-[1] grid items-center gap-x-4 border-b border-border bg-surface-2 px-3 py-2 text-caption font-bold uppercase tracking-wide text-fg-subtle grid-cols-[var(--adm-cols)]"
          style={{ '--adm-cols': gridCols }}
        >
          <span>{groupLabel ?? 'Group'}</span>
          {columns.map((column) => (
            <span key={column.key} className="justify-self-end text-end">{column.label}</span>
          ))}
        </div>

        {groups.map((group) => {
          const isOpen = open.has(group.key);
          const canExpand = expandable && group.rows !== undefined && group.rows.length > 0;
          const toggle = () =>
            setOpen((prev) => {
              const next = new Set(prev);
              if (next.has(group.key)) next.delete(group.key);
              else next.add(group.key);
              return next;
            });
          return (
            <div key={group.key} role="rowgroup">
              <div
                role="row"
                data-part="group-row"
                tabIndex={canExpand ? 0 : undefined}
                aria-expanded={canExpand ? isOpen : undefined}
                onClick={canExpand ? toggle : undefined}
                onKeyDown={
                  canExpand
                    ? (event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          toggle();
                        }
                      }
                    : undefined
                }
                className={`grid items-center gap-x-4 border-b border-border/60 px-3 py-2.5 grid-cols-[var(--adm-cols)] ${canExpand ? 'cursor-pointer hover:bg-surface-2/50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent' : ''}`}
                style={{ '--adm-cols': gridCols }}
              >
                <span className="flex items-center gap-1.5 font-semibold text-fg">
                  {canExpand && (
                    <ChevronRight
                      aria-hidden="true"
                      className={`size-3.5 text-fg-subtle transition-transform rtl:-scale-x-100 ${isOpen ? 'rotate-90 rtl:-rotate-90' : ''}`}
                    />
                  )}
                  <span className="truncate">{group.label}</span>
                  {group.count !== undefined && (
                    <span className="font-mono text-caption font-normal tabular-nums text-fg-subtle">({group.count})</span>
                  )}
                </span>
                {columns.map((column) => (
                  <span key={column.key} className="justify-self-end">{cell(group.aggregates[column.key], column)}</span>
                ))}
              </div>
              {isOpen &&
                group.rows?.map((detail, index) => (
                  <div
                    key={`${group.key}-${String(index)}`}
                    role="row"
                    data-part="detail-row"
                    className="grid items-center gap-x-4 border-b border-border/40 bg-surface-2/30 px-3 py-1.5 grid-cols-[var(--adm-cols)]"
                    style={{ '--adm-cols': gridCols }}
                  >
                    <span className="truncate ps-5 text-caption text-fg-muted">{detail.label}</span>
                    {columns.map((column) => (
                      <span key={column.key} className="justify-self-end">
                        <MonoText className="text-caption tabular-nums text-fg-muted">{formatCell(detail.aggregates[column.key], column, locale)}</MonoText>
                      </span>
                    ))}
                  </div>
                ))}
            </div>
          );
        })}

        {totalsRow && totals !== undefined && (
          <div
            role="row"
            data-part="totals-row"
            className="grid items-center gap-x-4 border-t-2 border-border px-3 py-2.5 font-semibold grid-cols-[var(--adm-cols)]"
            style={{ '--adm-cols': gridCols }}
          >
            <span className="text-fg">{totalsLabel ?? 'Total'}</span>
            {columns.map((column) => (
              <MonoText key={column.key} className="justify-self-end text-body-sm tabular-nums text-fg">
                {formatCell(totals[column.key], { ...column, format: column.format === 'progress' ? 'percent' : column.format }, locale)}
              </MonoText>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function summaryDataOf(data: unknown): GroupedSummaryData {
  if (typeof data === 'object' && data !== null) {
    const envelope = data as Partial<GroupedSummaryData>;
    return {
      data: Array.isArray(envelope.data) ? envelope.data : [],
      columns: Array.isArray(envelope.columns) ? envelope.columns : [],
      ...(envelope.totals === undefined ? {} : { totals: envelope.totals }),
    };
  }
  return { data: [], columns: [] };
}

export function GroupedSummaryTableWidget({ config, data }: WidgetProps<GroupedSummaryTableConfig>) {
  return (
    <GroupedSummaryTable
      data={summaryDataOf(data)}
      expandable={config.expandable}
      totalsRow={config.totalsRow}
      {...(config.groupLabel === undefined ? {} : { groupLabel: config.groupLabel })}
      {...(config.totalsLabel === undefined ? {} : { totalsLabel: config.totalsLabel })}
      {...(config.emptyTitle === undefined ? {} : { emptyTitle: config.emptyTitle })}
      {...(config.format?.locale === undefined ? {} : { locale: config.format.locale })}
    />
  );
}

const REGIONS = [
  { key: 'na', label: 'North America', services: ['API', 'Web', 'Jobs'] },
  { key: 'eu', label: 'Europe', services: ['API', 'Web'] },
  { key: 'apac', label: 'Asia Pacific', services: ['API', 'Web', 'Edge'] },
  { key: 'latam', label: 'Latin America', services: ['API'] },
] as const;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic grouped-summary payload (04 §7.7). */
export function groupedSummaryTableDemoData(seed: number): GroupedSummaryData {
  const random = mulberry32(seed || 1);
  const columns: AggColumn[] = [
    { key: 'requests', label: 'Requests', format: 'number' },
    { key: 'revenue', label: 'Revenue', format: 'currency' },
    { key: 'usage', label: 'Quota', format: 'progress', max: 100, tone: 'accent' },
    { key: 'errorRate', label: 'Errors', format: 'percent', tone: 'danger' },
  ];
  const groups: SummaryGroup[] = REGIONS.map((region) => {
    const rows = region.services.map((service) => ({
      label: service,
      aggregates: {
        requests: Math.floor(random() * 40_000) + 1000,
        revenue: Math.floor(random() * 20_000) + 500,
        usage: Math.floor(random() * 100),
        errorRate: Math.round(random() * 40) / 10,
      } as Record<string, number>,
    }));
    const sum = (key: string) => rows.reduce((acc, row) => acc + (row.aggregates[key] as number), 0);
    return {
      key: region.key,
      label: region.label,
      count: rows.length,
      rows,
      aggregates: {
        requests: sum('requests'),
        revenue: sum('revenue'),
        usage: Math.round(sum('usage') / rows.length),
        errorRate: Math.round((sum('errorRate') / rows.length) * 10) / 10,
      },
    };
  });
  const totals: Record<string, number> = {
    requests: groups.reduce((acc, g) => acc + (g.aggregates['requests'] as number), 0),
    revenue: groups.reduce((acc, g) => acc + (g.aggregates['revenue'] as number), 0),
    usage: Math.round(groups.reduce((acc, g) => acc + (g.aggregates['usage'] as number), 0) / groups.length),
    errorRate: Math.round((groups.reduce((acc, g) => acc + (g.aggregates['errorRate'] as number), 0) / groups.length) * 10) / 10,
  };
  return { data: groups, columns, totals };
}
