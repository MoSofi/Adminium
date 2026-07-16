/**
 * `diagnostics-readout` (annex §12) — compact terminal card of key/value
 * connection-check results with semantic-toned status values + a last-checked
 * timestamp. Evidence: System States.
 *
 * Wraps @adminium/ui's `KeyValueList`/`KeyValueRow` (which own the row rhythm and
 * the mono value treatment); this file adds the record binding, the per-check
 * value→tone map, and the freshness stamp.
 */

import { KeyValueRow, MonoText, cn } from '@adminium/ui';

import { formatStamp, numberField, recordRowOf, stringField } from './system-lib.js';
import type { SystemTone } from './system-lib.js';
import {
  DEFAULT_DIAGNOSTIC_CHECKS,
  diagnosticsReadoutConfigSchema,
  diagnosticsReadoutDemoData,
} from './system-config.js';
import type { DiagnosticsReadoutConfig } from './system-config.js';
import type { WidgetProps } from '../../registry/types.js';

export { diagnosticsReadoutConfigSchema, diagnosticsReadoutDemoData, DEFAULT_DIAGNOSTIC_CHECKS };
export type { DiagnosticsReadoutConfig };

/** Value tone classes — CSS variables only (04 hard rule: no raw hex). */
const TONE_TEXT: Record<SystemTone, string> = {
  neutral: 'text-fg-muted',
  accent: 'text-accent',
  pos: 'text-pos',
  warn: 'text-warn',
  danger: 'text-danger',
  info: 'text-info',
};

export interface DiagnosticCheck {
  key: string;
  label?: string | undefined;
  tones?: Record<string, string> | undefined;
  mono?: boolean | undefined;
}

export interface DiagnosticsReadoutViewProps {
  checks: readonly DiagnosticCheck[];
  values: Record<string, string | undefined>;
  checkedAt?: number | undefined;
  checkedAtLabel?: string | undefined;
  locale?: string | undefined;
  testId?: string | undefined;
}

function toneOf(value: string | undefined, tones: Record<string, string> | undefined): SystemTone {
  const mapped = value === undefined ? undefined : tones?.[value];
  return mapped !== undefined && mapped in TONE_TEXT ? (mapped as SystemTone) : 'neutral';
}

export function DiagnosticsReadoutView({
  checks,
  values,
  checkedAt,
  checkedAtLabel,
  locale,
  testId,
}: DiagnosticsReadoutViewProps) {
  const stamp = formatStamp(checkedAt, locale);
  // Only render checks the payload actually answered — a readout that lists
  // every configured probe as blank reads as "broken", not "not run".
  const present = checks.filter((check) => values[check.key] !== undefined);

  return (
    <div
      data-widget="diagnostics-readout"
      data-testid={testId}
      className="flex h-full flex-col gap-2 overflow-auto px-4 pb-4"
    >
      <div className="rounded-lg border border-border bg-surface-2 px-3 py-1.5">
        {present.map((check) => {
          const value = values[check.key];
          const tone = toneOf(value, check.tones);
          return (
            <KeyValueRow
              key={check.key}
              data-part="diagnostic-row"
              data-check={check.key}
              data-tone={tone}
              label={check.label ?? check.key}
            >
              {check.mono === false ? (
                <span className={cn('text-body-sm font-semibold', TONE_TEXT[tone])}>{value}</span>
              ) : (
                <MonoText className={cn('text-body-sm font-semibold', TONE_TEXT[tone])}>{value}</MonoText>
              )}
            </KeyValueRow>
          );
        })}
      </div>
      {stamp !== undefined && (
        <p className="text-caption text-fg-subtle">
          {checkedAtLabel ?? 'Last checked'} <MonoText>{stamp}</MonoText>
        </p>
      )}
    </div>
  );
}

export function DiagnosticsReadoutWidget({ config, data }: WidgetProps<DiagnosticsReadoutConfig>) {
  const row = recordRowOf(data);
  const checks = config.checks ?? DEFAULT_DIAGNOSTIC_CHECKS;

  const values: Record<string, string | undefined> = {};
  if (row !== null) {
    for (const check of checks) values[check.key] = stringField(row, check.key);
  }

  return (
    <DiagnosticsReadoutView
      checks={checks}
      values={values}
      checkedAt={row === null ? undefined : numberField(row, config.checkedAtField)}
      checkedAtLabel={config.checkedAtLabel}
      locale={config.format?.locale}
      testId={config.testId}
    />
  );
}
