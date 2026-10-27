// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `page-scheduler` template renderer (manifest `page-scheduler.json`,
 * annex).
 *
 * The required `schedule` slot mounts either:
 * - `schedule-matrix` → the interactive `ShiftMatrix` (click-to-cycle writes
 * — the modal→grid wiring fix), with the week window navigated in the header
 *   driving the host binding's `dateRange.*` params; or
 * - `capacity-board` → the family's `CapacityBoard` with a week/month ×4
 * rescale toggle.
 *
 * Stored item configs carry the candidate vocabulary
 * (`personColumn`/`dateColumn`/`typeColumn`, `projectColumn`/`hoursColumn` —
 * registry/candidates.ts) over record-list payloads; demo payloads arrive in
 * the family's rich shapes (`ScheduleMatrixData`/`CapacityBoardData`) and are
 * used as-is. KPI-row items and everything else render through WidgetHost.
 */
import { useMaybeT } from '../../lib/i18n.js';
import { Button, FormDialog, FormDialogBody, FormDialogFooter, FormDialogHeader, FormField, Input, SegmentedControl, Select } from '@adminium/ui';
import type { Tone } from '@adminium/ui';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { CapacityBoard, capacityDataOf } from '../../families/calendar/CapacityBoard.js';
import {
  addDays,
  firstJsWeekday,
  fmtMonthDay,
  resolveLocale,
  weekDays,
} from '../../families/calendar/calendar-lib.js';
import { servedChoicesOf } from '../../families/tables/choices.js';
import { SCHEDULE_PERSON_ALIAS, SCHEDULE_ROLE_ALIAS } from '../../registry/candidates.js';
import type { CapacityBoardData, CapacityMember } from '../../families/calendar/calendar-types.js';
import { boardRowsOf, humanizeEnum } from '../../families/boards/board-lib.js';
import { WidgetFrame } from '../../frame/WidgetFrame.js';
import { UnplacedRowsNotice, nothingPlaced } from '../planning/UnplacedRowsNotice.js';
import { WidgetHost, type WidgetDataState } from '../../frame/WidgetHost.js';
import { DashboardGrid } from '../../grid/DashboardGrid.js';
import type { LayoutItem } from '../../grid/layout-schema.js';
import type { WidgetEvent } from '../../registry/types.js';
import { withCurrency } from '../page-currency.js';
import { ShiftMatrix, type ShiftCell, type ShiftResource, type ShiftTypeDef } from './ShiftMatrix.js';
import {
  configNumber,
  configString,
  dayStartValue,
  itemConfigOf,
  parseTemplateConfig,
  planningDateKindOf,
  planningSourceOf,
  splitInstant,
  todayIso,
  useTemplateStates,
  type TemplateDataStates,
} from '../planning/planning-lib.js';

export const PAGE_SCHEDULER_TEMPLATE_ID = 'page-scheduler';

const MATRIX_WIDGET_ID = 'schedule-matrix';
const CAPACITY_WIDGET_ID = 'capacity-board';

const TYPE_TONES: readonly Tone[] = ['accent', 'info', 'pos', 'warn', 'danger', 'neutral'];

export interface PageSchedulerLabels {
  previousWeek?: string | undefined;
  nextWeek?: string | undefined;
  week?: string | undefined;
  month?: string | undefined;
  resource?: string | undefined;
  coverage?: string | undefined;
  addShift?: string | undefined;
  shiftCount?: string | undefined;
}

export interface PageSchedulerProps {
  /** The stored page config body: `{ templateVersion, toolbar, overlays, layout }`. */
  config: unknown;
  /** Per-instance data states from the host binding; absent → demo data. */
  states?: TemplateDataStates | undefined;
  onEvent?: ((instanceId: string, event: WidgetEvent) => void | Promise<unknown>) | undefined;
  /** Published page-control params — the visible week window as
   * `dateRange.start`/`dateRange.end` (late-bound filters). */
  onParamsChange?: ((params: Record<string, unknown>) => void) | undefined;
  /** Deterministic "today" (`YYYY-MM-DD`) for stories/tests; defaults to the wall clock. */
  referenceDate?: string | undefined;
  /**
   * IANA zone shifts are filed in (a timestamp is converted into it before
   * its day is taken; a new shift writes that zone's midnight). Absent ⇒ the
   * viewer's zone.
   */
  timeZone?: string | undefined;
  locale?: string | undefined;
  labels?: PageSchedulerLabels | undefined;
  className?: string | undefined;
  testId?: string | undefined;
  /**
   * The connection's currency, for a stored widget that names none (a KPI
   * card's money) — merged as the page draws, never into the stored layout.
   */
  currency?: string | undefined;
}

interface MatrixItemConfig {
  personColumn: string;
  dateColumn: string;
  typeColumn: string;
  /** Where a shift ends: with it, each chip says its times and each person their hours. */
  endColumn: string | undefined;
  /** How many `adm_person_N` lookups name a person (a first and a last name). */
  personNameParts: number;
  maxPerCell: number;
  targetCoverage: number | undefined;
}

export function matrixItemConfigOf(config: Record<string, unknown>): MatrixItemConfig {
  const names = config['personName'];
  return {
    personColumn: configString(config, 'personColumn') ?? 'person',
    dateColumn: configString(config, 'dateColumn', 'startColumn') ?? 'date',
    typeColumn: configString(config, 'typeColumn') ?? 'type',
    endColumn: configString(config, 'endColumn'),
    personNameParts: Array.isArray(names) ? Math.min(2, names.length) : 0,
    maxPerCell: configNumber(config, 'maxPerCell') ?? 2,
    targetCoverage: configNumber(config, 'targetCoverage'),
  };
}

const KNOWN_TONES: readonly string[] = ['neutral', 'accent', 'pos', 'warn', 'danger', 'info'];

/** Minutes past midnight of an `HH:MM`. */
function minutesOf(time: string | undefined): number | undefined {
  if (time === undefined) return undefined;
  const [h, m] = time.split(':').map(Number);
  return h === undefined || m === undefined || !Number.isFinite(h) || !Number.isFinite(m) ? undefined : h * 60 + m;
}

export interface MatrixModel {
  resources: ShiftResource[];
  types: ShiftTypeDef[];
  shifts: ShiftCell[];
  /** Present when the payload is the family's rich demo shape. */
  providedDays: string[] | null;
  /** False when the payload carries no per-row record ids (writes disabled). */
  writable: boolean;
  /** Rows the payload carried, placed or not — the "nothing placed" hint's denominator. */
  received: number;
}

/** A person-name-ish sibling column for the resource label (best effort). */
function resourceLabelOf(row: Record<string, unknown>, personColumn: string, personId: string, nameParts = 0): string {
  // The name read through the person's link (the generator asks for it): first and last joined.
  const parts = Array.from({ length: nameParts }, (_, index) => row[`${SCHEDULE_PERSON_ALIAS}_${String(index)}`]).filter((part): part is string => typeof part === 'string' && part.trim() !== '');
  if (parts.length > 0) return parts.join(' ');
  for (const key of [`${personColumn}_name`, 'person_name', 'employee_name', 'name', 'full_name', 'email']) {
    const value = row[key];
    if (typeof value === 'string' && value !== '') return value;
  }
  return personId;
}

/**
 * Build the matrix model from either payload shape: the family's rich
 * `ScheduleMatrixData` (demo mode) or a record-list of shift rows mapped via
 * the stored candidate vocabulary.
 */
export function matrixModelOf(
  data: unknown,
  cfg: MatrixItemConfig,
  timeZone?: string | undefined,
): MatrixModel {
  const source = (typeof data === 'object' && data !== null ? data : {}) as Record<string, unknown>;

  if (Array.isArray(source['assignments']) && Array.isArray(source['days'])) {
    // Rich shape: resources ride `rows`, assignments carry no record ids.
    const rows = Array.isArray(source['rows']) ? (source['rows'] as Record<string, unknown>[]) : [];
    const rawTypes = Array.isArray(source['shiftTypes']) ? (source['shiftTypes'] as Record<string, unknown>[]) : [];
    const types: ShiftTypeDef[] = rawTypes.map((type, index) => ({
      id: String(type['id'] ?? index),
      label: typeof type['label'] === 'string' ? (type['label'] as string) : humanizeEnum(String(type['id'] ?? index)),
      tone: (typeof type['tone'] === 'string' && (TYPE_TONES as readonly string[]).includes(type['tone'] as string)
        ? (type['tone'] as Tone)
        : TYPE_TONES[index % TYPE_TONES.length]) as Tone,
    }));
    const shifts = (source['assignments'] as Record<string, unknown>[]).map((assignment, index) => ({
      recordId: `demo-${index}`,
      resourceId: String(assignment['resourceId'] ?? ''),
      date: String(assignment['date'] ?? ''),
      typeId: String(assignment['typeId'] ?? ''),
    }));
    return {
      resources: rows.map((row, index) => ({
        id: String(row['id'] ?? index),
        label: typeof row['name'] === 'string' ? (row['name'] as string) : String(row['id'] ?? index),
        role: typeof row['role'] === 'string' ? (row['role'] as string) : undefined,
      })),
      types,
      shifts,
      providedDays: (source['days'] as unknown[]).map((day) => String(day)),
      writable: false,
      received: shifts.length,
    };
  }

  const rows = boardRowsOf(data);
  const dateKind = planningDateKindOf(data, cfg.dateColumn);
  const endKind = planningDateKindOf(data, cfg.endColumn);
  // The type column's own words and tones, as the answer gave them.
  const typeWords = servedChoicesOf(data).get(cfg.typeColumn);
  const resources: ShiftResource[] = [];
  const seenResources = new Set<string>();
  const typeIds: string[] = [];
  const shifts: ShiftCell[] = [];
  let writable = rows.length > 0;
  for (const [index, row] of rows.entries()) {
    const personRaw = row[cfg.personColumn];
    const person = personRaw === undefined || personRaw === null ? '' : String(personRaw);
    const day = splitInstant(row[cfg.dateColumn], { timeZone, kind: dateKind });
    const typeRaw = row[cfg.typeColumn];
    const typeId = typeRaw === undefined || typeRaw === null ? '' : String(typeRaw);
    if (person === '' || day === null || typeId === '') continue;
    if (!seenResources.has(person)) {
      seenResources.add(person);
      const role = row[SCHEDULE_ROLE_ALIAS];
      resources.push({ id: person, label: resourceLabelOf(row, cfg.personColumn, person, cfg.personNameParts), ...(typeof role === 'string' && role !== '' ? { role } : {}) });
    }
    if (!typeIds.includes(typeId)) typeIds.push(typeId);
    const id = row['id'] ?? row['_id'];
    if (id === undefined || id === null) writable = false;
    // Its times, where the table keeps them: a shift past midnight runs into the next day.
    const end = cfg.endColumn === undefined ? null : splitInstant(row[cfg.endColumn], { timeZone, kind: endKind });
    const from = minutesOf(day.time);
    const to = minutesOf(end?.time);
    const minutes = from === undefined || to === undefined ? undefined : (to - from + (end !== null && end.day !== day.day ? 24 * 60 : 0) + 24 * 60) % (24 * 60) || undefined;
    shifts.push({
      recordId: String(id ?? `row-${index}`),
      resourceId: person,
      date: day.day,
      typeId,
      ...(day.time === undefined ? {} : { start: day.time }),
      ...(end?.time === undefined ? {} : { end: end.time }),
      ...(minutes === undefined ? {} : { minutes }),
    });
  }
  return {
    resources,
    types: typeIds.map((id, index) => {
      const tone = typeWords?.enumTones?.[id];
      return {
        id,
        label: typeWords?.enumLabels?.[id] ?? humanizeEnum(id),
        tone: (tone !== undefined && KNOWN_TONES.includes(tone) ? tone : TYPE_TONES[index % TYPE_TONES.length]) as Tone,
      };
    }),
    shifts,
    providedDays: null,
    writable,
    received: rows.length,
  };
}

interface CapacityItemConfig {
  personColumn: string;
  projectColumn: string;
  hoursColumn: string;
  capacity: number;
  availableBelow: number;
  overloadedAbove: number;
}

export function capacityItemConfigOf(config: Record<string, unknown>): CapacityItemConfig {
  return {
    personColumn: configString(config, 'personColumn') ?? 'person',
    projectColumn: configString(config, 'projectColumn') ?? 'project',
    hoursColumn: configString(config, 'hoursColumn') ?? 'hours',
    capacity: configNumber(config, 'capacity') ?? 40,
    availableBelow: configNumber(config, 'availableBelow') ?? 75,
    overloadedAbove: configNumber(config, 'overloadedAbove') ?? 100,
  };
}

/** Rich `CapacityBoardData` passes through; record-list rows are grouped. */
export function capacityModelOf(data: unknown, cfg: CapacityItemConfig): CapacityBoardData {
  const direct = capacityDataOf(data);
  if (direct.rows.some((member) => Array.isArray(member.assignments))) return direct;

  const rows = boardRowsOf(data);
  const members = new Map<string, CapacityMember>();
  const tones: readonly string[] = ['accent', 'info', 'pos', 'warn', 'danger'];
  const projectTone = new Map<string, string>();
  for (const row of rows) {
    const personRaw = row[cfg.personColumn];
    const person = personRaw === undefined || personRaw === null ? '' : String(personRaw);
    const projectRaw = row[cfg.projectColumn];
    const project = projectRaw === undefined || projectRaw === null ? '' : String(projectRaw);
    const hoursRaw = row[cfg.hoursColumn];
    const hours = typeof hoursRaw === 'number' ? hoursRaw : Number(hoursRaw);
    if (person === '' || project === '' || !Number.isFinite(hours)) continue;
    if (!projectTone.has(project)) projectTone.set(project, tones[projectTone.size % tones.length] as string);
    let member = members.get(person);
    if (member === undefined) {
      member = {
        id: person,
        name: resourceLabelOf(row, cfg.personColumn, person),
        role: '',
        assignments: [],
      };
      members.set(person, member);
    }
    const existing = member.assignments.find((assignment) => assignment.project === project);
    if (existing === undefined) {
      member.assignments.push({ project, hours, tone: projectTone.get(project) as string });
    } else {
      existing.hours += hours;
    }
  }
  const list = [...members.values()];
  return { rows: list, total: list.length };
}

function MatrixSlot({
  item,
  state,
  onEvent,
  onParamsChange,
  referenceDate,
  timeZone,
  locale,
  labels,
}: {
  item: LayoutItem;
  state: WidgetDataState;
  onEvent: PageSchedulerProps['onEvent'];
  onParamsChange: PageSchedulerProps['onParamsChange'];
  referenceDate: string;
  timeZone: string | undefined;
  locale: string | undefined;
  labels: PageSchedulerLabels | undefined;
}) {
  const t = useMaybeT();
  const raw = itemConfigOf(item);
  const cfg = useMemo(() => matrixItemConfigOf(raw), [raw]);
  const source = planningSourceOf(raw);
  const model = useMemo(() => matrixModelOf(state.data, cfg, timeZone), [state.data, cfg, timeZone]);
  const dateKind = planningDateKindOf(state.data, cfg.dateColumn);
  const tag = resolveLocale(locale);

  const [weekOffset, setWeekOffset] = useState(0);
  const firstJs = firstJsWeekday(tag, configNumber(raw, 'weekStart'));
  const days = useMemo(() => {
    const base =
      model.providedDays !== null && model.providedDays.length > 0
        ? model.providedDays
        : weekDays(referenceDate, firstJs).map((day) => day.key);
    return weekOffset === 0 ? base : base.map((day) => addDays(day, weekOffset * 7));
  }, [model.providedDays, referenceDate, firstJs, weekOffset]);

  // Week nav drives the host binding's window (dateRange.* params).
  // Skipped on first render: the initial fetch already covers the default
  // window, and a mount-time params flip would refetch the page twice.
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    const start = days[0];
    const end = days[days.length - 1];
    if (start !== undefined && end !== undefined) {
      onParamsChange?.({ 'dateRange.start': start, 'dateRange.end': end });
    }
    // Deps are the visible window key only — same-window rerenders must not refetch.
  }, [days[0], days[days.length - 1]]);

  const canEdit = source !== null && model.writable && onEvent !== undefined;
  // The comp's "Add shift" form: open with its person and day, or with none from the header button.
  const [adding, setAdding] = useState<{ resourceId: string | undefined; day: string | undefined } | null>(null);
  const endKind = planningDateKindOf(state.data, cfg.endColumn);

  const frameState = state.status === 'loading' ? 'skeleton' : state.status === 'error' ? 'error' : 'loaded';
  const thisYear = new Date().getUTCFullYear();
  const weekLabel =
    days[0] === undefined
      ? ''
      : t('ui:templates.scheduler.weekOf', 'Week of {start} – {end}', { start: fmtMonthDay(tag, days[0], thisYear), end: fmtMonthDay(tag, days[days.length - 1] ?? days[0], thisYear) });
  const navButton =
    'flex size-8 items-center justify-center rounded-[8px] border border-border bg-surface text-fg-muted transition-colors hover:bg-surface-3 hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

  return (
    <WidgetFrame
      state={frameState}
      frameless
      skeleton="table"
      errorMessage={state.status === 'error' ? frameMessageOf(state.error) : undefined}
      onRetry={state.refetch}
      refetching={state.isRefetching === true}
      menu={undefined}
      testId={`schedule-slot-${item.i}`}
    >
      <div className="flex h-full min-h-0 flex-col gap-[18px] leading-[normal]">
        {/* The comp's header: the week, then its navigation and "Add shift". */}
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="me-auto min-w-0">
            <p data-part="week-label" className="text-[13px] font-bold text-fg">{weekLabel}</p>
            {canEdit ? <p className="mt-0.5 text-[12.5px] text-fg-muted">{t('ui:templates.scheduler.cellHint', 'Choose an empty cell to add a shift')}</p> : null}
          </div>
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              aria-label={labels?.previousWeek ?? t('ui:templates.scheduler.previousWeek', 'Previous week')}
              data-part="week-prev"
              onClick={() => setWeekOffset((offset) => offset - 1)}
              className={navButton}
            >
              <ChevronLeft className="size-4 rtl:-scale-x-100" aria-hidden="true" />
            </button>
            <button
              type="button"
              data-part="week-this"
              aria-pressed={weekOffset === 0}
              onClick={() => setWeekOffset(0)}
              className="rounded-[8px] bg-accent-soft px-3 py-[7px] text-[12px] font-bold text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              {t('ui:templates.scheduler.thisWeek', 'This week')}
            </button>
            <button
              type="button"
              aria-label={labels?.nextWeek ?? t('ui:templates.scheduler.nextWeek', 'Next week')}
              data-part="week-next"
              onClick={() => setWeekOffset((offset) => offset + 1)}
              className={navButton}
            >
              <ChevronRight className="size-4 rtl:-scale-x-100" aria-hidden="true" />
            </button>
          </div>
          {canEdit && model.types.length > 0 ? (
            <button
              type="button"
              data-part="shift-new"
              onClick={() => setAdding({ resourceId: undefined, day: undefined })}
              className="flex items-center gap-[7px] rounded-[10px] bg-accent py-2 pe-[13px] ps-2.5 text-[13px] font-bold text-accent-fg shadow-[0_2px_8px_color-mix(in_srgb,var(--accent)_35%,transparent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              <Plus aria-hidden="true" className="size-4" />
              {labels?.addShift ?? t('ui:templates.scheduler.addShift', 'Add shift')}
            </button>
          ) : null}
        </div>
        {state.status === 'success' && nothingPlaced(model.received, model.shifts.length) ? (
          <UnplacedRowsNotice
            testId="schedule-unplaced-rows"
            message={t(
              'ui:templates.planning.unplaced.scheduler',
              'None of this table’s rows has a person, a date and a shift type yet, so the schedule is empty. A row appears here as soon as it has all three.',
            )}
          />
        ) : null}
        <div className="min-h-0 flex-1">
          <ShiftMatrix
            resources={model.resources}
            days={days}
            types={model.types}
            shifts={model.shifts}
            maxPerCell={cfg.maxPerCell}
            {...(cfg.targetCoverage === undefined ? {} : { targetCoverage: cfg.targetCoverage })}
            canEdit={canEdit}
            showStats
            {...(locale === undefined ? {} : { locale })}
            labels={{
              ...(labels?.resource === undefined ? {} : { resource: labels.resource }),
              ...(labels?.coverage === undefined ? {} : { coverage: labels.coverage }),
              ...(labels?.addShift === undefined ? {} : { addShift: labels.addShift }),
              ...(labels?.shiftCount === undefined ? {} : { shiftCount: labels.shiftCount }),
            }}
            onCycle={(shift, nextTypeId) => {
              if (!canEdit || source === null || onEvent === undefined) return undefined;
              if (nextTypeId === null) {
                return onEvent(item.i, {
                  type: 'mutate',
                  intent: 'delete',
                  connectionId: source.connectionId,
                  table: source.table,
                  recordId: shift.recordId,
                });
              }
              return onEvent(item.i, {
                type: 'mutate',
                intent: 'update',
                connectionId: source.connectionId,
                table: source.table,
                recordId: shift.recordId,
                values: { [cfg.typeColumn]: nextTypeId },
              });
            }}
            onAddAt={(resourceId, day) => setAdding({ resourceId, day })}
            testId={`shift-matrix-${item.i}`}
          />
        </div>
      </div>
      {adding === null || source === null || onEvent === undefined ? null : (
        <AddShiftDialog
          resources={model.resources}
          days={days}
          types={model.types}
          initial={adding}
          timed={cfg.endColumn !== undefined}
          locale={tag}
          onClose={() => setAdding(null)}
          onSave={(shift) => {
            const startMinutes = minutesOf(shift.start) ?? 0;
            const endMinutes = minutesOf(shift.end);
            const at = (day: string, minutes: number, kind: typeof dateKind): string => {
              const midnight = dayStartValue(day, { timeZone, kind });
              if (kind !== 'instant') return midnight;
              const parsed = Date.parse(midnight);
              return Number.isFinite(parsed) ? new Date(parsed + minutes * 60_000).toISOString() : midnight;
            };
            // A shift that ends before it starts runs past midnight, into the next day.
            const endDay = endMinutes !== undefined && endMinutes <= startMinutes ? addDays(shift.day, 1) : shift.day;
            return onEvent(item.i, {
              type: 'mutate',
              intent: 'insert',
              connectionId: source.connectionId,
              table: source.table,
              values: {
                [cfg.personColumn]: shift.resourceId,
                [cfg.dateColumn]: at(shift.day, startMinutes, dateKind),
                [cfg.typeColumn]: shift.typeId,
                ...(cfg.endColumn === undefined || endMinutes === undefined ? {} : { [cfg.endColumn]: at(endDay, endMinutes, endKind) }),
              },
            });
          }}
        />
      )}
    </WidgetFrame>
  );
}

/**
 * The comp's "Add shift" form: who, which day, from and until when, and the
 * shift's type. A cell opens it with its person and day already chosen. The
 * save is the host's insert; a refused one keeps the form open and says why.
 */
function AddShiftDialog({
  resources,
  days,
  types,
  initial,
  timed,
  locale,
  onClose,
  onSave,
}: {
  resources: readonly ShiftResource[];
  days: readonly string[];
  types: readonly ShiftTypeDef[];
  initial: { resourceId: string | undefined; day: string | undefined };
  timed: boolean;
  locale: string;
  onClose: () => void;
  onSave: (shift: { resourceId: string; day: string; typeId: string; start: string; end: string }) => void | Promise<unknown>;
}) {
  const t = useMaybeT();
  const [resourceId, setResourceId] = useState(initial.resourceId ?? resources[0]?.id ?? '');
  const [day, setDay] = useState(initial.day ?? days[0] ?? '');
  const [typeId, setTypeId] = useState(types[0]?.id ?? '');
  const [start, setStart] = useState('09:00');
  const [end, setEnd] = useState('17:00');
  const [saving, setSaving] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const formId = 'add-shift-form';
  const submit = (): void => {
    if (resourceId === '' || day === '' || typeId === '' || saving) return;
    setRefused(null);
    const result = onSave({ resourceId, day, typeId, start, end });
    if (result === undefined || typeof (result as Promise<unknown>).then !== 'function') {
      onClose();
      return;
    }
    setSaving(true);
    (result as Promise<unknown>).then(
      () => {
        setSaving(false);
        onClose();
      },
      (error: unknown) => {
        setSaving(false);
        setRefused(error instanceof Error && error.message !== '' ? error.message : t('ui:templates.scheduler.addRefused', 'The shift was not added.'));
      },
    );
  };
  return (
    <FormDialog open onOpenChange={(open) => (open ? undefined : onClose())} width={480}>
      <FormDialogHeader
        icon={<Plus />}
        title={t('ui:templates.scheduler.addShift', 'Add shift')}
        subtitle={t('ui:templates.scheduler.addShiftSubtitle', 'Schedule a shift for a team member.')}
        closeLabel={t('ui:action.close', 'Close')}
      />
      <FormDialogBody>
        <form
          id={formId}
          className="flex flex-col gap-[15px]"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          {refused === null ? null : (
            <p role="alert" data-part="add-shift-refused" className="rounded-md bg-danger-soft px-3 py-2.5 text-body-sm font-bold text-danger">
              {refused}
            </p>
          )}
          <FormField label={t('ui:templates.scheduler.teamMember', 'Team member')}>
            <Select value={resourceId} onChange={(event) => setResourceId(event.target.value)}>
              {resources.map((resource) => (
                <option key={resource.id} value={resource.id}>
                  {resource.label}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label={t('ui:templates.scheduler.day', 'Date')}>
            <Select value={day} onChange={(event) => setDay(event.target.value)}>
              {days.map((option) => (
                <option key={option} value={option}>
                  {fmtMonthDay(locale, option)}
                </option>
              ))}
            </Select>
          </FormField>
          {timed ? (
            <div className="grid grid-cols-2 gap-3">
              <FormField label={t('ui:templates.scheduler.start', 'Start')}>
                <Input type="time" value={start} onChange={(event) => setStart(event.target.value)} />
              </FormField>
              <FormField label={t('ui:templates.scheduler.end', 'End')}>
                <Input type="time" value={end} onChange={(event) => setEnd(event.target.value)} />
              </FormField>
            </div>
          ) : null}
          <FormField label={t('ui:templates.scheduler.type', 'Type')}>
            <Select value={typeId} onChange={(event) => setTypeId(event.target.value)}>
              {types.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.label}
                </option>
              ))}
            </Select>
          </FormField>
        </form>
      </FormDialogBody>
      <FormDialogFooter>
        <Button type="button" variant="secondary" onClick={onClose}>
          {t('ui:action.cancel', 'Cancel')}
        </Button>
        <Button type="submit" form={formId} variant="primary" disabled={saving || resourceId === '' || typeId === ''}>
          <Plus aria-hidden="true" />
          {t('ui:templates.scheduler.addShift', 'Add shift')}
        </Button>
      </FormDialogFooter>
    </FormDialog>
  );
}

function CapacitySlot({
  item,
  state,
  locale,
  labels,
}: {
  item: LayoutItem;
  state: WidgetDataState;
  locale: string | undefined;
  labels: PageSchedulerLabels | undefined;
}) {
  const t = useMaybeT();
  const raw = itemConfigOf(item);
  const cfg = useMemo(() => capacityItemConfigOf(raw), [raw]);
  const model = useMemo(() => capacityModelOf(state.data, cfg), [state.data, cfg]);
  const [period, setPeriod] = useState<'week' | 'month'>('week');
  const frameState = state.status === 'loading' ? 'skeleton' : state.status === 'error' ? 'error' : 'loaded';

  return (
    <WidgetFrame
      state={frameState}
      title={configString(raw, 'title')}
      skeleton="list"
      errorMessage={state.status === 'error' ? frameMessageOf(state.error) : undefined}
      onRetry={state.refetch}
      refetching={state.isRefetching === true}
      testId={`capacity-slot-${item.i}`}
    >
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex items-center justify-end px-3 pt-2">
          <SegmentedControl
            data-part="capacity-period"
            options={[
              { value: 'week', label: labels?.week ?? t('ui:templates.scheduler.week', 'Week') },
              { value: 'month', label: labels?.month ?? t('ui:templates.scheduler.month', 'Month') },
            ]}
            value={period}
            onValueChange={(value) => setPeriod(value === 'month' ? 'month' : 'week')}
          />
        </div>
        <div className="min-h-0 flex-1">
          <CapacityBoard
            data={model}
            // Week/month ×4 rescale (Team Workload).
            capacity={period === 'month' ? cfg.capacity * 4 : cfg.capacity}
            period={period}
            availableBelow={cfg.availableBelow}
            overloadedAbove={cfg.overloadedAbove}
            {...(locale === undefined ? {} : { locale })}
          />
        </div>
      </div>
    </WidgetFrame>
  );
}

export function PageScheduler({
  config,
  states,
  onEvent,
  onParamsChange,
  referenceDate,
  timeZone,
  locale,
  labels,
  className,
  testId,
  currency,
}: PageSchedulerProps) {
  const t = useMaybeT();
  const parsed = useMemo(() => parseTemplateConfig(config), [config]);
  const resolvedStates = useTemplateStates(parsed.layout, states);
  const today = referenceDate ?? todayIso(timeZone);

  if (parsed.invalid) {
    return (
      <p role="alert" className="p-6 text-body-sm text-fg-muted" data-testid="page-scheduler-invalid">
        {t(
          'ui:templates.scheduler.invalidLayout',
          'This schedule’s stored layout is invalid. Regenerate the page or reset its layout.',
        )}
      </p>
    );
  }

  return (
    <DashboardGrid
      layout={parsed.layout}
      className={className}
      testId={testId ?? 'page-scheduler'}
      renderItem={(item) => {
        const state = resolvedStates[item.i] ?? { status: 'loading' as const };
        if (item.widget === MATRIX_WIDGET_ID) {
          return (
            <MatrixSlot
              item={item}
              state={state}
              onEvent={onEvent}
              onParamsChange={onParamsChange}
              referenceDate={today}
              timeZone={timeZone}
              locale={locale}
              labels={labels}
            />
          );
        }
        if (item.widget === CAPACITY_WIDGET_ID) {
          return <CapacitySlot item={item} state={state} locale={locale} labels={labels} />;
        }
        return (
          <WidgetHost
            widgetId={item.widget}
            instanceId={item.i}
            config={withCurrency(item.config, currency)}
            data={state}
            onEvent={onEvent === undefined ? undefined : (event) => void onEvent(item.i, event)}
          />
        );
      }}
    />
  );
}

function frameMessageOf(error: unknown): string | undefined {
  if (error instanceof Error && error.message !== '') return error.message;
  if (typeof error === 'string' && error !== '') return error;
  return undefined;
}
