// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The four providers a model can come from, as the Designer's picker and
 * "Add a model" dialog name them. Which fields each needs comes from Studio's
 * provider catalogue (pure data, no words), so both surfaces agree.
 */
import { providerCatalogEntry, type ConfigurableProvider } from '../../studio/ai/providerCatalog.js';
import { t } from '../../i18n/t.js';

export const PROVIDERS: readonly ConfigurableProvider[] = ['anthropic', 'openai', 'openai-compatible', 'ollama'];

export function providerLabel(provider: string): string {
  switch (provider) {
    case 'anthropic':
      return t('designer:provider.anthropic', 'Anthropic');
    case 'openai':
      return t('designer:provider.openai', 'OpenAI');
    case 'openai-compatible':
      return t('designer:provider.compatible', 'OpenAI-compatible');
    case 'ollama':
      return t('designer:provider.ollama', 'Ollama (local)');
    default:
      return provider;
  }
}

export function providerLine(provider: ConfigurableProvider): string {
  switch (provider) {
    case 'anthropic':
      return t('designer:provider.anthropicLine', 'Claude models. Needs an API key.');
    case 'openai':
      return t('designer:provider.openaiLine', 'GPT models. Needs an API key.');
    case 'openai-compatible':
      return t('designer:provider.compatibleLine', 'Any service that speaks the same protocol. Needs an address.');
    case 'ollama':
      return t('designer:provider.ollamaLine', 'Models running on this machine. No key.');
  }
}

/** What the form asks for: a key (required, optional or none) and an address. */
export function providerFields(provider: ConfigurableProvider) {
  const entry = providerCatalogEntry(provider);
  return {
    key: entry.key,
    address: entry.baseUrl,
    addressDefault: entry.baseUrlDefault ?? '',
    addressPlaceholder: entry.baseUrlPlaceholder ?? '',
    keyPlaceholder: entry.keyPlaceholder ?? '',
  };
}

/** A model's name split so its version reads in mono: "Claude Sonnet 5.5" → "Claude Sonnet " + "5.5"; an id is all mono. */
export function nameParts(label: string): { pre: string; ver: string } {
  const at = label.lastIndexOf(' ');
  return at === -1 ? { pre: '', ver: label } : { pre: label.slice(0, at + 1), ver: label.slice(at + 1) };
}
