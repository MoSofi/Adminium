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
 * Past the budget a call is refused before it is made, with
 * {@link OperatorAiUsedUpError} (a picture, with a `PictureError` that says
 * the same). The operator's gateway keeps its own budget too, so a call that
 * starts just under the line and ends over it is the most this can overspend:
 * each call's reply is held to what is left.
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
  /** What is left, or the refusal when nothing is. */
  const room = async (provider: ProviderId): Promise<number | null> => {
    const rest = await left();
    if (rest !== null && rest <= 0) throw new OperatorAiUsedUpError(provider);
    return rest;
  };

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
          const rest = await room(inner.id);
          const result = await inner.complete(rest === null ? req : { ...req, maxTokens: Math.max(1, Math.min(req.maxTokens, rest)) });
          await charge(
            result.usage === undefined
              ? estimateTokens(req.system) + req.messages.reduce((sum, message) => sum + estimateTokens(message.content), 0) + estimateTokens(result.text)
              : result.usage.inputTokens + result.usage.outputTokens,
          );
          return result;
        },
        async test() {
          await room(inner.id);
          const result = await inner.test();
          await charge(PING_TOKENS);
          return result;
        },
      };
      if (inner.transcribe !== undefined) {
        const transcribe = inner.transcribe.bind(inner);
        metered.transcribe = async (req) => {
          await room(inner.id);
          const heard = await transcribe(req);
          // Speech is paid by its length; a reply that does not say how long is counted from the recording's size.
          const seconds = heard.seconds ?? req.audio.byteLength / 4000;
          await charge(seconds * SPEECH_TOKENS_PER_SECOND + estimateTokens(heard.text));
          return heard;
        };
      }
      return metered;
    },
    runner(inner) {
      return {
        id: inner.id,
        async run(req) {
          const rest = await room(inner.id);
          const result = await inner.run(rest === null ? req : { ...req, maxTokens: Math.max(1, Math.min(req.maxTokens, rest)) });
          await charge(result.usage === undefined ? estimateTokens(req.system) + estimateTokens(JSON.stringify(req.messages)) + estimateTokens(JSON.stringify(result.blocks)) : result.usage.inputTokens + result.usage.outputTokens);
          return result;
        },
      };
    },
    maker(inner) {
      return {
        kind: inner.kind,
        listModels: (signal) => inner.listModels(signal),
        async make(req) {
          if ((await left()) === 0) throw new PictureError('billing', USED_UP_MESSAGE);
          const made = await inner.make(req);
          await charge(made.pictures.length * PICTURE_TOKENS + estimateTokens(req.prompt));
          return made;
        },
      };
    },
  };
}
