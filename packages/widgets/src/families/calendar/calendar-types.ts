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

// --- upcoming-events-list -----------------------------------------------------

/**
 * An upcoming event row (annex §5: "date block, mono version/ref, category pill,
 * owner avatar, status pill, colored left border"). A superset of
 * `CalendarEvent` — the same `calendar-events` payload drives the month grid and
 * this feed, so a release row's `ref`/`owner`/`status` are optional additions
 * rather than a second contract.
 */
export interface UpcomingEvent extends CalendarEvent {
  /** Mono version/reference string ("v2.4.0", "REL-118"). */
  ref?: string | undefined;
  owner?: string | undefined;
  /** Workflow status ("Scheduled", "At risk", "Shipped"). */
  status?: string | undefined;
  statusTone?: string | undefined;
}

// --- scheduled-jobs-list ------------------------------------------------------

/**
 * One recurring job (annex §5: "icon tile, name + format badge, meta (target ·
 * human cadence string), recipient avatar stack, Next run column, on/off switch").
 *
 * `frequency` is the ALREADY-HUMANIZED cadence string: cron → prose is a
 * host/server concern (it needs the schedule's timezone and the viewer's
 * locale), so the widget renders what it is given rather than parsing a cron
 * expression in the browser.
 */
export interface ScheduledJob {
  id: string | number;
  name: string;
  /** What the job targets (a table, a view, a saved report). */
  target?: string | undefined;
  /** Human cadence ("Every Monday at 09:00"), pre-formatted by the host. */
  frequency?: string | undefined;
  /** Output format badge (CSV, PDF, XLSX…). */
  format?: string | undefined;
  /** ISO instant of the next run; rendered through the Intl layer. */
  next?: string | undefined;
  enabled?: boolean | undefined;
  recipients?: string[] | undefined;
  tone?: string | undefined;
}

export interface ScheduledJobsData {
  /** record-list rows = jobs (host `isEmpty` reads `total`). */
  rows: ScheduledJob[];
  columns?: unknown[];
  total: number;
}

// --- calendar-legend-filter ---------------------------------------------------

/** An aggregated event category with its count (annex §5 legend rows/chips). */
export interface EventCategory {
  name: string;
  count: number;
  tone?: string | undefined;
}

// --- date-range-picker --------------------------------------------------------

/** The picker's `form-state` value: an ISO day pair (either end may be unset). */
export interface DateRangeValue {
  /** `YYYY-MM-DD`, or null while the user is picking. */
  start: string | null;
  end: string | null;
}

/** A quick-range preset (annex: "quick presets (7d/30d/QTD…)"). */
export interface DateRangePreset {
  id: string;
  label: string;
  /** Days back from the reference day; `qtd`/`ytd`/`mtd` use `anchor` instead. */
  days?: number | undefined;
  /** Period-to-date anchor, resolved against the reference day. */
  anchor?: 'mtd' | 'qtd' | 'ytd' | undefined;
}
