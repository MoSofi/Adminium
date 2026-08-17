// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `progress-bar` (annex §10) — determinate pill track with an animated accent
 * fill + optional mono % caption. Powers wizard %, import progress (the fill
 * flips `pos` at 100%) and generation progress. Evidence: Adminium Console,
 * Import Wizard, Workspace Onboarding, Connect Database, See It In Action.
 *
 * Wraps @adminium/ui's `ProgressBar` (which owns the track, the fill animation
 * and the `role="progressbar"` semantics); this file adds the `single-metric`
 * binding, the 0–100 clamp and the completion tone flip.
 */

import { MonoText, ProgressBar } from '@adminium/ui';
import { useMaybeT } from '@adminium/i18n/react';

import { clampPct, uiToneOf } from './forms-lib.js';
import { progressBarConfigSchema, progressBarDemoData } from './forms-config.js';
import type { ProgressBarConfig } from './forms-config.js';
import { asSingleMetric } from '../../lib/shapes.js';
import type { WidgetProps } from '../../registry/types.js';

export { progressBarConfigSchema, progressBarDemoData };
export type { ProgressBarConfig };

export function ProgressBarWidget({ config, data }: WidgetProps<ProgressBarConfig>) {
  const t = useMaybeT();
  const metric = asSingleMetric(data);
  // A malformed payload renders 0%, never a NaN-width bar (04 §3 leniency).
  const value = clampPct(metric?.value);
  const complete = value >= 100;
  const label = config.label ?? config.title ?? t('ui:widgets.forms.progressBar.label', 'Progress');

  return (
    <div
      data-widget="progress-bar"
      data-complete={complete ? 'true' : undefined}
      data-testid={config.testId}
      className="flex h-full items-center gap-2 px-[var(--widget-pad)] pb-[var(--widget-pad)]"
    >
      <ProgressBar
        value={value}
        max={100}
        // The completion flip is the annex's "color flips pos at 100%"; with it
        // off, an explicit config tone wins, else accent.
        tone={complete && config.completeColor ? 'pos' : uiToneOf(config.tone, 'accent')}
        size={config.height}
        animated
        label={label}
        className="flex-1"
      />
      {config.showPercent && (
        <MonoText data-part="progress-pct" className="shrink-0 text-caption font-semibold text-fg-muted">
          {Math.round(value)}%
        </MonoText>
      )}
    </div>
  );
}
