import { useMaybeT } from '@adminium/i18n/react';
import { MonoText, Tag } from '@adminium/ui';
import { Check } from 'lucide-react';

import { comparisonMatrixConfigSchema, comparisonMatrixDemoData } from './tables-tail-config.js';
import type { ComparisonMatrixConfig } from './tables-tail-config.js';
import { resolveLocale } from './tables-tail-lib.js';
import type {
  ComparisonCell,
  ComparisonColumn,
  ComparisonMatrixData,
  ComparisonRow,
} from './tables-tail-types.js';
import type { WidgetProps } from '../../registry/types.js';

export { comparisonMatrixConfigSchema, comparisonMatrixDemoData };
export type { ComparisonMatrixConfig, ComparisonCell, ComparisonColumn, ComparisonMatrixData, ComparisonRow };

/**
 * `comparison-matrix` (annex §3) — the plan/feature grid: a sticky multi-column
 * header, grouped category bands, cells rendering a check / an em-dash / mono
 * text, and one column visually promoted (Pricing, Billing & Usage's plan grid).
 *
 * A CSS grid pseudo-table, not a `<table>` — the same call the family's
 * `data-grid` makes — with explicit ARIA table roles so the semantics survive
 * the layout choice. The header is `sticky top-0`: `top` is the BLOCK-axis
 * inset, which does not mirror under RTL and is therefore correct as a physical
 * utility here (the grid scrolls vertically; the inline axis is what mirrors,
 * and that is handled by the logical `text-start`/`ps-*` utilities below).
 *
 * The promoted column is marked with `data-promoted` + a soft accent wash so the
 * emphasis is a tone, never a hard-coded colour.
 */

export interface ComparisonMatrixProps {
  columns: readonly ComparisonColumn[];
  rows: readonly ComparisonRow[];
  /** Ordered category bands; unlisted bands follow in first-seen order. */
  groups?: readonly string[] | undefined;
  promotedColumn?: string | undefined;
  promotedLabel?: string | undefined;
  includedLabel?: string | undefined;
  notIncludedLabel?: string | undefined;
  locale?: string | undefined;
  testId?: string | undefined;
}

/**
 * Band order: the ungrouped bucket first, then the configured `groups` in their
 * configured order, then any band the rows add that the config never listed.
 *
 * The ungrouped bucket is hoisted deliberately. It is not a band — it is the
 * un-banded preamble (a plan grid's headline rows), and it carries no group
 * name, so it can never appear in `groups`. Ordering it by first-seen instead
 * would strand those rows AFTER the configured bands the moment an author lists
 * any group at all.
 */
function bandsOf(rows: readonly ComparisonRow[], groups: readonly string[] | undefined): string[] {
  const seen: string[] = [];
  for (const row of rows) {
    const band = row.group ?? '';
    if (!seen.includes(band)) seen.push(band);
  }
  if (groups === undefined) return seen;
  const lead = seen.includes('') ? [''] : [];
  const ordered = groups.filter((group) => seen.includes(group));
  return [...lead, ...ordered, ...seen.filter((band) => band !== '' && !ordered.includes(band))];
}

function Cell({
  value,
  includedLabel,
  notIncludedLabel,
}: {
  value: ComparisonCell | undefined;
  includedLabel: string;
  notIncludedLabel: string;
}) {
  if (value === true) {
    return (
      <>
        <Check aria-hidden="true" className="mx-auto size-4 text-pos" />
        <span className="sr-only">{includedLabel}</span>
      </>
    );
  }
  if (value === false || value === undefined) {
    return (
      <>
        {/* An em-dash is decorative punctuation — the assistive text carries
            the meaning, so the glyph is hidden rather than read as "—". */}
        <span aria-hidden="true" className="text-fg-subtle">
          —
        </span>
        <span className="sr-only">{notIncludedLabel}</span>
      </>
    );
  }
  return <MonoText className="text-caption font-semibold text-fg">{value}</MonoText>;
}

export function ComparisonMatrix({
  columns,
  rows,
  groups,
  promotedColumn,
  promotedLabel,
  includedLabel,
  notIncludedLabel,
  locale,
  testId,
}: ComparisonMatrixProps) {
  const t = useMaybeT();
  const resolvedIncludedLabel = includedLabel ?? t('ui:widgets.tables.comparisonMatrix.includedLabel', 'Included');
  const resolvedNotIncludedLabel = notIncludedLabel ?? t('ui:widgets.tables.comparisonMatrix.notIncludedLabel', 'Not included');
  void resolveLocale(locale); // normalize at the boundary (see tables-tail-lib)
  const bands = bandsOf(rows, groups);
  // A feature label column + one column per compared plan.
  const template = `minmax(10rem, 1.6fr) repeat(${columns.length}, minmax(5rem, 1fr))`;

  return (
    <div
      data-widget="comparison-matrix"
      data-testid={testId}
      role="table"
      className="h-full overflow-auto"
    >
      <div
        role="row"
        className="sticky top-0 z-10 grid items-end gap-x-2 border-b border-border bg-surface-1 px-3 py-2.5 grid-cols-[var(--cmp-cols)]"
        style={{ '--cmp-cols': template }}
      >
        <span role="columnheader" className="text-caption font-bold uppercase tracking-wide text-fg-subtle">
          {/* The corner cell is intentionally blank — the row labels name
              themselves, and a filler heading would be read aloud as noise. */}
        </span>
        {columns.map((column) => {
          const promoted = column.id === promotedColumn;
          return (
            <span
              key={column.id}
              role="columnheader"
              data-part="cmp-col"
              data-promoted={promoted ? '' : undefined}
              className={`flex flex-col items-center gap-0.5 rounded-t-md px-2 py-1 text-center ${
                promoted ? 'bg-accent-soft' : ''
              }`}
            >
              {promoted && promotedLabel !== undefined && (
                <Tag tone="accent" className="mb-0.5 uppercase">
                  {promotedLabel}
                </Tag>
              )}
              <span className={`text-body-sm font-bold ${promoted ? 'text-accent' : 'text-fg'}`}>{column.label}</span>
              {column.meta !== undefined && (
                <MonoText className="text-caption text-fg-muted">{column.meta}</MonoText>
              )}
            </span>
          );
        })}
      </div>

      {bands.map((band) => (
        <div key={band === '' ? '__ungrouped' : band} data-part="cmp-band" data-band={band === '' ? undefined : band}>
          {band !== '' && (
            <div role="row" className="bg-surface-2 px-3 py-1.5">
              <span role="rowheader" className="text-caption font-bold uppercase tracking-wide text-fg-muted">
                {band}
              </span>
            </div>
          )}
          {rows
            .filter((row) => (row.group ?? '') === band)
            .map((row) => (
              <div
                key={row.id}
                role="row"
                data-part="cmp-row"
                className="grid items-center gap-x-2 border-b border-border/60 px-3 py-2 last:border-b-0 grid-cols-[var(--cmp-cols)]"
                style={{ '--cmp-cols': template }}
              >
                <span role="rowheader" className="truncate text-start text-body-sm text-fg">
                  {row.label}
                </span>
                {columns.map((column) => {
                  const promoted = column.id === promotedColumn;
                  return (
                    <span
                      key={column.id}
                      role="cell"
                      data-part="cmp-cell"
                      data-promoted={promoted ? '' : undefined}
                      className={`flex items-center justify-center px-2 py-1 text-center ${
                        promoted ? 'bg-accent-soft/40' : ''
                      }`}
                    >
                      <Cell
                        value={row.cells[column.id]}
                        includedLabel={resolvedIncludedLabel}
                        notIncludedLabel={resolvedNotIncludedLabel}
                      />
                    </span>
                  );
                })}
              </div>
            ))}
        </div>
      ))}
    </div>
  );
}

/**
 * Project an untrusted payload onto the matrix shape (annex: "static or
 * config-driven"), honouring the config's column allow-list/order.
 */
export function comparisonDataOf(data: unknown, config: ComparisonMatrixConfig): ComparisonMatrixData {
  const envelope = (typeof data === 'object' && data !== null ? data : {}) as Partial<ComparisonMatrixData>;
  const rawColumns = Array.isArray(envelope.columns) ? envelope.columns : [];
  const rawRows = Array.isArray(envelope.rows) ? envelope.rows : [];
  const allow = config.columns;
  const columns =
    allow === undefined || allow.length === 0
      ? rawColumns
      : allow.flatMap((id) => rawColumns.filter((column) => column.id === id));
  return {
    columns,
    rows: rawRows,
    ...(config.groups === undefined ? (envelope.groups === undefined ? {} : { groups: envelope.groups }) : { groups: config.groups }),
  };
}

export function ComparisonMatrixWidget({ config, data }: WidgetProps<ComparisonMatrixConfig>) {
  const matrix = comparisonDataOf(data, config);
  return (
    <ComparisonMatrix
      columns={matrix.columns}
      rows={matrix.rows}
      {...(matrix.groups === undefined ? {} : { groups: matrix.groups })}
      {...(config.promotedColumn === undefined ? {} : { promotedColumn: config.promotedColumn })}
      {...(config.promotedLabel === undefined ? {} : { promotedLabel: config.promotedLabel })}
      {...(config.format?.locale === undefined ? {} : { locale: config.format.locale })}
      {...(config.testId === undefined ? {} : { testId: config.testId })}
    />
  );
}
