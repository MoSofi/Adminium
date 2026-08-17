// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `domain` family config schemas + deterministic demo generators — PURE module
 * (zod + domain-lib only; no React component code).
 *
 * WHY THIS EXISTS: the registry metadata graph reaches this family through
 * `domain-track.definitions.ts`, which imports the config schemas and `demoData`
 * generators. Those must not drag the `OrgChart` / `GanttChart` components into
 * the eager registry chunk — the family stays in ONE lazy chunk loaded via
 * `lazy(() => import('./domain-track-components.js'))` (04 §2.3; chunk-budget
 * gate). Same convention as `boards-config.ts` / the kpi + charts families.
 */
import { z } from 'zod';

import { DAY_MS, DOMAIN_DEMO_EPOCH, mulberry32, pickFrom } from './domain-lib.js';
import type { GanttData, OrgNode, OrgTreeData } from './domain-types.js';
import { widgetSharedConfigSchema } from '../../registry/shared-config.js';

// ── org-chart (annex §13) ──────────────────────────────────────────────────

/**
 * `org-chart` config. The field names map a FLAT self-referencing people table
 * (`manager_id → id`) onto the tree — the auto-instantiation trigger for this
 * widget is exactly "self-FK on a people table" (annex §13 auto-instantiation),
 * so the generator names the columns here. A payload already shaped as
 * `hierarchy/tree` ignores them.
 *
 * `maxDepth` / `collapsible` / `deptColorMap` are the annex's declared config.
 */
export const orgChartConfigSchema = widgetSharedConfigSchema.extend({
  idField: z.string().default('id'),
  parentField: z.string().default('manager_id'),
  labelField: z.string().default('name'),
  roleField: z.string().default('title'),
  deptField: z.string().default('dept'),
  avatarField: z.string().optional(),
  toneField: z.string().optional(),
  /** Depth beyond which the tree is pruned (root = depth 0). */
  maxDepth: z.number().int().min(1).max(12).default(6),
  /** Managers get an expand/collapse "N reports" footer. */
  collapsible: z.boolean().default(true),
  /** Ids collapsed on first render (the rest expand). */
  defaultCollapsed: z.array(z.string()).optional(),
  /** Department → tone; unmapped departments get a stable hashed tone. */
  deptColorMap: z.record(z.string(), z.string()).optional(),
  emptyTitle: z.string().optional(),
  emptyBody: z.string().optional(),
  /** Localized "N reports" footer template; `{count}` placeholder. */
  reportsLabel: z.string().optional(),
});
export type OrgChartConfig = z.infer<typeof orgChartConfigSchema>;

const ORG_DEPTS = [
  { name: 'Executive', tone: 'accent' },
  { name: 'Engineering', tone: 'info' },
  { name: 'Design', tone: 'danger' },
  { name: 'Operations', tone: 'pos' },
] as const;

/**
 * The demo org (design port `Org Chart.dc.html`): a CEO, three VPs, and their
 * reports — a realistic self-FK people table, kept as a FLAT row list so the
 * demo exercises the same `manager_id → id` adaptation the live generator hits.
 */
const ORG_PEOPLE: readonly { id: string; name: string; title: string; dept: string; manager_id: string | null }[] = [
  { id: 'c0', name: 'Ava Reyes', title: 'Chief Executive', dept: 'Executive', manager_id: null },
  { id: 'd1', name: 'Morgan Lee', title: 'VP Engineering', dept: 'Engineering', manager_id: 'c0' },
  { id: 'd2', name: 'Riley Cho', title: 'VP Design', dept: 'Design', manager_id: 'c0' },
  { id: 'd3', name: 'Casey Ford', title: 'VP Operations', dept: 'Operations', manager_id: 'c0' },
  { id: 'r1', name: 'Kai Ndlovu', title: 'Frontend Lead', dept: 'Engineering', manager_id: 'd1' },
  { id: 'r2', name: 'Priya Rao', title: 'Backend Lead', dept: 'Engineering', manager_id: 'd1' },
  { id: 'r3', name: 'Dana Wu', title: 'Platform Engineer', dept: 'Engineering', manager_id: 'd1' },
  { id: 'r4', name: 'Taylor Kim', title: 'Product Design', dept: 'Design', manager_id: 'd2' },
  { id: 'r5', name: 'Jordan Smith', title: 'Brand & Motion', dept: 'Design', manager_id: 'd2' },
  { id: 'r6', name: 'Sam Park', title: 'Delivery Lead', dept: 'Operations', manager_id: 'd3' },
  { id: 'r7', name: 'Leo Marsh', title: 'People Ops', dept: 'Operations', manager_id: 'd3' },
  { id: 'r8', name: 'Nadia Haq', title: 'Finance', dept: 'Operations', manager_id: 'd3' },
];

/**
 * Deterministic `hierarchy/tree` payload (04 §7.7). The seed selects which
 * reports are staffed (never the CEO or the VPs), so distinct seeds yield
 * distinct — but always well-formed and connected — org trees.
 */
export function orgChartDemoData(seed: number): OrgTreeData {
  const random = mulberry32(seed || 1);
  // Seed-driven staffing: each report is present with ~75% probability, but
  // every VP keeps at least their first report so no branch renders childless.
  const keptIds = new Set<string>(['c0', 'd1', 'd2', 'd3', 'r1', 'r4', 'r6']);
  for (const person of ORG_PEOPLE) {
    if (!keptIds.has(person.id) && random() < 0.75) keptIds.add(person.id);
  }

  const byId = new Map<string, OrgNode>();
  const kept = ORG_PEOPLE.filter((person) => keptIds.has(person.id));
  for (const person of kept) {
    byId.set(person.id, {
      id: person.id,
      label: person.name,
      meta: {
        role: person.title,
        dept: person.dept,
        tone: ORG_DEPTS.find((dept) => dept.name === person.dept)?.tone ?? 'accent',
      },
      children: [],
    });
  }
  const roots: OrgNode[] = [];
  for (const person of kept) {
    const node = byId.get(person.id) as OrgNode;
    const parent = person.manager_id === null ? undefined : byId.get(person.manager_id);
    if (parent === undefined) roots.push(node);
    else parent.children.push(node);
  }
  return { roots, total: kept.length };
}

// ── gantt-chart (annex §13) ────────────────────────────────────────────────

/**
 * `gantt-chart` config. Field names project a task table onto the time axis;
 * `totalDays` / `todayLine` / `weekLabels` / `phaseColors` are the annex's
 * declared config.
 */
export const ganttChartConfigSchema = widgetSharedConfigSchema.extend({
  idField: z.string().default('id'),
  labelField: z.string().default('name'),
  startField: z.string().default('start_date'),
  endField: z.string().default('end_date'),
  progressField: z.string().default('progress'),
  phaseField: z.string().default('phase'),
  ownerField: z.string().optional(),
  milestoneField: z.string().optional(),
  /** Force the axis length in days; else derived from the data span. */
  totalDays: z.number().int().min(1).max(3650).optional(),
  /** Draw the today marker (resolved from `format.referenceTime`, else now). */
  todayLine: z.boolean().default(true),
  /** Show the week-bucket date header above the canvas. */
  weekLabels: z.boolean().default(true),
  /** Show the per-phase legend footer. */
  showLegend: z.boolean().default(true),
  /** Phase → tone; unmapped phases get a stable hashed tone. */
  phaseColors: z.record(z.string(), z.string()).optional(),
  /** Localized group name for rows with no phase FK. */
  ungroupedLabel: z.string().optional(),
  emptyTitle: z.string().optional(),
  emptyBody: z.string().optional(),
});
export type GanttChartConfig = z.infer<typeof ganttChartConfigSchema>;

/** The demo plan's phase FK values — the `phase` column's domain. */
type GanttPhase = 'Discovery' | 'Design' | 'Build' | 'Launch';

const GANTT_OWNERS = ['Ava Reyes', 'Morgan Lee', 'Sam Park', 'Riley Cho', 'Casey Ford'] as const;

/**
 * The demo plan (design port `Gantt Chart.dc.html`): a four-phase project whose
 * tasks overlap and ladder forward, ending on a go-live milestone.
 * `start`/`dur` are day offsets from `DOMAIN_DEMO_EPOCH`; `pct` is seeded.
 */
const GANTT_PLAN: readonly {
  id: string;
  name: string;
  phase: GanttPhase;
  start: number;
  dur: number;
  maxPct: number;
  milestone?: boolean;
}[] = [
  { id: 't1', name: 'Kickoff & research', phase: 'Discovery', start: 0, dur: 7, maxPct: 100 },
  { id: 't2', name: 'Stakeholder interviews', phase: 'Discovery', start: 3, dur: 9, maxPct: 100 },
  { id: 't3', name: 'Wireframes', phase: 'Design', start: 10, dur: 10, maxPct: 95 },
  { id: 't4', name: 'Visual design', phase: 'Design', start: 18, dur: 14, maxPct: 70 },
  { id: 't5', name: 'Design review', phase: 'Design', start: 30, dur: 5, maxPct: 40 },
  { id: 't6', name: 'Frontend build', phase: 'Build', start: 32, dur: 23, maxPct: 55 },
  { id: 't7', name: 'Backend & API', phase: 'Build', start: 34, dur: 24, maxPct: 45 },
  { id: 't8', name: 'QA & testing', phase: 'Build', start: 52, dur: 12, maxPct: 20 },
  { id: 't9', name: 'Beta release', phase: 'Launch', start: 60, dur: 5, maxPct: 10 },
  { id: 't10', name: 'Go live', phase: 'Launch', start: 68, dur: 0, maxPct: 0, milestone: true },
];

/** ISO `YYYY-MM-DD` for a whole-day offset from the demo epoch. */
function demoDay(offset: number): string {
  return new Date(DOMAIN_DEMO_EPOCH + offset * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Deterministic task `record-list` (04 §7.7). Dates derive from the fixed
 * `DOMAIN_DEMO_EPOCH`; the seed drives per-task progress + owner, so distinct
 * seeds yield distinct payloads while the plan's shape stays legible.
 */
export function ganttChartDemoData(seed: number): GanttData {
  const random = mulberry32(seed || 1);
  const rows = GANTT_PLAN.map((task) => ({
    id: task.id,
    name: task.name,
    phase: task.phase,
    start_date: demoDay(task.start),
    end_date: demoDay(task.start + task.dur),
    progress: task.maxPct === 0 ? 0 : Math.round(random() * task.maxPct),
    owner: pickFrom(random, GANTT_OWNERS),
    milestone: task.milestone === true,
  }));
  return { rows, total: rows.length };
}

/**
 * The demo "today" — day 34 of the plan (design port), as epoch ms. Stories and
 * tests pin `format.referenceTime` to this so the today marker lands in a fixed
 * place without any wall-clock read (04 §7.7 / VRT byte-determinism).
 */
export const GANTT_DEMO_TODAY_MS = DOMAIN_DEMO_EPOCH + 34 * DAY_MS;
