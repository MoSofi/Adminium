// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The panel's conversation: one a person, kept by the server, asked on
 * whichever page the person is on.
 *
 * HOW IT DIFFERS FROM A WINDOW'S SESSION (`useAssistantSession`). A window
 * opens a session when it opens and closes it when it closes: the session IS
 * the open window. The panel's conversation outlives the panel: it is found
 * again on every load, nothing here closes it but "New conversation", and
 * each question carries the page it is asked on, because the person walks
 * while they talk.
 *
 * ONE QUESTION AT A TIME, IN WHICHEVER WINDOW. The server refuses a second
 * while one runs; that refusal is a state here (the line above the field),
 * not an error under the question.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { ApiError } from '../../app/api.js';
import {
  assistantApi,
  readResetsAt,
  type AssistantActionBody,
  type AssistantAvailability,
  type AssistantContext,
  type AssistantFacts,
  type AssistantHostRef,
  type AssistantTurnStatus,
} from '../api.js';
import { messageOf, reasonOf, toThreadTurn, type ActionOutcome, type ThreadTurn } from '../useAssistantSession.js';
import { useTurnProgress, type LiveStep } from '../useTurnProgress.js';

/** The page a question is asked on, as the page published it. */
export interface PanelPage {
  context: AssistantContext;
  host: AssistantHostRef;
  /** An editor's unsaved document. */
  draft?: unknown;
}

export type PanelPhase = 'loading' | 'unavailable' | 'ready' | 'error';

export interface PanelConversation {
  phase: PanelPhase;
  availability: AssistantAvailability | null;
  /** What the assistant is told of the page the person is on NOW. */
  facts: AssistantFacts | null;
  name: string;
  /** Null until the first question of a conversation is asked. */
  sessionId: string | null;
  turns: ThreadTurn[];
  /** Earlier turns of the conversation that were not loaded. */
  earlier: number;
  liveSteps: LiveStep[];
  working: boolean;
  /** A question was refused because another is still running (asked in another window, or not yet seen here). */
  busyElsewhere: boolean;
  nextTurnTokens: number;
  problem: string | null;
  usedUpUntil: number | null;
  /** The conversation on screen was closed somewhere else: nothing more can be asked in it. */
  closedElsewhere: boolean;
  /** There is no conversation because the last one was closed for its age, lately. */
  aged: boolean;
  ask: (text: string, page: PanelPage) => void;
  answer: (turnId: string, picks: Record<string, string>, page: PanelPage) => void;
  stop: () => void;
  newConversation: () => void;
  runAction: (turnId: string, body: AssistantActionBody) => Promise<ActionOutcome | null>;
}

const LIVE: readonly AssistantTurnStatus[] = ['queued', 'running'];
/** How long a page must stand still before its facts are asked for: a grid publishes on every keystroke. */
const FACTS_SETTLE_MS = 350;
/** How often a running turn's row is read, beside the channel that announces its end. */
export const LIVE_POLL_MS = 5_000;

export function usePanelConversation(page: PanelPage): PanelConversation {
  const [phase, setPhase] = useState<PanelPhase>('loading');
  const [availability, setAvailability] = useState<AssistantAvailability | null>(null);
  const [facts, setFacts] = useState<AssistantFacts | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [turns, setTurns] = useState<ThreadTurn[]>([]);
  const [earlier, setEarlier] = useState(0);
  const [nextTurnTokens, setNextTurnTokens] = useState(0);
  const [problem, setProblem] = useState<string | null>(null);
  const [usedUpUntil, setUsedUpUntil] = useState<number | null>(null);
  const [closedElsewhere, setClosedElsewhere] = useState(false);
  const [busyElsewhere, setBusyElsewhere] = useState(false);
  const [aged, setAged] = useState(false);

  const sessionRef = useRef<string | null>(null);
  sessionRef.current = sessionId;

  const live = turns.find((turn) => LIVE.includes(turn.status)) ?? null;

  // ── load: who may ask, and the conversation they left ─────────────────────
  const context = page.context;
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [state, current] = await Promise.all([assistantApi.availability(context), assistantApi.currentSession()]);
        if (cancelled) return;
        setAvailability(state);
        setUsedUpUntil(state.budget !== undefined && !state.budget.left ? state.budget.resetsAt : null);
        setSessionId(current.session?.id ?? null);
        setTurns(current.turns.map((view) => toThreadTurn(view, [])));
        setEarlier(current.earlier);
        setAged(current.aged === true);
        setPhase(state.enabled ? 'ready' : 'unavailable');
      } catch (error) {
        if (cancelled) return;
        setProblem(messageOf(error));
        setPhase('error');
      }
    })();
    return () => {
      cancelled = true;
    };
    // Once a panel: the page the person walks to changes the facts below, not who they are.
  }, []);

  // ── the page the person is on: what the assistant would be told of it ─────
  const pageKey = JSON.stringify([page.context, page.host]);
  const enabled = availability?.enabled === true;
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      const [pageContext, host] = JSON.parse(pageKey) as [AssistantContext, AssistantHostRef];
      assistantApi.pageFacts({ context: pageContext, host }).then(
        (reply) => {
          if (cancelled) return;
          setFacts(reply.facts);
          setNextTurnTokens(reply.nextTurnTokens);
        },
        () => {
          // The header then says less; asking still works, and the turn reads the page itself.
          if (!cancelled) setFacts(null);
        },
      );
    }, FACTS_SETTLE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [enabled, pageKey]);

  /** Read one turn's row and fold it into the thread. */
  const refreshTurn = useCallback(async (turnId: string) => {
    const id = sessionRef.current;
    if (id === null) return;
    try {
      const view = await assistantApi.turn(id, turnId);
      setTurns((previous) => previous.map((turn) => (turn.id === turnId ? toThreadTurn(view, turn.pickedLabels) : turn)));
    } catch (error) {
      setProblem(messageOf(error));
    }
  }, []);

  const onTerminal = useCallback(() => {
    const id = live?.id;
    if (id !== undefined) void refreshTurn(id);
  }, [live?.id, refreshTurn]);
  const { steps: liveSteps } = useTurnProgress(live?.jobId ?? null, onTerminal);

  // The channel says when a turn ends, and a missed event would leave it "working" for ever: a
  // socket that dropped, a turn found already running on load, a tab that slept. So the row is
  // read as well, slowly, while one runs. Slow on purpose: these reads share the person's
  // per-minute allowance of requests with their questions.
  const liveTurnId = live?.id ?? null;
  useEffect(() => {
    if (liveTurnId === null) return;
    const timer = setInterval(() => void refreshTurn(liveTurnId), LIVE_POLL_MS);
    return () => clearInterval(timer);
  }, [liveTurnId, refreshTurn]);

  const start = useCallback(async (body: { text?: string; picks?: Record<string, string> }, pickedLabels: string[], on: PanelPage) => {
    setProblem(null);
    setBusyElsewhere(false);
    const where = { context: on.context, host: on.host, ...(on.draft === undefined ? {} : { draft: on.draft }) };
    try {
      let id = sessionRef.current;
      if (id === null) {
        // The first question of a conversation makes it. Two windows that do this at once are
        // both answered the same conversation by the server.
        const opened = await assistantApi.openSession({ ...where, kind: 'panel' });
        id = opened.session.id;
        sessionRef.current = id;
        setSessionId(id);
      }
      const started = await assistantApi.createTurn(id, { ...body, ...where });
      // The estimate under the field stays the page's (`pageFacts`): what this reply carries is
      // the size of the next message alone, which says nothing of what a question here costs.
      setTurns((previous) => [...previous, toThreadTurn(started.turn, pickedLabels)]);
    } catch (error) {
      const reason = reasonOf(error);
      if (reason === 'budget') {
        setUsedUpUntil(readResetsAt(error instanceof ApiError ? error.details : null));
        return;
      }
      if (reason === 'busy') {
        setBusyElsewhere(true);
        return;
      }
      if (reason === 'closed') {
        setClosedElsewhere(true);
        return;
      }
      setProblem(messageOf(error));
    }
  }, []);

  const ask = useCallback(
    (text: string, on: PanelPage) => {
      const trimmed = text.trim();
      if (trimmed !== '') void start({ text: trimmed }, [], on);
    },
    [start],
  );

  const answer = useCallback(
    (turnId: string, picks: Record<string, string>, on: PanelPage) => {
      const asked = turns.find((turn) => turn.id === turnId);
      const labels: string[] = [];
      for (const group of asked?.ask?.groups ?? []) {
        const option = group.options.find((candidate) => candidate.key === picks[group.key]);
        if (option !== undefined) labels.push(option.label);
      }
      void start({ picks }, labels, on);
    },
    [start, turns],
  );

  const liveId = live?.id ?? null;
  const stop = useCallback(() => {
    const id = sessionRef.current;
    if (id === null || liveId === null) return;
    void assistantApi
      .cancelTurn(id, liveId)
      .catch(() => undefined)
      .then(() => refreshTurn(liveId));
  }, [liveId, refreshTurn]);

  const newConversation = useCallback(() => {
    const id = sessionRef.current;
    sessionRef.current = null;
    setSessionId(null);
    setTurns([]);
    setEarlier(0);
    setProblem(null);
    setClosedElsewhere(false);
    setBusyElsewhere(false);
    // Closed for good on the server; a failure is swept by its age, and the person has moved on.
    if (id !== null) void assistantApi.closeSession(id).catch(() => undefined);
  }, []);

  const runAction = useCallback(async (turnId: string, body: AssistantActionBody): Promise<ActionOutcome | null> => {
    const id = sessionRef.current;
    if (id === null) return null;
    setProblem(null);
    try {
      const reply = await assistantApi.action(id, turnId, body);
      return { echo: reply.echo, created: reply.created, sample: reply.sample };
    } catch (error) {
      setProblem(messageOf(error));
      return null;
    }
  }, []);

  return {
    phase,
    availability,
    facts,
    name: availability?.name ?? 'Milo',
    sessionId,
    turns,
    earlier,
    liveSteps,
    working: live !== null,
    busyElsewhere,
    nextTurnTokens,
    problem,
    usedUpUntil: usedUpUntil ?? turns.reduce<number | null>((found, turn) => turn.usedUpUntil ?? found, null),
    closedElsewhere,
    // Said until the person asks something: then there is a conversation again.
    aged: aged && sessionId === null,
    ask,
    answer,
    stop,
    newConversation,
    runAction,
  };
}
