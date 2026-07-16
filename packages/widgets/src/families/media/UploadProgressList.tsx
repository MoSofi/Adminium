import { EmptyState, IconButton, IconTile, MonoText, ProgressBar } from '@adminium/ui';
import type { Tone } from '@adminium/ui';
import { Download, RotateCcw, X } from 'lucide-react';

import { fileIconFor } from './media-icons.js';
import { FILE_KIND_TONE, clampPct, fileRowsOf, kindOf, resolveLocale, stringField } from './media-lib.js';
import { getFormatters } from '@adminium/i18n';
import { UPLOAD_STATUSES, uploadProgressListConfigSchema, uploadProgressListDemoData } from './media-config.js';
import type { UploadProgressListConfig, UploadStatus } from './media-config.js';
import type { WidgetProps } from '../../registry/types.js';

export { uploadProgressListConfigSchema, uploadProgressListDemoData };
export type { UploadProgressListConfig, UploadStatus };

/**
 * `upload-progress-list` (annex §8) — per-file rows with a progress bar and a
 * status ("62%", "Done", "Failed" + Retry). Generalises to export-queue jobs
 * (Adminium UI Kit), which is why the fields are config-named rather than
 * hardcoded to uploads.
 *
 * NO TRANSPORT: the widget renders job rows from the data contract and reports
 * Retry/Cancel/Download intents through callbacks. It never uploads and never
 * polls — there are no files routes yet (08 §2.11); the host drives the jobs and
 * feeds their state back in.
 */

/** A normalized job row. */
export interface UploadJob {
  id: string;
  name: string;
  status: UploadStatus;
  /** 0–100, clamped. */
  pct: number;
  error?: string | undefined;
  type?: string | undefined;
  mime?: string | undefined;
  /** Artefact link for a finished job — the Download action's target. */
  url?: string | undefined;
}

export interface UploadProgressListProps {
  jobs: readonly UploadJob[];
  retryable?: boolean | undefined;
  downloadable?: boolean | undefined;
  cancellable?: boolean | undefined;
  locale?: string | undefined;
  doneLabel?: string | undefined;
  failedLabel?: string | undefined;
  queuedLabel?: string | undefined;
  retryLabel?: string | undefined;
  downloadLabel?: string | undefined;
  cancelLabel?: string | undefined;
  emptyTitle?: string | undefined;
  emptyBody?: string | undefined;
  onRetry?: ((job: UploadJob) => void) | undefined;
  onCancel?: ((job: UploadJob) => void) | undefined;
  onDownload?: ((job: UploadJob) => void) | undefined;
  testId?: string | undefined;
}

/** Status → the bar's fill tone (done pos, failed danger, in-flight accent). */
const STATUS_TONE: Record<UploadStatus, Tone> = {
  queued: 'neutral',
  uploading: 'accent',
  done: 'pos',
  failed: 'danger',
};

/** Status → the trailing metadata's text colour. */
const STATUS_TEXT: Record<UploadStatus, string> = {
  queued: 'text-fg-subtle',
  uploading: 'text-fg-subtle',
  done: 'text-pos',
  failed: 'text-danger',
};

export function UploadProgressList({
  jobs,
  retryable = true,
  downloadable = false,
  cancellable = false,
  locale,
  doneLabel,
  failedLabel,
  queuedLabel,
  retryLabel,
  downloadLabel,
  cancelLabel,
  emptyTitle,
  emptyBody,
  onRetry,
  onCancel,
  onDownload,
  testId,
}: UploadProgressListProps) {
  const tag = resolveLocale(locale);
  const fmt = getFormatters(tag);

  if (jobs.length === 0) {
    return (
      <EmptyState
        compact
        preset="all-caught-up"
        title={emptyTitle ?? 'No uploads in progress'}
        body={emptyBody ?? 'Files you upload will show their progress here.'}
      />
    );
  }

  return (
    <ul data-widget="upload-progress-list" data-testid={testId} className="h-full space-y-2 overflow-auto p-3">
      {jobs.map((job) => {
        const kind = kindOf(job.type, job.mime, job.name);
        const statusText =
          job.status === 'done'
            ? (doneLabel ?? 'Done')
            : job.status === 'failed'
              ? (failedLabel ?? 'Failed')
              : job.status === 'queued'
                ? (queuedLabel ?? 'Queued')
                : fmt.percent(job.pct / 100);
        return (
          <li
            key={job.id}
            data-part="upload-row"
            data-status={job.status}
            className="flex items-center gap-3 rounded-lg border border-border px-3 py-2.5"
          >
            <IconTile size="sm" tone={FILE_KIND_TONE[kind]} icon={fileIconFor(job.type, job.mime, job.name, undefined)} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-body-sm font-semibold text-fg">{job.name}</p>
              <ProgressBar
                size="sm"
                className="mt-1.5"
                value={job.pct}
                tone={STATUS_TONE[job.status]}
                label={`${job.name}: ${statusText}`}
              />
              {job.status === 'failed' && job.error !== undefined && (
                <p data-part="upload-error" className="mt-1 truncate text-caption text-danger">
                  {job.error}
                </p>
              )}
            </div>
            <MonoText className={`shrink-0 text-caption font-semibold ${STATUS_TEXT[job.status]}`}>{statusText}</MonoText>
            {retryable && job.status === 'failed' && (
              <IconButton size="sm" label={retryLabel ?? 'Retry'} onClick={() => onRetry?.(job)} data-part="upload-retry">
                <RotateCcw className="size-3.5" />
              </IconButton>
            )}
            {downloadable && job.status === 'done' && (
              <IconButton size="sm" label={downloadLabel ?? 'Download'} onClick={() => onDownload?.(job)} data-part="upload-download">
                <Download className="size-3.5" />
              </IconButton>
            )}
            {cancellable && (job.status === 'uploading' || job.status === 'queued') && (
              <IconButton size="sm" label={cancelLabel ?? 'Cancel'} onClick={() => onCancel?.(job)} data-part="upload-cancel">
                <X className="size-3.5" />
              </IconButton>
            )}
          </li>
        );
      })}
    </ul>
  );
}

const STATUS_SET: ReadonlySet<string> = new Set(UPLOAD_STATUSES);

/**
 * Project an untrusted job `record-list` onto `UploadJob`s. An unrecognised
 * status degrades to `uploading` when a percentage is moving and `queued`
 * otherwise — a job row from an export queue may use its own vocabulary, and a
 * widget must render it rather than blank the row.
 */
export function uploadJobsOf(data: unknown, config: UploadProgressListConfig): UploadJob[] {
  return fileRowsOf(data).map((row, index): UploadJob => {
    const pct = clampPct(row[config.pctField]);
    const rawStatus = stringField(row, config.statusField)?.toLowerCase();
    const status: UploadStatus = rawStatus !== undefined && STATUS_SET.has(rawStatus)
      ? (rawStatus as UploadStatus)
      : pct >= 100
        ? 'done'
        : pct > 0
          ? 'uploading'
          : 'queued';
    const id = stringField(row, config.idField) ?? `job-${index}`;
    return {
      id,
      name: stringField(row, config.nameField) ?? id,
      status,
      pct: status === 'done' ? 100 : pct,
      error: stringField(row, config.errorField),
      type: stringField(row, config.typeField),
      mime: stringField(row, config.mimeField),
      url: stringField(row, config.urlField),
    };
  });
}

export function UploadProgressListWidget({ config, data, onEvent }: WidgetProps<UploadProgressListConfig>) {
  return (
    <UploadProgressList
      jobs={uploadJobsOf(data, config)}
      retryable={config.retryable}
      downloadable={config.downloadable}
      cancellable={config.cancellable}
      {...(config.format?.locale === undefined ? {} : { locale: config.format.locale })}
      {...(config.doneLabel === undefined ? {} : { doneLabel: config.doneLabel })}
      {...(config.failedLabel === undefined ? {} : { failedLabel: config.failedLabel })}
      {...(config.queuedLabel === undefined ? {} : { queuedLabel: config.queuedLabel })}
      {...(config.retryLabel === undefined ? {} : { retryLabel: config.retryLabel })}
      {...(config.downloadLabel === undefined ? {} : { downloadLabel: config.downloadLabel })}
      {...(config.cancelLabel === undefined ? {} : { cancelLabel: config.cancelLabel })}
      {...(config.emptyTitle === undefined ? {} : { emptyTitle: config.emptyTitle })}
      {...(config.emptyBody === undefined ? {} : { emptyBody: config.emptyBody })}
      onDownload={(job) => {
        // The row's own artefact link wins; `config.href` is the instance-level
        // fallback (an export-queue page pointing at its downloads route).
        const href = job.url ?? config.href;
        if (href !== undefined) onEvent({ type: 'drill-through', href });
      }}
    />
  );
}
