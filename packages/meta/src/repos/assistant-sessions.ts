// SPDX-License-Identifier: AGPL-3.0-only
/**
 * assistantSessionsRepo — `adminium_assistant_sessions` + `adminium_assistant_turns`.
 *
 * One repo for both tables, because a turn is never addressed except through
 * its session: the transcript is read in `seq` order, a session's totals move
 * whenever a turn's do, and deleting a session takes its turns with it.
 *
 * The persistence layer only. Which status may follow which, what a turn may
 * cost, and what a result is allowed to hold are the server's questions; here
 * a status is validated against the closed set and the json columns are
 * validated on the way in and parsed on the way out, so nothing unreadable
 * can be stored and nothing stored comes back as a string.
 *
 * `seq` is allocated by counting the session's turns rather than by a
 * sequence: the unique `(session_id, seq)` index is what actually guarantees
 * it, and a second insert that raced the count fails there instead of quietly
 * producing two turn 3s.
 */

import type { Selectable } from 'kysely';
import type { z } from 'zod';

import type { MetaDb } from '../connect.js';
import { newId } from '../ids.js';
import {
  assistantAskSchema,
  assistantContextSchema,
  assistantErrorSchema,
  assistantHostSchema,
  assistantResultSchema,
  assistantSessionStatusSchema,
  assistantStepsSchema,
  assistantTranscriptSchema,
  assistantTurnStatusSchema,
  type AssistantContextKey,
  type AssistantHost,
  type AssistantSessionStatus,
  type AssistantStepRow,
  type AssistantTranscriptMessage,
  type AssistantTurnStatus,
} from '../schema/json-payloads.js';
import type { AdminiumAssistantSessionsTable, AdminiumAssistantTurnsTable } from '../schema/tables.js';
import { MetaValidationError, packJson, readJson, readJsonOrNull } from './util.js';

export type {
  AssistantContextKey,
  AssistantHost,
  AssistantSessionStatus,
  AssistantStepRow,
  AssistantTranscriptMessage,
  AssistantTurnStatus,
};

export interface AssistantSession {
  id: string;
  context: AssistantContextKey;
  host: AssistantHost;
  /** The editor page's unsaved document, as it was when the modal opened. */
  draft: unknown | null;
  provider: string | null;
  model: string | null;
  tokensIn: number;
  tokensOut: number;
  status: AssistantSessionStatus;
  createdBy: string | null;
  createdAt: number;
  updatedAt: number;
  closedAt: number | null;
}

export interface AssistantTurn {
  id: string;
  sessionId: string;
  seq: number;
  askText: string | null;
  picks: Record<string, string> | null;
  status: AssistantTurnStatus;
  jobId: string | null;
  transcript: AssistantTranscriptMessage[];
  steps: AssistantStepRow[];
  say: string | null;
  ask: Record<string, unknown> | null;
  result: Record<string, unknown> | null;
  error: Record<string, unknown> | null;
  tokensIn: number | null;
  tokensOut: number | null;
  durationMs: number | null;
  createdAt: number;
  finishedAt: number | null;
}

export interface CreateAssistantSessionInput {
  context: AssistantContextKey;
  host: AssistantHost;
  draft?: unknown;
  provider?: string | null;
  model?: string | null;
  createdBy?: string | null;
}

export interface CreateAssistantTurnInput {
  sessionId: string;
  askText?: string | null;
  picks?: Record<string, string> | null;
  /** The user message this turn starts from; every round appends to it. */
  transcript?: readonly AssistantTranscriptMessage[];
  jobId?: string | null;
}

/** Everything a finished (or stopped) turn writes back in one statement. */
export interface FinishAssistantTurnInput {
  status: AssistantTurnStatus;
  transcript?: readonly AssistantTranscriptMessage[];
  steps?: readonly AssistantStepRow[];
  say?: string | null;
  ask?: Record<string, unknown> | null;
  result?: Record<string, unknown> | null;
  error?: Record<string, unknown> | null;
  tokensIn?: number | null;
  tokensOut?: number | null;
  durationMs?: number | null;
  /** Stamped for every terminal status; omit to leave the turn unfinished. */
  finishedAt?: number | null;
}

function decodeSession(row: Selectable<AdminiumAssistantSessionsTable>): AssistantSession {
  return {
    id: row.id,
    context: assistantContextSchema.parse(row.context),
    host: assistantHostSchema.parse(readJson(row.host)),
    draft: readJsonOrNull(row.draft),
    provider: row.provider,
    model: row.model,
    tokensIn: row.tokensIn,
    tokensOut: row.tokensOut,
    status: assistantSessionStatusSchema.parse(row.status),
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    closedAt: row.closedAt,
  };
}

function decodeTurn(row: Selectable<AdminiumAssistantTurnsTable>): AssistantTurn {
  return {
    id: row.id,
    sessionId: row.sessionId,
    seq: row.seq,
    askText: row.askText,
    picks: readJsonOrNull<Record<string, string>>(row.picks),
    status: assistantTurnStatusSchema.parse(row.status),
    jobId: row.jobId,
    transcript: assistantTranscriptSchema.parse(readJson(row.transcript)),
    steps: assistantStepsSchema.parse(readJson(row.steps)),
    say: row.say,
    ask: readJsonOrNull<Record<string, unknown>>(row.ask),
    result: readJsonOrNull<Record<string, unknown>>(row.result),
    error: readJsonOrNull<Record<string, unknown>>(row.error),
    tokensIn: row.tokensIn,
    tokensOut: row.tokensOut,
    durationMs: row.durationMs,
    createdAt: row.createdAt,
    finishedAt: row.finishedAt,
  };
}

/** Validate a json payload on the way in, naming the field a caller got wrong. */
function packChecked<T>(what: string, schema: z.ZodType<T>, value: unknown): string {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new MetaValidationError(`invalid assistant ${what}`, parsed.error.issues);
  return packJson(parsed.data);
}

export function assistantSessionsRepo(meta: MetaDb) {
  const { db } = meta;

  async function findSession(id: string): Promise<AssistantSession | null> {
    const row = await db
      .selectFrom('adminium_assistant_sessions')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    return row === undefined ? null : decodeSession(row);
  }

  async function findTurn(id: string): Promise<AssistantTurn | null> {
    const row = await db.selectFrom('adminium_assistant_turns').selectAll().where('id', '=', id).executeTakeFirst();
    return row === undefined ? null : decodeTurn(row);
  }

  return {
    findSession,
    findTurn,

    /** Open a session. The provider is recorded now so a later change cannot rewrite history. */
    async create(input: CreateAssistantSessionInput, at: number = Date.now()): Promise<AssistantSession> {
      const context = assistantContextSchema.safeParse(input.context);
      if (!context.success) throw new MetaValidationError('invalid assistant context', context.error.issues);
      const row = {
        id: newId('ast'),
        context: context.data,
        host: packChecked('host', assistantHostSchema, input.host),
        draft: input.draft === undefined ? null : packJson(input.draft),
        provider: input.provider ?? null,
        model: input.model ?? null,
        tokensIn: 0,
        tokensOut: 0,
        status: 'open' as const,
        createdBy: input.createdBy ?? null,
        createdAt: at,
        updatedAt: at,
        closedAt: null,
      };
      await db.insertInto('adminium_assistant_sessions').values(row).execute();
      return decodeSession(row as unknown as Selectable<AdminiumAssistantSessionsTable>);
    },

    /** A person's sessions, newest first — what the retention sweep and a support read ask for. */
    async listForUser(userId: string, limit = 50): Promise<AssistantSession[]> {
      const rows = await db
        .selectFrom('adminium_assistant_sessions')
        .selectAll()
        .where('createdBy', '=', userId)
        .orderBy('createdAt', 'desc')
        .orderBy('id', 'desc')
        .limit(limit)
        .execute();
      return rows.map(decodeSession);
    },

    /**
     * Add a turn's usage to the session's running totals. A read-modify-write
     * would lose a concurrent turn's tokens; this is one statement, so the
     * database adds them.
     */
    async addUsage(
      sessionId: string,
      usage: { tokensIn?: number; tokensOut?: number },
      at: number = Date.now(),
    ): Promise<boolean> {
      const res = await db
        .updateTable('adminium_assistant_sessions')
        .set((eb) => ({
          tokensIn: eb('tokensIn', '+', usage.tokensIn ?? 0),
          tokensOut: eb('tokensOut', '+', usage.tokensOut ?? 0),
          updatedAt: at,
        }))
        .where('id', '=', sessionId)
        .executeTakeFirst();
      return Number(res.numUpdatedRows) === 1;
    },

    /** Close a session. Idempotent: closing a closed session changes nothing and answers false. */
    async close(sessionId: string, at: number = Date.now()): Promise<boolean> {
      const res = await db
        .updateTable('adminium_assistant_sessions')
        .set({ status: 'closed', closedAt: at, updatedAt: at })
        .where('id', '=', sessionId)
        .where('status', '=', 'open')
        .executeTakeFirst();
      return Number(res.numUpdatedRows) === 1;
    },

    /** Sessions a browser left open, last touched before `before` — the sweep's first pass. */
    async listStaleOpen(before: number, limit = 500): Promise<AssistantSession[]> {
      const rows = await db
        .selectFrom('adminium_assistant_sessions')
        .selectAll()
        .where('status', '=', 'open')
        .where('updatedAt', '<', before)
        .orderBy('updatedAt', 'asc')
        .limit(limit)
        .execute();
      return rows.map(decodeSession);
    },

    /**
     * Delete closed sessions that closed before `before`, with their turns.
     * The turns go first and explicitly: the FK cascades on every dialect we
     * support, but SQLite only honours it when `foreign_keys` is on, and a
     * sweep that silently left orphans on one engine is worse than two
     * statements.
     */
    async purgeClosedBefore(before: number): Promise<{ sessions: number; turns: number }> {
      const ids = (
        await db
          .selectFrom('adminium_assistant_sessions')
          .select('id')
          .where('status', '=', 'closed')
          .where('closedAt', '<', before)
          .execute()
      ).map((row) => row.id);
      if (ids.length === 0) return { sessions: 0, turns: 0 };
      const turns = await db.deleteFrom('adminium_assistant_turns').where('sessionId', 'in', ids).executeTakeFirst();
      const sessions = await db.deleteFrom('adminium_assistant_sessions').where('id', 'in', ids).executeTakeFirst();
      return { sessions: Number(sessions.numDeletedRows), turns: Number(turns.numDeletedRows) };
    },

    /** Start a turn. `seq` continues the session's transcript. */
    async createTurn(input: CreateAssistantTurnInput, at: number = Date.now()): Promise<AssistantTurn> {
      const counted = await db
        .selectFrom('adminium_assistant_turns')
        .select((eb) => eb.fn.countAll().as('count'))
        .where('sessionId', '=', input.sessionId)
        .executeTakeFirst();
      const seq = Number(counted?.count ?? 0) + 1;
      const row = {
        id: newId('atn'),
        sessionId: input.sessionId,
        seq,
        askText: input.askText ?? null,
        picks: input.picks === undefined || input.picks === null ? null : packJson(input.picks),
        status: 'queued' as const,
        jobId: input.jobId ?? null,
        transcript: packChecked('transcript', assistantTranscriptSchema, input.transcript ?? []),
        steps: packChecked('steps', assistantStepsSchema, []),
        say: null,
        ask: null,
        result: null,
        error: null,
        tokensIn: null,
        tokensOut: null,
        durationMs: null,
        createdAt: at,
        finishedAt: null,
      };
      await db.insertInto('adminium_assistant_turns').values(row).execute();
      return decodeTurn(row as unknown as Selectable<AdminiumAssistantTurnsTable>);
    },

    /** The session's turns in order — the history the next turn replays. */
    async listTurns(sessionId: string): Promise<AssistantTurn[]> {
      const rows = await db
        .selectFrom('adminium_assistant_turns')
        .selectAll()
        .where('sessionId', '=', sessionId)
        .orderBy('seq', 'asc')
        .execute();
      return rows.map(decodeTurn);
    },

    /** Is anything in this session still going? A second turn may not start over one. */
    async hasLiveTurn(sessionId: string): Promise<boolean> {
      const row = await db
        .selectFrom('adminium_assistant_turns')
        .select('id')
        .where('sessionId', '=', sessionId)
        .where('status', 'in', ['queued', 'running'])
        .executeTakeFirst();
      return row !== undefined;
    },

    /**
     * Move a turn's status, optionally only from the one it is expected to be
     * in, so the job can claim a queued turn atomically. Answers whether a row
     * changed.
     */
    async setTurnStatus(
      id: string,
      status: AssistantTurnStatus,
      opts: { expected?: AssistantTurnStatus; jobId?: string | null } = {},
    ): Promise<boolean> {
      const valid = assistantTurnStatusSchema.safeParse(status);
      if (!valid.success) throw new MetaValidationError('invalid assistant turn status', valid.error.issues);
      let query = db.updateTable('adminium_assistant_turns').set({
        status: valid.data,
        ...(opts.jobId === undefined ? {} : { jobId: opts.jobId }),
      });
      query = query.where('id', '=', id);
      if (opts.expected !== undefined) query = query.where('status', '=', opts.expected);
      const res = await query.executeTakeFirst();
      return Number(res.numUpdatedRows) === 1;
    },

    /** Publish the steps a running turn has reached, so a reload shows the card mid-flight. */
    async recordSteps(id: string, steps: readonly AssistantStepRow[]): Promise<boolean> {
      const res = await db
        .updateTable('adminium_assistant_turns')
        .set({ steps: packChecked('steps', assistantStepsSchema, steps) })
        .where('id', '=', id)
        .executeTakeFirst();
      return Number(res.numUpdatedRows) === 1;
    },

    /** Write everything a turn ended with, in one statement. */
    async finishTurn(id: string, input: FinishAssistantTurnInput): Promise<boolean> {
      const status = assistantTurnStatusSchema.safeParse(input.status);
      if (!status.success) throw new MetaValidationError('invalid assistant turn status', status.error.issues);
      const set: Record<string, unknown> = { status: status.data };
      if (input.transcript !== undefined) {
        set.transcript = packChecked('transcript', assistantTranscriptSchema, input.transcript);
      }
      if (input.steps !== undefined) set.steps = packChecked('steps', assistantStepsSchema, input.steps);
      if (input.say !== undefined) set.say = input.say;
      if (input.ask !== undefined) {
        set.ask = input.ask === null ? null : packChecked('ask', assistantAskSchema, input.ask);
      }
      if (input.result !== undefined) {
        set.result = input.result === null ? null : packChecked('result', assistantResultSchema, input.result);
      }
      if (input.error !== undefined) {
        set.error = input.error === null ? null : packChecked('error', assistantErrorSchema, input.error);
      }
      if (input.tokensIn !== undefined) set.tokensIn = input.tokensIn;
      if (input.tokensOut !== undefined) set.tokensOut = input.tokensOut;
      if (input.durationMs !== undefined) set.durationMs = input.durationMs;
      if (input.finishedAt !== undefined) set.finishedAt = input.finishedAt;
      const res = await db
        .updateTable('adminium_assistant_turns')
        .set(set)
        .where('id', '=', id)
        .executeTakeFirst();
      return Number(res.numUpdatedRows) === 1;
    },
  };
}

export type AssistantSessionsRepo = ReturnType<typeof assistantSessionsRepo>;
