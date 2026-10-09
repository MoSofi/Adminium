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
 * IT LIVES AS LONG AS THE APP IS OPEN, so nothing it learns may be for ever:
 * whether a model is set up, whether the day's allowance is used, what this
 * person may do on this page are all asked again (on opening the panel, on
 * walking to a page of another kind, when the day turns), because the panel
 * that learned them an hour ago is the same panel.
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
import { messageOf, reasonOf, toThreadTurn, type ActionOutcome, type ThreadTurn } from '../thread.js';
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
  /** A question is on its way to the server: nothing else may be started or ended meanwhile. */
  asking: boolean;
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
  /** Read one turn again, whole: an older draft comes without its document until it is needed. */
  loadWhole: (turnId: string) => void;
}

const LIVE: readonly AssistantTurnStatus[] = ['queued', 'running'];
/** How long a page must stand still before its facts are asked for: a grid publishes on every keystroke. */
const FACTS_SETTLE_MS = 350;
/** How often a running turn's row is read, beside the channel that announces its end. */
export const LIVE_POLL_MS = 5_000;

export function usePanelConversation(page: PanelPage, active: boolean): PanelConversation {
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
  const [asking, setAsking] = useState(false);
  // Bumped to load everything again: a first load that failed is tried again when the panel is next opened.
  const [attempt, setAttempt] = useState(0);

  const sessionRef = useRef<string | null>(null);
  sessionRef.current = sessionId;
  /** "New conversation" closing the old one: the next conversation is not opened until it has. */
  const closing = useRef<Promise<unknown> | null>(null);
  const askingRef = useRef(false);

  const live = turns.find((turn) => LIVE.includes(turn.status)) ?? null;

  /** What the server says of who may ask, folded in: it decides the bars, never a guess kept from earlier. */
  const takeAvailability = useCallback((state: AssistantAvailability) => {
    setAvailability(state);
    setUsedUpUntil(state.budget !== undefined && !state.budget.left ? state.budget.resetsAt : null);
    setPhase((current) => (current === 'loading' || current === 'error' ? current : state.enabled ? 'ready' : 'unavailable'));
  }, []);

  // ── load: who may ask, and the conversation they left ─────────────────────
  const context = page.context;
  const contextRef = useRef(context);
  contextRef.current = context;
  const askedFor = useRef<AssistantContext | null>(null);
  useEffect(() => {
    let cancelled = false;
    setPhase('loading');
    setProblem(null);
    void (async () => {
      try {
        const forContext = contextRef.current;
        const [state, current] = await Promise.all([assistantApi.availability(forContext), assistantApi.currentSession()]);
        if (cancelled) return;
        askedFor.current = forContext;
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
  }, [attempt]);

  // Asked again whenever the answer may have changed: the panel is opened (a model may have been
  // set up since, the day may have turned, an admin may have raised the allowance), or the
  // person walked to a page of another kind (saving a template and saving a rule are different
  // grants). Not while it is closed: a closed panel asks the server nothing.
  const loaded = phase !== 'loading' && phase !== 'error';
  const wasActive = useRef(active);
  useEffect(() => {
    const opened = active && !wasActive.current;
    wasActive.current = active;
    if (!active) return;
    if (phase === 'error') {
      if (opened) setAttempt((count) => count + 1);
      return;
    }
    if (!loaded || (!opened && askedFor.current === context)) return;
    askedFor.current = context;
    let cancelled = false;
    assistantApi.availability(context).then(
      (state) => {
        if (!cancelled) takeAvailability(state);
      },
      () => {
        // Asked again on the next page or the next opening.
        askedFor.current = null;
      },
    );
    return () => {
      cancelled = true;
    };
  }, [active, loaded, phase, context, takeAvailability]);

  // The day's allowance starts again at an instant the server named: the bar goes when it comes.
  useEffect(() => {
    if (usedUpUntil === null) return;
    const wait = Math.min(Math.max(usedUpUntil - Date.now(), 0) + 1_000, 2_147_000_000);
    const timer = setTimeout(() => {
      setUsedUpUntil(null);
      askedFor.current = null;
    }, wait);
    return () => clearTimeout(timer);
  }, [usedUpUntil]);

  // ── the page the person is on: what the assistant would be told of it ─────
  const pageKey = JSON.stringify([page.context, page.host]);
  const enabled = availability?.enabled === true;
  useEffect(() => {
    // Only while the panel is open: a closed one costs the person none of their requests.
    if (!enabled || !active) return;
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
  }, [enabled, active, pageKey]);

  /** A turn as the server has it now, folded into the thread. */
  const fold = useCallback((view: Parameters<typeof toThreadTurn>[0], pickedLabels?: string[]) => {
    setTurns((previous) => {
      const at = previous.findIndex((turn) => turn.id === view.id);
      const next = toThreadTurn(view, pickedLabels ?? previous[at]?.pickedLabels ?? []);
      // A read that was on its way when the turn ended must not put it back to "working".
      if (at !== -1 && !LIVE.includes(previous[at]!.status) && LIVE.includes(next.status)) return previous;
      return at === -1 ? [...previous, next] : previous.map((turn, index) => (index === at ? next : turn));
    });
    // The answer that used the last of the day says when it starts again.
    const reset = readResetsAt(view.answer) ?? (view.error !== null && view.error.kind === 'budget' ? readResetsAt(view.error) : null);
    if (reset !== null && reset > Date.now()) setUsedUpUntil(reset);
  }, []);

  /** Read one turn's row and fold it into the thread. */
  const refreshTurn = useCallback(
    async (turnId: string) => {
      const id = sessionRef.current;
      if (id === null) return;
      try {
        fold(await assistantApi.turn(id, turnId));
      } catch (error) {
        setProblem(messageOf(error));
      }
    },
    [fold],
  );

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
  // Nothing is running here any more: whatever was "still working" has been seen to end.
  useEffect(() => {
    if (liveTurnId === null) setBusyElsewhere(false);
  }, [liveTurnId]);

  const start = useCallback(
    async (body: { text?: string; picks?: Record<string, string> }, pickedLabels: string[], on: PanelPage) => {
      // One at a time from here too: a second press while the first is on its way is not a second question.
      if (askingRef.current) return;
      askingRef.current = true;
      setAsking(true);
      setProblem(null);
      setBusyElsewhere(false);
      const where = { context: on.context, host: on.host, ...(on.draft === undefined ? {} : { draft: on.draft }) };
      try {
        // A conversation being ended is ended first: opened before that, the server would answer
        // the very conversation that is about to close.
        if (closing.current !== null) await closing.current;
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
        fold(started.turn, pickedLabels);
      } catch (error) {
        const reason = reasonOf(error);
        if (reason === 'budget') setUsedUpUntil(readResetsAt(error instanceof ApiError ? error.details : null));
        else if (reason === 'busy') setBusyElsewhere(true);
        else if (reason === 'closed') setClosedElsewhere(true);
        else setProblem(messageOf(error));
      } finally {
        askingRef.current = false;
        setAsking(false);
      }
    },
    [fold],
  );

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
    // Not while a question is on its way: its turn would arrive in a thread that no longer is its own.
    if (askingRef.current) return;
    const id = sessionRef.current;
    sessionRef.current = null;
    setSessionId(null);
    setTurns([]);
    setEarlier(0);
    setProblem(null);
    setClosedElsewhere(false);
    setBusyElsewhere(false);
    if (id === null) return;
    // Closed for good on the server; a failure is swept by its age, and the person has moved on.
    const closed = assistantApi
      .closeSession(id)
      .catch(() => undefined)
      .finally(() => {
        if (closing.current === closed) closing.current = null;
      });
    closing.current = closed;
  }, []);

  const runAction = useCallback(
    async (turnId: string, body: AssistantActionBody): Promise<ActionOutcome | null> => {
      const id = sessionRef.current;
      if (id === null) return null;
      setProblem(null);
      try {
        const reply = await assistantApi.action(id, turnId, body);
        // What the server recorded on the turn (a draft that is now saved) is read back, so the
        // card says so after the panel has been closed and opened again.
        if (reply.created !== null) void refreshTurn(turnId);
        return { echo: reply.echo, created: reply.created, sample: reply.sample };
      } catch (error) {
        setProblem(messageOf(error));
        return null;
      }
    },
    [refreshTurn],
  );

  const loadWhole = useCallback((turnId: string) => void refreshTurn(turnId), [refreshTurn]);

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
    asking,
    nextTurnTokens,
    problem,
    usedUpUntil,
    loadWhole,
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
