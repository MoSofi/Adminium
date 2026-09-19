// SPDX-License-Identifier: AGPL-3.0-only
/**
 * One turn: the conversation between the model and this instance's own data,
 * from what the person typed to what the modal ends up showing.
 *
 * The loop, once per round, at most {@link ASSISTANT_MAX_ROUNDS} times:
 *
 *   ask the provider → read the reply against the turn contract
 *     · unreadable → send the errors back as a repair, up to twice; a third
 *       failure ends the turn
 *     · `calls`  → run the tools, append the results, go round again
 *     · `ask`    → stop and wait for the person
 *     · `result` → validate the draft with the HOST PAGE's own acceptor;
 *                  invalid, hand back the page's complaints (one repair) and
 *                  go round again; valid, compute the diff and stop
 *     · nothing  → a plain answer; stop
 *
 * WHY IT IS A PURE FUNCTION. Everything that touches the world arrives as an
 * argument: the provider client, the tool executor, the clock, the progress
 * sink. So a whole conversation can be scripted in a test with no network, no
 * job runtime and no meta store, and the job handler is left owning only what
 * it should — persistence and the channel.
 *
 * WHAT IT WILL NOT DO. There is no branch here that writes anything. The
 * terminal move is a validated draft; a person decides what happens to it.
 */

import {
  ASSISTANT_MAX_CALLS_PER_TURN,
  ASSISTANT_MAX_ROUNDS,
  ASSISTANT_STEP_ICON_FALLBACK,
  assistantArtefactErrorsMessage,
  assistantLineDiff,
  assistantMoveOf,
  assistantStepEventMessage,
  assistantToolResultsMessage,
  parseAssistantTurn,
  type AssistantAsk,
  type AssistantResult,
  type AssistantStepEvent,
  type AssistantToolResult,
  ProviderError,
  type AssistantDiffLine,
  type AssistantTurnV1,
  type LlmValidationError,
  type ProviderClient,
} from '@adminium/llm';

import { buildRepairMessage, DEFAULT_MAX_REPAIRS, type RunFailureError } from '../llm/direct-runner.js';
import type { AssistantContextAdapter, AssistantToolOutcome } from './types.js';

/** A message as it goes to the provider and as the transcript stores it. */
export interface TurnMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** One step row, as it is stored and as the modal draws it. */
export interface TurnStep {
  id: string;
  state: 'started' | 'done' | 'failed';
  icon: string;
  label: string;
  detail: string;
  tables: string[];
  /** Set only on the page-read step; the dashboard words it. */
  facts?: Record<string, string | number | boolean>;
}

/** What the runner is asked to do. */
export interface TurnRunInput {
  client: ProviderClient;
  model: string;
  provider: string;
  maxTokens: number;
  /** The prompt the context built, already filled. */
  system: string;
  /**
   * The page's own facts, as the first step reports them.
   *
   * The runner opens every turn by saying what it read before it asked
   * anything — the page, and what the page holds. That is not decoration: a
   * person watching a draft appear is owed the same first line the model got,
   * and it is the only step that is TRUE by construction rather than because
   * a model said so. Absent means no such step (a harness that has no page).
   */
  pageFacts?: Record<string, string | number | boolean> | undefined;
  /** Earlier turns' messages, then this turn's opening message. */
  messages: readonly TurnMessage[];
  context: AssistantContextAdapter;
  /** Runs one tool call. Answers a failure as data; never throws for the model's mistakes. */
  execute: (call: { id: string; tool: string; args: Record<string, unknown> }) => Promise<AssistantToolOutcome>;
  /** Resolve the lines a `basedOn` document projects to, for the diff. */
  baseLines?: ((basedOn: string) => Promise<string[] | null>) | undefined;
  /** Accept the drafted artefact with the host page's own validator. */
  accept: (artefact: Record<string, unknown>) => Promise<
    { ok: true; artefact: Record<string, unknown> } | { ok: false; errors: { path: string; code: string; message: string }[] }
  >;
  /**
   * Step events, as they happen — with the whole step list beside each one, so
   * a caller can both publish the event and persist the card a reload would
   * have to draw.
   */
  onStep?:
    | ((event: AssistantStepEvent, percent: number, steps: readonly TurnStep[]) => void | Promise<void>)
    | undefined;
  /** Cooperative cancellation, checked at every round boundary. */
  signal?: AbortSignal | undefined;
  /** Repairs per round; the same budget the enrichment path uses. */
  maxRepairs?: number | undefined;
  now?: (() => number) | undefined;
}

export type TurnOutcome =
  | {
      status: 'done';
      say: string;
      /** Present when the model produced a draft. */
      result: TurnResult | null;
      steps: TurnStep[];
      messages: TurnMessage[];
      sources: string[];
      tokensIn: number;
      tokensOut: number;
    }
  | {
      status: 'awaiting_picks';
      say: string;
      ask: AssistantAsk;
      steps: TurnStep[];
      messages: TurnMessage[];
      sources: string[];
      tokensIn: number;
      tokensOut: number;
    }
  | {
      status: 'failed';
      errors: RunFailureError[];
      steps: TurnStep[];
      messages: TurnMessage[];
      sources: string[];
      tokensIn: number;
      tokensOut: number;
    }
  | { status: 'cancelled'; steps: TurnStep[]; messages: TurnMessage[]; sources: string[]; tokensIn: number; tokensOut: number };

/** The drafted document and everything the result card shows beside it. */
export interface TurnResult {
  title: string;
  meta: string;
  workTitle: string | null;
  basedOn: string | null;
  artefact: Record<string, unknown>;
  warning: string | null;
  /** The page's own rows, as kinds the dashboard words. */
  details: { kind: string; args: Record<string, string | number> }[];
  /** What the model added, in its own words. */
  modelDetails: { label: string; value: string }[];
  checks: string[];
  followups: string[];
  /** `connection.table` names this turn read. */
  sources: string[];
  diff: {
    against: string | null;
    adds: number;
    dels: number;
    lines: AssistantDiffLine[];
    truncated: boolean;
  };
}

/** A cap the model went past is reported to it, not enforced by silence. */
const CALL_CAP_MESSAGE = `You have used the ${String(ASSISTANT_MAX_CALLS_PER_TURN)} tool calls this request allows. Answer with what you have, or ask the person a question.`;

const ROUND_CAP_ERROR: LlmValidationError = {
  code: 'LLM_SCHEMA_INVALID',
  severity: 'fatal',
  path: '',
  message: `The assistant took more than ${String(ASSISTANT_MAX_ROUNDS)} rounds without reaching an answer.`,
};

export async function runAssistantTurn(input: TurnRunInput): Promise<TurnOutcome> {
  const maxRepairs = input.maxRepairs ?? DEFAULT_MAX_REPAIRS;
  const messages: TurnMessage[] = input.messages.map((message) => ({ ...message }));

  const steps: TurnStep[] = [];
  const sources: string[] = [];
  const usage = { tokensIn: 0, tokensOut: 0 };
  let callsUsed = 0;
  let repairs = 0;

  // The page-read step, before the first provider call. It is published
  // `done`: the read already happened — `pageFacts` is what built the prompt
  // this turn is about to send, so there is no moment when it is pending.
  if (input.pageFacts !== undefined) {
    const read: TurnStep = {
      id: 'page',
      state: 'done',
      icon: 'file-search',
      // Empty on purpose: `facts` is what this step SAYS, and the sentence
      // that says it is the dashboard's — in the operator's own language.
      label: '',
      detail: '',
      tables: [],
      facts: input.pageFacts,
    };
    steps.push(read);
    await publish(input, read, 0, { kind: 'ready' }, steps);
  }

  const stopped = (): TurnOutcome => ({
    status: 'cancelled',
    steps,
    messages,
    sources,
    tokensIn: usage.tokensIn,
    tokensOut: usage.tokensOut,
  });

  const failed = (errors: RunFailureError[]): TurnOutcome => ({
    status: 'failed',
    errors,
    steps,
    messages,
    sources,
    tokensIn: usage.tokensIn,
    tokensOut: usage.tokensOut,
  });

  for (let round = 0; round < ASSISTANT_MAX_ROUNDS; round += 1) {
    if (input.signal?.aborted ?? false) return stopped();

    let reply: { text: string; usage?: { inputTokens: number; outputTokens: number } };
    try {
      reply = await input.client.complete({
        system: input.system,
        messages: messages.map((message) => ({ ...message })),
        model: input.model,
        maxTokens: input.maxTokens,
        // Zero, always. A provider that ignores the field samples at its own
        // default; one that honours it gives the same draft twice.
        temperature: 0,
      });
    } catch (error) {
      // A transport or config failure is not something a re-prompt can fix.
      return failed([providerFailure(error, input.provider)]);
    }
    usage.tokensIn += reply.usage?.inputTokens ?? 0;
    usage.tokensOut += reply.usage?.outputTokens ?? 0;

    const parsed = parseAssistantTurn(reply.text);
    if (!parsed.ok) {
      if (repairs >= maxRepairs) return failed([...parsed.errors]);
      repairs += 1;
      messages.push({ role: 'assistant', content: reply.text });
      messages.push({ role: 'user', content: buildRepairMessage(parsed.errors) });
      continue;
    }

    const turn: AssistantTurnV1 = parsed.turn;
    const move = assistantMoveOf(turn);

    if (move === 'ask') {
      messages.push({ role: 'assistant', content: reply.text });
      return {
        status: 'awaiting_picks',
        say: turn.say,
        ask: turn.ask as AssistantAsk,
        steps,
        messages,
        sources,
        tokensIn: usage.tokensIn,
        tokensOut: usage.tokensOut,
      };
    }

    if (move === 'calls') {
      const calls = turn.calls ?? [];
      messages.push({ role: 'assistant', content: reply.text });

      const remaining = ASSISTANT_MAX_CALLS_PER_TURN - callsUsed;
      if (remaining <= 0) {
        // The cap is told to the model rather than enforced by a silent empty
        // answer — a model that does not know why its calls stopped repeats
        // them until the rounds run out.
        messages.push({ role: 'user', content: CALL_CAP_MESSAGE });
        continue;
      }

      const results: AssistantToolResult[] = [];
      for (const call of calls.slice(0, remaining)) {
        if (input.signal?.aborted ?? false) return stopped();
        callsUsed += 1;
        const step: TurnStep = {
          id: call.id,
          state: 'started',
          icon: call.step.icon || ASSISTANT_STEP_ICON_FALLBACK,
          label: call.step.label,
          detail: call.step.detail,
          tables: [],
        };
        steps.push(step);
        await publish(input, step, round, null, steps);

        const outcome = await input.execute({ id: call.id, tool: call.tool, args: call.args });
        if (outcome.tables !== undefined) {
          for (const table of outcome.tables) {
            step.tables.push(table);
            if (!sources.includes(table)) sources.push(table);
          }
        }
        if (outcome.error !== undefined) {
          step.state = 'failed';
          await publish(input, step, round, { kind: 'warnings', count: 1 }, steps);
          results.push({ id: call.id, tool: call.tool, ok: false, error: outcome.error });
        } else {
          step.state = 'done';
          await publish(input, step, round, { kind: 'ready' }, steps);
          results.push({ id: call.id, tool: call.tool, ok: true, result: outcome.result });
        }
      }

      const dropped = calls.length - Math.min(calls.length, remaining);
      messages.push({ role: 'user', content: assistantToolResultsMessage(results) });
      if (dropped > 0) messages.push({ role: 'user', content: CALL_CAP_MESSAGE });
      continue;
    }

    if (move === 'result') {
      const result = turn.result as AssistantResult;
      const accepted = await input.accept(result.artefact);
      if (!accepted.ok) {
        // The page's own complaints, in the page's own words. It costs one
        // repair, the same as an unreadable reply, because it is the same
        // kind of mistake: the model produced something this instance cannot
        // use.
        if (repairs >= maxRepairs) {
          return failed(
            accepted.errors.map((error) => ({
              code: 'LLM_SCHEMA_INVALID' as const,
              severity: 'fatal' as const,
              path: error.path,
              message: error.message,
            })),
          );
        }
        repairs += 1;
        messages.push({ role: 'assistant', content: reply.text });
        messages.push({ role: 'user', content: assistantArtefactErrorsMessage(accepted.errors) });
        continue;
      }

      messages.push({ role: 'assistant', content: reply.text });
      const artefact = accepted.artefact;
      const basedOn = result.basedOn ?? null;
      const draftLines = input.context.projectForDiff(artefact);
      const baseLines = basedOn === null ? null : ((await input.baseLines?.(basedOn)) ?? null);
      // No base means a new document, and every line of it is an addition —
      // which is what the card says above the lines.
      const diff = assistantLineDiff(baseLines, draftLines);

      return {
        status: 'done',
        say: turn.say,
        result: {
          title: result.title,
          meta: result.meta,
          workTitle: result.workTitle ?? null,
          basedOn,
          artefact,
          warning: result.warning ?? null,
          // The page's own rows first, then whatever the model added. The
          // page's are KINDS the dashboard words; the model's are its own
          // label/value pairs and are shown as it wrote them.
          details: input.context.details(artefact),
          modelDetails: [...(result.details ?? [])],
          checks: [...(result.checks ?? [])],
          followups: [...(result.followups ?? [])],
          sources: [...sources],
          diff: {
            against: baseLines === null ? null : basedOn,
            adds: diff.adds,
            dels: diff.dels,
            lines: diff.lines,
            truncated: diff.truncated,
          },
        },
        steps,
        messages,
        sources,
        tokensIn: usage.tokensIn,
        tokensOut: usage.tokensOut,
      };
    }

    // A plain answer: no move, just words.
    messages.push({ role: 'assistant', content: reply.text });
    return {
      status: 'done',
      say: turn.say,
      result: null,
      steps,
      messages,
      sources,
      tokensIn: usage.tokensIn,
      tokensOut: usage.tokensOut,
    };
  }

  return failed([ROUND_CAP_ERROR]);
}

/** Publish one step row's state on the job channel. */
async function publish(
  input: TurnRunInput,
  step: TurnStep,
  round: number,
  note: AssistantStepEvent['note'],
  steps: readonly TurnStep[],
): Promise<void> {
  if (input.onStep === undefined) return;
  const percent = Math.min(100, Math.round(((round + 1) * 100) / ASSISTANT_MAX_ROUNDS));
  await input.onStep(
    {
      kind: 'step',
      id: step.id,
      state: step.state,
      icon: step.icon as AssistantStepEvent['icon'],
      label: step.label,
      detail: step.detail,
      tables: [...step.tables],
      ...(step.facts === undefined ? {} : { facts: step.facts }),
      note,
    },
    percent,
    steps,
  );
}

/** A provider transport failure, with the key already scrubbed by the client. */
function providerFailure(error: unknown, provider: string): RunFailureError {
  if (error instanceof ProviderError) {
    return { kind: 'provider', provider: error.provider, code: error.code, message: error.message };
  }
  return {
    kind: 'provider',
    provider,
    code: 'unknown',
    message: error instanceof Error ? error.message : String(error),
  };
}

/** Serialize a step event for a job progress message. */
export { assistantStepEventMessage };
