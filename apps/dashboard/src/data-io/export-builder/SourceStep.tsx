// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Step 1 — Source (comp 161-207): "Which table?", the connection chip, the
 * table search, the table list with locked rows, and the "Start from" card.
 */
import { useState } from 'react';
import { Check, Database, Lock, Table2 } from 'lucide-react';
import { SearchInput, Select, cn } from '@adminium/ui';

import type { ExportSourcesDto, ExportSourceTable } from '../api.js';
import { copy } from './copy.js';

export type StartFrom = 'all' | { pageId: string };

export interface SourceStepProps {
  sources: ExportSourcesDto;
  /** All connections the viewer can see; a chip for one, a select for more. */
  connections: { id: string; name: string }[];
  onConnection: (id: string) => void;
  selected: string | null;
  onSelect: (table: ExportSourceTable) => void;
  onLocked: (table: ExportSourceTable) => void;
  from: StartFrom;
  onFrom: (from: StartFrom) => void;
}

function formatCount(n: number): string {
  return n.toLocaleString();
}

export function SourceStep({
  sources,
  connections,
  onConnection,
  selected,
  onSelect,
  onLocked,
  from,
  onFrom,
}: SourceStepProps) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const tables = sources.tables.filter(
    (table) => q === '' || table.name.toLowerCase().includes(q) || (table.label ?? '').toLowerCase().includes(q),
  );
  const current = sources.tables.find((table) => table.id === selected) ?? null;

  return (
    <div className="flex flex-col gap-3.5" data-testid="export-builder-source">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-[16px] font-extrabold tracking-[-0.015em] text-fg">{copy.sourceTitle()}</span>
        {connections.length > 1 ? (
          <Select
            aria-label={copy.sourceTitle()}
            value={sources.connection.id}
            onChange={(event) => onConnection(event.currentTarget.value)}
            data-testid="export-builder-connection"
          >
            {connections.map((connection) => (
              <option key={connection.id} value={connection.id}>
                {connection.name}
              </option>
            ))}
          </Select>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-3 px-2.5 py-1 text-[11.5px] font-bold text-fg-muted">
            <Database className="size-[13px]" aria-hidden="true" />
            <span className="font-mono">{sources.connection.name}</span>
          </span>
        )}
        <span className="text-[11.5px] text-fg-subtle">{sources.connection.dialect}</span>
      </div>

      <SearchInput
        className="max-w-[360px]"
        value={query}
        onChange={(event) => setQuery(event.currentTarget.value)}
        placeholder={copy.sourceSearch()}
        aria-label={copy.sourceSearch()}
        data-testid="export-builder-table-search"
      />

      <div className="overflow-hidden rounded-[14px] border border-border bg-surface shadow-card">
        {tables.map((table) => {
          const isSelected = table.id === selected;
          const locked = !table.canExport;
          const rows = table.rowCountEstimate === null ? null : formatCount(table.rowCountEstimate);
          const meta = [
            rows === null ? copy.sourceMetaNoRows(table.columnCount) : copy.sourceMeta(rows, table.columnCount),
            ...(table.usedBy > 0 ? [copy.sourceUsedBy(table.usedBy)] : []),
          ].join(' · ');
          return (
            <button
              key={table.id}
              type="button"
              onClick={() => (locked ? onLocked(table) : onSelect(table))}
              aria-pressed={isSelected}
              aria-disabled={locked}
              data-testid={`export-builder-table-${table.name}`}
              className={cn(
                'flex w-full items-center gap-3 border-b border-border px-4 py-3 text-start last:border-b-0 hover:bg-surface-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent',
                isSelected && 'bg-accent-soft',
                locked && 'cursor-not-allowed opacity-50',
              )}
            >
              <span
                className={cn(
                  'flex size-[30px] shrink-0 items-center justify-center rounded-[9px]',
                  isSelected ? 'bg-accent text-accent-fg' : 'bg-surface-3 text-fg-subtle',
                )}
              >
                {locked ? <Lock className="size-[15px]" aria-hidden="true" /> : <Table2 className="size-[15px]" aria-hidden="true" />}
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[13px] font-semibold text-fg">{table.name}</span>
                  {table.label === null ? null : <span className="text-[12px] font-semibold text-fg-muted">{table.label}</span>}
                </span>
                <span className="font-mono text-[10.5px] text-fg-subtle">{meta}</span>
              </span>
              {locked ? <span className="shrink-0 text-[11px] font-bold text-fg-subtle">{copy.sourceLocked()}</span> : null}
              {isSelected ? (
                <span className="flex size-[22px] shrink-0 items-center justify-center rounded-full bg-accent text-accent-fg">
                  <Check className="size-[13px]" aria-hidden="true" />
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      {current === null ? null : (
        <div
          className="flex flex-col gap-3 rounded-[14px] border border-border bg-surface p-[var(--card-pad,20px)] shadow-card"
          data-testid="export-builder-start-from"
        >
          <div>
            <div className="text-[13.5px] font-extrabold text-fg">{copy.startFromTitle()}</div>
            <div className="mt-[3px] text-[12px] text-fg-muted">{copy.startFromBody()}</div>
          </div>
          <StartOption
            on={from === 'all'}
            label={copy.startFromAll(current.name)}
            onClick={() => onFrom('all')}
            testId="export-builder-start-all"
          />
          {current.pages.map((page) => (
            <StartOption
              key={page.id}
              on={from !== 'all' && from.pageId === page.id}
              label={copy.startFromPage(page.title)}
              meta={copy.startFromPageMeta(page.title, page.columns, page.linked, page.totals)}
              onClick={() => onFrom({ pageId: page.id })}
              testId={`export-builder-start-${page.id}`}
            />
          ))}
          {current.pages.length === 0 ? (
            <div className="flex w-full items-center gap-3 rounded-[11px] border border-dashed border-border-strong bg-surface-2 px-3 py-3 text-[12.5px] font-semibold text-fg-subtle">
              {copy.startFromNone()}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

function StartOption({
  on,
  label,
  meta,
  onClick,
  testId,
}: {
  on: boolean;
  label: string;
  meta?: string;
  onClick: () => void;
  testId: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      onClick={onClick}
      data-testid={testId}
      className={cn(
        'flex w-full items-center gap-3 rounded-[11px] border px-3 py-3 text-start focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent',
        on ? 'border-accent bg-accent-soft' : 'border-border bg-surface',
      )}
    >
      <span
        className={cn(
          'flex size-[17px] shrink-0 items-center justify-center rounded-full border-2 bg-surface',
          on ? 'border-accent' : 'border-border-strong',
        )}
      >
        {on ? <span className="size-[9px] rounded-full bg-accent" /> : null}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-[13px] font-bold text-fg">{label}</span>
        {meta === undefined ? null : <span className="font-mono text-[10.5px] text-fg-subtle">{meta}</span>}
      </span>
    </button>
  );
}
