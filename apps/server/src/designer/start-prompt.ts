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
 */
import { operatorTalliesRepo, type MetaDb } from '@adminium/meta';

import { ConflictError, NotFoundError } from '../errors.js';
import type { AiConnections } from '../llm/connections.js';
import type { Designer } from './service.js';
import type { Actor } from './tool-types.js';

/** The tally that says the start prompt has run. */
export const START_PROMPT_TALLY = 'designer-start-prompt';

export interface StartPromptDeps {
  meta: MetaDb;
  designer: Designer;
  connections: AiConnections;
  /** The prompt as the environment gave it, decoded; null when none was given. */
  prompt: string | null;
}

/** What the session is called: the prompt's first words. */
const titleOf = (prompt: string): string => {
  const words = prompt.replace(/\s+/g, ' ').trim().split(' ').slice(0, 6).join(' ');
  return words.length > 60 ? `${words.slice(0, 59)}…` : words;
};

/** Whether this instance has a start prompt that has not run yet. */
export async function startPromptWaiting(deps: Pick<StartPromptDeps, 'meta' | 'prompt'>): Promise<boolean> {
  if (deps.prompt === null) return false;
  return (await operatorTalliesRepo(deps.meta).get(START_PROMPT_TALLY)) === null;
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
  if (!(await tallies.claim(START_PROMPT_TALLY))) throw new ConflictError('The start prompt has already run.', 'CONFLICT', { reason: 'START_PROMPT_RAN' });
  const { runner } = deps.designer;
  // The folder is kept for the turn before the session is made, as a new session with its first message does.
  const claim = runner.claim();
  try {
    const session = await deps.designer.createSession({ title: titleOf(prompt), target: 'dashboard', connectionId: chosen.connection.id, model: chosen.model }, by);
    const started = await runner.start(session.id, { text: prompt, by, claim, defaultNo: true });
    return { sessionId: session.id, turn: started.turn };
  } catch (error) {
    // It did not start: the next try may.
    await tallies.release(START_PROMPT_TALLY);
    throw error;
  } finally {
    claim.release();
  }
}
