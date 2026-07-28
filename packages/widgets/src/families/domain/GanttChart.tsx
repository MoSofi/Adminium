import { getFormatters, latnDataTag } from '@adminium/i18n';
import { useMaybeT } from '@adminium/i18n/react';
import { EmptyState, MonoText } from '@adminium/ui';
import type { Tone } from '@adminium/ui';
import { useMemo } from 'react';

import { ganttChartConfigSchema, ganttChartDemoData } from './domain-config.js';
import type { GanttChartConfig } from './domain-config.js';
import {
  TONE_SOLID_BG,
  asRecord,
  dayToPercent,
  daysToPercent,
  groupSpan,
  resolveLocale,
  toGanttModel,
  toneOf,
  weekTicks,
} from './domain-lib.js';
import type { GanttFieldMap } from './domain-lib.js';
import type { GanttGroup, GanttModel, GanttTask } from './domain-types.js';
import type { WidgetProps } from '../../registry/types.js';

/**
 * `gantt-chart` (annex §13) — percent-positioned task bars over a week-column
 * grid: phase group summary bars, per-task progress fill with a
 * contrast-switching % label, a today line, 45°-diamond milestones, owner
 * initials, and a legend footer. Built from start/end date columns + a progress
 * column + a phase FK — which is also the auto-instantiation trigger (annex §13:
 * "start+end dates + phase FK → `gantt-chart`").
 *
 * DIRECTION — THE LTR ISLAND (10-i18n-theming.md §5.5, verbatim): "The timeline
 * canvas (date header + bars + today line) is a **fixed-LTR island** — time
 * flows left→right, consistent with the chart rule; the label column stays
 * physically left of the canvas so labels align with the time origin. Everything
 * around it (toolbar, filters, zoom control, page chrome) mirrors."
 *
 * So this component does NOT mirror its time axis. The scroll region carries
 * `dir="ltr"`, which pins the label gutter + the axis origin to the physical
 * left inside an RTL page while the widget header/legend (outside the island)
 * mirror normally. This matches `@adminium/charts` — geometry/timelineLanes.ts
 * already states "The time axis is an LTR island (04 §7.4 — time axes never
 * mirror), so event x-positions are LTR here" — and it is why the LTR-canonical
 * geometry in domain-lib.ts is used verbatim under both directions.
 *
 * NOTE: this deliberately contradicts a "the gantt time axis mirrors in RTL"
 * reading of 04 §7.4's blanket "all horizontal scales mirror". 10-i18n-theming
 * §5.5 + its Open decisions #1 narrow that to CATEGORICAL scales; time axes stay
 * LTR. The narrower rule is the one implemented across the charts package, so it
 * is the one implemented here.
 *
 * Digits/dates route through the @adminium/i18n Intl layer; axis dates are
 * DATA-context strings → `latnDataTag` (Latin digits, gregorian) so the header
 * stays `tabular-nums`-aligned in every locale including `ar_EG`
 * (10-i18n-theming.md §4.2: "gantt date headers … are data context").
 */

export { ganttChartConfigSchema, ganttChartDemoData };
export type { GanttChartConfig };

/** Label-gutter width — the task-name column beside the canvas. */
const GUTTER = 'w-[168px]';

export interface GanttChartProps {
  data: unknown;
  fields: GanttFieldMap;
  totalDays?: number | undefined;
  todayLine?: boolean | undefined;
  /** Epoch ms for the today marker; pinned by stories/VRT, else the wall clock. */
  todayMs?: number | undefined;
  weekLabels?: boolean | undefined;
  showLegend?: boolean | undefined;
  phaseColors?: Record<string, string> | undefined;
  ungroupedLabel?: string | undefined;
  locale?: string | undefined;
  emptyTitle?: string | undefined;
  emptyBody?: string | undefined;
  testId?: string | undefined;
}

const axisFmts = new Map<string, Intl.DateTimeFormat>();

/** "Sep 1" — short month + day, Latin digits (data context), pinned to UTC. */
function fmtAxisDate(tag: string, ms: number): string {
  const resolved = latnDataTag(tag);
  let fmt = axisFmts.get(resolved);
  if (fmt === undefined) {
    fmt = new Intl.DateTimeFormat(resolved, { month: 'short', day: 'numeric', timeZone: 'UTC' });
    axisFmts.set(resolved, fmt);
  }
  return fmt.format(new Date(ms));
}

/** Tolerant read of the task `record-list` envelope. */
export function ganttRowsOf(data: unknown): Record<string, unknown>[] {
  const source = asRecord(data);
  return source !== null && Array.isArray(source.rows) ? (source.rows as Record<string, unknown>[]) : [];
}

export function GanttChart({
  data,
  fields,
  totalDays,
  todayLine = true,
  todayMs,
  weekLabels = true,
  showLegend = true,
  phaseColors,
  ungroupedLabel,
  locale,
  emptyTitle,
  emptyBody,
  testId,
}: GanttChartProps) {
  const t = useMaybeT();
  const tag = resolveLocale(locale);
  const fmt = getFormatters(tag);
  const rows = useMemo(() => ganttRowsOf(data), [data]);

  // Resolved here (not in domain-lib, which is hook-free): the config value
  // still wins; `t()` only localizes the hardcoded default.
  const resolvedUngroupedLabel = ungroupedLabel ?? t('ui:widgets.domain.ganttChart.ungroupedLabel', 'Tasks');

  const model: GanttModel = useMemo(
    () =>
      toGanttModel(rows, fields, {
        totalDays,
        ...(todayLine ? { todayMs: todayMs ?? Date.now() } : {}),
        ...(phaseColors === undefined ? {} : { phaseColors }),
        ungroupedLabel: resolvedUngroupedLabel,
      }),
    [rows, fields, totalDays, todayLine, todayMs, phaseColors, resolvedUngroupedLabel],
  );

  const ticks = useMemo(
    () => (weekLabels ? weekTicks(model.originMs, model.totalDays) : []),
    [weekLabels, model.originMs, model.totalDays],
  );

  if (model.groups.length === 0) {
    return (
      <EmptyState
        compact
        preset="no-data"
        title={emptyTitle ?? t('ui:widgets.domain.ganttChart.emptyTitle', 'Nothing scheduled')}
        body={emptyBody ?? t('ui:widgets.domain.ganttChart.emptyBody', 'Tasks appear here once they have start and end dates.')}
      />
    );
  }

  const todayPct = model.todayDay === null ? null : dayToPercent(model.todayDay, model.totalDays);

  return (
    <div data-widget="gantt-chart" data-testid={testId} className="flex h-full flex-col">
      {/*
        THE LTR ISLAND (§5.5). `dir="ltr"` pins the label gutter physically left
        of the canvas and makes time flow left→right even inside an RTL page.
        Logical utilities INSIDE this subtree therefore resolve to their physical
        LTR meaning — which is the intent, not an accident.
      */}
      <div dir="ltr" data-testid="gantt-canvas" className="flex-1 overflow-auto">
        <div className="min-w-[640px]">
          {weekLabels && (
            <div className="sticky top-0 z-10 flex border-b border-border bg-surface">
              <div className={`${GUTTER} shrink-0`} />
              <div className="relative flex flex-1">
                {ticks.map((ms) => (
                  <div
                    key={ms}
                    data-testid="gantt-week-tick"
                    className="flex-1 border-s border-border py-2 text-center text-[10.5px] font-bold text-fg-subtle"
                  >
                    <MonoText className="tabular-nums">{fmtAxisDate(tag, ms)}</MonoText>
                  </div>
                ))}
              </div>
            </div>
          )}

          {model.groups.map((group) => (
            <GanttGroupRows
              key={group.key}
              group={group}
              model={model}
              todayPct={todayPct}
              formatPercent={(pct) => fmt.percent(pct / 100)}
            />
          ))}
        </div>
      </div>

      {/*
        Chrome — OUTSIDE the island, so it mirrors normally under RTL (§5.5
        "Everything around it … mirrors").
      */}
      {showLegend && model.groups.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border px-3 py-2">
          {model.groups.map((group) => (
            <span key={group.key} className="flex items-center gap-1.5 text-caption text-fg-muted">
              <span className={`size-2 shrink-0 rounded-full ${TONE_SOLID_BG[toneOf(group.tone)]}`} aria-hidden="true" />
              {group.name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

interface GanttGroupRowsProps {
  group: GanttGroup;
  model: GanttModel;
  todayPct: number | null;
  formatPercent: (pct: number) => string;
}

function GanttGroupRows({ group, model, todayPct, formatPercent }: GanttGroupRowsProps) {
  const tone = toneOf(group.tone);
  const span = groupSpan(group);
  const summaryStart = dayToPercent(span.startDay, model.totalDays);
  const summaryWidth = daysToPercent(span.startDay, span.durDays, model.totalDays);

  return (
    <div data-testid={`gantt-group-${group.key}`}>
      {/* Phase summary row — the group bar at 40% alpha (annex §13). */}
      <div className="flex items-center border-b border-border bg-surface-2">
        <div className={`${GUTTER} shrink-0 truncate px-3 py-1.5 text-caption font-bold text-fg`}>
          {group.name}
        </div>
        <div className="relative h-7 flex-1">
          <TodayLine pct={todayPct} />
          <div
            className={`absolute inset-y-2 start-[var(--bar-x)] w-[var(--bar-w)] rounded ${TONE_SOLID_BG[tone]} opacity-40`}
            style={{ '--bar-x': `${summaryStart}%`, '--bar-w': `${summaryWidth}%` }}
            aria-hidden="true"
          />
        </div>
      </div>

      {group.tasks.map((task) => (
        <GanttTaskRow
          key={task.id}
          task={task}
          tone={tone}
          model={model}
          todayPct={todayPct}
          formatPercent={formatPercent}
        />
      ))}
    </div>
  );
}

interface GanttTaskRowProps {
  task: GanttTask;
  tone: Tone;
  model: GanttModel;
  todayPct: number | null;
  formatPercent: (pct: number) => string;
}

function GanttTaskRow({ task, tone, model, todayPct, formatPercent }: GanttTaskRowProps) {
  const startPct = dayToPercent(task.startDay, model.totalDays);
  const widthPct = daysToPercent(task.startDay, task.durDays, model.totalDays);
  const label = `${task.label} · ${formatPercent(task.pct)}`;

  return (
    <div
      data-testid={`gantt-task-${task.id}`}
      data-start-pct={startPct.toFixed(2)}
      className="flex items-center border-b border-border transition-colors hover:bg-surface-2"
    >
      <div className={`${GUTTER} shrink-0 truncate px-3 py-2 text-caption text-fg-muted`}>{task.label}</div>
      <div className="relative h-8 flex-1">
        <TodayLine pct={todayPct} />
        {task.milestone === true ? (
          <span
            title={task.label}
            aria-label={task.label}
            role="img"
            data-testid={`gantt-milestone-${task.id}`}
            className={`absolute top-1/2 start-[var(--bar-x)] size-2.5 -translate-y-1/2 rotate-45 ${TONE_SOLID_BG[tone]}`}
            style={{ '--bar-x': `${startPct}%` }}
          />
        ) : (
          <div
            title={label}
            aria-label={label}
            role="img"
            className="absolute inset-y-1.5 start-[var(--bar-x)] w-[var(--bar-w)] overflow-hidden rounded bg-surface-3"
            style={{ '--bar-x': `${startPct}%`, '--bar-w': `${widthPct}%` }}
          >
            {/* Progress fill — grows from the bar's start edge. */}
            <div
              className={`absolute inset-y-0 start-0 w-[var(--fill-w)] ${TONE_SOLID_BG[tone]}`}
              style={{ '--fill-w': `${task.pct}%` }}
            />
            {/*
              Contrast-switching % label (annex §13): above ~55% fill the label
              sits ON the tone-colored fill → invert to the tone's foreground.

              That inverted colour is `text-accent-fg`, the theme's single
              on-filled-surface token, NOT `text-white`: the fill is
              TONE_SOLID_BG[tone], which is themed, so a literal white loses the
              theme flip (white on the dark --pos is 2.00:1 and on the dark
              --accent 2.29:1, under the 4.5:1 AA floor for this 10px label).
              text-accent-fg measures >=5.68:1 on every TONE_SOLID_BG value in
              both themes (worst case: #0f0f14 on the dark --fg-subtle).

              adminium/no-literal-color-on-token-bg cannot flag this pairing —
              the background arrives through a lookup table in another module,
              which the rule does not resolve.
            */}
            <span
              className={`absolute inset-y-0 start-1.5 flex items-center text-[10px] font-bold tabular-nums ${
                task.pct > 55 ? 'text-accent-fg' : 'text-fg-muted'
              }`}
            >
              {task.pct > 0 ? formatPercent(task.pct) : ''}
            </span>
            {task.owner === undefined ? null : (
              <span className="absolute inset-y-0 end-1.5 flex items-center text-[9.5px] font-bold text-fg-subtle">
                {task.owner}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** The today marker — a full-height rule at the axis position (annex §13). */
function TodayLine({ pct }: { pct: number | null }) {
  if (pct === null) return null;
  return (
    <span
      data-testid="gantt-today-line"
      aria-hidden="true"
      className="absolute inset-y-0 z-[2] w-0.5 start-[var(--today-x)] bg-danger/55"
      style={{ '--today-x': `${pct}%` }}
    />
  );
}

/** Resolve the config's field-name map once per render (stable identity). */
function fieldsOf(config: GanttChartConfig): GanttFieldMap {
  return {
    idField: config.idField,
    labelField: config.labelField,
    startField: config.startField,
    endField: config.endField,
    progressField: config.progressField,
    phaseField: config.phaseField,
    ownerField: config.ownerField,
    milestoneField: config.milestoneField,
  };
}

export function GanttChartWidget({ config, data }: WidgetProps<GanttChartConfig>) {
  const fields = useMemo(() => fieldsOf(config), [config]);
  return (
    <GanttChart
      data={data}
      fields={fields}
      {...(config.totalDays === undefined ? {} : { totalDays: config.totalDays })}
      todayLine={config.todayLine}
      // `format.referenceTime` pins "now" for demo/VRT determinism (04 §2.1);
      // absent → the component falls back to the wall clock.
      {...(config.format?.referenceTime === undefined ? {} : { todayMs: config.format.referenceTime })}
      weekLabels={config.weekLabels}
      showLegend={config.showLegend}
      {...(config.phaseColors === undefined ? {} : { phaseColors: config.phaseColors })}
      {...(config.ungroupedLabel === undefined ? {} : { ungroupedLabel: config.ungroupedLabel })}
      {...(config.format?.locale === undefined ? {} : { locale: config.format.locale })}
      {...(config.emptyTitle === undefined ? {} : { emptyTitle: config.emptyTitle })}
      {...(config.emptyBody === undefined ? {} : { emptyBody: config.emptyBody })}
    />
  );
}
