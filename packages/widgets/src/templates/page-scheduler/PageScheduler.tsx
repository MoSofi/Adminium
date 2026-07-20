/**
 * `page-scheduler` template renderer (09-generated-app.md §7.6, 04 §10
 * manifest `page-scheduler.json`, annex §14 "person FK × date × shift-type").
 *
 * The required `schedule` slot mounts either:
 * - `schedule-matrix` → the interactive `ShiftMatrix` (click-to-cycle writes
 *   — the M7-T03 modal→grid wiring fix), with the week window navigated in
 *   the header driving the host binding's `dateRange.*` params; or
 * - `capacity-board` → the family's `CapacityBoard` with a week/month ×4
 *   rescale toggle (09 §7.6 "Team Workload").
 *
 * Stored item configs carry the candidate vocabulary
 * (`personColumn`/`dateColumn`/`typeColumn`, `projectColumn`/`hoursColumn` —
 * registry/candidates.ts) over record-list payloads; demo payloads arrive in
 * the family's rich shapes (`ScheduleMatrixData`/`CapacityBoardData`) and are
 * used as-is. KPI-row items and everything else render through WidgetHost.
 */
import { Button, SegmentedControl } from '@adminium/ui';
import type { Tone } from '@adminium/ui';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { CapacityBoard, capacityDataOf } from '../../families/calendar/CapacityBoard.js';
import {
  addDays,
  firstJsWeekday,
  fmtMonthShort,
  parseIsoDay,
  resolveLocale,
  weekDays,
} from '../../families/calendar/calendar-lib.js';
import type { CapacityBoardData, CapacityMember } from '../../families/calendar/calendar-types.js';
import { boardRowsOf, humanizeEnum } from '../../families/boards/board-lib.js';
import { WidgetFrame } from '../../frame/WidgetFrame.js';
import { WidgetHost, type WidgetDataState } from '../../frame/WidgetHost.js';
import { DashboardGrid } from '../../grid/DashboardGrid.js';
import type { LayoutItem } from '../../grid/layout-schema.js';
import type { WidgetEvent } from '../../registry/types.js';
import { ShiftMatrix, type ShiftCell, type ShiftResource, type ShiftTypeDef } from './ShiftMatrix.js';
import {
  configNumber,
  configString,
  itemConfigOf,
  parseTemplateConfig,
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
  /** Per-instance data states from the host binding; absent → demo data (04 §5.3). */
  states?: TemplateDataStates | undefined;
  onEvent?: ((instanceId: string, event: WidgetEvent) => void | Promise<unknown>) | undefined;
  /** Published page-control params — the visible week window as
   *  `dateRange.start`/`dateRange.end` (04 §5.1 late-bound filters). */
  onParamsChange?: ((params: Record<string, unknown>) => void) | undefined;
  /** Deterministic "today" (`YYYY-MM-DD`) for stories/tests; defaults to the wall clock. */
  referenceDate?: string | undefined;
  locale?: string | undefined;
  labels?: PageSchedulerLabels | undefined;
  className?: string | undefined;
  testId?: string | undefined;
}

interface MatrixItemConfig {
  personColumn: string;
  dateColumn: string;
  typeColumn: string;
  maxPerCell: number;
  targetCoverage: number | undefined;
}

export function matrixItemConfigOf(config: Record<string, unknown>): MatrixItemConfig {
  return {
    personColumn: configString(config, 'personColumn') ?? 'person',
    dateColumn: configString(config, 'dateColumn', 'startColumn') ?? 'date',
    typeColumn: configString(config, 'typeColumn') ?? 'type',
    maxPerCell: configNumber(config, 'maxPerCell') ?? 2,
    targetCoverage: configNumber(config, 'targetCoverage'),
  };
}

export interface MatrixModel {
  resources: ShiftResource[];
  types: ShiftTypeDef[];
  shifts: ShiftCell[];
  /** Present when the payload is the family's rich demo shape. */
  providedDays: string[] | null;
  /** False when the payload carries no per-row record ids (writes disabled). */
  writable: boolean;
}

/** A person-name-ish sibling column for the resource label (best effort). */
function resourceLabelOf(row: Record<string, unknown>, personColumn: string, personId: string): string {
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
export function matrixModelOf(data: unknown, cfg: MatrixItemConfig): MatrixModel {
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
    };
  }

  const rows = boardRowsOf(data);
  const resources: ShiftResource[] = [];
  const seenResources = new Set<string>();
  const typeIds: string[] = [];
  const shifts: ShiftCell[] = [];
  let writable = rows.length > 0;
  for (const [index, row] of rows.entries()) {
    const personRaw = row[cfg.personColumn];
    const person = personRaw === undefined || personRaw === null ? '' : String(personRaw);
    const day = splitInstant(row[cfg.dateColumn]);
    const typeRaw = row[cfg.typeColumn];
    const typeId = typeRaw === undefined || typeRaw === null ? '' : String(typeRaw);
    if (person === '' || day === null || typeId === '') continue;
    if (!seenResources.has(person)) {
      seenResources.add(person);
      resources.push({ id: person, label: resourceLabelOf(row, cfg.personColumn, person) });
    }
    if (!typeIds.includes(typeId)) typeIds.push(typeId);
    const id = row['id'] ?? row['_id'];
    if (id === undefined || id === null) writable = false;
    shifts.push({
      recordId: String(id ?? `row-${index}`),
      resourceId: person,
      date: day.day,
      typeId,
    });
  }
  return {
    resources,
    types: typeIds.map((id, index) => ({
      id,
      label: humanizeEnum(id),
      tone: TYPE_TONES[index % TYPE_TONES.length] as Tone,
    })),
    shifts,
    providedDays: null,
    writable,
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
  locale,
  labels,
}: {
  item: LayoutItem;
  state: WidgetDataState;
  onEvent: PageSchedulerProps['onEvent'];
  onParamsChange: PageSchedulerProps['onParamsChange'];
  referenceDate: string;
  locale: string | undefined;
  labels: PageSchedulerLabels | undefined;
}) {
  const raw = itemConfigOf(item);
  const cfg = useMemo(() => matrixItemConfigOf(raw), [raw]);
  const source = planningSourceOf(raw);
  const model = useMemo(() => matrixModelOf(state.data, cfg), [state.data, cfg]);
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

  // Week nav drives the host binding's window (04 §5.1 dateRange.* params).
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

  const frameState = state.status === 'loading' ? 'skeleton' : state.status === 'error' ? 'error' : 'loaded';
  const monthLabel = days[0] === undefined ? '' : fmtMonthShort(tag, parseIsoDay(days[0]));

  return (
    <WidgetFrame
      state={frameState}
      title={configString(raw, 'title')}
      skeleton="table"
      errorMessage={state.status === 'error' ? frameMessageOf(state.error) : undefined}
      onRetry={state.refetch}
      refetching={state.isRefetching === true}
      menu={undefined}
      testId={`schedule-slot-${item.i}`}
    >
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex items-center justify-end gap-1 px-2 pb-1">
          <span className="me-auto ps-1 text-caption font-semibold text-fg-subtle" data-part="week-label">
            {monthLabel}
          </span>
          <Button
            variant="ghost"
            size="sm"
            aria-label={labels?.previousWeek ?? 'Previous week'}
            data-part="week-prev"
            onClick={() => setWeekOffset((offset) => offset - 1)}
          >
            <ChevronLeft className="size-4 rtl:-scale-x-100" aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            aria-label={labels?.nextWeek ?? 'Next week'}
            data-part="week-next"
            onClick={() => setWeekOffset((offset) => offset + 1)}
          >
            <ChevronRight className="size-4 rtl:-scale-x-100" aria-hidden="true" />
          </Button>
        </div>
        <div className="min-h-0 flex-1">
          <ShiftMatrix
            resources={model.resources}
            days={days}
            types={model.types}
            shifts={model.shifts}
            maxPerCell={cfg.maxPerCell}
            {...(cfg.targetCoverage === undefined ? {} : { targetCoverage: cfg.targetCoverage })}
            canEdit={canEdit}
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
            onAdd={(resourceId, date, typeId) => {
              if (!canEdit || source === null || onEvent === undefined) return undefined;
              return onEvent(item.i, {
                type: 'mutate',
                intent: 'insert',
                connectionId: source.connectionId,
                table: source.table,
                values: { [cfg.personColumn]: resourceId, [cfg.dateColumn]: date, [cfg.typeColumn]: typeId },
              });
            }}
            testId={`shift-matrix-${item.i}`}
          />
        </div>
      </div>
    </WidgetFrame>
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
              { value: 'week', label: labels?.week ?? 'Week' },
              { value: 'month', label: labels?.month ?? 'Month' },
            ]}
            value={period}
            onValueChange={(value) => setPeriod(value === 'month' ? 'month' : 'week')}
          />
        </div>
        <div className="min-h-0 flex-1">
          <CapacityBoard
            data={model}
            // Week/month ×4 rescale (09 §7.6 Team Workload).
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
  locale,
  labels,
  className,
  testId,
}: PageSchedulerProps) {
  const parsed = useMemo(() => parseTemplateConfig(config), [config]);
  const resolvedStates = useTemplateStates(parsed.layout, states);
  const today = referenceDate ?? todayIso();

  if (parsed.invalid) {
    return (
      <p role="alert" className="p-6 text-body-sm text-fg-muted" data-testid="page-scheduler-invalid">
        This schedule&rsquo;s stored layout is invalid. Regenerate the page or reset its layout.
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
            config={item.config}
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
