/**
 * Prompt-builder contract types (06-llm-assist.md §4.1, §4.4, §2).
 *
 * These are additive to T01's `response/schema.ts` + top-level `types.ts`: they
 * name the builder's INPUT (`PromptInput`), the requested-section vocabulary
 * (§4.4), the injected allow-lists, and the builder's OUTPUT (`PromptArtifact`).
 * `PromptInput.schemaIr` is the engine IR (`DatabaseModel`) and `stats` is the
 * engine's `StatsResult[]` (the shape every adapter's `collectTableStats`
 * returns) — the doc's aspirational `SchemaIr` / `TableStats[]` names map onto
 * these landed types.
 *
 * Browser-safe: type-only engine imports (erased at build), no runtime edge.
 */
import type { DatabaseModel, StatsResult } from '@adminium/engine';

import type { LocaleCode } from '../response/schema.js';

// ─── Requested sections (§4.4) ───────────────────────────────────────────────

/**
 * The ten decision groups the prompt asks for, mapped 1:1 to response keys
 * (§4.4). The wizard lets the user deselect groups (all on by default); a
 * deselected section's numbered decision block is removed from the rendered
 * user text and its key becomes optional-and-ignored downstream.
 */
export const REQUESTED_SECTIONS = [
  'labels',
  'groups',
  'enums',
  'relations',
  'keys',
  'templates',
  'widgets',
  'pii',
  'icons',
  'microcopy',
] as const;

export type RequestedSection = (typeof REQUESTED_SECTIONS)[number];

/** All ten sections, in canonical order — the default when the user deselects nothing. */
export const ALL_SECTIONS: readonly RequestedSection[] = REQUESTED_SECTIONS;

/**
 * Section → the 1-based number of its decision block in {@link PROMPT_V1_USER}
 * (§5.2). The builder keeps the original numbering (never renumbers) so the
 * cross-references inside the template — "for decision 6", "Skip decisions 2 and
 * 7" — stay valid even when blocks are dropped; deselected blocks simply leave a
 * gap in the sequence.
 */
export const SECTION_DECISION_NUMBER: Readonly<Record<RequestedSection, number>> = {
  labels: 1,
  groups: 2,
  enums: 3,
  relations: 4,
  keys: 5,
  templates: 6,
  widgets: 7,
  pii: 8,
  icons: 9,
  microcopy: 10,
};

// ─── Allow-lists injected into the prompt (§5 builder notes) ─────────────────

/**
 * The closed vocabularies bounding what the model may suggest, injected as
 * `{{ALLOWED_PAGE_TEMPLATE_IDS_JSON}}` / `{{ALLOWED_WIDGET_IDS_JSON}}`. In
 * production these are `LLM_ALLOWED_TEMPLATES` / `LLM_ALLOWED_WIDGETS` from
 * `@adminium/widgets` (derived from the live registries so prompt and runtime
 * cannot drift — 06 §5). They are INJECTED rather than imported here to keep
 * `@adminium/llm` browser-safe and dependency-minimal: the allow-lists live in
 * the widgets *main* barrel, which pulls the React render layer, whereas this
 * package must import only pure-Zod/pure-TS types (mirrors the engine rule that
 * only the `@adminium/widgets/page-config` leaf may be imported). The server /
 * dashboard callers, which already depend on `@adminium/widgets`, pass them in.
 */
export interface AllowedVocabularies {
  /** `LLM_ALLOWED_TEMPLATES` — recommendable page-template ids. */
  templates: readonly string[];
  /** `LLM_ALLOWED_WIDGETS` — the curated dashboard-widget subset. */
  widgets: readonly string[];
}

// ─── Sampling (§4.2) ─────────────────────────────────────────────────────────

/**
 * Sampling opt-in. `null` (default) ⇒ SAMPLE-FREE: no cell value from any table
 * appears anywhere in the prompt (§1 invariant 5, acceptance criterion 8). When
 * set, the sampling block adds up to `maxValuesPerColumn` most-common values +
 * ordered min/max — but NEVER for PII-suspected or secret columns.
 */
export type Sampling = null | { maxValuesPerColumn: number };

// ─── Builder input (§4.1) ────────────────────────────────────────────────────

/**
 * One (possibly chunked) prompt's worth of input. `schemaIr` is the
 * post-inclusion IR (only included tables; PII-masked columns still listed as
 * structure, flagged so the model can confirm/deny — §4.1).
 */
export interface PromptInput {
  /** `adminium_schema_snapshots.id` this prompt was built from (recorded, not injected). */
  snapshotId: string;
  /** The classified schema IR (05-introspection-engine.md). */
  schemaIr: DatabaseModel;
  /** Aggregate statistics, one per table (engine `collectTableStats` output). */
  stats: readonly StatsResult[];
  /** Subset of the 8 canonical locales; MUST include `en_US` (§4.1). */
  locales: readonly LocaleCode[];
  /** Which decision groups to request (§4.4). Empty ⇒ treated as all sections. */
  sections: readonly RequestedSection[];
  /** `null` = sample-free (default). */
  sampling: Sampling;
  /** ULID; echoed (optionally) by the response. */
  runId: string;
  /** Present only for a chunked run (§4.5); the chunker (T04) fills it. */
  chunk?: PromptChunkInfo;
}

/** Chunk placement for a map-phase prompt (§4.5). `index` is 1-based for display. */
export interface PromptChunkInfo {
  index: number;
  total: number;
  /** Qualified ids of out-of-chunk FK targets rendered as `"stub": true` context. */
  stubTables: readonly string[];
}

// ─── Builder options ─────────────────────────────────────────────────────────

/** Provider-agnostic input-token budget per prompt (§4.5). */
export const DEFAULT_TOKEN_BUDGET = 60_000;

export interface BuildPromptOptions {
  /** The closed vocabularies bounding suggestions (see {@link AllowedVocabularies}). */
  allowed: AllowedVocabularies;
  /** Input-token budget for the assembled user section (§4.5). Default {@link DEFAULT_TOKEN_BUDGET}. */
  tokenBudget?: number;
}

// ─── Builder output (§2) ─────────────────────────────────────────────────────

/**
 * One map-phase prompt. For an unchunked run the artifact carries exactly one
 * chunk (`index: 1, total: 1`). The chunker (T04) produces the multi-chunk case;
 * this shape is what it packs.
 */
export interface PromptChunk {
  /** 1-based position; `1` and `total: 1` for an unchunked run. */
  index: number;
  total: number;
  /** The system section sent for this chunk (identical across chunks). */
  system: string;
  /** The rendered user section for this chunk. */
  user: string;
  /** BYO flattening: `=== SYSTEM ===\n…\n\n=== USER ===\n…` (byte-identical between markers). */
  byo: string;
  /** `ceil(chars / 3.6)` over the flattened document (§4.5). */
  tokenEstimate: number;
}

/**
 * `buildPrompt(input, opts)` output. `system`/`user` are the direct-path
 * messages; `byo` is their flattened copyable document; `chunks` holds the
 * map-phase prompts (one entry when unchunked). `tokenEstimate` is over `byo`
 * (what BYO shows under the copy button).
 */
export interface PromptArtifact {
  system: string;
  user: string;
  byo: string;
  chunks: PromptChunk[];
  tokenEstimate: number;
  /** Whether the assembled user section exceeds `opts.tokenBudget` (chunking hint for T04). */
  overBudget: boolean;
  /** The active sections after normalizing `input.sections` (empty ⇒ all). */
  sections: readonly RequestedSection[];
}
