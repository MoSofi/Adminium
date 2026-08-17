// SPDX-License-Identifier: AGPL-3.0-only
/**
 * llmRunsRepo — adminium_llm_runs (07-meta-store.md §3.19, 06-llm-assist.md §7.4).
 *
 * One row = one enrichment attempt (provider API or BYO paste). This repo is the
 * thin persistence layer: it round-trips rows and validates the json payloads it
 * writes. The §7.4 run-lifecycle transition rules and run immutability live one
 * layer up in the server run-service — the repo's `updateStatus` accepts an
 * optional `expected` current-status guard so the service can transition
 * atomically, but it does not itself know the legal transition graph.
 *
 * §9 telemetry-free guarantee: for BYO runs `provider`/`model` stay NULL. The
 * repo never fills them; enforcing "BYO ⇒ null" is the run-service's job.
 */

import type { Selectable, Updateable } from 'kysely';

import type { MetaDb } from '../connect.js';
import { newId } from '../ids.js';
import {
  llmRunLocalesSchema,
  llmRunModeSchema,
  llmRunReviewSchema,
  llmRunSamplingSchema,
  llmRunSectionsSchema,
  llmRunStatusSchema,
  llmValidationStatusSchema,
  type LlmRunReview,
  type LlmRunStatus,
} from '../schema/json-payloads.js';
import type { AdminiumLlmRunsTable } from '../schema/tables.js';
import { MetaValidationError, packJson, readJsonOrNull } from './util.js';

export type LlmRunMode = 'provider' | 'byo';
export type LlmValidationStatus = 'pending' | 'valid' | 'partial' | 'invalid';
export type { LlmRunStatus, LlmRunReview };

export interface LlmRun {
  id: string;
  connectionId: string;
  snapshotId: string;
  mode: LlmRunMode;
  provider: string | null;
  model: string | null;
  promptVersion: string;
  promptHash: string;
  promptText: string | null;
  sections: string[] | null;
  locales: string[] | null;
  sampling: { maxValuesPerColumn: number } | null;
  chunksTotal: number;
  chunksReceived: number;
  responseRaw: string | null;
  responseJson: unknown | null;
  status: LlmRunStatus;
  validationStatus: LlmValidationStatus;
  validationErrors: unknown | null;
  review: LlmRunReview | null;
  tokensIn: number | null;
  tokensOut: number | null;
  durationMs: number | null;
  appliedBy: string | null;
  appliedAt: number | null;
  createdBy: string | null;
  createdAt: number;
}

export interface CreateLlmRunInput {
  /** Defaults to `newId('run')`. The run id equals the runId embedded in the prompt (§7.4). */
  id?: string;
  connectionId: string;
  snapshotId: string;
  mode: LlmRunMode;
  provider?: string | null;
  model?: string | null;
  promptVersion: string;
  promptHash: string;
  promptText?: string | null;
  sections?: readonly string[] | null;
  locales?: readonly string[] | null;
  sampling?: { maxValuesPerColumn: number } | null;
  chunksTotal?: number;
  chunksReceived?: number;
  status?: LlmRunStatus;
  validationStatus?: LlmValidationStatus;
  createdBy?: string | null;
}

/** Fields recordResponse persists after validating a received chunk/response. */
export interface RecordResponsePatch {
  status: LlmRunStatus;
  validationStatus: LlmValidationStatus;
  responseRaw?: string | null;
  responseJson?: unknown | null;
  validationErrors?: unknown | null;
  chunksReceived?: number;
  tokensIn?: number | null;
  tokensOut?: number | null;
  durationMs?: number | null;
}

export interface MarkAppliedInput {
  appliedBy?: string | null;
  /** Terminal status — `applied` or `partially_applied`. */
  status: Extract<LlmRunStatus, 'applied' | 'partially_applied'>;
  review?: LlmRunReview;
}

function decode(row: Selectable<AdminiumLlmRunsTable>): LlmRun {
  return {
    id: row.id,
    connectionId: row.connectionId,
    snapshotId: row.snapshotId,
    mode: row.mode as LlmRunMode,
    provider: row.provider,
    model: row.model,
    promptVersion: row.promptVersion,
    promptHash: row.promptHash,
    promptText: row.promptText,
    sections: readJsonOrNull<string[]>(row.sections),
    locales: readJsonOrNull<string[]>(row.locales),
    sampling: readJsonOrNull<{ maxValuesPerColumn: number }>(row.sampling),
    chunksTotal: row.chunksTotal,
    chunksReceived: row.chunksReceived,
    responseRaw: row.responseRaw,
    responseJson: readJsonOrNull(row.responseJson),
    status: row.status as LlmRunStatus,
    validationStatus: row.validationStatus as LlmValidationStatus,
    validationErrors: readJsonOrNull(row.validationErrors),
    review: readJsonOrNull<LlmRunReview>(row.review),
    tokensIn: row.tokensIn,
    tokensOut: row.tokensOut,
    durationMs: row.durationMs,
    appliedBy: row.appliedBy,
    appliedAt: row.appliedAt,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
  };
}

export function llmRunsRepo(meta: MetaDb) {
  const { db } = meta;

  async function findById(id: string): Promise<LlmRun | null> {
    const row = await db.selectFrom('adminium_llm_runs').selectAll().where('id', '=', id).executeTakeFirst();
    return row === undefined ? null : decode(row);
  }

  return {
    findById,

    /** Persist a new run (typically a `draft`). Validates every json payload before writing. */
    async create(input: CreateLlmRunInput, at: number = Date.now()): Promise<LlmRun> {
      const mode = llmRunModeSchema.safeParse(input.mode);
      if (!mode.success) throw new MetaValidationError('invalid llm run mode', mode.error.issues);
      const status = llmRunStatusSchema.safeParse(input.status ?? 'draft');
      if (!status.success) throw new MetaValidationError('invalid llm run status', status.error.issues);
      const validationStatus = llmValidationStatusSchema.safeParse(input.validationStatus ?? 'pending');
      if (!validationStatus.success) {
        throw new MetaValidationError('invalid llm validation status', validationStatus.error.issues);
      }

      let sections: string | null = null;
      if (input.sections !== null && input.sections !== undefined) {
        const parsed = llmRunSectionsSchema.safeParse(input.sections);
        if (!parsed.success) throw new MetaValidationError('invalid llm run sections', parsed.error.issues);
        sections = packJson(parsed.data);
      }
      let locales: string | null = null;
      if (input.locales !== null && input.locales !== undefined) {
        const parsed = llmRunLocalesSchema.safeParse(input.locales);
        if (!parsed.success) throw new MetaValidationError('invalid llm run locales', parsed.error.issues);
        locales = packJson(parsed.data);
      }
      let sampling: string | null = null;
      if (input.sampling !== undefined) {
        const parsed = llmRunSamplingSchema.safeParse(input.sampling);
        if (!parsed.success) throw new MetaValidationError('invalid llm run sampling', parsed.error.issues);
        sampling = packJson(parsed.data);
      }

      const row = {
        id: input.id ?? newId('run'),
        connectionId: input.connectionId,
        snapshotId: input.snapshotId,
        mode: mode.data,
        provider: input.provider ?? null,
        model: input.model ?? null,
        promptVersion: input.promptVersion,
        promptHash: input.promptHash,
        promptText: input.promptText ?? null,
        sections,
        locales,
        sampling,
        chunksTotal: input.chunksTotal ?? 1,
        chunksReceived: input.chunksReceived ?? 0,
        responseRaw: null,
        responseJson: null,
        status: status.data,
        validationStatus: validationStatus.data,
        validationErrors: null,
        review: null,
        tokensIn: null,
        tokensOut: null,
        durationMs: null,
        appliedAt: null,
        appliedBy: null,
        createdBy: input.createdBy ?? null,
        createdAt: at,
      };
      await db.insertInto('adminium_llm_runs').values(row).execute();
      return decode(row as Selectable<AdminiumLlmRunsTable>);
    },

    /** Run history for a connection, newest first. */
    async listForConnection(connectionId: string): Promise<LlmRun[]> {
      const rows = await db
        .selectFrom('adminium_llm_runs')
        .selectAll()
        .where('connectionId', '=', connectionId)
        .orderBy('createdAt', 'desc')
        .orderBy('id', 'desc')
        .execute();
      return rows.map(decode);
    },

    /**
     * Set the lifecycle status. When `expected` is given the update only lands if
     * the row is still in that status (optimistic transition) — the server
     * run-service uses this to make transitions atomic. Returns whether a row
     * changed.
     */
    async updateStatus(
      id: string,
      status: LlmRunStatus,
      opts: { expected?: LlmRunStatus; at?: number } = {},
    ): Promise<boolean> {
      const valid = llmRunStatusSchema.safeParse(status);
      if (!valid.success) throw new MetaValidationError('invalid llm run status', valid.error.issues);
      let query = db.updateTable('adminium_llm_runs').set({ status: valid.data }).where('id', '=', id);
      if (opts.expected !== undefined) query = query.where('status', '=', opts.expected);
      const res = await query.executeTakeFirst();
      return Number(res.numUpdatedRows) === 1;
    },

    /** Persist a validated (or fatally-rejected) response and advance the run. */
    async recordResponse(id: string, patch: RecordResponsePatch): Promise<boolean> {
      const status = llmRunStatusSchema.safeParse(patch.status);
      if (!status.success) throw new MetaValidationError('invalid llm run status', status.error.issues);
      const validationStatus = llmValidationStatusSchema.safeParse(patch.validationStatus);
      if (!validationStatus.success) {
        throw new MetaValidationError('invalid llm validation status', validationStatus.error.issues);
      }
      const set: Updateable<AdminiumLlmRunsTable> = {
        status: status.data,
        validationStatus: validationStatus.data,
      };
      if (patch.responseRaw !== undefined) set.responseRaw = patch.responseRaw;
      if (patch.responseJson !== undefined) {
        set.responseJson = patch.responseJson === null ? null : packJson(patch.responseJson);
      }
      if (patch.validationErrors !== undefined) {
        set.validationErrors = patch.validationErrors === null ? null : packJson(patch.validationErrors);
      }
      if (patch.chunksReceived !== undefined) set.chunksReceived = patch.chunksReceived;
      if (patch.tokensIn !== undefined) set.tokensIn = patch.tokensIn;
      if (patch.tokensOut !== undefined) set.tokensOut = patch.tokensOut;
      if (patch.durationMs !== undefined) set.durationMs = patch.durationMs;
      const res = await db.updateTable('adminium_llm_runs').set(set).where('id', '=', id).executeTakeFirst();
      return Number(res.numUpdatedRows) === 1;
    },

    /** Persist the accepted/rejected suggestion-id lists (§8.3). */
    async recordReview(id: string, review: LlmRunReview): Promise<boolean> {
      const valid = llmRunReviewSchema.safeParse(review);
      if (!valid.success) throw new MetaValidationError('invalid llm run review', valid.error.issues);
      const res = await db
        .updateTable('adminium_llm_runs')
        .set({ review: packJson(valid.data) })
        .where('id', '=', id)
        .executeTakeFirst();
      return Number(res.numUpdatedRows) === 1;
    },

    /** Terminal apply: stamp applied_at/applied_by, set the terminal status, persist the review. */
    async markApplied(id: string, input: MarkAppliedInput, at: number = Date.now()): Promise<boolean> {
      const status = llmRunStatusSchema.safeParse(input.status);
      if (!status.success || (status.data !== 'applied' && status.data !== 'partially_applied')) {
        throw new MetaValidationError('markApplied status must be applied | partially_applied');
      }
      const set: Updateable<AdminiumLlmRunsTable> = {
        status: status.data,
        appliedBy: input.appliedBy ?? null,
        appliedAt: at,
      };
      if (input.review !== undefined) {
        const review = llmRunReviewSchema.safeParse(input.review);
        if (!review.success) throw new MetaValidationError('invalid llm run review', review.error.issues);
        set.review = packJson(review.data);
      }
      const res = await db.updateTable('adminium_llm_runs').set(set).where('id', '=', id).executeTakeFirst();
      return Number(res.numUpdatedRows) === 1;
    },
  };
}

export type LlmRunsRepo = ReturnType<typeof llmRunsRepo>;
