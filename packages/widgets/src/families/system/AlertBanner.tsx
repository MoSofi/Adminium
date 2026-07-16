/**
 * `alert-banner` (annex §12) — inline callout: severity tint, bold stat lead or
 * icon, explanatory copy, optional CTA. Variants observed in the comps:
 * over-limit warning, deploy-freeze note, recurring-schedule info, rebalance
 * suggestion. The annex's auto-instantiation hook emits one of these per quota
 * check.
 *
 * Wraps @adminium/ui's `Alert` (which owns the tone-soft bg + `color-mix` tone
 * border + default per-tone glyph); this file adds the record binding, the
 * severity→tone map, the bold stat lead, and dismissal.
 */

import { Button, IconButton, Alert } from '@adminium/ui';
import { X } from 'lucide-react';
import { useState } from 'react';

import { recordRowOf, stringField } from './system-lib.js';
import { alertBannerConfigSchema, alertBannerDemoData } from './system-config.js';
import type { AlertBannerConfig } from './system-config.js';
import type { WidgetProps } from '../../registry/types.js';

export { alertBannerConfigSchema, alertBannerDemoData };
export type { AlertBannerConfig };

const ALERT_TONES = ['info', 'pos', 'warn', 'danger'] as const;
type AlertTone = (typeof ALERT_TONES)[number];

/**
 * Default severity vocabulary — the common spellings a real `severity`/`level`
 * column uses. Config `severityMap` overrides it per instance.
 */
const DEFAULT_SEVERITY_TONE: Record<string, AlertTone> = {
  info: 'info',
  notice: 'info',
  success: 'pos',
  ok: 'pos',
  pos: 'pos',
  warn: 'warn',
  warning: 'warn',
  danger: 'danger',
  error: 'danger',
  critical: 'danger',
  fatal: 'danger',
};

function toneOf(severity: string | undefined, map: Record<string, string> | undefined): AlertTone {
  if (severity === undefined) return 'info';
  const mapped = map?.[severity] ?? DEFAULT_SEVERITY_TONE[severity.toLowerCase()];
  return mapped !== undefined && (ALERT_TONES as readonly string[]).includes(mapped) ? (mapped as AlertTone) : 'info';
}

export interface AlertBannerViewProps {
  severity?: string | undefined;
  /** Bold stat lead rendered before the copy ("92% of plan"). */
  lead?: string | undefined;
  message?: string | undefined;
  ctaLabel?: string | undefined;
  severityMap?: Record<string, string> | undefined;
  dismissible?: boolean | undefined;
  dismissLabel?: string | undefined;
  onCta?: (() => void) | undefined;
  testId?: string | undefined;
}

export function AlertBannerView({
  severity,
  lead,
  message,
  ctaLabel,
  severityMap,
  dismissible = false,
  dismissLabel,
  onCta,
  testId,
}: AlertBannerViewProps) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  const tone = toneOf(severity, severityMap);
  // The annex leads with the stat when there is one, else the message carries
  // the title line — an Alert always needs a title.
  const title = lead ?? message ?? '';
  const body = lead === undefined ? undefined : message;

  return (
    <div className="relative px-4 pb-4">
      <Alert
        data-widget="alert-banner"
        data-severity={severity ?? 'info'}
        data-testid={testId}
        tone={tone}
        // `warn`/`danger` callouts appear in response to a state change, so they
        // announce assertively; informational ones stay polite.
        role={tone === 'danger' || tone === 'warn' ? 'alert' : 'status'}
        title={title}
        {...(body === undefined ? {} : { body })}
        {...(ctaLabel === undefined
          ? {}
          : {
              action: (
                <Button size="sm" variant="ghost" onClick={() => onCta?.()}>
                  {ctaLabel}
                </Button>
              ),
            })}
        className={dismissible ? 'pe-11' : undefined}
      />
      {dismissible && (
        <IconButton
          size="sm"
          label={dismissLabel ?? 'Dismiss'}
          data-part="alert-dismiss"
          onClick={() => setDismissed(true)}
          className="absolute end-6 top-2"
        >
          <X className="size-3.5" />
        </IconButton>
      )}
    </div>
  );
}

export function AlertBannerWidget({ config, data, onEvent }: WidgetProps<AlertBannerConfig>) {
  const row = recordRowOf(data);
  if (row === null) return null;

  const href = stringField(row, config.ctaHrefField) ?? config.href;
  const ctaLabel = stringField(row, config.ctaLabelField);

  return (
    <AlertBannerView
      severity={stringField(row, config.severityField)}
      lead={stringField(row, config.leadField)}
      message={stringField(row, config.messageField)}
      // A CTA needs somewhere to go: without an href the label is inert, so drop it.
      {...(ctaLabel === undefined || href === undefined ? {} : { ctaLabel })}
      severityMap={config.severityMap}
      dismissible={config.dismissible}
      dismissLabel={config.dismissLabel}
      onCta={href === undefined ? undefined : () => onEvent({ type: 'drill-through', href })}
      testId={config.testId}
    />
  );
}
