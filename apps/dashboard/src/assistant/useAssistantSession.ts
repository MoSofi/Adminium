// SPDX-License-Identifier: AGPL-3.0-only
/**
 * One open modal, as state.
 *
 * The whole conversation lives here so the parts below can be plain functions
 * of what they are given: opening the session, asking, answering a question,
 * following the work, running an action, and closing.
 *
 * THE THREAD KEEPS EVERY TURN. The comp draws only the last question, because
 * a comp shows one moment; a real session has many, and scrolling back to what
 * you asked two turns ago is the ordinary thing to want. Each turn keeps its
 * own bubble, card and result.
 *
 * NOTHING IS OPTIMISTIC. A turn appears when the server has a row for it, and
 * its result appears when the server has one. There is no local guess to
 * reconcile, which is what makes a reload mid-turn show the same thing the
 * screen already shows.
 *
 * CLOSING CANCELS. A turn that is still running when the modal closes is
 * cancelled and the session is closed — work nobody is waiting for is work
 * nobody should pay a provider for.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { ApiError } from '../app/api.js';
import { t } from '../i18n/t.js';
import {
  assistantApi,
  readAsk,
  isTooLong,
  readErrorMessage,
  readResult,
  type AssistantAsk,
  type AssistantAvailability,
  type AssistantFacts,
  type AssistantResult,
  type AssistantStepView,
  type AssistantTurnStatus,
  type AssistantTurnView,
} from './api.js';
import type { AssistantHostContext } from './hostContext.js';
import { useTurnProgress, type LiveStep } from './useTurnProgress.js';

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
  jobId: string | null;
  /** What this turn cost, as the row reports it. */
  tokensIn: number;
  tokensOut: number;
}

export type SessionPhase = 'loading' | 'unavailable' | 'ready' | 'error';

export interface AssistantSession {
  phase: SessionPhase;
  availability: AssistantAvailability | null;
  facts: AssistantFacts | null;
  /** The assistant's name here; the fallback keeps the copy readable before the first reply. */
  name: string;
  turns: ThreadTurn[];
  /** The turn the modal is currently watching, if any. */
  liveSteps: LiveStep[];
  /** True while a turn is queued or running. */
  working: boolean;
  tokensIn: number;
  tokensOut: number;
  nextTurnTokens: number;
  /** A sentence about something that went wrong outside a turn (opening, an action). */
  problem: string | null;
  submit: (text: string) => void;
  answer: (turnId: string, picks: Record<string, string>) => void;
  runAction: (turnId: string, body: ActionRequest) => Promise<ActionOutcome | null>;
}

export interface ActionRequest {
  action: 'save' | 'test-send' | 'sample' | 'language.add';
  open?: boolean;
  name?: string;
  locale?: string;
}

export interface ActionOutcome {
  echo: Record<string, unknown>;
  created: { id: string; kind: string; name: string } | null;
  sample: { artefact: Record<string, unknown>; label: string } | null;
}

function toThreadTurn(view: AssistantTurnView, pickedLabels: string[]): ThreadTurn {
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
    jobId: view.jobId,
    tokensIn: view.tokensIn ?? 0,
    tokensOut: view.tokensOut ?? 0,
  };
}

const LIVE: readonly AssistantTurnStatus[] = ['queued', 'running'];

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
function messageOf(error: unknown): string {
  if (error instanceof ApiError) {
    const details = error.details;
    const setting =
      typeof details === 'object' && details !== null && !Array.isArray(details)
        ? (details as { setting?: unknown }).setting
        : undefined;
    if (setting === 'email.smtp') {
      return t('assistant:error.smtp', 'Email is not configured yet. Open Email settings to add a relay.');
    }
    return error.message;
  }
  return error instanceof Error ? error.message : String(error);
}

/**
 * Open a session for one host and drive it.
 *
 * `open` is the modal's own open state: the session is created when the modal
 * opens and closed when it closes, which is what makes the session row mean
 * "one open modal" rather than "one browser tab".
 */
export function useAssistantSession(host: AssistantHostContext, open: boolean): AssistantSession {
  const [phase, setPhase] = useState<SessionPhase>('loading');
  const [availability, setAvailability] = useState<AssistantAvailability | null>(null);
  const [facts, setFacts] = useState<AssistantFacts | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [turns, setTurns] = useState<ThreadTurn[]>([]);
  // What the session had ALREADY spent when this modal opened. Everything
  // since is summed from the turns themselves, so a turn read twice cannot
  // double-count and a turn that arrived finished still counts once.
  const [baseTokens, setBaseTokens] = useState({ in: 0, out: 0 });
  const [nextTurnTokens, setNextTurnTokens] = useState(0);
  const [problem, setProblem] = useState<string | null>(null);

  const sessionRef = useRef<string | null>(null);
  sessionRef.current = sessionId;
  const hostRef = useRef(host);
  hostRef.current = host;

  const live = turns.find((turn) => LIVE.includes(turn.status)) ?? null;

  // ── open ───────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setPhase('loading');
    setTurns([]);
    setProblem(null);
    void (async () => {
      try {
        const current = hostRef.current;
        const state = await assistantApi.availability(current.context);
        if (cancelled) return;
        setAvailability(state);
        if (!state.enabled) {
          setPhase('unavailable');
          return;
        }
        const opened = await assistantApi.openSession({
          context: current.context,
          host: current.host,
          ...(current.draft === undefined ? {} : { draft: current.draft as Record<string, unknown> }),
        });
        if (cancelled) return;
        setSessionId(opened.session.id);
        setFacts(opened.facts);
        setBaseTokens({ in: opened.session.tokensIn, out: opened.session.tokensOut });
        setNextTurnTokens(opened.nextTurnTokens);
        setPhase('ready');
      } catch (error) {
        if (cancelled) return;
        setProblem(messageOf(error));
        setPhase('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  // ── close ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (open) return;
    const id = sessionRef.current;
    if (id === null) return;
    setSessionId(null);
    // Fire-and-forget: the modal is already gone, and a failed close is swept
    // by retention rather than shown to somebody who has moved on.
    void assistantApi.closeSession(id).catch(() => undefined);
  }, [open]);

  useEffect(
    () => () => {
      const id = sessionRef.current;
      if (id !== null) void assistantApi.closeSession(id).catch(() => undefined);
    },
    [],
  );

  /** Read one turn's row and fold it into the thread. */
  const refreshTurn = useCallback(async (turnId: string) => {
    const id = sessionRef.current;
    if (id === null) return;
    try {
      const view = await assistantApi.turn(id, turnId);
      setTurns((previous) =>
        previous.map((turn) => (turn.id === turnId ? toThreadTurn(view, turn.pickedLabels) : turn)),
      );
    } catch (error) {
      setProblem(messageOf(error));
    }
  }, []);

  const onTerminal = useCallback(() => {
    const id = live?.id;
    if (id !== undefined) void refreshTurn(id);
  }, [live?.id, refreshTurn]);

  const { steps: liveSteps } = useTurnProgress(live?.jobId ?? null, onTerminal);

  const start = useCallback(
    async (body: { text?: string; picks?: Record<string, string> }, pickedLabels: string[]) => {
      const id = sessionRef.current;
      if (id === null) return;
      setProblem(null);
      try {
        const started = await assistantApi.createTurn(id, body);
        setTurns((previous) => [...previous, toThreadTurn(started.turn, pickedLabels)]);
        setNextTurnTokens(started.nextTurnTokens);
      } catch (error) {
        setProblem(messageOf(error));
      }
    },
    [],
  );

  const submit = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (trimmed === '') return;
      void start({ text: trimmed }, []);
    },
    [start],
  );

  const answer = useCallback(
    (turnId: string, picks: Record<string, string>) => {
      // The labels the person SAW travel with the answer, because a key alone
      // says nothing a turn later — to the model or to whoever reads this back.
      const asked = turns.find((turn) => turn.id === turnId);
      const labels: string[] = [];
      for (const group of asked?.ask?.groups ?? []) {
        const picked = picks[group.key];
        const option = group.options.find((candidate) => candidate.key === picked);
        if (option !== undefined) labels.push(option.label);
      }
      void start({ picks }, labels);
    },
    [start, turns],
  );

  const runAction = useCallback(
    async (turnId: string, body: ActionRequest): Promise<ActionOutcome | null> => {
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
    },
    [],
  );

  return {
    phase,
    availability,
    facts,
    name: availability?.name ?? 'Milo',
    turns,
    liveSteps,
    working: live !== null,
    tokensIn: baseTokens.in + turns.reduce((total, turn) => total + turn.tokensIn, 0),
    tokensOut: baseTokens.out + turns.reduce((total, turn) => total + turn.tokensOut, 0),
    nextTurnTokens,
    problem,
    submit,
    answer,
    runAction,
  };
}
