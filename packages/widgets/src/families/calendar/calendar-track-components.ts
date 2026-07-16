/**
 * `calendar` family TRACK CAL component barrel — the single lazy-import target
 * for this track's definitions, so the registry's metadata graph reaches the
 * @adminium/ui-heavy widget components only through a dynamic `import()`
 * boundary (one lazy chunk for the family, 04 §2.3). Mirrors the
 * kpi/charts/feeds `*-components` convention.
 */
export { CalendarMonthWidget } from './CalendarMonth.js';
export { DayAgendaWidget } from './DayAgenda.js';
export { ScheduleMatrixWidget } from './ScheduleMatrix.js';
export { CapacityBoardWidget } from './CapacityBoard.js';
// M7 Wave-4 TAIL — the four §5 widgets that complete the family.
export { CalendarLegendFilterWidget } from './CalendarLegendFilter.js';
export { UpcomingEventsListWidget } from './UpcomingEventsList.js';
export { DateRangePickerWidget } from './DateRangePicker.js';
export { ScheduledJobsListWidget } from './ScheduledJobsList.js';
