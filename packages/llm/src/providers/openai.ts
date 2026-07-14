/**
 * OpenAI Chat Completions client (06-llm-assist.md §3.1). Auth: `Authorization:
 * Bearer`; POST `/v1/chat/completions`. The wire-format helpers are exported and
 * reused by the openai-compatible client. Fetch only, temperature fixed at 0.
 */
import { pingComplete, requestJson, toCompleteResult } from './http.js';
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
} from './types.js';

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';

export interface OpenAiChatResponse {
  choices?: { message?: { content?: string | null } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/** Builds the Chat Completions request body, prepending the system message when present. */
export function buildOpenAiChatBody(req: CompleteRequest): Record<string, unknown> {
  const messages: { role: string; content: string }[] = [];
  if (req.system.length > 0) messages.push({ role: 'system', content: req.system });
  for (const m of req.messages) messages.push({ role: m.role, content: m.content });
  return {
    model: req.model,
    max_tokens: req.maxTokens,
    temperature: req.temperature,
    messages,
  };
}

/** Extracts assistant text + token usage from a Chat Completions response. */
export function parseOpenAiChatResponse(json: OpenAiChatResponse, provider: ProviderId): CompleteResult {
  const text = json.choices?.[0]?.message?.content;
  if (typeof text !== 'string' || text.length === 0) {
    throw new ProviderError({
      provider,
      code: 'bad_response',
      message: `${provider}: response contained no message content`,
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

  const client: ProviderClient = {
    id: 'openai',

    async listModels() {
      return listOpenAiModels({ apiKey, baseUrl, ...(timeoutMs !== undefined ? { timeoutMs } : {}) });
    },

    async complete(req) {
      assertEnrichmentTemperature(req.temperature, 'openai');
      const json = await requestJson<OpenAiChatResponse>({
        provider: 'openai',
        method: 'POST',
        url: `${baseUrl}/chat/completions`,
        headers: headers(),
        apiKey,
        ...(timeoutMs !== undefined ? { timeoutMs } : {}),
        body: buildOpenAiChatBody(req),
      });
      return parseOpenAiChatResponse(json, 'openai');
    },

    async test() {
      return pingComplete(client, requireModel(config, 'openai'));
    },
  };

  return client;
}
