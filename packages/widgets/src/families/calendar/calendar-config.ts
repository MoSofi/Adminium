/**
 * `calendar` family config schemas + deterministic demo generators — PURE
 * module (zod, the shared config, the framework-light `calendar-lib` helpers
 * and `calendar-types` types only; no React, no component code).
 *
 * WHY THIS EXISTS: `registry/index.ts` statically imports
 * `calendar-track.definitions.ts`, so everything that module imports lands in
 * the registry's EAGER graph. While the schemas + demo payloads lived in
 * `CalendarMonth.tsx` / `DayAgenda.tsx` / `ScheduleMatrix.tsx` /
 * `CapacityBoard.tsx`, the definitions had to reach into those component
 * modules to name them — which pulled all four widgets and their @adminium/ui
 * deps into the eager chunk and left the sibling
 * `lazy(() => import('./calendar-track-components.js'))` refs buying nothing.
 * Holding them here (the boards/domain/media `*-config` convention) lets the
 * definitions import metadata only, so the components stay reachable
 * exclusively through the lazy barrel (04 §2.3, acceptance #3; enforced by
 * `qa/chunk-budget.test.ts`).
 *
 * The component files re-export these symbols, so the family barrel,
 * stories and tests keep their existing import points.
 */
import { z } from 'zod';

import {
  ANCHOR_TODAY,
  ANCHOR_YEAR,
  PERSONA_NAMES,
  addDays,
  mulberry32,
  pickFrom,
  resolvePreset,
  weekDays,
} from './calendar-lib.js';
import type {
  CalendarEvent,
  CapacityAssignment,
  CapacityBoardData,
  CapacityMember,
  DateRangeValue,
  ScheduleAssignment,
  ScheduleMatrixData,
  ScheduleResource,
  ScheduleShiftType,
  ScheduledJob,
  ScheduledJobsData,
  UpcomingEvent,
} from './calendar-types.js';
import { widgetSharedConfigSchema } from '../../registry/shared-config.js';

const toneEnum = z.enum(['neutral', 'accent', 'pos', 'warn', 'danger', 'info']);

// ── calendar-month (annex §5) ──────────────────────────────────────────────
export const calendarMonthConfigSchema = widgetSharedConfigSchema.extend({
  /** Displayed year; inferred from the events (or the demo anchor) when unset. */
  year: z.number().int().min(1970).max(3000).optional(),
  /** Displayed month, 0-based (0 = January). */
  month: z.number().int().min(0).max(11).optional(),
  /** Force the first weekday (ISO 1 = Mon … 7 = Sun); else locale-derived. */
  firstDayOfWeek: z.number().int().min(1).max(7).optional(),
  /** Max event chips before the day cell collapses to "+N more". */
  maxChipsPerDay: z.number().int().min(1).max(4).default(2),
  /** Category name → tone override map. */
  categoryColorMap: z.record(z.string(), toneEnum).optional(),
  emptyTitle: z.string().optional(),
  emptyBody: z.string().optional(),
});
export type CalendarMonthConfig = z.infer<typeof calendarMonthConfigSchema>;

const EVENT_POOL = [
  { title: 'Sprint planning', category: 'meeting', time: '09:00' },
  { title: 'Design review', category: 'meeting', time: '11:30' },
  { title: 'Release v2.4', category: 'release', time: '15:00' },
  { title: 'Contract deadline', category: 'deadline', time: '17:00' },
  { title: 'All-hands', category: 'meeting', time: '14:00' },
  { title: 'Security audit', category: 'deadline' },
  { title: 'Marketing launch', category: 'release', time: '10:00' },
  { title: 'Team offsite', category: 'event' },
  { title: '1:1 sync', category: 'meeting', time: '13:00' },
  { title: 'Data migration', category: 'deadline', time: '22:00' },
] as const;

/** Deterministic `calendar-events` payload anchored to the demo month (04 §7.7). */
export function calendarMonthDemoData(seed: number): { events: CalendarEvent[] } {
  const random = mulberry32(seed || 1);
  const events: CalendarEvent[] = [];
  const count = 10 + Math.floor(random() * 8);
  for (let i = 0; i < count; i += 1) {
    const day = 1 + Math.floor(random() * 28);
    const pick = pickFrom(random, EVENT_POOL);
    events.push({
      id: i + 1,
      date: `${ANCHOR_YEAR}-07-${String(day).padStart(2, '0')}`,
      title: pick.title,
      category: pick.category,
      ...(('time' in pick) ? { time: pick.time } : {}),
    });
  }
  return { events };
}

// ── day-agenda (annex §5) ──────────────────────────────────────────────────
export const dayAgendaConfigSchema = widgetSharedConfigSchema.extend({
  /** Selected ISO day; inferred from the events (or the demo anchor) when unset. */
  date: z.string().optional(),
  /** Agenda span: a single day or the whole (locale-aligned) week. */
  range: z.enum(['day', 'week']).default('day'),
  /** Force the first weekday for week mode (ISO 1 = Mon … 7 = Sun). */
  firstDayOfWeek: z.number().int().min(1).max(7).optional(),
  showCount: z.boolean().default(true),
  emptyTitle: z.string().optional(),
  emptyBody: z.string().optional(),
});
export type DayAgendaConfig = z.infer<typeof dayAgendaConfigSchema>;

const AGENDA_POOL = [
  { title: 'Standup', category: 'meeting', time: '09:00', end: '09:15' },
  { title: 'Design critique', category: 'meeting', time: '10:30', end: '11:30' },
  { title: 'Customer call', category: 'meeting', time: '13:00', end: '13:45' },
  { title: 'Release cutoff', category: 'deadline', time: '17:00' },
  { title: 'Roadmap review', category: 'meeting', time: '15:00', end: '16:00' },
  { title: 'Deploy window', category: 'release', time: '22:00', end: '23:00' },
  { title: 'Docs due', category: 'deadline' },
  { title: 'Lunch & learn', category: 'event', time: '12:00', end: '13:00' },
] as const;

/** Deterministic single-day `calendar-events` payload for the demo anchor day. */
export function dayAgendaDemoData(seed: number): { events: CalendarEvent[] } {
  const random = mulberry32(seed || 1);
  const count = 3 + Math.floor(random() * 4);
  const events: CalendarEvent[] = [];
  const used = new Set<number>();
  for (let i = 0; i < count; i += 1) {
    let index = Math.floor(random() * AGENDA_POOL.length);
    for (let guard = 0; guard < AGENDA_POOL.length && used.has(index); guard += 1) {
      index = (index + 1) % AGENDA_POOL.length;
    }
    used.add(index);
    const pick = AGENDA_POOL[index] ?? pickFrom(random, AGENDA_POOL);
    events.push({
      id: i + 1,
      date: ANCHOR_TODAY,
      title: pick.title,
      category: pick.category,
      ...(('time' in pick) ? { time: pick.time } : {}),
      ...(('end' in pick) ? { end: pick.end } : {}),
    });
  }
  return { events };
}

// ── schedule-matrix (annex §5) ─────────────────────────────────────────────
export const scheduleMatrixConfigSchema = widgetSharedConfigSchema.extend({
  /** Force the first weekday (ISO 1 = Mon … 7 = Sun); else locale-derived. */
  weekStart: z.number().int().min(1).max(7).optional(),
  /** Max shift chips before a day cell collapses to "+N". */
  maxPerCell: z.number().int().min(1).max(3).default(2),
  /** Target coverage per day used for the coverage micro-bars. */
  targetCoverage: z.number().int().min(1).max(20).optional(),
  showCoverage: z.boolean().default(true),
  showLegend: z.boolean().default(true),
  emptyTitle: z.string().optional(),
  emptyBody: z.string().optional(),
});
export type ScheduleMatrixConfig = z.infer<typeof scheduleMatrixConfigSchema>;

const SHIFT_TYPES: ScheduleShiftType[] = [
  { id: 'morning', label: 'Morning', start: '06:00', end: '14:00', hours: 8, tone: 'accent' },
  { id: 'day', label: 'Day', start: '09:00', end: '17:00', hours: 8, tone: 'info' },
  { id: 'evening', label: 'Evening', start: '14:00', end: '22:00', hours: 8, tone: 'pos' },
  { id: 'night', label: 'Night', start: '22:00', end: '06:00', hours: 8, tone: 'warn' },
];

/** Deterministic resource-schedule `record-list` payload for the demo week (04 §7.7). */
export function scheduleMatrixDemoData(seed: number): ScheduleMatrixData {
  const random = mulberry32(seed || 1);
  const resources: ScheduleResource[] = PERSONA_NAMES.slice(0, 6).map((name, i) => ({
    id: `r-${i + 1}`,
    name,
    role: (['Barista', 'Shift lead', 'Server', 'Cook', 'Host', 'Cashier'] as const)[i] ?? 'Staff',
  }));
  const week = weekDays(`${ANCHOR_YEAR}-07-13`, 0); // anchor week starting Sunday
  const days = week.map((d) => d.key);
  const assignments: ScheduleAssignment[] = [];
  for (const resource of resources) {
    for (const day of days) {
      // ~65% chance of a shift; occasionally two on a day.
      if (random() < 0.65) {
        assignments.push({ resourceId: resource.id, date: day, typeId: (SHIFT_TYPES[Math.floor(random() * SHIFT_TYPES.length)] as ScheduleShiftType).id });
        if (random() < 0.15) {
          assignments.push({ resourceId: resource.id, date: day, typeId: (SHIFT_TYPES[Math.floor(random() * SHIFT_TYPES.length)] as ScheduleShiftType).id });
        }
      }
    }
  }
  return { rows: resources, total: resources.length, days, shiftTypes: SHIFT_TYPES, assignments };
}

// ── capacity-board (annex §5) ──────────────────────────────────────────────
export const capacityBoardConfigSchema = widgetSharedConfigSchema.extend({
  /** Hours of capacity per period (the 100% mark). */
  capacity: z.number().int().min(1).max(400).default(40),
  period: z.enum(['week', 'month']).default('week'),
  /** Below this util % a member is "Available". */
  availableBelow: z.number().int().min(1).max(100).default(75),
  /** Above this util % a member is "Overloaded". */
  overloadedAbove: z.number().int().min(1).max(300).default(100),
  showLegend: z.boolean().default(true),
  emptyTitle: z.string().optional(),
  emptyBody: z.string().optional(),
});
export type CapacityBoardConfig = z.infer<typeof capacityBoardConfigSchema>;

const PROJECTS = [
  { name: 'Platform', tone: 'accent' },
  { name: 'Mobile app', tone: 'info' },
  { name: 'Data migration', tone: 'pos' },
  { name: 'Infra', tone: 'warn' },
  { name: 'Redesign', tone: 'danger' },
] as const;

/** Deterministic member-capacity `record-list` payload (04 §7.7). */
export function capacityBoardDemoData(seed: number): CapacityBoardData {
  const random = mulberry32(seed || 1);
  const rows: CapacityMember[] = PERSONA_NAMES.slice(0, 6).map((name, i) => {
    const projectCount = 1 + Math.floor(random() * 3);
    const assignments: CapacityAssignment[] = [];
    const used = new Set<number>();
    for (let p = 0; p < projectCount; p += 1) {
      let index = Math.floor(random() * PROJECTS.length);
      for (let guard = 0; guard < PROJECTS.length && used.has(index); guard += 1) index = (index + 1) % PROJECTS.length;
      used.add(index);
      const project = PROJECTS[index] as (typeof PROJECTS)[number];
      assignments.push({ project: project.name, hours: 6 + Math.floor(random() * 16), tone: project.tone });
    }
    return {
      id: `m-${i + 1}`,
      name,
      role: (['Engineer', 'Designer', 'PM', 'Engineer', 'Analyst', 'Engineer'] as const)[i] ?? 'Contributor',
      assignments,
    };
  });
  return { rows, total: rows.length };
}

// ── calendar-legend-filter (annex §5) ──────────────────────────────────────
export const calendarLegendFilterConfigSchema = widgetSharedConfigSchema.extend({
  /** Toggling a category filters the sibling calendar (annex `toggleable`). */
  toggleable: z.boolean().default(true),
  /** Rows (checkbox + label + count) or a compact chip strip (annex "rows or chips"). */
  variant: z.enum(['rows', 'chips']).default('rows'),
  /** Category name → tone override map, shared with `calendar-month`. */
  categoryColorMap: z.record(z.string(), toneEnum).optional(),
  /** Categories hidden on first render; the rest start checked. */
  defaultHidden: z.array(z.string()).default([]),
  /**
   * Sibling calendar instance this legend filters (annex: "toggling filters the
   * calendar"). The widget emits the hidden set; the host owns the cross-widget
   * wiring — a widget never reaches into another widget.
   */
  linkTarget: z.string().optional(),
  /** Bucket label for events with no category. */
  uncategorizedLabel: z.string().optional(),
  emptyTitle: z.string().optional(),
  emptyBody: z.string().optional(),
});
export type CalendarLegendFilterConfig = z.infer<typeof calendarLegendFilterConfigSchema>;

const LEGEND_POOL = [
  { title: 'Sprint planning', category: 'meeting' },
  { title: 'Release v2.4', category: 'release' },
  { title: 'Contract deadline', category: 'deadline' },
  { title: 'Team offsite', category: 'event' },
  { title: 'Maintenance window', category: 'maintenance' },
] as const;

/**
 * Deterministic `calendar-events` payload the legend aggregates (04 §7.7). Same
 * contract as `calendar-month` — the legend is a VIEW of the calendar's events,
 * not a second query, so it binds to the identical payload.
 */
export function calendarLegendFilterDemoData(seed: number): { events: CalendarEvent[] } {
  const random = mulberry32(seed || 1);
  const count = 12 + Math.floor(random() * 10);
  const events: CalendarEvent[] = [];
  for (let i = 0; i < count; i += 1) {
    const pick = pickFrom(random, LEGEND_POOL);
    const day = 1 + Math.floor(random() * 28);
    events.push({
      id: i + 1,
      date: `${ANCHOR_YEAR}-07-${String(day).padStart(2, '0')}`,
      title: pick.title,
      category: pick.category,
    });
  }
  return { events };
}

// ── upcoming-events-list (annex §5) ────────────────────────────────────────
export const upcomingEventsListConfigSchema = widgetSharedConfigSchema.extend({
  /** Next-N events (annex `n`). */
  n: z.number().int().min(1).max(50).default(6),
  /** Category name → tone override map (drives the row's start border). */
  categoryColorMap: z.record(z.string(), toneEnum).optional(),
  showOwner: z.boolean().default(true),
  showStatus: z.boolean().default(true),
  /**
   * Reference day (`YYYY-MM-DD`) for the "date ≥ today" cutoff. Unset → the
   * shared `format.referenceTime` clock, else the wall clock. Pinning it is what
   * makes a VRT capture of this widget byte-stable (04 §7.7).
   */
  fromDate: z.string().optional(),
  emptyTitle: z.string().optional(),
  emptyBody: z.string().optional(),
});
export type UpcomingEventsListConfig = z.infer<typeof upcomingEventsListConfigSchema>;

const RELEASE_POOL: readonly { title: string; category: string; status: string; statusTone: string }[] = [
  { title: 'Billing service', category: 'release', status: 'Scheduled', statusTone: 'info' },
  { title: 'Dashboard redesign', category: 'release', status: 'At risk', statusTone: 'warn' },
  { title: 'Search reindex', category: 'maintenance', status: 'Scheduled', statusTone: 'info' },
  { title: 'SSO rollout', category: 'release', status: 'Blocked', statusTone: 'danger' },
  { title: 'Quarterly review', category: 'meeting', status: 'Confirmed', statusTone: 'pos' },
  { title: 'Data retention sweep', category: 'maintenance', status: 'Scheduled', statusTone: 'info' },
  { title: 'API v2 deprecation', category: 'deadline', status: 'Confirmed', statusTone: 'pos' },
  { title: 'Mobile hotfix', category: 'release', status: 'Scheduled', statusTone: 'info' },
];

/**
 * Deterministic forward-looking `calendar-events` payload (04 §7.7). Every event
 * lands on or after the demo anchor day so the widget's "date ≥ today" cutoff
 * keeps rows on screen for a story/VRT capture pinned to the anchor.
 */
export function upcomingEventsListDemoData(seed: number): { events: UpcomingEvent[] } {
  const random = mulberry32(seed || 1);
  let day = ANCHOR_TODAY;
  const events: UpcomingEvent[] = RELEASE_POOL.map((pick, index) => {
    day = addDays(day, index === 0 ? 0 : 1 + Math.floor(random() * 6));
    return {
      id: index + 1,
      date: day,
      title: pick.title,
      category: pick.category,
      time: `${String(9 + Math.floor(random() * 9)).padStart(2, '0')}:00`,
      ref: `v${2 + Math.floor(random() * 2)}.${index}.0`,
      owner: pickFrom(random, PERSONA_NAMES),
      status: pick.status,
      statusTone: pick.statusTone,
    };
  });
  return { events };
}

// ── date-range-picker (annex §5) ───────────────────────────────────────────
const rangePresetSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  days: z.number().int().min(1).max(3650).optional(),
  anchor: z.enum(['mtd', 'qtd', 'ytd']).optional(),
});

export const dateRangePickerConfigSchema = widgetSharedConfigSchema.extend({
  /**
   * Quick presets (annex `presets`). Labels are host-translated strings, the
   * same contract the boards family's announcements use — unset falls back to
   * the family's English `DEFAULT_RANGE_PRESETS`.
   */
  presets: z.array(rangePresetSchema).optional(),
  /** Max selectable span in days (annex `maxRange`); longer picks are clamped. */
  maxRange: z.number().int().min(1).max(3650).optional(),
  /** Force the first weekday (ISO 1 = Mon … 7 = Sun); else locale-derived. */
  firstDayOfWeek: z.number().int().min(1).max(7).optional(),
  /** Reference "today" (`YYYY-MM-DD`) the presets resolve against. */
  referenceDate: z.string().optional(),
  showPresets: z.boolean().default(true),
  showSummary: z.boolean().default(true),
});
export type DateRangePickerConfig = z.infer<typeof dateRangePickerConfigSchema>;

/**
 * Deterministic `form-state` payload — a resolved day pair (04 §7.7). The seed
 * picks which default preset the demo lands on, so the payload threads its seed
 * (the determinism gate) while every value stays anchored to the fixed demo
 * epoch rather than a wall-clock read.
 */
export function dateRangePickerDemoData(seed: number): { value: DateRangeValue } {
  const random = mulberry32(seed || 1);
  const spans = [7, 14, 30, 90] as const;
  const days = pickFrom(random, spans);
  const { start, end } = resolvePreset({ days }, ANCHOR_TODAY);
  return { value: { start, end } };
}

// ── scheduled-jobs-list (annex §5) ─────────────────────────────────────────
export const scheduledJobsListConfigSchema = widgetSharedConfigSchema.extend({
  /** Row field driving the on/off switch (annex `toggleField`). */
  toggleField: z.string().default('enabled'),
  /** Row-mapping overrides (annex `rowMapping`) — the source column per slot. */
  nameField: z.string().default('name'),
  targetField: z.string().default('target'),
  frequencyField: z.string().default('frequency'),
  formatField: z.string().default('format'),
  nextRunField: z.string().default('next'),
  recipientsField: z.string().default('recipients'),
  /** Render the on/off switch (annex); read-only pages hide it. */
  toggleable: z.boolean().default(true),
  showRecipients: z.boolean().default(true),
  nextRunLabel: z.string().optional(),
  toggleLabel: z.string().optional(),
  emptyTitle: z.string().optional(),
  emptyBody: z.string().optional(),
});
export type ScheduledJobsListConfig = z.infer<typeof scheduledJobsListConfigSchema>;

const JOB_POOL: readonly { name: string; target: string; frequency: string; format: string }[] = [
  { name: 'Weekly revenue digest', target: 'public.invoices', frequency: 'Every Monday at 09:00', format: 'PDF' },
  { name: 'Churn cohort export', target: 'public.subscriptions', frequency: 'Every 1st of the month', format: 'CSV' },
  { name: 'Support SLA report', target: 'public.tickets', frequency: 'Every weekday at 08:00', format: 'XLSX' },
  { name: 'Audit log archive', target: 'public.audit_log', frequency: 'Every day at 02:00', format: 'CSV' },
  { name: 'Signup funnel snapshot', target: 'public.sessions', frequency: 'Every Friday at 17:00', format: 'PDF' },
  { name: 'Inventory reconciliation', target: 'public.products', frequency: 'Every 6 hours', format: 'CSV' },
];

/** Deterministic recurring-job `record-list` payload (04 §7.7). */
export function scheduledJobsListDemoData(seed: number): ScheduledJobsData {
  const random = mulberry32(seed || 1);
  const rows: ScheduledJob[] = JOB_POOL.map((job, index) => {
    const recipientCount = 1 + Math.floor(random() * 3);
    return {
      id: `job-${index + 1}`,
      name: job.name,
      target: job.target,
      frequency: job.frequency,
      format: job.format,
      // Fixed epoch, never `Date.now()` — the anchor day plus a seeded offset.
      next: `${addDays(ANCHOR_TODAY, 1 + Math.floor(random() * 7))}T09:00:00.000Z`,
      enabled: random() > 0.25,
      recipients: PERSONA_NAMES.slice(0, recipientCount).map((name) => name),
    };
  });
  return { rows, total: rows.length };
}
