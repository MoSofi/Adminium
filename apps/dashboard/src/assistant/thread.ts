// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A conversation's turns, as the thread draws them, and what is read off a
 * refusal.
 *
 * THE THREAD KEEPS EVERY TURN: each keeps its own bubble, card and result,
 * because scrolling back to what was asked two turns ago is the ordinary
 * thing to want.
 *
 * NOTHING IS OPTIMISTIC. A turn appears when the server has a row for it, and
 * its result when the server has one. There is no local guess to reconcile,
 * which is what makes a reload mid-turn show what the screen already shows.
 */
import { ApiError } from '../app/api.js';
import { t } from '../i18n/t.js';
import {
  readAsk,
  isTooLong,
  readAnswer,
  readErrorKind,
  readResetsAt,
  readErrorMessage,
  readResult,
  type AssistantAnswer,
  type AssistantAsk,
  type AssistantContext,
  type AssistantErrorKind,
  type AssistantResult,
  type AssistantStepView,
  type AssistantTurnStatus,
  type AssistantTurnView,
} from './api.js';

/** One exchange, as the thread draws it. */
export interface ThreadTurn {
  id: string;
  status: AssistantTurnStatus;
  /** What the person typed, when they typed rather than picked. */
  askText: string | null;
  /** The labels they picked, when they answered a question. */
  pickedLabels: string[];
  say: string | null;
  steps: AssistantStepView[];
  ask: AssistantAsk | null;
  result: AssistantResult | null;
  /** Why it failed, in one sentence; `null` for a failure with no sentence. */
  errorMessage: string | null;
  /** The one failure this app words itself: the conversation outgrew the model. */
  tooLong: boolean;
  /** A failure this app has its own words for; `null` for one it shows in the server's. */
  errorKind: AssistantErrorKind | null;
  /** When today's allowance starts again, if this is the turn that used the last of it. */
  usedUpUntil: number | null;
  /** What the turn read, forgot, offers next and points at; `null` on a turn that recorded none. */
  answer: AssistantAnswer | null;
  /** The page it was asked on. */
  context: AssistantContext;
  on: {
    pageId: string | null;
    documentId: string | null;
    title: string | null;
    scope: { kind: 'selection' | 'record' | 'page'; count: number | null } | null;
    /** It drafted for a document that has been deleted since. */
    gone: boolean;
  };
  jobId: string | null;
  /** What this turn cost, as the row reports it. */
  tokensIn: number;
  tokensOut: number;
}

export interface ActionOutcome {
  echo: Record<string, unknown>;
  created: { id: string; kind: string; name: string } | null;
  sample: { artefact: Record<string, unknown>; label: string } | null;
}

export function toThreadTurn(view: AssistantTurnView, pickedLabels: string[]): ThreadTurn {
  return {
    id: view.id,
    status: view.status,
    askText: view.askText,
    pickedLabels,
    say: view.say,
    steps: view.steps,
    ask: readAsk(view.ask),
    result: readResult(view.result),
    errorMessage: readErrorMessage(view.error),
    tooLong: isTooLong(view.error),
    errorKind: readErrorKind(view.error),
    usedUpUntil: readResetsAt(view.answer) ?? (readErrorKind(view.error) === 'budget' ? readResetsAt(view.error) : null),
    answer: readAnswer(view.answer),
    context: view.context,
    on: {
      pageId: view.on?.pageId ?? null,
      documentId: view.on?.documentId ?? null,
      title: view.on?.title ?? null,
      scope: view.on?.scope ?? null,
      gone: view.on?.gone === true,
    },
    jobId: view.jobId,
    tokensIn: view.tokensIn ?? 0,
    tokensOut: view.tokensOut ?? 0,
  };
}


/**
 * What to show when something refuses.
 *
 * Every failure shows the SERVER's own scrubbed sentence, because it usually
 * says the one useful thing — which table, which field, which document. Two
 * do not, and both are states this product already has words for in every
 * language: a conversation the model cannot hold any more, and an instance
 * with no mail relay. For those the server sends a MARKER and this says it,
 * because an English sentence in a Czech modal is a worse answer than a
 * translated one.
 */
export function messageOf(error: unknown): string {
  if (error instanceof ApiError) {
    const details = error.details;
    const setting =
      typeof details === 'object' && details !== null && !Array.isArray(details)
        ? (details as { setting?: unknown }).setting
        : undefined;
    if (setting === 'email.smtp') {
      return t('assistant:error.smtp', 'Email is not configured yet. Open Email settings to add a relay.');
    }
    // One question at a time, in whichever window: said in the person's language, not the server's.
    if (reasonOf(error) === 'busy') return t('assistant:error.busy', 'Your last question is still being worked on. Wait for it, or stop it first.');
    return error.message;
  }
  return error instanceof Error ? error.message : String(error);
}

/** Why the server refused, when it named a reason this app has its own words for. */
export function reasonOf(error: unknown): string | null {
  if (!(error instanceof ApiError)) return null;
  const details = error.details;
  const reason = typeof details === 'object' && details !== null && !Array.isArray(details) ? (details as { reason?: unknown }).reason : undefined;
  return typeof reason === 'string' ? reason : null;
}
