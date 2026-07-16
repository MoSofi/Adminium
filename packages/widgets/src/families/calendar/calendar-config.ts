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
  mulberry32,
  pickFrom,
  weekDays,
} from './calendar-lib.js';
import type {
  CalendarEvent,
  CapacityAssignment,
  CapacityBoardData,
  CapacityMember,
  ScheduleAssignment,
  ScheduleMatrixData,
  ScheduleResource,
  ScheduleShiftType,
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
