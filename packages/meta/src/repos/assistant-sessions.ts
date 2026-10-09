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
import { inIdOrder, MetaValidationError, packJson, readJson, readJsonOrNull } from './util.js';

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
  /** One window on one page, or the conversation that stays open across pages. */
  kind: AssistantSessionKind;
}

/** How a conversation is held: by one window, or by the panel. */
export type AssistantSessionKind = 'modal' | 'panel';

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
  /** The page this turn was asked on; `null` means the session's. */
  context: AssistantContextKey | null;
  /** What that page was showing; `null` means the session's. */
  host: AssistantHost | null;
  /** The editor's unsaved document when the question was asked. */
  draft: unknown | null;
  /** What the turn ended with besides its words and its draft. */
  answer: Record<string, unknown> | null;
}

export interface CreateAssistantSessionInput {
  context: AssistantContextKey;
  host: AssistantHost;
  draft?: unknown;
  provider?: string | null;
  model?: string | null;
  createdBy?: string | null;
  kind?: AssistantSessionKind;
}

export interface CreateAssistantTurnInput {
  sessionId: string;
  askText?: string | null;
  picks?: Record<string, string> | null;
  /** The user message this turn starts from; every round appends to it. */
  transcript?: readonly AssistantTranscriptMessage[];
  jobId?: string | null;
  /** The page the question is asked on, when the client names one. */
  context?: AssistantContextKey | null;
  host?: AssistantHost | null;
  draft?: unknown;
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
  answer?: Record<string, unknown> | null;
  /** Stamped for every terminal status; omit to leave the turn unfinished. */
  finishedAt?: number | null;
  /**
   * Write only while the turn is still in this status. The job ends a turn it
   * holds as `running`; a turn the person stopped meanwhile keeps `cancelled`.
   */
  expected?: AssistantTurnStatus;
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
    kind: row.kind === 'panel' ? 'panel' : 'modal',
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
    // Read, never trusted to parse: a page a newer server knew is, to this one, the session's.
    context: assistantContextSchema.nullable().catch(null).parse(row.context ?? null),
    host: row.host === null || row.host === undefined ? null : assistantHostSchema.nullable().catch(null).parse(readJson(row.host)),
    draft: readJsonOrNull(row.draft ?? null),
    answer: readJsonOrNull<Record<string, unknown>>(row.answer ?? null),
  };
}

/** A context key on the way in, refused by name when it is none this build knows. */
function contextOf(value: unknown): AssistantContextKey {
  const context = assistantContextSchema.safeParse(value);
  if (!context.success) throw new MetaValidationError('invalid assistant context', context.error.issues);
  return context.data;
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
        kind: input.kind ?? ('modal' as const),
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
     * The person's open PANEL conversation: the one that stays open while they
     * walk from page to page. The oldest open one, so two windows that opened
     * one each in the same instant agree on which it is.
     */
    async openPanelOf(userId: string): Promise<AssistantSession | null> {
      const row = await db
        .selectFrom('adminium_assistant_sessions')
        .selectAll()
        .where('createdBy', '=', userId)
        .where('kind', '=', 'panel')
        .where('status', '=', 'open')
        .orderBy('createdAt', 'asc')
        .orderBy('id', 'asc')
        .executeTakeFirst();
      return row === undefined ? null : decodeSession(row);
    },

    /** The panel conversation of a person that was closed last, or null: read to say why the panel is empty. */
    async lastClosedPanelOf(userId: string): Promise<AssistantSession | null> {
      const row = await db
        .selectFrom('adminium_assistant_sessions')
        .selectAll()
        .where('createdBy', '=', userId)
        .where('kind', '=', 'panel')
        .where('status', '=', 'closed')
        .orderBy('closedAt', 'desc')
        .orderBy('id', 'desc')
        .executeTakeFirst();
      return row === undefined ? null : decodeSession(row);
    },

    /** Close every open panel conversation of a person but one: a person has one. Answers how many were closed. */
    async closeOtherPanels(userId: string, keepId: string, at: number = Date.now()): Promise<number> {
      const res = await db
        .updateTable('adminium_assistant_sessions')
        .set({ status: 'closed', closedAt: at, updatedAt: at })
        .where('createdBy', '=', userId)
        .where('kind', '=', 'panel')
        .where('status', '=', 'open')
        .where('id', '!=', keepId)
        .executeTakeFirst();
      return Number(res.numUpdatedRows);
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
    async close(sessionId: string, at: number = Date.now(), opts: { idleBefore?: number } = {}): Promise<boolean> {
      let q = db
        .updateTable('adminium_assistant_sessions')
        .set({ status: 'closed', closedAt: at, updatedAt: at })
        .where('id', '=', sessionId)
        .where('status', '=', 'open');
      // The sweep's close: only while the session is still idle, so one used since it was listed stays open.
      if (opts.idleBefore !== undefined) q = q.where('updatedAt', '<', opts.idleBefore);
      const res = await q.executeTakeFirst();
      return Number(res.numUpdatedRows) === 1;
    },

    /**
     * Open panel conversations started before `before`. A panel conversation is
     * not abandoned by being left: it is there again on the next page and the
     * next morning. It is closed by its age instead, whatever its use.
     */
    async listOldPanels(before: number, limit = 500): Promise<Array<{ id: string }>> {
      return db
        .selectFrom('adminium_assistant_sessions')
        .select('id')
        .where('status', '=', 'open')
        .where('kind', '=', 'panel')
        .where('createdAt', '<', before)
        .orderBy('createdAt', 'asc')
        .orderBy('id', 'asc')
        .limit(limit)
        .execute();
    },

    /** Modal sessions a browser left open, last touched before `before` — the sweep's first pass. */
    async listStaleOpen(before: number, limit = 500): Promise<AssistantSession[]> {
      // Ids first, then the rows: MySQL sorts whole rows in a fixed buffer, and a
      // long transcript is bigger than it ("Out of sort memory").
      const ids = (
        await db
          .selectFrom('adminium_assistant_sessions')
          .select('id')
          .where('status', '=', 'open')
          .where('kind', '=', 'modal')
          .where('updatedAt', '<', before)
          .orderBy('updatedAt', 'asc')
          .orderBy('id', 'asc')
          .limit(limit)
          .execute()
      ).map((row) => row.id);
      if (ids.length === 0) return [];
      const rows = await db.selectFrom('adminium_assistant_sessions').selectAll().where('id', 'in', ids).execute();
      return inIdOrder(ids, rows).map(decodeSession);
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
        context: input.context === undefined || input.context === null ? null : contextOf(input.context),
        host: input.host === undefined || input.host === null ? null : packChecked('host', assistantHostSchema, input.host),
        draft: input.draft === undefined || input.draft === null ? null : packJson(input.draft),
        answer: null,
        proposalClaimedAt: null,
        proposalDoneAt: null,
      };
      await db.insertInto('adminium_assistant_turns').values(row).execute();
      // A question is use: the sweep that closes a conversation left alone for a day reads this.
      await db.updateTable('adminium_assistant_sessions').set({ updatedAt: at }).where('id', '=', input.sessionId).execute();
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

    /**
     * The LAST `limit` turns of a session up to and including `upToSeq`, in
     * order, and how many came before them. A conversation that lasts weeks
     * holds every transcript it ever sent; what the next turn and the panel
     * need is its end, so the rest is counted and not read.
     */
    async listTurnsTail(sessionId: string, limit: number, upToSeq?: number): Promise<{ turns: AssistantTurn[]; earlier: number }> {
      let ids = db.selectFrom('adminium_assistant_turns').select(['id', 'seq']).where('sessionId', '=', sessionId);
      if (upToSeq !== undefined) ids = ids.where('seq', '<=', upToSeq);
      // Ids first, then the rows: MySQL sorts whole rows in a fixed buffer, and a transcript is bigger than it.
      const all = await ids.orderBy('seq', 'asc').execute();
      const wanted = all.slice(-Math.max(limit, 1)).map((row) => row.id);
      if (wanted.length === 0) return { turns: [], earlier: 0 };
      const rows = await db.selectFrom('adminium_assistant_turns').selectAll().where('id', 'in', wanted).execute();
      return { turns: inIdOrder(wanted, rows).map(decodeTurn), earlier: all.length - wanted.length };
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
     * The turn a PERSON has under way, in any of their conversations, or
     * `null`. One at a time a person: what a day's allowance is held against
     * is counted as it is spent, and several turns opened at once would each
     * pass the same check.
     */
    async liveTurnOf(userId: string): Promise<{ id: string; sessionId: string } | null> {
      const row = await db
        .selectFrom('adminium_assistant_turns as turn')
        .innerJoin('adminium_assistant_sessions as session', 'session.id', 'turn.sessionId')
        .select(['turn.id as id', 'turn.sessionId as sessionId'])
        .where('session.createdBy', '=', userId)
        .where('turn.status', 'in', ['queued', 'running'])
        .orderBy('turn.createdAt', 'desc')
        .executeTakeFirst();
      return row === undefined ? null : { id: row.id, sessionId: row.sessionId };
    },

    /**
     * End every turn left `running`: at boot, with one process, nothing is
     * running them. Without this a person is told "still working" until the
     * job's stale lock lapses, minutes later. Queued turns are left: their
     * job is still in the queue and will run them.
     */
    async failRunningTurns(error: Record<string, unknown>, at: number = Date.now()): Promise<number> {
      const res = await db
        .updateTable('adminium_assistant_turns')
        .set({ status: 'failed', error: packChecked('error', assistantErrorSchema, error), finishedAt: at })
        .where('status', '=', 'running')
        .executeTakeFirst();
      return Number(res.numUpdatedRows);
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

    /**
     * Note what a turn's draft was saved as, inside its stored result
     * (`result.saved`), so a second save of the same draft can find the first.
     * `false` when the turn is gone or produced no result to carry it.
     */
    async recordTurnSaved(id: string, saved: AssistantTurnSaved): Promise<boolean> {
      const turn = await findTurn(id);
      if (turn === null || turn.result === null) return false;
      const res = await db
        .updateTable('adminium_assistant_turns')
        .set({ result: packChecked('result', assistantResultSchema, { ...turn.result, saved: { ...saved } }) })
        .where('id', '=', id)
        .executeTakeFirst();
      return Number(res.numUpdatedRows) === 1;
    },

    /**
     * Replace what a finished turn's answer holds, as its proposal is checked,
     * confirmed or let go. Only a turn that is done: one still running writes
     * its own answer when it ends.
     */
    async recordAnswer(id: string, answer: Record<string, unknown>): Promise<boolean> {
      const res = await db
        .updateTable('adminium_assistant_turns')
        .set({ answer: packJson(answer) })
        .where('id', '=', id)
        .where('status', '=', 'done')
        .executeTakeFirst();
      return Number(res.numUpdatedRows) === 1;
    },

    /**
     * Take a turn's proposal for the one confirm it gets. `false` when another
     * request already has: the guard is the statement's own WHERE.
     */
    async claimProposal(id: string, at: number = Date.now()): Promise<boolean> {
      const res = await db
        .updateTable('adminium_assistant_turns')
        .set({ proposalClaimedAt: at })
        .where('id', '=', id)
        .where('status', '=', 'done')
        .where('proposalClaimedAt', 'is', null)
        .executeTakeFirst();
      return Number(res.numUpdatedRows) === 1;
    },

    /** Note that a claimed proposal's run has written its outcome. */
    async finishProposal(id: string, answer: Record<string, unknown>, at: number = Date.now()): Promise<boolean> {
      const res = await db
        .updateTable('adminium_assistant_turns')
        .set({ answer: packJson(answer), proposalDoneAt: at })
        .where('id', '=', id)
        .where('proposalClaimedAt', 'is not', null)
        .where('proposalDoneAt', 'is', null)
        .executeTakeFirst();
      return Number(res.numUpdatedRows) === 1;
    },

    /** Turns whose proposal was taken by a confirm that never finished: its process is gone. */
    async listUnfinishedProposals(limit = 500): Promise<AssistantTurn[]> {
      const rows = await db
        .selectFrom('adminium_assistant_turns')
        .selectAll()
        .where('proposalClaimedAt', 'is not', null)
        .where('proposalDoneAt', 'is', null)
        .orderBy('createdAt', 'asc')
        .limit(limit)
        .execute();
      return rows.map(decodeTurn);
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
      if (input.answer !== undefined) set.answer = input.answer === null ? null : packJson(input.answer);
      if (input.finishedAt !== undefined) set.finishedAt = input.finishedAt;
      let query = db.updateTable('adminium_assistant_turns').set(set).where('id', '=', id);
      if (input.expected !== undefined) query = query.where('status', '=', input.expected);
      const res = await query.executeTakeFirst();
      return Number(res.numUpdatedRows) === 1;
    },
  };
}

export type AssistantSessionsRepo = ReturnType<typeof assistantSessionsRepo>;

/** The document a turn's draft became, and when. */
export interface AssistantTurnSaved {
  id: string;
  kind: string;
  name: string;
  at: number;
}
