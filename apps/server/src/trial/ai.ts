// SPDX-License-Identifier: AGPL-3.0-only
/**
 * AI under trial mode: the person's own key to a provider's fixed public API
 * (Anthropic, OpenAI, Google), or the operator's own connection from the
 * environment. Never a model at an address the person types: that would make
 * this server call anywhere they like, with what they like.
 */
import { ProviderError, type ProviderId } from '@adminium/llm';

import type { TrialPolicy } from './policy.js';

/** The providers reached at an address somebody types: refused for a saved connection where the operator says so. */
export const ADDRESS_PROVIDERS: ReadonlySet<ProviderId> = new Set<ProviderId>(['openai-compatible', 'ollama']);

export const CUSTOM_PROVIDER_OFF = 'The operator allows only your own key to Anthropic, OpenAI or Google on this installation, so a model at an address of your own cannot be saved here.';

/**
 * The saved connection as the operator allows it, or a `ProviderError` saying
 * why not: a provider reached at a typed address, or any typed address, where
 * the profile refuses them. For the paths that call a model with what is saved.
 */
export function savedConnectionRefusal(policy: Pick<TrialPolicy, 'allows'>, provider: ProviderId, baseUrl: string | null): ProviderError | null {
  if (ADDRESS_PROVIDERS.has(provider) && !policy.allows('customAiProviders').allowed) {
    return new ProviderError({ provider, code: 'config', message: CUSTOM_PROVIDER_OFF });
  }
  if (baseUrl !== null && baseUrl !== '' && !policy.allows('aiBaseUrl').allowed) {
    return new ProviderError({ provider, code: 'config', message: TYPED_ADDRESS_OFF });
  }
  return null;
}

/** A test or a save that names an address of its own, where the operator allows none. */
export const TYPED_ADDRESS_OFF = 'The operator does not allow an AI address of your own on this installation.';
