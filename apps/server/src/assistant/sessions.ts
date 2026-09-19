// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Opening a session, replaying its history, and keeping its running total.
 *
 * A session is one open modal. The transcript it accumulates is what makes the
 * SECOND question in a conversation answerable: every earlier turn's provider
 * messages are replayed, in order, before the new one — so "make it shorter"
 * knows what "it" is without the person saying so again.
 *
 * A turn's messages are stored whole rather than re-derived, because they are
 * the record of what the model was actually shown. Re-rendering them from
 * today's documents would replay a conversation about a document that has
 * since changed.
 */

import {
  assistantOpenDocumentMessage,
  assistantPicksMessage,
  type AssistantAsk,
} from '@adminium/llm';
import { assistantSessionsRepo, type AssistantSession, type AssistantTurn, type MetaDb } from '@adminium/meta';

import type { TurnMessage } from './turn-runner.js';

/** Turns whose messages are worth replaying: the ones that actually happened. */
const REPLAYED: ReadonlySet<string> = new Set(['done', 'awaiting_picks']);

/**
 * Every earlier turn's messages, in order, plus the editor's on-screen draft
 * before the first of them.
 *
 * A failed or cancelled turn is left out: its messages end in an error the
 * model would try to answer, and nothing it produced is a fact about this
 * conversation.
 */
export function replayTranscript(
  session: AssistantSession,
  turns: readonly AssistantTurn[],
  upTo: string,
): TurnMessage[] {
  const messages: TurnMessage[] = [];
  if (session.draft !== null) {
    messages.push({ role: 'user', content: assistantOpenDocumentMessage(session.draft) });
  }
  for (const turn of turns) {
    if (turn.id === upTo) break;
    if (!REPLAYED.has(turn.status)) continue;
    for (const message of turn.transcript) {
      if (message.role !== 'user' && message.role !== 'assistant') continue;
      messages.push({ role: message.role, content: message.content });
    }
  }
  return messages;
}

/**
 * The message a turn opens with: what the person typed, or — when they
 * answered a question instead — the picks, with the labels they saw.
 *
 * The labels travel because the keys alone are meaningless to the model that
 * offered them a turn ago: `{"tpl":"t2"}` says nothing, `EU reverse charge`
 * says everything.
 */
export function openingMessage(turn: AssistantTurn, previous: AssistantTurn | null): TurnMessage {
  if (turn.picks !== null && Object.keys(turn.picks).length > 0) {
    return { role: 'user', content: assistantPicksMessage(turn.picks, labelsFor(turn.picks, previous)) };
  }
  return { role: 'user', content: turn.askText ?? '' };
}

/** The option labels a previous turn's question offered, by group key. */
function labelsFor(picks: Record<string, string>, previous: AssistantTurn | null): Record<string, string> {
  const labels: Record<string, string> = {};
  const ask = previous?.ask as AssistantAsk | null | undefined;
  if (ask === null || ask === undefined || !Array.isArray(ask.groups)) return labels;
  for (const group of ask.groups) {
    const picked = picks[group.key];
    if (picked === undefined) continue;
    const option = group.options.find((candidate) => candidate.key === picked);
    if (option !== undefined) labels[group.key] = option.label;
  }
  return labels;
}

/** Add one turn's usage to the session it belongs to. */
export async function accrueUsage(
  meta: MetaDb,
  sessionId: string,
  usage: { tokensIn: number; tokensOut: number },
  at: number,
): Promise<void> {
  await assistantSessionsRepo(meta).addUsage(sessionId, usage, at);
}

/**
 * The turn a job is about, with its session and the history behind it —
 * resolved in one place so the job handler and the routes agree on what a
 * turn's context is.
 */
export interface LoadedTurn {
  session: AssistantSession;
  turn: AssistantTurn;
  /** Earlier turns' messages, then this turn's opening message. */
  messages: TurnMessage[];
}

export async function loadTurn(meta: MetaDb, turnId: string): Promise<LoadedTurn | null> {
  const repo = assistantSessionsRepo(meta);
  const turn = await repo.findTurn(turnId);
  if (turn === null) return null;
  const session = await repo.findSession(turn.sessionId);
  if (session === null) return null;
  const turns = await repo.listTurns(turn.sessionId);
  const index = turns.findIndex((candidate) => candidate.id === turn.id);
  const previous = index > 0 ? (turns[index - 1] ?? null) : null;
  return {
    session,
    turn,
    messages: [...replayTranscript(session, turns, turn.id), openingMessage(turn, previous)],
  };
}
