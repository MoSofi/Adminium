import { Avatar, ProgressBar, StatusPill, Switch } from '@adminium/ui';
import { useState } from 'react';
import { z } from 'zod';

import { formatRelativeTime } from './column-spec.js';
import type { GridRow } from './column-spec.js';
import type { WidgetProps } from '../../registry/types.js';
import { widgetSharedConfigSchema } from '../../registry/shared-config.js';

/**
 * `master-list` (annex §3) — selectable rich list rows driving a detail pane:
 * owner avatar, title/subtitle, status pill, optional inline toggle, progress
 * %, and per-row stats, filtered by a chip bar. Row selection is the primary
 * interaction (feeds a sibling detail widget); the inline toggle emits a
 * mutation intent. Binds to a `record-list` + selection state.
 */

export const masterListConfigSchema = widgetSharedConfigSchema.extend({
  titleField: z.string().default('name'),
  subtitleField: z.string().optional(),
  statusField: z.string().optional(),
  toggleField: z.string().optional(),
  progressField: z.string().optional(),
  ownerField: z.string().optional(),
  updatedField: z.string().optional(),
  /** Column whose distinct values seed the filter chip bar. */
  filterField: z.string().optional(),
  selectable: z.boolean().default(true),
  allLabel: z.string().optional(),
  emptyTitle: z.string().optional(),
});
export type MasterListConfig = z.infer<typeof masterListConfigSchema>;

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

const RULES = [
  { name: 'Auto-assign new tickets', status: 'active', category: 'Support' },
  { name: 'Escalate SLA breach', status: 'active', category: 'Support' },
  { name: 'Weekly usage digest', status: 'paused', category: 'Reports' },
  { name: 'Churn risk alert', status: 'active', category: 'Growth' },
  { name: 'Failed payment retry', status: 'active', category: 'Billing' },
  { name: 'Onboarding nudge', status: 'draft', category: 'Growth' },
  { name: 'Backup export nightly', status: 'paused', category: 'Reports' },
] as const;
const OWNERS = ['Ada Lovelace', 'Grace Hopper', 'Alan Turing', 'Katherine Johnson'] as const;

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

/** Deterministic `record-list` of automation rules (04 §7.7). */
export function masterListDemoData(seed: number): { data: GridRow[] } {
  const random = mulberry32(seed || 1);
  const base = Date.UTC(2026, 6, 14, 9, 0, 0);
  const data: GridRow[] = RULES.map((rule, index) => ({
    id: index + 1,
    name: rule.name,
    status: rule.status,
    category: rule.category,
    enabled: rule.status === 'active',
    progress: Math.floor(random() * 100),
    owner_name: OWNERS[Math.floor(random() * OWNERS.length) % OWNERS.length],
    updated_at: new Date(base - Math.floor(random() * 96) * 3_600_000).toISOString(),
  }));
  return { data };
}
