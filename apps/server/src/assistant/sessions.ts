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
  estimateTokens,
  type AssistantAsk,
} from '@adminium/llm';
import { assistantSessionsRepo, type AssistantSession, type AssistantTurn, type MetaDb } from '@adminium/meta';

import { storedProposalOf } from './proposals.js';
import type { TurnMessage } from './turn-runner.js';

/** Turns whose messages are worth replaying: the ones that actually happened. */
const REPLAYED: ReadonlySet<string> = new Set(['done', 'awaiting_picks']);

/**
 * The first message of a transcript that holds ONE turn: its opening message
 * and what followed. Its role is neither `user` nor `assistant`, so it is
 * never sent to a provider; it only says how the row is to be read.
 */
export const TRANSCRIPT_MARK: TurnTranscriptMessage = { role: 'meta', content: 'adminium.transcript/v2' };

interface TurnTranscriptMessage {
  role: string;
  content: string;
}

/** What a turn stores: the mark, then its own messages (`before` is how many came from earlier turns). */
export function ownTranscript(messages: readonly TurnMessage[], before: number): TurnTranscriptMessage[] {
  return [TRANSCRIPT_MARK, ...messages.slice(before)];
}

function isMarked(transcript: readonly TurnTranscriptMessage[]): boolean {
  const first = transcript[0];
  return first !== undefined && first.role === TRANSCRIPT_MARK.role && first.content === TRANSCRIPT_MARK.content;
}

function spoken(transcript: readonly TurnTranscriptMessage[]): TurnMessage[] {
  const out: TurnMessage[] = [];
  for (const message of transcript) {
    if (message.role !== 'user' && message.role !== 'assistant') continue;
    out.push({ role: message.role, content: message.content });
  }
  return out;
}

/**
 * Every earlier turn's messages, in order, plus the editor's on-screen draft
 * before the first of them.
 *
 * A failed or cancelled turn is left out: its messages end in an error the
 * model would try to answer, and nothing it produced is a fact about this
 * conversation.
 *
 * EACH MESSAGE ONCE. A turn stores its own messages behind {@link TRANSCRIPT_MARK}.
 * Rows written before the mark existed hold the whole conversation before
 * them as well (the draft, then every earlier row as it was stored), so
 * joining them said the first question twice by the third turn and four times
 * by the fourth. Such a row is recognised by its length, not by its words: it
 * begins with exactly what the replay of its day was, and its own opening
 * message stands right after. Two turns that ask the same thing are therefore
 * never mistaken for one another.
 */
export function replayTranscript(
  session: AssistantSession,
  turns: readonly AssistantTurn[],
  upTo: string,
): TurnMessage[] {
  const history = historyOf(session, turns, upTo);
  return [...(history.open === null ? [] : [history.open]), ...history.pieces.flatMap((piece) => piece.whole)];
}

/** One earlier turn that happened, with its own messages. */
export interface HistoryPiece {
  turn: AssistantTurn;
  /** What was said in it, each message once: its opening message, the rounds, the final reply. */
  whole: TurnMessage[];
}

/** The conversation before one turn, a piece a turn, and the document open on the page it is asked on. */
export function historyOf(
  session: AssistantSession,
  turns: readonly AssistantTurn[],
  upTo: string,
): { open: TurnMessage | null; pieces: HistoryPiece[] } {
  const document = openDocumentOf(session, turns.find((turn) => turn.id === upTo) ?? null);
  const open: TurnMessage | null = document === null ? null : { role: 'user', content: assistantOpenDocumentMessage(document) };
  const pieces: HistoryPiece[] = [];
  // How long the replay was when an unmarked row was written: the draft, then every earlier row whole.
  let legacyBefore = session.draft === null ? 0 : 1;
  let previous: AssistantTurn | null = null;
  for (const turn of turns) {
    if (turn.id === upTo) break;
    const earlier = previous;
    previous = turn;
    if (!REPLAYED.has(turn.status)) continue;
    if (isMarked(turn.transcript)) {
      pieces.push({ turn, whole: spoken(turn.transcript) });
      continue;
    }
    const whole = spoken(turn.transcript);
    const opening = openingMessage(turn, earlier);
    const own = whole[legacyBefore]?.role === 'user' && whole[legacyBefore]?.content === opening.content ? whole.slice(legacyBefore) : whole;
    pieces.push({ turn, whole: own });
    legacyBefore += whole.length;
  }
  return { open, pieces };
}

/** The most earlier turns a turn of the panel's conversation reads: older ones are no longer in mind. */
export const HISTORY_TURNS_MAX = 40;

/**
 * The share of a model's window the turn just before this one may take to be
 * replayed WHOLE (its tool calls and what they answered). Above it, that
 * turn too is told in outline.
 */
export const HISTORY_NEWEST_SHARE = 0.3;

/** How much of an earlier answer an outline carries. */
const RECAP_ANSWER_MAX = 600;

const RECAP_NOTE =
  'An outline of this conversation so far, oldest first: what the person asked, on which page, what was read to answer (never the rows themselves), and what you answered. A figure that is not in front of you is read again, never recalled from here.';

/** One earlier turn, in outline: enough to know what was asked and answered, and what would have to be read again. */
function recapOf(session: AssistantSession, piece: HistoryPiece): Record<string, unknown> {
  const turn = piece.turn;
  const answer = turn.answer as { reads?: unknown; sources?: unknown } | null;
  const reads = Array.isArray(answer?.reads) ? answer.reads : [];
  const draft = turn.result === null ? undefined : (turn.result as { title?: unknown }).title;
  const say = turn.say ?? '';
  return {
    asked: piece.whole[0]?.content ?? turn.askText ?? '',
    on: turn.context ?? session.context,
    ...(reads.length > 0 ? { read: reads } : Array.isArray(answer?.sources) && answer.sources.length > 0 ? { read: answer.sources } : {}),
    answered: say.length <= RECAP_ANSWER_MAX ? say : `${say.slice(0, RECAP_ANSWER_MAX - 1)}…`,
    ...(typeof draft === 'string' ? { drafted: draft } : {}),
    ...(turn.status === 'awaiting_picks' ? { asked_back: true } : {}),
    ...(proposalOutcomeOf(turn) ?? {}),
  };
}

const PROPOSAL_NOTE =
  'What became of the proposal in your last reply. Only what is listed as done was written; say nothing else was. A proposal that was not confirmed changed nothing: propose again only if the person asks.';

/**
 * What became of a turn's proposal, as the model is told: whether the person
 * confirmed it and what the server then did. Never a preview and never a
 * row: the model learns the outcome, not what the person was shown.
 */
function proposalOutcomeOf(turn: AssistantTurn): Record<string, unknown> | null {
  const proposal = storedProposalOf(turn.answer);
  if (proposal === null) return null;
  if (proposal.state !== 'applied' && proposal.state !== 'interrupted' && proposal.state !== 'applying') {
    return { proposed: proposal.title, confirmed: false };
  }
  const outcome = proposal.outcome ?? { done: [], failed: [], notTried: [] };
  return {
    proposed: proposal.title,
    confirmed: true,
    done: outcome.done.map((entry) => ({ action: entry.index, ...(entry.id === null ? {} : { id: entry.id }) })),
    ...(outcome.failed.length === 0 ? {} : { refused: outcome.failed.map((entry) => ({ action: entry.index, code: entry.code, message: entry.message })) }),
    ...(outcome.notTried.length === 0 ? {} : { not_tried: outcome.notTried }),
    ...(outcome.unsure === undefined || outcome.unsure.length === 0 ? {} : { not_known: outcome.unsure }),
  };
}

export interface ComposedHistory {
  /** What is sent: the open document, the outline, the newest turn whole, this turn's opening message. */
  messages: TurnMessage[];
  /** Earlier turns that are not in it at all: the conversation had outgrown the model's window. */
  forgot: number;
  /** Earlier turns told in outline rather than replayed whole. */
  outlined: number;
}

/**
 * What a turn is sent of the conversation before it.
 *
 * NOT EVERYTHING. Replayed whole, a conversation's tool calls and the rows
 * they answered are most of its size, and it outgrows a small model's window
 * in a handful of questions. So:
 *
 *  - the turn JUST BEFORE this one is replayed whole while it fits a fixed
 *    share of the window, because "sort that by country" and "why is the
 *    third one higher" lean on what it read. A turn that asked the person
 *    something back is always whole: its answer is this turn's opening;
 *  - older turns are told in OUTLINE, in one message: what was asked, on
 *    which page, what was read (tables and counts, never rows) and what was
 *    answered. Enough to know what "it" is; not enough to quote a figure
 *    from, which the prompt says is read again;
 *  - when even that does not fit, the oldest turns are left out, and the
 *    turn says how many, so the person is told what the assistant no longer
 *    has in mind instead of being answered from half a conversation.
 */
export function composeHistory(input: {
  session: AssistantSession;
  open: TurnMessage | null;
  pieces: readonly HistoryPiece[];
  opening: TurnMessage;
  system: string;
  /** The model's input window, in tokens as this server estimates them. */
  limit: number;
}): ComposedHistory {
  const size = (messages: readonly TurnMessage[]): number => messages.reduce((total, message) => total + estimateTokens(message.content), 0);
  const newest = input.pieces.at(-1);
  const newestWhole =
    newest !== undefined && (newest.turn.status === 'awaiting_picks' || size(newest.whole) <= HISTORY_NEWEST_SHARE * input.limit);
  let outline = newestWhole ? input.pieces.slice(0, -1) : [...input.pieces];
  const tail = newestWhole && newest !== undefined ? newest.whole : [];
  let forgot = 0;
  // The newest turn's own reply is replayed whole, so what became of its proposal follows it.
  const became = newestWhole && newest !== undefined ? proposalOutcomeOf(newest.turn) : null;
  const outcomeNote: TurnMessage | null = became === null ? null : { role: 'user', content: JSON.stringify({ proposal_outcome: became, note: PROPOSAL_NOTE }) };

  const build = (): TurnMessage[] => [
    ...(input.open === null ? [] : [input.open]),
    ...(outline.length === 0
      ? []
      : [{ role: 'user' as const, content: JSON.stringify({ earlier_in_this_conversation: outline.map((piece) => recapOf(input.session, piece)), note: RECAP_NOTE }) }]),
    ...tail,
    ...(outcomeNote === null ? [] : [outcomeNote]),
    input.opening,
  ];
  const fits = (messages: readonly TurnMessage[]): boolean => estimateTokens(input.system) + size(messages) <= input.limit;

  let messages = build();
  while (!fits(messages) && outline.length > 0) {
    outline = outline.slice(1);
    forgot += 1;
    messages = build();
  }
  return { messages, forgot, outlined: outline.length };
}

/**
 * The unsaved document the model is shown before anything else: the one on
 * the screen of the page the question is asked on.
 *
 * A turn that names its own page carries that page's document (or none, on a
 * page that is not an editor). A turn that names no page was asked in the
 * window the session opened, whose document the session kept. The session's
 * is never shown to a turn asked elsewhere: it would be a document from a
 * page the person has left, presented as "currently open".
 */
function openDocumentOf(session: AssistantSession, turn: AssistantTurn | null): unknown | null {
  if (turn === null || turn.context === null) return session.draft;
  return turn.draft;
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
  /** Earlier turns' messages, each whole, then this turn's opening message. */
  messages: TurnMessage[];
  /** The same conversation in pieces, for {@link composeHistory}: what is sent depends on the model's window. */
  open: TurnMessage | null;
  pieces: HistoryPiece[];
  opening: TurnMessage;
  /** Earlier turns of a long conversation that were not read at all: they count as forgotten. */
  unread: number;
}

export async function loadTurn(meta: MetaDb, turnId: string): Promise<LoadedTurn | null> {
  const repo = assistantSessionsRepo(meta);
  const turn = await repo.findTurn(turnId);
  if (turn === null) return null;
  const session = await repo.findSession(turn.sessionId);
  if (session === null) return null;
  // A window's session is short and may hold rows an earlier release wrote, which are read from
  // its first turn on. The panel's conversation lasts weeks and every row of it is marked: its
  // END is read, and what came before is counted as no longer in mind.
  const tail = session.kind === 'panel' ? await repo.listTurnsTail(turn.sessionId, HISTORY_TURNS_MAX + 1, turn.seq) : null;
  const turns = tail === null ? await repo.listTurns(turn.sessionId) : tail.turns;
  const index = turns.findIndex((candidate) => candidate.id === turn.id);
  const previous = index > 0 ? (turns[index - 1] ?? null) : null;
  const history = historyOf(session, turns, turn.id);
  const opening = openingMessage(turn, previous);
  return {
    session,
    turn,
    messages: [...(history.open === null ? [] : [history.open]), ...history.pieces.flatMap((piece) => piece.whole), opening],
    open: history.open,
    pieces: history.pieces,
    opening,
    unread: tail?.earlier ?? 0,
  };
}
