// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Review-diff model (06-llm-assist.md §8.2, §10.3) — the pure logic behind the
 * `/studio/llm-runs/:id/review` screen: it maps the server's per-suggestion
 * diff categories into the ten §10.3 display groups, derives the default
 * accept/reject selection from each row's status + confidence, computes the
 * confidence-gated "Accept all ≥ threshold" set, and summarizes the accepted
 * writes for the apply-confirmation modal.
 *
 * Kept framework-free (no React, no DOM) so acceptance criterion 12 — "'Accept
 * all ≥ 0.8' never selects rejects-heuristic or user-locked rows" — is pinned
 * by a fast unit test rather than a rendered one. The dashboard cannot import
 * `@adminium/llm` (01 §2.3), so the selection semantics of `apply/diff.ts`
 * (`CONFIDENCE_SELECTABLE_STATUSES`, `isBulkAcceptable`) are re-stated here
 * structurally against the mirrored `SuggestionDiff` DTO.
 */
import type { SuggestionDiff, SuggestionStatus } from '../ai/api.js';

/** The confidence at/above which conflict + llm-new rows pre-check (§8.2). */
export const DEFAULT_ACCEPT_THRESHOLD = 0.8;

// ─── Display groups (§10.3) ──────────────────────────────────────────────────

export type ReviewGroupId =
  | 'labels'
  | 'groups'
  | 'enums'
  | 'relations'
  | 'keys'
  | 'templates'
  | 'dashboards'
  | 'pii'
  | 'icons'
  | 'microcopy';

export interface ReviewGroupDef {
  id: ReviewGroupId;
  /** Server diff `category` tokens (§8.1 id prefixes) folded into this group. */
  categories: readonly string[];
  /** Kebab-case lucide icon (resolved via `lucideByName`). */
  icon: string;
  labelKey: string;
  labelDefault: string;
}

/**
 * The ten review groups in §10.3 order. `dashboard` + `widget` diff rows share
 * one group; `icon` has no dedicated diff category today (the table label
 * bundle carries the icon), so that group renders only if the server ever emits
 * one — grouping is data-driven and skips empty groups.
 */
export const REVIEW_GROUPS: readonly ReviewGroupDef[] = [
  {
    id: 'labels',
    categories: ['label'],
    icon: 'tag',
    labelKey: 'studio.llmRuns.review.group.labels',
    labelDefault: 'Labels & translations',
  },
  {
    id: 'groups',
    categories: ['group'],
    icon: 'layout-grid',
    labelKey: 'studio.llmRuns.review.group.navigation',
    labelDefault: 'Navigation & domains',
  },
  {
    id: 'enums',
    categories: ['enum'],
    icon: 'list-checks',
    labelKey: 'studio.llmRuns.review.group.enums',
    labelDefault: 'Enum semantics',
  },
  {
    id: 'relations',
    categories: ['relation'],
    icon: 'git-fork',
    labelKey: 'studio.llmRuns.review.group.relations',
    labelDefault: 'Relations',
  },
  {
    id: 'keys',
    categories: ['key'],
    icon: 'key-round',
    labelKey: 'studio.llmRuns.review.group.keys',
    labelDefault: 'Key columns',
  },
  {
    id: 'templates',
    categories: ['template'],
    icon: 'layout-template',
    labelKey: 'studio.llmRuns.review.group.templates',
    labelDefault: 'Page templates',
  },
  {
    id: 'dashboards',
    categories: ['dashboard', 'widget'],
    icon: 'bar-chart-3',
    labelKey: 'studio.llmRuns.review.group.dashboards',
    labelDefault: 'Dashboards & widgets',
  },
  {
    id: 'pii',
    categories: ['pii'],
    icon: 'shield',
    labelKey: 'studio.llmRuns.review.group.pii',
    labelDefault: 'PII & masking',
  },
  {
    id: 'icons',
    categories: ['icon'],
    icon: 'shapes',
    labelKey: 'studio.llmRuns.review.group.icons',
    labelDefault: 'Icons',
  },
  {
    id: 'microcopy',
    categories: ['copy'],
    icon: 'message-square-text',
    labelKey: 'studio.llmRuns.review.group.microcopy',
    labelDefault: 'Micro-copy',
  },
];

const CATEGORY_TO_GROUP: ReadonlyMap<string, ReviewGroupId> = new Map(
  REVIEW_GROUPS.flatMap((group) => group.categories.map((category) => [category, group.id] as const)),
);

export function groupIdForCategory(category: string): ReviewGroupId | null {
  return CATEGORY_TO_GROUP.get(category) ?? null;
}

export interface ReviewGroup {
  def: ReviewGroupDef;
  rows: SuggestionDiff[];
}

/**
 * Bucket the diff rows into the §10.3 display groups, preserving the server's
 * stable row order within each group and dropping empty groups. Rows whose
 * category maps to no group are collected under a trailing `labels`-like
 * fallback so nothing is silently lost.
 */
export function groupDiffs(diffs: readonly SuggestionDiff[]): ReviewGroup[] {
  const byId = new Map<ReviewGroupId, SuggestionDiff[]>();
  for (const diff of diffs) {
    const groupId = groupIdForCategory(diff.category);
    if (groupId === null) continue;
    const bucket = byId.get(groupId);
    if (bucket === undefined) byId.set(groupId, [diff]);
    else bucket.push(diff);
  }
  const groups: ReviewGroup[] = [];
  for (const def of REVIEW_GROUPS) {
    const rows = byId.get(def.id);
    if (rows !== undefined && rows.length > 0) groups.push({ def, rows });
  }
  return groups;
}

// ─── Selection semantics (§8.2, acceptance criterion 12) ─────────────────────

/**
 * A row the human can toggle. `heuristic-only` has nothing to accept and
 * `user-locked` is frozen behind a user edit, so neither is checkable.
 * `rejects-heuristic` IS checkable (a human may confirm the rejection) but is
 * never pre-checked and never entered by a bulk control.
 */
export function isCheckable(status: SuggestionStatus): boolean {
  return status === 'agree' || status === 'conflict' || status === 'llm-new' || status === 'rejects-heuristic';
}

/** Locked behind an existing `source: 'user'` override — rendered disabled. */
export function isUserLocked(status: SuggestionStatus): boolean {
  return status === 'user-locked';
}

/**
 * The only statuses a bulk control (confidence slider or per-category
 * select-all) may auto-select. Deliberately excludes `rejects-heuristic` and
 * `user-locked` (acceptance criterion 12) and `agree` (pre-accepted
 * separately, not confidence-gated).
 */
function isBulkEligible(status: SuggestionStatus): boolean {
  return status === 'conflict' || status === 'llm-new';
}

/** Whether a row is pre-checked at `threshold` (§8.2 "Review default"). */
export function isDefaultChecked(diff: SuggestionDiff, threshold = DEFAULT_ACCEPT_THRESHOLD): boolean {
  if (diff.status === 'agree') return true; // pre-accepted, collapsed
  if (isBulkEligible(diff.status)) return diff.confidence >= threshold;
  return false; // rejects-heuristic, heuristic-only, user-locked
}

/** The initial accept set: every `agree` row + confident conflict/llm-new rows. */
export function defaultSelection(
  diffs: readonly SuggestionDiff[],
  threshold = DEFAULT_ACCEPT_THRESHOLD,
): Set<string> {
  const selected = new Set<string>();
  for (const diff of diffs) if (isDefaultChecked(diff, threshold)) selected.add(diff.id);
  return selected;
}

/**
 * The accept set produced by "Accept all ≥ threshold" — identical to the
 * default selection at that threshold (`agree` ∪ confident conflict/llm-new).
 * Never contains `rejects-heuristic` or `user-locked` ids (acceptance
 * criterion 12).
 */
export function bulkAcceptSelection(
  diffs: readonly SuggestionDiff[],
  threshold: number,
): Set<string> {
  return defaultSelection(diffs, threshold);
}

/** The bulk-selectable ids within a set of rows — for per-category select-all. */
export function selectableIds(rows: readonly SuggestionDiff[]): string[] {
  return rows.filter((row) => row.status === 'agree' || isBulkEligible(row.status)).map((row) => row.id);
}

/** Tri-state of a category/global select-all checkbox over its selectable rows. */
export type SelectAllState = 'none' | 'some' | 'all';

export function selectAllState(rows: readonly SuggestionDiff[], selected: ReadonlySet<string>): SelectAllState {
  const ids = selectableIds(rows);
  if (ids.length === 0) return 'none';
  let checked = 0;
  for (const id of ids) if (selected.has(id)) checked += 1;
  if (checked === 0) return 'none';
  return checked === ids.length ? 'all' : 'some';
}

// ─── Header counts (§10.3: agree / conflict / new / rejects) ─────────────────

export interface StatusCounts {
  agree: number;
  conflict: number;
  new: number;
  rejects: number;
  locked: number;
  heuristicOnly: number;
  total: number;
}

export function countStatuses(diffs: readonly SuggestionDiff[]): StatusCounts {
  const counts: StatusCounts = {
    agree: 0,
    conflict: 0,
    new: 0,
    rejects: 0,
    locked: 0,
    heuristicOnly: 0,
    total: diffs.length,
  };
  for (const diff of diffs) {
    switch (diff.status) {
      case 'agree':
        counts.agree += 1;
        break;
      case 'conflict':
        counts.conflict += 1;
        break;
      case 'llm-new':
        counts.new += 1;
        break;
      case 'rejects-heuristic':
        counts.rejects += 1;
        break;
      case 'user-locked':
        counts.locked += 1;
        break;
      case 'heuristic-only':
        counts.heuristicOnly += 1;
        break;
    }
  }
  return counts;
}

// ─── Apply-write summary (§10.3 confirmation modal) ──────────────────────────

/**
 * Counts of the writes an apply would perform, derived on the client from the
 * accepted rows' categories (the server owns the authoritative plan; this is
 * the pre-apply preview text "Creates 2 dashboard pages, updates 41 labels…").
 */
export interface ApplySummary {
  labels: number;
  keys: number;
  enums: number;
  relations: number;
  templates: number;
  dashboards: number;
  widgets: number;
  navGroups: number;
  pii: number;
  icons: number;
  microcopy: number;
  total: number;
}

export function summarizeAccepted(
  diffs: readonly SuggestionDiff[],
  accepted: ReadonlySet<string>,
): ApplySummary {
  const summary: ApplySummary = {
    labels: 0,
    keys: 0,
    enums: 0,
    relations: 0,
    templates: 0,
    dashboards: 0,
    widgets: 0,
    navGroups: 0,
    pii: 0,
    icons: 0,
    microcopy: 0,
    total: 0,
  };
  for (const diff of diffs) {
    if (!accepted.has(diff.id)) continue;
    summary.total += 1;
    switch (diff.category) {
      case 'label':
        summary.labels += 1;
        break;
      case 'key':
        summary.keys += 1;
        break;
      case 'enum':
        summary.enums += 1;
        break;
      case 'relation':
        summary.relations += 1;
        break;
      case 'template':
        summary.templates += 1;
        break;
      case 'dashboard':
        summary.dashboards += 1;
        break;
      case 'widget':
        summary.widgets += 1;
        break;
      case 'group':
        summary.navGroups += 1;
        break;
      case 'pii':
        summary.pii += 1;
        break;
      case 'icon':
        summary.icons += 1;
        break;
      case 'copy':
        summary.microcopy += 1;
        break;
    }
  }
  return summary;
}

/** The count shown in the footer's "Apply N accepted suggestions" button. */
export function acceptedCount(diffs: readonly SuggestionDiff[], accepted: ReadonlySet<string>): number {
  let count = 0;
  for (const diff of diffs) if (accepted.has(diff.id)) count += 1;
  return count;
}

/**
 * A compact human identifier for a row's target, derived from its §8.1
 * suggestion id (`label:public.orders.total_cents` → `orders.total_cents`),
 * with the `public.` schema qualifier stripped for readability.
 */
export function rowIdentifier(diff: SuggestionDiff): string {
  const colon = diff.id.indexOf(':');
  const rest = colon === -1 ? diff.id : diff.id.slice(colon + 1);
  return rest.replace(/(^|[.:>-])public\./g, '$1');
}
