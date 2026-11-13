// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The operator's own AI connection, and the hard limit on it.
 *
 * Three variables, each the operator's word in any profile:
 *
 *   ADMINIUM_AI_OPERATOR_ONLY=on       a connection saved in Settings → AI is refused unless it is
 *                                       the person's own key to a fixed public provider; every AI
 *                                       feature otherwise runs on the environment's connection
 *   ADMINIUM_AI_OPERATOR_SCOPE=dashboard  a Designer turn on the operator's connection builds dashboards
 *                                       only (`designer/operator-scope.ts`)
 *   ADMINIUM_AI_OPERATOR_BUDGET_TOKENS the tokens the operator's connection may spend over the
 *                                       instance's life, every feature together
 *
 * The count is kept HERE, at the one place every model call passes: the
 * client, runner and picture maker `llm/connections.ts` hands out for a
 * connection the operator set. The Designer, the page assistant, voice and
 * picture making all get theirs from there, so none is left out by a caller
 * that forgot. It is kept in the meta store's operator tallies
 * (`adminium_operator_tallies`), which no settings route, config import,
 * export or archive reads or writes: a super admin cannot set it back.
 *
 * Each call RESERVES what it may spend before it is made (its input, as
 * estimated, and the most it may answer), out of what is left after the calls
 * still running reserved theirs; past the budget a call is refused before it
 * is made, with {@link OperatorAiUsedUpError} (a picture, with a
 * `PictureError` that says the same). When the call ends, what it spent is
 * counted and its reservation let go. A call that fails or is stopped is
 * counted too: the provider was sent its input, and a stopped reply was billed
 * for what it streamed (a tool call that had begun, for all it reserved). So
 * calls at once never pass the line together, and the most this can overspend
 * is what one call's provider counts beyond the estimate. The operator's
 * gateway keeps its own budget too.
 */
import {
  estimateTokens,
  PictureError,
  ProviderError,
  type PictureMaker,
  type ProviderClient,
  type ProviderId,
  type ProviderRunner,
} from '@adminium/llm';
import { operatorTalliesRepo, type MetaDb } from '@adminium/meta';

import type { Env } from '../config/env.js';

/** The tally the operator's AI spend is counted in. */
export const AI_TOKENS_TALLY = 'ai-tokens';

/** What a made picture is counted as: an image model's square picture at medium quality is about this many tokens. */
export const PICTURE_TOKENS = 4_200;
/** What a second of speech turned into text is counted as, beside the words it gave. */
export const SPEECH_TOKENS_PER_SECOND = 10;
/** What a one-token check of a connection is counted as. */
export const PING_TOKENS = 16;

/** The fixed words, the same for every feature: the dashboard words them in the person's language from `reason`. */
export const USED_UP_MESSAGE = 'The AI included with this trial is used up. Add your own AI key to continue, or Upgrade.';

export interface OperatorAiRules {
  only: boolean;
  scope: 'dashboard' | null;
  /** Tokens over the instance's life; null with no budget. */
  budget: number | null;
}

export function operatorAiRules(env: Pick<Env, 'ADMINIUM_AI_OPERATOR_ONLY' | 'ADMINIUM_AI_OPERATOR_SCOPE' | 'ADMINIUM_AI_OPERATOR_BUDGET_TOKENS'>): OperatorAiRules {
  return { only: env.ADMINIUM_AI_OPERATOR_ONLY, scope: env.ADMINIUM_AI_OPERATOR_SCOPE ?? null, budget: env.ADMINIUM_AI_OPERATOR_BUDGET_TOKENS ?? null };
}

/** Whether this instance counts its operator's AI at all: any of the three variables set. */
export const countsOperatorAi = (rules: OperatorAiRules): boolean => rules.only || rules.scope !== null || rules.budget !== null;

/** A call on the operator's connection past its budget: refused before it is made. */
export class OperatorAiUsedUpError extends ProviderError {
  readonly operatorAi = 'used-up' as const;
  constructor(provider: ProviderId) {
    super({ provider, code: 'config', message: USED_UP_MESSAGE });
  }
}

/** Whether an error is the operator's budget refusing a call, whichever kind of call it was. */
export function isOperatorAiUsedUp(error: unknown): boolean {
  return error instanceof OperatorAiUsedUpError || (error instanceof PictureError && error.message === USED_UP_MESSAGE);
}

export interface OperatorAiMeter {
  readonly rules: OperatorAiRules;
  /** Whether calls on the operator's connection are counted here. */
  readonly counting: boolean;
  /** Tokens spent so far; null where nothing is counted. */
  used(): Promise<number | null>;
  /** Tokens left; null with no budget. Never below 0. */
  left(): Promise<number | null>;
  /** The same client, every call checked against the budget first and counted after. */
  client(client: ProviderClient): ProviderClient;
  runner(runner: ProviderRunner): ProviderRunner;
  maker(maker: PictureMaker): PictureMaker;
  /** Count by hand: what a caller spent another way. */
  charge(tokens: number): Promise<void>;
  /** Make the tally's row, so it reads 0 rather than "not counted" from the boot on. */
  open(): Promise<void>;
}

/** A failed call's codes that say no model ran: nothing was billed. */
const NOT_RUN: ReadonlySet<string> = new Set(['config', 'network', 'auth', 'rate_limit', 'not_found', 'http']);

const whole = (value: number): number => (Number.isFinite(value) && value > 0 ? Math.ceil(value) : 0);

export function createOperatorAiMeter(meta: MetaDb | null, rules: OperatorAiRules, opts: { now?: () => number } = {}): OperatorAiMeter {
  const now = opts.now ?? Date.now;
  const counting = meta !== null && countsOperatorAi(rules);
  const tallies = meta === null ? null : operatorTalliesRepo(meta);

  const used = async (): Promise<number | null> => {
    if (!counting || tallies === null) return null;
    return (await tallies.get(AI_TOKENS_TALLY))?.amount ?? 0;
  };
  const left = async (): Promise<number | null> => {
    if (rules.budget === null) return null;
    return Math.max(0, rules.budget - ((await used()) ?? 0));
  };
  const charge = async (tokens: number): Promise<void> => {
    const n = whole(tokens);
    if (!counting || tallies === null || n === 0) return;
    await tallies.add(AI_TOKENS_TALLY, n, now());
  };
  /** Tokens the calls running now reserved and have not yet counted. */
  let reserved = 0;
  /**
   * Room for one call: `want` tokens (its input and its most), held out of what is left after the running calls' own;
   * the refusal when nothing is. `rest` is what the call may spend (null with no budget); `settle` counts what it spent
   * and lets the reservation go.
   */
  const reserve = async (want: number, refuse: () => Error): Promise<{ rest: number | null; settle(spent: number): Promise<void> }> => {
    if (!counting) return { rest: null, settle: async () => undefined };
    const spent = (await used()) ?? 0;
    // Nothing is awaited from here until the reservation is made: two calls never both read the same room.
    const rest = rules.budget === null ? null : rules.budget - spent - reserved;
    if (rest !== null && rest <= 0) throw refuse();
    const held = rest === null ? 0 : Math.min(rest, Math.max(1, whole(want)));
    reserved += held;
    let open = true;
    return {
      rest,
      async settle(tokens) {
        if (!open) return;
        open = false;
        try {
          await charge(tokens);
        } finally {
          reserved -= held;
        }
      },
    };
  };
  /** A call that failed or was stopped: its input and what it streamed, unless it never reached a model. */
  const failedCost = (error: unknown, input: number, streamed: number): number => (error instanceof ProviderError && NOT_RUN.has(error.code) ? 0 : input + streamed);

  return {
    rules,
    counting,
    used,
    left,
    charge,
    async open() {
      if (counting && tallies !== null) await tallies.open(AI_TOKENS_TALLY, now());
    },
    client(inner) {
      const metered: ProviderClient = {
        id: inner.id,
        listModels: () => inner.listModels(),
        async complete(req) {
          const input = estimateTokens(req.system) + req.messages.reduce((sum, message) => sum + estimateTokens(message.content), 0);
          const room = await reserve(input + req.maxTokens, () => new OperatorAiUsedUpError(inner.id));
          let result: Awaited<ReturnType<ProviderClient['complete']>>;
          try {
            result = await inner.complete(room.rest === null ? req : { ...req, maxTokens: Math.max(1, Math.min(req.maxTokens, room.rest)) });
          } catch (error) {
            await room.settle(failedCost(error, input, 0));
            throw error;
          }
          await room.settle(result.usage === undefined ? input + estimateTokens(result.text) : result.usage.inputTokens + result.usage.outputTokens);
          return result;
        },
        async test() {
          const room = await reserve(PING_TOKENS, () => new OperatorAiUsedUpError(inner.id));
          try {
            return await inner.test();
          } finally {
            await room.settle(PING_TOKENS);
          }
        },
      };
      if (inner.transcribe !== undefined) {
        const transcribe = inner.transcribe.bind(inner);
        metered.transcribe = async (req) => {
          // Speech is paid by its length; a reply that does not say how long is counted from the recording's size.
          const sent = (req.audio.byteLength / 4000) * SPEECH_TOKENS_PER_SECOND;
          const room = await reserve(sent, () => new OperatorAiUsedUpError(inner.id));
          let heard: Awaited<ReturnType<typeof transcribe>>;
          try {
            heard = await transcribe(req);
          } catch (error) {
            await room.settle(failedCost(error, sent, 0));
            throw error;
          }
          const seconds = heard.seconds ?? req.audio.byteLength / 4000;
          await room.settle(seconds * SPEECH_TOKENS_PER_SECOND + estimateTokens(heard.text));
          return heard;
        };
      }
      return metered;
    },
    runner(inner) {
      return {
        id: inner.id,
        async run(req) {
          const input = estimateTokens(req.system) + estimateTokens(JSON.stringify(req.messages));
          const room = await reserve(input + req.maxTokens, () => new OperatorAiUsedUpError(inner.id));
          const maxTokens = room.rest === null ? req.maxTokens : Math.max(1, Math.min(req.maxTokens, room.rest));
          // What streamed, for a reply that is stopped: its words as they came, and a tool call's arguments (which do not
          // stream here) as all the reply could have been.
          let words = '';
          let calling = false;
          const onEvent = req.onEvent;
          const watched = {
            ...req,
            maxTokens,
            onEvent: (event: Parameters<NonNullable<typeof onEvent>>[0]) => {
              if (event.type === 'text') words += event.delta;
              else calling = true;
              onEvent?.(event);
            },
          };
          let result: Awaited<ReturnType<ProviderRunner['run']>>;
          try {
            result = await inner.run(watched);
          } catch (error) {
            await room.settle(failedCost(error, input, calling ? maxTokens : estimateTokens(words)));
            throw error;
          }
          await room.settle(result.usage === undefined ? input + estimateTokens(JSON.stringify(result.blocks)) : result.usage.inputTokens + result.usage.outputTokens);
          return result;
        },
      };
    },
    maker(inner) {
      return {
        kind: inner.kind,
        listModels: (signal) => inner.listModels(signal),
        async make(req) {
          const input = estimateTokens(req.prompt);
          const room = await reserve(req.count * PICTURE_TOKENS + input, () => new PictureError('billing', USED_UP_MESSAGE));
          let made: Awaited<ReturnType<PictureMaker['make']>>;
          try {
            made = await inner.make(req);
          } catch (error) {
            // A picture is paid for when it is delivered.
            await room.settle(0);
            throw error;
          }
          await room.settle(made.pictures.length * PICTURE_TOKENS + input);
          return made;
        },
      };
    },
  };
}
