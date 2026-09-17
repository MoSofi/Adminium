// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The started state (comp 580-604, 1138-1150): the file name, the progress
 * pill and bar, the note in its two variants, and the download / "Back to
 * Data exports" / "Export another" actions. Progress is the job's `pct`,
 * polled the way the Data Exports page polls.
 */
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ArrowRight, Download, FileDown, Loader } from 'lucide-react';
import { Alert, Button, ProgressBar, cn } from '@adminium/ui';

import { dataIoApi, exportQuery, jobQuery } from '../api.js';
import { copy } from './copy.js';

export interface StartedCardProps {
  exportId: string;
  jobId: string | null;
  fileName: string;
  rowCount: number | null;
  format: 'csv' | 'json';
  onAnother: () => void;
}

export function StartedCard({ exportId, jobId, fileName, rowCount, format, onAnother }: StartedCardProps) {
  const row = useQuery(exportQuery(exportId));
  const job = useQuery(jobQuery(jobId));
  const status = row.data?.status ?? 'processing';
  const done = status === 'ready';
  const failed = status === 'failed' || status === 'cancelled';
  const pct = done ? 100 : Math.max(4, job.data?.progress?.pct ?? 4);
  const rows = (done ? row.data?.rowCount ?? rowCount : rowCount)?.toLocaleString() ?? '—';
  return (
    <div className="max-w-[560px] rounded-2xl border border-border bg-surface p-6 shadow-card" data-testid="export-builder-started">
      <div className="flex items-center gap-[13px]">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
          <FileDown className="size-[21px]" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate font-mono text-[13.5px] font-semibold text-fg">{row.data?.filename ?? fileName}</div>
          <div className="mt-[3px] text-[12px] text-fg-muted" data-testid="export-builder-progress-label">
            {done ? copy.ready(rows) : copy.preparing(fileName, rows)}
          </div>
        </div>
        <span
          className={cn(
            'shrink-0 rounded-full px-[9px] py-[3px] font-mono text-[11.5px] font-bold',
            done ? 'bg-pos-soft text-pos' : 'bg-accent-soft text-accent',
          )}
        >
          {pct}%
        </span>
      </div>
      <ProgressBar className="mt-4" value={pct} tone={done ? 'pos' : 'accent'} label={copy.busy()} />
      {failed ? (
        <Alert className="mt-3.5" tone="danger" title={copy.failedTitle()} body={row.data?.error ?? undefined} />
      ) : (
        <div className="mt-3.5 text-[12px] leading-[1.55] text-fg-muted">{done ? copy.noteReady() : copy.noteBusy()}</div>
      )}
      <div className="mt-[18px] flex flex-wrap gap-2.5">
        {done ? (
          <Button asChild iconLeft={<Download />} data-testid="export-builder-download">
            <a href={dataIoApi.downloadHref(exportId)} rel="noopener">
              {copy.download(format === 'csv' ? 'CSV' : 'JSONL')}
            </a>
          </Button>
        ) : failed ? null : (
          <Button disabled iconLeft={<Loader />} variant="secondary">
            {copy.busy()}
          </Button>
        )}
        <Button asChild variant={done || failed ? 'secondary' : 'primary'} iconRight={<ArrowRight className="rtl:-scale-x-100" />}>
          <Link to="/exports">{copy.backToExports()}</Link>
        </Button>
        <Button variant="secondary" onClick={onAnother} data-testid="export-builder-another">
          {copy.another()}
        </Button>
      </div>
    </div>
  );
}
