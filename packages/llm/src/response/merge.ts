// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `merge.ts` — deterministic chunk reduce + the `PROMPT_MERGE_V1` orchestration
 * (06-llm-assist.md §4.5, acceptance criterion 7).
 *
 * The map phase (see `prompt/chunker.ts`) produces one `LlmResponseV1` per chunk.
 * This module reduces them back to one:
 *
 * 1. **Deterministic code reduce** ({@link mergeChunkResponses}). Per-table
 *    sections (`tables`, `enums`, per-column `pii`, `microcopy`, `relations`) are
 *    disjoint by table across chunks and merged by key. Duplicate inferred
 *    relations (both endpoints stubbed in one chunk, real in another) dedupe by
 *    endpoints keeping the highest confidence. Global sections (`navGroups`,
 *    `dashboards`) are consolidated so **every table lands in exactly one nav
 *    group** and no group/dashboard cap is exceeded. Every tie-break is
 *    content-derived, so the result is invariant under the order of the input
 *    responses (acceptance criterion 7: "order-independent").
 *
 * 2. **LLM reduce prompt** ({@link buildMergePrompt}). For a richer cross-chunk
 *    grouping, `PROMPT_MERGE_V1` (§4.5, shipped verbatim in `prompt/templates`)
 *    receives only the per-chunk `navGroups`/`dashboards` plus the full
 *    table-name list and returns one consolidated global result;
 *    {@link applyGlobalMerge} folds that back onto the deterministic per-table
 *    merge (re-running the deterministic global consolidation defensively).
 *
 * Determinism: no `Date.now`/`Math.random`; canonical (sorted-key) JSON drives
 * every tie-break. Browser-safe: only pure-TS/Zod imports.
 */
import { flattenByo } from '../prompt/builder.js';
import { toPromptJson } from '../prompt/serializer.js';
import { PROMPT_MERGE_V1 } from '../prompt/templates/v1.js';
import { estimateTokens } from '../prompt/token-estimate.js';

import { LlmResponseV1, SCHEMA_VERSION } from './schema.js';
import type {
  ConfirmedRelation,
  DashboardSuggestion,
  EnumSuggestion,
  InferredRelation,
  NavGroupSuggestion,
  TableSuggestion,
  WidgetSuggestion,
} from './schema.js';

const KEY_SEP = '\x00';

// ─── Canonical serialization for content-derived tie-breaks ──────────────────

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) out[key] = sortKeys(record[key]);
    return out;
  }
  return value;
}

/** Order-independent canonical JSON (keys sorted recursively) for tie-breaking. */
function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

/**
 * True when `candidate` should win over `incumbent`: higher confidence, else the
 * lexicographically smaller canonical form. A total order → the same winner
 * regardless of which response was seen first.
 */
function outranks(candidateConfidence: number, incumbentConfidence: number, candidate: unknown, incumbent: unknown): boolean {
  if (candidateConfidence !== incumbentConfidence) return candidateConfidence > incumbentConfidence;
  return canonicalJson(candidate) < canonicalJson(incumbent);
}

// ─── Per-table sections (disjoint by key) ────────────────────────────────────

function mergeTables(responses: readonly LlmResponseV1[]): TableSuggestion[] {
  const byTable = new Map<string, TableSuggestion>();
  for (const response of responses) {
    for (const table of response.tables) {
      const incumbent = byTable.get(table.table);
      if (incumbent === undefined || outranks(table.confidence, incumbent.confidence, table, incumbent)) {
        byTable.set(table.table, table);
      }
    }
  }
  return [...byTable.values()].sort((a, b) => a.table.localeCompare(b.table));
}

function mergeEnums(responses: readonly LlmResponseV1[]): EnumSuggestion[] {
  const byColumn = new Map<string, EnumSuggestion>();
  for (const response of responses) {
    for (const suggestion of response.enums) {
      const key = `${suggestion.table}${KEY_SEP}${suggestion.column}`;
      const incumbent = byColumn.get(key);
      if (incumbent === undefined || outranks(suggestion.confidence, incumbent.confidence, suggestion, incumbent)) {
        byColumn.set(key, suggestion);
      }
    }
  }
  return [...byColumn.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([, value]) => value);
}

function endpointKey(
  relation: Pick<ConfirmedRelation, 'fromTable' | 'fromColumns' | 'toTable' | 'toColumns'>,
): string {
  return [
    relation.fromTable,
    relation.fromColumns.join(','),
    relation.toTable,
    relation.toColumns.join(','),
  ].join(KEY_SEP);
}

function mergeConfirmed(responses: readonly LlmResponseV1[]): ConfirmedRelation[] {
  const byEndpoints = new Map<string, ConfirmedRelation>();
  for (const response of responses) {
    for (const relation of response.relations.confirmed) {
      const key = endpointKey(relation);
      const incumbent = byEndpoints.get(key);
      if (incumbent === undefined || outranks(relation.confidence, incumbent.confidence, relation, incumbent)) {
        byEndpoints.set(key, relation);
      }
    }
  }
  return [...byEndpoints.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([, value]) => value);
}

function mergeInferred(responses: readonly LlmResponseV1[]): InferredRelation[] {
  const byEndpoints = new Map<string, InferredRelation>();
  for (const response of responses) {
    for (const relation of response.relations.inferred) {
      const key = endpointKey(relation);
      const incumbent = byEndpoints.get(key);
      if (incumbent === undefined || outranks(relation.confidence, incumbent.confidence, relation, incumbent)) {
        byEndpoints.set(key, relation);
      }
    }
  }
  return [...byEndpoints.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([, value]) => value);
}

function mergeNotes(responses: readonly LlmResponseV1[]): string[] {
  const notes = new Set<string>();
  for (const response of responses) {
    for (const note of response.notes ?? []) notes.add(note);
  }
  return [...notes].sort((a, b) => a.localeCompare(b)).slice(0, 5);
}

// ─── Global sections ─────────────────────────────────────────────────────────

interface NavGroupAcc {
  id: string;
  label: NavGroupSuggestion['label'];
  icon: string;
  confidence: number;
  tables: Set<string>;
}

/** Max nav groups allowed by the response schema (§6.1: `navGroups.max(7)`). */
const MAX_NAV_GROUPS = 7;

/**
 * Consolidate nav-group proposals from every chunk into one coherent set where
 * **each table appears in exactly one group** (§4.5). Same-id groups union their
 * tables; a table proposed under several groups is assigned to the group with
 * the highest confidence (ties by id) and removed from the rest; empty groups
 * drop out. If more than 7 groups survive, the lowest-priority groups' tables
 * fold into the last kept group so the cap holds without orphaning any table.
 */
export function consolidateNavGroups(groups: readonly NavGroupSuggestion[]): NavGroupSuggestion[] {
  const byId = new Map<string, NavGroupAcc>();
  for (const group of groups) {
    const incumbent = byId.get(group.id);
    if (incumbent === undefined) {
      byId.set(group.id, {
        id: group.id,
        label: group.label,
        icon: group.icon,
        confidence: group.confidence,
        tables: new Set(group.tables),
      });
      continue;
    }
    for (const table of group.tables) incumbent.tables.add(table);
    const swapLabel = outranks(
      group.confidence,
      incumbent.confidence,
      { label: group.label, icon: group.icon },
      { label: incumbent.label, icon: incumbent.icon },
    );
    if (swapLabel) {
      incumbent.label = group.label;
      incumbent.icon = group.icon;
    }
    incumbent.confidence = Math.max(incumbent.confidence, group.confidence);
  }

  const accs = [...byId.values()];

  // One group per table: pick the best owning group deterministically.
  const owner = new Map<string, NavGroupAcc>();
  for (const acc of accs) {
    for (const table of acc.tables) {
      const current = owner.get(table);
      if (current === undefined) {
        owner.set(table, acc);
        continue;
      }
      const better =
        acc.confidence > current.confidence ||
        (acc.confidence === current.confidence && acc.id.localeCompare(current.id) < 0);
      if (better) owner.set(table, acc);
    }
  }
  for (const acc of accs) {
    acc.tables = new Set([...acc.tables].filter((table) => owner.get(table) === acc));
  }

  let ranked = accs
    .filter((acc) => acc.tables.size > 0)
    .sort((a, b) => b.confidence - a.confidence || a.id.localeCompare(b.id));

  if (ranked.length > MAX_NAV_GROUPS) {
    const kept = ranked.slice(0, MAX_NAV_GROUPS);
    const sink = kept[kept.length - 1];
    if (sink !== undefined) {
      for (const acc of ranked.slice(MAX_NAV_GROUPS)) {
        for (const table of acc.tables) sink.tables.add(table);
      }
    }
    ranked = kept;
  }

  return ranked.map((acc, index) => ({
    id: acc.id,
    label: acc.label,
    icon: acc.icon,
    order: index,
    tables: [...acc.tables].sort((a, b) => a.localeCompare(b)),
    confidence: acc.confidence,
  }));
}

interface DashboardAcc {
  id: string;
  domain: string;
  label: DashboardSuggestion['label'];
  metaKey: string;
  tables: Set<string>;
  widgets: Map<string, WidgetSuggestion>;
}

/** Max dashboards / widgets-per-dashboard allowed by the schema (§6.1). */
const MAX_DASHBOARDS = 6;
const MAX_WIDGETS = 8;

function widgetKey(widget: WidgetSuggestion): string {
  return [
    widget.widget,
    widget.table,
    widget.metricColumn ?? '',
    widget.dimensionColumn ?? '',
    widget.timeColumn ?? '',
    widget.agg ?? '',
  ].join(KEY_SEP);
}

/**
 * Consolidate dashboard proposals: same-id dashboards union tables and widgets
 * (widgets dedupe by binding, keeping the highest confidence), widgets are
 * re-ranked by confidence and capped at 8, and the dashboards themselves are
 * ranked by total widget confidence and capped at 6. Fully deterministic.
 */
export function consolidateDashboards(dashboards: readonly DashboardSuggestion[]): DashboardSuggestion[] {
  const byId = new Map<string, DashboardAcc>();
  for (const dashboard of dashboards) {
    const metaKey = canonicalJson({ domain: dashboard.domain, label: dashboard.label });
    let acc = byId.get(dashboard.id);
    if (acc === undefined) {
      acc = {
        id: dashboard.id,
        domain: dashboard.domain,
        label: dashboard.label,
        metaKey,
        tables: new Set(),
        widgets: new Map(),
      };
      byId.set(dashboard.id, acc);
    } else if (metaKey < acc.metaKey) {
      acc.domain = dashboard.domain;
      acc.label = dashboard.label;
      acc.metaKey = metaKey;
    }
    for (const table of dashboard.tables) acc.tables.add(table);
    for (const widget of dashboard.widgets) {
      const key = widgetKey(widget);
      const incumbent = acc.widgets.get(key);
      if (incumbent === undefined || outranks(widget.confidence, incumbent.confidence, widget, incumbent)) {
        acc.widgets.set(key, widget);
      }
    }
  }

  const built = [...byId.values()].map((acc) => {
    const widgets = [...acc.widgets.values()]
      .sort(
        (a, b) =>
          b.confidence - a.confidence ||
          a.widget.localeCompare(b.widget) ||
          a.table.localeCompare(b.table) ||
          widgetKey(a).localeCompare(widgetKey(b)),
      )
      .slice(0, MAX_WIDGETS)
      .map((widget, index) => ({ ...widget, rank: index + 1 }));
    const score = widgets.reduce((sum, widget) => sum + widget.confidence, 0);
    return { acc, widgets, score };
  });

  return built
    .sort((a, b) => b.score - a.score || a.acc.id.localeCompare(b.acc.id))
    .slice(0, MAX_DASHBOARDS)
    .map(({ acc, widgets }, index) => ({
      id: acc.id,
      domain: acc.domain,
      label: acc.label,
      order: index,
      tables: [...acc.tables].sort((a, b) => a.localeCompare(b)),
      widgets,
    }));
}

// ─── Deterministic reduce (public) ───────────────────────────────────────────

/**
 * Reduce per-chunk `LlmResponseV1` results into one validated response. Purely
 * deterministic and independent of the order of `responses`. Responses that the
 * model declined (an `error` key set) contribute nothing; if every response
 * declined, the first declared error propagates.
 */
export function mergeChunkResponses(responses: readonly LlmResponseV1[]): LlmResponseV1 {
  const active = responses.filter((response) => response.error === undefined);

  if (active.length === 0) {
    const declined = responses.find((response) => response.error !== undefined);
    if (declined?.error !== undefined) {
      return LlmResponseV1.parse({ schema_version: SCHEMA_VERSION, error: declined.error });
    }
    return LlmResponseV1.parse({ schema_version: SCHEMA_VERSION });
  }

  const notes = mergeNotes(active);
  const base = {
    schema_version: SCHEMA_VERSION,
    tables: mergeTables(active),
    enums: mergeEnums(active),
    relations: { confirmed: mergeConfirmed(active), inferred: mergeInferred(active) },
    navGroups: consolidateNavGroups(active.flatMap((response) => response.navGroups)),
    dashboards: consolidateDashboards(active.flatMap((response) => response.dashboards)),
  };
  return LlmResponseV1.parse(notes.length > 0 ? { ...base, notes } : base);
}

// ─── LLM reduce prompt (PROMPT_MERGE_V1 orchestration, §4.5) ──────────────────

export interface MergePromptOptions {
  /** Full qualified table-name list for the whole schema, injected into the prompt (§4.5). */
  allTableNames: readonly string[];
}

export interface MergePromptArtifact {
  system: string;
  user: string;
  /** BYO flattening (`=== SYSTEM ===` / `=== USER ===`), same as map-phase prompts. */
  byo: string;
  tokenEstimate: number;
  /** Chunk count injected as `{{TOTAL}}`. */
  total: number;
}

function fillToken(text: string, token: string, value: string): string {
  // Function replacer so a `$` inside injected JSON is never a replacement pattern.
  return text.replace(token, () => value);
}

/**
 * Build the `PROMPT_MERGE_V1` reduce prompt (§4.5): it embeds only each chunk's
 * partial `navGroups`/`dashboards` and the full table-name list, reusing the v1
 * system section verbatim. Used only for the optional LLM consolidation of the
 * global sections when a run was chunked.
 */
export function buildMergePrompt(
  responses: readonly LlmResponseV1[],
  options: MergePromptOptions,
): MergePromptArtifact {
  const total = responses.length;
  const partials = responses.map((response) => ({
    navGroups: response.navGroups,
    dashboards: response.dashboards,
  }));
  const tableNames = [...new Set(options.allTableNames)].sort((a, b) => a.localeCompare(b));

  const system = PROMPT_MERGE_V1.system;
  let user: string = PROMPT_MERGE_V1.user;
  user = fillToken(user, '{{TOTAL}}', String(total));
  user = fillToken(user, '{{ALL_TABLE_NAMES_JSON}}', toPromptJson(tableNames));
  user = fillToken(user, '{{PARTIAL_GROUPS_AND_DASHBOARDS_JSON}}', toPromptJson(partials));

  const byo = flattenByo(system, user);
  return { system, user, byo, tokenEstimate: estimateTokens(byo), total };
}

/**
 * Fold an LLM merge-prompt response's consolidated global sections onto the
 * deterministic per-table merge, re-running the deterministic global
 * consolidation defensively (so the output still guarantees one group per table
 * and honors the caps even if the model drifted).
 */
export function applyGlobalMerge(merged: LlmResponseV1, mergeResponse: LlmResponseV1): LlmResponseV1 {
  return LlmResponseV1.parse({
    ...merged,
    navGroups: consolidateNavGroups(mergeResponse.navGroups),
    dashboards: consolidateDashboards(mergeResponse.dashboards),
  });
}
