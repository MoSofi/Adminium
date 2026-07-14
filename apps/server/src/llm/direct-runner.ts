/**
 * Direct-API path runner (06-llm-assist.md §7.5, §10.2 step 3, acceptance #6).
 *
 * The provider-agnostic core the `llm-run` job handler drives: given the
 * per-chunk prompts, a {@link ProviderClient}, and a `validate` closure, it runs
 * the map phase (one provider round-trip per chunk, with the §7.5 repair loop),
 * then reduces the per-chunk `LlmResponseV1` results into one via the browser-safe
 * `@adminium/llm` merge. It is DELIBERATELY free of `@adminium/meta` / persistence
 * / the jobs runtime so it stays a pure, unit-testable function — the handler
 * (`jobs/llm-run.ts`) owns run-state persistence and progress fan-out.
 *
 * §7.5 repair loop (per chunk):
 *  - A clean reply (no FATAL error) ends the chunk. Per-item (referential) errors
 *    are review-time information and NEVER trigger a repair.
 *  - A FATAL stage-1–4 failure sends a repair turn — the model's bad output as an
 *    `assistant` message, then the exact §7.5 `user` message carrying the error
 *    list — up to {@link DEFAULT_MAX_REPAIRS} (2) times.
 *  - `LLM_TRUNCATED` first raises `maxTokens` to the provider ceiling and retries
 *    the SAME messages, WITHOUT consuming a repair attempt (§7.5). Only once the
 *    budget is already at the ceiling does a further truncation cost a repair.
 *  - Initial attempt + 2 exhausted repairs = 3 consecutive failures → the run
 *    fails with the last error list preserved.
 *
 * Temperature is pinned to 0 on every call (determinism mandate, §3.1). The API
 * key lives only inside the injected client; nothing here logs or returns it.
 */
import {
  isFatal,
  mergeChunkResponses,
  ProviderError,
  type LlmResponseV1,
  type LlmValidationError,
  type ProviderClient,
  type ValidationResult,
} from '@adminium/llm';

/** Max repair turns per chunk before the run fails (§7.5). */
export const DEFAULT_MAX_REPAIRS = 2;

/** Longest error list embedded in a repair message (§7.5 "max 20"). */
export const MAX_REPAIR_ERRORS = 20;

/** One map-phase prompt: the direct-path `system` + initial `user` messages. */
export interface RunnerChunk {
  /** 1-based position for display; `1`/`total: 1` for an unchunked run. */
  index: number;
  total: number;
  system: string;
  user: string;
}

/**
 * A provider transport/config failure recorded on a failed run. Distinct from a
 * {@link LlmValidationError} — it carries the {@link ProviderError} code, never a
 * schema path, and is scrubbed of the API key by `ProviderError` itself. Stored
 * opaquely in `adminium_llm_runs.validation_errors` alongside validation errors.
 */
export interface ProviderRunError {
  kind: 'provider';
  provider: string;
  /** {@link ProviderError.code} — `network` / `timeout` / `auth` / … */
  code: string;
  message: string;
}

/** A failed-run error entry: a validation failure OR a provider transport error. */
export type RunFailureError = LlmValidationError | ProviderRunError;

export function isProviderRunError(error: RunFailureError): error is ProviderRunError {
  return (error as ProviderRunError).kind === 'provider';
}

/** Progress phases (§10.2 step 3), mapped to hub events by the handler. */
export type RunnerPhase =
  | { phase: 'building' }
  | { phase: 'sending'; chunk: number; total: number; provider: string; model: string }
  | { phase: 'validating'; chunk: number; total: number }
  | { phase: 'truncation-retry'; chunk: number; total: number; maxTokens: number }
  | { phase: 'repairing'; chunk: number; total: number; attempt: number; maxAttempts: number }
  | { phase: 'chunk-done'; chunk: number; total: number; received: number }
  | { phase: 'done'; suggestions: number };

export interface DirectRunInput {
  /** Per-chunk prompts (one entry for an unchunked run). */
  chunks: readonly RunnerChunk[];
  client: ProviderClient;
  /** Selected model id passed to `complete()`. */
  model: string;
  /** Display id for the `sending` progress event (`anthropic`, `openai`, …). */
  provider: string;
  /** Initial response budget (`maxTokens`); default provider budget when unset. */
  maxTokens: number;
  /** Ceiling `maxTokens` is raised to on `LLM_TRUNCATED` before a repair (§7.5). */
  maxTokensCeiling: number;
  /** Validate one raw reply against the run's snapshot + registries. */
  validate(rawText: string): ValidationResult;
  /** Progress sink (§10.2). */
  onProgress?: (event: RunnerPhase) => void;
  /** Called after each chunk validates cleanly — persists `chunks_received`. */
  onChunkComplete?: (received: number) => void | Promise<void>;
  /** Cooperative cancellation; checked at every turn boundary (§10.2). */
  signal?: AbortSignal;
  /** Max repair turns per chunk (§7.5 = 2). */
  maxRepairs?: number;
}

export type DirectRunOutcome =
  | {
      status: 'validated';
      /** Merged (map-reduce) response across all chunks. */
      response: LlmResponseV1;
      tokensIn: number;
      tokensOut: number;
      chunksReceived: number;
      /** Accumulated per-item validation errors (review-time info). */
      errors: LlmValidationError[];
      warnings: LlmValidationError[];
    }
  | {
      status: 'failed';
      /** The last fatal error list, or a single provider-transport error. */
      errors: RunFailureError[];
      tokensIn: number;
      tokensOut: number;
      chunksReceived: number;
    }
  | { status: 'cancelled'; chunksReceived: number };

/**
 * Build the §7.5 repair `user` message VERBATIM. The error list renders each
 * failure as `code, JSON path, message`, capped at {@link MAX_REPAIR_ERRORS}.
 */
export function buildRepairMessage(errors: readonly LlmValidationError[]): string {
  const list = errors
    .slice(0, MAX_REPAIR_ERRORS)
    .map((error) => `- ${error.code}, ${error.path === '' ? '(root)' : error.path}, ${error.message}`)
    .join('\n');
  return [
    'Your previous response failed machine validation:',
    list,
    'Return the corrected COMPLETE JSON object now. Output rules still apply:',
    'single JSON object, no prose, no fences, schema_version first.',
  ].join('\n');
}

/** Count the atomic suggestions in a response (the "done: N suggestions" total). */
export function countSuggestions(response: LlmResponseV1): number {
  let total = 0;
  for (const table of response.tables) {
    total += 1 + table.columns.length;
  }
  total += response.enums.length;
  total += response.relations.confirmed.length + response.relations.inferred.length;
  total += response.navGroups.length;
  for (const dashboard of response.dashboards) {
    total += 1 + dashboard.widgets.length;
  }
  return total;
}

type ChatMessage = { role: 'user' | 'assistant'; content: string };

/** A single chunk succeeded (its validated response) — internal map-phase result. */
interface ChunkSuccess {
  kind: 'ok';
  response: LlmResponseV1;
  errors: LlmValidationError[];
  warnings: LlmValidationError[];
}
interface ChunkFailure {
  kind: 'failed';
  errors: RunFailureError[];
}
interface ChunkCancelled {
  kind: 'cancelled';
}
type ChunkResult = ChunkSuccess | ChunkFailure | ChunkCancelled;

/**
 * Run the direct-API path over every chunk and reduce to one response. Never
 * throws for provider or validation failures — those resolve to a `failed`
 * outcome so the caller records the run rather than retrying the whole job.
 */
export async function runDirectPath(input: DirectRunInput): Promise<DirectRunOutcome> {
  const maxRepairs = input.maxRepairs ?? DEFAULT_MAX_REPAIRS;
  input.onProgress?.({ phase: 'building' });

  const responses: LlmResponseV1[] = [];
  const errors: LlmValidationError[] = [];
  const warnings: LlmValidationError[] = [];
  const usage = { tokensIn: 0, tokensOut: 0 };
  let chunksReceived = 0;

  for (const chunk of input.chunks) {
    if (input.signal?.aborted) return { status: 'cancelled', chunksReceived };

    const result = await runChunk(chunk, input, maxRepairs, usage);

    if (result.kind === 'cancelled') return { status: 'cancelled', chunksReceived };
    if (result.kind === 'failed') {
      return {
        status: 'failed',
        errors: result.errors,
        tokensIn: usage.tokensIn,
        tokensOut: usage.tokensOut,
        chunksReceived,
      };
    }

    responses.push(result.response);
    errors.push(...result.errors);
    warnings.push(...result.warnings);
    chunksReceived += 1;
    input.onProgress?.({
      phase: 'chunk-done',
      chunk: chunk.index,
      total: chunk.total,
      received: chunksReceived,
    });
    await input.onChunkComplete?.(chunksReceived);
  }

  if (input.signal?.aborted) return { status: 'cancelled', chunksReceived };

  // Reduce phase — deterministic, order-independent (§4.5, acceptance #7).
  const merged = mergeChunkResponses(responses);
  input.onProgress?.({ phase: 'done', suggestions: countSuggestions(merged) });

  return {
    status: 'validated',
    response: merged,
    tokensIn: usage.tokensIn,
    tokensOut: usage.tokensOut,
    chunksReceived,
    errors,
    warnings,
  };
}

/** One chunk's map phase: send → validate → repair loop (§7.5). */
async function runChunk(
  chunk: RunnerChunk,
  input: DirectRunInput,
  maxRepairs: number,
  usage: { tokensIn: number; tokensOut: number },
): Promise<ChunkResult> {
  const messages: ChatMessage[] = [{ role: 'user', content: chunk.user }];
  let maxTokens = input.maxTokens;
  let repairs = 0;

  for (;;) {
    if (input.signal?.aborted) return { kind: 'cancelled' };

    input.onProgress?.({
      phase: 'sending',
      chunk: chunk.index,
      total: chunk.total,
      provider: input.provider,
      model: input.model,
    });

    let reply: { text: string; usage?: { inputTokens: number; outputTokens: number } };
    try {
      // Temperature pinned 0 — determinism mandate (§3.1).
      reply = await input.client.complete({
        system: chunk.system,
        messages: messages.map((message) => ({ ...message })),
        model: input.model,
        maxTokens,
        temperature: 0,
      });
    } catch (error) {
      // Transport/config failure: not repairable by re-prompting → the run fails.
      return { kind: 'failed', errors: [toProviderRunError(error, input.provider)] };
    }
    usage.tokensIn += reply.usage?.inputTokens ?? 0;
    usage.tokensOut += reply.usage?.outputTokens ?? 0;

    input.onProgress?.({ phase: 'validating', chunk: chunk.index, total: chunk.total });
    const validation = input.validate(reply.text);

    if (validation.response !== undefined) {
      // Clean parse (no fatal). Per-item errors are review-time info, not repairs.
      return {
        kind: 'ok',
        response: validation.response,
        errors: validation.errors,
        warnings: validation.warnings,
      };
    }

    const fatals = validation.errors.filter(isFatal);
    const truncated = fatals.some((error) => error.code === 'LLM_TRUNCATED');

    // Truncation escalates the budget once, for free, before any repair (§7.5).
    if (truncated && maxTokens < input.maxTokensCeiling) {
      maxTokens = input.maxTokensCeiling;
      input.onProgress?.({
        phase: 'truncation-retry',
        chunk: chunk.index,
        total: chunk.total,
        maxTokens,
      });
      continue;
    }

    if (repairs >= maxRepairs) {
      // Initial attempt + `maxRepairs` failed = 3 consecutive failures (§7.5).
      return { kind: 'failed', errors: [...validation.errors] };
    }

    repairs += 1;
    input.onProgress?.({
      phase: 'repairing',
      chunk: chunk.index,
      total: chunk.total,
      attempt: repairs,
      maxAttempts: maxRepairs,
    });
    messages.push({ role: 'assistant', content: reply.text });
    messages.push({ role: 'user', content: buildRepairMessage(fatals) });
  }
}

/** Map an unknown thrown value to a key-scrubbed {@link ProviderRunError}. */
function toProviderRunError(error: unknown, provider: string): ProviderRunError {
  if (error instanceof ProviderError) {
    return { kind: 'provider', provider: error.provider, code: error.code, message: error.message };
  }
  return {
    kind: 'provider',
    provider,
    code: 'unknown',
    message: error instanceof Error ? error.message : String(error),
  };
}
