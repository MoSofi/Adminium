// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Left pane: searchable table tree with per-table column lists, mono type
 * chips and PK/FK/UNIQUE/PII badges (UI Kit schema explorer vocabulary).
 * Labels shown are the APPLIED ones from `GET /connections/:id/schema`
 * (server-side override application — the live-preview read path), with any
 * unsaved staged label layered on top and flagged with an accent dot.
 */
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Badge, MonoText, SearchInput, cn } from '@adminium/ui';

import { t } from '../../i18n/t.js';
import { lucideByName } from '../../lib/lucide.js';
import { SchemaBadges, TypeChip } from './badges.js';
import {
  columnDisplayLabel,
  tableDisplayLabel,
  type EffectiveModel,
  type EffectiveTable,
  type RemapSelection,
} from './model.js';
import { overrideKey, type RemapBuffer } from './useRemapBuffer.js';

export interface SchemaTreeProps {
  model: EffectiveModel;
  buffer: RemapBuffer;
  selection: RemapSelection | null;
  onSelect: (selection: RemapSelection) => void;
}

function stagedTableLabel(buffer: RemapBuffer, table: EffectiveTable): string | null {
  const entry = buffer.get(overrideKey({ op: 'table.label', tableName: table.id, value: { label: '' } }));
  if (entry === null || entry.item.op !== 'table.label') return null;
  return entry.item.value.label;
}

function stagedColumnLabel(buffer: RemapBuffer, tableId: string, column: string): string | null {
  const entry = buffer.get(
    overrideKey({ op: 'column.label', tableName: tableId, columnName: column, value: { label: '' } }),
  );
  if (entry === null || entry.item.op !== 'column.label') return null;
  return entry.item.value.label;
}

export function SchemaTree({ model, buffer, selection, onSelect }: SchemaTreeProps) {
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());

  const q = query.trim().toLowerCase();
  const visible = useMemo(() => {
    if (q === '') return model.tables;
    return model.tables.filter(
      (table) =>
        table.name.toLowerCase().includes(q) ||
        tableDisplayLabel(table).toLowerCase().includes(q) ||
        table.columns.some((column) => column.name.toLowerCase().includes(q)),
    );
  }, [model.tables, q]);

  const toggle = (tableId: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(tableId)) next.delete(tableId);
      else next.add(tableId);
      return next;
    });
  };

  return (
    <nav aria-label={t('studio:remap.tree.label', 'Schema')} className="flex min-h-0 flex-col gap-2">
      <SearchInput
        aria-label={t('studio:remap.tree.search', 'Search tables and columns')}
        placeholder={t('studio:remap.tree.searchPlaceholder', 'Search tables…')}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onClear={() => setQuery('')}
        clearLabel={t('common.clear', 'Clear')}
      />
      <ul className="min-h-0 flex-1 overflow-y-auto pe-1" data-testid="remap-tree">
        {visible.length === 0 ? (
          <li className="p-3 text-body-sm text-fg-muted">
            {t('studio:remap.tree.noMatches', 'No tables match your search.')}
          </li>
        ) : null}
        {visible.map((table) => {
          const isOpen = expanded.has(table.id) || q !== '';
          const staged = stagedTableLabel(buffer, table);
          const label = staged ?? tableDisplayLabel(table);
          const selected = selection?.kind === 'table' && selection.tableId === table.id;
          const excluded =
            buffer.get(overrideKey({ op: 'table.exclude', tableName: table.id, value: { excluded: true } }))
              ?.item.op === 'table.exclude'
              ? (buffer.get(
                  overrideKey({ op: 'table.exclude', tableName: table.id, value: { excluded: true } }),
                )?.item.value as { excluded: boolean }).excluded
              : table.excluded === true;
          const Icon = lucideByName(table.icon ?? 'table');
          return (
            <li key={table.id}>
              <div className="flex items-center gap-0.5">
                <button
                  type="button"
                  aria-label={
                    isOpen
                      ? t('studio:remap.tree.collapse', 'Collapse table')
                      : t('studio:remap.tree.expand', 'Expand table')
                  }
                  aria-expanded={isOpen}
                  className="rounded-sm p-1 text-fg-muted hover:text-fg"
                  onClick={() => toggle(table.id)}
                >
                  {isOpen ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5 rtl:-scale-x-100" />}
                </button>
                <button
                  type="button"
                  aria-current={selected ? 'true' : undefined}
                  className={cn(
                    'flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-start text-body-sm',
                    selected ? 'bg-surface-2 text-fg' : 'text-fg hover:bg-surface-2',
                    excluded && 'opacity-60',
                  )}
                  onClick={() => {
                    onSelect({ kind: 'table', tableId: table.id });
                    setExpanded((current) => new Set(current).add(table.id));
                  }}
                >
                  <Icon aria-hidden className="size-4 shrink-0 text-fg-muted" />
                  <span className="truncate font-medium">{label}</span>
                  {staged !== null ? (
                    <span
                      aria-label={t('studio:remap.tree.unsaved', 'Unsaved change')}
                      className="size-1.5 shrink-0 rounded-full bg-accent"
                    />
                  ) : null}
                  <MonoText className="ms-auto truncate text-[11px] text-fg-subtle">{table.name}</MonoText>
                  {excluded ? <Badge tone="neutral">{t('studio:remap.tree.excluded', 'Excluded')}</Badge> : null}
                </button>
              </div>
              {isOpen ? (
                <ul className="ms-5 border-s border-border ps-2">
                  {table.columns.map((column) => {
                    const stagedLabel = stagedColumnLabel(buffer, table.id, column.name);
                    const columnSelected =
                      selection?.kind === 'column' &&
                      selection.tableId === table.id &&
                      selection.column === column.name;
                    return (
                      <li key={column.name}>
                        <button
                          type="button"
                          aria-current={columnSelected ? 'true' : undefined}
                          className={cn(
                            'flex w-full items-center gap-2 rounded-md px-2 py-1 text-start text-body-sm',
                            columnSelected ? 'bg-surface-2 text-fg' : 'text-fg-muted hover:bg-surface-2 hover:text-fg',
                          )}
                          onClick={() => onSelect({ kind: 'column', tableId: table.id, column: column.name })}
                        >
                          <span className="truncate">{stagedLabel ?? columnDisplayLabel(column)}</span>
                          {stagedLabel !== null ? (
                            <span
                              aria-label={t('studio:remap.tree.unsaved', 'Unsaved change')}
                              className="size-1.5 shrink-0 rounded-full bg-accent"
                            />
                          ) : null}
                          <span className="ms-auto flex shrink-0 items-center gap-1">
                            <TypeChip type={column.logicalType} />
                            <SchemaBadges column={column} />
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
