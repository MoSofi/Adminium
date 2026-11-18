// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Who a website chat's automatic answerer sends a visitor's words to, named by
 * the server from the connection it would use, never guessed by a page (the
 * voice card's pattern): a fixed provider by its own name, a service reached
 * at an address by that address's host, and a local Ollama by its name (a
 * `:cloud` model of it runs at ollama.com, so it is named that).
 *
 * The sentence the settings page shows beside the switch is made here too, in
 * the reader's language.
 */
import type { I18nInstance } from '@adminium/i18n/server';

import type { AiConnection } from '../llm/connections.js';

const FIXED: Readonly<Record<string, string>> = { anthropic: 'Anthropic', openai: 'OpenAI', 'adminium-managed': 'Adminium' };

/** The host of an address, or null when it does not read as one. */
function hostOf(address: string | null): string | null {
  if (address === null || address === '') return null;
  try {
    return new URL(address).hostname || null;
  } catch {
    return null;
  }
}

/** The name of the service a connection sends to, as the settings page says it. */
export function chatServiceName(connection: Pick<AiConnection, 'provider' | 'baseUrl'>, model: string | null): string {
  const fixed = FIXED[connection.provider];
  if (fixed !== undefined) return fixed;
  if (connection.provider === 'ollama') {
    if (model !== null && /:cloud$|-cloud$/.test(model)) return 'ollama.com';
    return hostOf(connection.baseUrl) ?? 'Ollama';
  }
  return hostOf(connection.baseUrl) ?? connection.provider;
}

/** "Visitors' messages are sent to {service} to pick an answer. Nothing else is sent.", in the reader's language. */
export function chatAiNotice(i18n: Pick<I18nInstance, 't'>, service: string): string {
  return i18n.t('email:chat.aiNotice', { service, defaultValue: 'Visitors’ messages are sent to {service} to pick an answer. Nothing else is sent.' });
}
