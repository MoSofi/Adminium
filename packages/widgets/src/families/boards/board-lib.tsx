import { getInitials } from '@adminium/ui';
import type { Tone } from '@adminium/ui';
import { mulberry32 } from '@adminium/charts';

/**
 * Shared, framework-light helpers for the `boards` family (annex §6) — a
 * deterministic seeded PRNG for `demoData`, the card/column/lane vocabulary,
 * tone normalization, column/lane derivation from a record-list, and the
 * grouping used by both `kanban-board` and `kanban-swimlane-grid`.
 *
 * No dnd-kit here: this module is pure so its helpers stay unit-testable and so
 * the heavy interaction code (dnd-kit) is confined to the widget component
 * files (04 §2.3 chunk budget; boards is the only family that pulls dnd-kit).
 * Widgets stay pure (no i18n provider dependency) — labels/announcements arrive
 * as props with English defaults, resolved through @adminium/i18n at the host
 * boundary like the rest of the registry (04 §2, 04-T06).
 */

export { mulberry32 };

/** Deterministic pick from a non-empty tuple (mirrors feeds/feed-lib). */
export function pickFrom<T>(random: () => number, items: readonly T[]): T {
  return items[Math.floor(random() * items.length) % items.length] as T;
}

/** Fixed demo epoch so `demoData(seed)` is byte-identical across runs (04 §7.7). */
export const BOARD_DEMO_EPOCH = Date.UTC(2026, 6, 14, 12, 0, 0);

const KNOWN_TONES: ReadonlySet<Tone> = new Set<Tone>(['neutral', 'accent', 'pos', 'warn', 'danger', 'info']);

/** Coerce an untrusted tone string to a valid `Tone`, defaulting to neutral. */
export function boardToneOf(value: unknown, fallback: Tone = 'neutral'): Tone {
  return typeof value === 'string' && KNOWN_TONES.has(value as Tone) ? (value as Tone) : fallback;
}

/** Priority → tone (annex board-card priority pill). */
export function priorityTone(priority: unknown): Tone {
  switch (typeof priority === 'string' ? priority.toLowerCase() : '') {
    case 'high':
    case 'urgent':
    case 'critical':
      return 'danger';
    case 'medium':
    case 'med':
      return 'warn';
    case 'low':
      return 'info';
    default:
      return 'neutral';
  }
}

/** A single board card (annex board-card data contract). */
export interface BoardCardData {
  id: string;
  title: string;
  /** Value of the status/column field this card currently belongs to. */
  column: string;
  /** Value of the swimlane field (kanban-swimlane-grid only). */
  lane?: string | undefined;
  tag?: string | undefined;
  tagTone?: Tone | undefined;
  priority?: string | undefined;
  owner?: string | undefined;
  /** 0..100 completion percent → card progress bar. */
  pct?: number | undefined;
  points?: number | undefined;
  due?: string | undefined;
  client?: string | undefined;
  budget?: string | undefined;
}

/** A board column derived from the status enum (annex `columnDefs`). */
export interface ColumnDef {
  id: string;
  label: string;
  tone: Tone;
  /** Optional work-in-progress limit (annex `wipLimits`). */
  wip?: number | undefined;
}

/** A swimlane row (annex `laneDefs`). */
export interface LaneDef {
  id: string;
  name: string;
  tone: Tone;
}

/** Loose config-supplied column spec (all fields optional; derived if absent). */
export interface ColumnDefInput {
  id?: string | undefined;
  label?: string | undefined;
  tone?: string | undefined;
  wip?: number | undefined;
}

/** Loose config-supplied lane spec (all fields optional; derived if absent). */
export interface LaneDefInput {
  id?: string | undefined;
  name?: string | undefined;
  tone?: string | undefined;
}

const COLUMN_TONE_CYCLE: readonly Tone[] = ['neutral', 'accent', 'warn', 'pos', 'info', 'danger'];

/** Humanize an enum value: `in_progress`/`in-progress` → `In progress`. */
export function humanizeEnum(value: string): string {
  const spaced = value.replace(/[_-]+/g, ' ').trim();
  if (spaced === '') return value;
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * Resolve the ordered column set for a board. Explicit `columnDefs` win (order
 * + label + tone + wip); otherwise columns are derived from the distinct values
 * of `columnField` in first-seen order, tone-cycled deterministically (annex:
 * "columns derived from enum values").
 */
export function resolveColumns(
  cards: readonly BoardCardData[],
  columnDefs?: readonly ColumnDefInput[] | undefined,
): ColumnDef[] {
  if (columnDefs && columnDefs.length > 0) {
    return columnDefs.map((def, index) => ({
      id: String(def.id ?? index),
      label: def.label ?? humanizeEnum(String(def.id ?? index)),
      tone: boardToneOf(def.tone, COLUMN_TONE_CYCLE[index % COLUMN_TONE_CYCLE.length]),
      wip: def.wip,
    }));
  }
  const seen: string[] = [];
  for (const card of cards) {
    if (!seen.includes(card.column)) seen.push(card.column);
  }
  return seen.map((id, index) => ({
    id,
    label: humanizeEnum(id),
    tone: COLUMN_TONE_CYCLE[index % COLUMN_TONE_CYCLE.length] as Tone,
  }));
}

/** Resolve the ordered lane set for a swimlane board (annex `laneDefs`). */
export function resolveLanes(
  cards: readonly BoardCardData[],
  laneDefs?: readonly LaneDefInput[] | undefined,
): LaneDef[] {
  if (laneDefs && laneDefs.length > 0) {
    return laneDefs.map((def, index) => ({
      id: String(def.id ?? index),
      name: def.name ?? humanizeEnum(String(def.id ?? index)),
      tone: boardToneOf(def.tone, COLUMN_TONE_CYCLE[index % COLUMN_TONE_CYCLE.length]),
    }));
  }
  const seen: string[] = [];
  for (const card of cards) {
    const lane = card.lane ?? '';
    if (!seen.includes(lane)) seen.push(lane);
  }
  return seen.map((id, index) => ({
    id,
    name: humanizeEnum(id),
    tone: COLUMN_TONE_CYCLE[index % COLUMN_TONE_CYCLE.length] as Tone,
  }));
}

/** Cards belonging to a column, in stable input order. */
export function cardsInColumn(cards: readonly BoardCardData[], columnId: string): BoardCardData[] {
  return cards.filter((card) => card.column === columnId);
}

/** Cards belonging to a (lane, column) cell, in stable input order. */
export function cardsInCell(cards: readonly BoardCardData[], laneId: string, columnId: string): BoardCardData[] {
  return cards.filter((card) => (card.lane ?? '') === laneId && card.column === columnId);
}

/** Sum of `points` across a set of cards (annex lane summary "Σ points"). */
export function sumPoints(cards: readonly BoardCardData[]): number {
  return cards.reduce((total, card) => total + (typeof card.points === 'number' ? card.points : 0), 0);
}

/** Initials for a card owner's gradient avatar (empty owner → no avatar). */
export function ownerInitials(owner: string | undefined, locale?: string): string | undefined {
  if (owner === undefined || owner.trim() === '') return undefined;
  return getInitials(owner, locale);
}

/**
 * Normalize an untrusted record-list row into a `BoardCardData`. `columnField`
 * / `laneField` / `titleField` name the source columns (04 §3 record-list). A
 * row missing the column value is bucketed under `''` (an "unassigned" column
 * the caller can surface or hide).
 */
export function toBoardCard(
  row: Record<string, unknown>,
  index: number,
  fields: { columnField: string; laneField?: string | undefined; titleField: string },
): BoardCardData {
  const str = (value: unknown): string | undefined => (typeof value === 'string' && value !== '' ? value : undefined);
  const num = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);
  return {
    id: String(row['id'] ?? row['_id'] ?? index),
    title: str(row[fields.titleField]) ?? str(row['title']) ?? `#${index + 1}`,
    column: str(row[fields.columnField]) ?? '',
    lane: fields.laneField === undefined ? undefined : (str(row[fields.laneField]) ?? ''),
    tag: str(row['tag']),
    tagTone: boardToneOf(row['tagTone'], 'accent'),
    priority: str(row['priority']),
    owner: str(row['owner']) ?? str(row['assignee']),
    pct: num(row['pct']) ?? num(row['progress']),
    points: num(row['points']) ?? num(row['estimate']),
    due: str(row['due']),
    client: str(row['client']),
    budget: str(row['budget']),
  };
}

/** Extract the record-list rows from a data envelope (mirrors feeds/feedRowsOf). */
export function boardRowsOf(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data as Record<string, unknown>[];
  if (typeof data === 'object' && data !== null) {
    const envelope = data as { data?: unknown; rows?: unknown };
    if (Array.isArray(envelope.data)) return envelope.data as Record<string, unknown>[];
    if (Array.isArray(envelope.rows)) return envelope.rows as Record<string, unknown>[];
  }
  return [];
}
