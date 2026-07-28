/**
 * ShiftMatrix — the INTERACTIVE resource × day scheduling grid the
 * `page-scheduler` template mounts for `schedule-matrix` items
 * (09-generated-app.md §7.6 "Shift scheduler").
 *
 * The family's `ScheduleMatrix` is display-only; the comp's defect the M7-T03
 * note calls out ("the add-shift modal must write into the grid") is exactly
 * the missing write path. This component owns it:
 *
 * - **click-to-cycle**: clicking a shift chip advances its type through the
 *   shift-type order — and past the last type REMOVES the shift — emitting the
 *   update/delete through `onCycle`; the change applies optimistically and
 *   rolls back when the returned promise rejects (the boards-family
 *   optimistic-move contract).
 * - **click-to-add**: an empty slot in a cell (cap `maxPerCell`, default 2)
 *   shows a quiet "+" that inserts a first-type shift via `onAdd`.
 * - coverage micro-bars per day flag zero-coverage in danger tone (annex §5);
 *   a shift-type legend closes the grid.
 *
 * Anatomy mirrors the family's ScheduleMatrix (single logical CSS grid,
 * mirrors under RTL; tone tokens only) so the two render identically — this
 * one just accepts clicks.
 */
import { getFormatters } from '@adminium/i18n';
import { useMaybeT } from '@adminium/i18n/react';
import { Avatar, MonoText } from '@adminium/ui';
import type { Tone } from '@adminium/ui';
import { Plus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import {
  TONE_SOFT_BORDER,
  TONE_SOLID_BG,
  fmtColumnDay,
  parseIsoDay,
  resolveLocale,
} from '../../families/calendar/calendar-lib.js';

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
  /** False renders the read-only grid (demo mode / no binding). */
  canEdit?: boolean | undefined;
  locale?: string | undefined;
  labels?: ShiftMatrixLabels | undefined;
  /** Cycle a shift to `nextTypeId` (null ⇒ remove). Return the mutate promise
   *  to opt into rollback-on-rejection. */
  onCycle?: ((shift: ShiftCell, nextTypeId: string | null) => void | Promise<unknown>) | undefined;
  /** Insert a new first-type shift into an open slot. */
  onAdd?: ((resourceId: string, date: string, typeId: string) => void | Promise<unknown>) | undefined;
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
  canEdit = true,
  locale,
  labels,
  onCycle,
  onAdd,
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

  const countByResource = useMemo(() => {
    const map = new Map<string, number>();
    for (const shift of settledShifts) {
      if (days.includes(shift.date)) map.set(shift.resourceId, (map.get(shift.resourceId) ?? 0) + 1);
    }
    return map;
  }, [settledShifts, days]);

  const coverageByDay = useMemo(() => {
    const map = new Map<string, number>();
    for (const day of days) map.set(day, 0);
    for (const shift of settledShifts) {
      if (map.has(shift.date)) map.set(shift.date, (map.get(shift.date) ?? 0) + 1);
    }
    return map;
  }, [settledShifts, days]);

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
  const gridCols = `minmax(9rem,1.4fr) repeat(${days.length}, minmax(4.5rem,1fr))`;
  const firstType = types[0];

  return (
    <div data-part="shift-matrix" data-testid={testId} className="flex h-full flex-col overflow-auto">
      <div role="table" className="min-w-full">
        <div
          role="row"
          className="sticky top-0 z-[1] grid items-end gap-1 border-b border-border bg-surface-2 px-2 py-2 grid-cols-[var(--adm-cols)]"
          style={{ '--adm-cols': gridCols }}
        >
          <span className="text-caption font-bold uppercase tracking-wide text-fg-subtle">
            {labels?.resource ?? t('ui:widgets.calendar.scheduleMatrix.resourceLabel', 'Resource')}
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
            <div className="flex min-w-0 items-center gap-2">
              <Avatar name={resource.label} size="sm" locale={tag} />
              <div className="min-w-0">
                <p className="truncate text-caption font-semibold text-fg">{resource.label}</p>
                <p className="truncate text-[10px] text-fg-subtle">
                  {resource.role !== undefined ? `${resource.role} · ` : ''}
                  {/* An explicit label keeps the documented `{n}`-replace contract; the
                      default is an ICU plural (`count` selects, `n` is pre-formatted). */}
                  {labels?.shiftCount !== undefined
                    ? labels.shiftCount.replace('{n}', fmt.number(countByResource.get(resource.id) ?? 0))
                    : t('ui:templates.scheduler.shiftCount', '{count, plural, one {{n} shift} other {{n} shifts}}', {
                        count: countByResource.get(resource.id) ?? 0,
                        n: fmt.number(countByResource.get(resource.id) ?? 0),
                      })}
                </p>
              </div>
            </div>
            {days.map((day) => {
              const cell = cellIndex.get(`${resource.id}|${day}`) ?? [];
              const shown = cell.slice(0, maxPerCell);
              const canAdd = canEdit && onAdd !== undefined && firstType !== undefined && cell.length < maxPerCell;
              return (
                <div key={day} role="cell" data-part="shift-cell" className="flex flex-col gap-0.5">
                  {shown.map((shift) => {
                    const type = typeById.get(shift.typeId);
                    const tone = type?.tone ?? 'accent';
                    const label = type?.label ?? shift.typeId;
                    return canEdit && onCycle !== undefined ? (
                      <button
                        key={shift.recordId}
                        type="button"
                        data-part="shift-chip"
                        data-shift={shift.recordId}
                        title={label}
                        onClick={() => cycle(shift)}
                        className={`truncate rounded-e-sm border-s-2 px-1 py-px text-start text-[10px] font-semibold leading-tight hover:brightness-110 focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-accent ${TONE_SOFT_BORDER[tone]}`}
                      >
                        {label}
                      </button>
                    ) : (
                      <span
                        key={shift.recordId}
                        data-part="shift-chip"
                        title={label}
                        className={`truncate rounded-e-sm border-s-2 px-1 py-px text-[10px] font-semibold leading-tight ${TONE_SOFT_BORDER[tone]}`}
                      >
                        {label}
                      </span>
                    );
                  })}
                  {cell.length > maxPerCell && (
                    <span className="text-[10px] font-semibold text-fg-subtle">
                      +{fmt.number(cell.length - maxPerCell)}
                    </span>
                  )}
                  {canAdd && (
                    <button
                      type="button"
                      data-part="shift-add"
                      aria-label={`${labels?.addShift ?? t('ui:templates.scheduler.addShift', 'Add shift')}: ${resource.label}, ${day}`}
                      onClick={() => void onAdd(resource.id, day, (firstType as ShiftTypeDef).id)}
                      className="flex min-h-4 items-center justify-center rounded-sm text-fg-subtle opacity-0 transition-opacity hover:bg-surface-2 hover:text-fg focus-visible:opacity-100 focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-accent group-hover:opacity-100 [&:hover]:opacity-100 [[role=row]:hover_&]:opacity-100"
                    >
                      <Plus className="size-3" aria-hidden="true" />
                    </button>
                  )}
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
            <span className="text-caption font-bold uppercase tracking-wide text-fg-subtle">
              {labels?.coverage ?? t('ui:widgets.calendar.scheduleMatrix.coverageLabel', 'Coverage')}
            </span>
            {days.map((day) => {
              const count = coverageByDay.get(day) ?? 0;
              const pct = Math.min(100, Math.round((count / target) * 100));
              const tone: Tone = count === 0 ? 'danger' : count >= target ? 'pos' : 'warn';
              return (
                <div
                  key={day}
                  data-part="coverage-day"
                  data-tone={tone}
                  className="flex flex-col items-center gap-1"
                  title={`${count}/${target}`}
                >
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

      {showLegend && types.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border px-3 py-2">
          {types.map((type) => (
            <span key={type.id} className="flex items-center gap-1.5 text-caption text-fg-muted">
              <span className={`size-2 shrink-0 rounded-full ${TONE_SOLID_BG[type.tone]}`} aria-hidden="true" />
              {type.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
