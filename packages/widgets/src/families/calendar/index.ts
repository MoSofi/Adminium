/**
 * `calendar` family public surface (annex §5) — the calendar/scheduling
 * components (calendar-month, day-agenda, schedule-matrix, capacity-board) plus
 * the TRACK CAL registry metadata. Component code is also reachable through each
 * definition's `lazy()` ref, so the registry still emits one chunk per family
 * (04 §2.3); this barrel is for direct template/story composition and tests.
 * Registry metadata lives in `calendar-track.definitions.ts`.
 */
export {
  CalendarMonth,
  CalendarMonthWidget,
  calendarMonthConfigSchema,
  calendarMonthDemoData,
  eventsOf,
  type CalendarMonthConfig,
  type CalendarMonthProps,
} from './CalendarMonth.js';
export {
  DayAgenda,
  DayAgendaWidget,
  dayAgendaConfigSchema,
  dayAgendaDemoData,
  type DayAgendaConfig,
  type DayAgendaProps,
} from './DayAgenda.js';
export {
  ScheduleMatrix,
  ScheduleMatrixWidget,
  scheduleDataOf,
  scheduleMatrixConfigSchema,
  scheduleMatrixDemoData,
  type ScheduleMatrixConfig,
  type ScheduleMatrixProps,
} from './ScheduleMatrix.js';
export {
  CapacityBoard,
  CapacityBoardWidget,
  capacityBoardConfigSchema,
  capacityBoardDemoData,
  capacityDataOf,
  type CapacityBoardConfig,
  type CapacityBoardProps,
} from './CapacityBoard.js';
export type {
  CalendarEvent,
  CapacityAssignment,
  CapacityBoardData,
  CapacityMember,
  ScheduleAssignment,
  ScheduleMatrixData,
  ScheduleResource,
  ScheduleShiftType,
} from './calendar-types.js';
export {
  calendarMonthDefinition,
  calendarTrackDefinitions,
  capacityBoardDefinition,
  dayAgendaDefinition,
  scheduleMatrixDefinition,
} from './calendar-track.definitions.js';
