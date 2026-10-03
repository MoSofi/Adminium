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
      reason: 'no-tool-call' | 'refused-result';
      message: string;
    }
  /** The model could not be asked (a refused key, no answer): no verdict on the model. `code` is the provider error's. */
  | { canBuild: false; reason: 'error'; code: string; message: string };

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
    return { canBuild: false, reason: 'error', code: error instanceof ProviderError ? error.code : 'error', message: error instanceof Error ? error.message : String(error) };
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

/** A 32×32 picture, yellow above blue: what a model that reads pictures can name and one that does not cannot guess. */
export const PROBE_PICTURE = 'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAALklEQVR42u3NMQ0AAAgDsAnDvwqUcKGCg6RJ/2Y6pyIQCASCF0GqbwkEAoHgQ7BAmNxMGPuLHwAAAABJRU5ErkJggg==';

/**
 * Whether a model reads pictures: asked, not guessed from its name.
 *
 * True when it names both colours in their order; false when it answers
 * anything else, or the provider refuses a request that carries a picture;
 * null when the model could not be asked at all (the network, the key, a
 * busy server), which says nothing about the model.
 */
export async function readsImages(runner: ProviderRunner, model: string, opts: { signal?: AbortSignal } = {}): Promise<boolean | null> {
  try {
    const result = await runner.run({
      system: 'You are being checked. Follow the instruction exactly.',
      model,
      tools: [],
      maxTokens: CAN_BUILD_TOKENS,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'This picture has two colours, one above the other. Answer with two words: the colour on top, then the colour below.' },
            { type: 'image', mediaType: 'image/png', data: PROBE_PICTURE },
          ],
        },
      ],
      ...(opts.signal === undefined ? {} : { signal: opts.signal }),
    });
    const said = result.blocks.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join(' ');
    return /yellow[\s\S]*blue/i.test(said);
  } catch (error) {
    if (error instanceof ProviderError && error.code === 'aborted') throw error;
    // The request itself was refused: this model, or this server, takes no picture.
    if (error instanceof ProviderError && (error.code === 'http' || error.code === 'bad_response' || error.code === 'empty_response')) return false;
    return null;
  }
}
