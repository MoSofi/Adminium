// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `boards` family config schemas + deterministic demo generators — PURE module
 * (zod + board-lib + shared-config only; no dnd-kit, no React component code).
 *
 * WHY THIS EXISTS: the registry metadata graph reaches this family through
 * `boards-track.definitions.ts`, which imports the config schemas and `demoData`
 * generators. Those must NOT drag the dnd-kit-heavy `KanbanBoard` /
 * `KanbanSwimlaneGrid` components into the eager registry chunk (acceptance #3 —
 * dnd-kit stays confined to the family's lazy component chunk, loaded via
 * `lazy(() => import('./boards-track-components.js'))`). Keeping the schemas +
 * demo payloads here (the kpi/charts `*-config` / `*-demo` convention) lets the
 * definitions import metadata only; the component files re-export these symbols
 * so existing barrel/story/test import points stay stable.
 */
import type { Tone } from '@adminium/ui';
import { z } from 'zod';

import { BOARD_DEMO_EPOCH, mulberry32, pickFrom } from './board-lib.js';
import { widgetSharedConfigSchema } from '../../registry/shared-config.js';

const toneEnum = z.enum(['neutral', 'accent', 'pos', 'warn', 'danger', 'info']);

export const kanbanColumnDefSchema = z.object({
  id: z.string(),
  label: z.string().optional(),
  tone: toneEnum.optional(),
  wip: z.number().int().positive().optional(),
});

const laneDefSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  tone: toneEnum.optional(),
});

/**
 * Localized dnd aria-live announcement TEMPLATES (annex §6 a11y). Widgets are
 * locale-agnostic and receive already-translated strings through config (the
 * `emptyTitle`/`addLabel` convention); the host fills these from `t('…')`.
 * Placeholders: `{title}` (card title) and `{cell}` (target column/lane label).
 * Omitted keys fall back to the English `defaultBoardAnnouncements`.
 */
export const boardAnnouncementConfigSchema = z
  .object({
    grabbed: z.string(),
    over: z.string(),
    moved: z.string(),
    returned: z.string(),
    failed: z.string(),
  })
  .partial();
export type BoardAnnouncementConfig = z.infer<typeof boardAnnouncementConfigSchema>;

// ── kanban-board (annex §6) ────────────────────────────────────────────────
export const kanbanBoardConfigSchema = widgetSharedConfigSchema.extend({
  columnField: z.string().default('status'),
  titleField: z.string().default('title'),
  columnDefs: z.array(kanbanColumnDefSchema).optional(),
  allowAdd: z.boolean().default(false),
  addLabel: z.string().optional(),
  announcements: boardAnnouncementConfigSchema.optional(),
  emptyTitle: z.string().optional(),
  emptyBody: z.string().optional(),
});
export type KanbanBoardConfig = z.infer<typeof kanbanBoardConfigSchema>;

const BOARD_DEMO_COLUMNS: readonly { id: string; label: string; tone: Tone }[] = [
  { id: 'todo', label: 'To do', tone: 'neutral' },
  { id: 'in_progress', label: 'In progress', tone: 'accent' },
  { id: 'review', label: 'Review', tone: 'warn' },
  { id: 'done', label: 'Done', tone: 'pos' },
];
const BOARD_DEMO_OWNERS = ['Ava Reyes', 'Grace Hopper', 'Alan Turing', 'Katherine Johnson', 'Edsger Dijkstra'] as const;
const BOARD_DEMO_TITLES = [
  'Billing webhook retries',
  'Onboarding checklist v2',
  'SSO for enterprise tier',
  'Export to CSV',
  'Realtime presence',
  'Audit log filters',
  'Dark mode polish',
  'Rate-limit dashboard',
  'Invite teammates flow',
  'Schema diff viewer',
] as const;
const BOARD_DEMO_TAGS = ['Feature', 'Bug', 'Chore', 'Spike'] as const;
const BOARD_DEMO_PRIORITIES = ['High', 'Medium', 'Low'] as const;
const BOARD_DEMO_CLIENTS = ['Acme Holdings', 'Globex', 'Initech', 'Umbrella'] as const;

/** Deterministic `record-list` of board rows (04 §7.7). */
export function kanbanBoardDemoData(seed: number): { data: Record<string, unknown>[]; total: number } {
  const random = mulberry32(seed || 1);
  const data = Array.from({ length: 11 }, (_, index) => {
    const column = pickFrom(random, BOARD_DEMO_COLUMNS);
    const done = column.id === 'done';
    const due = new Date(BOARD_DEMO_EPOCH + (index - 4) * 86_400_000);
    return {
      id: `PRJ-${100 + index}`,
      title: pickFrom(random, BOARD_DEMO_TITLES),
      status: column.id,
      tag: pickFrom(random, BOARD_DEMO_TAGS),
      priority: pickFrom(random, BOARD_DEMO_PRIORITIES),
      owner: pickFrom(random, BOARD_DEMO_OWNERS),
      pct: done ? 100 : Math.floor(random() * 90),
      points: pickFrom(random, [1, 2, 3, 5, 8] as const),
      client: pickFrom(random, BOARD_DEMO_CLIENTS),
      due: `${due.getUTCMonth() + 1}/${due.getUTCDate()}`,
    };
  });
  return { data, total: data.length };
}

// ── kanban-swimlane-grid (annex §6) ────────────────────────────────────────
export const kanbanSwimlaneGridConfigSchema = widgetSharedConfigSchema.extend({
  columnField: z.string().default('status'),
  laneField: z.string().default('lane'),
  titleField: z.string().default('title'),
  columnDefs: z.array(kanbanColumnDefSchema).optional(),
  laneDefs: z.array(laneDefSchema).optional(),
  pointsUnit: z.string().optional(),
  announcements: boardAnnouncementConfigSchema.optional(),
  emptyTitle: z.string().optional(),
  emptyBody: z.string().optional(),
});
export type KanbanSwimlaneGridConfig = z.infer<typeof kanbanSwimlaneGridConfigSchema>;

const SWIM_DEMO_COLUMNS: readonly { id: string; label: string; tone: Tone }[] = [
  { id: 'todo', label: 'To do', tone: 'neutral' },
  { id: 'in_progress', label: 'In progress', tone: 'accent' },
  { id: 'review', label: 'Review', tone: 'warn' },
  { id: 'done', label: 'Done', tone: 'pos' },
];
const SWIM_DEMO_LANES: readonly { id: string; name: string; tone: Tone }[] = [
  { id: 'growth', name: 'Growth', tone: 'accent' },
  { id: 'platform', name: 'Platform', tone: 'info' },
  { id: 'mobile', name: 'Mobile', tone: 'warn' },
];
const SWIM_DEMO_OWNERS = ['Ava Reyes', 'Grace Hopper', 'Alan Turing', 'Katherine Johnson'] as const;
const SWIM_DEMO_TITLES = [
  'Referral rewards',
  'Signup A/B test',
  'Push notifications',
  'Offline cache',
  'Query planner',
  'Connection pooling',
  'Deep links',
  'Crash reporting',
  'Paywall redesign',
  'Session replay',
  'Feature flags',
  'Cohort export',
] as const;
const SWIM_DEMO_TAGS = ['Feature', 'Bug', 'Chore'] as const;

/** Deterministic `record-list` with two categorical fields (04 §7.7). */
export function kanbanSwimlaneGridDemoData(seed: number): { data: Record<string, unknown>[]; total: number } {
  const random = mulberry32(seed || 1);
  const data = Array.from({ length: 14 }, (_, index) => {
    const column = pickFrom(random, SWIM_DEMO_COLUMNS);
    const lane = pickFrom(random, SWIM_DEMO_LANES);
    const due = new Date(BOARD_DEMO_EPOCH + (index - 5) * 86_400_000);
    return {
      id: `TASK-${200 + index}`,
      title: pickFrom(random, SWIM_DEMO_TITLES),
      status: column.id,
      lane: lane.id,
      tag: pickFrom(random, SWIM_DEMO_TAGS),
      owner: pickFrom(random, SWIM_DEMO_OWNERS),
      points: pickFrom(random, [1, 2, 3, 5, 8] as const),
      pct: column.id === 'done' ? 100 : Math.floor(random() * 80),
      due: `${due.getUTCMonth() + 1}/${due.getUTCDate()}`,
    };
  });
  return { data, total: data.length };
}

// ── board-card (annex §6) ──────────────────────────────────────────────────
/**
 * The card is registered in its OWN right, not only as the boards' child: the
 * annex gives it an id, and the detail/preview surfaces (a linked card in a
 * timeline, a card preview in the builder palette) instantiate exactly one of
 * them against a single `record`. The component is the same `BoardCard` the
 * kanban columns render, so a card looks identical wherever it appears.
 */
export const boardCardConfigSchema = widgetSharedConfigSchema.extend({
  /** Visible field allow-list (annex "visible fields"); unset → every field present. */
  fields: z.array(z.enum(['tag', 'priority', 'points', 'client', 'budget', 'pct', 'owner', 'due', 'id'])).optional(),
  /** Progress-bar + tag accent tone; normally the card's column tone. */
  columnTone: toneEnum.optional(),
  /** Drill-through target for the card (annex `linkTarget`). */
  linkTarget: z.string().optional(),
  titleField: z.string().default('title'),
  pointsUnit: z.string().optional(),
  gripLabel: z.string().optional(),
});
export type BoardCardConfig = z.infer<typeof boardCardConfigSchema>;

/**
 * Deterministic single-`record` payload (04 §7.7). The `record` shape's envelope
 * is `{ row }` — that is what the host's shared `isEmptyByShape['record']`
 * predicate reads, so an unbound/missing card empty-states instead of rendering
 * a blank frame.
 */
export function boardCardDemoData(seed: number): { row: Record<string, unknown> } {
  const random = mulberry32(seed || 1);
  const column = pickFrom(random, BOARD_DEMO_COLUMNS);
  const done = column.id === 'done';
  const due = new Date(BOARD_DEMO_EPOCH + 3 * 86_400_000);
  return {
    row: {
      id: `PRJ-${100 + Math.floor(random() * 40)}`,
      title: pickFrom(random, BOARD_DEMO_TITLES),
      status: column.id,
      tag: pickFrom(random, BOARD_DEMO_TAGS),
      tagTone: column.tone,
      priority: pickFrom(random, BOARD_DEMO_PRIORITIES),
      owner: pickFrom(random, BOARD_DEMO_OWNERS),
      pct: done ? 100 : Math.floor(random() * 90),
      points: pickFrom(random, [1, 2, 3, 5, 8] as const),
      client: pickFrom(random, BOARD_DEMO_CLIENTS),
      due: `${due.getUTCMonth() + 1}/${due.getUTCDate()}`,
    },
  };
}

// ── inline-compose-card (annex §6) ─────────────────────────────────────────
export const inlineComposeCardConfigSchema = widgetSharedConfigSchema.extend({
  /**
   * Column defaults stamped onto the new record (annex `defaults`). Values are
   * primitives only: a stored config must never be able to smuggle a nested
   * object/expression into an INSERT the host will run.
   */
  defaults: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).default({}),
  /** The field the typed text lands in. */
  titleField: z.string().default('title'),
  placeholder: z.string().optional(),
  addLabel: z.string().optional(),
  cancelLabel: z.string().optional(),
  /** Keep the composer open after adding, for rapid entry (Project Board). */
  keepOpen: z.boolean().default(true),
  /** Start expanded (a dedicated compose slot) vs. behind the add affordance. */
  defaultOpen: z.boolean().default(false),
});
export type InlineComposeCardConfig = z.infer<typeof inlineComposeCardConfigSchema>;

/**
 * Deterministic `form-state` payload (04 §7.7) — the transient draft. The seed
 * picks the placeholder-ish suggestion the demo shows, so the payload threads
 * its seed while staying wall-clock free.
 */
export function inlineComposeCardDemoData(seed: number): { value: { title: string } } {
  const random = mulberry32(seed || 1);
  return { value: { title: pickFrom(random, BOARD_DEMO_TITLES) } };
}
