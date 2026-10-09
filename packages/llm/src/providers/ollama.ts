// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Local Ollama client: no auth, `baseUrl` defaults to `http://localhost:11434`.
 * POST `/api/chat` (non-streaming); `GET /api/tags` for the model list. The only
 * direct provider promoted in Electron offline mode. temperature (fixed 0) goes
 * in `options` per the Ollama chat API, as does the context window (`num_ctx`).
 * A chat request gets `OLLAMA_TIMEOUT_MS`, not the shared default.
 */
import { pingComplete, requestJson, toCompleteResult } from './http.js';
import { listOllamaModels } from './model-catalog.js';
import {
  assertEnrichmentTemperature,
  OLLAMA_NUM_CTX,
  OLLAMA_TIMEOUT_MS,
  ProviderError,
  requireModel,
  stripTrailingSlash,
  nativeToolCallNames,
  type ProviderClient,
  type ProviderConfig,
} from './types.js';

const DEFAULT_BASE_URL = 'http://localhost:11434';

interface OllamaChatResponse {
  message?: { content?: string; tool_calls?: { function?: { name?: unknown } }[] };
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
        timeoutMs: timeoutMs ?? OLLAMA_TIMEOUT_MS,
        body: {
          model: req.model,
          messages,
          stream: false,
          options: { temperature: req.temperature, num_predict: req.maxTokens, num_ctx: OLLAMA_NUM_CTX },
        },
      });

      const text = json.message?.content;
      if (typeof text !== 'string' || text.length === 0) {
        // Some models answer a request for JSON with a call in their own
        // tool format and no text at all. Named, so a caller can ask again
        // and say what was wrong; unnamed, it reads as a provider fault.
        const toolCalls = nativeToolCallNames(json.message?.tool_calls);
        throw new ProviderError({
          provider: 'ollama',
          code: 'empty_response',
          message:
            toolCalls.length > 0
              ? `ollama: the model answered with its own tool call (${toolCalls.join(', ')}) and no text`
              : 'ollama: response contained no message content',
          toolCalls,
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
