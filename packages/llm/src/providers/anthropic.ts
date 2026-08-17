// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Anthropic Messages API client (06-llm-assist.md §3.1). Auth: `x-api-key` +
 * `anthropic-version`; POST `/v1/messages` in the Messages wire format. Fetch
 * only, no SDK. Enrichment temperature is fixed at 0 (asserted).
 */
import { pingComplete, requestJson, toCompleteResult } from './http.js';
import { listAnthropicModels } from './model-catalog.js';
import {
  assertEnrichmentTemperature,
  ProviderError,
  requireApiKey,
  requireModel,
  stripTrailingSlash,
  type ProviderClient,
  type ProviderConfig,
} from './types.js';

const ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_BASE_URL = 'https://api.anthropic.com';

interface AnthropicMessagesResponse {
  content?: { type?: string; text?: string }[];
  usage?: { input_tokens?: number; output_tokens?: number };
}

export function createAnthropicClient(config: ProviderConfig): ProviderClient {
  const apiKey = requireApiKey(config, 'anthropic');
  const baseUrl = config.baseUrl ? stripTrailingSlash(config.baseUrl) : DEFAULT_BASE_URL;
  const timeoutMs = config.timeoutMs;

  const headers = (): Record<string, string> => ({
    'content-type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': ANTHROPIC_VERSION,
  });

  const client: ProviderClient = {
    id: 'anthropic',

    async listModels() {
      return listAnthropicModels({
        apiKey,
        baseUrl,
        ...(timeoutMs !== undefined ? { timeoutMs } : {}),
      });
    },

    async complete(req) {
      assertEnrichmentTemperature(req.temperature, 'anthropic');
      const json = await requestJson<AnthropicMessagesResponse>({
        provider: 'anthropic',
        method: 'POST',
        url: `${baseUrl}/v1/messages`,
        headers: headers(),
        apiKey,
        ...(timeoutMs !== undefined ? { timeoutMs } : {}),
        body: {
          model: req.model,
          max_tokens: req.maxTokens,
          temperature: req.temperature,
          system: req.system,
          messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
        },
      });

      const text = (json.content ?? [])
        .filter((block) => block.type === 'text' && typeof block.text === 'string')
        .map((block) => block.text ?? '')
        .join('');
      if (text.length === 0) {
        throw new ProviderError({
          provider: 'anthropic',
          code: 'bad_response',
          message: 'anthropic: response contained no text content',
        });
      }
      return toCompleteResult(text, json.usage?.input_tokens, json.usage?.output_tokens);
    },

    async test() {
      return pingComplete(client, requireModel(config, 'anthropic'));
    },
  };

  return client;
}
