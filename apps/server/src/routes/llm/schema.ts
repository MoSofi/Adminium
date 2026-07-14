/**
 * Zod request/response schemas for `routes/llm/` (06-llm-assist.md §10.5, §3.2).
 *
 * The API key is WRITE-ONLY: `PUT /config` accepts `apiKey`, but no reply schema
 * here ever carries it — `GET /config` returns `apiKeySet` + `apiKeyLast4` only
 * (§3.2, acceptance #10). The shapes are mirrored verbatim by the dashboard
 * client `apps/dashboard/src/studio/ai/api.ts` (the copied-mirror convention —
 * change both together; the dashboard cannot import `@adminium/llm`).
 */

import { z } from 'zod';

// ─── Shared vocabularies (mirror `@adminium/llm` constants) ──────────────────

/** The five configurable providers (settings-registry `llm.provider`). */
export const llmProviderSchema = z.enum([
  'anthropic',
  'openai',
  'openai-compatible',
  'ollama',
  'adminium-managed',
]);

/** The eight canonical locales (§6.1 `LOCALES`); `en_US` is always required. */
export const llmLocaleSchema = z.enum([
  'en_US',
  'de_DE',
  'ar_EG',
  'zh_CN',
  'zh_TW',
  'cs_CZ',
  'da_DK',
  'fr_FR',
]);

/** The ten decision groups (§4.4 `REQUESTED_SECTIONS`). */
export const llmSectionSchema = z.enum([
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
]);

/** Sampling opt-in (§4.2); `null` = sample-free (default). */
export const llmSamplingSchema = z
  .object({ maxValuesPerColumn: z.number().int().min(1).max(100) })
  .nullable();

// ─── Config (§3.2) ───────────────────────────────────────────────────────────

/**
 * `GET /config` reply. NEVER the key — `apiKeySet` + last-4 only (§3.2,
 * acceptance #10). `apiKeyLast4` is `null` unless a key is stored.
 */
export const llmConfigReply = z.object({
  provider: llmProviderSchema.nullable(),
  model: z.string().nullable(),
  baseUrl: z.string().nullable(),
  maxOutputTokens: z.number().int().positive().nullable(),
  apiKeySet: z.boolean(),
  apiKeyLast4: z.string().nullable(),
});
export type LlmConfigReply = z.infer<typeof llmConfigReply>;

/**
 * `PUT /config` body. `apiKey` is write-only; the empty string clears it,
 * `undefined`/absent leaves the stored key untouched (§3.2 "PUT with a new key
 * overwrites; there is no read-back").
 */
export const llmConfigPutBody = z.object({
  provider: llmProviderSchema.nullable(),
  model: z.string().min(1).max(200).nullable().optional(),
  baseUrl: z.string().url().max(500).nullable().optional(),
  apiKey: z.string().max(500).optional(),
  maxOutputTokens: z.number().int().min(256).max(200_000).nullable().optional(),
});
export type LlmConfigPutBody = z.infer<typeof llmConfigPutBody>;

/** `POST /config/test` reply — provider `test()` ping outcome (never the key). */
export const llmConfigTestReply = z.object({
  ok: z.boolean(),
  model: z.string().nullable(),
  latencyMs: z.number().nullable(),
  error: z.object({ code: z.string(), message: z.string() }).nullable(),
});
export type LlmConfigTestReply = z.infer<typeof llmConfigTestReply>;

/** `GET /models` reply — the active provider's models + whether they are live. */
export const llmModelInfo = z.object({ id: z.string(), label: z.string() });
export const llmModelsReply = z.object({
  models: z.array(llmModelInfo),
  /** `live` = fetched from the provider; `static` = the bundled fallback list. */
  source: z.enum(['live', 'static']),
});
export type LlmModelsReply = z.infer<typeof llmModelsReply>;

// ─── Runs ────────────────────────────────────────────────────────────────────

/** Run summary DTO — omits the heavy `prompt_text` / `raw_response` blobs. */
export const llmRunDto = z.object({
  id: z.string(),
  connectionId: z.string(),
  snapshotId: z.string(),
  /** `provider` = direct-API path, `byo` = copy-paste round-trip. */
  mode: z.enum(['provider', 'byo']),
  /** NULL for BYO runs (§9 telemetry-free guarantee). */
  provider: z.string().nullable(),
  model: z.string().nullable(),
  promptVersion: z.string(),
  status: z.enum([
    'draft',
    'running',
    'awaiting_response',
    'validated',
    'applied',
    'partially_applied',
    'failed',
    'discarded',
  ]),
  validationStatus: z.enum(['pending', 'valid', 'partial', 'invalid']),
  sections: z.array(z.string()).nullable(),
  locales: z.array(z.string()).nullable(),
  sampling: llmSamplingSchema,
  chunksTotal: z.number().int(),
  chunksReceived: z.number().int(),
  tokensIn: z.number().int().nullable(),
  tokensOut: z.number().int().nullable(),
  durationMs: z.number().int().nullable(),
  appliedBy: z.string().nullable(),
  appliedAt: z.number().nullable(),
  createdBy: z.string().nullable(),
  createdAt: z.number(),
});
export type LlmRunDto = z.infer<typeof llmRunDto>;

/** One validation failure (mirrors `@adminium/llm` `LlmValidationError`, §7.2). */
export const llmValidationErrorSchema = z.object({
  code: z.string(),
  severity: z.enum(['fatal', 'item', 'warning']),
  /** JSON path into the response; `''` = the whole document. */
  path: z.string(),
  message: z.string(),
  hint: z.string().optional(),
  suggestionId: z.string().optional(),
});
export type LlmValidationErrorDto = z.infer<typeof llmValidationErrorSchema>;

/** Accepted/rejected suggestion-id lists persisted on a reviewed run (§8.3). */
export const llmRunReviewSchema = z.object({
  accepted: z.array(z.string()),
  rejected: z.array(z.string()),
});

/** Run detail DTO — the summary plus the validation errors + review lists. */
export const llmRunDetailDto = llmRunDto.extend({
  validationErrors: z.array(llmValidationErrorSchema).nullable(),
  review: llmRunReviewSchema.nullable(),
});
export type LlmRunDetailDto = z.infer<typeof llmRunDetailDto>;

/** One re-downloadable prompt chunk (BYO flattened `=== SYSTEM ===\n…`). */
export const llmPromptChunk = z.object({
  index: z.number().int().min(1),
  total: z.number().int().min(1),
  /** The flattened copyable document (byte-identical between the markers, §1). */
  byo: z.string(),
});

/** `POST /runs` body — build a prompt against the connection's latest snapshot. */
export const createRunBody = z.object({
  connectionId: z.string().min(1),
  /** `provider` = direct API path, `byo` = copy-paste round-trip. */
  path: z.enum(['provider', 'byo']),
  /** Empty/absent ⇒ all ten sections (§4.4). */
  sections: z.array(llmSectionSchema).optional(),
  /** Requested locales; `en_US` is enforced. Default `['en_US']`. */
  locales: z.array(llmLocaleSchema).min(1).optional(),
  /** Sampling opt-in; default sample-free (§4.2). */
  sampling: llmSamplingSchema.optional(),
});
export type CreateRunBody = z.infer<typeof createRunBody>;

/** `POST /runs` reply — the created run plus its prompt artifact. */
export const createRunReply = z.object({
  run: llmRunDto,
  prompt: z.object({
    promptVersion: z.string(),
    tokenEstimate: z.number().int(),
    chunks: z.array(llmPromptChunk),
  }),
});
export type CreateRunReply = z.infer<typeof createRunReply>;

export const runIdParams = z.object({ id: z.string().min(1) });

/** `GET /runs?connectionId=…` query — runs are listed per connection. */
export const runsListQuery = z.object({ connectionId: z.string().min(1) });
export const runsListReply = z.object({ runs: z.array(llmRunDto) });

/** `POST /runs/:id/response` body — a pasted BYO chunk (§10.2 step 4). */
export const runResponseBody = z.object({
  /** 1-based chunk index (unchunked runs omit it). */
  chunkIndex: z.number().int().min(1).optional(),
  text: z.string().min(1).max(4_000_000),
});
export type RunResponseBody = z.infer<typeof runResponseBody>;

/** `POST /runs/:id/response` reply — the run plus the full validation result. */
export const runResponseReply = z.object({
  run: llmRunDetailDto,
  validation: z.object({
    /** True iff no fatal error stopped the pipeline (a cleaned response exists). */
    ok: z.boolean(),
    errors: z.array(llmValidationErrorSchema),
    warnings: z.array(llmValidationErrorSchema),
  }),
});
export type RunResponseReply = z.infer<typeof runResponseReply>;

/** `GET /runs/:id/prompt` reply — re-download the prompt file(s). */
export const runPromptReply = z.object({
  promptVersion: z.string(),
  chunks: z.array(llmPromptChunk),
});
export type RunPromptReply = z.infer<typeof runPromptReply>;

/** One reviewed suggestion diff row (mirrors `@adminium/llm` `SuggestionDiff`, §8.2). */
export const suggestionDiffSchema = z.object({
  id: z.string(),
  category: z.string(),
  table: z.string().optional(),
  status: z.enum(['agree', 'conflict', 'llm-new', 'heuristic-only', 'rejects-heuristic', 'user-locked']),
  llmValue: z.unknown(),
  heuristicValue: z.unknown(),
  currentValue: z.unknown().optional(),
  confidence: z.number(),
  reason: z.string().optional(),
});
export type SuggestionDiffDto = z.infer<typeof suggestionDiffSchema>;

export const runDiffReply = z.object({ diff: z.array(suggestionDiffSchema) });
export type RunDiffReply = z.infer<typeof runDiffReply>;

/** `POST /runs/:id/apply` body — the accepted suggestion-id set (§8.3). */
export const runApplyBody = z.object({ accepted: z.array(z.string()) });
export type RunApplyBody = z.infer<typeof runApplyBody>;

/** `POST /runs/:id/apply` reply — the terminal run + the write counts. */
export const runApplyReply = z.object({
  run: llmRunDto,
  /** True when some actionable suggestion was rejected → `partially_applied`. */
  partial: z.boolean(),
  counts: z.object({
    overrides: z.number().int(),
    pages: z.number().int(),
    navGroupUpdates: z.number().int(),
  }),
  review: llmRunReviewSchema,
  /**
   * Single-use undo token backing the success-toast Undo action (§10.3); `null`
   * when the apply wrote nothing to revert. The review screen parks it in the
   * app-wide undo contract and `POST /runs/:id/undo/:token` consumes it.
   */
  undoToken: z.string().nullable(),
});
export type RunApplyReply = z.infer<typeof runApplyReply>;

/** `POST /runs/:id/undo/:token` params — the run + its single-use undo token. */
export const runUndoParams = z.object({ id: z.string().min(1), token: z.string().min(1) });
export type RunUndoParams = z.infer<typeof runUndoParams>;

/** `POST /runs/:id/undo/:token` reply — the reverted write counts. */
export const runUndoReply = z.object({
  overrides: z.number().int(),
  pages: z.number().int(),
});
export type RunUndoReply = z.infer<typeof runUndoReply>;

/** 202 reply for the direct-path enqueue (`POST /runs/:id/execute`). */
export const jobAcceptedReply = z.object({ jobId: z.string() });
