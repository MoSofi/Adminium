// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Shared PURE helpers for the `domain` family (annex §13) — a deterministic
 * seeded PRNG, tone coercion, the cycle-safe self-FK → tree adapter + tidy-tree
 * layout behind `org-chart`, and the time-axis geometry behind `gantt-chart`.
 *
 * DOM-free and React-free on purpose: every layout decision is a pure function
 * of its inputs, so the geometry is golden-testable (04-T17 determinism gate)
 * and the definitions module can import the demo generators without dragging
 * component code into the eager registry chunk (04 §2.3).
 *
 * DIRECTION POLICY (10-i18n-theming.md §5.5) — the two widgets sit on OPPOSITE
 * sides of the mirroring rule, and this module keeps both honest by emitting
 * LTR-canonical geometry in both cases:
 *
 *   - `org-chart` is a hierarchy, not a time axis → it MIRRORS. The layout below
 *     is canonical-LTR and the component maps it onto `inset-inline-start`, so
 *     the browser mirrors the tree under `dir="rtl"` (the same logical-CSS
 *     mechanism the `calendar` family relies on for its month grid).
 *   - `gantt-chart` is a time axis → it does NOT mirror. Per §5.5 the timeline
 *     canvas is a **fixed-LTR island** ("time flows left→right … the label
 *     column stays physically left of the canvas so labels align with the time
 *     origin"); only the surrounding chrome mirrors. `@adminium/charts` already
 *     encodes this for `chart-timeline-lanes` (geometry/timelineLanes.ts: "The
 *     time axis is an LTR island … so event x-positions are LTR here").
 */
import type { Tone } from '@adminium/ui';

import type { GanttGroup, GanttModel, GanttTask, OrgNode } from './domain-types.js';

// --- determinism primitives ---------------------------------------------------

/** Mulberry32 — the repo's deterministic seeded PRNG (see boards/calendar/feeds). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic pick from a non-empty tuple. */
export function pickFrom<T>(random: () => number, items: readonly T[]): T {
  return items[Math.floor(random() * items.length) % items.length] as T;
}

/**
 * Fixed demo anchor — 2026-07-01T00:00:00Z. `demoData(seed)` derives every date
 * from this constant so payloads are byte-identical across runs and never read
 * the wall clock (04 §7.7 / determinism gate).
 */
export const DOMAIN_DEMO_EPOCH = Date.UTC(2026, 6, 1);

/** Milliseconds in a whole day — the gantt axis unit. */
export const DAY_MS = 86_400_000;

// --- tone helpers -------------------------------------------------------------

const KNOWN_TONES: ReadonlySet<string> = new Set(['neutral', 'accent', 'pos', 'warn', 'danger', 'info']);

/** Coerce an untrusted tone string to a valid `Tone`, defaulting as given. */
export function toneOf(value: unknown, fallback: Tone = 'accent'): Tone {
  return typeof value === 'string' && KNOWN_TONES.has(value) ? (value as Tone) : fallback;
}

/** Stable FNV-1a-ish hash of a string → index into a palette. */
export function hashIndex(value: string, modulo: number): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return modulo <= 0 ? 0 : hash % modulo;
}

const TONE_CYCLE: readonly Tone[] = ['accent', 'info', 'pos', 'warn', 'danger', 'neutral'];

/**
 * Tone for a category (department / phase), honoring an explicit map, else a
 * stable hashed cycle — the same category always draws the same color.
 */
export function categoryTone(category: string | undefined, map?: Record<string, string> | undefined): Tone {
  if (category === undefined || category === '') return 'accent';
  const explicit = map?.[category];
  if (explicit !== undefined) return toneOf(explicit);
  return TONE_CYCLE[hashIndex(category, TONE_CYCLE.length)] as Tone;
}

/** Tone → solid background (bars, dots, connectors). */
export const TONE_SOLID_BG: Record<Tone, string> = {
  neutral: 'bg-fg-subtle',
  accent: 'bg-accent',
  pos: 'bg-pos',
  warn: 'bg-warn',
  danger: 'bg-danger',
  info: 'bg-info',
};

/** Tone → soft tint + tone text (dept chips, group summary bars). */
export const TONE_SOFT: Record<Tone, string> = {
  neutral: 'bg-surface-3 text-fg-muted',
  accent: 'bg-accent-soft text-accent',
  pos: 'bg-pos-soft text-pos',
  warn: 'bg-warn-soft text-warn',
  danger: 'bg-danger-soft text-danger',
  info: 'bg-info-soft text-info',
};

/** Tone → border color only (node card top rule / tinted report cards). */
export const TONE_BORDER: Record<Tone, string> = {
  neutral: 'border-fg-subtle',
  accent: 'border-accent',
  pos: 'border-pos',
  warn: 'border-warn',
  danger: 'border-danger',
  info: 'border-info',
};

// --- shared payload narrowing -------------------------------------------------

type Rec = Record<string, unknown>;

export function asRecord(value: unknown): Rec | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Rec) : null;
}

/** Read a field as a trimmed string; undefined when absent/blank. */
export function stringField(row: Rec, field: string): string | undefined {
  const value = row[field];
  if (typeof value === 'string' && value.trim() !== '') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

/** Read a field as a finite number; undefined when unparseable. */
export function numberField(row: Rec, field: string): number | undefined {
  const value = row[field];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

/**
 * Coalesce an empty/whitespace locale to `en-US` — a schema-valid
 * `format.locale: ''` otherwise reaches `Avatar`'s `toLocaleUpperCase('')`,
 * which throws `RangeError` (see calendar-lib.ts for the same guard).
 */
export function resolveLocale(locale: string | undefined): string {
  return locale !== undefined && locale.trim() !== '' ? locale : 'en-US';
}

// =============================================================================
// org-chart — self-FK adaptation + tidy-tree layout
// =============================================================================

/** Field names that map a flat self-FK people row onto an `OrgNode`. */
export interface OrgFieldMap {
  idField: string;
  parentField: string;
  labelField: string;
  roleField?: string | undefined;
  deptField?: string | undefined;
  avatarField?: string | undefined;
  toneField?: string | undefined;
}

/**
 * Adapt a FLAT self-referencing people `record-list` (`manager_id → id`) into
 * the canonical `hierarchy/tree` roots.
 *
 * CYCLE SAFETY (a hard requirement — a corrupt `manager_id` cycle must never
 * hang the render): the walk is structurally incapable of looping.
 *   1. Self-edges (`manager_id === id`) are dropped up front.
 *   2. Edges to a non-existent manager are dropped — that row becomes a root.
 *   3. Roots are the rows left with no surviving parent edge; each is expanded
 *      by a DFS that marks nodes `visited` BEFORE recursing, so a back-edge into
 *      an already-visited node is skipped rather than followed.
 *   4. Any row still unvisited after the root pass is, by construction, inside a
 *      cycle (or hanging off one). Those are promoted to roots in stable input
 *      order and expanded by the same guarded DFS.
 * Every row therefore renders EXACTLY once, and termination is guaranteed
 * because each DFS step consumes an unvisited node from a finite set.
 */
export function buildOrgTree(rows: readonly Rec[], fields: OrgFieldMap): { roots: OrgNode[]; total: number } {
  const byId = new Map<string, Rec>();
  const order: string[] = [];
  for (const row of rows) {
    const id = stringField(row, fields.idField);
    if (id === undefined || byId.has(id)) continue; // last-wins would reorder; first-wins is stable
    byId.set(id, row);
    order.push(id);
  }

  // Surviving parent edges only (rules 1 + 2).
  const parentOf = new Map<string, string>();
  const childrenOf = new Map<string, string[]>();
  for (const id of order) {
    const row = byId.get(id) as Rec;
    const parent = stringField(row, fields.parentField);
    if (parent === undefined || parent === id || !byId.has(parent)) continue;
    parentOf.set(id, parent);
    const siblings = childrenOf.get(parent);
    if (siblings === undefined) childrenOf.set(parent, [id]);
    else siblings.push(id);
  }

  const visited = new Set<string>();

  const expand = (id: string): OrgNode => {
    visited.add(id); // marked BEFORE recursing — back-edges can never re-enter
    const row = byId.get(id) as Rec;
    const children: OrgNode[] = [];
    for (const childId of childrenOf.get(id) ?? []) {
      if (visited.has(childId)) continue; // cycle back-edge — skip, never follow
      children.push(expand(childId));
    }
    return toOrgNode(id, row, fields, children);
  };

  const roots: OrgNode[] = [];
  for (const id of order) {
    if (!parentOf.has(id) && !visited.has(id)) roots.push(expand(id));
  }
  // Rule 4 — rows only reachable through a cycle still get rendered, as roots.
  for (const id of order) {
    if (!visited.has(id)) roots.push(expand(id));
  }

  return { roots, total: visited.size };
}

function toOrgNode(id: string, row: Rec, fields: OrgFieldMap, children: OrgNode[]): OrgNode {
  const meta: Record<string, string | undefined> = {};
  if (fields.roleField !== undefined) meta.role = stringField(row, fields.roleField);
  if (fields.deptField !== undefined) meta.dept = stringField(row, fields.deptField);
  if (fields.avatarField !== undefined) meta.avatar = stringField(row, fields.avatarField);
  if (fields.toneField !== undefined) meta.tone = stringField(row, fields.toneField);
  const hasMeta = Object.values(meta).some((value) => value !== undefined);
  return {
    id,
    label: stringField(row, fields.labelField) ?? id,
    ...(hasMeta ? { meta } : {}),
    children,
  };
}

/**
 * Read an `org-chart` payload into tree roots, accepting BOTH shapes the widget
 * declares: the canonical `hierarchy/tree` envelope (`{ roots }`) and the flat
 * self-FK `record-list` (`{ rows }`) a real people table returns.
 */
export function orgRootsOf(data: unknown, fields: OrgFieldMap): { roots: OrgNode[]; total: number } {
  const source = asRecord(data);
  if (source === null) return { roots: [], total: 0 };

  if (Array.isArray(source.roots)) {
    const roots = sanitizeNodes(source.roots as unknown[], new Set());
    return { roots, total: countNodes(roots) };
  }
  if (Array.isArray(source.rows)) {
    return buildOrgTree(source.rows as Rec[], fields);
  }
  return { roots: [], total: 0 };
}

/**
 * Defensively re-shape an untrusted `hierarchy/tree` payload. A server-supplied
 * tree can also carry a cycle (a node re-listed under its own descendant, or a
 * shared object reference), so the same visited-set guard applies here.
 */
function sanitizeNodes(values: readonly unknown[], seen: Set<string>): OrgNode[] {
  const out: OrgNode[] = [];
  for (const value of values) {
    const node = asRecord(value);
    if (node === null) continue;
    const id = typeof node.id === 'string' ? node.id : typeof node.id === 'number' ? String(node.id) : undefined;
    if (id === undefined || seen.has(id)) continue;
    seen.add(id);
    const meta = asRecord(node.meta);
    const children = Array.isArray(node.children) ? sanitizeNodes(node.children as unknown[], seen) : [];
    out.push({
      id,
      label: typeof node.label === 'string' ? node.label : id,
      ...(meta === null
        ? {}
        : {
            meta: {
              role: typeof meta.role === 'string' ? meta.role : undefined,
              dept: typeof meta.dept === 'string' ? meta.dept : undefined,
              avatar: typeof meta.avatar === 'string' ? meta.avatar : undefined,
              tone: typeof meta.tone === 'string' ? meta.tone : undefined,
            },
          }),
      children,
    });
  }
  return out;
}

/** Total node count across a forest. */
export function countNodes(roots: readonly OrgNode[]): number {
  let total = 0;
  for (const root of roots) total += 1 + countNodes(root.children);
  return total;
}

// --- tidy-tree layout ---------------------------------------------------------

export interface OrgLayoutOptions {
  /** Node card width in px. */
  nodeWidth?: number;
  /** Node card height in px. */
  nodeHeight?: number;
  /** Horizontal gap between sibling subtrees, px. */
  hGap?: number;
  /** Vertical gap between depth bands, px. */
  vGap?: number;
  /** Depth beyond which nodes are pruned (root = depth 0). */
  maxDepth?: number;
  /** Ids whose subtree is collapsed (children laid out as if absent). */
  collapsed?: ReadonlySet<string>;
}

export interface OrgLayoutNode {
  node: OrgNode;
  id: string;
  depth: number;
  /** Top-inline-start corner of the card, in canonical-LTR px. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Has children in the DATA (may be hidden by collapse/maxDepth). */
  hasChildren: boolean;
  /** Direct-report count — the "N reports" footer. */
  childCount: number;
  /** Subtree hidden because this node is collapsed or at `maxDepth`. */
  collapsed: boolean;
  /**
   * Subtree hidden by the `maxDepth` cap rather than by the user. Such a node
   * can NEVER expand — toggling its collapsed state is a no-op — so the caller
   * must not offer an expand affordance or advertise `aria-expanded` on it.
   */
  pruned: boolean;
}

export interface OrgConnector {
  parentId: string;
  childId: string;
  /** SVG elbow path in canonical-LTR coordinates. */
  d: string;
}

export interface OrgLayout {
  nodes: OrgLayoutNode[];
  connectors: OrgConnector[];
  /** Canvas extents in px. */
  width: number;
  height: number;
}

const DEFAULTS = { nodeWidth: 168, nodeHeight: 104, hGap: 20, vGap: 44 } as const;

/**
 * Deterministic tidy-tree layout — a classic two-pass layered algorithm, no
 * external lib:
 *   pass 1 (post-order): leaves consume successive x slots; an internal node is
 *           centered over the span of its laid-out children.
 *   pass 2: y = depth · (nodeHeight + vGap) — a strict layered band per depth.
 * Multiple roots lay out left-to-right in input order, so a forest (several CEOs
 * / an orphan set / a broken cycle promoted to roots) renders side by side.
 *
 * Output is CANONICAL-LTR (see the direction policy at the top of this file);
 * the component maps `x` onto `inset-inline-start` and lets the browser mirror
 * the whole tree under `dir="rtl"`.
 *
 * Pure: same input → byte-identical output, no clock, no RNG, no DOM.
 */
export function layoutOrgTree(roots: readonly OrgNode[], options: OrgLayoutOptions = {}): OrgLayout {
  const nodeWidth = options.nodeWidth ?? DEFAULTS.nodeWidth;
  const nodeHeight = options.nodeHeight ?? DEFAULTS.nodeHeight;
  const hGap = options.hGap ?? DEFAULTS.hGap;
  const vGap = options.vGap ?? DEFAULTS.vGap;
  const maxDepth = options.maxDepth ?? Number.POSITIVE_INFINITY;
  const collapsed = options.collapsed ?? new Set<string>();

  const nodes: OrgLayoutNode[] = [];
  const connectors: OrgConnector[] = [];
  let cursor = 0; // next free leaf slot, in px

  const place = (node: OrgNode, depth: number): OrgLayoutNode => {
    const isPruned = depth >= maxDepth;
    const isCollapsed = collapsed.has(node.id) || isPruned;
    const visibleChildren = isCollapsed ? [] : node.children;

    const laidOutChildren = visibleChildren.map((child) => place(child, depth + 1));

    let x: number;
    if (laidOutChildren.length === 0) {
      x = cursor;
      cursor += nodeWidth + hGap;
    } else {
      const first = laidOutChildren[0] as OrgLayoutNode;
      const last = laidOutChildren[laidOutChildren.length - 1] as OrgLayoutNode;
      x = (first.x + last.x) / 2;
    }

    const entry: OrgLayoutNode = {
      node,
      id: node.id,
      depth,
      x,
      y: depth * (nodeHeight + vGap),
      width: nodeWidth,
      height: nodeHeight,
      hasChildren: node.children.length > 0,
      childCount: node.children.length,
      collapsed: isCollapsed && node.children.length > 0,
      pruned: isPruned && node.children.length > 0,
    };
    nodes.push(entry);

    for (const child of laidOutChildren) {
      connectors.push({
        parentId: entry.id,
        childId: child.id,
        d: elbowPath(entry, child, nodeWidth, nodeHeight, vGap),
      });
    }
    return entry;
  };

  for (const root of roots) place(root, 0);

  const maxX = nodes.reduce((max, n) => Math.max(max, n.x + n.width), 0);
  const maxY = nodes.reduce((max, n) => Math.max(max, n.y + n.height), 0);
  // `nodes` comes out in post-order; sort to a stable depth-then-x reading order
  // so the DOM (and any snapshot) is deterministic and tab order reads top-down.
  nodes.sort((a, b) => a.depth - b.depth || a.x - b.x || (a.id < b.id ? -1 : 1));
  return { nodes, connectors, width: maxX, height: maxY };
}

/**
 * Elbow connector: down out of the parent's bottom-center, across the mid-band,
 * then down into the child's top-center — the design port's CSS elbow, as one
 * SVG path (canonical-LTR).
 */
function elbowPath(
  parent: OrgLayoutNode,
  child: OrgLayoutNode,
  nodeWidth: number,
  nodeHeight: number,
  vGap: number,
): string {
  const px = round2(parent.x + nodeWidth / 2);
  const py = round2(parent.y + nodeHeight);
  const cx = round2(child.x + nodeWidth / 2);
  const cy = round2(child.y);
  const midY = round2(py + vGap / 2);
  return `M ${px} ${py} L ${px} ${midY} L ${cx} ${midY} L ${cx} ${cy}`;
}

/** 2-dp rounding — keeps emitted path strings byte-stable across platforms. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

// =============================================================================
// gantt-chart — time-axis geometry (canonical LTR; never mirrored)
// =============================================================================

/** Field names mapping a task `record-list` row onto the gantt model. */
export interface GanttFieldMap {
  idField: string;
  labelField: string;
  startField: string;
  endField: string;
  progressField?: string | undefined;
  phaseField?: string | undefined;
  ownerField?: string | undefined;
  milestoneField?: string | undefined;
}

/** Parse an ISO date/datetime (or epoch ms) to an epoch-ms instant. */
export function parseDateMs(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isNaN(ms) ? undefined : ms;
  }
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  const raw = value.trim();
  // Date-only strings parse as UTC midnight; datetimes keep their own offset.
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T00:00:00.000Z` : raw;
  const ms = new Date(iso).getTime();
  return Number.isNaN(ms) ? undefined : ms;
}

/** Whole days between two epoch-ms instants (floor toward the origin). */
export function dayOffset(ms: number, originMs: number): number {
  return Math.floor((ms - originMs) / DAY_MS);
}

export interface GanttModelOptions {
  /** Force the axis length; else derived from the data span. */
  totalDays?: number | undefined;
  /** Epoch ms for the today marker; omit to hide it. */
  todayMs?: number | undefined;
  /** Explicit phase → tone map (annex `phaseColors`). */
  phaseColors?: Record<string, string> | undefined;
  /** Fallback group name for rows with no phase FK. */
  ungroupedLabel?: string | undefined;
}

/**
 * Project a task `record-list` onto the gantt model: parse start/end, derive the
 * axis origin + span, bucket rows under their phase FK (input order preserved
 * within a group, groups in first-seen order — deterministic), and locate the
 * today marker.
 *
 * Rows with an unparseable/absent start are DROPPED (a bar with no position is
 * meaningless); an absent/earlier end yields a 1-day bar. A row whose duration
 * rounds to 0 days — or that sets the milestone field — becomes a diamond.
 *
 * Positions are canonical-LTR day offsets: day 0 is the oldest instant and the
 * axis grows toward `totalDays`. This does NOT flip under RTL — per
 * 10-i18n-theming.md §5.5 the gantt canvas is a fixed-LTR island.
 */
export function toGanttModel(
  rows: readonly Rec[],
  fields: GanttFieldMap,
  options: GanttModelOptions = {},
): GanttModel {
  interface Parsed {
    id: string;
    label: string;
    startMs: number;
    endMs: number;
    pct: number;
    owner?: string | undefined;
    milestone: boolean;
    phase: string;
  }

  // Progress columns come in two conventions: 0–1 fractions and 0–100 whole
  // percentages. The choice is a property of the COLUMN, not of a row — sniffing
  // per row would read a 0–100 column's legitimate `1` ("1% done") as the
  // fraction 1.0 and render a full bar. Decide once over every row: any value
  // above 1 proves the column is 0–100; otherwise treat it as fractions.
  const progressIsFraction =
    fields.progressField === undefined
      ? false
      : !rows.some((row) => {
          const value = numberField(row, fields.progressField as string);
          return value !== undefined && value > 1;
        });

  const parsed: Parsed[] = [];
  rows.forEach((row, index) => {
    const startMs = parseDateMs(row[fields.startField]);
    if (startMs === undefined) return;
    const endParsed = parseDateMs(row[fields.endField]);
    const endMs = endParsed === undefined || endParsed < startMs ? startMs : endParsed;
    const pctRaw = fields.progressField === undefined ? undefined : numberField(row, fields.progressField);
    const pct = pctRaw === undefined ? 0 : clamp(progressIsFraction ? pctRaw * 100 : pctRaw, 0, 100);
    const milestoneFlag =
      fields.milestoneField === undefined ? false : truthy(row[fields.milestoneField]);
    parsed.push({
      id: stringField(row, fields.idField) ?? `task-${index}`,
      label: stringField(row, fields.labelField) ?? `task-${index}`,
      startMs,
      endMs,
      pct,
      owner: fields.ownerField === undefined ? undefined : stringField(row, fields.ownerField),
      milestone: milestoneFlag,
      phase: (fields.phaseField === undefined ? undefined : stringField(row, fields.phaseField)) ?? '',
    });
  });

  if (parsed.length === 0) {
    return { groups: [], totalDays: Math.max(1, options.totalDays ?? 1), originMs: 0, todayDay: null };
  }

  const originMs = Math.min(...parsed.map((task) => task.startMs));
  const lastMs = Math.max(...parsed.map((task) => task.endMs));
  const spanDays = Math.max(1, Math.ceil((lastMs - originMs) / DAY_MS));
  const totalDays = Math.max(1, options.totalDays ?? spanDays);

  const groupOrder: string[] = [];
  const grouped = new Map<string, GanttTask[]>();
  for (const task of parsed) {
    const startDay = dayOffset(task.startMs, originMs);
    const rawDur = Math.round((task.endMs - task.startMs) / DAY_MS);
    const isMilestone = task.milestone || rawDur <= 0;
    const ganttTask: GanttTask = {
      id: task.id,
      label: task.label,
      startDay,
      durDays: isMilestone ? 1 : Math.max(1, rawDur),
      pct: task.pct,
      ...(task.owner === undefined ? {} : { owner: task.owner }),
      ...(isMilestone ? { milestone: true } : {}),
    };
    const bucket = grouped.get(task.phase);
    if (bucket === undefined) {
      groupOrder.push(task.phase);
      grouped.set(task.phase, [ganttTask]);
    } else {
      bucket.push(ganttTask);
    }
  }

  const groups: GanttGroup[] = groupOrder.map((phase) => ({
    key: phase === '' ? '__ungrouped__' : phase,
    name: phase === '' ? (options.ungroupedLabel ?? 'Tasks') : phase,
    tone: categoryTone(phase === '' ? undefined : phase, options.phaseColors),
    tasks: grouped.get(phase) as GanttTask[],
  }));

  const todayDay =
    options.todayMs === undefined ? null : withinAxis(dayOffset(options.todayMs, originMs), totalDays);

  return { groups, totalDays, originMs, todayDay };
}

/** Day offset if it lands inside the axis window, else null (marker hidden). */
function withinAxis(day: number, totalDays: number): number | null {
  return day < 0 || day > totalDays ? null : day;
}

function truthy(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') return ['true', '1', 'yes', 'y'].includes(value.trim().toLowerCase());
  return false;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** A group's summary span — earliest start → latest end across its tasks. */
export function groupSpan(group: GanttGroup): { startDay: number; durDays: number } {
  if (group.tasks.length === 0) return { startDay: 0, durDays: 0 };
  const startDay = Math.min(...group.tasks.map((task) => task.startDay));
  const endDay = Math.max(...group.tasks.map((task) => task.startDay + task.durDays));
  return { startDay, durDays: Math.max(1, endDay - startDay) };
}

/** Percent of the axis a day offset sits at — the CSS positioning unit. */
export function dayToPercent(day: number, totalDays: number): number {
  return totalDays <= 0 ? 0 : clamp((day / totalDays) * 100, 0, 100);
}

/** Percent width for a span of `days`, clamped so a bar never overflows. */
export function daysToPercent(startDay: number, days: number, totalDays: number): number {
  if (totalDays <= 0) return 0;
  const start = clamp(startDay, 0, totalDays);
  const end = clamp(startDay + days, 0, totalDays);
  return ((end - start) / totalDays) * 100;
}

/** Week-bucket origins across the axis — the date-header tick instants. */
export function weekTicks(originMs: number, totalDays: number): number[] {
  const weeks = Math.max(1, Math.ceil(totalDays / 7));
  return Array.from({ length: weeks }, (_, index) => originMs + index * 7 * DAY_MS);
}
