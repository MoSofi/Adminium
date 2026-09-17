// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The Export Builder (comp): three steps — Source, Columns, Preview & export —
 * behind the Data Exports page's "New export", plus the no-access state, the
 * started card and the "Based on <file>" prefill from a finished export
 * (`?basedOn=`).
 *
 * The page owns the draft and the step; the steps render it. The step gating
 * is the comp's `goStep` (762-767): step 2 needs a table, step 3 needs at
 * least one column and no duplicate header; the footer's hints are its
 * `hint` strings (1074-1082) verbatim.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearch } from '@tanstack/react-router';
import { ArrowLeft, ArrowRight, CheckCircle2, Copy, Download, Lock } from 'lucide-react';
import { Button, Stepper, cn } from '@adminium/ui';

import { ApiError } from '../../app/api.js';
import { bootstrapQuery, flattenNav } from '../../app/bootstrap.js';
import { pageQuery } from '../../api/pages.js';
import { PageActions } from '../../shell/PageActionsProvider.js';
import { studioApi, type SchemaTable } from '../../studio/api.js';
import { findTable } from '../../studio/pages/columnSpecBuilder.js';
import {
  dataIoApi,
  exportQuery,
  exportSourcesQuery,
  exportViewsQuery,
  exportsListQuery,
  type ExportDto,
  type ExportSourceTable,
} from '../api.js';
import { ColumnsStep } from './ColumnsStep.js';
import { PreviewStep } from './PreviewStep.js';
import { SourceStep, type StartFrom } from './SourceStep.js';
import { StartedCard } from './StartedCard.js';
import { STEP_LABEL, copy } from './copy.js';
import {
  EMPTY_DRAFT,
  defaultDraft,
  defaultFileStem,
  draftFromPage,
  draftFromSource,
  duplicateHeaders,
  fileExtension,
  toSource,
  type Draft,
  type DraftSettings,
} from './model.js';

type Step = 0 | 1 | 2;

/** The comp's pill lives 2.6 s (comp 731). */
const TOAST_MS = 2_600;

/**
 * The comp's toast (77-81): a bottom-CENTRE pill that ignores the pointer.
 *
 * Not the shell's toast stack, and the reason is a defect the e2e run found:
 * that stack sits at the viewport's bottom END, exactly over this page's
 * Continue button on a short list, and pauses its own timer while the
 * pointer hovers it — so "add a column, reach for Continue" never landed.
 * The comp's pill is `pointer-events: none` and centred, which is why it can
 * never block a primary action (the house layout rule).
 */
function useBuilderToast(): { message: string | null; show: (message: string) => void } {
  const [message, setMessage] = useState<string | null>(null);
  const [timer, setTimer] = useState<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer !== null) clearTimeout(timer);
  }, [timer]);
  const show = useCallback((next: string) => {
    setTimer((current) => {
      if (current !== null) clearTimeout(current);
      return setTimeout(() => setMessage(null), TOAST_MS);
    });
    setMessage(next);
  }, []);
  return { message, show };
}

function BuilderToast({ message }: { message: string | null }) {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[26px] z-[300] flex justify-center" role="status" aria-live="polite">
      {message === null ? null : (
        <div
          className="inline-flex items-center gap-[9px] rounded-full bg-fg px-[18px] py-2.5 text-[12.5px] font-bold text-surface shadow-[0_10px_30px_rgba(10,10,20,.28)] animate-[nb-fade_.2s_ease]"
          data-testid="export-builder-toast"
        >
          <CheckCircle2 className="size-[15px]" aria-hidden="true" />
          {message}
        </div>
      )}
    </div>
  );
}

function schemaQueryFor(connectionId: string | null) {
  return {
    queryKey: ['data-io', 'export-schema', connectionId] as const,
    queryFn: () => studioApi.getSchema(connectionId as string),
    enabled: connectionId !== null,
  };
}

export function ExportBuilderPage() {
  const queryClient = useQueryClient();
  const builderToast = useBuilderToast();
  const search = useSearch({ strict: false }) as { basedOn?: string };
  const basedOn = search.basedOn ?? null;
  const boot = useQuery({ ...bootstrapQuery(), enabled: false });

  // Every connection the nav knows; the comp draws ONE chip and never a
  // control, so a select stands in only when there is more than one (a fill).
  const connections = useMemo(() => {
    const seen = new Map<string, string>();
    for (const item of boot.data === undefined ? [] : flattenNav(boot.data.nav)) {
      if (typeof item.connectionId === 'string' && !seen.has(item.connectionId)) {
        seen.set(item.connectionId, item.connectionName ?? item.connectionId);
      }
    }
    return [...seen.entries()].map(([id, name]) => ({ id, name }));
  }, [boot.data]);
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const activeConnection = connectionId ?? connections[0]?.id ?? null;

  const sources = useQuery(exportSourcesQuery(activeConnection));
  const schema = useQuery(schemaQueryFor(activeConnection));
  const basedOnRow = useQuery(exportQuery(basedOn));

  const [step, setStep] = useState<Step>(0);
  const [dir, setDir] = useState<'fwd' | 'back'>('fwd');
  const [tableId, setTableId] = useState<string | null>(null);
  const [from, setFrom] = useState<StartFrom>('all');
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [settings, setSettings] = useState<DraftSettings>({ format: 'csv', scope: 'all', view: null, headerRow: true, name: '' });
  const [tab, setTab] = useState<'table' | 'raw'>('table');
  const [started, setStarted] = useState<{ exportId: string; jobId: string | null; fileName: string; rows: number | null; format: 'csv' | 'json' } | null>(null);
  const [prefilled, setPrefilled] = useState(false);

  const table: SchemaTable | null = useMemo(() => findTable(schema.data, tableId), [schema.data, tableId]);
  const sourceTable: ExportSourceTable | null = sources.data?.tables.find((entry) => entry.id === tableId) ?? null;
  const views = useQuery(exportViewsQuery(activeConnection, step === 2 ? tableId : null));

  const toast = builderToast.show;

  // "Based on <file>": every step arrives pre-filled from the stored definition.
  useEffect(() => {
    if (prefilled || basedOnRow.data === undefined || schema.data === undefined) return;
    const row = basedOnRow.data;
    const stored = findTable(schema.data, row.source.table ?? null);
    if (stored === null) return;
    setTableId(stored.id);
    setDraft(draftFromSource(row.source, schema.data, stored));
    setSettings({
      format: row.format === 'json' ? 'json' : 'csv',
      scope: row.source.viewId ? 'view' : 'all',
      view: null,
      headerRow: row.source.options?.headerRow !== false,
      name: row.source.options?.fileName ?? '',
    });
    setPrefilled(true);
  }, [basedOnRow.data, schema.data, prefilled]);

  // A saved view chosen before the list arrived: attach it once it has.
  useEffect(() => {
    if (settings.scope !== 'view' || settings.view !== null || views.data === undefined) return;
    const wanted = basedOnRow.data?.source.viewId ?? null;
    const view = views.data.find((entry) => entry.id === wanted) ?? views.data[0] ?? null;
    if (view !== null) setSettings((current) => ({ ...current, view }));
  }, [views.data, settings.scope, settings.view, basedOnRow.data]);

  // "The columns of a page": the page's body, rebuilt as the draft.
  const fromPageId = from === 'all' ? null : from.pageId;
  const pageDoc = useQuery({ ...pageQuery(fromPageId ?? ''), enabled: fromPageId !== null });
  useEffect(() => {
    if (fromPageId === null || pageDoc.data === undefined || pageDoc.data.status !== 'ok' || schema.data === undefined || table === null) return;
    setDraft(draftFromPage(pageDoc.data.page.config as Record<string, unknown>, schema.data, table));
  }, [fromPageId, pageDoc.data, schema.data, table]);

  function selectTable(entry: ExportSourceTable): void {
    const found = findTable(schema.data, entry.id);
    setTableId(entry.id);
    setFrom('all');
    setDraft(found === null ? EMPTY_DRAFT : defaultDraft(found));
    setSettings({ format: 'csv', scope: 'all', view: null, headerRow: true, name: '' });
  }

  function goStep(next: Step): void {
    if (next === step) return;
    if (next > 0 && table === null) return;
    if (next > 1 && draft.columns.length === 0) return;
    setDir(next > step ? 'fwd' : 'back');
    setStep(next);
    setStarted(null);
  }

  const fileStem = settings.name.trim() === '' ? defaultFileStem(table) : settings.name.trim();
  const fileName = `${fileStem}${fileExtension(settings.format)}`;
  const source = table === null ? null : toSource(draft, table, settings);

  const preview = useQuery({
    queryKey: ['data-io', 'export-preview', activeConnection, JSON.stringify(source), settings.format] as const,
    queryFn: () =>
      dataIoApi.previewExport({ connectionId: activeConnection as string, source: source as NonNullable<typeof source>, format: settings.format, sampleRows: 20 }),
    enabled: step === 2 && activeConnection !== null && source !== null && started === null,
    retry: false,
  });
  const previewError =
    preview.error === null || preview.error === undefined
      ? null
      : preview.error instanceof ApiError && preview.error.status !== 504 && preview.error.status !== 408
        ? preview.error.message
        : copy.sampleTimeout();

  const createMutation = useMutation({
    mutationFn: async () => {
      if (activeConnection === null || source === null) throw new Error('pick a table first');
      return dataIoApi.createExport({ connectionId: activeConnection, source, format: settings.format });
    },
    onSuccess: (reply) => {
      queryClient.setQueryData(exportsListQuery().queryKey, (old: ExportDto[] | undefined) => [reply.data, ...(old ?? [])]);
      void queryClient.invalidateQueries({ queryKey: ['data-io', 'exports'] });
      setStarted({ exportId: reply.data.id, jobId: reply.data.jobId, fileName, rows: preview.data?.rowCount ?? null, format: settings.format });
      toast(copy.toastStarted());
    },
    onError: (error) => toast(error instanceof Error ? error.message : copy.sampleFailed()),
  });

  const dupes = duplicateHeaders(draft).size > 0;
  let hint = '';
  let disabled = false;
  let nextLabel = copy.continue();
  let nextIcon = <ArrowRight className="rtl:-scale-x-100" />;
  if (step === 0) {
    disabled = table === null;
    hint = table === null ? copy.hintChooseTable() : from === 'all' ? copy.hintFromAll(table.name) : copy.hintFromPage(table.name);
  } else if (step === 1) {
    disabled = draft.columns.length === 0 || dupes;
    hint = draft.columns.length === 0 ? copy.hintNoColumns() : dupes ? copy.hintDupes() : copy.hintOrder(draft.columns.length);
  } else {
    nextLabel = copy.export();
    nextIcon = <Download />;
    disabled = preview.isLoading || previewError !== null || draft.columns.length === 0 || createMutation.isPending;
    hint = previewError !== null ? copy.hintReadSample() : copy.hintDownloads();
  }

  const noAccess =
    (boot.data !== undefined && connections.length === 0) ||
    (sources.data !== undefined && sources.data.tables.every((entry) => !entry.canExport));
  const basedOnLabel = basedOnRow.data === undefined ? null : basedOnRow.data.filename ?? `${basedOnRow.data.source.table ?? 'export'}.${basedOnRow.data.format}`;

  const stepSuffix = table === null ? [STEP_LABEL.source, STEP_LABEL.columns, STEP_LABEL.preview][step]?.() ?? '' : table.name;

  return (
    <div className="mx-auto flex w-full max-w-[1240px] flex-col gap-[18px]" data-testid="export-builder">
      <BuilderToast message={builderToast.message} />
      <PageActions
        title={copy.title()}
        subtitle={copy.subtitle()}
        backTo="/exports"
        titleAdornment={
          basedOnLabel === null ? undefined : (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-[9px] py-[3px] text-[10.5px] font-bold text-accent" data-testid="export-builder-based-on">
              <Copy className="size-3" aria-hidden="true" />
              <span className="font-mono">{copy.basedOn(basedOnLabel)}</span>
            </span>
          )
        }
      >
        <Button asChild variant="secondary" size="topbar" data-testid="export-builder-cancel">
          <Link to="/exports">{copy.cancel()}</Link>
        </Button>
      </PageActions>

      {noAccess ? (
        <div className="flex flex-1 items-center justify-center px-7 py-10" data-testid="export-builder-no-access">
          <div className="flex max-w-[420px] flex-col items-center text-center">
            <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-surface-3 text-fg-subtle">
              <Lock className="size-[26px]" aria-hidden="true" />
            </div>
            <div className="text-[17px] font-extrabold tracking-[-0.02em] text-fg">{copy.noAccessTitle()}</div>
            <div className="mt-[7px] text-[13px] leading-[1.55] text-fg-muted">
              <NoAccessSentence />
            </div>
            <Button asChild variant="secondary" className="mt-5" iconLeft={<ArrowLeft className="rtl:-scale-x-100" />}>
              <Link to="/exports">{copy.backToExports()}</Link>
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-baseline gap-1.5">
              <span className="text-[11px] font-extrabold uppercase tracking-[.05em] text-fg-subtle">{copy.step(step + 1)}</span>
              <span className="text-[11px] font-extrabold text-fg-subtle">·</span>
              <span className={cn(table === null ? 'text-[11px] font-extrabold uppercase tracking-[.05em]' : 'font-mono text-[11.5px] font-semibold', 'text-fg')} data-testid="export-builder-step-suffix">
                {stepSuffix}
              </span>
            </div>
            <Stepper
              className="min-w-[300px] flex-1"
              label={copy.title()}
              activeIndex={step}
              steps={[
                { id: 'source', label: STEP_LABEL.source() },
                { id: 'columns', label: STEP_LABEL.columns() },
                { id: 'preview', label: STEP_LABEL.preview() },
              ]}
              onStepClick={(index) => goStep(index as Step)}
            />
          </div>

          <div key={`${step}-${dir}`} className={cn('flex flex-col gap-3.5', dir === 'fwd' ? 'animate-[nb-slide-fwd_.3s_cubic-bezier(.2,.7,.3,1)]' : 'animate-[nb-slide-back_.3s_cubic-bezier(.2,.7,.3,1)]')} data-dir={dir}>
            {step === 0 && sources.data !== undefined ? (
              <SourceStep
                sources={sources.data}
                connections={connections}
                onConnection={(id) => {
                  setConnectionId(id);
                  setTableId(null);
                  setDraft(EMPTY_DRAFT);
                }}
                selected={tableId}
                onSelect={selectTable}
                onLocked={(entry) => toast(copy.sourceLockedToast(entry.name))}
                from={from}
                onFrom={(next) => {
                  setFrom(next);
                  if (next === 'all' && table !== null) setDraft(defaultDraft(table));
                }}
              />
            ) : null}
            {step === 1 && schema.data !== undefined && table !== null ? (
              <ColumnsStep schema={schema.data} table={table} draft={draft} onDraft={setDraft} onToast={toast} />
            ) : null}
            {step === 2 && table !== null ? (
              started !== null ? (
                <StartedCard
                  exportId={started.exportId}
                  jobId={started.jobId}
                  fileName={started.fileName}
                  rowCount={started.rows}
                  format={started.format}
                  onAnother={() => {
                    setStarted(null);
                    setStep(0);
                    setTableId(null);
                    setFrom('all');
                    setDraft(EMPTY_DRAFT);
                    setSettings({ format: 'csv', scope: 'all', view: null, headerRow: true, name: '' });
                  }}
                />
              ) : (
                <PreviewStep
                  settings={settings}
                  onSettings={(patch) => setSettings((current) => ({ ...current, ...patch }))}
                  views={views.data ?? []}
                  tableRows={sourceTable?.rowCountEstimate ?? null}
                  fileName={fileName}
                  preview={preview.data ?? null}
                  loading={preview.isLoading || preview.isFetching}
                  error={previewError}
                  refreshedAt={preview.dataUpdatedAt === 0 ? null : preview.dataUpdatedAt}
                  onRefresh={() => void preview.refetch()}
                  tab={tab}
                  onTab={setTab}
                  columnCount={draft.columns.length}
                />
              )
            ) : null}
          </div>

          {started === null ? (
            <div className="flex flex-wrap items-center gap-3 pt-1">
              <span className="max-w-[420px] text-[12px] text-fg-subtle" data-testid="export-builder-hint">
                {hint}
              </span>
              <div className="ms-auto flex items-center gap-2.5">
                {step > 0 ? (
                  <Button variant="secondary" size="lg" iconLeft={<ArrowLeft className="rtl:-scale-x-100" />} onClick={() => goStep((step - 1) as Step)} data-testid="export-builder-back">
                    {copy.back()}
                  </Button>
                ) : null}
                <Button
                  size="lg"
                  disabled={disabled}
                  iconRight={nextIcon}
                  onClick={() => (step === 2 ? createMutation.mutate() : goStep((step + 1) as Step))}
                  data-testid="export-builder-next"
                >
                  {nextLabel}
                </Button>
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

/**
 * The comp's sentence with "Roles & access" as a link (133): the catalogue
 * carries the whole sentence with a `{link}` placeholder so every locale
 * places the link where its grammar wants it, and the link text is spliced
 * back out here to be wrapped.
 */
function NoAccessSentence() {
  const linkText = copy.noAccessLink();
  const sentence = copy.noAccessBody(linkText);
  const at = sentence.indexOf(linkText);
  if (at < 0) return <>{sentence}</>;
  return (
    <>
      {sentence.slice(0, at)}
      <Link to="/settings/roles" className="text-accent hover:underline">
        {linkText}
      </Link>
      {sentence.slice(at + linkText.length)}
    </>
  );
}
