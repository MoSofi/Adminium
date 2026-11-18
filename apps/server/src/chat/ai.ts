// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHETHER A CHAT CAN USE AI NOW, and the service's name a visitor is told.
 *
 * The window's first line names the AI service whenever automatic answers or
 * Milo drafting send a visitor's words to it, so the name comes from the
 * server, never a guess: the provider of the connection the assistant uses
 * (`connections.default()`), as people know it, or the host of a model at an
 * address of the owner's own. AI is usable when there is such a connection
 * and the server may call it (`connections.refusal`: a provider, the network
 * on).
 */
import type { ProviderId } from '@adminium/llm';

import type { AiConnection, AiConnections } from '../llm/connections.js';

/** A provider's name, as a visitor reads it. */
const SERVICE_NAMES: Readonly<Record<ProviderId, string | null>> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  ollama: 'Ollama',
  'adminium-managed': 'Adminium',
  // A model at an address of the owner's own: named by its host.
  'openai-compatible': null,
};

/** What the door needs to know of AI for a chat. */
export interface ChatAi {
  usable: boolean;
  /** The service's name; null while none is usable. */
  service: string | null;
}

/** A connection's service, as a visitor reads it. */
export function serviceNameOf(connection: Pick<AiConnection, 'provider' | 'baseUrl'>): string | null {
  const named = SERVICE_NAMES[connection.provider];
  if (named !== null && named !== undefined) return named;
  if (connection.baseUrl === null || connection.baseUrl === '') return null;
  try {
    return new URL(connection.baseUrl).hostname || null;
  } catch {
    return null;
  }
}

/** Reads AI's state for chats from the server's connections. Never throws: an error is "not usable". */
export function chatAiFrom(connections: Pick<AiConnections, 'default' | 'refusal'>): () => Promise<ChatAi> {
  return async () => {
    try {
      const chosen = await connections.default();
      if (chosen === null || connections.refusal(chosen.connection) !== null) return { usable: false, service: null };
      const service = serviceNameOf(chosen.connection);
      return { usable: service !== null, service };
    } catch {
      return { usable: false, service: null };
    }
  };
}
