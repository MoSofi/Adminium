// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The Designer's start prompt: the operator's first request, built for the
 * instance's owner once, right after the first-run account step.
 *
 * Its text is `ADMINIUM_DESIGNER_START_PROMPT_B64` (base64) or a read-only
 * mounted file (`ADMINIUM_DESIGNER_START_PROMPT_FILE`), both decoded and
 * checked when the environment is read (`config/env.ts`): never a raw value
 * built from a visitor's words. It goes to the model as the FIRST USER TURN of
 * a new session, never into the system prompt, so it can ask for no more than
 * the person typing it could.
 *
 * The run is a dashboard build, and nobody is watching it start: every card
 * it shows (a question, a package, a font) is answered no. A meta tally
 * (`adminium_operator_tallies`) is taken before the turn starts, so it runs
 * once for the instance's life: not again after a restart, not twice for two
 * tabs. A run that could not start gives the tally back.
 *
 * A run the operator's gateway refused at its cap (a 429 before the first step,
 * `ADMINIUM_AI_BUILD_API_KEY`'s daily cap) has spent nothing: the tally is given
 * back, and the run waits ({@link createStartPromptRetry}). The session is told
 * when it starts again, and it starts again in the same session at that time;
 * a server restarted meanwhile starts it at its next boot, in a new session.
 * While it waits, `POST /designer/start-prompt` answers 409
 * `START_PROMPT_WAITING` with the time, and `/system/info` says it.
 */
import { operatorTalliesRepo, type MetaDb } from '@adminium/meta';

import { ConflictError, NotFoundError } from '../errors.js';
import type { AiConnections } from '../llm/connections.js';
import type { Designer } from './service.js';
import type { Actor } from './tool-types.js';

/** The tally that says the start prompt has run. */
export const START_PROMPT_TALLY = 'designer-start-prompt';
/** The tally that holds when a run refused at the operator's cap starts again (ms since the epoch); none when nothing waits. */
export const START_PROMPT_WAIT_TALLY = 'designer-start-prompt-wait';
/** How long a run refused at the operator's cap waits before it is asked again. */
export const START_PROMPT_RETRY_MS = 15 * 60_000;
/** Who the start prompt's run acts as when nobody started it from a page: a run resumed at boot. */
export const START_PROMPT_ACTOR: Actor = { id: null, label: 'Adminium Designer' };

export interface StartPromptDeps {
  meta: MetaDb;
  designer: Designer;
  connections: AiConnections;
  /** The prompt as the environment gave it, decoded; null when none was given. */
  prompt: string | null;
  /** Told of each run started, so one refused at the operator's cap can be started again as its starter. */
  retry?: Pick<StartPromptRetry, 'started'> | undefined;
}

/** What the session is called: the prompt's first words. */
const titleOf = (prompt: string): string => {
  const words = prompt.replace(/\s+/g, ' ').trim().split(' ').slice(0, 6).join(' ');
  return words.length > 60 ? `${words.slice(0, 59)}…` : words;
};

/** Whether this instance has a start prompt that has not run yet (and is not waiting for the operator's cap). */
export async function startPromptWaiting(deps: Pick<StartPromptDeps, 'meta' | 'prompt'>): Promise<boolean> {
  if (deps.prompt === null) return false;
  const tallies = operatorTalliesRepo(deps.meta);
  if ((await tallies.get(START_PROMPT_TALLY)) !== null) return false;
  return (await tallies.get(START_PROMPT_WAIT_TALLY)) === null;
}

/** When a run refused at the operator's cap starts again (ms), or null when none waits. */
export async function startPromptWaitsUntil(deps: Pick<StartPromptDeps, 'meta' | 'prompt'>): Promise<number | null> {
  if (deps.prompt === null) return null;
  return (await operatorTalliesRepo(deps.meta).get(START_PROMPT_WAIT_TALLY))?.amount ?? null;
}

/**
 * Start the start prompt's run: a new dashboard session on the instance's model, with the prompt as its first message.
 * 404 without a prompt, 409 once it has run or with no model to run it on.
 */
export async function runStartPrompt(deps: StartPromptDeps, by: Actor): Promise<{ sessionId: string; turn: number }> {
  if (deps.prompt === null) throw new NotFoundError('This server has no start prompt.', { reason: 'NO_START_PROMPT' });
  const prompt = deps.prompt;
  const chosen = await deps.connections.default();
  if (chosen === null || deps.connections.refusal(chosen.connection) !== null || chosen.model === null || chosen.model === '') {
    throw new ConflictError('There is no model to run the start prompt on.', 'CONFLICT', { reason: 'NO_MODEL' });
  }
  const tallies = operatorTalliesRepo(deps.meta);
  const waits = await tallies.get(START_PROMPT_WAIT_TALLY);
  if (waits !== null) {
    throw new ConflictError('The start prompt waits for the AI included with this server: it starts again by itself.', 'CONFLICT', { reason: 'START_PROMPT_WAITING', until: waits.amount });
  }
  if (!(await tallies.claim(START_PROMPT_TALLY))) throw new ConflictError('The start prompt has already run.', 'CONFLICT', { reason: 'START_PROMPT_RAN' });
  const { runner } = deps.designer;
  // The folder is kept for the turn before the session is made, as a new session with its first message does.
  const claim = runner.claim();
  try {
    const session = await deps.designer.createSession({ title: titleOf(prompt), target: 'dashboard', connectionId: chosen.connection.id, model: chosen.model }, by);
    const started = await runner.start(session.id, { text: prompt, by, claim, defaultNo: true });
    deps.retry?.started(session.id, by);
    return { sessionId: session.id, turn: started.turn };
  } catch (error) {
    // It did not start: the next try may.
    await tallies.release(START_PROMPT_TALLY);
    throw error;
  } finally {
    claim.release();
  }
}

/** How a start-prompt turn ended, as the runner records it (`designer.turn.finished`). */
export interface StartPromptTurnEnd {
  sessionId: string;
  startPrompt?: boolean;
  outcome: string;
  failure?: string | null;
  steps: number;
}

export interface StartPromptRetry {
  /** A run was started in this session, by this person. */
  started(sessionId: string, by: Actor): void;
  /** A turn ended: a start-prompt run refused at the operator's cap before its first step waits, and runs again. */
  turnFinished(end: StartPromptTurnEnd): Promise<void>;
  /** At boot: a run that waited when the server stopped starts again at its time, in a new session. */
  resume(): Promise<void>;
  /** Stop the timer (server close). */
  stop(): void;
}

/** The rate-limit code a provider's 429 carries (`@adminium/llm`). */
const AT_THE_CAP = 'rate_limit';

/**
 * The start prompt's run, held while the operator's gateway refuses it at its cap. One process serves an instance:
 * the timer is this process's, and what waits is in the meta store's tallies, so a restart picks it up ({@link resume}).
 */
export function createStartPromptRetry(
  deps: StartPromptDeps & {
    now?: () => number;
    retryMs?: number;
    log?: (message: string, error?: unknown) => void;
  },
): StartPromptRetry {
  const now = deps.now ?? Date.now;
  const retryMs = deps.retryMs ?? START_PROMPT_RETRY_MS;
  const tallies = operatorTalliesRepo(deps.meta);
  const starters = new Map<string, Actor>();
  let timer: NodeJS.Timeout | null = null;
  let stopped = false;

  const schedule = (at: number, run: () => Promise<void>): void => {
    if (stopped) return;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(
      () => {
        timer = null;
        void run().catch((error: unknown) => deps.log?.('the start prompt could not start again', error));
      },
      Math.max(0, at - now()),
    );
    timer.unref();
  };

  /** Run again in the same session: the person watching it sees the turn start. */
  const again = (sessionId: string, by: Actor) => async (): Promise<void> => {
    if (deps.prompt === null) return;
    await tallies.release(START_PROMPT_WAIT_TALLY);
    if (!(await tallies.claim(START_PROMPT_TALLY))) return;
    try {
      await deps.designer.runner.start(sessionId, { text: deps.prompt, by, defaultNo: true });
      starters.set(sessionId, by);
    } catch (error) {
      await tallies.release(START_PROMPT_TALLY);
      throw error;
    }
  };

  return {
    started(sessionId, by) {
      starters.set(sessionId, by);
    },
    async turnFinished(end) {
      if (end.startPrompt !== true || deps.prompt === null) return;
      if (end.outcome !== 'failed' || end.failure !== AT_THE_CAP || end.steps > 0) {
        starters.delete(end.sessionId);
        return;
      }
      // Refused at the cap before any step: nothing was built, nothing spent. The tally goes back, and the run waits.
      const until = now() + retryMs;
      await tallies.release(START_PROMPT_TALLY);
      await tallies.raise(START_PROMPT_WAIT_TALLY, until);
      try {
        const session = deps.designer.store.read(end.sessionId);
        deps.designer.runner.events(end.sessionId).emit(
          session.turns,
          { kind: 'error', code: 'start-prompt-waiting', message: `The AI included with this server is busy for now. This build starts again by itself at ${new Date(until).toISOString()}.` },
          { by: 'person' },
        );
      } catch (error) {
        deps.log?.('the start prompt’s session could not be told when it starts again', error);
      }
      schedule(until, again(end.sessionId, starters.get(end.sessionId) ?? START_PROMPT_ACTOR));
    },
    async resume() {
      if (deps.prompt === null) return;
      const waits = await tallies.get(START_PROMPT_WAIT_TALLY);
      if (waits === null) return;
      schedule(waits.amount, async () => {
        await tallies.release(START_PROMPT_WAIT_TALLY);
        const started = await runStartPrompt({ ...deps, retry: this }, START_PROMPT_ACTOR);
        starters.set(started.sessionId, START_PROMPT_ACTOR);
      });
    },
    stop() {
      stopped = true;
      if (timer !== null) clearTimeout(timer);
      timer = null;
    },
  };
}
