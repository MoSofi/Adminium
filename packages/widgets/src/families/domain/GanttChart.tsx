// SPDX-License-Identifier: AGPL-3.0-only
import { getFormatters, latnDataTag } from '@adminium/i18n';
import { useMaybeT } from '../../lib/i18n.js';
import { Avatar, EmptyState, MonoText } from '@adminium/ui';
import type { Tone } from '@adminium/ui';
import { ChevronDown, ChevronRight, CircleCheckBig, Flag, ListChecks, TriangleAlert, type LucideIcon } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { ganttChartConfigSchema, ganttChartDemoData } from './domain-config.js';
import type { GanttChartConfig } from './domain-config.js';
import { TONE_SOLID_BG, asRecord, dayToPercent, daysToPercent, groupSpan, resolveLocale, toGanttModel, toneOf } from './domain-lib.js';
import type { GanttFieldMap } from './domain-lib.js';
import type { GanttGroup, GanttModel, GanttTask } from './domain-types.js';
import { bindingSourceOf } from '../boards/board-lib.js';
import type { WidgetProps } from '../../registry/types.js';

/**
 * `gantt-chart` — the Gantt Chart comp: the plan's four figures, then one
 * card — a "Task" column beside a week (or month) grid, each group a row of
 * its own with a faint bar over its whole span (collapsible), each task a
 * tinted bar filled as far as its progress with the % on it, milestones as
 * diamonds, a red line at today, and the legend at the foot.
 *
 * DIRECTION — THE LTR ISLAND: the timeline canvas (date header + bars + today
 * line) is a fixed-LTR island — time flows left→right in every language, the
 * charts package's rule for time axes; the label column stays physically left
 * of the canvas so labels line up with the time origin. Everything around it
 * (figures, the Weeks/Months control, the legend) mirrors normally.
 *
 * Digits/dates route through the @adminium/i18n Intl layer; axis dates are
 * DATA-context strings → `latnDataTag` (Latin digits, gregorian).
 */

export { ganttChartConfigSchema, ganttChartDemoData };
export type { GanttChartConfig };

const DAY_MS = 86_400_000;

/** A group's colour: its bar's tint, its fill, its dot, the summary bar. */
const TINT: Record<Tone, string> = {
  neutral: 'bg-surface-3 border-border-strong',
  accent: 'bg-accent-soft border-accent/50',
  pos: 'bg-pos-soft border-pos/50',
  warn: 'bg-warn-soft border-warn/50',
  danger: 'bg-danger-soft border-danger/50',
  info: 'bg-info-soft border-info/50',
};
const SUMMARY: Record<Tone, string> = {
  neutral: 'bg-fg-subtle/40',
  accent: 'bg-accent/40',
  pos: 'bg-pos/40',
  warn: 'bg-warn/40',
  danger: 'bg-danger/40',
  info: 'bg-info/40',
};
const STAT_TONE = {
  accent: 'bg-accent-soft text-accent',
  pos: 'bg-pos-soft text-pos',
  warn: 'bg-warn-soft text-warn',
  danger: 'bg-danger-soft text-danger',
} as const;

export interface GanttChartProps {
  data: unknown;
  fields: GanttFieldMap;
  totalDays?: number | undefined;
  todayLine?: boolean | undefined;
  /** Epoch ms for the today marker; pinned by stories/VRT, else the wall clock. */
  todayMs?: number | undefined;
  weekLabels?: boolean | undefined;
  showLegend?: boolean | undefined;
  /** The comp's four figures above the timeline. */
  showStats?: boolean | undefined;
  phaseColors?: Record<string, string> | undefined;
  ungroupedLabel?: string | undefined;
  locale?: string | undefined;
  emptyTitle?: string | undefined;
  emptyBody?: string | undefined;
  /** A task's bar was chosen: open its record. */
  onTaskOpen?: ((taskId: string) => void) | undefined;
  testId?: string | undefined;
}

const axisFmts = new Map<string, Intl.DateTimeFormat>();
const monthFmts = new Map<string, Intl.DateTimeFormat>();

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

/** "Sep 2026" — a month column's head. */
function fmtAxisMonth(tag: string, ms: number): string {
  const resolved = latnDataTag(tag);
  let fmt = monthFmts.get(resolved);
  if (fmt === undefined) {
    fmt = new Intl.DateTimeFormat(resolved, { month: 'short', year: 'numeric', timeZone: 'UTC' });
    monthFmts.set(resolved, fmt);
  }
  return fmt.format(new Date(ms));
}

/** Tolerant read of the task `record-list` envelope. */
export function ganttRowsOf(data: unknown): Record<string, unknown>[] {
  const source = asRecord(data);
  return source !== null && Array.isArray(source.rows) ? (source.rows as Record<string, unknown>[]) : [];
}

type Zoom = 'weeks' | 'months';

/** The columns the grid is cut into, each with its start (ms) and its share of the axis. */
function columnsOf(zoom: Zoom, originMs: number, totalDays: number): { ms: number; startDay: number; days: number }[] {
  const endMs = originMs + totalDays * DAY_MS;
  const out: { ms: number; startDay: number; days: number }[] = [];
  if (zoom === 'weeks') {
    for (let ms = originMs; ms < endMs; ms += 7 * DAY_MS) {
      const startDay = (ms - originMs) / DAY_MS;
      out.push({ ms, startDay, days: Math.min(7, totalDays - startDay) });
    }
    return out;
  }
  const origin = new Date(originMs);
  let cursor = Date.UTC(origin.getUTCFullYear(), origin.getUTCMonth(), 1);
  while (cursor < endMs) {
    const d = new Date(cursor);
    const next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
    const from = Math.max(cursor, originMs);
    const to = Math.min(next, endMs);
    out.push({ ms: cursor, startDay: (from - originMs) / DAY_MS, days: (to - from) / DAY_MS });
    cursor = next;
  }
  return out;
}

/**
 * A task is at risk when it is not done and either its end has passed or it
 * is further behind than a quarter of its time: 60% of the way through its
 * dates with 20% done. Milestones are counted on their own.
 */
function atRisk(task: GanttTask, todayDay: number | null): boolean {
  if (task.milestone === true || task.pct >= 100 || todayDay === null) return false;
  if (todayDay > task.startDay + task.durDays) return true;
  if (todayDay <= task.startDay) return false;
  const elapsed = ((todayDay - task.startDay) / Math.max(1, task.durDays)) * 100;
  return elapsed - task.pct > 25;
}

export function GanttChart({
  data,
  fields,
  totalDays,
  todayLine = true,
  todayMs,
  weekLabels = true,
  showLegend = true,
  showStats = false,
  phaseColors,
  ungroupedLabel,
  locale,
  emptyTitle,
  emptyBody,
  onTaskOpen,
  testId,
}: GanttChartProps) {
  const t = useMaybeT();
  const tag = resolveLocale(locale);
  const fmt = getFormatters(tag);
  const rows = useMemo(() => ganttRowsOf(data), [data]);
  const now = todayMs ?? Date.now();

  // Resolved here (not in domain-lib, which is hook-free): the config value
  // still wins; `t()` only localizes the hardcoded default.
  const resolvedUngroupedLabel = ungroupedLabel ?? t('ui:widgets.domain.ganttChart.ungroupedLabel', 'Tasks');

  const base: GanttModel = useMemo(
    () =>
      toGanttModel(rows, fields, {
        totalDays,
        ...(phaseColors === undefined ? {} : { phaseColors }),
        ungroupedLabel: resolvedUngroupedLabel,
      }),
    [rows, fields, totalDays, phaseColors, resolvedUngroupedLabel],
  );
  // The axis reaches today (the comp always shows where today is), with a week to spare either side of the plan.
  const model = useMemo(() => {
    if (base.groups.length === 0 || !todayLine || totalDays !== undefined) {
      const todayDay = todayLine ? (now - base.originMs) / DAY_MS : null;
      return { ...base, todayDay: todayDay !== null && todayDay >= 0 && todayDay <= base.totalDays ? todayDay : null };
    }
    const todayDay = (now - base.originMs) / DAY_MS;
    const lead = todayDay < 0 ? Math.ceil(-todayDay) + 7 : 0;
    const shift = (task: GanttTask): GanttTask => ({ ...task, startDay: task.startDay + lead });
    const groups = lead === 0 ? base.groups : base.groups.map((group) => ({ ...group, tasks: group.tasks.map(shift) }));
    const total = Math.max(base.totalDays + lead, todayDay + lead + 7);
    return { groups, originMs: base.originMs - lead * DAY_MS, totalDays: Math.ceil(total), todayDay: todayDay + lead };
  }, [base, now, todayLine, totalDays]);

  const [zoom, setZoom] = useState<Zoom | null>(null);
  // Weeks for a plan of a few months; a longer plan opens on months (the comp's two views).
  const shownZoom: Zoom = zoom ?? (model.totalDays > 120 ? 'months' : 'weeks');
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  // A long plan opens where today is (a little before it), not at its first day.
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const todayAt = model.todayDay === null ? null : model.todayDay / model.totalDays;
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null || todayAt === null) return;
    const track = canvas.scrollWidth - 260;
    if (track <= canvas.clientWidth - 260) return;
    canvas.scrollLeft = Math.max(0, todayAt * track - (canvas.clientWidth - 260) / 3);
  }, [todayAt, shownZoom]);

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

  const columns = weekLabels ? columnsOf(shownZoom, model.originMs, model.totalDays) : [];
  const todayPct = model.todayDay === null ? null : dayToPercent(model.todayDay, model.totalDays);
  const tasks = model.groups.flatMap((group) => group.tasks);
  const risky = tasks.filter((task) => atRisk(task, model.todayDay)).length;
  const milestones = tasks.filter((task) => task.milestone === true).length;
  const stats: { key: string; icon: LucideIcon; tone: keyof typeof STAT_TONE; value: number; label: string }[] = [
    { key: 'tasks', icon: ListChecks, tone: 'accent', value: tasks.length, label: t('ui:widgets.domain.ganttChart.stats.tasks', 'Total tasks') },
    { key: 'onTrack', icon: CircleCheckBig, tone: 'pos', value: tasks.length - risky - milestones, label: t('ui:widgets.domain.ganttChart.stats.onTrack', 'On track') },
    { key: 'atRisk', icon: TriangleAlert, tone: 'warn', value: risky, label: t('ui:widgets.domain.ganttChart.stats.atRisk', 'At risk') },
    { key: 'milestones', icon: Flag, tone: 'danger', value: milestones, label: t('ui:widgets.domain.ganttChart.stats.milestones', 'Milestones') },
  ];
  // A column never narrower than its date: the canvas scrolls sideways instead.
  const minColumn = shownZoom === 'weeks' ? 64 : 88;
  const segment = (on: boolean): string =>
    `rounded-[7px] px-3 py-1.5 text-[12.5px] font-bold focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent ${on ? 'bg-surface text-fg shadow-card' : 'text-fg-subtle hover:text-fg'}`;
  const toggle = (key: string) =>
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <div data-widget="gantt-chart" data-testid={testId} className="flex h-full flex-col gap-[18px] leading-[normal]">
      {(showStats || weekLabels) && (
        <div className="flex flex-wrap items-start gap-4">
          {showStats && (
            <div data-part="gantt-stats" className="grid min-w-0 flex-1 grid-cols-2 gap-4 xl:grid-cols-4">
              {stats.map((stat) => (
                <div key={stat.key} className="flex items-center gap-[13px] rounded-[14px] border border-border bg-surface px-[18px] py-4 shadow-card">
                  <span aria-hidden="true" className={`flex size-9 shrink-0 items-center justify-center rounded-[10px] ${STAT_TONE[stat.tone]}`}>
                    <stat.icon className="size-[18px]" />
                  </span>
                  <div>
                    <div className="font-mono text-[22px] font-semibold leading-none tracking-[-0.02em] text-fg tabular-nums">{fmt.number(stat.value)}</div>
                    <div className="mt-[3px] text-[12px] text-fg-muted">{stat.label}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
          {weekLabels && (
            <div role="group" aria-label={t('ui:widgets.domain.ganttChart.zoom', 'Timeline scale')} data-part="gantt-zoom" className="ms-auto flex gap-[3px] rounded-[9px] border border-border bg-surface-2 p-[3px]">
              <button type="button" aria-pressed={shownZoom === 'weeks'} className={segment(shownZoom === 'weeks')} onClick={() => setZoom('weeks')}>
                {t('ui:widgets.domain.ganttChart.weeks', 'Weeks')}
              </button>
              <button type="button" aria-pressed={shownZoom === 'months'} className={segment(shownZoom === 'months')} onClick={() => setZoom('months')}>
                {t('ui:widgets.domain.ganttChart.months', 'Months')}
              </button>
            </div>
          )}
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[16px] border border-border bg-surface shadow-card">
        {/*
          THE LTR ISLAND. `dir="ltr"` pins the label gutter physically left
          of the canvas and makes time flow left→right even inside an RTL page.
        */}
        <div ref={canvasRef} dir="ltr" data-testid="gantt-canvas" className="min-h-0 flex-1 overflow-auto">
          <div className="min-w-[var(--adm-gantt-min)]" style={{ '--adm-gantt-min': `${String(260 + columns.length * minColumn)}px` }}>
            {weekLabels && (
              <div className="sticky top-0 z-10 flex border-b border-border bg-surface">
                <div className="sticky start-0 z-[3] w-[260px] shrink-0 border-e border-border bg-surface px-[18px] py-[13px] text-[11px] font-bold uppercase tracking-[.05em] text-fg-subtle">
                  {t('ui:widgets.domain.ganttChart.taskColumn', 'Task')}
                </div>
                <div className="relative flex flex-1">
                  {columns.map((column) => (
                    <div
                      key={column.ms}
                      data-testid="gantt-week-tick"
                      className="min-w-0 basis-0 border-s border-border py-[13px] text-center text-[10.5px] font-bold text-fg-subtle grow-[var(--adm-days)]"
                      style={{ '--adm-days': String(column.days) }}
                    >
                      <MonoText className="tabular-nums">{shownZoom === 'weeks' ? fmtAxisDate(tag, column.ms) : fmtAxisMonth(tag, column.ms)}</MonoText>
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
                columns={columns}
                todayPct={todayPct}
                collapsed={collapsed.has(group.key)}
                onToggle={() => toggle(group.key)}
                locale={tag}
                formatPercent={(pct) => fmt.percent(pct / 100)}
                countLabel={t('ui:widgets.domain.ganttChart.taskCount', '{count, plural, one {# task} other {# tasks}}', { count: group.tasks.length })}
                onTaskOpen={onTaskOpen}
              />
            ))}
          </div>
        </div>

        {showLegend && (
          <div className="flex flex-wrap items-center gap-x-[18px] gap-y-2.5 border-t border-border bg-surface-2 px-[18px] py-3.5">
            {model.groups.map((group) => (
              <span key={group.key} className="flex items-center gap-[7px] text-[11.5px] font-semibold text-fg-muted">
                <span className={`size-[11px] shrink-0 rounded-[4px] ${TONE_SOLID_BG[toneOf(group.tone)]}`} aria-hidden="true" />
                {group.name}
              </span>
            ))}
            {todayPct === null ? null : (
              <span className="ms-auto flex items-center gap-[7px] text-[11.5px] font-semibold text-fg-muted">
                <span aria-hidden="true" className="h-[13px] w-0.5 rounded-[2px] bg-danger" />
                {t('ui:widgets.domain.ganttChart.today', 'Today')}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** The week (or month) lines behind a row, and the line at today. */
function RowGrid({ columns, totalDays, todayPct }: { columns: { ms: number; startDay: number }[]; totalDays: number; todayPct: number | null }) {
  return (
    <>
      {columns.map((column) =>
        column.startDay === 0 ? null : (
          <span
            key={column.ms}
            aria-hidden="true"
            className="absolute inset-y-0 start-[var(--adm-at)] w-px bg-border"
            style={{ '--adm-at': `${String(dayToPercent(column.startDay, totalDays))}%` }}
          />
        ),
      )}
      {todayPct === null ? null : (
        <span
          aria-hidden="true"
          data-testid="gantt-today-line"
          className="absolute inset-y-0 start-[var(--adm-today)] z-[2] w-0.5 bg-danger opacity-55"
          style={{ '--adm-today': `${String(todayPct)}%` }}
        />
      )}
    </>
  );
}

interface GanttGroupRowsProps {
  group: GanttGroup;
  model: GanttModel;
  columns: { ms: number; startDay: number }[];
  todayPct: number | null;
  collapsed: boolean;
  onToggle: () => void;
  locale: string;
  formatPercent: (pct: number) => string;
  countLabel: string;
  onTaskOpen: ((taskId: string) => void) | undefined;
}

function GanttGroupRows({ group, model, columns, todayPct, collapsed, onToggle, locale, formatPercent, countLabel, onTaskOpen }: GanttGroupRowsProps) {
  const tone = toneOf(group.tone);
  const span = groupSpan(group);
  const Chevron = collapsed ? ChevronRight : ChevronDown;
  return (
    <div data-testid={`gantt-group-${group.key}`} role="group" aria-label={group.name}>
      <div className="flex min-h-[42px] border-b border-border bg-surface-2">
        <button
          type="button"
          aria-expanded={!collapsed}
          onClick={onToggle}
          className="sticky start-0 z-[3] flex w-[260px] shrink-0 items-center gap-[9px] border-e border-border bg-surface-2 px-[18px] text-start focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
        >
          <Chevron aria-hidden="true" className="size-[15px] shrink-0 text-fg-subtle" />
          <span aria-hidden="true" className={`size-[9px] shrink-0 rounded-[3px] ${TONE_SOLID_BG[tone]}`} />
          <span className="min-w-0 truncate text-[13px] font-extrabold tracking-[-0.01em] text-fg">{group.name}</span>
          <MonoText className="shrink-0 text-[10.5px] font-semibold text-fg-subtle">{countLabel}</MonoText>
        </button>
        <div className="relative flex-1">
          <RowGrid columns={columns} totalDays={model.totalDays} todayPct={todayPct} />
          <span
            aria-hidden="true"
            data-part="gantt-summary"
            className={`absolute top-1/2 start-[var(--adm-at)] h-[5px] w-[var(--adm-w)] -translate-y-1/2 rounded-[4px] ${SUMMARY[tone]}`}
            style={{ '--adm-at': `${String(dayToPercent(span.startDay, model.totalDays))}%`, '--adm-w': `${String(daysToPercent(span.startDay, span.durDays, model.totalDays))}%` }}
          />
        </div>
      </div>
      {!collapsed &&
        group.tasks.map((task) => (
          <GanttTaskRow key={task.id} task={task} tone={tone} model={model} columns={columns} todayPct={todayPct} locale={locale} formatPercent={formatPercent} onTaskOpen={onTaskOpen} />
        ))}
    </div>
  );
}

function GanttTaskRow({
  task,
  tone,
  model,
  columns,
  todayPct,
  locale,
  formatPercent,
  onTaskOpen,
}: {
  task: GanttTask;
  tone: Tone;
  model: GanttModel;
  columns: { ms: number; startDay: number }[];
  todayPct: number | null;
  locale: string;
  formatPercent: (pct: number) => string;
  onTaskOpen: ((taskId: string) => void) | undefined;
}) {
  const left = dayToPercent(task.startDay, model.totalDays);
  const width = daysToPercent(task.startDay, task.durDays, model.totalDays);
  const pct = Math.round(task.pct);
  const label = `${task.label} · ${formatPercent(task.pct)}`;
  return (
    <div className="flex h-[46px] border-b border-border transition-colors hover:bg-surface-2">
      <div className="sticky start-0 z-[3] flex w-[260px] shrink-0 items-center gap-2.5 border-e border-border bg-surface pe-[18px] ps-10">
        <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-fg" title={task.label}>
          {task.label}
        </span>
        {task.owner === undefined ? null : <Avatar name={task.owner} size="sm" locale={locale} title={task.owner} className="size-[22px] text-[9px]" />}
      </div>
      <div className="relative flex-1">
        <RowGrid columns={columns} totalDays={model.totalDays} todayPct={todayPct} />
        {task.milestone === true ? (
          <button
            type="button"
            aria-label={task.label}
            title={task.label}
            data-testid={`gantt-milestone-${task.id}`}
            disabled={onTaskOpen === undefined}
            onClick={() => onTaskOpen?.(task.id)}
            className={`absolute top-1/2 start-[var(--adm-at)] z-[2] size-[15px] -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[3px] border-2 border-surface ${TONE_SOLID_BG[tone]}`}
            style={{ '--adm-at': `${String(left)}%` }}
          />
        ) : (
          <button
            type="button"
            aria-label={label}
            title={label}
            data-testid={`gantt-task-${task.id}`}
            data-start-pct={String(left)}
            disabled={onTaskOpen === undefined}
            onClick={() => onTaskOpen?.(task.id)}
            className={`absolute top-1/2 start-[var(--adm-at)] z-[1] flex h-[22px] w-[var(--adm-w)] min-w-1.5 -translate-y-1/2 items-center overflow-hidden rounded-[7px] border transition-[filter] hover:brightness-105 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent ${TINT[tone]} ${onTaskOpen === undefined ? 'cursor-default' : 'cursor-pointer'}`}
            style={{ '--adm-at': `${String(left)}%`, '--adm-w': `${String(width)}%` }}
          >
            {pct > 0 ? (
              <MonoText className="whitespace-nowrap ps-2 text-[10px] font-semibold text-fg-muted">{formatPercent(task.pct)}</MonoText>
            ) : null}
            {/* The fill, over the label, carries the label again in the light colour: where the fill
                reaches, the words are light on it; past it, muted on the tint. Which part covers the
                words depends on the bar's width in pixels, so no single colour by percent can be right. */}
            <span
              aria-hidden="true"
              className={`absolute inset-y-0 start-0 z-[1] flex w-[var(--adm-pct)] items-center overflow-hidden ${TONE_SOLID_BG[tone]}`}
              style={{ '--adm-pct': `${String(pct)}%` }}
            >
              {pct > 0 ? <MonoText className="whitespace-nowrap ps-2 text-[10px] font-semibold text-surface">{formatPercent(task.pct)}</MonoText> : null}
            </span>
          </button>
        )}
      </div>
    </div>
  );
}

function fieldsOf(config: GanttChartConfig): GanttFieldMap {
  return {
    idField: config.idField,
    labelField: config.labelField,
    startField: config.startField,
    endField: config.endField,
    progressField: config.progressField,
    phaseField: config.phaseField,
    ownerField: config.ownerField,
    ...(config.ownerFields === undefined ? {} : { ownerFields: config.ownerFields }),
    ...(config.phaseLabelField === undefined ? {} : { phaseLabelField: config.phaseLabelField }),
    milestoneField: config.milestoneField,
  };
}

export function GanttChartWidget({ config, data, onEvent }: WidgetProps<GanttChartConfig>) {
  const fields = useMemo(() => fieldsOf(config), [config]);
  const source = bindingSourceOf(config.binding as Parameters<typeof bindingSourceOf>[0]);
  return (
    <GanttChart
      data={data}
      fields={fields}
      {...(config.totalDays === undefined ? {} : { totalDays: config.totalDays })}
      todayLine={config.todayLine}
      {...(config.format?.referenceTime === undefined ? {} : { todayMs: config.format.referenceTime })}
      weekLabels={config.weekLabels}
      showLegend={config.showLegend}
      showStats={config.showStats}
      {...(config.phaseColors === undefined ? {} : { phaseColors: config.phaseColors })}
      {...(config.ungroupedLabel === undefined ? {} : { ungroupedLabel: config.ungroupedLabel })}
      {...(config.format?.locale === undefined ? {} : { locale: config.format.locale })}
      {...(config.emptyTitle === undefined ? {} : { emptyTitle: config.emptyTitle })}
      {...(config.emptyBody === undefined ? {} : { emptyBody: config.emptyBody })}
      // A bar opens its record (the comp's task), where the chart is bound to a table.
      {...(source === null ? {} : { onTaskOpen: (taskId: string) => void onEvent({ type: 'record-open', connectionId: source.connectionId, table: source.table, recordId: taskId }) })}
    />
  );
}
