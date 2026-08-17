/**
 * `table-inclusion-checklist` (annex §10) — scrollable toggleable table list:
 * custom checkbox, mono name, human row counts, PII warning badges,
 * suggested-dashboard tag chips, and an included/total header count.
 * Evidence: Adminium Console, Auth & Onboarding, Connect Database.
 *
 * TWO EXPORTS, ONE IMPLEMENTATION (same split as `ConnectionStringField`):
 *   · `TableInclusionChecklist` — the presentational list. The Studio connect
 *     wizard (`apps/dashboard/src/studio/connect/steps/TablesStep.tsx`) renders
 *     THIS component and keeps only what is wizard-specific around it (its
 *     search box, its per-source row-count degradation, its explanatory notes).
 *   · `TableInclusionChecklistWidget` — the registry binding over it.
 * The inclusion RULES both sides obey live in the pure `forms-tables.ts`.
 */

import { Badge, Checkbox, EmptyState, MonoText, Tag, cn } from '@adminium/ui';
import { useMaybeT } from '@adminium/i18n/react';
import { ShieldAlert } from 'lucide-react';
import { useState } from 'react';
import type { ReactNode } from 'react';

import { tableInclusionChecklistConfigSchema, tableInclusionChecklistDemoData } from './forms-config.js';
import type { TableInclusionChecklistConfig } from './forms-config.js';
import { booleanField, formatRows, numberField, recordRowsOf, stringField } from './forms-lib.js';
import { bindingTargetOf } from './forms-state.js';
import { defaultIncludedIds, inclusionCounts, isHighVolume } from './forms-tables.js';
import type { InclusionTable } from './forms-tables.js';
import type { WidgetProps } from '../../registry/types.js';

export { tableInclusionChecklistConfigSchema, tableInclusionChecklistDemoData };
export type { TableInclusionChecklistConfig };

/**
 * Project the §3 `record-list` payload onto includable tables (annex §10:
 * "introspected tables {name, rowCount, pii?, tag?, included}").
 *
 * `pii` is read as a COUNT or a flag: an introspector that reports
 * `pii: true` and one that reports `pii: 3` are both saying the table has PII,
 * and a widget that understood only one of them would drop the badge — the one
 * signal on this screen that exists to make someone stop and think.
 */
export function inclusionTablesOf(data: unknown, config: TableInclusionChecklistConfig): InclusionTable[] {
  const rows = recordRowsOf(data);
  const out: InclusionTable[] = [];
  for (const row of rows) {
    const id = stringField(row, config.nameField);
    if (id === undefined) continue;
    const rowEstimate = numberField(row, config.rowCountField) ?? null;
    const piiCount = numberField(row, config.piiField);
    const piiFlag = booleanField(row, config.piiField);
    out.push({
      id,
      rowEstimate,
      piiColumns: piiCount ?? (piiFlag === true ? 1 : 0),
      highVolume: isHighVolume(rowEstimate),
      preHidden: booleanField(row, config.hiddenField) === true,
      tag: stringField(row, config.tagField),
    });
  }
  return out;
}

/** The initial selection: an explicit `included` column wins over the default rule. */
export function initialInclusion(data: unknown, config: TableInclusionChecklistConfig, tables: readonly InclusionTable[]): Set<string> {
  const rows = recordRowsOf(data);
  const explicit: string[] = [];
  let sawColumn = false;
  for (const row of rows) {
    if (!(config.includedField in row)) continue;
    sawColumn = true;
    const id = stringField(row, config.nameField);
    if (id !== undefined && booleanField(row, config.includedField) === true) explicit.push(id);
  }
  // No `included` column at all ⇒ nobody has chosen yet ⇒ apply the >100k rule.
  // An `included` column that happens to be all-false is a real choice, and must
  // NOT be overwritten by the default (05; M5-T02).
  return new Set(sawColumn ? explicit : defaultIncludedIds(tables));
}

export interface TableInclusionChecklistProps {
  tables: readonly InclusionTable[];
  selected: ReadonlySet<string>;
  onToggle: (id: string, checked: boolean) => void;
  /**
   * Replaces the default row-count cell. The wizard passes one so it can degrade
   * counts per source (`—` for a schema file, `≈` for MySQL estimates) — a
   * concern the widget has no way to know about and must not guess at.
   */
  renderRowMeta?: ((table: InclusionTable) => ReactNode) | undefined;
  /** Annex §10 `piiDetection`. */
  piiDetection?: boolean | undefined;
  /** Annex §10 `maxHeight`, in px. */
  maxHeight?: number | undefined;
  /** `{included}` / `{total}` are substituted. Omit to hide the header count. */
  countTemplate?: string | undefined;
  piiLabel?: string | undefined;
  highVolumeLabel?: string | undefined;
  a11yLabel?: string | undefined;
  /** Rendered in place of the rows when there are none (the caller's copy). */
  emptyContent?: ReactNode | undefined;
  locale?: string | undefined;
  className?: string | undefined;
  'data-testid'?: string | undefined;
}

export function TableInclusionChecklist({
  tables,
  selected,
  onToggle,
  renderRowMeta,
  piiDetection = true,
  maxHeight,
  countTemplate,
  piiLabel,
  highVolumeLabel,
  a11yLabel,
  emptyContent,
  locale,
  className,
  'data-testid': testId,
}: TableInclusionChecklistProps) {
  const t = useMaybeT();
  // Signature defaults moved into the body so the English falls back through
  // t(); an explicit caller label still wins.
  const resolvedPiiLabel = piiLabel ?? t('ui:widgets.forms.tableInclusionChecklist.pii', 'PII');
  const resolvedHighVolumeLabel = highVolumeLabel ?? t('ui:widgets.forms.tableInclusionChecklist.highVolume', 'high volume');
  // Join/system tables are never listed (annex §10). Filtering HERE, not at the
  // call site, keeps the rule with the data: a caller that forgot would silently
  // offer to build dashboards on a join table.
  const visible = tables.filter((table) => !table.preHidden);
  const counts = inclusionCounts(tables, selected);

  return (
    <div
      className={cn('flex min-h-0 flex-col gap-2', className)}
      data-widget="table-inclusion-checklist"
      data-testid={testId}
    >
      {countTemplate !== undefined && (
        <div className="flex items-center justify-between gap-3">
          <span className="text-caption font-bold uppercase tracking-wide text-fg-subtle">{a11yLabel}</span>
          <MonoText data-part="inclusion-count" className="text-body-sm text-fg-muted">
            {countTemplate.replace('{included}', String(counts.included)).replace('{total}', String(counts.total))}
          </MonoText>
        </div>
      )}

      <ul
        aria-label={a11yLabel}
        data-part="table-list"
        className={cn(
          'm-0 flex list-none flex-col divide-y divide-border overflow-auto rounded-lg border border-border bg-surface p-0',
          maxHeight === undefined ? 'min-h-0 flex-1' : 'max-h-[var(--adm-max-h)]',
        )}
        {...(maxHeight === undefined ? {} : { style: { '--adm-max-h': `${maxHeight}px` } })}
      >
        {visible.map((table) => {
          const checked = selected.has(table.id);
          return (
            <li
              key={table.id}
              data-part="table-row"
              data-table={table.id}
              data-included={checked}
              className="flex items-center gap-3 px-3.5 py-2.5"
            >
              <Checkbox
                checked={checked}
                onCheckedChange={(next) => onToggle(table.id, next === true)}
                aria-label={table.id}
              />
              <MonoText className="min-w-0 flex-1 truncate text-body-sm text-fg">{table.id}</MonoText>
              {piiDetection && table.piiColumns > 0 && (
                <Badge tone="warn" data-part="pii-badge">
                  <ShieldAlert aria-hidden="true" className="size-3" />
                  {`${resolvedPiiLabel} · ${table.piiColumns}`}
                </Badge>
              )}
              {table.tag !== undefined && <Tag data-part="table-tag">{table.tag}</Tag>}
              {table.highVolume && <Badge tone="neutral" data-part="high-volume-badge">{resolvedHighVolumeLabel}</Badge>}
              {renderRowMeta !== undefined ? (
                renderRowMeta(table)
              ) : (
                <MonoText data-part="row-count" className="w-24 shrink-0 text-end text-body-sm text-fg-muted">
                  {formatRows(table.rowEstimate ?? undefined, locale) ?? '—'}
                </MonoText>
              )}
            </li>
          );
        })}
        {visible.length === 0 && emptyContent !== undefined && (
          <li className="px-3.5 py-6 text-center text-body-sm text-fg-muted">{emptyContent}</li>
        )}
      </ul>
    </div>
  );
}

/**
 * The registry binding (annex §10). Binds the §3 `record-list` shape — an empty
 * table list is genuinely empty, so the frame's empty state is the right answer
 * and this widget does not fake one.
 *
 * WRITE MODEL: one `update` intent per toggle carrying the WHOLE inclusion set,
 * not a delta. The stored value is a set (`settings.includedTables`), so sending
 * the set is sending the new value; a delta would make the host reconstruct
 * state it does not own.
 */
export function TableInclusionChecklistWidget({ config, data, onEvent }: WidgetProps<TableInclusionChecklistConfig>) {
  const t = useMaybeT();
  const tables = inclusionTablesOf(data, config);
  const [selected, setSelected] = useState<Set<string>>(() => initialInclusion(data, config, tables));
  const target = bindingTargetOf(config.binding);

  if (tables.length === 0) {
    return (
      <EmptyState
        compact
        preset="no-data"
        title={config.emptyTitle ?? t('ui:widgets.forms.tableInclusionChecklist.emptyTitle', 'No tables found')}
        body={config.emptyBody ?? t('ui:widgets.forms.tableInclusionChecklist.emptyBody', 'Connect a database and its tables will appear here.')}
      />
    );
  }

  const toggle = (id: string, checked: boolean) => {
    const next = new Set(selected);
    if (checked) next.add(id);
    else next.delete(id);
    setSelected(next);
    if (target === null) return;
    onEvent({
      type: 'mutate',
      intent: 'update',
      connectionId: target.connectionId,
      table: target.table,
      values: { includedTables: [...next].sort() },
    });
  };

  return (
    <div className="flex h-full min-h-0 flex-col px-[var(--widget-pad)] pb-[var(--widget-pad)]">
      <TableInclusionChecklist
        tables={tables}
        selected={selected}
        onToggle={toggle}
        piiDetection={config.piiDetection}
        maxHeight={config.maxHeight}
        countTemplate="{included}/{total}"
        {...(config.piiLabel === undefined ? {} : { piiLabel: config.piiLabel })}
        {...(config.highVolumeLabel === undefined ? {} : { highVolumeLabel: config.highVolumeLabel })}
        a11yLabel={config.a11yLabel ?? config.title ?? t('ui:widgets.forms.tableInclusionChecklist.a11yLabel', 'Tables to include')}
        locale={config.format?.locale}
        data-testid={config.testId}
      />
    </div>
  );
}
