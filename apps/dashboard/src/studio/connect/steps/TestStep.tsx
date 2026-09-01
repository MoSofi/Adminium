// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Step 3 — connection test + introspection (09 §8.2 step 2, M5-T01):
 * POST /connections/test (probe) → POST /connections (create) →
 * POST /connections/:id/introspect, narrated in the progress-log-console
 * with the comps' storytelling script. The async 202 path polls
 * `GET /jobs/:id` (progress messages become log lines); the sync path plays
 * the staged script. AdapterError codes map to remediation hints.
 *
 * Schema-file mode has no live database: the parse-variant script replays
 * the step-2 preview (including parser warnings) and completes locally.
 *
 * M9-T04: per-engine capability degradation is narrated honestly — the log
 * ends with the engine's caveats (MySQL ≈ row estimates and weaker FK/enum
 * metadata, SQLite CHECK-enum synthesis, schema files' missing live signals)
 * straight from the @adminium/engine capability matrix.
 */
import { useEffect, useRef, useState } from 'react';
import { Alert, Button } from '@adminium/ui';

import { ApiError } from '../../../app/api.js';
import { t } from '../../../i18n/t.js';
import { studioApi, type SchemaTable } from '../../api.js';
import { capabilityNotes, wizardCapabilitySource } from '../capabilityNotes.js';
import { LogConsole, type LogLine } from '../LogConsole.js';
import { effectiveDsn, effectiveEngine, hintForErrorCode, type WizardState } from '../wizardState.js';

export type TestStatus = 'idle' | 'running' | 'done' | 'error';

export interface TestStepProps {
  state: WizardState;
  onPatch: (patch: Partial<WizardState>) => void;
  onStatus: (status: TestStatus) => void;
  status: TestStatus;
  /** Stagger between storytelling lines (tests pass 0). */
  lineDelayMs?: number | undefined;
  /** Poll interval for the async job path (tests pass a small value). */
  pollIntervalMs?: number | undefined;
}

const wait = (ms: number) => (ms <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms)));

export function TestStep({
  state,
  onPatch,
  onStatus,
  status,
  lineDelayMs = 250,
  pollIntervalMs = 700,
}: TestStepProps) {
  const [lines, setLines] = useState<LogLine[]>([]);
  const [errorHint, setErrorHint] = useState<string | null>(null);
  const runningRef = useRef(false);
  const cancelledRef = useRef(false);
  const nextId = useRef(0);

  const push = (kind: LogLine['kind'], text: string) => {
    if (cancelledRef.current) return;
    nextId.current += 1;
    const id = `line_${nextId.current}`;
    setLines((current) => [
      // A new line settles the previous "running" spinner into a plain info line.
      ...current.map((line) => (line.kind === 'running' ? { ...line, kind: 'info' as const } : line)),
      { id, kind, text },
    ]);
  };

  /**
   * A server-supplied `hint` wins over the per-code copy: the adapter knows
   * things the code cannot carry (e.g. "that host is a transaction pooler —
   * drop `-pooler`"), and `hintForErrorCode` would flatten it to the generic
   * "verify the DSN" line.
   */
  const fail = (message: string, code: string | null, hint?: string | null) => {
    push('error', message);
    const fromCode = code === null ? null : hintForErrorCode(code);
    setErrorHint(hint !== undefined && hint !== null && hint.length > 0 ? hint : fromCode);
    onStatus('error');
  };

  /** Parser warnings shown inline in the log before it gets noisy. */
  const MAX_WARNING_LINES = 10;

  function pushCapabilityNotes(): void {
    for (const note of capabilityNotes(wizardCapabilitySource(state))) {
      push('info', note);
    }
  }

  async function runFileScript(): Promise<void> {
    const preview = state.filePreview;
    if (preview === null) return;
    push('running', t('studio:test.log.readingFile', 'Reading uploaded schema file…'));
    await wait(lineDelayMs);
    push('info', t('studio:test.log.parsingFile', 'Parsing {file}…', { file: preview.fileName }));
    await wait(lineDelayMs);
    push(
      'ok',
      t('studio:test.log.detected', 'Detected {tables} tables · {columns} columns', { tables: String(preview.tables), columns: String(preview.columns) }),
    );
    await wait(lineDelayMs);
    for (const warning of preview.warnings.slice(0, MAX_WARNING_LINES)) {
      push('warn', warning);
    }
    if (preview.warnings.length > MAX_WARNING_LINES) {
      push(
        'warn',
        t('studio:test.log.moreWarnings', '+{count} more parser warnings', { count: String(preview.warnings.length - MAX_WARNING_LINES), }),
      );
    }
    pushCapabilityNotes();
    push('ok', t('studio:test.log.ready', 'Ready'));
    onStatus('done');
  }

  async function finishFromSchema(connectionId: string, proposedMasks: number | null): Promise<void> {
    const schema = await studioApi.getSchema(connectionId);
    const tables: SchemaTable[] = schema.model.tables;
    const columns = tables.reduce((sum, table) => sum + table.columns.length, 0);
    push(
      'ok',
      t('studio:test.log.found', 'Found {tables} tables · {columns} columns', { tables: String(tables.length), columns: String(columns) }),
    );
    await wait(lineDelayMs);
    push('info', t('studio:test.log.mapping', 'Mapping column types → input widgets'));
    await wait(lineDelayMs);
    push('info', t('studio:test.log.relations', 'Detecting relations…'));
    await wait(lineDelayMs);
    push('running', t('studio:test.log.piiScan', 'Scanning for PII columns…'));
    await wait(lineDelayMs);
    push(
      'ok',
      proposedMasks === null
        ? t('studio:test.log.piiDoneUnknown', 'PII scan complete')
        : t('studio:test.log.piiDone', 'PII scan complete — {count} columns masked by default', { count: String(proposedMasks), }),
    );
    pushCapabilityNotes();
    push('ok', t('studio:test.log.ready', 'Ready'));
    onStatus('done');
  }

  async function pollJob(connectionId: string, jobId: string): Promise<void> {
    let lastMessage: string | null = null;
    for (;;) {
      if (cancelledRef.current) return;
      const job = await studioApi.getJob(jobId);
      const message = job.progress?.message ?? job.progress?.step ?? null;
      if (message !== null && message !== lastMessage) {
        lastMessage = message;
        push('running', message);
      }
      if (job.status === 'succeeded') {
        await finishFromSchema(connectionId, null);
        return;
      }
      if (job.status === 'failed' || job.status === 'cancelled') {
        fail(job.lastError ?? t('studio:test.log.jobFailed', 'Introspection failed.'), null);
        return;
      }
      await wait(pollIntervalMs);
    }
  }

  async function run(): Promise<void> {
    onStatus('running');
    setErrorHint(null);
    setLines([]);

    if (state.mode === 'file') {
      await runFileScript();
      return;
    }

    const engine = effectiveEngine(state) ?? 'postgres';
    const dsn = effectiveDsn(state);
    try {
      push('running', t('studio:test.log.connecting', 'Establishing secure connection…'));
      const probe = await studioApi.testDsn(engine, dsn);
      if (!probe.ok) {
        fail(
          probe.error?.message ?? t('studio:test.log.connectFailed', 'Connection failed.'),
          probe.error?.code ?? 'UNKNOWN',
          probe.error?.hint,
        );
        return;
      }
      onPatch({ readOnly: probe.readOnly, privileges: probe.privileges });
      push(
        'ok',
        t('studio:test.log.connected', 'Connected ({latency} ms) · read-only introspection', { latency: String(Math.round(probe.latencyMs)), }),
      );
      await wait(lineDelayMs);

      let connectionId = state.connectionId;
      if (connectionId === null) {
        const created = await studioApi.createConnection({
          name: state.name.trim(),
          engine,
          dsn,
          settings: { intent: state.intent },
        });
        connectionId = created.id;
        onPatch({ connectionId, readOnly: created.readOnly });
      }

      push('running', t('studio:test.log.readingSchema', 'Reading schema: public'));
      const result = await studioApi.introspect(connectionId);
      if (result.kind === 'job') {
        await pollJob(connectionId, result.jobId);
        return;
      }
      await finishFromSchema(connectionId, result.proposedMasks);
    } catch (cause) {
      if (cause instanceof ApiError) {
        fail(cause.message, cause.code);
        return;
      }
      fail(t('studio:test.log.networkFailed', 'Request failed — check your connection and retry.'), null);
    }
  }

  useEffect(() => {
    cancelledRef.current = false;
    if (!runningRef.current && status !== 'done') {
      runningRef.current = true;
      void run().finally(() => {
        runningRef.current = false;
      });
    }
    return () => {
      cancelledRef.current = true;
    };
    // Intentionally mount-only: auto-runs once; Retry re-triggers explicitly.
  }, []);

  return (
    <section aria-label={t('studio:test.title', 'Analyzing your schema')} className="flex flex-col gap-4">
      <div>
        <h2 className="text-section text-fg">{t('studio:test.title', 'Analyzing your schema')}</h2>
        <p className="mt-1 text-body-sm text-fg-muted">
          {t('studio:test.subtitle', 'Introspecting tables, columns, and relationships. This takes a few seconds.')}
        </p>
      </div>
      <LogConsole lines={lines} label={t('studio:test.logLabel', 'Introspection log')} />
      {status === 'error' ? (
        <Alert
          tone="danger"
          role="alert"
          title={t('studio:test.errorTitle', 'Connection failed')}
          {...(errorHint === null ? {} : { body: errorHint })}
          action={
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                if (!runningRef.current) {
                  runningRef.current = true;
                  void run().finally(() => {
                    runningRef.current = false;
                  });
                }
              }}
            >
              {t('studio:test.retry', 'Retry')}
            </Button>
          }
        />
      ) : null}
      <p className="text-caption text-fg-subtle">
        {t('studio:test.trust', 'We only read your schema and data. Nothing is modified.')}
      </p>
    </section>
  );
}
