// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Import Wizard (M7-T07, 09-generated-app.md §11.1) — the four-step flow on
 * the `page-wizard` template shell: Upload (target picker + `upload-dropzone`)
 * → Map columns (`column-mapping-table`, auto-match, "Don't import") →
 * Validate (`validation-issues-list`, NON-BLOCKING: invalid rows are counted
 * as rows-to-skip, never a wall) → Import & review (job progress via the jobs
 * API polled + a `jobs:<id>` realtime subscription, then the review numbers).
 *
 * NUMBER CONSISTENCY IS AN INVARIANT (§11.1): imported = created + updated +
 * skipped — asserted here in the component; a mismatch renders the
 * inconsistency warning instead of silently pretty-printing wrong math.
 *
 * Target selection rides the nav tree: picking a table page lazily fetches
 * its envelope (`pageQuery`) and reads `source.connectionId`/`source.table` +
 * `config.columns[]` — no admin-only schema endpoint involved, so the wizard
 * works for anyone holding the per-table import grant.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, ProgressBar, Select, Spinner } from '@adminium/ui';
import {
  ColumnMappingTableWidget,
  PageWizard,
  SKIP_TARGET,
  UploadDropzone,
  ValidationIssuesListWidget,
  columnMappingTableConfigSchema,
  validationIssuesListConfigSchema,
  type WidgetEvent,
} from '@adminium/widgets';

import { bootstrapQuery, flattenNav, type NavItem } from '../app/bootstrap.js';
import { createRealtimeClient } from '../app/ws.js';
import { pageQuery } from '../api/pages.js';
import { t } from '../i18n/t.js';
import {
  dataIoApi,
  importQuery,
  jobQuery,
  type ImportDto,
  type UploadPreview,
  type ValidationReportDto,
} from './api.js';

export interface ImportTarget {
  connectionId: string;
  table: string;
  /** Destination field catalog (from the page's `config.columns[]`). */
  columns: { key: string; label?: string }[];
}

export interface ImportWizardPageProps {
  /** Pre-resolved target (the `page-wizard` binding passes the envelope's). */
  initialTarget?: ImportTarget | undefined;
}

type StepId = 'upload' | 'map' | 'validate' | 'run';

const STEP_IDS: readonly StepId[] = ['upload', 'map', 'validate', 'run'];

function targetColumnsOf(config: Record<string, unknown>): { key: string; label?: string }[] {
  const raw = config['columns'];
  if (!Array.isArray(raw)) return [];
  const out: { key: string; label?: string }[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue;
    const name = (entry as Record<string, unknown>)['name'];
    const label = (entry as Record<string, unknown>)['label'];
    if (typeof name === 'string' && name.length > 0) {
      out.push(typeof label === 'string' ? { key: name, label } : { key: name });
    }
  }
  return out;
}

/** §11.1 invariant — exported for tests. */
export function statsConsistent(stats: {
  total: number;
  inserted?: number;
  updated?: number;
  skipped?: number;
}): boolean {
  return stats.total === (stats.inserted ?? 0) + (stats.updated ?? 0) + (stats.skipped ?? 0);
}

export function ImportWizardPage({ initialTarget }: ImportWizardPageProps) {
  const queryClient = useQueryClient();
  const boot = useQuery({ ...bootstrapQuery(), enabled: false });

  const [step, setStep] = useState<StepId>('upload');
  const [target, setTarget] = useState<ImportTarget | null>(initialTarget ?? null);
  const [targetError, setTargetError] = useState<string | null>(null);
  const [preview, setPreview] = useState<UploadPreview | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  // from → to; SKIP_TARGET = explicit "Don't import"; absent = undecided.
  const mappingRef = useRef<Record<string, string>>({});
  const [importRow, setImportRow] = useState<ImportDto | null>(null);
  const [report, setReport] = useState<ValidationReportDto | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);

  const navItems = useMemo(
    () => (boot.data === undefined ? [] : flattenNav(boot.data.nav)),
    [boot.data],
  );

  // --- target picker (upload step) --------------------------------------------

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
          t('dataio.import.notATable', 'That page is not a table — pick a table page to import into.'),
        );
        return;
      }
      setTarget({ connectionId, table, columns: targetColumnsOf(doc.page.config) });
    },
    [queryClient],
  );

  // --- upload -------------------------------------------------------------------

  const uploadMutation = useMutation({
    mutationFn: (file: File) => dataIoApi.uploadImportFile(file),
    onSuccess: (data) => {
      setPreview(data);
      setUploadError(null);
      mappingRef.current = {};
      setStep('map');
    },
    onError: (error: unknown) => {
      setUploadError(error instanceof Error ? error.message : String(error));
    },
  });

  // --- mapping --------------------------------------------------------------------

  const mappingConfig = useMemo(() => {
    if (target === null) return null;
    return columnMappingTableConfigSchema.parse({
      binding: {
        connectionId: target.connectionId,
        source: { name: target.table },
        shape: 'record-list',
      },
      ...(target.columns.length > 0 ? { targets: target.columns } : {}),
      autoMatch: true,
      skipLabel: t('dataio.import.skipTarget', "Don't import"),
    });
  }, [target]);

  const mappingData = useMemo(() => {
    if (preview === null) return { rows: [], total: 0 };
    return {
      rows: preview.columns.map((column, index) => ({
        column,
        sample: preview.sampleRows[0]?.[index] ?? '',
      })),
      total: preview.columns.length,
    };
  }, [preview]);

  const onMappingEvent = useCallback((event: WidgetEvent) => {
    if (event.type !== 'mutate' || event.intent !== 'update') return;
    const mapping = (event.values as { mapping?: Record<string, string> }).mapping;
    if (mapping !== undefined) mappingRef.current = mapping;
  }, []);

  // --- validate ---------------------------------------------------------------------

  const validateMutation = useMutation({
    mutationFn: async () => {
      if (target === null || preview === null) throw new Error('wizard state out of order');
      const columns = preview.columns.map((from) => {
        const to = mappingRef.current[from];
        return { from, to: to === undefined || to === '' || to === SKIP_TARGET ? null : to };
      });
      return dataIoApi.createImport({
        fileId: preview.fileId,
        connectionId: target.connectionId,
        table: target.table,
        mapping: { columns },
        options: { mode: 'insert', skipInvalid: true },
      });
    },
    onSuccess: (reply) => {
      setImportRow(reply.data.import);
      setReport(reply.data.report);
      setStep('validate');
    },
  });

  const issuesData = useMemo(() => {
    if (report === null) return { rows: [], total: 0 };
    // Aggregate row-level issues into (column, code) triage lines.
    const grouped = new Map<string, { title: string; desc: string; count: number }>();
    for (const issue of report.issues) {
      const key = `${issue.column}:${issue.code}`;
      const existing = grouped.get(key);
      if (existing !== undefined) existing.count += 1;
      else grouped.set(key, { title: `${issue.column}: ${issue.code}`, desc: issue.message, count: 1 });
    }
    const rows = [...grouped.values()].map((row) => ({ severity: 'warn', ...row }));
    if (report.invalid === 0) {
      rows.push({
        severity: 'info',
        title: t('dataio.import.allValid', 'All rows passed validation'),
        desc: '',
        count: report.total,
      });
    }
    return { rows, total: rows.length };
  }, [report]);

  // --- run ----------------------------------------------------------------------------

  const runMutation = useMutation({
    mutationFn: async () => {
      if (importRow === null) throw new Error('nothing to run');
      return dataIoApi.runImport(importRow.id);
    },
    onSuccess: (reply) => {
      setJobId(reply.data.jobId);
      setStep('run');
    },
  });

  const job = useQuery(jobQuery(jobId));
  const running = job.data?.status === 'pending' || job.data?.status === 'running';
  const importPoll = useQuery(importQuery(importRow?.id ?? '', importRow !== null && step === 'run'));
  const finished = importPoll.data ?? importRow;

  // Progress also rides the realtime channel `jobs:<id>` (09 §11.1) — events
  // just poke the polled queries, so WS-less browsers degrade to polling.
  useEffect(() => {
    if (jobId === null) return;
    const client = createRealtimeClient({
      channels: [`jobs:${jobId}`],
      onEvent: () => {
        void queryClient.invalidateQueries({ queryKey: ['data-io', 'job', jobId] });
        if (importRow !== null) {
          void queryClient.invalidateQueries({ queryKey: ['data-io', 'import', importRow.id] });
        }
      },
    });
    client.start();
    return () => {
      client.stop();
    };
  }, [jobId, importRow, queryClient]);

  // --- render -------------------------------------------------------------------------

  const steps = [
    { id: 'upload', label: t('dataio.import.stepUpload', 'Upload') },
    { id: 'map', label: t('dataio.import.stepMap', 'Map columns') },
    { id: 'validate', label: t('dataio.import.stepValidate', 'Validate') },
    { id: 'run', label: t('dataio.import.stepRun', 'Import & review') },
  ];

  const stats = finished?.stats ?? null;
  const consistent = stats === null || statsConsistent(stats);

  const body = ((): ReactElement => {
    switch (step) {
      case 'upload':
        return (
          <div className="flex flex-col gap-4">
            <label className="flex max-w-md flex-col gap-1.5">
              <span className="text-body-sm font-medium text-fg">
                {t('dataio.import.targetLabel', 'Target table')}
              </span>
              <Select
                value=""
                onChange={(event) => {
                  const item = navItems.find((nav) => nav.pageId === event.currentTarget.value);
                  if (item !== undefined) void pickTarget(item);
                }}
              >
                <option value="">
                  {target === null
                    ? t('dataio.import.targetPlaceholder', 'Choose a table page…')
                    : target.table}
                </option>
                {navItems.map((item) => (
                  <option key={item.pageId} value={item.pageId}>
                    {item.fallback}
                  </option>
                ))}
              </Select>
            </label>
            {targetError !== null ? <Alert tone="warn" title={targetError} /> : null}
            {uploadError !== null ? <Alert tone="danger" title={uploadError} /> : null}
            <UploadDropzone
              accept=".csv,text/csv"
              multiple={false}
              disabled={target === null || uploadMutation.isPending}
              dropTitle={t('dataio.import.dropTitle', 'Drop a CSV file to import')}
              hint={t('dataio.import.dropHint', 'CSV up to 32 MB — the first row must be the header')}
              onFiles={(files) => {
                const file = files[0];
                if (file !== undefined) uploadMutation.mutate(file);
              }}
              testId="import-upload"
            />
            {uploadMutation.isPending ? <Spinner size="sm" /> : null}
          </div>
        );
      case 'map':
        return preview === null || mappingConfig === null ? (
          <Spinner size="md" />
        ) : (
          <div className="flex min-h-0 flex-col gap-3">
            <p className="text-body-sm text-fg-muted">
              {t('dataio.import.mapHint', '{count} data rows in {file} — choose a target for each column.', {
                count: preview.totalRows,
                file: preview.filename,
              })}
            </p>
            <ColumnMappingTableWidget
              config={mappingConfig}
              data={mappingData}
              instanceId="import-wizard-mapping"
              onEvent={onMappingEvent}
            />
            {validateMutation.isError ? (
              <Alert
                tone="danger"
                title={
                  validateMutation.error instanceof Error
                    ? validateMutation.error.message
                    : t('dataio.import.validateFailed', 'Validation failed.')
                }
              />
            ) : null}
          </div>
        );
      case 'validate':
        return report === null ? (
          <Spinner size="md" />
        ) : (
          <div className="flex min-h-0 flex-col gap-3">
            <p className="text-body-sm text-fg" data-testid="validation-summary">
              {t(
                'dataio.import.validationSummary',
                '{valid} of {total} rows ready to import — {invalid} will be skipped.',
                { valid: report.valid, total: report.total, invalid: report.invalid },
              )}
            </p>
            <ValidationIssuesListWidget
              config={validationIssuesListConfigSchema.parse({})}
              data={issuesData}
              instanceId="import-wizard-issues"
              onEvent={() => undefined}
            />
          </div>
        );
      case 'run': {
        const pct = job.data?.progress?.pct ?? (finished?.status === 'succeeded' ? 100 : 0);
        return (
          <div className="flex flex-col gap-4">
            <ProgressBar
              value={pct}
              label={t('dataio.import.progressLabel', 'Import progress')}
              tone={finished?.status === 'failed' ? 'danger' : 'accent'}
            />
            {running || finished === null ? (
              <p className="text-body-sm text-fg-muted">
                {job.data?.progress?.message ?? t('dataio.import.running', 'Importing…')}
              </p>
            ) : stats !== null ? (
              <div className="flex flex-col gap-3" data-testid="import-review">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {(
                    [
                      [t('dataio.import.kpiTotal', 'Rows in file'), stats.total],
                      [t('dataio.import.kpiCreated', 'Created'), stats.inserted ?? 0],
                      [t('dataio.import.kpiUpdated', 'Updated'), stats.updated ?? 0],
                      [t('dataio.import.kpiSkipped', 'Skipped'), stats.skipped ?? 0],
                    ] as const
                  ).map(([label, value]) => (
                    <div key={label} className="rounded-lg border border-border bg-surface p-3">
                      <div className="text-caption font-bold uppercase tracking-wide text-fg-subtle">
                        {label}
                      </div>
                      <div className="font-mono text-h3 text-fg tabular-nums">{value}</div>
                    </div>
                  ))}
                </div>
                {!consistent ? (
                  <Alert
                    tone="danger"
                    title={t(
                      'dataio.import.inconsistent',
                      'Import numbers are inconsistent — total must equal created + updated + skipped.',
                    )}
                  />
                ) : null}
                {finished !== null && finished.errorReportFileId !== null ? (
                  <a
                    className="text-body-sm text-accent underline underline-offset-2"
                    href={dataIoApi.errorReportHref(finished.id)}
                  >
                    {t('dataio.import.downloadErrors', 'Download the skipped-rows report (CSV)')}
                  </a>
                ) : null}
              </div>
            ) : (
              <Alert
                tone="danger"
                title={t('dataio.import.runFailed', 'The import failed.')}
                body={job.data?.lastError ?? undefined}
              />
            )}
          </div>
        );
      }
    }
  })();

  const footer = ((): ReactElement | null => {
    switch (step) {
      case 'upload':
        return null; // uploading advances automatically
      case 'map':
        return (
          <>
            <Button variant="ghost" onClick={() => setStep('upload')}>
              {t('dataio.back', 'Back')}
            </Button>
            <Button
              onClick={() => validateMutation.mutate()}
              disabled={validateMutation.isPending}
              data-testid="wizard-validate"
            >
              {validateMutation.isPending
                ? t('dataio.import.validating', 'Validating…')
                : t('dataio.import.toValidate', 'Validate')}
            </Button>
          </>
        );
      case 'validate':
        return (
          <>
            <Button variant="ghost" onClick={() => setStep('map')}>
              {t('dataio.back', 'Back')}
            </Button>
            <Button
              onClick={() => runMutation.mutate()}
              disabled={runMutation.isPending || importRow === null}
              data-testid="wizard-run"
            >
              {report !== null && report.invalid > 0
                ? t('dataio.import.runSkipping', 'Import {valid} rows (skip {invalid})', {
                    valid: report.valid,
                    invalid: report.invalid,
                  })
                : t('dataio.import.run', 'Run import')}
            </Button>
          </>
        );
      case 'run':
        return null;
    }
  })();

  return (
    // No gutter of its own: this renders both at `/imports` (wrapped by the
    // route's `PageSurface`) and as the `page-wizard` template body (wrapped by
    // PageRenderer's). Owning one here would double the padding in both.
    <div className="flex h-full min-h-0 flex-col">
      <PageWizard
        steps={steps}
        activeStepId={step}
        stepStates={finished?.status === 'failed' ? { run: 'error' } : undefined}
        onSelectStep={(id) => {
          // Revisiting resets everything downstream of the step returned to.
          if (STEP_IDS.indexOf(id as StepId) < STEP_IDS.indexOf(step)) setStep(id as StepId);
        }}
        footer={footer ?? undefined}
        testId="import-wizard"
      >
        {body}
      </PageWizard>
    </div>
  );
}
