// SPDX-License-Identifier: AGPL-3.0-only
import { Badge, MonoText, ProgressBar } from '@adminium/ui';
import { useMaybeT } from '@adminium/i18n/react';
import { useMemo } from 'react';

import { experimentVariantCompareConfigSchema, experimentVariantCompareDemoData } from './domain-ops-config.js';
import type { ExperimentVariantCompareConfig } from './domain-ops-config.js';
import {
  OPS_TONE_BG,
  OPS_TONE_TEXT,
  booleanField,
  confidenceTone,
  countField,
  formatCount,
  formatPct,
  interpolate,
  labelField,
  liftPct,
  opsRowsOf,
  pctField,
} from './domain-ops-lib.js';
import type { ExperimentVariant } from './domain-ops-types.js';
import { asRecord, clamp, numberField } from './domain-lib.js';
import { OpsEmpty } from './OpsEmpty.js';
import type { WidgetProps } from '../../registry/types.js';

/**
 * `experiment-variant-compare` (annex §13) — per-variant horizontal conversion
 * bars (width = conv / maxConv), lift-vs-control pills, CONTROL / WINNER badges,
 * participant + conversion counts, and the paired significance meter: a
 * confidence bar color-coded ≥95 green / ≥80 amber plus a verdict.
 * Evidence: AB Experiments.
 *
 * WINNER IS DERIVED, NEVER BOUND (annex: "winner derived") — and it is derived
 * with the significance gate applied, not from `max(conv)` alone. An experiment
 * readout that crowns a "winner" at 61% confidence is the single most expensive
 * mistake this widget could make: it tells a reader to ship a change the data
 * does not support. So the badge appears only when the test cleared the high
 * threshold AND the leader is not the control.
 */

export { experimentVariantCompareConfigSchema, experimentVariantCompareDemoData };
export type { ExperimentVariantCompareConfig };

export interface ExperimentVariantCompareViewProps {
  variants: readonly ExperimentVariant[];
  /** Significance of the test, percent 0–100; absent → no meter. */
  confidence?: number | undefined;
  confThresholds?: { high?: number; medium?: number } | undefined;
  showSignificance?: boolean | undefined;
  locale?: string | undefined;
  controlLabel?: string | undefined;
  winnerLabel?: string | undefined;
  significanceLabel?: string | undefined;
  verdictSignificantLabel?: string | undefined;
  verdictInconclusiveLabel?: string | undefined;
  countsLabel?: string | undefined;
  testId?: string | undefined;
}

export function ExperimentVariantCompareView({
  variants,
  confidence,
  confThresholds,
  showSignificance = true,
  locale,
  controlLabel,
  winnerLabel,
  significanceLabel,
  verdictSignificantLabel,
  verdictInconclusiveLabel,
  countsLabel,
  testId,
}: ExperimentVariantCompareViewProps) {
  const t = useMaybeT();
  const maxConv = useMemo(
    () => variants.reduce((max, variant) => Math.max(max, variant.conv), 0),
    [variants],
  );
  const control = useMemo(() => variants.find((variant) => variant.control), [variants]);

  const high = confThresholds?.high ?? 95;
  const leader = useMemo(
    () => variants.reduce<ExperimentVariant | null>((best, v) => (best === null || v.conv > best.conv ? v : best), null),
    [variants],
  );
  // See the header note: significant AND not the control.
  const winnerId =
    confidence !== undefined && confidence >= high && leader !== null && !leader.control ? leader.id : null;

  const meterTone = confidence === undefined ? 'neutral' : confidenceTone(confidence, confThresholds);
  const significant = confidence !== undefined && confidence >= high;
  const resolvedSignificanceLabel =
    significanceLabel ?? t('ui:widgets.domain.experimentVariantCompare.significanceLabel', 'Confidence');

  return (
    <div
      data-widget="experiment-variant-compare"
      data-testid={testId}
      className="flex h-full flex-col gap-3 overflow-auto px-[var(--widget-pad)] pb-[var(--widget-pad)]"
    >
      <div className="flex flex-col gap-2.5">
        {variants.map((variant) => {
          const lift = control === undefined || variant.control ? null : liftPct(variant.conv, control.conv);
          // Bar width is conv / maxConv (annex) — a RELATIVE scale, so the
          // leader always fills the row and small absolute rates stay legible.
          const width = maxConv <= 0 ? 0 : clamp((variant.conv / maxConv) * 100, 0, 100);
          return (
            <div key={variant.id} data-part="variant-row" data-variant={variant.id} className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-body-sm font-semibold text-fg">{variant.name}</span>
                {variant.control ? (
                  <Badge tone="neutral" data-part="variant-control">
                    {controlLabel ?? t('ui:widgets.domain.experimentVariantCompare.controlLabel', 'CONTROL')}
                  </Badge>
                ) : null}
                {winnerId === variant.id ? (
                  <Badge tone="pos" data-part="variant-winner">
                    {winnerLabel ?? t('ui:widgets.domain.experimentVariantCompare.winnerLabel', 'WINNER')}
                  </Badge>
                ) : null}
                <span className="ms-auto flex items-center gap-2">
                  {lift === null ? null : (
                    <Badge tone={lift >= 0 ? 'pos' : 'danger'} data-part="variant-lift">
                      {`${lift >= 0 ? '+' : ''}${formatPct(Math.abs(lift), locale, 1)}`}
                    </Badge>
                  )}
                  <MonoText className="text-body-sm font-bold tabular-nums text-fg">
                    {formatPct(variant.conv, locale, 2)}
                  </MonoText>
                </span>
              </div>
              {/*
                The bar is decorative: the same rate is stated as text in the row
                above, so announcing a second progressbar per variant is noise.
              */}
              <div aria-hidden="true" className="h-2 overflow-hidden rounded-full bg-surface-3">
                <div
                  data-part="variant-bar"
                  className={`h-full w-[var(--bar-w)] rounded-full ${
                    winnerId === variant.id ? OPS_TONE_BG.pos : OPS_TONE_BG.accent
                  }`}
                  style={{ '--bar-w': `${width}%` }}
                />
              </div>
              <p className="text-caption text-fg-subtle">
                {countsLabel !== undefined
                  ? interpolate(countsLabel, {
                      users: formatCount(variant.users, locale),
                      conversions: formatCount(variant.conversions, locale),
                    })
                  : t(
                      'ui:widgets.domain.experimentVariantCompare.countsLabel',
                      '{users} participants · {conversions} conversions',
                      {
                        users: formatCount(variant.users, locale),
                        conversions: formatCount(variant.conversions, locale),
                      },
                    )}
              </p>
            </div>
          );
        })}
      </div>

      {!showSignificance || confidence === undefined ? null : (
        <div data-testid="significance-meter" className="mt-auto flex flex-col gap-1 border-t border-border pt-3">
          <div className="flex items-center justify-between text-caption">
            <span className="text-fg-subtle">{resolvedSignificanceLabel}</span>
            <MonoText className={`font-bold ${OPS_TONE_TEXT[meterTone]}`} data-part="significance-value">
              {formatPct(confidence, locale, 1)}
            </MonoText>
          </div>
          <ProgressBar
            value={confidence}
            tone={meterTone}
            size="sm"
            animated={false}
            label={resolvedSignificanceLabel}
          />
          <p className="text-caption text-fg-subtle" data-part="significance-verdict">
            {significant
              ? (verdictSignificantLabel ??
                t('ui:widgets.domain.experimentVariantCompare.verdictSignificantLabel', 'Statistically significant — safe to call.'))
              : (verdictInconclusiveLabel ??
                t('ui:widgets.domain.experimentVariantCompare.verdictInconclusiveLabel', 'Not yet significant — keep the test running.'))}
          </p>
        </div>
      )}
    </div>
  );
}

/** Project the bound `record-list` onto the variant model. */
function variantsOf(config: ExperimentVariantCompareConfig, data: unknown): ExperimentVariant[] {
  const rows = opsRowsOf(data);
  return rows.map((row, index) => {
    const conv = pctField(row, config.convField, 0);
    const users = countField(row, config.usersField, 0);
    return {
      id: labelField(row, config.idField, `v${index}`),
      name: labelField(row, config.nameField, `Variant ${index + 1}`),
      conv,
      users,
      // Denormalized conversions when the column exists; else derived from the
      // rate — an experiment table stores one or the other, rarely both.
      conversions: countField(row, config.conversionsField, Math.round((users * conv) / 100)),
      control: booleanField(row, config.controlField) ?? index === 0,
    };
  });
}

/**
 * Read the test's significance. Envelope-level first (a server that computes it
 * returns it beside `rows`), then off the leading row (a denormalized variants
 * table stores it per arm). Absent → the meter is simply not rendered.
 */
function confidenceOf(config: ExperimentVariantCompareConfig, data: unknown, rows: Record<string, unknown>[]): number | undefined {
  const envelope = asRecord(data);
  const fromEnvelope = envelope === null ? undefined : numberField(envelope, config.confidenceField);
  if (fromEnvelope !== undefined) return clamp(fromEnvelope, 0, 100);
  for (const row of rows) {
    const value = numberField(row, config.confidenceField);
    if (value !== undefined) return clamp(value, 0, 100);
  }
  return undefined;
}

export function ExperimentVariantCompareWidget({ config, data }: WidgetProps<ExperimentVariantCompareConfig>) {
  const t = useMaybeT();
  const variants = useMemo(() => variantsOf(config, data), [config, data]);
  const confidence = useMemo(() => confidenceOf(config, data, opsRowsOf(data)), [config, data]);

  if (variants.length === 0) {
    return (
      <OpsEmpty
        title={config.emptyTitle ?? t('ui:widgets.domain.experimentVariantCompare.emptyTitle', 'No variants')}
        body={config.emptyBody ?? t('ui:widgets.domain.experimentVariantCompare.emptyBody', 'Bind an experiment variants table with conversion numbers.')}
      />
    );
  }

  return (
    <ExperimentVariantCompareView
      variants={variants}
      showSignificance={config.showSignificance}
      {...(confidence === undefined ? {} : { confidence })}
      {...(config.confThresholds === undefined ? {} : { confThresholds: config.confThresholds })}
      {...(config.format?.locale === undefined ? {} : { locale: config.format.locale })}
      {...(config.controlLabel === undefined ? {} : { controlLabel: config.controlLabel })}
      {...(config.winnerLabel === undefined ? {} : { winnerLabel: config.winnerLabel })}
      {...(config.significanceLabel === undefined ? {} : { significanceLabel: config.significanceLabel })}
      {...(config.verdictSignificantLabel === undefined ? {} : { verdictSignificantLabel: config.verdictSignificantLabel })}
      {...(config.verdictInconclusiveLabel === undefined
        ? {}
        : { verdictInconclusiveLabel: config.verdictInconclusiveLabel })}
      {...(config.countsLabel === undefined ? {} : { countsLabel: config.countsLabel })}
      {...(config.testId === undefined ? {} : { testId: config.testId })}
    />
  );
}
