// SPDX-License-Identifier: AGPL-3.0-only
/**
 * LLM-assist routes (06-llm-assist.md §10.5) — the HTTP surface over the T07 run
 * service, the T08 `llm-run` job, and the T10b apply executor.
 *
 * The full §10.5 table, all guarded by `system:llm:run` (Admin + Super-Admin;
 * Editor/Viewer → 403, acceptance #13):
 *
 *   GET  /llm/config              provider config (key WRITE-ONLY, §3.2)
 *   PUT  /llm/config              store provider/model/baseUrl/maxOutputTokens
 *                                 + AES-256-GCM-encrypt the api key (acceptance #10)
 *   POST /llm/config/test         provider `test()` ping (never the key)
 *   GET  /llm/models              active-provider model list (+ static fallback)
 *   POST /llm/runs                create a run → run + prompt artifact
 *   POST /llm/runs/:id/execute    direct path: enqueue the `llm-run` job (202)
 *   POST /llm/runs/:id/response   BYO paste: chunk text → validation result
 *   GET  /llm/runs                history (per connection)
 *   GET  /llm/runs/:id            run detail (incl. validation errors + review)
 *   GET  /llm/runs/:id/prompt     re-download the prompt file(s)
 *   GET  /llm/runs/:id/diff       SuggestionDiff[] against the heuristic baseline
 *   POST /llm/runs/:id/apply      apply the accepted suggestion ids (§8.3)
 *
 * The api key never appears in any reply or log: `PUT` encrypts before storage,
 * `GET` returns `apiKeySet` + last-4 only, and every provider error is scrubbed
 * of the key by `ProviderError` before it reaches a response.
 *
 * Injected deps (this tree must not import `@adminium/widgets`, so the allowed
 * vocabularies + key crypto arrive from the app-wiring layer): see
 * {@link LlmRoutesDeps}.
 */

import { parseDatabaseModel, type DatabaseModel } from '@adminium/engine';
import {
  ProviderError,
  type AllowedVocabularies,
  type LlmKeyCrypto,
  type LocaleCode,
  type RequestedSection,
  type Sampling,
} from '@adminium/llm';
import { settingsRepo, snapshotsRepo, type LlmRun, type MetaDb } from '@adminium/meta';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { AppError, ConflictError, ForbiddenError, NotFoundError, ValidationFailedError } from '../../errors.js';
import { LLM_RUN_KIND } from '../../jobs/llm-run.js';
import type { ApplyService } from '../../llm/apply-service.js';
import { RunNotApplicableError, SnapshotNotFoundError } from '../../llm/apply-service.js';
import { LlmApplyUndoStore } from '../../llm/apply-undo-store.js';
import {
  createPromptService,
  ProviderNotSelectedError,
  SnapshotRequiredError,
  type CollectRunStats,
} from '../../llm/prompt-service.js';
import { CHUNK_SEPARATOR } from '../../llm/run-service.js';
import {
  ByoTelemetryError,
  InvalidRunTransitionError,
  RunImmutableError,
  RunNotFoundError,
  type RunService,
} from '../../llm/run-service.js';
import {
  ProviderNotConfiguredError,
  readLlmConfig,
  resolveProviderClient,
  writeLlmConfig,
  type CreateClient,
} from './config-service.js';
import {
  createRunBody,
  createRunReply,
  jobAcceptedReply,
  llmConfigPutBody,
  llmConfigReply,
  llmConfigTestReply,
  llmModelsReply,
  runApplyBody,
  runApplyReply,
  runDiffReply,
  runIdParams,
  runPromptReply,
  runResponseBody,
  runResponseReply,
  runUndoParams,
  runUndoReply,
  runsListQuery,
  runsListReply,
  llmRunDetailDto,
  type LlmRunDetailDto,
  type LlmRunDto,
  type LlmValidationErrorDto,
} from './schema.js';

/** Every `/api/v1/llm/*` route requires this grant — Admin + Super-Admin only (§10.1). */
export const LLM_RUN_PERMISSION = 'system:llm:run';

/**
 * The §4.2 stats collector contract now lives with the prompt service — the CLI
 * injects the same shape. Re-exported here so existing importers of
 * `routes/llm/index.js` keep resolving.
 */
export type { CollectRunStats, CollectRunStatsInput } from '../../llm/prompt-service.js';

export interface LlmRoutesDeps {
  meta: MetaDb;
  /** T07 — run lifecycle (create/receive/status machine). */
  runService: RunService;
  /** T10b — transactional apply executor + diff/plan builder. */
  applyService: ApplyService;
  /** AES-256-GCM closures for the `llm.apiKey` setting at rest (§3.2). */
  keyCrypto: LlmKeyCrypto;
  /**
   * `LLM_ALLOWED_TEMPLATES` / `LLM_ALLOWED_WIDGETS` from `@adminium/widgets` —
   * INJECTED, since the server tree must not import the widgets package.
   */
  allowed: AllowedVocabularies;
  /** Bundled lucide manifest for the icon-fallback warning (optional). */
  allowedIcons?: ReadonlySet<string> | readonly string[];
  /** §4.2 stats collector (default: none — sample-free, statistics omitted). */
  collectStats?: CollectRunStats;
  /** Test seam — construct a provider client (default: the real client). */
  createClient?: CreateClient;
  /** In-process apply-undo token store (default: a fresh instance per plugin). */
  undoStore?: LlmApplyUndoStore;
}

/** Extract the acting session-user id (API-key principals stamp NULL, like siblings). */
function actorIdOf(request: FastifyRequest): string | null {
  return request.apiKeyPrincipal === null
    ? ((request as unknown as { user?: { id?: string } }).user?.id ?? null)
    : null;
}

/** Map an `LlmRun` row to the summary DTO (omits the heavy prompt/response blobs). */
function toRunDto(run: LlmRun): LlmRunDto {
  return {
    id: run.id,
    connectionId: run.connectionId,
    snapshotId: run.snapshotId,
    mode: run.mode,
    provider: run.provider,
    model: run.model,
    promptVersion: run.promptVersion,
    status: run.status,
    validationStatus: run.validationStatus,
    sections: run.sections,
    locales: run.locales,
    sampling: run.sampling,
    chunksTotal: run.chunksTotal,
    chunksReceived: run.chunksReceived,
    tokensIn: run.tokensIn,
    tokensOut: run.tokensOut,
    durationMs: run.durationMs,
    appliedBy: run.appliedBy,
    appliedAt: run.appliedAt,
    createdBy: run.createdBy,
    createdAt: run.createdAt,
  };
}

/** The detail DTO — the summary plus the validation errors + review lists. */
function toRunDetailDto(run: LlmRun): LlmRunDetailDto {
  return {
    ...toRunDto(run),
    validationErrors: (run.validationErrors as LlmValidationErrorDto[] | null) ?? null,
    review: run.review,
  };
}

/** Split a persisted `prompt_text` blob into its per-chunk BYO documents (§10.2). */
function splitPromptChunks(promptText: string): { index: number; total: number; byo: string }[] {
  const parts = promptText.split(CHUNK_SEPARATOR);
  return parts.map((byo, index) => ({ index: index + 1, total: parts.length, byo }));
}

export function llmRoutes(deps: LlmRoutesDeps): FastifyPluginAsyncZod {
  const { meta, runService, applyService, keyCrypto, allowed } = deps;
  const snapshots = snapshotsRepo(meta);
  const settings = settingsRepo(meta);
  const undoStore = deps.undoStore ?? new LlmApplyUndoStore();
  const promptService = createPromptService({
    meta,
    runService,
    allowed,
    ...(deps.collectStats === undefined ? {} : { collectStats: deps.collectStats }),
  });

  const allowedTemplates = allowed.templates;
  const allowedWidgets = allowed.widgets;

  async function loadModelForRun(run: LlmRun): Promise<DatabaseModel> {
    const snapshot = await snapshots.findById(run.snapshotId);
    if (snapshot === null) {
      throw new NotFoundError('The run’s schema snapshot no longer exists.', {
        snapshotId: run.snapshotId,
      });
    }
    return parseDatabaseModel(snapshot.schema);
  }

  return async (app) => {
    const guard = app.rbac.require(LLM_RUN_PERMISSION);

    // ── Config (§3.2) ─────────────────────────────────────────────────────────

    app.get(
      '/llm/config',
      { preHandler: guard, schema: { response: { 200: llmConfigReply } } },
      async () => readLlmConfig(settings, keyCrypto),
    );

    app.put(
      '/llm/config',
      { preHandler: guard, schema: { body: llmConfigPutBody, response: { 200: llmConfigReply } } },
      async (request) => {
        const before = await readLlmConfig(settings, keyCrypto);
        const at = app.rbac.now();
        await writeLlmConfig(settings, keyCrypto, request.body, {
          updatedBy: actorIdOf(request),
          at,
        });
        const after = await readLlmConfig(settings, keyCrypto);
        // Audit carries provider/model/baseUrl/key-presence only — never the key.
        await app.rbac.audit(request, {
          category: 'llm',
          action: 'llm.config.update',
          changes: {
            before: {
              provider: before.provider,
              model: before.model,
              baseUrl: before.baseUrl,
              maxOutputTokens: before.maxOutputTokens,
              apiKeySet: before.apiKeySet,
            },
            after: {
              provider: after.provider,
              model: after.model,
              baseUrl: after.baseUrl,
              maxOutputTokens: after.maxOutputTokens,
              apiKeySet: after.apiKeySet,
            },
          },
        });
        return after;
      },
    );

    app.post(
      '/llm/config/test',
      { preHandler: guard, schema: { response: { 200: llmConfigTestReply } } },
      async () => {
        try {
          const resolved = await resolveProviderClient(settings, keyCrypto, deps.createClient);
          const ping = await resolved.client.test();
          return { ok: true as const, model: ping.model, latencyMs: ping.latencyMs, error: null };
        } catch (error) {
          if (error instanceof ProviderNotConfiguredError) {
            throw new ConflictError(error.message, 'CONFLICT');
          }
          // Client construction OR the ping failed. `ProviderError` is
          // key-scrubbed; surface it as ok:false rather than a 500.
          if (error instanceof ProviderError) {
            return { ok: false, model: null, latencyMs: null, error: { code: error.code, message: error.message } };
          }
          throw error;
        }
      },
    );

    app.get(
      '/llm/models',
      { preHandler: guard, schema: { response: { 200: llmModelsReply } } },
      async () => {
        try {
          const resolved = await resolveProviderClient(settings, keyCrypto, deps.createClient);
          const models = await resolved.client.listModels();
          return { models, source: 'live' as const };
        } catch (error) {
          if (error instanceof ProviderNotConfiguredError) {
            throw new ConflictError(error.message, 'CONFLICT');
          }
          // Client construction / listing failed (the client also falls back to a
          // static list internally); yield an empty static reply, never a 500.
          return { models: [], source: 'static' as const };
        }
      },
    );

    // ── Runs ──────────────────────────────────────────────────────────────────

    app.post(
      '/llm/runs',
      { preHandler: guard, schema: { body: createRunBody, response: { 201: createRunReply } } },
      async (request, reply) => {
        const body = request.body;

        // The orchestration lives in the prompt service so `adminium
        // generate-prompt` runs the identical path (06 §10.4 CLI parity).
        let created;
        try {
          created = await promptService.createRunForConnection({
            connectionId: body.connectionId,
            path: body.path,
            ...(body.locales === undefined ? {} : { locales: body.locales as LocaleCode[] }),
            ...(body.sections === undefined ? {} : { sections: body.sections as RequestedSection[] }),
            sampling: (body.sampling ?? null) as Sampling,
            createdBy: actorIdOf(request),
          });
        } catch (error) {
          if (error instanceof SnapshotRequiredError) {
            throw new ConflictError(error.message, 'CONFLICT', { connectionId: body.connectionId });
          }
          if (error instanceof ProviderNotSelectedError) {
            throw new ConflictError(error.message, 'CONFLICT');
          }
          if (error instanceof ByoTelemetryError) throw new ValidationFailedError(error.message);
          throw error;
        }

        return reply.status(201).send({
          run: toRunDto(created.run),
          prompt: {
            promptVersion: created.run.promptVersion,
            tokenEstimate: created.artifact.tokenEstimate,
            chunks: created.artifact.chunks.map((chunk) => ({
              index: chunk.index,
              total: chunk.total,
              byo: chunk.byo,
            })),
          },
        });
      },
    );

    app.post(
      '/llm/runs/:id/execute',
      { preHandler: guard, schema: { params: runIdParams, response: { 202: jobAcceptedReply } } },
      async (request, reply) => {
        const run = await runService.getRun(request.params.id);
        if (run === null) throw new NotFoundError('LLM run not found.', { runId: request.params.id });
        if (run.mode !== 'provider') {
          throw new ConflictError('BYO runs are completed by pasting a response, not executed.', 'CONFLICT');
        }
        if (run.status !== 'draft') {
          throw new ConflictError(`Run is ${run.status}; only a draft run can be executed.`, 'CONFLICT');
        }
        if (!app.hasDecorator('jobs') || !app.jobs.registry.has(LLM_RUN_KIND)) {
          throw new ConflictError('The direct-API runner is not available on this instance.', 'CONFLICT');
        }
        const userId = actorIdOf(request);
        const job = await app.jobs.enqueue({
          kind: LLM_RUN_KIND,
          payload: { runId: run.id, ...(userId !== null ? { userId } : {}) },
          dedupeKey: `llm-run:${run.id}`,
        });
        await app.rbac.audit(request, {
          category: 'llm',
          action: 'llm.run.execute',
          connectionId: run.connectionId,
          changes: { after: { runId: run.id, jobId: job.id } },
        });
        return reply.status(202).send({ jobId: job.id });
      },
    );

    app.post(
      '/llm/runs/:id/response',
      { preHandler: guard, schema: { params: runIdParams, body: runResponseBody, response: { 200: runResponseReply } } },
      async (request) => {
        const run = await runService.getRun(request.params.id);
        if (run === null) throw new NotFoundError('LLM run not found.', { runId: request.params.id });
        const model = await loadModelForRun(run);
        // NO stats collection here (§9 zero-network guarantee): pasting a BYO
        // response must be fully in-process against the stored snapshot —
        // `collectStats` opens the SOURCE database (up to 200 table scans) and
        // would 500 the paste when it is unreachable. Stats enrich the PROMPT
        // at run creation (prompt-service.ts §4.2); validation without them
        // matches the direct path exactly (jobs/llm-run.ts passes none).

        try {
          const result = await runService.receiveResponse(run.id, {
            text: request.body.text,
            ...(request.body.chunkIndex !== undefined ? { chunkIndex: request.body.chunkIndex } : {}),
            snapshot: model,
            allowedTemplates,
            allowedWidgets,
            ...(deps.allowedIcons !== undefined ? { allowedIcons: deps.allowedIcons } : {}),
          });
          return {
            run: toRunDetailDto(result.run),
            validation: {
              ok: result.validation.response !== undefined,
              errors: result.validation.errors as LlmValidationErrorDto[],
              warnings: result.validation.warnings as LlmValidationErrorDto[],
            },
          };
        } catch (error) {
          if (error instanceof RunImmutableError || error instanceof InvalidRunTransitionError) {
            throw new ConflictError(error.message, 'CONFLICT');
          }
          throw error;
        }
      },
    );

    app.get(
      '/llm/runs',
      { preHandler: guard, schema: { querystring: runsListQuery, response: { 200: runsListReply } } },
      async (request) => {
        const runs = await runService.listRuns(request.query.connectionId);
        return { runs: runs.map(toRunDto) };
      },
    );

    app.get(
      '/llm/runs/:id',
      { preHandler: guard, schema: { params: runIdParams, response: { 200: llmRunDetailDto } } },
      async (request) => {
        const run = await runService.getRun(request.params.id);
        if (run === null) throw new NotFoundError('LLM run not found.', { runId: request.params.id });
        return toRunDetailDto(run);
      },
    );

    app.get(
      '/llm/runs/:id/prompt',
      { preHandler: guard, schema: { params: runIdParams, response: { 200: runPromptReply } } },
      async (request) => {
        const run = await runService.getRun(request.params.id);
        if (run === null) throw new NotFoundError('LLM run not found.', { runId: request.params.id });
        if (run.promptText === null || run.promptText.length === 0) {
          throw new NotFoundError('This run has no stored prompt.', { runId: run.id });
        }
        return { promptVersion: run.promptVersion, chunks: splitPromptChunks(run.promptText) };
      },
    );

    app.get(
      '/llm/runs/:id/diff',
      { preHandler: guard, schema: { params: runIdParams, response: { 200: runDiffReply } } },
      async (request) => {
        const run = await runService.getRun(request.params.id);
        if (run === null) throw new NotFoundError('LLM run not found.', { runId: request.params.id });
        if (run.responseJson === null || run.responseJson === undefined) {
          throw new ConflictError('The run has no validated response to diff yet.', 'CONFLICT');
        }
        try {
          const { diff } = await applyService.buildPlanForRun(run, []);
          return { diff };
        } catch (error) {
          if (error instanceof SnapshotNotFoundError) {
            throw new NotFoundError('The run’s schema snapshot no longer exists.', { snapshotId: run.snapshotId });
          }
          throw error;
        }
      },
    );

    app.post(
      '/llm/runs/:id/apply',
      { preHandler: guard, schema: { params: runIdParams, body: runApplyBody, response: { 200: runApplyReply } } },
      async (request) => {
        try {
          const actor = actorIdOf(request);
          const result = await applyService.applyRun(request.params.id, request.body.accepted, {
            appliedBy: actor,
          });
          // Park the before-image so the success toast's Undo action can revert this
          // exact apply within the toast window (§10.3). Only issue a token when the
          // apply actually wrote something revertible.
          const revertible =
            result.undo.insertedOverrideIds.length > 0 ||
            result.undo.updatedOverrides.length > 0 ||
            result.undo.insertedPageIds.length > 0 ||
            result.undo.updatedPages.length > 0;
          const undoToken = revertible
            ? undoStore.issue({
                userId: actor,
                runId: result.run.id,
                connectionId: result.run.connectionId,
                undo: result.undo,
              }).token
            : null;
          await app.rbac.audit(request, {
            category: 'llm',
            action: 'llm.run.apply',
            connectionId: result.run.connectionId,
            changes: {
              after: {
                runId: result.run.id,
                partial: result.partial,
                accepted: result.review.accepted.length,
                rejected: result.review.rejected.length,
                overrides: result.counts.overrides,
                pages: result.counts.pages,
              },
            },
          });
          return {
            run: toRunDto(result.run),
            partial: result.partial,
            counts: result.counts,
            review: result.review,
            undoToken,
          };
        } catch (error) {
          if (error instanceof RunNotFoundError) {
            throw new NotFoundError('LLM run not found.', { runId: request.params.id });
          }
          if (error instanceof RunNotApplicableError) {
            throw new ConflictError(error.message, 'CONFLICT');
          }
          if (error instanceof SnapshotNotFoundError) {
            throw new NotFoundError('The run’s schema snapshot no longer exists.');
          }
          throw error;
        }
      },
    );

    app.post(
      '/llm/runs/:id/undo/:token',
      { preHandler: guard, schema: { params: runUndoParams, response: { 200: runUndoReply } } },
      async (request) => {
        const consumed = undoStore.consume(request.params.token);
        if (consumed.status === 'unknown') {
          throw new NotFoundError('Unknown or already-used undo token.', { runId: request.params.id });
        }
        if (consumed.status === 'expired') {
          throw new AppError(410, 'UNDO_EXPIRED', 'The undo window has closed.');
        }
        const entry = consumed.entry;
        if (entry.runId !== request.params.id) {
          throw new NotFoundError('Unknown or already-used undo token.', { runId: request.params.id });
        }
        // Only the user who applied the run may undo it (mirrors the CRUD undo).
        if (entry.userId !== null && entry.userId !== actorIdOf(request)) {
          throw new ForbiddenError('Only the user who applied this run can undo it.', 'FORBIDDEN', {});
        }
        await applyService.undoApply(entry.undo);
        await app.rbac.audit(request, {
          category: 'llm',
          action: 'llm.run.undo',
          connectionId: entry.connectionId,
          changes: {
            after: {
              runId: entry.runId,
              overrides: entry.undo.insertedOverrideIds.length + entry.undo.updatedOverrides.length,
              pages: entry.undo.insertedPageIds.length,
            },
          },
        });
        return {
          overrides: entry.undo.insertedOverrideIds.length + entry.undo.updatedOverrides.length,
          pages: entry.undo.insertedPageIds.length,
        };
      },
    );
  };
}
