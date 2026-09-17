// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Anthropic Messages API client. Auth: `x-api-key` + `anthropic-version`; POST
 * `/v1/messages` in the Messages wire format. Fetch only, no SDK. Enrichment
 * temperature is fixed at 0 (asserted) and sent only to the models that still
 * accept it — see {@link anthropicAcceptsTemperature}.
 */
import { pingComplete, requestJson, toCompleteResult } from './http.js';
import { anthropicAcceptsTemperature, listAnthropicModels } from './model-catalog.js';
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
      /*
       * `temperature` is OMITTED for every model that has dropped sampling
       * (4.7 and newer): those 400 the whole request rather than ignoring the
       * field, so one deprecated parameter fails an entire enrichment run.
       *
       * The determinism mandate cannot be honoured on those models by any
       * request this client can make — the knob is gone, and the API samples at
       * its own default. `assertEnrichmentTemperature` above still stands: a
       * caller asking for 0.7 is a bug wherever it lands, and on a 4.6-or-older
       * model the 0 below is still sent and still binding.
       */
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
          ...(anthropicAcceptsTemperature(req.model) ? { temperature: req.temperature } : {}),
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
          code: 'empty_response',
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
