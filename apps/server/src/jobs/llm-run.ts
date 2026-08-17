// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `llm-run` job handler — the direct-API path as an `adminium_jobs` job
 * (06-llm-assist.md §7.5, §10.2 step 3, acceptance #6).
 *
 * Given a run id, it: parses the run's persisted `prompt_text` back into the
 * per-chunk `system`/`user` messages (byte-identical to what the BYO export
 * shows — §1 invariant 1), moves the run `draft → running`, resolves the active
 * provider client (decrypted key — see `llm/provider-resolver.ts`), drives the
 * repair loop in `llm/direct-runner.ts`, and persists the terminal run through
 * T07's run-service (`validated` with the merged response + token usage +
 * duration, or `failed` with the preserved error list). A cancel aborts the run
 * to `discarded`.
 *
 * Direct-only (§9): a BYO run must never reach here — its intake is T07's
 * `run-service.receiveResponse`, and it records NO provider/model. The handler
 * guards on `mode === 'provider'`.
 *
 * Progress rides the existing jobs realtime channel (`jobs:<jobId>`, gated to the
 * job owner or `system:jobs:read` — i.e. Admin+): the worker republishes every
 * `ctx.progress()` there. Nothing here logs or emits the API key.
 */
import {
  BYO_SYSTEM_MARKER,
  BYO_USER_MARKER,
  type ProviderClient,
  type ValidationResult,
} from '@adminium/llm';
import { type LlmRun, type MetaDb } from '@adminium/meta';
import { z } from 'zod';

import {
  runDirectPath,
  type ProviderRunError,
  type RunnerChunk,
  type RunnerPhase,
} from '../llm/direct-runner.js';
import { createRunService, CHUNK_SEPARATOR, type RunService } from '../llm/run-service.js';
import type { JobHandlerContext, JobRegistry } from './registry.js';

/** Job kind for the direct-API enrichment runner. */
export const LLM_RUN_KIND = 'llm-run';

/** Payload: the run to execute. `userId` follows the jobs owner convention (§3). */
export const llmRunPayloadSchema = z.object({
  runId: z.string().min(1),
  userId: z.string().optional(),
});
export type LlmRunPayload = z.infer<typeof llmRunPayloadSchema>;

/** Everything a resolved run needs to make its provider round-trips. */
export interface ResolvedRun {
  client: ProviderClient;
  /** Display id for progress events. */
  provider: string;
  model: string;
  /** Initial response budget. */
  maxTokens: number;
  /** Ceiling `maxTokens` is raised to on `LLM_TRUNCATED` (§7.5). */
  maxTokensCeiling: number;
  /** Validate one raw reply against the run's snapshot + registries. */
  validate: (rawText: string) => ValidationResult;
}

/** Resolve a run into a provider client + budgets + validator (decrypted key). */
export type ResolveRun = (run: LlmRun) => Promise<ResolvedRun>;

export interface LlmRunHandlerDeps {
  meta: MetaDb;
  /** Turns a run into a live provider client (see `provider-resolver.ts`). */
  resolve: ResolveRun;
  /** Defaults to `createRunService({ meta })`; injected in tests. */
  runService?: RunService;
  /** Clock override — tests. */
  now?: () => number;
}

/**
 * Register the `llm-run` handler (mirrors `registerNoopProgressHandler`). Wire it
 * where the registry is built (`jobs/register.ts`) with a production
 * {@link ResolveRun}, or register it on a custom registry in tests.
 */
export function registerLlmRunHandler(registry: JobRegistry, deps: LlmRunHandlerDeps): void {
  const runService = deps.runService ?? createRunService({ meta: deps.meta });
  const now = deps.now ?? Date.now;
  registry.registerJobHandler(LLM_RUN_KIND, llmRunPayloadSchema, async (payload, ctx) => {
    await executeLlmRun(payload, ctx, { runService, resolve: deps.resolve, now });
    return { runId: payload.runId };
  }, { internal: true });
}

interface ExecuteDeps {
  runService: RunService;
  resolve: ResolveRun;
  now: () => number;
}

async function executeLlmRun(
  payload: LlmRunPayload,
  ctx: JobHandlerContext,
  deps: ExecuteDeps,
): Promise<void> {
  const { runService, resolve, now } = deps;

  const existing = await runService.getRun(payload.runId);
  if (existing === null) {
    throw new Error(`llm-run: run not found: ${payload.runId}`);
  }
  // Direct-only: BYO intake is T07's receiveResponse; it records no provider (§9).
  if (existing.mode !== 'provider') {
    throw new Error(`llm-run requires a provider run; ${existing.id} is mode "${existing.mode}"`);
  }
  if (existing.promptText === null || existing.promptText.length === 0) {
    await runService.markFailed(existing.id, {
      errors: [providerRunError('config', 'run has no stored prompt to send')],
    });
    return;
  }

  const chunks = parsePromptChunks(existing.promptText);

  // draft → running. A non-draft run (retry/concurrent worker) is left alone.
  let run: LlmRun;
  try {
    run = await runService.markRunning(existing.id);
  } catch {
    ctx.log('llm-run: run not startable, skipping', { status: existing.status });
    return;
  }

  const startedAt = now();
  try {
    const resolved = await resolve(run);
    const outcome = await runDirectPath({
      chunks,
      client: resolved.client,
      model: resolved.model,
      provider: resolved.provider,
      maxTokens: resolved.maxTokens,
      maxTokensCeiling: resolved.maxTokensCeiling,
      validate: resolved.validate,
      signal: ctx.signal,
      onProgress: (event) => {
        emitProgress(ctx, event);
      },
      onChunkComplete: async (received) => {
        await runService.recordChunkProgress(run.id, received);
      },
    });
    const durationMs = now() - startedAt;

    if (outcome.status === 'cancelled') {
      // Cooperative cancel → discard the run; the worker marks the job cancelled.
      await safeDiscard(runService, run.id);
      ctx.log('llm-run: cancelled', { runId: run.id });
      return;
    }
    if (outcome.status === 'failed') {
      await runService.markFailed(run.id, {
        errors: outcome.errors,
        tokensIn: outcome.tokensIn,
        tokensOut: outcome.tokensOut,
        durationMs,
      });
      ctx.log('llm-run: failed', { runId: run.id, errors: outcome.errors.length });
      return;
    }

    await runService.recordDirectResult(run.id, {
      response: outcome.response,
      chunksReceived: outcome.chunksReceived,
      tokensIn: outcome.tokensIn,
      tokensOut: outcome.tokensOut,
      durationMs,
      validationErrors: outcome.errors.length > 0 ? outcome.errors : null,
    });
    ctx.log('llm-run: validated', {
      runId: run.id,
      tokensIn: outcome.tokensIn,
      tokensOut: outcome.tokensOut,
    });
  } catch (error) {
    // resolve() / persistence failure. Deterministic (no key, wrong config) so a
    // job retry would not help — fail the run and let the job complete.
    if (ctx.signal.aborted) {
      await safeDiscard(runService, run.id);
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    await runService.markFailed(run.id, {
      errors: [providerRunError('config', message)],
      durationMs: now() - startedAt,
    });
    ctx.log('llm-run: errored before completion', { runId: run.id });
  }
}

/** Discard without throwing if the run already reached a terminal state. */
async function safeDiscard(runService: RunService, runId: string): Promise<void> {
  try {
    await runService.discard(runId);
  } catch {
    // Already terminal (e.g. finalized just before the cancel landed) — ignore.
  }
}

/**
 * Split a persisted `prompt_text` blob back into per-chunk direct-path messages.
 * `prompt_text` is `chunk.byo` joined by {@link CHUNK_SEPARATOR}; each chunk is
 * `=== SYSTEM ===\n<system>\n\n=== USER ===\n<user>` (the §1 invariant-1 form), so
 * the `system`/`user` recovered here are byte-identical to what was built.
 */
export function parsePromptChunks(promptText: string): RunnerChunk[] {
  const parts = promptText.split(CHUNK_SEPARATOR);
  const total = parts.length;
  return parts.map((part, index) => {
    const { system, user } = splitByo(part);
    return { index: index + 1, total, system, user };
  });
}

function splitByo(byo: string): { system: string; user: string } {
  const systemPrefix = `${BYO_SYSTEM_MARKER}\n`;
  const userSeparator = `\n\n${BYO_USER_MARKER}\n`;
  const body = byo.startsWith(systemPrefix) ? byo.slice(systemPrefix.length) : byo;
  const at = body.indexOf(userSeparator);
  if (at === -1) {
    throw new Error('llm-run: prompt chunk is missing its "=== USER ===" divider');
  }
  return { system: body.slice(0, at), user: body.slice(at + userSeparator.length) };
}

function providerRunError(code: string, message: string): ProviderRunError {
  return { kind: 'provider', provider: 'unknown', code, message };
}

const NON_DONE_PCT_CAP = 99;

/**
 * Map a {@link RunnerPhase} to a `ctx.progress()` call (published on `jobs:<id>`).
 * The percentage advances roughly with chunk position; `done` lands on 100.
 */
function emitProgress(ctx: JobHandlerContext, event: RunnerPhase): void {
  switch (event.phase) {
    case 'building':
      ctx.progress(2, { step: 'building', message: 'Building prompt' });
      return;
    case 'sending':
      ctx.progress(chunkPct(event.chunk, event.total, 0.1), {
        step: 'sending',
        message: `Sending to ${event.provider}/${event.model}`,
      });
      return;
    case 'validating':
      ctx.progress(chunkPct(event.chunk, event.total, 0.6), {
        step: 'validating',
        message: 'Validating response',
      });
      return;
    case 'truncation-retry':
      ctx.progress(chunkPct(event.chunk, event.total, 0.4), {
        step: 'truncation-retry',
        message: `Reply truncated — retrying with a higher token limit (${event.maxTokens})`,
      });
      return;
    case 'repairing':
      ctx.progress(chunkPct(event.chunk, event.total, 0.5), {
        step: 'repairing',
        message: `Repairing (${event.attempt}/${event.maxAttempts})`,
      });
      return;
    case 'chunk-done':
      ctx.progress(chunkPct(event.chunk, event.total, 1), {
        step: 'chunk-done',
        message: `Chunk ${event.chunk} of ${event.total} validated`,
      });
      return;
    case 'done':
      ctx.progress(100, { step: 'done', message: `Done: ${event.suggestions} suggestions` });
      return;
  }
}

/** A monotonic-ish percentage: 5–95 across chunks, `fraction` within a chunk. */
function chunkPct(chunk: number, total: number, fraction: number): number {
  const span = 90 / Math.max(1, total);
  const pct = 5 + (chunk - 1) * span + span * fraction;
  return Math.min(NON_DONE_PCT_CAP, Math.max(0, Math.round(pct)));
}
