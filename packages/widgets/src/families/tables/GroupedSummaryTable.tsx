import { getFormatters } from '@adminium/i18n';
import { EmptyState, MonoText, ProgressBar } from '@adminium/ui';
import type { Tone } from '@adminium/ui';
import { ChevronRight } from 'lucide-react';
import { useState } from 'react';

import { formatMoney } from './column-spec.js';
import type { GroupedSummaryTableConfig } from './tables-track-f-config.js';
import type { AggColumn, GroupedSummaryData } from './tables-track-f-types.js';
import type { WidgetProps } from '../../registry/types.js';

/**
 * `grouped-summary-table` (annex §3) — group-header rows with aggregate
 * columns (a usage progress bar, mono figures), expandable detail rows, and a
 * Σ totals footer. Binds to a `record-list` of GROUP rows plus per-group
 * aggregates and grand totals.
 */

// Config schema + deterministic demo payload live in the pure
// `tables-track-f-config` module, and the aggregate shapes in
// `tables-track-f-types`, so the registry metadata graph never reaches this
// component file (04 §2.3). Re-exported here to keep existing import points
// stable.
export { groupedSummaryTableConfigSchema, groupedSummaryTableDemoData } from './tables-track-f-config.js';
export type { GroupedSummaryTableConfig } from './tables-track-f-config.js';
export type { AggColumn, AggFormat, GroupedSummaryData, SummaryGroup } from './tables-track-f-types.js';

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
