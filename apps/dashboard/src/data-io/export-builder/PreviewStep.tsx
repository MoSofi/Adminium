// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Step 3 — Preview & export (comp 454-578): the settings row (file name,
 * format, rows, header row), the preview card with its Table and Raw file
 * tabs and four sample states, the summary rail and the "Worth knowing" card.
 * The sample comes from `POST /exports/preview` — the job's resolver and
 * writer — so a cell here is the cell in the file.
 */
import { OctagonAlert, RotateCw, TriangleAlert } from 'lucide-react';
import { SegmentedControl, Select, Skeleton, Switch, Tabs, TabsContent, TabsList, TabsTrigger, cn } from '@adminium/ui';

import type { ExportPreviewDto, ExportSavedViewDto } from '../api.js';
import { copy } from './copy.js';
import { formatSize, type DraftSettings } from './model.js';

export interface PreviewStepProps {
  settings: DraftSettings;
  onSettings: (patch: Partial<DraftSettings>) => void;
  views: ExportSavedViewDto[];
  /** The table's row estimate, for "All rows · n". */
  tableRows: number | null;
  fileName: string;
  preview: ExportPreviewDto | null;
  loading: boolean;
  error: string | null;
  refreshedAt: number | null;
  onRefresh: () => void;
  tab: 'table' | 'raw';
  onTab: (tab: 'table' | 'raw') => void;
  columnCount: number;
}

function formatCount(n: number | null): string {
  return n === null ? '—' : n.toLocaleString();
}

export function PreviewStep({
  settings,
  onSettings,
  views,
  tableRows,
  fileName,
  preview,
  loading,
  error,
  refreshedAt,
  onRefresh,
  tab,
  onTab,
  columnCount,
}: PreviewStepProps) {
  const rowCount = preview?.rowCount ?? (settings.scope === 'view' ? settings.view?.rowCount ?? null : tableRows);
  const maskedCount = preview?.columns.filter((column) => column.masked).length ?? 0;
  const warnings: { key: string; text: string }[] = [];
  if (maskedCount > 0) warnings.push({ key: 'masked', text: copy.warnMasked(maskedCount) });
  if (settings.scope === 'view' && settings.view?.hasSearch === true) warnings.push({ key: 'search', text: copy.warnSearch() });
  if (rowCount === 0) warnings.push({ key: 'rows', text: copy.warnNoRows() });
  const minutes = refreshedAt === null ? 0 : Math.floor((Date.now() - refreshedAt) / 60_000);
  const when = minutes < 1 ? copy.justNow() : copy.minutesAgo(minutes);
  const isCsv = settings.format === 'csv';
  const failed = !loading && error !== null;
  const showBody = !loading && !failed && preview !== null;

  return (
    <div className="flex flex-col gap-3.5" data-testid="export-builder-preview">
      <span className="text-[16px] font-extrabold tracking-[-0.015em] text-fg">{copy.previewTitle()}</span>

      <div className="flex flex-wrap items-end gap-3.5 rounded-[14px] border border-border bg-surface px-4 py-[15px] shadow-card max-[900px]:flex-col max-[900px]:items-stretch">
        <label className="flex min-w-[220px] flex-1 flex-col gap-1.5">
          <Label>{copy.fileName()}</Label>
          <input
            value={settings.name === '' ? fileName : settings.name}
            onChange={(event) => onSettings({ name: event.currentTarget.value.replace(/\.(csv|jsonl)$/i, '') })}
            className="w-full rounded-[10px] border border-border-strong bg-surface-2 px-[11px] py-[9px] font-mono text-[12.5px] text-fg outline-none focus-visible:shadow-[0_0_0_3px_var(--accent-soft)]"
            data-testid="export-builder-file-name"
          />
        </label>
        <div className="flex flex-col gap-1.5">
          <Label>{copy.format()}</Label>
          <SegmentedControl
            aria-label={copy.format()}
            value={settings.format}
            onValueChange={(value) => onSettings({ format: value === 'json' ? 'json' : 'csv' })}
            options={[
              { value: 'csv', label: copy.csv() },
              { value: 'json', label: copy.jsonl() },
            ]}
            data-testid="export-builder-format"
          />
        </div>
        <div className="flex min-w-[240px] flex-col gap-1.5">
          <Label>{copy.rows()}</Label>
          <SegmentedControl
            aria-label={copy.rows()}
            value={settings.scope}
            onValueChange={(value) =>
              onSettings({ scope: value === 'view' ? 'view' : 'all', view: value === 'view' ? settings.view ?? views[0] ?? null : settings.view })
            }
            options={[
              { value: 'all', label: tableRows === null ? copy.allRowsUnknown() : copy.allRows(formatCount(tableRows)) },
              { value: 'view', label: copy.viewRows() },
            ]}
            data-testid="export-builder-scope"
          />
          {settings.scope === 'view' ? (
            <Select
              aria-label={copy.savedView()}
              value={settings.view?.id ?? ''}
              onChange={(event) => onSettings({ view: views.find((view) => view.id === event.currentTarget.value) ?? null })}
              data-testid="export-builder-view"
            >
              {views.map((view) => (
                <option key={view.id} value={view.id}>
                  {view.rowCount === null
                    ? copy.viewLabelNoRows(view.name, view.filterCount)
                    : copy.viewLabel(view.name, view.filterCount, formatCount(view.rowCount))}
                </option>
              ))}
            </Select>
          ) : null}
        </div>
        {isCsv ? (
          <div className="flex flex-col gap-1.5">
            <Label>{copy.headerRow()}</Label>
            <Switch
              aria-label={copy.headerRow()}
              checked={settings.headerRow}
              onCheckedChange={(checked) => onSettings({ headerRow: checked })}
              data-testid="export-builder-header-row"
            />
          </div>
        ) : null}
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,296px)] items-start gap-3.5 max-[1080px]:grid-cols-1">
        <div className="min-w-0 overflow-hidden rounded-2xl border border-border bg-surface shadow-card">
          <Tabs value={tab} onValueChange={(value) => onTab(value === 'raw' ? 'raw' : 'table')} variant="pill">
            <div className="flex flex-wrap items-center gap-2.5 border-b border-border px-4 py-3">
              <TabsList>
                <TabsTrigger value="table" data-testid="export-builder-tab-table">
                  {copy.tabTable()}
                </TabsTrigger>
                <TabsTrigger value="raw" data-testid="export-builder-tab-raw">
                  {copy.tabRaw()}
                </TabsTrigger>
              </TabsList>
              <div className="ms-auto flex items-center gap-2">
                <span className="text-[11px] text-fg-subtle" data-testid="export-builder-sample-caption">
                  {copy.sample(preview?.sampleRows ?? 20, when)}
                </span>
                <button
                  type="button"
                  onClick={onRefresh}
                  className="nb-ib inline-flex items-center gap-1.5 rounded-[9px] border border-border bg-surface px-2.5 py-1.5 text-[11.5px] font-bold text-fg-muted"
                  data-testid="export-builder-refresh"
                >
                  <RotateCw className="size-[13px]" aria-hidden="true" />
                  {copy.refresh()}
                </button>
              </div>
            </div>

            {loading ? (
              <div className="flex flex-col gap-2 p-4" data-testid="export-builder-sample-loading">
                {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
                  <Skeleton key={i} height={i === 0 ? 18 : 14} width={`${100 - (i % 3) * 12}%`} rounded="md" />
                ))}
              </div>
            ) : null}

            {failed ? (
              <div className="m-4 flex items-start gap-2.5 rounded-xl border border-danger bg-danger-soft p-3.5" data-testid="export-builder-sample-failed">
                <OctagonAlert className="mt-px size-[17px] shrink-0 text-danger" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <div className="text-[12.5px] font-extrabold text-danger">{copy.sampleFailed()}</div>
                  <div className="mt-[3px] text-[11.5px] text-fg-muted">{error}</div>
                </div>
                <button
                  type="button"
                  onClick={onRefresh}
                  className="nb-ib inline-flex shrink-0 items-center gap-1.5 rounded-[9px] bg-danger px-3 py-[7px] text-[11.5px] font-extrabold text-accent-fg"
                  data-testid="export-builder-retry"
                >
                  <RotateCw className="size-[13px]" aria-hidden="true" />
                  {copy.retry()}
                </button>
              </div>
            ) : null}

            {showBody ? (
              <>
                <TabsContent value="table">
                  <div className="max-h-[460px] overflow-auto focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent" tabIndex={0} role="region" aria-label={copy.tabTable()}>
                    <table className="w-full border-separate border-spacing-0" data-testid="export-builder-sample-table">
                      <thead>
                        <tr>
                          {preview.columns.map((column) => (
                            <th
                              key={column.key}
                              className="sticky top-0 z-[2] whitespace-nowrap border-b border-border bg-surface-2 px-[13px] py-[9px] text-start text-[11px] font-extrabold uppercase tracking-[.03em] text-fg-subtle"
                            >
                              {column.header}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {preview.rows.map((row, rowIndex) => (
                          <tr key={rowIndex} className="hover:bg-surface-2">
                            {row.map((cell, cellIndex) => {
                              const column = preview.columns[cellIndex];
                              const mono = column?.numeric === true || column?.masked === true;
                              return (
                                <td
                                  key={column?.key ?? cellIndex}
                                  className={cn(
                                    'whitespace-nowrap border-b border-border px-[13px] py-[9px] text-start text-[12px] font-medium',
                                    mono && 'font-mono',
                                    cell === '' || column?.masked === true ? 'text-fg-subtle' : 'text-fg',
                                  )}
                                >
                                  {cell}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {rowCount === 0 ? (
                    <div className="border-t border-border px-4 py-3.5 text-[11.5px] text-fg-muted">{copy.headerOnly()}</div>
                  ) : null}
                </TabsContent>
                <TabsContent value="raw">
                  <div className="max-h-[460px] overflow-auto bg-surface-2 px-4 py-3.5 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent" tabIndex={0} role="region" aria-label={copy.tabRaw()} data-testid="export-builder-sample-raw">
                    {preview.raw.map((line, index) => (
                      <div key={index} className="flex items-baseline gap-3">
                        <span className="w-5 shrink-0 text-start font-mono text-[10.5px] text-fg-subtle">{index + 1}</span>
                        <span className="whitespace-pre font-mono text-[11.5px] leading-[1.75] text-fg">{line}</span>
                      </div>
                    ))}
                  </div>
                </TabsContent>
              </>
            ) : null}
          </Tabs>
        </div>

        <div className="flex flex-col gap-3 lg:sticky lg:top-24">
          <div className="flex flex-col gap-[11px] rounded-2xl border border-border bg-surface p-[var(--card-pad,20px)] shadow-card" data-testid="export-builder-summary-rail">
            <div className="text-[13px] font-extrabold text-fg">{copy.summaryTitle()}</div>
            <SummaryLine label={copy.summaryColumns()} value={String(columnCount)} />
            <SummaryLine label={copy.summaryRows()} value={formatCount(rowCount)} />
            <SummaryLine label={copy.summarySize()} value={preview?.estimatedBytes == null ? '—' : formatSize(preview.estimatedBytes)} />
            <SummaryLine label={copy.summaryRetention()} value={copy.summaryKept()} plain />
            <SummaryLine label={copy.summaryFileName()} value={fileName} wrap />
          </div>
          {warnings.length > 0 ? (
            <div className="flex flex-col gap-2 rounded-2xl border border-warn bg-warn-soft px-[15px] py-3.5" data-testid="export-builder-warnings">
              <div className="flex items-center gap-2 text-warn">
                <TriangleAlert className="size-[15px]" aria-hidden="true" />
                <span className="text-[12px] font-extrabold">{copy.warnTitle()}</span>
              </div>
              {warnings.map((warning) => (
                <div key={warning.key} className="text-[11.5px] leading-[1.5] text-warn">
                  {warning.text}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Label({ children }: { children: string }) {
  return <span className="block text-[11px] font-extrabold uppercase tracking-[.04em] text-fg-subtle">{children}</span>;
}

function SummaryLine({ label, value, plain, wrap }: { label: string; value: string; plain?: boolean; wrap?: boolean }) {
  return (
    <div className="flex items-baseline gap-2.5">
      <span className="flex-1 text-[11.5px] text-fg-muted">{label}</span>
      <span
        className={cn(
          'text-end',
          plain ? 'text-[11.5px] font-bold text-fg-muted' : 'font-mono text-[12px] font-semibold text-fg',
          wrap && 'break-all text-[11px]',
        )}
      >
        {value}
      </span>
    </div>
  );
}
