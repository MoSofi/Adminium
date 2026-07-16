import { lazy } from 'react';

import {
  calendarLegendFilterConfigSchema,
  calendarLegendFilterDemoData,
  calendarMonthConfigSchema,
  calendarMonthDemoData,
  capacityBoardConfigSchema,
  capacityBoardDemoData,
  dateRangePickerConfigSchema,
  dateRangePickerDemoData,
  dayAgendaConfigSchema,
  dayAgendaDemoData,
  scheduleMatrixConfigSchema,
  scheduleMatrixDemoData,
  scheduledJobsListConfigSchema,
  scheduledJobsListDemoData,
  upcomingEventsListConfigSchema,
  upcomingEventsListDemoData,
} from './calendar-config.js';
import { defineWidget } from '../../registry/types.js';
import type { WidgetDefinition } from '../../registry/types.js';

/**
 * TRACK CAL contribution to the `calendar` family (annex §5). Metadata only —
 * the config schemas and demo generators come from the pure `calendar-config`
 * module, and the @adminium/ui-heavy widget components load through the
 * `calendar-track-components` barrel via `lazy(() => import(...))`, so the family
 * stays in one lazy chunk and the registry metadata never eagerly pulls the
 * component code (04 §2.3; the boards/domain/media convention). The GREEN LOOP
 * spreads `calendarTrackDefinitions` into `families/calendar/definitions.ts`
 * (and wires that into the registry map). Widget ids match the annex catalog
 * exactly (acceptance #1).
 *
 * Sizing is annex rows → 40px half-units (04 §6.1: `h = round(annexRows × 2)`).
 */

export const calendarMonthDefinition: WidgetDefinition = defineWidget({
  id: 'calendar-month',
  family: 'calendar',
  component: lazy(() => import('./calendar-track-components.js').then((m) => ({ default: m.CalendarMonthWidget }))),
  configSchema: calendarMonthConfigSchema,
  dataContract: 'calendar-events',
  sizing: { minW: 6, minH: 10, defaultW: 8, defaultH: 12 }, // annex 6×5 → 8×6
  placement: 'grid',
  skeleton: 'block',
  demoData: calendarMonthDemoData,
  descriptionKey: 'widgets.calendar.calendarMonth.description',
});

export const dayAgendaDefinition: WidgetDefinition = defineWidget({
  id: 'day-agenda',
  family: 'calendar',
  component: lazy(() => import('./calendar-track-components.js').then((m) => ({ default: m.DayAgendaWidget }))),
  configSchema: dayAgendaConfigSchema,
  dataContract: 'calendar-events',
  sizing: { minW: 3, minH: 8, defaultW: 4, defaultH: 12 }, // annex 3×4 → 4×6
  placement: 'grid',
  skeleton: 'list',
  demoData: dayAgendaDemoData,
  descriptionKey: 'widgets.calendar.dayAgenda.description',
});

export const scheduleMatrixDefinition: WidgetDefinition = defineWidget({
  id: 'schedule-matrix',
  family: 'calendar',
  component: lazy(() => import('./calendar-track-components.js').then((m) => ({ default: m.ScheduleMatrixWidget }))),
  configSchema: scheduleMatrixConfigSchema,
  dataContract: 'record-list',
  sizing: { minW: 8, minH: 8, defaultW: 12, defaultH: 12 }, // annex 8×4 → 12×6
  placement: 'grid',
  skeleton: 'table',
  capabilities: { editsData: true },
  demoData: scheduleMatrixDemoData,
  descriptionKey: 'widgets.calendar.scheduleMatrix.description',
});

export const capacityBoardDefinition: WidgetDefinition = defineWidget({
  id: 'capacity-board',
  family: 'calendar',
  component: lazy(() => import('./calendar-track-components.js').then((m) => ({ default: m.CapacityBoardWidget }))),
  configSchema: capacityBoardConfigSchema,
  dataContract: 'record-list',
  sizing: { minW: 8, minH: 8, defaultW: 12, defaultH: 10 }, // annex 8×4 → 12×5
  placement: 'grid',
  skeleton: 'list',
  demoData: capacityBoardDemoData,
  descriptionKey: 'widgets.calendar.capacityBoard.description',
});

// ── M7 Wave-4 TAIL — the four §5 widgets that complete the family ──────────

export const calendarLegendFilterDefinition: WidgetDefinition = defineWidget({
  id: 'calendar-legend-filter',
  family: 'calendar',
  component: lazy(() => import('./calendar-track-components.js').then((m) => ({ default: m.CalendarLegendFilterWidget }))),
  configSchema: calendarLegendFilterConfigSchema,
  // The legend is a VIEW of the calendar's own events (annex §5: "categories
  // aggregated from events"), so it binds to the identical payload rather than
  // declaring a second contract.
  dataContract: 'calendar-events',
  sizing: { minW: 3, minH: 2, defaultW: 4, defaultH: 4 }, // annex min 3×1
  placement: 'grid',
  skeleton: 'list',
  demoData: calendarLegendFilterDemoData,
  descriptionKey: 'widgets.calendar.calendarLegendFilter.description',
});

export const upcomingEventsListDefinition: WidgetDefinition = defineWidget({
  id: 'upcoming-events-list',
  family: 'calendar',
  component: lazy(() => import('./calendar-track-components.js').then((m) => ({ default: m.UpcomingEventsListWidget }))),
  configSchema: upcomingEventsListConfigSchema,
  dataContract: 'calendar-events',
  sizing: { minW: 3, minH: 6, defaultW: 4, defaultH: 8 }, // annex 3×3 → 4×4
  placement: 'grid',
  skeleton: 'list',
  demoData: upcomingEventsListDemoData,
  descriptionKey: 'widgets.calendar.upcomingEventsList.description',
});

export const dateRangePickerDefinition: WidgetDefinition = defineWidget({
  id: 'date-range-picker',
  family: 'calendar',
  component: lazy(() => import('./calendar-track-components.js').then((m) => ({ default: m.DateRangePickerWidget }))),
  configSchema: dateRangePickerConfigSchema,
  // annex §5: "date pair (control, feeds other widgets' queries)" — a control's
  // payload is its own value, which is the `form-state` shape (§3).
  dataContract: 'form-state',
  sizing: { minW: 3, minH: 6, defaultW: 3, defaultH: 6 }, // annex "popover/inline 3×3"
  placement: 'inline', // toolbar/popover chrome, never a grid tile (annex)
  skeleton: 'block',
  demoData: dateRangePickerDemoData,
  descriptionKey: 'widgets.calendar.dateRangePicker.description',
});

export const scheduledJobsListDefinition: WidgetDefinition = defineWidget({
  id: 'scheduled-jobs-list',
  family: 'calendar',
  component: lazy(() => import('./calendar-track-components.js').then((m) => ({ default: m.ScheduledJobsListWidget }))),
  configSchema: scheduledJobsListConfigSchema,
  dataContract: 'record-list',
  sizing: { minW: 6, minH: 6, defaultW: 12, defaultH: 8 }, // annex 6×3 → 12×4
  placement: 'grid',
  skeleton: 'list',
  // The on/off switch emits a `mutate` UPDATE intent; the host runs it through
  // the CRUD API with undo + audit — the widget never writes.
  capabilities: { editsData: true },
  demoData: scheduledJobsListDemoData,
  descriptionKey: 'widgets.calendar.scheduledJobsList.description',
});

export const calendarTrackDefinitions: readonly WidgetDefinition[] = [
  calendarMonthDefinition,
  dayAgendaDefinition,
  scheduleMatrixDefinition,
  capacityBoardDefinition,
  calendarLegendFilterDefinition,
  upcomingEventsListDefinition,
  dateRangePickerDefinition,
  scheduledJobsListDefinition,
];
