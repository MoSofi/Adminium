import { Avatar, ProgressBar, StatusPill, Switch } from '@adminium/ui';
import { useState } from 'react';

import { formatRelativeTime } from './column-spec.js';
import type { GridRow } from './column-spec.js';
import type { MasterListConfig } from './tables-track-f-config.js';
import type { WidgetProps } from '../../registry/types.js';

/**
 * `master-list` (annex §3) — selectable rich list rows driving a detail pane:
 * owner avatar, title/subtitle, status pill, optional inline toggle, progress
 * %, and per-row stats, filtered by a chip bar. Row selection is the primary
 * interaction (feeds a sibling detail widget); the inline toggle emits a
 * mutation intent. Binds to a `record-list` + selection state.
 */

// Config schema + deterministic demo payload live in the pure
// `tables-track-f-config` module so the registry metadata graph never reaches
// this component file (04 §2.3). Re-exported here to keep existing import
// points stable.
export { masterListConfigSchema, masterListDemoData } from './tables-track-f-config.js';
export type { MasterListConfig } from './tables-track-f-config.js';

export interface MasterListProps {
  rows: readonly GridRow[];
  config: Pick<
    MasterListConfig,
    'titleField' | 'subtitleField' | 'statusField' | 'toggleField' | 'progressField' | 'ownerField' | 'updatedField' | 'filterField' | 'selectable'
  >;
  selectedId?: string | undefined;
  allLabel?: string | undefined;
  emptyTitle?: string | undefined;
  locale?: string | undefined;
  /** Injectable clock for deterministic relative timestamps in tests. */
  now?: number | undefined;
  rowIdField?: string | undefined;
  onSelect?: ((id: string, row: GridRow) => void) | undefined;
  onToggle?: ((id: string, next: boolean, row: GridRow) => void) | undefined;
  testId?: string | undefined;
}

function str(value: unknown): string | undefined {
  return value === null || value === undefined ? undefined : String(value);
}

export function MasterList({
  rows,
  config,
  selectedId,
  allLabel,
  emptyTitle,
  locale,
  now,
  rowIdField = 'id',
  onSelect,
  onToggle,
  testId,
}: MasterListProps) {
  const [activeFilter, setActiveFilter] = useState<string>('__all__');
  const [localSelected, setLocalSelected] = useState<string | undefined>(selectedId);
  const selected = selectedId ?? localSelected;

  const filterValues =
    config.filterField === undefined
      ? []
      : [...new Set(rows.map((row) => str(row[config.filterField as string])).filter((v): v is string => v !== undefined))];

  const filtered =
    config.filterField === undefined || activeFilter === '__all__'
      ? rows
      : rows.filter((row) => str(row[config.filterField as string]) === activeFilter);

  return (
    <div data-widget="master-list" data-testid={testId} className="flex h-full flex-col">
      {filterValues.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 border-b border-border px-3 py-2">
          {['__all__', ...filterValues].map((value) => (
            <button
              key={value}
              type="button"
              data-active={activeFilter === value}
              onClick={() => setActiveFilter(value)}
              className="rounded-full border border-border px-2.5 py-0.5 text-caption font-semibold text-fg-muted data-[active=true]:border-accent data-[active=true]:bg-accent-soft data-[active=true]:text-accent hover:text-fg focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
            >
              {value === '__all__' ? (allLabel ?? 'All') : value}
            </button>
          ))}
        </div>
      )}
      {filtered.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-4 py-8 text-center text-body-sm text-fg-muted">
          {emptyTitle ?? 'No items match this filter'}
        </div>
      ) : (
        <ul className="min-h-0 flex-1 divide-y divide-border/60 overflow-y-auto">
          {filtered.map((row) => {
            const id = String(row[rowIdField] ?? JSON.stringify(row));
            const title = str(row[config.titleField]) ?? id;
            const subtitle = config.subtitleField === undefined ? undefined : str(row[config.subtitleField]);
            const status = config.statusField === undefined ? undefined : str(row[config.statusField]);
            const owner = config.ownerField === undefined ? undefined : str(row[config.ownerField]);
            const updated = config.updatedField === undefined ? undefined : str(row[config.updatedField]);
            const progress =
              config.progressField === undefined ? undefined : Number(row[config.progressField]);
            const toggleOn = config.toggleField === undefined ? undefined : row[config.toggleField] === true;
            const isSelected = selected === id;
            return (
              <li key={id}>
                <div
                  role={config.selectable ? 'button' : undefined}
                  tabIndex={config.selectable ? 0 : undefined}
                  aria-current={isSelected ? true : undefined}
                  data-selected={isSelected}
                  onClick={
                    config.selectable
                      ? () => {
                          setLocalSelected(id);
                          onSelect?.(id, row);
                        }
                      : undefined
                  }
                  onKeyDown={
                    config.selectable
                      ? (event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            setLocalSelected(id);
                            onSelect?.(id, row);
                          }
                        }
                      : undefined
                  }
                  className="flex items-center gap-3 border-s-2 border-transparent px-3 py-2.5 data-[selected=true]:border-accent data-[selected=true]:bg-accent-soft/60 hover:bg-surface-2/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
                >
                  {owner !== undefined && <Avatar name={owner} size="sm" />}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-body-sm font-semibold text-fg">{title}</span>
                      {status !== undefined && <StatusPill status={status} />}
                    </div>
                    {subtitle !== undefined && <p className="truncate text-caption text-fg-muted">{subtitle}</p>}
                    {progress !== undefined && Number.isFinite(progress) && (
                      <div className="mt-1.5 flex items-center gap-2">
                        <ProgressBar value={progress} size="sm" className="max-w-40" label={`${title} progress`} />
                        <span className="font-mono text-caption tabular-nums text-fg-subtle">{Math.round(progress)}%</span>
                      </div>
                    )}
                    {updated !== undefined && (
                      <p className="mt-0.5 font-mono text-caption tabular-nums text-fg-subtle">
                        {formatRelativeTime(updated, { locale, ...(now === undefined ? {} : { now }) })}
                      </p>
                    )}
                  </div>
                  {toggleOn !== undefined && (
                    <Switch
                      checked={toggleOn}
                      aria-label={`Toggle ${title}`}
                      onClick={(event) => event.stopPropagation()}
                      onCheckedChange={(next) => onToggle?.(id, next, row)}
                    />
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function rowsOf(data: unknown): GridRow[] {
  if (Array.isArray(data)) return data as GridRow[];
  if (typeof data === 'object' && data !== null && Array.isArray((data as { data?: unknown }).data)) {
    return (data as { data: GridRow[] }).data;
  }
  return [];
}

export function MasterListWidget({ config, data, onEvent }: WidgetProps<MasterListConfig>) {
  const source = config.binding;
  const table = source === undefined ? undefined : source.source.schema === undefined ? source.source.name : `${source.source.schema}.${source.source.name}`;
  return (
    <MasterList
      rows={rowsOf(data)}
      config={config}
      {...(config.allLabel === undefined ? {} : { allLabel: config.allLabel })}
      {...(config.emptyTitle === undefined ? {} : { emptyTitle: config.emptyTitle })}
      {...(config.format?.locale === undefined ? {} : { locale: config.format.locale })}
      onSelect={(id, row) => {
        if (table !== undefined && source !== undefined) {
          onEvent({ type: 'record-open', connectionId: source.connectionId, table, recordId: (row['id'] as string | number | undefined) ?? id });
        }
      }}
      onToggle={(id, next) => {
        if (table !== undefined && source !== undefined && config.toggleField !== undefined) {
          onEvent({ type: 'mutate', intent: 'update', connectionId: source.connectionId, table, recordId: id, values: { [config.toggleField]: next } });
        }
      }}
    />
  );
}
