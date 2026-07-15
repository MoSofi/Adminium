/**
 * Data-contract shapes for the `calendar` family (annex §5). `CalendarEvent`
 * mirrors the canonical `calendar-events` envelope (04 §3
 * `{ date, title, category?, time?, tone? }`); the scheduling widgets carry
 * resource-slot payloads inside a `record-list` envelope (rows = resources /
 * members, so the host's `isEmpty` predicate routes on `total`).
 */

/** One calendar event — a date (+ optional `HH:MM` time), title, and category. */
export interface CalendarEvent {
  id?: string | number | undefined;
  /** `YYYY-MM-DD` or a full ISO string; only the day is used for placement. */
  date: string;
  title: string;
  category?: string | undefined;
  /** 24-hour `HH:MM` start time (agenda + chip prefix). */
  time?: string | undefined;
  /** Explicit tone override; else derived from `category`. */
  tone?: string | undefined;
  /** Optional `HH:MM` end time (agenda time range). */
  end?: string | undefined;
}

// --- schedule-matrix ----------------------------------------------------------

/** A shift type: label, `HH:MM` window, credited hours, and a color tone. */
export interface ScheduleShiftType {
  id: string;
  label: string;
  start: string;
  end: string;
  hours: number;
  tone: string;
}

export interface ScheduleResource {
  id: string;
  name: string;
  role: string;
}

export interface ScheduleAssignment {
  resourceId: string;
  /** `YYYY-MM-DD` day key (one of `days`). */
  date: string;
  typeId: string;
}

export interface ScheduleMatrixData {
  /** record-list rows = resources (host `isEmpty` reads `total`). */
  rows: ScheduleResource[];
  columns?: unknown[];
  total: number;
  /** Ordered `YYYY-MM-DD` column keys. */
  days: string[];
  shiftTypes: ScheduleShiftType[];
  assignments: ScheduleAssignment[];
}

// --- capacity-board -----------------------------------------------------------

export interface CapacityAssignment {
  project: string;
  hours: number;
  tone?: string | undefined;
}

export interface CapacityMember {
  id: string;
  name: string;
  role: string;
  assignments: CapacityAssignment[];
}

export interface CapacityBoardData {
  /** record-list rows = members (host `isEmpty` reads `total`). */
  rows: CapacityMember[];
  columns?: unknown[];
  total: number;
}
