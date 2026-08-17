/**
 * `progress-log-console` (annex §12) — terminal-style streaming checklist: mono
 * log lines, done lines get a green check, the active line gets a spinner, with
 * a paired determinate progress bar + mono %. Variants: `live` (streamed server
 * events) and `static-terminal` (the CLI-simulation card). Evidence: Connect
 * Database, See It In Action, API & Backend, Adminium Landing.
 *
 * This is where long-running server tasks (introspection, import, export,
 * deploy) surface in the generated app (annex §12 auto-instantiation), so it
 * accepts BOTH `record-list` (a finished run's rows) and `stream` (a live WS
 * channel's append-only snapshot) — `capabilities.realtime` marks it bindable
 * over WS (04 §5.3).
 *
 * Built fresh rather than lifted from `apps/dashboard/src/studio/connect/
 * LogConsole.tsx`: a widget may never import an app (04 §2.1), and the annex's
 * contract adds the progress bar + variants the Studio console does not have.
 * The Studio wizard keeps its own console.
 */

import { EmptyState, MonoText, ProgressBar, Spinner, cn } from '@adminium/ui';
import { useMaybeT } from '@adminium/i18n/react';
import { Check, CircleAlert, TriangleAlert } from 'lucide-react';
import { useEffect, useRef } from 'react';

import { clampPct, numberField, oneOf, recordRowsOf, stringField } from './system-lib.js';
import type { LogLineKind } from './system-lib.js';
import { LOG_LINE_KINDS, progressLogConsoleConfigSchema, progressLogConsoleDemoData } from './system-config.js';
import type { ProgressLogConsoleConfig } from './system-config.js';
import type { WidgetProps } from '../../registry/types.js';

export { progressLogConsoleConfigSchema, progressLogConsoleDemoData };
export type { ProgressLogConsoleConfig };

export interface LogLine {
  id: string;
  kind: LogLineKind;
  text: string;
  pct?: number | undefined;
}

const KIND_TEXT: Record<LogLineKind, string> = {
  info: 'text-fg-muted',
  ok: 'text-fg-muted',
  warn: 'text-warn',
  error: 'text-danger',
  running: 'text-fg',
};

function LineGlyph({ kind }: { kind: LogLineKind }) {
  if (kind === 'ok') return <Check className="size-3.5 text-pos" />;
  if (kind === 'error') return <CircleAlert className="size-3.5 text-danger" />;
  if (kind === 'warn') return <TriangleAlert className="size-3.5 text-warn" />;
  if (kind === 'running') return <Spinner size="sm" className="size-3.5" />;
  return <span className="size-1 rounded-full bg-fg-subtle" />;
}

/**
 * Project an untrusted payload onto the console's line model. Keeps the LAST
 * `maxLines` (a long run's tail is the interesting part) and defaults an
 * unrecognised `kind` to `info` rather than dropping the line — losing a log
 * line to a vocabulary mismatch would be worse than rendering it plainly.
 */
export function logLinesOf(
  data: unknown,
  config: Pick<ProgressLogConsoleConfig, 'textField' | 'kindField' | 'pctField' | 'maxLines'>,
): LogLine[] {
  const rows = recordRowsOf(data);
  const tail = rows.slice(Math.max(0, rows.length - config.maxLines));
  const lines: LogLine[] = [];
  for (const [index, row] of tail.entries()) {
    const text = stringField(row, config.textField);
    if (text === undefined) continue;
    const pct = numberField(row, config.pctField);
    lines.push({
      id: stringField(row, 'id') ?? `line-${index}`,
      kind: oneOf(row[config.kindField], LOG_LINE_KINDS, 'info'),
      text,
      ...(pct === undefined ? {} : { pct: clampPct(pct) }),
    });
  }
  return lines;
}

/**
 * The bar value: the newest line carrying a `pct` wins; with none, progress is
 * derived from how many lines have completed (annex §12: "may be derived from
 * step index").
 */
export function progressPctOf(lines: readonly LogLine[]): number {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const pct = lines[index]?.pct;
    // Clamp here too, not only in `logLinesOf`: this is exported and callers
    // (templates, tests, a host computing its own lines) can hand in raw values,
    // and an unclamped pct would overflow the bar's track.
    if (pct !== undefined) return clampPct(pct);
  }
  if (lines.length === 0) return 0;
  const done = lines.filter((line) => line.kind !== 'running').length;
  return clampPct((done / lines.length) * 100);
}

export interface ProgressLogConsoleViewProps {
  lines: readonly LogLine[];
  variant?: 'live' | 'static-terminal';
  showProgress?: boolean | undefined;
  follow?: boolean | undefined;
  pct?: number | undefined;
  a11yLabel?: string | undefined;
  progressLabel?: string | undefined;
  emptyTitle?: string | undefined;
  emptyBody?: string | undefined;
  testId?: string | undefined;
}

export function ProgressLogConsoleView({
  lines,
  variant = 'live',
  showProgress = true,
  follow = true,
  pct,
  a11yLabel,
  progressLabel,
  emptyTitle,
  emptyBody,
  testId,
}: ProgressLogConsoleViewProps) {
  const t = useMaybeT();
  const endRef = useRef<HTMLDivElement | null>(null);
  const lineCount = lines.length;

  useEffect(() => {
    if (!follow) return;
    // `scrollIntoView` is absent in happy-dom and older engines — optional-call
    // it so the console degrades to "no auto-scroll" instead of throwing into
    // the WidgetErrorBoundary.
    endRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [lineCount, follow]);

  if (lineCount === 0) {
    return (
      <EmptyState
        compact
        preset="nothing-scheduled"
        title={emptyTitle ?? t('ui:widgets.system.progressLogConsole.emptyTitle', 'Nothing to report yet')}
        body={emptyBody ?? t('ui:widgets.system.progressLogConsole.emptyBody', 'Log lines appear here once the task starts.')}
      />
    );
  }

  const value = pct ?? progressPctOf(lines);

  return (
    <div
      data-widget="progress-log-console"
      data-variant={variant}
      data-testid={testId}
      className="flex h-full flex-col gap-2 px-[var(--widget-pad)] pb-[var(--widget-pad)]"
    >
      <div
        // A streaming log is a log landmark, announced politely: assertive would
        // interrupt a screen-reader user on every appended line.
        role="log"
        aria-label={a11yLabel ?? t('ui:widgets.system.progressLogConsole.a11yLabel', 'Progress log')}
        aria-live="polite"
        className={cn(
          'min-h-0 flex-1 overflow-y-auto rounded-lg border border-border p-3.5 font-mono text-caption leading-6',
          variant === 'static-terminal' ? 'bg-surface-3' : 'bg-surface-2',
        )}
      >
        {lines.map((line) => (
          <div key={line.id} data-part="log-line" data-kind={line.kind} className="flex items-start gap-2">
            <span aria-hidden="true" className="mt-1 flex size-4 shrink-0 items-center justify-center">
              <LineGlyph kind={line.kind} />
            </span>
            {/*
              `break-all` (not truncate): a log line is diagnostic content —
              hiding its tail defeats the point. Long DSNs/stack frames wrap.
            */}
            <span className={cn('min-w-0 break-all', KIND_TEXT[line.kind])}>{line.text}</span>
          </div>
        ))}
        <div ref={endRef} />
      </div>

      {showProgress && (
        <div className="flex items-center gap-2">
          <ProgressBar
            value={value}
            max={100}
            tone={value >= 100 ? 'pos' : 'accent'}
            size="sm"
            label={progressLabel ?? t('ui:widgets.system.progressLogConsole.progressLabel', 'Progress')}
            className="flex-1"
          />
          <MonoText data-part="log-pct" className="shrink-0 text-caption font-semibold text-fg-muted">
            {Math.round(value)}%
          </MonoText>
        </div>
      )}
    </div>
  );
}

export function ProgressLogConsoleWidget({ config, data }: WidgetProps<ProgressLogConsoleConfig>) {
  const lines = logLinesOf(data, config);

  return (
    <ProgressLogConsoleView
      lines={lines}
      variant={config.variant}
      showProgress={config.showProgress}
      follow={config.follow}
      a11yLabel={config.a11yLabel}
      progressLabel={config.progressLabel}
      emptyTitle={config.emptyTitle}
      emptyBody={config.emptyBody}
      testId={config.testId}
    />
  );
}
