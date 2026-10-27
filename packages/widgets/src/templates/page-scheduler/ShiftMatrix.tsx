// SPDX-License-Identifier: AGPL-3.0-only
/**
 * ShiftMatrix — the INTERACTIVE resource × day scheduling grid the
 * `page-scheduler` template mounts for `schedule-matrix` items, drawn as the
 * Shift Scheduler comp: the week's four figures, then one card — day headers
 * with their coverage, a row a person (name, role, hours), a cell a day with
 * its shift chips (type and times), and the legend at its foot.
 *
 * The family's `ScheduleMatrix` is display-only; the comp's defect the note
 * calls out ("the add-shift modal must write into the grid") is exactly the
 * missing write path. This component owns it:
 *
 * - **click-to-cycle**: clicking a shift chip advances its type through the
 *   shift-type order — and past the last type REMOVES the shift — emitting the
 *   update/delete through `onCycle`; the change applies optimistically and
 *   rolls back when the returned promise rejects (the boards-family
 *   optimistic-move contract).
 * - **click-to-add**: an empty slot in a cell (cap `maxPerCell`, default 2)
 *   shows a quiet "+" that inserts a first-type shift via `onAdd`.
 * - coverage micro-bars per day flag zero-coverage in danger tone (annex); a
 * shift-type legend closes the grid.
 *
 * Anatomy mirrors the family's ScheduleMatrix (single logical CSS grid,
 * mirrors under RTL; tone tokens only) so the two render identically — this
 * one just accepts clicks.
 */
import { getFormatters } from '@adminium/i18n';
import { useMaybeT } from '../../lib/i18n.js';
import { Avatar, MonoText } from '@adminium/ui';
import type { Tone } from '@adminium/ui';
import { CalendarCheck, CircleAlert, Clock, Plus, Users, type LucideIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { TONE_SOLID_BG, fmtColumnDay, fmtMonthDay, parseIsoDay, resolveLocale } from '../../families/calendar/calendar-lib.js';

/** A chip's tint and its edge, by its type's tone (the comp: 12% of the colour, a 3px edge of it). */
const CHIP_TONE: Record<Tone, string> = {
  neutral: 'border-fg-subtle bg-surface-2',
  accent: 'border-accent bg-accent-soft',
  pos: 'border-pos bg-pos-soft',
  warn: 'border-warn bg-warn-soft',
  danger: 'border-danger bg-danger-soft',
  info: 'border-info bg-info-soft',
};
const STAT_TONE: Record<'accent' | 'pos' | 'warn' | 'danger', string> = {
  accent: 'bg-accent-soft text-accent',
  pos: 'bg-pos-soft text-pos',
  warn: 'bg-warn-soft text-warn',
  danger: 'bg-danger-soft text-danger',
};

export interface ShiftTypeDef {
  id: string;
  label: string;
  tone: Tone;
}

export interface ShiftResource {
  id: string;
  label: string;
  role?: string | undefined;
}

export interface ShiftCell {
  /** Record id of the shift row — the PATCH/DELETE target. */
  recordId: string;
  resourceId: string;
  /** `YYYY-MM-DD`. */
  date: string;
  typeId: string;
  /** `HH:MM` the shift starts and ends, where the table keeps times. */
  start?: string | undefined;
  end?: string | undefined;
  /** How long it runs, where both ends are known. */
  minutes?: number | undefined;
}

export interface ShiftMatrixLabels {
  resource?: string | undefined;
  coverage?: string | undefined;
  addShift?: string | undefined;
  /** `{n}` substituted with the per-resource shift count. */
  shiftCount?: string | undefined;
}

export interface ShiftMatrixProps {
  resources: readonly ShiftResource[];
  /** Ordered `YYYY-MM-DD` day columns. */
  days: readonly string[];
  types: readonly ShiftTypeDef[];
  shifts: readonly ShiftCell[];
  maxPerCell?: number | undefined;
  targetCoverage?: number | undefined;
  showCoverage?: boolean | undefined;
  showLegend?: boolean | undefined;
  /** The week's four figures above the grid (the comp's summary cards). */
  showStats?: boolean | undefined;
  /** False renders the read-only grid (demo mode / no binding). */
  canEdit?: boolean | undefined;
  locale?: string | undefined;
  labels?: ShiftMatrixLabels | undefined;
  /** Cycle a shift to `nextTypeId` (null ⇒ remove). Return the mutate promise
   *  to opt into rollback-on-rejection. */
  onCycle?: ((shift: ShiftCell, nextTypeId: string | null) => void | Promise<unknown>) | undefined;
  /** Insert a new first-type shift into an open slot. */
  onAdd?: ((resourceId: string, date: string, typeId: string) => void | Promise<unknown>) | undefined;
  /**
   * An open slot was chosen: the host asks for the shift's times and type
   * (the comp's "Add shift" form) instead of adding one at once. Given, it
   * wins over `onAdd`.
   */
  onAddAt?: ((resourceId: string, date: string) => void) | undefined;
  testId?: string | undefined;
}

/** The optimistic override a pending cycle applies: a new type, or removal. */
type Override = { typeId: string } | { removed: true };

export function ShiftMatrix({
  resources,
  days,
  types,
  shifts,
  maxPerCell = 2,
  targetCoverage,
  showCoverage = true,
  showLegend = true,
  showStats = false,
  canEdit = true,
  locale,
  labels,
  onCycle,
  onAdd,
  onAddAt,
  testId,
}: ShiftMatrixProps) {
  const t = useMaybeT();
  const tag = resolveLocale(locale);
  const fmt = getFormatters(tag);
  const [overrides, setOverrides] = useState<Record<string, Override>>({});

  // Reconcile optimistic overrides against fresh server data: once the
  // incoming shift reaches its override target (or disappears after a remove)
  // the override is dropped so it can never mask later refetches — the
  // boards-family `useBoardMoves` reconcile rule.
  useEffect(() => {
    setOverrides((previous) => {
      const ids = Object.keys(previous);
      if (ids.length === 0) return previous;
      const byId = new Map(shifts.map((shift) => [shift.recordId, shift]));
      let changed = false;
      const next = { ...previous };
      for (const id of ids) {
        const override = previous[id] as Override;
        const shift = byId.get(id);
        const settled =
          'removed' in override ? shift === undefined : shift !== undefined && shift.typeId === override.typeId;
        if (settled || shift === undefined) {
          delete next[id];
          changed = true;
        }
      }
      return changed ? next : previous;
    });
  }, [shifts]);

  const typeById = useMemo(() => new Map(types.map((type) => [type.id, type])), [types]);

  /** Shifts with optimistic overrides applied, removed ones dropped. */
  const settledShifts = useMemo(() => {
    const out: ShiftCell[] = [];
    for (const shift of shifts) {
      const override = overrides[shift.recordId];
      if (override === undefined) out.push(shift);
      else if (!('removed' in override)) out.push({ ...shift, typeId: override.typeId });
    }
    return out;
  }, [shifts, overrides]);

  const cellIndex = useMemo(() => {
    const map = new Map<string, ShiftCell[]>();
    for (const shift of settledShifts) {
      const key = `${shift.resourceId}|${shift.date}`;
      const list = map.get(key);
      if (list === undefined) map.set(key, [shift]);
      else list.push(shift);
    }
    return map;
  }, [settledShifts]);

  // The week's own shifts: what the figures, the hours and the coverage count.
  const weekShifts = useMemo(() => settledShifts.filter((shift) => days.includes(shift.date)), [settledShifts, days]);
  const countByResource = useMemo(() => {
    const map = new Map<string, number>();
    for (const shift of weekShifts) map.set(shift.resourceId, (map.get(shift.resourceId) ?? 0) + 1);
    return map;
  }, [weekShifts]);
  const minutesByResource = useMemo(() => {
    const map = new Map<string, number>();
    for (const shift of weekShifts) if (shift.minutes !== undefined) map.set(shift.resourceId, (map.get(shift.resourceId) ?? 0) + shift.minutes);
    return map;
  }, [weekShifts]);
  const timed = weekShifts.some((shift) => shift.minutes !== undefined);

  const coverageByDay = useMemo(() => {
    const map = new Map<string, number>();
    for (const day of days) map.set(day, 0);
    for (const shift of weekShifts) map.set(shift.date, (map.get(shift.date) ?? 0) + 1);
    return map;
  }, [weekShifts, days]);

  const cycle = (shift: ShiftCell) => {
    if (onCycle === undefined) return;
    const index = types.findIndex((type) => type.id === shift.typeId);
    const next = index >= 0 && index < types.length - 1 ? (types[index + 1] as ShiftTypeDef).id : null;
    setOverrides((previous) => ({
      ...previous,
      [shift.recordId]: next === null ? { removed: true } : { typeId: next },
    }));
    const result = onCycle(shift, next);
    if (result && typeof (result as Promise<unknown>).then === 'function') {
      (result as Promise<unknown>).then(undefined, () => {
        setOverrides((previous) => {
          const rolled = { ...previous };
          delete rolled[shift.recordId];
          return rolled;
        });
      });
    }
  };

  const target = targetCoverage ?? Math.max(1, Math.ceil(resources.length / 2));
  const firstType = types[0];
  const hoursOf = (minutes: number): string => fmt.number(minutes / 60, { maximumFractionDigits: 1 });
  const addLabel = labels?.addShift ?? t('ui:templates.scheduler.addShift', 'Add shift');

  const stats: { key: string; icon: LucideIcon; tone: keyof typeof STAT_TONE; value: string; label: string }[] = [
    { key: 'staff', icon: Users, tone: 'accent', value: fmt.number(countByResource.size), label: t('ui:templates.scheduler.stats.staff', 'Scheduled staff') },
    { key: 'shifts', icon: CalendarCheck, tone: 'pos', value: fmt.number(weekShifts.length), label: t('ui:templates.scheduler.stats.shifts', 'Total shifts') },
    ...(timed
      ? [{ key: 'hours', icon: Clock, tone: 'warn' as const, value: hoursOf(weekShifts.reduce((sum, shift) => sum + (shift.minutes ?? 0), 0)), label: t('ui:templates.scheduler.stats.hours', 'Scheduled hours') }]
      : []),
    { key: 'uncovered', icon: CircleAlert, tone: 'danger', value: fmt.number([...coverageByDay.values()].filter((count) => count === 0).length), label: t('ui:templates.scheduler.stats.uncovered', 'Uncovered days') },
  ];

  return (
    <div data-part="shift-matrix" data-testid={testId} className="flex h-full flex-col gap-[18px] overflow-auto leading-[normal]">
      {showStats && (
        <div data-part="shift-stats" className={`grid shrink-0 grid-cols-2 gap-4 ${stats.length === 4 ? 'xl:grid-cols-4' : 'xl:grid-cols-3'}`}>
          {stats.map((stat) => (
            <div key={stat.key} className="flex items-center gap-[13px] rounded-[14px] border border-border bg-surface px-[18px] py-4 shadow-card">
              <span aria-hidden="true" className={`flex size-9 shrink-0 items-center justify-center rounded-[10px] ${STAT_TONE[stat.tone]}`}>
                <stat.icon className="size-[18px]" />
              </span>
              <div>
                <div className="font-mono text-[22px] font-semibold leading-none tracking-[-0.02em] text-fg tabular-nums">{stat.value}</div>
                <div className="mt-[3px] text-[12px] text-fg-muted">{stat.label}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="shrink-0 overflow-hidden rounded-[16px] border border-border bg-surface shadow-card">
        <div role="table" className="min-w-[760px]">
          <div role="row" className="flex border-b border-border bg-surface-2">
            <span role="columnheader" className="w-[200px] shrink-0 border-e border-border px-[18px] py-[13px] text-[11px] font-bold uppercase tracking-[.05em] text-fg-subtle">
              {labels?.resource ?? t('ui:templates.scheduler.teamMember', 'Team member')}
            </span>
            {days.map((day) => {
              const label = fmtColumnDay(tag, parseIsoDay(day));
              const count = coverageByDay.get(day) ?? 0;
              const pct = Math.min(100, Math.round((count / Math.max(1, resources.length)) * 100));
              return (
                <div key={day} role="columnheader" className="min-w-0 flex-1 border-s border-border px-3 py-2.5 text-center">
                  <div className="text-[12px] font-bold text-fg">{label.weekday}</div>
                  <MonoText className="text-[10.5px] text-fg-subtle">{fmtMonthDay(tag, day)}</MonoText>
                  {showCoverage && (
                    <div
                      data-part="coverage-day"
                      data-tone={count === 0 ? 'danger' : count >= target ? 'pos' : 'warn'}
                      title={labels?.coverage ?? t('ui:widgets.calendar.scheduleMatrix.coverageLabel', 'Coverage')}
                      className="mt-1.5 flex items-center justify-center gap-[5px]"
                    >
                      <div className="h-1 max-w-[60px] flex-1 overflow-hidden rounded-[3px] bg-surface-3">
                        <div className={`h-full w-[var(--cov)] rounded-[3px] ${count === 0 ? 'bg-danger' : 'bg-accent'}`} style={{ '--cov': `${pct}%` }} />
                      </div>
                      <span className="text-[9.5px] font-bold tabular-nums text-fg-subtle">{fmt.number(count)}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {resources.map((resource) => {
            const minutes = minutesByResource.get(resource.id);
            const count = countByResource.get(resource.id) ?? 0;
            return (
              <div key={resource.id} role="row" className="flex border-b border-border">
                <div role="rowheader" className="flex w-[200px] shrink-0 items-center gap-[11px] border-e border-border px-[18px] py-3">
                  {/* aria-hidden: the avatar's aria-label otherwise repeats the name beside it. */}
                  <Avatar name={resource.label} size="md" locale={tag} aria-hidden="true" className="size-[30px] text-[12px]" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-bold text-fg">{resource.label}</p>
                    <p className="truncate text-[11px] text-fg-subtle">
                      {resource.role ??
                        (labels?.shiftCount !== undefined
                          ? labels.shiftCount.replace('{n}', fmt.number(count))
                          : t('ui:templates.scheduler.shiftCount', '{count, plural, one {{n} shift} other {{n} shifts}}', { count, n: fmt.number(count) }))}
                    </p>
                  </div>
                  {timed && (
                    <div className="text-end">
                      <MonoText className="block text-[12.5px] font-semibold tabular-nums text-fg">{hoursOf(minutes ?? 0)}</MonoText>
                      <span className="text-[9.5px] text-fg-subtle">{t('ui:templates.scheduler.hoursUnit', 'hrs')}</span>
                    </div>
                  )}
                </div>
                {days.map((day) => {
                  const cell = cellIndex.get(`${resource.id}|${day}`) ?? [];
                  const shown = cell.slice(0, maxPerCell);
                  const canAdd = canEdit && firstType !== undefined && cell.length < maxPerCell && (onAddAt !== undefined || onAdd !== undefined);
                  const add = () => {
                    if (onAddAt !== undefined) onAddAt(resource.id, day);
                    else void onAdd?.(resource.id, day, (firstType as ShiftTypeDef).id);
                  };
                  return (
                    <div key={day} role="cell" data-part="shift-cell" className="group flex min-h-[74px] min-w-0 flex-1 flex-col gap-[5px] border-s border-border p-[7px] transition-colors hover:bg-surface-2">
                      {shown.map((shift) => {
                        const type = typeById.get(shift.typeId);
                        const tone = type?.tone ?? 'accent';
                        const label = type?.label ?? shift.typeId;
                        const time = shift.start === undefined ? undefined : shift.end === undefined ? shift.start : `${shift.start}–${shift.end}`;
                        const inner = (
                          <>
                            <span className="flex min-w-0 items-center gap-[5px]">
                              <span aria-hidden="true" className={`size-2 shrink-0 rounded-[3px] ${TONE_SOLID_BG[tone]}`} />
                              <span className="truncate text-[11px] font-bold text-fg">{label}</span>
                            </span>
                            {time === undefined ? null : <MonoText className="mt-0.5 block truncate text-[10px] text-fg-muted">{time}</MonoText>}
                          </>
                        );
                        const chip = `block w-full animate-[nb-pop_.16s_ease] rounded-[7px] border-s-[3px] px-2 py-1.5 text-start hover:brightness-[1.04] ${CHIP_TONE[tone]}`;
                        return canEdit && onCycle !== undefined ? (
                          <button
                            key={shift.recordId}
                            type="button"
                            data-part="shift-chip"
                            data-shift={shift.recordId}
                            title={time === undefined ? label : `${label} · ${time}`}
                            onClick={() => cycle(shift)}
                            className={`${chip} focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-accent`}
                          >
                            {inner}
                          </button>
                        ) : (
                          <span key={shift.recordId} data-part="shift-chip" title={time === undefined ? label : `${label} · ${time}`} className={chip}>
                            {inner}
                          </span>
                        );
                      })}
                      {cell.length > maxPerCell && <span className="text-[10px] font-semibold text-fg-subtle">+{fmt.number(cell.length - maxPerCell)}</span>}
                      {canAdd && (
                        <button
                          type="button"
                          data-part="shift-add"
                          aria-label={`${addLabel}: ${resource.label}, ${day}`}
                          onClick={add}
                          className={`${cell.length === 0 ? 'flex-1' : 'min-h-5'} flex items-center justify-center rounded-[6px] text-fg-subtle opacity-0 transition-opacity hover:text-fg focus-visible:opacity-100 focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-accent group-hover:opacity-100`}
                        >
                          <Plus className="size-4" aria-hidden="true" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>

        {showLegend && types.length > 0 && (
          <div data-part="shift-legend" className="flex flex-wrap gap-x-[18px] gap-y-2.5 bg-surface-2 px-[18px] py-3.5">
            {types.map((type) => (
              <span key={type.id} className="flex items-center gap-[7px] text-[11.5px] font-semibold text-fg-muted">
                <span className={`size-[11px] shrink-0 rounded-[4px] ${TONE_SOLID_BG[type.tone]}`} aria-hidden="true" />
                {type.label}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
