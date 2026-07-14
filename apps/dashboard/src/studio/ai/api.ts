/**
 * Studio AI (LLM-assist) API client (06-llm-assist.md §10.5) — one typed wrapper
 * over the `/api/v1/llm/*` routes that every Batch-4 AI surface (Settings → AI,
 * the connect-wizard enrichment step, the review-diff screen) imports, so no
 * screen re-derives request/response shapes.
 *
 * The types mirror the server Zod schemas in
 * `apps/server/src/routes/llm/schema.ts` — the copied-mirror convention (as in
 * `studio/api.ts`): change both together. The dashboard cannot import
 * `@adminium/llm` (01 §2.3, `dependency-cruiser`), so the LLM contract shapes are
 * duplicated structurally here.
 *
 * The API key is WRITE-ONLY: `putConfig` sends it, but no reply ever carries it —
 * `getConfig` returns `apiKeySet` + `apiKeyLast4` only (§3.2).
 */

import { api } from '../../app/api.js';

// ─── Shared vocabularies ─────────────────────────────────────────────────────

export type LlmProvider = 'anthropic' | 'openai' | 'openai-compatible' | 'ollama' | 'adminium-managed';

export type LlmLocale = 'en_US' | 'de_DE' | 'ar_EG' | 'zh_CN' | 'zh_TW' | 'cs_CZ' | 'da_DK' | 'fr_FR';

export type LlmSection =
  | 'labels'
  | 'groups'
  | 'enums'
  | 'relations'
  | 'keys'
  | 'templates'
  | 'widgets'
  | 'pii'
  | 'icons'
  | 'microcopy';

export type LlmSampling = { maxValuesPerColumn: number } | null;

export type LlmRunMode = 'provider' | 'byo';

export type LlmRunStatus =
  | 'draft'
  | 'running'
  | 'awaiting_response'
  | 'validated'
  | 'applied'
  | 'partially_applied'
  | 'failed'
  | 'discarded';

export type LlmValidationStatus = 'pending' | 'valid' | 'partial' | 'invalid';

// ─── Config (§3.2) ───────────────────────────────────────────────────────────

/** `GET /config` — provider config with the key redacted to presence + last-4. */
export interface LlmConfig {
  provider: LlmProvider | null;
  model: string | null;
  baseUrl: string | null;
  maxOutputTokens: number | null;
  apiKeySet: boolean;
  /** The last 4 chars of the stored key, or `null` when unset (never the key). */
  apiKeyLast4: string | null;
}

/**
 * `PUT /config` body. `apiKey` is write-only: omit it to keep the existing key,
 * pass an empty string to clear it, pass a value to replace it (§3.2).
 */
export interface LlmConfigInput {
  provider: LlmProvider | null;
  model?: string | null;
  baseUrl?: string | null;
  apiKey?: string;
  maxOutputTokens?: number | null;
}

/** `POST /config/test` — provider `test()` ping outcome (never the key). */
export interface LlmConfigTestResult {
  ok: boolean;
  model: string | null;
  latencyMs: number | null;
  error: { code: string; message: string } | null;
}

export interface LlmModelInfo {
  id: string;
  label: string;
}

/** `GET /models` — the active provider's models + whether they are live or static. */
export interface LlmModelsResult {
  models: LlmModelInfo[];
  source: 'live' | 'static';
}

// ─── Runs ────────────────────────────────────────────────────────────────────

/** Run summary DTO (omits the heavy prompt/response blobs). */
export interface LlmRunDto {
  id: string;
  connectionId: string;
  snapshotId: string;
  mode: LlmRunMode;
  /** NULL for BYO runs (§9 telemetry-free guarantee). */
  provider: string | null;
  model: string | null;
  promptVersion: string;
  status: LlmRunStatus;
  validationStatus: LlmValidationStatus;
  sections: string[] | null;
  locales: string[] | null;
  sampling: LlmSampling;
  chunksTotal: number;
  chunksReceived: number;
  tokensIn: number | null;
  tokensOut: number | null;
  durationMs: number | null;
  appliedBy: string | null;
  appliedAt: number | null;
  createdBy: string | null;
  createdAt: number;
}

/** One validation failure (§7.2) — `message` renders verbatim in the paste UI. */
export interface LlmValidationError {
  code: string;
  severity: 'fatal' | 'item' | 'warning';
  /** JSON path into the response; `''` = the whole document. */
  path: string;
  message: string;
  hint?: string;
  suggestionId?: string;
}

/** Accepted/rejected suggestion-id lists persisted on a reviewed run (§8.3). */
export interface LlmRunReview {
  accepted: string[];
  rejected: string[];
}

/** Run detail DTO — the summary plus the validation errors + review lists. */
export interface LlmRunDetail extends LlmRunDto {
  validationErrors: LlmValidationError[] | null;
  review: LlmRunReview | null;
}

/** One re-downloadable prompt chunk (the flattened BYO document). */
export interface LlmPromptChunk {
  index: number;
  total: number;
  byo: string;
}

/** `POST /runs` body. */
export interface CreateRunInput {
  connectionId: string;
  /** `provider` = direct API path, `byo` = copy-paste round-trip. */
  path: LlmRunMode;
  /** Empty/absent ⇒ all ten sections (§4.4). */
  sections?: LlmSection[];
  /** Requested locales; `en_US` is enforced server-side. Default `['en_US']`. */
  locales?: LlmLocale[];
  sampling?: LlmSampling;
}

/** `POST /runs` reply — the created run plus its prompt artifact. */
export interface CreateRunResult {
  run: LlmRunDto;
  prompt: {
    promptVersion: string;
    tokenEstimate: number;
    chunks: LlmPromptChunk[];
  };
}

/** `POST /runs/:id/response` body — a pasted BYO chunk. */
export interface RunResponseInput {
  /** 1-based chunk index (unchunked runs omit it). */
  chunkIndex?: number;
  text: string;
}

/** `POST /runs/:id/response` reply — the run plus the full validation result. */
export interface RunResponseResult {
  run: LlmRunDetail;
  validation: {
    /** True iff no fatal error stopped the pipeline (a cleaned response exists). */
    ok: boolean;
    errors: LlmValidationError[];
    warnings: LlmValidationError[];
  };
}

/** `GET /runs/:id/prompt` reply. */
export interface RunPromptResult {
  promptVersion: string;
  chunks: LlmPromptChunk[];
}

export type SuggestionStatus =
  | 'agree'
  | 'conflict'
  | 'llm-new'
  | 'heuristic-only'
  | 'rejects-heuristic'
  | 'user-locked';

/** One reviewed suggestion diff row (§8.2). */
export interface SuggestionDiff {
  id: string;
  category: string;
  table?: string;
  status: SuggestionStatus;
  llmValue: unknown;
  heuristicValue: unknown;
  currentValue?: unknown;
  confidence: number;
  reason?: string;
}

/** `POST /runs/:id/apply` reply. */
export interface RunApplyResult {
  run: LlmRunDto;
  /** True when some actionable suggestion was rejected → `partially_applied`. */
  partial: boolean;
  counts: { overrides: number; pages: number; navGroupUpdates: number };
  review: LlmRunReview;
  /**
   * Single-use undo token backing the success-toast Undo action (§10.3); `null`
   * when the apply wrote nothing to revert.
   */
  undoToken: string | null;
}

/** `POST /runs/:id/undo/:token` reply — the reverted write counts. */
export interface RunUndoResult {
  overrides: number;
  pages: number;
}

const BASE = '/api/v1/llm';
const enc = encodeURIComponent;

export const aiApi = {
  // ── Config ──────────────────────────────────────────────────────────────────
  /** Provider config; the key is redacted to `apiKeySet` + `apiKeyLast4`. */
  getConfig: () => api.get<LlmConfig>(`${BASE}/config`),

  /** Store provider/model/baseUrl/maxOutputTokens; encrypts the api key at rest. */
  putConfig: (input: LlmConfigInput) => api.put<LlmConfig>(`${BASE}/config`, input),

  /** Ping the active provider (`test()`); never echoes the key. */
  testConfig: () => api.post<LlmConfigTestResult>(`${BASE}/config/test`),

  /** Model list for the active provider (live, with a static fallback). */
  listModels: () => api.get<LlmModelsResult>(`${BASE}/models`),

  // ── Runs ─────────────────────────────────────────────────────────────────────
  /** Build a prompt against the connection's latest snapshot → run + artifact. */
  createRun: (input: CreateRunInput) => api.post<CreateRunResult>(`${BASE}/runs`, input),

  /** Direct path: enqueue the `llm-run` job; progress rides the jobs channel. */
  executeRun: (id: string) => api.post<{ jobId: string }>(`${BASE}/runs/${enc(id)}/execute`),

  /** BYO paste: submit a chunk's response text → validation result. */
  postResponse: (id: string, input: RunResponseInput) =>
    api.post<RunResponseResult>(`${BASE}/runs/${enc(id)}/response`, input),

  /** Run history for a connection (newest first). */
  listRuns: async (connectionId: string) =>
    (await api.get<{ runs: LlmRunDto[] }>(`${BASE}/runs?connectionId=${enc(connectionId)}`)).runs,

  /** Run detail incl. validation errors + review lists. */
  getRun: (id: string) => api.get<LlmRunDetail>(`${BASE}/runs/${enc(id)}`),

  /** Re-download the prompt file(s) for a run. */
  getPrompt: (id: string) => api.get<RunPromptResult>(`${BASE}/runs/${enc(id)}/prompt`),

  /** The reviewed diff against the heuristic baseline. */
  getDiff: async (id: string) =>
    (await api.get<{ diff: SuggestionDiff[] }>(`${BASE}/runs/${enc(id)}/diff`)).diff,

  /** Apply the accepted suggestion ids in one transaction (§8.3). */
  applyRun: (id: string, accepted: string[]) =>
    api.post<RunApplyResult>(`${BASE}/runs/${enc(id)}/apply`, { accepted }),

  /** Revert exactly one apply within the toast window (single-use token, §10.3). */
  undoApply: (id: string, token: string) =>
    api.post<RunUndoResult>(`${BASE}/runs/${enc(id)}/undo/${enc(token)}`),
};
