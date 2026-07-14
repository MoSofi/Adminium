/**
 * Dispatches a `ProviderConfig` to the matching client constructor (§3.1).
 * `adminium-managed` is intentionally unsupported here — that Cloud-relay client
 * ships in M12, not this wave — and requesting it is a `config` error.
 */
import { createAnthropicClient } from './anthropic.js';
import { createOllamaClient } from './ollama.js';
import { createOpenAiCompatibleClient } from './openai-compatible.js';
import { createOpenAiClient } from './openai.js';
import { ProviderError, type ProviderClient, type ProviderConfig } from './types.js';

export function createProviderClient(config: ProviderConfig): ProviderClient {
  switch (config.provider) {
    case 'anthropic':
      return createAnthropicClient(config);
    case 'openai':
      return createOpenAiClient(config);
    case 'openai-compatible':
      return createOpenAiCompatibleClient(config);
    case 'ollama':
      return createOllamaClient(config);
    case 'adminium-managed':
      throw new ProviderError({
        provider: 'adminium-managed',
        code: 'config',
        message: 'the adminium-managed provider is not available in this build (M12)',
      });
    default: {
      const exhaustive: never = config.provider;
      throw new ProviderError({
        provider: 'anthropic',
        code: 'config',
        message: `unknown provider: ${String(exhaustive)}`,
      });
    }
  }
}
