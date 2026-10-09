// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Test the assistant with this model": one small turn, to find a model that
 * cannot run the assistant when it is CHOSEN, not in the middle of somebody's
 * work.
 *
 * A model can answer a connection test and still be unable to follow the
 * reply format: it answers in prose, or in its own tool-calling format, or
 * never uses a tool it was offered. So the test is the real loop
 * ({@link runAssistantTurn}), on the real prompt of a page that drafts
 * nothing, with ONE tool whose answer cannot be guessed: a number made for
 * this run. It passes when the model called the tool and said the number.
 *
 * Three provider calls at most (the call, the answer, one slip). A model
 * that needs more than one repair to count to a number is not one to work
 * with, and the cap bounds what a press of the button can cost.
 */

import { randomInt } from 'node:crypto';

import { buildAssistantPrompt, type AssistantToolSpec, type ProviderClient } from '@adminium/llm';

import { runAssistantTurn } from './turn-runner.js';

/** Why a model did not pass, as a KIND: the dashboard has the words. */
export type AssistantModelTestFailure =
  /** It never answered in the reply format. */
  | 'format'
  /** It answered without using the tool it was told to use. */
  | 'no-tool'
  /** It used the tool and then said something else. */
  | 'wrong-value'
  /** The provider itself failed: the connection test is the one to read. */
  | 'provider';

export interface AssistantModelTestResult {
  ok: boolean;
  /** Provider calls made. */
  rounds: number;
  latencyMs: number;
  failure: AssistantModelTestFailure | null;
  /** The provider's own sentence when it failed; never the key. */
  message: string | null;
}

/** Provider calls one test may make. */
export const ASSISTANT_MODEL_TEST_ROUNDS = 3;

const PING: AssistantToolSpec = {
  name: 'ping',
  description: 'Answers one number. Call it with no arguments.',
  args: { type: 'object', properties: {}, additionalProperties: false },
};

const QUESTION = 'Call the tool "ping" and tell me the number it answers.';

export async function testAssistantModel(input: {
  client: ProviderClient;
  provider: string;
  model: string;
  name: string;
  now?: (() => number) | undefined;
  /** The number the tool answers; made per run unless a test fixes it. */
  value?: number | undefined;
}): Promise<AssistantModelTestResult> {
  const now = input.now ?? Date.now;
  const started = now();
  const value = input.value ?? randomInt(1000, 10_000);
  let rounds = 0;
  let pinged = false;

  // Counts the calls and stops at the cap: the runner's own cap is sized for real work.
  const stop = new AbortController();
  const client: ProviderClient = {
    id: input.client.id,
    listModels: () => input.client.listModels(),
    test: () => input.client.test(),
    complete: async (request) => {
      if (rounds >= ASSISTANT_MODEL_TEST_ROUNDS) {
        stop.abort();
        throw new Error('the test used its rounds');
      }
      rounds += 1;
      return input.client.complete(request);
    },
  };

  const outcome = await runAssistantTurn({
    client,
    model: input.model,
    provider: input.provider,
    maxTokens: 600,
    system: buildAssistantPrompt({
      name: input.name,
      appName: 'Adminium',
      pageLabel: 'Model test',
      localeName: 'English',
      pageFacts: 'This is a test of the reply format. There is no data here, only the tool below.',
      document: null,
      tools: [PING],
      rowsUnavailable: null,
    }),
    messages: [{ role: 'user', content: QUESTION }],
    execute: (call) => {
      if (call.tool !== PING.name) return Promise.resolve({ error: { code: 'UNKNOWN_TOOL', message: 'The only tool here is ping.' } });
      pinged = true;
      return Promise.resolve({ result: { number: value } });
    },
    accept: () => Promise.resolve({ ok: false as const, errors: [] }),
    signal: stop.signal,
    now,
  });

  const done = (failure: AssistantModelTestFailure | null, message: string | null = null): AssistantModelTestResult => ({
    ok: failure === null,
    rounds,
    latencyMs: now() - started,
    failure,
    message,
  });

  if (outcome.status === 'done') {
    if (!pinged) return done('no-tool');
    return outcome.say.includes(String(value)) ? done(null) : done('wrong-value');
  }
  if (outcome.status === 'failed') {
    const provider = outcome.errors.find((error) => 'kind' in error && error.kind === 'provider');
    // Out of rounds, or a reply that never became the format: the model's doing either way.
    if (outcome.reason === 'model-format' || provider === undefined || rounds >= ASSISTANT_MODEL_TEST_ROUNDS) return done('format');
    return done('provider', 'message' in provider ? provider.message : null);
  }
  // Asked a question back, or stopped at the cap mid-way: it did not do the one thing asked.
  return done(pinged ? 'wrong-value' : 'format');
}
