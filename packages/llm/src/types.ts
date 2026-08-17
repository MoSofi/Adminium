// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Shared `@adminium/llm` contract types (06-llm-assist.md §2, §7.1): the
 * normalized `EnrichmentSet` both paths reduce to, the provider identifiers, and
 * the run status machine.
 *
 * Browser-safe: this module imports only pure-Zod / pure-TS types. The engine
 * reference is a type-only re-export (erased at build time) so no DB-driver code
 * can reach `@adminium/dashboard` through here.
 */
import { z } from 'zod';

import type {
  ConfirmedRelation,
  DashboardSuggestion,
  EnumSuggestion,
  InferredRelation,
  LocaleCode,
  Microcopy,
  NavGroupSuggestion,
  PiiSuggestion,
} from './response/schema.js';

/**
 * The classified schema IR a run is built, validated and normalized against
 * (05-introspection-engine.md). Re-exported here so every `@adminium/llm`
 * module names the model from one place; the referential checks (§7.3) and the
 * heuristic→EnrichmentSet normalizer both consume it. Type-only: no runtime edge
 * to `@adminium/engine`, keeping this package browser-safe.
 */
export type { DatabaseModel } from '@adminium/engine';

// ─── Provider identity (§3.1) ────────────────────────────────────────────────

export const PROVIDER_IDS = [
  'anthropic',
  'openai',
  'openai-compatible',
  'ollama',
  'adminium-managed',
] as const;

export const providerIdSchema = z.enum(PROVIDER_IDS);
export type ProviderId = z.infer<typeof providerIdSchema>;

// ─── Run status machine (§7.4) ───────────────────────────────────────────────

/**
 * `adminium_llm_runs.status` states. Transitions (§7.4):
 *   draft → running | awaiting_response
 *   running | awaiting_response → validated | failed | discarded
 *   validated → applied | partially_applied | discarded
 *   applied | partially_applied | failed | discarded → (terminal)
 */
export const LLM_RUN_STATUSES = [
  'draft',
  'running',
  'awaiting_response',
  'validated',
  'applied',
  'partially_applied',
  'failed',
  'discarded',
] as const;

export const llmRunStatusSchema = z.enum(LLM_RUN_STATUSES);
export type LlmRunStatus = z.infer<typeof llmRunStatusSchema>;

/** States a run can never leave (§7.4: "Runs are immutable after `applied`"). */
export const TERMINAL_LLM_RUN_STATUSES = [
  'applied',
  'partially_applied',
  'failed',
  'discarded',
] as const satisfies readonly LlmRunStatus[];

export function isTerminalRunStatus(status: LlmRunStatus): boolean {
  return (TERMINAL_LLM_RUN_STATUSES as readonly LlmRunStatus[]).includes(status);
}

// ─── EnrichmentSet — normalized shape (§7.1) ─────────────────────────────────

/** One table's normalized enrichment (labels, keys, templates, micro-copy, per-column). */
export interface EnrichmentTable {
  label: Partial<Record<LocaleCode, string>>;
  description?: Partial<Record<LocaleCode, string>>;
  icon?: string;
  displayColumn?: string | null;
  naturalKey?: string[] | null;
  templates: { template: string; rank: number; reason?: string; confidence: number }[];
  microcopy?: Microcopy;
  columns: Record<
    string,
    {
      label: Partial<Record<LocaleCode, string>>;
      description?: Partial<Record<LocaleCode, string>>;
      pii?: PiiSuggestion | null;
    }
  >;
  /** heuristic entries use fixed 0.5. */
  confidence: number;
}

/**
 * The normalized enrichment both the heuristic baseline (from `@adminium/engine`)
 * and a validated `LlmResponseV1` reduce to, so they diff field-by-field (§7.1).
 * `tables` is keyed by `"schema.table"`; `enums` by `"schema.table.column"`.
 */
export interface EnrichmentSet {
  source: 'heuristic' | 'llm';
  llmRunId?: string;
  tables: Record<string, EnrichmentTable>;
  enums: Record<string, EnumSuggestion>;
  inferredRelations: InferredRelation[];
  /**
   * Confirmed relations the LLM REJECTS (`correct: false`) — a declared FK it
   * wants suppressed (§8.3 `relation_suppressed`). Carried so the diff can raise
   * a `rejects-heuristic` row a human must confirm (§8.2, acceptance criterion
   * 12); an accepted one never enters a confidence-gated bulk set. The heuristic
   * baseline never populates this (it accepts every declared FK).
   */
  suppressedRelations: ConfirmedRelation[];
  navGroups: NavGroupSuggestion[];
  dashboards: DashboardSuggestion[];
}
