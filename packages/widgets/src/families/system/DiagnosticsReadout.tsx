// SPDX-License-Identifier: AGPL-3.0-only
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
import { useScrollRegion } from '../../lib/useScrollRegion.js';
import { useWidgetHeadingId } from '../../frame/WidgetHeadingContext.js';
import { useMaybeT } from '@adminium/i18n/react';

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

/**
 * `DEFAULT_DIAGNOSTIC_CHECKS` with localized labels: `ui:widgets.system.
 * diagnosticsReadout.*` under an `I18nProvider`, the same English fallbacks
 * outside one. Config-supplied `checks` are never remapped — an explicit label
 * arrives already translated and always wins.
 */
function useDefaultDiagnosticChecks(): readonly DiagnosticCheck[] {
  const t = useMaybeT();
  const labels: Record<string, string> = {
    host: t('ui:widgets.system.diagnosticsReadout.host', 'Host'),
    dns: t('ui:widgets.system.diagnosticsReadout.dns', 'DNS'),
    tcp: t('ui:widgets.system.diagnosticsReadout.tcp', 'TCP'),
    tls: t('ui:widgets.system.diagnosticsReadout.tls', 'TLS'),
    auth: t('ui:widgets.system.diagnosticsReadout.auth', 'Auth'),
    latency: t('ui:widgets.system.diagnosticsReadout.latency', 'Latency'),
  };
  return DEFAULT_DIAGNOSTIC_CHECKS.map((check) => ({ ...check, label: labels[check.key] ?? check.label }));
}

export function DiagnosticsReadoutView({
  checks,
  values,
  checkedAt,
  checkedAtLabel,
  locale,
  testId,
}: DiagnosticsReadoutViewProps) {
  const t = useMaybeT();
  const stamp = formatStamp(checkedAt, locale);
  // Only render checks the payload actually answered — a readout that lists
  // every configured probe as blank reads as "broken", not "not run".
  // The DNS/TCP/TLS/auth rows below the fold were unreachable without a mouse:
  // a keyboard-only operator could read the first four checks of a failing
  // connection and not the one that failed. `group` rather than `region` — a
  // dashboard of thirteen widgets must not contribute thirteen landmarks.
  const scroll = useScrollRegion({ role: 'group', labelledBy: useWidgetHeadingId() ?? undefined });

  const present = checks.filter((check) => values[check.key] !== undefined);

  return (
    <div
      data-widget="diagnostics-readout"
      data-testid={testId}
      {...scroll}
      className={`flex h-full flex-col gap-2 overflow-auto px-[var(--widget-pad)] pb-[var(--widget-pad)] ${scroll.className}`}
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
          {checkedAtLabel ?? t('ui:widgets.system.diagnosticsReadout.checkedAt', 'Last checked')} <MonoText>{stamp}</MonoText>
        </p>
      )}
    </div>
  );
}

export function DiagnosticsReadoutWidget({ config, data }: WidgetProps<DiagnosticsReadoutConfig>) {
  const defaultChecks = useDefaultDiagnosticChecks();
  const row = recordRowOf(data);
  const checks = config.checks ?? defaultChecks;

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
