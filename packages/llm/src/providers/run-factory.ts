// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The runner for a provider configuration, and the test of whether a model
 * can be built with.
 */
import { createAnthropicRunner } from './run-anthropic.js';
import { createOllamaRunner } from './run-ollama.js';
import { createOpenAiCompatibleRunner, createOpenAiRunner } from './run-openai.js';
import type { ProviderRunner, RunMessage, RunTool } from './run-types.js';
import { ProviderError, type ProviderConfig } from './types.js';

export function createProviderRunner(config: ProviderConfig): ProviderRunner {
  switch (config.provider) {
    case 'anthropic':
      return createAnthropicRunner(config);
    case 'openai':
      return createOpenAiRunner(config);
    case 'openai-compatible':
      return createOpenAiCompatibleRunner(config);
    case 'ollama':
      return createOllamaRunner(config);
    default:
      throw new ProviderError({
        provider: config.provider,
        code: 'config',
        message: `${config.provider}: this provider cannot run tools in this build`,
      });
  }
}

export type CanBuild =
  /** It called the tool and took the answer. `reportsUsage`: both turns said how many tokens they used. */
  | { canBuild: true; reportsUsage: boolean }
  | {
      canBuild: false;
      /** `no-tool-call`: it ignored the tool. `refused-result`: it would not take the tool's answer. */
      reason: 'no-tool-call' | 'refused-result' | 'error';
      message: string;
    };

const ECHO: RunTool = {
  name: 'echo',
  description: 'Repeats one word back. Call it when asked to.',
  inputSchema: {
    type: 'object',
    properties: { word: { type: 'string', description: 'The word to repeat.' } },
    required: ['word'],
    additionalProperties: false,
  },
};

const WORD = 'adminium';
const CAN_BUILD_TOKENS = 256;

/**
 * Whether a model can be built with: a whole round trip, not a ping.
 *
 * Asking for one tool call is not enough. Some servers accept `tools` and
 * ignore it; others make the call and then refuse the message that carries
 * its result. Both look fine until the second request of a real turn. So
 * this sends the call's result back and expects the model to finish.
 */
export async function canBuild(runner: ProviderRunner, model: string, opts: { signal?: AbortSignal } = {}): Promise<CanBuild> {
  const system = 'You are being checked. Follow the instruction exactly.';
  const messages: RunMessage[] = [
    { role: 'user', content: [{ type: 'text', text: `Call the tool "echo" with the word "${WORD}". Do not answer in words.` }] },
  ];
  const base = { system, model, tools: [ECHO], maxTokens: CAN_BUILD_TOKENS, ...(opts.signal === undefined ? {} : { signal: opts.signal }) };

  let first;
  try {
    first = await runner.run({ ...base, messages });
  } catch (error) {
    // The caller's own stop is not a verdict on the model.
    if (error instanceof ProviderError && error.code === 'aborted') throw error;
    return { canBuild: false, reason: 'error', message: error instanceof Error ? error.message : String(error) };
  }
  const call = first.blocks.find((block) => block.type === 'tool_call');
  if (call === undefined || call.type !== 'tool_call' || call.name !== ECHO.name) {
    return { canBuild: false, reason: 'no-tool-call', message: 'The model answered in words instead of calling the tool it was given.' };
  }
  if (first.malformed.length > 0 || String(call.input['word'] ?? '').toLowerCase() !== WORD) {
    return { canBuild: false, reason: 'no-tool-call', message: 'The model called the tool, but not with the arguments it was asked for.' };
  }

  let second;
  try {
    second = await runner.run({
      ...base,
      messages: [
        ...messages,
        { role: 'assistant', content: first.blocks },
        {
          role: 'user',
          content: [
            { type: 'tool_result', callId: call.id, content: WORD },
            { type: 'text', text: 'Now answer with the single word: done' },
          ],
        },
      ],
    });
  } catch (error) {
    if (error instanceof ProviderError && error.code === 'aborted') throw error;
    return {
      canBuild: false,
      reason: 'refused-result',
      message: `The model called the tool, and the server refused the tool's answer: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  return { canBuild: true, reportsUsage: first.usage !== undefined && second.usage !== undefined };
}
