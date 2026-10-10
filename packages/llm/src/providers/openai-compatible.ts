// SPDX-License-Identifier: AGPL-3.0-only
/**
 * OpenAI-compatible client: same Chat Completions wire format as OpenAI against
 * a user-supplied `baseUrl` (Groq, Together, vLLM, LM Studio, …). The Bearer key
 * is optional; the model-list endpoint may be absent, so a 404 is tolerated →
 * empty list → free-text model field in the UI.
 */
import {
  buildOpenAiChatBody,
  parseOpenAiChatResponse,
  type OpenAiChatResponse,
  OPENAI_TRANSCRIBE_MODEL,
} from './openai.js';
import { pingComplete, requestJson, transcribeOpenAiStyle } from './http.js';
import { listOpenAiCompatibleModels } from './model-catalog.js';
import {
  assertEnrichmentTemperature,
  requireBaseUrl,
  requireModel,
  type ProviderClient,
  type ProviderConfig,
} from './types.js';

export function createOpenAiCompatibleClient(config: ProviderConfig): ProviderClient {
  const baseUrl = requireBaseUrl(config, 'openai-compatible');
  const apiKey = config.apiKey; // optional
  const hasKey = apiKey !== undefined && apiKey.trim() !== '';
  const timeoutMs = config.timeoutMs;

  const headers = (): Record<string, string> => {
    const h: Record<string, string> = { 'content-type': 'application/json' };
    if (hasKey) h['authorization'] = `Bearer ${apiKey ?? ''}`;
    return h;
  };

  const client: ProviderClient = {
    id: 'openai-compatible',

    async listModels() {
      return listOpenAiCompatibleModels({
        baseUrl,
        ...(hasKey ? { apiKey } : {}),
        ...(timeoutMs !== undefined ? { timeoutMs } : {}),
      });
    },

    async complete(req) {
      assertEnrichmentTemperature(req.temperature, 'openai-compatible');
      const json = await requestJson<OpenAiChatResponse>({
        provider: 'openai-compatible',
        method: 'POST',
        url: `${baseUrl}/chat/completions`,
        headers: headers(),
        ...(hasKey ? { apiKey } : {}),
        ...(timeoutMs !== undefined ? { timeoutMs } : {}),
        body: buildOpenAiChatBody(req),
      });
      return parseOpenAiChatResponse(json, 'openai-compatible');
    },

    async test() {
      return pingComplete(client, requireModel(config, 'openai-compatible'));
    },

    // Offered because the route is part of what such a server copies; one that has no such route answers 404,
    // which the caller reads as "this server does not transcribe" (and falls back to the browser's own).
    async transcribe(req) {
      return transcribeOpenAiStyle({
        provider: 'openai-compatible',
        baseUrl,
        ...(hasKey ? { apiKey: apiKey as string } : {}),
        ...(timeoutMs !== undefined ? { timeoutMs } : {}),
        model: req.model ?? OPENAI_TRANSCRIBE_MODEL,
        req,
      });
    },
  };

  return client;
}
