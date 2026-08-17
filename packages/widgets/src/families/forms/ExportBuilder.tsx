/**
 * `export-builder` (annex §10) — a config form (format segmented PDF/CSV/XLSX,
 * date range, include-charts switch) driving an idle → running(%) → done
 * (Download) state machine. Evidence: Adminium UI Kit, Metrics Dashboard,
 * Payments, Time Tracking.
 *
 * PRESENTATIONAL: clicking Export emits an `insert` intent describing the JOB —
 * the host queues it and reports progress back through the payload. The widget
 * runs no export and owns no timer, which is also why the phase is derived
 * (see `exportPhaseOf`) rather than animated locally.
 *
 * Binds §3 `form-state`: the payload is the export's config plus its progress.
 */

import { Button, DateInput, FormField, MonoText, ProgressBar, SegmentedControl, Select, Switch } from '@adminium/ui';
import { useMaybeT } from '@adminium/i18n/react';
import { Download } from 'lucide-react';
import { useState } from 'react';

import { exportBuilderConfigSchema, exportBuilderDemoData } from './forms-config.js';
import type { ExportBuilderConfig } from './forms-config.js';
import { EXPORT_FORMATS, EXPORT_PHASES, exportPhaseOf } from './forms-builders.js';
import type { ExportFormat, ExportPhase } from './forms-builders.js';
import { clampPct, numberField, oneOf, stringField } from './forms-lib.js';
import { bindingTargetOf, formValuesOf } from './forms-state.js';
import type { WidgetProps } from '../../registry/types.js';

export { exportBuilderConfigSchema, exportBuilderDemoData };
export type { ExportBuilderConfig };

export interface ExportState {
  format: ExportFormat;
  from: string;
  to: string;
  includeCharts: boolean;
  groupBy: string;
  email: boolean;
}

/** Project the §3 `form-state` payload onto the form's initial values. */
export function exportStateOf(data: unknown, config: ExportBuilderConfig): ExportState {
  const values = formValuesOf(data);
  const formats = config.formats ?? EXPORT_FORMATS;
  const fallback: ExportFormat = formats[0] ?? 'csv';
  const format = oneOf(values['format'], EXPORT_FORMATS, fallback);
  return {
    // A payload naming a format this instance disabled falls back rather than
    // rendering a segmented control with no segment selected.
    format: formats.includes(format) ? format : fallback,
    from: stringField(values, 'from') ?? '',
    to: stringField(values, 'to') ?? '',
    includeCharts: values['includeCharts'] === true,
    groupBy: stringField(values, 'groupBy') ?? '',
    email: values['email'] === true,
  };
}

export function ExportBuilderWidget({ config, data, onEvent }: WidgetProps<ExportBuilderConfig>) {
  const t = useMaybeT();
  const values = formValuesOf(data);
  const formats = config.formats ?? EXPORT_FORMATS;
  const [state, setState] = useState<ExportState>(() => exportStateOf(data, config));
  const [submitted, setSubmitted] = useState(false);
  const target = bindingTargetOf(config.binding);

  const payloadPhase: ExportPhase = oneOf(values['status'], EXPORT_PHASES, 'idle');
  const phase = exportPhaseOf(payloadPhase, submitted);
  const progress = clampPct(numberField(values, 'progress'));
  const href = stringField(values, 'downloadHref') ?? config.href;
  // Each is rendered in two slots (visible label + accessible name) — resolve once.
  const formatLabel = config.formatLabel ?? t('ui:widgets.forms.exportBuilder.format', 'Format');
  const runningLabel = config.runningLabel ?? t('ui:widgets.forms.exportBuilder.running', 'Preparing your export…');

  const patch = (partial: Partial<ExportState>) => setState((current) => ({ ...current, ...partial }));

  const submit = () => {
    setSubmitted(true);
    if (target === null) return; // unbound (demo/story/palette)
    onEvent({
      type: 'mutate',
      intent: 'insert',
      connectionId: target.connectionId,
      table: target.table,
      values: {
        format: state.format,
        from: state.from,
        to: state.to,
        ...(config.includeChartsOption ? { includeCharts: state.includeCharts } : {}),
        ...(config.groupBy === undefined ? {} : { groupBy: state.groupBy }),
        ...(config.emailOption ? { email: state.email } : {}),
      },
    });
  };

  return (
    <div
      data-widget="export-builder"
      data-phase={phase}
      data-testid={config.testId}
      className="flex h-full flex-col gap-3 overflow-auto px-[var(--widget-pad)] pb-[var(--widget-pad)]"
    >
      <FormField label={formatLabel}>
        <SegmentedControl
          aria-label={formatLabel}
          data-part="export-format"
          value={state.format}
          onValueChange={(next) => patch({ format: oneOf(next, EXPORT_FORMATS, state.format) })}
          options={formats.map((format) => ({ value: format, label: format.toUpperCase() }))}
        />
      </FormField>

      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label={config.fromLabel ?? t('ui:widgets.forms.exportBuilder.from', 'From')}>
          <DateInput
            data-part="export-from"
            value={state.from}
            onChange={(event) => patch({ from: event.currentTarget.value })}
          />
        </FormField>
        <FormField label={config.toLabel ?? t('ui:widgets.forms.exportBuilder.to', 'To')}>
          <DateInput data-part="export-to" value={state.to} onChange={(event) => patch({ to: event.currentTarget.value })} />
        </FormField>
      </div>

      {config.groupBy !== undefined && config.groupBy.length > 0 && (
        <FormField label={config.groupByLabel ?? t('ui:widgets.forms.exportBuilder.groupBy', 'Group by')}>
          <Select
            data-part="export-group-by"
            value={state.groupBy}
            onChange={(event) => patch({ groupBy: event.currentTarget.value })}
          >
            <option value="" />
            {config.groupBy.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label ?? option.key}
              </option>
            ))}
          </Select>
        </FormField>
      )}

      {config.includeChartsOption && (
        <label className="flex cursor-pointer items-center justify-between gap-3">
          <span className="text-body-sm text-fg">
            {config.includeChartsLabel ?? t('ui:widgets.forms.exportBuilder.includeCharts', 'Include charts')}
          </span>
          <Switch
            data-part="export-include-charts"
            checked={state.includeCharts}
            onCheckedChange={(next) => patch({ includeCharts: next })}
          />
        </label>
      )}

      {config.emailOption && (
        <label className="flex cursor-pointer items-center justify-between gap-3">
          <span className="text-body-sm text-fg">
            {config.emailLabel ?? t('ui:widgets.forms.exportBuilder.email', 'Email me the export')}
          </span>
          <Switch data-part="export-email" checked={state.email} onCheckedChange={(next) => patch({ email: next })} />
        </label>
      )}

      {phase === 'running' && (
        <div data-part="export-progress" className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-caption text-fg-muted">{runningLabel}</span>
            <MonoText className="text-caption tabular-nums text-fg-muted">{`${progress}%`}</MonoText>
          </div>
          {/* `label` is ProgressBar's ACCESSIBLE name, not visible copy — the
              caption above is what a sighted user reads. */}
          <ProgressBar value={progress} label={runningLabel} />
        </div>
      )}

      {phase === 'failed' && (
        <p data-part="export-failed" className="text-caption font-semibold text-danger">
          {config.failedLabel ?? t('ui:widgets.forms.exportBuilder.failed', 'The export failed. Try again.')}
        </p>
      )}

      <div className="mt-auto flex items-center justify-end gap-2">
        {phase === 'done' && (
          <span data-part="export-done" className="me-auto text-caption font-semibold text-pos">
            {config.doneLabel ?? t('ui:widgets.forms.exportBuilder.done', 'Export ready')}
          </span>
        )}
        {phase === 'done' && href !== undefined ? (
          // Drill-through, not an <a download>: the host owns navigation and the
          // signed URL (04 §2.1). A Download button with no href would be a
          // control that does nothing, so it only renders once there IS one.
          <Button data-part="export-download" iconLeft={<Download />} onClick={() => onEvent({ type: 'drill-through', href })}>
            {config.downloadLabel ?? t('ui:widgets.forms.exportBuilder.download', 'Download')}
          </Button>
        ) : (
          <Button data-part="export-submit" loading={phase === 'running'} disabled={phase === 'running'} onClick={submit}>
            {config.submitLabel ?? t('ui:widgets.forms.exportBuilder.submit', 'Export')}
          </Button>
        )}
      </div>
    </div>
  );
}
