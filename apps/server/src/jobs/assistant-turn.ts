// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `assistant.turn` — one exchange with the model, as a job.
 *
 * WHY A JOB. A turn makes several provider round-trips and reads a database
 * between them; that outlives an HTTP request comfortably. As a job it gets
 * the things this instance already has for long work: a queue, cancellation, a
 * realtime channel the modal is already able to follow, and a row that
 * survives the browser being closed.
 *
 * WHICH RESOLVER. The GUARDED one — `resolveProviderClient` re-checks the
 * stored base URL against the outbound guard at the moment it dials, so a
 * metadata address planted in settings (by an imported bundle, by a direct
 * write) is refused here rather than fetched. The enrichment job's own
 * resolver does not do that check, and copying it would copy the hole.
 *
 * WHO IT RUNS AS. The person who asked. Their permission set is resolved the
 * way the realtime hub resolves one outside a request, and every table read
 * inside the turn is checked against it. A payload with no user reads nothing
 * — which is the honest answer, not a degradation.
 */

import { assistantSessionsRepo, type MetaDb } from '@adminium/meta';
import { assistantStepEventMessage } from '@adminium/llm';
import { z } from 'zod';

import { runAssistantTurn } from '../assistant/turn-runner.js';
import { fitsContextWindow, setUpTurn } from '../assistant/turn-setup.js';
import { loadTurn } from '../assistant/sessions.js';
import type { ConnectionManager } from '../connections/manager.js';
import { isProviderRunError, type RunFailureError } from '../llm/direct-runner.js';
import type { ResolvedProviderClient } from '../routes/llm/config-service.js';
import type { JobHandlerContext, JobRegistry } from './registry.js';

export const ASSISTANT_TURN_KIND = 'assistant.turn';

/** Payload: the turn to run. `userId` follows the jobs owner convention. */
export const assistantTurnPayloadSchema = z.object({
  turnId: z.string().min(1),
  userId: z.string().optional(),
});
export type AssistantTurnPayload = z.infer<typeof assistantTurnPayloadSchema>;

export interface AssistantTurnDeps {
  meta: MetaDb;
  manager: ConnectionManager;
  /** The GUARDED resolver — see this file's header. */
  resolveClient: () => Promise<ResolvedProviderClient>;
  /** A system permission, for one user, outside a request. */
  can: (userId: string | null, permission: string) => Promise<boolean>;
  /** The output budget one provider reply may use. */
  maxTokens?: number | undefined;
  now?: (() => number) | undefined;
}

/** The output budget a turn asks for. A drafted document is a few thousand tokens. */
export const ASSISTANT_MAX_OUTPUT_TOKENS = 8000;

export function registerAssistantTurnHandler(registry: JobRegistry, deps: AssistantTurnDeps): void {
  registry.registerJobHandler(
    ASSISTANT_TURN_KIND,
    assistantTurnPayloadSchema,
    async (payload, ctx) => {
      await executeAssistantTurn(payload, ctx, deps);
      return { turnId: payload.turnId };
    },
    { internal: true },
  );
}

/** A failure, as the turn row stores it: always a list, always readable back. */
function errorPayload(errors: readonly RunFailureError[]): Record<string, unknown> {
  const provider = errors.find(isProviderRunError);
  if (provider !== undefined) {
    return { kind: 'provider', provider: provider.provider, code: provider.code, message: provider.message };
  }
  return {
    kind: 'validation',
    errors: errors.map((error) => ({ ...error })),
  };
}

export async function executeAssistantTurn(
  payload: AssistantTurnPayload,
  ctx: JobHandlerContext,
  deps: AssistantTurnDeps,
): Promise<void> {
  const now = deps.now ?? Date.now;
  const repo = assistantSessionsRepo(deps.meta);
  const loaded = await loadTurn(deps.meta, payload.turnId);
  if (loaded === null) throw new Error(`assistant.turn: turn not found: ${payload.turnId}`);
  const { session, turn, messages } = loaded;

  // The claim: a turn runs once. A second worker that raced this one finds the
  // row already `running` and leaves it alone.
  if (!(await repo.setTurnStatus(turn.id, 'running', { expected: 'queued', jobId: ctx.jobId }))) {
    ctx.log('assistant.turn: turn is not queued; another worker has it', { turnId: turn.id });
    return;
  }

  const startedAt = now();
  const userId = payload.userId ?? session.createdBy;
  const finish = async (patch: Parameters<typeof repo.finishTurn>[1]): Promise<void> => {
    await repo.finishTurn(turn.id, { ...patch, durationMs: now() - startedAt, finishedAt: now() });
  };

  let resolved: ResolvedProviderClient;
  try {
    resolved = await deps.resolveClient();
  } catch (error) {
    await finish({
      status: 'failed',
      error: {
        kind: 'provider',
        code: 'config',
        message: error instanceof Error ? error.message : String(error),
      },
    });
    return;
  }

  const setup = await setUpTurn({
    meta: deps.meta,
    manager: deps.manager,
    context: session.context,
    host: session.host,
    userId: userId ?? null,
    can: (permission) => deps.can(userId ?? null, permission),
  });

  // Refused rather than truncated: a provider that silently drops the oldest
  // messages answers confidently from half a conversation.
  const fit = fitsContextWindow(resolved.provider, setup.system, messages);
  if (!fit.fits) {
    await finish({
      status: 'failed',
      error: {
        kind: 'too-long',
        estimate: fit.estimate,
        limit: fit.limit,
        message: 'This conversation is too long for the model — start a new session.',
      },
    });
    return;
  }

  const outcome = await runAssistantTurn({
    client: resolved.client,
    model: resolved.model,
    provider: resolved.provider,
    maxTokens: deps.maxTokens ?? ASSISTANT_MAX_OUTPUT_TOKENS,
    system: setup.system,
    // What the page held when the prompt was built — reported as the turn's
    // first step, before anything is asked.
    pageFacts: setup.facts as Record<string, string | number | boolean>,
    messages,
    context: setup.adapter,
    execute: setup.execute,
    accept: (artefact) => setup.adapter.acceptArtefact(artefact, setup.deps),
    baseLines: (basedOn) => setup.adapter.baseForDiff(basedOn, setup.deps),
    onStep: async (event, _percent, steps) => {
      // The step envelope IS the message: the dashboard parses it and draws
      // the row. `pct` is advisory — a turn does not know how many rounds it
      // will take until it has taken them.
      ctx.progress(percentOf(event.state), { step: event.id, message: assistantStepEventMessage(event) });
      // And the card is persisted as it grows, so a reload mid-turn shows
      // what the other screens are already showing rather than nothing.
      await repo.recordSteps(turn.id, steps);
    },
    signal: ctx.signal,
    now,
  });

  // Tokens count whatever the turn ended as: a failed round-trip was still
  // paid for, and a session's total that hid it would be a lie.
  if (outcome.tokensIn > 0 || outcome.tokensOut > 0) {
    await repo.addUsage(session.id, { tokensIn: outcome.tokensIn, tokensOut: outcome.tokensOut }, now());
  }

  const common = {
    transcript: outcome.messages,
    steps: outcome.steps,
    tokensIn: outcome.tokensIn,
    tokensOut: outcome.tokensOut,
  };

  if (outcome.status === 'awaiting_picks') {
    await finish({ ...common, status: 'awaiting_picks', say: outcome.say, ask: outcome.ask as unknown as Record<string, unknown> });
    return;
  }
  if (outcome.status === 'failed') {
    await finish({ ...common, status: 'failed', error: errorPayload(outcome.errors) });
    return;
  }
  if (outcome.status === 'cancelled') {
    await finish({ ...common, status: 'cancelled' });
    return;
  }
  await finish({
    ...common,
    status: 'done',
    say: outcome.say,
    result: outcome.result === null ? null : (outcome.result as unknown as Record<string, unknown>),
  });
}

/** Advisory: a step that started is halfway to a step that finished. */
function percentOf(state: 'started' | 'done' | 'failed'): number {
  return state === 'started' ? 40 : 80;
}
