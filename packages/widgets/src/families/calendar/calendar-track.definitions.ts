import { lazy } from 'react';

import { calendarMonthConfigSchema, calendarMonthDemoData } from './CalendarMonth.js';
import { capacityBoardConfigSchema, capacityBoardDemoData } from './CapacityBoard.js';
import { dayAgendaConfigSchema, dayAgendaDemoData } from './DayAgenda.js';
import { scheduleMatrixConfigSchema, scheduleMatrixDemoData } from './ScheduleMatrix.js';
import { defineWidget } from '../../registry/types.js';
import type { WidgetDefinition } from '../../registry/types.js';

/**
 * TRACK CAL contribution to the `calendar` family (annex §5). Metadata only —
 * the @adminium/ui-heavy widget components load through the
 * `calendar-track-components` barrel via `lazy(() => import(...))`, so the family
 * stays in one lazy chunk and the registry metadata never eagerly pulls the
 * component code (04 §2.3; the kpi/charts/feeds convention). The GREEN LOOP
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

export const calendarTrackDefinitions: readonly WidgetDefinition[] = [
  calendarMonthDefinition,
  dayAgendaDefinition,
  scheduleMatrixDefinition,
  capacityBoardDefinition,
];
