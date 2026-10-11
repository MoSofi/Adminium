// SPDX-License-Identifier: AGPL-3.0-only
/**
 * OpenAI Chat Completions client. Auth: `Authorization: Bearer`; POST
 * `/v1/chat/completions`. The wire-format helpers are exported and reused by the
 * openai-compatible client. Fetch only, temperature fixed at 0.
 */
import { pingComplete, requestJson, toCompleteResult, transcribeOpenAiStyle } from './http.js';
import { listOpenAiModels } from './model-catalog.js';
import {
  assertEnrichmentTemperature,
  ProviderError,
  requireApiKey,
  requireModel,
  stripTrailingSlash,
  type CompleteRequest,
  type CompleteResult,
  type ProviderClient,
  type ProviderConfig,
  type ProviderId,
  nativeToolCallNames,
} from './types.js';

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';

/** OpenAI's transcription model, when the caller names none. */
export const OPENAI_TRANSCRIBE_MODEL = 'whisper-1';

export interface OpenAiChatResponse {
  choices?: { message?: { content?: string | null; tool_calls?: { function?: { name?: unknown } }[] } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/** Builds the Chat Completions request body, prepending the system message when present. */
export function buildOpenAiChatBody(req: CompleteRequest, official: OfficialShape | null = null): Record<string, unknown> {
  const messages: { role: string; content: string }[] = [];
  if (req.system.length > 0) messages.push({ role: 'system', content: req.system });
  for (const m of req.messages) messages.push({ role: m.role, content: m.content });
  if (official === null) return { model: req.model, max_tokens: req.maxTokens, temperature: req.temperature, messages };
  return {
    model: req.model,
    max_completion_tokens: req.maxTokens,
    ...(official === 'quiet' ? { reasoning_effort: 'none' } : {}),
    ...(official === 'bare' ? {} : { temperature: req.temperature }),
    messages,
  };
}

/**
 * How a request to the official API is shaped. Seen on the real service
 * (2026-10-11, gpt-6-luna): `max_tokens` is refused outright (every model takes
 * `max_completion_tokens`), and a model that reasons refuses `temperature: 0`
 * unless its reasoning is off.
 *
 *  - `plain`: the temperature as asked. What a model that does not reason takes.
 *  - `quiet`: the same with `reasoning_effort: "none"`. What a model that
 *    reasons takes, and still at temperature 0.
 *  - `bare`: no temperature at all, for a model that takes neither.
 *
 * A model is asked the first way, and the next one only when the service
 * refuses the request for its temperature or its reasoning; what it took is
 * remembered for the process.
 */
export type OfficialShape = 'plain' | 'quiet' | 'bare';
const OFFICIAL_SHAPES: readonly OfficialShape[] = ['plain', 'quiet', 'bare'];
const refusedForShape = (error: unknown): boolean => error instanceof ProviderError && error.status === 400 && /temperature|reasoning_effort/.test(error.message);

/** Extracts assistant text + token usage from a Chat Completions response. */
export function parseOpenAiChatResponse(json: OpenAiChatResponse, provider: ProviderId): CompleteResult {
  const text = json.choices?.[0]?.message?.content;
  if (typeof text !== 'string' || text.length === 0) {
    // A model that answers a request for JSON with a call in its own tool
    // format and no text: named, so a caller can ask again and say what was wrong.
    const toolCalls = nativeToolCallNames(json.choices?.[0]?.message?.tool_calls);
    throw new ProviderError({
      provider,
      code: 'empty_response',
      message:
        toolCalls.length > 0
          ? `${provider}: the model answered with its own tool call (${toolCalls.join(', ')}) and no text`
          : `${provider}: response contained no message content`,
      toolCalls,
    });
  }
  return toCompleteResult(text, json.usage?.prompt_tokens, json.usage?.completion_tokens);
}

export function createOpenAiClient(config: ProviderConfig): ProviderClient {
  const apiKey = requireApiKey(config, 'openai');
  const baseUrl = config.baseUrl ? stripTrailingSlash(config.baseUrl) : DEFAULT_BASE_URL;
  const timeoutMs = config.timeoutMs;

  const headers = (): Record<string, string> => ({
    'content-type': 'application/json',
    authorization: `Bearer ${apiKey}`,
  });

  /** The shape each model took. */
  const shapes = new Map<string, OfficialShape>();

  const client: ProviderClient = {
    id: 'openai',

    async listModels() {
      return listOpenAiModels({ apiKey, baseUrl, ...(timeoutMs !== undefined ? { timeoutMs } : {}) });
    },

    async complete(req) {
      assertEnrichmentTemperature(req.temperature, 'openai');
      let at = OFFICIAL_SHAPES.indexOf(shapes.get(req.model) ?? 'plain');
      for (;;) {
        const shape = OFFICIAL_SHAPES[at] as OfficialShape;
        try {
          const json = await requestJson<OpenAiChatResponse>({
            provider: 'openai',
            method: 'POST',
            url: `${baseUrl}/chat/completions`,
            headers: headers(),
            apiKey,
            ...(timeoutMs !== undefined ? { timeoutMs } : {}),
            body: buildOpenAiChatBody(req, shape),
          });
          shapes.set(req.model, shape);
          return parseOpenAiChatResponse(json, 'openai');
        } catch (error) {
          if (at === OFFICIAL_SHAPES.length - 1 || !refusedForShape(error)) throw error;
          at += 1;
        }
      }
    },

    async test() {
      return pingComplete(client, requireModel(config, 'openai'));
    },

    async transcribe(req) {
      return transcribeOpenAiStyle({ provider: 'openai', baseUrl, apiKey, ...(timeoutMs !== undefined ? { timeoutMs } : {}), model: req.model ?? OPENAI_TRANSCRIBE_MODEL, req });
    },
  };

  return client;
}
