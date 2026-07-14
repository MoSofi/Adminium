/**
 * Provider dispatcher tests (06-llm-assist.md §3.1): each supported ProviderId
 * maps to the right client id; `adminium-managed` is a config error in this build.
 */
import { describe, expect, it } from 'vitest';

import { createProviderClient } from './factory.js';
import { ProviderError } from './types.js';

describe('createProviderClient', () => {
  it('constructs the matching client for each supported provider', () => {
    expect(createProviderClient({ provider: 'anthropic', apiKey: 'k', model: 'm' }).id).toBe('anthropic');
    expect(createProviderClient({ provider: 'openai', apiKey: 'k', model: 'm' }).id).toBe('openai');
    expect(
      createProviderClient({ provider: 'openai-compatible', baseUrl: 'http://x/v1', model: 'm' }).id,
    ).toBe('openai-compatible');
    expect(createProviderClient({ provider: 'ollama', model: 'm' }).id).toBe('ollama');
  });

  it('rejects adminium-managed (M12, not this build)', () => {
    const err = (() => {
      try {
        createProviderClient({ provider: 'adminium-managed' });
        return undefined;
      } catch (e) {
        return e;
      }
    })();
    expect(err).toBeInstanceOf(ProviderError);
    expect((err as ProviderError).code).toBe('config');
  });
});
