// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Direct-API enrichment progress screen (06-llm-assist.md §10.2 step 3). Runs
 * the `llm-run` job and narrates its realtime progress through the introspection
 * LogConsole pattern: "Building prompt → Sending to <provider>/<model> →
 * Validating → Repairing (1/2) → Done: N suggestions", with per-chunk progress.
 * Cancel aborts the job, which discards the run server-side (§7.5 / jobs/llm-run).
 *
 * Progress rides the job's realtime channel (`jobs:<jobId>`, published by the
 * worker); this screen follows it via the same job-progress read the connect
 * wizard's introspection step uses, so the surface stays testable without a
 * socket.
 */
import { useEffect, useRef, useState } from 'react';
import { Alert, Button, MonoText } from '@adminium/ui';

import { api } from '../../app/api.js';
import { t } from '../../i18n/t.js';
import { studioApi } from '../api.js';
import { aiApi } from '../ai/api.js';
import { LogConsole, type LogLine } from './LogConsole.js';

const wait = (ms: number) => (ms <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms)));

type Phase = 'running' | 'done' | 'error';

export interface EnrichDirectProgressProps {
  runId: string;
  provider: string;
  model: string;
  onContinueReview: (runId: string) => void;
  /** Return to the option cards after a cancel/abandon. */
  onCancel: () => void;
  /** Test seam — poll cadence for the job-progress read. */
  pollIntervalMs?: number | undefined;
}

export function EnrichDirectProgress({
  runId,
  provider,
  model,
  onContinueReview,
  onCancel,
  pollIntervalMs = 800,
}: EnrichDirectProgressProps) {
  const [lines, setLines] = useState<LogLine[]>([]);
  const [phase, setPhase] = useState<Phase>('running');
  const [error, setError] = useState<string | null>(null);
  const jobIdRef = useRef<string | null>(null);
  const cancelledRef = useRef(false);
  const startedRef = useRef(false);
  const nextId = useRef(0);

  const push = (kind: LogLine['kind'], text: string) => {
    nextId.current += 1;
    const id = `llm_${nextId.current}`;
    setLines((current) => [
      ...current.map((line) => (line.kind === 'running' ? { ...line, kind: 'info' as const } : line)),
      { id, kind, text },
    ]);
  };

  const fail = (message: string) => {
    setPhase('error');
    setError(message);
    push('error', message);
  };

  async function finish(): Promise<void> {
    const run = await aiApi.getRun(runId);
    if (run.status === 'failed') {
      const first = run.validationErrors?.find((issue) => issue.severity === 'fatal');
      fail(first?.message ?? t('studio:enrich.direct.failed', 'The provider run failed. Check your AI settings and retry.'));
      return;
    }
    push('ok', t('studio:enrich.direct.done', 'Enrichment complete — review the suggestions.'));
    setPhase('done');
  }

  async function pollJob(jobId: string): Promise<void> {
    let last: string | null = null;
    for (;;) {
      if (cancelledRef.current) return;
      const job = await studioApi.getJob(jobId);
      const message = job.progress?.message ?? job.progress?.step ?? null;
      if (message !== null && message !== last) {
        last = message;
        push('running', message);
      }
      if (job.status === 'succeeded') {
        await finish();
        return;
      }
      if (job.status === 'failed' || job.status === 'cancelled') {
        fail(job.lastError ?? t('studio:enrich.direct.jobFailed', 'The enrichment run did not finish.'));
        return;
      }
      await wait(pollIntervalMs);
    }
  }

  async function run(): Promise<void> {
    setPhase('running');
    setError(null);
    setLines([]);
    push('running', t('studio:enrich.direct.building', 'Building prompt…'));
    try {
      const { jobId } = await aiApi.executeRun(runId);
      jobIdRef.current = jobId;
      await pollJob(jobId);
    } catch (cause) {
      fail(cause instanceof Error ? cause.message : t('studio:enrich.direct.startFailed', 'Could not start the run — retry.'));
    }
  }

  useEffect(() => {
    // Re-arm on every setup so React.StrictMode's setup→cleanup→setup double-invoke
    // (main.tsx) does not leave `cancelledRef` stuck `true` from the simulated
    // cleanup — otherwise the first (and only) `run()` resolves into a cancelled
    // poll loop and the screen hangs on "Building prompt…". `startedRef` still
    // guards `run()` so the job is started exactly once.
    cancelledRef.current = false;
    if (!startedRef.current) {
      startedRef.current = true;
      void run();
    }
    return () => {
      cancelledRef.current = true;
    };
  }, []);

  const cancel = () => {
    cancelledRef.current = true;
    const jobId = jobIdRef.current;
    if (jobId !== null) {
      void api.post(`/api/v1/jobs/${encodeURIComponent(jobId)}/cancel`).catch(() => undefined);
    }
    onCancel();
  };

  return (
    <section aria-label={t('studio:enrich.direct.title', 'Enriching with AI')} className="flex flex-col gap-4">
      <div>
        <h2 className="text-section text-fg">{t('studio:enrich.direct.title', 'Enriching with AI')}</h2>
        <p className="mt-1 text-body-sm text-fg-muted">
          {t('studio:enrich.direct.subtitle', 'Sending your schema to')}{' '}
          <MonoText>
            {provider}/{model}
          </MonoText>
        </p>
      </div>

      <LogConsole lines={lines} label={t('studio:enrich.direct.logLabel', 'Enrichment log')} />

      {error !== null ? (
        <Alert tone="danger" role="alert" title={t('studio:enrich.direct.errorTitle', 'Enrichment failed')} body={error} />
      ) : null}

      <div className="flex items-center gap-2">
        {phase === 'running' ? (
          <Button type="button" variant="secondary" onClick={cancel}>
            {t('studio:enrich.direct.cancel', 'Cancel')}
          </Button>
        ) : null}
        {phase === 'done' ? (
          <Button type="button" onClick={() => onContinueReview(runId)}>
            {t('studio:enrich.direct.continueReview', 'Continue to review')}
          </Button>
        ) : null}
        {phase === 'error' ? (
          <>
            <Button type="button" variant="secondary" onClick={() => void run()}>
              {t('studio:enrich.direct.retry', 'Retry')}
            </Button>
            <Button type="button" variant="ghost" onClick={onCancel}>
              {t('studio:enrich.direct.back', 'Back to options')}
            </Button>
          </>
        ) : null}
      </div>
    </section>
  );
}
