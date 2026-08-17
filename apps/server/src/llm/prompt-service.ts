// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Prompt/run creation service (06-llm-assist.md §10.4 + §10.5).
 *
 * THE LIFT (M10-T01): everything here used to live inline inside the
 * `POST /api/v1/llm/runs` handler. The CLI's `adminium generate-prompt` needs
 * the exact same sequence — resolve the connection's latest snapshot, read the
 * configured provider for a direct run, collect §4.2 stats, `createRun`, and
 * park a BYO run in `awaiting_response`. Rather than let the CLI reimplement it
 * (the M10 risk register's named failure mode: "CLI/Docker parity with Studio
 * wizard drifts"), the orchestration moved here and BOTH front doors call it:
 * the route is now a thin HTTP adapter over `createRunForConnection`.
 *
 * What stays out: HTTP concerns (status codes, DTO mapping, RBAC, audit) belong
 * to the route; process/exit concerns belong to the CLI. This service throws
 * typed errors and returns domain objects — no Fastify, no `process`.
 */

import { parseDatabaseModel, type DatabaseModel, type StatsResult } from '@adminium/engine';
import type {
  AllowedVocabularies,
  LocaleCode,
  ProviderId,
  RequestedSection,
  Sampling,
} from '@adminium/llm';
import { settingsRepo, snapshotsRepo, type LlmRun, type MetaDb } from '@adminium/meta';

import type { CreateRunResult, RunService } from './run-service.js';

// ─── Errors ──────────────────────────────────────────────────────────────────

/** The connection has never been introspected — nothing to build a prompt from. */
export class SnapshotRequiredError extends Error {
  override readonly name = 'SnapshotRequiredError';
  constructor(readonly connectionId: string) {
    super('Introspect the connection before running AI enrichment.');
  }
}

/** A `provider` (direct) run was requested but Settings → AI has no provider. */
export class ProviderNotSelectedError extends Error {
  override readonly name = 'ProviderNotSelectedError';
  constructor() {
    super('Configure an AI provider before running the direct path.');
  }
}

// ─── Inputs / outputs ────────────────────────────────────────────────────────

export interface CollectRunStatsInput {
  connectionId: string;
  snapshotId: string;
  /** The classified schema IR from the run's snapshot (privacy flags + types). */
  model: DatabaseModel;
  /** Sampling opt-in (§4.2) — sample-free when `null`. */
  sampling: Sampling;
}

/**
 * Collects §4.2 aggregate statistics for a run's snapshot. Injected so callers
 * stay testable WITHOUT a live source database; the app-wiring layer supplies a
 * `ConnectionManager`-backed implementation.
 */
export type CollectRunStats = (input: CollectRunStatsInput) => Promise<readonly StatsResult[]>;

/** Default: sample-free with no aggregates (statistics omitted from the prompt). */
export const NO_STATS: CollectRunStats = async () => [];

export interface CreateRunForConnectionInput {
  connectionId: string;
  /** `byo` = copy-paste round-trip (the CLI's path); `provider` = direct API. */
  path: 'byo' | 'provider';
  /** Requested output locales; `en_US` is always included by the prompt builder. */
  locales?: readonly LocaleCode[] | undefined;
  /** Requested decision groups (§4.4); empty/omitted ⇒ all sections. */
  sections?: readonly RequestedSection[] | undefined;
  /** Sampling opt-in (§4.2); `null` = sample-free (default). */
  sampling?: Sampling | undefined;
  createdBy?: string | null | undefined;
}

export interface CreateRunForConnectionResult extends CreateRunResult {
  /** The run AFTER the BYO `awaiting_response` transition (§10.2 step 4). */
  run: LlmRun;
  /** The snapshot the prompt was built against. */
  snapshotId: string;
}

export interface PromptServiceDeps {
  meta: MetaDb;
  runService: RunService;
  /**
   * `LLM_ALLOWED_TEMPLATES` / `LLM_ALLOWED_WIDGETS` from `@adminium/widgets` —
   * INJECTED, since the server tree must not import the widgets package (01 §2.3).
   */
  allowed: AllowedVocabularies;
  /** §4.2 stats collector (default {@link NO_STATS}). */
  collectStats?: CollectRunStats | undefined;
}

// ─── Service ─────────────────────────────────────────────────────────────────

export function createPromptService(deps: PromptServiceDeps) {
  const { meta, runService, allowed } = deps;
  const snapshots = snapshotsRepo(meta);
  const settings = settingsRepo(meta);
  const collectStats = deps.collectStats ?? NO_STATS;

  /** The connection's latest snapshot as a parsed IR, or {@link SnapshotRequiredError}. */
  async function loadLatestModel(
    connectionId: string,
  ): Promise<{ snapshotId: string; model: DatabaseModel }> {
    const snapshot = await snapshots.latest(connectionId);
    if (snapshot === null) throw new SnapshotRequiredError(connectionId);
    // The stored snapshot already carries its classified semantics.
    return { snapshotId: snapshot.id, model: parseDatabaseModel(snapshot.schema) };
  }

  return {
    loadLatestModel,

    /**
     * Build the prompt for a connection's latest snapshot and persist the run.
     * BYO runs come back already in `awaiting_response`; direct runs stay `draft`
     * for the caller to execute (route → `llm-run` job).
     */
    async createRunForConnection(
      input: CreateRunForConnectionInput,
    ): Promise<CreateRunForConnectionResult> {
      const { snapshotId, model } = await loadLatestModel(input.connectionId);
      const locales = (input.locales ?? ['en_US']) as LocaleCode[];
      const sections = (input.sections ?? []) as RequestedSection[];
      const sampling: Sampling = input.sampling ?? null;

      // §9: BYO runs record no provider/model — only the direct path reads them.
      let provider: ProviderId | null = null;
      let providerModel: string | null = null;
      if (input.path === 'provider') {
        provider = await settings.get('llm.provider');
        if (provider === null) throw new ProviderNotSelectedError();
        providerModel = await settings.get('llm.model');
      }

      const stats = await collectStats({ connectionId: input.connectionId, snapshotId, model, sampling });

      const created = await runService.createRun({
        connectionId: input.connectionId,
        snapshotId,
        schemaIr: model,
        stats,
        locales,
        sections,
        sampling,
        mode: input.path,
        provider,
        model: providerModel,
        allowed,
        createdBy: input.createdBy ?? null,
      });

      const run =
        input.path === 'byo' ? await runService.markAwaitingResponse(created.run.id) : created.run;

      return { ...created, run, snapshotId };
    },
  };
}

export type PromptService = ReturnType<typeof createPromptService>;
