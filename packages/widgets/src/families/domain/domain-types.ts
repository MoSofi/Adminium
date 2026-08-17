// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Data-contract shapes for the `domain` family (annex §13).
 *
 * `org-chart` binds the canonical `hierarchy/tree` envelope (04 §3 —
 * `Tree { roots: TreeNode[] }`, `TreeNode { id, label, meta?, children[] }`),
 * and ALSO tolerates the flat self-referencing `record-list` a real people table
 * actually returns (`manager_id → id`), adapting it to a tree at the component
 * boundary. `gantt-chart` binds a `record-list` of task rows carrying start/end
 * (+ optional progress / phase / owner) columns — §3 has no gantt-specific
 * envelope, and the annex derives the phase→tasks grouping "from start/end date
 * columns + progress + phase FK", which is exactly a record-list projection.
 *
 * Both envelopes carry `total` so the host's shared `isEmptyByShape` predicate
 * routes the empty state on it (the `calendar` family carries resource payloads
 * in a record-list envelope for the same reason — see calendar-types.ts).
 */

// --- org-chart (`hierarchy/tree`) ---------------------------------------------

/** Per-person detail hung off a `TreeNode` (04 §3 `meta`); annex §13 fields. */
export interface OrgNodeMeta {
  /** Job title — "VP Engineering". */
  role?: string | undefined;
  /** Department, drives the dept chip + node tone. */
  dept?: string | undefined;
  /** Avatar image URL; absent → `Avatar` renders deterministic initials. */
  avatar?: string | undefined;
  /** Explicit tone override; else derived from `dept`. */
  tone?: string | undefined;
}

/** One person in the reporting tree (04 §3 `TreeNode`). */
export interface OrgNode {
  id: string;
  label: string;
  meta?: OrgNodeMeta | undefined;
  children: OrgNode[];
}

/**
 * The `hierarchy/tree` envelope. `total` = node count across all roots — present
 * so `isEmptyByShape['record-list']` also reads a `{ roots: [], total: 0 }`
 * payload as empty (the widget declares both shapes; see domain-track.definitions.ts).
 */
export interface OrgTreeData {
  roots: OrgNode[];
  total: number;
}

// --- gantt-chart (`record-list`) ----------------------------------------------

/**
 * One task row as it arrives from the server (`record-list` `rows[]`). Field
 * NAMES are config-driven (`labelField`, `startField`, …); this interface is the
 * post-resolution normalized view the geometry works on.
 */
export interface GanttTask {
  id: string;
  label: string;
  /** Whole days from the chart origin (0 = the first day of the window). */
  startDay: number;
  /** Duration in whole days; always >= 1 so a bar is never zero-width. */
  durDays: number;
  /** Completion percentage, clamped 0–100. */
  pct: number;
  /** Owner initials/short label rendered at the bar's inline-end. */
  owner?: string | undefined;
  /** Zero-duration checkpoint — rendered as a 45° diamond, not a bar. */
  milestone?: boolean | undefined;
}

/** Tasks grouped by the phase FK, with a summary bar spanning the group. */
export interface GanttGroup {
  key: string;
  name: string;
  /** Semantic tone driving the group's bar color. */
  tone: string;
  tasks: GanttTask[];
}

/** The normalized gantt model the component renders (derived, never bound). */
export interface GanttModel {
  groups: GanttGroup[];
  /** Total days spanned by the time axis. */
  totalDays: number;
  /** UTC epoch ms of day 0 — the axis origin. */
  originMs: number;
  /** Day offset of the today marker, or null when it falls outside the window. */
  todayDay: number | null;
}

/** The `record-list` envelope gantt binds (04 §3 `RecordList`). */
export interface GanttData {
  rows: Record<string, unknown>[];
  total: number;
}
