// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Local Ollama client (06-llm-assist.md §3.1): no auth, `baseUrl` defaults to
 * `http://localhost:11434`. POST `/api/chat` (non-streaming); `GET /api/tags`
 * for the model list. The only direct provider promoted in Electron offline mode.
 * temperature (fixed 0) goes in `options` per the Ollama chat API.
 */
import { pingComplete, requestJson, toCompleteResult } from './http.js';
import { listOllamaModels } from './model-catalog.js';
import {
  assertEnrichmentTemperature,
  ProviderError,
  requireModel,
  stripTrailingSlash,
  type ProviderClient,
  type ProviderConfig,
} from './types.js';

const DEFAULT_BASE_URL = 'http://localhost:11434';

interface OllamaChatResponse {
  message?: { content?: string };
  prompt_eval_count?: number;
  eval_count?: number;
}

export function createOllamaClient(config: ProviderConfig): ProviderClient {
  const baseUrl = config.baseUrl ? stripTrailingSlash(config.baseUrl) : DEFAULT_BASE_URL;
  const timeoutMs = config.timeoutMs;

  const client: ProviderClient = {
    id: 'ollama',

    async listModels() {
      return listOllamaModels({ baseUrl, ...(timeoutMs !== undefined ? { timeoutMs } : {}) });
    },

    async complete(req) {
      assertEnrichmentTemperature(req.temperature, 'ollama');
      const messages: { role: string; content: string }[] = [];
      if (req.system.length > 0) messages.push({ role: 'system', content: req.system });
      for (const m of req.messages) messages.push({ role: m.role, content: m.content });

      const json = await requestJson<OllamaChatResponse>({
        provider: 'ollama',
        method: 'POST',
        url: `${baseUrl}/api/chat`,
        headers: { 'content-type': 'application/json' },
        ...(timeoutMs !== undefined ? { timeoutMs } : {}),
        body: {
          model: req.model,
          messages,
          stream: false,
          options: { temperature: req.temperature, num_predict: req.maxTokens },
        },
      });

      const text = json.message?.content;
      if (typeof text !== 'string' || text.length === 0) {
        throw new ProviderError({
          provider: 'ollama',
          code: 'bad_response',
          message: 'ollama: response contained no message content',
        });
      }
      return toCompleteResult(text, json.prompt_eval_count, json.eval_count);
    },

    async test() {
      return pingComplete(client, requireModel(config, 'ollama'));
    },
  };

  return client;
}
