/**
 * LLM run lifecycle service (06-llm-assist.md §7.4, §7.5, §9).
 *
 * The shared layer the direct-path runner (T08), the apply executor (T10b), and
 * the `/api/v1/llm/*` routes (T11) all call. It owns:
 *  - `createRun` — build the prompt (via the browser-safe `@adminium/llm`
 *    `buildPrompt`) against the connection's snapshot IR + collected stats,
 *    persist a `draft` run with its flattened `prompt_text` + `prompt_sha256`,
 *    and (§9) keep `provider`/`model` NULL for BYO runs;
 *  - `receiveResponse` — the BYO intake: validate a pasted chunk through the
 *    shared `validateResponse` pipeline and advance the run (fatal → stays
 *    `awaiting_response`; clean → `validated`);
 *  - the §7.4 status machine (legal transitions + run immutability after a
 *    terminal state).
 *
 * Architecture (01 §2.3): the transactional apply-EXECUTOR that writes overrides
 * /pages lives in T10b, not here — this service persists run rows and validation
 * outcomes only. Provider NETWORK calls belong to T08's job runner; this service
 * performs none.
 */

import { createHash } from 'node:crypto';

import type { DatabaseModel, StatsResult } from '@adminium/engine';
import {
  buildPrompt,
  isTerminalRunStatus,
  PROMPT_VERSION,
  validateResponse,
  type AllowedVocabularies,
  type LlmResponseV1,
  type LlmRunStatus,
  type LlmValidationError,
  type LocaleCode,
  type ProviderId,
  type PromptArtifact,
  type RequestedSection,
  type Sampling,
  type ValidationResult,
} from '@adminium/llm';
import { llmRunsRepo, newId, type LlmRun, type LlmRunReview, type MetaDb } from '@adminium/meta';

import type { RunFailureError } from './direct-runner.js';

/**
 * Joins multiple flattened chunk prompts into the persisted `prompt_text` blob.
 * Exported so the direct-path runner can split `prompt_text` back into the
 * per-chunk `system`/`user` messages it sends (byte-identical to what BYO shows,
 * §1 invariant 1).
 */
export const CHUNK_SEPARATOR = '\n\n=== NEXT PROMPT ===\n\n';

/**
 * §7.4 legal transitions. A terminal state has no outgoing edges, which is how
 * run immutability after `applied` is enforced (any transition off it throws).
 */
export const LEGAL_RUN_TRANSITIONS: Readonly<Record<LlmRunStatus, readonly LlmRunStatus[]>> = {
  draft: ['running', 'awaiting_response', 'failed', 'discarded'],
  running: ['validated', 'failed', 'discarded'],
  awaiting_response: ['validated', 'failed', 'discarded'],
  validated: ['applied', 'partially_applied', 'discarded'],
  applied: [],
  partially_applied: [],
  failed: [],
  discarded: [],
};

export function canTransition(from: LlmRunStatus, to: LlmRunStatus): boolean {
  return LEGAL_RUN_TRANSITIONS[from].includes(to);
}

// ─── Errors ──────────────────────────────────────────────────────────────────

export class RunNotFoundError extends Error {
  override name = 'RunNotFoundError';
  constructor(readonly runId: string) {
    super(`llm run not found: ${runId}`);
  }
}

/** A mutating call targeted a run already in a terminal state (§7.4 immutability). */
export class RunImmutableError extends Error {
  override name = 'RunImmutableError';
  constructor(readonly runId: string, readonly status: LlmRunStatus) {
    super(`llm run ${runId} is ${status} and immutable`);
  }
}

export class InvalidRunTransitionError extends Error {
  override name = 'InvalidRunTransitionError';
  constructor(readonly runId: string, readonly from: LlmRunStatus, readonly to: LlmRunStatus) {
    super(`illegal llm run transition ${from} → ${to} (run ${runId})`);
  }
}

/**
 * A BYO run was asked to record a provider/model — forbidden by the §9
 * telemetry-free guarantee (BYO `provider`/`model` stay NULL, never recorded).
 */
export class ByoTelemetryError extends Error {
  override name = 'ByoTelemetryError';
  constructor(message: string) {
    super(message);
  }
}

// ─── Inputs / outputs ────────────────────────────────────────────────────────

export interface CreateRunInput {
  connectionId: string;
  /** The snapshot the run is built and later validated against (§7.4). */
  snapshotId: string;
  /** The classified schema IR (from the snapshot). */
  schemaIr: DatabaseModel;
  /** Aggregate statistics (adapter `collectTableStats` output). */
  stats: readonly StatsResult[];
  /** Requested output locales; must include `en_US` (enforced by `buildPrompt`). */
  locales: readonly LocaleCode[];
  /** Requested decision groups (§4.4); empty ⇒ all sections. */
  sections: readonly RequestedSection[];
  /** Sampling opt-in (§4.2); `null` = sample-free (default). */
  sampling: Sampling;
  /** `provider` = direct API path, `byo` = copy-paste round-trip. */
  mode: 'provider' | 'byo';
  /** Direct path only. MUST be null/undefined for `byo` (§9). */
  provider?: ProviderId | null;
  /** Direct path only. MUST be null/undefined for `byo` (§9). */
  model?: string | null;
  /** `LLM_ALLOWED_TEMPLATES` / `LLM_ALLOWED_WIDGETS` from `@adminium/widgets`. */
  allowed: AllowedVocabularies;
  createdBy?: string | null;
  /** Override the default input-token budget (§4.5). */
  tokenBudget?: number;
}

export interface CreateRunResult {
  run: LlmRun;
  artifact: PromptArtifact;
}

/** BYO response intake — everything the shared validation pipeline needs (§7.2). */
export interface ReceiveResponseInput {
  /** Raw pasted/received text (a full JSON object, fences/prose tolerated). */
  text: string;
  /** 1-based chunk index (unchunked runs omit it). */
  chunkIndex?: number;
  /** The classified schema IR the run was built against (from the snapshot). */
  snapshot: DatabaseModel;
  /** `LLM_ALLOWED_TEMPLATES` — recommendable page-template ids. */
  allowedTemplates: readonly string[];
  /** `LLM_ALLOWED_WIDGETS` — the curated dashboard-widget subset. */
  allowedWidgets: readonly string[];
  /** Bundled lucide manifest for the icon-fallback warning (optional). */
  allowedIcons?: ReadonlySet<string> | readonly string[];
  /** Stats enabling pseudo-enum acceptance in referential checks (optional). */
  stats?: readonly StatsResult[];
  /** Tables present only as chunk context (§4.5). */
  stubTables?: readonly string[];
  /**
   * Validate WITHOUT persisting anything: no `recordResponse`, no status
   * transition, no chunk counted. The returned `run` is a projection of what the
   * row WOULD have become, so callers can render the same summary they would
   * from a real intake.
   *
   * This exists because `adminium apply-llm-response --dry-run` promises
   * "Nothing was written" and validation is the only thing it can honestly do
   * along the way: intake is a WRITE (it commits the response and flips the run
   * to `validated`, after which the run can never take a different pasted
   * response). Doing it and then printing "nothing was written" was the
   * opposite of the flag. Chunked runs made it worse — a dry run of chunk 1
   * consumed the slot, so a later real apply of chunk 1 could reach
   * `chunksReceived === chunksTotal` with chunk 2 never pasted.
   */
  dryRun?: boolean;
}

export interface ReceiveResponseResult {
  run: LlmRun;
  /** The full validation result (errors + warnings + cleaned response). */
  validation: ValidationResult;
}

export interface MarkFailedInput {
  /** Preserved error list — validation failures and/or a provider transport error (§7.5). */
  errors?: readonly RunFailureError[];
  /** Token usage consumed before the failure (recorded for observability). */
  tokensIn?: number | null;
  tokensOut?: number | null;
  durationMs?: number | null;
}

/** running → validated persistence for the direct path (T08). */
export interface RecordDirectResultInput {
  /** The merged (map-reduce) parsed response (§7.4 `parsed_response`). */
  response: LlmResponseV1;
  /** Chunks that validated cleanly (== chunksTotal on success). */
  chunksReceived: number;
  tokensIn: number;
  tokensOut: number;
  durationMs: number;
  /** Accumulated per-item errors → `validation_status` `partial` vs `valid`. */
  validationErrors?: readonly LlmValidationError[] | null;
}

export interface MarkAppliedInput {
  appliedBy?: string | null;
  /** True when some suggestions were rejected in review → `partially_applied`. */
  partial?: boolean;
  review?: LlmRunReview;
}

export interface RunServiceDeps {
  meta: MetaDb;
  /** Clock override — tests. */
  now?: () => number;
}

// ─── Service ─────────────────────────────────────────────────────────────────

export function createRunService(deps: RunServiceDeps) {
  const runs = llmRunsRepo(deps.meta);
  const now = deps.now ?? Date.now;

  async function findOrThrow(runId: string): Promise<LlmRun> {
    const run = await runs.findById(runId);
    if (run === null) throw new RunNotFoundError(runId);
    return run;
  }

  function assertTransition(run: LlmRun, to: LlmRunStatus): void {
    if (isTerminalRunStatus(run.status)) throw new RunImmutableError(run.id, run.status);
    if (!canTransition(run.status, to)) {
      throw new InvalidRunTransitionError(run.id, run.status, to);
    }
  }

  /** Move `runId` to `to`, guarding on its current status so the write is atomic. */
  async function transition(run: LlmRun, to: LlmRunStatus): Promise<LlmRun> {
    assertTransition(run, to);
    const ok = await runs.updateStatus(run.id, to, { expected: run.status, at: now() });
    if (!ok) {
      // The row changed under us (concurrent transition) — re-read and reject.
      const fresh = await findOrThrow(run.id);
      throw new InvalidRunTransitionError(run.id, fresh.status, to);
    }
    return findOrThrow(run.id);
  }

  return {
    getRun: (runId: string): Promise<LlmRun | null> => runs.findById(runId),
    listRuns: (connectionId: string): Promise<LlmRun[]> => runs.listForConnection(connectionId),

    /**
     * Build the prompt and persist a `draft` run. For BYO runs `provider`/`model`
     * are forced NULL (§9); passing either is a {@link ByoTelemetryError}. The run
     * id equals the runId embedded in the prompt (§7.4).
     */
    async createRun(input: CreateRunInput): Promise<CreateRunResult> {
      if (input.mode === 'byo') {
        if ((input.provider ?? null) !== null || (input.model ?? null) !== null) {
          throw new ByoTelemetryError(
            'BYO runs must not record a provider or model (06-llm-assist.md §9).',
          );
        }
      }

      const id = newId('run');
      const artifact = buildPrompt(
        {
          snapshotId: input.snapshotId,
          schemaIr: input.schemaIr,
          stats: input.stats,
          locales: input.locales,
          sections: input.sections,
          sampling: input.sampling,
          runId: id,
        },
        {
          allowed: input.allowed,
          ...(input.tokenBudget !== undefined ? { tokenBudget: input.tokenBudget } : {}),
        },
      );

      const promptText = artifact.chunks.map((chunk) => chunk.byo).join(CHUNK_SEPARATOR);
      const promptHash = createHash('sha256').update(promptText).digest('hex');

      const run = await runs.create(
        {
          id,
          connectionId: input.connectionId,
          snapshotId: input.snapshotId,
          mode: input.mode,
          provider: input.mode === 'byo' ? null : input.provider ?? null,
          model: input.mode === 'byo' ? null : input.model ?? null,
          promptVersion: PROMPT_VERSION,
          promptHash,
          promptText,
          sections: artifact.sections,
          locales: input.locales,
          sampling: input.sampling,
          chunksTotal: artifact.chunks.length,
          chunksReceived: 0,
          status: 'draft',
          createdBy: input.createdBy ?? null,
        },
        now(),
      );

      return { run, artifact };
    },

    /** draft → running (direct path; T08 calls this before the provider call). */
    async markRunning(runId: string): Promise<LlmRun> {
      const run = await findOrThrow(runId);
      return transition(run, 'running');
    },

    /** draft → awaiting_response (BYO; the run now waits for a pasted response). */
    async markAwaitingResponse(runId: string): Promise<LlmRun> {
      const run = await findOrThrow(runId);
      return transition(run, 'awaiting_response');
    },

    /**
     * BYO intake (§7.2): validate a pasted chunk against the run's snapshot and
     * requested locales. A fatal error keeps the run in `awaiting_response` (the
     * user can fix and re-paste); a clean parse advances it to `validated` once
     * every chunk is received.
     */
    async receiveResponse(
      runId: string,
      input: ReceiveResponseInput,
    ): Promise<ReceiveResponseResult> {
      const run = await findOrThrow(runId);
      if (isTerminalRunStatus(run.status)) throw new RunImmutableError(run.id, run.status);
      if (run.status !== 'awaiting_response') {
        throw new InvalidRunTransitionError(run.id, run.status, 'validated');
      }

      const validation = validateResponse(input.text, {
        snapshot: input.snapshot,
        locales: (run.locales ?? ['en_US']) as LocaleCode[],
        allowedTemplates: input.allowedTemplates,
        allowedWidgets: input.allowedWidgets,
        ...(input.allowedIcons !== undefined ? { allowedIcons: input.allowedIcons } : {}),
        ...(input.stats !== undefined ? { stats: input.stats } : {}),
        ...(input.stubTables !== undefined ? { stubTables: input.stubTables } : {}),
        runId: run.id,
      });

      const dryRun = input.dryRun === true;

      if (validation.response === undefined) {
        // Fatal (stage 1–4): stays awaiting_response, errors preserved (§7.2/§7.5).
        if (dryRun) {
          return {
            run: {
              ...run,
              validationStatus: 'invalid',
              responseRaw: input.text,
              validationErrors: validation.errors,
            },
            validation,
          };
        }
        await runs.recordResponse(run.id, {
          status: 'awaiting_response',
          validationStatus: 'invalid',
          responseRaw: input.text,
          validationErrors: validation.errors,
        });
        return { run: await findOrThrow(run.id), validation };
      }

      const chunksReceived = Math.min(run.chunksReceived + 1, run.chunksTotal);
      const allReceived = chunksReceived >= run.chunksTotal;
      const nextStatus: LlmRunStatus = allReceived ? 'validated' : 'awaiting_response';
      const validationStatus = validation.errors.length > 0 ? 'partial' : 'valid';

      if (dryRun) {
        // The row the caller WOULD have got — computed from the same values the
        // write below uses, so the projection cannot drift from the real thing.
        return {
          run: {
            ...run,
            status: nextStatus,
            validationStatus,
            responseRaw: input.text,
            responseJson: validation.response,
            validationErrors: validation.errors.length > 0 ? validation.errors : null,
            chunksReceived,
          },
          validation,
        };
      }

      await runs.recordResponse(run.id, {
        status: nextStatus,
        validationStatus,
        responseRaw: input.text,
        responseJson: validation.response,
        validationErrors: validation.errors.length > 0 ? validation.errors : null,
        chunksReceived,
      });
      return { run: await findOrThrow(run.id), validation };
    },

    /**
     * Persist the accepted/rejected suggestion-id lists (§8.3). Allowed once the
     * run is `validated` and before it terminates; survives reload for re-review.
     */
    async recordReview(runId: string, review: LlmRunReview): Promise<LlmRun> {
      const run = await findOrThrow(runId);
      if (isTerminalRunStatus(run.status)) throw new RunImmutableError(run.id, run.status);
      if (run.status !== 'validated') {
        throw new InvalidRunTransitionError(run.id, run.status, run.status);
      }
      await runs.recordReview(run.id, review);
      return findOrThrow(run.id);
    },

    /**
     * validated → applied | partially_applied. The transactional overrides/pages
     * writes are the apply-EXECUTOR's job (T10b); this only stamps the terminal
     * run row (and, optionally, the final review).
     */
    async markApplied(runId: string, input: MarkAppliedInput = {}): Promise<LlmRun> {
      const run = await findOrThrow(runId);
      const to: LlmRunStatus = input.partial === true ? 'partially_applied' : 'applied';
      assertTransition(run, to);
      await runs.markApplied(
        run.id,
        {
          appliedBy: input.appliedBy ?? null,
          status: to,
          ...(input.review !== undefined ? { review: input.review } : {}),
        },
        now(),
      );
      return findOrThrow(run.id);
    },

    /**
     * running → validated for the direct path (T08). Records the merged parsed
     * response, token usage and wall-clock duration; `validation_status` is
     * `partial` when per-item errors survived, else `valid` (§7.4).
     */
    async recordDirectResult(
      runId: string,
      input: RecordDirectResultInput,
    ): Promise<LlmRun> {
      const run = await findOrThrow(runId);
      if (isTerminalRunStatus(run.status)) throw new RunImmutableError(run.id, run.status);
      if (run.status !== 'running') {
        throw new InvalidRunTransitionError(run.id, run.status, 'validated');
      }
      const hasItemErrors = (input.validationErrors?.length ?? 0) > 0;
      await runs.recordResponse(run.id, {
        status: 'validated',
        validationStatus: hasItemErrors ? 'partial' : 'valid',
        responseJson: input.response,
        validationErrors: hasItemErrors ? input.validationErrors ?? null : null,
        chunksReceived: input.chunksReceived,
        tokensIn: input.tokensIn,
        tokensOut: input.tokensOut,
        durationMs: input.durationMs,
      });
      return findOrThrow(run.id);
    },

    /**
     * Bump `chunks_received` on a still-`running` chunked run (§7.5 map phase
     * progress). Best-effort — swallows the terminal/immutable case so a
     * cancellation racing the update never resurrects a discarded run.
     */
    async recordChunkProgress(runId: string, chunksReceived: number): Promise<void> {
      const run = await runs.findById(runId);
      if (run === null || run.status !== 'running') return;
      await runs.recordResponse(runId, {
        status: 'running',
        validationStatus: 'pending',
        chunksReceived,
      });
    },

    /** running | awaiting_response → failed (repair exhausted / provider error, §7.5). */
    async markFailed(runId: string, input: MarkFailedInput = {}): Promise<LlmRun> {
      const run = await findOrThrow(runId);
      assertTransition(run, 'failed');
      await runs.recordResponse(run.id, {
        status: 'failed',
        validationStatus: 'invalid',
        validationErrors: input.errors ?? null,
        ...(input.tokensIn !== undefined ? { tokensIn: input.tokensIn } : {}),
        ...(input.tokensOut !== undefined ? { tokensOut: input.tokensOut } : {}),
        ...(input.durationMs !== undefined ? { durationMs: input.durationMs } : {}),
      });
      return findOrThrow(run.id);
    },

    /** Abandon a non-terminal run (user cancel) → discarded. */
    async discard(runId: string): Promise<LlmRun> {
      const run = await findOrThrow(runId);
      return transition(run, 'discarded');
    },
  };
}

export type RunService = ReturnType<typeof createRunService>;
