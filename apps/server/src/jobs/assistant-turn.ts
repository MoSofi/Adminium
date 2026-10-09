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
import { ASSISTANT_INPUT_TOKEN_LIMIT, assistantStepEventMessage } from '@adminium/llm';
import { z } from 'zod';

import { runAssistantTurn } from '../assistant/turn-runner.js';
import { fitsContextWindow, setUpTurn } from '../assistant/turn-setup.js';
import { readAllowance, roundTokens, spend } from '../assistant/allowance.js';
import { listedAddOns } from '../assistant/tools/add-ons.js';
import type { AssistantAddOn } from '../assistant/types.js';
import { composeHistory, loadTurn, ownTranscript } from '../assistant/sessions.js';
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
  /** The add-ons this server has and could have, for the tool that lists them and for checking a suggestion. */
  addOns?: (() => Promise<AssistantAddOn[]>) | undefined;
  /** The output budget one provider reply may use. */
  maxTokens?: number | undefined;
  now?: (() => number) | undefined;
}

/** The output budget a turn asks for. A drafted document is a few thousand tokens. */
export const ASSISTANT_MAX_OUTPUT_TOKENS = 8000;

/** The English of a turn stopped by the day's allowance, for a reader with no words of its own for it. */
export const BUDGET_MESSAGE = 'Today\'s allowance for the assistant is used up.';

/** The English of a `model-format` failure, for a reader that has no words of its own for it. */
export const MODEL_FORMAT_MESSAGE = 'This model does not answer in the way the assistant needs. Choose another model.';

/** What a turn is told it ended as when the process running it went away. */
export const INTERRUPTED_ERROR = {
  kind: 'interrupted',
  message: 'The server restarted while this was running — ask again.',
} as const;

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
  const { session, turn } = loaded;

  // The claim: a turn runs once. A second worker that raced this one finds the
  // row already `running` and leaves it alone.
  if (!(await repo.setTurnStatus(turn.id, 'running', { expected: 'queued', jobId: ctx.jobId }))) {
    // Unless nobody has it. This job, claimed again, with its own turn still
    // `running`: a live run keeps its lock fresh, so the run that started this
    // turn died with its process. It is ended here rather than run again — the
    // provider was already paid once, and the person who asked stopped waiting
    // a stale-lock window ago. Without this the row said `running` for ever.
    if (ctx.attempt > 1 && turn.status === 'running' && turn.jobId === ctx.jobId) {
      // Guarded, so a run that did finish in the meantime keeps what it wrote.
      if (await repo.setTurnStatus(turn.id, 'failed', { expected: 'running' })) {
        await repo.finishTurn(turn.id, { status: 'failed', error: { ...INTERRUPTED_ERROR }, finishedAt: now() });
        ctx.log('assistant.turn: the run that held this turn is gone; turn failed', { turnId: turn.id });
        return;
      }
    }
    ctx.log('assistant.turn: turn is not queued; another worker has it', { turnId: turn.id });
    return;
  }

  const startedAt = now();
  // One question of the day, counted when its run begins.
  await spend(deps.meta, payload.userId ?? session.createdBy ?? null, { turns: 1 }, startedAt);
  const userId = payload.userId ?? session.createdBy;
  const finish = async (patch: Parameters<typeof repo.finishTurn>[1]): Promise<void> => {
    // Only while this run still holds the turn: one the person stopped meanwhile stays stopped.
    await repo.finishTurn(turn.id, { ...patch, durationMs: now() - startedAt, finishedAt: now(), expected: 'running' });
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

  // Reading the page can fail for reasons that are nobody's bug (a page deleted since, a
  // connection gone). Thrown, the job would be tried again and the person told half a minute
  // later that the server restarted; it is said at once, as what it is.
  let setup: Awaited<ReturnType<typeof setUpTurn>>;
  try {
    setup = await setUpTurn({
      meta: deps.meta,
      manager: deps.manager,
      // The page the question was asked on; a turn that names none was asked on the session's.
      context: turn.context ?? session.context,
      host: turn.host ?? session.host,
      userId: userId ?? null,
      can: (permission) => deps.can(userId ?? null, permission),
      ...(deps.addOns === undefined ? {} : { addOns: deps.addOns }),
    });
  } catch (error) {
    await finish({
      status: 'failed',
      error: { kind: 'setup', message: error instanceof Error ? error.message : String(error) },
    });
    return;
  }

  // What this turn is sent of the conversation before it: the turn just before it whole, older
  // ones in outline, and the oldest left out (and said so) when the model's window is that small.
  const composed = composeHistory({
    session,
    open: loaded.open,
    pieces: loaded.pieces,
    opening: loaded.opening,
    system: setup.system,
    limit: ASSISTANT_INPUT_TOKEN_LIMIT[resolved.provider],
  });
  const messages = composed.messages;

  // Refused rather than truncated: a provider that silently drops the oldest
  // messages answers confidently from half a conversation. Reached only when this ONE
  // question, with the page it is asked on, is larger than the model's window.
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

  const document = setup.adapter.document;
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
    document: document,
    propose: setup.proposable,
    execute: setup.execute,
    // Never reached on a page that drafts nothing: a `result` does not parse there.
    accept: (artefact) =>
      document === undefined
        ? Promise.resolve({ ok: false as const, errors: [{ path: 'result', code: 'NO_DOCUMENT', message: 'This page has no document.' }] })
        : document.acceptArtefact(artefact, setup.deps),
    baseLines: (basedOn) => (document === undefined ? Promise.resolve(null) : document.baseForDiff(basedOn, setup.deps)),
    onStep: async (event, _percent, steps) => {
      // The step envelope IS the message: the dashboard parses it and draws
      // the row. `pct` is advisory — a turn does not know how many rounds it
      // will take until it has taken them.
      ctx.progress(percentOf(event.state), { step: event.id, message: assistantStepEventMessage(event) });
      // And the card is persisted as it grows, so a reload mid-turn shows
      // what the other screens are already showing rather than nothing.
      await repo.recordSteps(turn.id, steps);
    },
    // The day's allowance, held as it is spent: each round is counted when it returns, and the
    // next is not asked for once the day's number is reached.
    mayContinue: async () => (await readAllowance(deps.meta, userId ?? null, now())).left,
    onRound: async (round) => {
      await spend(deps.meta, userId ?? null, { tokens: roundTokens(round) }, now());
    },
    signal: ctx.signal,
    now,
  });

  // Tokens count whatever the turn ended as: a failed round-trip was still
  // paid for, and a session's total that hid it would be a lie.
  if (outcome.tokensIn > 0 || outcome.tokensOut > 0) {
    await repo.addUsage(session.id, { tokensIn: outcome.tokensIn, tokensOut: outcome.tokensOut }, now());
  }

  // What the turn ended with besides its words and its draft. Built here, from what the tools
  // did: the tables that were really read, each row read's "this many of that many", and
  // whether the turn used the last of the day's allowance.
  const after = await readAllowance(deps.meta, userId ?? null, now());
  const answer: Record<string, unknown> = {
    sources: [...outcome.sources],
    reads: outcome.reads.map((read) => ({ ...read })),
    // A read that came back short of what there is: the answer is about a part of the rows.
    truncated: outcome.reads.some((read) => typeof read.total === 'number' && typeof read.returned === 'number' && read.returned < read.total),
    ...(after.left ? {} : { budget: { limit: after.limit, used: after.used, resetsAt: after.resetsAt } }),
    // Earlier turns that were not sent at all: the person is told what is no longer in mind.
    ...(composed.forgot + loaded.unread > 0 ? { forgot: composed.forgot + loaded.unread } : {}),
  };
  // Add-ons the reply pointed at: kept only when this server's own list has them and they are
  // not installed. The card is drawn from that list when the turn is read; nothing of the
  // model's wording about an add-on is stored as fact.
  if ('followups' in outcome && outcome.followups.length > 0) answer.followups = outcome.followups;
  const suggested = 'suggest' in outcome ? outcome.suggest : [];
  if (suggested.length > 0) {
    const known = await listedAddOns(deps.addOns);
    const keep = suggested.filter((key, index) => suggested.indexOf(key) === index && (known ?? []).some((item) => item.key === key && item.state !== 'installed'));
    if (keep.length > 0) answer.suggest = keep.map((key) => ({ key }));
  }

  // What the reply asked the person to confirm. Stored as the model wrote it and marked
  // unchecked: this job has no session of the person's to check it with, so nothing of it is
  // shown until the panel's own request has run the checks as them.
  if (outcome.status === 'done' && outcome.proposal !== null) {
    answer.proposal = { state: 'unchecked', title: outcome.proposal.title, actions: outcome.proposal.actions, madeAt: now() };
  }

  const common = {
    // The turn's own messages: the conversation before it is in the rows before it.
    transcript: ownTranscript(outcome.messages, messages.length - 1),
    steps: outcome.steps,
    tokensIn: outcome.tokensIn,
    tokensOut: outcome.tokensOut,
  };

  if (outcome.status === 'awaiting_picks') {
    await finish({ ...common, answer, status: 'awaiting_picks', say: outcome.say, ask: outcome.ask as unknown as Record<string, unknown> });
    return;
  }
  if (outcome.status === 'failed' && outcome.reason === 'budget') {
    const allowance = await readAllowance(deps.meta, userId ?? null, now());
    await finish({
      ...common,
      status: 'failed',
      // A KIND with the numbers: the dashboard says when it starts again, in the person's own time.
      error: { kind: 'budget', limit: allowance.limit, used: allowance.used, resetsAt: allowance.resetsAt, message: BUDGET_MESSAGE },
    });
    return;
  }
  if (outcome.status === 'failed') {
    await finish({
      ...common,
      status: 'failed',
      error:
        outcome.reason === 'model-format'
          ? // The model cannot follow the reply format: say which one, so the person can be told to choose another.
            { kind: 'model-format', provider: resolved.provider, model: resolved.model, message: MODEL_FORMAT_MESSAGE }
          : errorPayload(outcome.errors),
    });
    return;
  }
  if (outcome.status === 'cancelled') {
    await finish({ ...common, status: 'cancelled' });
    return;
  }
  await finish({
    ...common,
    answer,
    status: 'done',
    say: outcome.say,
    result: outcome.result === null ? null : (outcome.result as unknown as Record<string, unknown>),
  });
}

/** Advisory: a step that started is halfway to a step that finished. */
function percentOf(state: 'started' | 'done' | 'failed'): number {
  return state === 'started' ? 40 : 80;
}
