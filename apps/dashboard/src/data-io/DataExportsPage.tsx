// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Data Exports (M7-T07, 09-generated-app.md §11.2): request an export
 * (table + format) and watch the artifact list — an optimistic `processing`
 * row lands immediately, progress rides the polled list (+ the export job's
 * `jobs:<id>` channel), and ready rows download through the authenticated
 * `/exports/:id/download` route. Rows render through `scheduled-jobs-list`
 * (the §11.2 "master list of jobs" consistency choice).
 *
 * xlsx is deliberately absent from the format picker — the server rejects it
 * in this build (no dependency-free workbook writer; documented deviation).
 */
import { useCallback, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Select } from '@adminium/ui';
import { ScheduledJobsList, type ScheduledJob } from '@adminium/widgets';

import { bootstrapQuery, flattenNav, type NavItem } from '../app/bootstrap.js';
import { pageQuery } from '../api/pages.js';
import { t } from '../i18n/t.js';
import { dataIoApi, exportsListQuery, type ExportDto, type ExportFormat } from './api.js';

function statusLine(row: ExportDto): string {
  switch (row.status) {
    case 'processing':
      return t('dataio.exports.statusProcessing', 'Processing…');
    case 'ready':
      return t('dataio.exports.statusReady', 'Ready — {rows} rows · click to download', {
        rows: row.rowCount ?? 0,
      });
    case 'failed':
      return t('dataio.exports.statusFailed', 'Failed — {error}', { error: row.error ?? '?' });
    case 'cancelled':
      return t('dataio.exports.statusCancelled', 'Cancelled');
    case 'expired':
      return t('dataio.exports.statusExpired', 'Expired');
  }
}

function toneOf(row: ExportDto): string {
  switch (row.status) {
    case 'ready':
      return 'pos';
    case 'failed':
      return 'danger';
    case 'processing':
      return 'info';
    default:
      return 'neutral';
  }
}

export function DataExportsPage() {
  const queryClient = useQueryClient();
  const boot = useQuery({ ...bootstrapQuery(), enabled: false });
  const exportsList = useQuery(exportsListQuery());

  const [target, setTarget] = useState<{ connectionId: string; table: string } | null>(null);
  const [targetError, setTargetError] = useState<string | null>(null);
  const [format, setFormat] = useState<ExportFormat>('csv');

  const navItems = useMemo(
    () => (boot.data === undefined ? [] : flattenNav(boot.data.nav)),
    [boot.data],
  );

  const pickTarget = useCallback(
    async (item: NavItem) => {
      setTargetError(null);
      const doc = await queryClient.ensureQueryData(pageQuery(item.pageId));
      const table = doc.status === 'ok' ? doc.page.source.table : null;
      const connectionId = doc.status === 'ok' ? doc.page.source.connectionId : null;
      if (
        doc.status !== 'ok' ||
        doc.page.template !== 'page-crud' ||
        typeof table !== 'string' ||
        table === '' ||
        typeof connectionId !== 'string'
      ) {
        setTarget(null);
        setTargetError(
          t('dataio.exports.notATable', 'That page is not a table — pick a table page to export.'),
        );
        return;
      }
      setTarget({ connectionId, table });
    },
    [queryClient],
  );

  const createMutation = useMutation({
    mutationFn: async () => {
      if (target === null) throw new Error('pick a table first');
      return dataIoApi.createExport({
        connectionId: target.connectionId,
        source: { kind: 'table', table: target.table },
        format,
      });
    },
    onSuccess: (reply) => {
      // Optimistic processing row (§11.2) — prepend, then let polling refine.
      queryClient.setQueryData(exportsListQuery().queryKey, (old: ExportDto[] | undefined) => [
        reply.data,
        ...(old ?? []),
      ]);
      void queryClient.invalidateQueries({ queryKey: ['data-io', 'exports'] });
    },
  });

  const download = useCallback((exportId: string) => {
    const anchor = document.createElement('a');
    anchor.href = dataIoApi.downloadHref(exportId);
    anchor.rel = 'noopener';
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
  }, []);

  const rows: ScheduledJob[] = useMemo(
    () =>
      (exportsList.data ?? []).map((row) => ({
        id: row.id,
        name: row.filename ?? `${row.source.table ?? row.source.kind}.${row.format}`,
        target: row.source.table ?? undefined,
        frequency: statusLine(row),
        format: row.format.toUpperCase(),
        next: undefined,
        enabled: row.status === 'ready',
        tone: toneOf(row),
      })),
    [exportsList.data],
  );

  return (
    // Gutter + column come from the route's `PageSurface` (data-io/routes.tsx).
    <div className="flex h-full min-h-0 flex-col gap-5">

      {/* --- request form ------------------------------------------------------ */}
      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-surface p-4">
        <label className="flex min-w-56 flex-col gap-1.5">
          <span className="text-body-sm font-medium text-fg">
            {t('dataio.exports.tableLabel', 'Table')}
          </span>
          <Select
            value=""
            onChange={(event) => {
              const item = navItems.find((nav) => nav.pageId === event.currentTarget.value);
              if (item !== undefined) void pickTarget(item);
            }}
          >
            <option value="">
              {target === null ? t('dataio.exports.tablePlaceholder', 'Choose a table…') : target.table}
            </option>
            {navItems.map((item) => (
              <option key={item.pageId} value={item.pageId}>
                {item.fallback}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-body-sm font-medium text-fg">
            {t('dataio.exports.formatLabel', 'Format')}
          </span>
          <Select
            value={format}
            onChange={(event) => setFormat(event.currentTarget.value as ExportFormat)}
          >
            <option value="csv">CSV</option>
            <option value="json">JSON</option>
          </Select>
        </label>
        <Button
          onClick={() => createMutation.mutate()}
          disabled={target === null || createMutation.isPending}
          data-testid="create-export"
        >
          {t('dataio.exports.create', 'Export')}
        </Button>
        <p className="basis-full text-caption text-fg-subtle">
          {t('dataio.exports.retention', 'Exports are kept for 30 days, then expire.')}
        </p>
      </div>

      {targetError !== null ? <Alert tone="warn" title={targetError} /> : null}
      {createMutation.isError ? (
        <Alert
          tone="danger"
          title={
            createMutation.error instanceof Error
              ? createMutation.error.message
              : t('dataio.exports.createFailed', 'Could not request the export.')
          }
        />
      ) : null}

      {/* --- artifact list ------------------------------------------------------- */}
      <ScheduledJobsList
        jobs={rows}
        toggleable={false}
        showRecipients={false}
        nextRunLabel=""
        emptyTitle={t('dataio.exports.emptyTitle', 'No exports yet')}
        emptyBody={t('dataio.exports.emptyBody', 'Request one above — artifacts appear here with their status.')}
        onSelect={(job) => {
          const row = (exportsList.data ?? []).find((entry) => entry.id === String(job.id));
          if (row !== undefined && row.status === 'ready') download(row.id);
        }}
        testId="exports-list"
      />
    </div>
  );
}
