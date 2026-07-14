/**
 * Normalization to the shared `EnrichmentSet` (06-llm-assist.md §7.1).
 *
 * Two producers reduce to the SAME normalized shape so they can be diffed
 * field-by-field (§8.2):
 *
 *  - {@link normalizeLlmResponse}   — a validated `LlmResponseV1` → `EnrichmentSet`.
 *  - {@link normalizeHeuristicBaseline} — the engine's classified model
 *    (`ClassifiedModel` + `DatabaseModel`) → `EnrichmentSet`. This is the
 *    baseline the LLM refines; it always exists (05-introspection-engine.md).
 *
 * Browser-safety (01-architecture.md §2.3): `@adminium/llm` is consumed by
 * `@adminium/dashboard`, so this module imports only pure-TS engine *types*
 * (`import type`) — never engine runtime, which would risk pulling non-browser
 * code into the client bundle. The two tiny heuristics the baseline needs but
 * the classifier does not persist — identifier humanization and enum-tone
 * keyword mapping — are mirrored here from `@adminium/engine`
 * (`generate/util.ts#humanize`, `generate/crud.ts#enumTones`) so no runtime
 * edge is created. Everything is pure and deterministic (no Date.now /
 * Math.random) — the diff UI and golden tests depend on it (§3.1 temperature 0).
 */
import type {
  ClassifiedModel,
  ColumnModel,
  DatabaseModel,
  PiiKind as EnginePiiKind,
  Relation,
} from '@adminium/engine';

import type {
  InferredRelation,
  Masking,
  PiiKind,
  PiiSuggestion,
  RelationKind,
  Tone,
} from '../response/schema.js';
import type { LlmResponseV1 } from '../response/schema.js';
import type { EnrichmentSet, EnrichmentTable } from '../types.js';

/** §7.1: "heuristic entries use fixed 0.5." Shared with the diff engine. */
export const HEURISTIC_CONFIDENCE = 0.5;

// ─── LLM response → EnrichmentSet ────────────────────────────────────────────

export interface NormalizeLlmOptions {
  /** Overrides the run id stored on the set; defaults to the response's `run_id`. */
  llmRunId?: string;
}

/**
 * Reduce a validated `LlmResponseV1` to the normalized `EnrichmentSet` (§7.1).
 *
 * `tables` is keyed by `"schema.table"`, `enums` by `"schema.table.column"`.
 * Confirmed relations that AFFIRM a declared FK (`correct: true`) re-state an
 * existing relation and are handled at apply time (§8.3), not in the refinement
 * diff. Confirmed relations the model REJECTS (`correct: false`) are a different
 * matter: §8.2 lists them as `rejects-heuristic` rows a human must confirm and
 * "Accept all ≥ 0.8" must never auto-select, so they are lifted into
 * `suppressedRelations` for the diff to surface (finding: without this a
 * `correct: false` suppression produced no diff row at all and bypassed the
 * human-confirm gate).
 */
export function normalizeLlmResponse(
  response: LlmResponseV1,
  opts: NormalizeLlmOptions = {},
): EnrichmentSet {
  const tables: EnrichmentSet['tables'] = {};

  for (const t of response.tables) {
    const columns: EnrichmentTable['columns'] = {};
    for (const c of t.columns) {
      const column: EnrichmentTable['columns'][string] = { label: c.label, pii: c.pii };
      if (c.description !== undefined) column.description = c.description;
      columns[c.column] = column;
    }

    const table: EnrichmentTable = {
      label: t.label,
      description: t.description,
      icon: t.icon,
      displayColumn: t.displayColumn,
      naturalKey: t.naturalKey,
      templates: t.pageTemplates.map((p) => ({
        template: p.template,
        rank: p.rank,
        reason: p.reason,
        confidence: p.confidence,
      })),
      columns,
      confidence: t.confidence,
    };
    if (t.microcopy !== undefined) table.microcopy = t.microcopy;
    tables[t.table] = table;
  }

  const enums: EnrichmentSet['enums'] = {};
  for (const e of response.enums) {
    enums[`${e.table}.${e.column}`] = e;
  }

  const set: EnrichmentSet = {
    source: 'llm',
    tables,
    enums,
    inferredRelations: response.relations.inferred,
    suppressedRelations: response.relations.confirmed.filter((r) => !r.correct),
    navGroups: response.navGroups,
    dashboards: response.dashboards,
  };
  const runId = opts.llmRunId ?? response.run_id;
  if (runId !== undefined) set.llmRunId = runId;
  return set;
}

// ─── Heuristic classified model → EnrichmentSet ──────────────────────────────

/**
 * Reduce the engine's heuristic classification to the same `EnrichmentSet`
 * shape (§7.1). Consumes both the classifier output (`ClassifiedModel` — shape,
 * display/natural key, per-column semantics + PII flags) and the source
 * `DatabaseModel` (identifier names for humanization, declared enum values,
 * inferred relations). Emitting only pure-Zod/pure-TS engine data keeps the
 * heuristic→EnrichmentSet mapping inside `@adminium/llm` with no engine→llm edge.
 */
export function normalizeHeuristicBaseline(
  model: DatabaseModel,
  classified: ClassifiedModel,
): EnrichmentSet {
  const columnsByTable = new Map<string, Map<string, ColumnModel>>(
    model.tables.map((t) => [t.id, new Map(t.columns.map((c) => [c.name, c]))]),
  );
  const enumValuesById = new Map(model.enums.map((e) => [e.id, e.values]));

  const tables: EnrichmentSet['tables'] = {};
  const enums: EnrichmentSet['enums'] = {};

  for (const ct of classified.tables) {
    const modelColumns = columnsByTable.get(ct.tableId);
    const columns: EnrichmentTable['columns'] = {};

    for (const cc of ct.columns) {
      columns[cc.column] = {
        label: { en_US: humanize(cc.column) },
        pii: heuristicPii(cc.semantics.flags.pii, cc.semantics.confidence),
      };

      const kind =
        cc.semantics.primary === 'status-workflow'
          ? 'workflow'
          : cc.semantics.primary === 'category-enum'
            ? 'category'
            : null;
      if (kind === null) continue;
      const enumRef = modelColumns?.get(cc.column)?.enumRef ?? null;
      const values = enumRef !== null ? enumValuesById.get(enumRef) : undefined;
      if (values === undefined || values.length === 0) continue;
      enums[`${ct.tableId}.${cc.column}`] = {
        table: ct.tableId,
        column: cc.column,
        kind,
        order: [...values],
        tones: enumTones(values),
        reason: 'Heuristic enum classification from column semantics and declared values.',
        confidence: HEURISTIC_CONFIDENCE,
      };
    }

    tables[ct.tableId] = {
      label: { en_US: humanize(ct.tableId) },
      icon: SHAPE_ICONS[ct.shape.kind] ?? 'table',
      displayColumn: ct.displayColumn,
      naturalKey: ct.naturalKey !== null ? [ct.naturalKey] : null,
      templates: [],
      columns,
      confidence: HEURISTIC_CONFIDENCE,
    };
  }

  const inferredRelations: InferredRelation[] = [];
  for (const rel of model.relations) {
    if (rel.kind === 'inferred-name' || rel.kind === 'inferred-join-table') {
      inferredRelations.push(toInferredRelation(rel));
    }
  }

  return {
    source: 'heuristic',
    tables,
    enums,
    inferredRelations,
    suppressedRelations: [],
    navGroups: [],
    dashboards: [],
  };
}

// ─── Local mirrors of the two engine heuristics the classifier doesn't persist ─

/**
 * Mirror of `@adminium/engine` `generate/util.ts#humanize`: `order_details` →
 * `Order Details`; `public.orders` → `Orders`. Kept byte-faithful so the
 * heuristic baseline labels match what the generator emits.
 */
function humanize(name: string): string {
  const bare = name.includes('.') ? (name.split('.').pop() ?? name) : name;
  return bare
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Mirror of `@adminium/engine` `generate/crud.ts#enumTones` (§7.1 rule-7 tone
 * map), narrowed to the `Tone` union. The engine map never emits `accent`.
 */
const TONE_POS = /^(active|paid|done|completed?|closed|approved|healthy|shipped|delivered)$/i;
const TONE_WARN = /^(pending|trial|review|in_review|draft|queued|on_hold|paused|open|new)$/i;
const TONE_DANGER = /^(failed|rejected|churned|overdue|blocked|cancell?ed|error)$/i;

function enumTones(values: readonly string[]): Record<string, Tone> {
  const tones: Record<string, Tone> = {};
  for (const value of values) {
    if (TONE_POS.test(value)) tones[value] = 'pos';
    else if (TONE_WARN.test(value)) tones[value] = 'warn';
    else if (TONE_DANGER.test(value)) tones[value] = 'danger';
    else tones[value] = 'muted';
  }
  return tones;
}

/** Mirror of the generator's nav-icon-per-shape map (09 §2.2 / generate/index.ts). */
const SHAPE_ICONS: Record<string, string> = {
  people: 'users',
  workflow: 'kanban-square',
  events: 'calendar',
  catalog: 'package',
  log: 'scroll-text',
  settings: 'settings',
  geo: 'map',
  join: 'link',
  generic: 'table',
};

/**
 * Map the engine's PII kind (§7.2) onto the LLM contract's PII vocabulary (§6.1)
 * with a sensible default masking, so a heuristic PII flag normalizes into the
 * same `PiiSuggestion` shape the LLM emits. Masking is a display default; the
 * diff treats a heuristic flag as "considers this PII" and compares confirm vs
 * reject, not masking strategy.
 */
const PII_KIND_MAP: Record<EnginePiiKind, { kind: PiiKind; masking: Masking }> = {
  email: { kind: 'email', masking: 'mask-email' },
  phone: { kind: 'phone', masking: 'mask-partial' },
  ip: { kind: 'ip', masking: 'mask-partial' },
  'person-name': { kind: 'name', masking: 'mask-partial' },
  address: { kind: 'address', masking: 'redact' },
  dob: { kind: 'dob', masking: 'redact' },
  'gov-id': { kind: 'gov-id', masking: 'last4' },
  'payment-id': { kind: 'financial', masking: 'last4' },
  'geo-precise': { kind: 'location', masking: 'redact' },
};

function heuristicPii(kind: EnginePiiKind | null, confidence: number): PiiSuggestion | null {
  if (kind === null) return null;
  const mapped = PII_KIND_MAP[kind];
  return {
    kind: mapped.kind,
    masking: mapped.masking,
    reason: `Heuristic PII flag (${kind}).`,
    confidence,
  };
}

function toInferredRelation(rel: Relation): InferredRelation {
  const kind: RelationKind =
    rel.cardinality === 'one-to-one'
      ? 'one-to-one'
      : rel.cardinality === 'many-to-many'
        ? 'many-to-many-via'
        : 'many-to-one';
  const inferred: InferredRelation = {
    fromTable: rel.from.tableId,
    fromColumns: [...rel.from.columns],
    toTable: rel.to.tableId,
    toColumns: [...rel.to.columns],
    kind,
    evidence: 'Heuristic-inferred relation from the engine classifier.',
    confidence: rel.confidence,
  };
  if (rel.through !== null) inferred.viaTable = rel.through.tableId;
  return inferred;
}
