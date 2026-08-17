// SPDX-License-Identifier: AGPL-3.0-only
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
// M7 Wave-4 TAIL — the four §5 widgets that complete the family.
export {
  CalendarLegendFilter,
  CalendarLegendFilterWidget,
  calendarLegendFilterConfigSchema,
  calendarLegendFilterDemoData,
  legendCategoriesOf,
  type CalendarLegendFilterConfig,
  type CalendarLegendFilterProps,
  type LegendCategory,
} from './CalendarLegendFilter.js';
export {
  UpcomingEventsList,
  UpcomingEventsListWidget,
  cutoffDayOf,
  upcomingEventsListConfigSchema,
  upcomingEventsListDemoData,
  upcomingEventsOf,
  type UpcomingEventsListConfig,
  type UpcomingEventsListProps,
} from './UpcomingEventsList.js';
export {
  DateRangePicker,
  DateRangePickerWidget,
  dateRangePickerConfigSchema,
  dateRangePickerDemoData,
  nextRange,
  rangeValueOf,
  type DateRangePickerConfig,
  type DateRangePickerProps,
} from './DateRangePicker.js';
export {
  ScheduledJobsList,
  ScheduledJobsListWidget,
  scheduledJobsListConfigSchema,
  scheduledJobsListDemoData,
  scheduledJobsOf,
  type ScheduledJobsListConfig,
  type ScheduledJobsListProps,
} from './ScheduledJobsList.js';
export type {
  CalendarEvent,
  CapacityAssignment,
  CapacityBoardData,
  CapacityMember,
  DateRangePreset,
  DateRangeValue,
  EventCategory,
  ScheduleAssignment,
  ScheduleMatrixData,
  ScheduleResource,
  ScheduleShiftType,
  ScheduledJob,
  ScheduledJobsData,
  UpcomingEvent,
} from './calendar-types.js';
export {
  DEFAULT_RANGE_PRESETS,
  addDays,
  aggregateCategories,
  bindingSourceOf,
  daysBetween,
  isInRange,
  resolvePreset,
  upcomingFrom,
  type BindingSource,
} from './calendar-lib.js';
export {
  calendarLegendFilterDefinition,
  calendarMonthDefinition,
  calendarTrackDefinitions,
  capacityBoardDefinition,
  dateRangePickerDefinition,
  dayAgendaDefinition,
  scheduleMatrixDefinition,
  scheduledJobsListDefinition,
  upcomingEventsListDefinition,
} from './calendar-track.definitions.js';
