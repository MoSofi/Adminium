// SPDX-License-Identifier: AGPL-3.0-only
import { MonoText, SegmentedControl, Tooltip, TooltipProvider } from '@adminium/ui';
import type { Tone } from '@adminium/ui';
import { useMaybeT } from '@adminium/i18n/react';
import { useMemo, useState } from 'react';

import { uptimeSegmentBarConfigSchema, uptimeSegmentBarDemoData } from './domain-ops-config.js';
import type { UptimeSegmentBarConfig } from './domain-ops-config.js';
import {
  OPS_TONE_BG,
  UPTIME_TONE,
  formatDay,
  formatPct,
  instantField,
  interpolate,
  opsRowsOf,
  uptimePct,
  uptimeStateOf,
} from './domain-ops-lib.js';
import type { UptimeDay, UptimeState } from './domain-ops-types.js';
import { toneOf } from './domain-lib.js';
import { OpsEmpty } from './OpsEmpty.js';
import type { WidgetProps } from '../../registry/types.js';

/**
 * `uptime-segment-bar` (annex §13) — the statuspage-style day strip: n flex
 * segments toned pos/warn/danger with per-day tooltips and a hover scaleY, an
 * axis reading "{n} days ago / uptime % / Today", and a 30/90-day toggle.
 * Evidence: Status Page.
 *
 * DIRECTION (10-i18n-theming.md §5.5) — this one MIRRORS, and that is a
 * deliberate call against the gantt's fixed-LTR-island rule, not an oversight.
 * The island rule exists for a DATED canvas: the gantt has a calendar header and
 * a label gutter that must align to a time ORIGIN, so flipping it would put day
 * 0 under a header that says otherwise. A statuspage strip has neither. It has
 * exactly two anchors — an "N days ago" caption at one end and "Today" at the
 * other — and both are text that mirrors with the reader. Pinning the strip LTR
 * while its own captions flipped would put "Today" at the end the newest segment
 * is NOT at: a caption that lies. So the strip is a plain `flex` row and the
 * whole thing reverses under `dir="rtl"`, captions and segments together.
 *
 * The array itself is never reversed in JS — rows arrive oldest → newest and are
 * rendered in that order in both directions, so LTR and RTL consume byte-
 * identical data and only CSS differs.
 */

export { uptimeSegmentBarConfigSchema, uptimeSegmentBarDemoData };
export type { UptimeSegmentBarConfig };

export interface UptimeSegmentBarViewProps {
  /** Daily statuses, OLDEST → NEWEST. */
  days: readonly UptimeDay[];
  period?: '30' | '90' | undefined;
  showToggle?: boolean | undefined;
  stateColors?: Record<string, string> | undefined;
  locale?: string | undefined;
  daysAgoLabel?: string | undefined;
  todayLabel?: string | undefined;
  uptimeLabel?: string | undefined;
  testId?: string | undefined;
}

/** Per-day tone: an explicit `stateColors` override, else the shared uptime map. */
function dayTone(state: UptimeState, overrides: Record<string, string> | undefined): Tone {
  const explicit = overrides?.[state];
  return explicit === undefined ? UPTIME_TONE[state] : toneOf(explicit, UPTIME_TONE[state]);
}

const STATUS_FALLBACK: Record<UptimeState, string> = {
  operational: 'Operational',
  degraded: 'Degraded',
  down: 'Down',
  unknown: 'No data',
};

/**
 * Literal bundle key per state — indexed, never assembled, so the extractor
 * sees all four and a new `UptimeState` fails the build (10 §2.5).
 */
const STATUS_KEY = {
  operational: 'ui:widgets.domain.uptimeSegmentBar.status.operational',
  degraded: 'ui:widgets.domain.uptimeSegmentBar.status.degraded',
  down: 'ui:widgets.domain.uptimeSegmentBar.status.down',
  unknown: 'ui:widgets.domain.uptimeSegmentBar.status.unknown',
} as const satisfies Record<UptimeState, string>;

export function UptimeSegmentBarView({
  days,
  period = '90',
  showToggle = true,
  stateColors,
  locale,
  daysAgoLabel,
  todayLabel,
  uptimeLabel,
  testId,
}: UptimeSegmentBarViewProps) {
  const t = useMaybeT();
  // The toggle is COMPONENT state seeded from config: a stored config pins where
  // the strip starts, not where it stays (a widget that reset the user's toggle
  // on every re-render would be unusable).
  const [window, setWindow] = useState<string>(period);
  const size = window === '30' ? 30 : 90;
  const visible = useMemo(() => days.slice(-size), [days, size]);
  const pct = useMemo(() => uptimePct(visible.map((day) => day.state)), [visible]);

  return (
    <TooltipProvider>
      <div
        data-widget="uptime-segment-bar"
        data-testid={testId}
        data-period={window}
        className="flex h-full flex-col justify-center gap-2 px-[var(--widget-pad)] pb-[var(--widget-pad)]"
      >
        {!showToggle ? null : (
          <div className="flex justify-end">
            <SegmentedControl
              value={window}
              onValueChange={setWindow}
              data-testid="uptime-period-toggle"
              options={[
                { value: '30', label: t('ui:widgets.domain.uptimeSegmentBar.period30Label', '30d') },
                { value: '90', label: t('ui:widgets.domain.uptimeSegmentBar.period90Label', '90d') },
              ]}
            />
          </div>
        )}

        {/*
          Decorative for AT: the axis row below states the same summary in text
          ("90 days ago · 99.4% uptime · Today"), and announcing ninety segments
          would bury it.
        */}
        <div aria-hidden="true" data-testid="uptime-strip" className="flex h-9 items-stretch gap-[2px]">
          {visible.map((day) => {
            const tone = dayTone(day.state, stateColors);
            const label = `${formatDay(day.ms, locale) ?? ''} — ${t(STATUS_KEY[day.state], STATUS_FALLBACK[day.state])}`;
            return (
              <Tooltip key={day.ms} content={label}>
                <span
                  data-part="uptime-segment"
                  data-state={day.state}
                  className={`min-w-[3px] flex-1 rounded-xs transition-transform duration-150 hover:scale-y-110 ${OPS_TONE_BG[tone]}`}
                />
              </Tooltip>
            );
          })}
        </div>

        <div className="flex items-center justify-between gap-2 text-caption text-fg-subtle">
          <span data-part="uptime-axis-start">
            {daysAgoLabel !== undefined
              ? interpolate(daysAgoLabel, { days: size })
              : // `days` is pre-stringified so ICU substitutes verbatim, exactly
                // like the config path's `interpolate`.
                t('ui:widgets.domain.uptimeSegmentBar.daysAgoLabel', '{days} days ago', { days: String(size) })}
          </span>
          <MonoText className="font-bold text-fg" data-part="uptime-pct">
            {formatPct(pct, locale, 2)} {uptimeLabel ?? t('ui:widgets.domain.uptimeSegmentBar.uptimeLabel', 'uptime')}
          </MonoText>
          <span data-part="uptime-axis-end">{todayLabel ?? t('ui:widgets.domain.uptimeSegmentBar.todayLabel', 'Today')}</span>
        </div>
      </div>
    </TooltipProvider>
  );
}

/** Project the bound `record-list` onto the day strip (oldest → newest). */
function daysOf(config: UptimeSegmentBarConfig, data: unknown): UptimeDay[] {
  const rows = opsRowsOf(data);
  const out: UptimeDay[] = [];
  rows.forEach((row, index) => {
    const ms = instantField(row, config.dayField);
    out.push({
      // A status column with no usable date still renders in payload order — the
      // strip's meaning is the SEQUENCE, and dropping undated days would silently
      // shorten the window and inflate the uptime percentage.
      ms: ms ?? index,
      state: uptimeStateOf(row[config.statusField]),
    });
  });
  return out;
}

export function UptimeSegmentBarWidget({ config, data }: WidgetProps<UptimeSegmentBarConfig>) {
  const t = useMaybeT();
  const days = useMemo(() => daysOf(config, data), [config, data]);

  if (days.length === 0) {
    return (
      <OpsEmpty
        title={config.emptyTitle ?? t('ui:widgets.domain.uptimeSegmentBar.emptyTitle', 'No uptime history')}
        body={config.emptyBody ?? t('ui:widgets.domain.uptimeSegmentBar.emptyBody', 'Daily status rows appear here as an uptime strip.')}
      />
    );
  }

  return (
    <UptimeSegmentBarView
      days={days}
      period={config.period}
      showToggle={config.showToggle}
      {...(config.stateColors === undefined ? {} : { stateColors: config.stateColors })}
      {...(config.format?.locale === undefined ? {} : { locale: config.format.locale })}
      {...(config.daysAgoLabel === undefined ? {} : { daysAgoLabel: config.daysAgoLabel })}
      {...(config.todayLabel === undefined ? {} : { todayLabel: config.todayLabel })}
      {...(config.uptimeLabel === undefined ? {} : { uptimeLabel: config.uptimeLabel })}
      {...(config.testId === undefined ? {} : { testId: config.testId })}
    />
  );
}
