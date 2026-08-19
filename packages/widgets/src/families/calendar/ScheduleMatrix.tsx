// SPDX-License-Identifier: AGPL-3.0-only
import { getFormatters } from '@adminium/i18n';
import { useMaybeT } from '@adminium/i18n/react';
import { Avatar, EmptyState, MonoText } from '@adminium/ui';
import type { Tone } from '@adminium/ui';
import { useMemo } from 'react';

import {
  TONE_SOFT_BORDER,
  TONE_SOLID_BG,
  fmtColumnDay,
  parseIsoDay,
  resolveLocale,
  toneOf,
} from './calendar-lib.js';
import type { ScheduleMatrixConfig } from './calendar-config.js';
import type {
  ScheduleAssignment,
  ScheduleMatrixData,
  ScheduleResource,
  ScheduleShiftType,
} from './calendar-types.js';
import type { WidgetProps } from '../../registry/types.js';

// Config schema + deterministic demo payload live in the pure `calendar-config`
// module so the registry metadata graph never reaches this component file
// (04 §2.3). Re-exported here to keep existing import points stable.
export { scheduleMatrixConfigSchema, scheduleMatrixDemoData } from './calendar-config.js';
export type { ScheduleMatrixConfig } from './calendar-config.js';

/**
 * `schedule-matrix` (annex §5) — the resource-scheduling grid: rows = people
 * (avatar, role, total hours), columns = days, cells hold up to N type-colored
 * shift chips, with per-day coverage micro-bars (danger at zero) and a shift-type
 * legend strip. The first (resource) column and the day columns are a single
 * logical CSS grid that mirrors under `dir="rtl"`. Binds to a `record-list` of
 * resources plus an assignments matrix + shift-type metadata.
 */

/**
 * Reorder a week's day columns so the first column is the given ISO weekday
 * (1 = Mon … 7 = Sun). Rotation preserves the run of consecutive days; the
 * days that fall before the chosen start wrap to the end (Monday-first, etc.).
 */
export function orderDaysByWeekStart(days: readonly string[], weekStart?: number | undefined): readonly string[] {
  if (weekStart === undefined || days.length === 0) return days;
  const isoWeekday = (iso: string): number => ((parseIsoDay(iso).getUTCDay() + 6) % 7) + 1;
  const start = days.findIndex((day) => isoWeekday(day) === weekStart);
  if (start <= 0) return days;
  return [...days.slice(start), ...days.slice(0, start)];
}

export interface ScheduleMatrixProps {
  data: ScheduleMatrixData;
  /** Force the first weekday column (ISO 1 = Mon … 7 = Sun); else server order. */
  weekStart?: number | undefined;
  maxPerCell?: number | undefined;
  targetCoverage?: number | undefined;
  showCoverage?: boolean | undefined;
  showLegend?: boolean | undefined;
  locale?: string | undefined;
  emptyTitle?: string | undefined;
  emptyBody?: string | undefined;
  testId?: string | undefined;
}

function keyOf(resourceId: string, date: string): string {
  return `${resourceId}|${date}`;
}

export function ScheduleMatrix({
  data,
  weekStart,
  maxPerCell = 2,
  targetCoverage,
  showCoverage = true,
  showLegend = true,
  locale,
  emptyTitle,
  emptyBody,
  testId,
}: ScheduleMatrixProps) {
  const t = useMaybeT();
  const tag = resolveLocale(locale);
  const fmt = getFormatters(tag);
  const { rows: resources, shiftTypes, assignments } = data;
  const days = useMemo(() => orderDaysByWeekStart(data.days, weekStart), [data.days, weekStart]);

  const typeById = useMemo(() => {
    const map = new Map<string, ScheduleShiftType>();
    for (const type of shiftTypes) map.set(type.id, type);
    return map;
  }, [shiftTypes]);

  const cellIndex = useMemo(() => {
    const map = new Map<string, ScheduleAssignment[]>();
    for (const assignment of assignments) {
      const key = keyOf(assignment.resourceId, assignment.date);
      const list = map.get(key);
      if (list === undefined) map.set(key, [assignment]);
      else list.push(assignment);
    }
    return map;
  }, [assignments]);

  const hoursByResource = useMemo(() => {
    const map = new Map<string, number>();
    for (const assignment of assignments) {
      const hours = typeById.get(assignment.typeId)?.hours ?? 0;
      map.set(assignment.resourceId, (map.get(assignment.resourceId) ?? 0) + hours);
    }
    return map;
  }, [assignments, typeById]);

  const coverageByDay = useMemo(() => {
    const map = new Map<string, number>();
    for (const day of days) map.set(day, 0);
    for (const assignment of assignments) {
      if (map.has(assignment.date)) map.set(assignment.date, (map.get(assignment.date) ?? 0) + 1);
    }
    return map;
  }, [assignments, days]);

  if (resources.length === 0 || days.length === 0) {
    return (
      <EmptyState
        compact
        preset="nothing-scheduled"
        title={emptyTitle ?? t('ui:widgets.calendar.scheduleMatrix.emptyTitle', 'No shifts scheduled')}
        body={emptyBody ?? t('ui:widgets.calendar.scheduleMatrix.emptyBody', 'Assigned shifts will appear on this schedule.')}
      />
    );
  }

  const target = targetCoverage ?? Math.max(1, Math.ceil(resources.length / 2));
  const gridCols = `minmax(9rem,1.4fr) repeat(${days.length}, minmax(4.5rem,1fr))`;

  return (
    <div data-widget="schedule-matrix" data-testid={testId} className="flex h-full flex-col overflow-auto">
      <div role="table" className="min-w-full">
        <div
          role="row"
          className="sticky top-0 z-[1] grid items-end gap-1 border-b border-border bg-surface-2 px-2 py-2 grid-cols-[var(--adm-cols)]"
          style={{ '--adm-cols': gridCols }}
        >
          {/*
            `role="table"` makes this a real table to AT, and a table's rows must
            contain header/cell roles — a bare <span> in column 1 left the row
            with a missing required child, which is what axe reports and what
            makes the first column announce as nothing.
          */}
          <span role="columnheader" className="text-caption font-bold uppercase tracking-wide text-fg-subtle">
            {t('ui:widgets.calendar.scheduleMatrix.resourceLabel', 'Resource')}
          </span>
          {days.map((day) => {
            const label = fmtColumnDay(tag, parseIsoDay(day));
            return (
              <div key={day} role="columnheader" className="text-center">
                <div className="text-caption font-bold uppercase tracking-wide text-fg-subtle">{label.weekday}</div>
                <MonoText className="text-caption tabular-nums text-fg-muted">{label.day}</MonoText>
              </div>
            );
          })}
        </div>

        {resources.map((resource) => (
          <div
            key={resource.id}
            role="row"
            className="grid items-stretch gap-1 border-b border-border/50 px-2 py-1.5 grid-cols-[var(--adm-cols)] hover:bg-surface-2/50"
            style={{ '--adm-cols': gridCols }}
          >
            <div role="rowheader" className="flex min-w-0 items-center gap-2">
              {/*
                aria-hidden, or the rowheader's name becomes "Ana Trujillo Ana
                Trujillo, Manager · 32h" — the avatar's own aria-label repeats the
                text beside it. Avatar spreads {...props} after its role/aria-label,
                so this lands.
              */}
              <Avatar name={resource.name} size="sm" locale={tag} aria-hidden="true" />
              <div className="min-w-0">
                <p className="truncate text-caption font-semibold text-fg">{resource.name}</p>
                <p className="truncate text-[10px] text-fg-subtle">
                  {resource.role} ·{' '}
                  <MonoText className="tabular-nums">
                    {t('ui:widgets.calendar.scheduleMatrix.hoursLabel', '{hours}h', {
                      hours: fmt.number(hoursByResource.get(resource.id) ?? 0),
                    })}
                  </MonoText>
                </p>
              </div>
            </div>
            {days.map((day) => {
              const cell = cellIndex.get(keyOf(resource.id, day)) ?? [];
              const shown = cell.slice(0, maxPerCell);
              const overflow = cell.length - shown.length;
              return (
                <div key={day} className="flex flex-col gap-0.5" role="cell">
                  {shown.map((assignment, i) => {
                    const type = typeById.get(assignment.typeId);
                    const tone = toneOf(type?.tone, 'accent');
                    return (
                      <span
                        key={i}
                        title={type === undefined ? assignment.typeId : `${type.label} · ${type.start}–${type.end}`}
                        className={`truncate rounded-e-sm border-s-2 px-1 py-px text-[10px] font-semibold leading-tight ${TONE_SOFT_BORDER[tone]}`}
                      >
                        {type?.label ?? assignment.typeId}
                      </span>
                    );
                  })}
                  {overflow > 0 && <span className="text-[10px] font-semibold text-fg-subtle">+{fmt.number(overflow)}</span>}
                </div>
              );
            })}
          </div>
        ))}

        {showCoverage && (
          <div
            role="row"
            className="grid items-center gap-1 border-t border-border bg-surface-2/40 px-2 py-2 grid-cols-[var(--adm-cols)]"
            style={{ '--adm-cols': gridCols }}
          >
            <span role="rowheader" className="text-caption font-bold uppercase tracking-wide text-fg-subtle">
              {t('ui:widgets.calendar.scheduleMatrix.coverageLabel', 'Coverage')}
            </span>
            {days.map((day) => {
              const count = coverageByDay.get(day) ?? 0;
              const pct = Math.min(100, Math.round((count / target) * 100));
              const tone: Tone = count === 0 ? 'danger' : count >= target ? 'pos' : 'warn';
              return (
                <div key={day} role="cell" className="flex flex-col items-center gap-1" title={`${count}/${target}`}>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-3">
                    <div className={`h-full w-[var(--cov)] rounded-full ${TONE_SOLID_BG[tone]}`} style={{ '--cov': `${pct}%` }} />
                  </div>
                  <MonoText className="text-[10px] tabular-nums text-fg-subtle">{fmt.number(count)}</MonoText>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {showLegend && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border px-3 py-2">
          {shiftTypes.map((type) => (
            <span key={type.id} className="flex items-center gap-1.5 text-caption text-fg-muted">
              <span className={`size-2 shrink-0 rounded-full ${TONE_SOLID_BG[toneOf(type.tone, 'accent')]}`} aria-hidden="true" />
              {type.label}
              <MonoText className="tabular-nums text-fg-subtle">{type.start}–{type.end}</MonoText>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** Tolerant read of the schedule `record-list` envelope. */
export function scheduleDataOf(data: unknown): ScheduleMatrixData {
  const source = (typeof data === 'object' && data !== null ? data : {}) as Partial<ScheduleMatrixData>;
  return {
    rows: Array.isArray(source.rows) ? (source.rows as ScheduleResource[]) : [],
    total: typeof source.total === 'number' ? source.total : (source.rows?.length ?? 0),
    days: Array.isArray(source.days) ? (source.days as string[]) : [],
    shiftTypes: Array.isArray(source.shiftTypes) ? (source.shiftTypes as ScheduleShiftType[]) : [],
    assignments: Array.isArray(source.assignments) ? (source.assignments as ScheduleAssignment[]) : [],
  };
}

export function ScheduleMatrixWidget({ config, data }: WidgetProps<ScheduleMatrixConfig>) {
  return (
    <ScheduleMatrix
      data={scheduleDataOf(data)}
      {...(config.weekStart === undefined ? {} : { weekStart: config.weekStart })}
      maxPerCell={config.maxPerCell}
      {...(config.targetCoverage === undefined ? {} : { targetCoverage: config.targetCoverage })}
      showCoverage={config.showCoverage}
      showLegend={config.showLegend}
      {...(config.format?.locale === undefined ? {} : { locale: config.format.locale })}
      {...(config.emptyTitle === undefined ? {} : { emptyTitle: config.emptyTitle })}
      {...(config.emptyBody === undefined ? {} : { emptyBody: config.emptyBody })}
    />
  );
}

